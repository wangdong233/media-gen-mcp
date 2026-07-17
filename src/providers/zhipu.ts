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
import { withRetry } from "./http.js";

interface ZhipuModelsConfig {
  image?: { default?: string; available?: string[] };
  video?: { default?: string; available?: string[] };
}

interface RateLimitEntry {
  minIntervalMs: number;
  learnedAt: string;
}

interface ZhipuProviderConfig {
  apiKey: string;
  baseUrl: string;
  videoMinIntervalMs: number;
  models?: ZhipuModelsConfig;
  rateLimits?: Record<string, RateLimitEntry>;
  rateLimitTtlMs: number;
}

/**
 * 智谱 CogVideoX 视频约束(以 cogvideox-3 的能力集为上界):
 * - fps 枚举 {30, 60},默认 30。
 * - duration 枚举 {5, 10} 秒(仅 cogvideox-3 支持显式设定;cogvideox-flash/cogvideox-2 时长由模型固定)。
 * numFrames 在智谱不是原生参数,这里用 5s/10s @ 30fps 的标称值(150/300)供工具层建 schema;
 * createVideo 按 durationSeconds 或 numFrames/fps 反推秒数,吸附到 {5,10}。
 */
const ALLOWED_DURATIONS = [5, 10] as const; // cogvideox-3 秒
const DEFAULT_DURATION_SECONDS = 5;
const ALLOWED_FRAME_RATES = new Set<number>([30, 60]);
const DEFAULT_FRAME_RATE = 30;
const ALLOWED_NUM_FRAMES = [150, 300] as const; // 标称:5s/10s @ 30fps
const DEFAULT_NUM_FRAMES = 150;

/** 支持 duration / 首尾帧的模型(cogvideox-3);flash / cogvideox-2 时长固定且仅单图。 */
const MODELS_WITH_DURATION = new Set<string>(["cogvideox-3"]);

/** 通用 Resolution(480p/720p/1080p)→ 智谱 size(WxH)。用户可用 extra.size 覆盖(如 4K/竖屏)。 */
const RESOLUTION_TO_SIZE: Record<string, string> = {
  "480p": "720x480",
  "720p": "1280x720",
  "1080p": "1920x1080",
};

/** 智谱 cogview 图像 size 硬约束(实测 400 报文):每边 512-2880、16 整数倍、像素 ≤ 2^21。 */
const ZHIPU_IMG_MIN_SIDE = 512;
const ZHIPU_IMG_MAX_SIDE = 2880;
const ZHIPU_IMG_SIDE_MULTIPLE = 16;
const ZHIPU_IMG_MAX_PIXELS = 1 << 21; // 2097152

/** 把任意 WxH 吸附到智谱合法 size(16 倍数 + clamp 512-2880 + 像素 ≤ 2^21)。调用方免试错碰 400。 */
export function snapZhipuImageSize(size: string): string {
  const m = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) {
    throw new Error(
      `zhipu size "${size}" 格式无效(应为 WxH,如 1024x1024)。约束:每边 512-2880、16 整数倍、像素 ≤ 2^21。`,
    );
  }
  let w = Math.round(+m[1] / ZHIPU_IMG_SIDE_MULTIPLE) * ZHIPU_IMG_SIDE_MULTIPLE;
  let h = Math.round(+m[2] / ZHIPU_IMG_SIDE_MULTIPLE) * ZHIPU_IMG_SIDE_MULTIPLE;
  w = Math.max(ZHIPU_IMG_MIN_SIDE, Math.min(ZHIPU_IMG_MAX_SIDE, w));
  h = Math.max(ZHIPU_IMG_MIN_SIDE, Math.min(ZHIPU_IMG_MAX_SIDE, h));
  // 像素超限:按比例缩减较长边(16 步长),直到 ≤ 2^21
  while (w * h > ZHIPU_IMG_MAX_PIXELS) {
    if (w >= h) {
      w -= ZHIPU_IMG_SIDE_MULTIPLE;
      if (w < ZHIPU_IMG_MIN_SIDE) break;
    } else {
      h -= ZHIPU_IMG_SIDE_MULTIPLE;
      if (h < ZHIPU_IMG_MIN_SIDE) break;
    }
  }
  if (w < ZHIPU_IMG_MIN_SIDE || h < ZHIPU_IMG_MIN_SIDE || w * h > ZHIPU_IMG_MAX_PIXELS) {
    throw new Error(
      `zhipu size "${size}" 吸附后(${w}x${h})仍不满足约束(每边 512-2880、16 整数倍、像素 ≤ 2^21)。`,
    );
  }
  return `${w}x${h}`;
}

