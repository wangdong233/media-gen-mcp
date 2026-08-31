/**
 * Google Flow provider —— 经本机 Chrome(lasso CDP)页面上下文驱动 labs.google/fx Flow。
 *
 * 一切契约依据 doc/flow-api-contract.md(2026-08-22 白盒逆向,重放实证;§7/§9/§10 为后续轮次 live wire 补遗)。
 * 本文件不重新探索:端点/字段/状态机全部按契约 §0-§5 + §7/§9/§10 wire 落地。
 *
 * 架构(契约 §0):一切网络调用经 CDP Runtime.evaluate 页面上下文 fetch,不裸调 API:
 *   - reCAPTCHA enterprise token 必须真实页面环境生成(grecaptcha.enterprise.execute)
 *   - 认证全自动:labs.google 同源 cookie(tRPC)+ Bearer access_token(aisandbox,现取 session)
 *   - 页面上下文无 CORS 问题(同源;aisandbox 端点允许 labs.google origin,实测 200)
 *
 * 前置检测(契约 §0,允许才用):CDP /json/version 可连 → 存在 labs.google page target →
 * session 有 access_token。检测结果缓存 TTL 30s(避免每次工具调用都探测)。
 *
 * 错误契约:所有错误统一 `[flow] S<code> <消息> Hint: <修复提示>`(对齐 [nested-diagram] S_NESTED 风格):
 *   S1xx 环境(CDP/页面/登录)| S2xx 页面 fetch 失败 | S3xx 参数/模型校验 | S4xx 媒体/下载
 *
 * 铁律(审查 03 安全约束):
 *   - 🔴 createVideo = 消耗积分的提交点(价区间经 B9 格式层从 staticTierCosts 生成:abraCreditRange()/veoCreditRange())—— 入口有显式标记
 *   - 🔴 generateImage = 零点生成(契约 §3 图片一律零消耗;价真源 = B9 格式层 FLOW_ZERO_CREDIT),仍是提交点 —— 入口有显式标记
 *   - getVideo/mediaStatus/getMediaBytes/getCredits = 零消耗只读路径(状态轮询/下载)
 *   - 渠道准入(C 任务):实现 capabilities()(能力事实)+ requiresOptIn()=true(准入策略)——
 *     未显式同意(点名 provider/model 或 <modality>ProviderPriority 列入)时,flow 永不进入
 *     任何模态的隐式 fallback 链(取代旧门禁「不实现 capabilities()」,见 types.ts 注释)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type {
  MediaProviderBase,
  ImageProvider,
  VideoProvider,
  ImageRequest,
  ImageResult,
  VideoRequest,
  VideoTask,
  VideoHandle,
  VideoResult,
  TaskStatus,
  ProviderCapabilities,
  ProviderHealth,
  Modality,
  SubmissionConfirm,
} from "./types.js";

// ── 常量(契约 §1,白盒实证值) ──

const DEFAULT_CDP_PORT = 9223;
const CDP_HOST = "127.0.0.1";
const LABS_ORIGIN = "https://labs.google";
const AISANDBOX_ORIGIN = "https://aisandbox-pa.googleapis.com";
/** 部分 aisandbox 调用的公开 API key(GET credits 用 ?key=;契约 §1 实测值)。 */
const FLOW_API_KEY = "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY";
/** reCAPTCHA enterprise(invisible)site key —— 必须在 labs.google 页面上下文 execute。 */
const RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
/**
 * reCAPTCHA action 名(2026-08-22 从页面 bundle 实证:_app/7874 chunk 的 hw('<ACTION>') 调用点)。
 * execute 必须带 action,否则上游 403 "reCAPTCHA evaluation failed"(0 点生图重放实测确认)。
 * 'IMAGE_GENERATION' / 'VIDEO_GENERATION' 均已 live 双 200 实证(契约 §7.4:i2v/t2v/r2v/interpolation/
 * extension/upsampler 全模式走 VIDEO_GENERATION);2K 图片放大同用 IMAGE_GENERATION(§10.8 live 拦截实证:
 * 经页面 patch grecaptcha.enterprise.execute + 真实 UI 2K 菜单单次触发捕获;D 轮"IMAGE_UPSAMPLING
 * 独立 action"是误判 —— 该字符串在 bundle 中仅作 OUT_OF_CREDITS 错误类目键,提交会连 403)。
 */
const RECAPTCHA_ACTION_IMAGE = "IMAGE_GENERATION";
const RECAPTCHA_ACTION_VIDEO = "VIDEO_GENERATION";
/** Flow 工具内部名(契约 §1)。 */
const TOOL_INTERNAL_NAME = "PINHOLE";
/**
 * wire 字段 clientContext.sessionId 的魔数格式:前导分号 + 毫秒时间戳 —— 外部系统约定
 * (契约 doc/flow-api-contract.md §1),非本仓库发明;命名常量防 4 处副本漂移(R-INT-08/R-CI-08)。
 */
const wireSessionId = () => `;${Date.now()}`;
/** 前置检测结果缓存 TTL:30s(硬约束:避免每次工具调用都探测 CDP)。 */
const DEFAULT_PREFLIGHT_TTL_MS = 30_000;
/** 单次页面 fetch(经 Runtime.evaluate)超时:状态/目录快;媒体下载大,单独放宽。 */
const EVAL_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
/**
 * 工具级截止默认值(2026-08-24 吸收自 flow-mcp withDeadline):flow 长操作(生图轮询内部
 * 兜底 240s / 下载 180s)有界但不满足「单次调用 ≤120s」防 stall 红线 —— 本截止在 provider
 * 边界把 generateImage/createVideo/getVideo/getMediaBytes 包进 Promise.race,超时转结构化
 * [flow] S410;底层 promise 不取消(生成可能在服务端继续,稍后经 flow_status 可达 —— 诚实降级)。
 * config 顶级 flow.toolDeadlineMs / env FLOW_TOOL_DEADLINE_MS 可调。
 */
const DEFAULT_TOOL_DEADLINE_MS = 110_000;
/**
 * 计费确认令牌默认 TTL:10 分钟(两段式往返留足阅读预估的时间;过期重取,防陈旧确认)。
 * config 顶级 flow.confirmTtlMs / env FLOW_CONFIRM_TTL_MS 可调。
 */
const DEFAULT_CONFIRM_TTL_MS = 600_000;
/**
 * 确认令牌 HMAC 密钥:🔴 安装级稳定密钥(2026-08-31,日志#15 修复)。
 * 旧实现是模块级 `crypto.randomBytes(32)`(进程随机)—— 一次性 stdio 客户端每次调用新起进程,
 * 进程 A 签发、进程 B 校验必 S320,错误文案完全不指向进程边界(产线误导排查 40 分钟)。
 * 现改为 `~/.media-gen-mcp/flow-confirm-secret`(32B,0600,不存在则创建;原子 tmp+rename),
 * 令牌跨进程可验;测试注入缝 = 实例字段 confirmSecretFile(对齐 projectFile 先例)。
 * 🔴 安全配套(密钥持久化后单次消费语义必须同步跨进程,否则令牌可跨进程重放):
 * consumedConfirmTokens 持久化到 ~/.media-gen-mcp/flow-confirm-consumed.json(原子写,读时惰性清理过期)。
 */
const FLOW_CONFIRM_SECRET_FILE = path.join(os.homedir(), ".media-gen-mcp", "flow-confirm-secret");
const FLOW_CONFIRM_CONSUMED_FILE = path.join(os.homedir(), ".media-gen-mcp", "flow-confirm-consumed.json");
const CONFIRM_TOKEN_PREFIX = "fvc1";
const FLOW_PROJECT_FILE = path.join(os.homedir(), ".media-gen-mcp", "flow-project.json");
/** 无 labs.google target 时自动开页的缺省 URL(flow-project.json 的 projectId/projectUrl 优先)。 */
const DEFAULT_FLOW_TAB_URL = `${LABS_ORIGIN}/fx/tools/flow`;
/** 401 自愈:reload 后等页面/新 session 生效的冷却(日志#13/#14:刷新页面即恢复)。 */
const HEAL_RELOAD_SETTLE_MS = 3_000;
/** S101 自愈:/json/new + 主动导航后等页面出现的冷却(重页面+代理慢,日志#5 实证可到 10s)。 */
const HEAL_NEWTAB_SETTLE_MS = 8_000;
/** S103 evaluate 瞬态超时自愈的退避(日志#7/#9:批产隐藏标签节流,重试即愈)。 */
const HEAL_EVAL_BACKOFF_MS = 8_000;
/** 本地图片输入的服务端读取上限(工具侧转 data: URI;超出结构化拒绝)。 */
export const LOCAL_IMAGE_INPUT_MAX_BYTES = 15 * 1024 * 1024;


// 拉起指引分层(2026-08-31 调研修复:hint 曾一律教 --mode visible —— 把"登录场景才需要可见"
// 泛化到所有场景,叠加 lasso 的"visible 实例不被收割+端口复用"特性,导致浏览器多次常驻可见):
// ①LAUNCH_HINT(默认,S100/S103 用):hidden 档零窗口 + --idle-ms 0 防 idle reaper,登录态在 profile 重启即恢复;
// ②LOGIN_LAUNCH_HINT(仅 S102 未登录):可见登录,且带完整收回链(登录后 chrome-hide 回静默)。
const LAUNCH_HINT =
  "启动:lasso launch-chrome --port 9223 --idle-ms 0(hidden 档零窗口;登录态在 profile,重启即恢复;--idle-ms 0 防 60s idle 收割)。仅当提示未登录(S102)时才需要 visible 档人工登录";
const LOGIN_LAUNCH_HINT =
  "Chrome 未登录 labs.google:lasso launch-chrome --port 9223 --mode visible --idle-ms 0 → 在窗口里完成 labs.google 登录 → 登录后 lasso chrome-hide 收回后台(保持静默;后续拉起均 hidden 即可)";

// ── 错误类型:所有 flow 错误统一 [flow] S<code> 前缀(项目错误前缀规范) ──

export class FlowError extends Error {
  /** S 码(S1xx 环境/S2xx 网络/S3xx 参数/S4xx 媒体),供测试与调用方机读。 */
  readonly code: string;
  /**
   * 环境前置未就绪标记(C 任务):true = 请求从未提交(CDP 不可连/无页面/未登录/reCAPTCHA 失败)。
   * isChainAdvanceable 据此让「链头为默认路由(非显式点名 flow)」的优先级链推进到下一渠道,
   * 而非把环境错误抛给用户;显式 provider=flow 仍被钉死守卫拦下(语义劫持防护)。
   */
  readonly precondition?: true;
  /**
   * HTTP 风格 status(供 http.ts isTransient/isFallbackWorthy 复用既有语义):
   * - 0 = 瞬时网络错(值得同 provider 重试)
   * - 上游真实 HTTP 状态 = 按既有 4xx/5xx 语义
   * - 不设置 = 环境未就绪/参数校验错(非瞬时,不该被重试或 fallback 掩盖)
   */
  readonly flowStatus?: number;
  /**
   * S103 子类标记:CDP evaluate 超时(瞬态,批产实测重试即愈,日志#7/#9)——
   * 供传输层自动退避一次判别(仅这一类自愈;其余 S100/S102 等环境前置仍不静默重试)。
   */
  readonly evalTimeout?: true;

  constructor(code: string, message: string, opts?: { hint?: string; flowStatus?: number; precondition?: boolean; evalTimeout?: boolean }) {
    super(`[flow] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "FlowError";
    this.code = code;
    this.flowStatus = opts?.flowStatus;
    if (opts?.precondition) this.precondition = true;
    if (opts?.evalTimeout) this.evalTimeout = true;
    if (opts?.flowStatus !== undefined) (this as any).status = opts.flowStatus;
  }
}

// ── 传输层:页面上下文 fetch(唯一网络出口) ──

export interface PageFetchArgs {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 请求体(base64;页面侧 atob → Uint8Array,避免 JSON 内嵌二进制转义问题)。 */
  bodyB64?: string;
}

export interface PageFetchResp {
  ok: boolean;
  status: number;
  contentType: string;
  bodyB64: string;
}

/**
 * Flow 传输抽象。生产实现 = CDP Runtime.evaluate;测试注入 stub(零网络零消耗)。
 * pageFetch/recaptchaToken 之外的都从这两个原语派生。
 *
 * 自愈(2026-08-31,产线日志#4/#7/#9/#13/#14):生产实现在环境层内置三类「带 warning 的单次自愈」——
 * S101 自动开页 / S103 evaluate 瞬态超时退避 / reload(401 自愈用)。自愈 note 经可选 notes 数组
 * 上浮(provider 在公共入口 drain 进结果 warnings;stub 可选实现同通道供测试断言)。
 * 纪律(03 清单「不静默重试」):每类自愈至多一次、必留痕(stderr + 结果 warnings)、
 * S100(不可连)/S102(无 token)等环境前置绝不静默重试。
 */
export interface FlowTransport {
  /**
   * 前置检测第 1/2 步:CDP 可连 + 定位 labs.google page target(失败抛 S100/S101)。
   * opts.newTabUrl = 无 target 时自动开页自愈用的 URL(生产实现消费;缺省 labs.google/fx/tools/flow)。
   */
  open(opts?: { newTabUrl?: string }): Promise<{ pageUrl: string }>;
  /** 在 labs.google 页面上下文执行 fetch(失败抛 S200/S201/S103)。 */
  pageFetch(args: PageFetchArgs, timeoutMs?: number): Promise<PageFetchResp>;
  /** 在页面上下文执行 grecaptcha.enterprise.execute(siteKey,{action}) 取 token(失败抛 S104)。 */
  recaptchaToken(siteKey: string, action: string): Promise<string>;
  /** 刷新 labs 页面(401 自愈用;CDP Page.reload 语义)。可选 —— stub 无需实现。 */
  reload?(): Promise<void>;
  /** 自愈 note 通道(可选):provider 在公共入口 drain 到结果 warnings。 */
  notes?: string[];
}

/** 传输/provider 共用:推一条自愈 note(stderr 永远留痕 + 结果 warnings 上浮通道)。 */
function pushHealNote(transport: FlowTransport | null, note: string): void {
  console.error(`[flow] ${note}`);
  const notes = (transport as any)?.notes;
  if (Array.isArray(notes)) notes.push(note);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** JSON 字面量安全内嵌 JS 源码(U+2028/2029 在 JS 字符串里合法但 JSON.parse 页面侧无碍,预防性转义)。 */
function jsonLiteral(v: unknown): string {
  return JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * 页面上下文 fetch 表达式(Runtime.evaluate + awaitPromise + returnByValue)。
 * 返回值形状恒定:{__flowFetch:{ok,status,contentType,bodyB64}} 或 {__flowFetchError},
 * 把页面侧异常变成数据回来(而非 CDP protocol exception),错误信息更完整。
 * bodyB64 = btoa(二进制串) —— 大文件(视频 mp4)分块累积后整体 btoa(实测 2.3MB 正常)。
 */
const FETCH_EXPR = (a: PageFetchArgs) =>
  `(async()=>{const a=${jsonLiteral(a)};try{const init={method:a.method,headers:a.headers};` +
  `if(a.bodyB64!=null){const bin=atob(a.bodyB64);const bytes=new Uint8Array(bin.length);` +
  `for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);init.body=bytes;}` +
  `const r=await fetch(a.url,init);const buf=await r.arrayBuffer();let bin="";const u8=new Uint8Array(buf);` +
  `for(let i=0;i<u8.length;i+=0x8000)bin+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));` +
  `return{__flowFetch:{ok:r.ok,status:r.status,contentType:r.headers.get("content-type")||"",bodyB64:btoa(bin)}}` +
  `}catch(e){return{__flowFetchError:String(e&&e.message||e)};}})()`;

const RECAPTCHA_EXPR = (siteKey: string, action: string) =>
  `(async()=>{try{if(typeof grecaptcha!=="object"||!grecaptcha.enterprise){return{__rcErr:"grecaptcha.enterprise 未加载"}}` +
  `const t=await grecaptcha.enterprise.execute(${jsonLiteral(siteKey)},{action:${jsonLiteral(action)}});return{__rcTok:t};}catch(e){return{__rcErr:String(e&&e.message||e)};}})()`;

/** CDP WebSocket 客户端:懒连接 + 消息路由 + 超时;连接断开自动失效,下次调用重连。 */
class CdpConnection {
  private ws: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** 页面导航/关闭导致 WS 断开时,把存活页 URL 记下来供 S103 诊断。 */
  lastCloseReason = "";

  constructor(private readonly wsUrl: string) {}

  private connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      const onOpenTimeout = setTimeout(() => {
        if (!settled) { settled = true; ws.terminate(); reject(new FlowError("S103", "CDP WebSocket 连接超时")); }
      }, 10_000);
      ws.once("open", () => {
        if (settled) return;
        settled = true; clearTimeout(onOpenTimeout);
        this.ws = ws; resolve();
      });
      ws.once("error", (e: Error) => {
        if (settled) return;
        settled = true; clearTimeout(onOpenTimeout);
        reject(new FlowError("S103", `CDP WebSocket 错误: ${e.message}`, { hint: LAUNCH_HINT }));
      });
      ws.once("close", () => {
        this.lastCloseReason = this.lastCloseReason || "closed";
        this.ws = null;
        for (const [, p] of this.pending) p.reject(new FlowError("S103", "CDP 连接已断开(页面可能被导航/关闭)", { hint: LAUNCH_HINT, flowStatus: 0 }));
        this.pending.clear();
      });
      ws.on("message", (raw: WebSocket.RawData) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m?.id != null && this.pending.has(m.id)) {
            const p = this.pending.get(m.id)!;
            this.pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message ?? "CDP error"));
            else p.resolve(m.result);
          }
        } catch { /* 非 JSON 帧忽略 */ }
      });
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  /** 原始 CDP 命令(带超时;evaluate/Page.navigate 共用 pending 路由)。 */
  private async send(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    await this.connect();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new FlowError("S103", `CDP ${method} 超时(>${Math.round(timeoutMs / 1000)}s)`, { flowStatus: 0, ...(method === "Runtime.evaluate" ? { evalTimeout: true } : {}) }));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.ws!.send(JSON.stringify({ id, method, params }));
      } catch (e: any) {
        clearTimeout(timer); this.pending.delete(id);
        reject(new FlowError("S103", `CDP 发送失败: ${e?.message ?? e}`, { flowStatus: 0 }));
      }
    });
  }

  async evaluate(expression: string, timeoutMs: number): Promise<unknown> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    return r;
  }

  /** 导航当前页面(Page.navigate 命令响应在导航发起即返回,不受上下文销毁影响)。 */
  navigate(url: string, timeoutMs = 15_000): Promise<void> {
    return this.send("Page.navigate", { url }, timeoutMs).then(() => undefined);
  }

  /** 重载当前页面(Page.reload;命令 ack 不依赖 JS 上下文存活,401 自愈用)。 */
  reloadPage(timeoutMs = 15_000): Promise<void> {
    return this.send("Page.reload", {}, timeoutMs).then(() => undefined);
  }

  /** 立即断开(自愈临时连接用 —— WS 句柄是事件循环引用,不断开会挂住进程;主连接不调用)。 */
  dispose(): void {
    const ws = this.ws;
    this.ws = null;
    this.pending.clear();
    if (ws) { try { ws.terminate(); } catch { /* 已断开 */ } }
  }

}

/** 生产传输:CDP /json/version 探活 + /json/list 定位 labs.google page target + Runtime.evaluate。 */
export class CdpFlowTransport implements FlowTransport {
  private conn: CdpConnection | null = null;
  private pageUrl = "";
  /** 自愈 note 通道(provider 公共入口 drain 进结果 warnings;stderr 在 push 时已留痕)。 */
  readonly notes: string[] = [];
  /** 自愈时序(实例字段 = 测试注入缝调短;生产用模块常量默认 8s/3s/8s)。 */
  healNewTabSettleMs = HEAL_NEWTAB_SETTLE_MS;
  healEvalBackoffMs = HEAL_EVAL_BACKOFF_MS;
  healReloadSettleMs = HEAL_RELOAD_SETTLE_MS;

  constructor(private readonly port: number = DEFAULT_CDP_PORT) {}

  /** /json/list 探测(S100:CDP 不可连)。 */
  private async listTargets(): Promise<Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>> {
    try {
      const res = await fetch(`http://${CDP_HOST}:${this.port}/json/list`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as any;
    } catch (e: any) {
      throw new FlowError("S100", `CDP ${CDP_HOST}:${this.port} 不可连(${e?.message ?? e})`, { hint: LAUNCH_HINT, precondition: true });
    }
  }

  /** 从 labs.google page targets 里选 WS 连接对象(优先 Flow 项目页;否则任一 labs 页)。 */
  private attachLabsPage(pages: Array<{ url: string; webSocketDebuggerUrl?: string }>): { pageUrl: string } {
    const page = pages.find((t) => t.url.includes("/tools/flow")) ?? pages[0];
    if (!page.webSocketDebuggerUrl) {
      throw new FlowError("S103", "page target 无 webSocketDebuggerUrl(页面可能正在关闭)");
    }
    this.pageUrl = page.url;
    this.conn = new CdpConnection(page.webSocketDebuggerUrl);
    return { pageUrl: this.pageUrl };
  }

  /**
   * 自动开页自愈(日志#4):PUT /json/new?<flow 项目页 URL> 开 tab。
   * 🔴 本机 Chrome 实证 /json/new 的 url 参数不落地导航(tab 停 about:blank)—— 开出 tab 后
   * 主动经其 webSocketDebuggerUrl 发 Page.navigate 到目标 URL,再由 open() 复探确认。
   */
  private async openLabsTab(url: string): Promise<void> {
    const res = await fetch(`http://${CDP_HOST}:${this.port}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tab = (await res.json()) as any;
    const wsUrl = tab?.webSocketDebuggerUrl;
    if (typeof wsUrl !== "string" || !wsUrl) throw new Error("新 tab 无 webSocketDebuggerUrl");
    const tmp = new CdpConnection(wsUrl);
    try {
      await tmp.navigate(url);
    } finally {
      tmp.dispose(); // 导航已发起,临时连接立即断开(WS 是事件循环引用)
    }
  }

  /** 前置检测 1/2:CDP 可连 + labs.google page target 存在(无 target 时自动开页自愈一次,日志#4)。 */
  async open(opts: { newTabUrl?: string } = {}): Promise<{ pageUrl: string }> {
    if (this.conn) return { pageUrl: this.pageUrl };
    const targets = await this.listTargets(); // S100
    const labsPages = (list: typeof targets) => list.filter((t) => t.type === "page" && t.url.startsWith(`${LABS_ORIGIN}/`));
    let pages = labsPages(targets);
    if (!pages.length) {
      // 自愈(日志#4,带 warning):自动开 Flow 项目页 → 等页面出现 → 复探一次;仍无 → 原错误(hint 不变)
      const tabUrl = opts.newTabUrl ?? DEFAULT_FLOW_TAB_URL;
      pushHealNote(this, `无 labs.google 页面 target,已自动开新标签页 ${tabUrl} 并等待其就绪(自愈重试一次)`);
      try {
        await this.openLabsTab(tabUrl);
      } catch { /* 开页自愈失败 → 复探后仍走原 S101 */ }
      await sleep(this.healNewTabSettleMs);
      const retryTargets = await this.listTargets(); // S100(不可连场景原样抛)
      pages = labsPages(retryTargets);
      if (!pages.length) {
        throw new FlowError("S101", `CDP 可连但无 labs.google page target(现有 page:${retryTargets.filter(t => t.type === "page").map(t => t.url.slice(0, 60)).join(" | ") || "无"};已尝试自动开页未果)`, {
          hint: `在 Chrome 打开 https://labs.google/fx/tools/flow 的任意 Flow 项目页(当前项目页 https://labs.google/fx/zh/tools/flow/project/c36ca3e2-192b-41e5-9e5b-700130e3d324)`,
          precondition: true,
        });
      }
    }
    return this.attachLabsPage(pages);
  }

  /** 单次 evaluate(无重试)。 */
  private async evalOnce(expr: string, timeoutMs: number): Promise<unknown> {
    if (!this.conn) throw new FlowError("S103", "CDP 未连接(先 open())");
    let r: any;
    try {
      r = await this.conn.evaluate(expr, timeoutMs);
    } catch (e) {
      if (e instanceof FlowError) throw e;
      // evaluate 协议层异常(表达式语法/页面上下文销毁)
      this.conn = null;
      throw new FlowError("S103", `CDP evaluate 失败: ${(e as Error)?.message ?? e}`, { hint: LAUNCH_HINT, flowStatus: 0 });
    }
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      this.conn = null;
      throw new FlowError("S103", `页面执行异常: ${String(d.exception?.description ?? d.text).slice(0, 300)}`, { hint: "页面可能已被导航/关闭;重开 Flow 项目页后重试", flowStatus: 0 });
    }
    return r?.result?.value;
  }

  private async eval(expr: string, timeoutMs: number): Promise<unknown> {
    try {
      return await this.evalOnce(expr, timeoutMs);
    } catch (e) {
      // 自愈(日志#7/#9,带 warning):仅「evaluate 超时」这一类瞬态(隐藏标签节流/页面忙,批产实测
      // 重试即愈)自动退避重试一次;其余 S103(WS 断开/页面异常)与环境前置(S100/S102)绝不静默重试
      // (03 清单「不静默重试」纪律:自愈必须带 warning 且限一次)。退避+重试计入外层 toolDeadline。
      if (!(e instanceof FlowError) || !e.evalTimeout) throw e;
      pushHealNote(this, `CDP 瞬态超时已自动退避 ${Math.round(this.healEvalBackoffMs / 1000)}s 重试一次(${(e as Error).message.replace(/^\[flow\] S103 /, "")})`);
      await sleep(this.healEvalBackoffMs);
      return await this.evalOnce(expr, timeoutMs);
    }
  }

  /** 刷新 labs 页面(401 自愈:access_token ~1h 陈旧,reload 即恢复,无需重登 —— 日志#13/#14)。 */
  async reload(): Promise<void> {
    if (!this.conn) throw new FlowError("S103", "CDP 未连接(先 open())");
    await this.conn.reloadPage();
  }

  async pageFetch(args: PageFetchArgs, timeoutMs = EVAL_TIMEOUT_MS): Promise<PageFetchResp> {
    const v = await this.eval(FETCH_EXPR(args), timeoutMs);
    if (!v || typeof v !== "object") throw new FlowError("S103", "页面 fetch 返回空(evaluate 结果丢失)", { flowStatus: 0 });
    if ((v as any).__flowFetchError) {
      throw new FlowError("S200", `页面 fetch 异常: ${String((v as any).__flowFetchError).slice(0, 200)}(url: ${args.url.slice(0, 120)})`, { flowStatus: 0 });
    }
    const f = (v as any).__flowFetch;
    if (!f || typeof f.bodyB64 !== "string") throw new FlowError("S103", "页面 fetch 返回形状异常(无 __flowFetch)", { flowStatus: 0 });
    return { ok: !!f.ok, status: f.status, contentType: String(f.contentType ?? ""), bodyB64: f.bodyB64 };
  }

  async recaptchaToken(siteKey: string, action: string): Promise<string> {
    const v = (await this.eval(RECAPTCHA_EXPR(siteKey, action), 30_000)) as any;
    if (v?.__rcErr) throw new FlowError("S104", `reCAPTCHA token 获取失败: ${String(v.__rcErr).slice(0, 200)}`, { hint: "确认停留在 labs.google Flow 页面(enterprise 脚本由页面加载)", precondition: true });
    if (!v?.__rcTok || typeof v.__rcTok !== "string") throw new FlowError("S104", "reCAPTCHA token 为空", { precondition: true });
    return v.__rcTok;
  }
}

