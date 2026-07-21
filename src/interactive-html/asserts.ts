/**
 * 交互式 HTML 图 —— 5 个契约断言助手(P0-5A §4.3 / §6.1)。
 *
 * 在 renderer 内部做契约 asserts(S2/S6/S9/S11 + S4 dual-palette);
 * handler 拿到的 result 已经过断言,跳过 assertOutputClean(P0-4 守 raster/vector,HTML 不属其责域)。
 *
 *   assertSelfContained(html)       S2 无外链 <script src=,允许 data: URI
 *   assertNoXmlDecl(html)           S11 无 <?xml?(C2 防线)
 *   assertDualPalette(html)         S4 含 @media (prefers-color-scheme: dark)(仅 darkTheme 传时)
 *   assertMotionGovernor(html)      S9 含 prefers-reduced-motion: reduce + data-motion="still"
 *   assertSizeUnder(html, max)      S6 byte 长度 ≤ max(默认 256KB)
 *
 * License:P0-5 自研(标准 web 契约检查,无第三方源码引用)。
 */

/**
 * S2:产物单文件自包含 —— 禁外链 <script src=,禁外链 <link rel="stylesheet" href="http...">。
 * 允许 data: URI 内联(用户不引外部 CDN 时离线可看)。
 *
 * 注:本断言保护"零依赖可看"的核心契约;允许 data: 是因为 <link rel="stylesheet" href="data:...">
 * 也是自包含。
 */
export function assertSelfContained(html: string): void {
  // <script src="...">(任何 src,无论 http/https/data,都视为外链依赖;inline <script> 是允许的)
  const scriptSrc = /<script\b[^>]*\bsrc\s*=/.test(html);
  if (scriptSrc) {
    throw new Error(`S2 self-contained contract violated: <script src= detected. All JS must be inline.`);
  }
  // <link rel="stylesheet" href="http..." / "https..."> 外链样式表拒
  const externalLink = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*\bhref\s*=\s*["'](?:https?:|\/\/)/i.test(html);
  if (externalLink) {
    throw new Error(`S2 self-contained contract violated: external stylesheet <link> detected. Use inline <style> or data: URI.`);
  }
}

/**
 * S11:HTML 内联 SVG 无 <?xml?> 声明(C2 防线)。
 *
 * 浏览器解析 HTML 时遇到 <?xml?> 会作为异常 comment 处理,
 * 但更关键的是干扰 byte-identical 断言与 D2 SVG 嵌入位置稳定性。
 */
export function assertNoXmlDecl(html: string): void {
  if (/<\?xml/.test(html)) {
    throw new Error(`S11 no-xml-decl contract violated: "<?xml" detected in HTML. D2 must be called with noXMLTag:true.`);
  }
}

/**
 * S4:D2 SVG 双调色板注入(darkTheme 传时)。
 *
 * D2 darkThemeID 字段会在 SVG <style> 内注入 @media screen and (prefers-color-scheme:dark) {...}
 * 覆盖规则(实测 D2 WASM v0.7.0-HEAD 行为,2026-07-22 Step 1.2.5 实证;open_point #6 解决),
 * GitHub README 嵌入时浏览器自动跟随系统主题,无需 JS。
 *
 * 正则宽松(接受多种 @media 形式):
 *   - D2 WASM 实际产出:`@media screen and (prefers-color-scheme:dark){...}`
 *   - 标准 CSS:`@media (prefers-color-scheme: dark){...}`
 *   - 关键信号:`prefers-color-scheme:` 后跟 `dark`(在 @media 媒体查询内)
 *
 * 若此断言失败 → 降级预案(P0-5A §3.3):D2 WASM 不注入 → 自研 CSS 变量双主题方案。
 */
export function assertDualPalette(html: string): void {
  // matches "@media ... prefers-color-scheme: dark" (D2 form: "@media screen and (prefers-color-scheme:dark)")
  if (!/@media[^{]*prefers-color-scheme\s*:\s*dark\b/.test(html)) {
    throw new Error(`S4 dual-palette contract violated: @media ... prefers-color-scheme:dark not found in HTML/SVG. D2 darkThemeID may not have injected the dark palette.`);
  }
}

/**
 * S9:prefers-reduced-motion 无障碍兼容(Motion Governor 必含规则)。
 *
 * 用户系统设了"减少动画"偏好时,所有 animation/transition 强制 none。
 */
export function assertMotionGovernor(html: string): void {
  if (!/prefers-reduced-motion\s*:\s*reduce/.test(html)) {
    throw new Error(`S9 motion-governor contract violated: @media (prefers-reduced-motion: reduce) rule missing.`);
  }
  if (!/data-motion\s*=\s*["']still["']/.test(html)) {
    throw new Error(`S9 motion-governor contract violated: [data-motion="still"] selector missing.`);
  }
}

/**
 * S6:HTML 体积上限(防 Tier 2 mermaid ~2.8MB 内联膨胀)。
 *
 * MVP 默认 256KB;超即抛(产物已生成但断言失败,renderer 调用方拿不到)。
 *
 * @param maxBytes  默认 256 * 1024
 */
export function assertSizeUnder(html: string, maxBytes: number = 256 * 1024): void {
  const bytes = Buffer.byteLength(html, "utf-8");
  if (bytes > maxBytes) {
    throw new Error(`S6 size contract violated: HTML is ${bytes} bytes > ${maxBytes} bytes (${(bytes / 1024).toFixed(1)}KB). Reduce SVG complexity or inline fewer assets.`);
  }
}
