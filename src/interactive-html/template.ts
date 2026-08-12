/**
 * 交互式 HTML 图 —— HTML 模板(markmap 范式,sentinel 占位符)。
 *
 * 设计要点(P0-5A §3.6):
 *   - 用独特 sentinel 字符串作占位符( unlikely 在用户 SVG/title 中出现)
 *   - fillTemplate 用函数式 .replace(callback),replacement 函数返回值原样使用,
 *     防 $&/$'/$1 被解释为 replacement pattern(markmap 范式)
 *   - 零外链 <script src=,守 S2;允许 <link rel="stylesheet" data: URI(MVP 默认不引)
 *   - 模板内无 Math.random/Date.now,确定性
 *
 * 占位符:
 *   __MGM_TITLE_SLOT__  —— HTML <title> + <h1>(escapeHtml 后填充,2 处)
 *   __MGM_SVG_SLOT__    —— <main> 内的 SVG(原样填充,不 escape)
 *
 * License:P0-5 自研(无第三方源码引用;模板为通用 web 工艺)。
 */
import { VIEWER_CSS_VARS, PREPAINT_RESOLVER_JS } from "./theme.js";
import { MOTION_GOVERNOR_CSS } from "./motion-governor.js";
import { ANIMATIONS_CSS } from "./animations.js";
import { VIEWER_MIN_JS } from "./viewer-min.js";

/**
 * 单文件自包含 HTML 模板。
 *
 * 结构:
 *   <!doctype html>
 *   <html data-theme="auto" data-motion="auto">  // pre-paint resolver 立即覆盖
 *     <head>
 *       <meta charset> <meta viewport>
 *       <title>__MGM_TITLE_SLOT__</title>
 *       <script> PREPAINT_RESOLVER_JS </script>   // 防 FOUC,head 最早
 *       <style> VIEWER_CSS_VARS + MOTION_GOVERNOR_CSS + LAYOUT_CSS </style>
 *     </head>
 *     <body>
 *       <header class="mgm-toolbar"> ... <h1>__MGM_TITLE_SLOT__</h1> ... buttons ... </header>
 *       <main id="mgm-viewer"> <div id="mgm-stage"> __MGM_SVG_SLOT__ </div> </main>
 *       <script> VIEWER_MIN_JS </script>
 *     </body>
 *   </html>
 *
 * 注:XML 声明 <?xml?> 绝不出现在 HTML 中 —— D2 SVG 通过 noXMLTag:true 去,
 * viewer export SVG 用 XMLSerializer(默认不加 xml decl),源码字符串字面量里也无 <?xml。
 */
const LAYOUT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--mgm-bg);
  color: var(--mgm-fg);
  font-family: "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mgm-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--mgm-toolbar-bg);
  border-bottom: 1px solid var(--mgm-toolbar-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.mgm-toolbar h1 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--mgm-fg);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mgm-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.mgm-actions button {
  background: var(--mgm-btn-bg);
  color: var(--mgm-btn-fg);
  border: 1px solid var(--mgm-btn-border);
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}
.mgm-actions button:hover {
  background: var(--mgm-btn-hover-bg);
}
.mgm-actions button:focus-visible {
  outline: 2px solid var(--mgm-accent);
  outline-offset: 1px;
}
#mgm-viewer {
  flex: 1 1 auto;
  overflow: auto;
  position: relative;
  background: var(--mgm-stage-bg);
  cursor: grab;
  touch-action: none;
}
#mgm-viewer.mgm-dragging { cursor: grabbing; }
#mgm-stage {
  transform-origin: 0 0;
  transition: transform 0.12s ease-out;
  display: inline-block;
  padding: 1.5rem;
  min-width: 100%;
  min-height: 100%;
}
#mgm-stage svg {
  display: block;
  max-width: none;
  height: auto;
}
@media (max-width: 640px) {
  .mgm-toolbar { padding: 0.4rem 0.5rem; gap: 0.25rem; }
  .mgm-toolbar h1 { font-size: 0.9rem; }
  .mgm-actions button { padding: 0.2rem 0.45rem; font-size: 0.78rem; }
}
`;

/** 完整 HTML 模板(sentinel 待 fillTemplate 替换)。 */
export const HTML_TEMPLATE = `<!doctype html>
<html lang="en" data-theme="auto" data-motion="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__MGM_TITLE_SLOT__</title>
<script>
${PREPAINT_RESOLVER_JS}
</script>
<style>
${VIEWER_CSS_VARS}
${LAYOUT_CSS}
${ANIMATIONS_CSS}
${MOTION_GOVERNOR_CSS}
</style>
</head>
<body>
<header class="mgm-toolbar">
<h1>__MGM_TITLE_SLOT__</h1>
<div class="mgm-actions">
<button id="mgm-btn-theme" type="button" aria-label="Toggle theme" title="Cycle theme: auto / light / dark">Theme: Auto</button>
<button id="mgm-btn-motion" type="button" aria-label="Toggle motion" title="Toggle animations">Motion: On</button>
<button id="mgm-btn-zoom-out" type="button" aria-label="Zoom out" title="Zoom out">&minus;</button>
<button id="mgm-btn-zoom-reset" type="button" aria-label="Reset view" title="Reset zoom and pan">&#8634;</button>
<button id="mgm-btn-zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
<button id="mgm-btn-export-svg" type="button" aria-label="Export SVG" title="Download SVG file">SVG</button>
</div>
</header>
<main id="mgm-viewer">
<div id="mgm-stage">
__MGM_SVG_SLOT__
</div>
</main>
<script>
${VIEWER_MIN_JS}
</script>
</body>
</html>
`;

/** 标题 + SVG 占位符 sentinel(与 fill-template.ts 共享)。 */
export const TITLE_SENTINEL = "__MGM_TITLE_SLOT__";
export const SVG_SENTINEL = "__MGM_SVG_SLOT__";
