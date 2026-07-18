/**
 * 颜色工具(shared):解析 hex / 计算亮度 / WCAG 对比度。
 * card/qr/formula/icon 的"合法输入但产出视觉误导"防御共用(如浅色字+浅色底不可见)。
 */

/** 解析颜色串首个 #hex(#RGB/#RRGGBB;渐变取首个 stop)→ [r,g,b];无 hex 返回 null。 */
export function parseHex(color: string): [number, number, number] | null {
  const m = color.match(/#([0-9a-f]{3}|[0-9a-f]{6})/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 解析颜色串全部 #hex 停止色(渐变含多个)→ 数组(可能空)。 */
export function parseAllHex(color: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  const re = /#([0-9a-f]{3}|[0-9a-f]{6})/gi;
  let m;
  while ((m = re.exec(color))) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    out.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  }
  return out;
}

/** WCAG 相对亮度(渐变取首个 hex stop)。无 hex 返回 null。 */
export function luminanceOf(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** 0.5 = 自定义启发式阈值(非 WCAG AA),作明暗自适应判断。 */
export function isLightBg(bg: string): boolean {
  const l = luminanceOf(bg);
  return l != null && l > 0.5;
}

/** WCAG 对比度(1.0=无对比)。取两色首个 hex;任一无 hex 返回 null。 */
export function contrastRatio(c1: string, c2: string): number | null {
  const l1 = luminanceOf(c1), l2 = luminanceOf(c2);
  if (l1 == null || l2 == null) return null;
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}
