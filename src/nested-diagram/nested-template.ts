/**
 * 嵌套架构图工具 —— HTML 模板(template-store + breadcrumb nav + manifest JSON slot)。
 *
 * 设计要点(方案 §3.5 / §5;对齐 interactive-html/template.ts markmap 范式):
 *   - 4 个 sentinel 占位符(独特字符串,unlikely 在用户 SVG/title/JSON 中出现)
 *   - fillNestedTemplate 用**单遍联合 regex + 函数回调**(比 fill-template.ts 顺序填充更强:
 *     单遍不重扫插入值 → 根本免疫"某 slot 的值含另一 sentinel 字面"的跨 sentinel 污染;
 *     函数回调返回值原样使用,$&/$'/$1 不解释,markmap 范式)
 *   - manifest JSON 的 `</` → `<\/` 转义:防 `</script>` 破出 `<script type="application/json">` 块
 *     (JSON.parse 解码 `\/` → `/`,viewer 侧无损;producer 可能在 label 注 `</script>` 文本)
 *   - 零外链 <script src=,守 S2;确定性(无 Math.random/Date.now)
 *
 * 占位符(4 sentinel):
 *   __MGM_NESTED_TITLE_SLOT__     HTML <title> + <h1>(escapeHtml 后填充,2 处)
 *   __MGM_NESTED_ROOT_SVG_SLOT__  <main> 内 stage 初始 root SVG(README 兜底:剥 <script> 仍可见 root)
 *   __MGM_NESTED_MANIFEST_SLOT__  <script type="application/json"> 内 LayerSpec store(template-store 数据源)
 *   __MGM_NESTED_VIEWER_SLOT__    <script> 内 VIEWER_NESTED_JS IIFE
 *
 * License:P0-5B 自研(无第三方源码引用;模板/sentinel/单遍填充为通用 web 工艺)。
 */
import { VIEWER_CSS_VARS, PREPAINT_RESOLVER_JS } from "../interactive-html/theme.js";
import { MOTION_GOVERNOR_CSS } from "../interactive-html/motion-governor.js";
import { ANIMATIONS_CSS } from "../interactive-html/animations.js";
import { escapeHtml } from "../interactive-html/fill-template.js";
import type { LayerSpec } from "./manifest-types.js";

/** 嵌套 HTML 体积上限(与单图 256KB 解耦;方案 §6.2 钉 1MB 起步,可按 B4 回测收紧)。 */
export const NESTED_SIZE_CAP = 1 * 1024 * 1024;

/** 标题 + SVG + JSON + viewer 占位符 sentinel(与 fillNestedTemplate 共享)。 */
export const NESTED_TITLE_SENTINEL = "__MGM_NESTED_TITLE_SLOT__";
export const NESTED_ROOT_SVG_SENTINEL = "__MGM_NESTED_ROOT_SVG_SLOT__";
export const NESTED_MANIFEST_SENTINEL = "__MGM_NESTED_MANIFEST_SLOT__";
export const NESTED_VIEWER_SENTINEL = "__MGM_NESTED_VIEWER_SLOT__";

/**
 * 布局 CSS(toolbar / viewer / stage 复用 viewer-min 范式 ~85 行 + 嵌套专属 breadcrumb / container-list /
 * 卡片 / up 按钮 ~50 行)。与 template.ts LAYOUT_CSS 的文本重复是 byte-identical 红线代价(01 §3.2
 * duplication > wrong abstraction:抽 viewer-core factory 须改 viewer-min 源码 → Tier 2)。
 */
