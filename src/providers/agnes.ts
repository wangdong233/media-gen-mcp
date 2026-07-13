import type {
  MediaProvider,
  ImageRequest,
  ImageResult,
  VideoRequest,
  VideoTask,
  VideoHandle,
  VideoResult,
} from "./types.js";
import { persistProviderField } from "../config.js";

interface AgnesModelsConfig {
  image?: { default?: string; available?: string[] };
  video?: { default?: string; available?: string[] };
}

interface RateLimitEntry {
  minIntervalMs: number;
  learnedAt: string;
}

interface AgnesProviderConfig {
  apiKey: string;
  baseUrl: string;
  videoMinIntervalMs: number;
  models?: AgnesModelsConfig;
  rateLimits?: Record<string, RateLimitEntry>;
  rateLimitTtlMs: number;
}

const ALLOWED_NUM_FRAMES = [81, 121, 161, 241, 441] as const;
const NUM_FRAMES_ALLOWED = new Set<number>(ALLOWED_NUM_FRAMES);
const DEFAULT_NUM_FRAMES = 121;
const DEFAULT_FRAME_RATE = 24;
const DEFAULT_RESOLUTION = "720p";

const STATUS_MAP: Record<string, VideoResult["status"]> = {
  completed: "completed",
  succeeded: "completed",
  success: "completed",
  failed: "failed",
  error: "failed",
  cancelled: "failed",
  canceled: "failed",
};

/** 时长(秒)→ 最近合法 num_frames(按实际 frameRate 算,非硬编码 24)。 */
function framesForDuration(seconds: number, frameRate: number): number {
  let best = DEFAULT_NUM_FRAMES;
  let bestDelta = Infinity;
  for (const f of ALLOWED_NUM_FRAMES) {
    const d = Math.abs(f / frameRate - seconds);
    if (d < bestDelta) {
      bestDelta = d;
      best = f;
    }
  }
  return best;
}

/**
 * Agnes AI provider —— 基于 2026-07-11 curl 实测契约。
 *
 * 模型:工具参数 > config models.*.default > (无 fallback,缺失报错引导)。代码不内置厂商模型名。
 * 限流(per-model + TTL):基线 videoMinIntervalMs;429 学习 per-model 回写;TTL 过期降级基线。
 * 时钟 per-model:lastSubmitAt 按 model 独立计时,多模型交替不被错误全局串行。
 */
export class AgnesProvider implements MediaProvider {
  readonly name = "agnes";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiHost: string;
  private readonly videoMinIntervalMs: number;
  private readonly rateLimitTtlMs: number;
  private readonly models?: AgnesModelsConfig;
  private rateLimits: Record<string, RateLimitEntry>;
  private lastSubmitAt: Record<string, number> = {}; // per-model 提交时刻
  private submitChain: Promise<void> = Promise.resolve();

  constructor(c: AgnesProviderConfig) {
    this.apiKey = c.apiKey;
    this.baseUrl = c.baseUrl.replace(/\/$/, "");
    this.apiHost = this.baseUrl.replace(/\/v1\/?$/, "");
    this.videoMinIntervalMs = c.videoMinIntervalMs;
    this.rateLimitTtlMs = c.rateLimitTtlMs;
    this.models = c.models;
    this.rateLimits = { ...(c.rateLimits ?? {}) };
  }

  listModels(): string[] {
    const img = this.models?.image?.available ?? [];
    const vid = this.models?.video?.available ?? [];
    return [...img, ...vid];
  }

  videoConstraints() {
    return {
      allowedNumFrames: [...ALLOWED_NUM_FRAMES],
      defaultNumFrames: DEFAULT_NUM_FRAMES,
      defaultFrameRate: DEFAULT_FRAME_RATE,
    };
  }

  estimateGenerationSeconds(numFrames: number): number {
    return Math.ceil(numFrames * 0.93);
  }

  /** 当前 model 有效限流:学习值(未过期)?? 基线。 */
  private getRateLimit(model: string): number {
    const entry = this.rateLimits[model];
    if (entry?.minIntervalMs && entry?.learnedAt) {
      const age = Date.now() - Date.parse(entry.learnedAt);
      if (Number.isFinite(age) && age >= 0 && age < this.rateLimitTtlMs) {
        return entry.minIntervalMs;
      }
    }
    return this.videoMinIntervalMs;
  }