// ── 模型目录(契约 §3 + 2026-08-22 projectInitialData 实测快照,全部 usage key 逐字核对) ──

// 真实 wire 枚举名(2026-08-22 实测纠偏:live bundle 逐字为 PORTRAIT_THREE_FOUR / LANDSCAPE_FOUR_THREE,
// 缩写形式 PORTRAIT_3_4 / LANDSCAPE_4_3 会被上游 400 "Invalid value at image_aspect_ratio" 拒收)
const IMAGE_ASPECTS = ["SQUARE", "PORTRAIT", "LANDSCAPE", "PORTRAIT_THREE_FOUR", "LANDSCAPE_FOUR_THREE"] as const;
export type FlowImageAspect = (typeof IMAGE_ASPECTS)[number];

/** 生图模型 key(契约 §3:一律零消耗;价真源 = B9 格式层 FLOW_ZERO_CREDIT)。 */
export const FLOW_IMAGE_MODELS: string[] = [
  "GEM_PIX_2", // Nano Banana Pro(10 refs)
  "NARWHAL", // Nano Banana 2(默认)
  "HARBOR_SEAL", // Nano Banana 2 Lite
  "GEM_PIX_2_UPSAMPLE_2K", // 2K 放大(零消耗)
];

/** 生视频模型 usage key(实测快照;动态目录可经 flowStatus() 获取最新值)。 */
function buildVideoModelCatalog(): string[] {
  const abra = ["abra_edit"];
  for (const mode of ["t2v", "r2v", "i2v"]) for (const d of [4, 6, 8, 10]) abra.push(`abra_${mode}_${d}s`);
  const lite = [
    "veo_3_1_t2v_lite", "veo_3_1_i2v_lite", "veo_3_1_r2v_lite", "veo_3_1_interpolation_lite", "veo_3_1_extension_lite",
    "veo_3_1_t2v_lite_4s", "veo_3_1_t2v_lite_6s", "veo_3_1_i2v_s_lite_4s", "veo_3_1_i2v_s_lite_6s",
    "veo_3_1_i2v_s_lite_4s_fl", "veo_3_1_i2v_s_lite_6s_fl",
  ];
  const fast = [
    "veo_3_1_t2v_fast", "veo_3_1_t2v_fast_ultra", "veo_3_1_t2v_fast_portrait", "veo_3_1_t2v_fast_portrait_ultra",
    "veo_3_1_r2v_fast_landscape", "veo_3_1_r2v_fast_landscape_ultra", "veo_3_1_r2v_fast_portrait", "veo_3_1_r2v_fast_portrait_ultra",
    "veo_3_1_i2v_s_fast", "veo_3_1_i2v_s_fast_ultra", "veo_3_1_i2v_s_fast_portrait", "veo_3_1_i2v_s_fast_portrait_ultra",
    "veo_3_1_i2v_s_fast_fl", "veo_3_1_i2v_s_fast_ultra_fl", "veo_3_1_i2v_s_fast_portrait_fl", "veo_3_1_i2v_s_fast_portrait_ultra_fl",
    "veo_3_1_extend_fast_landscape", "veo_3_1_extend_fast_landscape_ultra", "veo_3_1_extend_fast_portrait", "veo_3_1_extend_fast_portrait_ultra",
    "veo_3_1_t2v_fast_4s", "veo_3_1_i2v_s_fast_4s", "veo_3_1_i2v_s_fast_4s_fl",
    "veo_3_1_t2v_fast_6s", "veo_3_1_i2v_s_fast_6s", "veo_3_1_i2v_s_fast_6s_fl",
  ];
  const quality = [
    "veo_3_1_t2v", "veo_3_1_t2v_portrait", "veo_3_1_i2v_s", "veo_3_1_i2v_s_portrait",
    "veo_3_1_i2v_s_fl", "veo_3_1_i2v_s_portrait_fl", "veo_3_1_extend_landscape", "veo_3_1_extend_portrait",
    "veo_3_1_t2v_quality_4s", "veo_3_1_i2v_s_quality_4s", "veo_3_1_i2v_s_quality_4s_fl",
    "veo_3_1_t2v_quality_6s", "veo_3_1_i2v_s_quality_6s", "veo_3_1_i2v_s_quality_6s_fl",
  ];
  const upsamplers = ["veo_3_1_upsampler_1080p", "veo_3_1_upsampler_4k"];
  return [...abra, ...lite, ...lite.map((k) => `${k}_low_priority`), ...fast, ...quality, ...upsamplers];
}

export const FLOW_VIDEO_MODELS: string[] = buildVideoModelCatalog();
/** 视频 duration 合法集(秒;usage key 后缀)。 */
export const FLOW_VIDEO_DURATIONS = [4, 6, 8, 10] as const;
/** 通用工具层 numFrames 语义(24fps)↔ Flow duration(秒)换算。 */
export const FLOW_FRAME_RATE = 24;

/**
 * 估算一条视频的积分消耗(契约 §3 表;仅用于提交前 warning,非计费真值)。
 * 🔴 tier 盲:此函数不区分 SERVICE_TIER —— 2026-08-27 live 快照(契约 §14.4)证明多家族 per-tier 价差
 * 真实存在(lite ADVANCED=5/其余 10;fast ultra/_4s/_6s 仅 ADVANCED=10;low_priority 仅 ADVANCED=0;
 * plain fast 在 ADVANCED 反而 UNAVAILABLE)。tier 已知时一律优先 staticTierCosts(key)[tier]
 * (动态目录 creditMapping 最先,见 lookupVideoCost);本函数仅作「tier 不可得」的最后兜底。
 */
export function estimateVideoCredits(key: string): number | undefined {
  // abra t2v/i2v/r2v 同按时长 7/10/12/15 计(契约 §3;修"i2v/r2v 恒 15"的 4s 高估一倍)
  const abra = /^abra_(?:t2v|i2v|r2v)_(\d+)s$/.exec(key);
  if (abra) {
    const d = Number(abra[1]);
    return d <= 4 ? 7 : d <= 6 ? 10 : d <= 8 ? 12 : 15;
  }
  if (key === "abra_edit") return 20;
  if (key.includes("_lite")) return 10;
  if (key.includes("_fast")) return 20;
  if (key === "veo_3_1_upsampler_1080p") return 0;
  if (key.startsWith("veo_3_1_")) return 100; // quality 档(t2v/i2v_s/extend 及 _quality_ 变体)
  return undefined;
}

// ── per-tier 价矩阵(契约 §14.4,2026-08-27 live projectInitialData 快照蒸馏;77 usage 全量核对) ──

export type FlowServiceTier = "SERVICE_TIER_ENTRY" | "SERVICE_TIER_INTERMEDIATE" | "SERVICE_TIER_ADVANCED";
/** 单 tier 价:number = 积分;"UNAVAILABLE" = 该 key 在此会员档不可用(目录 creditMapping 原文)。 */
export type FlowTierCost = number | "UNAVAILABLE";

const UNAV: FlowTierCost = "UNAVAILABLE";

/**
 * 静态 per-tier 价矩阵(D-4 双向修正):不止「本 tier UNAVAILABLE 误报成价」一个方向 ——
 * fast_ultra/_4s/_6s 静态估 20 真值 ADVANCED-only 10(INTERMEDIATE 用户反向踩坑)、
 * lite 静态估 10 真值 ADVANCED 5、low_priority 静态估 10 真值 ADVANCED 0、
 * plain fast 在 ADVANCED 是 UNAVAILABLE(静态估 20)。来源:/tmp/flow-survey/flat-usages.json
 * 77 usage 全量(2026-08-27 快照;动态目录 creditByKey 优先,本表是无 CDP 时的兜底)。
 * 纯函数(导出供单测白盒)。返回 undefined = 未知家族(交给上游/动态目录)。
 */
export function staticTierCosts(key: string): Partial<Record<FlowServiceTier, FlowTierCost>> | undefined {
  const abra = /^abra_(t2v|i2v|r2v)_(\d+)s$/.exec(key);
  if (abra) {
    const d = Number(abra[2]);
    const c = d <= 4 ? 7 : d <= 6 ? 10 : d <= 8 ? 12 : 15;
    return { SERVICE_TIER_ADVANCED: c, SERVICE_TIER_INTERMEDIATE: c, SERVICE_TIER_ENTRY: c };
  }
  if (key === "abra_edit") return { SERVICE_TIER_ADVANCED: 20, SERVICE_TIER_INTERMEDIATE: 20, SERVICE_TIER_ENTRY: 20 };
  if (!key.startsWith("veo_3_1_")) return undefined;
  if (key.endsWith("_low_priority")) return { SERVICE_TIER_ADVANCED: 0, SERVICE_TIER_INTERMEDIATE: UNAV, SERVICE_TIER_ENTRY: UNAV };
  if (key === "veo_3_1_upsampler_1080p") return { SERVICE_TIER_ADVANCED: 0, SERVICE_TIER_INTERMEDIATE: 0, SERVICE_TIER_ENTRY: UNAV };
  if (key === "veo_3_1_upsampler_4k") return { SERVICE_TIER_ADVANCED: 50, SERVICE_TIER_INTERMEDIATE: UNAV, SERVICE_TIER_ENTRY: UNAV };
  const advOnly = (c: number) => ({ SERVICE_TIER_ADVANCED: c, SERVICE_TIER_INTERMEDIATE: UNAV, SERVICE_TIER_ENTRY: UNAV });
  // 变体后缀族(§14.4;ultra 可与 portrait/landscape 叠加,须按包含判断而非紧邻):
  //   _lite_4s/_lite_6s(含 _fl)→ ADVANCED-only 5;_quality_4s/_quality_6s → ADVANCED-only 100;
  //   fast 家族的 _ultra/_fast_4s/_fast_6s → ADVANCED-only 10(静态盲估 20 是错的)
  if (/_(lite|quality)_(4|6)s($|_)/.test(key)) return advOnly(key.includes("_quality") ? 100 : 5);
  if (key.includes("_fast") && (key.includes("_ultra") || /_fast_(4|6)s($|_)/.test(key))) return advOnly(10);
  // plain lite(t2v/i2v/r2v/interpolation/extension):ADVANCED 5 / 其余 10(per-tier 价差实证)
  if (key.includes("_lite")) return { SERVICE_TIER_ADVANCED: 5, SERVICE_TIER_INTERMEDIATE: 10, SERVICE_TIER_ENTRY: 10 };
  // plain fast:INTERMEDIATE/ENTRY 20,ADVANCED 反 UNAVAILABLE(§14.4)
  if (key.includes("_fast")) return { SERVICE_TIER_ADVANCED: UNAV, SERVICE_TIER_INTERMEDIATE: 20, SERVICE_TIER_ENTRY: 20 };
  // plain quality(t2v/i2v_s/extend 无变体后缀):全 tier 100
  return { SERVICE_TIER_ADVANCED: 100, SERVICE_TIER_INTERMEDIATE: 100, SERVICE_TIER_ENTRY: 100 };
}

/** 把 tier 价矩阵压缩成人类可读串(S303 门禁消息/flow_status 标注用)。 */
export function formatTierMatrix(m: Record<string, any> | Partial<Record<FlowServiceTier, FlowTierCost>> | undefined): string {
  if (!m) return "";
  const parts: string[] = [];
  for (const t of ["SERVICE_TIER_ADVANCED", "SERVICE_TIER_INTERMEDIATE", "SERVICE_TIER_ENTRY"] as FlowServiceTier[]) {
    if (!(t in (m as object))) continue;
    const v = (m as any)[t];
    const raw = v && typeof v === "object" && "cost" in v ? v.cost : v; // 兼容动态 creditMapping 条目
    parts.push(`${t.replace("SERVICE_TIER_", "")}=${raw === "UNAVAILABLE" ? "UNAVAILABLE" : raw}`);
  }
  return parts.join(" / ");
}

// ── B9 积分价文案单源格式层(薄层):hint/描述/错误文案里的积分数字一律经本层从 staticTierCosts 生成,禁手写 ──

/** 非视频生成路径统一零消耗(契约 §3:生图/图片放大/上传/预设语音/只读管理)——文案里「0 点/0 credits」的唯一真源。 */
export const FLOW_ZERO_CREDIT = 0;

/** 文案默认档:INTERMEDIATE(当前登录档;ADVANCED 价差在文案里单独标注,见 videoCostTableHintZh)。 */
const DOC_TIER: FlowServiceTier = "SERVICE_TIER_INTERMEDIATE";
/** veo 三 plain 生成分支代表 key(文案「lite/fast/quality」价的取数口;不含 upsampler/low_priority 等零价特殊键)。 */
const VEO_PLAIN_KEYS = { lite: "veo_3_1_t2v_lite", fast: "veo_3_1_t2v_fast", quality: "veo_3_1_t2v" } as const;

/**
 * key 在指定 tier 的积分价文案数字(staticTierCosts 在文案层的唯一取数口)。
 * 数字 → 十进制串;"UNAVAILABLE" 原样;未知 key → "?"(哨兵:生成文案出现 "?" = key 手误,单测断言全部文案无 "?")。
 */
export function flowTierCost(key: string, tier: FlowServiceTier = DOC_TIER): string {
  const v = staticTierCosts(key)?.[tier];
  return v === undefined ? "?" : String(v);
}

/** 单 key 价短语(英文,工具 schema 描述用):如 "20 credits"。 */
export function flowCreditsEn(key: string): string {
  return `${flowTierCost(key)} credits`;
}

/** 单 key 价短语(中文,hint/错误文案用):如 "20 点"。 */
export function flowCreditsZh(key: string): string {
  return `${flowTierCost(key)} 点`;
}

/** keys ×(可选指定档)的全部数字价并集(UNAVAILABLE 排除;区间推导用)。 */
function numericTierCosts(keys: string[], tier?: FlowServiceTier): number[] {
  const out: number[] = [];
  for (const k of keys) {
    const m = staticTierCosts(k);
    if (!m) continue;
    for (const t of tier ? [tier] : (Object.keys(m) as FlowServiceTier[])) {
      const v = m[t];
      if (typeof v === "number") out.push(v);
    }
  }
  return out;
}

function creditRange(nums: number[]): string {
  return `${Math.min(...nums)}-${Math.max(...nums)}`;
}

/** abra 全家族价区间文案("7-20":t2v/i2v/r2v 时长梯 + abra_edit,全 tier 价并集)。 */
export function abraCreditRange(): string {
  return creditRange(numericTierCosts(FLOW_VIDEO_MODELS.filter((k) => /^abra_(t2v|i2v|r2v)_\d+s$/.test(k) || k === "abra_edit")));
}

/** abra 生成分支价区间文案("7-15":仅 t2v/i2v/r2v 时长梯,不含 edit;按 duration 计价的模式描述用)。 */
export function abraGenCreditRange(): string {
  return creditRange(numericTierCosts(FLOW_VIDEO_MODELS.filter((k) => /^abra_(t2v|i2v|r2v)_\d+s$/.test(k))));
}

/** veo 生成分支价区间文案("10-100":三 plain 分支默认档价并集)。 */
export function veoCreditRange(): string {
  return creditRange(numericTierCosts(Object.values(VEO_PLAIN_KEYS), DOC_TIER));
}

/** veo 三 plain 分支默认档价列表串(「lite 10 / fast 20 / quality 100」;sep 按中英场景自选)。 */
export function veoPlainCostsList(sep = " / "): string {
  return (Object.keys(VEO_PLAIN_KEYS) as Array<keyof typeof VEO_PLAIN_KEYS>).map((f) => `${f} ${flowTierCost(VEO_PLAIN_KEYS[f])}`).join(sep);
}

/** 提交前消耗表 hint(S300 无 model 时挂载)—— 每个数字取自 staticTierCosts,改真源即随变。 */
export function videoCostTableHintZh(): string {
  const ADV: FlowServiceTier = "SERVICE_TIER_ADVANCED";
  const ladder = FLOW_VIDEO_DURATIONS.map((d) => flowTierCost(`abra_t2v_${d}s`)).join("/");
  return `消耗表(tier 盲估算;per-tier 真值见 flow_status):abra t2v/i2v/r2v ${FLOW_VIDEO_DURATIONS.join("/")}s=${ladder} 点,abra_edit=${flowTierCost("abra_edit")},veo lite=${flowTierCost(VEO_PLAIN_KEYS.lite)}(ADVANCED 档 ${flowTierCost(VEO_PLAIN_KEYS.lite, ADV)}),veo fast=${flowTierCost(VEO_PLAIN_KEYS.fast)}(ADVANCED 档 ${flowTierCost(VEO_PLAIN_KEYS.fast, ADV)}),veo quality=${flowTierCost(VEO_PLAIN_KEYS.quality)},fast 的 ultra/_4s/_6s 变体=ADVANCED 档专属 ${flowTierCost("veo_3_1_t2v_fast_ultra", ADV)},low_priority=ADVANCED 档 ${flowTierCost("veo_3_1_t2v_lite_low_priority", ADV)},veo_3_1_upsampler_1080p=${flowTierCost("veo_3_1_upsampler_1080p")}`;
}

/** flow_status 快照 hint 的计价首句 —— 每个数字取自 staticTierCosts,改真源即随变。 */
export function flowSnapshotCostHintZh(): string {
  const ADV: FlowServiceTier = "SERVICE_TIER_ADVANCED";
  return `提交视频消耗积分(tier 盲估算:abra t2v/i2v/r2v ${abraGenCreditRange()}/abra_edit ${flowTierCost("abra_edit")}/veo ${veoPlainCostsList("/")} 每条;upsampler_1080p ${flowTierCost("veo_3_1_upsampler_1080p")} 点;🔴 per-tier 真值见各 key creditMapping —— lite ADVANCED=${flowTierCost(VEO_PLAIN_KEYS.lite, ADV)}、fast ultra/_4s/_6s 仅 ADVANCED=${flowTierCost("veo_3_1_t2v_fast_ultra", ADV)}、plain fast 在 ADVANCED ${flowTierCost(VEO_PLAIN_KEYS.fast, ADV)}、low_priority 仅 ADVANCED=${flowTierCost("veo_3_1_t2v_lite_low_priority", ADV)})`;
}

/**
 * r2v 模式输入上限(契约 §14.1,2026-08-27 live 快照 inputSpec/maxImageInputs):
 * abra_r2v_{4,6,8,10}s = 参考图 7 / 音频 5;veo r2v 家族(lite/fast±ultra/low_priority)= 3 / 1。
 * 动态目录 usage.inputSpec.maxAudioReferences + usage.maxImageInputs 优先(见 cacheDynamicCatalog),
 * 本表是无 CDP/目录未缓存时的兜底;返回 undefined = 非 r2v key(不适用)。
 * 纯函数(导出供单测白盒)。
 */
