/**
 * Phase 3 BLOCKING 修复 —— viewer-stack 运行时导航逻辑的真 DOM E2E 测试。
 *
 * 03 §2.3 smoke / full user journey。Phase 3 审查 BLOCKING finding(已 L3 复现确认):
 *   16 条 stub 契约测试只做 HTML 字面 regex,从未在 DOM 跑 VIEWER_NESTED_JS IIFE。
 *   mutation(删两处 INV-2 守卫)后契约测试全绿,但 viewer 安全边界 silently 破坏
 *   —— cc-status-dot v0.5.18 "verdict=ship 但实战崩" 同构。
 *
 * 本套件在真 DOM(puppeteer-core + Chrome)跑 viewer IIFE,断言运行时行为:
 *   - drill swap(template-store stage.innerHTML 切换 + 面包屑 + hash + up 按钮)
 *   - INV-2 hash 逃树拒绝(restoreFromHash 沿 children 链校验)
 *   - INV-2 drill 非 child 拒绝(drillInto child 检查)
 *   - Esc 语义切分(stack>1 goUp;stack=1 reset zoom)
 *   - container-list 卡片渲染 + 卡片 drill
 *   - 面包屑 >5 折叠(head2 + … + tail2)
 *
 * Chrome 不可用时整套 skip(puppeteer-core 不绑 Chrome;CI 无 Chrome 时降级,本地抓 mutation)。
 * 用 stub engine(快、确定性)+ container 卡片(viewer 从 store 生成,可靠)+ hash 注入测 INV-2,
 * 不依赖真 D2 WASM 60s 冷启。
 *
 * License:本文件为 P0-5B 自研。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildNestedHtml } from "../dist/nested-diagram/index.js";
import { NESTED_SALT_PREFIX } from "../dist/nested-diagram/manifest-types.js";

// ── Chrome 探测(复用 render-svg.ts channel:"chrome" 范式)──
let browser = null;
let page = null;
let chromeAvailable = true;
const tmpDir = mkdtempSync(path.join(tmpdir(), "nested-e2e-"));

before(async () => {
  try {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      channel: "chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    page = await browser.newPage();
  } catch (e) {
    chromeAvailable = false;
    console.warn(`[nested-viewer.e2e] Chrome 不可用,整套 skip:${(e?.message ?? String(e)).slice(0, 120)}`);
  }
});

after(async () => {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
  }
});

/** stub D2Engine:产含 @media dark 块(模拟 D2 darkThemeID)+ 闭合标签。 */
function stubEngine() {
  return {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["architecture"],
    render: async (req) => {
      const id = req.salt.replace(NESTED_SALT_PREFIX, "");
      const dark = req.darkTheme && req.darkTheme.trim()
        ? '<style>@media screen and (prefers-color-scheme:dark){rect{fill:#0f172a}}</style>'
        : "";
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-stub-id="${id}">${dark}<rect width="50" height="50"/><text>${id}</text></svg>`,
      };
    },
  };
}

/** 构 HTML + 落盘 + page.goto,返回 page(已加载)。 */
async function loadManifest(manifest, opts = {}) {
  const built = await buildNestedHtml(
    { manifest, darkTheme: opts.darkTheme ?? "200" },
    stubEngine(),
  );
  const file = path.join(tmpDir, `case-${opts.name ?? Math.random().toString(36).slice(2)}.html`);
  writeFileSync(file, built.html, "utf-8");
  await page.goto("file://" + file, { waitUntil: "load" });
  return file;
}

/** 在 page 里 dispatch drill(模拟真点击:SVG <a> 无 .click(),用 dispatchEvent MouseEvent)。 */
async function drillVia(cardOrAnchorSelector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error("drill target not found: " + sel);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, cardOrAnchorSelector);
}

/** 读 viewer 当前运行时状态。 */
async function viewerState() {
  return page.evaluate(() => {
    const stage = document.getElementById("mgm-stage");
    const bc = document.getElementById("mgm-breadcrumb");
    const svg = stage.querySelector("svg");
    const cards = stage.querySelectorAll("button[data-drill]");
    return {
      hash: location.hash,
      stageStubId: svg ? svg.getAttribute("data-stub-id") : null,
      isContainerCards: cards.length > 0,
      cardCount: cards.length,
      bcText: bc.textContent,
      bcDisplay: bc.style.display,
      crumbCount: bc.querySelectorAll(".mgm-crumb, .mgm-crumb-current").length,
      hasEllipsis: !!bc.querySelector(".mgm-crumb-ellipsis"),
      upDisabled: document.getElementById("mgm-btn-up").disabled,
      placeholder: /聚合层/.test(stage.innerHTML) ? stage.querySelector(".mgm-container-placeholder")?.textContent : null,
    };
  });
}

// 3 层 manifest:root container → a container → a1 leaf;b 是 root 另一子(非 a 的 child,测 INV-2)
const manifest3 = {
  id: "root", label: "Root", diagram: "", children: [
    { id: "a", label: "A", diagram: "", children: [
      { id: "a1", label: "A1", diagram: "a1d" },
    ]},
    { id: "b", label: "B", diagram: "bd" },
  ],
};

// ──────────────────────────────────────────────────────────────────────────
// 各测试:Chrome 不可用时 skip
// ──────────────────────────────────────────────────────────────────────────

test("drill swap: root container 卡片 → 点 a → stage 切到 a 的卡片 + 面包屑 + hash + up 启用", async () => {
  if (!chromeAvailable) return;
  await loadManifest(manifest3, { name: "drill-swap" });
  // 初始:root container,2 张卡片(a, b)
  let s = await viewerState();
  assert.equal(s.stageStubId, null, "root 是 container,stage 无 svg(卡片)");
  assert.equal(s.cardCount, 2, "root container 显 a/b 2 卡片");
  assert.equal(s.upDisabled, true, "stack=1 up 禁用");
  assert.equal(s.bcDisplay, "none", "单层面包屑隐藏");
  // 点 a 卡片 → drill 进 a
  await drillVia('button[data-drill="a"]');
  s = await viewerState();
  assert.equal(s.hash, "#path=root%2Fa", "hash 同步到 root/a");
  assert.equal(s.stageStubId, null, "a 也是 container,stage 显卡片");
  assert.equal(s.cardCount, 1, "a container 显 a1 1 卡片");
  assert.equal(s.bcText, "Root/A", "面包屑显路径");
  assert.equal(s.upDisabled, false, "stack=2 up 启用");
});

test("INV-2 hash 逃树拒绝: #path=root/a/b(b 非 a 的 child)→ stack 留 root", async () => {
  if (!chromeAvailable) return;
  // 直接 goto 带 hash 的 URL,触发 restoreFromHash
  const built = await buildNestedHtml({ manifest: manifest3, darkTheme: "200" }, stubEngine());
  const file = path.join(tmpDir, "inv2-hash.html");
  writeFileSync(file, built.html, "utf-8");
  await page.goto("file://" + file + "#path=root/a/b", { waitUntil: "load" });
  const s = await viewerState();
  // b 不是 a 的 child(a.children=[a1])→ INV-2 拒,stack 留 [root]
  assert.equal(s.stageStubId, null, "留 root container(卡片)");
  assert.equal(s.cardCount, 2, "root 的 2 卡片");
  assert.equal(s.bcText, "", "面包屑空(stack=[root])");
  assert.equal(s.upDisabled, true, "stack=1 up 禁用");
});

test("INV-2 drill 非 child 拒绝: 在 a 注入 drill:b(b 非 a child)→ stack 留 [root,a]", async () => {
  if (!chromeAvailable) return;
  await loadManifest(manifest3, { name: "inv2-drill" });
  await drillVia('button[data-drill="a"]'); // root → a(合法)
  let s = await viewerState();
  assert.equal(s.bcText, "Root/A");
  // 注入一个伪 drill 链接到 b(非 a 的 child),点它
  await page.evaluate(() => {
    const stage = document.getElementById("mgm-stage");
    const fake = document.createElement("a");
    fake.setAttribute("href", "drill:b");
    fake.id = "fake-drill-b";
    fake.textContent = "fake";
    stage.appendChild(fake);
    fake.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  s = await viewerState();
  // INV-2:b 不是 a 的 child → drillInto 拒,stack 留 [root, a]
  assert.equal(s.bcText, "Root/A", "drill 非 child 被拒,面包屑不变");
  assert.equal(s.hash, "#path=root%2Fa", "hash 不变");
});

test("Esc goUp: drill root→a→a1 后 Esc 两次 → 逐层回 root", async () => {
  if (!chromeAvailable) return;
  await loadManifest(manifest3, { name: "esc" });
  await drillVia('button[data-drill="a"]'); // → a
  await drillVia('button[data-drill="a1"]'); // → a1
  let s = await viewerState();
  assert.equal(s.stageStubId, "a1", "在 a1 图");
  assert.equal(s.bcText, "Root/A/A1");
  // Esc 1 → 回 a
  await page.keyboard.press("Escape");
  s = await viewerState();
  assert.equal(s.stageStubId, null, "回 a container(卡片)");
  assert.equal(s.bcText, "Root/A");
  // Esc 2 → 回 root(stack=1,Esc 应 reset zoom 非继续上溯)
  await page.keyboard.press("Escape");
  s = await viewerState();
  assert.equal(s.bcText, "", "回 root(面包屑空)");
  assert.equal(s.upDisabled, true, "stack=1 up 禁用");
  assert.equal(s.cardCount, 2, "root 卡片");
});

test("面包屑 >5 折叠: 6 级链 drill 到底 → head2 + … + tail2(4 crumb + 1 ellipsis)", async () => {
  if (!chromeAvailable) return;
  // 程序化构建 6 级链:n0→n1→n2→n3→n4→n5(n0..n4 container,n5 leaf)
  let manifest6 = { id: "n5", label: "L5", diagram: "leaf" };
  for (let i = 4; i >= 0; i--) {
    manifest6 = { id: "n" + i, label: "L" + i, diagram: "", children: [manifest6] };
  }
  await loadManifest(manifest6, { name: "fold" });
  // 逐层 drill 到 n5
  for (const id of ["n1", "n2", "n3", "n4", "n5"]) {
    await drillVia(`button[data-drill="${id}"]`);
  }
  const s = await viewerState();
  assert.equal(s.stageStubId, "n5", "到达 n5 叶子图");
  assert.ok(s.hasEllipsis, "stack=6 > 5 → 含 ellipsis");
  assert.equal(s.crumbCount, 4, "head2 + tail2 = 4 crumb(不含 ellipsis)");
  assert.match(s.bcText, /L0.*L4.*L5/, "root(L0)与 current(L5)永显");
});

test("restoreFromHash malformed URI escape 降级 root: #path=% → 不崩,留 root", async () => {
  if (!chromeAvailable) return;
  const built = await buildNestedHtml({ manifest: manifest3, darkTheme: "200" }, stubEngine());
  const file = path.join(tmpDir, "malformed.html");
  writeFileSync(file, built.html, "utf-8");
  await page.goto("file://" + file + "#path=%", { waitUntil: "load" });
  const s = await viewerState();
  // 裸 % decodeURIComponent 抛 URIError → try/catch 降级,stack=[root],UI 正常初始化
  assert.equal(s.cardCount, 2, "malformed hash 降级 root,显卡片(UI 未崩)");
  assert.equal(s.upDisabled, true, "stack=1");
});
