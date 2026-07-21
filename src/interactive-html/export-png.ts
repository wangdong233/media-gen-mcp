/**
 * 交互式 HTML 图 —— PNG 预览导出(P0-5A §3.5)。
 *
 * 三档优先级(沿用 PRD open_point #3 + P0-5A §3.5):
 *   1. puppeteer-core(首选,已在 deps L48):headless Chrome 截图,CSS 变量自动解析
 *   2. @resvg/resvg-js(末选,已在 deps L43):进程内、确定性,不解析 CSS 变量
 *
 * previewPng 默认 false —— Chrome launch 慢,用户显式要才导。
 *
 * pickSafeScale:防 iOS Safari 16Mpx canvas 上限(PRD §3.5)。本 MVP 直接用 resvg
 * 路径(纯后端光栅化,无 canvas 限制);puppeteer 路径 screenshot 内部也守浏览器上限。
 *
 * License:P0-5 自研(标准 puppeteer/resvg 用法,无第三方源码引用)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

/**
 * 把 SVG 导成 PNG 落盘。
 *
 * @param svg      D2 渲染出的 SVG 字符串
 * @param outDir   输出目录(handler 已 resolveOutDir)
 * @param name     文件名(不含扩展名;renderer 已 basename sanitize)
 * @returns        PNG 绝对路径
 *
 * 异常:puppeteer 路径与 resvg 路径都失败时抛(用户 previewPng=true 但环境不支持)。
 */
export async function exportPngFromSvg(
  svg: string,
  outDir: string,
  name: string,
): Promise<string> {
  const safeName = path.basename(name);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, safeName + ".png");

  // 1. 首选 puppeteer-core(CSS 变量自动解析,色彩与 viewer 一致)
  try {
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      // 装载 SVG 进一个最小 HTML(viewer chrome 不参与截图,仅 SVG 内容)
      const htmlDoc =
        "<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<style>html,body{margin:0;padding:0;background:#ffffff;}svg{display:block;}</style>" +
        "</head><body>" + svg + "</body></html>";
      await page.setContent(htmlDoc, { waitUntil: "load", timeout: 15000 });
      const svgHandle = await page.$("svg");
      if (svgHandle) {
        await svgHandle.screenshot({ path: outPath, omitBackground: false });
      } else {
        await page.screenshot({ path: outPath, fullPage: true, omitBackground: false });
      }
    } finally {
      await browser.close();
    }
    return outPath;
  } catch {
    // puppeteer 不可用(Chrome 未装/launch 失败)→ 降级 resvg
  }

  // 2. 末选 resvg(进程内、确定性,不解析 CSS 变量,直接光栅化 SVG)
  const pngBuf = renderSvgToPngBuffer(svg);
  await fs.writeFile(outPath, pngBuf);
  return outPath;
}

/** resvg 光栅化 SVG → PNG Buffer(白底 + 中文字体兜底,与 generate_diagram PNG 路径同源)。 */
function renderSvgToPngBuffer(svg: string): Buffer {
  // F14(主控终验内修):复刻 d2.ts PNG 路径范式 —— 加 [resvg] 前缀,handler catch 据此前缀路由到
  // resvg 归一化;否则裸 resvg 错会被 handler 错归到 d2(F13 已先拦契约错,但引擎错仍需此前缀)。
  try {
    // fitTo width 1600(与 d2.ts D2_MAX_W 对齐),防大架构图产超大 PNG
    const resvg = new Resvg(svg, {
      background: "#ffffff",
      fitTo: { mode: "width", value: 1600 },
      font: {
        loadSystemFonts: true,
        defaultFontFamily: "PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
      },
    });
    return Buffer.from(resvg.render().asPng());
  } catch (e: any) {
    throw new Error("[resvg] " + String(e?.message ?? e));
  }
}
