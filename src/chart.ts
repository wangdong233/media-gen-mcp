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
  const { spec: vegaSpec } = compile(req.spec as any);
  const view = new View(parse(vegaSpec), { renderer: "none" });
  try {
    const svg = await view.toSVG();
    let png: Buffer | undefined;
    if (req.format === "png") {
      const resvg = new Resvg(svg);
      png = Buffer.from(resvg.render().asPng());
    }
    return { svg, png };
  } finally {
    view.finalize(); // CQ-3:释放 vega dataflow + scenegraph
  }
}