const NESTED_LAYOUT_CSS = `
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
.mgm-actions button:hover:not(:disabled) { background: var(--mgm-btn-hover-bg); }
.mgm-actions button:focus-visible { outline: 2px solid var(--mgm-accent); outline-offset: 1px; }
.mgm-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
#mgm-btn-up { font-weight: 700; }
/* breadcrumb(supplement navigation,3+ 级才有价值;单层 display:none) */
.mgm-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.35rem 0.75rem;
  background: var(--mgm-bg-elevated);
  border-bottom: 1px solid var(--mgm-toolbar-border);
  font-size: 0.85rem;
  flex-shrink: 0;
}
.mgm-crumb {
  background: transparent;
  border: none;
  color: var(--mgm-accent);
  font: inherit;
  font-size: 0.85rem;
  padding: 0.1rem 0.3rem;
  cursor: pointer;
  border-radius: 4px;
}
.mgm-crumb:hover { background: var(--mgm-btn-hover-bg); }
.mgm-crumb:focus-visible { outline: 2px solid var(--mgm-accent); outline-offset: 1px; }
.mgm-crumb-current { color: var(--mgm-fg); font-weight: 600; padding: 0.1rem 0.3rem; }
.mgm-crumb-sep { color: var(--mgm-fg-muted); }
.mgm-crumb-ellipsis { color: var(--mgm-fg-muted); padding: 0 0.2rem; }
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
#mgm-stage svg { display: block; max-width: none; height: auto; }
/* 可下钻节点视觉信号(viewer-stack markDrillable 注入 ▾ 角标 + class)—— 解决"看不出能点" */
#mgm-stage a[href^="drill:"] { cursor: pointer; }
#mgm-stage a[href^="drill:"]:hover { filter: drop-shadow(0 0 6px var(--mgm-accent)); }
.mgm-drill-mark { fill: var(--mgm-accent); font-size: 13px; font-weight: bold; pointer-events: none; }
/* container-list:分组容器层(diagram=""),显示 children 卡片 */
.mgm-container-list { max-width: 900px; margin: 0 auto; padding: 1rem 0; }
.mgm-container-placeholder { color: var(--mgm-fg-muted); margin: 0 0 1rem; font-size: 0.9rem; }
.mgm-child-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
.mgm-child-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: var(--mgm-btn-bg);
  border: 1px solid var(--mgm-btn-border);
  border-radius: 8px;
  padding: 0.85rem 1rem;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mgm-child-card:hover {
  border-color: var(--mgm-accent);
  box-shadow: var(--mgm-shadow);
}
.mgm-child-card:focus-visible { outline: 2px solid var(--mgm-accent); outline-offset: 2px; }
.mgm-card-title { color: var(--mgm-fg); font-weight: 600; }
.mgm-card-hint { color: var(--mgm-fg-muted); font-size: 0.78rem; }
.mgm-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 640px) {
  .mgm-toolbar { padding: 0.4rem 0.5rem; gap: 0.25rem; }
  .mgm-toolbar h1 { font-size: 0.9rem; }
  .mgm-actions button { padding: 0.2rem 0.45rem; font-size: 0.78rem; }
  .mgm-child-cards { grid-template-columns: 1fr; }
}
`;

/** 完整 HTML 模板(4 sentinel 待 fillNestedTemplate 单遍填充)。 */
export const NESTED_HTML_TEMPLATE = `<!doctype html>
<html lang="en" data-theme="auto" data-motion="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__MGM_NESTED_TITLE_SLOT__</title>
<script>
${PREPAINT_RESOLVER_JS}
</script>
<style>
${VIEWER_CSS_VARS}
${NESTED_LAYOUT_CSS}
${ANIMATIONS_CSS}
${MOTION_GOVERNOR_CSS}
</style>
</head>
<body>
<header class="mgm-toolbar">
<h1>__MGM_NESTED_TITLE_SLOT__</h1>
<div class="mgm-actions">
<button id="mgm-btn-up" type="button" aria-label="返回上一层" title="返回上一层 (Esc)" disabled>&#8593;</button>
<button id="mgm-btn-theme" type="button" aria-label="切换主题" title="切换主题:auto / light / dark">Theme: Auto</button>
<button id="mgm-btn-motion" type="button" aria-label="切换动画" title="切换动画">Motion: On</button>
<button id="mgm-btn-zoom-out" type="button" aria-label="缩小" title="缩小">&minus;</button>
<button id="mgm-btn-zoom-reset" type="button" aria-label="重置视图" title="重置缩放与平移">&#8634;</button>
<button id="mgm-btn-zoom-in" type="button" aria-label="放大" title="放大">+</button>
<button id="mgm-btn-export-svg" type="button" aria-label="导出当前层 SVG" title="下载当前层 SVG 文件">SVG</button>
</div>
</header>
<nav class="mgm-breadcrumb" id="mgm-breadcrumb" aria-label="层级导航"></nav>
<main id="mgm-viewer">
<div id="mgm-stage">
__MGM_NESTED_ROOT_SVG_SLOT__
</div>
</main>
<div id="mgm-aria-live" role="status" aria-live="polite" class="mgm-visually-hidden"></div>
<script type="application/json" id="mgm-manifest">__MGM_NESTED_MANIFEST_SLOT__</script>
<script>
__MGM_NESTED_VIEWER_SLOT__
</script>
</body>
</html>
`;

