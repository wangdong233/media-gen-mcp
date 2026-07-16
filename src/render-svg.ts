import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import path from "node:path";

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
  /** PNG 目标像素宽(resvg fitTo;Chrome deviceScaleFactor 基于此)。 */
  width?: number;
  /** 渲染后端:"auto"(默认,自动选)| "resvg"(轻量 92%)| "chrome"(100% 滤镜保真,需系统 Chrome)。 */
  backend?: "auto" | "resvg" | "chrome";
  /** Retina 倍率(仅 Chrome 后端;默认 2)。 */
  scale?: number;
  name?: string;
}

export interface RenderSvgOutput {
  svg: string;
  png?: Buffer;
  /** 实际使用的后端(信息性)。 */
  backendUsed: "resvg" | "chrome";
}

// ── Chrome 检测与生命周期 ──
let browser: any = null;
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;
const BROWSER_IDLE_MS = 5 * 60 * 1000; // 5 分钟无活动 → 关闭 Chrome

async function getBrowser(): Promise<any> {
  if (browser) {
    resetIdleTimer();
    return browser;
  }
  const puppeteer = await import("puppeteer-core").catch(() => null);
  if (!puppeteer) return null;
  try {
    // 探测系统 Chrome(channel:'chrome' 找标准安装路径)
    browser = await puppeteer.default.launch({
      channel: "chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=full"],
    });
    resetIdleTimer();
    return browser;
  } catch {
    // Chrome 不可用 → 尝试 Edge
    try {
      browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=full"],
        executablePath: findEdgePath(),
      });
      resetIdleTimer();
      return browser;
    } catch {
      browser = null;
      return null;
    }
  }
}

/** 探测系统 Edge 路径(跨平台)。 */
function findEdgePath(): string | undefined {
  const { existsSync } = require("node:fs");
  const candidates = [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", // macOS
    "/usr/bin/microsoft-edge", // Linux
    "/usr/bin/microsoft-edge-stable",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", // Windows
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((p) => { try { return existsSync(p); } catch { return false; } });
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
}

// 检测 SVG 是否含滤镜(需要 Chrome 才能 100% 渲染)
function hasSvgFilters(svg: string): boolean {
  return /<filter[\s>]|feGaussianBlur|feTurbulence|feDisplacementMap|feConvolveMatrix|feSpecularLighting|feDiffuseLighting/i.test(svg);
}

// 从 SVG 提取宽高(viewBox 或 width/height)
function extractSvgSize(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox="0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (vb) return { width: Math.round(parseFloat(vb[1])), height: Math.round(parseFloat(vb[2])) };
  const w = svg.match(/\swidth="(\d+)/);
  const h = svg.match(/\sheight="(\d+)/);
  return {
    width: w ? parseInt(w[1]) : 1200,
    height: h ? parseInt(h[1]) : 800,
  };
}

/** Chrome 渲染 SVG → PNG(puppeteer-core + 系统 Chrome)。 */
async function renderWithChrome(svg: string, targetWidth: number, scale: number): Promise<Buffer> {
  const b = await getBrowser();
  if (!b) throw new Error("Chrome not available");
  const { width: svgW, height: svgH } = extractSvgSize(svg);
  const page = await b.newPage();
  try {
    const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${svgW}px;height:${svgH}px;overflow:hidden;}</style></head><body>${svg}</body></html>`;
    await page.setViewport({ width: svgW, height: svgH, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle0" });
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
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: targetWidth },
  });
  return Buffer.from(resvg.render().asPng());
}

export async function renderSvg(req: RenderSvgRequest): Promise<RenderSvgOutput> {
  if (!req.svg || !req.svg.trim()) throw new Error("`svg` is required");
  if (!req.svg.trim().startsWith("<")) throw new Error("`svg` must be valid SVG/XML (starting with <)");

  const format = req.format ?? "png";
  const targetWidth = req.width && req.width > 0 ? Math.floor(req.width) : extractSvgSize(req.svg).width;

  // 后端选择:auto → 含滤镜且 Chrome 可用 → Chrome;否则 resvg
  const wantsChrome = req.backend === "chrome" || (req.backend !== "resvg" && hasSvgFilters(req.svg));
  let backendUsed: "resvg" | "chrome" = "resvg";
  let png: Buffer | undefined;

  if (format === "png") {
    if (wantsChrome) {
      const b = await getBrowser();
      if (b) {
        try {
          png = await renderWithChrome(req.svg, targetWidth, req.scale ?? 2);
          backendUsed = "chrome";
        } catch {
          // Chrome 失败 → 降级 resvg
          png = renderWithResvg(req.svg, targetWidth);
          backendUsed = "resvg";
        }
      } else {
        png = renderWithResvg(req.svg, targetWidth);
      }
    } else {
      png = renderWithResvg(req.svg, targetWidth);
    }
  }

  return { svg: req.svg, png, backendUsed };
}
