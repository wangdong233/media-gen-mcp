import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * browser-pool.ts —— render 管线共享 Chrome 的进程级单例池(2026-09-01 P0 根治)。
 *
 * 事故背景(doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md):
 *  旧实现「每次调用 launch 新 Chrome + 30s 空闲定时器关停」——spawner(MCP server)被
 *  SIGKILL 时定时器随宿主消亡,清理路径永不执行 → 两天 83 孤儿 Chrome(+599 族进程,
 *  18.8GB RSS)→ 整机 Load 680 冻结。本模块按报告 §8.1/§8.2 根治:
 *
 *  1. 进程级全局单例:首次 launch、后续复用;单飞锁防并发重复 launch;引用计数防
 *     「渲染进行中浏览器被空闲回收」;空闲 N 分钟(默认 5min)自动 close + 删 profile 目录。
 *     旧 30s 空闲过短 —— 促发频繁冷 launch(每次 ~1-2s),5min 换稳定复用。
 *  2. 堵死孤儿路径:launch 成功即登记进程级 live 集合;process.on('exit') 同步
 *     best-effort 清理(SIGKILL 主进程 + rmSync profile 目录 —— exit 钩子内零 await);
 *     SIGTERM/SIGINT 异步 close 后退出;launch 显式 handleSIGTERM/handleSIGHUP/handleSIGINT
 *     + timeout 防挂死;渲染方一律 acquire/release(try/finally)配对。
 *     (SIGKILL 本身无解 —— 由看门狗兜底,见报告 §8.3。)
 *  3. 可识别性:profile 目录固定前缀 media-gen-mcp-render-<pid>-<rand>,命令行含
 *     `--user-data-dir=…/media-gen-mcp-render-…` —— 复发时
 *     `pgrep -f media-gen-mcp-render` 可精确侦察/清理,永不误伤用户真身 Chrome。
 *
 * 确定性承诺(不回归):DETERMINISTIC_FLAGS 八旗标原样保留 —— 同输入同输出是
 * render 管线的核心承诺(2026-08-27 live 验证)。
 *
 * 注意:本文件含 Date/process.pid 等「生命周期」时源(空闲计时/profile 命名),
 * 不参与渲染产物 —— determinism.test.ts 的时源扫描范围(6 个渲染文件)刻意不含本文件,
 * 与 render-video(合法计时)同边界。
 */

// ── 类型(自 render-svg.ts 迁入;render-svg 转为 re-export 保持兼容)──
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  /** puppeteer Browser.process() —— exit 钩子同步 SIGKILL 用;测试 mock 可缺省。 */
  process?(): { kill(signal?: string): void } | null;
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

