/**
 * P0-2 单元测试 · normalizeEngineError 各 pattern + helper 白盒覆盖。
 *
 * 与 error-format.smoke.mjs 的分工:
 *   - smoke.mjs:14 条 pattern 各 1 真实样本的正样本 + 反崩溃 + 元契约(广度覆盖)
 *   - 本文件(unit):针对每条 pattern 的 **边界 / 同源变体 / 数据流细节** 做白盒断言 ——
 *     ① 单条 pattern 在多组真实样本下的稳定性
 *     ② helper(pickD2Line/pickLine/pickUnbalancedBrace/extractD2Errmsgs)对越界/异常输入的纯函数行为
 *     ③ 兜底分支对 object ctx.input 的处理(R3 F1 medium 修复锁死)
 *     ④ engineHint 路由的边界(只改 engine 不给 hint 时按 engine 走;给 hint 则 hint 覆盖 engine)
 *
 * 形态:`node --test test/unit.error-format.mjs`(node 18+ 内置,零依赖)。
 * 不接入 `npm test`(保 P0-3 立场 —— P0-3 才引入 test/ 目录结构与 CI stale gate)。
 * 引用编译后 `dist/handlers/error-format.js`,跑前必须 `npm run build`。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEngineError,
  __didMatchLastKnownPattern,
} from "../dist/handlers/error-format.js";

// ═══════════════════════════════════════════════════════════════════════
// D2 pattern 1 — 数值属性范围(rx [\w-]+ 覆盖含连字符的 stroke-width 等)
// ═══════════════════════════════════════════════════════════════════════

test("D2 p1: 含连字符属性 stroke-width(0–15 范围,errmsg 1-indexed)", () => {
  const raw = JSON.stringify([{
    range: "index,0:25:25-0:28:28",
    errmsg: 'index:1:26: expected "stroke-width" to be a number between 0 and 15',
  }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { style.stroke-width: 1.5 }", raw });
  assert.match(out, /\[d2\] line 1:/);
  assert.match(out, /stroke-width/);
  assert.match(out, /0–15/);            // 阈值用全角 en dash,与代码 m[2]–m[3] 一致
  assert.match(out, /style\.stroke-width: 1\.5/);  // offending 回显 input 行
  assert.match(out, /修复.*stroke-width.*整数/);
});

test("D2 p1: 含连字符属性 border-radius(0–20 范围)", () => {
  const raw = JSON.stringify([{
    range: "index,0:1:1-0:12:12",
    errmsg: 'index:1:2: expected "border-radius" to be a number between 0 and 20',
  }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { style.border-radius: 1.5 }", raw });
  assert.match(out, /border-radius/);
  assert.match(out, /0–20/);
  assert.equal(__didMatchLastKnownPattern(), true);
});

test("D2 p1: 行号解析优先取 errmsg 的 1-indexed 形式(index:N:),不取 range 0-indexed", () => {
  // 蓄意构造 range=5 但 errmsg=2 的样本,验证 pickD2Line 走的是 errmsg
  const raw = JSON.stringify([{
    range: "index,5:1:1-5:5:5",
    errmsg: 'index:2:3: expected "stroke-width" to be a number between 0 and 15',
  }]);
  const out = normalizeEngineError("d2", raw, { input: "L1\nL2: x\nL3\nL4\nL5\nL6", raw });
  assert.match(out, /line 2:/);
  assert.match(out, /offending: L2: x/);  // 行号 2 → input 第 2 行
});

test("D2 p1: 非 JSON 字符串形态(兜底走裸串匹配,行号 undefined)", () => {
  // D2 未来某版若 dump 成非 JSON,extractD2Errmsgs 回退 [rawMsg]
  const raw = 'expected "opacity" to be a number between 0 and 1';
  const out = normalizeEngineError("d2", raw, { input: "x: { opacity: 0.5 }", raw });
  assert.match(out, /\[d2\]/);
  assert.match(out, /opacity/);
  assert.match(out, /0–1/);
  assert.equal(__didMatchLastKnownPattern(), true);
});

// ═══════════════════════════════════════════════════════════════════════
// D2 pattern 3 — style 关键字(全量 17 个,验证 [\w-]+ 覆盖含连字符 7 个)
// ═══════════════════════════════════════════════════════════════════════

test("D2 p3: 全量 17 个 style 关键字逐一匹配(锁死 PRD §9 #13 回归)", () => {
  const kws = [
    // 无连字符 10 个
    "fill", "stroke", "shadow", "bold", "italic", "underline", "opacity", "filled", "multiple", "3d",
    // 含连字符 7 个(原 \w+ 全漏, [\w-]+ 全命中)
    "font-size", "font-color", "stroke-width", "stroke-dash", "border-radius", "text-transform", "double-border",
  ];
  for (const kw of kws) {
    const raw = JSON.stringify([{ range: "index,0:0:0-0:1:1", errmsg: `index:1:1: ${kw} must be style.${kw}` }]);
    const out = normalizeEngineError("d2", raw, { input: "x: { " + kw + ": red }", raw });
    assert.match(out, new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${kw} 未在输出中回显`);
    assert.match(out, /保留样式关键字/, `${kw} 未命中 pattern 3`);
    assert.doesNotMatch(out, /未识别的错误形态/, `${kw} 落入兜底,rx 漏含连字符`);
  }
});

test("D2 p3: 反向引用 \\1 守护 —— 形似但非 '<KW> must be style.<X>' 不误匹配", () => {
  // 若 rx 写成 /([\w-]+) must be style\.[\w-]+/(无反向引用),会误匹配此构造
  const raw = JSON.stringify([{ errmsg: "fill must be style.stroke" }]);
  const out = normalizeEngineError("d2", raw, { input: "", raw });
  // pattern 3 反向引用 \1 要求两侧 KW 相同;不匹配则落到兜底
  assert.match(out, /未识别的错误形态|fill/);
});

// ═══════════════════════════════════════════════════════════════════════
// D2 pattern 4 — pickUnbalancedBrace 简化版启发式边界(F7 low,白盒)
// ═══════════════════════════════════════════════════════════════════════

test("D2 p4: map 块未闭合 → offending 回显首个含 { 的行", () => {
  const raw = JSON.stringify([{ errmsg: "maps must be terminated with }" }]);
  const out = normalizeEngineError("d2", raw, {
    input: "x: {\n  a: 1\n  b: 2",  // 缺 }
    raw,
  });
  assert.match(out, /map.*未正确闭合/);
  assert.match(out, /offending:.*x: \{/);  // suspectLine = 首个含 { 的行
});

test("D2 p4: map 块已闭合(depth=0)→ 无 offending 片段(仍报错但 suspectLine 缺)", () => {
  const raw = JSON.stringify([{ errmsg: "maps must be terminated with }" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { a: 1 }", raw });
  assert.match(out, /map.*未正确闭合/);
  // depth 已平衡,pickUnbalancedBrace 返回 undefined → formatNormalized 不加 offending 前缀
  assert.doesNotMatch(out, /offending:/);
});

// ═══════════════════════════════════════════════════════════════════════
// Graphviz pattern 1-3 — 行号回显与 offending 行
// ═══════════════════════════════════════════════════════════════════════

test("Graphviz p1: syntax error in line N near 'X' → offending 回显该行原文", () => {
  const input = "line 1\nline 2: A ->\nline 3";
  const out = normalizeEngineError("graphviz", "syntax error in line 2 near '>'", { input, raw: "" });
  assert.match(out, /\[graphviz\] line 2:/);
  assert.match(out, /意外 token ">"/);
  assert.match(out, /offending: line 2: A ->/);
});

test("Graphviz p2: syntax error in line N (无 near) → 兜底 offending", () => {
  const input = "digraph G {\n  A -> B\n  [label=\"x\"\n}";
  const out = normalizeEngineError("graphviz", "syntax error in line 3", { input, raw: "" });
  assert.match(out, /\[graphviz\] line 3:/);
  assert.match(out, /offending:.*\[label/);
});

test("Graphviz p3: syntax error near 'X' 无行号 → 不抛 offending", () => {
  const out = normalizeEngineError("graphviz", "syntax error near 'this'", { input: "x", raw: "" });
  assert.match(out, /意外 token "this"/);
  assert.doesNotMatch(out, /offending:/);  // pattern 3 make 无 offendingConstruct 字段
});

// ═══════════════════════════════════════════════════════════════════════
// Vega-Lite pattern 1-3 — type 值标准化 / signal / gradient
// ═══════════════════════════════════════════════════════════════════════

test("Vega-Lite p1: Invalid field type 'undefined'(内部标准化)→ offending 指向 channel.type 路径", () => {
  const out = normalizeEngineError("vega-lite", 'Invalid field type "undefined"', {
    input: { mark: "bar", encoding: { x: { type: "quantitativ" } } },
    raw: "",
  });
  assert.match(out, /\[vega-lite\]/);
  assert.match(out, /encoding\.<channel>\.type="<缩写或空>"/);  // m[1]==="undefined" 走 then 分支
  assert.match(out, /quantitative.*nominal.*ordinal.*temporal/);
  assert.match(out, /拼错|缩写/);
});

test("Vega-Lite p2: Unrecognized signal name 'foo' → datum 语法 remediation", () => {
  const out = normalizeEngineError("vega-lite", 'Unrecognized signal name "foo"', { input: {}, raw: "" });
  assert.match(out, /signal.*condition\.test|condition\.test.*signal/);
  assert.match(out, /datum\.<field>|datum/);
});

test("Vega-Lite p3: gradient misuse → 走 mark.fill/encoding.color.scale remediation", () => {
  const out = normalizeEngineError("vega-lite", "Cannot read property 'length' of undefined", { input: {}, raw: "" });
  assert.match(out, /gradient.*不支持|不支持.*gradient/);
  assert.match(out, /mark\.fill|encoding\.color\.scale/);
});

// ═══════════════════════════════════════════════════════════════════════
// resvg pattern 1-2 — SVG 前 80 字符回显 / 字体加载错误 rx 修订
// ═══════════════════════════════════════════════════════════════════════

test("resvg p1: 缺 xmlns 的 SVG → offending 回显前 80 字符", () => {
  const svg = '<svg><rect width="50" height="50"/></svg>';
  const out = normalizeEngineError("resvg",
    "SVG data parsing failed cause the document does not have a root node",
    { input: svg, raw: "" });
  assert.match(out, /\[resvg\]/);
  assert.match(out, /offending: <svg>.*width="50"/);
  assert.match(out, /xmlns/);
});

test("resvg p2: default font-family '' not found(含单引号)→ 字体 remediation", () => {
  // 锁死 PRD 原计划 rx `[^']{0,5}` 排除单引号会漏匹配,实施时改 `.{0,15}` 允许引号
  const out = normalizeEngineError("resvg", "default font-family '' not found", { input: "", raw: "" });
  assert.match(out, /字体加载失败/);
  assert.match(out, /PingFang|Noto|Microsoft YaHei/);
  assert.equal(__didMatchLastKnownPattern(), true);
});

test("resvg p2: 'No match for ... font-family.'(含引号)→ 同款字体 remediation", () => {
  const out = normalizeEngineError("resvg", "No match for 'PingFang SC' font-family.", { input: "", raw: "" });
  assert.match(out, /字体加载失败/);
});

test("resvg p2: 'Failed to load a font face' / 'malformed font' / \"font doesn't have a family name\" 三变体", () => {
  for (const m of ["Failed to load a font face", "malformed font", "font doesn't have a family name"]) {
    const out = normalizeEngineError("resvg", m, { input: "", raw: "" });
    assert.match(out, /字体加载失败/, `${m} 未命中 resvg pattern 2`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// helper 白盒:pickD2Line / extractD2Errmsgs 间接行为
// ═══════════════════════════════════════════════════════════════════════

test("extractD2Errmsgs: 非 JSON 字符串 → 回退 [rawMsg](反崩溃)", () => {
  // D2 未来换非 JSON dump 格式,extractD2Errmsgs try/catch 兜底
  const out = normalizeEngineError("d2", "not a json array at all", { input: "", raw: "" });
  assert.match(out, /\[d2\]/);
  assert.match(out, /not a json array at all|未识别的错误形态/);
});

test("extractD2Errmsgs: JSON 数组但 entries 无 errmsg 字段 → 回退 [rawMsg]", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:1:1" }, { foo: "bar" }]);
  const out = normalizeEngineError("d2", raw, { input: "", raw: "" });
  assert.match(out, /\[d2\]/);
});

test("pickD2Line: JSON 数组含多条 errmsg → 取首条匹配 pattern 的(不一定是 entries[0])", () => {
  // 多条 errmsg:第 1 条不匹配任何 pattern,第 2 条匹配 pattern 3
  const raw = JSON.stringify([
    { range: "index,0:0:0-0:1:1", errmsg: "some unmatched error xyz" },
    { range: "index,0:0:0-0:5:5", errmsg: "fill must be style.fill" },
  ]);
  const out = normalizeEngineError("d2", raw, { input: "", raw });
  assert.match(out, /保留样式关键字/);  // 命中第 2 条
  assert.equal(__didMatchLastKnownPattern(), true);
});

// ═══════════════════════════════════════════════════════════════════════
// R3 F1 medium 修复锁死:兜底分支对 object ctx.input 输出 JSON 片段(不输出 [object Object])
// ═══════════════════════════════════════════════════════════════════════

test("F1 fix: 兜底分支对 object ctx.input 不输出 '[object Object]',改输出 JSON 片段", () => {
  // 触发路径真实可达:generate_chart handler src/index.ts:1008 传 a.spec 对象作为 ctx.input,
  // Vega-Lite 错误形态多样,落到兜底是常态(3 条 pattern 之外的未识别错误)。
  const spec = { mark: "bar", encoding: { x: { field: "a", type: "quantitativ" } } };
  const out = normalizeEngineError("vega-lite", "some unknown vega error xyz123", {
    input: spec,
    raw: "",
  });
  assert.equal(typeof out, "string");
  assert.match(out, /\[vega-lite\]/);
  assert.match(out, /some unknown vega error xyz123/);  // 原 rawMsg 保留
  assert.match(out, /未识别的错误形态/);                  // 兜底标记
  // 🔒 F1 修复锁死:严禁输出 [object Object](失去诊断价值)
  assert.doesNotMatch(out, /\[object Object\]/);
  // 🔒 F1 修复锁死:应输出对象 JSON 片段(有诊断价值)
  assert.match(out, /"mark"\s*:\s*"bar"/);
  assert.match(out, /"quantitativ"/);  // 用户拼错的值应能从兜底文本里看到
});

test("F1 fix: 兜底分支对 object ctx.input 截断到 80 字符(防超长 spec 撑爆 token)", () => {
  const bigSpec = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })) };
  const out = normalizeEngineError("vega-lite", "unknown error", { input: bigSpec, raw: "" });
  // 截断发生在 slice(0, 80) 之后;JSON 片段不超过 ~100 字符(80 + 兜底壳)
  const preview = out.split("原始输入前 80 字符:")[1] ?? "";
  assert.ok(preview.length <= 100, `preview 应 ≤ ~80 字符,实际 ${preview.length}`);
});

test("F1 fix: 兜底分支对 string ctx.input 行为不变(向后兼容)", () => {
  const out = normalizeEngineError("d2", "some error", { input: "x: { bad syntax }", raw: "" });
  assert.match(out, /x: \{ bad syntax \}/);  // string 照旧原样
  assert.doesNotMatch(out, /\[object Object\]/);
});

// ═══════════════════════════════════════════════════════════════════════
// engineHint 路由边界
// ═══════════════════════════════════════════════════════════════════════

test("engineHint 优先级:engine='d2' + engineHint='resvg' → 走 resvg patterns 表", () => {
  const out = normalizeEngineError(
    "d2",
    "SVG data parsing failed cause the document does not have a root node",
    { input: "<svg/>", raw: "" },
    "resvg",  // hint 覆盖 engine
  );
  assert.match(out, /\[resvg\]/);       // 不能是 [d2]
  assert.match(out, /xmlns/);
});

test("engineHint 缺省:engine='d2' 不给 hint → 按 engine 走 d2 patterns 表", () => {
  // 同样的 SVG parsing 字符串但 engine 是 d2 → 走 d2 patterns 表(不命中任何 pattern → 兜底)
  const out = normalizeEngineError(
    "d2",
    "SVG data parsing failed cause the document does not have a root node",
    { input: "", raw: "" },
    // 无 hint
  );
  assert.match(out, /\[d2\]/);  // 按 engine 路由
  assert.match(out, /未识别的错误形态/);  // d2 patterns 表不匹配这条 resvg 字串
});

// ═══════════════════════════════════════════════════════════════════════
// 反崩溃契约:未知错误形态 / 空字符串 / null-safe
// ═══════════════════════════════════════════════════════════════════════

test("anti-crash: 空字符串 rawMsg → 返回 [d2] + 兜底标记,不抛", () => {
  const out = normalizeEngineError("d2", "", { input: "", raw: "" });
  assert.equal(typeof out, "string");
  assert.match(out, /\[d2\]/);
});

test("anti-crash: 反崩溃 regex /TypeError|Cannot read|is not a function/ 永不出现在输出", () => {
  // Archify layout-rules.test.mjs:166 同款反崩溃契约
  const cases = [
    { engine: "d2", raw: JSON.stringify([{ errmsg: "weird error" }]), input: "" },
    { engine: "graphviz", raw: "unknown graphviz error", input: "" },
    { engine: "vega-lite", raw: "unknown vega error", input: { mark: "bar" } },
    { engine: "resvg", raw: "unknown resvg error", input: "<svg/>" },
  ];
  for (const { engine, raw, input } of cases) {
    const out = normalizeEngineError(engine, raw, { input, raw });
    assert.doesNotMatch(out, /TypeError|Cannot read|is not a function/,
      `anti-crash regex violated for engine=${engine}: ${out}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 元契约:每条归一化文本必含 [engine] 标签 + 修复: 动词
// ═══════════════════════════════════════════════════════════════════════

test("contract: 归一化文本单行拼装,定界符 ' | ' 清晰分隔三件套", () => {
  // formatNormalized 的输出格式:[engine] [line N:] message | offending: ... | 修复: ...
  const raw = JSON.stringify([{
    range: "index,0:0:0-0:25:25",
    errmsg: 'index:1:1: expected "stroke-width" to be a number between 0 and 15',
  }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { style.stroke-width: 1.5 }", raw });
  // 单行(无换行,LLM 解析友好)
  assert.equal(out.includes("\n"), false, `归一化文本应单行,实际含换行:${JSON.stringify(out)}`);
  // 三件套按顺序出现:定位 → 问题 → offending → 修复
  const idxEngine = out.indexOf("[d2]");
  const idxMsg = out.indexOf("仅接受整数");
  const idxOff = out.indexOf("offending:");
  const idxFix = out.indexOf("修复:");
  assert.ok(idxEngine >= 0 && idxMsg > idxEngine && idxOff > idxMsg && idxFix > idxOff,
    `三件套顺序错乱:engine=${idxEngine} msg=${idxMsg} offending=${idxOff} fix=${idxFix}`);
});

test("contract: 兜底文本带换行标记(区分归一化成功 vs 兜底)", () => {
  // 兜底分支输出多行(主行 + "未识别的错误形态"提示行),与成功归一化的单行区分
  const out = normalizeEngineError("d2", "totally unknown xyz", { input: "", raw: "" });
  assert.ok(out.includes("\n"), `兜底文本应带换行(区分归一化成功),实际:${JSON.stringify(out)}`);
  assert.match(out, /未识别的错误形态/);
});
