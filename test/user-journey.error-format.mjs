/**
 * P0-2 用户旅程测试 · MCP stdio 端到端(用户视角)。
 *
 * 与 smoke / unit / integration 的分工:
 *   - 前三者:从函数 / 模块 / handler 层视角白盒验证
 *   - 本文件(user-journey):**以用户(Claude / 开发者)视角**,经真实 MCP JSON-RPC stdio 协议
 *     spawn `node dist/index.js`,发 tools/call 请求,验证用户实际看到的 isError + content[0].text。
 *
 * 这是 PRD §8.3 "MCP inspector 喂 4 类错输入" 的自动化等价物 —— 用 child_process spawn
 * 替代手动 MCP inspector,可重复跑、可断言。
 *
 * 形态:`node --test test/user-journey.error-format.mjs`(node 18+ 内置,零依赖)。
 * 引用编译后 dist/index.js(MCP server 入口),跑前必须 `npm run build`。
 *
 * 注:D2 WASM 加载首次 ~2.5s(本地),每个 case spawn 新 server,4 类错输入 + happy + tools/list
 * 共 6 case 串行总耗时 ~20s(本地)。单 case 默认 120s 超时 —— 给 D2 WASM 首次编译在慢 /
 * 高负载 CI runner(实测可 >60s)留余量,避免 callTool 内置超时杀掉 happy/error 路径卡死 npm test
 * (经 prepublishOnly 链会影响 npm publish)。本地快机仍 ~2s 返回,不受影响。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ⚠️ 用 fileURLToPath 而非 new URL().pathname —— 后者会把空格/中文 URL 编码
// (路径含 "Agnes AI接入",URL 编码后变 "Agnes%20AI%E6%8E%A5%E5%85%A5" 找不到文件)
const SERVER_PATH = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/**
 * Spawn MCP server,跑一个 tools/call 请求,等响应。
 * 协议:JSON-RPC over stdio(line-delimited)。
 * 流程:initialize → notifications/initialized → tools/call
 */
async function callTool(name, args, method = "tools/call", timeoutMs = 120000) {
  const child = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MCP_TEST_MODE: "1" },
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  child.stderr.on("data", (c) => stderrChunks.push(c));

  // 给 server 200ms 启动
  await new Promise((r) => setTimeout(r, 200));

  const id = Date.now();
  const sendInit = { jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } } };
  const sendInitNotif = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
  const sendCall = { jsonrpc: "2.0", id: id + 1, method,
    params: method === "tools/list" ? {} : { name, arguments: args } };

  child.stdin.write(JSON.stringify(sendInit) + "\n");
  await new Promise((r) => setTimeout(r, 200));
  child.stdin.write(JSON.stringify(sendInitNotif) + "\n");
  await new Promise((r) => setTimeout(r, 200));
  child.stdin.write(JSON.stringify(sendCall) + "\n");

  const deadline = Date.now() + timeoutMs;
  let response = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const allData = Buffer.concat(stdoutChunks).toString("utf8");
    for (const line of allData.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === id + 1) { response = msg; break; }
      } catch { /* non-JSON */ }
    }
    if (response) break;
  }

  // 清理:SIGKILL 强制 + stdin.end() 防 server 等更多输入
  try { child.stdin.end(); } catch {}
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 50));

  if (!response) {
    const stderrTail = Buffer.concat(stderrChunks).toString("utf8").slice(-300);
    throw new Error(`MCP ${method} timeout(${timeoutMs}ms). stderr: ${stderrTail}`);
  }
  return response;
}

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 1:Graphviz 非法 DOT(锁死 §4.1 bug 修复,引擎快优先)
// ═══════════════════════════════════════════════════════════════════════

