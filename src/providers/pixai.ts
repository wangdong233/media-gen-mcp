/**
 * PixAI 渠道(渠道工厂飞轮轮 7 GO,2026-09-23)—— 动漫垂直,双通道 provider。
 *
 * 调研定谳(doc/渠道工厂飞轮.md 轮 7 + wire 契约挖掘 agent 报告):
 * - 模式 B:免费 10,000 积分/日绑定账号(非 UI)——Web 后端 GraphQL(api.pixai.art/graphql)
 *   即 UI 自己调的 API,与 UI 同池;claim 制(dailyClaimQuota)+邮箱验证才发放;
 * - 官方 REST v2(api.pixai.art/v2/image/create,Bearer API key)计费官方文档零提及(❓待实测);
 * - 凭证优先级:apiKey(REST)→ token(GraphQL 直连)→ email/password(recaptcha 两步+login
 *   mutation,token 在**响应头 Token**;逆向产物脆弱,失败给 DevTools 手动取 token 降级指引);
 * - GraphQL 生图 parameters 自由 JSONObject(modelId=版本 ID/priority:1000 必传免公共队列);
 *   REST v2 严格 schema(additionalProperties:false;aspectRatio/size 枚举;batchSize 仅 1|4);
 * - 轮询:REST ≥1.5s(官方红线)/GraphQL ≥2s;终态 waiting|running|completed|failed|cancelled;
 *   产物不永久保留→完成即下载转 data:URI;并发 waiting≤10(REST 官方;GraphQL 同池假设);
 * - **API 无视频**(官方 limits 明确);Reference Pro/Edit API 未开放;i2i 仅 GraphQL 通道
 *   且 mediaUrl 须公网 URL(上传两段式 P2 再开);
 * - IP 条款全候选最优:平台不主张版权+API 产出用户持版权且私有;
 * - 风险:GraphQL 非官方路径可演化(官方客户端已 archived);单账号自律(反多账号明文)。
 *
 * 错误码族:[pixai] P1xx 环境(凭证/recaptcha)/ P2xx 网络 / P3xx 参数 / P4xx 结果。
 * 纪律:错误必带 .status(4xx 立即抛,5xx/0 才瞬时重试);丢弃参数必告警;能力声明与实现逐项对齐。
 * requiresOptIn=true。测试:白盒 stub(fetchImpl/downloadImpl 注入缝);真机门 PIXAI_IT 双门。
 */
import type {
  ImageRequest, ImageResult, ImageConstraints,
  Modality, ProviderCapabilities, ChannelInfo, MediaProviderBase, ImageProvider,
} from "./types.js";
import { withRetry } from "./http.js";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/** 简单名 → 模型版本 ID(wire 契约 B5 官方静态表;用户点名用简单名,内部映射)。 */
export const PIXAI_MODELS: Record<string, { versionId: string; family: "dit" | "sdxl"; label: string }> = {
  tsubaki2: { versionId: "1983308862240288769", family: "dit", label: "Tsubaki.2(推荐,DiT,mode 四档)" },
  haruka2: { versionId: "1861558740588989558", family: "sdxl", label: "Haruka v2(SDXL,sampling 可调)" },
  hoshino2: { versionId: "1954632828118619567", family: "sdxl", label: "Hoshino v2(SDXL,sampling 可调)" },
};
export const PIXAI_MODEL_NAMES = Object.keys(PIXAI_MODELS);
/** REST v2 枚举(wire 契约 B2 逐字)。 */
const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "3:5", "5:3", "9:16", "16:9", "1:3", "3:1"] as const;
/** 1k 档像素表(比例 → 宽×高;GraphQL 通道直传用)。 */
const RATIO_1K: Record<string, [number, number]> = {
  "1:1": [1024, 1024], "2:3": [848, 1280], "3:2": [1280, 848], "3:4": [864, 1152], "4:3": [1152, 864],
  "3:5": [768, 1280], "5:3": [1280, 768], "9:16": [720, 1280], "16:9": [1280, 720], "1:3": [512, 1536], "3:1": [1536, 512],
};
/** Tsubaki.2 积分价(×4 批次官方价/4;source:官方 docs 模型页)。 */
const PIXAI_CREDITS_PER_IMAGE: Record<string, number> = { tsubaki2_lite: 550, tsubaki2_standard: 800, tsubaki2_pro: 1700, tsubaki2_ultimate: 1750, haruka2: 400, hoshino2: 400 };
const DEFAULT_NEGATIVE = "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry";
const RECAPTCHA_SITEKEY = "6Ld_hskiAAAAADfg9HredZvZx8Z_C8FrNJ519Rc6";
const TOKEN_STORE = path.join(os.homedir(), ".media-gen-mcp", "pixai-token.json");