export function staticR2vCaps(key: string): { images: number; audio: number } | undefined {
  if (/^abra_r2v_\d+s$/.test(key)) return { images: 7, audio: 5 };
  if (/^veo_3_1_.*r2v/.test(key)) return { images: 3, audio: 1 };
  return undefined;
}

/** 图片比例直传枚举(UI 语义;映射到 Flow IMAGE_ASPECT_RATIO_*)。 */
export const FLOW_IMAGE_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "3:4", "4:3"] as const;
const ASPECT_TO_ENUM: Record<string, FlowImageAspect> = {
  "16:9": "LANDSCAPE",
  "9:16": "PORTRAIT",
  "1:1": "SQUARE",
  "3:4": "PORTRAIT_THREE_FOUR",
  "4:3": "LANDSCAPE_FOUR_THREE",
};

/** aspect("16:9" 等 UI 语义)→ Flow 图像比例枚举;非法值 → S301(列合法值)。导出供单测。 */
export function aspectRatioToImageAspect(aspect: string): FlowImageAspect {
  const mapped = ASPECT_TO_ENUM[String(aspect ?? "").trim()];
  if (!mapped) {
    throw new FlowError("S301", `aspect 非法:"${aspect}"(合法:${FLOW_IMAGE_ASPECT_RATIOS.join(" / ")})`);
  }
  return mapped;
}

// ── 视频 v2 wire(契约 §7.3 + §9.1/§9.2/§9.3,2026-08-23 live/404 探针实证):每模式独立端点 + requests[]/videoModelKey ──

/** 模式 → 端点 apiPathname(契约 §7.3/§9 端点表;i2v/首尾帧/r2v/extension/upsampler 形状均经 404 探针或 live 200 验证;edit 见 §11.1)。 */
export const VIDEO_API_ENDPOINTS: Readonly<Record<string, string>> = {
  t2v: "batchAsyncGenerateVideoText",
  i2v: "batchAsyncGenerateVideoStartImage",
  interpolation: "batchAsyncGenerateVideoStartAndEndImage",
  r2v: "batchAsyncGenerateVideoReferenceImages",
  extension: "batchAsyncGenerateVideoExtendVideo",
  edit: "batchAsyncGenerateVideoEditVideo",
  upsampler: "batchAsyncGenerateVideoUpsampleVideo",
};

/**
 * v2 已开放提交的模式:
 * t2v/i2v/interpolation/r2v/extension/upsampler_1080p 全部 live 提交验证(§7/§9/§10);
 * edit(E 轮 parity 放行):wire 经 bundle Zod + 假 key 404 探针双定型(§11.1,形状全过、零调度),
 * 但**真实付费提交未做**(abra_edit,价见 staticTierCosts,待用户授权)→ 提交响应固定带警示。
 */
export const OPEN_VIDEO_MODES: ReadonlySet<string> = new Set(["t2v", "i2v", "interpolation", "r2v", "extension", "edit", "upsampler"]);

/** 未开放模式的拒绝依据(S303 消息组成部分 —— 错误里说明依据,不静默;价数字经 B9 格式层从 staticTierCosts 生成)。 */
const NOT_OPEN_REASONS: Readonly<Record<string, string>> = {
  "upsampler-4k": `veo_3_1_upsampler_4k 在 INTERMEDIATE tier UNAVAILABLE(契约 §9.1:需 ADVANCED ${flowTierCost("veo_3_1_upsampler_4k", "SERVICE_TIER_ADVANCED")} 点);当前 tier 只开放 1080p(${flowTierCost("veo_3_1_upsampler_1080p")} 点)`,
};

/** flow 助记模型正则(abra_t2v / abra_i2v / abra_r2v)—— key 解析与 provider 归属校验共用单一真源(H-nit)。 */
export const FLOW_MNEMONIC_RE = /^(abra)_(t2v|i2v|r2v)$/;

/** 视频 usage key 的模式段 → 中文标签(S303/S301 报错用)。 */
const VIDEO_MODE_LABELS: Record<string, string> = {
  t2v: "文生视频",
  i2v: "图生视频(起始图)",
  r2v: "参考图",
  interpolation: "首尾帧",
  extension: "延长",
  edit: "编辑",
  upsampler: "超分(独立端点)",
};

/**
 * 从 usage key 提取生成模式段。返回 undefined = 无法判定(目录新增的未知家族,放行交给上游)。
 * 检测顺序:upsampler → interpolation → extend(覆盖 extend/extension)→
 * fl 尾缀(首尾帧变体;须在 i2v 前 —— veo_3_1_i2v_s_*_fl 的 requirements 是 START+END,属首尾帧)→
 * i2v → r2v → t2v。
 */
export function videoModeOfKey(key: string): string | undefined {
  const abra = /^abra_(t2v|i2v|r2v)_\d+s$/.exec(key);
  if (abra) return abra[1];
  if (key === "abra_edit") return "edit";
  if (key.startsWith("veo_3_1_")) {
    if (key.includes("_upsampler")) return "upsampler";
    if (key.includes("_interpolation")) return "interpolation";
    if (key.includes("_exten")) return "extension"; // veo_3_1_extend_* / veo_3_1_extension_*(注意 extension=exten+sion,非 extend+ion)
    if (/(^|_)fl($|_)/.test(key)) return "interpolation"; // _fl = 首尾帧(first-last)变体;先于 _i2v 判定
    if (key.includes("_i2v")) return "i2v";
    if (key.includes("_r2v")) return "r2v";
    if (key.includes("_t2v")) return "t2v";
  }
  return undefined;
}

/**
 * 开放集外模式 → S303(错误消息带依据)。mode=undefined(未知家族)放行交给上游。
 * 开放集 = t2v / i2v / interpolation / r2v / extension / upsampler(契约 §7.3 + §9,2026-08-23 全部 live 提交验证)。
 * 特例:veo_3_1_upsampler_4k 属 upsampler 模式但被 INTERMEDIATE tier 锁(§9.1)→ 单独 S303。
 */
function assertModeOpen(key: string, mode: string | undefined): void {
  if (mode === "upsampler" && key.includes("_4k")) {
    throw new FlowError("S303", `模型 "${key}" ${NOT_OPEN_REASONS["upsampler-4k"]}`, {
      hint: `视频超分请用 veo_3_1_upsampler_1080p(${flowCreditsZh("veo_3_1_upsampler_1080p")});4K 需升级 ADVANCED 会员后开放`,
    });
  }
  if (mode == null || OPEN_VIDEO_MODES.has(mode)) return;
  throw new FlowError(
    "S303",
    `模型 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式的 key,当前未开放:${NOT_OPEN_REASONS[mode] ?? "该模式请求形状未实证"}`,
    {
      hint: `已开放:文生视频(t2v,如 abra_t2v_8s;2026-08-27 live 已验证,契约 §15)、图生视频(i2v + image,如 abra_i2v_8s)、参考图(r2v + images,如 abra_r2v_8s;可叠加 audioMediaIds 挂预设语音)、首尾帧(interpolation/_fl + keyframes 2 张)、延长(extension + videoMediaId,如 veo_3_1_extension_lite)、编辑(edit + videoMediaId + prompt,abra_edit,${flowCreditsZh("abra_edit")};2026-08-27 live 已验证,契约 §15)、视频超分(upsampler + videoMediaId,veo_3_1_upsampler_1080p,${flowCreditsZh("veo_3_1_upsampler_1080p")});全集见 flow_status`,
    },
  );
}

/** 宽高比数值 → 最近似 Flow 图像比例枚举(比例表契约 §3:1:1/9:16/16:9/3:4/4:3)。 */
function ratioToImageAspect(w: number, h: number): FlowImageAspect {
  const r = w / h;
  const table: Array<[FlowImageAspect, number]> = [
    ["SQUARE", 1], ["PORTRAIT", 9 / 16], ["LANDSCAPE", 16 / 9], ["PORTRAIT_THREE_FOUR", 3 / 4], ["LANDSCAPE_FOUR_THREE", 4 / 3],
  ];
  let best: FlowImageAspect = "LANDSCAPE", bestDelta = Infinity;
  for (const [k, v] of table) { const d = Math.abs(r - v); if (d < bestDelta) { bestDelta = d; best = k; } }
  return best;
}

/** size("WxH")→ 最近似 Flow 图像比例枚举(契约 §3:1:1/9:16/16:9/3:4/4:3;wire 枚举名见 IMAGE_ASPECTS 实测纠偏注释)。 */
export function sizeToImageAspect(size?: string): FlowImageAspect {
  const m = size ? /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(size) : null;
  if (!m) return "LANDSCAPE";
  const w = Number(m[1]), h = Number(m[2]);
  if (!w || !h) return "LANDSCAPE";
  return ratioToImageAspect(w, h);
}

/**
 * 视频模型 key 解析:mnemonic(abra_t2v)+ duration → 完整 usage key;显式 key 与 duration 冲突 → S301。
 * 纯解析(不做模式门禁 —— 门禁在 createVideo 按 image/keyframes 交叉校验,依据契约 §7.3 每模式独立端点)。
 * allowedKeys:校验目录(默认静态快照;createVideo 传 listVideoModels() = 动态目录优先、静态兜底,
 * 与 resolveProvider 的 model→provider 归属判断同源,消除动态/静态错位 —— audit finding-7)。
 * 纯函数(导出供单测白盒)。
 */
export function resolveVideoModelKey(
  model: string,
  durationSeconds?: number,
  allowedKeys: string[] = FLOW_VIDEO_MODELS,
): { key: string; duration: number; warnings: string[] } {
  const warnings: string[] = [];
  if (durationSeconds != null && !FLOW_VIDEO_DURATIONS.includes(durationSeconds as any)) {
    throw new FlowError("S301", `durationSeconds=${durationSeconds} 非法(视频时长仅 ${FLOW_VIDEO_DURATIONS.join("/")}s)`);
  }
  const duration = snapDuration(durationSeconds);
  const m = FLOW_MNEMONIC_RE.exec(model); // m[1]=家族 m[2]=模式(与 registry isFlowMnemonic 同一真源)
  if (m) {
    const key = `${model}_${duration}s`;
    if (!allowedKeys.includes(key)) {
      throw new FlowError("S300", `组合出的模型 key "${key}" 不在目录中`);
    }
    return { key, duration, warnings };
  }
  if (!allowedKeys.includes(model)) {
    throw new FlowError("S300", `未知视频模型 "${model}"。可用:${summarizeModels()}。完整动态目录可调 flow_status 查看`);
  }
  const embedded = /_(\d+)s(?:$|_)/.exec(model);
  if (embedded) {
    const keyDur = Number(embedded[1]);
    if (durationSeconds != null && keyDur !== durationSeconds) {
      throw new FlowError("S301", `模型 "${model}" 自带 ${keyDur}s 时长,与 durationSeconds=${durationSeconds} 冲突(若你传的是 numFrames,该 durationSeconds 由 numFrames÷frameRate 推导而来;二选一:换不带时长的 key,或改 numFrames/durationSeconds 与 key 一致)`);
    }
    return { key: model, duration: keyDur, warnings };
  }
  // 无时长后缀的 key(veo 家族默认 8s):请求 4/6s 时若目录有对应变体则自动切换
  if (duration === 4 || duration === 6) {
    const variant = `${model}_${duration}s`;
    if (allowedKeys.includes(variant)) {
      warnings.push(`按 durationSeconds=${duration}s 自动切换到变体 "${variant}"(原 key "${model}" 默认 8s)。`);
      return { key: variant, duration, warnings };
    }
    warnings.push(`模型 "${model}" 无 ${duration}s 变体,按默认时长生成(Flow 端决定)。`);
  } else if (duration === 10 && model.startsWith("veo_")) {
    throw new FlowError("S301", `veo 家族无 10s 时长(仅 4/6/8s 或默认);abra 家族支持 4/6/8/10s`);
  }
  return { key: model, duration, warnings };
}

function snapDuration(seconds?: number): number {
  if (seconds == null) return 8;
  let best = 8, bestDelta = Infinity;
  for (const d of FLOW_VIDEO_DURATIONS) { const delta = Math.abs(d - seconds); if (delta < bestDelta) { bestDelta = delta; best = d; } }
  return best;
}

function summarizeModels(): string {
  const abra = FLOW_VIDEO_MODELS.filter((k) => k.startsWith("abra_"));
  const rest = FLOW_VIDEO_MODELS.filter((k) => !k.startsWith("abra_"));
  return `${abra.length} 个 abra key(abra_{t2v,i2v,r2v}_{4,6,8,10}s / abra_edit)+ ${rest.length} 个 veo key(veo_3_1_*_{lite,fast,quality…},见 flow_status 动态目录)`;
}

/**
 * Flow mediaId 形状启发(供工具层放行判断;存在性/类型校验归 findMedia 的结构化 S400/S301):
 * 标准 UUID,或 UUID 派生名 —— Flow 对派生媒体用「源 id + 后缀」命名(§10.7 live 实证:<源id>_upsampled,
 * 非 UUID),只认标准 UUID 会把派生 id 挡在工具层到不了 provider。仅作非路径启发(拒绝 / : 空白),
 * 绝不做存在性判断。导出供单测白盒。
 */
export function isFlowMediaIdLike(u: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[-_][a-z0-9_-]+)?$/i.test(u);
}

/**
 * 媒体生成状态映射(契约 §2.3/§5 + §10.5 + §11.3):
 * - 含 SUCCESSFUL → completed
 * - 含 SCHEDULED / PENDING / ACTIVE → in_progress(提交后初始态 SCHEDULED;PENDING = 排队后处理前、
 *   ACTIVE = 生成中 —— 两枚举均为 2026-08-23 E 轮 live 首次观察,§10.5;旧版把它们误判 failed 的 bug 于此修复)
 * - 含 CANCELED → failed(终态;枚举名经 bundle 字符串表实证 §11.3,cancelGenerations 落点)
 * - 无 mediaStatus 但已有 generatedImage/generatedVideo → completed(实测:已完成图片不带 mediaStatus)
 * - 其余(含 FAILED 等未观察枚举)→ 一律当失败处理并回传原文(契约 §5 预答)
 * 导出供单测白盒。
 */
export function mapMediaStatus(media: any): { status: TaskStatus; rawStatus?: string; error?: string } {
  const raw = media?.mediaMetadata?.mediaStatus?.mediaGenerationStatus as string | undefined;
  if (raw == null) {
    if (media?.image?.generatedImage || media?.video?.generatedVideo) return { status: "completed" };
    return { status: "failed", rawStatus: undefined, error: "媒体无 mediaGenerationStatus 且无生成结果(疑似失败或未观察状态)" };
  }
  if (raw.includes("SUCCESSFUL")) return { status: "completed", rawStatus: raw };
  if (raw.includes("SCHEDULED") || raw.includes("PENDING") || raw.includes("ACTIVE")) return { status: "in_progress", rawStatus: raw };
  if (raw.includes("CANCELED")) return { status: "failed", rawStatus: raw, error: "生成已被取消(MEDIA_GENERATION_STATUS_CANCELED)" };
  return { status: "failed", rawStatus: raw, error: `Flow 媒体状态非成功:${raw}` };
}

// ── Provider ──

export interface FlowProviderConfig {
  /** CDP 端口(lasso launch-chrome --port;默认 9223)。 */
  cdpPort?: number;
  /** 指定 Flow projectId(缺省读 ~/.media-gen-mcp/flow-project.json,再缺省自动新建并落盘)。 */
  projectId?: string;
  /** config providers.flow.models.video.default:视频默认模型(无默认 → 显式要求传 model,防误耗积分)。 */
  models?: { video?: { default?: string }; image?: { default?: string } };
  /** 测试注入 stub transport(零网络零消耗)。 */
  transport?: FlowTransport;
  /**
   * 顶级 flow 渠道运行时段(registry 注入 config.flow 对象引用):
   * toolDeadlineMs = 长操作截止;videoConfirm/confirmTtlMs = 计费确认门开关与令牌 TTL。
   * 传引用(非解构)使测试可 live 修改。
   */
  flowCfg?: { toolDeadlineMs?: number; videoConfirm?: boolean; confirmTtlMs?: number };
}

export class FlowProvider implements MediaProviderBase, ImageProvider, VideoProvider {
  readonly name = "flow";
  private readonly transport: FlowTransport;
  private readonly cfgProjectId?: string;
  private readonly models?: FlowProviderConfig["models"];
  /** 前置检测缓存(TTL 30s;避免每次工具调用都探测 CDP)。 */
  private preflightCache: { at: number; pageUrl: string; email: string } | null = null;
  preflightTtlMs = DEFAULT_PREFLIGHT_TTL_MS; // 实例字段便于测试调短
  private lastReadyAt: number | null = null;
  /**
   * C 任务:60s 软熔断(对齐 agnes.notifyUnavailable)。冷却窗口内 ensureReady 直接抛缓存错误
   * (零探测)——「链头跳过」(registry resolveProvider)+「再次尝试快速失败」双通道共用此状态,
   * 使 flow-first 用户在 Chrome 未开时每个窗口至多付一次 CDP 连接尝试(本地 ECONNREFUSED ~ms 级)。
   */
  private cooldownUntil = 0;
  /**
   * B2-high 修复:确认令牌单次消费表(token → 过期时刻)。
   * verifyConfirmToken 是纯函数校验,无消费语义时同一令牌在 TTL 内可重放提交=重复扣积分;
   * 校验通过即消费(提交后续网络失败需重取令牌 —— 安全优先,重取成本一次往返)。
   * 🔴 2026-08-31(日志#15):HMAC 密钥改安装级稳定密钥后,单次消费语义必须同步跨进程成立
   * (否则令牌可跨进程重放)—— 本内存表与 ~/.media-gen-mcp/flow-confirm-consumed.json 双写:
   * 校验前读盘合并(syncConsumedFromDisk,惰性清理过期),消费后原子写盘(persistConsumedTokens)。
   * 诚实边界(B 白盒 2026-08-31):上表机制阻断的是【顺序】跨进程重放 —— 并发首消费存在毫秒级
   * 理论 TOCTOU 窗口(两进程同窗口内都通过 has() 检查则双双放行)。威胁模型:单用户本地工具 +
   * 毫秒窗口 + 重放需同 digest 同参数 + 重放后果=多扣一次积分,暴露面可接受;彻底封窗需 mkdir
   * 锁文件,对本威胁模型属过度设计(判断依据:丢失更新已由 persistConsumedTokens 并集写盘封掉,
   * 残留仅首消费竞态,不破坏已消费令牌的不可重放性)。
   */
  private consumedConfirmTokens = new Map<string, number>();
  /**
   * 确认令牌安装级密钥文件(测试注入缝,对齐 projectFile 先例):
   * null = 默认 ~/.media-gen-mcp/flow-confirm-secret(32B 随机,0600,原子 tmp+rename,不存在则创建)。
   */
  confirmSecretFile: string | null = null;
  /** 已消费令牌持久化文件(测试注入缝):null = 默认 ~/.media-gen-mcp/flow-confirm-consumed.json。 */
  confirmConsumedFile: string | null = null;
  /** 安装级密钥的进程内缓存(首用读盘/创建;同文件多实例各自缓存同值)。 */
  private confirmSecretCache: Buffer | null = null;
  private cooldownError: Error | null = null;
  cooldownMs = 60_000; // 实例字段便于测试调短
  /** 动态目录缓存(projectInitialData 派生;10 分钟)。creditByKey 供计费确认门动态预估;inputByKey 供 r2v 上限动态校验(§14.1)。 */
  private dynamicCatalog: {
    at: number; videoKeys: string[];
    creditByKey?: Record<string, Record<string, any>>;
    inputByKey?: Record<string, { maxImageInputs?: number; maxAudioReferences?: number }>;
  } | null = null;
  private readonly dynamicCatalogTtlMs = 10 * 60_000;
  /** 顶级 flow 段引用(toolDeadlineMs + 计费确认门;registry 注入 config.flow 对象)。 */
  private readonly flowCfg?: { toolDeadlineMs?: number; videoConfirm?: boolean; confirmTtlMs?: number };

  constructor(c: FlowProviderConfig = {}) {
    this.transport = c.transport ?? new CdpFlowTransport(c.cdpPort ?? DEFAULT_CDP_PORT);
    this.cfgProjectId = c.projectId;
    this.models = c.models;
    this.flowCfg = c.flowCfg;
  }

  // ── MediaProviderBase ──
  // 能力事实与准入策略分离(C 任务,types.ts MediaProviderBase.requiresOptIn 注释):
  // capabilities() 如实陈述(全部 2026-08-23 live 实证开放的模式);
  // requiresOptIn()=true 承担旧门禁职责 —— 未显式同意时 flow 不进任何隐式 fallback 链。
  capabilities(): ProviderCapabilities {
    return {
      image: { textToImage: true, imageToImage: true }, // 契约 §2.4/§7.2(t2v + 带图 base/references)
      video: { textToVideo: true, imageToVideo: true, keyframes: true }, // 契约 §7.3(t2v/i2v/StartAndEndImage;extension/upsampler 走 videoMediaId 特化)
    };
  }
  requiresOptIn(_modality: Modality): boolean {
    // image:0 积分但路由到 Google Flow 项目(隐私边界 + 模型语义变更须显式同意,防默认路由
    // 随「本机 Chrome 是否开着」漂移);video:消耗积分(误耗红线)。两模态统一「显式同意才介入」。
    // 2026-08-26:链即开关 —— 显式列入 imageProviderPriority/videoProviderPriority = 启用,
    // 不配置 = 不启用;原 S000 硬门(flow.enabled)删除(与链语义重复的正交维度)。
    return true;
  }
  listModels(): string[] { return [...this.listImageModels(), ...this.listVideoModels()]; }
  listImageModels(): string[] { return [...FLOW_IMAGE_MODELS]; }
  listVideoModels(): string[] {
    return this.dynamicCatalog && Date.now() - this.dynamicCatalog.at < this.dynamicCatalogTtlMs
      ? [...this.dynamicCatalog.videoKeys]
      : [...FLOW_VIDEO_MODELS];
  }
  supportsImageToImage(): boolean {
    // 2026-08-23 开放(契约 §7.2 live 实证):images 经 /v1/flow/uploadImage 上传为项目内媒体,
    // 再以 imageInputs[{imageInputType, name=mediaId}] 引用 —— images[0]=base,images[1..]=references(上限 10)。
    return true;
  }
  /**
   * 输入引用例外(渠道差异内聚,types.ts ImageProvider.acceptsImageInputRef):
   * 2K 放大模式(GEM_PIX_2_UPSAMPLE_2K + 单图)允许 images[0] 传项目内已有图片的 mediaId
   * (存在性/类型交 findMedia 结构化 S400/S301;形状 = UUID 或 UUID 派生名,如 §10.7 实证的
   * <源id>_upsampled —— isFlowMediaIdLike 仅作非路径启发,绝不做存在性判断)。
   */
  acceptsImageInputRef(value: string, req: { model?: string; images?: string[] }): boolean {
    return req.model === "GEM_PIX_2_UPSAMPLE_2K" && (req.images?.length ?? 0) === 1 && isFlowMediaIdLike(value);
  }
  health(): ProviderHealth {
    return {
      configured: this.lastReadyAt != null,
      cooldown: this.cooldownUntil > Date.now(),
    };
  }
  tier(): number { return 0; }
  notifyUnavailable(e: any): void {
    // 60s 软熔断(对齐 agnes);缓存错误供 ensureReady 冷却窗口内零探测快速失败。
    this.cooldownUntil = Date.now() + this.cooldownMs;
    this.cooldownError = e instanceof Error ? e : new Error(String(e));
    console.error(`[media-gen-mcp] flow 不可用(${(e as Error)?.message?.slice(0, 60)}),${Math.round(this.cooldownMs / 1000)}s 内优先级链跳过`);
  }

