import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";

/**
 * SVG → PNG 渲染(双后端:resvg 轻量默认 + Chrome 高保真可选)。
 * 用户说"画个酷炫架构图" → Claude 写 SVG(带 feGaussianBlur 等)→ 调 render_svg → 高质量 PNG。
 * 不再需要跳过工具手动调 Chrome。
 *
 * 自动后端选择:SVG 含 <filter> + Chrome 可用 → Chrome(100%);否则 resvg(92%,进程内)。
 */

export interface RenderSvgRequest {
  /** SVG 源码(XML 字符串)。 */
  svg: string;
  format?: "svg" | "png";
  /** PNG 目标像素宽(resvg fitTo;Chrome viewport 基于此)。 */
  width?: number;
  /** 渲染后端:"auto"(默认,自动选)| "resvg"(轻量 92%)| "chrome"(100% 滤镜保真,需系统 Chrome)。 */
  backend?: "auto" | "resvg" | "chrome";
  /** Retina 倍率(仅 Chrome 后端;默认 2)。 */
  scale?: number;
}

export type BackendUsed = "resvg" | "chrome" | "passthrough";

export interface RenderSvgOutput {
  svg: string;
  png?: Buffer;
  /** 实际使用的后端(信息性)。 */
  backendUsed: BackendUsed;
  /** 后端降级时附警告(如 Chrome 不可用 → resvg)。 */
  warning?: string;
  /** B10 丢弃必告警:后端专属参数(width=resvg 消费;scale=Chrome 消费)在另一后端/直通下显式传入时告警。 */
  warnings?: string[];
}

/**
 * B10 丢弃必告警(纯函数,renderSvg 与离线单测共用;按「最终后端」判定,Chrome 失败回落 resvg 时 scale 同样被丢):
 *  - width:schema 声明 resvg 后端消费;Chrome 按 SVG 内在尺寸×scale 渲染,忽略 width;svg 直通无栅格化,同样忽略。
 *  - scale:schema 声明仅 Chrome 渲染消费;resvg 无 Retina 概念;svg 直通无渲染。
 */
export function renderSvgDiscardWarnings(req: RenderSvgRequest, backendUsed: BackendUsed): string[] {
  const w: string[] = [];
  if (backendUsed === "chrome") {
    if (req.width != null) {
      w.push("width 仅 resvg 后端消费,Chrome 后端按 SVG 内在尺寸×scale 渲染,已忽略 width。");
    }
  } else if (backendUsed === "passthrough") {
    if (req.width != null) w.push("width 仅 PNG 栅格化消费,svg 直通不渲染,已忽略。");
    if (req.scale != null) w.push("scale 仅 Chrome 后端 PNG 渲染消费,svg 直通不渲染,已忽略。");
  } else {
    if (req.scale != null) {
      w.push("scale 仅 Chrome 后端消费,resvg 后端已忽略(要控制输出尺寸请用 width)。");
    }
  }
  return w;
}

// ── Chrome 检测与生命周期 ──
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
export interface PageLike {
  setViewport(opts: any): Promise<void>;
  setContent(html: string, opts: any): Promise<void>;
  evaluateHandle(expr: string): Promise<unknown>;
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  createCDPSession(): Promise<CDPSessionLike>;
  screenshot(opts: any): Promise<Uint8Array | string>;
  close(): Promise<void>;
}
export interface CDPSessionLike {
  send(method: string, params?: any): Promise<any>;
}

let browser: BrowserLike | null = null;
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;
let launching: Promise<BrowserLike | null> | null = null;
const BROWSER_IDLE_MS = 30 * 1000; // 独立脚本渲染后最长 30s 释放 Chrome → 进程退出;server 持续渲染会重置定时器保持热(30s 空闲才冷启,tradeoff 换取独立调用不 hang)

// 确定性渲染 flags(SVG 截图 + 视频帧捕获共用;HyperFrames 同款):
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

