/**
 * Gemini 网页渠道(gemini.google.com)第 5 生成渠道 —— CDP UI 驱动。
 *
 * 形态(2026-09-22 调研定谳,doc/渠道/Gemini渠道调研-2026-09-22.md):
 * - attach 本机 Chrome CDP(lasso chrome-profile-default,Google 登录态在 profile,默认 9225 ——
 *   与 flow 的 9223 独立,端口可配,吸取 lasso browse 通道硬编码 9222 的教训)
 * - 生成入口 = 对话页「上传和工具」菜单 →「制作图片」(Nano Banana 2)/「制作视频」(Omni);
 *   不做 StreamGenerate wire 重放(无文档嵌套数组,UI 入口比协议稳)
 * - 计费 = Google AI 订阅算力配额制(5h 滚动窗 + 周上限,无按次积分):无确认门,
 *   每次视频生成带配额警示 warning(实测单条视频 ≈15-20% 5h 窗口)
 * - requiresOptIn(image/video)=true(对齐 flow/pixverse:隐私边界 + 配额消耗须显式同意)
 *
 * 错误码族:[gemini] S1xx 环境(CDP/页面/登录/地区)/ S2xx 网络页面 fetch / S3xx 参数 /
 * S4xx 生成结果(超时/无产物/页面报错)。
 *
 * 测试纪律:白盒套件只注入 GeminiTransport stub(零网络零 CDP 零生成);真机集成走
 * test/gemini-tools.integration.test.mjs,GEMINI_IT=1 + 非 CI + CDP 活着 三门(默认永不真连,
 * FLOW_IT 同款 —— Flow 窗口事故 #2 教训)。
 */
import type {
  ImageRequest,
  ImageResult,
  ImageConstraints,
  VideoRequest,
  VideoTask,
  VideoResult,
  VideoHandle,
  Modality,
  ProviderCapabilities,
} from "./types.js";
import { CdpConnection } from "./cdp-client.js";

// ── 常量 ──

const GEMINI_ORIGIN = "https://gemini.google.com";
const DEFAULT_GEMINI_TAB_URL = `${GEMINI_ORIGIN}/app`;
export const DEFAULT_GEMINI_CDP_PORT = 9225;
const CDP_HOST = "127.0.0.1";

/** 单次 evaluate 超时(页面侧 JS)。 */
const EVAL_TIMEOUT_MS = 30_000;
/** 新页/导航后等 SPA 就绪的 settle。 */
const NAV_SETTLE_MS = 4_000;
/** 进入模式后等输入区形态切换。 */
const MODE_SETTLE_MS = 1_500;
/** 菜单打开后等 overlay 渲染。 */
const MENU_SETTLE_MS = 1_000;
/** 生成轮询间隔。 */
const POLL_INTERVAL_MS = 4_000;
/** 图像生成轮询截止(实测 16s,预算 10x;UI 生成无法取消,超时转 S410)。 */
export const IMAGE_POLL_DEADLINE_MS = 180_000;
/** 视频生成轮询截止(实测 48s,长 prompt 可数分钟,预算 ~8.8x)。 */
export const VIDEO_POLL_DEADLINE_MS = 420_000;

const GEMINI_LAUNCH_HINT =
  "启动(任选其一;lasso 非必需,本工具只要求一台 9225 调试 Chrome 且登录了 Google 账号):" +
  "①lasso launch-chrome --port 9225 --idle-ms 0(hidden 零窗口;登录态在 profile,重启即恢复;--idle-ms 0 防 idle 收割)" +
  "②无 lasso 时裸 Chrome:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9225 --user-data-dir=$HOME/.media-gen-mcp/chrome-profile-gemini'" +
  "(首次在窗口里登录 gemini.google.com,此后复用)";
const GEMINI_LOGIN_HINT =
  "Chrome 未登录 Google:lasso launch-chrome --port 9225 --mode visible --idle-ms 0 → 在窗口里完成 Google 登录" +
  " → 登录后 lasso chrome-hide 收回后台(保持静默;后续拉起均 hidden 即可)";

/** UI 中英文候选(界面语言自适应;aria-label/textContent 双通道)。 */
const T = {
  toolsMenu: ["上传和工具", "Upload and tools", "Upload & tools"],
  imageMode: ["制作图片", "Create image", "Image"],
  videoMode: ["制作视频", "Create video", "Video"],
  send: ["发送", "Send", "Submit"],
  imageEngineBadge: /Nano Banana|制作图片|Image generation/i,
  videoEngineBadge: /Omni|制作视频|Video generation/i,
};

// ── 错误类型:所有 gemini 错误统一 [gemini] S<code> 前缀(项目错误前缀规范) ──

