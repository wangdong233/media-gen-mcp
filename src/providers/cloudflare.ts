/**
 * Cloudflare Workers AI 渠道(渠道工厂飞轮轮 12 GO,2026-09-23)—— 官方 REST,纯图像 provider。
 *
 * 调研定谳(doc/渠道工厂飞轮.md 轮 12 + cloudflare-probe agent 报告,官方文档一手+实探):
 * - C 类:10,000 Neurons/天全账号续杯(Workers Free/Paid 同额,00:00 UTC 重置);免费计划超额**硬停**
 *   (429/3036),付费计划超额自动计费 $0.011/千 neurons —— 付费计划有真实扣费风险,需档位警示;
 * - **image-only**:@cf/ 目录 65 模型零视频任务,勿注册 video;
 * - 两族请求体:A 族 JSON(schnell/SDXL/lucid/phoenix)与 B 族 multipart(flux-2 全家,纯文生图也必须
 *   multipart;参考图 input_image_0..3 每张 <512×512);
 * - 端点 POST /client/v4/accounts/{account_id}/ai/run/{model};Bearer API Token(Workers AI Read+Edit);
 *   响应 v4 envelope {result:{image: 裸 base64 无 data: 前缀}, success}(mime 按 magic bytes 嗅探);
 * - 档位分层(免费 10k neurons/天):schnell 57.6/张(1024²@4步≈173 张/日,文生图主力)/
 *   klein-4b 104.2(编辑主力)/SDXL 双 $0 Beta(零费)/dev 3750(黑洞,premium)/9b 1364/lucid ~6000/
 *   phoenix 2370(premium 档逐张价格警示);
 * - 旧 img2img v1.5 模型已从目录消失,勿接;无官方 neurons 余额端点(dashboard/GraphQL 对账);
 * - 条款:输出归用户商用无碍(Developer Platform Service-Specific Terms 2026-06-09);720 RPM。
 *
 * 错误码族:[cloudflare] C1xx 环境(token/account_id 未配)/ C2xx 网络(429/5xx)/ C3xx 参数 /
 * C4xx 结果;每日额度尽(429/3036)→ 冷却至 00:00 UTC 并快速失败,不重试。
 * 纪律:错误带 .status;丢弃参数必告警;provider 恒单张(D1);能力声明与实现逐项对齐。
 * requiresOptIn=true。测试:白盒 stub(fetchImpl 注入缝);真机门 CLOUDFLARE_IT 双门。
 */
import type {
  ImageRequest, ImageResult, Modality, ProviderCapabilities, ChannelInfo, MediaProviderBase, ImageProvider,
} from "./types.js";
import { withRetry } from "./http.js";

export interface CfModelSpec {
  /** @cf/ 全名(REST 路径)。 */
  full: string;
  family: "json" | "multipart";
  label: string;
  /** 免费额度内单张 neuron 估算(1024² 默认档;±50% 余量——tile 取整规则官方未定义)。 */
  neuronsPerImage: number;
  steps?: { key: "steps" | "num_steps"; def: number; max: number };
  size?: { w: [number, number]; h: [number, number]; def: [number, number] };
  /** i2i 形态:sdxl=JSON image_b64 单图 / flux2=multipart input_image_0..3(≤4,<512²)/ none。 */
  i2i: "sdxl-b64" | "flux2-multipart" | "none";
}

