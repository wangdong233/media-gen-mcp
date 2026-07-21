/**
 * P0-2 冒烟测试:LLM 友好错误契约(handler 层引擎 stderr 归一化)。
 *
 * 形态:`node --test test/error-format.smoke.mjs` 单文件可跑(node 18+ 内置,零依赖)。
 * **不接入 `npm test`**(保 P0-3 立场 —— P0-3 才正式引入 test/ 目录结构、tsconfig.test.json、
 * CI stale gate、`npm test` 接入)。P0-2 交付时实施者本地手动 `node --test` 触发。
 *
 * 引用 `dist/handlers/error-format.js`(编译后 JS),与 `check-schema.mjs` 同模式;
 * 实施者跑测试前必须先 `npm run build` 让 dist 存在。
 *
 * 测试矩阵:
 *   - 14 条 knownErrorPatterns 各 1 真实样本(D2 ×6 / Graphviz ×3 / Vega-Lite ×3 / resvg ×2)
 *   - 2 条 D2 含连字符 style 关键字锁死(锁死 pares2/01-功能分析.md §9 open_point #13 回归)
 *   - D2 真实 Go 错误模板负样本(锁死不被误路由到 resvg patterns,§9 open_point #11)
 *   - 反崩溃契约(未知错误形态不抛,返回兜底)
 *   - 元契约(每条归一化文本必含 [engine] 标签 + 修复动词)
 *   - Graphviz bug 锁死 e2e(`digraph G { A -> }` 抛 syntax error 而非 produced no SVG)
 *   - PNG 复用 [resvg] 前缀路由(engineHint 结构性路由)
 *   - chart.ts PNG 复用 [resvg] 前缀锁死 e2e(node:module register 装 loader 把 @resvg/resvg-js
 *     替换成总抛错的 mock,验证 chart.js 内层 throw 经 outer 层不被 "Vega-Lite render error:" 重包装)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEngineError,
  __didMatchLastKnownPattern,
} from "../dist/handlers/error-format.js";

// ───────────────────────── D2(6 条 pattern 各 1 真实样本)─────────────────────────

test("D2 pattern 1: float stroke-width → '整数' + '0–15' + offending", () => {
  // 注意:实测样本errmsg 形态 `expected "stroke-width" to be a number between 0 and 15`
  // ⚠️ stroke-width 含连字符,rx 必须用 [\w-]+ 而非 \w+(同款 bug 见 pattern 3,实施时实测发现)
  // 真实 D2 输出(D2Engine.render 实测,errmsg 1-indexed 行号):
  //   range="index,0:25:25-0:28:28"(0-indexed),errmsg="index:1:26: expected ..."(1-indexed)
  //   —— 同一行不同索引基准。pickD2Line 优先解析 errmsg(用户实际看到的形式)。
  const raw = JSON.stringify([{
    range: "index,0:25:25-0:28:28",
    errmsg: 'index:1:26: expected "stroke-width" to be a number between 0 and 15',
  }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { style.stroke-width: 1.5 }", raw });
  assert.match(out, /\[d2\]/);
  assert.match(out, /stroke-width/);
  assert.match(out, /0–15|0-15/);
  assert.match(out, /整数/);               // 阈值 + 修复动词
  assert.match(out, /offending:/);          // offending 片段回显
  assert.match(out, /line 1/);              // 行号(从 errmsg index:1: 提取)
  assert.doesNotMatch(out, /TypeError|Cannot read/);
  assert.equal(__didMatchLastKnownPattern(), true);
});

test("D2 pattern 2: missing value after colon (#hex 未加引号)", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "missing value after colon" }]);
  const out = normalizeEngineError("d2", raw, { input: 'x: { style.fill: #ff0000 }', raw });
  assert.match(out, /注释符|#/);
  assert.match(out, /修复/);
  assert.match(out, /加引号|quanc/);
});

test("D2 pattern 3: reserved style keyword (fill must be style.fill)", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "index:1:1: fill must be style.fill" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { shape: oval; fill: red }", raw });
  assert.match(out, /fill/);
  assert.match(out, /保留样式关键字/);
  assert.match(out, /style\.fill/);
});

test("D2 pattern 4: maps must be terminated with }", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "maps must be terminated with }" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: {\n  a: 1\n", raw });
  assert.match(out, /map|未正确闭合|块/);
  assert.match(out, /修复/);
});

test("D2 pattern 5: connection missing destination", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "connection missing destination" }]);
  const out = normalizeEngineError("d2", raw, { input: "a -> b ->", raw });
  assert.match(out, /连接箭头|缺目标节点/);
  assert.match(out, /a -> b/);
});

test("D2 pattern 6: one of (enum)", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "one of expected: foo, bar, baz" }]);
  const out = normalizeEngineError("d2", raw, { input: "", raw });
  assert.match(out, /非法枚举值/);
  assert.match(out, /foo, bar, baz/);
});

// ───────────────────────── D2 含连字符 style 关键字(锁死 §9 #13 回归)─────────────────────────

test("D2 hyphenated keyword (font-size must be style.font-size) — lock §9 #13 regression", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:7:7", errmsg: "index:1:1: font-size must be style.font-size" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { font-size: red }", raw });
  assert.match(out, /font-size/);
  assert.match(out, /保留样式关键字/);
  assert.doesNotMatch(out, /未识别的错误形态/);  // 必须命中 pattern 3,不落入兜底
});

test("D2 hyphenated keyword (border-radius must be style.border-radius) — lock §9 #13 regression", () => {
  const raw = JSON.stringify([{ range: "index,0:0:0-0:11:11", errmsg: "index:1:1: border-radius must be style.border-radius" }]);
  const out = normalizeEngineError("d2", raw, { input: "x: { border-radius: red }", raw });
  assert.match(out, /border-radius/);
  assert.match(out, /保留样式关键字/);
  assert.doesNotMatch(out, /未识别的错误形态/);
});

// ───────────────────────── D2 真实 Go 错误模板负样本(锁死不被误路由到 resvg patterns)─────────────────────────

test("D2 negative: Go-style errors not misrouted to resvg patterns — lock §9 #11", () => {
  const goErrs = [
    "maps must be terminated with }",
    "failed to parse map key %q: %w",
    "connection missing destination",
    '%s" is not a valid theme code',
    "classes cannot contain an edge",
  ];
  for (const goErr of goErrs) {
    const raw = JSON.stringify([{ errmsg: goErr, range: "index,0:0:0-0:1:1" }]);
    const out = normalizeEngineError("d2", raw, { input: "", raw });
    // 要么命中 d2 pattern,要么走 d2 兜底;**绝不能**返回 resvg 归一化文本
    assert.doesNotMatch(out, /字体加载失败|resvg 解析 SVG 失败|xmlns/,
      `Go error "${goErr}" was misrouted to resvg: ${out}`);
    // 仍保留 [d2] 标签
    assert.match(out, /\[d2\]/);
  }
});

// ───────────────────────── Graphviz(3 条 pattern,修复后的样本)─────────────────────────

test("Graphviz pattern 1: syntax error near '}'", () => {
  const out = normalizeEngineError("graphviz", "syntax error in line 1 near '}'", {
    input: "digraph G { A -> }",
    raw: "",
  });
  assert.match(out, /\[graphviz\]/);
  assert.match(out, /line 1/);
  assert.match(out, /offending:.*\}/);
  assert.match(out, /大括号|配对|节点/);
  assert.match(out, /修复/);
});

test("Graphviz pattern 2: syntax error in line N (no near)", () => {
  const out = normalizeEngineError("graphviz", "syntax error in line 2", {
    input: "digraph G {\n  A -> B\n  [label=\"x\"\n}",
    raw: "",
  });
  assert.match(out, /line 2/);
  assert.match(out, /DOT 语法错/);
});

test("Graphviz pattern 3: syntax error near 'X' (no line number)", () => {
  const out = normalizeEngineError("graphviz", "syntax error near 'this'", {
    input: "this is not dot at all",
    raw: "",
  });
  assert.match(out, /意外 token "this"/);
  assert.match(out, /修复/);
});

// ───────────────────────── Vega-Lite(3 条 pattern)─────────────────────────

test("Vega-Lite pattern 1: Invalid field type (type:'quantitativ' typo)", () => {
  // 注意:type:"quant" 被 vega-lite v5.22 静默接受为 quantitative 缩写,不触发该错;
  // 真触发是 type:"quantitativ"(拼写错)/ type:"foo" / type:null。
  // 详见 pares2/01-功能分析.md §9.1 open_point #14(样本订正)。
  const out = normalizeEngineError("vega-lite", 'Vega-Lite spec error: Invalid field type "undefined"', {
    input: { mark: "bar", encoding: { x: { field: "a", type: "quantitativ" } } },
    raw: "",
  });
  assert.match(out, /\[vega-lite\]/);
  assert.match(out, /quantitative/);
  assert.match(out, /nominal/);
  assert.match(out, /ordinal/);
  assert.match(out, /temporal/);
  assert.match(out, /缩写|拼/);
});

test("Vega-Lite pattern 2: Unrecognized signal name", () => {
  const out = normalizeEngineError("vega-lite", "Unrecognized signal name \"foo\"", { input: {}, raw: "" });
  assert.match(out, /signal|condition\.test/);
  assert.match(out, /datum/);
});

test("Vega-Lite pattern 3: gradient misuse", () => {
  const out = normalizeEngineError("vega-lite", "Cannot read property 'length' of undefined", { input: {}, raw: "" });
  assert.match(out, /gradient/);
  assert.match(out, /修复/);
});

// ───────────────────────── resvg(2 条 pattern)─────────────────────────

test("resvg pattern 1: SVG data parsing failed / no root node", () => {
  const out = normalizeEngineError("resvg",
    "SVG data parsing failed cause the document does not have a root node",
    { input: "<svg><rect width=\"50\" height=\"50\"/></svg>", raw: "" });
  assert.match(out, /\[resvg\]/);
  assert.match(out, /xmlns/);
  assert.match(out, /offending: <svg>/);          // 前 80 字符回显(format 用 "offending: <片>" 带空格)
  assert.match(out, /修复/);
});

// P0-2 第 2 轮审查修复锁死:chart handler(src/index.ts:1008)在 PNG 复用路径抛 [resvg] 错时,
// 传的 ctx.input 是 Vega-Lite spec 对象(`{ input: a.spec as Record<string,unknown>, ... }`),
// 而非字符串。历史 bug:resvg pattern 1 的 make 函数 `(ctx.input as string).slice(0, 80)`
// 在对象上抛 TypeError → 穿透到顶层 catch → 用户看到 'ctx.input.slice is not a function'
// 而非 [resvg] 归一化文本,违反 PRD §1.2.4 + §3.2 反崩溃契约。
test("resvg pattern 1: object ctx.input (chart handler PNG reuse path) does not crash", () => {
  const spec = { mark: "bar", data: { values: [{ a: 1 }] }, encoding: { x: { field: "a", type: "quantitative" } } };
  const raw = "[resvg] SVG data parsing failed cause the document does not have a root node";
  const stripped = raw.replace(/^\[resvg\] /i, "");
  const out = normalizeEngineError("resvg", stripped, { input: spec, raw }, "resvg");
  assert.match(out, /\[resvg\]/);
  assert.match(out, /xmlns/);
  assert.match(out, /offending:/);                          // 仍回显片段(JSON 序列化后的前 80 字符)
  assert.match(out, /"mark"\s*:\s*"bar"/);                  // 对象 → JSON 片段,有诊断价值
  assert.doesNotMatch(out, /TypeError|is not a function|Cannot read/);
  assert.equal(__didMatchLastKnownPattern(), true);
});

// P0-2 第 2 轮审查修复锁死:normalizeEngineError 的反崩溃契约兜底 —— p.make 内部任何
// 未预见异常(如本例 circular ref 让 JSON.stringify 抛 "Converting circular structure to JSON")
// 都被 normalizeEngineError 的 try/catch 捕获,返回带 [resvg] 的兜底文本,绝不穿透到顶层 catch。
test("anti-crash: p.make throwing (circular JSON.stringify) is caught, returns fallback", () => {
  const circular = { mark: "bar" };
  circular.self = circular; // 触发 JSON.stringify 抛 "Converting circular structure to JSON"
  const raw = "SVG data parsing failed cause the document does not have a root node";
  const out = normalizeEngineError("resvg", raw, { input: circular, raw }, "resvg");
  // 反崩溃契约:函数返回了字符串(没抛),且保留了 [resvg] 标签 + 原 rawMsg(信息不丢)。
  // fallback 文本里会含 "circular" 字样(来自 V8 native 错误文本)是有诊断价值的,不算契约违反。
  assert.equal(typeof out, "string");
  assert.ok(out.length > 0);
  assert.match(out, /\[resvg\]/);
  assert.match(out, /SVG data parsing failed/);  // 原 rawMsg 必须保留
  assert.match(out, /归一化失败/);                 // 兜底标记
});

test("resvg pattern 2: default font-family not found", () => {
  const out = normalizeEngineError("resvg", "default font-family '' not found", { input: "", raw: "" });
  assert.match(out, /字体加载失败/);
  assert.match(out, /PingFang|Noto|Microsoft YaHei/);
});

// ───────────────────────── 反崩溃契约(Archify layout-rules.test.mjs:166 同款)─────────────────────────

test("anti-crash: unknown error shape returns raw, not throws", () => {
  const out = normalizeEngineError("d2", "some totally unknown error xyz123", { input: "", raw: "" });
  assert.match(out, /some totally unknown error xyz123/);  // 原样保留
  assert.match(out, /未识别的错误形态/);                    // 兜底标记
  assert.doesNotMatch(out, /TypeError|is not a function|Cannot read/);
  assert.equal(__didMatchLastKnownPattern(), false);
});

test("anti-crash: malformed input (null/undefined raw) returns fallback", () => {
  // normalizeEngineError 不接受 null/undefined(签名约束 string),但要测空字符串不崩
  const out = normalizeEngineError("d2", "", { input: "", raw: "" });
  assert.match(out, /\[d2\]/);
  assert.match(out, /未识别的错误形态/);
});

// ───────────────────────── engineHint 路由(PNG 复用路径)─────────────────────────

test("engineHint routes D2-attributed resvg error to resvg patterns", () => {
  // 场景:d2.ts PNG 复用路径抛 "[resvg] SVG data parsing failed...",
  // 外层 handler 捕获时 engine="d2" 但加 engineHint="resvg"
  const raw = "[resvg] SVG data parsing failed cause the document does not have a root node";
  const stripped = raw.replace(/^\[resvg\] /i, "");
  const out = normalizeEngineError("d2", stripped, { input: "<svg/>", raw: stripped }, "resvg");
  assert.match(out, /\[resvg\]/);                // 必须走 resvg patterns 路由
  assert.match(out, /xmlns/);                     // resvg pattern 1 的特征文案
  assert.doesNotMatch(out, /未识别的错误形态/);   // 不能落入 d2 兜底
});

test("engineHint routes graphviz-attributed resvg font error to resvg patterns", () => {
  const raw = "[resvg] default font-family '' not found";
  const stripped = raw.replace(/^\[resvg\] /i, "");
  const out = normalizeEngineError("graphviz", stripped, { input: "<svg/>", raw: stripped }, "resvg");
  assert.match(out, /\[resvg\]/);
  assert.match(out, /字体加载失败/);
});

// ───────────────────────── 元契约(三件套必须齐:定位 + 问题 + 修复)─────────────────────────

test("contract: every known case carries [engine] tag + 修复 verb", () => {
  const cases = [
    { engine: "d2", raw: JSON.stringify([{ range: "index,1:1:1-1:5:5", errmsg: 'expected "stroke-width" to be a number between 0 and 15' }]), input: "x: { style.stroke-width: 1.5 }" },
    { engine: "d2", raw: JSON.stringify([{ errmsg: "missing value after colon" }]), input: "a: #ff0000" },
    { engine: "d2", raw: JSON.stringify([{ errmsg: "fill must be style.fill" }]), input: "x: { fill: red }" },
    { engine: "d2", raw: JSON.stringify([{ errmsg: "maps must be terminated with }" }]), input: "x: {" },
    { engine: "d2", raw: JSON.stringify([{ errmsg: "connection missing destination" }]), input: "a ->" },
    { engine: "graphviz", raw: "syntax error in line 1 near '}'", input: "digraph G { A -> }" },
    { engine: "graphviz", raw: "syntax error in line 2", input: "x\ny" },
    { engine: "vega-lite", raw: 'Invalid field type "undefined"', input: {} },
    { engine: "vega-lite", raw: "Unrecognized signal name \"x\"", input: {} },
    { engine: "vega-lite", raw: "gradient misuse", input: {} },
    { engine: "resvg", raw: "SVG data parsing failed cause the document does not have a root node", input: "<svg/>" },
    { engine: "resvg", raw: "default font-family '' not found", input: "" },
  ];
  for (const { engine, raw, input } of cases) {
    const out = normalizeEngineError(engine, raw, { input, raw });
    assert.match(out, new RegExp(`\\[${engine}\\]`), `missing [${engine}] tag in: ${out}`);
    assert.match(out, /修复[:：]/, `missing 修复 verb in: ${out}`);
  }
});

// ───────────────────────── Graphviz bug 锁死 e2e(P0-3 接入前的临时形态)─────────────────────────

test("regression: graphviz exposes viz-js errors (not 'produced no SVG')", async () => {
  // 直接调编译后的 GraphvizEngine,验证 §4.1 bug 修复落地:digraph G { A -> } 抛
  // syntax error in line 1 near '}' 而非 produced no SVG。
  const { GraphvizEngine } = await import("../dist/diagram/graphviz.js");
  const eng = new GraphvizEngine();
  await assert.rejects(
    () => eng.render({ code: "digraph G { A -> }", format: "svg" }),
    (e) => {
      assert.match(e.message, /syntax error in line 1 near '}'/, `unexpected msg: ${e.message}`);
      assert.doesNotMatch(e.message, /produced no SVG/);   // 🔒 bug 锁死
      return true;
    },
  );
});

test("regression: graphviz valid DOT still renders (happy path unchanged)", async () => {
  const { GraphvizEngine } = await import("../dist/diagram/graphviz.js");
  const eng = new GraphvizEngine();
  const out = await eng.render({ code: "digraph G { A -> B }", format: "svg" });
  assert.match(out.svg, /<svg/);
});

// ───────────────────────── chart.ts PNG 复用 [resvg] 前缀锁死(P0-2 §4.3.4)─────────────────────────
//
// Bug:chart.ts 的 PNG 复用路径(throw new Error("[resvg] " + ...))曾嵌在 view.toSVG() 的
// outer try 内,被 outer catch 的 `Vega-Lite render error: ${m}${vh}` 二次包装,吃掉 [resvg] 前缀。
// handler 层 normalizeEngineError 用 /^\[resvg\] /i 锚首检测路由,prefix 被吃后路由失效,
// 错误落到 vega-lite 兜底(附 '[object Object]' 泄露 + '未识别' 误导标签)。
// Fix:把 PNG 渲染移出 outer try(对齐 d2.ts/graphviz.ts 结构),[resvg] 前缀透传。
//
// ESM 命名空间 immutable,无法 monkey-patch;这里用 node:module register() 装一次性 loader,
// 把 @resvg/resvg-js 替换成总抛错的 mock,验证 chart.js 内层 throw 透传到调用方时仍带 [resvg] 前缀。

test("regression: chart PNG resvg errors keep [resvg] prefix (not wrapped by outer catch)", async () => {
  const { register } = await import("node:module");
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  const tmpDir = mkdtempSync(join(tmpdir(), "chart-resvg-stub-"));
  const loaderPath = join(tmpDir, "loader.mjs");
  // 用 resolve+load 双 hook 把 @resvg/resvg-js 重定向到 virtual:mock-resvg —— 必须改 specifier
  // 解析路径,不能只改 load;之前的 graphviz 回归测试已把真实 resvg-js 加载进 Node module cache,
  // 单 load hook 对已缓存 URL 不再生效。virtual URL 是全新 key,必触发 load 返回 mock source。
  writeFileSync(loaderPath, `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "@resvg/resvg-js") {
        return { url: "virtual:mock-resvg", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
    export async function load(url, context, defaultLoad) {
      if (url === "virtual:mock-resvg") {
        return {
          format: "module",
          source: \`export class Resvg {
  constructor(svg) {
    throw new Error("SVG data parsing failed cause the document does not have a root node");
  }
}
\`,
          shortCircuit: true,
        };
      }
      return defaultLoad(url, context);
    }
  `);
  register(pathToFileURL(loaderPath).href);

  try {
    // 用 cache-busting query 强制重新 import chart.js,让 mocked Resvg 生效
    // (register 只对 register 之后发起的 import 起作用)
    const chartMod = await import(`../dist/chart.js?t=stub-${Date.now()}`);
    const spec = {
      mark: "bar", width: 100, height: 100,
      data: { values: [{ a: 1, b: 2 }] },
      encoding: { x: { field: "a", type: "quantitative" }, y: { field: "b", type: "quantitative" } },
    };
    await assert.rejects(
      () => chartMod.renderChart({ spec, format: "png" }),
      (e) => {
        assert.match(e.message, /^\[resvg\] /, `msg should start with [resvg] prefix, got: ${e.message}`);
        assert.doesNotMatch(e.message, /Vega-Lite render error/, `should NOT be wrapped by outer catch, got: ${e.message}`);
        assert.match(e.message, /SVG data parsing failed/, `should carry underlying resvg message, got: ${e.message}`);
        return true;
      },
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