test("user journey Graphviz: 非法 DOT → 收到归一化中文消息(而非 'produced no SVG')", async () => {
  const resp = await callTool("generate_diagram", {
    code: "digraph G { A -> }",
    engine: "graphviz",
    format: "svg",
    outDir: "./output",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /\[graphviz\]/);
  assert.match(text, /line 1/);
  assert.match(text, /DOT 语法错.*意外 token "|"/);  // 归一化后的中文消息
  // 🔒 bug 锁死:严禁再出现 produced no SVG(§4.1 bug 修复的核心)
  assert.doesNotMatch(text, /produced no SVG/);
  assert.match(text, /offending:.*\}/);
  assert.match(text, /大括号|配对|节点/);
  assert.doesNotMatch(text, /TypeError|Cannot read/);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 2:用户喂 Vega-Lite 错 type(拼错 quantitative)
// ═══════════════════════════════════════════════════════════════════════

test("user journey Vega-Lite: type:'quantitativ' 拼写错 → 收到 4 个合法值提示", async () => {
  const resp = await callTool("generate_chart", {
    spec: {
      mark: "bar",
      width: 100, height: 100,
      data: { values: [{ a: 1, b: 2 }] },
      encoding: { x: { field: "a", type: "quantitativ" }, y: { field: "b", type: "quantitative" } },
    },
    format: "svg",
    outDir: "./output",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /\[vega-lite\]/);
  assert.match(text, /quantitative/);
  assert.match(text, /nominal/);
  assert.match(text, /ordinal/);
  assert.match(text, /temporal/);
  assert.match(text, /拼错|缩写/);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 3:用户喂 render_svg 缺 xmlns 的 SVG
// ═══════════════════════════════════════════════════════════════════════

test("user journey render_svg: 缺 xmlns 的 SVG → 收到 xmlns 修复动词", async () => {
  const resp = await callTool("render_svg", {
    svg: '<svg><rect width="50" height="50"/></svg>',  // 缺 xmlns
    format: "png",
    outDir: "./output",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /\[resvg\]/);
  assert.match(text, /xmlns/);
  assert.match(text, /offending: <svg>/);
  assert.match(text, /修复/);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 4:用户喂 D2 错输入(浮点 stroke-width,WASM 慢单独跑)
// ═══════════════════════════════════════════════════════════════════════

test("user journey D2: 用户调 generate_diagram 喂浮点 stroke-width → 收到 LLM 友好错误", async () => {
  const resp = await callTool("generate_diagram", {
    code: "x: { style.stroke-width: 1.5 }",
    engine: "d2",
    format: "svg",
    outDir: "./output",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /\[d2\]/);
  assert.match(text, /stroke-width/);
  assert.match(text, /0–15/);
  assert.match(text, /整数/);
  assert.match(text, /offending:/);
  assert.doesNotMatch(text, /TypeError|Cannot read|is not a function/);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 5:happy path 不破(向后兼容,D2 合法输入)
// ═══════════════════════════════════════════════════════════════════════

test("user journey happy D2: 合法 a -> b → 成功返回 local_path(isError 不为 true)", async () => {
  const resp = await callTool("generate_diagram", {
    code: "a -> b",
    engine: "d2",
    format: "svg",
    outDir: "./output",
  });
  const result = resp.result;
  assert.notEqual(result.isError, true, `happy path 不应 isError: ${JSON.stringify(result)}`);
  const text = result.content[0].text;
  const parsed = JSON.parse(text);
  assert.equal(parsed.engine, "d2");
  assert.equal(parsed.format, "svg");
  assert.match(parsed.local_path, /diagram_.*\.svg$/);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 6:happy path Graphviz(向后兼容)
// ═══════════════════════════════════════════════════════════════════════

test("user journey happy Graphviz: 合法 DOT → 成功返回 svg", async () => {
  const resp = await callTool("generate_diagram", {
    code: "digraph G { A -> B -> C }",
    engine: "graphviz",
    format: "svg",
    outDir: "./output",
  });
  const result = resp.result;
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.engine, "graphviz");
  assert.equal(parsed.format, "svg");
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 7:23 工具枚举(flow 加入 flow_status 后 22→23;向后兼容)
// ═══════════════════════════════════════════════════════════════════════

test("user journey 工具枚举: tools/list 返回 23 个工具(flow 后)", async () => {
  const resp = await callTool(null, null, "tools/list");
  const tools = resp.result.tools;
  assert.equal(tools.length, 23, `23 工具枚举破:${tools.length} 个`);
  // 关键工具名仍在
  const names = tools.map((t) => t.name).sort();
  for (const required of ["generate_diagram", "generate_chart", "render_svg", "generate_interactive_diagram", "generate_nested_diagram", "extract_image_meta", "flow_status"]) {
    assert.ok(names.includes(required), `${required} 工具消失`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 8:generate_nested_diagram 端到端(P0-5B 第 21 工具;happy + 错误路由三分支)
// ═══════════════════════════════════════════════════════════════════════

test("user journey nested happy: 合法 manifest → 返回 local_path(.html)+ bytes + layers", async () => {
  const resp = await callTool("generate_nested_diagram", {
    manifest: {
      id: "root", label: "演示", diagram: "a -> b",
      children: [{ id: "c1", label: "子", diagram: "x -> y" }],
    },
    outDir: "/tmp/nested-uj",
  });
  const result = resp.result;
  assert.notEqual(result.isError, true, `happy path 不应 isError: ${JSON.stringify(result)}`);
  const data = JSON.parse(result.content[0].text);
  assert.match(data.local_path, /\.html$/, "返回 HTML 落盘路径");
  assert.ok(data.bytes > 0, "bytes > 0");
  assert.equal(data.layers, 2, "root + c1 两层 diagram");
});

test("user journey nested error 第一分支: 非法 manifest(重复 id)→ [nested-diagram] V1 直抛", async () => {
  const resp = await callTool("generate_nested_diagram", {
    manifest: { id: "dup", label: "x", diagram: "a", children: [{ id: "dup", label: "y", diagram: "b" }] },
    outDir: "/tmp/nested-uj",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /\[nested-diagram\] V1/, "契约错(V1-V5/S_NESTED/E_ENGINE)直抛不归 d2");
});

test("user journey nested error 第三分支: 子层 D2 浮点 stroke-width → [d2] 归一化", async () => {
  const resp = await callTool("generate_nested_diagram", {
    manifest: { id: "root", label: "演示", diagram: "x: { style.stroke-width: 1.5 }" },
    outDir: "/tmp/nested-uj",
  });
  const result = resp.result;
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /\[d2\]/, "D2 引擎错经第三分支 normalizeEngineError 归一化(非 [nested-diagram] 直抛)");
  assert.match(text, /stroke-width/);
  assert.doesNotMatch(text, /TypeError|Cannot read|is not a function/);
});