  // ── 防 stall 工具级截止(吸收自 flow-mcp withDeadline,2026-08-24 合包) ──

  /** 截止取值:flow.toolDeadlineMs(config/env)> 默认 110s;非法值回默认。 */
  private toolDeadlineMs(): number {
    const v = this.flowCfg?.toolDeadlineMs;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_TOOL_DEADLINE_MS;
  }

  /**
   * 长操作截止:正常完成原样返回;超过 deadline 转 [flow] S410 结构化错。
   * 底层 promise 不取消(诚实降级:生成可能在服务端继续,稍后经 flow_status(mediaId) 可达)。
   */
  private async withToolDeadline<T>(p: Promise<T>, label: string): Promise<T> {
    const ms = this.toolDeadlineMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new FlowError("S410",
        `${label} 超过工具层截止 ${Math.round(ms / 1000)}s(防 stall 红线)`,
        { hint: "底层操作未取消 —— 不带参数调 flow_status 查看项目 media 列表(提交过的生成会继续);完成项可 flow_status(mediaId, download=true) 落盘" })), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 工具层约束接口 ──

  videoConstraints() {
    // numFrames 语义换算:duration(4/6/8/10s)× 24fps = 96/144/192/240(见 FLOW_FRAME_RATE)
    return {
      allowedNumFrames: FLOW_VIDEO_DURATIONS.map((d) => d * FLOW_FRAME_RATE),
      defaultNumFrames: 8 * FLOW_FRAME_RATE,
      defaultFrameRate: FLOW_FRAME_RATE,
      allowedFrameRates: [FLOW_FRAME_RATE],
    };
  }
  /** 保守估计(实测 abra ~120s / veo lite ~110s / fast ~100s;quality 可达 260s)。 */
  estimateGenerationSeconds(_numFrames: number): number { return 130; }
  maxFramesFor(): number | undefined { return undefined; }

  // ── 前置检测(契约 §0;TTL 30s 缓存) ──

  /**
   * 前置检测:CDP 可连(S100)→ labs.google page target(S101)→ session 有 access_token(S102)。
   * 结果缓存 TTL preflightTtlMs(默认 30s)。access_token 不缓存(契约 §5:~1h 过期,每次现取)。
   * C 任务:冷却窗口(notifyUnavailable 置位,60s)内直接抛缓存错误 —— 零探测快速失败,
   * 使优先级链在 Chrome 未开时每窗口至多付一次连接尝试。
   */
  /**
   * 自动开页自愈(日志#4)的目标 URL:flow-project.json 的 projectUrl(显式)或 projectId 推导的
   * 项目页;文件缺省回落 labs.google/fx/tools/flow。纯本地读,不触发网络(无 ensureReady 循环)。
   */
  private flowTabUrl(): string {
    try {
      const raw = JSON.parse(fs.readFileSync(this.projectFile ?? FLOW_PROJECT_FILE, "utf-8"));
      // v2 场景优先(2026-08-31 live 发现:顶层 projectUrl 恒指"最后新建"的项目,多场景下会开错页):
      // 本 scope 映射 → default 兜底 → 顶层 projectUrl/v1 projectId(最后,防历史文件无 projects)
      if (raw?.version === 2 && raw.projects && typeof raw.projects === "object") {
        const scope = this.scopeKeyOverride ?? flowScopeKeyOf();
        const pid2 = raw.projects[scope] ?? raw.projects.default;
        if (typeof pid2 === "string" && pid2) return `${LABS_ORIGIN}/fx/tools/flow/project/${pid2}`;
      }
      if (typeof raw?.projectUrl === "string" && raw.projectUrl.startsWith(`${LABS_ORIGIN}/`)) return raw.projectUrl;
      if (typeof raw?.projectId === "string" && raw.projectId) return `${LABS_ORIGIN}/fx/tools/flow/project/${raw.projectId}`; // v1
    } catch { /* 无项目文件 → 缺省 URL */ }
    return DEFAULT_FLOW_TAB_URL;
  }

  async ensureReady(force = false): Promise<{ pageUrl: string; email: string }> {
    if (this.cooldownUntil > Date.now() && this.cooldownError) {
      throw this.cooldownError;
    }
    if (this.cooldownUntil <= Date.now()) this.cooldownError = null; // 窗口过期,清缓存错误
    if (!force && this.preflightCache && Date.now() - this.preflightCache.at < this.preflightTtlMs) {
      return this.preflightCache;
    }
    // S100 自愈一次(CDP 刚不可连常是 Chrome 正在启动/重启的就绪窗口):退避重探;仍失败原错误(拉起指引不变)。
    let pageUrl: string;
    try {
      ({ pageUrl } = await this.transport.open({ newTabUrl: this.flowTabUrl() })); // S100 / S101(无 target 自动开页自愈)
    } catch (e) {
      if (!(e instanceof FlowError) || e.code !== "S100") throw e;
      pushHealNote(this.transport, `CDP 瞬态不可连(Chrome 可能正在启动/重启):退避 ${Math.round(this.healCdpBackoffMs / 1000)}s 自动重探一次`);
      await sleep(this.healCdpBackoffMs);
      ({ pageUrl } = await this.transport.open({ newTabUrl: this.flowTabUrl() }));
    }
    const sess = await this.fetchSession(); // S102(带 S200/S202 网络自愈链)
    const cached = { at: Date.now(), pageUrl, email: sess.email ?? "" };
    this.preflightCache = cached;
    this.lastReadyAt = cached.at;
    return { pageUrl: cached.pageUrl, email: cached.email };
  }

  /** GET /fx/api/auth/session(同源 cookie;契约 §2.1)。未登录抛 S102。 */
  /** session 探测带网络自愈(日志#21:Chrome 刚重启/代理握手窗口,页面 fetch 瞬态 Failed to fetch)。 */
  healNetBackoffMs = 10_000; // 测试缝(#21 session 网络自愈)
  healCdpBackoffMs = 5_000; // 测试缝(S100 重探)
  healRcBackoffMs = 5_000; // 测试缝(S104 重取)

  /** S104 自愈(token 获取在提交前、零副作用):页面 enterprise 脚本随 Chrome 重启/导航可能未就绪 —— 退避重取一次。 */
  private async recaptchaTokenAuto(siteKey: string, action: string): Promise<string> {
    try {
      return await this.transport.recaptchaToken(siteKey, action);
    } catch (e) {
      if (!(e instanceof FlowError) || e.code !== "S104") throw e;
      pushHealNote(this.transport, `reCAPTCHA token 获取瞬态失败(${(e.message ?? "").replace(/^\[flow\] S104 /, "").slice(0, 62)}…):退避 ${Math.round(this.healRcBackoffMs / 1000)}s 自动重取一次`);
      await sleep(this.healRcBackoffMs);
      return await this.transport.recaptchaToken(siteKey, action);
    }
  }
  private async fetchSession(): Promise<{ email?: string; accessToken: string }> {
    const HEAL_HINT = "Chrome 刚重启或代理未就绪时 Flow 页 fetch 会瞬态失败:通常 10-30s 后重试即恢复,或打开一次 Flow 页(通常无需重新登录);若持续失败,检查代理对 labs.google 的可达性";
    const isNetErr = (e: unknown): e is FlowError => e instanceof FlowError && (e.code === "S200" || e.code === "S202");
    try {
      return await this.fetchSessionOnce();
    } catch (e) {
      if (!isNetErr(e)) throw e;
      pushHealNote(this.transport, `Flow 页面网络未就绪(${e.code}):退避 ${Math.round(this.healNetBackoffMs / 1000)}s 自动重试一次`);
      await sleep(this.healNetBackoffMs);
      try {
        return await this.fetchSessionOnce();
      } catch (e2) {
        if (!isNetErr(e2)) throw e2;
        pushHealNote(this.transport, "仍未就绪:自动 reload Flow 页面后重试一次(等价人工刷新;Chrome 重启/代理切换后常见)");
        try { if (this.transport.reload) await this.transport.reload(); } catch { /* reload 失败仍再试一次 fetch */ }
        await sleep((this.transport as { healReloadSettleMs?: number }).healReloadSettleMs ?? HEAL_RELOAD_SETTLE_MS);
        try {
          return await this.fetchSessionOnce();
        } catch (e3) {
          if (!isNetErr(e3)) throw e3;
          throw new FlowError(e3.code, `${e3.message.replace(/^\[flow] S\d+ /, "")} [已自动退避+刷新页面重试仍失败]`, { flowStatus: 0, hint: HEAL_HINT });
        }
      }
    }
  }
  private async fetchSessionOnce(): Promise<{ email?: string; accessToken: string }> {
    const f = await this.transport.pageFetch({ url: `${LABS_ORIGIN}/fx/api/auth/session`, method: "GET", headers: {} });
    if (!f.ok) throw new FlowError("S201", `session 查询 HTTP ${f.status}`, { flowStatus: f.status });
    let sess: any;
    try { sess = JSON.parse(bufToUtf8(f.bodyB64)); } catch {
      throw new FlowError("S202", "session 响应体非 JSON", { flowStatus: 0 });
    }
    if (!sess?.access_token) {
      throw new FlowError("S102", "labs.google 会话未登录(session 无 access_token)", { hint: LOGIN_LAUNCH_HINT, precondition: true });
    }
    return { email: sess?.user?.email, accessToken: sess.access_token };
  }

  /** access_token 现取现用(契约 §5:每次从 session 取,不缓存)。 */
  private async getAccessToken(): Promise<string> {
    return (await this.fetchSession()).accessToken;
  }

  // ── 401 自愈(日志#13/#14:access_token ~1h 陈旧 + 页面长时不刷新 → 携陈旧 token 调 API 得 401;页面 reload 即恢复,无需重登) ──

  /**
   * 带 401 自愈的 pageFetch(全部 tRPC/aisandbox 调用点共用;fetchSession 的 next-auth 端点除外):
   * 响应 401 且本连接 ensureReady 曾通过(lastReadyAt 非空,排除「从未登录」的假自愈)→
   * 自动 reload labs 页面一次 → 等 HEAL_RELOAD_SETTLE_MS → 重取 session 刷新 Bearer(带 authorization 的请求)
   * → 重试一次(带 warning)。仍 401 → S201(hint 指向「刷新/重开 Flow 页即恢复,无需重登」)。
   * 防递归:自愈内部的 session 重取走原始 transport(不入本包装)。reload+重试计入外层 toolDeadline。
   * POST 重试安全性:401 = 认证在处理前被拒(上游 auth middleware 先于业务),重试不会造成
   * 双重提交/双扣积分;确认门单次消费语义不受影响(门在提交前的独立调用里)。
   */
  private async pageFetchAuto(args: PageFetchArgs, timeoutMs?: number): Promise<PageFetchResp> {
    const f = await this.transport.pageFetch(args, timeoutMs);
    if (f.status !== 401 || this.lastReadyAt == null) return f; // 从未就绪过 → 不自愈(S102/S201 原语义)
    const isFlowApi = args.url.startsWith(`${LABS_ORIGIN}/fx/api/trpc/`) || args.url.startsWith(`${AISANDBOX_ORIGIN}/`);
    if (!isFlowApi) return f; // 仅 tRPC/aisandbox(任务边界);其余端点维持原语义
    pushHealNote(this.transport, "access_token 陈旧(401):已自动刷新 Flow 页面重取会话并重试一次(通常无需重新登录)");
    let reloaded = false;
    try {
      if (this.transport.reload) {
        await this.transport.reload();
        reloaded = true;
      }
    } catch { /* reload 失败 → 仍重试一次原请求(半过期场景可能已自愈) */ }
    if (reloaded) await sleep((this.transport as { healReloadSettleMs?: number }).healReloadSettleMs ?? HEAL_RELOAD_SETTLE_MS);
    const healed: PageFetchArgs = { ...args, headers: { ...args.headers } };
    if (typeof healed.headers.authorization === "string" && healed.headers.authorization) {
      try {
        const sess = await this.transport.pageFetch({ url: `${LABS_ORIGIN}/fx/api/auth/session`, method: "GET", headers: {} });
        if (sess.ok) {
          const s = JSON.parse(bufToUtf8(sess.bodyB64));
          if (typeof s?.access_token === "string" && s.access_token) healed.headers.authorization = `Bearer ${s.access_token}`;
        }
      } catch { /* session 重取失败 → 保持原 token 重试一次 */ }
    }
    const again = await this.transport.pageFetch(healed, timeoutMs);
    if (again.status !== 401) return again;
    throw new FlowError(
      "S201",
      `页面 API HTTP 401(自动刷新页面重试一次后仍 401;url: ${args.url.slice(0, 120)};body: ${bufToUtf8(again.bodyB64).slice(0, 160)})`,
      {
        flowStatus: 401,
        hint: "页面会话可能已过期:通常刷新/重开 Flow 页面即恢复(无需重新登录,本错误已自动 reload 重试过一次);确需人工检查时:lasso chrome-show → 检查 labs.google 登录 → 完成后 lasso chrome-hide 收回后台(保持静默)",
      },
    );
  }

  /** drain 传输层自愈 note(S101 自动开页/S103 退避/401 刷新 —— stderr 已留痕,这里上浮进结果 warnings)。 */
  private takeHealNotes(): string[] {
    const notes = (this.transport as { notes?: string[] }).notes;
    if (!Array.isArray(notes) || !notes.length) return [];
    return notes.splice(0, notes.length);
  }

  /** 公共入口统一上浮自愈 note(与既有 warnings 合并,不覆盖 provider 业务告警)。 */
  private attachHealNotes<T>(r: T): T {
    const notes = this.takeHealNotes();
    if (notes.length && r && typeof r === "object") {
      const w = (r as { warnings?: string[] }).warnings;
      (r as { warnings?: string[] }).warnings = [...(Array.isArray(w) ? w : []), ...notes];
    }
    return r;
  }

  // ── 项目管理(契约 §2.7 / ~/.media-gen-mcp/flow-project.json) ──

