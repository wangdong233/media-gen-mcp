/**
 * 交互式 HTML 图 —— 动画 CSS(0.12.1 新增,让图真"动"起来)。
 *
 * 三种动画,全部纯 CSS @keyframes(确定性:无 Math.random / Date.now / JS 驱动参数,
 * 同输入同 HTML 字节,不破 golden byte-compare 与 Step 1.2.5 确定性契约):
 *
 *   1. 边数据流:stroke-dashoffset 沿 path.connection 流动(虚线沿边走,架构/流程/ER 通用)
 *   2. 边/消息依次高亮:opacity 脉冲,:nth-of-type 错开 delay(时序图消息依次亮)
 *   3. 节点入场淡入:g.shape opacity 0→1,:nth-of-type 错开;悬停 drop-shadow 高亮
 *
 * 无障碍 / 暂停:Motion Governor(theme.ts 同级 motion-governor.ts)的
 *   `@media (prefers-reduced-motion: reduce)` 与 `html[data-motion="still"]`
 *   统一 `animation: none !important; transition: none !important;` gate 所有动画。
 *   本文件用普通 animation(非 !important),Governor 的 !important 必胜,故无需在此重复守。
 *
 * 靶向(D2 SVG 约定):
 *   - 边/消息 = `<path class="connection ..." fill="none">`(形状轮廓 path 无 connection 类,不受边流影响)
 *   - 节点 = `<g class="shape">`
 *   :nth-of-type 错开要求兄弟序;D2 通常把同类放同一 <g> 下,非严格兄弟时优雅降级(共享 delay,动画仍放)。
 *
 * License:P0-5 自研(标准 CSS 动画工艺,无第三方源码引用)。
 */
export const ANIMATIONS_CSS = `
/* === 1+2. 边数据流 + 依次高亮(逗号分隔多动画合并到 path.connection)=== */
path.connection {
  stroke-dasharray: 6 5;
  animation: mgm-edge-flow 1.4s linear infinite, mgm-edge-pulse 3.6s ease-in-out infinite;
}
@keyframes mgm-edge-flow {
  to { stroke-dashoffset: -11; }   /* -(dash+gap) = -(6+5) 无缝循环 */
}
@keyframes mgm-edge-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
/* 依次高亮:第 N 条边/消息的 pulse 错开(flow 始终 0 不错开)。
   animation-delay 逗号列表与 animation 名列表一一对应(flow, pulse)。 */
path.connection:nth-of-type(2)  { animation-delay: 0s, 0.30s; }
path.connection:nth-of-type(3)  { animation-delay: 0s, 0.60s; }
path.connection:nth-of-type(4)  { animation-delay: 0s, 0.90s; }
path.connection:nth-of-type(5)  { animation-delay: 0s, 1.20s; }
path.connection:nth-of-type(6)  { animation-delay: 0s, 1.50s; }
path.connection:nth-of-type(7)  { animation-delay: 0s, 1.80s; }
path.connection:nth-of-type(8)  { animation-delay: 0s, 2.10s; }
path.connection:nth-of-type(9)  { animation-delay: 0s, 2.40s; }
path.connection:nth-of-type(10) { animation-delay: 0s, 2.70s; }
path.connection:nth-of-type(11) { animation-delay: 0s, 3.00s; }
path.connection:nth-of-type(12) { animation-delay: 0s, 3.30s; }

/* === 3. 节点入场淡入(加载一次,依次)+ 悬停高亮 === */
g.shape {
  animation: mgm-node-enter 0.55s ease-out both;
  transition: filter 0.2s ease;
}
@keyframes mgm-node-enter {
  from { opacity: 0; }
  to   { opacity: 1; }
}
g.shape:nth-of-type(2)  { animation-delay: 0.08s; }
g.shape:nth-of-type(3)  { animation-delay: 0.16s; }
g.shape:nth-of-type(4)  { animation-delay: 0.24s; }
g.shape:nth-of-type(5)  { animation-delay: 0.32s; }
g.shape:nth-of-type(6)  { animation-delay: 0.40s; }
g.shape:nth-of-type(7)  { animation-delay: 0.48s; }
g.shape:nth-of-type(8)  { animation-delay: 0.56s; }
g.shape:nth-of-type(9)  { animation-delay: 0.64s; }
g.shape:nth-of-type(10) { animation-delay: 0.72s; }
g.shape:hover {
  filter: drop-shadow(0 0 5px var(--mgm-accent, #6366f1));
}
`;
