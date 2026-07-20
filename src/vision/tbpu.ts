// src/vision/tbpu.ts
/**
 * TBPU(Text Block Processing Unit)排版解析后处理 —— Umi-OCR 算法的 JS/TS 移植。
 * 算法源:https://github.com/hiroi-sora/Umi-OCR  py_src/ocr/tbpu/
 *   - parser_tools/gap_tree.py (330 行,间隔树排序)
 *   - parser_tools/paragraph_parse.py (173 行,段内分隔符预测)
 *   - parser_tools/line_preprocessing.py (98 行,行预处理)
 *   - 8 个 strategy parser(parser_multi_xxx / parser_single_xxx / parser_none 三族)
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
  return { units, missingBbox: missing };
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
    const [, top1, , bottom1] = tb1.bbox;
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
