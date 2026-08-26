// P0-2 §4.2.2 pattern 3 未决点调查脚本
// 目的:实测 D2 对每个保留样式关键字被误用作属性名/shape 名时的 errmsg 形态
// 验证 rx /(\w+) must be style\.\1/ 是否覆盖所有保留字
//
// 运行方式:
//   cd /Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp
//   node /Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/d2-reserved-word-probe.mjs

import { D2 } from "/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/node_modules/@terrastruct/d2/dist/node-esm/index.js";

const d2 = new D2();
await d2.ready;

// D2 Style 接口的全部保留键(来自 @terrastruct/d2/index.d.ts Style interface)
// DSL 语法用 kebab-case
const reservedStyleKeywords = [
  "opacity",
  "stroke",
  "fill",
  "fill-pattern",
  "stroke-width",
  "stroke-dash",
  "border-radius",
  "shadow",
  "3d",
  "multiple",
  "font",
  "font-size",
  "font-color",
  "animated",
  "bold",
  "italic",
  "underline",
  "filled",
  "double-border",
  "text-transform",
];

// 待测试场景:
//  场景 A:文档 §4.2.2 pattern 3 注释给的触发输入 "a: { shape: oval; fill: red }"
//          (map 块内同行分号把 fill 当 shape 名)
//  场景 B:保留字当顶层节点名 "fill: hello"
//  场景 C:保留字当内层属性 "a: { fill: red }"(单属性块,非同行多属性)
//  场景 D:保留字当 shape 名 "fill: { label: x }"
const scenarios = {
  A_sameLineSemicolon: (kw) => `a: { shape: oval; ${kw}: red }`,
  B_topLevelNode: (kw) => `${kw}: hello`,
  C_singleLineInBlock: (kw) => `a: { ${kw}: red }`,
  D_asShapeName: (kw) => `${kw}: { label: x }`,
};

console.log("=== D2 保留字 errmsg 形态实测 ===\n");

const results = [];
for (const kw of reservedStyleKeywords) {
  for (const [scenarioName, fn] of Object.entries(scenarios)) {
    const code = fn(kw);
    try {
      const compiled = await d2.compile(code);
      results.push({ kw, scenario: scenarioName, code, ok: true, errmsg: null });
      console.log(`[OK no err] kw=${kw.padEnd(15)} scenario=${scenarioName.padEnd(22)} code=${JSON.stringify(code)}`);
    } catch (e) {
      const msg = e?.message ?? String(e);
      results.push({ kw, scenario: scenarioName, code, ok: false, errmsg: msg });
      console.log(`[ERR]      kw=${kw.padEnd(15)} scenario=${scenarioName.padEnd(22)}`);
      console.log(`          code=${JSON.stringify(code)}`);
      console.log(`          msg=${msg}`);
    }
  }
}

// 汇总:对触发了错误的,分析 errmsg 形态
console.log("\n\n=== 形态汇总 ===");
const errResults = results.filter((r) => !r.ok);
const forms = {};
for (const r of errResults) {
  // 归一化 errmsg(去掉具体 kw,看模板)
  let form = r.errmsg;
  // 提取主要 errmsg(JSON 数组的话取每条 errmsg 字段)
  try {
    const parsed = JSON.parse(r.errmsg);
    if (Array.isArray(parsed)) {
      form = parsed.map((e) => e.errmsg).join(" | ");
    }
  } catch {
    /* keep as-is */
  }
  // 替换当前 kw 为 <KW> 看模板形态
  const templated = form.replaceAll(r.kw, "<KW>");
  if (!forms[templated]) forms[templated] = [];
  forms[templated].push(`${r.kw}@${r.scenario}`);
}

console.log("\n errmsg 模板形态分组:");
for (const [tpl, cases] of Object.entries(forms)) {
  console.log(`\n  模板: ${tpl}`);
  console.log(`  命中 (${cases.length}): ${cases.join(", ")}`);
}

// 验证文档里的 regex 是否能匹配所有
console.log("\n\n=== regex 验证 ===");
const docRegex = /(\w+) must be style\.\1/;
for (const r of errResults) {
  let testStr = r.errmsg;
  try {
    const parsed = JSON.parse(r.errmsg);
    if (Array.isArray(parsed)) {
      testStr = parsed.map((e) => e.errmsg).join("\n");
    }
  } catch {
    /* keep as-is */
  }
  const matched = docRegex.test(testStr);
  console.log(
    `  kw=${r.kw.padEnd(15)} scenario=${r.scenario.padEnd(22)} matched=${matched}  errmsg=${testStr.slice(0, 120)}`,
  );
}

// 写出 JSON 全量结果
const outPath = "/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/d2-reserved-word-probe-results.json";
const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n全量结果写入: ${outPath}`);

process.exit(0);