  /** 429 学习:解析真实限流,per-model 更新内存 + 回写 config。 */
  private learnRateLimit(model: string, body: any): void {
    const msg: string = body?.error?.message ?? body?.message ?? "";
    const m = msg.match(/(\d+)\s*requests?\s*per\s*(\d+)?\s*(minute|second|hour)s?/i);
    if (!m) return;
    const count = +m[1];
    const window = m[2] ? +m[2] : 1;
    if (!count || !window) return;
    const unit = m[3].toLowerCase();
    const unitMs = unit === "second" ? 1000 : unit === "minute" ? 60_000 : 3_600_000;
    const learned = Math.ceil((unitMs * window) / count) + 2000;
    const prev = this.rateLimits[model];
    const prevAge = prev?.learnedAt ? Date.now() - Date.parse(prev.learnedAt) : Infinity;
    const prevStale =
      !prev || !Number.isFinite(prevAge) || prevAge < 0 || prevAge >= this.rateLimitTtlMs;
    if (prevStale || learned > prev.minIntervalMs) {
      this.rateLimits[model] = { minIntervalMs: learned, learnedAt: new Date().toISOString() };
      console.error(
        `[media-gen-mcp] 从 429 学习到 ${model} 限速:${learned}ms/提交,回写 config.json`,
      );
      persistProviderField("agnes", "rateLimits", this.rateLimits).catch(() => {});
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.apiKey) throw new Error("AGNES_API_KEY is not set");
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? text;
      const e = new Error(`Agnes ${res.status}: ${msg}`);
      (e as any).status = res.status;
      (e as any).body = json;
      throw e;
    }
    return json;
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const model = req.model ?? this.models?.image?.default;
    if (!model) {
      throw new Error(
        "image model 未配置:请在 config.json 设 providers.agnes.models.image.default,或在工具参数传 model",
      );
    }
    const body: Record<string, unknown> = { model, prompt: req.prompt };
    if (req.size) body.size = req.size;
    if (req.n) body.n = req.n;
    if (req.images?.length) body.image = req.images;
    if (req.extra) Object.assign(body, req.extra);

    const r = await this.request("/images/generations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const outputs = (r.data ?? []).map((d: any) => ({
      url: d.url as string | undefined,
      b64: d.b64_json as string | undefined,
    }));
    return { outputs, raw: r };
  }

  /** per-model 限速串行化:submitChain 全局串行(避免并发),但按各 model 自己的时钟等待。 */
  private enqueueSubmit(model: string): Promise<void> {
    this.submitChain = this.submitChain.then(async () => {
      const minInterval = this.getRateLimit(model);
      const last = this.lastSubmitAt[model] ?? 0;
      const wait = minInterval - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastSubmitAt[model] = Date.now();
    });
    return this.submitChain;
  }

  async createVideo(req: VideoRequest): Promise<VideoTask> {
    const frameRate = req.frameRate ?? DEFAULT_FRAME_RATE;
    const numFrames = req.durationSeconds
      ? framesForDuration(req.durationSeconds, frameRate)
      : req.numFrames ?? DEFAULT_NUM_FRAMES;
    if (!NUM_FRAMES_ALLOWED.has(numFrames)) {
      throw new Error(
        `num_frames=${numFrames} is not allowed by Agnes; must be one of ${[...ALLOWED_NUM_FRAMES].join("/")} (8n+1, ≤441)`,
      );
    }

    const model = req.model ?? this.models?.video?.default;
    if (!model) {
      throw new Error(
        "video model 未配置:请在 config.json 设 providers.agnes.models.video.default,或在工具参数传 model",
      );
    }

    const mode =
      req.mode ??
      (req.keyframes?.length ? "keyframes" : req.image ? "image-to-video" : "text-to-video");

    if (mode === "image-to-video" && !req.image) {
      throw new Error("image-to-video requires `image` (single URL)");
    }
    if (mode === "keyframes" && !req.keyframes?.length) {
      throw new Error("keyframes requires `keyframes` (URL array)");
    }

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      num_frames: numFrames,
      frame_rate: frameRate,
      resolution: req.resolution ?? DEFAULT_RESOLUTION,
      ...(req.ratio ? { ratio: req.ratio } : {}),
      ...(req.seed ? { seed: req.seed } : {}),
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    };

    if (mode === "image-to-video") {
      body.image = req.image;
      body.mode = "ti2vid";
    } else if (mode === "keyframes") {
      body.mode = "keyframes";
      body.extra_body = { image: req.keyframes, mode: "keyframes" };
    } else {
      body.mode = "ti2vid";
    }

    if (req.extra) Object.assign(body, req.extra);

    await this.enqueueSubmit(model);

    try {
      const r = await this.request("/videos", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        taskId: r.task_id ?? r.id,
        videoId: r.video_id,
        status: r.status ?? "queued",
        raw: r,
      };
    } catch (e: any) {
      if (e?.status === 429) this.learnRateLimit(model, e.body);
      throw e;
    }
  }

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    let r: any;
    if (handle.videoId) {
      r = await this.request(
        `${this.apiHost}/agnesapi?video_id=${encodeURIComponent(handle.videoId)}`,
        { method: "GET" },
      );
    } else if (handle.taskId) {
      r = await this.request(`/videos/${encodeURIComponent(handle.taskId)}`, { method: "GET" });
    } else {
      throw new Error("getVideo requires videoId or taskId");
    }

    const raw = String(r.status ?? "unknown").toLowerCase();
    let status: VideoResult["status"] = STATUS_MAP[raw] ?? "in_progress";
    const url = r.url ?? undefined;
    let error = r.error
      ? typeof r.error === "string"
        ? r.error
        : JSON.stringify(r.error)
      : undefined;

    if (status === "completed" && !url) {
      status = "failed";
      error = error ?? "Agnes returned completed without a url";
    }

    return {
      status,
      progress: typeof r.progress === "number" ? r.progress : undefined,
      url,
      error,
      raw: r,
    };
  }
}
