# TBPU 排版解析 + ignoreArea 忽略区域:设计文档

> 借鉴 Umi-OCR(hiroi-sora/Umi-OCR MIT),为 media-gen-mcp extract_text 增加后处理能力。
> 调研源码:Umi-OCR py_src/ocr/tbpu/(gap_tree / paragraph_parse / line_preprocessing / 8 策略 parser + ignore_area)。

---

## TBPU 排版解析后处理(Umi-OCR GapTree + ParagraphParse 移植)→ src/vision/tbpu.ts

### JS 设计
【模块定位】新增 src/vision/tbpu.ts(provider 抽象层之外的"后处理层",平行于 src/diagram/、src/card/,不是 provider,不实现 VisionProvider 接口)。理由:TBPU 与 provider 解耦——任何 provider(tesseract/paddle/vlm)返回 TextBlock[] 后都可走同一后处理;放 providers/ 会暗示它是 provider。

【公开 API】单一入口,纯函数,无副作用:
  applyTbpu(blocks: TextBlock[], layout?: LayoutStrategy): TbpuResult
  TbpuResult = { blocks: TextBlock[]; text: string; warnings?: string[] }

【LayoutStrategy 枚举】4 主 + 4 进阶(完整暴露 Umi 8 策略,advanced 用户可直传):
  type LayoutStrategy =
    | "none"         // 默认,等价当前 join("\n") 行为
    | "natural"      // → multi_para:GapTree 重排 + ParagraphParse 段内分隔符预测(文档首选)
    | "plain"        // → multi_none:GapTree 重排 + word_separator 连写,无硬换行(纯文本流)
    | "code"         // → single_code:保缩进,行内合并,列缩进还原(代码/CSV/终端截图)
    | "multi-para" | "multi-line" | "multi-none"      // 进阶
    | "single-para" | "single-line" | "single-none" | "single-code";

【内部 Unit 工作类型】解耦输入与算法:
  interface Unit { bbox: [x0,y0,x1,y1]; text: string; end: string; src: TextBlock }
  算法在 Unit[] 上运行;end 在策略中改写;最后输出时映射回新 TextBlock[](不 mutate 输入)。

【算法对象】
  class GapTree { sort(units): Unit[]; getNodesTextBlocks(): Unit[][] }
  function paragraphParse(units: Unit[]): void  // 段内分组 + 写 end
  function getSingleLines(units): Unit[][]       // 单栏行聚类(SingleLine.get_lines 移植)
  function mergeCodeLine(line: Unit[]): Unit     // single_code 行合并 + 列距补空格
  function indentCode(units: Unit[]): void       // single_code 列缩进还原

【与 extract_text 集成的契约】
  provider.recognize() 返回 VisionResult{ text, blocks } →
  handler 拿到 blocks 后调 applyTbpu(blocks, hints.layout) →
  用返回的 {blocks, text} 覆盖 result 的 text 和 blocks →
  落盘/返回。layout=undefined|"none" 时直接跳过(零开销,保持当前行为)。

【向后兼容 / 降级路径】
  - blocks.length<=1:直接返回(单块无需排序)。
  - 任一 block 缺 bbox:tesseract.js 已自带 bbox,但 paddle.ts 当前不写 bbox(需集成时补 rec_polys→bbox)。无 bbox 时 emit warning + 降级为 "none"(join("\n")),不抛错。
  - digitOnly=true 时 layout 自动失效(验证码场景无需版面):由 handler 层判断,不进 tbpu。

【简化决策(相对 Umi 原版)】
  1. linePreprocessing 跳过旋转校正:仅保留"过滤空文本 + 按 y 排序"。tesseract.js/padd

### 集成点
4 个集成点,与现有 pares5 架构(provider 抽象 + fallback 链)对齐:

【1. src/providers/types.ts —— 2 处扩展】
A) ExtractTextHints 加 layout 字段(语义级,与 languages/digitOnly/segmentation 同层):
  export interface ExtractTextHints {
    languages?: string[];
    digitOnly?: boolean;
    segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";
    /** pares6: 排版解析后处理。none=不处理(默认,当前 join("\n") 行为);natural=多栏自然段合并(文档);plain=多栏纯文本流(收据/流水);code=保留缩进(代码截图)。 */
    layout?: "none" | "natural" | "plain" | "code";
  }
B) TextBlock 加可选 end 字段(非破坏性,透出 TBPU 预测的分隔符给 json outputFormat):
  export interface TextBlock {
    text: string;
    bbox?: [number, number, number, number];
    confidence?: number;
    level: "word" | "line" | "paragraph";
    /** pares6: TBPU 预测的块尾分隔符("" | " " | "\n"),仅 layout != none 时出现。 */
    end?: string;
  }

【2. src/index.ts extract_text handler —— 3 处改动】
A) import:{ applyTbpu } from "./vision/tbpu.js"; 加 LayoutStrategy 类型
B) schema:extract_text inputSchema.properties 加一项
   layout: { type: "string", enum: ["none", "natural", "plain", "code"], default: "none", description: "版面后处理:natural=多栏自然段合并(文档/论文)/ plain=纯文本流无段落(收据/流水)/ code=保留缩进(代码截图)/ none=不处理(默认,逐行)。需要 blocks 带 bbox。" }
C) handler:
  // 原 hints 构造处加:
  const hints: ExtractTextHints = {
    languages: toStringArray(a.languages),
    digitOnly: a.digitOnly === true,
    segmentation: optString(a.segmentation) as ExtractTextHints["segmentation"],
    layout: optString(a.layout) as ExtractTextHints["layout"],  // ← 新增
  };
  // recognize 成功后(result.blocks 存在时),走 TBPU 后处理:
  if (result.blocks?.length && hints.layout && hints.layout !== "none") {
    const tbpu = applyTbpu(result.blocks, hints.layout);
    result = { ...result, blocks: tbpu.blocks, text: tbpu.text };
    if (tbpu.warnings?.length) warnings.push(...tbpu.warnings);
  }
  // fallback 路径同样补(recognize 二次调用后也走一遍 TBPU)

【3. src/providers/tesseract.ts —— 无需改】
  recognize() 已从 ln.bbox 写入 TextBlock.bbox(tesseract.js Page.lines[].bbox 恒存在),TBPU 直接可用。
  唯一注意:l

### TS 代码骨架