/** 智谱 task_status(大写)小写化后 → 统一态。PROCESSING/SUCCESS/FAIL + 兼容别名。 */
const STATUS_MAP: Record<string, VideoResult["status"]> = {
  success: "completed",
  succeeded: "completed",
  completed: "completed",
  processing: "in_progress",
  fail: "failed",
  failed: "failed",
  error: "failed",
  cancelled: "failed",
  canceled: "failed",
};

/** 秒数 → 最近合法 duration(cogvideox-3:5 或 10)。 */
function nearestDuration(seconds: number): number {
  let best: number = ALLOWED_DURATIONS[0];
  let bestDelta = Infinity;
  for (const d of ALLOWED_DURATIONS) {
    const delta = Math.abs(d - seconds);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = d;
    }
  }
  return best;
}

/**
 * Zhipu(智谱 BigModel / Z.AI)provider —— CogView 文生图 + CogVideoX 文生/图生视频。
 *
 * 端点(base = https://open.bigmodel.cn/api,国际版 https://api.z.ai/api):
 *   图像:POST /paas/v4/images/generations(同步,data[].url)
 *   视频:POST /paas/v4/videos/generations(异步,返回 id)→ GET /paas/v4/async-result/{id} 轮询
 *
 * 模型:工具参数 > config models.*.default > (无 fallback,缺失报错引导)。代码不内置厂商模型名。
 * 免费模型:cogview-3-flash(图)、cogvideox-flash(视频);glm-image/cogview-4/cogvideox-3 付费。
 * 限流(per-model + TTL):基线 videoMinIntervalMs;429/1302 学习 per-model 回写;TTL 过期降级基线。
 * 智谱限流为"并发在途任务数"(按账户权益),非固定 QPM;learnRateLimit 仅在文案可解析时生效,否则 inert。
 */
export class ZhipuProvider implements MediaProvider {
  readonly name = "zhipu";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly videoMinIntervalMs: number;
  private readonly rateLimitTtlMs: number;
  private readonly models?: ZhipuModelsConfig;
  private rateLimits: Record<string, RateLimitEntry>;
  private lastSubmitAt: Record<string, number> = {}; // per-model 提交时刻
  private submitChain: Promise<void> = Promise.resolve();