export class GeminiError extends Error {
  /** S 码(S1xx 环境/S2xx 网络/S3xx 参数/S4xx 生成),供测试与调用方机读。 */
  readonly code: string;
  /** 环境前置未就绪(CDP 不可连/无页面/未登录):请求从未提交,链推进语义同 FlowError.precondition。 */
  readonly precondition?: true;
  /** HTTP 风格 status(0=瞬时;复用 http.ts isTransient/isFallbackWorthy 语义)。 */
  readonly geminiStatus?: number;
  /** S103 子类:CDP evaluate 超时(瞬态,重试即愈)。 */
  readonly evalTimeout?: true;

  constructor(code: string, message: string, opts?: { hint?: string; geminiStatus?: number; precondition?: boolean; evalTimeout?: boolean }) {
    super(`[gemini] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "GeminiError";
    this.code = code;
    this.geminiStatus = opts?.geminiStatus;
    if (opts?.precondition) this.precondition = true;
    if (opts?.evalTimeout) this.evalTimeout = true;
    if (opts?.geminiStatus !== undefined) (this as any).status = opts.geminiStatus;
  }
}

const geminiCdpError = (code: string, message: string, opts?: { hint?: string; status?: number; evalTimeout?: boolean }) =>
  new GeminiError(code, message, opts ? { hint: opts.hint, geminiStatus: opts.status, evalTimeout: opts.evalTimeout } : undefined);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** JSON 字面量安全内嵌 JS 源码(与 flow.ts 同款转义纪律)。 */
function jsonLiteral(v: unknown): string {
  return JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// ── 传输抽象(测试注入 stub;生产 = CDP Runtime.evaluate) ──

export interface GeminiTransport {
  /** CDP 可连 + 定位 gemini.google.com page target(无则自动开页自愈一次);失败抛 S100/S101。 */
  open(opts?: { newTabUrl?: string }): Promise<{ pageUrl: string }>;
  /** 页面上下文 Runtime.evaluate(awaitPromise+returnByValue)。 */
  eval(expression: string, timeoutMs?: number): Promise<unknown>;
  /** 可信文本输入(CDP Input.insertText;Angular rich-textarea 识别保证)。 */
  insertText(text: string): Promise<void>;
  /** 导航当前 attach 页(navigate 到空对话用)。 */
  navigate(url: string): Promise<void>;
  /** 自愈 note 通道(provider 公共入口 drain 进结果 warnings)。 */
  notes?: string[];
}

function pushNote(transport: GeminiTransport | null, note: string): void {
  console.error(`[gemini] ${note}`);
  const notes = (transport as any)?.notes;
  if (Array.isArray(notes)) notes.push(note);
}

/** 页面侧探测表达式(全部 returnByValue,零异常泄漏 —— try/catch 包裹返回 {__err})。 */

/** 登录态探测:账号徽章 aria-label(中英文界面兼容)。 */
const EXPR_LOGIN = `(() => {
  try {
    const a = document.querySelector('a[aria-label*="Google 账号"],a[aria-label*="Google Account"]');
    const label = a ? a.getAttribute('aria-label') : null;
    return { logged: !!label, account: label ? String(label).slice(0, 120) : null, url: location.href };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 打开「上传和工具」菜单。 */
const exprOpenToolsMenu = () => `(() => {
  try {
    const btn = [...document.querySelectorAll('button,[role="button"]')].find(b => {
      const l = (b.getAttribute('aria-label') || '').trim();
      return ${jsonLiteral(T.toolsMenu)}.some(t => l.includes(t));
    });
    if (!btn) return { ok: false, stage: 'menu-btn', visibleLabels: [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(Boolean).slice(0, 24) };
    btn.click();
    return { ok: true };
  } catch (e) { return { __err: String(e) }; }
})()`;

/**
 * 点击模式菜单项(「制作图片」/「制作视频」)。
 * 调研实证:菜单项是纯文本 div(非 button、无 role)——叶子 textContent 精确匹配 + 5 级冒泡
 * click(dispatchEvent,勿依赖元素自身 click 语义)。
 */
const exprClickModeItem = (candidates: string[]) => `(() => {
  try {
    const ov = document.querySelector('.cdk-overlay-container') || document.body;
    const cands = ${jsonLiteral(candidates)};
    for (const c of cands) {
      const leaves = [...ov.querySelectorAll('*')].filter(el => el.children.length === 0 && (el.textContent || '').trim() === c);
      if (leaves.length) {
        let t = leaves[0];
        for (let i = 0; i < 5 && t; i++) { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); t = t.parentElement; }
        return { ok: true, matched: c };
      }
    }
    return { ok: false, stage: 'menu-item', menuText: (ov.innerText || '').slice(0, 300) };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 模式徽章确认(进错模式软告警,不硬错 —— 徽章文案可能随改版漂移)。 */
const EXPR_MODE_BADGE = `(() => {
  try { return { badge: (document.body.innerText || '').slice(0, 3000) }; } catch (e) { return { __err: String(e) }; }
})()`;

/** 点击发送按钮。 */
const exprClickSend = () => `(() => {
  try {
    const sb = [...document.querySelectorAll('button,[role="button"]')].find(b => {
      const l = (b.getAttribute('aria-label') || '').trim();
      return ${jsonLiteral(T.send)}.some(t => l.includes(t)) && !!(b.offsetWidth || b.offsetHeight);
    });
    if (!sb) return { ok: false, stage: 'send-btn' };
    sb.click();
    return { ok: true };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 聚焦输入框(insertText 前置)。 */
const EXPR_FOCUS_INPUT = `(() => {
  try {
    const t = document.querySelector('rich-textarea textarea, rich-textarea [contenteditable], textarea');
    if (!t) return { ok: false, stage: 'input' };
    t.focus();
    return { ok: true };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 图像产物轮询:大图(>300px 自然宽)+ 图片操作按钮出现 = ready;错误文案捕获。 */
const EXPR_POLL_IMAGE = `(() => {
  try {
    const gen = [...document.images].filter(im => im.naturalWidth > 300 && !/gstatic|googleusercontent\\.com\\/ogw\\//.test(im.src));
    const src = gen.map(im => im.src).find(s => s.startsWith('blob:')) || gen.map(im => im.src).find(Boolean) || null;
    const imgActions = [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || '').filter(l => /下载|分享图片|Download|Share image/.test(l));
    const body = document.body.innerText || '';
    const err = /请检查互联网连接|再试一次|无法生成|达到.{0,8}上限|Something went wrong|try again later|can't generate/i.exec(body);
    return { count: gen.length, src, ready: gen.length > 0 && imgActions.length > 0, err: err ? err[0] : null };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 视频产物轮询:video 元素 src(直链或 blob)+ ready 标记。 */
const EXPR_POLL_VIDEO = `(() => {
  try {
    const v = document.querySelector('video');
    const src = v ? String(v.currentSrc || v.src || '') : '';
    const body = document.body.innerText || '';
    const readyMark = /Your video is ready|视频已就绪|视频已生成|is ready/i.test(body);
    const err = /请检查互联网连接|再试一次|无法生成|达到.{0,8}上限|Something went wrong|try again later|can't generate/i.exec(body);
    return { src: src.slice(0, 800), ready: !!src && (readyMark || /usercontent|blob:/.test(src)), err: err ? err[0] : null, dur: v && isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null };
  } catch (e) { return { __err: String(e) }; }
})()`;

/** 图像产物 canvas 抓取:blob img → decode → drawImage → toDataURL(重编码 JPEG 0.92)。
 * 真机教训(2026-09-22):页面 fetch(blob:) 一律 "Failed to fetch"(blob 引用不经 Service Worker
 * 上下文);canvas 路径零 fetch 依赖,标准 API。产物为 JPEG 重编码(视觉无损档)。 */
const EXPR_CANVAS_GRAB = `(async () => {
  try {
    const im = [...document.images].filter(i => i.naturalWidth > 300 && !/gstatic/.test(i.src)).pop();
    if (!im) return { __err: 'no generated image' };
    try { await im.decode(); } catch (e) {}
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    return { b64, contentType: 'image/jpeg', w: c.width, h: c.height, bytes: Math.round(b64.length * 3 / 4) };
  } catch (e) { return { __err: String(e && e.message || e) }; }
})()`;

/** 页面上下文 fetch 任意 src → base64(视频直链下载出口;已真机验证)。 */
const exprFetchB64 = (src: string) => `(async () => {
  try {
    const resp = await fetch(${jsonLiteral(src)}, { credentials: 'include' });
    if (!resp.ok) return { __err: 'HTTP ' + resp.status };
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return { b64: btoa(bin), contentType: resp.headers.get('content-type') || '', bytes: bytes.length };
  } catch (e) { return { __err: String(e && e.message || e) }; }
})()`;

// ── 生产传输:CDP 探活 + gemini page 定位/自愈开页 + evaluate ──

export class CdpGeminiTransport implements GeminiTransport {
  private conn: CdpConnection | null = null;
  private pageUrl = "";
  readonly notes: string[] = [];
  /** S101 自愈开页后等页面出现的 settle(flow healNewTabSettleMs 先例:生产 4s,测试调短)。 */
  healNewTabSettleMs = NAV_SETTLE_MS;

  constructor(private readonly port: number = DEFAULT_GEMINI_CDP_PORT) {}

  private async listTargets(): Promise<Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>> {
    try {
      const res = await fetch(`http://${CDP_HOST}:${this.port}/json/list`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as any;
    } catch (e: any) {
      throw new GeminiError("S100", `CDP ${CDP_HOST}:${this.port} 不可连(${e?.message ?? e})`, { hint: GEMINI_LAUNCH_HINT, precondition: true });
    }
  }

  private attachPage(pages: Array<{ url: string; webSocketDebuggerUrl?: string }>): { pageUrl: string } {
    const page = pages[0];
    if (!page?.webSocketDebuggerUrl) {
      throw new GeminiError("S103", "page target 无 webSocketDebuggerUrl(页面可能正在关闭)");
    }
    this.pageUrl = page.url;
    this.conn = new CdpConnection(page.webSocketDebuggerUrl, geminiCdpError, GEMINI_LAUNCH_HINT);
    return { pageUrl: this.pageUrl };
  }

  /** 自动开页自愈:PUT /json/new + 主动 Page.navigate(与 flow 同款实证:/json/new 的 url 不落地导航)。 */
  private async openTab(url: string): Promise<void> {
    const res = await fetch(`http://${CDP_HOST}:${this.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tab = (await res.json()) as any;
    const wsUrl = tab?.webSocketDebuggerUrl;
    if (typeof wsUrl !== "string" || !wsUrl) throw new Error("新 tab 无 webSocketDebuggerUrl");
    const tmp = new CdpConnection(wsUrl, geminiCdpError, GEMINI_LAUNCH_HINT);
    try {
      await tmp.navigate(url);
    } finally {
      tmp.dispose();
    }
  }

  async open(opts: { newTabUrl?: string } = {}): Promise<{ pageUrl: string }> {
    if (this.conn) return { pageUrl: this.pageUrl };
    const targets = await this.listTargets(); // S100
    const geminiPages = (list: typeof targets) => list.filter((t) => t.type === "page" && t.url.startsWith(`${GEMINI_ORIGIN}/`));
    let pages = geminiPages(targets);
    if (!pages.length) {
      const tabUrl = opts.newTabUrl ?? DEFAULT_GEMINI_TAB_URL;
      pushNote(this, `无 gemini.google.com 页面 target,已自动开新标签页 ${tabUrl}(自愈一次)`);
      try {
        await this.openTab(tabUrl);
      } catch { /* 开页自愈失败 → 复探后走原 S101 */ }
      await sleep(this.healNewTabSettleMs);
      const retryTargets = await this.listTargets();
      pages = geminiPages(retryTargets);
      if (!pages.length) {
        throw new GeminiError("S101", `CDP 可连但无 gemini.google.com page target(现有 page:${retryTargets.filter((t) => t.type === "page").map((t) => t.url.slice(0, 60)).join(" | ") || "无"};已尝试自动开页未果)`, { hint: `在 Chrome 打开 ${DEFAULT_GEMINI_TAB_URL}`, precondition: true });
      }
    }
    return this.attachPage(pages);
  }

  async eval(expression: string, timeoutMs: number = EVAL_TIMEOUT_MS): Promise<unknown> {
    if (!this.conn) throw new GeminiError("S103", "CDP 未连接(先 open())");
    let r: any;
    try {
      r = await this.conn.evaluate(expression, timeoutMs);
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      this.conn = null;
      throw new GeminiError("S103", `CDP evaluate 失败: ${(e as Error)?.message ?? e}`, { geminiStatus: 0 });
    }
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      this.conn = null;
      throw new GeminiError("S103", `页面执行异常: ${String(d.exception?.description ?? d.text).slice(0, 300)}`, { hint: "页面可能已被导航/关闭;重开 gemini.google.com 后重试", geminiStatus: 0 });
    }
    return r?.result?.value;
  }

  async insertText(text: string): Promise<void> {
    if (!this.conn) throw new GeminiError("S103", "CDP 未连接(先 open())");
    await this.conn.sendCommand("Input.insertText", { text }, 10_000);
  }

  async navigate(url: string): Promise<void> {
    if (!this.conn) throw new GeminiError("S103", "CDP 未连接(先 open())");
    await this.conn.navigate(url);
  }

  dispose(): void {
    this.conn?.dispose();
    this.conn = null;
  }
}

// ── 模型目录(F4 纪律:本常量是唯一真源,工具描述/文档一律指向 list_models) ──

/** 图像模型(UI 引擎徽章实测 2026-09-22:「使用 Nano Banana 2 生成」)。 */
export const GEMINI_IMAGE_MODELS: string[] = [
  "nano-banana-2", // 制作图片默认引擎(Nano Banana 2)
];

/** 视频模型(UI 引擎徽章实测 2026-09-22:「使用 Omni 生成」;Gemini Omni = Veo 3.1 系)。 */
export const GEMINI_VIDEO_MODELS: string[] = [
  "omni", // 制作视频默认引擎(Gemini Omni)
  "veo-3.1", // 同族别名(网页徽章 Omni;命名对齐 API 文档系)
];

/** 视频时序实测:48s 出片 ≈ 8s 片长(24fps × 192 帧);UI 无时长控件(固定档)。 */
export const GEMINI_VIDEO_NUM_FRAMES = 192;
export const GEMINI_VIDEO_FPS = 24;

// ── Provider ──

export interface GeminiWebProviderOpts {
  cdpPort?: number;
  /** 测试注入缝(生产缺省 = CdpGeminiTransport)。 */
  transport?: GeminiTransport;
}

/** 提交后的内存会话(getVideo 轮询源;UI 驱动无上游 taskId —— 伪 handle 仅进程内有效,重启即失效,诚实告知)。 */
interface GeminiSession {
  kind: "image" | "video";
  prompt: string;
  createdAt: number;
  /** 已被 getVideo 观察到 ready 并 fetch 完成。 */
  consumed?: boolean;
}

export class GeminiWebProvider {
  readonly name = "gemini";
  private transport: GeminiTransport | null;
  private readonly cdpPort: number;
  private cooldownUntil = 0;
  private lastErrorAt: string | undefined;
  private sessions = new Map<string, GeminiSession>();
  private sessionSeq = 0;
  /** 轮询/间歇节奏测试缝(flow heal* 先例:生产默认常量,测试实例调短)。 */
  pollIntervalMs = POLL_INTERVAL_MS;
  imagePollDeadlineMs = IMAGE_POLL_DEADLINE_MS;
  videoPollDeadlineMs = VIDEO_POLL_DEADLINE_MS;
  navSettleMs = NAV_SETTLE_MS;
  modeSettleMs = MODE_SETTLE_MS;
  menuSettleMs = MENU_SETTLE_MS;
  typeSettleMs = 600;

  constructor(opts: GeminiWebProviderOpts = {}) {
    this.cdpPort = opts.cdpPort ?? DEFAULT_GEMINI_CDP_PORT;
    this.transport = opts.transport ?? null;
  }

  private ensureTransport(): GeminiTransport {
    if (!this.transport) this.transport = new CdpGeminiTransport(this.cdpPort);
    return this.transport;
  }

  // ── MediaProviderBase ──

  channelInfo(): import("./types.js").ChannelInfo {
    return {
      status: "live",
      cost: "Google AI 订阅算力配额(5h 滚动窗+周上限;无按次积分/确认门)",
      freeQuota: "图像低耗;视频单条实测 ≈15-20% 的 5h 窗口(PRO 档,每次提交带配额警示)",
      capabilities: { t2i: true, i2i: false, t2v: true, i2v: false, keyframes: false },
      limits: ["视频固定 8s/24fps/16:9(异值参数逐项告警)", "单 live 会话(未取件视频存续期拒绝新提交 S303)", "图像仅文生图(图生图未接)"],
      watermark: "无",
      prerequisites: ["本机 Chrome CDP 9225 + Google AI 订阅登录(lasso launch-chrome --port 9225)"],
      risks: ["ToS 自动化灰色(单账号自用,与 flow 同级)", "IP 漂出可用区则服务不可用(配额不重置)"],
    };
  }

  capabilities(): ProviderCapabilities {
    return {
      image: { textToImage: true, imageToImage: false },
      video: { textToVideo: true, imageToVideo: false, keyframes: false },
    };
  }

  /** 订阅配额渠道(视频消耗显著)+ 隐私边界(本机 Chrome 路由到 Google):显式同意才介入。 */
  requiresOptIn(_modality: Modality): boolean {
    return true;
  }

  listModels(): string[] {
    return [...GEMINI_IMAGE_MODELS, ...GEMINI_VIDEO_MODELS];
  }

  listImageModels(): string[] {
    return [...GEMINI_IMAGE_MODELS];
  }

  listVideoModels(): string[] {
    return [...GEMINI_VIDEO_MODELS];
  }

  health(): { configured: boolean; cooldown: boolean; lastErrorAt?: string } {
    return { configured: true, cooldown: Date.now() < this.cooldownUntil, lastErrorAt: this.lastErrorAt };
  }

  notifyUnavailable(e: any): void {
    this.lastErrorAt = new Date().toISOString();
    const transient = (e as any)?.geminiStatus === 0 || /S2\d\d/.test(String((e as any)?.code ?? ""));
    if (transient) this.cooldownUntil = Date.now() + 60_000;
  }

  // ── ImageProvider ──

  supportsImageToImage(): boolean {
    return false;
  }

  imageConstraints(): ImageConstraints | undefined {
    return undefined; // UI 无像素级 size 约束(宽高比控件;精确像素不承诺)
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    const model = this.resolveImageModel(req.model);
    if (req.n && req.n > 1) warnings.push(`gemini 网页单次生成 1 张,已忽略 n=${req.n}(需多张请重复调用;注意每次消耗订阅算力配额)。`);
    if (req.images?.length) warnings.push("gemini 渠道暂不支持图生图(制作图片模式无底图上传通道,增强项未排期);images 已忽略。");
    for (const k of ["size", "aspect", "seed", "quality"] as const) {
      if ((req as any)[k] != null) warnings.push(`gemini 网页渠道不消费 ${k}(UI 无对应控件),已忽略。`);
    }
    this.assertNoLiveSession();
    const t = this.ensureTransport();
    try {
      await this.ensureFreshChat(t);
      await this.enterMode(t, "image");
      await this.typeAndSend(t, req.prompt);
      const got = await this.pollAndFetch(t, "image", this.imagePollDeadlineMs);
      this.drainNotes(t, warnings);
      return {
        // url=data:URI 是 handler 落盘管线唯一消费形态(downloadAsset 按 content-type 定扩展名 ——
        // NB2 网页产物实测为 JPEG,裸 b64 会被存成错误扩展;真机验证 2026-09-22)。
        outputs: [{ url: `data:${got.contentType};base64,${got.b64}` }],
        raw: { provider: "gemini-web", model, engine: "Nano Banana 2 (UI)", contentType: got.contentType },
        warnings,
      };
    } catch (e) {
      this.drainNotes(t, warnings);
      throw withWarnings(e, warnings);
    }
  }

  // ── VideoProvider ──

  videoConstraints() {
    return {
      allowedNumFrames: [GEMINI_VIDEO_NUM_FRAMES],
      defaultNumFrames: GEMINI_VIDEO_NUM_FRAMES,
      defaultFrameRate: GEMINI_VIDEO_FPS,
      allowedFrameRates: [GEMINI_VIDEO_FPS],
    };
  }

  estimateGenerationSeconds(_numFrames: number, _frameRate?: number): number {
    return 50; // 实测 48s;同步等待甜蜜点(≤60s 默认 wait)
  }

  async createVideo(req: VideoRequest): Promise<VideoTask> {
    const warnings: string[] = [];
    const model = this.resolveVideoModel(req.model);
    if (req.image || req.keyframes?.length || req.images?.length) {
      throw new GeminiError("S301", "gemini 网页渠道当前仅支持文生视频(制作视频模式无底图/关键帧上传通道;图生视频为增强项未排期)。");
    }
    for (const k of ["resolution", "ratio", "seed", "negativePrompt", "videoMediaId", "audioMediaIds"] as const) {
      if ((req as any)[k] != null) warnings.push(`gemini 网页渠道不消费 ${k}(UI 固定 16:9 默认档),已忽略。`);
    }
    // P1-B(审查):时序参数静默丢弃违反"丢弃必告警"铁律 —— 固定 8s/24fps 档,调用方传异值必须知情
    if (req.numFrames != null && req.numFrames !== GEMINI_VIDEO_NUM_FRAMES) {
      warnings.push(`gemini 网页渠道视频为固定 ${Math.round(GEMINI_VIDEO_NUM_FRAMES / GEMINI_VIDEO_FPS)}s/${GEMINI_VIDEO_FPS}fps 档(UI 无时长控件),numFrames=${req.numFrames} 已忽略。`);
    }
    if (req.frameRate != null && req.frameRate !== GEMINI_VIDEO_FPS) {
      warnings.push(`gemini 网页渠道视频固定 ${GEMINI_VIDEO_FPS}fps,frameRate=${req.frameRate} 已忽略。`);
    }
    if (req.mode != null && req.mode !== "text-to-video") {
      warnings.push(`gemini 网页渠道当前仅文生视频,mode=${req.mode} 已忽略。`);
    }
    warnings.push("配额警示:gemini 视频消耗 Google AI 订阅算力配额(算力制,无按次计价;实测单条 ≈15-20% 的 5 小时滚动窗口,PRO 档参考)。超额降级为功能不可用,直到窗口刷新。");
    this.assertNoLiveSession();
    const t = this.ensureTransport();
    try {
      await this.ensureFreshChat(t);
      await this.enterMode(t, "video");
      await this.typeAndSend(t, req.prompt);
      const taskId = `gemini-${++this.sessionSeq}-${Date.now().toString(36)}`;
      this.sessions.set(taskId, { kind: "video", prompt: req.prompt, createdAt: Date.now() });
      this.drainNotes(t, warnings);
      return {
        taskId,
        status: "submitted",
        raw: { provider: "gemini-web", model, engine: "Omni (UI)" },
        warnings,
      };
    } catch (e) {
      this.drainNotes(t, warnings);
      throw withWarnings(e, warnings);
    }
  }

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    const taskId = handle.taskId ?? handle.videoId;
    const sess = typeof taskId === "string" ? this.sessions.get(taskId) : undefined;
    if (!sess || sess.kind !== "video") {
      return {
        status: "failed",
        error: `gemini 会话 ${taskId ?? "(空)"} 不存在或非视频(伪 handle 仅进程内有效;server 重启后无法取件 —— 生成完成为同步等待语义,正常路径不会脱handle)。`,
      };
    }
    const t = this.ensureTransport();
    const warnings: string[] = [];
    try {
      await t.open(); // P2-3(审查):WS 断连/eval 复位后 open 幂等重连(S410"可重试"承诺成立的前提)
      const got = await this.pollAndFetch(t, "video", this.videoPollDeadlineMs);
      sess.consumed = true;
      this.sessions.delete(taskId as string);
      this.drainNotes(t, warnings);
      return {
        status: "completed",
        url: `data:${got.contentType};base64,${got.b64}`,
        raw: { provider: "gemini-web", engine: "Omni (UI)" },
        ...(warnings.length ? { warnings } : {}),
      };
    } catch (e) {
      this.drainNotes(t, warnings);
      // P1-D(审查):仅 S410(轮询超时,生成可能仍在跑)保留会话供重试;S400 是页面终态报错
      // (配额窗口耗尽/无法生成)—— 必须终态 failed 并删会话,否则同步路径空转到外层 900s 超时。
      if (e instanceof GeminiError && e.code === "S410") {
        return { status: "in_progress", raw: { note: (e as Error).message } };
      }
      this.sessions.delete(taskId as string); // P2-4:终态删会话(防 Map 只增不减)
      return { status: "failed", error: (e as Error).message, ...(warnings.length ? { warnings } : {}) };
    }
  }

  // ── UI 驱动序列 ──

  /** P1-E(审查):存在未消费视频会话时拒绝新提交 —— 单页 UI 驱动下 ensureFreshChat 会导航走
   * 其产物页,使其 getVideo 永远 S410(已消耗配额沉没且无告警;AIGC 抽卡连发场景必踩)。
   * 串行纪律:先 get_video 取件(或等其终态),再发下一条。 */
  private assertNoLiveSession(): void {
    for (const [id, sess] of this.sessions) {
      if (sess.consumed) continue;
      throw new GeminiError("S303", `已有未取件的视频会话 ${id}(单页 UI 驱动,新提交会导航走其产物页使配额沉没)。先 get_video(taskId="${id}") 取件后再发下一条。`, { precondition: true });
    }
  }

  /** 干净对话页:navigate /app + settle + 登录检查(S102)。 */
  private async ensureFreshChat(t: GeminiTransport): Promise<void> {
    await t.open();
    await t.navigate(DEFAULT_GEMINI_TAB_URL);
    await sleep(this.navSettleMs);
    const login = (await t.eval(EXPR_LOGIN)) as any;
    if (login?.__err) throw new GeminiError("S103", `登录态探测失败: ${login.__err}`);
    if (!login?.logged) {
      throw new GeminiError("S102", "Chrome 未登录 Google 账号(无账号徽章)", { hint: GEMINI_LOGIN_HINT, precondition: true });
    }
  }

  /** 「上传和工具」→ 模式项;徽章确认(软告警)。 */
  private async enterMode(t: GeminiTransport, kind: "image" | "video"): Promise<void> {
    const menu = (await t.eval(exprOpenToolsMenu())) as any;
    if (menu?.__err) throw new GeminiError("S103", `打开工具菜单失败: ${menu.__err}`);
    if (!menu?.ok) {
      throw new GeminiError("S101", `未找到「上传和工具」菜单按钮(UI 改版或页面未就绪;可见按钮标签:${JSON.stringify(menu?.visibleLabels ?? []).slice(0, 300)})`, { precondition: true });
    }
    await sleep(this.menuSettleMs);
    const item = (await t.eval(exprClickModeItem(kind === "image" ? T.imageMode : T.videoMode))) as any;
    if (item?.__err) throw new GeminiError("S103", `点击模式菜单项失败: ${item.__err}`);
    if (!item?.ok) {
      throw new GeminiError("S101", `工具菜单中未找到「${kind === "image" ? "制作图片" : "制作视频"}」入口(菜单文本:${String(item?.menuText ?? "").slice(0, 200)})`, { precondition: true });
    }
    await sleep(this.modeSettleMs);
    // 徽章软确认(改版敏感,不硬错)
    const badge = (await t.eval(EXPR_MODE_BADGE)) as any;
    const ok = kind === "image" ? T.imageEngineBadge.test(badge?.badge ?? "") : T.videoEngineBadge.test(badge?.badge ?? "");
    if (!ok) {
      pushNote(t, `模式徽章未确认(${kind};页面头部文本可能改版)——继续提交,若产物类型不符请反馈`);
    }
  }

  private async typeAndSend(t: GeminiTransport, prompt: string): Promise<void> {
    const focus = (await t.eval(EXPR_FOCUS_INPUT)) as any;
    if (!focus?.ok) throw new GeminiError("S101", `输入区未找到 rich-textarea(页面形态异常:${focus?.stage ?? "?"})`, { precondition: true });
    await t.insertText(prompt);
    await sleep(this.typeSettleMs);
    const send = (await t.eval(exprClickSend())) as any;
    if (!send?.ok) throw new GeminiError("S103", `发送按钮未找到/不可点(${send?.stage ?? "?"});prompt 可能未进输入框`, { geminiStatus: 0 });
  }

  /** 轮询产物 → 页面 fetch → base64(不含 data: 前缀;S410 超时/S400 页面错误)。 */
  private async pollAndFetch(t: GeminiTransport, kind: "image" | "video", deadlineMs: number): Promise<{ b64: string; contentType: string }> {
    const start = Date.now();
    let lastErr: string | null = null;
    let lastStage = "init";
    while (Date.now() - start < deadlineMs) {
      const poll = (await t.eval(kind === "image" ? EXPR_POLL_IMAGE : EXPR_POLL_VIDEO)) as any;
      if (poll?.__err) throw new GeminiError("S103", `产物轮询执行失败: ${poll.__err}`);
      lastStage = poll?.ready ? "ready" : poll?.err ? "err" : "waiting";
      if (poll?.err) {
        lastErr = String(poll.err);
        // 页面明确报错(连接/上限):立即失败,不空等到 deadline
        throw new GeminiError("S400", `页面报错: ${lastErr}${/上限|limit/i.test(lastErr) ? "(疑似配额窗口耗尽 —— 设置→用量限额 查看;5h 滚动刷新)" : ""}`);
      }
      if (poll?.ready && (poll?.src || kind === "image")) {
        // 图像:canvas 抓取(fetch(blob) 不可用,见 EXPR_CANVAS_GRAB 注释);视频:直链 fetch。
        const fetched = (await t.eval(
          kind === "image" ? EXPR_CANVAS_GRAB : exprFetchB64(String(poll.src)),
          60_000,
        )) as any;
        if (fetched?.__err) throw new GeminiError("S200", `产物下载失败: ${fetched.__err}${kind === "video" ? `(src: ${String(poll.src).slice(0, 80)})` : ""}`, { geminiStatus: 0 });
        if (!fetched?.b64) throw new GeminiError("S200", "产物下载返回空 b64", { geminiStatus: 0 });
        const ct = String(fetched.contentType || (kind === "image" ? "image/jpeg" : "video/mp4"));
        return { b64: String(fetched.b64), contentType: ct };
      }
      await sleep(this.pollIntervalMs);
    }
    throw new GeminiError("S410", `生成轮询超时(>${Math.round(deadlineMs / 1000)}s,lastStage=${lastStage}${lastErr ? `, lastErr=${lastErr}` : ""});底层生成不受影响 —— 页面上可能稍后出结果,但本进程无法再取(会话保留可重试 get_video)`, { geminiStatus: 0 });
  }

  private drainNotes(t: GeminiTransport, warnings: string[]): void {
    const notes = (t as any)?.notes;
    if (Array.isArray(notes) && notes.length) {
      warnings.push(...notes.splice(0, notes.length).map((n: string) => `[自愈] ${n}`));
    }
  }

  private resolveImageModel(model: string | undefined): string {
    const m = model ?? GEMINI_IMAGE_MODELS[0];
    if (!GEMINI_IMAGE_MODELS.includes(m)) {
      throw new GeminiError("S300", `未知图像模型 "${m}"。gemini 可用:${GEMINI_IMAGE_MODELS.join(", ")}(制作图片模式引擎固定 Nano Banana 2)。`);
    }
    return m;
  }

  private resolveVideoModel(model: string | undefined): string {
    const m = model ?? GEMINI_VIDEO_MODELS[0];
    if (!GEMINI_VIDEO_MODELS.includes(m)) {
      throw new GeminiError("S300", `未知视频模型 "${m}"。gemini 可用:${GEMINI_VIDEO_MODELS.join(", ")}(制作视频模式引擎固定 Omni)。`);
    }
    return m;
  }
}

/** 错误透传时把已积累 warnings 附到 GeminiError 消息(handler 语义:失败路径也不丢消费告警)。 */
function withWarnings(e: unknown, warnings: string[]): unknown {
  if (warnings.length && e instanceof GeminiError && !e.message.includes("[warn]")) {
    const w = new GeminiError(e.code, `${e.message.replace(/^\[gemini\] /, "")} | warnings: ${warnings.join("; ").slice(0, 500)}`);
    return w;
  }
  return e;
}
