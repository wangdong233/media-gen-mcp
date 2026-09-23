/**
 * SiliconFlow 硅基流动渠道(渠道工厂飞轮队列 v2 #1,2026-09-23 GO)—— HTTP API provider。
 *
 * 调研定谳(doc/渠道工厂飞轮.md 轮 4 + siliconflow-probe agent 报告):
 * - 国内站 api.siliconflow.cn(默认;国际站 .com 阵容/价格分叉,经 baseUrl 可切);
 * - 生图 POST /v1/images/generations:OpenAI 兼容但三处偏差——响应信封 `images[].url`(非 data[])/
 *   图片 URL 仅 1h TTL(立即下载)/batch_size 已移除(多张循环调用);
 * - 视频 submit/poll 异步:POST /v1/video/submit → requestId → POST /v1/video/status 轮询
 *   (结果保留 10min + URL 1h 双 TTL);固定 5s,仅 720P 级三档,I2V 单首帧无首尾帧;
 * - 免费 = Kolors(唯一免费生图模型,需实名);代金券 ¥14(2099 有效)先于余额抵扣,可用于
 *   付费模型(Z-Image-Turbo ¥0.10/Qwen-Image ¥0.30/Wan2.2 视频 ¥2.00);
 * - 水印:默认显式「AI 生成」+隐式;X-Enable-Watermark:0 仅下游再处理场景(默认不发);
 * - 429 TPM 限流/IPM 2·IPD 400(生图);503 过载——指数退避。
 *
 * 错误码族:[siliconflow] S1xx 环境(key 未配)/ S2xx 网络(429/503 上游)/ S3xx 参数 / S4xx 结果。
 * requiresOptIn=true(池含付费模型;Kolors 免费但账号需实名——费用与实名边界经点名知悉)。
 * 测试纪律:白盒 stub HTTP(零网络零消耗);真机门 SILICONFLOW_IT=1 + 非 CI + key 已配。
 */
import type {
  ImageRequest, ImageResult, ImageConstraints, VideoRequest, VideoTask, VideoResult, VideoHandle,
  Modality, ProviderCapabilities, ChannelInfo, MediaProviderBase, ImageProvider, VideoProvider,
} from "./types.js";
import { withRetry } from "./http.js";

export const SILICONFLOW_IMAGE_MODELS: string[] = [
  "Kwai-Kolors/Kolors",          // 唯一免费(实名后);1024x1024/960x1280/768x1024/720x1440/720x1280
  "Tongyi-MAI/Z-Image-Turbo",    // ¥0.10(地板价)
  "Tongyi-MAI/Z-Image",
  "Qwen/Qwen-Image",             // ¥0.30;1328x1328 等 7 档
  "Qwen/Qwen-Image-Edit",        // ¥0.30 图生图/编辑
  "Qwen/Qwen-Image-Edit-2509",   // ¥0.30 最多 3 输入图
  "Baidu/ERNIE-Image-Turbo",     // ¥0.11
];
export const SILICONFLOW_VIDEO_MODELS: string[] = [
  "Wan-AI/Wan2.2-T2V-A14B",      // ¥2.00/条;固定 5s
  "Wan-AI/Wan2.2-I2V-A14B",      // ¥2.00/条;单首帧
];
const DEFAULT_BASE_URL = "https://api.siliconflow.cn";
/** 免费模型(成本台账/描述口径;实测扣费以账号代金券流水为准)。 */
export const SILICONFLOW_FREE_MODELS = new Set(["Kwai-Kolors/Kolors"]);
/** 静态价目(¥;单位:张/条)。与 channelInfo/costCatalog 同源;实际以代金券流水为准。 */
export const SILICONFLOW_PRICES_CNY: Record<string, number> = {
  "Kwai-Kolors/Kolors": 0,
  "Tongyi-MAI/Z-Image-Turbo": 0.10,
  "Tongyi-MAI/Z-Image": 0.30,
  "Qwen/Qwen-Image": 0.30,
  "Qwen/Qwen-Image-Edit": 0.30,
  "Qwen/Qwen-Image-Edit-2509": 0.30,
  "Baidu/ERNIE-Image-Turbo": 0.11,
  "Wan-AI/Wan2.2-T2V-A14B": 2.0,
  "Wan-AI/Wan2.2-I2V-A14B": 2.0,
};

