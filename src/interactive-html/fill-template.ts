/**
 * 交互式 HTML 图 —— fillTemplate(markmap 范式,函数式 .replace 防 $& 解释)。
 *
 * 设计要点(P0-5A §3.6):
 *   - 用 .replace(pattern, callback) 而非 .replace(pattern, string),
 *     因为 callback 返回值原样使用、不被 $&/$'/$1 解释(markmap 范式)
 *   - 用户 title 必须 escapeHtml(防 XSS / 防 </title> 闭合乱)
 *   - SVG 原样填充(结构性内容,escape 会破坏 SVG)
 *   - 全局 /g regex 替换所有 __MGM_TITLE_SLOT__(模板内 <title> + <h1> 2 处)
 *   - SVG 占位符仅 1 处,无 /g 也安全(但用 callback 仍防 $& 解释)
 *
 * License:P0-5 自研(无第三方源码引用;escape + sentinel 范式为通用 web 工艺)。
 */
import { HTML_TEMPLATE, TITLE_SENTINEL, SVG_SENTINEL } from "./template.js";

/** HTML 实体 escape(用于用户输入的 title 文本,防 XSS + 防 </title> 闭合)。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 把 SVG + title 填进 HTML 模板。
 *
 * @param svg  D2 渲染出的 SVG 字符串(noXMLTag:true 已去 <?xml?>)
 * @param title  HTML <title> + <h1> 文本(用户输入)
 * @returns  完整自包含 HTML 字符串
 *
 * 不变量:同输入同输出(确定性),无 Math.random/Date.now。
 */
export function fillTemplate(opts: { svg: string; title: string }): string {
  const titleEscaped = escapeHtml(opts.title);
  // 函数式 replace:返回值原样使用,$&/$'/$1 不解释(markmap 范式)。
  // /g 全局:模板内 __MGM_TITLE_SLOT__ 出现 2 处(<title> + <h1>),都要填同一 escapeHtml(title)。
  return HTML_TEMPLATE
    .replace(new RegExp(escapeRegex(TITLE_SENTINEL), "g"), () => titleEscaped)
    .replace(new RegExp(escapeRegex(SVG_SENTINEL)), () => opts.svg);
}

/** 转义正则元字符(sentinel 是字面字符串,非正则)。 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
