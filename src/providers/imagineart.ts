/**
 * ImagineArt 渠道(渠道工厂飞轮轮 13 GO,2026-09-23)—— spawn 官方 CLI,免费日额同池。
 *
 * 调研定谳(doc/渠道工厂飞轮.md 轮 13 + imagineart CLI wire 契约报告,npm tarball 一手):
 * - **官方托管 MCP 与平台同池计费**(官方原文「billed through your existing imagine.art credits」
 *   「free tier includes 100 credits/day」「no API key」);REST API 疑似独立计费→不走;
 * - CLI `@imagineartofficial/mcp`(bin: imagine/imagineart/imagine-mcp,Node ≥20)直发是一等公民:
 *   `image/video` 命令 + `--json` 机器契约(stdout 恒 JSON,进度/错误走 stderr;exit 0 全成/1 失败或
 *   部分失败/130 取消);**CLI 内零模型校验**(model 裸透传,合法值在服务端 schema);
 * - 认证:OAuth 2.1+PKCE,`login --no-browser` 打印 URL 人工授权一次,凭据落
 *   ~/.imagine-mcp/credentials.json;env `IMAGINE_MCP_TOKEN`=不落盘正道;🔴 未登录时命令会
 *   **自动开浏览器**——provider 必须先 status 探活,不签在就 I1xx 快速失败给人工指引;
 * - `status --json` → {signedIn, tokenSource, credits{current,unit}}(内置余额查询);
 * - 双错误路:queue 期失败(含配额拒)→ exit 1 + stderr、**stdout 可能空**;wait 期失败 →
 *   results[].error;无配额专用退出码(配额尽靠 stderr 文本判别);
 * - 阻塞式出图(image 600s/video 1200s 默认;无轮询子命令);视频走伪 handle(内存 promise,
 *   gemini 先例),getVideo 等待落定;
 * - 免费层:仅 standard 模型/720p/产出公开/1 并发;**免费产出限非商用**(terms 软措辞)。
 *
 * 错误码族:[imagineart] I1xx 环境(未登录/CLI 缺失)/ I2xx spawn 传输 / I3xx 参数 / I4xx 结果。
 * 纪律:丢弃参数必告警(seed CLI 无此参→告警忽略);provider 恒单张(D1);能力声明与实现对齐。
 * requiresOptIn=true。测试:Transport stub 注入(零 spawn 零积分)。
 */
import type {
  ImageRequest, ImageResult, VideoRequest, VideoTask, VideoResult, VideoHandle,
  Modality, ProviderCapabilities, ChannelInfo, MediaProviderBase, ImageProvider, VideoProvider,
} from "./types.js";
import { spawn } from "node:child_process";
import fs from "node:fs";

/** 锁定版本(🔴 禁裸 npx 漂移;4 天 0.1.0→0.10.0 高频变更期,升级须重验契约)。 */
export const IMAGINEART_CLI_VERSION = "0.10.0";
const IMAGINEART_PKG = `@imagineartofficial/mcp@${IMAGINEART_CLI_VERSION}`;

/** 简单名(透传服务端;credits=官方价目估算,静态)。 */
export const IMAGINEART_IMAGE_MODELS: Record<string, number> = {
  "z-image-turbo": 5, "flux-dev": 5, "chatgpt-image-2": 6,
  "nano-banana-2": 24, "qwen-image": 24, "seedream-4-5": 24, "imagineart-2-0": 25,
};
export const IMAGINEART_VIDEO_MODELS: Record<string, number> = {
  "wan-2-2": 30, "seedance-1-5-pro": 72,
};

