/**
 * Phase 2 契约测试 —— renderManifestLayers 渲染核心(stub engine 注入,验三杠杆 + LayerSpec 契约)。
 *
 * 走 node:test runner;.mjs 从 ../dist/nested-diagram/ 导入(对齐 interactive-html-contract.test.mjs
 * 的 stub engine S12 范式 —— 验 D2 render 传 salt/noXMLTag/theme,不跑真实 D2 WASM 60s 冷启)。
 *
 * 覆盖(03 §2.1 + §2.2):
 *   - C3 per-node salt = NESTED_SALT_PREFIX + node.id(确定性 + 防 ID 冲突)
 *   - C2 noXMLTag = true(HTML 内联必去 <?xml?>)
 *   - 整树共享 theme/darkTheme(global,非 per-node)
 *   - DFS 序确定性(layers 数组顺序稳定)
 *   - 容器节点(diagram="")跳过 D2 render(svg="",viewMode=container-list)
 *   - title = escapeHtml(label)(信任边界 blocking B-1)
 *   - 任一节点 D2 失败 → 整树拒绝(throw 传播,无 partial)
 *   - 确定性:同输入两次 → 等价 layers
 *   - LayerSpec shape:parent/children ids/viewMode 正确
 *
 * License:本文件为 P0-5B 自研。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderManifestLayers } from "../dist/nested-diagram/index.js";
import { NESTED_SALT_PREFIX } from "../dist/nested-diagram/manifest-types.js";

/** stub D2Engine:记录每次 render 请求,按 salt 后缀(= node.id)产确定性 SVG。 */
function makeStubEngine() {
  const calls = [];
  const engine = {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["flowchart", "sequence", "class", "er", "architecture"],
    render: async (req) => {
      calls.push(req);
      const id = req.salt.replace(NESTED_SALT_PREFIX, "");
      return { svg: `<svg data-stub-id="${id}" viewBox="0 0 100 100"><rect/></svg>` };
    },
  };
  return { engine, calls };
}