```typescript
// src/vision/tbpu.ts
/**
 * TBPU(Text Block Processing Unit)排版解析后处理 —— Umi-OCR 算法的 JS/TS 移植。
 * 算法源:https://github.com/hiroi-sora/Umi-OCR  py_src/ocr/tbpu/
 *   - parser_tools/gap_tree.py (330 行,间隔树排序)
 *   - parser_tools/paragraph_parse.py (173 行,段内分隔符预测)
 *   - parser_tools/line_preprocessing.py (98 行,行预处理)
 *   - 8 个 strategy parser(parser_multi_*/parser_single_*/parser_none)
 *
 * 定位:provider-agnostic 的 blocks 后处理。在 extract_text handler 中,
 * provider(tesseract/paddle)返回 blocks 后调用 applyTbpu(blocks, layout)。
 *
 * 简化(相对 Umi 原版):
 *   1. linePreprocessing 跳过旋转校正 —— tesseract.js/paddle 已返回轴对齐 bbox,
 *      旋转角 ≈ 0° 走原版 fast path;若后续接入带回转 box 的源,补 _calculateAngle 即可。
 *   2. ignore_area(忽略区域)未移植 —— MCP 工具层暂无 ignore-area 参数需求,YAGNI。
 */
import type { TextBlock } from "../providers/types.js";

// ════════════════════════ 公开类型 ════════════════════════

/** 排版策略。前 4 个为主推(natural/plain/code/none),其余为完整 Umi 8 策略的透传口。 */
export type LayoutStrategy =
  | "none"          // 不处理(默认,等价当前 join("\n") 行为)
  | "natural"       // 多栏-自然段(multi_para):GapTree + ParagraphParse,文档首选
  | "plain"         // 多栏-纯文本流(multi_none):GapTree 重排 + 段内连写,无硬换行
  | "code"          // 单栏-代码段(single_code):保缩进,合并行,还原列缩进层级
  // ── 进阶(完整暴露 Umi 8 策略)──
  | "multi-para" | "multi-line" | "multi-none"
  | "single-para" | "single-line" | "single-none" | "single-code";

export interface TbpuResult {
  /** 重排后的 blocks(每个 block 携带预测的 `end` 分隔符)。 */
  blocks: TextBlock[];
  /** 按 Umi 语义拼接的全文(text + end,末尾 end 丢弃)。 */
  text: string;
  warnings?: string[];
}

// ════════════════════════ 内部工作类型 ════════════════════════

type Bbox = [number, number, number, number]; // [x0, y0, x1, y1]

/** 内部块单元。end 在策略中被改写;text/bbox 为不可变快照。 */
interface Unit {
  bbox: Bbox;
  text: string;
  end: string; // "" | " " | "\n"
  src: TextBlock; // 原 TextBlock 引用,承袭 confidence/level
}

interface Gap { left: number; right: number; rowStart: number; }
interface Cut { left: number; right: number; rowStart: number; rowEnd: number; }
interface TreeNode {
  xLeft: number; xRight: number; rTop: number; rBottom: number;
  units: Unit[]; children: TreeNode[];
}

const TH = 1.2;     // 段内行高容忍倍数(移植 paragraph_parse.TH)
const EPS = 0.0001; // 浮点容忍(移植 gap_tree 的 +0.0001 比较)

// ════════════════════════ 公开入口 ════════════════════════

const STRATEGY_ALIAS: Record<string, LayoutStrategy> = {
  none: "none", natural: "natural", plain: "plain", code: "code",
  "multi-para": "multi-para", "multi-line": "multi-line", "multi-none": "multi-none",
  "single-para": "single-para", "single-line": "single-line",
  "single-none": "single-none", "single-code": "single-code",
  // Umi 原始键名兼容(下划线)
  multi_para: "multi-para", multi_line: "multi-line", multi_none: "multi-none",
  single_para: "single-para", single_line: "single-line",
  single_none: "single-none", single_code: "single-code",
};

/**
 * 对 OCR blocks 做排版解析后处理。
 * - layout 缺省 / "none" → 等价当前行为(join("\n")),blocks 原序返回。
 * - blocks 为空 / 单块 → 快速返回。
 * - 任一块缺 bbox → 降级为 "none" 并打 warning(layout 不可用)。
 */
export function applyTbpu(blocks: TextBlock[], layout?: LayoutStrategy): TbpuResult {
  const warnings: string[] = [];
  const strategy = layout ? STRATEGY_ALIAS[layout] ?? "none" : "none";

  if (!blocks.length) return { blocks, text: "" };
  if (blocks.length === 1) {
    return { blocks, text: blocks[0].text };
  }
  if (strategy === "none") {
    return { blocks, text: blocks.map((b) => b.text).join("\n") };
  }

  // 预处理:text 过滤 + bbox 缺失检测
  const { units, missingBbox } = preprocess(blocks);
  if (!units.length) return { blocks: [], text: "" };
  if (missingBbox > 0) {
    warnings.push(
      `${missingBbox}/${blocks.length} 个 block 缺 bbox,无法做版面分析,已降级为 "none"(线性拼接)。请确认 provider 输出 bbox(tesseract.js 已自带;paddle 需从 rec_polys/dt_polys 提取)。`,
    );
    return { blocks, text: blocks.map((b) => b.text).join("\n"), warnings };
  }

  // 分派策略
  let out: Unit[];
  switch (strategy) {
    case "natural":
    case "multi-para":   out = strategyMultiPara(units); break;
    case "plain":
    case "multi-none":   out = strategyMultiNone(units); break;
    case "multi-line":   out = strategyMultiLine(units); break;
    case "single-para":  out = strategySinglePara(units); break;
    case "single-line":  out = strategySingleLine(units); break;
    case "single-none":  out = strategySingleNone(units); break;
    case "code":
    case "single-code":  out = strategySingleCode(units); break;
    default:             out = units; // 兜底
  }

  // 输出 TextBlock[] + 全文拼接
  const outBlocks: TextBlock[] = out.map((u) => ({
    text: u.text,
    bbox: u.bbox,
    confidence: u.src.confidence,
    level: u.src.level,
    end: u.end,
  }));
  const text = out
    .map((u, i) => (i < out.length - 1 ? u.text + u.end : u.text))
    .join("");
  return { blocks: outBlocks, text, warnings: warnings.length ? warnings : undefined };
}

// ════════════════════════ 行预处理(简化版) ════════════════════════

function preprocess(blocks: TextBlock[]): { units: Unit[]; missingBbox: number } {
  let missing = 0;
  const units: Unit[] = [];
  for (const b of blocks) {
    if (!b.text) continue; // 丢空文本块(对齐 linePreprocessing 的 filter)
    if (!b.bbox) { missing++; continue; }
    units.push({
      bbox: [b.bbox[0], b.bbox[1], b.bbox[2], b.bbox[3]],
      text: b.text,
      end: "\n",
      src: b,
    });
  }
  units.sort((a, b) => a.bbox[1] - b.bbox[1]); // 按 y0 从上到下(gap_tree 前置条件)
  return { units, missing };
}

// ════════════════════════ 工具:CJK 判断 + 分隔符预测 ════════════════════════

function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return [
    [0x4e00, 0x9fff], [0x3040, 0x30ff], [0x1100, 0x11ff], [0x3130, 0x318f],
    [0xac00, 0xd7af], [0x3000, 0x303f], [0xfe30, 0xfe4f], [0xff00, 0xffef],
  ].some(([s, e]) => cp >= s && cp <= e);
}

/**
 * 段内相邻行的分隔符预测(移植 paragraph_parse.word_separator)。
 * - 中日韩相邻 → ""(无分隔)
 * - 前字符为 "-" → ""(连字符换行)
 * - 后字符为标点 → ""(标点紧跟)
 * - 否则 → " "(拉丁词间空格)
 */
export function wordSeparator(c1: string, c2: string): string {
  if (!c1 || !c2) return " ";
  if (isCjk(c1) && isCjk(c2)) return "";
  if (c1 === "-") return "";
  if (/\p{P}/u.test(c2)) return ""; // Unicode 标点类别(对齐 unicodedata.category P*)
  return " ";
}

// ════════════════════════ GapTree 间隔树排序算法 ════════════════════════

class GapTree {
  private currentNodes: TreeNode[] = [];

  /** 排序入口:返回按人类阅读顺序重排后的 units。 */
  sort(units: Unit[]): Unit[] {
    if (units.length <= 1) { this.currentNodes = []; return [...units]; }
    const pageL = Math.min(...units.map((u) => u.bbox[0]));
    const pageR = Math.max(...units.map((u) => u.bbox[2]));
    const { cuts, rows } = this.getCutsRows(units, pageL, pageR);
    if (!cuts.length) {
      this.currentNodes = [];
      return [...units];
    }
    const root = this.getLayoutTree(cuts, rows);
    const nodes = this.preorder(root);
    this.currentNodes = nodes;
    return this.flatten(nodes);
  }

  /** sort 后调用:返回以列区块为单位的二层列表(每个内层 list = 一列区块)。 */
  getNodesTextBlocks(): Unit[][] {
    return this.currentNodes
      .filter((n) => n.units.length)
      .map((n) => [...n.units]);
  }

  // ── 求竖切线 cuts + 行 rows ──
  // cuts = 在多个连续行中持续存在的 x-间隙(列分隔线);rows = 同一水平线上的块组
  private getCutsRows(units: Unit[], pageL: number, pageR: number): { cuts: Cut[]; rows: Unit[][] } {
    const pL = pageL - 1; // 边缘外扩 1,免块边与页边重叠
    const pR = pageR + 1;
    const rows: Unit[][] = [];
    const completedCuts: Cut[] = [];
    let gaps: Gap[] = [];
    let rowIndex = 0;
    let unitIndex = 0;

    while (unitIndex < units.length) {
      const unit = units[unitIndex];
      const uBottom = unit.bbox[3];
      const row: Unit[] = [unit];
      for (let i = unitIndex + 1; i < units.length; i++) {
        if (units[i].bbox[1] > uBottom) break; // 下一块顶部低于当前行底 → 新行
        row.push(units[i]);
        unitIndex = i;
      }
      row.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[2] - b.bbox[2]);

      // 当前行的水平间隙组
      const rowGaps: Gap[] = [];
      let searchStart = pL;
      for (const u of row) {
        const [l, , r] = u.bbox;
        if (l > searchStart) rowGaps.push({ left: searchStart, right: l, rowStart: rowIndex });
        if (r > searchStart) searchStart = r;
      }
      rowGaps.push({ left: searchStart, right: pR, rowStart: rowIndex });

      // 与上一行的 gaps 取交集;未交上的旧 gap → 竖切线终结
      const { next, removed } = updateGaps(gaps, rowGaps);
      gaps = next;
      const rowMax = rowIndex - 1;
      for (const dg of removed) completedCuts.push({ ...dg, rowEnd: rowMax });

      rows.push(row);
      unitIndex++;
      rowIndex++;
    }
    // 收尾:剩余 gaps 延伸到最后一行
    const lastRow = rows.length - 1;
    for (const g of gaps) completedCuts.push({ ...g, rowEnd: lastRow });
    completedCuts.sort((a, b) => a.left - b.left);
    return { cuts: completedCuts, rows };
  }

  // ── 构建布局树 ──
  private getLayoutTree(cuts: Cut[], rows: Unit[][]): TreeNode {
    const rowsGaps: [number, number][][] = rows.map(() => []);
    for (const cut of cuts) {
      for (let r = cut.rowStart; r <= cut.rowEnd; r++) rowsGaps[r].push([cut.left, cut.right]);
    }

    const root: TreeNode = {
      xLeft: cuts[0].left - 1, xRight: cuts[cuts.length - 1].right + 1,
      rTop: -1, rBottom: -1, units: [], children: [],
    };
    const completedNodes: TreeNode[] = [root];
    let nowNodes: TreeNode[] = [];

    // 将 node 挂到最近的父节点(x 投影包含其右界 且 底部在它之上;并列取最右)
    const complete = (node: TreeNode) => {
      const nodeR = node.xRight - 2;
      let maxNodes: TreeNode[] = [];
      let maxR = -2;
      for (const com of completedNodes) {
        if (nodeR < com.xLeft || nodeR > com.xRight + EPS) continue;
        if (com.rBottom >= node.rTop) continue;
        if (com.rBottom > maxR) { maxR = com.rBottom; maxNodes = [com]; }
        else if (com.rBottom === maxR) maxNodes.push(com);
      }
      const parent = maxNodes.length
        ? maxNodes.reduce((a, b) => (a.xRight >= b.xRight ? a : b))
        : root;
      parent.children.push(node);
      completedNodes.push(node);
    };

    for (let r_i = 0; r_i < rows.length; r_i++) {
      const row = rows[r_i];
      const rowGaps = rowsGaps[r_i];

      // 1) 延续 / 终结当前打开的节点
      const surviving: TreeNode[] = [];
      for (const node of nowNodes) {
        let lFlag = false, rFlag = false, completedFlag = false;
        for (const gap of rowGaps) {
          if (gap[1] === node.xLeft) lFlag = true;
          if (gap[0] === node.xRight) rFlag = true;
          if ((node.xLeft < gap[0] && gap[0] < node.xRight) ||
              (node.xLeft < gap[1] && gap[1] < node.xRight)) {
            completedFlag = true; break;
          }
        }
        if (!lFlag || !rFlag) completedFlag = true;
        if (completedFlag) complete(node);
        else { node.rBottom = r_i; surviving.push(node); }
      }
      nowNodes = surviving;

      // 2) 从左到右分配本行 blocks 到节点
      let u_i = 0, g_i = 0;
      while (u_i < row.length) {
        const unit = row[u_i];
        const xL = rowGaps[g_i][1];        // 左间隙右界
        const xR = rowGaps[g_i + 1][0];    // 右间隙左界
        if (unit.bbox[0] + EPS > xR) { g_i++; continue; } // 块在更右的列
        let found = false;
        for (const node of nowNodes) {
          if (node.xLeft === xL && node.xRight === xR) {
            node.units.push(unit); found = true; break;
          }
        }
        if (!found) {
          nowNodes.push({
            xLeft: xL, xRight: xR, rTop: r_i, rBottom: r_i,
            units: [unit], children: [],
          });
        }
        u_i++;
      }
    }
    for (const node of nowNodes) complete(node);

    // 整理:子节点按 x 排,units 按 y 排
    for (const node of completedNodes) {
      node.children.sort((a, b) => a.xLeft - b.xLeft);
      node.units.sort((a, b) => a.bbox[1] - b.bbox[1]);
    }
    return root;
  }

  private preorder(root: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    const stack: TreeNode[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return out;
  }

  private flatten(nodes: TreeNode[]): Unit[] {
    return nodes.flatMap((n) => n.units);
  }
}

/** 间隙组求交:gaps1 ∩ gaps2 → next;gaps1 中未交上任何 gap2 的 → removed(竖切线终结)。 */
function updateGaps(gaps1: Gap[], gaps2: Gap[]): { next: Gap[]; removed: Gap[] } {
  const flags1 = gaps1.map(() => true);  // true = 待移除(未交)
  const flags2 = gaps2.map(() => true);  // true = 待新增
  const next: Gap[] = [];
  for (let i1 = 0; i1 < gaps1.length; i1++) {
    for (let i2 = 0; i2 < gaps2.length; i2++) {
      const interL = Math.max(gaps1[i1].left, gaps2[i2].left);
      const interR = Math.min(gaps1[i1].right, gaps2[i2].right);
      if (interL <= interR) {
        next.push({ left: interL, right: interR, rowStart: gaps1[i1].rowStart });
        flags1[i1] = false;
        flags2[i2] = false;
      }
    }
  }
  for (let i2 = 0; i2 < gaps2.length; i2++) if (flags2[i2]) next.push(gaps2[i2]);
  const removed: Gap[] = [];
  for (let i1 = 0; i1 < gaps1.length; i1++) if (flags1[i1]) removed.push(gaps1[i1]);
  return { next, removed };
}

// ════════════════════════ ParagraphParse 段内分隔符预测 ════════════════════════

/** 移植 paragraph_parse.ParagraphParse.run:对单列内的 units 做段落分组 + 写入 end。 */
function paragraphParse(units: Unit[]): void {
  if (!units.length) return;
  const sorted = [...units].sort((a, b) => a.bbox[1] - b.bbox[1]);
  if (sorted.length === 1) { sorted[0].end = "\n"; return; }

  // ── Phase 1:按左右对齐 + 行间距分组为段落 ──
  let [paraL, , paraR, paraBottom] = sorted[0].bbox;
  let paraH = sorted[0].bbox[3] - sorted[0].bbox[1];
  let paraS: number | null = null;
  let nowPara: Unit[] = [sorted[0]];
  const paras: Unit[][] = [];
  const parasSpace: (number | null)[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const u = sorted[i];
    const [l, top, r, bottom] = u.bbox;
    const h = bottom - top;
    const ls = top - paraBottom; // 行间距
    const same =
      Math.abs(paraL - l) <= paraH * TH &&
      Math.abs(paraR - r) <= paraH * TH &&
      (paraS === null || ls < paraS + paraH * 0.5);
    if (same) {
      paraL = (paraL + l) / 2;
      paraR = (paraR + r) / 2;
      paraH = (paraH + h) / 2;
      paraS = paraS === null ? ls : (paraS + ls) / 2;
      nowPara.push(u);
    } else {
      paras.push(nowPara); parasSpace.push(paraS);
      nowPara = [u];
      paraL = l; paraR = r; paraH = h; paraS = null;
    }
    paraBottom = bottom;
  }
  paras.push(nowPara); parasSpace.push(paraS);

  // ── Phase 2:单行孤儿段并入上/下段(末句/首句)──
  for (let i1 = paras.length - 1; i1 >= 0; i1--) {
    const para = paras[i1];
    if (para.length !== 1) continue;
    const [l, top, r, bottom] = para[0].bbox;
    let upFlag = false, downFlag = false;

    if (i1 > 0) {
      const upLast = paras[i1 - 1][paras[i1 - 1].length - 1];
      const [upL, upTop, upR, upBottom] = upLast.bbox;
      const upH = upBottom - upTop;
      upFlag = Math.abs(upL - l) <= upH * TH && r <= upR + upH * TH;
      if (parasSpace[i1 - 1] !== null && top - upBottom > (parasSpace[i1 - 1] as number) + upH * 0.5) {
        upFlag = false;
      }
    }
    if (i1 < paras.length - 1) {
      const downFirst = paras[i1 + 1][0];
      const [downL, downTop, downR, downBottom] = downFirst.bbox;
      const downH = downBottom - downTop;
      if (downL - downH * TH <= l && l <= downL + downH * (1 + TH)) {
        downFlag = paras[i1 + 1].length > 1
          ? Math.abs(downR - r) <= downH * TH
          : downR - downH * TH < r;
      }
      if (parasSpace[i1 + 1] !== null && downTop - bottom > (parasSpace[i1 + 1] as number) + downH * 0.5) {
        downFlag = false;
      }
    }

    if (upFlag && downFlag) {
      const upLast = paras[i1 - 1][paras[i1 - 1].length - 1];
      const downFirst = paras[i1 + 1][0];
      if (top - upLast.bbox[3] < downFirst.bbox[1] - bottom) paras[i1 - 1].push(para[0]);
      else paras[i1 + 1].unshift(para[0]);
    } else if (upFlag) paras[i1 - 1].push(para[0]);
    else if (downFlag) paras[i1 + 1].unshift(para[0]);

    if (upFlag || downFlag) { paras.splice(i1, 1); parasSpace.splice(i1, 1); }
  }

  // ── Phase 3:刷新每段 end(段内分隔 + 段末换行)──
  for (const para of paras) {
    for (let i = 0; i < para.length - 1; i++) {
      const c1 = para[i].text[para[i].text.length - 1] ?? "";
      const c2 = para[i + 1].text[0] ?? "";
      para[i].end = wordSeparator(c1, c2);
    }
    para[para.length - 1].end = "\n";
  }
}

// ════════════════════════ 单栏工具(get_lines / merge / indent) ════════════════════════

/** 单栏假设:按 y 重叠 + 行高接近,把 blocks 聚成行(移植 SingleLine.get_lines)。 */
function getSingleLines(units: Unit[]): Unit[][] {
  const sorted = [...units].sort((a, b) => a.bbox[0] - b.bbox[0]);
  const consumed = new Array(sorted.length).fill(false);
  const lines: Unit[][] = [];

  for (let i1 = 0; i1 < sorted.length; i1++) {
    if (consumed[i1]) continue;
    const tb1 = sorted[i1];
    let r1 = tb1.bbox[2];
    const [l1, top1, , bottom1] = tb1.bbox;
    const h1 = bottom1 - top1;
    const line: Unit[] = [tb1];

    for (let i2 = i1 + 1; i2 < sorted.length; i2++) {
      if (consumed[i2]) continue;
      const tb2 = sorted[i2];
      const [l2, top2, r2, bottom2] = tb2.bbox;
      const h2 = bottom2 - top2;
      if (l2 < r1 - h1) continue;                              // 行2左侧太前
      if (top2 < top1 - h1 * 0.5 || bottom2 > bottom1 + h1 * 0.5) continue; // 垂直距离太远
      if (Math.abs(h1 - h2) > Math.min(h1, h2) * 0.5) continue; // 行高差距过大
      line.push(tb2);
      consumed[i2] = true;
      r1 = r2;
    }
    // 行内分隔符(大间隙强制空格,否则按字符判断)
    for (let i = 0; i < line.length - 1; i++) {
      const [, t1, r1b, b1] = line[i].bbox;
      const [l2, , , b2] = line[i + 1].bbox;
      // 注:Umi 原式为 (b1+b2-t1-l2)*0.5(疑似 l2 应为 t2,此处忠实移植)
      const h = (b1 + b2 - t1 - l2) * 0.5;
      if (l2 - r1b > h * 1.5) { line[i].end = " "; continue; }
      const c1 = line[i].text[line[i].text.length - 1] ?? "";
      const c2 = line[i + 1].text[0] ?? "";
      line[i].end = wordSeparator(c1, c2);
    }
    line[line.length - 1].end = "\n";
    lines.push(line);
    consumed[i1] = true;
  }
  lines.sort((a, b) => a[0].bbox[1] - b[0].bbox[1]);
  return lines;
}

/** single_code:把一行的多个 block 合并为一个 unit,按列距离补 2*N 空格(移植 SingleCode.merge_line)。 */
function mergeCodeLine(line: Unit[]): Unit {
  const A: Unit = {
    bbox: [line[0].bbox[0], line[0].bbox[1], line[0].bbox[2], line[0].bbox[3]],
    text: line[0].text,
    end: "\n",
    src: line[0].src,
  };
  let ha = A.bbox[3] - A.bbox[1];
  for (let i = 1; i < line.length; i++) {
    const B = line[i];
    ha = (ha + (B.bbox[3] - B.bbox[1])) / 2;
    let space = 0;
    if (B.bbox[0] > A.bbox[2]) space = Math.round((B.bbox[0] - A.bbox[2]) / ha);
    A.text += " ".repeat(2 * space) + B.text;
    A.bbox = [
      Math.min(A.bbox[0], B.bbox[0]),
      Math.min(A.bbox[1], B.bbox[1]),
      Math.max(A.bbox[2], B.bbox[2]),
      Math.max(A.bbox[3], B.bbox[3]),
    ];
  }
  return A;
}

/** single_code:按平均行高构建缩进层级,为每行句首补空格(移植 SingleCode.indent)。 */
function indentCode(units: Unit[]): void {
  if (!units.length) return;
  let lh = 0, xMin = Infinity, xMax = -Infinity;
  for (const u of units) {
    lh += u.bbox[3] - u.bbox[1];
    if (u.bbox[0] < xMin) xMin = u.bbox[0];
    if (u.bbox[0] > xMax) xMax = u.bbox[0];
  }
  lh /= units.length;
  const lh2 = lh / 2;
  const levels: number[] = [];
  for (let x = xMin; x < xMax; x += lh) levels.push(x);
  for (const u of units) {
    const target = u.bbox[0] + lh2;
    // bisect_left(levels, target)
    let lo = 0, hi = levels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (levels[mid] < target) lo = mid + 1; else hi = mid;
    }
    const level = Math.max(0, lo - 1);
    u.text = " ".repeat(2 * level) + u.text;
    u.bbox = [xMin, u.bbox[1], u.bbox[2], u.bbox[3]]; // 左侧归零对齐
  }
}

// ════════════════════════ 8 策略入口 ════════════════════════

function strategyMultiPara(units: Unit[]): Unit[] {
  const gtree = new GapTree();
  const sorted = gtree.sort(units);
  for (const nodeUnits of gtree.getNodesTextBlocks()) paragraphParse(nodeUnits);
  return sorted;
}

function strategyMultiLine(units: Unit[]): Unit[] {
  const sorted = new GapTree().sort(units);
  for (const u of sorted) u.end = "\n";
  return sorted;
}

function strategyMultiNone(units: Unit[]): Unit[] {
  const sorted = new GapTree().sort(units);
  for (let i = 0; i < sorted.length; i++) {
    if (i < sorted.length - 1) {
      const c1 = sorted[i].text[sorted[i].text.length - 1] ?? "";
      const c2 = sorted[i + 1].text[0] ?? "";
      sorted[i].end = wordSeparator(c1, c2);
    } else sorted[i].end = "\n";
  }
  return sorted;
}

function strategySingleLine(units: Unit[]): Unit[] {
  const lines = getSingleLines(units);
  return lines.flat();
}

function strategySinglePara(units: Unit[]): Unit[] {
  const lines = getSingleLines(units);
  // 每行 → 临时 unit(取行 bbox + 行首尾字符),交给 paragraphParse 预测行间分隔
  const tempUnits: Unit[] = lines.map((line) => {
    let [, b1, b2, b3] = line[0].bbox;
    const b0 = line[0].bbox[0];
    for (let i = 1; i < line.length; i++) {
      const bb = line[i].bbox;
      b1 = Math.min(b1, bb[1]); b2 = Math.max(b2, bb[2]); b3 = Math.max(b3, bb[3]);
    }
    return {
      bbox: [b0, b1, b2, b3] as Bbox,
      text: (line[0].text[0] ?? "") + (line[line.length - 1].text[line[line.length - 1].text.length - 1] ?? ""),
      end: "\n",
      src: line[0].src,
      _line: line, // 旁路存储;TS 严格模式可改 Map<Unit, Unit[]>
    } as Unit & { _line: Unit[] };
  });
  paragraphParse(tempUnits);
  // 把预测的 end 写回原 line 末块
  return tempUnits.flatMap((t) => {
    const line = (t as Unit & { _line?: Unit[] })._line ?? [];
    if (line.length) line[line.length - 1].end = t.end;
    return line;
  });
}

function strategySingleNone(units: Unit[]): Unit[] {
  const flat = strategySingleLine(units);
  for (let i = 0; i < flat.length - 1; i++) {
    if (flat[i].end === "\n") {
      const c1 = flat[i].text[flat[i].text.length - 1] ?? "";
      const c2 = flat[i + 1].text[0] ?? "";
      flat[i].end = wordSeparator(c1, c2);
    }
  }
  return flat;
}

function strategySingleCode(units: Unit[]): Unit[] {
  const lines = getSingleLines(units);
  const merged = lines.map(mergeCodeLine);
  indentCode(merged);
  return merged;
}
```

