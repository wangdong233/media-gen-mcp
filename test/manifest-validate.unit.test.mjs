/**
 * Phase 1 Unit tests —— manifest-validate.ts 的 V1-V5 + 字段四态 + id 字符集 + 未知字段。
 *
 * 测试金字塔「Unit」层:validateManifest 是纯函数,无外部依赖,SMALL。
 * 走 node:test runner;.mjs 从 ../dist/nested-diagram/ 导入(对齐 interactive-html-contract.test.mjs
 * 范式,测真实 built output,不破 tsconfig.test.json rootDir:test)。
 *
 * 覆盖(03 §2.1):
 *   - 核心路径:合法 3 层电商子集 / 单节点 / diagramType 切换 / 空 diagram 容器
 *   - V1 重复 id(兄弟 + 嵌套)
 *   - V2 object-identity 环(自引 + 共享对象)
 *   - V3 必填漏(id/label/diagram)/ 空串(id/label)/ 类型错 / null 字段 / 非对象根 / 数组根 / 未知字段
 *   - V4 diagramType 非法(拼写错 / 空串 / 非字符串)
 *   - V5 children 非数组
 *   - id 字符集(大写 / 下划线 / 空格 / unicode / D2 元字符 / 空串)
 *   - 边界:深 4 层 / unicode label / 空 children=叶子 / 空 notes 归一
 *
 * License:本文件为 P0-5B 自研。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "../dist/nested-diagram/manifest-validate.js";
import { NESTED_ERROR_PREFIX, MAX_MANIFEST_DEPTH } from "../dist/nested-diagram/manifest-types.js";

/** 断言某输入被 validateManifest 拒,且错误信息含预期 subcode(如 "V1:"/"V3:")。 */
function assertReject(input, subcode, msgPart) {
  assert.throws(
    () => validateManifest(input),
    (err) => {
      assert.ok(
        err.message.startsWith(NESTED_ERROR_PREFIX + " "),
        `错误应以 "${NESTED_ERROR_PREFIX} " 开头,得:${err.message}`,
      );
      assert.ok(err.message.includes(subcode), `错误应含 "${subcode}",得:${err.message}`);
      if (msgPart) {
        assert.ok(err.message.includes(msgPart), `错误应含 "${msgPart}",得:${err.message}`);
      }
      return true;
    },
  );
}

/** 最小合法单节点(等价 generate_interactive_diagram 单图)。 */
function singleNode() {
  return { id: "root", label: "根", diagram: "a -> b" };
}

// ──────────────────────────────────────────────────────────────────────────
// 核心路径(合法 manifest 全通过)
// ──────────────────────────────────────────────────────────────────────────

test("合法单节点通过 + 归一化(无选填字段则不填)", () => {
  const m = validateManifest(singleNode());
  assert.equal(m.id, "root");
  assert.equal(m.label, "根");
  assert.equal(m.diagram, "a -> b");
  assert.equal(m.diagramType, undefined, "未传 diagramType 不应默认填(Phase 2 转)");
  assert.equal(m.children, undefined, "无 children 不应填 []");
  assert.equal(m.notes, undefined, "无 notes 不应填");
});

test("合法 3 层树通过(children/notes/diagramType 都覆盖 + 归一化断言)", () => {
  const m = validateManifest({
    id: "root",
    label: "顶层",
    diagram: "a -> b",
    diagramType: "architecture",
    notes: "顶层旁注",
    children: [
      {
        id: "mid",
        label: "中层",
        diagram: "",
        children: [
          { id: "leaf", label: "叶子", diagram: "x -> y", diagramType: "sequence" },
        ],
      },
    ],
  });
  assert.equal(m.id, "root");
  // S5 审查 finding:补 diagramType/notes 归一化断言(防 mutation "删归一化赋值" survive)
  assert.equal(m.diagramType, "architecture", "root 传了 diagramType 应原样保留");
  assert.equal(m.notes, "顶层旁注", "root 传了非空 notes 应原样保留");
  assert.equal(m.children.length, 1);
  assert.equal(m.children[0].id, "mid");
  assert.equal(m.children[0].diagram, "", "空 diagram 合法(分组容器)");
  assert.equal(m.children[0].diagramType, undefined, "mid 未传 diagramType 应不填(归一化)");
  assert.equal(m.children[0].notes, undefined, "mid 未传 notes 应不填(归一化)");
  assert.equal(m.children[0].children.length, 1);
  assert.equal(m.children[0].children[0].diagramType, "sequence");
  assert.equal(m.children[0].children[0].children, undefined, "叶子无 children");
});

