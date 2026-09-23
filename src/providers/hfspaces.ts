/**
 * HF Spaces 渠道(渠道工厂飞轮轮 24 GO,2026-09-24)—— 免部署跑开源视频模型,gradio REST 直调。
 *
 * 实测定谳(轮 24 S2 + wire 契约实测 agent,全一手 2026-09-24):
 * - 「免部署白嫖开源视频」正门:ZeroGPU 配额=匿名 2min GPU/天(按 IP,共享出口易耗尽)/
 *   免费号 5min/天/PRO $9/月 40min;配额账号级跨 Space 共享;
 * - 协议:POST /gradio_api/call/{api_name} {data:[...]} → {event_id} →
 *   GET /gradio_api/call/{api_name}/{event_id} 收 SSE(event: complete|error|未知忽略);
 *   **event_id 即真异步句柄**(createVideo 提交即返,getVideo 流式收);
 * - 目标表(P0 双主力+P1 兜底,均 RUNNING 实测):
 *   · wan22-i2v  = prithivMLmods/Wan2.2-Fast(Wan2.2-I2V-A14B 蒸馏+量化,9 参全必填平铺,
 *     image_b64 须 data:URI,时长 ≤5s,返回 complete data[0].video=内嵌 data:video/mp4;base64)
 *   · wan22-relay = Saravutw/WAN2.2_I2V_LIGHTNING(首末帧接力 i2v,16 参,input_image/last_image
 *     吃 ImageData{url|base64} 免上传,时长 ≤10s,返回 FileData.url 临时链接即时下载;
 *     hf_oauth 是模板装饰,实测纯 ZeroGPU 走访客配额)
 *   · cogvideox = zai-org/CogVideoX-2B-Space(t2v 兜底,签名最简,480p 无音轨,模型 2024 代)
 * - 错误形态(实测):POST 恒 200+event_id;SSE error **data:null(零延迟)=GPU 记账层拒**
 *   (配额尽/匿名 xlarge 拒,provider 必须识别并指引 token);error 带文本=参数错;
 * - 两种返回形态都要实现(URL 下载 / base64 剥离);HF 直连无需代理;产出归用户
 *   (Wan=Apache2.0 商用安全;CogVideoX=zai-org 许可)。
 *
 * 错误码族:[hfspaces] H1xx 环境/配额(H201 GPU 记账拒=换 token/Space)/ H2xx 网络 /
 * H3xx 参数 / H4xx 结果。纪律:丢弃参数必告警;错误带 .status;能力声明与实现对齐。
 * requiresOptIn=true(共享公共资源,自律使用)。测试:fetchImpl/SSE 注入缝零网络。
 */
import type {
  VideoRequest, VideoTask, VideoResult, VideoHandle,
  Modality, ProviderCapabilities, ChannelInfo, MediaProviderBase, VideoProvider,
} from "./types.js";

export interface HfSpaceTarget {
  subdomain: string;
  apiName: string;
  label: string;
  kind: "i2v" | "i2v-relay" | "t2v";
  maxDurationSeconds: number;
  /** 组装 /call 的 data 数组(参数顺序=签名顺序)。 */
  buildData: (req: VideoRequest, helpers: { toImageData: (u: string) => unknown; dataUriB64: (u: string) => string }) => unknown[];
  /** 从 complete 的 data 数组取产物(返回 {kind:"url",url} 或 {kind:"b64",b64})。 */
  parse: (data: unknown[]) => { kind: "url" | "b64"; value: string } | undefined;
}

