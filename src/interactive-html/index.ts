/**
 * 交互式 HTML 图 —— 主入口(P0-5A §4.3)。
 *
 * 端到端链路:
 *   DSL → D2Engine.render(传 darkThemeID/noXMLTag/salt 三杠杆)
 *       → fillTemplate(套 HTML 模板,内联 viewer + motion governor + pre-paint resolver)
 *       → 5 个契约 assert(S2/S4/S6/S9/S11)
 *       → 落盘
 *       → 可选 PNG 预览
 *
 * 接口分层(P0-5A §8.2):
 *   - buildInteractiveHtml(req, engine?)  纯函数,不落盘,返回 {html, ...}
 *                                           golden + 契约 test 都调它
 *   - renderInteractiveHtml(req, engine?)  落盘 wrapper,handler 只调它
 *
 * D2Engine singleton(P0-5A §3.2):严禁 `new D2Engine()` 触发 22MB WASM 双加载;
 *   通过 getDiagramEngine("d2") 拿 singleton;测试用 stub engine 注入(open_point #15 方案 A)。
 *
 * 三杠杆(P0-5A §0.6 字段名已实地核实):
 *   - darkThemeID(全大写,驼峰会静默失败)→ D2 SVG 内联 @media prefers-color-scheme 双调色板
 *   - noXMLTag(硬编码 true)→ 去 <?xml?> 声明
 *   - salt(固定 "media-gen-mcp-interactive")→ 多图嵌入同 HTML 防 SVG ID 冲突,零成本确定性防御
 *
 * License:P0-5 自研(无第三方源码引用;D2/markmap 工艺为通用 web 工艺)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DiagramEngine } from "../diagram/types.js";
import { getDiagramEngine } from "../diagram/render.js";
import { fillTemplate } from "./fill-template.js";
import {
  assertSelfContained,
  assertNoXmlDecl,
  assertDualPalette,
  assertMotionGovernor,
  assertSizeUnder,
} from "./asserts.js";
import { exportPngFromSvg } from "./export-png.js";

export interface InteractiveDiagramRequest {
  /** D2 DSL 源码(必填)。 */
  code: string;
  /** 浅色主题(D2 themeID 或 default/neutral);默认 default。 */
  theme?: string;
  /** 深色主题;传了才触发 D2 SVG 内联 @media prefers-color-scheme 双调色板。 */
  darkTheme?: string;
  /** HTML <title> + <h1> 文本;默认 "Interactive Diagram"。 */
  title?: string;
  /** 是否同时导 PNG 预览(默认 false,Chrome launch 慢)。 */
  previewPng?: boolean;
  /** 文件名(不含扩展名);省略自动命名。 */
  name?: string;
  /** 落盘目录(handler 已 resolveOutDir 解析)。 */
  outDir?: string;
}

export interface InteractiveDiagramBuildResult {
  /** 完整自包含 HTML 字符串。 */
  html: string;
  /** HTML byte 长度(S6 校验)。 */
  bytes: number;
  /** 是否双主题烤进(darkTheme 传时为 true)。 */
  hasDarkLightDualPalette: boolean;
  /** 内联的 D2 SVG 字符串(S3 几何 byte-identical 断言用)。 */
  svg: string;
}

export interface InteractiveDiagramResult extends InteractiveDiagramBuildResult {
  /** HTML 落盘绝对路径。 */
  localPath: string;
  /** PNG 预览绝对路径(previewPng=true 时存在)。 */
  previewPngPath?: string;
}

/** 固定 salt(open_point #2:零成本确定性防御 + 多图嵌入同 HTML 防 SVG ID 冲突)。 */
export const D2_INTERACTIVE_SALT = "media-gen-mcp-interactive";

/**
 * 构建 HTML(纯函数,不落盘)。golden pipeline 与契约 test 都调它。
 *
 * @param req     请求(code 必填)
 * @param engine  可选 DiagramEngine(stub 注入,测试用);省略 → getDiagramEngine("d2")
 */
export async function buildInteractiveHtml(
  req: InteractiveDiagramRequest,
  engine?: DiagramEngine,
): Promise<InteractiveDiagramBuildResult> {
  if (!req.code || !req.code.trim()) {
    throw new Error("`code` is required and must be a non-empty string");
  }
  // 1. D2 渲染(传三杠杆)
  const d2Engine = engine ?? getDiagramEngine("d2");
  if (!d2Engine) throw new Error("D2 engine unavailable");
  if (!d2Engine.isAvailable()) throw new Error("D2 engine not available");
  const rendered = await d2Engine.render({
    code: req.code,
    engine: "d2",
    format: "svg",
    theme: req.theme,
    darkTheme: req.darkTheme,           // → darkThemeID(C1,d2.ts 合并)
    noXMLTag: true,                      // C2 硬编码(HTML 内联必去 <?xml?>)
    salt: D2_INTERACTIVE_SALT,           // C3 硬编码(固定 salt,零成本防御 + 防 ID 冲突)
  });
  const svg = rendered.svg;

  // 2. 套 HTML 模板
  const html = fillTemplate({
    svg,
    title: req.title ?? "Interactive Diagram",
  });

  // 3. 契约 asserts(S2/S4/S6/S9/S11;S3 由调用方 / golden 验证)
  assertSelfContained(html);
  assertNoXmlDecl(html);                // C2 防线
  if (req.darkTheme != null) assertDualPalette(html);
  assertMotionGovernor(html);
  assertSizeUnder(html, 256 * 1024);    // S6 默认 256KB

  return {
    html,
    bytes: Buffer.byteLength(html, "utf-8"),
    hasDarkLightDualPalette: req.darkTheme != null,
    svg,
  };
}

/**
 * 构建 HTML + 落盘 + 可选 PNG(handler 调它)。
 *
 * @param req     请求(code 必填,outDir 必填)
 * @param engine  可选 DiagramEngine(stub 注入,测试用)
 */
export async function renderInteractiveHtml(
  req: InteractiveDiagramRequest,
  engine?: DiagramEngine,
): Promise<InteractiveDiagramResult> {
  const built = await buildInteractiveHtml(req, engine);
  // 4. 落盘(renderer 内部直写,不经 writeLocalRender —— HTML 不在 svg|png format 类型内;P0-5A §0.4)
  const outDir = req.outDir;
  if (!outDir) throw new Error("`outDir` is required (handler resolves it via resolveOutDir before calling)");
  const safeName = path.basename(req.name ?? `interactive_${Date.now().toString(36)}`); // BL-04: sanitize
  await fs.mkdir(outDir, { recursive: true });
  const localPath = path.join(outDir, safeName + ".html");
  await fs.writeFile(localPath, built.html, "utf-8");

  // 5. 可选 PNG 预览
  let previewPngPath: string | undefined;
  if (req.previewPng) {
    previewPngPath = await exportPngFromSvg(built.svg, outDir, safeName);
  }

  return {
    ...built,
    localPath,
    ...(previewPngPath ? { previewPngPath } : {}),
  };
}
