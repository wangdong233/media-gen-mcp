/**
 * P0-3 Golden 配置 —— 单一真相源(刷新器 render-golden.mjs 与验证器 golden.test.ts 共享)。
 *
 * 设计与 Archify 范式对偶:同一份 GOLDEN 数组,刷新器写 expected/、验证器读 expected/。
 * 任何新增本地确定性工具的 golden 用例,**只能**在此数组追加,不允许测试文件里另起。
 *
 * 当前覆盖(P0-3 范围 6 工具 + 1 skip):
 *   - qrcode      SVG / PNG(qr-png-verify:byte + jsQR 双校验)
 *   - formula     SVG(R-01:preNormalize 抹 MathJax MJX-N- 自增计数器)
 *   - chart       SVG(Vega;open_point 1 实证 byte-stable)
 *   - card        SVG(强制 fontFamily:"Noto Sans SC" → isCjkFamily 命中 → 0 fetch;无 emoji 避开 twemoji CDN)
 *   - render_svg  SVG passthrough(完全确定;input==output)
 *   - diagram     SVG(D2/Graphviz;macOS 本地刷新,CI Linux 校验 open_point 2)
 *   - generate_icon skip(依赖 Iconify API,byte 不稳定)
 *
 * License:本文件为 P0-3 自研(数据结构 + 配置,无第三方源码引用)。
 */

export type CompareStrategy = "svg-byte" | "png-byte" | "qr-png-verify";
export type GoldenTool = "qrcode" | "formula" | "chart" | "card" | "render_svg" | "diagram";

export interface GoldenCase {
  /** 唯一 id,用于 describe/test name。 */
  id: string;
  tool: GoldenTool;
  /** 相对 test/golden/fixtures/ 的 fixture 路径。 */
  fixturePath: string;
  /** 相对 test/golden/expected/ 的 expected 路径。 */
  expectedPath: string;
  compareStrategy: CompareStrategy;
  /** 若设置,测试 it.skip 并打印原因(icon 网络依赖、跨平台 byte 不一致等)。 */
  skipReason?: string;
  /**
   * R-01:可选 SVG 预规范化钩子。
   * formula 用例必设(抹 MJX-N-);其它 case 留 undefined → compareSvg 内部默认走 normalizeMathJaxIds(no-op 安全)。
   */
  preNormalize?: (svg: string) => string;
}

/**
 * 抹 MathJax SVG 内部自增计数器(R-01;src/formula.ts:23-35 lazy singleton 状态)。
 * 必须与 test/golden/helpers.ts 的 normalizeMathJaxIds 等价(本文件单独定义避免循环依赖)。
 */
const normMathJax = (s: string): string => s.replace(/MJX-\d+-/g, "MJX-N-");

export const GOLDEN: GoldenCase[] = [
  // ── QR(最确定,优先做)──
  { id: "qr-basic-svg", tool: "qrcode", fixturePath: "qr/basic.txt", expectedPath: "qr/basic.svg", compareStrategy: "svg-byte" },
  { id: "qr-url-png", tool: "qrcode", fixturePath: "qr/url.json", expectedPath: "qr/url.png", compareStrategy: "qr-png-verify" },

  // ── formula(MathJax;R-01:必设 preNormalize 抹 MJX-N- 自增计数器)──
  {
    id: "formula-basic-svg",
    tool: "formula",
    fixturePath: "formula/basic.tex",
    expectedPath: "formula/basic.svg",
    compareStrategy: "svg-byte",
    preNormalize: normMathJax,
  },

  // ── chart(Vega,open_point 1 实证 byte-stable)──
  { id: "chart-bar-svg", tool: "chart", fixturePath: "chart/bar-basic.json", expectedPath: "chart/bar-basic.svg", compareStrategy: "svg-byte" },

  // ── card(限定 CJK family + 无 emoji;open_point 7 实证 0 fetch + 跨进程 byte-identical)──
  { id: "card-cjk-svg", tool: "card", fixturePath: "card/cjk-og.json", expectedPath: "card/cjk-og.svg", compareStrategy: "svg-byte" },

  // ── render_svg passthrough(完全确定;input==output)──
  { id: "rsvg-passthrough-svg", tool: "render_svg", fixturePath: "render-svg/passthrough.svg", expectedPath: "render-svg/passthrough.svg", compareStrategy: "svg-byte" },

  // ── diagram D2/Graphviz(跨平台 byte 校验:open_point 2 在 CI Linux 首跑闭环;
  //    若 CI 红 → 加 skipReason,延后 P0-4 pHash;绝不宽容 diff)──
  { id: "diagram-d2-svg", tool: "diagram", fixturePath: "diagram/d2-basic.d2", expectedPath: "diagram/d2-basic.svg", compareStrategy: "svg-byte" },
  { id: "diagram-graphviz-svg", tool: "diagram", fixturePath: "diagram/graphviz-basic.dot", expectedPath: "diagram/graphviz-basic.svg", compareStrategy: "svg-byte" },

  // ── icon:网络依赖(Iconify API),P0-3 skip;待 P0-4 mock fetch 后覆盖 ──
  // 注:fixturePath/expectedPath 留空(skipReason case 不渲染、不读盘);tool 用 render_svg 占位。
  {
    id: "icon-skip",
    tool: "render_svg",
    fixturePath: "",
    expectedPath: "",
    compareStrategy: "svg-byte",
    skipReason: "generate_icon 依赖 Iconify API(网络),byte 不稳定;待 P0-4 mock fetch 后覆盖",
  },
];