/** 简单名 → 模型规格(官方定价页/模型页逐字;neurons 为 1024² 默认档估算)。 */
export const CLOUDFLARE_MODELS: Record<string, CfModelSpec> = {
  "flux-schnell": { full: "@cf/black-forest-labs/flux-1-schnell", family: "json", label: "FLUX.1 schnell(文生图主力,≈57.6 neurons/张 → 10k/日≈173 张)", neuronsPerImage: 58, steps: { key: "steps", def: 4, max: 8 }, i2i: "none" },
  "flux-2-klein": { full: "@cf/black-forest-labs/flux-2-klein-4b", family: "multipart", label: "FLUX.2 klein 4B(多参考编辑主力,≈104 neurons/张;固定 4 步)", neuronsPerImage: 104, size: { w: [256, 1920], h: [256, 1920], def: [1024, 768] }, i2i: "flux2-multipart" },
  "flux-2-dev": { full: "@cf/black-forest-labs/flux-2-dev", family: "multipart", label: "FLUX.2 dev(premium:≈3,750 neurons/张@25步 —— 10k/日仅 2 张!)", neuronsPerImage: 3750, size: { w: [256, 1920], h: [256, 1920], def: [1024, 768] }, steps: { key: "steps", def: 25, max: 50 }, i2i: "flux2-multipart" },
  "flux-2-klein-9b": { full: "@cf/black-forest-labs/flux-2-klein-9b", family: "multipart", label: "FLUX.2 klein 9B(premium:≈1,364 neurons/张)", neuronsPerImage: 1364, size: { w: [256, 1920], h: [256, 1920], def: [1024, 768] }, i2i: "flux2-multipart" },
  "sdxl-lightning": { full: "@cf/bytedance/stable-diffusion-xl-lightning", family: "json", label: "SDXL Lightning($0 Beta=零费;720 RPM 内)", neuronsPerImage: 0, steps: { key: "num_steps", def: 20, max: 20 }, size: { w: [256, 2048], h: [256, 2048], def: [1024, 1024] }, i2i: "sdxl-b64" },
  "sdxl-base": { full: "@cf/stabilityai/stable-diffusion-xl-base-1.0", family: "json", label: "SDXL base 1.0($0 Beta=零费;img2img strength)", neuronsPerImage: 0, steps: { key: "num_steps", def: 20, max: 20 }, size: { w: [256, 2048], h: [256, 2048], def: [1024, 1024] }, i2i: "sdxl-b64" },
  lucid: { full: "@cf/leonardo/lucid-origin", family: "json", label: "Lucid Origin(Leonardo 系,premium:1120² 默认 ≈6,000 neurons/张)", neuronsPerImage: 6000, steps: { key: "num_steps", def: 30, max: 40 }, size: { w: [0, 2500], h: [0, 2500], def: [1120, 1120] }, i2i: "none" },
  phoenix: { full: "@cf/leonardo/phoenix-1.0", family: "json", label: "Phoenix 1.0(Leonardo 系,premium:≈2,370 neurons/张)", neuronsPerImage: 2370, steps: { key: "num_steps", def: 25, max: 50 }, size: { w: [0, 2048], h: [0, 2048], def: [1024, 1024] }, i2i: "none" },
};
export const CLOUDFLARE_MODEL_NAMES = Object.keys(CLOUDFLARE_MODELS);
/** 免费额度内的推荐档(警示线:超过 1,000 neurons/张即 premium 档)。 */
const PREMIUM_THRESHOLD = 1_000;

