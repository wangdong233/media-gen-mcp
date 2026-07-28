/**
 * 嵌套架构图工具 —— 嵌套专属契约断言(S_NESTED_1..5,Phase 4)。
 *
 * buildNestedHtml 内部做(在通用 S2/S4/S9/S11 + NESTED_SIZE_CAP 之后):
 *   S_NESTED_1  HTML 含 <script type="application/json" id="mgm-manifest">(template-store 数据源)
 *   S_NESTED_2  manifest JSON 可解析 + 含 rootId + layers 数组
 *   S_NESTED_3  layers id 集合无重复 + rootId ∈ layers(数据完整性)
 *   S_NESTED_4  HTML 含 <div id="mgm-stage">(template-store swap 目标)
 *   S_NESTED_5  root 层 viewMode=diagram 时 svg 非空(README 兜底:剥 <script> 后 stage 有内容)
 *
 * 与通用 asserts 的关系:S2/S4/S9/S11/size 守"任何自包含 HTML"通用契约;
 * S_NESTED_1..5 守"嵌套产物"特有结构 —— 防 fillNestedTemplate 静默填充错位 / store 损坏 /
 * stage 缺失。任一失败抛 [nested-diagram] S_NESTED_N 前缀(handler 据此前缀路由,F13 范式)。
 *
 * License:P0-5B 自研(标准结构断言,无第三方源码引用)。
 */
import { NESTED_ERROR_PREFIX } from "./manifest-types.js";
import type { LayerSpec } from "./manifest-types.js";

/** 抛 S_NESTED 契约错(统一前缀,handler 路由用)。 */
function failNested(code: string, detail: string): never {
  throw new Error(`${NESTED_ERROR_PREFIX} ${code}: ${detail}`);
}

/**
 * S_NESTED_1..5:嵌套产物结构完整性断言。
 *
 * @param html       buildNestedHtml 产出的完整 HTML
 * @param layers     renderManifestLayers 产出的 LayerSpec[](对照真源,验 store 一致)
 * @param rootId     根 id
 */
export function assertNestedIntegrity(
  html: string,
  layers: LayerSpec[],
  rootId: string,
): void {
  // S_NESTED_1:manifest store script 块存在
  const storeMatch = html.match(
    /<script type="application\/json" id="mgm-manifest">([\s\S]*?)<\/script>/,
  );
  if (!storeMatch) {
    failNested("S_NESTED_1", "manifest JSON store <script id=\"mgm-manifest\"> missing in HTML");
  }

  // S_NESTED_2:JSON 可解析 + rootId + layers 数组
  let parsed: { rootId?: unknown; layers?: unknown };
  try {
    parsed = JSON.parse(storeMatch[1]);
  } catch (e) {
    failNested(
      "S_NESTED_2",
      `manifest store JSON not parseable: ${(e as Error)?.message ?? String(e)}`,
    );
  }
  if (typeof parsed.rootId !== "string" || parsed.rootId !== rootId) {
    failNested("S_NESTED_2", `manifest store rootId mismatch: expected ${rootId}, got ${String(parsed.rootId)}`);
  }
  if (!Array.isArray(parsed.layers)) {
    failNested("S_NESTED_2", `manifest store layers must be an array, got ${typeof parsed.layers}`);
  }

  // S_NESTED_3:store layers id 集合与渲染真源一致(无重复 + rootId ∈ layers)
  const storeLayers = parsed.layers as Array<{ id?: unknown }>;
  const storeIds = storeLayers.map((l) => l.id);
  const renderIds = layers.map((l) => l.id);
  if (storeIds.some((id) => typeof id !== "string")) {
    failNested("S_NESTED_3", "manifest store contains a layer with non-string id");
  }
  if (new Set(storeIds).size !== storeIds.length) {
    failNested("S_NESTED_3", "manifest store contains duplicate layer ids");
  }
  if (!storeIds.includes(rootId)) {
    failNested("S_NESTED_3", `manifest store rootId "${rootId}" not found in layers`);
  }
  // store 与渲染真源 id 集合一致(防 fillNestedTemplate 错位 / 部分填充)
  if (JSON.stringify(storeIds) !== JSON.stringify(renderIds)) {
    failNested(
      "S_NESTED_3",
      `manifest store layer ids diverge from rendered source: store=[${storeIds.join(",")}] vs rendered=[${renderIds.join(",")}]`,
    );
  }

  // S_NESTED_4:stage swap 目标存在
  if (!/<div\s+id="mgm-stage"/.test(html)) {
    failNested("S_NESTED_4", 'template-store swap target <div id="mgm-stage"> missing in HTML');
  }

  // S_NESTED_5:root 若是 diagram 层,stage 内联 svg 非空(README 兜底)
  const rootLayer = layers.find((l) => l.id === rootId);
  if (rootLayer && rootLayer.viewMode === "diagram") {
    if (!rootLayer.svg || !/<svg/.test(rootLayer.svg)) {
      failNested("S_NESTED_5", `root layer "${rootId}" is a diagram but its svg is empty/invalid (README fallback would show blank stage)`);
    }
    // stage 内联的 root svg 应在 HTML 里(README 剥 <script> 后仍可见)
    const stageMatch = html.match(/<div\s+id="mgm-stage">([\s\S]*?)<\/div>\s*<\/main>/);
    if (!stageMatch || !/<svg/.test(stageMatch[1])) {
      failNested("S_NESTED_5", `root svg not inlined in #mgm-stage (README fallback broken)`);
    }
  }
}