export class ImagineartError extends Error {
  readonly code: string;
  readonly precondition?: true;
  constructor(code: string, message: string, opts?: { precondition?: boolean; hint?: string }) {
    super(`[imagineart] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "ImagineartError";
    this.code = code;
    if (opts?.precondition) this.precondition = true;
  }
}

export interface CliSpawnResult { stdout: string; stderr: string; code: number; }

/** 传输层抽象(生产 = npx spawn;测试注入 stub,零 spawn 零积分)。 */
export interface ImagineartTransport {
  run(args: string[], opts?: { timeoutMs?: number }): Promise<CliSpawnResult>;
}

export class NpxCliTransport implements ImagineartTransport {
  constructor(private readonly envToken?: string) {}
  async run(args: string[], opts?: { timeoutMs?: number }): Promise<CliSpawnResult> {
    const timeoutMs = opts?.timeoutMs ?? 620_000;
    return new Promise((resolve, reject) => {
      const child = spawn("npx", ["-y", IMAGINEART_PKG, ...args], {
        windowsHide: true,
        env: {
          ...process.env,
          NO_COLOR: "1", CI: "1", IMAGINE_NO_ANIMATION: "1", // 保 stderr 干净/禁 TTY 探测
          ...(this.envToken ? { IMAGINE_MCP_TOKEN: this.envToken } : {}),
        },
      });
      let stdout = ""; let stderr = ""; let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill("SIGKILL"); reject(new ImagineartError("I201", `CLI 超时(>${Math.round(timeoutMs / 1000)}s;长阻塞出图语义,视频默认 1200s)`)); }
      }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(new ImagineartError("I200", `spawn 失败(${e.message};需 Node ≥20 与 npx)`, { precondition: true })); } });
      child.on("close", (code) => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });
  }
}

interface ImagineartStatus { signedIn?: boolean; tokenSource?: string; credits?: { current?: number; unit?: string }; workspace?: { name?: string }; error?: string; }

export interface ImagineartProviderOpts {
  /** 长效 token(env 正道,CI/headless;与 login 凭据二选一)。 */
  token?: string;
  bin?: string;
  transport?: ImagineartTransport;
  /** 测试注入缝:产物下载。 */
  downloadImpl?: (url: string) => Promise<ArrayBuffer>;
}

export class ImagineartProvider implements MediaProviderBase, ImageProvider, VideoProvider {
  readonly name = "imagineart";
  private readonly transport: ImagineartTransport;
  private readonly downloadImpl: (url: string) => Promise<ArrayBuffer>;
  /** 登录态缓存(status 探活一次/进程,避免每请求多 spawn)。 */
  private statusCache?: { at: number; st: ImagineartStatus };
  /** 视频伪 handle(gemini 先例:taskId → 阻塞 promise)。 */
  private readonly videoWaiters = new Map<string, Promise<VideoResult>>();
  private cooldownUntil = 0;
  private lastErrorAt?: string;

  constructor(opts: ImagineartProviderOpts = {}) {
    this.transport = opts.transport ?? new NpxCliTransport(opts.token);
    this.downloadImpl = opts.downloadImpl || ((u: string) => fetch(u).then((r) => {
      if (!r.ok) throw new ImagineartError("I203", `产物下载失败 HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
  }

  // ── 基础 ──
  capabilities(): ProviderCapabilities {
    return { image: { textToImage: true, imageToImage: true }, video: { textToVideo: true, imageToVideo: true, keyframes: false } };
  }
  requiresOptIn(_m: Modality): boolean { return true; }
  listModels(): string[] { return [...Object.keys(IMAGINEART_IMAGE_MODELS), ...Object.keys(IMAGINEART_VIDEO_MODELS)]; }
  listImageModels(): string[] { return [...Object.keys(IMAGINEART_IMAGE_MODELS)]; }
  listVideoModels(): string[] { return [...Object.keys(IMAGINEART_VIDEO_MODELS)]; }
  videoConstraints() {
    return { allowedNumFrames: [120, 150, 240, 300], defaultNumFrames: 120, defaultFrameRate: 24, allowedFrameRates: [24] };
  }
  supportsImageToImage(): boolean { return true; }
  /** CLI --image 接受 url 或本地路径;通用层 data:URI 会被拒在此前置(http(s) only)。 */
  acceptsImageInputRef(value: string): boolean { return /^https?:\/\//i.test(value); }
  estimateGenerationSeconds(_n: number, _f?: number): number { return 90; }
  health() {
    const st = this.statusCache?.st;
    return { configured: st?.signedIn === true, cooldown: Date.now() < this.cooldownUntil, lastErrorAt: this.lastErrorAt };
  }
  notifyUnavailable(_e: any): void { this.lastErrorAt = new Date().toISOString(); }

  channelInfo(): ChannelInfo {
    const signed = this.statusCache?.st?.signedIn === true;
    const credits = this.statusCache?.st?.credits;
    return {
      status: signed ? "live" : "blocked-on-login",
      cost: "免费 100 credits/日(官方 MCP 同池计费;z-image-turbo 5cr/张≈16-20 张/日,wan-2-2 视频 30cr/条≈3 条/日)",
      freeQuota: `每日 100 credits(24h;免费层仅 standard 模型/720p/产出公开/1 并发)${credits?.current != null ? `;当前余额 ${credits.current}${credits.unit ?? ""}` : ""}`,
      capabilities: { t2i: true, i2i: true, t2v: true, i2v: true, keyframes: false },
      limits: [
        "免费产出限非商用(terms 软措辞;商用成片需 $13/mo);产出公开(无私私生成)",
        "seed 不支持(CLI 无该参数,告警忽略);n 批量由工具层扇出(每张独立计 credits)",
        "CLI 阻塞式出图(image 默认 600s/video 1200s);视频走伪 handle 轮询",
        "模型名透传服务端校验(CLI 零本地校验);免费层仅 standard 档(Pro/Veo 不可达)",
        "疑似免费层水印(⚠️单源第三方实测,官方条款未提)",
      ],
      watermark: "疑似免费层带水印(⚠️单源;官方未明文)",
      prerequisites: [
        "一次性登录:终端跑 `npx -y @imagineartofficial/mcp@0.10.0 login --no-browser` 复制 URL 浏览器授权(OAuth 2.1;凭据落 ~/.imagine-mcp/credentials.json);或 config providers.imagineart.token 传长效 token(env 正道不落盘)",
        "Node ≥20;渠道状态/余额:status --json(provider health 已内聚)",
      ],
      risks: [
        "官方 MCP 同池计费为官方文档承诺(2026-09-23 抓取);平台高频变更期(CLI 4 天 0.1.0→0.10.0)契约可能漂移",
        "GitHub repo 已蒸发(无 issue tracker);npx 冷启动开销",
        "Vyro AI(土耳其)独立集团;免费产出非商用条款与 pixai 形成对照",
      ],
    };
  }

  /** 成本目录(credits/条 静态官方价目)。 */
  costCatalog() {
    const out: Record<string, { mode: "image" | "video"; credits?: number; unit: "per-image" | "per-clip"; source: "static" }> = {};
    for (const [m, c] of Object.entries(IMAGINEART_IMAGE_MODELS)) out[m] = { mode: "image", credits: c, unit: "per-image", source: "static" };
    for (const [m, c] of Object.entries(IMAGINEART_VIDEO_MODELS)) out[m] = { mode: "video", credits: c, unit: "per-clip", source: "static" };
    return out;
  }

  // ── 登录态探活(缓存 5min;🔴 未登录时 CLI 会自动开浏览器——先探活拦下) ──
  private async ensureSignedIn(): Promise<void> {
    const cached = this.statusCache;
    if (cached && Date.now() - cached.at < 300_000 && cached.st.signedIn) return;
    const r = await this.transport.run(["status", "--json"], { timeoutMs: 60_000 });
    let st: ImagineartStatus = {};
    try { st = JSON.parse(r.stdout) as ImagineartStatus; } catch {
      throw new ImagineartError("I202", `status 输出无法解析(exit ${r.code};stderr:${r.stderr.slice(0, 150)})`, { hint: "确认 Node ≥20;npx 可用;CLI 版本 " + IMAGINEART_CLI_VERSION });
    }
    this.statusCache = { at: Date.now(), st };
    if (!st.signedIn) {
      throw new ImagineartError("I100", "未登录(status.signedIn=false;CLI 未登录时命令会尝试开浏览器,provider 前置拦下)", {
        precondition: true,
        hint: "终端跑 `npx -y " + IMAGINEART_PKG + " login --no-browser` 复制 URL 浏览器授权一次;或 config providers.imagineart.token 配长效 token",
      });
    }
  }

  // ── 生图 ──
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    if (req.n && req.n > 1) warnings.push(`imagineart provider 恒单张(CLI -n 批量会与工具层扇出叠加成 n×n 计费);每张独立扣 credits。`);
    if (req.seed != null) warnings.push("imagineart CLI 无 seed 参数,已忽略(复现不可用)。");
    if (req.size) warnings.push(`imagineart CLI 无像素 size(用 --resolution 1K/2K/4K 档);size "${req.size}" 已忽略——用 aspect+quality 近似控制。`);
    if (req.extra && Object.keys(req.extra).length) warnings.push(`imagineart 不消费 extra(${Object.keys(req.extra).join("/")}),已忽略。`);
    if (req.images && req.images.length > 1) warnings.push("imagineart 图生图单参考图(--image),仅消费 images[0]。");
    const model = req.model ?? "z-image-turbo";
    const credits = IMAGINEART_IMAGE_MODELS[model];
    if (credits != null) warnings.push(credits <= 6 ? `${model}:≈${credits} credits/张(免费 100/日≈${Math.floor(100 / credits)} 张)。` : `${model}:≈${credits} credits/张(免费 100/日仅≈${Math.floor(100 / credits)} 张;budget 档 z-image-turbo 5cr 更省)。`);
    await this.ensureSignedIn();

    const args = ["image", req.prompt, "--json", "--timeout", "600"];
    if (model) args.push("--model", model);
    if (req.aspect) args.push("--ratio", req.aspect);
    if (req.quality) args.push("--quality", req.quality);
    if (req.images?.[0]) {
      if (!/^https?:\/\//i.test(req.images[0])) throw new ImagineartError("I302", "imagineart i2i 输入须公网 http(s) URL(CLI --image 另收本地路径,但工具层已统一 URI 化)。");
      args.push("--image", req.images[0]);
    }
    const r = await this.transport.run(args, { timeoutMs: 620_000 });
    const parsed = this.parseCliJson(r, "image");
    const out = parsed.results?.[0];
    if (out?.error) throw new ImagineartError("I400", `生成失败:${String(out.error).slice(0, 160)}`);
    const url = out?.asset?.mediaUrl;
    if (!url) throw new ImagineartError("I400", `结果无 mediaUrl:${JSON.stringify(parsed).slice(0, 200)}`);
    const buf = await this.downloadImpl(url);
    const mime = sniffMime(url);
    return { outputs: [{ url: `data:${mime};base64,${Buffer.from(buf).toString("base64")}` }], raw: { provider: "imagineart", model, credits }, warnings };
  }

  // ── 视频(阻塞 CLI → 伪 handle,gemini 先例) ──
  async createVideo(req: VideoRequest): Promise<VideoTask> {
    const warnings: string[] = [];
    if (req.seed != null) warnings.push("imagineart CLI 无 seed,已忽略。");
    if (req.keyframes?.length) throw new ImagineartError("I301", "imagineart 无首尾帧(参考图走 images/I2V 单图)。");
    if (req.videoMediaId) warnings.push("imagineart 无视频续写/编辑,videoMediaId 已忽略。");
    if (req.audioMediaIds?.length) warnings.push("imagineart 无音频参考(音乐另有 music 命令未接),已忽略。");
    if (req.durationSeconds != null && ![5, 10].includes(req.durationSeconds)) warnings.push(`imagineart 视频时长档由模型定(常见 5/10s),durationSeconds=${req.durationSeconds} 直传服务端裁定。`);
    const model = req.model ?? "wan-2-2";
    const credits = IMAGINEART_VIDEO_MODELS[model];
    if (credits != null) warnings.push(`${model}:≈${credits} credits/条(免费 100/日≈${Math.floor(100 / credits)} 条;免费层 720p 上限)。`);
    await this.ensureSignedIn();

    const args = ["video", req.prompt, "--json", "--timeout", "1200"];
    if (model) args.push("--model", model);
    if (req.ratio) args.push("--ratio", req.ratio);
    if (req.resolution) args.push("--resolution", req.resolution);
    if (req.durationSeconds != null) args.push("--duration", String(req.durationSeconds));
    if (req.image) {
      if (!/^https?:\/\//i.test(req.image) && !fs.existsSync(req.image)) throw new ImagineartError("I302", "imagineart i2v 首帧须公网 URL 或存在的本地路径。");
      args.push("--image", req.image);
    }
    const taskId = `imagineart-${Date.now().toString(36)}`;
    const p = (async (): Promise<VideoResult> => {
      const r = await this.transport.run(args, { timeoutMs: 1_220_000 });
      const parsed = this.parseCliJson(r, "video");
      const out = parsed.results?.[0];
      if (out?.error) return { status: "failed", error: String(out.error).slice(0, 200) };
      const url = out?.asset?.mediaUrl;
      if (!url) return { status: "failed", error: `结果无 mediaUrl:${JSON.stringify(parsed).slice(0, 180)}` };
      const buf = await this.downloadImpl(url);
      return { status: "completed", url: `data:video/mp4;base64,${Buffer.from(buf).toString("base64")}`, raw: { provider: "imagineart", model } };
    })().finally(() => { this.videoWaiters.delete(taskId); });
    this.videoWaiters.set(taskId, p);
    return { taskId, status: "submitted", raw: { provider: "imagineart", model, credits }, warnings };
  }

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    const id = handle.taskId ?? handle.videoId;
    const waiter = id ? this.videoWaiters.get(id) : undefined;
    if (!waiter) return { status: "failed", error: `imagineart 伪 handle 不存在或已结算(${id ?? "无 taskId"};进程内有效——重启后须重新提交)。` };
    return waiter;
  }

  /** CLI --json 解析:双错误路(queue 期失败=stdout 空+exit 1+stderr;wait 期=results[].error)。 */
  private parseCliJson(r: CliSpawnResult, cmd: string): { results?: Array<{ asset?: { mediaUrl?: string }; savedTo?: string; error?: string | null }> } {
    if (r.code === 130) throw new ImagineartError("I201", `CLI 取消(exit 130;stderr:${r.stderr.slice(0, 120)})`);
    const text = r.stdout.trim();
    if (!text) {
      // queue 期失败(含配额尽):stdout 空,stderr 是唯一线索
      const quota = /credit|quota|limit|balance/i.test(r.stderr);
      throw new ImagineartError(quota ? "I101" : "I400", `${cmd} 提交失败(exit ${r.code};stderr:${r.stderr.slice(0, 200) || "空"})${quota ? "——疑似额度/配额限制" : ""}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ImagineartError("I202", `${cmd} stdout 非 JSON(exit ${r.code};前 160 字符:${text.slice(0, 160)})`);
    }
  }
}

function sniffMime(url: string): string {
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}
