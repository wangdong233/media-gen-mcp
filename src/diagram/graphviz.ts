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
// PNG 缩放:box-bounded zoom(同时约束两维),杜绝旧版盲目 width-fit 导致的极窄长条
// (旧 fitTo:{mode:"width",value:1000} 无视纵横比 → 1000×2775 窄长条)。
const GV_MAX_W = 1600;
const GV_MAX_H = 1400;
function graphvizFitTo(svg: string): { mode: "zoom"; value: number } | { mode: "width"; value: number } {
  // graphviz viewBox/width 单位是 pt;resvg 默认 96 DPI,渲染 px = pt × 96/72。zoom 必须基于 px 才能精确约束输出维度。
  const PT_TO_PX = 96 / 72;
  let wpt = 0, hpt = 0;
  const vb = svg.match(/viewBox="[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  if (vb) { wpt = parseFloat(vb[1]); hpt = parseFloat(vb[2]); }
  if (!wpt || !hpt) {
    const wm = svg.match(/\swidth="([\d.]+)pt"/);
    const hm = svg.match(/\sheight="([\d.]+)pt"/);
    if (wm) wpt = parseFloat(wm[1]);
    if (hm) hpt = parseFloat(hm[1]);
  }
  if (!wpt || !hpt) return { mode: "width", value: 1000 }; // 解析失败 fallback
  const wpx = wpt * PT_TO_PX, hpx = hpt * PT_TO_PX;
  return { mode: "zoom", value: Math.min(GV_MAX_W / wpx, GV_MAX_H / hpx) };
}

function enhanceGraphvizError(msg: string): string {
  let hint = "";
  if (/syntax|unexpected|parse|error/i.test(msg)) hint = " HINT: 检查 DOT 语法 —— 语句以 ; 或换行结束,大括号 {} 配对,边引用的节点须先声明,属性用 [] 或 = 赋值。";
  return msg + (hint || "");
}

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
      throw new Error(enhanceGraphvizError(`Graphviz (DOT) render failed: ${e?.message ?? String(e)}`));
    }
    if (!svg || !/<(svg|html|g|path)/.test(svg)) {
      throw new Error("graphviz engine produced no SVG");
    }

    let png: Buffer | undefined;
    if (req.format === "png") {
      const resvg = new Resvg(svg, {
        fitTo: graphvizFitTo(svg),
        background: "#ffffff",
        font: { loadSystemFonts: true, defaultFontFamily: "PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" },
      });
      png = Buffer.from(resvg.render().asPng());
    }
    return { svg, png };
  }
}