  constructor(c: ZhipuProviderConfig) {
    this.apiKey = c.apiKey;
    this.baseUrl = (c.baseUrl || "https://open.bigmodel.cn/api").replace(/\/$/, "");
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
  listImageModels(): string[] {
    return this.models?.image?.available ?? [];
  }
  listVideoModels(): string[] {
    return this.models?.video?.available ?? [];
  }
  imageConstraints() {
    return {
      minSide: ZHIPU_IMG_MIN_SIDE,
      maxSide: ZHIPU_IMG_MAX_SIDE,
      multipleOf: ZHIPU_IMG_SIDE_MULTIPLE,
      maxPixels: ZHIPU_IMG_MAX_PIXELS,
    };
  }

  videoConstraints() {
    return {
      allowedNumFrames: [...ALLOWED_NUM_FRAMES],
      defaultNumFrames: DEFAULT_NUM_FRAMES,
      defaultFrameRate: DEFAULT_FRAME_RATE,
    };
  }

  estimateGenerationSeconds(numFrames: number, frameRate?: number): number {
    // 粗估偏保守:CogVideoX 异步渲染,按输出时长 × 15s/1s 估算,地板 60s。
    const fps = frameRate ?? DEFAULT_FRAME_RATE;
    const outSeconds = numFrames / fps;
    return Math.max(60, Math.ceil(outSeconds * 15));
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
      persistProviderField("zhipu", "rateLimits", this.rateLimits).catch(() => {});
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    if (!this.apiKey) throw new Error("ZHIPU_API_KEY is not set");
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    // 5xx(503/1305 平台过载等)/网络抖动 → 指数退避重试;4xx(含 429/1302 并发超限)立即抛(由 learnRateLimit 学习)。
    return withRetry(async () => {
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
        const e = new Error(`Zhipu ${res.status}: ${msg}`);
        (e as any).status = res.status;
        (e as any).body = json;
        throw e;
      }
      return json;
    }, { tag: "Zhipu" });
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const model = req.model ?? this.models?.image?.default;
    if (!model) {
      throw new Error(
        "image model 未配置:请在 config.json 设 providers.zhipu.models.image.default,或在工具参数传 model",
      );
    }
    // 智谱原生 /paas/v4/images/generations:必填 model+prompt;size/quality/watermark_enabled/user_id 可选。
    // n 不透传(智谱固定 1 张,网关也忽略);批量由工具层 fan-out 兑现。
    // size 前置吸附到合法值(16 倍数 + clamp + 像素限),调用方免试错碰 400。
    const body: Record<string, unknown> = { model, prompt: req.prompt };
    if (req.size) body.size = snapZhipuImageSize(req.size);
    if (body.watermark_enabled === undefined) body.watermark_enabled = false; // 默认关水印
    if (req.extra) Object.assign(body, req.extra); // 用户 extra 可覆盖

    const r = await this.request("/paas/v4/images/generations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const outputs = (r.data ?? []).map((d: any) => ({
      url: d.url as string | undefined,
      b64: d.b64_json as string | undefined,
    }));
    // watermarked 标"是否请求了水印";即便请求关闭,免费档(如 cogview-3-flash)可能强制带 → warning 提醒以实际产物为准。
    const wantedWatermark = body.watermark_enabled === true;
    const warnings = wantedWatermark
      ? []
      : ["已请求关闭水印(watermark_enabled=false);部分免费模型(如 cogview-3-flash)可能强制带水印,以实际产物为准。"];
    return { outputs, raw: r, watermarked: wantedWatermark, warnings };
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
    const model = req.model ?? this.models?.video?.default;
    if (!model) {
      throw new Error(
        "video model 未配置:请在 config.json 设 providers.zhipu.models.video.default,或在工具参数传 model",
      );
    }

    const frameRate = req.frameRate ?? DEFAULT_FRAME_RATE;
    if (!ALLOWED_FRAME_RATES.has(frameRate)) {
      throw new Error(
        `frame_rate=${frameRate} is not allowed by Zhipu; must be one of ${[...ALLOWED_FRAME_RATES].join("/")} (30 or 60)`,
      );
    }

    const mode =
      req.mode ??
      (req.keyframes?.length ? "keyframes" : req.image ? "image-to-video" : "text-to-video");

    if (mode === "image-to-video" && !req.image) {
      throw new Error("image-to-video requires `image` (single URL)");
    }
    if (mode === "keyframes" && !req.keyframes?.length) {
      throw new Error("keyframes requires `keyframes` (URL array: 首帧/尾帧)");
    }
    if (mode === "keyframes" && !MODELS_WITH_DURATION.has(model)) {
      throw new Error(
        "keyframes(首尾帧)仅 cogvideox-3 支持;cogvideox-flash/cogvideox-2 仅支持单图 image-to-video",
      );
    }

    // 尺寸:优先 extra.size,其次 resolution 映射,缺省让智谱默认(短边 1080)。
    const size =
      (req.extra?.size as string | undefined) ??
      (req.resolution ? RESOLUTION_TO_SIZE[req.resolution] : undefined);

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      fps: frameRate,
    };
    if (size) body.size = size;

    // duration 仅 cogvideox-3 支持(flash/cogvideox-2 时长由模型固定,不发送)。
    if (MODELS_WITH_DURATION.has(model)) {
      const seconds =
        req.durationSeconds ??
        (req.numFrames ? req.numFrames / frameRate : DEFAULT_DURATION_SECONDS);
      body.duration = nearestDuration(seconds);
    }

    if (mode === "image-to-video") {
      body.image_url = req.image; // 单图 URL/Base64
    } else if (mode === "keyframes") {
      body.image_url = req.keyframes; // 数组:第 1 张首帧 / 第 2 张尾帧(cogvideox-3)
    }

    // 其余私有字段(quality/with_audio/watermark_enabled/user_id/request_id)走 extra 透传。
    if (req.extra) Object.assign(body, req.extra);

    await this.enqueueSubmit(model);

    try {
      const r = await this.request("/paas/v4/videos/generations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      // 提交即 PROCESSING;task_status 映射到统一态(默认 in_progress)。
      const raw = String(r.task_status ?? "PROCESSING").toLowerCase();
      return {
        taskId: r.id,
        status: STATUS_MAP[raw] ?? "queued",
        raw: r,
      };
    } catch (e: any) {
      // 1302=用户并发超限(智谱私有码,可能非 429);1305=平台过载。
      if (e?.status === 429 || e?.body?.error?.code === "1302") this.learnRateLimit(model, e.body);
      throw e;
    }
  }

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    if (!handle.taskId) {
      throw new Error("getVideo requires taskId (Zhipu 任务 ID)");
    }
    const r = await this.request(
      `/paas/v4/async-result/${encodeURIComponent(handle.taskId)}`,
      { method: "GET" },
    );

    const raw = String(r.task_status ?? "PROCESSING").toLowerCase();
    let status: VideoResult["status"] = STATUS_MAP[raw] ?? "in_progress";
    const url = r.video_result?.[0]?.url ?? undefined;
    let error = r.error
      ? typeof r.error === "string"
        ? r.error
        : JSON.stringify(r.error)
      : undefined;

    if (status === "completed" && !url) {
      status = "failed";
      error = error ?? "Zhipu returned SUCCESS without a video url";
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