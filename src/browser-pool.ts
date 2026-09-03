import { accessSync, constants, utimesSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

/**
 * browser-pool.ts —— render 管线浏览器生命周期(2026-09-01 P0 根治 → 2026-09-02 attach 切换
 * → 2026-09-03 legacy 自管池提前退役,原定 2026-12-01)。
 *
 * 单档运行形态,由 MEDIA_GEN_RENDER_MODE 二态选择(auto/attach,非法值与已退役的 legacy 值
 * 均 warn 后按 auto):
 *
 *  ▸ attach/auto 档(默认,lasso 渲染档):**不自管 launch** —— 经 `lasso-mcp render-chrome --ensure`
 *    拿 wsEndpoint 后 puppeteer.connect 附着到 lasso 治理的确定性渲染档 Chrome(确定性 8 旗标 +
 *    headless=new 由 lasso 渲染档 profile 保证,责任移交)。P0 事故根因「浏览器生命周期归属了会死的
 *    消费方进程」就此消除:消费方(含宿主会话)被 SIGKILL,渲染档照常存活、照常被 lasso idle 回收。
 *      - ensure 解析链:MEDIA_GEN_LASSO_BIN(显式路径)→ PATH 直查 lasso-mcp → npx -y 兜底(90s 预算)
 *      - 连接:puppeteer.connect({ browserWSEndpoint, defaultViewport: null });页面级 setViewport
 *        由渲染方自管(多渲染会话互不污染)
 *      - 归还 = browser.disconnect(),🔴 严禁 close()(connect 实例的 close 会下发 Browser.close
 *        CDP 指令直接杀掉共享渲染档 —— 池语义 close 已映射为 disconnect)
 *      - heartbeat:acquire/release 引用计数驱动 —— acquire 前后各 touch 一次(ensure 下发的
 *        touchPath,mtime 即「在用」信号)+ 渲染存续期间每 ≤60s touch;unref 不 pin 事件循环
 *      - 失配降级:ensure 非零退出/超时/不可解析 → 结构化错误 RENDER_BROWSER_UNAVAILABLE
 *        (🔴 绝不静默回落自管 launch,泄漏路径不复活)
 *
 * 退役史:2026-09-01 P0 根治的自管池(launch + exit 钩子 + idle 5min)曾以
 * MEDIA_GEN_RENDER_MODE=legacy 逃生门保留,原定 2026-12-01 退役,经用户裁决于
 * 2026-09-03 提前彻底移除(方案:doc/legacy清除-方案与判定.md);设 legacy 现产生
 * warning 并按 auto 处理,MEDIA_GEN_BROWSER_IDLE_MS 随之一并移除。
 *
 * 注意:本文件含 Date/process.pid 等「生命周期」时源(heartbeat),不参与渲染产物 ——
 * determinism.test.ts 的时源扫描范围(6 个渲染文件)刻意不含本文件,与 render-video
 * (合法计时)同边界。
 */

const execFileAsync = promisify(execFile);

// ── 类型(自 render-svg.ts 迁入;render-svg 转为 re-export 保持兼容)──
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  /** 监听断连(Chrome 崩溃/被外部杀死)→ 池自我清理;测试 mock 可缺省。 */
  once?(event: string, listener: () => void): unknown;
}
export interface PageLike {
  setViewport(opts: any): Promise<void>;
  setContent(html: string, opts: any): Promise<void>;
  evaluateHandle(expr: string): Promise<unknown>;
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  createCDPSession(): Promise<CDPSessionLike>;
  screenshot(opts: any): Promise<Uint8Array | string>;
  close(): Promise<void>;
  /** 元素句柄查询(export-png 按 <svg> 元素裁剪截图用;测试 mock 可缺省)。 */
  $?(selector: string): Promise<ElementHandleLike | null>;
}
export interface ElementHandleLike {
  screenshot(opts: any): Promise<Uint8Array | string | void>;
}
export interface CDPSessionLike {
  send(method: string, params?: any): Promise<any>;
}

