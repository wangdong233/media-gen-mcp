// src/vision/ignore-area.ts
/**
 * ignoreArea 忽略区域过滤(对称 Umi-OCR tbpu/ignore_area.py)。
 * 纯函数,零 provider 耦合,零副作用 —— handler 层调用 + 单测友好。
 * 语义:文本块 bbox 完全落在任一忽略区 AABB 内才剔除;部分重叠保留(同 Umi isInBox)。
 */

import type { TextBlock } from "../providers/types.js";

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
export function filterIgnoreAreas(
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
