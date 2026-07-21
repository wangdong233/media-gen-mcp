/**
 * P0-5 交互式 HTML 图 —— 契约测试套件。
 *
 * golden 之外覆盖:
 *   S2  无外链 <script src=
 *   S3  light/dark 几何 byte-identical(strip <style> 后比对)
 *   S4  darkTheme 传入时含 @media ... prefers-color-scheme:dark
 *   S5  同输入两次 byte-identical
 *   S6  HTML ≤ 256KB
 *   S9  prefers-reduced-motion + data-motion="still"
 *   S11 无 <?xml?
 *   S12 stub engine 注入 → 验证 D2 渲染传固定 salt + noXMLTag
 *   mutation: empty code / unknown theme → 抛错
 *
 * 走 node:test runner;buildInteractiveHtml 不落盘,直接返 HTML 字符串。
 * License:P0-5 自研。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInteractiveHtml, renderInteractiveHtml } from "../dist/interactive-html/index.js";

const FIXTURE = "test/golden/fixtures/interactive-html/architecture.d2";
const code = () => readFileSync(FIXTURE, "utf8");
const TMP = "/tmp/mgm-contract";

// S2:产物单文件自包含 —— 禁外链 <script src=。
test("S2: 无外链 <script src=", async () => {
  const r = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  assert.doesNotMatch(r.html, /<script\b[^>]*\bsrc\s*=/);
});

// S3:light/dark 几何 byte-identical(strip <style> + 内联 fill/stroke 后比对,只比几何结构)。
// dark 版的 SVG 改用 CSS-class-only 着色(D2 darkThemeID 触发:去内联 fill/stroke 让 @media 能切换),
// 故除 <style> 块外,还需抹内联 fill/stroke 属性,余下几何(路径 d/rect xy/text xy+content/viewBox)不变。
test("S3: light/dark 几何 byte-identical(stripped style + fill/stroke)", async () => {
  const extractGeometry = (h) => {
    const svg = /<svg[\s\S]*?<\/svg>/.exec(h)?.[0] ?? "";
    return svg
      // 抹 <style>...</style> 块(含 CDATA)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // 抹内联 fill="..." / stroke="..." 属性(dark 模式 D2 用 CSS class 替代;几何无关)
      .replace(/\s(?:fill|stroke)\s*=\s*"[^"]*"/gi, "")
      // 抹多空格(属性抹后留的双空格)
      .replace(/\s{2,}/g, " ")
      .replace(/\s+>/g, ">");
  };
  const r1 = await buildInteractiveHtml({ code: code() });
  const r2 = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  const g1 = extractGeometry(r1.html);
  const g2 = extractGeometry(r2.html);
  assert.equal(g1, g2, "geometry (SVG minus <style> + fill/stroke) must be byte-identical between light and dual-palette renders");
});

// S4:darkTheme 传入时含 @media ... prefers-color-scheme:dark(D2 WASM 实际格式)。
test("S4: darkTheme=default → HTML/SVG 含 @media ... prefers-color-scheme:dark", async () => {
  const r = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  // D2 WASM 实际产出:`@media screen and (prefers-color-scheme:dark){...}`(实测 2026-07-22)。
  assert.match(r.html, /@media[^{]*prefers-color-scheme\s*:\s*dark\b/);
});

// S4 反例:darkTheme 不传 → 不应注入 @media ... prefers-color-scheme:dark 块。
// 注:viewer pre-paint resolver 含字面字符串 'prefers-color-scheme: dark'(用于 matchMedia 探测),
// 故必须用与 S4 正例相同的 @media-anchored 正则,而非裸字符串匹配。
test("S4 反例: 不传 darkTheme → 不含 @media prefers-color-scheme:dark 块", async () => {
  const r = await buildInteractiveHtml({ code: code() });
  assert.doesNotMatch(r.html, /@media[^{]*prefers-color-scheme\s*:\s*dark\b/);
});

// S5:同输入两次 byte-identical(CRLF 归一化后)。
test("S5: 同输入两次 byte-identical", async () => {
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  const r1 = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  const r2 = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  assert.equal(norm(r1.html), norm(r2.html));
});

// S6:HTML ≤ 256KB。
test("S6: HTML ≤ 256KB", async () => {
  const r = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  assert.ok(r.bytes <= 256 * 1024, `bytes=${r.bytes} > 256KB`);
});

// S9:prefers-reduced-motion 规则存在。
test("S9: prefers-reduced-motion 规则存在", async () => {
  const r = await buildInteractiveHtml({ code: code() });
  assert.match(r.html, /prefers-reduced-motion\s*:\s*reduce/);
});

// S9:data-motion="still" 选择器存在。
test("S9: data-motion=\"still\" 选择器存在", async () => {
  const r = await buildInteractiveHtml({ code: code() });
  assert.match(r.html, /data-motion\s*=\s*["']still["']/);
});

// S11:无 <?xml? 声明(C2 防线)。
test("S11: 无 <?xml? 声明", async () => {
  const r = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  assert.doesNotMatch(r.html, /<\?xml/);
});

// S12:D2 渲染传固定 salt + noXMLTag(stub engine 注入,capturedOpts 验证)。
test("S12: D2 渲染传固定 salt='media-gen-mcp-interactive' + noXMLTag=true", async () => {
  let capturedOpts;
  const stubEngine = {
    name: "d2",
    isAvailable: () => true,
    listTypes: () => ["flowchart"],
    render: async (req) => {
      capturedOpts = req;
      return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="50" height="50"/></svg>' };
    },
  };
  await buildInteractiveHtml({ code: "a -> b" }, stubEngine);
  assert.equal(capturedOpts.salt, "media-gen-mcp-interactive");
  assert.equal(capturedOpts.noXMLTag, true);
  assert.equal(capturedOpts.engine, "d2");
  assert.equal(capturedOpts.format, "svg");
});

// mutation:empty code → 抛错含 'code'。
test("mutation: empty code → 抛错含 'code'", async () => {
  await assert.rejects(
    () => buildInteractiveHtml({ code: "" }),
    /code/i,
  );
});

// mutation:whitespace-only code → 抛错。
test("mutation: whitespace-only code → 抛错", async () => {
  await assert.rejects(
    () => buildInteractiveHtml({ code: "   \n  " }),
    /code/i,
  );
});

// mutation:unknown theme → 抛错含 known 列表。
test("mutation: unknown theme → 抛错含 known 列表", async () => {
  await assert.rejects(
    () => buildInteractiveHtml({ code: "a -> b", theme: "nope" }),
    /default|neutral|已知/,
  );
});

// mutation:unknown darkTheme → 抛错。
test("mutation: unknown darkTheme → 抛错", async () => {
  await assert.rejects(
    () => buildInteractiveHtml({ code: "a -> b", darkTheme: "nope" }),
    /default|neutral|已知/,
  );
});

// renderInteractiveHtml 落盘路径正确性(含 bytes / has_dual_palette)。
test("renderInteractiveHtml 落盘 + 返回 localPath/bytes", async () => {
  const r = await renderInteractiveHtml({
    code: code(), darkTheme: "default",
    outDir: TMP, name: "contract-rendered",
  });
  assert.match(r.localPath, /contract-rendered\.html$/);
  assert.ok(r.bytes > 0);
  assert.equal(r.hasDarkLightDualPalette, true);
  const html = readFileSync(r.localPath, "utf8");
  assert.match(html, /<!doctype html>/i);
});

// hasDualPalette:false when darkTheme omitted。
test("hasDarkLightDualPalette=false when darkTheme omitted", async () => {
  const r = await buildInteractiveHtml({ code: code() });
  assert.equal(r.hasDarkLightDualPalette, false);
});

// 大小写敏感字段名验证:darkThemeID(全大写)。
// 这条断言间接 —— 如果 darkThemeID 写成 darkThemeId(驼峰),D2 不会注入 @media,
// 上面的 S4 测试就会失败。这里再显式断言 HTML 含注入证据。
test("darkThemeID 字段大写正确(D2 注入了 dark palette CSS)", async () => {
  const r = await buildInteractiveHtml({ code: code(), darkTheme: "default" });
  // D2 darkThemeID 注入会产 .fill-B1 / .stroke-B1 等 dark palette 类(B=Blue/dark 系)
  assert.match(r.html, /\.fill-B\d+\s*\{/);
});