export const HFSPACES_MODELS: Record<string, HfSpaceTarget> = {
  "wan22-i2v": {
    subdomain: "prithivmlmods-wan2-2-fast",
    apiName: "generate_video",
    label: "Wan2.2-I2V 蒸馏(prithivMLmods,4 步 Lightning,≤5s,i2v;内嵌 b64 返回)",
    kind: "i2v", maxDurationSeconds: 5,
    buildData: (req, h) => [h.dataUriB64(req.image!), req.prompt ?? "", 4, "", Math.min(5, req.durationSeconds ?? 3.5), 1.0, 1.0, req.seed ?? 42, false],
    parse: (d) => {
      const v = (d?.[0] as any)?.video ?? d?.[0];
      if (typeof v === "string" && v.includes("base64")) {
        const m = /^data:[^;]+;base64,(.*)$/s.exec(v);
        if (m) return { kind: "b64", value: m[1] };
      }
      return undefined;
    },
  },
  "wan22-relay": {
    subdomain: "saravutw-wan2-2-i2v-lightning-4-8step-custom",
    apiName: "generate_video",
    label: "Wan2.2 首末帧接力 i2v(Saravutw Lightning,≤10s,keyframes 支持;URL 返回)",
    kind: "i2v-relay", maxDurationSeconds: 10,
    buildData: (req, h) => [
      h.toImageData(req.image!), req.keyframes?.[1] ? h.toImageData(req.keyframes[1]) : h.toImageData(req.image!),
      req.prompt ?? "", 4, "", Math.min(10, req.durationSeconds ?? 3.5), 1.0, 1.0, req.seed ?? 42, false, 5, "UniPCMultistep", 3, "16", false, true,
    ],
    parse: (d) => {
      const u = (d?.[0] as any)?.url;
      return typeof u === "string" && u ? { kind: "url", value: u } : undefined;
    },
  },
  cogvideox: {
    subdomain: "zai-org-cogvideox-2b-space",
    apiName: "generate",
    label: "CogVideoX-2B t2v 兜底(zai-org 官方,480p 无音轨,2024 代模型)",
    kind: "t2v", maxDurationSeconds: 6,
    buildData: (req) => [req.prompt ?? "", 50, 6],
    parse: (d) => {
      const u = (d?.[0] as any)?.url;
      return typeof u === "string" && u ? { kind: "url", value: u } : undefined;
    },
  },
};
export const HFSPACES_MODEL_NAMES = Object.keys(HFSPACES_MODELS);

