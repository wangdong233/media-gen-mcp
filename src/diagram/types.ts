/**
 * Diagram 引擎抽象层(与 MediaProvider 平行、独立)。
 *
 * 设计:本地确定性渲染(DSL 文本 → SVG/PNG),不走网络、不需 apiKey、同步。
 * CC 的 Claude 生成 DSL 代码 → MCP 接收 DSL 渲染 → 返回本地文件路径。
 */

export type DiagramEngineName = "d2" | "mermaid" | "graphviz";
export type DiagramFormat = "svg" | "png";

export interface DiagramRequest {
  /** DSL 源码(D2/Mermaid/Graphviz 代码),必填。由 CC 的 Claude 生成。 */
  code: string;
  /** 渲染引擎;省略 = 自动探测(优先 d2 WASM)。 */
  engine?: DiagramEngineName;
  /** 输出格式;默认 svg(矢量高清)。 */
  format?: DiagramFormat;
  /** 主题(d2 支持主题)。 */
  theme?: string;
  /** 图表类型(信息性:flowchart/sequence/class/architecture...)。 */
  diagramType?: string;
  /** 落盘目录;省略用 config.outDir。 */
  outDir?: string;
  /** 文件名(不含扩展名);省略自动命名。 */
  name?: string;
  /**
   * 深色主题(d2 专属;interactive-html 用,graphviz 忽略)。
   * 传了才触发 D2 SVG 内联 @media (prefers-color-scheme: dark) 双调色板,
   * GitHub README 嵌入时浏览器自动跟随系统主题。
   */
  darkTheme?: string;
  /**
   * 去 <?xml?> 声明(interactive-html 专属;HTML 内联 SVG 必传 true,否则浏览器解析错乱)。
   * 传到 D2 RenderOptions.noXMLTag。
   */
  noXMLTag?: boolean;
  /**
   * 固定 salt(interactive-html 专属;多图嵌入同 HTML 防 SVG ID 冲突,作零成本确定性防御)。
   * 传到 D2 RenderOptions.salt,会附加到 SVG 内部 ID 后缀。
   */
  salt?: string;
}

export interface DiagramRenderOutput {
  svg: string;
  png?: Buffer;
}

export interface DiagramResult {
  engine: DiagramEngineName;
  format: DiagramFormat;
  /** 本地绝对路径,CC 用 Read 查看。 */
  localPath: string;
}

/** 每个引擎实现此接口。渲染在本地、确定性。 */
export interface DiagramEngine {
  readonly name: DiagramEngineName;
  isAvailable(): boolean;
  listTypes(): string[];
  render(req: DiagramRequest): Promise<DiagramRenderOutput>;
}