export async function getBrowser(): Promise<BrowserLike | null> {
  if (browser) { resetIdleTimer(); return browser; }
  if (launching) return launching; // 单飞锁:防并发 launch 泄漏 Chrome 进程
  launching = (async (): Promise<BrowserLike | null> => {
    const puppeteer = await import("puppeteer-core").catch(() => null);
    if (!puppeteer) return null;
    // 尝试 Chrome(channel:'chrome' 找标准路径)
    try {
      const b = await puppeteer.default.launch({
        channel: "chrome",
        headless: true,
        args: DETERMINISTIC_FLAGS,
      });
      browser = b as BrowserLike;
      resetIdleTimer();
      return browser;
    } catch (e) {
      console.error("[render-svg] Chrome launch failed, trying Edge:", (e as Error)?.message);
    }
    // 回退 Edge
    const edgePath = findEdgePath();
    if (edgePath) {
      try {
        const b = await puppeteer.default.launch({
          headless: true,
          args: DETERMINISTIC_FLAGS,
          executablePath: edgePath,
        });
        browser = b as BrowserLike;
        resetIdleTimer();
        return browser;
      } catch (e) {
        console.error("[render-svg] Edge launch failed:", (e as Error)?.message);
      }
    }
    browser = null;
    return null;
  })().finally(() => { launching = null; });
  return launching;
}

function resetIdleTimer(): void {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(async () => {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
      browser = null;
    }
    browserIdleTimer = null;
  }, BROWSER_IDLE_MS);
  browserIdleTimer.unref(); // 定时器自身不 pin 事件循环(server 由 stdio 保活;独立脚本靠 idle 关 Chrome 后自然退出)
}

// 进程信号:关 Chrome 后立即 exit(防 Ctrl+C/SIGTERM 后 browser.close 异步未完成 hang)。
// server 模式必需;独立脚本/测试可设 MEDIA_GEN_NO_SIGNAL_HANDLERS=1 禁用(避免全局 handler 干扰其他 shutdown 逻辑)。
if (!process.env.MEDIA_GEN_NO_SIGNAL_HANDLERS) {
  const exitHandler = () => {
    if (browser) browser.close().catch(() => {}).finally(() => process.exit(0));
    else process.exit(0);
  };
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);
}

/** 检测 SVG 是否含滤镜块(需 Chrome 才能 100% 渲染)。 */
function hasSvgFilters(svg: string): boolean {
  // SVG <filter> 元素 + CSS filter: 属性(如 style 滤镜模糊)+ 外部资源/foreignObject(需 Chrome)
  return /<filter[\s>]/i.test(svg) || /\bfilter\s*:/i.test(svg);
}
function hasExternalResources(svg: string): boolean {
  return /<image[^>]+(xlink:)?href=["']https?:/i.test(svg) || /@import\s+url\(["']?https?:/i.test(svg) || /@font-face[^}]+url\(["']?https?:/i.test(svg);
}
function hasForeignObject(svg: string): boolean {
  return /<foreignObject[\s>]/i.test(svg);
}