---

## ignoreArea 忽略区域过滤(extract_text 后处理)。源码调研:Umi-OCR `UmiOCR-data/py_src/ocr/tbpu/ignore_area.py`(用户给的相对路径 `py_src/ocr/tbpu/` 正确,仅多一层仓库根前缀 `UmiOCR-data/`)+ `server/ocr_server.py` 的 check_ocr_options 归一化 + `tbpu/__init__.py` pipeline 集成。算法 = AABB 完全包含才剔除(部分重叠保留)。media-gen-mcp 现状:types.ts ExtractTextHints(无 ignoreAreas)、tesseract.ts recognize 已产出 blocks[].bbox=[x0,y0,x1,y1]、index.ts extract_text handler 第 713-760 行。集成点:types.ts 加 ignoreAreas + 新建 src/providers/vision-filter.ts 纯函数 + index.ts handler 后过滤(blocks+text 重拼)+ tesseract/paddle recognize 后(由 handler 统一调,provider 无须改)。

### JS 设计
**类型(types.ts · ExtractTextHints 扩字段)**
```ts
export interface RectIgnoreArea { x: number; y: number; w: number; h: number; }
export type CornerIgnoreArea = [[number, number], [number, number]];
export type IgnoreAreaInput = RectIgnoreArea | CornerIgnoreArea;

export interface ExtractTextHints {
  languages?: string[];
  digitOnly?: boolean;
  segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";
  /** NEW:文本块 bbox 完全落在任一忽略区 AABB 内则剔除;部分重叠保留(对称 Umi-OCR)。 */
  ignoreAreas?: IgnoreAreaInput[];
}
```
TextBlock.bbox 已是 `[x0, y0, x1, y1]`(tesseract.ts:147 已填)——恰好是 AABB 4 元组,无需任何 provider 改动即可消费。