/** 渲染档不可用(lasso ensure 失败 / puppeteer-core 缺失)。渲染方据此走降级路径。 */
export class BrowserUnavailableError extends Error {
  /** 结构化降级码:恒为 "RENDER_BROWSER_UNAVAILABLE"(2026-09-03 legacy 退役后无无码形态)。 */
  readonly code?: string;
  constructor(message = "Chrome/Edge not available", code?: string) {
    super(message);
    this.name = "BrowserUnavailableError";
    if (code) this.code = code;
  }
}

// ══════════════════ MEDIA_GEN_RENDER_MODE 二态(对接契约 §二.d,2026-09-03 legacy 提前退役)══════════════════

export type RenderMode = "auto" | "attach";

/**
 * 解析渲染档位:env MEDIA_GEN_RENDER_MODE 唯一入口。
 *  - auto(默认):ensure 成功 → attach;失败 → 结构化错误(绝不静默回落自管 launch)
 *  - attach:强制 attach(CI/验收钉死渲染档),ensure 失败同上报错
 *  - legacy:已退役(2026-09-03 自管池移除)—— 专用 warn(每值每进程一次)后按 auto
 *  - 其他非法值:warn(每值每进程一次)后按 auto
 */
const warnedInvalidModes = new Set<string>();
export function resolveRenderMode(env: { MEDIA_GEN_RENDER_MODE?: string | undefined } = process.env): RenderMode {
  const raw = env.MEDIA_GEN_RENDER_MODE?.trim().toLowerCase();
  if (raw === "attach") return raw;
  if (raw == null || raw === "" || raw === "auto") return "auto";
  if (!warnedInvalidModes.has(raw)) {
    warnedInvalidModes.add(raw);
    console.warn(
      raw === "legacy"
        ? `[browser-pool] MEDIA_GEN_RENDER_MODE="legacy" 已退役(自管池移除),按 auto 处理`
        : `[browser-pool] MEDIA_GEN_RENDER_MODE="${raw}" 非法(合法值 auto|attach),按 auto 处理`,
    );
  }
  return "auto";
}

// ══════════════════ 降级模板(对接契约 §二.d,lasso 验收照此比对文案)══════════════════

export const RENDER_UNAVAILABLE_CODE = "RENDER_BROWSER_UNAVAILABLE";
/**
 * 自愈命令短语唯一来源(F7 收敛,2026-09-03):降级模板与 connect 失败两处此前内联复述,
 * 漂移即误导用户。🔴 文案变更须同步 lasso 验收比对文案(对接契约 §二.d)与
 * test/browser-pool-attach.test.ts 断言;模块私有不扩导出面。
 */
const ENSURE_SELF_HEAL_COMMAND = "npx -y lasso-mcp render-chrome --ensure";

export function renderBrowserUnavailableMessage(ensureDetail: string): string {
  return (
    `确定性渲染需 lasso 渲染档:先运行 \`${ENSURE_SELF_HEAL_COMMAND}\` 后重试` +
    `(未装 lasso 见其 README)。ensure stderr: ${ensureDetail}`
  );
}

function renderUnavailable(ensureDetail: string): BrowserUnavailableError {
  return new BrowserUnavailableError(renderBrowserUnavailableMessage(ensureDetail), RENDER_UNAVAILABLE_CODE);
}

// ── 常量 ──
/** ensure 超时预算(对接契约 §一.1:消费方给 25s;lasso 内部拉起上限 20s,冷启 ~6.3s 余量充足)。 */
const ENSURE_TIMEOUT_MS = 25 * 1000;
/** npx 兜底路径超时预算(冷启可超 25s,放宽到 90s —— 对接契约 §一.1)。 */
const NPX_ENSURE_TIMEOUT_MS = 90 * 1000;
/** 渲染会话存续期间 heartbeat 周期(对接契约 §一.2:每 ≤60s touch 一次)。 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

// ══════════════════ attach 档:ensure 解析链 + connect + heartbeat ══════════════════

/** `lasso-mcp render-chrome --ensure` 成功输出的消费字段(未知字段忽略,前向兼容)。 */
export interface LassoEnsureInfo {
  /** ws://127.0.0.1:<port>/devtools/browser/<uuid>(/json/version 权威来源)。 */
  wsEndpoint: string;
  /** heartbeat 目标文件绝对路径(ensure 下发,消费方不硬编码)。 */
  touchPath?: string;
}