/** 从 SVG 根标签提取宽高(viewBox 或 width/height)。 */
function extractSvgSize(svg: string): { width: number; height: number } {
  // 优先从根 <svg> 标签的 viewBox 提取(支持任意起点)
  const rootTag = svg.match(/<svg[^>]*>/i);
  const root = rootTag ? rootTag[0] : "";
  const vb = root.match(/viewBox="([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  if (vb) return { width: Math.round(parseFloat(vb[3])), height: Math.round(parseFloat(vb[4])) };
  const w = root.match(/\swidth="([\d.]+)/);
  const h = root.match(/\sheight="([\d.]+)/);
  return {
    width: w ? Math.round(parseFloat(w[1])) : 1200,
    height: h ? Math.round(parseFloat(h[1])) : 800,
  };
}

/** Chrome 渲染 SVG → PNG(puppeteer-core + 系统 Chrome/Edge)。 */
async function renderWithChrome(svg: string, scale: number): Promise<Buffer> {
  const b = await getBrowser();
  if (!b) throw new Error("Chrome/Edge not available — install Google Chrome or Microsoft Edge, or use backend:'resvg' for lightweight rendering (92% filter fidelity).");
  const { width: svgW, height: svgH } = extractSvgSize(svg);
  const page = await b.newPage();
  try {
    const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${svgW}px;height:${svgH}px;overflow:hidden;}</style></head><body>${svg}</body></html>`;
    await page.setViewport({ width: svgW, height: svgH, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "load" }); // networkidle0 在 setContent 下会超时,用 load 即可
    await page.evaluateHandle("document.fonts.ready"); // puppeteer#791 修复
    const buf = await page.screenshot({
      type: "png",
      omitBackground: true,
      clip: { x: 0, y: 0, width: svgW, height: svgH },
    });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

/** resvg 渲染 SVG → PNG(进程内,~2-5MB WASM,92% 滤镜保真)。 */
function renderWithResvg(svg: string, targetWidth: number): Buffer {
  // P0-2 第 2 轮审查修复:与 chart.ts:121-127 / d2.ts:147-158 / graphviz.ts:81-91 三处
  // PNG 复用路径对齐 —— resvg 栅格化错统一加 [resvg] 前缀,让 handler 层结构性信号
  // (normalizeEngineError 用 /^\[resvg\] /i 锚首检测路由)100% 可靠,不再依赖脆弱的内容 rx。
  try {
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: targetWidth } });
    return Buffer.from(resvg.render().asPng());
  } catch (e: any) {
    throw new Error("[resvg] " + (e?.message ?? String(e)));
  }
}

export async function renderSvg(req: RenderSvgRequest): Promise<RenderSvgOutput> {
  if (!req.svg || !req.svg.trim()) throw new Error("`svg` is required");
  if (!req.svg.trim().startsWith("<")) throw new Error("`svg` must be valid SVG/XML (starting with <)");

  const format = req.format ?? "png";
  const targetWidth = req.width && req.width > 0 ? Math.floor(req.width) : extractSvgSize(req.svg).width;

  if (format === "svg") {
    return { svg: req.svg, backendUsed: "passthrough", warnings: renderSvgDiscardWarnings(req, "passthrough") };
  }

  // 后端选择:auto → 含滤镜且 Chrome 可用 → Chrome;否则 resvg
  const wantsChrome = req.backend === "chrome" || (req.backend !== "resvg" && (hasSvgFilters(req.svg) || hasExternalResources(req.svg) || hasForeignObject(req.svg)));
  let png: Buffer | undefined;
  let backendUsed: BackendUsed = "resvg";
  let warning: string | undefined;

  if (wantsChrome) {
    const b = await getBrowser();
    if (b) {
      try {
        png = await renderWithChrome(req.svg, req.scale ?? 2);
        backendUsed = "chrome";
      } catch (e) {
        console.error("[render-svg] Chrome render failed, fallback to resvg:", (e as Error)?.message);
        png = renderWithResvg(req.svg, targetWidth);
        backendUsed = "resvg";
        warning = "Chrome render failed, used resvg fallback.";
      }
    } else {
      png = renderWithResvg(req.svg, targetWidth);
      backendUsed = "resvg";
      warning = req.backend === "chrome"
        ? "Chrome/Edge not available; used resvg instead."
        : (hasSvgFilters(req.svg) ? "SVG uses <filter>/CSS filter but Chrome unavailable; rendered with resvg (~92% filter fidelity — glow/blur may differ from design)." : (hasExternalResources(req.svg) || hasForeignObject(req.svg) ? "SVG contains external resources/foreignObject but Chrome unavailable; resvg cannot fetch/render them (will be blank). Use backend=chrome or inline as data URI." : undefined));
    }
  } else {
    png = renderWithResvg(req.svg, targetWidth);
  }

  // B10:按最终后端归拢丢弃告警(chrome 失败回落 resvg 时 backendUsed 已是 resvg,scale 判丢弃正确)
  return { svg: req.svg, png, backendUsed, warning, warnings: renderSvgDiscardWarnings(req, backendUsed) };
}