**内部归一化**:两种用户形态统一转 `{x1,y1,x2,y2}`(已 min/max 排序);`{x,y,w,h} → {x, y, x+w, y+h}`。

**核心算法 isBlockContained(blockBBox, area)**:严格复刻 Umi isInBox 4 条件:`area.x1≤b.x1 && area.y1≤b.y1 && area.x2≥b.x2 && area.y2≥b.y2`(用 b 的 [x0,y0] 当 TL、[x1,y1] 当 BR)。等价 AABB 包含,即"整框包含才剔除,部分重叠保留"。

**过滤函数 filterBlocksByIgnoreAreas(blocks, areas?)**:
- areas 空/未传 → 原样返回(no-op)。
- 每个 block:无 bbox → 保留(不静默丢,透明)+ 计数;有 bbox → 任一 AABB 包含即剔除。
- 返回 `{ blocks, dropped, noBboxKept }` 供 handler 生成 warning。

**MCP args → IgnoreAreaInput[](parseIgnoreAreas)**:handler 用。严格校验:每项须 {x,y,w,h} 全 finite 或 [[n,n],[n,n]];任一非法 → throw(handler 外层 catch 已转 isError 返回)。

**集成位置(handler 层,非 provider 层)**:
- 新文件 `src/providers/vision-filter.ts` 放纯函数(对齐项目 providers/ 目录 + 易单测)。
- `index.ts` 的 `case "extract_text"` 在 recognize 返回后、落盘前调 filterBlocksByIgnoreAreas。
- **关键差异**:Umi 里 text 块就是文本的唯一载体;但 media-gen-mcp 的 tesseract provider 同时返回 `text`(全文,来自 data.text)和 `blocks`(按行)。过滤 blocks 后必须**用剩余 blocks 重拼 text**(join "\n"),否则 text 仍含被忽略区文字 —— 这是对 Umi 的必要补丁。