/** PATH 直查可执行文件(node 无内置 which;避免 npx 兜底的冷启开销)。 */
function findExecutableOnPath(name: string): string | null {
  const pathVar = process.env.PATH;
  if (!pathVar) return null;
  const exts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch { /* continue */ }
    }
  }
  return null;
}

/** ensure 可执行文件解析链:MEDIA_GEN_LASSO_BIN(显式,CI 用)→ PATH 直查 → npx -y 兜底。 */
export function resolveLassoEnsure(): { file: string; args: string[]; timeoutMs: number } {
  const explicit = process.env.MEDIA_GEN_LASSO_BIN?.trim();
  if (explicit) {
    return { file: explicit, args: ["render-chrome", "--ensure"], timeoutMs: ENSURE_TIMEOUT_MS };
  }
  const onPath = findExecutableOnPath("lasso-mcp");
  if (onPath) {
    return { file: onPath, args: ["render-chrome", "--ensure"], timeoutMs: ENSURE_TIMEOUT_MS };
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return { file: npx, args: ["-y", "lasso-mcp", "render-chrome", "--ensure"], timeoutMs: NPX_ENSURE_TIMEOUT_MS };
}

function ensureFailureDetail(e: unknown, file: string, budgetMs: number): string {
  const err = e as { killed?: boolean; code?: number | string; stderr?: string; message?: string } | null;
  if (err?.killed || /timed? out/i.test(String(err?.message ?? ""))) {
    return `ensure 超时(>${Math.round(budgetMs / 1000)}s,${file})`;
  }
  if (err?.code === "ENOENT") {
    return `可执行文件不存在: ${file}(装 lasso:npm i -g lasso-mcp,或设 MEDIA_GEN_LASSO_BIN 指向其入口)`;
  }
  const se = String(err?.stderr ?? "").trim();
  if (typeof err?.code === "number") return se ? `exit ${err.code}: ${se}` : `exit ${err.code}`;
  return se || err?.message || String(e);
}

/** ensure 阶段原始异常 → 降级 detail(execFile 形状:exit N + stderr 优先;否则 message)。 */
function rawEnsureDetail(e: unknown): string {
  const err = e as { code?: unknown; stderr?: string; message?: string } | null;
  const se = String(err?.stderr ?? "").trim();
  if (typeof err?.code === "number") return se ? `exit ${err.code}: ${se}` : `exit ${err.code}`;
  return se || err?.message || String(e);
}

/** 真跑 `render-chrome --ensure`:仅 exit===0 且 stdout 单行 JSON 可 parse 才放行,其余结构化降级。 */
async function runEnsure(): Promise<LassoEnsureInfo> {
  const { file, args, timeoutMs } = resolveLassoEnsure();
  let stdout = "", stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      // win32 .cmd 须 shell 才能被 execFile 拉起(args 全常量,无注入面)
      ...(process.platform === "win32" && /\.cmd$/i.test(file) ? { shell: true } : {}),
    }));
  } catch (e) {
    throw renderUnavailable(ensureFailureDetail(e, file, timeoutMs));
  }
  // stdout 纯净性契约:只允许一行 JSON(取最后一个非空行,容忍尾随换行;未知字段忽略)
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (!line) throw renderUnavailable(stderr.trim() || "ensure stdout 为空");
  let info: { wsEndpoint?: unknown; touchPath?: unknown };
  try {
    info = JSON.parse(line);
  } catch {
    throw renderUnavailable(stderr.trim() || `ensure stdout 不可解析: ${line.slice(0, 200)}`);
  }
  if (typeof info?.wsEndpoint !== "string" || !/^wss?:\/\//.test(info.wsEndpoint)) {
    throw renderUnavailable(stderr.trim() || "ensure 输出缺合法 wsEndpoint 字段");
  }
  return {
    wsEndpoint: info.wsEndpoint,
    touchPath: typeof info.touchPath === "string" && info.touchPath ? info.touchPath : undefined,
  };
}

