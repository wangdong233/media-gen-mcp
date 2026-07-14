import { instance, type Viz } from "@viz-js/viz";
import { Resvg } from "@resvg/resvg-js";
import type { DiagramEngine, DiagramRequest, DiagramRenderOutput } from "./types.js";

/**
 * Graphviz 引擎(@viz-js/viz —— Graphviz 编译为 WASM,进程内、无浏览器、无 spawn)。
 * DOT 语言 → SVG/PNG。viz-js 实例是可复用 singleton(WASM 模块,加载一次)。
 *
 * 与 D2Engine 同型:lazy singleton + try/catch 清晰错误 + PNG 经 resvg。
 * viz.render 同步 CPU(DOT 通常小图,可接受)。
 */
export class GraphvizEngine implements DiagramEngine {
  readonly name = "graphviz" as const;
  private viz?: Viz;

  isAvailable(): boolean {
    return true;
  }

  listTypes(): string[] {
    return ["directed-graph", "undirected-graph", "flowchart", "cluster", "state"];
  }

  private async getViz(): Promise<Viz> {
    if (!this.viz) this.viz = await instance(); // WASM 加载,一次性
    return this.viz;
  }

  async render(req: DiagramRequest): Promise<DiagramRenderOutput> {
    if (!req.code || !req.code.trim()) throw new Error("`code` (DOT source) is required");
    const viz = await this.getViz();
    let svg: string;
    try {
      const result = viz.render(req.code, { format: "svg" });
      svg = result.output ?? "";
    } catch (e: any) {
      throw new Error(`Graphviz (DOT) render failed: ${e?.message ?? String(e)}`);
    }
    if (!svg || !/<(svg|html|g|path)/.test(svg)) {
      throw new Error("graphviz engine produced no SVG");
    }

    let png: Buffer | undefined;
    if (req.format === "png") {
      const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1000 } });
      png = Buffer.from(resvg.render().asPng());
    }
    return { svg, png };
  }
}