**handler warning 透传**:`dropped>0` 推 `ignoreAreas 过滤:剔除 N/M 块`;`noBboxKept>0` 推 `N 个块无 bbox 已保留`,沿用现有 warnings 机制。

**schema(extract_text.inputSchema.properties 加一项)**:`ignoreAreas` { type:array, items: oneOf [{x,y,w,h 对象}, [[n,n],[n,n]] 两角点数组] },description 注明"完全包含才剔,部分重叠保留;坐标尺度同原图像素"。

**比 Umi 多的两点健壮性**:(1) 角序任意(Umi 假定 [TL],[BR] 顺序,反了静默失效 → 我们 Math.min/max 排序);(2) 

### 集成点
4 处集成(均给出绝对路径 + 锚点行号):

1. **types.ts(加字段)** — `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/src/providers/types.ts`
   - `ExtractTextHints`(第 134-141 行)末尾加 `ignoreAreas?: IgnoreAreaInput[];`
   - 配套在文件内声明/导出 `IgnoreAreaInput`、`RectIgnoreArea`、`CornerIgnoreArea`(或从 vision-filter.ts re-export)。
   - 理由:对称 `digitOnly`/`segmentation`,语义级 what 不泄漏引擎 how;provider 未来可原生消费(如 paddle 预掩膜)。

