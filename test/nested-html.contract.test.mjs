/**
 * Phase 3 契约测试 —— buildNestedHtml HTML 装配 + 模板契约(stub engine,不跑真 D2)。
 *
 * 走 node:test;.mjs 从 ../dist/nested-diagram/ 导入(对齐 interactive-html-contract.test.mjs 范式)。
 *
 * 覆盖(03 §2.1 + §2.2 + §2.3 golden-class):
 *   - S2 自包含 / S11 无 <?xml / S4 双调色板(darkTheme) / S9 motion governor / S6_nested ≤ 1MB
 *   - HTML 结构:stage root SVG 内联 + manifest JSON store + viewer JS + breadcrumb nav
 *   - manifest JSON 可解析 + `</` → `<\/` 转义往返(JSON.parse 还原 `</`)
 *   - container-list 层:svg="" + viewMode
 *   - B-1 label escapeHtml(信任边界)
 *   - `</script>` 注入防破出(label 经 escapeHtml + SVG 的 `</` 经 JSON 转义)
 *   - 确定性:两次 byte-identical
 *   - F11 sentinel 碰撞:title 含 sentinel → 抛
 *   - manifest 缺失 → 抛
 *
 * License:本文件为 P0-5B 自研。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNestedHtml } from "../dist/nested-diagram/index.js";
import { NESTED_SALT_PREFIX } from "../dist/nested-diagram/manifest-types.js";

/** stub D2Engine:产含 drill link + 闭合标签的确定性 SVG;按 darkTheme 条件注入 @media dark 块(模拟真 D2 darkThemeID)。 */
function makeStubEngine() {
  const calls = [];
  const engine = {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["architecture", "sequence"],
    render: async (req) => {
      calls.push(req);
      const id = req.salt.replace(NESTED_SALT_PREFIX, "");
      // darkTheme 传时模拟 D2 darkThemeID 注入 @media 双调色板块(让 assertDualPalette 通过)
      const darkBlock =
        req.darkTheme && req.darkTheme.trim()
          ? '<style>@media screen and (prefers-color-scheme:dark){rect{fill:#0f172a}}</style>'
          : "";
      // 含 drill link(模拟 D2 link:"drill:child")+ 闭合标签(测 `</` → `<\/` 转义)
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-stub-id="${id}">` +
          darkBlock +
          `<a href="drill:child-of-${id}"><rect width="50" height="50"/></a>` +
          `<text>label</text></svg>`,
      };
    },
  };
  return { engine, calls };
}

/** 3 层电商子集:root + container(空 diagram,必有 children)+ order。 */
function ecommerceManifest() {
  return {
    id: "root",
    label: "电商平台",
    diagram: "api -> svc",
    children: [
      {
        id: "business",
        label: "业务服务群",
        diagram: "", // container-list(分组容器,必有 children)
        children: [
          { id: "order", label: "订单服务", diagram: "create -> pay", diagramType: "sequence" },
        ],
      },
    ],
  };
}

/** 从 HTML 抽 manifest JSON block 内容。 */
function extractManifestJson(html) {
  const m = html.match(/<script type="application\/json" id="mgm-manifest">([\s\S]*?)<\/script>/);
  assert.ok(m, "manifest JSON script block 应存在");
  return m[1];
}

// ──────────────────────────────────────────────────────────────────────────
// S2/S11/S4/S9/S6 契约(复用 interactive-html asserts,在 buildNestedHtml 内部已跑)
// ──────────────────────────────────────────────────────────────────────────

test("S2: 无外链 <script src=", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, engine);
  assert.doesNotMatch(r.html, /<script\b[^>]*\bsrc\s*=/);
});

test("S11: 无 <?xml 声明", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, engine);
  assert.doesNotMatch(r.html, /<\?xml/);
});

test("S4: darkTheme 传时含 @media prefers-color-scheme:dark", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, engine);
  assert.match(r.html, /@media[^{]*prefers-color-scheme\s*:\s*dark/);
  assert.equal(r.hasDarkLightDualPalette, true);
});

test("S4 反例: 不传 darkTheme → 不含 @media dark 块 + hasDark=false", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  assert.doesNotMatch(r.html, /@media[^{]*prefers-color-scheme\s*:\s*dark/);
  assert.equal(r.hasDarkLightDualPalette, false);
});

test("S9: prefers-reduced-motion + data-motion=still", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  assert.match(r.html, /prefers-reduced-motion\s*:\s*reduce/);
  assert.match(r.html, /data-motion\s*=\s*["']still["']/);
});

test("S6_nested: HTML ≤ 1MB(NESTED_SIZE_CAP)", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, engine);
  assert.ok(r.bytes <= 1024 * 1024, `bytes=${r.bytes} > 1MB`);
});

// ──────────────────────────────────────────────────────────────────────────
// HTML 结构 + manifest JSON store
// ──────────────────────────────────────────────────────────────────────────

test("HTML 结构: stage root SVG 内联 + manifest store + viewer JS + breadcrumb nav", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, engine);
  // root SVG 内联在 stage(README 兜底)
  assert.match(r.html, /<div id="mgm-stage">[\s\S]*?data-stub-id="root"[^>]*>/);
  // manifest JSON store
  assert.match(r.html, /<script type="application\/json" id="mgm-manifest">/);
  // viewer JS(含 showView/drillInto 标志性函数)
  assert.match(r.html, /function showView\(/);
  assert.match(r.html, /drillInto/);
  // breadcrumb nav
  assert.match(r.html, /<nav class="mgm-breadcrumb" id="mgm-breadcrumb"/);
  // up button(默认 disabled,单层时)
  assert.match(r.html, /<button id="mgm-btn-up"[^>]*disabled/);
});

test("manifest JSON 可解析 + rootId/layers 字段正确", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  const json = extractManifestJson(r.html);
  const manifest = JSON.parse(json);
  assert.equal(manifest.rootId, "root");
  assert.equal(manifest.layers.length, 3);
  assert.deepEqual(
    manifest.layers.map((l) => l.id),
    ["root", "business", "order"],
  );
});

test("manifest JSON `</` → `<\\/` 转义往返:JSON.parse 还原 `</`(防 </script> 破出)", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  const json = extractManifestJson(r.html);
  // 转义后:JSON 字符串含 `<\/`(无裸 `</` 在闭合 svg 标签处)
  assert.ok(json.includes("<\\/"), "manifest JSON 应含 `<\\/` 转义(SVG 闭合标签)");
  // 关键:manifest script block 内不得含裸 `</script>`(会破出)
  assert.doesNotMatch(json, /<\/script>/i, "JSON 内不得有裸 </script>");
  // JSON.parse 往返还原 `</`
  const manifest = JSON.parse(json);
  assert.match(manifest.layers[0].svg, /<\/svg>/, "JSON.parse 还原 `</svg>` 闭合标签");
});

test("container-list 层: svg='' + viewMode='container-list' in store", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  const manifest = JSON.parse(extractManifestJson(r.html));
  const business = manifest.layers.find((l) => l.id === "business");
  assert.equal(business.viewMode, "container-list");
  assert.equal(business.svg, "", "容器层 svg=");
});

// ──────────────────────────────────────────────────────────────────────────
// B-1 label escapeHtml(信任边界)
// ──────────────────────────────────────────────────────────────────────────

test("B-1: label escapeHtml 进 LayerSpec.title(防 XSS)", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml(
    { manifest: { id: "root", label: '<script>alert(1)</script>', diagram: "a" } },
    engine,
  );
  const manifest = JSON.parse(extractManifestJson(r.html));
  assert.equal(manifest.layers[0].title, "&lt;script&gt;alert(1)&lt;/script&gt;");
  // HTML <title> 也 escape(fillNestedTemplate escapeHtml)
  assert.match(r.html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
});

test("title 默认 = root label(escapeHtml)", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml(
    { manifest: { id: "root", label: "订单系统", diagram: "a" } },
    engine,
  );
  assert.match(r.html, /<title>订单系统<\/title>/);
});

// ──────────────────────────────────────────────────────────────────────────
// 确定性:同输入两次 byte-identical
// ──────────────────────────────────────────────────────────────────────────

test("确定性: 同输入两次 buildNestedHtml → byte-identical HTML", async () => {
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  const { engine: e1 } = makeStubEngine();
  const { engine: e2 } = makeStubEngine();
  const r1 = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, e1);
  const r2 = await buildNestedHtml({ manifest: ecommerceManifest(), darkTheme: "200" }, e2);
  assert.equal(norm(r1.html), norm(r2.html), "两次 HTML byte-identical(golden 基础)");
  assert.equal(r1.bytes, r2.bytes);
  assert.equal(r1.layerCount, r2.layerCount);
});

// ──────────────────────────────────────────────────────────────────────────
// F11 sentinel 碰撞 + 缺失 manifest
// ──────────────────────────────────────────────────────────────────────────

test("F11: 显式 title 含 sentinel 字面 → 抛(防奇怪标题/误用)", async () => {
  const { engine } = makeStubEngine();
  await assert.rejects(
    () =>
      buildNestedHtml(
        { manifest: ecommerceManifest(), title: "__MGM_NESTED_VIEWER_SLOT__" },
        engine,
      ),
    /must not contain reserved sentinel/,
  );
});

test("manifest 缺失 → 抛 [nested-diagram] 前缀", async () => {
  const { engine } = makeStubEngine();
  await assert.rejects(
    () => buildNestedHtml({ manifest: null }, engine),
    /\[nested-diagram\].*manifest.*required/i,
  );
});

// ──────────────────────────────────────────────────────────────────────────
// layerCount + rootSvg 返回值
// ──────────────────────────────────────────────────────────────────────────

test("layerCount = diagram 节点数(不含 container-list)+ rootSvg 非空", async () => {
  const { engine } = makeStubEngine();
  const r = await buildNestedHtml({ manifest: ecommerceManifest() }, engine);
  // root + order 渲染;business 是 container 不计 → layerCount=2
  assert.equal(r.layerCount, 2);
  assert.ok(r.rootSvg.length > 0, "rootSvg 非空(PNG 预览用)");
  assert.match(r.rootSvg, /data-stub-id="root"/);
});