/**
 * 夹取整数 env 单源(#6 收敛,2026-09-03):读 env 字符串 → Number → 有限则截断小数并夹到
 * [min, max],非有限/未设 → fallback。此前两处同形散写(读字符串 → Number.isFinite →
 * 各自 min/max),漂移即两种写法 —— 由消费方声明夹取域(现存唯一消费方=heartbeatIntervalMs;legacy idleMs 已随 2026-09-03 退役)。
 * 现存唯一消费方 = heartbeatIntervalMs(idleMs 消费随 2026-09-03 legacy 自管池退役删除)。
 * 全仓 grep 结论:env 字符串→数字夹取仅此一处(config.ts num() 是 file>env 优先级解析且
 * float 域,非同形,不收敛)。负值语义 = 夹到 min。
 */
export function clampIntEnv(raw: string | undefined, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
  if (raw != null && raw.trim() !== "") {
    const v = Number(raw);
    if (Number.isFinite(v)) return Math.max(min, Math.min(Math.trunc(v), max));
  }
  return fallback;
}

/** heartbeat 周期:默认 60s(契约封顶);env MEDIA_GEN_RENDER_HEARTBEAT_MS 供测试调短(夹取域 [50, 60s],封顶 60s 不违约)。 */
function heartbeatIntervalMs(): number {
  return clampIntEnv(process.env.MEDIA_GEN_RENDER_HEARTBEAT_MS, DEFAULT_HEARTBEAT_INTERVAL_MS, 50, DEFAULT_HEARTBEAT_INTERVAL_MS);
}

/**
 * touch 渲染档「在用」信号(lasso chrome-touch 契约:文件 mtime 即活动信号,bug02 教训)。
 * 已存在 → utimes 刷 mtime;ENOENT → 创建(与 lasso touchChromePort 同款降序)。失败仅 warn 不阻断渲染。
 */
function touchRender(touchPath: string): void {
  try {
    const now = new Date();
    try {
      utimesSync(touchPath, now, now);
    } catch {
      writeFileSync(touchPath, `${Date.now()}\n`, "utf8"); // ENOENT:创建(mtime 即诞生)
    }
  } catch (e) {
    console.warn(`[browser-pool] render-chrome touch 失败(${touchPath}): ${(e as Error)?.message ?? e}`);
  }
}

// ── attach 池状态(进程级单例)──
interface AttachedEntry {
  browser: BrowserLike; // wrapper:close 已映射 disconnect
  wsEndpoint: string;
  touchPath: string | null;
}
let attachedEntry: AttachedEntry | null = null;
let attaching: Promise<BrowserLike> | null = null; // 单飞锁:并发调用共享同一次 ensure+connect
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ensureCalls = 0;
let attachCount = 0;
let refCount = 0; // 活跃借用数:>0 期间 heartbeat 武装(legacy 自管池退役后由 attach 语义独享)

/** 测试注入点:mock ensure 输出(替代真跑 lasso CLI)。 */
let ensureOverride: (() => Promise<LassoEnsureInfo>) | null = null;
/** 测试注入点:mock connect(可断言 {browserWSEndpoint, defaultViewport:null} 选项与 disconnect 归还语义)。 */
type AttachConnector = (opts: { browserWSEndpoint: string; defaultViewport: null }) => Promise<unknown>;
let connectorOverride: AttachConnector | null = null;

