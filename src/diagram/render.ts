import type { DiagramEngine } from "./types.js";
import { D2Engine } from "./d2.js";

/**
 * Diagram 引擎注册表 + 调度。
 * P0:只 D2(WASM,恒可用)。mermaid / graphviz 后续按需加(各实现 DiagramEngine)。
 */
const d2 = new D2Engine();

/** 获取 diagram 引擎。P0 只 D2。 */
export function getDiagramEngine(name?: string): DiagramEngine | undefined {
  if (!name || name === "d2") return d2;
  return undefined; // mermaid/graphviz 后续
}

export function listDiagramEngines(): DiagramEngine[] {
  return [d2];
}