// ── GraphQL 原文(wire 契约 A 节;社区/官方客户端逐字提取) ──
const GQL_LOGIN = `mutation login($input: RegisterOrLoginInput!) { login(input: $input) { id email emailVerified username } }`;
const GQL_CLAIM = `mutation dailyClaimQuota { dailyClaimQuota }`;
const GQL_QUOTA = `query getMyQuota { me { quotaAmount } }`;
const GQL_CREATE = `mutation createGenerationTask($parameters: JSONObject!) { createGenerationTask(parameters: $parameters) { id status } }`;
const GQL_TASK = `query getTaskById($id: ID!) { task(id: $id) { id status outputs } }`;
const GQL_MEDIA = `query getMediaById($id: String!) { media(id: $id) { id urls { variant url } } }`;

export class PixaiError extends Error {
  readonly code: string;
  readonly precondition?: true;
  readonly httpStatus?: number;
  constructor(code: string, message: string, opts?: { httpStatus?: number; precondition?: boolean; hint?: string }) {
    super(`[pixai] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "PixaiError";
    this.code = code;
    if (opts?.httpStatus !== undefined) { this.httpStatus = opts.httpStatus; (this as any).status = opts.httpStatus; }
    if (opts?.precondition) this.precondition = true;
  }
}

interface PixaiHttpResp { ok: boolean; status: number; headers?: Record<string, string>; json(): Promise<any>; text(): Promise<string>; }

export interface PixaiProviderOpts {
  apiKey?: string;
  token?: string;
  email?: string;
  password?: string;
  baseUrl?: string;
  /** 测试注入缝:替换底层 HTTP(白盒零网络)。 */
  fetchImpl?: (url: string, init: RequestInit) => Promise<PixaiHttpResp>;
  /** 测试注入缝:下载产物(PixAI 产物不永久保留,生产立即下载)。 */
  downloadImpl?: (url: string) => Promise<ArrayBuffer>;
  /** 测试缝:禁读宿主 token 存储(白盒测试防真发网络请求;S6 审查 D-2)。 */
  disableStoredTokenLoad?: boolean;
}

export class PixaiProvider implements MediaProviderBase, ImageProvider {
  readonly name = "pixai";
  private readonly apiKey?: string;
  private token?: string;
  private readonly email?: string;
  private readonly password?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: (url: string, init: RequestInit) => Promise<PixaiHttpResp>;
  private readonly downloadImpl: (url: string) => Promise<ArrayBuffer>;
  /** 轮询节奏测试缝(生产 2s;REST 官方红线 ≥1.5s)。 */
  pollIntervalMs = 2_000;
  /** 轮询截止测试缝(生产 300s;社区实证 15-30s 级完成)。 */
  pollDeadlineMs = 300_000;
  private cooldownUntil = 0;
  private lastErrorAt?: string;
  /** 每日 claim 幂等闸(进程内;领取制配额)。 */
  private claimedOn?: string;
  /** 测试缝:禁用磁盘 token 持久化。 */
  persistToken = true;

  constructor(opts: PixaiProviderOpts = {}) {
    this.apiKey = opts.apiKey;
    this.token = opts.token ?? (opts.disableStoredTokenLoad ? undefined : PixaiProvider.loadStoredToken());
    this.email = opts.email;
    this.password = opts.password;
    this.baseUrl = (opts.baseUrl || "https://api.pixai.art").replace(/\/$/, "");
    this.fetchImpl = (opts.fetchImpl as any) || ((u: string, i: RequestInit) => fetch(u, i) as any);
    this.downloadImpl = opts.downloadImpl || ((u: string) => fetch(u).then((r) => {
      if (!r.ok) throw new PixaiError("P200", `产物下载失败 HTTP ${r.status}(PixAI 产物不永久保留,任务需重生成)`, { httpStatus: 0 });
      return r.arrayBuffer();
    }));
  }

  private static loadStoredToken(): string | undefined {
    try { return JSON.parse(fs.readFileSync(TOKEN_STORE, "utf8")).token ?? undefined; } catch { return undefined; }
  }
  private storeToken(token: string): void {
    if (!this.persistToken) return;
    try { fs.mkdirSync(path.dirname(TOKEN_STORE), { recursive: true }); fs.writeFileSync(TOKEN_STORE, JSON.stringify({ token, savedAt: new Date().toISOString() }), { mode: 0o600 }); } catch { /* 持久化失败不阻断会话 */ }
  }

  /** 通道判定:apiKey=官方 REST v2;否则 token/email-password=GraphQL 免费通道。 */
  private channel(): "api" | "graphql" {
    return this.apiKey ? "api" : "graphql";
  }
  private hasCredential(): boolean {
    return !!(this.apiKey || this.token || (this.email && this.password));
  }

  // ── 基础 ──
  capabilities(): ProviderCapabilities {
    // i2i 仅 GraphQL 通道(mediaUrl 公网 URL);REST v2 create 无图像输入字段
    return { image: { textToImage: true, imageToImage: this.channel() === "graphql" }, video: { textToVideo: false, imageToVideo: false, keyframes: false } };
  }
  requiresOptIn(_m: Modality): boolean { return true; }
  listModels(): string[] { return [...PIXAI_MODEL_NAMES]; }
  listImageModels(): string[] { return [...PIXAI_MODEL_NAMES]; }
  listVideoModels(): string[] { return []; }
  imageConstraints(): ImageConstraints | undefined { return undefined; } // REST 枚举在实现内 snap+warn
  supportsImageToImage(): boolean { return this.channel() === "graphql"; }
  /** 通用层 images[] 门:仅公网 URL(上传两段式 P2 再开;data:/本地路径明确拒)。 */
  acceptsImageInputRef(value: string): boolean { return /^https?:\/\//i.test(value); }
  estimateGenerationSeconds(_n: number, _f?: number): number { return 45; }
  health() { return { configured: this.hasCredential(), cooldown: Date.now() < this.cooldownUntil, lastErrorAt: this.lastErrorAt }; }
  notifyUnavailable(e: any): void {
    this.lastErrorAt = new Date().toISOString();
    const st = e instanceof PixaiError ? e.httpStatus : undefined;
    if (st !== undefined && (st === 0 || st === 429 || st >= 500)) this.cooldownUntil = Date.now() + 60_000;
  }

  channelInfo(): ChannelInfo {
    return {
      status: this.hasCredential() ? "live" : "blocked-on-login",
      cost: "免费 10,000 积分/日(GraphQL token 通道,≈12 张 Standard/日;claim 制)+ 官方 REST API key 通道计费未公开(❓待实测)",
      freeQuota: "每日 10,000 积分(绑定账号;须邮箱验证;每日 claim 领取,provider 首次生成自动领取并告警);发图/任务/LoRA 返利可加赚",
      capabilities: { t2i: true, i2i: this.channel() === "graphql", t2v: false, i2v: false, keyframes: false },
      limits: [
        "API 无视频(官方 limits 明确;视频仅 UI)——本 provider 仅生图",
        "i2i 仅 GraphQL 通道且 images[] 须公网 http(s) URL(data:/本地路径拒;上传两段式后续开)",
        "waiting 任务 ≤10(REST 官方;GraphQL 同池假设);轮询 ≥1.5s",
        "×4 批次五折(Standard 3,200 积分/4 张=800/张)——当前工具层逐张扇出不享批量折扣,n>1 每张按单价",
        "产物不永久保留:完成即自动下载落盘(data:URI)",
        "REST v2 严格 schema:aspectRatio/size 枚举自动 snap+告警;mode 仅 Tsubaki 家族",
      ],
      watermark: "未见免费层强制水印证据(❓未定案;docs 仅列 watermark 为可选参数)",
      prerequisites: [
        "注册 pixai.art + 邮箱验证(不验证无每日积分)",
        "GraphQL token 三选一:①config providers.pixai.email/password(自动 recaptcha+login,脆弱逆向)②浏览器 DevTools → Local Storage → api.pixai.art:token 手动复制 → providers.pixai.token ③官方 API key:profile/edit/api 自助建(会员即时)或邮件 api@withpixai.art → providers.pixai.apiKey",
      ],
      risks: [
        "GraphQL 为 UI 同构非官方路径,随时可能演化(官方客户端已 archived 印证);报错时优先怀疑接口变更",
        "recaptcha 登录是逆向产物(sitekey/流程),Google 侧改动即失效——降级路径=手动复制 token",
        "单账号自律:官方明文反多账号农场;禁滥用",
        "官方 REST API 计费未公开:首用建议小额验证是否扣账号积分(P100 提示里有验证步骤)",
      ],
    };
  }

  /** 成本目录(积分/张;非人民币——免费池内消耗)。 */
  costCatalog() {
    const out: Record<string, { mode: "image" | "video"; credits?: number; unit: "per-image" | "unknown"; source: "static" | "none" }> = {};
    for (const [k, v] of Object.entries(PIXAI_CREDITS_PER_IMAGE)) {
      out[k] = { mode: "image", credits: v, unit: "per-image", source: "static" };
    }
    return out;
  }

  // ── HTTP ──
  private async gql<T = any>(query: string, variables?: Record<string, unknown>, opts?: { browserHeaders?: boolean }): Promise<T> {
    const token = await this.ensureToken();
    return withRetry(async () => {
      const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}` };
      if (opts?.browserHeaders !== false && !this.apiKey) {
        // 免费通道伪装浏览器(wire 契约 A0:社区库实证必须);API key 通道用客户端 UA
        headers["origin"] = "https://pixai.art";
        headers["referer"] = "https://pixai.art/";
        headers["user-agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
      } else {
        headers["user-agent"] = "PixAIApiClient/1.0.0";
      }
      const res = await this.fetchImpl(`${this.baseUrl}/graphql`, { method: "POST", headers, body: JSON.stringify({ query, variables: variables ?? {} }) });
      const text = () => res.text();
      if (res.status === 401) throw new PixaiError("P101", "凭证失效(Invalid token)——重新登录或更新 config providers.pixai.token/apiKey", { httpStatus: 401, precondition: true });
      if (res.status === 429) throw new PixaiError("P201", `限流:${(await text()).slice(0, 120)}(轮询红线 ≥1.5s;waiting≤10)`, { httpStatus: 429 });
      if (res.status >= 500) throw new PixaiError("P202", `上游错误 ${res.status}`, { httpStatus: res.status });
      if (!res.ok) throw new PixaiError("P300", `请求错误 ${res.status}:${(await text()).slice(0, 200)}`, { httpStatus: res.status });
      const j = JSON.parse(await text());
      if (j?.errors?.length) {
        const code = j.errors[0]?.extensions?.code;
        if (code === "UNAUTHENTICATED") throw new PixaiError("P101", `GraphQL UNAUTHENTICATED:${j.errors[0]?.message}`, { httpStatus: 401, precondition: true });
        throw new PixaiError("P301", `GraphQL 业务错误:${JSON.stringify(j.errors).slice(0, 200)}`, { httpStatus: 400 });
      }
      return j.data as T;
    }, { tag: "Pixai" });
  }

  private async rest<T = any>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    if (!this.apiKey) throw new PixaiError("P100", "REST 通道需 apiKey(config providers.pixai.apiKey)", { precondition: true });
    return withRetry(async () => {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, "user-agent": "PixAIApiClient/1.0.0" },
        body: init.body != null ? JSON.stringify(init.body) : undefined,
      });
      const text = () => res.text();
      if (res.status === 401) throw new PixaiError("P101", "apiKey 失效(Invalid Compact JWS)", { httpStatus: 401, precondition: true });
      if (res.status === 429) throw new PixaiError("P201", `限流:${(await text()).slice(0, 120)}`, { httpStatus: 429 });
      if (res.status >= 500) throw new PixaiError("P202", `上游错误 ${res.status}`, { httpStatus: res.status });
      if (!res.ok) throw new PixaiError("P300", `REST ${res.status}:${(await text()).slice(0, 200)}`, { httpStatus: res.status });
      return res.json() as Promise<T>;
    }, { tag: "Pixai" });
  }

  /** 凭证路由:有 token 直用;email/password 则 recaptcha 两步 + login mutation,token 在响应头。 */
  private async ensureToken(): Promise<string> {
    if (this.apiKey) return this.apiKey; // REST 通道不经 gql;此处兜底返回(不应到达)
    if (this.token) return this.token;
    if (!this.email || !this.password) {
      throw new PixaiError("P100", "pixai 凭证未配置(GraphQL token / email+password / apiKey 三选一)", {
        precondition: true,
        hint: "最稳:浏览器登录 pixai.art → DevTools → Application → Local Storage → 复制 api.pixai.art:token 的值 → config providers.pixai.token。或 profile/edit/api 建官方 API key → providers.pixai.apiKey",
      });
    }
    const recaptcha = await this.fetchRecaptchaToken();
    const res = await this.fetchImpl(`${this.baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://pixai.art", referer: "https://pixai.art/" },
      body: JSON.stringify({ query: GQL_LOGIN, variables: { input: { email: this.email, password: this.password, recaptchaToken: recaptcha } } }),
    });
    const headerToken = (res.headers ?? {})["token"] ?? (res.headers ?? {})["Token"];
    if (!headerToken) {
      const body = await res.text().catch(() => "");
      throw new PixaiError("P102", `登录未取到 token(响应头 Token 缺失;HTTP ${res.status}${body ? `:${body.slice(0, 120)}` : ""})`, { precondition: true, hint: "降级:浏览器 DevTools → Local Storage → api.pixai.art:token 手动复制 → providers.pixai.token" });
    }
    this.token = headerToken;
    this.storeToken(headerToken);
    return headerToken;
  }

  /** recaptcha invisible 两步(anchor 取 anchorToken → reload 换 execution token;逆向产物,失败走手动 token)。 */
  private async fetchRecaptchaToken(): Promise<string> {
    try {
      const co = "aHR0cHM6Ly9waXhhaS5hcnQ6NDQz";
      const v = "aR-zv8WjtWx4lAw-tRCA-zca";
      const anchor = await this.fetchImpl(
        `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITEKEY}&co=${co}&hl=ja&v=${v}&size=invisible&cb=${Date.now()}`,
        { method: "GET", headers: { "user-agent": "Mozilla/5.0" } },
      );
      const html = await anchor.text();
      const anchorToken = html.split('recaptcha-token" value="')[1]?.split('"')[0];
      if (!anchorToken) throw new Error("anchor 无 token");
      const reloadRes = await this.fetchImpl(`https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITEKEY}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ v: anchorToken, reason: "q", c: "", k: RECAPTCHA_SITEKEY, co, hl: "ja", size: "invisible" }).toString(),
      });
      const reloadText = await reloadRes.text();
      const exec = reloadText.split('"rresp","')[1]?.split('"')[0];
      if (!exec) throw new Error("reload 无 rresp");
      return exec;
    } catch (e) {
      throw new PixaiError("P102", `recaptcha 逆向登录失败(${(e as Error).message?.slice(0, 100)})`, { precondition: true, hint: "降级:浏览器 DevTools → Local Storage → api.pixai.art:token 手动复制 → providers.pixai.token" });
    }
  }

  /** 每日 claim(领取制配额):进程内按日幂等 + in-flight memo(并发扇出共享一次请求);非凭证类失败不阻断生成(可能已领);凭证错快速失败;顺带回读余额。 */
  private claimInFlight?: Promise<void>;
  private async claimDailyIfNeeded(warnings: string[]): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.claimedOn === today || this.channel() !== "graphql") return;
    if (this.claimInFlight) return this.claimInFlight; // 并发扇出共享同一 claim(S6 审查 A-4)
    this.claimInFlight = this.doClaim(warnings).finally(() => { this.claimInFlight = undefined; });
    return this.claimInFlight;
  }
  private async doClaim(warnings: string[]): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await this.gql(GQL_CLAIM);
      this.claimedOn = today;
      let quotaNote = "";
      try {
        const q = await this.gql(GQL_QUOTA);
        const amt = parseInt(String(q?.me?.quotaAmount ?? ""), 10);
        if (Number.isFinite(amt)) quotaNote = `(当前余额 ${amt} 积分)`;
      } catch { /* 余额读取失败不阻断 */ }
      warnings.push(`pixai 每日配额已自动 claim(领取制;10,000 积分/日)${quotaNote}。`);
    } catch (e) {
      if (e instanceof PixaiError && e.precondition) throw e; // 凭证/环境错:生成必同样失败,快速失败保真错因
      warnings.push(`pixai 每日 claim 未成功(${(e as Error).message?.slice(0, 80)})——若今日已在 UI 领取过则无碍。`);
    }
  }

  // ── 生图 ──
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    // 告警忽略块(纪律:丢弃参数必告警;images 走明确拒绝非告警)
    if (req.n && req.n > 1) warnings.push(`pixai provider 恒单张(工具层扇出);注意 ×4 批次五折仅 UI/直调可得,当前每张按单价(${PIXAI_CREDITS_PER_IMAGE.tsubaki2_standard} 积分/张 Standard 级)。`);
    if (req.quality) warnings.push("pixai 不支持 quality,已忽略(档位由模型+mode 决定)。");
    const extraKeys = Object.keys(req.extra ?? {});
    if (extraKeys.length) warnings.push(`pixai 不消费 extra(${extraKeys.join("/")}),已忽略。`);
    const model = this.resolveModel(req.model);
    const isTsubaki = PIXAI_MODELS[model].family === "dit";
    const size = this.resolveSize(req, warnings); // {ratio, w, h}
    await this.claimDailyIfNeeded(warnings);

    if (this.channel() === "api") {
      return this.generateRest(req, model, isTsubaki, size, warnings);
    }
    return this.generateGql(req, model, size, warnings);
  }

  /** REST v2(严格 schema;additionalProperties:false)。 */
  private async generateRest(req: ImageRequest, model: string, isTsubaki: boolean, size: { ratio: string }, warnings: string[]): Promise<ImageResult> {
    if (req.images?.length) throw new PixaiError("P302", "REST 通道 v2 create 无图像输入字段(i2i 仅 GraphQL 通道;换 token 凭证或去掉 images)。");
    const body: Record<string, unknown> = {
      modelVersionId: PIXAI_MODELS[model].versionId,
      prompt: req.prompt,
      aspectRatio: size.ratio,
      size: "1k",
      promptHelper: "disable", // 确定性:不服务端增强 prompt
    };
    if (isTsubaki) body.mode = "standard";
    if (req.seed != null && Number.isFinite(req.seed)) body.seed = Math.trunc(req.seed);
    if (req.aspect && !(ASPECT_RATIOS as readonly string[]).includes(req.aspect)) warnings.push(`pixai REST aspectRatio 无 ${req.aspect} 枚举,已 snap(${size.ratio})。`);
    const created = await this.rest<any>("/v2/image/create", { method: "POST", body });
    const taskId = created?.id;
    if (!taskId) throw new PixaiError("P400", `create 无任务 id:${String(JSON.stringify(created) ?? "").slice(0, 200)}`);
    warnings.push(`pixai REST 通道(API key):官方计费未公开——若扣积分则与免费池同源,若独立计费请停用并反馈。`);
    // 轮询 GET /v1/task/{id}(≥1.5s;v2/v1 混用是官方钦定)
    const final = await this.pollUntil(taskId, async (id) => {
      const t = await this.rest<any>(`/v1/task/${id}`, { method: "GET" });
      return { status: String(t?.status ?? ""), mediaUrls: (t?.outputs?.mediaUrls ?? []).filter((u: unknown): u is string => typeof u === "string"), raw: t };
    });
    if (final.status !== "completed") throw new PixaiError("P401", `任务未完成(${final.status})`);
    if (!final.mediaUrls.length) throw new PixaiError("P400", "completed 但无可用 mediaUrl(产物可能已过期不保留)");
    const urls: string[] = [];
    for (const u of final.mediaUrls) {
      const buf = await this.downloadWithRetry(u);
      urls.push(`data:image/png;base64,${Buffer.from(buf).toString("base64")}`);
    }
    return { outputs: urls.map((url) => ({ url })), raw: { provider: "pixai", channel: "api", model, taskId }, warnings };
  }

  /** GraphQL(免费通道;parameters 自由 JSONObject)。 */
  private async generateGql(req: ImageRequest, model: string, size: { w: number; h: number }, warnings: string[]): Promise<ImageResult> {
    const img = req.images?.[0];
    if (req.images && req.images.length > 1) warnings.push("pixai i2i 仅消费 images[0](多图参考 Reference Pro 未开放 API)。");
    if (img && !/^https?:\/\//i.test(img)) throw new PixaiError("P302", "i2i 输入须公网 http(s) URL(data:/本地路径需先上传;两段式上传后续开放)。");
    const parameters: Record<string, unknown> = {
      prompts: req.prompt,
      negativePrompts: DEFAULT_NEGATIVE, // ImageRequest 无 negativePrompt 字段;固定低质量词(视频契约字段不混入)
      width: size.w,
      height: size.h,
      modelId: PIXAI_MODELS[model].versionId,
      samplingSteps: 25,
      samplingMethod: "DPM++ 2M Karras",
      cfgScale: 6,
      seed: req.seed != null && Number.isFinite(req.seed) ? Math.trunc(req.seed) : "",
      priority: 1_000, // 不传进公共队列慢排队(官方 Go README)
      autoPublish: false,
    };
    if (img) { parameters.mediaUrl = img; }
    const created = await this.gql(GQL_CREATE, { parameters });
    const taskId = created?.createGenerationTask?.id;
    if (!taskId) throw new PixaiError("P400", `createGenerationTask 无任务 id:${String(JSON.stringify(created) ?? "").slice(0, 200)}`);
    // 轮询 task(id) → outputs.batch[].mediaId || outputs.mediaId
    const final = await this.pollUntil(String(taskId), async (id) => {
      const d = await this.gql(GQL_TASK, { id });
      const t = d?.task;
      const outs = t?.outputs ?? {};
      const mediaIds: string[] = Array.isArray(outs?.batch) ? outs.batch.map((b: any) => b?.mediaId).filter(Boolean) : outs?.mediaId ? [outs.mediaId] : [];
      return { status: String(t?.status ?? ""), mediaIds, raw: t };
    });
    if (final.status !== "completed") throw new PixaiError("P401", `任务未完成(${final.status})`);
    if (!final.mediaIds.length) throw new PixaiError("P400", "completed 但无产物 mediaId");
    // media(id) → urls variant=PUBLIC
    const urls: string[] = [];
    for (const mid of final.mediaIds) {
      const d = await this.gql(GQL_MEDIA, { id: mid });
      const pub = (d?.media?.urls ?? []).find((u: any) => u?.variant === "PUBLIC")?.url;
      if (!pub) { warnings.push(`media ${mid} 无 PUBLIC url(审查位/过期?),跳过。`); continue; }
      const buf = await this.downloadWithRetry(pub);
      urls.push(`data:image/png;base64,${Buffer.from(buf).toString("base64")}`);
    }
    if (!urls.length) throw new PixaiError("P400", "全部产物无可用 PUBLIC url");
    return { outputs: urls.map((url) => ({ url })), raw: { provider: "pixai", channel: "graphql", model, taskId }, warnings };
  }

  /** size 解析:aspect 优先(枚举表),否则 size 像素(16 倍数 snap),否则默认 1:1。 */
  private resolveSize(req: ImageRequest, warnings: string[]): { ratio: string; w: number; h: number } {
    const aspect = req.aspect && (ASPECT_RATIOS as readonly string[]).includes(req.aspect) ? req.aspect : undefined;
    if (req.aspect && !aspect) warnings.push(`pixai 无 ${req.aspect} 比例枚举,已忽略(近似的 1k 档比例:9:16/16:9/3:4/4:3/1:1 等)。`);
    if (aspect) { const [w, h] = RATIO_1K[aspect]; return { ratio: aspect, w, h }; }
    if (req.size) {
      const m = /^(\d{3,4})x(\d{3,4})$/.exec(req.size.trim());
      if (m) {
        let w = Number(m[1]); let h = Number(m[2]);
        const sw = Math.round(w / 16) * 16; const sh = Math.round(h / 16) * 16;
        if (sw !== w || sh !== h) warnings.push(`pixai GraphQL 尺寸须 16 倍数,${w}x${h} snap → ${sw}x${sh}。`);
        w = sw; h = sh;
        const ratio = this.nearestRatio(w, h);
        return { ratio, w, h };
      }
      warnings.push(`pixai size "${req.size}" 无法解析(WxH),按默认 1024x1024。`);
    }
    return { ratio: "1:1", w: 1024, h: 1024 };
  }
  private nearestRatio(w: number, h: number): string {
    let best = "1:1"; let bestDiff = Infinity;
    for (const [r, [rw, rh]] of Object.entries(RATIO_1K)) {
      const d = Math.abs(rw / rh - w / h);
      if (d < bestDiff) { bestDiff = d; best = r; }
    }
    return best;
  }

  /** 统一轮询(终态 completed|failed|cancelled;超时上抛 P402)。 */
  private async pollUntil(taskId: string, fetch: (id: string) => Promise<{ status: string; raw: unknown } & Record<string, unknown>>): Promise<any> {
    const deadline = Date.now() + this.pollDeadlineMs;
    for (;;) {
      const t = await fetch(taskId);
      if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") {
        if (t.status === "failed") throw new PixaiError("P401", `任务失败(${JSON.stringify(t.raw).slice(0, 150)})`);
        return t;
      }
      if (Date.now() > deadline) throw new PixaiError("P402", `轮询超时(>${Math.round(this.pollDeadlineMs / 1000)}s;任务仍在 ${t.status || "未知"} 态;PixAI 任务不因查询中断,可稍后经 taskId 复查)`);
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  private downloadWithRetry(url: string): Promise<ArrayBuffer> {
    return withRetry(() => this.downloadImpl(url), { tag: "Pixai" });
  }

  private resolveModel(model: string | undefined): string {
    const m = model ?? "tsubaki2";
    if (!PIXAI_MODELS[m]) {
      // 兼容直传版本 ID
      const hit = Object.entries(PIXAI_MODELS).find(([, v]) => v.versionId === m);
      if (hit) return hit[0];
      throw new PixaiError("P300", `未知模型 "${m}"。pixai 可用:${PIXAI_MODEL_NAMES.join(", ")}(或直传版本 ID)。`);
    }
    return m;
  }
}