  /** 解析 projectId:config → flow-project.json → 自动新建(POST project.createProject,零积分)。 */
  projectFile: string | null = null; // 测试注入缝(对齐 preflightTtlMs/entitiesFile 先例;默认 ~/.media-gen-mcp/flow-project.json)
  private pendingScopeKey: string | null = null; // ensureProjectId 解析时的本进程场景键(供新建命名与 v2 写盘)
  scopeKeyOverride: string | null = null; // 测试注入缝:覆盖 flowScopeKeyOf(process.cwd) 的场景键
  async ensureProjectId(): Promise<string> {
    if (this.cfgProjectId) return this.cfgProjectId;
    // v2 多场景解析(2026-08-31 用户裁决):flow-project.json = {version:2, projects:{<scopeKey>: projectId}};
    // scopeKey = flowScopeKeyOf(cwd)(场景层级,如 特辑_产品宣传@vscode状态插件)。v1 单 projectId 自动迁移
    // 为 projects.default(=既有主项目 —— CC 主会话/Project 根场景继续用,存量资产不动);
    // 新场景 miss → 按规范名 media-gen-mcp@<scopeKey> 新建(此前全局单项目/固定名,用户点名按使用项目隔离)。
    const scopeKey = this.scopeKeyOverride ?? flowScopeKeyOf();
    const file = this.projectFile ?? FLOW_PROJECT_FILE;
    let projects: Record<string, string> = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (raw?.version === 2 && raw.projects && typeof raw.projects === "object") projects = { ...raw.projects };
      else if (typeof raw?.projectId === "string" && raw.projectId) projects = { default: raw.projectId }; // v1 → v2
    } catch { /* 文件不存在/损坏 → 走新建 */ }
    this.pendingScopeKey = scopeKey; // 供新建命名与 v2 写盘
    const hit = projects[scopeKey];
    if (typeof hit === "string" && hit) return hit;
    // 🔴 测试探针护栏(2026-08-31 同名项目根因):spawn 出的 server 若 HOME 被隔离,本方法会在
    // CDP 活着时真实 createProject —— 补丁修密钥污染时曾意外打开项目污染(whitebox A-01,每次
    // npm test 一个同名项目)。测试统一设 FLOW_NEVER_CREATE_PROJECT=1:文件 miss 即结构化拒绝,
    // 绝不触达 Flow 账号;生产不设此 env,自愈新建语义不变(stderr 仍留痕)。
    if (process.env.FLOW_NEVER_CREATE_PROJECT === "1") {
      throw new FlowError("S101", `flow-project.json 不可读且 FLOW_NEVER_CREATE_PROJECT=1(测试探针模式,禁止自动新建项目;生产环境请勿设置此 env)`, { precondition: true });
    }
    await this.ensureReady();
    // 项目命名规范(2026-08-31 用户裁决升级):**按使用项目全路径层级**命名 media-gen-mcp@<场景@层级>
    // (示例 media-gen-mcp@特辑_产品宣传@vscode状态插件);default 场景保留基础名。
    // 历史教训链:日期家族(P0-17)→ 同名家族(P0-22)→ 本规范=场景隔离,一眼可辨"哪个使用方在哪个项目"。
    const scopeKey2 = this.pendingScopeKey ?? flowScopeKeyOf();
    const PROJECT_TITLE = flowProjectTitleOf(scopeKey2);
    const body = JSON.stringify({ json: { projectTitle: PROJECT_TITLE, toolName: TOOL_INTERNAL_NAME } });
    const f = await this.pageFetchAuto({
      url: `${LABS_ORIGIN}/fx/api/trpc/project.createProject`,
      method: "POST",
      headers: { "content-type": "application/json" },
      bodyB64: utf8ToB64(body),
    });
    if (!f.ok) throw new FlowError("S201", `project.createProject HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 160)}`, { flowStatus: f.status });
    let created: any;
    try { created = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "createProject 响应体非 JSON", { flowStatus: 0 }); }
    const pid = created?.result?.data?.json?.result?.projectId;
    if (!pid) throw new FlowError("S202", `createProject 响应无 projectId:${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: 0 });
    try {
      const persistFile = this.projectFile ?? FLOW_PROJECT_FILE;
      fs.mkdirSync(path.dirname(persistFile), { recursive: true });
      // v2 合并写:重读盘取最新 map(防多场景并发互抹),本 scope 键指向新 projectId;v1/v2 兼容迁移
      let merged: Record<string, string> = {};
      try {
        const cur = JSON.parse(fs.readFileSync(persistFile, "utf-8"));
        if (cur?.version === 2 && cur.projects && typeof cur.projects === "object") merged = { ...cur.projects };
        else if (typeof cur?.projectId === "string" && cur.projectId) merged = { default: cur.projectId };
      } catch { /* 首建无文件 */ }
      merged[scopeKey2] = pid;
      fs.writeFileSync(persistFile, JSON.stringify({
        version: 2,
        projects: merged,
        projectUrl: `${LABS_ORIGIN}/fx/tools/flow/project/${pid}`,
        createdAt: new Date().toISOString(),
        note: "media-gen-mcp flow 项目映射(scopeKey=cwd 末2段@连接;default=迁移前主项目);新场景 miss 按规范名 media-gen-mcp@<scopeKey> 新建",
      }, null, 2));
    } catch { /* 落盘失败不阻断(下次会再新建);projectId 已在返回值里 */ }
    // 自动新建非常态(HOME 正常 + flow-project.json 在则永不走到)—— stderr 留痕,便于发现环境异常
    console.error(`[flow] 已自动新建 Flow 项目 "${PROJECT_TITLE}"(scope=${scopeKey2}, ${pid});若非预期,请检查 HOME 与 ~/.media-gen-mcp/flow-project.json`);
    return pid;
  }

  // ── 只读数据面(零消耗;契约 §2.2/§2.3/§2.6) ──

  /** GET /v1/credits?key=(Bearer;契约 §2.2)。 */
  async getCredits(): Promise<{ credits?: number; serviceTier?: string; userPaygateTier?: string; subscriptionCredits?: number; sku?: string }> {
    await this.ensureReady();
    const token = await this.getAccessToken();
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/credits?key=${FLOW_API_KEY}`,
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!f.ok) throw new FlowError("S201", `credits 查询 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 160)}`, { flowStatus: f.status });
    try { return JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "credits 响应体非 JSON", { flowStatus: 0 }); }
  }

  /** GET flow.projectInitialData(契约 §2.3;状态轮询 + 模型目录单一数据源)。 */
  private async getProjectData(projectId?: string): Promise<any> {
    const pid = projectId ?? await this.ensureProjectId();
    await this.ensureReady();
    const input = encodeURIComponent(JSON.stringify({ json: { projectId: pid } }));
    const f = await this.pageFetchAuto({
      url: `${LABS_ORIGIN}/fx/api/trpc/flow.projectInitialData?input=${input}`,
      method: "GET",
      headers: {},
    });
    if (!f.ok) throw new FlowError("S201", `projectInitialData HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 160)}`, { flowStatus: f.status });
    let j: any;
    try { j = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "projectInitialData 响应体非 JSON", { flowStatus: 0 }); }
    const data = j?.result?.data?.json ?? j;
    if (!data?.projectContents) throw new FlowError("S202", `projectInitialData 响应缺 projectContents:${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: 0 });
    this.cacheDynamicCatalog(data);
    return data;
  }

  /** 从 projectInitialData 缓存动态 usage key 目录 + per-key creditMapping/inputSpec(计费确认门动态预估与 r2v 上限的真源)。 */
  private cacheDynamicCatalog(data: any): void {
    const keys: string[] = [];
    const creditByKey: Record<string, Record<string, any>> = {};
    const inputByKey: Record<string, { maxImageInputs?: number; maxAudioReferences?: number }> = {};
    for (const fam of data?.modelConfig?.videoModelFamilies ?? []) {
      for (const u of fam?.usages ?? []) {
        if (typeof u?.key !== "string") continue;
        keys.push(u.key);
        if (u?.creditMapping && typeof u.creditMapping === "object") creditByKey[u.key] = u.creditMapping;
        // §14.1:maxImageInputs 是 usage 顶层字段;maxAudioReferences 嵌在 inputSpec 内
        const caps: { maxImageInputs?: number; maxAudioReferences?: number } = {};
        if (Number.isFinite(u?.maxImageInputs)) caps.maxImageInputs = Number(u.maxImageInputs);
        if (Number.isFinite(u?.inputSpec?.maxAudioReferences)) caps.maxAudioReferences = Number(u.inputSpec.maxAudioReferences);
        if ("maxImageInputs" in caps || "maxAudioReferences" in caps) inputByKey[u.key] = caps;
      }
    }
    if (keys.length) this.dynamicCatalog = { at: Date.now(), videoKeys: keys, creditByKey, inputByKey };
  }

  private async findMedia(mediaId: string): Promise<any> {
    const data = await this.getProjectData();
    const media = (data?.projectContents?.media ?? []).find((m: any) => m?.name === mediaId);
    if (!media) {
      throw new FlowError("S400", `mediaId "${mediaId}" 不在本项目 media 列表(可能属于其他项目或已删除)`, { hint: "不带参数调 flow_status 可查看本项目全部 media" });
    }
    return media;
  }

  /** 媒体状态查询(零消耗):getVideo 的底层,也供 flow_status 工具直查。 */
  async mediaStatus(mediaId: string): Promise<{
    mediaId: string; status: TaskStatus; rawStatus?: string; kind: "video" | "image" | "unknown";
    model?: string; seed?: number; durationSeconds?: number; bytes?: number; created?: string; prompt?: string;
  }> {
    // 三审 finding-5:0 点工具路径同样受防 stall 截止(ensureReady+findMedia 可各挂一个 eval 超时)
    return this.withToolDeadline(this.mediaStatusUnbounded(mediaId), `flow 媒体状态 ${mediaId.slice(0, 8)}`);
  }
  private async mediaStatusUnbounded(mediaId: string): Promise<{
    mediaId: string; status: TaskStatus; rawStatus?: string; kind: "video" | "image" | "unknown";
    model?: string; seed?: number; durationSeconds?: number; bytes?: number; created?: string; prompt?: string;
  }> {
    await this.ensureReady();
    const m = await this.findMedia(mediaId);
    const mapped = mapMediaStatus(m);
    const gen = m?.video?.generatedVideo ?? m?.image?.generatedImage ?? {};
    const dim = m?.dimensions?.length;
    const durationSeconds = typeof dim === "string" && /^\d+s$/.test(dim) ? Number(dim.slice(0, -1)) : undefined;
    return {
      mediaId,
      status: mapped.status,
      ...(mapped.rawStatus ? { rawStatus: mapped.rawStatus } : {}),
      kind: m?.video?.generatedVideo ? "video" : m?.image?.generatedImage ? "image" : "unknown",
      ...(gen.model ? { model: gen.model } : {}),
      ...(gen.seed != null ? { seed: gen.seed } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(m?.mediaMetadata?.mediaBlobSize ? { bytes: Number(m.mediaMetadata.mediaBlobSize) } : {}),
      ...(m?.mediaMetadata?.createTime ? { created: m.mediaMetadata.createTime } : {}),
      ...(gen.prompt || m?.mediaMetadata?.requestData?.promptInputs?.[0]?.textInput ? { prompt: gen.prompt ?? m.mediaMetadata.requestData.promptInputs[0].textInput } : {}),
      ...(mapped.status === "failed" && mapped.error ? { error: mapped.error } : {}),
    };
  }

  /**
   * 媒体下载(零消耗;契约 §2.6):getMediaUrlRedirect。
   * 无 type → 原始资产(video/mp4 流式 / image);thumbnail=true → MEDIA_URL_TYPE_THUMBNAIL(image/jpeg)。
   */
  async getMediaBytes(mediaId: string, opts: { thumbnail?: boolean } = {}): Promise<{ contentType: string; buf: Buffer }> {
    // 防 stall:下载内部兜底 180s,超 120s 红线 —— 工具级截止 110s 封顶(S410 诚实降级)
    return this.withToolDeadline(this.getMediaBytesUnbounded(mediaId, opts), `flow 下载 ${mediaId.slice(0, 8)}`);
  }
  private async getMediaBytesUnbounded(mediaId: string, opts: { thumbnail?: boolean } = {}): Promise<{ contentType: string; buf: Buffer }> {
    await this.ensureReady();
    const q = opts.thumbnail ? "&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL" : "";
    const f = await this.pageFetchAuto({
      url: `${LABS_ORIGIN}/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}${q}`,
      method: "GET",
      headers: {},
    }, DOWNLOAD_TIMEOUT_MS);
    if (!f.ok) throw new FlowError("S402", `媒体下载 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 160)}`, { flowStatus: f.status });
    const buf = Buffer.from(f.bodyB64, "base64");
    if (!buf.length) throw new FlowError("S402", "媒体下载返回空 body", { flowStatus: 0 });
    return { contentType: f.contentType || "application/octet-stream", buf };
  }

  // ── 图片放大(契约 §9.5 + E 轮 bundle Zod 全 schema + §10.8 action 实证,0 点) ──

  /**
   * 2K 图片放大:POST /v1/flow/upsampleImage(0 点;reCAPTCHA action = IMAGE_GENERATION,§10.8 拦截实证)。
   * body 全 schema(bundle _app-cf6a7aa3 Zod 逐字,E 轮逆向):{clientContext, mediaId, requestContext, targetResolution},
   * targetResolution ∈ UPSAMPLE_IMAGE_RESOLUTION_{UNSPECIFIED,2K,4K}(4K 需 ADVANCED tier;模型固定 GEM_PIX_2_UPSAMPLE_2K,无选择字段)。
   * source:项目内已有 image mediaId,或 http(s)/data: URI(先 uploadImage 上传,0 点)。
   * 测试铁律:测试代码不得让本方法打真实网络(stub transport 除外)。
   */
  async generateUpscaledImage(req: ImageRequest): Promise<ImageResult> {
    await this.ensureReady();
    const src = req.images?.[0];
    if (!src) {
      throw new FlowError("S301", "图片放大需要 images[0](要放大的图:已有图片的 mediaId,或 http(s)/data: URI 自动上传)", { hint: `mediaId 可经 flow_status 查看;放大 ${FLOW_ZERO_CREDIT} 积分` });
    }
    const warnings: string[] = [];
    if (req.prompt?.trim()) warnings.push("图片放大不消费 prompt(固定 GEM_PIX_2_UPSAMPLE_2K 管线),已忽略。");
    // 源解析:URI → 上传;否则当 mediaId(须在项目内且是 image)
    let mediaId: string;
    if (/^(https?|data):/i.test(src)) {
      mediaId = (await this.uploadMedia(src)).mediaId;
    } else {
      const m = await this.findMedia(src);
      if (m?.video?.generatedVideo && !m?.image?.generatedImage) {
        throw new FlowError("S301", `mediaId "${src}" 是 video 媒体,不能作图片放大源`);
      }
      mediaId = src;
    }
    const submitted = await this.submitImageUpsample(mediaId, "UPSAMPLE_IMAGE_RESOLUTION_2K");
    const finished = await this.pollMediaUntilDone([submitted.mediaId], 240_000, 5_000);
    const outputs = [];
    for (const item of finished.done) {
      const got = await this.getMediaBytes(item.mediaId);
      outputs.push({
        url: `data:${got.contentType.split(";")[0] || "image/png"};base64,${got.buf.toString("base64")}`,
        mediaId: item.mediaId,
        ...(item.gen?.seed != null ? { seed: item.gen.seed } : {}),
      });
    }
    if (finished.timeout.length) warnings.push(`放大媒体轮询超时(${finished.timeout.join(",")}),可用 flow_status(mediaId) 复查后下载。`);
    if (!outputs.length) {
      throw new FlowError("S401", `图片放大失败(0 张产出;已提交 mediaId:${submitted.mediaId}${finished.failed.length ? ";" + finished.failed.map((x) => `${x.mediaId}(${x.rawStatus ?? "?"})`).join(",") : ""})`, { hint: "可带 mediaId 调 flow_status 复查状态" });
    }
    return { outputs, warnings: warnings.length ? warnings : undefined };
  }

  /** 🔴 提交点(图片放大 POST;0 点)。构造 §9.5+E 轮 schema body 并提交,返回新 mediaId。 */
  private async submitImageUpsample(mediaId: string, targetResolution: string): Promise<{ mediaId: string; raw: any }> {
    const pid = await this.ensureProjectId();
    const token = await this.getAccessToken();
    const recaptcha = await this.recaptchaTokenAuto(RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION_IMAGE); // §10.8: 放大与生图共用 action(IMAGE_UPSAMPLING 会 403)
    const body = {
      clientContext: {
        recaptchaContext: { token: recaptcha, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
        projectId: pid,
        tool: TOOL_INTERNAL_NAME,
        sessionId: wireSessionId(),
      },
      mediaId,
      requestContext: {},
      targetResolution,
    };
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/flow/upsampleImage`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      bodyB64: utf8ToB64(JSON.stringify(body)),
    });
    if (!f.ok) {
      throw new FlowError("S201", `图片放大提交 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 240)}`, { flowStatus: f.status });
    }
    let r: any;
    try { r = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "图片放大响应体非 JSON", { flowStatus: 0 }); }
    const newId = Array.isArray(r?.media) ? r.media[0]?.name : r?.media?.name;
    if (typeof newId !== "string" || !newId) {
      throw new FlowError("S202", `图片放大响应无 media.name:${bufToUtf8(f.bodyB64).slice(0, 240)}`, { flowStatus: 0 });
    }
    return { mediaId: newId, raw: r };
  }

  // ── 资产删除(契约 §9.4,字段名 = mediaIds;0 点;flow_status 轮询卫生前提) ──

  /**
   * 删除项目内媒体:POST /v1/flow:batchDeleteAssets body {mediaIds}(§9.4 假 id 404 探针实证字段名)。
   * 删除前逐个校验存在性(有未知 id → S400 整批不提交,防部分删除);删除为不可逆操作。
   */
  async deleteAssets(mediaIds: string[]): Promise<{ deleted: string[]; mediaRemaining: number; raw: unknown }> {
    // 三审 finding-5:多步链(前置 projectData + 批删 + 复查)总时长受工具级截止封顶(防 stall 红线)
    return this.withToolDeadline(this.deleteAssetsUnbounded(mediaIds), `flow 删除媒体 x${mediaIds.length}`);
  }
  private async deleteAssetsUnbounded(mediaIds: string[]): Promise<{ deleted: string[]; mediaRemaining: number; raw: unknown }> {
    if (!mediaIds.length) throw new FlowError("S301", "deleteAssets 需要 non-empty mediaIds 数组");
    await this.ensureReady();
    const known = new Set(((await this.getProjectData()).projectContents?.media ?? []).map((m: any) => m?.name));
    const unknown = mediaIds.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new FlowError("S400", `以下 mediaId 不在本项目(整批未删除):${unknown.join(", ")}`, { hint: "不带参数调 flow_status 可查看本项目全部 media" });
    }
    const token = await this.getAccessToken();
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/flow:batchDeleteAssets`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      bodyB64: utf8ToB64(JSON.stringify({ mediaIds })),
    });
    if (!f.ok) {
      throw new FlowError("S201", `batchDeleteAssets HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 240)}`, { flowStatus: f.status });
    }
    let raw: any;
    try { raw = JSON.parse(bufToUtf8(f.bodyB64)); } catch { raw = { rawText: bufToUtf8(f.bodyB64).slice(0, 200) }; }
    const after = ((await this.getProjectData()).projectContents?.media ?? []) as any[];
    return { deleted: mediaIds.filter((id) => !after.some((m) => m?.name === id)), mediaRemaining: after.length, raw };
  }

  // ── 媒体分享(契约 §8.3 live 双实证 + §11.2 E 轮 provider 路径复验;0 点) ──

  /**
   * 生成分享链接:tRPC flow.share.shareMedia POST {json:{mediaId, includePrompt:true, inputMediaIds:[], inputEntityIds:[]}}
   * (inputEntityIds 必须 [],null 会 zod 400 —— §8.3 live 实证)→ {result:{data:{json:{result:{mediaShareId}}}}}。
   * 分享 URL 模板(bundle 字符串表 0x2828/0xad1/0xb06 解码,E 轮):
   *   https://labs.google/fx/tools/flow/shared/{image|video}/<mediaShareId>(image/video 按媒体 kind)。
   * 逐 id 提交(tRPC 一次一个);未知 id → 整批 S400 不提交(对齐 deleteAssets 纪律)。
   */
  async shareMedia(mediaIds: string[]): Promise<{ shared: Array<{ mediaId: string; kind: string; mediaShareId: string; shareUrl: string }>; hint: string }> {
    // 三审 finding-5:逐 id 提交的 tRPC 循环(N id × 单次 eval 超时)可远超 120s 红线 —— 工具级截止封顶
    return this.withToolDeadline(this.shareMediaUnbounded(mediaIds), `flow 分享媒体 x${mediaIds.length}`);
  }
  private async shareMediaUnbounded(mediaIds: string[]): Promise<{ shared: Array<{ mediaId: string; kind: string; mediaShareId: string; shareUrl: string }>; hint: string }> {
    if (!mediaIds.length) throw new FlowError("S301", "shareMedia 需要 non-empty mediaIds 数组");
    await this.ensureReady();
    const all = (await this.getProjectData()).projectContents?.media ?? [];
    const known = new Map<string, "image" | "video">();
    for (const m of all) {
      if (m?.video?.generatedVideo) known.set(m.name, "video");
      else if (m?.image?.generatedImage) known.set(m.name, "image");
    }
    const unknown = mediaIds.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new FlowError("S400", `以下 mediaId 不在本项目(整批未分享):${unknown.join(", ")}`, { hint: "不带参数调 flow_status 可查看本项目全部 media" });
    }
    const shared: Array<{ mediaId: string; kind: string; mediaShareId: string; shareUrl: string }> = [];
    for (const id of mediaIds) {
      const f = await this.pageFetchAuto({
        url: `${LABS_ORIGIN}/fx/api/trpc/flow.share.shareMedia`,
        method: "POST",
        headers: { "content-type": "application/json" },
        bodyB64: utf8ToB64(JSON.stringify({ json: { mediaId: id, includePrompt: true, inputMediaIds: [], inputEntityIds: [] } })),
      });
      if (!f.ok) {
        throw new FlowError("S201", `shareMedia(${id}) HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: f.status });
      }
      let r: any;
      try { r = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", `shareMedia(${id}) 响应体非 JSON`, { flowStatus: 0 }); }
      // tRPC 响应嵌套:result.data.json.result.mediaShareId(§11.2 live 实测;容错浅挖两层)
      const mediaShareId = r?.result?.data?.json?.result?.mediaShareId ?? r?.result?.data?.json?.mediaShareId ?? r?.result?.mediaShareId;
      if (typeof mediaShareId !== "string" || !mediaShareId) {
        throw new FlowError("S202", `shareMedia(${id}) 响应无 mediaShareId:${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: 0 });
      }
      const kind = known.get(id) === "video" ? "video" : "image";
      shared.push({ mediaId: id, kind, mediaShareId, shareUrl: `${LABS_ORIGIN}/fx/tools/flow/shared/${kind}/${mediaShareId}` });
    }
    return {
      shared,
      hint: "分享链接公开可访问(含提示词 includePrompt=true);再次分享同一媒体会生成新的 mediaShareId(旧链接仍有效直至项目删除)。",
    };
  }

  // ── 取消生成(契约 §11.3;bundle 提交构造器明文 body={mediaId} 单值;0 点) ──

  /**
   * 取消 in-flight 生成:POST aisandbox /v1/flowMedia:cancelGeneration body {mediaId}(单值,逐 id 提交)。
   * 前置:逐 id 校验「在本项目 && 状态 in_progress」—— 已完成/已取消的媒体不可取消
   * (服务端会 4xx PUBLIC_ERROR_MEDIA_GENERATION_CANNOT_BE_CANCELED,bundle 错误码实证),整批先验后发。
   * 取消后复查状态:期望转移到 MEDIA_GENERATION_STATUS_CANCELED(mapMediaStatus → failed 终态)。
   *
   * 🔴 适用面 live 边界(§11.3):bundle 中 cancel 仅被 VideoService 的 processingRequests 队列调用
   * (传提交响应的 media.name = mediaId);E 轮 live 实证对 **图片** in-flight 提交取消 → 404
   * "Requested entity was not found"(图片生成不可取消/不在 cancelable registry)。视频 in-flight 的
   * E2E 取消未 live 验证(需一次最低价视频提交,价见 staticTierCosts,待授权)——本方法对 video 类 in-flight 照常提交,图片类
   * 如实回传服务端 404 并在错误中解释。
   */
  async cancelGenerations(mediaIds: string[]): Promise<{
    canceled: string[]; notCancelable: Array<{ mediaId: string; status: string; reason: string }>; statusAfter: Array<{ mediaId: string; status: string; rawStatus?: string }>;
  }> {
    // 三审 finding-5:先验 projectData + 逐 id 取消 + 复查的多步链受工具级截止封顶(防 stall 红线)
    return this.withToolDeadline(this.cancelGenerationsUnbounded(mediaIds), `flow 取消生成 x${mediaIds.length}`);
  }
  private async cancelGenerationsUnbounded(mediaIds: string[]): Promise<{
    canceled: string[]; notCancelable: Array<{ mediaId: string; status: string; reason: string }>; statusAfter: Array<{ mediaId: string; status: string; rawStatus?: string }>;
  }> {
    if (!mediaIds.length) throw new FlowError("S301", "cancelGenerations 需要 non-empty mediaIds 数组");
    await this.ensureReady();
    const data = await this.getProjectData();
    const all = data.projectContents?.media ?? [];
    const byId = new Map(all.map((m: any) => [m?.name, m]));
    const unknown = mediaIds.filter((id) => !byId.has(id));
    if (unknown.length) {
      throw new FlowError("S400", `以下 mediaId 不在本项目(整批未取消):${unknown.join(", ")}`, { hint: "不带参数调 flow_status 可查看本项目全部 media" });
    }
    const notCancelable: Array<{ mediaId: string; status: string; reason: string }> = [];
    const toCancel: string[] = [];
    for (const id of mediaIds) {
      const st = mapMediaStatus(byId.get(id));
      if (st.status === "in_progress") toCancel.push(id);
      else notCancelable.push({ mediaId: id, status: st.status, reason: st.status === "completed" ? "已完成,无需取消" : `状态 ${st.rawStatus ?? st.status} 非生成中,不可取消` });
    }
    const token = await this.getAccessToken();
    const canceled: string[] = [];
    for (const id of toCancel) {
      const f = await this.pageFetchAuto({
        url: `${AISANDBOX_ORIGIN}/v1/flowMedia:cancelGeneration`,
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        bodyB64: utf8ToB64(JSON.stringify({ mediaId: id })),
      });
      if (!f.ok) {
        const detail = bufToUtf8(f.bodyB64).slice(0, 200);
        const hint404 = f.status === 404
          ? "404 实测语义(§11.3):该生成不可取消 —— 图片生成 cancel → 404(bundle 中 cancel 仅 VideoService 使用);视频 in-flight 之外的状态也会 404"
          : undefined;
        throw new FlowError("S201", `cancelGeneration(${id}) HTTP ${f.status}: ${detail}`, { flowStatus: f.status, ...(hint404 ? { hint: hint404 } : {}) });
      }
      canceled.push(id);
    }
    // 取消后复查状态转移(零消耗只读;刚提交的 job 可能仍在转移中,如实回传)
    const after = canceled.length ? (await this.getProjectData()).projectContents?.media ?? [] : [];
    const statusAfter = canceled.map((id) => {
      const st = mapMediaStatus((after as any[]).find((m: any) => m?.name === id));
      return { mediaId: id, status: st.status, ...(st.rawStatus ? { rawStatus: st.rawStatus } : {}) };
    });
    return { canceled, notCancelable, statusAfter };
  }


  /**
   * 30 预设语音清单(契约 §8.8;只读源 = projectInitialData projectContents.externalReferenceMedia 的
   * AUDIO 条目,路径 entry.media.audio.generatedAudio —— §11.4 live 纠偏:audio 嵌在 entry.media 下,
   * 非条目顶层;30 条恒在,0 点)。
   */
  /** flow_status 工具主入口:全量自省(零消耗)。 */
  async flowStatus(): Promise<Record<string, unknown>> {
    // 三审 finding-5:ensureReady + credits + 全量 projectInitialData 的只读快照同样受工具级截止
    // (CDP 半态下多个 eval 叠加可超 120s 红线;flow_status 是 CC 的主要自省入口,必须防 stall)
    // B-finding-5:自愈 note 统一经 attachHealNotes 上浮(消除与 generateImage/getVideo 入口的
    // 手写重复合并,02 R-CI-08;泛型已覆盖 Record 返回形)。
    return this.attachHealNotes(await this.withToolDeadline(this.flowStatusUnbounded(), "flow 状态快照"));
  }
  private async flowStatusUnbounded(): Promise<Record<string, unknown>> {
    const ready = await this.ensureReady();
    const pid = await this.ensureProjectId();
    const [credits, data] = await Promise.all([this.getCredits(), this.getProjectData(pid)]);
    const media = (data?.projectContents?.media ?? []).map((m: any) => {
      const mapped = mapMediaStatus(m);
      return {
        mediaId: m?.name,
        status: mapped.status,
        kind: m?.video?.generatedVideo ? "video" : m?.image?.generatedImage ? "image" : "unknown",
        ...(m?.video?.generatedVideo?.model ? { model: m.video.generatedVideo.model } : {}),
      };
    });
    // per-key 真实积分价与需求/可用性(契约 §2.3 usages[].creditMapping/requirements)透传 —— audit finding-8:
    // 选模型依据不再只剩 hint 里的静态估算区间;creditsAtServiceTier = creditMapping[当前 serviceTier].cost
    const tier = (credits as any)?.serviceTier;
    const usageOut = (u: any) => ({
      key: u?.key,
      generationTimeSeconds: u?.generationTimeSeconds,
      ...(Array.isArray(u?.requirements) ? { requirements: u.requirements } : {}),
      ...(u?.creditMapping && typeof u.creditMapping === "object" ? { creditMapping: u.creditMapping } : {}),
      ...(u?.creditMapping && tier && u.creditMapping[tier]?.cost != null ? { creditsAtServiceTier: u.creditMapping[tier].cost } : {}),
      // §14.1 inputSpec 透传(r2v 参考图/音频上限的动态真源;maxImageInputs 是 usage 顶层字段)
      ...(Number.isFinite(u?.maxImageInputs) || Number.isFinite(u?.inputSpec?.maxAudioReferences)
        ? { inputSpec: { ...(Number.isFinite(u?.maxImageInputs) ? { maxImageInputs: u.maxImageInputs } : {}), ...(u?.inputSpec && typeof u.inputSpec === "object" ? u.inputSpec : {}) } }
        : {}),
      ...(u?.outputsAudio === true ? { outputsAudio: true } : {}),
    });
    const imageFamilies = (data?.modelConfig?.imageModelFamilies ?? []).map((f: any) => ({
      id: f?.id,
      displayName: f?.displayName,
      usages: (f?.usages ?? []).map((u: any) => ({ ...usageOut(u), maxImageReferences: u?.maxImageReferences })),
    }));
    const videoFamilies = (data?.modelConfig?.videoModelFamilies ?? []).map((f: any) => ({
      id: f?.id,
      displayName: f?.displayName,
      usages: (f?.usages ?? []).map((u: any) => ({ ...usageOut(u), supportedAspectRatios: u?.supportedAspectRatios })),
    }));
    // 30 预设语音(§8.8/§11.4:externalReferenceMedia 的 AUDIO 条目,entry.media.audio.generatedAudio;只读 0 点)
    const voices = (data?.projectContents?.externalReferenceMedia ?? [])
      .filter((e: any) => e?.media?.audio?.generatedAudio?.isPresetAudioSample === true)
      .map((e: any) => {
        const g = e.media.audio.generatedAudio;
        // id/mediaId 同值(mediaId = audioMediaIds 词表;id 兼容别名,见 listPresetVoices)
        const id = typeof e?.mediaId === "string" ? e.mediaId : String(g?.name ?? "").toLowerCase();
        return {
          id,
          mediaId: id,
          displayName: g?.name,
          ...(typeof g?.description === "string" ? { description: g.description } : {}),
        };
      });
    return {
      ok: true,
      provider: "flow",
      page_url: ready.pageUrl,
      email: ready.email,
      project_id: pid,
      project_url: `${LABS_ORIGIN}/fx/zh/tools/flow/project/${pid}`,
      credits,
      image_families: imageFamilies,
      video_families: videoFamilies,
      ...(voices.length ? { preset_voices: voices } : {}),
      media,
      hint: `${flowSnapshotCostHintZh()}。create_video(provider=flow)已开放(全部模式 live 已验证,契约 §15):t2v / i2v(image)/ 参考图(r2v + images,可叠加 audioMediaIds 挂预设语音,live 实证生效)/ 首尾帧(keyframes 2 张)/ 延长(extension + videoMediaId)/ 编辑(edit + videoMediaId + prompt,abra_edit)/ 视频超分(veo_3_1_upsampler_1080p + videoMediaId,${flowCreditsZh("veo_3_1_upsampler_1080p")});generate_image(provider=flow)支持 images(底图+参考)与 GEM_PIX_2_UPSAMPLE_2K 放大;flow_status(deleteMediaIds) 删媒体 / (shareMediaIds) 生成公开分享链接 / (cancelMediaIds) 取消生成中任务;无参 flow_status() 快照的 preset_voices 字段列 30 预设语音(全 ${FLOW_ZERO_CREDIT} 点,mediaId 亦作 r2v audioMediaIds 输入)。`,
    };
  }

  // ── 上传(契约 §7.1,live 200 实证:0 点、无需 reCAPTCHA) ──

  /**
   * 把一张图上传为 Flow 项目内媒体(生图 imageInputs 与视频 start/endImage 的公共前置)。
   * data: URI 本地解析;http(s) 经 Node fetch 下载(页面上下文 fetch 外站会撞 CORS)。
   * 返回 mediaId + 嗅探出的尺寸(供 imageInputs.aspectRatio)。
   */
  async uploadMedia(imageUri: string, opts: { fileName?: string } = {}): Promise<{
    mediaId: string; mimeType: string; width?: number; height?: number; imageAspect?: FlowImageAspect; raw: unknown;
  }> {
    await this.ensureReady();
    const img = await loadImageBytes(imageUri);
    const pid = await this.ensureProjectId();
    const token = await this.getAccessToken();
    const body = {
      clientContext: { projectId: pid, tool: TOOL_INTERNAL_NAME, sessionId: wireSessionId() },
      cropCoordinates: {},
      ...(opts.fileName ?? img.fileName ? { fileName: opts.fileName ?? img.fileName } : {}),
      imageBytes: img.bytes.toString("base64"),
      isHidden: false,
      isNotIngredient: false,
      isUserUploaded: true,
      mediaGenerationContext: { batchId: crypto.randomUUID() },
      mediaIdSeed: crypto.randomUUID(),
      mimeType: img.mimeType,
      parentMediaGenerationId: "",
      workflowIdSeed: crypto.randomUUID(),
    };
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/flow/uploadImage`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      bodyB64: utf8ToB64(JSON.stringify(body)),
    });
    if (!f.ok) {
      throw new FlowError("S201", `图片上传 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: f.status });
    }
    let r: any;
    try { r = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "图片上传响应体非 JSON", { flowStatus: 0 }); }
    const mediaId = r?.media?.name;
    if (typeof mediaId !== "string" || !mediaId) {
      throw new FlowError("S202", `图片上传响应无 media.name:${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: 0 });
    }
    return {
      mediaId,
      mimeType: img.mimeType,
      ...(img.width != null && img.height != null ? { width: img.width, height: img.height } : {}),
      ...(img.width != null && img.height != null ? { imageAspect: ratioToImageAspect(img.width, img.height) } : {}),
      raw: r,
    };
  }

  /** 视频请求的图片输入(契约 §7.3):上传 → {aspectRatio?, mediaId}(mediaId 与 imageBytes 是 oneof,只发 mediaId)。 */
  private async videoImageInput(imageUri: string): Promise<{ aspectRatio?: string; mediaId: string }> {
    const up = await this.uploadMedia(imageUri);
    return { ...(up.imageAspect ? { aspectRatio: `IMAGE_ASPECT_RATIO_${up.imageAspect}` } : {}), mediaId: up.mediaId };
  }

  // ── 生图(契约 §2.4;带图链路 §7.2,live 200 实证) ──

  /**
   * 🔴 消耗点(生图提交;契约 §3:当前 tier 图片全部 0 点,但会真实占用生成队列)。
   * 测试铁律:测试代码不得调用本方法打真实网络(stub transport 除外)。
   * 流程:batchGenerateImages 提交 → 轮询 projectInitialData 至 SUCCESSFUL → 下载字节 → data: URI 返回。
   * images(2026-08-23 开放):images[0] = base image(IMAGE_INPUT_TYPE_BASE_IMAGE,比例随底图 → UNSPECIFIED),
   * images[1..] = references(IMAGE_INPUT_TYPE_REFERENCE;base+refs 合计上限 10,契约 §7.2)。
   */
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    // 防 stall:生图轮询内部兜底 240s,超 120s 红线 —— 工具级截止 110s 封顶(S410 诚实降级;
    // 覆盖普通生图与 GEM_PIX_2_UPSAMPLE_2K 放大两条路径)
    return this.attachHealNotes(await this.withToolDeadline(this.generateImageUnbounded(req), "flow 生图"));
  }
  private async generateImageUnbounded(req: ImageRequest): Promise<ImageResult> {
    await this.ensureReady();
    const model = req.model ?? this.models?.image?.default ?? "NARWHAL";
    if (!FLOW_IMAGE_MODELS.includes(model)) {
      throw new FlowError("S300", `未知图片模型 "${model}"。可用:${FLOW_IMAGE_MODELS.join(", ")}`);
    }
    if (model === "GEM_PIX_2_UPSAMPLE_2K") {
      // 2K 放大走独立端点 /v1/flow/upsampleImage(契约 §9.5/E 轮 bundle Zod 全 schema + §10.8 action=IMAGE_GENERATION),
      // 不作普通生图模型提交;输入 images[0] = 已有图片 mediaId 或 http(s)/data: URI(先上传,0 点)。
      return this.generateUpscaledImage(req);
    }
    const pid = await this.ensureProjectId();
    const warnings: string[] = [];
    // 带图链路(契约 §7.2):先上传为项目内媒体,imageInputs 用 {imageInputType, name=mediaId} 引用
    let imageInputs: Array<{ imageInputType: string; name: string }> = [];
    if (req.images?.length) {
      if (req.images.length > 10) {
        throw new FlowError("S301", `images 数量 ${req.images.length} 超上限(Flow base image + references 合计最多 10,契约 §7.2 maxImageReferences)`);
      }
      const uploads: Array<{ mediaId: string }> = [];
      for (const uri of req.images) uploads.push(await this.uploadMedia(uri));
      imageInputs = [
        { imageInputType: "IMAGE_INPUT_TYPE_BASE_IMAGE", name: uploads[0].mediaId },
        ...uploads.slice(1).map((u) => ({ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: u.mediaId })),
      ];
    }
    // 比例优先级:一等 aspect 参数(UI 语义 16:9 等)> extra.imageAspectRatio(原始枚举,直调口)> size 最近似映射;
    // 带底图时强制 UNSPECIFIED(比例随底图,客户端实证契约 §7.2),用户显式传的比例告警后忽略
    const explicitAspect = Boolean(req.aspect || req.extra?.imageAspectRatio || (req.size && /^\s*\d+\s*x\s*\d+\s*$/i.test(req.size)));
    const aspect: string = imageInputs.length
      ? "UNSPECIFIED"
      : req.aspect
        ? aspectRatioToImageAspect(req.aspect)
        : ((req.extra?.imageAspectRatio as string | undefined) ?? sizeToImageAspect(req.size));
    if (imageInputs.length && explicitAspect) {
      warnings.push(`带底图生图的比例随底图(imageAspectRatio 强制 IMAGE_ASPECT_RATIO_UNSPECIFIED),已忽略传入的比例参数。`);
    }
    if (aspect !== "UNSPECIFIED" && !IMAGE_ASPECTS.includes(aspect as FlowImageAspect)) {
      throw new FlowError("S301", `imageAspectRatio 非法:${aspect}(合法:${IMAGE_ASPECTS.join("/")})`);
    }
    // seed:一等字段(工具层可达)优先,extra.seed 保留为 provider 直调透传口(audit finding-2)
    const imageSeed = req.seed ?? (typeof req.extra?.seed === "number" ? (req.extra.seed as number) : undefined);
    const submitted = await this.submitImages(pid, model, aspect, req.prompt, imageSeed, imageInputs);
    // 轮询至完成(实测 ~30-40s)
    const finished = await this.pollMediaUntilDone(submitted.mediaIds, 240_000, 5_000);
    const outputs = [];
    for (const item of finished.done) {
      const got = await this.getMediaBytes(item.mediaId);
      outputs.push({
        url: `data:${got.contentType.split(";")[0] || "image/png"};base64,${got.buf.toString("base64")}`,
        // mediaId/seed 回填:outputs ↔ Flow media 的对应关系可反查(flow_status(mediaId) 复下载/复现)—— audit finding-13
        mediaId: item.mediaId,
        ...(item.gen?.seed != null ? { seed: item.gen.seed } : {}),
      });
    }
    if (finished.failed.length) {
      warnings.push(`${finished.failed.length} 个媒体未成功:${finished.failed.map((x) => `${x.mediaId}(${x.rawStatus ?? "?"})`).join("; ")}`);
    }
    if (finished.timeout.length) {
      // 超时集不得静默丢弃(audit finding-17):部分完成部分超时时,超时项也必须可见
      warnings.push(`${finished.timeout.length} 个媒体轮询超时未到终态(${finished.timeout.join(", ")}),可用 flow_status(mediaId) 复查后下载。`);
    }
    if (!outputs.length) {
      throw new FlowError("S401", `图片生成失败(0 张产出;已提交 mediaId:${submitted.mediaIds.join(",")})`, { hint: "可带 mediaId 调 flow_status 复查状态" });
    }
    return { outputs, warnings: warnings.length ? warnings : undefined };
  }

  /** 🔴 消耗点(生图 POST;0 点)。构造契约 §2.4/§7.2 body 并提交,返回 SCHEDULED mediaId。 */
  private async submitImages(
    pid: string,
    model: string,
    aspect: string,
    prompt: string,
    seed?: number,
    imageInputs: Array<{ imageInputType: string; name: string }> = [],
  ): Promise<{ mediaIds: string[]; raw: any }> {
    const token = await this.getAccessToken();
    const recaptcha = await this.recaptchaTokenAuto(RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION_IMAGE);
    const clientContext = {
      recaptchaContext: { token: recaptcha, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
      projectId: pid,
      tool: TOOL_INTERNAL_NAME,
      sessionId: wireSessionId(),
    };
    const body = {
      clientContext,
      mediaGenerationContext: { batchId: crypto.randomUUID() },
      useNewMedia: true,
      requests: [{
        clientContext,
        imageModelName: model,
        imageAspectRatio: `IMAGE_ASPECT_RATIO_${aspect}`,
        structuredPrompt: { parts: [{ text: prompt }] },
        seed: seed ?? crypto.randomInt(1_000_000),
        imageInputs,
      }],
    };
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/projects/${pid}/flowMedia:batchGenerateImages`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      bodyB64: utf8ToB64(JSON.stringify(body)),
    });
    if (!f.ok) {
      throw new FlowError("S201", `生图提交 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: f.status });
    }
    let r: any;
    try { r = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "生图提交响应体非 JSON", { flowStatus: 0 }); }
    const mediaIds = (r?.media ?? []).map((m: any) => m?.name).filter((x: unknown): x is string => typeof x === "string");
    if (!mediaIds.length) throw new FlowError("S202", `生图提交响应无 media:${bufToUtf8(f.bodyB64).slice(0, 200)}`, { flowStatus: 0 });
    return { mediaIds, raw: r };
  }

  /**
   * 轮询一组 mediaId 至终态(completed/failed;超时返回 timeout 集)。零消耗(只读 projectInitialData)。
   * done 项携带该媒体的生成结果(gen = generatedImage/generatedVideo,含 seed)供 outputs 回填。
   */
  private async pollMediaUntilDone(mediaIds: string[], timeoutMs: number, intervalMs: number): Promise<{ done: Array<{ mediaId: string; gen?: any }>; failed: Array<{ mediaId: string; rawStatus?: string }>; timeout: string[] }> {
    const deadline = Date.now() + timeoutMs;
    const pending = new Set(mediaIds);
    const done: Array<{ mediaId: string; gen?: any }> = []; const failed: Array<{ mediaId: string; rawStatus?: string }> = []; const timeout: string[] = [];
    for (;;) {
      const data = await this.getProjectData();
      for (const mediaId of [...pending]) {
        const m = (data?.projectContents?.media ?? []).find((x: any) => x?.name === mediaId);
        const mapped = mapMediaStatus(m);
        if (mapped.status === "completed") {
          done.push({ mediaId, gen: m?.image?.generatedImage ?? m?.video?.generatedVideo });
          pending.delete(mediaId);
        }
        else if (mapped.status === "failed") { failed.push({ mediaId, rawStatus: mapped.rawStatus }); pending.delete(mediaId); }
      }
      if (!pending.size) return { done, failed, timeout };
      if (Date.now() >= deadline) { timeout.push(...pending); return { done, failed, timeout }; }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ── 生视频(契约 §7.3 v2 wire:每模式独立端点 + requests[]/videoModelKey/useV2ModelConfig) ──

  /**
   * 🔴🔴 消耗点(视频提交;全部价文案经 B9 格式层从 staticTierCosts 生成,见 videoCostTableHintZh)。
   * 提交即排队(submit-only 队列语义):本方法只提交返回 handle(SCHEDULED),绝不等待生成;
   * 轮询由工具层 waitVideo/getVideo 驱动(getVideo = 零消耗只读)。
   * 测试铁律:测试代码不得让本方法打真实网络(stub transport 除外)。
   *
   * 2026-08-23 wire 勘误+开放(契约 §7.3,live 实证):
   *   - 请求侧是 v2 形状(requests[]/videoModelKey/useV2ModelConfig),顶层 structuredPrompt/seed/
   *     videoModelControlInput 全部 400 "Unknown name"(§2.5 的旧形状是响应侧结构误当同构)
   *   - 开放模式:t2v(纯文本)/ i2v(req.image,START_IMAGE,✅ live 200)/
   *     interpolation(req.keyframes 2 张 = 首帧+尾帧,✅ live 200)
   *   - r2v/extension/edit/upsampler 仍 S303 拒绝,错误消息带依据(§7.3 NOT_OPEN_REASONS)
   *   - durationSeconds 非 {4,6,8,10} → 吸附 + warning(与通用 schema nearest 承诺一致)
   *   - resolution/negativePrompt 被 flow 丢弃 → 必出 warning 不静默(audit finding-3/10)
   */
  async createVideo(req: VideoRequest): Promise<VideoTask> {
    // 防 stall:提交虽是 submit-only,但 r2v 逐张上传(abra 最多 7 张 / veo 3 张,§14.1 inputSpec)
    // 最坏路径超红线 —— 工具级截止 110s 封顶(S410;底层不取消,提交结果稍后经 flow_status 可达)
    return this.attachHealNotes(await this.withToolDeadline(this.createVideoUnbounded(req), "flow 视频提交"));
  }

  // ── 计费确认门(用户核心诉求;两段式 —— MCP 无交互回调,确认经 confirmToken 二次调用表达) ──

  /**
   * 解析本请求将提交的 usage key(createVideoUnbounded 同一真源:模型缺省 S300 + key/duration
   * 校验)。计费确认门据此在提交前得出与提交完全一致的 key,令牌绑定才可靠。
   */
  private resolveBillingKey(req: VideoRequest): { key: string; duration: number; warnings: string[] } {
    const model = req.model ?? this.models?.video?.default;
    if (!model) {
      throw new FlowError("S300", `视频模型未指定(刻意无默认:提交视频消耗积分)。传 model(如 abra_t2v_8s / veo_3_1_t2v_lite / abra_i2v_8s + image / veo_3_1_interpolation_lite + keyframes)或在 config.json providers.flow.models.video.default 配置。可用:${summarizeModels()}`, {
        hint: videoCostTableHintZh(),
      });
    }
    const rawDuration = req.durationSeconds ?? (req.numFrames != null ? req.numFrames / (req.frameRate ?? FLOW_FRAME_RATE) : undefined);
    const duration = snapDuration(rawDuration);
    return resolveVideoModelKey(model, rawDuration == null ? undefined : duration, this.listVideoModels());
  }

  /**
   * 提交前的本地形状校验(渠道差异内聚;createVideoUnbounded 与 beginSubmissionConfirm 共用真源):
   * 模式门禁(S303)+ 输入形态互斥(S301)+ 模式↔输入交叉校验(S301)+ r2v 输入上限(§14.1 inputSpec)。
   * 网络侧校验(videoMediaId 存在性/类型/完成态、audioMediaIds 预设语音存在性)留 createVideo ——
   * 确认门阶段只做零消耗本地检查。
   * 返回 warnings + 输入形态(端点选择/上传复用,单一推导源)。
   */
  private assertVideoInputShape(key: string, mode: string | undefined, req: VideoRequest): {
    warnings: string[]; hasImage: boolean; kfCount: number; refCount: number; videoSource: string; audioCount: number; audioCap: number;
  } {
    const warnings: string[] = [];
    assertModeOpen(key, mode);
    // ratio 前置校验(与提交点 videoAspectRatioFor 同源文案):generation 类 key 仅 16:9/9:16 ——
    // 确认门不让用户确认一个注定 S301 的请求(不变量:S300/S301 早失败)。extension/upsampler/edit
    // 的方向继承源视频(videoAspectOfSource),不检。
    if (req.ratio && mode !== "extension" && mode !== "upsampler" && mode !== "edit"
      && req.ratio !== "16:9" && req.ratio !== "9:16") {
      throw new FlowError("S301", `视频比例仅支持 16:9 / 9:16(收到 "${req.ratio}";图片比例才支持 1:1/4:3/3:4)`);
    }
    const ratioWarn = videoRatioKeyWarning(req.ratio, key);
    if (ratioWarn) warnings.push(ratioWarn);
    const hasImage = Boolean(req.image);
    const kfCount = req.keyframes?.length ?? 0;
    const refCount = req.images?.length ?? 0;
    const videoSource = req.videoMediaId?.trim() || "";
    const audioIds = req.audioMediaIds ?? [];
    // r2v 输入上限(§14.1):动态 inputSpec(目录缓存)优先,静态快照兜底(abra 7/5、veo 3/1),未知家族保守 10
    const dynCaps = this.dynamicCatalog && Date.now() - this.dynamicCatalog.at < this.dynamicCatalogTtlMs
      ? this.dynamicCatalog.inputByKey?.[key] : undefined;
    const caps = dynCaps && (dynCaps.maxImageInputs != null || dynCaps.maxAudioReferences != null)
      ? { images: dynCaps.maxImageInputs ?? staticR2vCaps(key)?.images ?? 10, audio: dynCaps.maxAudioReferences ?? staticR2vCaps(key)?.audio ?? 0 }
      : staticR2vCaps(key) ?? { images: 10, audio: 0 };
    const capSource = dynCaps && (dynCaps.maxImageInputs != null || dynCaps.maxAudioReferences != null)
      ? "目录 inputSpec" : staticR2vCaps(key) ? "契约 §14.1 静态快照" : "未知家族保守值";
    if (audioIds.length) {
      // v1 收窄(D-3):音频参考只随 r2v 开放 —— edit 已 live(§15)但音频叠加仍只在 r2v 实证过
      // AUDIO_REFERENCE 是 r2v/edit 的可选叠加项(§14.1),其余模式(纯 t2v/i2v/首尾帧)无该 requirement。
      if (mode != null && mode !== "r2v") {
        throw new FlowError("S301", `audioMediaIds 音频参考需 r2v 模式 key(如 abra_r2v_8s,实验期 Match Voice to Visuals),当前 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式`, { hint: `音频 mediaId 清源 = 无参 flow_status() 快照的 preset_voices 字段(30 预设语音,${FLOW_ZERO_CREDIT} 点);用户自有音频上传 wire 未逆向,暂不支持` });
      }
      if (mode == null) warnings.push(`模型 "${key}" 模式未知,音频参考已随参考图(ReferenceImages)端点提交。`);
      if (audioIds.length > caps.audio) {
        throw new FlowError("S301", `audioMediaIds 数量 ${audioIds.length} 超上限(该 key ${caps.audio},${capSource})`);
      }
    }
    // 输入形态互斥:image(单起始图)/ keyframes(首尾帧)/ images(参考图)/ videoMediaId(视频引用);
    // audioMediaIds 是 images(r2v)的可选叠加输入,不单占一形态(r2v 无 images 时 audio 无载体 → else 分支拦截)
    const forms: string[] = [];
    if (hasImage) forms.push("image");
    if (kfCount) forms.push("keyframes");
    if (refCount) forms.push("images");
    if (videoSource) forms.push("videoMediaId");
    if (forms.length > 1) {
      throw new FlowError("S301", `输入参数互斥(${forms.join(" + ")} 同时传入):image=图生视频起始图 / keyframes=首尾帧 / images=参考图(r2v)/ videoMediaId=视频引用(extension/超分),一次只能选一种`);
    }
    if (videoSource) {
      if (mode != null && mode !== "extension" && mode !== "upsampler" && mode !== "edit") {
        throw new FlowError("S301", `videoMediaId 需 extension/upsampler/edit 模式 key(如 veo_3_1_extension_lite / veo_3_1_upsampler_1080p / abra_edit),当前 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式`);
      }
    }
    if (hasImage) {
      if (mode != null && mode !== "i2v") {
        throw new FlowError("S301", `image 起始图需 i2v 模式 key(如 abra_i2v_8s / veo_3_1_i2v_lite),当前 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式`);
      }
      if (mode == null) warnings.push(`模型 "${key}" 模式未知(目录新增家族),已按起始图(Image)端点提交。`);
    } else if (kfCount) {
      if (kfCount !== 2) {
        throw new FlowError("S301", `keyframes 需要恰好 2 张(首帧+尾帧),收到 ${kfCount} 张`);
      }
      if (mode != null && mode !== "interpolation") {
        throw new FlowError("S301", `首尾帧需 interpolation/_fl 模式 key(如 veo_3_1_interpolation_lite / veo_3_1_i2v_s_fast_fl),当前 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式`);
      }
      if (mode == null) warnings.push(`模型 "${key}" 模式未知(目录新增家族),已按首尾帧(StartAndEndImage)端点提交。`);
    } else if (refCount) {
      // r2v 参考图(§9.3:referenceImages entry = {aspectRatio, mediaId};上传 0 点)
      if (refCount > caps.images) {
        throw new FlowError("S301", `images 参考图数量 ${refCount} 超上限(该 key ${caps.images},${capSource};契约 §14.1:abra r2v=7 / veo r2v=3)`);
      }
      if (mode != null && mode !== "r2v") {
        throw new FlowError("S301", `images 参考图需 r2v 模式 key(如 abra_r2v_8s / veo_3_1_r2v_lite),当前 "${key}" 是 ${VIDEO_MODE_LABELS[mode] ?? mode}(${mode})模式`);
      }
      if (mode == null) warnings.push(`模型 "${key}" 模式未知(目录新增家族),已按参考图(ReferenceImages)端点提交。`);
    } else if (videoSource) {
      if (mode === "upsampler" && req.prompt?.trim()) {
        warnings.push("视频超分不消费 prompt(契约 §9.1 wire 无 textInput),已忽略提示词。");
      }
      if (mode === "edit" && !req.prompt?.trim()) {
        throw new FlowError("S301", "edit 模式需要 prompt(编辑指令,如 \"make it snow\"),描述要对源视频做什么");
      }
    } else {
      if (audioIds.length) {
        throw new FlowError("S301", `audioMediaIds 音频参考是 r2v images 的叠加输入,须同时传 images(1-${caps.images} 张参考图)`);
      }
      if (mode === "i2v") {
        throw new FlowError("S301", `i2v 模式 key 需要传 image 起始图;纯文生视频请用 t2v key(如 ${key.replace(/i2v/, "t2v")})`);
      }
      if (mode === "interpolation") {
        throw new FlowError("S301", "首尾帧模式 key 需要传 keyframes(2 张 = 首帧+尾帧);纯文生视频请用 t2v key");
      }
      if (mode === "r2v") {
        throw new FlowError("S301", `r2v 模式 key 需要传 images(1-${caps.images} 张参考图);纯文生视频请用 t2v key(如 ${key.replace(/r2v/, "t2v")})`);
      }
      if (mode === "extension" || mode === "upsampler" || mode === "edit") {
        throw new FlowError("S301", `${VIDEO_MODE_LABELS[mode]}模式 key 需要传 videoMediaId(项目内已有视频的 mediaId,可经 flow_status 查看;延长/编辑/超分直接引用生成视频,无需上传)`);
      }
    }
    return { warnings, hasImage, kfCount, refCount, videoSource, audioCount: audioIds.length, audioCap: caps.audio };
  }

  /**
   * 🔴 计费确认门(types.ts VideoProvider.beginSubmissionConfirm;handler 在每个真实提交点前调用):
   * - 第一段(无 confirmToken):预估消耗 >0 积分 → 返回挑战(handler 原样返回,绝不提交)——
   *   预估积分(动态 creditMapping 优先 / 静态契约表兜底)+ 短时效确认令牌 + 指引。
   * - 第二段(带 confirmToken):校验(令牌与「最终 key + 预估 + prompt + 输入引用」绑定 + TTL)→ 通过返回 undefined 放行。
   * 0 积分提交(veo_3_1_upsampler_1080p)不触发;flow.videoConfirm=false 整门关闭。
   * 模型/形状校验与提交同源(S300/S301 早失败 —— 不让用户确认一个注定失败的请求)。
   */
  async beginSubmissionConfirm(req: VideoRequest, confirmToken?: string): Promise<SubmissionConfirm | undefined> {
    if (this.flowCfg?.videoConfirm === false) return undefined;
    // 动态目录先刷新(0 点只读,10min TTL;失败静默回落静态):key 校验与预估都用动态真源 ——
    // 目录新增 key(静态快照无)在门口即可解析,价目取实时 creditMapping。
    await this.withToolDeadline(this.refreshCatalogIfStale(), "flow 确认门目录刷新");
    const resolved = this.resolveBillingKey(req);
    this.assertVideoInputShape(resolved.key, videoModeOfKey(resolved.key), req);
    const cost = await this.withToolDeadline(this.lookupVideoCost(resolved.key), "flow 确认门预估");
    this.assertTierAvailable(resolved.key, cost); // D-4:注定失败的请求不发确认令牌(用户确认了也只会碰壁)
    if (cost.credits === 0) return undefined;
    const credits = cost.credits; // null = 目录新增 key 静态表无价 → 保守仍要求确认
    const digest = this.confirmDigest(resolved.key, credits, req);
    if (!confirmToken) {
      return {
        needConfirm: true,
        provider: "flow",
        model: resolved.key,
        estimatedCost: credits,
        costSource: cost.source,
        ...(cost.balance != null && credits != null
          ? { currentBalance: cost.balance, estimatedBalanceAfter: Math.max(0, cost.balance - credits) }
          : {}),
        confirmToken: this.mintConfirmToken(digest),
        expiresInSeconds: Math.round(this.confirmTtlMs() / 1000),
        hint: `本次 create_video(provider=flow)将提交 Flow 视频生成,预计消耗 ${credits ?? "未知"} 积分(${cost.source === "dynamic" ? "动态目录实时价" : cost.source === "static-tier" ? "静态 per-tier 价(契约 §14.4)" : "tier 盲静态估算,flow_status 可查动态价"}${credits == null ? ";该 key 无静态价,提交后以实际扣减为准" : ""})。确认请用原参数加 confirmToken 重新调用;模型/时长/预估/prompt/输入引用(image/keyframes/images/videoMediaId/audioMediaIds)任一变化都会使令牌失效。0 积分操作(如 veo_3_1_upsampler_1080p)不触发本门;config 顶级 flow.videoConfirm=false 可关闭本门。`,
      };
    }
    this.verifyConfirmToken(confirmToken, digest); // 失败抛 [flow] S320/S321
    return undefined; // 放行提交
  }

  /** 动态目录过期则刷新(0 点只读 projectInitialData;失败静默 —— 静态快照兜底)。幂等。 */
  private async refreshCatalogIfStale(): Promise<void> {
    if (this.dynamicCatalog && Date.now() - this.dynamicCatalog.at < this.dynamicCatalogTtlMs) return;
    try { await this.getProjectData(); } catch { /* 环境不可用 → 静态兜底 */ }
  }

  /**
   * 查询 key 的积分价(0 点只读):动态 creditMapping(projectInitialData 缓存;过期则尽力 live 刷一次,
   * Chrome 未开/网络失败静默回落)优先 → 静态 per-tier 矩阵(§14.4 staticTierCosts,当前 tier 已知时)
   * → tier 盲静态估算(estimateVideoCredits)最后兜底。
   * 附带当前余额/tier(尽力而为,不可得不阻断预估)与 unavailableAtTier:
   * 🔴 目录真值里 cost 可以是字符串 "UNAVAILABLE"(§14.4 per-tier 矩阵)—— 该 key 在当前会员档
   * 不可用,提交注定失败。旧版把 NaN 静默落回 tier 盲估算(如 fast_ultra 在 INTERMEDIATE 静态估 20,
   * 用户确认后才在上游碰壁)—— 现在显式标出,由 assertTierAvailable 在确认门前拦截(S303)。
   * noRefresh=true(提交点调用):只用已缓存目录 + credits + 静态矩阵,不刷 projectInitialData ——
   * 守住「计费/tier 查找本身不新增项目数据读」的不变量(单测钉死纯提交路径零轮询;音频预设校验与
   * videoMediaId 校验的既有合法读不受影响);确认门(beginSubmissionConfirm)先行刷新过目录,
   * 10min TTL 内提交点看到的就是同一份。
   */
  private async lookupVideoCost(key: string, opts: { noRefresh?: boolean } = {}): Promise<{
    credits: number | null; source: "dynamic" | "static-tier" | "static"; balance?: number; tier?: string;
    unavailableAtTier?: boolean; tierMatrix?: string;
  }> {
    if (!opts.noRefresh) await this.refreshCatalogIfStale();
    let balance: number | undefined;
    let tier: string | undefined;
    try {
      const c = await this.getCredits();
      if (typeof c.credits === "number") balance = c.credits;
      tier = c.serviceTier;
    } catch { /* 余额/档位不可得 → 不阻断预估 */ }
    const cat = this.dynamicCatalog && Date.now() - this.dynamicCatalog.at < this.dynamicCatalogTtlMs ? this.dynamicCatalog : null;
    const mapping = cat?.creditByKey?.[key];
    if (mapping && tier && mapping[tier] != null) {
      const raw = mapping[tier]?.cost;
      if (raw === "UNAVAILABLE") {
        return { credits: null, source: "dynamic", balance, tier, unavailableAtTier: true, tierMatrix: formatTierMatrix(mapping) };
      }
      if (Number.isFinite(Number(raw))) return { credits: Number(raw), source: "dynamic", balance, tier };
    }
    // 静态 per-tier 矩阵兜底(无动态目录/该 tier 无动态条目时;tier 已知才可用)
    const stat = staticTierCosts(key);
    if (stat && tier && stat[tier as FlowServiceTier] != null) {
      const v = stat[tier as FlowServiceTier]!;
      if (v === "UNAVAILABLE") return { credits: null, source: "static-tier", balance, tier, unavailableAtTier: true, tierMatrix: formatTierMatrix(stat) };
      return { credits: v, source: "static-tier", balance, tier };
    }
    return { credits: estimateVideoCredits(key) ?? null, source: "static", balance, tier };
  }

  /**
   * tier 门禁(D-4,确认门与提交前的双拦):目录真值说该 key 在当前会员档 UNAVAILABLE → S303,
   * 错误消息带完整 per-tier 矩阵(双向:不止拦「本 tier 无价」,也告知其他 tier 的真实价,
   * 如 INTERMEDIATE 用户问 fast_ultra 得到「ADVANCED=10 / INTERMEDIATE=UNAVAILABLE」而非错误的 20)。
   * 纯本地判断(消费 lookupVideoCost 结果,不发新请求)。
   */
  private assertTierAvailable(key: string, cost: { unavailableAtTier?: boolean; tier?: string; tierMatrix?: string; source: string }): void {
    if (!cost.unavailableAtTier) return;
    throw new FlowError(
      "S303",
      `模型 "${key}" 在当前会员档(${cost.tier ?? "未知 tier"})UNAVAILABLE,不能提交(per-tier 价:${cost.tierMatrix || "见 flow_status"};来源 ${cost.source === "dynamic" ? "动态目录实时值" : "契约 §14.4 静态快照"})`,
      { hint: `换当前档可用的 key(如 INTERMEDIATE/ENTRY 档用 veo_3_1_t2v_fast=${flowTierCost("veo_3_1_t2v_fast")} 或 lite=${flowTierCost("veo_3_1_t2v_lite")},ADVANCED 档才有 fast_ultra/_4s/_6s=${flowTierCost("veo_3_1_t2v_fast_ultra", "SERVICE_TIER_ADVANCED")} 与 low_priority=${flowTierCost("veo_3_1_t2v_lite_low_priority", "SERVICE_TIER_ADVANCED")})或升级会员档;完整 per-tier 价目可调 flow_status 查看` },
    );
  }

  // ── 确认令牌(无状态 HMAC:签名覆盖「签发时刻 + 请求计费摘要」,无需服务端存储) ──

  private confirmTtlMs(): number {
    const v = this.flowCfg?.confirmTtlMs;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_CONFIRM_TTL_MS;
  }
  /**
   * 请求计费摘要:令牌与「最终 usage key + 预估积分 + prompt 指纹 + 输入引用指纹」绑定 ——
   * 确认后改模型/时长/预估刷新/prompt/输入引用(image/keyframes/images/videoMediaId/audioMediaIds)都使旧令牌失效,
   * 兑现 schema 与挑战 hint 的「任何参数变化都会使令牌失效」承诺(计费安全本就由 key 决定,
   * 输入引用入摘要把该承诺从「计费面」扩展到「语义面」:确认后换底图/换源视频/换音频样本不能复用令牌)。
   */
  private confirmDigest(key: string, credits: number | null, req: VideoRequest): string {
    // F4(B3 nit):prompt/negativePrompt 摘入 digest
    const promptFp = crypto.createHash("sha256").update(`${req.prompt ?? ""}#${req.negativePrompt ?? ""}`).digest("hex").slice(0, 12);
    // 三审 finding-3:输入引用摘入 digest。keyframes 保序(首/尾帧位置有语义);images/audioMediaIds
    // 排序(参考图/音频样本是集合,顺序不改变请求语义);image/videoMediaId 单值原样。
    const inputsFp = crypto.createHash("sha256").update([
      req.image ?? "",
      ...(req.keyframes ?? []),
      ...(req.images ?? []).slice().sort(),
      req.videoMediaId ?? "",
      ...(req.audioMediaIds ?? []).slice().sort(),
    ].join("#")).digest("hex").slice(0, 12);
    return crypto.createHash("sha256").update(`${key}#${credits ?? "u"}#${promptFp}#${inputsFp}`).digest("hex").slice(0, 24);
  }
  private confirmMintSeq = 0; // 单调序号:同毫秒内多次 mint 不撞车(否则 token 逐字节相同会被单次消费误拒)
  /**
   * 安装级 HMAC 密钥(日志#15):读 ~/.media-gen-mcp/flow-confirm-secret;不存在则创建
   * (32B 随机,0600,原子 tmp+rename)。创建后重读一次盘面值 —— 两进程首次并发创建时
   * rename 后写者胜,重读使所有实例收敛到同一密钥(仅"创建-即-mint"的毫秒窗口存在理论竞态,
   * 失败方向=校验失败重取,安全无害)。读/写均失败时退化为进程内随机(=旧版进程绑定行为)。
   */
  private confirmSecret(): Buffer {
    if (this.confirmSecretCache?.length) return this.confirmSecretCache;
    const file = this.confirmSecretFile ?? FLOW_CONFIRM_SECRET_FILE;
    try {
      const raw = fs.readFileSync(file);
      if (raw.length >= 32) {
        this.confirmSecretCache = raw;
        return raw;
      }
    } catch { /* 不存在/不可读 → 走创建 */ }
    let secret = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, secret, { mode: 0o600 });
      fs.renameSync(tmp, file);
      // 竞态收敛:以 rename 落盘后的最终值为准(并发创建时后写者胜)
      const settled = fs.readFileSync(file);
      if (settled.length >= 32) secret = settled;
    } catch { /* 落盘失败 → 进程内随机兜底(退化为旧版进程绑定行为,保守安全) */ }
    this.confirmSecretCache = secret;
    return secret;
  }
  private mintConfirmToken(digest: string): string {
    const issuedAt = Date.now().toString(36);
    const seq = (this.confirmMintSeq++).toString(36);
    const mac = crypto.createHmac("sha256", this.confirmSecret()).update(`${issuedAt}.${seq}.${digest}`).digest("hex").slice(0, 32);
    return `${CONFIRM_TOKEN_PREFIX}.${issuedAt}.${seq}.${mac}`;
  }
  /** 读盘合并已消费令牌(顺序跨进程重放阻断,日志#15 安全红线);过期条目惰性清理。 */
  private syncConsumedFromDisk(): void {
    const file = this.confirmConsumedFile ?? FLOW_CONFIRM_CONSUMED_FILE;
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return; // 文件不存在/损坏 → 仅内存表(首次使用/并发写坏均可再生态)
    }
    const tokens = raw?.tokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return;
    const now = Date.now();
    for (const [t, exp] of Object.entries(tokens)) {
      if (typeof exp === "number" && exp > now) this.consumedConfirmTokens.set(t, exp);
    }
  }
  /**
   * 消费表原子写盘(tmp+rename;过期先清防文件膨胀)。失败不阻断(内存单次消费仍成立,仅跨进程降级)。
   * 跨进程丢失更新防线(B 白盒 2026-08-31):写盘前重读磁盘,把「本进程上次 sync 之后、本次 persist
   * 之前」其他进程落盘的未过期条目并入 —— 写的是【内存 ∪ 盘上未过期】的并集而非仅本进程内存表,
   * 把 finding 所述 sync→persist 窗口的丢失更新收敛掉(rename 原子语义不变;残余仅 persist 内部
   * read→rename 的微秒级窗口,与并发首消费同级 —— 威胁模型评估见字段注释)。
   * 权限 0600(对齐 confirmSecret 的 tmp 写法):文件含 TTL 内仍有效的一次性令牌,防同机他用户可读。
   */
  private persistConsumedTokens(): void {
    const file = this.confirmConsumedFile ?? FLOW_CONFIRM_CONSUMED_FILE;
    const now = Date.now();
    for (const [t, exp] of this.consumedConfirmTokens) if (exp <= now) this.consumedConfirmTokens.delete(t);
    try {
      const disk = JSON.parse(fs.readFileSync(file, "utf-8"))?.tokens;
      if (disk && typeof disk === "object" && !Array.isArray(disk)) {
        for (const [t, exp] of Object.entries(disk)) {
          if (typeof exp === "number" && exp > now && !this.consumedConfirmTokens.has(t)) this.consumedConfirmTokens.set(t, exp);
        }
      }
    } catch { /* 盘上无文件/损坏 → 并集退化为内存表(与 sync 的再生态一致) */ }
    const tokens: Record<string, number> = {};
    for (const [t, exp] of this.consumedConfirmTokens) tokens[t] = exp;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, tokens }, null, 0), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch { /* 见 doc:写失败保守为进程内单次消费 */ }
  }
  /** 校验令牌:格式 → 时钟 sanity → TTL(S321 过期)→ HMAC 常量时间比较(S320 不匹配)→ 跨进程单次消费(S320 已使用)。 */
  private verifyConfirmToken(token: string, digest: string): void {
    const reget = "不带 confirmToken 重新调用 create_video(原参数)即可获取新预估与令牌";
    const crossProcess = "跨进程说明:旧版本(≤0.15.0)令牌绑定进程,若你在两个独立进程/连接里分别发起两段调用,须改为同一持久会话;本版本起为安装级令牌(密钥 ~/.media-gen-mcp/flow-confirm-secret),已支持跨进程 —— 仍失败请确认两次调用在同一 HOME 下";
    const m = new RegExp(`^${CONFIRM_TOKEN_PREFIX}\\.([0-9a-z]+)\\.([0-9a-z]+)\\.([0-9a-f]{32})$`).exec(token);
    if (!m) {
      throw new FlowError("S320", `confirmToken 格式非法(应为 ${CONFIRM_TOKEN_PREFIX}.<时刻>.<序号>.<签名>,由确认门第一段返回)`, { hint: `${reget};${crossProcess}` });
    }
    const issuedAt = parseInt(m[1], 36);
    const age = Date.now() - issuedAt;
    if (!Number.isFinite(issuedAt) || age < -30_000) {
      throw new FlowError("S320", "confirmToken 签发时间非法(时钟异常)", { hint: reget });
    }
    if (age > this.confirmTtlMs()) {
      throw new FlowError("S321", `confirmToken 已过期(TTL ${Math.round(this.confirmTtlMs() / 1000)}s,两段式确认窗口内未完成)`, { hint: `${reget};${crossProcess}` });
    }
    const expect = crypto.createHmac("sha256", this.confirmSecret()).update(`${m[1]}.${m[2]}.${digest}`).digest("hex").slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(m[3], "hex"), Buffer.from(expect, "hex"))) {
      throw new FlowError("S320", "confirmToken 与当前请求不符(模型/时长/预估/prompt/输入引用(image/keyframes/images/videoMediaId/audioMediaIds)任一变化都会改变令牌绑定)", { hint: `${reget};确认后请勿改动参数;${crossProcess}` });
    }
    // B2-high 修复 + 日志#15 跨进程化:单次消费 —— 同一令牌只放行一次(防跨进程重放重复扣积分);
    // 校验前读盘合并其他进程的消费记录,通过即消费并原子写盘。顺序重放已阻断;并发首消费的
    // 毫秒级理论窗口为已知接受残留(见 consumedConfirmTokens 字段注释的威胁模型评估)。
    this.syncConsumedFromDisk();
    if (this.consumedConfirmTokens.has(token)) {
      throw new FlowError("S320", "confirmToken 已使用(单次消费语义,防重复扣积分;本表跨进程持久化)", { hint: reget });
    }
    this.consumedConfirmTokens.set(token, issuedAt + this.confirmTtlMs());
    this.persistConsumedTokens();
  }

  private async createVideoUnbounded(req: VideoRequest): Promise<VideoTask> {
    await this.ensureReady();
    const warnings: string[] = [];
    // 丢弃参数必须告警(项目纪律,对齐 zhipu 丢弃 ratio/negativePrompt/seed 的先例)
    if (req.negativePrompt) {
      warnings.push("flow 不支持 negativePrompt,已忽略(负向约束请写进 prompt)。");
    }
    if (req.resolution && req.resolution !== "720p") {
      // §14.3 实证:75/75 生成 usage 全部仅 720P(ultra/quality/_4s/_6s 变体同 720P)——
      // 「ultra 变体提分辨率」的旧指引是错的;唯一升分辨率路径 = 生成后超分。
      warnings.push(`flow 视频生成分辨率恒 720P(契约 §14.3:75/75 生成 usage 仅 720P,ultra/quality 变体同 720P),resolution=${req.resolution} 已忽略;更高分辨率只能生成后超分(veo_3_1_upsampler_1080p,${flowCreditsZh("veo_3_1_upsampler_1080p")};4K 需 ADVANCED ${flowTierCost("veo_3_1_upsampler_4k", "SERVICE_TIER_ADVANCED")} 点)。`);
    }
    // duration:numFrames/24 换算或 durationSeconds 原值 → 吸附到 Flow 合法集 {4,6,8,10}s
    // (通用 schema 承诺 "nearest valid";此前非集合值直接 S301 与承诺矛盾 —— audit finding-4)。
    // key 解析与计费确认门同源(resolveBillingKey):动态目录优先校验(10min 缓存;无缓存时静态快照
    // 兜底,audit finding-7);durationSeconds 只传用户显式信号(全 key 自带时长而无时长参数时传
    // undefined,让 embedded 时长生效 —— 否则默认吸附 8s 会与 "4s" 撞出伪冲突 S301)。
    const resolved = this.resolveBillingKey(req);
    if (req.durationSeconds != null && !FLOW_VIDEO_DURATIONS.includes(req.durationSeconds as any)) {
      warnings.push(`durationSeconds=${req.durationSeconds} 不在 Flow 合法集 {4,6,8,10}s,已吸附为 ${resolved.duration}s(与工具层 numFrames 最近吸附语义一致)。`);
    }
    warnings.push(...resolved.warnings);
    const mode = videoModeOfKey(resolved.key);
    const shape = this.assertVideoInputShape(resolved.key, mode, req);
    warnings.push(...shape.warnings);
    // tier 门禁(D-4):目录真值说该 key 当前档 UNAVAILABLE → 提交前 S303(读 credits + 已缓存目录,零消耗,
    // noRefresh 不拉 projectInitialData —— 提交路径不引入新的项目数据读)。
    // 确认门开着时 beginSubmissionConfirm 已查过同一真源(10min 缓存),这里是提交点自守 ——
    // videoConfirm=false / 链内直达 / 单测直呼 createVideo 的路径同样拦住。
    {
      const cost = await this.withToolDeadline(this.lookupVideoCost(resolved.key, { noRefresh: true }), "flow tier 门禁");
      this.assertTierAvailable(resolved.key, cost);
    }
    // 视频源校验(extension/upsampler/edit 共用,网络侧):必须在项目内、是视频、已完成(§9.1/§9.2 videoInput:{mediaId};
    // edit 同走 videoInput,E 轮 bundle Zod 定型 §11.1)
    let sourceMedia: any = null;
    if (shape.videoSource) {
      sourceMedia = await this.findMedia(shape.videoSource);
      if (sourceMedia?.image?.generatedImage && !sourceMedia?.video?.generatedVideo) {
        throw new FlowError("S301", `videoMediaId "${shape.videoSource}" 是 image 媒体,不能作视频延长/超分的源(需视频 mediaId,可经 flow_status 查看)`);
      }
      // 生成中守卫:单一真源 mapMediaStatus(02 R-CI-08)—— SCHEDULED/PENDING/ACTIVE 三枚举全拦
      // (§10.6/§10.7 live 实证 PENDING/ACTIVE 为 in_progress;旧手写 includes("SCHEDULED") 漏拦 ACTIVE
      //  ~2 分钟主生成态,低价 extension key 可带不完整源闯到真实提交)。无 generatedVideo 的源
      // (上传残留/失败/未知状态)同样拒 —— videoInput 引用的必须是已完成的生成视频。
      const srcState = mapMediaStatus(sourceMedia);
      if (srcState.status !== "completed" || !sourceMedia?.video?.generatedVideo) {
        const why = srcState.status === "in_progress"
          ? `还在生成中(${srcState.rawStatus ?? "in_progress"}),等完成后再延长/超分(flow_status(mediaId) 轮询)`
          : srcState.status === "failed"
            ? `状态不可用(${srcState.rawStatus ?? "无 mediaGenerationStatus,疑似上传残留或失败"}),不能作源`
            : "无 generatedVideo(非已完成的生成视频),不能作源";
        throw new FlowError("S301", `videoMediaId "${shape.videoSource}" ${why}`);
      }
    }
    // 音频参考(r2v 专属叠加,§14.1/§14.6;网络侧校验):mediaId 必须是本项目 externalReferenceMedia
    // 里的预设语音样本(isPresetAudioSample=true;mediaId 是 "achernar"/"charon" 等 slug,非 UUID ——
    // 不能用 isFlowMediaIdLike 形状启发)。用户自有音频上传 wire 未逆向(D-3),v1 只开放挂预设语音。
    let referenceAudio: Array<{ mediaId: string }> | undefined;
    if (shape.audioCount) {
      const ext = (await this.getProjectData()).projectContents?.externalReferenceMedia ?? [];
      const preset = new Map<string, string>();
      for (const e of ext) {
        const g = e?.media?.audio?.generatedAudio;
        if (g?.isPresetAudioSample === true && typeof e?.mediaId === "string") preset.set(e.mediaId, String(g?.name ?? e.mediaId));
      }
      const bad = (req.audioMediaIds ?? []).filter((id) => !preset.has(id));
      if (bad.length) {
        throw new FlowError("S301", `audioMediaIds 含非预设语音样本:${bad.join(", ")}(音频参考只接受本项目 30 预设语音的 mediaId)`, { hint: `调无参 flow_status() 看快照 preset_voices 字段,列全部预设语音 mediaId(${FLOW_ZERO_CREDIT} 点);用户自有音频上传暂不支持(wire 未逆向,契约 §14.6)` });
      }
      referenceAudio = (req.audioMediaIds ?? []).map((id) => ({ mediaId: id }));
      warnings.push(`音频参考是实验期能力(客户端 UI 同款 disclaimer,契约 §14.6):2026-08-27 首次 live 提交实证生效 —— 生成成功未被过滤,产物音轨含明显语音(mean_volume -20dB,比纯环境音基线高约 12-16dB,契约 §15);语音与所选预设音色的一致性未做说话人级核验。提交带 audioFailurePreference=BLOCK_SILENCED_VIDEOS —— 音频安全过滤命中时整条生成失败(而非返回静默视频)。本次挂 ${shape.audioCount} 个预设语音(上限 ${shape.audioCap})。`);
    }

    // 端点选择(契约 §7.3/§9/§11.1 端点表):mode=undefined 的未知家族按输入形态走对应端点
    const endpointMode = mode != null && OPEN_VIDEO_MODES.has(mode)
      ? mode
      : shape.hasImage ? "i2v" : shape.kfCount === 2 ? "interpolation" : shape.refCount ? "r2v" : shape.videoSource ? "extension" : "t2v";
    const apiPathname = VIDEO_API_ENDPOINTS[endpointMode];

    // 图片输入:先上传为项目内媒体(契约 §7.1,0 点),再以 {aspectRatio?, mediaId} 引用(§7.3 oneof 只发 mediaId)
    let startImage: { aspectRatio?: string; mediaId: string } | undefined;
    let endImage: { aspectRatio?: string; mediaId: string } | undefined;
    let referenceImages: Array<{ aspectRatio?: string; mediaId: string }> | undefined;
    if (shape.hasImage) startImage = await this.videoImageInput(req.image!);
    else if (shape.kfCount === 2) {
      startImage = await this.videoImageInput(req.keyframes![0]);
      endImage = await this.videoImageInput(req.keyframes![1]);
    } else if (shape.refCount) {
      referenceImages = [];
      for (const uri of req.images!) referenceImages.push(await this.videoImageInput(uri));
    }

    const pid = await this.ensureProjectId();
    const token = await this.getAccessToken();
    const recaptcha = await this.recaptchaTokenAuto(RECAPTCHA_SITE_KEY, RECAPTCHA_ACTION_VIDEO);
    const clientContext = {
      recaptchaContext: { token: recaptcha, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" },
      projectId: pid,
      tool: TOOL_INTERNAL_NAME,
      sessionId: wireSessionId(),
    };
    // v2 请求体(契约 §7.3/§9/§11.1/§14.6,live 实证 + bundle Zod;各端点字段集不同):
    //   t2v/i2v/interpolation/r2v:全量 {aspectRatio, metadata, outputSpec, promptExpansionInput, seed, textInput, videoModelKey}
    //     —— r2v 另可叠加 referenceImages(参考图)与 referenceAudio(音频参考,§14.6,实验期)
    //   extension(§9.2):无 outputSpec;upsampler(§9.1):仅 {aspectRatio, metadata, seed, videoInput, videoModelKey}
    //   edit(§11.1,E 轮 bundle Zod _0x457c52 + 假 key 404 探针):{aspectRatio, metadata, seed, textInput, videoInput, videoModelKey}
    //     —— 无 promptExpansionInput(edit item schema 无该字段);顶层不带 useV2ModelConfig(bundle 提交构造器明文:
    //     'batchAsyncGenerateVideoEditVideo'!==apiPathname && {useV2ModelConfig:true},edit 是唯一例外)
    const requestItem: Record<string, unknown> = {
      aspectRatio: endpointMode === "extension" || endpointMode === "upsampler" || endpointMode === "edit"
        ? videoAspectOfSource(sourceMedia, req.ratio)
        : videoAspectRatioFor(req.ratio, resolved.key),
      metadata: { collectionId: "", mediaIdSeed: crypto.randomUUID(), sceneId: "", workflowIdSeed: crypto.randomUUID() },
      seed: req.seed ?? crypto.randomInt(1_000_000),
      videoModelKey: resolved.key,
    };
    if (endpointMode !== "upsampler" && endpointMode !== "edit") {
      if (endpointMode !== "extension") requestItem.outputSpec = { resolution: "VIDEO_RESOLUTION_720P" }; // §9.2:extension 无 outputSpec
      requestItem.promptExpansionInput = { prompt: "", seed: 0, templateId: "", videoInputs: [] };
      requestItem.textInput = { expandedPrompt: "", prompt: req.prompt, structuredPrompt: { parts: [{ text: req.prompt }] } };
    }
    if (endpointMode === "edit") {
      requestItem.textInput = { expandedPrompt: "", prompt: req.prompt, structuredPrompt: { parts: [{ text: req.prompt }] } };
    }
    if (startImage) requestItem.startImage = startImage;
    if (endImage) requestItem.endImage = endImage;
    if (referenceImages) requestItem.referenceImages = referenceImages;
    if (referenceAudio) requestItem.referenceAudio = referenceAudio; // §14.6:r2v 音频参考,entry = {mediaId}(2026-08-27 假 key 404 探针定型)
    if (shape.videoSource) requestItem.videoInput = { mediaId: shape.videoSource };
    const body = {
      clientContext,
      mediaGenerationContext: { batchId: crypto.randomUUID(), audioFailurePreference: "BLOCK_SILENCED_VIDEOS" },
      ...(endpointMode !== "edit" ? { useV2ModelConfig: true } : {}), // §11.1:edit 是唯一不带 useV2ModelConfig 的端点
      requests: [requestItem],
    };
    const f = await this.pageFetchAuto({
      url: `${AISANDBOX_ORIGIN}/v1/video:${apiPathname}`,
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      bodyB64: utf8ToB64(JSON.stringify(body)),
    });
    if (!f.ok) {
      throw new FlowError("S201", `视频提交 HTTP ${f.status}: ${bufToUtf8(f.bodyB64).slice(0, 300)}`, { flowStatus: f.status });
    }
    let r: any;
    try { r = JSON.parse(bufToUtf8(f.bodyB64)); } catch { throw new FlowError("S202", "视频提交响应体非 JSON", { flowStatus: 0 }); }
    const first = (r?.media ?? [])[0];
    const mediaId = first?.name ?? first?.operation?.name;
    if (!mediaId) throw new FlowError("S202", `视频提交响应无 media/operation name:${bufToUtf8(f.bodyB64).slice(0, 300)}`, { flowStatus: 0 });
    const creditsNow = await this.getCredits().catch(() => undefined);
    // 提交后预估提示:tier 已知时用 per-tier 真值(§14.4 staticTierCosts / 目录缓存),tier 盲估算最后兜底
    const tierNow = creditsNow?.serviceTier;
    const cat = this.dynamicCatalog && Date.now() - this.dynamicCatalog.at < this.dynamicCatalogTtlMs ? this.dynamicCatalog : null;
    const dynCost = cat?.creditByKey?.[resolved.key]?.[tierNow ?? ""]?.cost;
    const tierCost = Number.isFinite(Number(dynCost)) ? Number(dynCost)
      : tierNow != null ? staticTierCosts(resolved.key)?.[tierNow as FlowServiceTier] : undefined;
    const est = typeof tierCost === "number" ? tierCost : estimateVideoCredits(resolved.key);
    if (est != null) warnings.push(`🔴 本条预计消耗 ${est} 积分${creditsNow?.credits != null ? `(当前余额 ${creditsNow.credits})` : ""}。`);
    if (r?.remainingCredits != null) warnings.push(`提交后剩余积分:${r.remainingCredits}。`);
    return { taskId: mediaId, status: "queued", warnings: warnings.length ? warnings : undefined, raw: r };
  }

  /**
   * 状态轮询 + 完成取件(零消耗):projectInitialData 查 mediaId 状态;
   * SUCCESSFUL → getMediaUrlRedirect 取 mp4 字节 → data:video/mp4 URI(工具层 downloadAsset 落盘,
   * Node fetch 原生支持 data: URI)。绝不 fallback、绝不重复提交。
   */
  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    // 防 stall:完成态下载内部兜底 180s,超 120s 红线 —— 工具级截止 110s 封顶(S410)
    return this.attachHealNotes(await this.withToolDeadline(this.getVideoUnbounded(handle), `flow 取件 ${handle.taskId ?? handle.videoId ?? ""}`.trim()));
  }
  private async getVideoUnbounded(handle: VideoHandle): Promise<VideoResult> {
    const mediaId = handle.taskId ?? handle.videoId;
    if (!mediaId) throw new FlowError("S301", "getVideo 需要 taskId(mediaId)");
    await this.ensureReady();
    const m = await this.findMedia(mediaId);
    // kind 门禁(audit finding-11 第一层防线):image 媒体绝不按视频取件 ——
    // 否则图片字节会被当 data:video/mp4 下发、贴 .mp4 扩展名落盘且零告警
    if (m?.image?.generatedImage && !m?.video?.generatedVideo) {
      throw new FlowError("S403", `mediaId "${mediaId}" 是 image 媒体,不能经 get_video 按视频取件`, { hint: "下载图片请用 flow_status(mediaId, download=true);get_video 仅用于视频" });
    }
    const mapped = mapMediaStatus(m);
    const gen = m?.video?.generatedVideo ?? {};
    const raw = {
      mediaId,
      rawStatus: mapped.rawStatus,
      model: gen.model,
      seed: gen.seed,
      prompt: gen.prompt, // 输入↔产物映射闭环:落盘文件 ↔ mediaId ↔ seed ↔ model ↔ 原始 prompt
      dimensions: m?.dimensions?.length,
    };
    if (mapped.status === "completed") {
      const got = await this.getMediaBytes(mediaId);
      // 传输完整性(audit finding-18):字节数须精确等于 mediaBlobSize(实测已完成资产两者相等)
      const expected = Number(m?.mediaMetadata?.mediaBlobSize);
      if (Number.isFinite(expected) && expected > 0 && got.buf.length !== expected) {
        // 传输截断自愈一次(下载零副作用):重新走完整下载,二仍不完整才抛
        pushHealNote(this.transport, `下载疑似截断(${got.buf.length}B ≠ ${expected}B):自动重新下载一次`);
        const retry = await this.getMediaBytes(mediaId);
        if (retry.buf.length === expected) {
          Object.assign(got, retry);
        } else {
          throw new FlowError("S402", `下载不完整(两次):${got.buf.length}B/${retry.buf.length}B ≠ mediaBlobSize ${expected}B`, { flowStatus: 0 });
        }
      }
      const mime = got.contentType.split(";")[0] || "video/mp4";
      return { status: "completed", url: `data:${mime};base64,${got.buf.toString("base64")}`, raw };
    }
    if (mapped.status === "failed") {
      return { status: "failed", error: mapped.error ?? `Flow 状态:${mapped.rawStatus}`, raw };
    }
    return { status: "in_progress", raw };
  }
}

