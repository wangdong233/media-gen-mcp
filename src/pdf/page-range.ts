// src/pdf/page-range.ts
/**
 * pageRange 字符串解析器(pares6 PDF 管线)。
 *
 * 接受语法(以逗号分隔的 token,大小写不敏感):
 *   - 数字:"3"
 *   - 闭区间:"1-10"
 *   - 关键字:"all"(默认,全页)/ "odd"(奇数页 1,3,5…)/ "even"(偶数页 2,4,6…)/ "last"(仅最后一页)
 *   - 混合:"1,3,5-7,odd,last"
 *
 * 输出升序去重的页码数组(1-based),自动钳制到 [1, total] 范围。
 *
 * 纯函数,零依赖,零副作用 —— 单测友好。
 */

export interface ParsedPageRange {
  /** 升序去重的页码(1-based,已钳制到 [1,total]) */
  pages: number[];
  /** 解析过程中产生的告警(如区间越界、token 非法) */
  warnings: string[];
}

/**
 * 解析 pageRange 字符串。
 * - 输入空串/纯空白/undefined/"all" → null(语义"全部",由调用方决定)
 * - total ≤ 0 → 抛错(调用方应先确定总页数)
 */
export function parsePageRange(input: string | undefined | null, total: number): ParsedPageRange {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`parsePageRange: total 须为正整数,收到 ${total}`);
  }
  const trimmed = (input ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "all") {
    return { pages: [], warnings: [] }; // [] = 全部(由调用方解释)
  }

  const warnings: string[] = [];
  const set = new Set<number>();
  const tokens = trimmed.split(",").map((s) => s.trim()).filter(Boolean);

  // 关键字:对全文档按"是否每页索引匹配"展开,与区间/数字组合一致
  const expandKeyword = (kw: string): number[] => {
    if (kw === "odd") {
      const out: number[] = [];
      for (let i = 1; i <= total; i += 2) out.push(i); // 1,3,5…
      return out;
    }
    if (kw === "even") {
      const out: number[] = [];
      for (let i = 2; i <= total; i += 2) out.push(i); // 2,4,6…
      return out;
    }
    if (kw === "last") return [total];
    return [];
  };

  for (const tok of tokens) {
    // 纯关键字(odd/even/last)
    if (/^(odd|even|last)$/.test(tok)) {
      for (const p of expandKeyword(tok)) set.add(p);
      continue;
    }
    // 区间 a-b
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(tok);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo > hi) {
        warnings.push(`pageRange token "${tok}" 区间反向(lo>hi),已跳过。`);
        continue;
      }
      for (let p = lo; p <= hi; p++) set.add(p);
      continue;
    }
    // 单数字
    const numMatch = /^(\d+)$/.exec(tok);
    if (numMatch) {
      set.add(parseInt(numMatch[1], 10));
      continue;
    }
    warnings.push(`pageRange token "${tok}" 无法识别(支持 数字 / a-b / odd / even / last / all),已跳过。`);
  }

  // 钳制到 [1,total] 并排序去重
  const sorted = Array.from(set)
    .filter((p) => {
      if (p < 1 || p > total) {
        warnings.push(`页码 ${p} 超出文档范围 [1,${total}],已剔除。`);
        return false;
      }
      return true;
    })
    .sort((a, b) => a - b);

  return { pages: sorted, warnings };
}
