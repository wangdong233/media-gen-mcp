/**
 * 嵌套架构图工具 —— manifest 校验(P0-5B §4.3 / 方案 §1 / 03 §1.2)。
 *
 * validateManifest(input: unknown): Manifest
 *   纯函数,递归校验整棵树,任一违例整树拒绝(严禁部分加载)。
 *
 * 五项验证(V1-V5)+ 叠加:
 *   V1  id 唯一性      跨整棵树无重复 id(DFS 收集,size == 节点数)
 *   V2  无环检测       manifest 是树不是图(object-identity WeakSet;inline children 下防 node 自引)
 *   V3  必填字段完整   id/label/diagram 非 undefined,label 非空串;类型正确;全字段禁 null;未知字段拒
 *   V4  diagramType 合法 enum 5 值或缺省
 *   V5  children 闭合   children 必是 array,递归校验每元素也是 ManifestNode
 *   叠加 id 字符集     ^[a-z0-9-]+$(URL hash 友好 + 防 D2 ID 元字符 + 防 salt 注入)
 *
 * 写前先校验(03 §1.2 项 3):V1-V5 全过才返回 Manifest,严禁部分加载
 *   (防 cc-status-dot Anchor B 同构失败:producer 缺字段传播进内部 state 致后续消费者读错位)。
 *
 * 字段缺失四态归一(03 §1.2 项 2):逐字段定义 undefined / null / 空串 / 空数组 语义。
 *   全部禁 null(只允许 undefined 或有值,简化契约到二态)。
 *
 * 归一化(轻量,纯函数返回新对象):
 *   - diagramType undefined → 不填(Phase 2 转换时缺省 "architecture")
 *   - children undefined / [] → 不填(等价叶子)
 *   - notes undefined / ""  → 不填(等价无旁注)
 *   ManifestNode → LayerSpec 的完整转换在 Phase 2(buildNestedHtml),本文件只做校验 + 轻归一。
 *
 * License:P0-5B 自研(标准递归校验,无第三方源码引用)。
 */
import {
  DIAGRAM_TYPES,
  ID_PATTERN,
  MAX_MANIFEST_DEPTH,
  NESTED_ERROR_PREFIX,
} from "./manifest-types.js";
import type { DiagramType, Manifest, ManifestNode } from "./manifest-types.js";

/**
 * manifest 允许的字段名集合(冻结 6 字段,未知字段拒 → 防 `childen` 类拼写错误静默成叶子)。
 *
 * S2 审查 finding:用 `Record<keyof ManifestNode, true>` 在**编译期**把字段集合钉死 —— 未来给
 * ManifestNode interface 加可选字段时,_MANIFEST_KEYS 必须同步加该键(否则 TS 报缺属性),
 * 把"interface 加了字段但 KNOWN_KEYS 没跟 → 合法 manifest 被静默误拒为 unknown field"的漂移
 * 从运行时静默失败变成编译失败。
 */
const _MANIFEST_KEYS: Record<keyof ManifestNode, true> = {
  id: true,
  label: true,
  diagram: true,
  diagramType: true,
  children: true,
  notes: true,
};
const KNOWN_KEYS: readonly string[] = Object.keys(_MANIFEST_KEYS);
const KNOWN_KEYS_SET = new Set(KNOWN_KEYS);

/**
 * 校验 manifest 树,返回归一化后的 Manifest(纯函数,新对象,不改输入)。
 *
 * @param input  未知 shape 的输入(JSON.parse 结果 / MCP args / 测试构造)
 * @returns      归一化 Manifest(diagramType/children/notes 选填字段按需填入)
 * @throws       Error("[nested-diagram] <CODE>: ...") 任一违例整树拒绝
 */
export function validateManifest(input: unknown): Manifest {
  const ids = new Set<string>(); // V1 id 唯一性
  const visited = new WeakSet<object>(); // V2 object-identity 环检测
  const root = validateNode(input, "root", ids, visited, 0);
  return root;
}