/** ratio("16:9"/"9:16")→ Flow 视频比例枚举(契约 §3:视频仅 LANDSCAPE/PORTRAIT)。 */
function videoAspectRatioFor(ratio?: string, key?: string): string {
  // key 方向后缀优先级(2026-08-27 补):veo 系 key 自带 _portrait/_landscape 方向后缀(§14.4)——
  // 未传 ratio 时按后缀推导(_portrait → 9:16),杜绝"选了竖屏 key 却忘了 ratio → 默认发横屏"的静默错向;
  // 显式 ratio 与后缀冲突 → 不硬拒(wire aspectRatio 实际生效,live 实证),交由调用方 warning 提示。
  const keyDir = key?.includes("_portrait") ? "9:16" : key?.includes("_landscape") ? "16:9" : undefined;
  const effective = ratio ?? keyDir;
  if (!effective || effective === "16:9") return "VIDEO_ASPECT_RATIO_LANDSCAPE";
  if (effective === "9:16") return "VIDEO_ASPECT_RATIO_PORTRAIT";
  throw new FlowError("S301", `视频比例仅支持 16:9 / 9:16(收到 "${ratio}";图片比例才支持 1:1/4:3/3:4)`);
}

/** ratio × key 方向后缀一致性(warning 级,不拒):显式 ratio 与 _portrait/_landscape 后缀相悖时提示。 */
export function videoRatioKeyWarning(ratio: string | undefined, key: string | undefined): string | undefined {
  if (!ratio || !key) return undefined;
  const keyDir = key.includes("_portrait") ? "9:16" : key.includes("_landscape") ? "16:9" : undefined;
  if (keyDir && ratio !== keyDir) {
    return `模型 key "${key}" 内嵌 ${keyDir} 方向,与 ratio="${ratio}" 不一致(wire 以 ratio 为准;建议二者匹配或省略 ratio)。`;
  }
  return undefined;
}