/** 3 层电商子集:root(渲染)+ mid 容器(diagram="",跳过)+ leaf(渲染)。 */
function ecommerceManifest() {
  return {
    id: "root",
    label: "电商平台",
    diagram: "api -> svc",
    diagramType: "architecture",
    children: [
      {
        id: "business",
        label: "业务服务群",
        diagram: "", // 分组容器,不渲染
        children: [
          {
            id: "order-service",
            label: "订单服务",
            diagram: "create -> pay",
            diagramType: "sequence",
          },
        ],
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// C3 per-node salt + C2 noXMLTag + global theme
// ──────────────────────────────────────────────────────────────────────────

test("C3+C2: 每个非容器节点 render 传 per-node salt + noXMLTag:true + engine d2 + format svg", async () => {
  const { engine, calls } = makeStubEngine();
  await renderManifestLayers(ecommerceManifest(), {}, engine);
  // 容器节点(business)跳过 → 只 2 次 render(root + order-service)
  assert.equal(calls.length, 2, "容器节点 diagram='' 不调 render");
  // per-node salt(每节点唯一)
  assert.equal(calls[0].salt, NESTED_SALT_PREFIX + "root");
  assert.equal(calls[1].salt, NESTED_SALT_PREFIX + "order-service");
  // code 透传(每节点唯一)
  assert.equal(calls[0].code, "api -> svc");
  assert.equal(calls[1].code, "create -> pay");
  // nit: noXMLTag/engine/format 是硬编码常量,对称断言每次 render(nit 审查:原本只查 calls[0])
  for (const c of calls) {
    assert.equal(c.noXMLTag, true, "noXMLTag 硬编码 true(每节点)");
    assert.equal(c.engine, "d2", "engine=d2(每节点)");
    assert.equal(c.format, "svg", "format=svg(每节点)");
  }
});

test("global theme/darkTheme 整树共享 + hasDarkLightDualPalette=true(Strong 3:钉死 true 路径)", async () => {
  const { engine, calls } = makeStubEngine();
  const r = await renderManifestLayers(ecommerceManifest(), { theme: "neutral", darkTheme: "200" }, engine);
  for (const c of calls) {
    assert.equal(c.theme, "neutral", "theme 整树共享");
    assert.equal(c.darkTheme, "200", "darkTheme 整树共享");
  }
  // Strong 3:hasDark=true 路径必须断言(防 mutation 改 hasDark 恒 false survive)
  assert.equal(r.hasDarkLightDualPalette, true, "darkTheme='200' 非空白 → hasDarkLightDualPalette=true");
});

test("darkTheme 三态对称:undefined / 空白串 → hasDark=false;非空白 → true", async () => {
  const { engine: e1 } = makeStubEngine();
  const r1 = await renderManifestLayers(ecommerceManifest(), {}, e1);
  assert.equal(r1.hasDarkLightDualPalette, false, "darkTheme undefined → false");
  const { engine: e2 } = makeStubEngine();
  const r2 = await renderManifestLayers(ecommerceManifest(), { darkTheme: "   " }, e2);
  assert.equal(r2.hasDarkLightDualPalette, false, "darkTheme 空白串 → false");
  const { engine: e3 } = makeStubEngine();
  const r3 = await renderManifestLayers(ecommerceManifest(), { darkTheme: "200" }, e3);
  assert.equal(r3.hasDarkLightDualPalette, true, "darkTheme 非空白 → true");
});

test("darkTheme 空白串: hasDark=false 但原样透传给 render(d2.ts resolveD2Theme 归一 null)", async () => {
  const { engine, calls } = makeStubEngine();
  const r = await renderManifestLayers(ecommerceManifest(), { darkTheme: "   " }, engine);
  assert.equal(r.hasDarkLightDualPalette, false);
  for (const c of calls) {
    assert.equal(c.darkTheme, "   ", "空白串原样透传(d2.ts resolveD2Theme 自行归一 null)");
  }
});

// ──────────────────────────────────────────────────────────────────────────
// DFS 序确定性 + LayerSpec shape
// ──────────────────────────────────────────────────────────────────────────

test("DFS 序: layers 按 root → business → order-service 顺序(确定性)", async () => {
  const { engine } = makeStubEngine();
  const r = await renderManifestLayers(ecommerceManifest(), {}, engine);
  assert.equal(r.layers.length, 3);
  assert.deepEqual(
    r.layers.map((l) => l.id),
    ["root", "business", "order-service"],
    "DFS 序稳定(byte-identical HTML 基础)",
  );
  assert.equal(r.rootId, "root");
});

test("Strong 1/4: DFS 先序钉死(多叉 root→[a→[a1],b] + 异步可变延迟 stub,杀 Promise.all mutant)", async () => {
  // 强审查 finding:线性 fixture + 同步 stub 下 for-await 与 Promise.all 产出同序,DFS 不变量未测。
  // 本用例:多叉 fixture(BFS/并发会得 [root,a,b,a1])+ 异步可变延迟(后调用解析更快 → 并发下乱序)。
  // for-await 串行下序 = [root,a,a1,b](通过);Promise.all mutant 下序 ≠ 此(失败)。
  let seq = 0;
  const asyncEngine = {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["architecture"],
    render: async (req) => {
      const delay = 50 - ++seq * 10; // 40,30,20,10 — 后调用解析更快
      await new Promise((resolve) => setTimeout(resolve, delay));
      const id = req.salt.replace(NESTED_SALT_PREFIX, "");
      return { svg: `<svg data-id="${id}"/>` };
    },
  };
  const fixture = {
    id: "root",
    label: "r",
    diagram: "x",
    children: [
      { id: "a", label: "a", diagram: "x", children: [{ id: "a1", label: "a1", diagram: "x" }] },
      { id: "b", label: "b", diagram: "x" },
    ],
  };
  const r = await renderManifestLayers(fixture, {}, asyncEngine);
  assert.deepEqual(
    r.layers.map((l) => l.id),
    ["root", "a", "a1", "b"],
    "DFS 先序:root → a → a1 → b( BFS/并发会得 [root,a,b,a1];Promise.all mutant 必失败于此)",
  );
});

test("E_ENGINE: 非 d2 engine 拒绝(contract code E_ENGINE,nit 审查:类型签名撒谎防御)", async () => {
  const graphvizEngine = {
    name: "graphviz",
    isAvailable: () => true,
    listTypes: () => [],
    render: async () => ({ svg: "" }),
  };
  await assert.rejects(
    () => renderManifestLayers({ id: "r", label: "x", diagram: "a" }, {}, graphvizEngine),
    /\[nested-diagram\] E_ENGINE: engine must be d2, got graphviz/,
  );
});

test("LayerSpec shape: parent/children/viewMode/svg 正确", async () => {
  const { engine } = makeStubEngine();
  const r = await renderManifestLayers(ecommerceManifest(), {}, engine);
  const [root, business, orderSvc] = r.layers;

  // root
  assert.equal(root.parent, null);
  assert.deepEqual(root.children, ["business"]);
  assert.equal(root.viewMode, "diagram");
  assert.match(root.svg, /data-stub-id="root"/);

  // business(容器)
  assert.equal(business.parent, "root");
  assert.deepEqual(business.children, ["order-service"]);
  assert.equal(business.viewMode, "container-list", "diagram='' → container-list");
  assert.equal(business.svg, "", "容器节点 svg=''");

  // order-service(叶子)
  assert.equal(orderSvc.parent, "business");
  assert.deepEqual(orderSvc.children, [], "叶子 children=[]");
  assert.equal(orderSvc.viewMode, "diagram");
  assert.match(orderSvc.svg, /data-stub-id="order-service"/);
});

// ──────────────────────────────────────────────────────────────────────────
// blocking B-1: title = escapeHtml(label)
// ──────────────────────────────────────────────────────────────────────────

test("B-1: title = escapeHtml(label)(信任边界,producer 不可信)", async () => {
  const { engine } = makeStubEngine();
  const r = await renderManifestLayers(
    {
      id: "root",
      label: '<script>alert(1)</script>',
      diagram: "a",
    },
    {},
    engine,
  );
  // label 含 <script> → title 必须 escape(viewer 直接 innerHTML 才安全)
  assert.equal(r.layers[0].title, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.ok(!r.layers[0].title.includes("<script>"), "escape 后不得含裸 <script>");
});

// ──────────────────────────────────────────────────────────────────────────
// 整树拒绝:任一节点 D2 失败 → throw 传播,无 partial
// ──────────────────────────────────────────────────────────────────────────

test("整树拒绝: 第 2 个节点 D2 render 抛错 → renderManifestLayers 抛错(无 partial layers)", async () => {
  let callCount = 0;
  const failingEngine = {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["architecture"],
    render: async (req) => {
      callCount++;
      if (callCount === 2) {
        throw new Error("D2 compile error: bad syntax");
      }
      return { svg: "<svg/>" };
    },
  };
  await assert.rejects(
    () => renderManifestLayers(ecommerceManifest(), {}, failingEngine),
    /D2 compile error/,
    "第 2 节点(leaf)失败 → 整树拒绝",
  );
  // 调用方拿不到 partial result(renderManifestLayers throw,不返回 layers)
});

// ──────────────────────────────────────────────────────────────────────────
// 确定性:同输入两次 → 等价 layers
// ──────────────────────────────────────────────────────────────────────────

test("确定性: 同输入两次 renderManifestLayers → layers 等价", async () => {
  const { engine } = makeStubEngine();
  const r1 = await renderManifestLayers(ecommerceManifest(), { darkTheme: "200" }, engine);
  const r2 = await renderManifestLayers(ecommerceManifest(), { darkTheme: "200" }, engine);
  assert.deepEqual(r1.layers, r2.layers, "两次 layers 等价(确定性)");
  assert.equal(r1.rootId, r2.rootId);
  assert.equal(r1.hasDarkLightDualPalette, r2.hasDarkLightDualPalette);
});

// ──────────────────────────────────────────────────────────────────────────
// 校验错前缀(透传 Phase 1 validateManifest 的 [nested-diagram] 前缀)
// ──────────────────────────────────────────────────────────────────────────

test("校验错透传: 非法 manifest → [nested-diagram] 前缀错(Phase 1 validateManifest)", async () => {
  const { engine } = makeStubEngine();
  await assert.rejects(
    () => renderManifestLayers({ id: "dup", label: "x", diagram: "a", children: [{ id: "dup", label: "y", diagram: "b" }] }, {}, engine),
    /\[nested-diagram\] V1/,
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 单节点 manifest(等价 generate_interactive_diagram 单图)
// ──────────────────────────────────────────────────────────────────────────

test("单节点 manifest: 1 layer,rootId,无 children(等价单图)", async () => {
  const { engine, calls } = makeStubEngine();
  const r = await renderManifestLayers({ id: "solo", label: "单图", diagram: "a -> b" }, {}, engine);
  assert.equal(r.layers.length, 1);
  assert.equal(r.layers[0].id, "solo");
  assert.equal(r.layers[0].parent, null);
  assert.deepEqual(r.layers[0].children, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].salt, NESTED_SALT_PREFIX + "solo");
});