/** 抛契约错(never):统一 [nested-diagram] <CODE>: <detail> 前缀,handler 据此前缀路由(F13 范式)。 */
function fail(code: string, detail: string): never {
  throw new Error(`${NESTED_ERROR_PREFIX} ${code}: ${detail}`);
}

/** 递归校验单个节点,返回归一化 ManifestNode。depth 为栈安全守护(S4)。 */
function validateNode(
  node: unknown,
  path: string,
  ids: Set<string>,
  visited: WeakSet<object>,
  depth: number,
): ManifestNode {
  // ── 必须是非 null 非数组对象 ──
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    const got =
      node === null
        ? "null"
        : Array.isArray(node)
          ? "array"
          : typeof node;
    fail("V3", `node at ${path} must be an object, got ${got}`);
  }
  const n = node as Record<string, unknown>;

  // ── S4 栈安全守护:超 MAX_MANIFEST_DEPTH 整树拒绝(防极深递归 RangeError)──
  // 不可信 producer 可构造 depth=5000 致 RangeError,该 crash 无 [nested-diagram] 前缀 handler 无法
  // 路由归一化。这里转成 clean V3 rejection。256 远超任何合理架构层数(留 12× headroom)。
  if (depth > MAX_MANIFEST_DEPTH) {
    fail(
      "V3",
      `manifest exceeds max depth ${MAX_MANIFEST_DEPTH} (violating node at ${path}); split the tree or flatten abstraction layers`,
    );
  }

  // ── V2 object-identity 环检测 ──
  // 威胁模型:JSON(producer 真实格式)无法表示环或共享子树 —— JSON.stringify 自引对象直接抛,
  // JSON.parse 后共享子树变两份独立对象。此检测仅在被传入**程序构造的对象图**(测试 fixture /
  // 调用方直接传非序列化对象)时把潜在递归栈溢出转成清晰 V2 契约错。非死代码:守住"manifest
  // 必须是树"不变量,防维护者日后放松 children 校验时环漏进渲染层。
  if (visited.has(n)) {
    fail(
      "V2",
      `object-identity cycle/share detected: node object at ${path} was seen before (manifest must be a tree; JSON cannot express cycles, so this indicates a programmatic input reusing the same object)`,
    );
  }
  visited.add(n);

  // ── 未知字段拒绝(防 `childen` / `lable` 类拼写错误静默成叶子/漏字段) ──
  for (const key of Object.keys(n)) {
    if (!KNOWN_KEYS_SET.has(key)) {
      fail(
        "V3",
        `unknown field "${key}" at ${path} (allowed: ${KNOWN_KEYS.join(", ")}); possible typo? ManifestNode fields are frozen at 6 (see manifest-schema §5 YAGNI).`,
      );
    }
  }

  // ── 全字段禁 null(字段四态归一:只允许 undefined 或有值) ──
  for (const key of Object.keys(n)) {
    if (n[key] === null) {
      fail(
        "V3",
        `field "${key}" at ${path} must not be null (use undefined or a concrete value; null is forbidden to keep the contract two-state)`,
      );
    }
  }

  // ── id(必填 + 字符集 + 唯一) ──
  if (n.id === undefined) {
    fail("V3", `field "id" at ${path} is required`);
  }
  if (typeof n.id !== "string") {
    fail("V3", `field "id" at ${path} must be a string, got ${typeof n.id}`);
  }
  if (n.id === "") {
    fail("V3", `field "id" at ${path} must not be empty`);
  }
  if (!ID_PATTERN.test(n.id as string)) {
    fail(
      "V3",
      `field "id" at ${path}="${n.id}" must match ^[a-z0-9-]+$ (lowercase ascii digits hyphen; URL-hash friendly, avoids D2 ID metacharacters and salt injection)`,
    );
  }
  if (ids.has(n.id as string)) {
    fail(
      "V1",
      `duplicate id "${n.id}" at ${path} (ids must be unique across the whole tree)`,
    );
  }
  ids.add(n.id as string);

  // ── label(必填 + 非空;信任边界 escapeHtml 在 viewer 侧) ──
  if (n.label === undefined) {
    fail("V3", `field "label" at ${path} is required`);
  }
  if (typeof n.label !== "string") {
    fail(
      "V3",
      `field "label" at ${path} must be a string, got ${typeof n.label}`,
    );
  }
  if ((n.label as string).trim() === "") {
    fail(
      "V3",
      `field "label" at ${path} must not be empty or whitespace-only (UI needs visible text for breadcrumb + <title>)`,
    );
  }

  // ── diagram(必填 + string;空串合法 = 分组容器) ──
  if (n.diagram === undefined) {
    fail(
      "V3",
      `field "diagram" at ${path} is required (use empty string "" explicitly for a group-only container)`,
    );
  }
  if (typeof n.diagram !== "string") {
    fail(
      "V3",
      `field "diagram" at ${path} must be a string, got ${typeof n.diagram}`,
    );
  }
  // 空串合法(viewMode=container-list),不拒

  // ── diagramType(选填;缺省由 Phase 2 转 "architecture";非空须合法 enum) ──
  let diagramType: DiagramType | undefined;
  if (n.diagramType !== undefined) {
    if (typeof n.diagramType !== "string") {
      fail(
        "V4",
        `field "diagramType" at ${path} must be a string, got ${typeof n.diagramType}`,
      );
    }
    if (n.diagramType === "") {
      fail(
        "V4",
        `field "diagramType" at ${path} must not be empty (omit it for the default "architecture")`,
      );
    }
    if (!DIAGRAM_TYPES.includes(n.diagramType as DiagramType)) {
      fail(
        "V4",
        `field "diagramType" at ${path}="${n.diagramType}" is not a valid enum value (allowed: ${DIAGRAM_TYPES.join(" | ")})`,
      );
    }
    diagramType = n.diagramType as DiagramType;
  }

  // ── notes(选填 + string) ──
  if (n.notes !== undefined && typeof n.notes !== "string") {
    fail(
      "V3",
      `field "notes" at ${path} must be a string, got ${typeof n.notes}`,
    );
  }

  // ── children(选填;若存在须是 array;递归校验) ──
  let children: ManifestNode[] | undefined;
  if (n.children !== undefined) {
    if (!Array.isArray(n.children)) {
      fail(
        "V5",
        `field "children" at ${path} must be an array, got ${typeof n.children}`,
      );
    }
    // 空数组 = 叶子(合法,与 undefined 等价)
    const arr = n.children as unknown[];
    children = arr.map((child, i) =>
      validateNode(child, `${path}.children[${i}]`, ids, visited, depth + 1),
    );
  }

  // ── STRONG 审查:diagram="" (container-list) 必须有 children,否则 viewer 死胡同 UX ──
  // 契约"diagram 空串 = 显式仅分组容器"暗含"必有子可聚";无 children 的 container 会让 viewer
  // 显示"选择子模块进入"+ 空 cards,producer 无反馈。显式拒绝(写前先校验,03 §1.2 项 3)。
  if (n.diagram === "" && (children === undefined || children.length === 0)) {
    fail(
      "V3",
      `node at ${path} declares diagram="" (container-list) but has no children; provide children or a non-empty diagram`,
    );
  }

  // ── 构造归一化节点(纯,新对象;选填字段按需填) ──
  const out: ManifestNode = {
    id: n.id as string,
    label: n.label as string,
    diagram: n.diagram as string,
  };
  if (diagramType !== undefined) {
    out.diagramType = diagramType;
  }
  // undefined / [] → 不填(等价叶子);非空才填
  if (children !== undefined && children.length > 0) {
    out.children = children;
  }
  // undefined / "" → 不填(等价无旁注);非空才填
  if (n.notes !== undefined && (n.notes as string) !== "") {
    out.notes = n.notes as string;
  }
  return out;
}