/**
 * extension/upsampler 的 aspectRatio(§9.1 必填字段):优先继承源视频 generatedVideo.aspectRatio 原文
 * (响应侧回读的完整枚举,如 VIDEO_ASPECT_RATIO_LANDSCAPE);读不到时按 ratio 参数/默认 LANDSCAPE。
 */
function videoAspectOfSource(sourceMedia: any, ratio?: string): string {
  const raw = sourceMedia?.video?.generatedVideo?.aspectRatio;
  if (typeof raw === "string" && /^VIDEO_ASPECT_RATIO_[A-Z_]+$/.test(raw)) return raw;
  return videoAspectRatioFor(ratio);
}

// ── 图片字节加载与嗅探(uploadMedia 输入侧;契约 §7.1/§7.2) ──

interface LoadedImage {
  bytes: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  fileName?: string;
}

/** magic bytes 嗅探 mime + 尺寸(PNG/GIF/JPEG/WEBP;嗅不出尺寸时留空,aspectRatio 字段可省)。index.ts 本地图片输入转 data: URI 复用。 */
/**
 * 场景键(2026-08-31 用户裁决:新项目按"使用项目"全路径层级命名,如 media-gen-mcp@特辑_产品宣传@vscode状态插件)。
 * 规则:server 进程 cwd 相对 home 的路径段,剥去通用容器前缀 Documents/Project(如存在),取**末 2 段**用 @ 连接;
 * 剥后为空(cwd 恰为 home 或 Project 根)→ "default"。段名仅做文件名安全化,不译不改。
 */