function stopHeartbeatTimer(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

/** 引用计数驱动 heartbeat 启停:仅「有活跃借用且有 touchPath」期间武装;unref 不 pin 事件循环。 */
function syncHeartbeat(): void {
  const want = refCount > 0 && attachedEntry?.touchPath != null;
  if (want && heartbeatTimer == null) {
    // F1(02 审查):tick 读现值而非闭包捕获 —— 断连重 attach(touchPath 可能变化)后旧定时器
    // 自动 touch 新路径,消除"长渲染中途回收"窗口(attach 核心承诺:长渲染不误判空闲)
    heartbeatTimer = setInterval(() => {
      const tp = attachedEntry?.touchPath;
      if (tp) touchRender(tp);
    }, heartbeatIntervalMs());
    heartbeatTimer.unref?.();
  } else if (!want && heartbeatTimer != null) {
    stopHeartbeatTimer();
  }
}

/** 默认 connect:🔴 选项名 = browserWSEndpoint(webSocketDebuggerUrl 是 CDP /json/version 字段名,照抄直接 throw)。 */
async function defaultConnect(wsEndpoint: string): Promise<unknown> {
  const puppeteer = await import("puppeteer-core").catch(() => null);
  if (!puppeteer) {
    // puppeteer-core 是硬依赖,理论不可达;仍保持结构化「不可用」降级的诚实出口
    throw new BrowserUnavailableError(
      "Chrome/Edge not available — puppeteer-core missing", RENDER_UNAVAILABLE_CODE,
    );
  }
  return puppeteer.default.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
}

/**
 * 把 connect() 得到的实例包装成 BrowserLike:🔴 池语义 close 必须映射 disconnect ——
 * 对 connect 实例调 close() 会向 Chrome 下发 Browser.close CDP 指令,直接杀掉共享渲染档
 * (对接契约 §一.5 最易翻车点)。页面级 setViewport 照旧由渲染方自管(defaultViewport:null)。
 */
function wrapConnectedBrowser(raw: unknown): BrowserLike {
  const r = raw as {
    newPage(...args: unknown[]): Promise<PageLike>;
    disconnect(): Promise<void>;
    once?(event: string, listener: () => void): unknown;
  };
  return {
    newPage: (...args: unknown[]) => r.newPage(...args),
    close: () => r.disconnect(),
  };
}

/** 单飞 ensure+connect:已附着直接复用(每次 acquire 前置 touch);断连自清理后下次重新 ensure。 */
async function ensureAttached(): Promise<BrowserLike> {
  if (attachedEntry) {
    if (attachedEntry.touchPath) touchRender(attachedEntry.touchPath); // acquire 前置 touch(契约 §一.2 ①)
    return attachedEntry.browser;
  }
  if (attaching) return attaching;
  attaching = (async (): Promise<BrowserLike> => {
    ensureCalls++;
    let info: LassoEnsureInfo;
    try {
      info = ensureOverride ? await ensureOverride() : await runEnsure();
    } catch (e) {
      // ensure 阶段任何失败(execFile 非零/超时/解析失败/注入 mock 异常)→ 统一结构化降级;
      // runEnsure 内部已包装的直接透传,不二次套娃
      if (e instanceof BrowserUnavailableError && e.code === RENDER_UNAVAILABLE_CODE) throw e;
      throw renderUnavailable(rawEnsureDetail(e));
    }
    let raw: unknown;
    try {
      raw = connectorOverride
        ? await connectorOverride({ browserWSEndpoint: info.wsEndpoint, defaultViewport: null })
        : await defaultConnect(info.wsEndpoint);
    } catch (e) {
      // ensure 成功但 connect 失败(渲染档瞬死/网络抖动)→ 同码降级,指引自愈命令
      throw new BrowserUnavailableError(
        `渲染档连接失败(${(e as Error)?.message ?? e});可运行 \`${ENSURE_SELF_HEAL_COMMAND}\` 自愈后重试`,
        RENDER_UNAVAILABLE_CODE,
      );
    }
    const entry: AttachedEntry = {
      browser: wrapConnectedBrowser(raw),
      wsEndpoint: info.wsEndpoint,
      touchPath: info.touchPath ?? null,
    };
    attachCount++;
    try {
      (raw as { once?: (ev: string, cb: () => void) => unknown })?.once?.("disconnected", () => {
        // CDP 断连只做消费方侧自清理(契约 §一.5):短渲染间隙频繁连断是常态,
        // lasso 不因断连回收,本池也不杀不删(浏览器/profile 归 lasso)
        if (attachedEntry === entry) {
          attachedEntry = null;
          syncHeartbeat(); // F1:断连即停旧 heartbeat,下次 acquire 重 attach 后按新 touchPath 重臂
        }
      });
    } catch { /* ignore */ }
    attachedEntry = entry;
    if (entry.touchPath) touchRender(entry.touchPath); // attach 即渲染前 touch
    syncHeartbeat();
    return entry.browser;
  })().finally(() => { attaching = null; });
  return attaching;
}

/**
 * 归还 attach 连接(= disconnect,严禁杀共享渲染档);默认等待在飞单飞锁落定后再清态
 * (异步 API/测试复位路径语义正确)。信号路径传 false:在飞 ensure 含 npx 兜底 90s 预算,
 * 等它 = SIGTERM 后滞留至多 90s;不等则连接随进程消亡,共享渲染档无损(生命周期归 lasso)。
 */
async function releaseAttach(awaitInFlight = true): Promise<void> {
  if (attaching && awaitInFlight) { try { await attaching.catch(() => {}); } catch { /* ignore */ } }
  stopHeartbeatTimer();
  const entry = attachedEntry;
  attachedEntry = null;
  if (entry) {
    try { await entry.browser.close(); } catch { /* best-effort disconnect */ }
  }
}

// ══════════════════ 公共 API ══════════════════

// F3 导出面盘点(2026-09-03 legacy 退役收缩,机械钉死见 test/browser-pool-attach.test.ts「导出面」):
// 本模块导出 20 个符号(14 值 + 6 类型),运行时消费面只有 6 符号 API 子集 ——
// withBrowser / acquireBrowser / releaseBrowser / BrowserUnavailableError / RENDER_UNAVAILABLE_CODE /
// BrowserLike(render-video 另用 PageLike/CDPSessionLike 类型),由三个渲染消费方使用:
// render-svg.ts(withBrowser 全套)、render-video.ts(acquire/release 逐帧长会话)、
// interactive-html/export-png.ts(仅 withBrowser)。其余导出(resolveRenderMode/常量/测试注入
// setAttachProviderForTests/诊断 getBrowserPoolState/shutdownBrowser/syncCleanupOnExit/
// renderBrowserUnavailableMessage)只被 test 与诊断脚本消费 —— 新增运行时导出前先核这
// 三消费方,防导出面无主增长。

/**
 * 借用浏览器(引用计数 +1,渲染主路径用)。配对 releaseBrowser(try/finally)。
 * ensure→connect;失败抛 code=RENDER_BROWSER_UNAVAILABLE 的 BrowserUnavailableError
 * (🔴 绝不静默回落自管 launch —— 自管池已随 2026-09-03 legacy 退役物理删除)—— 计数已回退。
 */
export async function acquireBrowser(): Promise<BrowserLike> {
  refCount++;
  // 无 idle 定时器可抑制(idle 归 lasso);引用计数驱动 heartbeat
  try {
    const b = await ensureAttached();
    syncHeartbeat();
    return b;
  } catch (e) {
    refCount = Math.max(0, refCount - 1);
    syncHeartbeat();
    throw e;
  }
}

/** 归还借用(引用计数 -1);归零后 touch 一次 + 停 heartbeat(idle 回收归 lasso)。 */
export function releaseBrowser(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    if (attachedEntry?.touchPath) touchRender(attachedEntry.touchPath); // 归还即渲染后 touch(契约 §一.2 ①)
    syncHeartbeat(); // → 停 heartbeat
  }
}

