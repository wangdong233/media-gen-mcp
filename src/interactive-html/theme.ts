/**
 * 交互式 HTML 图 —— viewer 外观主题(CSS 变量 + pre-paint resolver)。
 *
 * 三层主题分工(P0-5A §3.3):
 *   1. D2 SVG 自带双调色板(C1 darkThemeID 注入 @media prefers-color-scheme)
 *      —— GitHub README 嵌入时浏览器自动跟随系统主题,无需 JS,viewer 不掺和。
 *   2. viewer 外观主题(toolbar / 背景 / 按钮)= 本文件 ~30 CSS 变量。
 *   3. pre-paint resolver script(防 FOUC):URLSearchParams(?theme=) > localStorage >
 *      prefers-color-scheme > 默认 auto,在 <body> 渲染前同步设 data-theme。
 *
 * 不变量(P0-5A §3.3):viewer 主题切换**绝不重渲染 SVG、绝不重算几何**(S3 实现基础)。
 * 切换只翻 [data-theme] 属性,CSS 变量级联,SVG 几何 byte-identical。
 *
 * License:P0-5 自研(无第三方源码引用;CSS 变量范式为通用 web 工艺)。
 */

/**
 * ~30 个 viewer 外观 CSS 变量(light 默认 + [data-theme="dark"] 覆盖)。
 * D2 SVG 内的 shape 配色由 D2 自己管(darkThemeID),不在此处覆盖。
 */
export const VIEWER_CSS_VARS = `
:root, html[data-theme="light"] {
  --mgm-bg: #ffffff;
  --mgm-bg-elevated: #f8fafc;
  --mgm-fg: #0f172a;
  --mgm-fg-muted: #475569;
  --mgm-toolbar-bg: #f1f5f9;
  --mgm-toolbar-border: #e2e8f0;
  --mgm-btn-bg: #ffffff;
  --mgm-btn-fg: #334155;
  --mgm-btn-border: #cbd5e1;
  --mgm-btn-hover-bg: #f1f5f9;
  --mgm-accent: #0d9488;
  --mgm-accent-fg: #ffffff;
  --mgm-focus-ring: rgba(13, 148, 136, 0.4);
  --mgm-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04);
  --mgm-stage-bg: #ffffff;
  --mgm-stage-border: #e2e8f0;
}
html[data-theme="dark"] {
  --mgm-bg: #0f172a;
  --mgm-bg-elevated: #1e293b;
  --mgm-fg: #f8fafc;
  --mgm-fg-muted: #94a3b8;
  --mgm-toolbar-bg: #1e293b;
  --mgm-toolbar-border: #334155;
  --mgm-btn-bg: #334155;
  --mgm-btn-fg: #f1f5f9;
  --mgm-btn-border: #475569;
  --mgm-btn-hover-bg: #475569;
  --mgm-accent: #2dd4bf;
  --mgm-accent-fg: #042f2e;
  --mgm-focus-ring: rgba(45, 212, 191, 0.5);
  --mgm-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
  --mgm-stage-bg: #0f172a;
  --mgm-stage-border: #334155;
}
`;

/**
 * Pre-paint resolver:在首次绘制前同步设 data-theme / data-motion,防 FOUC。
 * 必须在 <head> 最早执行(早于任何 <style> 应用到 body 之前)。
 *
 * 优先级(URL > localStorage > prefers-color-scheme > 默认 auto):
 *   1. ?theme=auto|light|dark   ?motion=auto|still
 *   2. localStorage["mgm-theme"] / ["mgm-motion"]
 *   3. prefers-color-scheme: dark(仅 theme,自动模式时解析为 dark/light)
 *   4. 默认 auto
 *
 * wrapped in try/catch:localStorage 在某些嵌入环境(GitHub README iframe、CSP 严格)会抛。
 */
export const PREPAINT_RESOLVER_JS = `(function(){
  try {
    var params = new URLSearchParams(location.search);
    var storedTheme = null, storedMotion = null;
    try { storedTheme = localStorage.getItem('mgm-theme'); } catch(e){}
    try { storedMotion = localStorage.getItem('mgm-motion'); } catch(e){}
    var themePref = params.get('theme') || storedTheme || 'auto';
    if (themePref !== 'auto' && themePref !== 'light' && themePref !== 'dark') themePref = 'auto';
    var resolved = themePref;
    if (themePref === 'auto') {
      try {
        resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      } catch(e) { resolved = 'light'; }
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = themePref;
    var motionPref = params.get('motion') || storedMotion || 'auto';
    if (motionPref !== 'auto' && motionPref !== 'still') motionPref = 'auto';
    document.documentElement.dataset.motion = motionPref;
  } catch(e) {
    try { document.documentElement.dataset.theme = 'light'; } catch(_){}
  }
})();`;
