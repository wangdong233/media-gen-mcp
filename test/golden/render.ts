/**
 * P0-3 Golden 渲染分派 —— 刷新器(scripts/render-golden.mjs)与验证器(test/golden.test.ts)共享。
 *
 * 设计要点:
 *  - 直接 import 现有 dist/ 产物(P0-2 已实证此模式安全),绕开 MCP stdio 子进程开销。
 *  - fixture 文件扩展名决定解析方式:`.txt` 纯文本 / `.json` JSON.parse / `.tex` LaTeX 原文 /
 *    `.svg` SVG 原文 / `.d2` D2 DSL / `.dot` Graphviz DOT。
 *  - 返回 `{svg?, png?, input}`:input 给 qr-png-verify 的 jsQR 解码校验用(对 qrcode 是 text 原文)。
 *
 * License:本文件为 P0-3 自研(分派逻辑,无第三方源码引用)。
 *
 * imports 路径核对(R-05 路径 A:tsconfig.test.json rootDir="test"):
 *  - 源码 test/golden/render.ts:../../dist/qr.js → ../=test/ ../../=项目根 → dist/qr.js ✓
 *  - 编译后 dist-test/golden/render.js:../../dist/qr.js → 同上(运行时视角 = 源码视角)✓
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderQR } from "../../dist/qr.js";
import { renderFormula } from "../../dist/formula.js";
import { renderChart } from "../../dist/chart.js";
import { renderCard } from "../../dist/card.js";
import { renderSvg } from "../../dist/render-svg.js";
import { getDiagramEngine } from "../../dist/diagram/render.js";
import type { DiagramEngineName } from "../../dist/diagram/types.js";

const FIXTURES = path.resolve("test/golden/fixtures");

export interface RenderResult {
  svg?: string;
  png?: Buffer;
  /** qrcode:原 text;其它:源 fixture 内容(用于调试 / QR 解码校验)。 */
  input: unknown;
  warnings?: string[];
}

/**
 * 渲染分派:tool + fixturePath → {svg?, png?, input}。
 *
 * @param tool       金子工具名
 * @param fixturePath 相对 test/golden/fixtures/ 的路径
 */
export async function render(tool: string, fixturePath: string): Promise<RenderResult> {
  const abs = path.join(FIXTURES, fixturePath);
  if (tool === "qrcode") {
    if (fixturePath.endsWith(".txt")) {
      const text = readFileSync(abs, "utf8").trim();
      const out = await renderQR({ text, format: "svg" });
      return { input: text, ...out };
    }
    // .json 参数化(可含 margin/errorCorrectionLevel/dark/light/width/format)
    const params = JSON.parse(readFileSync(abs, "utf8"));
    const out = await renderQR(params);
    return { input: params.text, ...out };
  }
  if (tool === "formula") {
    const tex = readFileSync(abs, "utf8").trim();
    const out = await renderFormula({ tex, format: "svg" });
    return { input: tex, ...out };
  }
  if (tool === "chart") {
    const spec = JSON.parse(readFileSync(abs, "utf8"));
    const out = await renderChart({ spec, format: "svg" });
    return { input: spec, ...out };
  }
  if (tool === "card") {
    const props = JSON.parse(readFileSync(abs, "utf8"));
    const out = await renderCard({ ...props, format: "svg" });
    return { input: props, ...out };
  }
  if (tool === "render_svg") {
    const svg = readFileSync(abs, "utf8");
    const out = await renderSvg({ svg, format: "svg" });
    return { input: svg, svg: out.svg, png: out.png, warnings: out.warning ? [out.warning] : [] };
  }
  if (tool === "diagram") {
    const code = readFileSync(abs, "utf8");
    const engineName: DiagramEngineName = fixturePath.endsWith(".dot") ? "graphviz" : "d2";
    const engine = getDiagramEngine(engineName);
    if (!engine) throw new Error(`unknown diagram engine: ${engineName}`);
    const out = await engine.render({ code, engine: engineName, format: "svg" });
    return { input: code, ...out };
  }
  if (tool === "interactive_html") {
    // P0-5 golden:调 buildInteractiveHtml(不落盘纯函数)拿 HTML 字符串,
    // 复用 RenderResult.svg 字段装 HTML 字符串(避免扩接口)。
    // darkTheme=default 触发 D2 darkThemeID 双调色板注入(守 S4)。
    const code = readFileSync(abs, "utf8");
    const { buildInteractiveHtml } = await import("../../dist/interactive-html/index.js");
    const built = await buildInteractiveHtml({ code, darkTheme: "default" });
    return { input: code, svg: built.html };
  }
  if (tool === "nested_diagram") {
    // P0-5B golden:调 buildNestedHtml(不落盘纯函数)拿 HTML,复用 svg slot 装 HTML。
    // darkTheme=200 触发 D2 双调色板(守 S4);fixture 是 manifest JSON。
    const manifest = JSON.parse(readFileSync(abs, "utf8"));
    const { buildNestedHtml } = await import("../../dist/nested-diagram/index.js");
    const built = await buildNestedHtml({ manifest, darkTheme: "200" });
    return { input: manifest, svg: built.html };
  }
  throw new Error(`unknown tool: ${tool}`);
}
