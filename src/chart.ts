import { compile } from "vega-lite";
import { View, parse } from "vega";
import { Resvg } from "@resvg/resvg-js";

/**
 * 静态扫描 Vega-Lite spec 的"合法输入但产出视觉误导"问题(S16 area baseline 溢出类)。
 * 不改写 spec、不报错,只返回 warnings 供调用方感知。
 */
function checkChartSpec(spec: any): string[] {
  const ws: string[] = [];
  if (!spec || typeof spec !== "object") return ws;

  const mark = typeof spec.mark === "string" ? spec.mark : spec.mark?.type;
  const enc = spec.encoding ?? {};
  const data = Array.isArray(spec.data?.values) ? spec.data.values : [];

  // 取 y(或 theta)的 field + scale 配置
  const yField = enc.y?.field ?? enc.theta?.field;
  const yScale = enc.y?.scale ?? enc.theta?.scale ?? {};
  const yDomain = Array.isArray(yScale.domain) ? yScale.domain : null;

  // ① area/bar + y domain 不含 0 → baseline 溢出/截断基线(S16 面积溢出)
  if ((mark === "area" || mark === "bar") && yDomain) {
    const [lo, hi] = yDomain;
    if ((lo > 0 || hi < 0) && yScale.zero !== true) {
      ws.push(`${mark} 的 baseline=0 落在 y-domain [${lo},${hi}] 之外,面积/柱子会溢出或撑爆画布;请把 0 纳入 domain(设 scale.zero=true)或改用 line mark。`);
    }
  }
  if ((mark === "area" || mark === "bar") && yScale.zero === false) {
    ws.push(`${mark} 设了 scale.zero=false,非零基线会夸大差异(甚至溢出);柱状图建议从 0 起。`);
  }

  // ② log 轴 + 数据含 ≤0 → 静默丢弃行
  if (yScale.type === "log" && yField && data.length) {
    const negatives = data.filter((d: any) => Number(d[yField]) <= 0).length;
    if (negatives > 0) {
      const pct = Math.round((negatives / data.length) * 100);
      ws.push(`log 轴无法表达 ≤0 的值,${negatives} 行(${pct}%)已被静默丢弃;请改用 linear/symlog 轴、过滤非正值或加常数偏移。`);
    }
  }

  // ③ arc(饼图) + theta 负值 → part-of-whole 语义不成立
  if (mark === "arc" && enc.theta?.field && data.length) {
    const negs = data.filter((d: any) => Number(d[enc.theta.field]) < 0).length;
    if (negs > 0) ws.push(`饼图 theta 出现负值(${negs} 个),part-of-whole 语义不成立;请过滤负值或改用柱状图。`);
  }

  // ④ arc(饼图) + 类别 >12 → 小扇形不可区分
  if (mark === "arc" && enc.color?.field && data.length) {
    const cats = new Set(data.map((d: any) => d[enc.color.field]));
    if (cats.size > 12) ws.push(`饼图有 ${cats.size} 个扇形,小扇形难以区分、占比易误读;类别>12 建议改横向柱状图。`);
  }

  return ws;
}

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
  warnings?: string[];
}

export async function renderChart(req: ChartRequest): Promise<ChartRenderOutput> {
  const warnings = checkChartSpec(req.spec as any);

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
  try {
    const spec: any = { ...req.spec };
    // 工具层默认尺寸:未显式设 autosize 时,补全缺失维度(避免只设 width 或 height 时另一维仍极小 ~100×240)
    if (spec.autosize == null) {
      if (spec.width == null) spec.width = 640;
      if (spec.height == null) spec.height = 400;
    }
    const compiled = compile(spec);
    vegaSpec = compiled.spec;
  } catch (e: any) {
    const m = String(e?.message ?? e);
    let vh = "";
    if (/gradient|length/i.test(m)) vh = " HINT: gradient 写法 — 用 mark 的 fill.gradient(如 \"gradient(#a,#b)\") 或 encoding color scale,勿在 style 放 gradient 对象。";
    else if (/signal|Unrecognized/i.test(m)) vh = " HINT: condition.test 用 \"datum.<field> === <val>\" 语法;signal 名须先定义再用。";
    throw new Error(`Vega-Lite spec error: ${m}${vh}`);
  }
  const view = new View(parse(vegaSpec), { renderer: "none" });
  try {
    const svg = await view.toSVG();
    let png: Buffer | undefined;
    if (req.format === "png") {
      const resvg = new Resvg(svg);
      png = Buffer.from(resvg.render().asPng());
    }
    return { svg, png, warnings };
  } catch (e: any) {
    const m = String(e?.message ?? e);
    let vh = "";
    if (/signal|Unrecognized/i.test(m)) vh = " HINT: condition.test 用 \"datum.<field> === <val>\" 语法;signal 名须先定义再用。";
    throw new Error(`Vega-Lite render error: ${m}${vh}`);
  } finally {
    view.finalize(); // CQ-3:释放 vega dataflow + scenegraph
  }
}