2. **新建 vision-filter.ts(纯函数)** — `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/src/providers/vision-filter.ts`
   - 容纳 `normalizeIgnoreArea` / `isBlockContained` / `filterBlocksByIgnoreAreas` / `parseIgnoreAreas`。
   - 放 providers/ 下:tesseract.ts/paddle.ts(M2)同目录,import "./vision-filter.js" 短路径;零副作用纯函数,易单测。
   - 不放进 tesseract.ts:同一段过滤逻辑 paddle.ts(M2)也要复用,DRY。

3. **index.ts(extract_text handler 接线)** — `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/src/index.ts`
   - 顶部 import(第 26 行附近,紧跟 providers/types.js 的 import):`import { filterBlocksByIgnoreAreas, parseIgnoreAreas } from "./providers/vision-filter.js";` 以及 type import `IgnoreAreaInput`。
   - `case "extract_text"`(第 713-760 行):
     - schema properties(第 178-188 行 properties 块)加 `ignoreAreas`(见 codeSkeleton 的 JSON Schema 片)。
     - 在 `const hints: ExtractTextHints = {...}`(第 721-725 行)之前 `try { ignoreAreas = parseIgnoreAreas(a.ignoreAreas) } catch { return err(...) }`,再把 `ignoreAreas` 放入 hints。
     - 在两条 recognize 调用(第 730 行成功路径 + 第 740 行 fallback 路径)合并之后的公共区段(落盘 `if (result.text && a.download !== false)` 第 743 行之前),插入过滤 + `result.text = result.blocks.map(b=>b.text).join("\n")` 重拼。
     - dropped/noBboxKept 数 push 进 `warnings`(沿用第 727 行已有的 `warnings: string[]`)。
   - fallback 链兼容:过滤发生在 recognize 返回之后(无论首 provider 还是 fallback provider),`activeProvider`/`result` 已是最终生效者,过滤语义不受 fallback 影响。

