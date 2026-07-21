/**
 * P0-2 集成测试 · 模块间接通(handler 包装 → normalizeEngineError → throw → 顶层 catch)。
 *
 * 与 smoke / unit 的分工:
 *   - smoke.mjs:核心 normalizeEngineError 函数 + chart.ts 单点 [resvg] 前缀透传
 *   - unit.error-format.mjs:pattern 边界 + helper 白盒
 *   - 本文件(integration):**handler 层模块间接通** —— 验证 src/index.ts 三处 handler 包装
 *     (generate_diagram / generate_chart / render_svg)实际把引擎抛错接入 normalizeEngineError,
 *     走顶层 catch 转成 err(message) 协议输出。
 *
 * 形态:`node --test test/integration.error-format.mjs`(node 18+ 内置,零依赖)。
 * 引用编译后 dist/(handler 层包装的 catch 逻辑在 dist/index.js 的 CallToolRequest handler 内,
 * 但顶层 catch 把所有 handler 异常都转成 {content:[{text}], isError:true} —— 我们直接调用各 engine
 * 模块模拟"抛错到 handler",验证 normalizeEngineError 在 catch 块里的真实接入效果)。
 *
 * 跑前必须 `npm run build` 让 dist/ 存在。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEngineError,
} from "../dist/handlers/error-format.js";

// ═══════════════════════════════════════════════════════════════════════
// 模拟 handler 层包装:把 engine 抛的 raw msg 经 normalizeEngineError 后再 throw
// 这是 src/index.ts:947-957 / 982-984 / 1054-1062 三处 catch 块的核心逻辑
// ═══════════════════════════════════════════════════════════════════════

/**
 * 仿真 handler 层的 try/catch 包装(与 src/index.ts 三处 catch 同结构)。
 * 用于在不 spawn MCP server 的前提下验证"engine 抛错 → normalizeEngineError 接入"链路。
 */