test("空 children 数组等价叶子(归一化后不填 children)", () => {
  const m = validateManifest({ id: "root", label: "根", diagram: "a", children: [] });
  assert.equal(m.children, undefined, "空数组应归一为不填(等价 undefined)");
});

test("空 notes 归一化(等价无旁注,不填)", () => {
  const m = validateManifest({ id: "root", label: "根", diagram: "a", notes: "" });
  assert.equal(m.notes, undefined, "空 notes 应归一为不填(等价 undefined)");
});

test("纯函数性:不改输入(R-INT-01)", () => {
  const input = {
    id: "root",
    label: "根",
    diagram: "a",
    children: [{ id: "c1", label: "子", diagram: "b" }],
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  validateManifest(input);
  assert.deepEqual(input, snapshot, "validateManifest 不应改输入(纯函数)");
});

test("unicode label 通过(label 非信任边界校验对象,只校验非空 string)", () => {
  const m = validateManifest({ id: "root", label: "中文标题 🚀", diagram: "a" });
  assert.equal(m.label, "中文标题 🚀");
});

// ──────────────────────────────────────────────────────────────────────────
// V1 id 唯一性
// ──────────────────────────────────────────────────────────────────────────

test("V1: 兄弟节点重复 id 整树拒绝", () => {
  assertReject(
    {
      id: "root",
      label: "根",
      diagram: "a",
      children: [
        { id: "dup", label: "甲", diagram: "b" },
        { id: "dup", label: "乙", diagram: "c" },
      ],
    },
    "V1",
    "duplicate id",
  );
});

test("V1: 嵌套层重复 id 整树拒绝(父孙同名)", () => {
  assertReject(
    {
      id: "root",
      label: "根",
      diagram: "a",
      children: [{ id: "root", label: "也叫 root", diagram: "b" }],
    },
    "V1",
  );
});

// ──────────────────────────────────────────────────────────────────────────
// V2 无环(object-identity)
// ──────────────────────────────────────────────────────────────────────────

test("V2: 节点自引(object-identity 环)整树拒绝", () => {
  const node = { id: "root", label: "根", diagram: "a" };
  node.children = [node]; // 自己当自己的 child → 环
  assertReject(node, "V2", "cycle");
});

test("V2: 共享同一对象两次 → V2 object-identity 先命中(validateNode 里 V2 在 V1 之前)", () => {
  // 共享对象同时是"图非树"(V2)和"id 重复"(V1)双重违例;V2 更本质(图违反),先检查先命中。
  // 两条都准确,关键是被拒;这里断言 V2(实际行为)。
  const shared = { id: "shared", label: "共享", diagram: "a" };
  assertReject(
    {
      id: "root",
      label: "根",
      diagram: "b",
      children: [shared, shared],
    },
    "V2",
    "seen before",
  );
});

// ──────────────────────────────────────────────────────────────────────────
// V3 必填字段 / 类型 / null / 非对象根 / 未知字段
// ──────────────────────────────────────────────────────────────────────────

test("V3: 根非对象拒绝", () => {
  assertReject(null, "V3", "must be an object");
  assertReject("string", "V3", "must be an object");
  assertReject(42, "V3", "must be an object");
  assertReject([], "V3", "must be an object");
  assertReject(undefined, "V3", "must be an object");
});

test("V3: 子节点非对象拒绝", () => {
  assertReject(
    { id: "root", label: "根", diagram: "a", children: ["not-node"] },
    "V3",
    "must be an object",
  );
});

test("V3: 缺 id 拒绝", () => {
  assertReject({ label: "根", diagram: "a" }, "V3", '"id"');
});
test("V3: 缺 label 拒绝", () => {
  assertReject({ id: "root", diagram: "a" }, "V3", '"label"');
});
test("V3: 缺 diagram 拒绝(显式提示用空串)", () => {
  assertReject({ id: "root", label: "根" }, "V3", '"diagram"');
});

test("V3: id 空串拒绝", () => {
  assertReject({ id: "", label: "根", diagram: "a" }, "V3", '"id"');
});
test("V3: label 空串拒绝", () => {
  assertReject({ id: "root", label: "", diagram: "a" }, "V3", '"label"');
});

test("V3: id 类型错(数字)拒绝", () => {
  assertReject({ id: 42, label: "根", diagram: "a" }, "V3", '"id"');
});
test("V3: label 类型错拒绝", () => {
  assertReject({ id: "root", label: 42, diagram: "a" }, "V3", '"label"');
});
test("V3: diagram 类型错拒绝", () => {
  assertReject({ id: "root", label: "根", diagram: 42 }, "V3", '"diagram"');
});

test("V3: 任意字段为 null 拒绝(全禁 null 二态)", () => {
  assertReject({ id: "root", label: null, diagram: "a" }, "V3", "must not be null");
  assertReject({ id: "root", label: "根", diagram: null }, "V3", "must not be null");
  assertReject({ id: null, label: "根", diagram: "a" }, "V3", "must not be null");
  assertReject({ id: "root", label: "根", diagram: "a", notes: null }, "V3", "must not be null");
});

test("V3: 未知字段拒绝(防 `childen`/`lable` 类拼写错误静默成叶子)", () => {
  // childen 漏 r → 若不拒,被当叶子,drill 不工作,极难排查
  assertReject(
    { id: "root", label: "根", diagram: "a", childen: [{ id: "c", label: "子", diagram: "b" }] },
    "V3",
    "unknown field",
  );
  assertReject({ id: "root", label: "根", diagram: "a", layout: { x: 1 } }, "V3", "unknown field");
  assertReject({ id: "root", label: "根", diagram: "a", version: "1.0" }, "V3", "unknown field");
});

// ──────────────────────────────────────────────────────────────────────────
// V4 diagramType 合法 enum
// ──────────────────────────────────────────────────────────────────────────

test("V4: diagramType 拼写错拒绝", () => {
  assertReject(
    { id: "root", label: "根", diagram: "a", diagramType: "architectur" },
    "V4",
    "not a valid enum",
  );
});

test("V4: diagramType 空串拒绝", () => {
  assertReject({ id: "root", label: "根", diagram: "a", diagramType: "" }, "V4");
});

test("V4: diagramType 非字符串拒绝", () => {
  assertReject({ id: "root", label: "根", diagram: "a", diagramType: 42 }, "V4");
});

test("V4: 五个合法 diagramType 全通过", () => {
  for (const dt of ["architecture", "sequence", "er", "class", "flowchart"]) {
    const m = validateManifest({ id: "root", label: "根", diagram: "a", diagramType: dt });
    assert.equal(m.diagramType, dt);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// V5 children 闭合
// ──────────────────────────────────────────────────────────────────────────

test("V5: children 非数组拒绝", () => {
  assertReject(
    { id: "root", label: "根", diagram: "a", children: "not-array" },
    "V5",
    "must be an array",
  );
  assertReject({ id: "root", label: "根", diagram: "a", children: { x: 1 } }, "V5", "must be an array");
});

test("V5: 嵌套子节点的违例也整树拒绝(递归校验闭合)", () => {
  assertReject(
    {
      id: "root",
      label: "根",
      diagram: "a",
      children: [
        { id: "ok", label: "合法", diagram: "b" },
        { id: "bad", label: "缺 diagram", children: [] }, // 孙辈缺 diagram
      ],
    },
    "V3",
  );
});

// ──────────────────────────────────────────────────────────────────────────
// id 字符集 ^[a-z0-9-]+$
// ──────────────────────────────────────────────────────────────────────────

test("id 字符集: 大写字母拒绝", () => {
  assertReject({ id: "Root", label: "根", diagram: "a" }, "V3", "must match ^[a-z0-9-]+$");
});
test("id 字符集: 下划线拒绝", () => {
  assertReject({ id: "order_service", label: "根", diagram: "a" }, "V3");
});
test("id 字符集: 空格拒绝", () => {
  assertReject({ id: "order service", label: "根", diagram: "a" }, "V3");
});
test("id 字符集: 中文拒绝", () => {
  assertReject({ id: "订单", label: "根", diagram: "a" }, "V3");
});
test("id 字符集: D2 ID 元字符(dot)拒绝", () => {
  // 'a.b' 在 D2 里是 nested container 引用,会污染 salt + drill href
  assertReject({ id: "a.b", label: "根", diagram: "a" }, "V3");
});
test("id 字符集: 合法值通过(纯小写/数字/连字符)", () => {
  for (const id of ["root", "order-service", "svc-1", "a", "123", "a-b-c-9"]) {
    assert.doesNotThrow(() => validateManifest({ id, label: "根", diagram: "x" }));
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 边界:深 4 层
// ──────────────────────────────────────────────────────────────────────────

test("边界: 深 4 层链通过", () => {
  const m = validateManifest({
    id: "l0",
    label: "0",
    diagram: "a",
    children: [
      {
        id: "l1",
        label: "1",
        diagram: "b",
        children: [
          {
            id: "l2",
            label: "2",
            diagram: "c",
            children: [{ id: "l3", label: "3", diagram: "d" }],
          },
        ],
      },
    ],
  });
  assert.equal(m.children[0].children[0].children[0].id, "l3");
});

// ──────────────────────────────────────────────────────────────────────────
// S3 label 空白串(实现 vs 意图一致:错误消息说 "visible text" 则纯空白须拒)
// ──────────────────────────────────────────────────────────────────────────

test("S3: label 纯空白串拒绝(空格/tab/换行,对齐 'visible text' 意图)", () => {
  assertReject({ id: "root", label: "   ", diagram: "a" }, "V3", "whitespace-only");
  assertReject({ id: "root", label: "\t", diagram: "a" }, "V3");
  assertReject({ id: "root", label: "\n", diagram: "a" }, "V3");
});

test("S3: label 含前后空白但内部有字 通过(只拒纯空白,不 trim 内容)", () => {
  const m = validateManifest({ id: "root", label: "  订单  ", diagram: "a" });
  assert.equal(m.label, "  订单  ", "非纯空白 label 原样保留(只拒纯空白,不 trim 内容)");
});

// ──────────────────────────────────────────────────────────────────────────
// S1/S6 notes 非 string 分支(防 mutation 删 typeof 分支 survive)
// ──────────────────────────────────────────────────────────────────────────

test("S1: notes 非字符串拒绝(防 mutation 删 typeof n.notes 分支 survive)", () => {
  assertReject({ id: "r", label: "x", diagram: "a", notes: 42 }, "V3", '"notes"');
  assertReject({ id: "r", label: "x", diagram: "a", notes: { x: 1 } }, "V3", '"notes"');
  assertReject({ id: "r", label: "x", diagram: "a", notes: ["arr"] }, "V3", '"notes"');
});

// ──────────────────────────────────────────────────────────────────────────
// nit: children:null / diagramType:null 定向(钉死 contract code 必为 V3 非 V4/V5)
// ──────────────────────────────────────────────────────────────────────────

test("V3: children=null 定向拒绝(contract code 必为 V3 非 V5)", () => {
  assertReject({ id: "r", label: "x", diagram: "a", children: null }, "V3", "must not be null");
});

test("V3: diagramType=null 定向拒绝(contract code 必为 V3 非 V4)", () => {
  assertReject({ id: "r", label: "x", diagram: "a", diagramType: null }, "V3", "must not be null");
});

// ──────────────────────────────────────────────────────────────────────────
// S4 栈安全守护:MAX_MANIFEST_DEPTH 边界
// ──────────────────────────────────────────────────────────────────────────

/** 构造 nodeCount 个节点的线性链(root depth 0,最深层 depth nodeCount-1)。 */
function buildChain(nodeCount) {
  let node = { id: "n" + (nodeCount - 1), label: "x", diagram: "a" };
  for (let i = nodeCount - 2; i >= 0; i--) {
    node = { id: "n" + i, label: "x", diagram: "a", children: [node] };
  }
  return node;
}

test(`S4: depth = MAX_MANIFEST_DEPTH(${MAX_MANIFEST_DEPTH}) 通过(256 不 > 256)`, () => {
  // nodeCount = MAX+1 → 最深层 depth = MAX,不触发 depth>MAX
  const m = validateManifest(buildChain(MAX_MANIFEST_DEPTH + 1));
  assert.equal(m.id, "n0");
});

test(`S4: depth = MAX+1(${MAX_MANIFEST_DEPTH + 1}) 整树拒绝(防 RangeError,clean V3 非 crash)`, () => {
  // nodeCount = MAX+2 → 最深层 depth = MAX+1,触发 depth>MAX → clean V3 rejection
  assertReject(buildChain(MAX_MANIFEST_DEPTH + 2), "V3", "exceeds max depth");
});

// ──────────────────────────────────────────────────────────────────────────
// nit: property round-trip(validate 输出 → JSON 往返 → 再 validate → 等价)
// ──────────────────────────────────────────────────────────────────────────

test("property: validateManifest 输出 JSON 往返等价(idempotency)", () => {
  const samples = [
    singleNode(),
    {
      id: "root",
      label: "顶层",
      diagram: "a -> b",
      diagramType: "architecture",
      notes: "n",
      children: [
        { id: "c1", label: "子", diagram: "c1d" },
        { id: "c2", label: "叶", diagram: "x", diagramType: "sequence" },
      ],
    },
    { id: "root", label: "中文 🚀", diagram: "a" },
  ];
  for (const s of samples) {
    const o1 = validateManifest(s);
    const o2 = validateManifest(JSON.parse(JSON.stringify(o1)));
    assert.deepEqual(o1, o2, "validate 输出经 JSON 往返后再 validate 应等价(idempotency)");
  }
});

// ──────────────────────────────────────────────────────────────────────────
// STRONG(Phase 3 审查):container-list(diagram="")必须有 children,否则 viewer 死胡同 UX
// ──────────────────────────────────────────────────────────────────────────

test("STRONG: diagram='' 无 children 拒绝(container 必有子可聚,防 viewer 死胡同)", () => {
  assertReject(
    { id: "root", label: "x", diagram: "" },
    "V3",
    "container-list",
  );
  assertReject(
    { id: "root", label: "x", diagram: "a", children: [{ id: "c", label: "y", diagram: "" }] },
    "V3",
    "container-list",
  );
});

test("STRONG: diagram='' 有 children 通过(合法 container)", () => {
  const m = validateManifest({
    id: "root",
    label: "x",
    diagram: "",
    children: [{ id: "c", label: "y", diagram: "z" }],
  });
  assert.equal(m.diagram, "");
  assert.equal(m.children.length, 1);
});
