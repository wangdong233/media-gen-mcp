/**
 * 嵌套架构图工具 —— manifest 数据契约类型(P0-5B §4 / 方案 §3.4)。
 *
 * 设计原则(01 §3 抽象纪律 + 03 §1.2 数据逻辑):
 *   - manifest = 把当前 InteractiveDiagramRequest(叶子)递归包成树,每节点 = 一个抽象层
 *   - 必填字段只有 3 个(id / label / diagram),其余选填 + 智能缺省
 *   - diagram 空串 = 显式"仅分组容器"(container-list viewMode),非漏字段
 *   - 全部禁 null(只允许 undefined 或有值,简化契约到二态)
 *   - 不为假想未来加字段(Y1-Y10 拒绝清单,见 manifest-schema与示例.md §5)
 *
 * 这是 producer 契约(Claude / 架构师写);LayerSpec 是 viewer 契约(buildNestedHtml 转换后)。
 * 两者 shape 不同,转换契约钉死在方案报告 §3.4(ManifestNode ↔ LayerSpec 表)。
 *
 * License:P0-5B 自研(类型定义,无第三方源码引用)。
 */

/**
 * 图类型闭环 enum(01 §2.5 刻度四:概念完整性)。
 * 新加类型须显式 PR(改这里 + DIAGRAM_TYPES + inputSchema enum + check-error-text)。
 */
export type DiagramType =
  | "architecture" // 组件/模块拓扑(默认,最常见)
  | "sequence" // 时序(方法/进程交互)
  | "er" // 实体关系(数据模型)
  | "class" // 类图(继承/组合)
  | "flowchart"; // 流程/状态机

/** DiagramType 闭环值数组(运行时 enum 校验用,V4)。与 type 联合同源,改时同步。 */
export const DIAGRAM_TYPES: readonly DiagramType[] = [
  "architecture",
  "sequence",
  "er",
  "class",
  "flowchart",
];

/** diagramType 缺省值(V4:producer 省略时 viewer 按 architecture 渲染)。 */
export const DEFAULT_DIAGRAM_TYPE: DiagramType = "architecture";

/**
 * Manifest 树节点 —— 一个抽象层(对齐 01 §2.1 航母分层)。
 *
 * @field id       跨整棵树唯一标识(viewer 用作 hash 路由锚点 + D2 salt 后缀)。必填,^[a-z0-9-]+$。
 * @field label    节点显示名(浏览器 UI 文字 / 面包屑 / <title>)。必填。
 *                 🔴 信任边界:producer 不可信(AI/人手写皆可),viewer 侧强制 escapeHtml。
 * @field diagram  该层的 D2 DSL 源码。必填(允许空串)。
 *                 非空 → viewer 渲染对应图;空串 "" → 仅分组容器(viewMode: container-list)。
 *                 空串 ≠ undefined:显式区分"我决定这里不画图" vs "字段漏了"(03 §1.2 项 2)。
 * @field diagramType  图类型显式标注;缺省 = "architecture"。选填(显式 > 隐式,防 infer 错)。
 * @field children     子节点;缺省 / [] / undefined 三者等价 = 叶子(无 drill-down)。选填。
 * @field notes        旁注 / WHY(producer 自用,不进 viewer)。选填。
 */
export interface ManifestNode {
  id: string;
  label: string;
  diagram: string;
  diagramType?: DiagramType;
  children?: ManifestNode[];
  notes?: string;
}

/**
 * manifest 文件根对象。
 * 故意不包 { version, manifest, metadata }:root 就是节点本身(顶图 = 根)。
 * 不发明新概念(01 §3 抽象是手段非目的)。
 */
export type Manifest = ManifestNode;

/**
 * LayerSpec —— viewer 契约 shape(buildNestedHtml 把 ManifestNode 树 DFS 先序扁平化后的产物)。
 *
 * 与 ManifestNode 的差异(转换契约钉死在方案 §3.4):
 *   - title: label 经 escapeHtml 后的字符串(信任边界)
 *   - svg:   diagram 经 D2 render 后的字符串(分组容器为空串)
 *   - children: ManifestNode[] 递归引用 → string[] id 引用(direct children;整体 layers 数组 DFS 先序)
 *   - parent: 计算字段(DFS 遍历时记录父 id;root 为 null)
 *   - viewMode: 计算字段(diagram==="" → container-list,否则 diagram)
 *   - diagramType / notes 不进 LayerSpec(仅 producer 用)
 *
 * Phase 2(renderManifestLayers)填充;Phase 1 仅定义 shape。
 *
 * 扁平化算法 = DFS 先序(自顶向下,父先于子,兄弟按数组序):renderManifestLayers 用 for-await 串行
 * 遍历(非 Promise.all 并发),保 D2 chain 顺序 + layers 数组顺序稳定 → byte-identical HTML。
 * 测试 manifest-layers.contract.test.mjs 的"DFS 序钉死"用例(多叉树 fixture + 异步可变延迟 stub)守护。
 */
export interface LayerSpec {
  id: string;
  /** 已 escapeHtml 后的标题(信任边界,viewer 直接 innerHTML 安全)。 */
  title: string;
  /** 已渲染 SVG(diagram==="" 的分组容器为空串,viewer 显示 placeholder + children 卡片)。 */
  svg: string;
  /** 父节点 id;root 为 null。 */
  parent: string | null;
  /** 子节点 id 引用数组(BFS 序列化,递归引用转 id 引用)。 */
  children: string[];
  /** 渲染模式:diagram 非空 → "diagram";diagram 空串 → "container-list"。 */
  viewMode: "diagram" | "container-list";
}

/**
 * 契约错前缀(F13-style 错误路由:index.ts handler 据此前缀决定归一化路径)。
 * validateManifest / nested-asserts 的契约错统一抛 "[nested-diagram] <CODE> ...",
 * handler 见此前缀直抛不归 d2(对齐 interactive-html F13 范式,index.ts:1050-1068)。
 */
export const NESTED_ERROR_PREFIX = "[nested-diagram]";

/** id 字符集:URL hash 友好 + 防 D2 ID 元字符 + 防 salt 注入。 */
export const ID_PATTERN = /^[a-z0-9-]+$/;

/** 嵌套版 per-node salt 前缀(拼接 node.id,id 已校验 ∈ [a-z0-9-])。方案 §3.4 blocking B-3 钉死。 */
export const NESTED_SALT_PREFIX = "media-gen-mcp-nested-";

/**
 * manifest 树最大深度(栈安全守护,S4 审查 finding)。
 *
 * 03 §1.2 项 7 + §1.5:不可信 producer(AI/人手写)可构造极深嵌套致递归栈溢出 RangeError,
 * 该 crash 无 [nested-diagram] 前缀,Phase 4 handler 无法路由归一化。validateManifest 在递归时
 * 以 depth 参数守护,超限 fail('V3', ...) 整树拒绝(clean rejection,非 crash)。
 *
 * 这是**栈安全**守护(只关递归深度,不关节点总数);与 NESTED_SIZE_CAP 1MB 体积 cap(装配后
 * buildNestedHtml 校验)是正交两层:本层防 RangeError,size cap 防 HTML 过大。节点数无独立软 cap
 * —— 由 size cap 间接约束(nit 审查:handler 不另设 N≤50,避免注释/代码漂移)。
 *
 * 256 远超任何合理架构图层数(航母例子 4 层、C4 标准 4 层、最深嵌套系统 ≤20 层),留 12× headroom。
 */
export const MAX_MANIFEST_DEPTH = 256;
