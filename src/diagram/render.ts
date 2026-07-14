import type { DiagramEngine } from "./types.js";
import { D2Engine } from "./d2.js";
import { GraphvizEngine } from "./graphviz.js";

/**
 * Diagram 引擎注册表 + 调度。
 * d2(@terrastruct/d2 WASM,恒可用)+ graphviz(@viz-js/viz WASM)。
 *
 * mermaid:经深度调研(官方 mermaid 需 DOM;jsdom 方案污染全局且对长驻 MCP 进程有风险;
 * 无纯 WASM mermaid;连 mermaid-isomorphic@3 也强依赖 playwright/Chromium),**进程内不可行**。
 * 故 engine 枚举保留 mermaid(可发现性),但 getDiagramEngine 返回 undefined,
 * 由 index.ts handler 给出清晰错误 + 推荐 d2/graphviz(见 MERMAID_UNSUPPORTED_MSG)。
 */
const d2 = new D2Engine();
const graphviz = new GraphvizEngine();

/** mermaid 不可用时返回给用户的说明 + 替代方案。 */
export const MERMAID_UNSUPPORTED_MSG =
  "mermaid 引擎在进程内不可用(需浏览器/Chromium 或污染全局的 jsdom,不适合本确定性 MCP)。" +
  "请用 d2(覆盖 flowchart/sequence/class/er/mindmap,默认引擎)或 graphviz(DOT 语言)。";

/** 获取 diagram 引擎。 */
export function getDiagramEngine(name?: string): DiagramEngine | undefined {
  if (!name || name === "d2") return d2;
  if (name === "graphviz") return graphviz;
  return undefined; // mermaid 等交 handler 给清晰提示
}

export function listDiagramEngines(): DiagramEngine[] {
  return [d2, graphviz];
}