/** Chrome/Edge 均不可用(puppeteer-core 缺失或双 launch 失败)。渲染方据此走降级路径。 */
export class BrowserUnavailableError extends Error {
  constructor(message = "Chrome/Edge not available") {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

// ── 常量 ──
/** profile 目录前缀 —— 报告 §9 自救命令 pgrep/pkill 的识别特征,改名须同步报告附录。 */
export const PROFILE_DIR_PREFIX = "media-gen-mcp-render";
/** 空闲回收默认 5min(报告 §8.1:旧 30s 过短促发频 launch);env 覆盖供测试/独立脚本调短。 */
export const DEFAULT_BROWSER_IDLE_MS = 5 * 60 * 1000;
/** launch 超时(防 Chrome 卡死挂死渲染调用)。 */
const LAUNCH_TIMEOUT_MS = 30 * 1000;

// 确定性渲染 flags(原 render-svg.ts 同款,逐字不改动 —— SVG 截图 + 视频帧捕获共用;
// HyperFrames 同款):
// --force-color-profile=srgb:颜色一致;--run-all-compositor-stages-before-draw:截图前合成器刷完;
// --disable-background-timer-throttling:GSAP ticker 不被节流;--disable-backgrounding-occluded-windows:防后台化。
const DETERMINISTIC_FLAGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--font-render-hinting=full",
  "--force-color-profile=srgb",
  "--run-all-compositor-stages-before-draw",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

/** 探测系统 Edge 路径(跨平台,Chrome 不可用时的回退)。 */
function findEdgePath(): string | undefined {
  const candidates = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((p) => {
    try { return existsSync(p); } catch { return false; }
  });
}

// ── 池状态(进程级单例)──
interface LiveBrowser {
  browser: BrowserLike;
  profileDir: string;
  /** exit 钩子同步兜底杀的进程句柄记录(mock/真浏览器通用)。 */
  exitKill: () => void;
}
let current: LiveBrowser | null = null;
let launching: Promise<BrowserLike | null> | null = null; // 单飞锁:并发调用共享同一次 launch
let refCount = 0; // 活跃借用数:>0 时空闲回收绝不触发
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let launchCount = 0;
/** 进程级登记:exit 时兜底清理的全部实例(正常 close 后移除)。SIGKILL 孤儿路径的最后一道进程内防线。 */
const liveForExit = new Set<LiveBrowser>();

/** 测试注入点:替换 launch 实现(mock browser);null = 恢复默认真 launch。 */
let launcherOverride: (() => Promise<{ browser: BrowserLike; profileDir: string } | null>) | null = null;

/** 空闲回收时长:env MEDIA_GEN_BROWSER_IDLE_MS 覆盖(读取时机 = 每次武装定时器,测试可动态设)。 */
function idleMs(): number {
  const raw = process.env.MEDIA_GEN_BROWSER_IDLE_MS;
  if (raw != null && raw.trim() !== "") {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return DEFAULT_BROWSER_IDLE_MS;
}

function clearIdleTimer(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/** 武装空闲定时器:仅当零借用且有存活实例;unref 保证不 pin 事件循环(独立脚本靠传输层退场后自然退出)。 */
function armIdleTimer(): void {
  clearIdleTimer();
  if (refCount > 0 || !current) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void closeBrowser();
  }, idleMs());
  idleTimer.unref?.();
}

function removeProfileDir(profileDir: string): void {
  try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

/** 关停当前实例:close 失败(已死/超时)→ 同步 SIGKILL 兜底;成功后删 profile 目录。 */
async function closeBrowser(): Promise<void> {
  const entry = current;
  current = null;
  clearIdleTimer();
  if (!entry) return;
  liveForExit.delete(entry);
  try {
    await entry.browser.close();
  } catch {
    try { entry.exitKill(); } catch { /* ignore */ }
  }
  removeProfileDir(entry.profileDir);
}

/** 默认 launch:Chrome(channel)→ Edge 回退;固定前缀 profile + 显式信号处理 + 超时。 */
async function defaultLaunch(): Promise<{ browser: BrowserLike; profileDir: string } | null> {
  const puppeteer = await import("puppeteer-core").catch(() => null);
  if (!puppeteer) return null;
  // 固定可识别前缀(报告 §9 自救命令依赖):$TMPDIR/media-gen-mcp-render-<pid>-XXXXXX
  let profileDir: string;
  try {
    profileDir = mkdtempSync(path.join(os.tmpdir(), `${PROFILE_DIR_PREFIX}-${process.pid}-`));
  } catch (e) {
    // 极端边路(如磁盘满):建不出 profile → 按不可用降级,不让渲染调用裸抛
    console.error("[browser-pool] profile dir creation failed:", (e as Error)?.message);
    return null;
  }
  const common = {
    headless: true,
    args: DETERMINISTIC_FLAGS,
    userDataDir: profileDir,
    // 显式声明(默认即 true,显式 = 意图 + 防 puppeteer 未来改默认):
    // 宿主收到 SIGTERM/SIGINT/SIGHUP 时 puppeteer 自身也会尝试 close —— 与本池的
    // 信号钩子(见 registerExitHooks)双保险,任一路径命中都不会留孤儿。
    handleSIGINT: true,
    handleSIGTERM: true,
    handleSIGHUP: true,
    timeout: LAUNCH_TIMEOUT_MS, // launch 挂死上限
  };
  // 尝试 Chrome(channel:'chrome' 找标准路径)
  try {
    const b = await puppeteer.default.launch({ channel: "chrome", ...common });
    return { browser: b as unknown as BrowserLike, profileDir };
  } catch (e) {
    console.error("[browser-pool] Chrome launch failed, trying Edge:", (e as Error)?.message);
  }
  // 回退 Edge
  const edgePath = findEdgePath();
  if (edgePath) {
    try {
      const b = await puppeteer.default.launch({ ...common, executablePath: edgePath });
      return { browser: b as unknown as BrowserLike, profileDir };
    } catch (e) {
      console.error("[browser-pool] Edge launch failed:", (e as Error)?.message);
    }
  }
  // 双双失败:清掉刚建的 profile 目录,不留垃圾
  removeProfileDir(profileDir);
  return null;
}

/** 单飞 ensure:已有实例直接复用;否则(可能并发)共享同一次 launch。 */
async function ensureLaunched(): Promise<BrowserLike | null> {
  if (current) { armIdleTimer(); return current.browser; } // 触碰 = 重置空闲计时
  if (launching) return launching;
  launching = (async (): Promise<BrowserLike | null> => {
    const launched = launcherOverride ? await launcherOverride() : await defaultLaunch();
    if (!launched) return null;
    launchCount++;
    const entry: LiveBrowser = {
      browser: launched.browser,
      profileDir: launched.profileDir,
      exitKill: () => { launched.browser.process?.()?.kill("SIGKILL"); },
    };
    current = entry;
    liveForExit.add(entry);
    // Chrome 崩溃/被外部杀死:池自我清理,下次调用重新 launch(借用方操作会自然抛错)
    try { launched.browser.once?.("disconnected", () => {
      if (current === entry) {
        current = null;
        clearIdleTimer();
      }
      liveForExit.delete(entry);
      removeProfileDir(launched.profileDir);
    }); } catch { /* ignore */ }
    armIdleTimer();
    return launched.browser;
  })().finally(() => { launching = null; });
  return launching;
}

// ══════════════════ 公共 API ══════════════════

/**
 * 借用浏览器(引用计数 +1,渲染主路径用)。配对 releaseBrowser(try/finally)。
 * 不可用(Chrome/Edge 缺失或双 launch 失败)抛 BrowserUnavailableError —— 计数已回退。
 */
export async function acquireBrowser(): Promise<BrowserLike> {
  refCount++;
  clearIdleTimer(); // 有活跃借用期间绝不空闲回收
  let b: BrowserLike | null;
  try {
    b = await ensureLaunched();
  } catch (e) {
    // launch 路径意外异常(非「不可用」):计数也必须回退,不得泄漏计数器
    refCount--;
    if (refCount === 0) armIdleTimer();
    throw e;
  }
  if (!b) {
    refCount--;
    if (refCount === 0) armIdleTimer();
    throw new BrowserUnavailableError("Chrome/Edge not available — install Google Chrome or Microsoft Edge, or use a resvg/local fallback path.");
  }
  return b;
}

/** 归还借用(引用计数 -1);归零后武装空闲回收定时器。 */
export function releaseBrowser(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) armIdleTimer();
}

/**
 * 渲染包裹器:acquire → fn → release(finally 保证异常路径也归还)。
 * withBrowser 持有引用期间空闲回收被抑制 —— 长渲染不会被中途拆浏览器。
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
 * 兼容 probe 语义(= 旧 render-svg.getBrowser):确保已启动并返回实例,不可用返回 null。
 * 不加引用计数 —— 仅用于可用性探测/测试收尾;渲染主路径必须用 withBrowser/acquireBrowser。
 */
export async function getBrowser(): Promise<BrowserLike | null> {
  return ensureLaunched();
}

/** 立即关停当前实例(不等空闲):测试 after 钩子 / 显式收缩资源用。 */
export async function shutdownBrowser(): Promise<void> {
  await closeBrowser();
}

/** 池状态(测试/诊断只读快照)。 */
export function getBrowserPoolState(): {
  refCount: number;
  launched: boolean;
  launchCount: number;
  idleTimerArmed: boolean;
  profileDir: string | null;
  exitEntries: number;
} {
  return {
    refCount,
    launched: current !== null,
    launchCount,
    idleTimerArmed: idleTimer !== null,
    profileDir: current ? current.profileDir : null,
    exitEntries: liveForExit.size,
  };
}

/** 测试注入:替换 launch 实现;null 恢复默认。注入前若已有实例会先立即关停。 */
export async function setLauncherForTests(
  launcher: (() => Promise<{ browser: BrowserLike; profileDir: string } | null>) | null,
): Promise<void> {
  await closeBrowser();
  launcherOverride = launcher;
}

// ── 进程级登记与退出钩子(模块加载即注册一次;render-svg/index 启动即导入本模块)──

/** exit 钩子体(同步,零 await):SIGKILL Chrome 主进程(Helper 随管道断退出)+ rmSync profile。 */
export function syncCleanupOnExit(): void {
  // 真实 'exit' 时进程随即消亡,清 current 仅图幂等;测试直调则防「复活已杀实例」。
  current = null;
  clearIdleTimer();
  for (const entry of liveForExit) {
    try { entry.exitKill(); } catch { /* best-effort */ }
    try { rmSync(entry.profileDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  liveForExit.clear();
}

let hooksRegistered = false;
function registerExitHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  // 'exit' 钩子纯增量(不改进程行为),无条件注册 —— SIGKILL 以外的一切退出路径都走到这里。
  process.on("exit", syncCleanupOnExit);
  // 进程信号:关 Chrome 后立即 exit(防 Ctrl+C/SIGTERM 后 browser.close 异步未完成 hang)。
  // server 模式必需;独立脚本/测试可设 MEDIA_GEN_NO_SIGNAL_HANDLERS=1 禁用
  // (避免全局 handler 干扰其他 shutdown 逻辑 —— 沿用旧 render-svg 同名开关与语义)。
  if (!process.env.MEDIA_GEN_NO_SIGNAL_HANDLERS) {
    const exitHandler = () => {
      closeBrowser().catch(() => {}).finally(() => process.exit(0));
    };
    process.on("SIGINT", exitHandler);
    process.on("SIGTERM", exitHandler);
  }
}
registerExitHooks();