4. **tesseract.ts(无须改)** — `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/src/providers/tesseract.ts`
   - `recognize`(第 121-154 行)产出的 `blocks[].bbox` 已是 `[ln.bbox.x0, ln.bbox.y0, ln.bbox.x1, l

### TS 代码骨架

```typescript
// ═══════════════════ NEW FILE: src/providers/vision-filter.ts ═══════════════════
/**
 * ignoreArea 忽略区域过滤(对称 Umi-OCR tbpu/ignore_area.py)。
 * 纯函数,零 provider 耦合,零副作用 —— handler 层调用 + 单测友好。
 * 语义:文本块 bbox 完全落在任一忽略区 AABB 内才剔除;部分重叠保留(同 Umi isInBox)。
 */

import type { TextBlock } from "./types.js";

/** 内部归一化 AABB(已排序:x1≤x2, y1≤y2)。 */
export interface AABB {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 用户层 {x,y,w,h} 矩形(原点+尺寸,最直观)。 */
export interface RectIgnoreArea {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 用户层两角点 [[x1,y1],[x2,y2]](对齐 Umi-OCR 用户 API;角序任意,内部排序)。 */
export type CornerIgnoreArea = [[number, number], [number, number]];

/** hints 层单条忽略区(两种形态任一)。 */
export type IgnoreAreaInput = RectIgnoreArea | CornerIgnoreArea;

/**
 * 归一化:两种用户形态 → 已排序 AABB。
 * 对 Umi 的改进:角序任意也能正确工作(Umi 假定 [TL],[BR] 顺序,反了会静默失效)。
 */
export function normalizeIgnoreArea(input: IgnoreAreaInput): AABB {
  if (Array.isArray(input)) {
    const [[ax, ay], [bx, by]] = input;
    return {
      x1: Math.min(ax, bx),
      y1: Math.min(ay, by),
      x2: Math.max(ax, bx),
      y2: Math.max(ay, by),
    };
  }
  const { x, y, w, h } = input;
  return { x1: x, y1: y, x2: x + w, y2: y + h };
}

/**
 * 块是否被 AABB 完全包含(= Umi isInBox 的等价语义)。
 * blockBBox 约定 [x0,y0,x1,y1] = [TL_x, TL_y, BR_x, BR_y](与 TextBlock.bbox / tesseract 一致)。
 */
export function isBlockContained(
  blockBBox: [number, number, number, number],
  area: AABB,
): boolean {
  const [bx1, by1, bx2, by2] = blockBBox;
  return (
    area.x1 <= bx1 &&
    area.y1 <= by1 &&
    area.x2 >= bx2 &&
    area.y2 >= by2
  );
}

export interface FilterResult {
  blocks: TextBlock[];
  /** 被剔除的块数。 */
  dropped: number;
  /** 因无 bbox 无法判定而保留的块数(透明诊断)。 */
  noBboxKept: number;
}

/**
 * 主过滤函数。
 * - areas 空/undefined → 原样返回(no-op,dropped=0)。
 * - 块无 bbox → 保留(不静默丢)并计数。
 * - 块落在任一 AABB 内 → 剔除。
 */
export function filterBlocksByIgnoreAreas(
  blocks: TextBlock[],
  areas: IgnoreAreaInput[] | undefined,
): FilterResult {
  if (!areas || areas.length === 0) {
    return { blocks, dropped: 0, noBboxKept: 0 };
  }
  const aabbs = areas.map(normalizeIgnoreArea);
  let dropped = 0;
  let noBboxKept = 0;
  const out = blocks.filter((b) => {
    if (!b.bbox) {
      noBboxKept++;
      return true; // 几何不可判定 → 保留
    }
    const contained = aabbs.some((a) => isBlockContained(b.bbox!, a));
    if (contained) {
      dropped++;
      return false;
    }
    return true;
  });
  return { blocks: out, dropped, noBboxKept };
}

/**
 * MCP loose args → IgnoreAreaInput[] | undefined。
 * 严格校验,任一项非法 → throw(handler catch 转 isError)。
 */
export function parseIgnoreAreas(v: unknown): IgnoreAreaInput[] | undefined {
  if (v == null) return undefined;
  if (!Array.isArray(v)) {
    throw new Error("`ignoreAreas` 须为数组,每项为 {x,y,w,h} 或 [[x1,y1],[x2,y2]]。");
  }
  if (v.length === 0) return undefined;
  const out: IgnoreAreaInput[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const { x, y, w, h } = item as Record<string, unknown>;
      if (
        ![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        throw new Error(
          `ignoreAreas[${i}] 的 {x,y,w,h} 必须全为有限数。`,
        );
      }
      out.push({ x: x as number, y: y as number, w: w as number, h: h as number });
    } else if (Array.isArray(item) && item.length === 2) {
      const p0 = item[0];
      const p1 = item[1];
      if (
        !Array.isArray(p0) || p0.length !== 2 ||
        !Array.isArray(p1) || p1.length !== 2 ||
        !([p0[0], p0[1], p1[0], p1[1]].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        ))
      ) {
        throw new Error(
          `ignoreAreas[${i}] 必须为 [[x1,y1],[x2,y2]] 两点形式且坐标为有限数。`,
        );
      }
      out.push([[(p0[0] as number), (p0[1] as number)], [(p1[0] as number), (p1[1] as number)]]);
    } else {
      throw new Error(
        `ignoreAreas[${i}] 格式不合法(须 {x,y,w,h} 或 [[x1,y1],[x2,y2]])。`,
      );
    }
  }
  return out;
}

// ═══════════════════ EDIT 1: types.ts — ExtractTextHints ═══════════════════
// (顶部补一行 import 或就地声明 IgnoreAreaInput;若不想跨文件循环依赖,直接在 types.ts 内声明)
//
//   /** 忽略区:用户层 {x,y,w,h} 或 [[x1,y1],[x2,y2]](在 vision-filter.ts 定义并 re-export)。 */
//   export type IgnoreAreaInput = import("./vision-filter.js").IgnoreAreaInput;
//
// export interface ExtractTextHints {
//   languages?: string[];
//   digitOnly?: boolean;
//   segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";
//   /** 忽略区域:落在任一区域 AABB 内的文本块被剔除(完全包含才剔,部分重叠保留)。 */
//   ignoreAreas?: IgnoreAreaInput[];
// }

// ═══════════════════ EDIT 2: index.ts — extract_text case ═══════════════════
//
// import { filterBlocksByIgnoreAreas, parseIgnoreAreas } from "./providers/vision-filter.js";
//
// 在 const hints: ExtractTextHints = { ... } 前解析:
//     let ignoreAreas: IgnoreAreaInput[] | undefined;
//     try {
//       ignoreAreas = parseIgnoreAreas(a.ignoreAreas);
//     } catch (e: any) {
//       return err(e.message);
//     }
//
//   const hints: ExtractTextHints = {
//     languages: toStringArray(a.languages),
//     digitOnly: a.digitOnly === true,
//     segmentation: optString(a.segmentation) as ExtractTextHints["segmentation"],
//     ignoreAreas,                          // ← NEW:hints 携带,provider 未来可原生消费
//   };
//
// 在 result = await activeProvider.recognize(...) 之后(成功路径 + fallback 路径都过,或抽到 finally 之后),
// 在落盘之前,插入过滤:
//
//     // ignoreAreas 后过滤(handler 层,对称 Umi tbpu pipeline;provider 无关)
//     if (ignoreAreas && ignoreAreas.length && result.blocks?.length) {
//       const beforeBlocks = result.blocks.length;
//       const fr = filterBlocksByIgnoreAreas(result.blocks, ignoreAreas);
//       result.blocks = fr.blocks;
//       // ★关键:tesseract 的 result.text 来自 data.text,独立于 blocks,含忽略区文字。
//       // 过滤后必须用剩余 blocks 重新拼接 text(Umi 不需要因为其 blocks 即唯一文本源)。
//       result.text = fr.blocks.map((b) => b.text).filter(Boolean).join("\n");
//       if (fr.dropped > 0) {
//         warnings.push(`ignoreAreas:剔除 ${fr.dropped}/${beforeBlocks} 个文本块。`);
//       }
//       if (fr.noBboxKept > 0) {
//         warnings.push(`ignoreAreas:${fr.noBboxKept} 个块无 bbox 无法判定,已保留。`);
//       }
//     }
//
// 同步在 extract_text schema properties 加:
//     ignoreAreas: {
//       type: "array",
//       description: "忽略区域:落在任一区域内的文本块被剔除。完全包含才剔(部分重叠保留)。每项为 {x,y,w,h} 或 [[x1,y1],[x2,y2]](像素坐标,与图片同尺度)。适合遮挡 logo/水印/页眉页脚后再识别。例:[{x:0,y:0,w:200,h:50}]。",
//       items: {
//         oneOf: [
//           {
//             type: "object",
//             properties: {
//               x: { type: "number" }, y: { type: "number" },
//               w: { type: "number" }, h: { type: "number" },
//             },
//             required: ["x", "y", "w", "h"],
//           },
//           {
//             type: "array",
//             items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
//             minItems: 2, maxItems: 2,
//           },
//         ],
//       },
//     },
```

---

