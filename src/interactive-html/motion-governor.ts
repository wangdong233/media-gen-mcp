/**
 * 交互式 HTML 图 —— Motion Governor 极简版(P0-5A §3.4)。
 *
 * 借鉴 Archify 5 触发条件范式(265 行 → 极简 ~20 行 CSS + viewer 一个按钮)。
 *
 * 留:
 *   - prefers-reduced-motion(无障碍硬需求,S9)
 *   - html[data-motion="still"](用户手动暂停,viewer 按钮 toggle)
 * 删(Tier 2/3 单独立项):
 *   - 多面板互斥所有者逻辑(MVP 只 1 个面板)
 *   - Story Trail 章节回放
 *   - visibilitychange 暂停(Tier 2)
 *
 * License:P0-5 自研(标准 CSS 无障碍范式,无第三方源码引用)。
 */
export const MOTION_GOVERNOR_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
html[data-motion="still"] *,
html[data-motion="still"] *::before,
html[data-motion="still"] *::after {
  animation: none !important;
  transition: none !important;
}
`;