/**
 * 渲染包裹器:acquire → fn → release(finally 保证异常路径也归还)。
 * withBrowser 持有引用期间 attach heartbeat 在跑 —— 长渲染不误判空闲。
 */
export async function withBrowser<T>(fn: (browser: BrowserLike) => Promise<T>): Promise<T> {
  const browser = await acquireBrowser();
  try {
    return await fn(browser);
  } finally {
    releaseBrowser();
  }
}

/**
 * 兼容 probe 语义(= 旧 render-svg.getBrowser):确保已附着并返回实例,不可用返回 null。
 * 不加引用计数 —— 仅用于可用性探测/测试收尾;渲染主路径必须用 withBrowser/acquireBrowser。
 */
export async function getBrowser(): Promise<BrowserLike | null> {
  return ensureAttached().catch(() => null);
}

/** 立即归还当前连接(不等空闲):= disconnect,共享渲染档继续存活(生命周期归 lasso)。 */
export async function shutdownBrowser(): Promise<void> {
  await releaseAttach();
}

/** 池状态(测试/诊断只读快照)。 */
export function getBrowserPoolState(): {
  mode: RenderMode;
  refCount: number;
  attached: boolean;
  attachCount: number;
  ensureCalls: number;
  heartbeatArmed: boolean;
  wsEndpoint: string | null;
} {
  return {
    mode: resolveRenderMode(),
    refCount,
    attached: attachedEntry !== null,
    attachCount,
    ensureCalls,
    heartbeatArmed: heartbeatTimer !== null,
    wsEndpoint: attachedEntry ? attachedEntry.wsEndpoint : null,
  };
}

