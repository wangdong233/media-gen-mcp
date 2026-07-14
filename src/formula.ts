import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { Resvg } from "@resvg/resvg-js";

/**
 * 数学公式(MathJax)—— LaTeX → SVG(矢量,字形内嵌路径,无外部字体依赖)。
 * 用户说"渲染这个公式 E=mc²" → Claude 调 generate_formula(tex=...) → SVG/PNG。
 *
 * 引擎一次性初始化(lazy singleton):adaptor + TeX(AllPackages) + SVG jax 复用,避免每次重建。
 *
 * 关键:SVG jax 必须用 `new SVG()`(默认 tex 字体)。若传 `{ font: "tex" }`,构造函数会把
 * `this.options.font`(字符串 "tex")直接赋给 `this.font`,导致 `this.font.params.x_height`
 * 报错(font 变成字符串)。
 */
interface MathJaxEngine {
  html: any;
  adaptor: { innerHTML: (node: any) => string };
}
let engine: MathJaxEngine | undefined;

function getEngine(): MathJaxEngine {
  if (engine) return engine;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor); // 必须在 mathjax.document 之前
  const html = mathjax.document("", {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG(), // 默认 tex 字体;勿传 { font }
  });
  engine = { html, adaptor };
  return engine;
}

export interface FormulaRequest {
  /** LaTeX 源码(如 `\frac{a}{b}`)。由 Claude 生成。 */
  tex: string;
  /** 块级(display)还是行内。默认 true(块级)。 */
  display?: boolean;
  format?: "svg" | "png";
  /** 字号 em(默认 18)。 */
  fontSize?: number;
  /** PNG 目标像素宽(默认 600);仅 format=png 时生效。 */
  width?: number;
  /** 前景色(默认黑色)。MathJax SVG 用 currentColor,设此值改色。 */
  color?: string;
}

export interface FormulaRenderOutput {
  svg: string;
  png?: Buffer;
}

export async function renderFormula(req: FormulaRequest): Promise<FormulaRenderOutput> {
  if (!req.tex || !req.tex.trim()) throw new Error("`tex` is required");

  const { html, adaptor } = getEngine();
  const em = req.fontSize && req.fontSize > 0 ? req.fontSize : 18;

  let svg: string;
  try {
    const node = html.convert(req.tex, {
      display: req.display !== false,
      em,
      ex: em / 2,
      containerWidth: 1024,
    });
    svg = adaptor.innerHTML(node) as string;
  } catch (e: any) {
    // MathJax 编译错误(语法错):抛出可读消息
    throw new Error(`LaTeX compile failed: ${e?.message ?? String(e)}`);
  }
  if (!svg || !svg.trim().startsWith("<svg")) {
    throw new Error("formula engine produced no SVG");
  }

  // 前景色:MathJax SVG 字形用 currentColor,在根 <svg> 上设 color 属性即可改色
  if (req.color && req.color.trim() && req.color.trim().toLowerCase() !== "#000000") {
    const rootEnd = svg.indexOf(">");
    if (rootEnd > 0) svg = `${svg.slice(0, rootEnd)} color="${req.color.trim()}">${svg.slice(rootEnd + 1)}`;
  }

  let png: Buffer | undefined;
  if (req.format === "png") {
    // SVG 宽高为 ex 单位;用 Resvg fitTo 按 viewBox 等比缩放到目标像素宽
    const target = req.width && req.width > 0 ? req.width : 600;
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: target },
      background: "#ffffff",
    });
    png = Buffer.from(resvg.render().asPng());
  }
  return { svg, png };
}