export class SiliconflowError extends Error {
  readonly code: string;
  readonly precondition?: true;
  readonly sfStatus?: number;
  constructor(code: string, message: string, opts?: { sfStatus?: number; precondition?: boolean; hint?: string }) {
    super(`[siliconflow] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "SiliconflowError";
    this.code = code;
    if (opts?.sfStatus !== undefined) { this.sfStatus = opts.sfStatus; (this as any).status = opts.sfStatus; }
    if (opts?.precondition) this.precondition = true;
  }
}

export interface SiliconflowProviderOpts {
  apiKey?: string;
  baseUrl?: string;
  /** 测试注入缝:替换底层 HTTP(白盒零网络)。 */
  fetchImpl?: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;
  /** 测试注入缝:下载产物(生图 URL 1h TTL,生产立即下载)。 */
  downloadImpl?: (url: string) => Promise<ArrayBuffer>;
}

interface SfHttpResp {
  ok: boolean; status: number; json(): Promise<any>; text(): Promise<string>;
}

export class SiliconflowProvider implements MediaProviderBase, ImageProvider, VideoProvider {
  readonly name = "siliconflow";
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<SfHttpResp>;
  private readonly downloadImpl: (url: string) => Promise<ArrayBuffer>;
  /** 轮询节奏测试缝(生产 5s)。 */
  pollIntervalMs = 5_000;
  /** 视频轮询截止测试缝(生产 600s;实测参考:Wan2.2 数分钟)。 */
  pollDeadlineMs = 600_000;
  private cooldownUntil = 0;
  private lastErrorAt?: string;

  constructor(opts: SiliconflowProviderOpts = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = (opts.fetchImpl as any) || ((u: string, i: RequestInit) => fetch(u, i) as any);
    this.downloadImpl = opts.downloadImpl || ((u: string) => fetch(u).then((r) => {
      if (!r.ok) throw new SiliconflowError("S200", `产物下载失败 HTTP ${r.status}(URL 1h TTL,须立即取)`, { sfStatus: 0 });
      return r.arrayBuffer();
    }));
  }

  // ── 基础 ──
  capabilities(): ProviderCapabilities {
    return { image: { textToImage: true, imageToImage: true }, video: { textToVideo: true, imageToVideo: true, keyframes: false } };
  }
  requiresOptIn(_m: Modality): boolean { return true; }
  listModels(): string[] { return [...SILICONFLOW_IMAGE_MODELS, ...SILICONFLOW_VIDEO_MODELS]; }
  listImageModels(): string[] { return [...SILICONFLOW_IMAGE_MODELS]; }
  listVideoModels(): string[] { return [...SILICONFLOW_VIDEO_MODELS]; }
  imageConstraints(): ImageConstraints | undefined { return undefined; } // image_size 逐模型档;工具层不硬约束
  supportsImageToImage(): boolean { return true; }
  videoConstraints() {
    return { allowedNumFrames: [120, 150], defaultNumFrames: 120, defaultFrameRate: 24, allowedFrameRates: [24] }; // 固定 5s(120@24;I2V 按图比例 150)
  }
  estimateGenerationSeconds(_n: number, _f?: number): number { return 180; }
  health() { return { configured: !!this.apiKey, cooldown: Date.now() < this.cooldownUntil, lastErrorAt: this.lastErrorAt }; }
  notifyUnavailable(e: any): void {
    this.lastErrorAt = new Date().toISOString();
    const st = e instanceof SiliconflowError ? e.sfStatus : undefined;
    if (st !== undefined && (st === 0 || st === 429 || st >= 500)) this.cooldownUntil = Date.now() + 60_000;
  }

  channelInfo(): ChannelInfo {
    return {
      status: this.apiKey ? "live" : "blocked-on-login",
      cost: "免费(Kolors)+按量付费(代金券先扣;Z-Image-Turbo ¥0.10/张 起,Wan2.2 视频 ¥2/条)",
      freeQuota: "Kolors 免费(实名后,IPM 2/IPD 400 量级)+注册代金券 ¥14(≈永久有效,可抵付费模型)",
      capabilities: { t2i: true, i2i: true, t2v: true, i2v: true, keyframes: false },
      limits: ["视频固定 5s/720P 级(I2V 按图比例),无首尾帧", "batch_size 已移除(多张=多次调用)", "图片 URL 1h TTL(工具内已自动立即落盘)", "免费模型限额固定不随档位涨;429 TPM/IPM 限流"],
      watermark: "默认显式「AI 生成」+隐式(合规默认;不发关闭头)",
      prerequisites: ["注册 siliconflow.cn(手机/微信/邮箱)→ cloud.siliconflow.cn/account/ak 建 API key → config providers.siliconflow.apiKey", "免费模型需实名"],
      risks: ["平台持续亏损(价格可能变动;近月已移除 batch_size/加水印)", "ToS 3.4(p) 商用措辞含糊(商用管线建议人工过原文)"],
    };
  }

  /** 成本目录(¥;复用 costCatalog 钩子,单位 per-image/per-clip;ledger 态留待实测台账)。 */
  costCatalog() {
    const out: Record<string, { mode: "image" | "video"; credits?: number; unit: "per-image" | "unknown"; source: "ledger" | "static" | "none" }> = {};
    for (const [m, price] of Object.entries(SILICONFLOW_PRICES_CNY)) {
      const isVideo = m.startsWith("Wan-AI/");
      out[m] = { mode: isVideo ? "video" : "image", credits: price, unit: "per-image", source: "static" };
    }
    return out;
  }

  // ── HTTP ──
  private assertKey(): string {
    if (!this.apiKey) throw new SiliconflowError("S100", "apiKey 未配置(siliconflow)", { precondition: true, hint: "注册 siliconflow.cn → cloud.siliconflow.cn/account/ak 新建密钥 → ~/.media-gen-mcp/config.json providers.siliconflow.apiKey" });
    return this.apiKey;
  }
  private async request(path: string, body: unknown): Promise<any> {
    const key = this.assertKey();
    return withRetry(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const text = () => res.text();
      // 全部带 sfStatus:withRetry/isTransient 按 .status 判瞬时性 —— 4xx 必须立即抛,零重试
      if (res.status === 401) throw new SiliconflowError("S101", "Invalid token(检查 apiKey)", { precondition: true, sfStatus: 401 });
      if (res.status === 429) throw new SiliconflowError("S201", `限流(TPM/IPM;退避重试中):${(await text()).slice(0, 120)}`, { sfStatus: 429 });
      if (res.status === 503 || res.status === 504) throw new SiliconflowError("S202", `上游过载(${res.status})`, { sfStatus: res.status });
      if (res.status >= 500) throw new SiliconflowError("S203", `上游错误 ${res.status}`, { sfStatus: res.status });
      if (!res.ok) throw new SiliconflowError("S300", `参数/请求错误 ${res.status}:${(await text()).slice(0, 200)}`, { sfStatus: res.status });
      return res.json();
    });
  }

  // ── 生图 ──
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    const model = this.resolveImageModel(req.model, warnings);
    const size = req.size || "1024x1024";
    const body: Record<string, unknown> = { model, prompt: req.prompt, image_size: size };
    if (req.seed != null) body.seed = req.seed;
    // i2i:仅 Qwen Edit 模型族接 images(2509 ≤3 张数组;普通 Edit 单张字符串);其余模型传 images → 明确拒绝
    if (req.images?.length) {
      if (model === "Qwen/Qwen-Image-Edit") {
        if (req.images.length > 1) warnings.push(`siliconflow Qwen-Image-Edit 仅接受 1 张输入图,已取 images[0](多图请用 Qwen-Image-Edit-2509,≤3 张)。`);
        body.image = req.images[0];
      } else if (model === "Qwen/Qwen-Image-Edit-2509") {
        const imgs = req.images.slice(0, 3);
        if (req.images.length > 3) warnings.push(`siliconflow Qwen-Image-Edit-2509 最多 3 张输入图,已截断为前 3。`);
        body.image = imgs.length === 1 ? imgs[0] : imgs;
      } else {
        throw new SiliconflowError("S302", `模型 ${model} 不接受 images 输入(硅基流动图生图仅 Qwen/Qwen-Image-Edit(-2509));换 Edit 模型或去掉 images。`);
      }
    }
    if (req.n && req.n > 1) warnings.push(`siliconflow batch_size 已于 2026-09-30 移除,n=${req.n} → 循环 ${req.n} 次独立调用(每张独立计费)。`);
    const loops = Math.max(1, Math.min(8, req.n || 1));
    const outputs: { url: string }[] = [];
    for (let i = 0; i < loops; i++) {
      const j = await this.request("/v1/images/generations", { ...body, ...(req.seed != null ? { seed: req.seed + i } : {}) });
      const imgs = j?.images;
      if (!Array.isArray(imgs) || !imgs[0]?.url) throw new SiliconflowError("S400", `响应信封异常(期望 images[].url):${JSON.stringify(j).slice(0, 200)}`);
      outputs.push({ url: imgs[0].url });
    }
    // URL 1h TTL → 立即转 data:URI(handler 落盘管线消费)
    const dataUris: string[] = [];
    for (const o of outputs) {
      const buf = await this.downloadImpl(o.url);
      dataUris.push(`data:image/png;base64,${Buffer.from(buf).toString("base64")}`);
    }
    if (SILICONFLOW_PRICES_CNY[model] === 0) warnings.push("Kolors = 免费模型(实名后;额度 IPM/IPD 限额内)。");
    else warnings.push(`计费模型 ${model}:静态价 ¥${SILICONFLOW_PRICES_CNY[model]}/张(代金券先扣;以实际流水为准)。`);
    return { outputs: dataUris.map((url) => ({ url })), raw: { provider: "siliconflow", model }, warnings };
  }

  // ── 视频(异步 submit/poll) ──
  async createVideo(req: VideoRequest): Promise<VideoTask> {
    const warnings: string[] = [];
    const model = this.resolveVideoModel(req.model, req.image ? undefined : warnings, req.image ? undefined : warnings);
    if (req.durationSeconds != null && req.durationSeconds !== 5) warnings.push(`siliconflow 视频固定 5s,durationSeconds=${req.durationSeconds} 已忽略。`);
    if (req.keyframes?.length) throw new SiliconflowError("S301", "siliconflow 视频无首尾帧(仅单首帧 I2V)。");
    const size = req.ratio === "9:16" ? "720x1280" : req.ratio === "1:1" ? "960x960" : "1280x720";
    const body: Record<string, unknown> = { model, prompt: req.prompt, image_size: size };
    if (req.seed != null) body.seed = req.seed;
    if (req.image) body.image = req.image; // data: URI/URL
    const j = await this.request("/v1/video/submit", body);
    if (!j?.requestId) throw new SiliconflowError("S400", `submit 无 requestId:${JSON.stringify(j).slice(0, 200)}`);
    warnings.push(`计费模型 ${model}:静态价 ¥${SILICONFLOW_PRICES_CNY[model]}/条(代金券先扣)。结果保留 10min/URL 1h,取件即时下载。`);
    return { taskId: String(j.requestId), status: "submitted", raw: { provider: "siliconflow", model }, warnings };
  }

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    const requestId = handle.taskId ?? handle.videoId;
    if (!requestId) return { status: "failed", error: "siliconflow 取件需 taskId" };
    const deadline = Date.now() + this.pollDeadlineMs;
    for (;;) {
      const j = await this.request("/v1/video/status", { requestId });
      const st = String(j?.status ?? "");
      if (st === "Succeed") {
        const url = j?.results?.videos?.[0]?.url;
        if (!url) return { status: "failed", error: `Succeed 但无视频 URL:${JSON.stringify(j).slice(0, 200)}` };
        const buf = await this.downloadImpl(url); // 双 TTL:立即下载
        return { status: "completed", url: `data:video/mp4;base64,${Buffer.from(buf).toString("base64")}`, raw: { provider: "siliconflow" } };
      }
      if (st === "Failed") return { status: "failed", error: `生成失败:${j?.reason ?? "未知原因"}` };
      if (Date.now() > deadline) return { status: "timeout", error: `轮询超时(>${Math.round(this.pollDeadlineMs / 1000)}s;结果仅保留 10min,可能已过期)` };
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  private resolveImageModel(model: string | undefined, warnings: string[]): string {
    const m = model ?? "Kwai-Kolors/Kolors";
    if (!SILICONFLOW_IMAGE_MODELS.includes(m)) {
      throw new SiliconflowError("S300", `未知图像模型 "${m}"。siliconflow 可用:${SILICONFLOW_IMAGE_MODELS.join(", ")}。`);
    }
    void warnings;
    return m;
  }
  private resolveVideoModel(model: string | undefined, _a?: string[], _b?: string[]): string {
    const m = model ?? "Wan-AI/Wan2.2-T2V-A14B";
    if (!SILICONFLOW_VIDEO_MODELS.includes(m)) {
      throw new SiliconflowError("S300", `未知视频模型 "${m}"。siliconflow 可用:${SILICONFLOW_VIDEO_MODELS.join(", ")}(固定 5s,无首尾帧)。`);
    }
    return m;
  }
}
