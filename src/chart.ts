import { compile } from "vega-lite";
import { View, parse } from "vega";
import { Resvg } from "@resvg/resvg-js";

/**
 * 数据可视化(Vega-Lite)—— 声明式 JSON spec → SVG/PNG。
 * 用户说"根据这组数据画柱状图" → Claude 生成 Vega-Lite JSON → MCP 渲染。
 * 纯 JS(vega scenegraph → SVG),无 canvas/无浏览器。
 */
export interface ChartRequest {
  /** Vega-Lite specification(JSON object)。由 Claude 生成。 */
  spec: Record<string, unknown>;
  format?: "svg" | "png";
}

export interface ChartRenderOutput {
  svg: string;
  png?: Buffer;
}

export async function renderChart(req: ChartRequest): Promise<ChartRenderOutput> {
  // 守卫:在 compile 前检查常见致命错误(Vega-Lite compile 对 mark:"pie" 不报错,render 时才崩)
  const rawMark = (req.spec as any)?.mark;
  const markType = typeof rawMark === "string" ? rawMark : rawMark?.type;
  if (markType && /pie|donut/i.test(markType)) {
    throw new Error(`Vega-Lite has no "${markType}" mark type. For pie/donut: use mark: { type: "arc" } + encoding: { theta: { field: "v", type: "quantitative" }, color: { field: "c", type: "nominal" } }. Donut: add mark.innerRadius.`);
  }
  if (rawMark && typeof rawMark === "object" && !rawMark.type) {
    throw new Error(`Vega-Lite mark object must have a "type" key. Example: mark: { type: "bar" }.`);
  }
  let vegaSpec;
  const view = new View(parse(vegaSpec as any), { renderer: "none" });
  try {
    const svg = await view.toSVG();
    let png: Buffer | undefined;
    if (req.format === "png") {
      const resvg = new Resvg(svg);
      png = Buffer.from(resvg.render().asPng());
    }
    return { svg, png };
  } catch (e: any) {
    throw new Error(`Vega-Lite render error: ${e?.message ?? String(e)}`);
  } finally {
    view.finalize(); // CQ-3:释放 vega dataflow + scenegraph
  }
}