export function flowScopeKeyOf(cwd: string = process.cwd(), home: string = os.homedir()): string {
  const rel = path.relative(home, cwd);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "default";
  let segs = rel.split(path.sep).filter(Boolean);
  if (segs[0] === "Documents" && segs[1] === "Project") segs = segs.slice(2);
  segs = segs.slice(-2); // 末 2 段(用户示例:特辑_产品宣传@vscode状态插件)
  const safe = segs.map((x) => x.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()).filter(Boolean);
  return safe.length ? safe.join("@") : "default";
}

/** 按 scopeKey 生成 Flow 项目标题(截断 60 字符防超平台限制)。 */
function flowProjectTitleOf(scopeKey: string): string {
  const base = scopeKey === "default" ? "media-gen-mcp" : `media-gen-mcp@${scopeKey}`;
  return base.length > 60 ? base.slice(0, 60) : base;
}

export function sniffImage(bytes: Buffer): { mimeType?: string; width?: number; height?: number } {
  const latin = (s: number, e: number) => bytes.subarray(s, e).toString("latin1");
  const be16 = (o: number) => bytes.readUInt16BE(o);
  const le16 = (o: number) => bytes.readUInt16LE(o);
  try {
    if (bytes.length > 24 && latin(0, 8) === "\x89PNG\r\n\x1a\n" && latin(12, 16) === "IHDR") {
      return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes.length > 10 && (latin(0, 6) === "GIF87a" || latin(0, 6) === "GIF89a")) {
      return { mimeType: "image/gif", width: le16(6), height: le16(8) };
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      // JPEG:扫 SOF0-3/5-7/9-11/13-15 段取尺寸(逐段跳过,容错截断)
      let o = 2;
      while (o + 9 < bytes.length) {
        if (bytes[o] !== 0xff) { o++; continue; }
        const marker = bytes[o + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { mimeType: "image/jpeg", height: be16(o + 5), width: be16(o + 7) };
        }
        const len = be16(o + 2);
        if (len < 2) break;
        o += 2 + len;
      }
      return { mimeType: "image/jpeg" };
    }
    if (bytes.length > 30 && latin(0, 4) === "RIFF" && latin(8, 12) === "WEBP") {
      const chunk = latin(12, 16);
      if (chunk === "VP8X") return { mimeType: "image/webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { mimeType: "image/webp", width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = bytes.readUInt32LE(21);
        return { mimeType: "image/webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return { mimeType: "image/webp" };
    }
  } catch { /* 嗅探失败按未知处理 */ }
  return {};
}

/**
 * 取图字节:data: URI 本地解析;http(s) 经 Node fetch 下载(不走 CDP 页面上下文 ——
 * 页面 fetch 外站图会撞 CORS,labs.google 同源约束只覆盖 API 调用)。
 */
async function loadImageBytes(imageUri: string): Promise<LoadedImage> {
  const uri = String(imageUri ?? "").trim();
  if (/^data:/i.test(uri)) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(uri);
    if (!m) throw new FlowError("S301", `data: URI 格式非法(前 60 字符:${uri.slice(0, 60)})`);
    const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    if (!bytes.length) throw new FlowError("S301", "data: URI 图片字节为空");
    const sniffed = sniffImage(bytes);
    if (!sniffed.mimeType && !m[1]) throw new FlowError("S301", "data: URI 无 mime 且字节嗅探失败(前 8 字节非 PNG/JPEG/GIF/WEBP)");
    return { bytes, mimeType: sniffed.mimeType ?? m[1] ?? "application/octet-stream", width: sniffed.width, height: sniffed.height };
  }
  if (!/^https?:\/\//i.test(uri)) {
    throw new FlowError("S301", `images 输入须为 http(s): 或 data: URI(收到 "${uri.slice(0, 60)}")`);
  }
  let resp: Response;
  try {
    resp = await fetch(uri, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  } catch (e: any) {
    throw new FlowError("S201", `图片下载失败(${uri.slice(0, 120)}):${e?.message ?? e}`, { flowStatus: 0 });
  }
  if (!resp.ok) throw new FlowError("S201", `图片下载 HTTP ${resp.status}(${uri.slice(0, 120)})`, { flowStatus: resp.status });
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!bytes.length) throw new FlowError("S201", `图片下载返回空 body(${uri.slice(0, 120)})`, { flowStatus: 0 });
  const sniffed = sniffImage(bytes);
  const ctHeader = resp.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const mimeType = sniffed.mimeType ?? (ctHeader.startsWith("image/") ? ctHeader : "");
  if (!mimeType) throw new FlowError("S301", `无法判定图片 mime(content-type "${ctHeader}" 非 image/* 且字节嗅探失败):${uri.slice(0, 120)}`);
  return {
    bytes, mimeType, width: sniffed.width, height: sniffed.height,
    fileName: uri.split("/").pop()?.split("?")[0] || undefined,
  };
}

// ── 编码助手 ──

function bufToUtf8(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}
function utf8ToB64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}