/**
 * 测试注入:替换 attach 档的 ensure 与 connect 两步(mock ensure 输出 / 断言 connect 选项与
 * disconnect 归还语义)。传 null 恢复默认真跑。注入前先归还既有 attach 连接。
 */
export async function setAttachProviderForTests(
  ensure: (() => Promise<LassoEnsureInfo>) | null,
  connector: AttachConnector | null,
): Promise<void> {
  await releaseAttach();
  ensureOverride = ensure;
  connectorOverride = connector;
}

// ── 进程级登记与退出钩子(模块加载即注册一次;render-svg/index 启动即导入本模块)──

/**
 * exit 钩子体(同步,零 await):仅清本地连接态(🔴 绝不杀共享渲染档/不删其 profile ——
 * 生命周期归属 lasso,连接随进程消亡)。
 */
export function syncCleanupOnExit(): void {
  // 真实 'exit' 时进程随即消亡,清状态仅图幂等;测试直调则防「复活已杀实例」。
  attachedEntry = null;
  stopHeartbeatTimer();
}

let hooksRegistered = false;
function registerExitHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // 'exit' 钩子纯增量(不改进程行为),无条件注册 —— SIGKILL 以外的一切退出路径都走到这里。
  process.on("exit", syncCleanupOnExit);
  // 进程信号:仅断连既有连接后退出(对接契约 §一.5)。
  // server 模式必需;独立脚本/测试可设 MEDIA_GEN_NO_SIGNAL_HANDLERS=1 禁用
  // (避免全局 handler 干扰其他 shutdown 逻辑 —— 沿用旧 render-svg 同名开关与语义)。
  if (!process.env.MEDIA_GEN_NO_SIGNAL_HANDLERS) {
    const exitHandler = () => {
      // 信号路径不等在飞 ensure(2026-09-03 项1:npx 兜底 90s 预算,等它=SIGTERM 滞留);
      // 既有连接仍 disconnect 后退出(对接契约 §一.5)
      releaseAttach(false)
        .catch(() => {})
        .finally(() => process.exit(0));
    };
    process.on("SIGINT", exitHandler);
    process.on("SIGTERM", exitHandler);
  }
}
registerExitHooks();