/** 转义正则元字符(sentinel 是字面字符串,非正则)。 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把 title + rootSvg + manifest JSON + viewer JS 填进嵌套 HTML 模板(单遍联合 regex)。
 *
 * @param opts.title      HTML <title> + <h1>(manifest.label,已 escapeHtml 前缀由调用方决;本函数再 escape 一次兜底)
 * @param opts.rootSvg    root 层 D2 SVG 字符串(stage 初始内联,README 兜底)
 * @param opts.rootId     manifest 根 id(viewer 起点 + URL hash 起点)
 * @param opts.layers     LayerSpec[](DFS 先序,template-store 数据源)
 * @param opts.viewerJs   VIEWER_NESTED_JS IIFE 字符串
 * @returns               完整自包含 HTML 字符串
 *
 * 不变量:同输入同输出(确定性),无 Math.random/Date.now。
 */
export function fillNestedTemplate(opts: {
  title: string;
  rootSvg: string;
  rootId: string;
  layers: LayerSpec[];
  viewerJs: string;
}): string {
  // F11(信任边界):title 是 producer 文本,含 sentinel 字面 → 几乎必是误用;入口拒(防奇怪标题)
  const titleRaw = opts.title;
  const sentinels = [
    NESTED_TITLE_SENTINEL,
    NESTED_ROOT_SVG_SENTINEL,
    NESTED_MANIFEST_SENTINEL,
    NESTED_VIEWER_SENTINEL,
  ];
  for (const s of sentinels) {
    if (titleRaw.includes(s)) {
      throw new Error(
        `[nested-diagram] title must not contain reserved sentinel strings; found "${s}" in title.`,
      );
    }
  }
  const titleEscaped = escapeHtml(titleRaw);

  // manifest JSON:`</` → `<\/` 转义防 `</script>` 破出 script 块(producer 可能在 label 注该文本)
  const manifestJson = JSON.stringify({ rootId: opts.rootId, layers: opts.layers }).replace(
    /<\//g,
    () => "<\\/",
  );

  // 单遍联合 regex:4 sentinel 一次性匹配,函数回调按 sentinel 名返回对应值。
  // 比 fill-template.ts 顺序填充更强:.replace 不重扫插入值 → 免疫"某 slot 值含另一 sentinel 字面"的
  // 跨 sentinel 污染(即便 rootSvg/manifestJson 含某 sentinel 字面,也只在其原 match 位被替换一次,
  // 插入值不被二次扫描)。函数回调返回值原样使用,$& 不解释(markmap 范式)。
  const valueFor: Record<string, () => string> = {
    [NESTED_TITLE_SENTINEL]: () => titleEscaped,
    [NESTED_ROOT_SVG_SENTINEL]: () => opts.rootSvg,
    [NESTED_MANIFEST_SENTINEL]: () => manifestJson,
    [NESTED_VIEWER_SENTINEL]: () => opts.viewerJs,
  };
  const pattern = new RegExp(sentinels.map(escapeRegex).join("|"), "g");
  return NESTED_HTML_TEMPLATE.replace(pattern, (match) => valueFor[match]());
}
