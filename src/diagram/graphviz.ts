import { instance, type Viz } from "@viz-js/viz";
import { Resvg } from "@resvg/resvg-js";
import type { DiagramEngine, DiagramRequest, DiagramRenderOutput } from "./types.js";

/**
 * Graphviz 引擎(@viz-js/viz —— Graphviz 编译为 WASM,进程内、无浏览器、无 spawn)。
 * DOT 语言 → SVG/PNG。viz-js 实例是可复用 singleton(WASM 模块,加载一次)。
 *
 * 与 D2Engine 同型:lazy singleton + try/catch 清晰错误 + PNG 经 resvg。
 * viz.render 同步 CPU(DOT 通常小图,可接受)。
 *
 * P0-2:catch 块的 enhanceGraphvizError HINT 已迁入 src/handlers/error-format.ts 的
 * knownErrorPatterns.graphviz;此处只抛裸错误,PNG 复用路径的 resvg 错误加 [resvg] 前缀
 * 供 handler 层 normalizeEngineError 结构性路由(替代脆弱的内容匹配)。
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
    // P0-2 §4.1 bug 修复:viz-js v3 语法错不抛错,返回 {status:"failure", output:undefined, errors:[...]}
    // 旧版 catch 是死代码、真实错被 result.errors 丢弃 → 用户只看到 "produced no SVG"。
    // 现显式读取 errors 数组并拼接进 throw,normalizeEngineError("graphviz", ...) 才有东西可归一化。
    let result;
    try {
      result = viz.render(req.code, { format: "svg" });
    } catch (e: any) {
      // viz-js 严重内部错(极罕见)才走这里 — 错误透传给 handler 层归一化
      throw new Error(`Graphviz (DOT) render failed: ${e?.message ?? String(e)}`);
    }
    const svg = result.output ?? "";
    const ge = result.errors?.length
      ? result.errors.map((er: any, i: number) => `[${i + 1}] ${er.message ?? String(er)}`).join(" ")
      : "";
    if (!svg || !/<(svg|html|g|path)/.test(svg)) {
      throw new Error(
        ge
          ? `graphviz engine rejected the DOT input: ${ge}`
          : "graphviz engine produced no SVG (no error reported by viz-js — check DOT syntax)",
      );
    }

    let png: Buffer | undefined;
    if (req.format === "png") {
      // P0-2 §4.3.4:PNG 复用路径的 resvg 错误加 [resvg] 前缀,handler 层 normalizeEngineError
      // 用结构性信号(engineHint/前缀)路由到 resvg patterns 表,替代脆弱的内容匹配。
      try {
        const resvg = new Resvg(svg, {
          fitTo: graphvizFitTo(svg),
          background: "#ffffff",
          font: { loadSystemFonts: true, defaultFontFamily: "PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" },
        });
        png = Buffer.from(resvg.render().asPng());
      } catch (e: any) {
        throw new Error("[resvg] " + (e?.message ?? String(e)));
      }
    }
    return { svg, png };
  }
}