export class HfspacesError extends Error {
  readonly code: string;
  readonly precondition?: true;
  readonly httpStatus?: number;
  constructor(code: string, message: string, opts?: { httpStatus?: number; precondition?: boolean; hint?: string }) {
    super(`[hfspaces] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "HfspacesError";
    this.code = code;
    if (opts?.httpStatus !== undefined) { this.httpStatus = opts.httpStatus; (this as any).status = opts.httpStatus; }
    if (opts?.precondition) this.precondition = true;
  }
}

export interface HfspacesProviderOpts {
  /** 可选 HF token(免费号 5min GPU/天,优先级更高;匿名仅 2min/天且共享 IP 易耗尽)。 */
  token?: string;
  /** 测试注入缝:替换底层 HTTP(白盒零网络;POST 与 SSE GET 都走这里)。 */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

interface SseEvent { event: string; data: string | null }

export class HfspacesProvider implements MediaProviderBase, VideoProvider {
  readonly name = "hfspaces";
  private readonly token?: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  /** SSE 收流截止测试缝(生产 600s;排队+生成实测可达数分钟)。 */
  pollDeadlineMs = 600_000;
  /** 提交后需记住模型以解析 getVideo(async handle 的解析上下文)。 */
  private readonly taskModels = new Map<string, string>();
  private cooldownUntil = 0;
  private lastErrorAt?: string;

  constructor(opts: HfspacesProviderOpts = {}) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl || ((u: string, i: RequestInit) => fetch(u, i));
  }

  // ── 基础 ──
  capabilities(): ProviderCapabilities {
    // relay=首末帧接力(Saravutw input_image+last_image),按 keyframes 能力如实声明
    return { image: { textToImage: false, imageToImage: false }, video: { textToVideo: true, imageToVideo: true, keyframes: true } };
  }
  requiresOptIn(_m: Modality): boolean { return true; }
  listModels(): string[] { return [...HFSPACES_MODEL_NAMES]; }
  listImageModels(): string[] { return []; }
  listVideoModels(): string[] { return [...HFSPACES_MODEL_NAMES]; }
  videoConstraints() {
    return { allowedNumFrames: [56, 80, 120, 160], defaultNumFrames: 56, defaultFrameRate: 16, allowedFrameRates: [16] }; // 16fps 实测;3.5s≈56 帧
  }
  estimateGenerationSeconds(_n: number, _f?: number): number { return 180; }
  health() { return { configured: true, cooldown: Date.now() < this.cooldownUntil, lastErrorAt: this.lastErrorAt }; }
  notifyUnavailable(e: any): void {
    this.lastErrorAt = new Date().toISOString();
    const st = e instanceof HfspacesError ? e.httpStatus : undefined;
    if (st !== undefined && (st === 0 || st === 429 || st >= 500)) this.cooldownUntil = Date.now() + 60_000;
  }

  channelInfo(): ChannelInfo {
    return {
      status: "live",
      cost: "免费(ZeroGPU 公共配额):匿名 2min GPU/天(按 IP,共享出口易耗尽)/免费 HF 账号 5min/天/PRO $9/月 40min —— 配 hfspaces.token 提额提优先级",
      freeQuota: "配额账号级跨 Space 共享;≈3-5 条 Wan2.2/天(免费号);匿名出口 IP 常已耗尽(实测 data:null),正式使用建议配免费 HF token",
      capabilities: { t2i: false, i2i: false, t2v: true, i2v: true, keyframes: true },
      limits: [
        "**video-only**(图生成不在本渠道;P1 cogvideox 为 2024 代兜底,480p 无音轨)",
        "wan22-i2v ≤5s(9 参全必填,输入须 data:URI,内嵌 b64 返回);wan22-relay ≤10s(首末帧接力=唯一 keyframes 支持;URL 输入输出)",
        "无显式分辨率参数(prithiv 自动方裁 480-832;relay 随图比例;quality 是码率非分辨率)",
        "GPU 记账层拒=SSE error data:null(零延迟无文本)——换 Space/换 token 重试;FileData.url 为临时链接即时下载",
        "共享公共资源自律使用;Saravutw 的 hf_oauth 是模板装饰(实测纯 ZeroGPU)",
      ],
      watermark: "无平台水印(产出随模型许可:Wan=Apache2.0 商用安全;CogVideoX=zai-org 许可)",
      prerequisites: [
        "开箱即用(匿名);正式使用:huggingface.co 免费注册 → Settings → Access Tokens 建 token → config providers.hfspaces.token(5min GPU/天+高优先级)",
        "HF 直连无需代理;产出归用户(HF ToS:You own the Content you create)",
      ],
      risks: [
        "社区 Space 随时可私有化/改签名(官方 demo 已大面积私有化)——目标表 3 个均为 2026-09-24 RUNNING 实测,漂移时 H3xx 报错指引换 Space",
        "匿名 GPU 按 IP 记账,共享出口配额易被他人耗尽",
        "排队时长不可控(低优先级匿名可达数分钟)",
      ],
    };
  }

  // ── 提交(真异步:event_id 即句柄) ──
  async createVideo(req: VideoRequest): Promise<VideoTask> {
    const warnings: string[] = [];
    if (req.negativePrompt) warnings.push("hfspaces 目标表未透传 negativePrompt(prithiv 留空串),已忽略。");
    if (req.videoMediaId) warnings.push("hfspaces 无视频续写,videoMediaId 已忽略。");
    if (req.audioMediaIds?.length) warnings.push("hfspaces 无音频参考(audioMediaIds),已忽略。");
    if (req.resolution && req.resolution !== "480p" && req.resolution !== "720p") warnings.push(`hfspaces 无显式分辨率参数(自动方裁/随图比例),resolution=${req.resolution} 已忽略。`);
    // 模型路由:显式 > 按输入形态默认(i2v→wan22-i2v;image+keyframes[1]→relay;t2v→cogvideox)
    let model = req.model;
    if (!model) {
      if (req.image && req.keyframes?.[1]) model = "wan22-relay";
      else if (req.image) model = "wan22-i2v";
      else model = "cogvideox";
    }
    const target = HFSPACES_MODELS[model];
    if (!target) throw new HfspacesError("H300", `未知模型 "${model}"。hfspaces 可用:${HFSPACES_MODEL_NAMES.join(", ")}。`);
    if (target.kind !== "t2v" && !req.image) throw new HfspacesError("H302", `${model} 是 i2v 模型,须传 image(纯文生视频用 cogvideox)。`);
    if (target.kind === "t2v" && req.image) warnings.push("cogvideox 为 t2v,image 已忽略。");
    if (req.durationSeconds != null && req.durationSeconds > target.maxDurationSeconds) warnings.push(`${model} 时长上限 ${target.maxDurationSeconds}s,durationSeconds=${req.durationSeconds} 已截断。`);
    if (target.kind === "i2v-relay" && !req.keyframes?.[1]) warnings.push("wan22-relay 是首末帧接力模型但仅收到首帧,last_image 将复用首帧(等效单帧 i2v);首尾帧请用 keyframes[2] 传。");
    if (target.kind === "i2v" && req.keyframes?.[1]) warnings.push("wan22-i2v 不支持末帧(keyframes[1] 已忽略;接力用 wan22-relay)。");

    const helpers = {
      toImageData: (u: string) => {
        const m = /^data:[^;]+;base64,(.*)$/s.exec(u);
        if (m) return { base64: m[1] }; // ImageData base64 形态(data:URI 剥离)
        if (/^https?:\/\//i.test(u)) return { url: u };
        throw new HfspacesError("H302", "参考图须公网 http(s) URL 或 data:URI。");
      },
      dataUriB64: (u: string) => {
        const m = /^data:[^;]+;base64,(.*)$/s.exec(u);
        if (!m) throw new HfspacesError("H302", `wan22-i2v 的 image 须 data:URI(工具层已本地化;http URL 请用 wan22-relay)。`);
        return u; // prithiv 原样要 data:URI 字符串
      },
    };
    const data = target.buildData(
      { ...req, image: req.image, durationSeconds: Math.min(req.durationSeconds ?? 3.5, target.maxDurationSeconds) } as VideoRequest,
      helpers,
    );
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`https://${target.subdomain}.hf.space/gradio_api/call/${target.apiName}`, {
      method: "POST", headers, body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404) throw new HfspacesError("H301", `Space/端点 404(${target.subdomain} 可能已私有化或改签名)`, { httpStatus: 404, hint: "社区 Space 漂移是常态——换模型名或稍后重试" });
      throw new HfspacesError("H200", `提交失败 HTTP ${res.status}:${body.slice(0, 150)}`, { httpStatus: res.status });
    }
    const j = await res.json() as any;
    const eventId = j?.event_id;
    if (!eventId) throw new HfspacesError("H400", `无 event_id:${JSON.stringify(j).slice(0, 150)}`);
    this.taskModels.set(String(eventId), model);
    warnings.push(`hfspaces=${model}(${target.label});ZeroGPU 公共配额,排队时长取决于优先级${this.token ? "(带 token)" : "(匿名低优先级,建议 config providers.hfspaces.token)"}。`);
    return { taskId: String(eventId), status: "submitted", raw: { provider: "hfspaces", model }, warnings };
  }

  // ── 收流(SSE;event_id 真句柄) ──
  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    const eventId = handle.taskId ?? handle.videoId;
    if (!eventId) return { status: "failed", error: "hfspaces 取件需 taskId(event_id)" };
    const model = this.taskModels.get(eventId);
    if (!model) return { status: "failed", error: `event_id ${eventId} 无模型上下文(进程内 Map;重启后不可恢复——gradio event 短时效,本属正常)` };
    const target = HFSPACES_MODELS[model];
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`https://${target.subdomain}.hf.space/gradio_api/call/${target.apiName}/${eventId}`, { method: "GET", headers });
    if (!res.ok) return { status: "failed", error: `SSE GET HTTP ${res.status}(event 可能已过期;gradio event 短时效,请重新提交)` };
    const events = await this.readSse(res);
    this.taskModels.delete(eventId);
    for (const ev of events) {
      if (ev.event === "error") {
        if (ev.data == null || ev.data === "null") {
          return { status: "failed", error: "GPU 记账层拒(配额尽/匿名 xlarge 拒;实测形态 data:null)——换 Space 重试,或 config providers.hfspaces.token 配免费 HF token(5min/天+高优先级)" };
        }
        return { status: "failed", error: `Space 执行错误:${String(ev.data).slice(0, 200)}` };
      }
      if (ev.event === "complete") {
        let arr: unknown[];
        try { arr = JSON.parse(String(ev.data ?? "[]")); } catch { arr = []; }
        const out = target.parse(arr);
        if (!out) return { status: "failed", error: `complete 但无产物(模型 ${model};形态漂移?)` };
        if (out.kind === "b64") {
          return { status: "completed", url: `data:video/mp4;base64,${out.value}`, raw: { provider: "hfspaces", model } };
        }
        const buf = await this.downloadUrl(out.value);
        return { status: "completed", url: `data:video/mp4;base64,${Buffer.from(buf).toString("base64")}`, raw: { provider: "hfspaces", model } };
      }
      // queue/generating/未知事件:忽略继续
    }
    return { status: "failed", error: "SSE 流结束但无 complete/error(未知形态)" };
  }

  /** SSE 解析(fetch 流式 body;"event: X\ndata: Y" 帧;data:null 保 null)。 */
  private async readSse(res: Response): Promise<SseEvent[]> {
    const deadline = Date.now() + this.pollDeadlineMs;
    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events: SseEvent[] = [];
    for (;;) {
      if (Date.now() > deadline) throw new HfspacesError("H201", `SSE 收流超时(>${Math.round(this.pollDeadlineMs / 1000)}s;排队+生成;可重试同 event_id 或重新提交)`, { httpStatus: 0 });
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let event = "message"; let data: string | null = null;
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = data == null ? line.slice(5).trim() : `${data}\n${line.slice(5).trim()}`;
        }
        events.push({ event, data });
        if (event === "complete" || event === "error") {
          try { await reader.cancel(); } catch { /* 已结束 */ }
          return events;
        }
      }
    }
    return events;
  }

  private async downloadUrl(url: string): Promise<ArrayBuffer> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const r = await this.fetchImpl(url, { method: "GET", headers });
    if (!r.ok) throw new HfspacesError("H201", `产物下载失败 HTTP ${r.status}(FileData.url 临时链接,须即时取)`, { httpStatus: 0 });
    return r.arrayBuffer();
  }
}