export class CloudflareError extends Error {
  readonly code: string;
  readonly precondition?: true;
  readonly httpStatus?: number;
  /** Cloudflare v4 envelope 错误码(7003 形态;429/3036=每日额度尽)。 */
  readonly cfCode?: number;
  constructor(code: string, message: string, opts?: { httpStatus?: number; cfCode?: number; precondition?: boolean; hint?: string }) {
    super(`[cloudflare] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "CloudflareError";
    this.code = code;
    if (opts?.httpStatus !== undefined) { this.httpStatus = opts.httpStatus; (this as any).status = opts.httpStatus; }
    if (opts?.cfCode !== undefined) this.cfCode = opts.cfCode;
    if (opts?.precondition) this.precondition = true;
  }
}

interface CfHttpResp { ok: boolean; status: number; headers?: Record<string, string>; json(): Promise<any>; arrayBuffer?(): Promise<ArrayBuffer>; text(): Promise<string>; }

export interface CloudflareProviderOpts {
  apiToken?: string;
  accountId?: string;
  baseUrl?: string;
  /** 测试注入缝:替换底层 HTTP(白盒零网络)。 */
  fetchImpl?: (url: string, init: RequestInit) => Promise<CfHttpResp>;
  /** 测试注入缝:取参考图二进制(生产=fetch;flux-2 multipart 参考图必须是二进制文件部件)。 */
  fetchBinaryImpl?: (url: string) => Promise<{ bytes: ArrayBuffer; mime: string }>;
}

export class CloudflareProvider implements MediaProviderBase, ImageProvider {
  readonly name = "cloudflare";
  private readonly apiToken?: string;
  private readonly accountId?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<CfHttpResp>;
  private readonly fetchBinaryImpl: (url: string) => Promise<{ bytes: ArrayBuffer; mime: string }>;
  /** 每日额度尽(429/3036)冷却:至 00:00 UTC。 */
  private quotaCooldownUntil = 0;
  private cooldownUntil = 0;
  private lastErrorAt?: string;

  constructor(opts: CloudflareProviderOpts = {}) {
    this.apiToken = opts.apiToken;
    this.accountId = opts.accountId;
    this.baseUrl = (opts.baseUrl || "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
    this.fetchImpl = (opts.fetchImpl as any) || ((u: string, i: RequestInit) => fetch(u, i) as any);
    this.fetchBinaryImpl = opts.fetchBinaryImpl || (async (u: string) => {
      // S6 审查 A-1:flux-2 参考图官方 wire=二进制文件部件(changelog 实证),URL/data: 均先取字节
      if (u.startsWith("data:")) {
        const m = /^data:([^;,]+);base64,(.*)$/s.exec(u);
        if (!m) throw new CloudflareError("C302", "参考图 data:URI 无法解析(须 base64 形态)。");
        return { bytes: Buffer.from(m[2], "base64") as unknown as ArrayBuffer, mime: m[1] };
      }
      const r = await fetch(u);
      if (!r.ok) throw new CloudflareError("C203", `参考图获取失败 HTTP ${r.status}`, { httpStatus: 0 });
      return { bytes: await r.arrayBuffer(), mime: r.headers.get("content-type")?.split(";")[0] || "image/png" };
    });
  }

  // ── 基础 ──
  capabilities(): ProviderCapabilities {
    return { image: { textToImage: true, imageToImage: true }, video: { textToVideo: false, imageToVideo: false, keyframes: false } };
  }
  requiresOptIn(_m: Modality): boolean { return true; }
  listModels(): string[] { return [...CLOUDFLARE_MODEL_NAMES]; }
  listImageModels(): string[] { return [...CLOUDFLARE_MODEL_NAMES]; }
  supportsImageToImage(): boolean { return true; }
  /** i2i 输入形态:flux-2 系 multipart 吃二进制(data:/http 均先取字节);SDXL 系吃 data:URI(b64)。 */
  acceptsImageInputRef(value: string): boolean { return /^(https?:|data:)/i.test(value); }
  health() {
    const now = Date.now();
    return { configured: !!(this.apiToken && this.accountId), cooldown: now < this.cooldownUntil || now < this.quotaCooldownUntil, lastErrorAt: this.lastErrorAt };
  }
  notifyUnavailable(e: any): void {
    this.lastErrorAt = new Date().toISOString();
    const cf = e instanceof CloudflareError ? e.cfCode : undefined;
    if (cf === 3036) {
      // 每日免费额度尽:冷却到 00:00 UTC(下次重置),勿 60s 熔断误判
      const d = new Date();
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 30);
      this.quotaCooldownUntil = next;
      return;
    }
    const st = e instanceof CloudflareError ? e.httpStatus : undefined;
    if (st !== undefined && (st === 0 || st === 429 || st >= 500)) this.cooldownUntil = Date.now() + 60_000;
  }

  channelInfo(): ChannelInfo {
    return {
      status: this.apiToken && this.accountId ? "live" : "blocked-on-login",
      cost: "免费 10,000 neurons/天(全账号续杯,00:00 UTC 重置);超额:Workers Free=硬停(零扣费风险)/Workers Paid=自动计费 $0.011/千 neurons(¥0.079/万)",
      freeQuota: "10k neurons/日 ≈ 173 张 flux-schnell 或 95 张 flux-2-klein(编辑)或 2 张 flux-2-dev;SDXL 双 Beta $0/step=零费不限(720 RPM 内)",
      capabilities: { t2i: true, i2i: true, t2v: false, i2v: false, keyframes: false },
      limits: [
        "**image-only**(@cf/ 目录零视频模型)——勿向本渠道发视频请求",
        "premium 档烧额度:flux-2-dev ≈3,750 neurons/张(10k/日仅 2 张)/klein-9b 1,364/lucid ≈6,000/phoenix 2,370 —— 每次调用带 neuron 估价警示",
        "flux-2 系 multipart:参考图 input_image_0..3 最多 4 张,每张必须 <512×512",
        "flux-1-schnell 无 width/height 参数(固定输出,尺寸被忽略并告警)",
        "720 requests/min(图像任务);无官方 neurons 余额端点(对账走 dashboard/GraphQL)",
        "Workers Paid 计划超额自动扣费 —— 与免费计划不同,勿滥用 premium 档",
      ],
      watermark: "无水印(官方文档零水印证据)",
      prerequisites: [
        "dash.cloudflare.com 注册(免费计划即可,无需信用卡)→ Workers AI 页 → Use REST API → Create a Workers AI API Token(预填模板一键建)",
        "同页 Get Account ID 复制 account_id → config providers.cloudflare.apiToken / providers.cloudflare.accountId(或 env CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)",
      ],
      risks: [
        "neurons 计价机制有变更史(2024 曾宣布弃用后回摆)——价目快照 2026-09-23,漂移以官方定价页为准",
        "模型属第三方(BFL/Leonardo/Stability/ByteDance),输出商用须同时守模型方条款",
        "旧 stable-diffusion-v1-5-img2img 已下线,未接入(勿引用陈旧文档)",
      ],
    };
  }

  /** 成本目录(neurons/张估算;0=零费 Beta)。 */
  costCatalog() {
    const out: Record<string, { mode: "image"; credits?: number; unit: "per-image"; source: "static" }> = {};
    for (const [k, v] of Object.entries(CLOUDFLARE_MODELS)) {
      out[k] = { mode: "image", credits: v.neuronsPerImage, unit: "per-image", source: "static" };
    }
    return out;
  }

  // ── 生图 ──
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    if (this.health().cooldown && Date.now() < this.quotaCooldownUntil) {
      throw new CloudflareError("C201", `今日 10,000 neurons 免费额度已尽(429/3036;00:00 UTC 重置,约 ${Math.ceil((this.quotaCooldownUntil - Date.now()) / 3_600_000)}h 后)`, { precondition: true, cfCode: 3036 });
    }
    if (req.n && req.n > 1) warnings.push(`cloudflare provider 恒单张(工具层扇出);每张独立计 neurons。`);
    if (req.aspect) warnings.push("cloudflare 不支持 aspect,已忽略(用 size=WxH 控制尺寸;flux-schnell 固定输出不支持尺寸)。");
    if (req.quality) warnings.push("cloudflare 不支持 quality,已忽略。");
    if (req.extra && Object.keys(req.extra).length) warnings.push(`cloudflare 不消费 extra(${Object.keys(req.extra).join("/")}),已忽略。`);
    const model = this.resolveModel(req.model);
    const spec = CLOUDFLARE_MODELS[model];
    const isPremium = spec.neuronsPerImage >= PREMIUM_THRESHOLD;
    if (isPremium) warnings.push(`premium 档 ${model}:≈${spec.neuronsPerImage} neurons/张(免费 10k/日 ≈ ${Math.floor(10_000 / spec.neuronsPerImage)} 张;Workers Paid 计划超额自动扣费 $0.011/千)。`);
    else if (spec.neuronsPerImage === 0) warnings.push(`${model} = $0 Beta(零 neurons 消耗,720 RPM 内)。`);
    else warnings.push(`${model}:≈${spec.neuronsPerImage} neurons/张(免费 10k/日 ≈ ${Math.floor(10_000 / spec.neuronsPerImage)} 张)。`);

    const size = this.resolveSize(req, spec, warnings);
    const { body, contentType } = await this.buildBody(req, spec, size, warnings);
    const raw = await this.run(model, body, contentType);
    // v4 envelope: result.image = 裸 base64(无 data: 前缀);mime 按 magic bytes 嗅探
    const img = raw?.result?.image ?? raw?.image;
    if (typeof img !== "string" || !img) throw new CloudflareError("C400", `响应无 image(base64):${String(JSON.stringify(raw) ?? "").slice(0, 200)}`);
    const mime = typeof raw?._mime === "string" ? raw._mime : sniffImageMime(img);
    return { outputs: [{ url: `data:${mime};base64,${img}` }], raw: { provider: "cloudflare", model, neurons: spec.neuronsPerImage }, warnings };
  }

  private async buildBody(req: ImageRequest, spec: CfModelSpec, size: { w: number; h: number }, warnings: string[]): Promise<{ body: unknown; contentType?: string }> {
    if (spec.family === "multipart") {
      // flux-2 全家:纯文生图也必须 multipart;参考图 input_image_0..3(≤4 张,<512×512)
      // 🔴 S6 审查 A-1:官方 wire=二进制文件部件(changelog 实证)——URL/data: 一律先取字节转 Blob
      const fd = new FormData();
      fd.set("prompt", req.prompt);
      fd.set("width", String(size.w));
      fd.set("height", String(size.h));
      if (req.seed != null && Number.isFinite(req.seed)) fd.set("seed", String(Math.trunc(req.seed)));
      if (spec.steps) fd.set("steps", String(spec.steps.def)); // 仅 dev 消费;klein 固定 4 步不传
      if (req.images?.length) {
        const imgs = req.images.slice(0, 4);
        if (req.images.length > 4) warnings.push("flux-2 参考图最多 4 张(input_image_0..3),已截断。");
        warnings.push("flux-2 参考图每张必须 <512×512(上游硬限;过大图会报错,请预缩放)。");
        for (let i = 0; i < imgs.length; i++) {
          const { bytes, mime } = await this.fetchBinaryImpl(imgs[i]);
          fd.set(`input_image_${i}`, new Blob([bytes], { type: mime }), `ref_${i}.png`);
        }
      }
      return { body: fd }; // FormData 自动带 boundary
    }
    // A 族 JSON
    const body: Record<string, unknown> = { prompt: req.prompt };
    if (spec.steps) body[spec.steps.key] = spec.steps.def;
    if (req.seed != null && Number.isFinite(req.seed)) body.seed = Math.trunc(req.seed);
    if (spec.size) { body.width = size.w; body.height = size.h; }
    if (req.images?.length) {
      if (spec.i2i !== "sdxl-b64") throw new CloudflareError("C302", `模型 ${spec.full} 不接受 images(仅 SDXL 系 image_b64 / flux-2 系 multipart)。`);
      const dataUri = req.images[0];
      const m = /^data:image\/[a-z+]+;base64,(.*)$/s.exec(dataUri);
      if (!m) throw new CloudflareError("C302", "SDXL img2img 输入须 data:URI(工具层已本地化);http URL 请经 flux-2 模型(multipart 参考图)。");
      body.image_b64 = m[1];
      if (req.images.length > 1) warnings.push("SDXL img2img 仅消费 images[0]。");
    }
    return { body: JSON.stringify(body), contentType: "application/json" };
  }

  private async run(model: string, body: unknown, contentType?: string): Promise<any> {
    if (!this.apiToken || !this.accountId) {
      throw new CloudflareError("C100", "凭证未配置(apiToken+accountId 双必需)", {
        precondition: true,
        hint: "dash.cloudflare.com → Workers AI → Use REST API → Create Token + Get Account ID → config providers.cloudflare.{apiToken,accountId}",
      });
    }
    return withRetry(async () => {
      const headers: Record<string, string> = { authorization: `Bearer ${this.apiToken}`, accept: "application/json" };
      if (contentType) headers["content-type"] = contentType;
      const res = await this.fetchImpl(`${this.baseUrl}/accounts/${this.accountId}/ai/run/${CLOUDFLARE_MODELS[model].full}`, { method: "POST", headers, body: body as any });
      const text = () => res.text();
      if (res.status === 401 || res.status === 403) throw new CloudflareError("C101", `鉴权失败 ${res.status}(检查 API Token 权限:Workers AI Read+Edit)`, { httpStatus: res.status, precondition: true });
      if (res.status === 429) {
        const body = await text();
        const code = extractCfCode(body);
        if (code === 3036) throw new CloudflareError("C202", "今日 10,000 neurons 免费额度已尽(00:00 UTC 重置)", { httpStatus: 429, cfCode: 3036, precondition: true });
        throw new CloudflareError("C201", `限流/容量(${code ?? "429"};图像 720 RPM;3040=容量临时超限可重试)`, { httpStatus: 429, cfCode: code });
      }
      if (res.status >= 500) throw new CloudflareError("C202", `上游错误 ${res.status}`, { httpStatus: res.status });
      if (!res.ok) {
        const body = await text();
        const code = extractCfCode(body);
        throw new CloudflareError("C300", `请求错误 ${res.status}${code ? `(cf ${code})` : ""}:${body.slice(0, 180)}`, { httpStatus: res.status, cfCode: code });
      }
      // 防御分支:历史上有裸二进制返回路径的报告 —— Content-Type image/* 时按二进制转 b64(信响应 mime)
      const ct = (res.headers ?? {})["content-type"] ?? "";
      if (ct.startsWith("image/")) {
        const buf = await res.arrayBuffer!();
        return { result: { image: Buffer.from(buf).toString("base64") }, success: true, _binaryFallback: true, _mime: ct.split(";")[0] };
      }
      const j = JSON.parse(await text());
      if (j?.success === false) {
        const err = j?.errors?.[0];
        const code = typeof err?.code === "number" ? err.code : undefined;
        throw new CloudflareError("C301", `envelope success=false${code ? `(cf ${code})` : ""}:${String(err?.message ?? JSON.stringify(j.errors)).slice(0, 180)}`, { httpStatus: 400, cfCode: code });
      }
      return j;
    }, { tag: "Cloudflare" });
  }

  private resolveModel(model: string | undefined): string {
    const m = model ?? "flux-schnell";
    if (!CLOUDFLARE_MODELS[m]) {
      const hit = Object.entries(CLOUDFLARE_MODELS).find(([, v]) => v.full === m);
      if (hit) return hit[0];
      throw new CloudflareError("C300", `未知模型 "${m}"。cloudflare 可用:${CLOUDFLARE_MODEL_NAMES.join(", ")}(或 @cf/ 全名)。`);
    }
    return m;
  }

  /** size 解析:模型支持尺寸→WxH(clamp+告警);schnell 无尺寸参数→忽略告警。 */
  private resolveSize(req: ImageRequest, spec: CfModelSpec, warnings: string[]): { w: number; h: number } {
    const def = spec.size?.def ?? [1024, 1024];
    if (!spec.size) {
      if (req.size) warnings.push("flux-schnell 无 width/height 参数(固定输出),size 已忽略。");
      return { w: def[0], h: def[1] };
    }
    let w = def[0]; let h = def[1];
    if (req.size) {
      const m = /^(\d{2,4})x(\d{2,4})$/.exec(req.size.trim());
      if (m) { w = Number(m[1]); h = Number(m[2]); }
      else warnings.push(`cloudflare size "${req.size}" 无法解析(WxH),用默认 ${def[0]}x${def[1]}。`);
    }
    const [wmin, wmax] = spec.size.w; const [hmin, hmax] = spec.size.h;
    const cw = Math.min(wmax, Math.max(wmin, w)); const ch = Math.min(hmax, Math.max(hmin, h));
    if (cw !== w || ch !== h) warnings.push(`尺寸 clamp 到模型范围:${w}x${h} → ${cw}x${ch}(${spec.full})。`);
    return { w: cw, h: ch };
  }
}

function extractCfCode(body: string): number | undefined {
  const m = /"code"\s*:\s*(\d+)/.exec(body);
  return m ? Number(m[1]) : undefined;
}
function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg"; // schnell 官方标注 JPEG;未知按 jpeg(消费方按 data:URI 落盘)
}