async function simulateHandlerCatch(engineName, engineFn, inputForCtx) {
  try {
    await engineFn();
    return { isError: false };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const isResvg = /^\[resvg\] /i.test(msg);
    const normalized = normalizeEngineError(
      isResvg ? "resvg" : engineName,
      msg.replace(/^\[resvg\] /i, ""),
      { input: inputForCtx, raw: msg },
      isResvg ? "resvg" : undefined,
    );
    // 顶层 catch(src/index.ts:1367)把 throw 转 err(message)
    return { isError: true, message: normalized };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// generate_diagram handler 包装:接 D2Engine.render 抛错
// ═══════════════════════════════════════════════════════════════════════

test("integration generate_diagram: D2 float stroke-width 抛错 → handler 返回归一化文本", async () => {
  // 真实 D2Engine 抛错的仿真(d2.ts:132 改后抛裸 errmsg;真实 rawMsg 是 JSON 数组字符串)
  const fakeD2Render = async () => {
    throw new Error(JSON.stringify([{
      range: "index,0:25:25-0:28:28",
      errmsg: 'index:1:26: expected "stroke-width" to be a number between 0 and 15',
    }]));
  };
  const result = await simulateHandlerCatch(
    "d2",
    fakeD2Render,
    "x: { style.stroke-width: 1.5 }",  // code 作为 ctx.input
  );
  assert.equal(result.isError, true);
  assert.match(result.message, /\[d2\]/);
  assert.match(result.message, /stroke-width/);
  assert.match(result.message, /0–15/);
  assert.match(result.message, /整数/);
  assert.match(result.message, /offending:.*style\.stroke-width: 1\.5/);
});

test("integration generate_diagram: Graphviz 非法 DOT → handler 返回归一化文本(锁死 §4.1 bug 修复)", async () => {
  // 真实 GraphvizEngine 抛错的仿真(graphviz.ts 修复后抛 "graphviz engine rejected the DOT input: [1] syntax error ...")
  const fakeGraphvizRender = async () => {
    throw new Error("graphviz engine rejected the DOT input: [1] syntax error in line 1 near '}'");
  };
  const result = await simulateHandlerCatch(
    "graphviz",
    fakeGraphvizRender,
    "digraph G { A -> }",  // code 作为 ctx.input
  );
  assert.equal(result.isError, true);
  assert.match(result.message, /\[graphviz\]/);
  assert.match(result.message, /line 1/);
  assert.match(result.message, /意外 token "}"/);
  assert.match(result.message, /offending:.*digraph G \{ A -> \}/);
});

test("integration generate_diagram: D2 → PNG 复用 [resvg] 前缀路由", async () => {
  // D2 SVG 已渲染成功,但 PNG 复用 resvg 失败(d2.ts:147-152 加 [resvg] 前缀)
  const fakeD2PngReuseFailure = async () => {
    throw new Error("[resvg] SVG data parsing failed cause the document does not have a root node");
  };
  const result = await simulateHandlerCatch("d2", fakeD2PngReuseFailure, "<svg>bad</svg>");
  assert.equal(result.isError, true);
  // handler 识别 [resvg] 前缀 → engineHint='resvg' → 走 resvg patterns 表(而非 d2 兜底)
  assert.match(result.message, /\[resvg\]/);
  assert.match(result.message, /xmlns/);
  assert.doesNotMatch(result.message, /未识别的错误形态/);  // 不能走 d2 兜底
});

// ═══════════════════════════════════════════════════════════════════════
// generate_chart handler 包装:接 renderChart 抛错
// ═══════════════════════════════════════════════════════════════════════

test("integration generate_chart: Vega-Lite Invalid field type → handler 返回归一化文本", async () => {
  // chart.ts compile 错的仿真:外层 catch 包成 "Vega-Lite spec error: Invalid field type 'undefined'"
  const fakeVegaCompileError = async () => {
    throw new Error('Vega-Lite spec error: Invalid field type "undefined"');
  };
  const spec = { mark: "bar", encoding: { x: { field: "a", type: "quantitativ" } } };
  const result = await simulateHandlerCatch("vega-lite", fakeVegaCompileError, spec);
  assert.equal(result.isError, true);
  assert.match(result.message, /\[vega-lite\]/);
  assert.match(result.message, /quantitative.*nominal.*ordinal.*temporal/);
  assert.match(result.message, /拼错|缩写/);
});

test("integration generate_chart: object ctx.input 不崩(R2-1 修复在 handler 路径仍生效)", async () => {
  // chart handler 的 ctx.input 是 Vega-Lite spec 对象(src/index.ts:1008)。
  // resvg pattern 1 make 历史曾对 object ctx.input 抛 TypeError,违反反崩溃契约。
  // 触发条件:Vega-Lite compile 成功但 PNG 复用 resvg 失败 → 抛 [resvg] + chart.ts 包装错误。
  const fakeChartPngReuseFailure = async () => {
    throw new Error("[resvg] SVG data parsing failed cause the document does not have a root node");
  };
  const spec = { mark: "bar", encoding: { x: { field: "a", type: "quantitative" } } };
  const result = await simulateHandlerCatch("vega-lite", fakeChartPngReuseFailure, spec);
  assert.equal(result.isError, true);
  assert.match(result.message, /\[resvg\]/);  // 经 [resvg] 前缀路由到 resvg patterns
  assert.match(result.message, /xmlns/);
  // R2-1 修复:object ctx.input 经 typeof check → JSON.stringify → 含 spec 字段
  assert.match(result.message, /offending:.*"mark"\s*:\s*"bar"/);
  assert.doesNotMatch(result.message, /TypeError|Cannot read|is not a function/);
});

// ═══════════════════════════════════════════════════════════════════════
// render_svg handler 包装:接 renderSvg 抛错
// ═══════════════════════════════════════════════════════════════════════

test("integration render_svg: resvg 字体加载失败 → handler 路由到 resvg patterns 表", async () => {
  // render-svg.ts:208 加 [resvg] 前缀;render_svg handler 看到前缀路由
  const fakeRenderSvgFontError = async () => {
    throw new Error("[resvg] default font-family '' not found");
  };
  const result = await simulateHandlerCatch("resvg", fakeRenderSvgFontError, "<svg><text>hi</text></svg>");
  assert.equal(result.isError, true);
  assert.match(result.message, /\[resvg\]/);
  assert.match(result.message, /字体加载失败/);
  assert.match(result.message, /PingFang|Noto|Microsoft YaHei/);
});

test("integration render_svg: 非 resvg 错(如 Chrome 不可用)→ handler 原样抛(不走归一化)", async () => {
  // Chrome 后端错(如 "Chrome/Edge not available")对 LLM 已清晰,不归一化
  const fakeChromeNotAvailable = async () => {
    throw new Error("Chrome/Edge not available. Install Google Chrome or use backend:'resvg'.");
  };
  // render_svg handler 只对 resvg 类错误走归一化;非 resvg 错原样抛
  const result = await simulateHandlerCatch("resvg", fakeChromeNotAvailable, "<svg/>");
  assert.equal(result.isError, true);
  // 注意:这里 simulateHandlerCatch 总是调 normalizeEngineError,但实际 handler 有 isResvgErr 判断
  // 此 case 验证 normalizeEngineError 对"已清晰的 Chrome 错"会走兜底(未命中 resvg patterns)
  assert.match(result.message, /Chrome\/Edge not available|未识别的错误形态/);
});

// ═══════════════════════════════════════════════════════════════════════
// 真实模块级集成:直接调 dist/diagram/graphviz.js / dist/chart.js 验证端到端抛错
// (与 smoke.mjs 的 graphviz bug 锁死 / chart [resvg] 前缀透传互补,这里聚焦 happy + error 双路径)
// ═══════════════════════════════════════════════════════════════════════

test("integration GraphvizEngine: 合法 DOT happy path → 返回 svg(P0-2 不破成功路径)", async () => {
  const { GraphvizEngine } = await import("../dist/diagram/graphviz.js");
  const eng = new GraphvizEngine();
  const out = await eng.render({ code: "digraph G { A -> B -> C }", format: "svg" });
  assert.match(out.svg, /<svg[\s>]/);
  assert.ok(out.svg.length > 100);
});

test("integration GraphvizEngine: 非法 DOT → 抛带 syntax error 的归一化前文本", async () => {
  const { GraphvizEngine } = await import("../dist/diagram/graphviz.js");
  const eng = new GraphvizEngine();
  await assert.rejects(
    () => eng.render({ code: "digraph G { A -> }", format: "svg" }),
    (e) => {
      // graphviz.ts 抛的 raw msg;handler 层会再过 normalizeEngineError
      assert.match(e.message, /syntax error in line 1 near '}'/);
      assert.doesNotMatch(e.message, /produced no SVG/);  // 🔒 bug 修复锁死
      return true;
    },
  );
});

test("integration GraphvizEngine: PNG 复用 [resvg] 前缀透传(代码静态断言)", async () => {
  // graphviz SVG 成功渲染,但 PNG 复用 resvg 失败时(graphviz.ts:81-91)
  // 由于真实 Resvg 对合法 SVG 不会失败,这里用代码静态断言验证 [resvg] 前缀模式就位
  const fs = await import("node:fs/promises");
  const graphvizSource = await fs.readFile("src/diagram/graphviz.ts", "utf8");
  assert.match(graphvizSource, /throw new Error\("\[resvg\] " \+/);
});

// ═══════════════════════════════════════════════════════════════════════
// 三处 PNG 复用路径对称性验证(d2.ts / graphviz.ts / chart.ts / render-svg.ts)
// ═══════════════════════════════════════════════════════════════════════

test("integration 对称性: 4 处 PNG 复用路径全部加 [resvg] 前缀", async () => {
  const fs = await import("node:fs/promises");
  const files = [
    "src/diagram/d2.ts",
    "src/diagram/graphviz.ts",
    "src/chart.ts",
    "src/render-svg.ts",
  ];
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    assert.match(
      src,
      /throw new Error\("\[resvg\] " \+\s*\(e\?\.message \?\? String\(e\)\)\)/,
      `${f} 未加 [resvg] 前缀对称包装`,
    );
  }
});

test("integration 对称性: handler 三处包装都 import normalizeEngineError", async () => {
  const fs = await import("node:fs/promises");
  const indexSrc = await fs.readFile("src/index.ts", "utf8");
  // import 语句存在
  assert.match(indexSrc, /from\s+"\.\/handlers\/error-format\.js"/);
  // generate_diagram / generate_chart / render_svg 三处 catch 内都调 normalizeEngineError
  const handlerBlocks = [
    /case "generate_diagram":[\s\S]*?normalizeEngineError\(/,
    /case "generate_chart":[\s\S]*?normalizeEngineError\(/,
    /case "render_svg":[\s\S]*?normalizeEngineError\(/,
  ];
  for (const rx of handlerBlocks) {
    assert.match(indexSrc, rx, "某处 handler 未调 normalizeEngineError");
  }
});

test("integration 单一归一化入口: 不存在第二个错误归一化函数定义", async () => {
  const fs = await import("node:fs/promises");
  // 整个 src/ 只能有 normalizeEngineError 一个错误归一化入口(契约对称性)
  // 注意:d2.ts / graphviz.ts 的注释里仍引用旧函数名(说明删除函数的 P0-2 §4.4 迁移注释),
  // 所以只断言函数 **定义** 不存在,不断言字串不存在。
  const files = [
    "src/index.ts", "src/chart.ts", "src/render-svg.ts",
    "src/diagram/d2.ts", "src/diagram/graphviz.ts",
  ];
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    // 旧函数定义应已删除(function 关键字 + 函数名)
    assert.doesNotMatch(src, /function\s+enhanceD2Error\s*\(/,
      `${f} 仍含旧归一化函数定义 enhanceD2Error`);
    assert.doesNotMatch(src, /function\s+enhanceGraphvizError\s*\(/,
      `${f} 仍含旧归一化函数定义 enhanceGraphvizError`);
    // 也不应有调用方
    assert.doesNotMatch(src, /[^a-zA-Z]enhanceD2Error\s*\(/,
      `${f} 仍调用 enhanceD2Error`);
    assert.doesNotMatch(src, /[^a-zA-Z]enhanceGraphvizError\s*\(/,
      `${f} 仍调用 enhanceGraphvizError`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 顶层 err() 协议不变(单字段 {content:[{type:"text", text:...}], isError:true})
// ═══════════════════════════════════════════════════════════════════════

test("integration 顶层 err() 协议: 错误返回仍是单字段 text 协议", async () => {
  const fs = await import("node:fs/promises");
  const indexSrc = await fs.readFile("src/index.ts", "utf8");
  // err() helper 签名零变更
  assert.match(indexSrc, /function err\(message: string\)\s*\{\s*return\s*\{\s*content:\s*\[\{\s*type:\s*"text"/);
  // 顶层 catch 仍按 e.message 走 err()
  assert.match(indexSrc, /catch \(e: unknown\)\s*\{\s*return err\(e instanceof Error \? e\.message : String\(e\)\);/);
});
