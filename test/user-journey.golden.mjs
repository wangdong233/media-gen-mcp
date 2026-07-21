/**
 * P0-3 用户旅程测试 · MCP stdio 端到端(用户视角)—— 6 个本地确定性工具。
 *
 * 与 golden.test.ts / determinism.test.ts 的分工:
 *   - golden/determinism:从 dist/renderXxx() 函数视角白盒验证(绕开 handler)
 *   - 本文件(user-journey):**以用户(Claude / 开发者)视角**,经真实 MCP JSON-RPC stdio 协议
 *     spawn `node dist/index.js`,发 tools/call 请求,**读取用户实际看到的 local_path 文件**,
 *     用与 golden.test.ts 完全相同的 helpers(compareSvg/comparePng/verifyQrPng)做 byte 比对。
 *
 * 这条链路证明:「用户调 tool → MCP handler 落盘 local_path → 文件 byte ≡ test/golden/expected/」。
 * 任何破坏这条链路的改动(handler 参数透传错误、outDir 处理错误、writeLocalRender bug、
 * 渲染器升级 byte 漂移)都会被本测试捕获。
 *
 * 形态:`node --test test/user-journey.golden.mjs`(node 18+ 内置,零依赖)。
 * 引用编译后 dist/index.js + dist-test/golden/helpers.js,跑前必须 `npm run build && npm run build:tests`。
 *
 * 注:D2 WASM 加载首次 ~2.5s(本地);每个 case spawn 新 server,6 个确定性工具串行总耗时 ~12s。
 *     复用 P0-2 callTool helper 的 120s 默认超时(给 CI 慢 runner 留余量)。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// ⚠️ 用 fileURLToPath 而非 new URL().pathname —— 后者会把空格/中文 URL 编码
// (路径含 "Agnes AI接入",URL 编码后变 "Agnes%20AI%E6%8E%A5%E5%85%A5" 找不到文件)
const SERVER_PATH = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const HELPERS_PATH = fileURLToPath(new URL("../dist-test/golden/helpers.js", import.meta.url));
const EXPECTED_DIR = fileURLToPath(new URL("../test/golden/expected/", import.meta.url));

// 复用 P0-3 helpers(与 golden.test.ts 完全相同的比对逻辑)
const { compareSvg, comparePng, verifyQrPng } = await import(HELPERS_PATH);

// 临时 outDir(handler 落盘 local_path 到此)
const TMP_OUT = fileURLToPath(new URL("../output-p0-3-userjourney/", import.meta.url));

// ═══════════════════════════════════════════════════════════════════════
// callTool helper —— 与 P0-2 user-journey.error-format.mjs 完全一致的范式
// ═══════════════════════════════════════════════════════════════════════
async function callTool(name, args, timeoutMs = 120000) {
  const child = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MCP_TEST_MODE: "1" },
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  child.stderr.on("data", (c) => stderrChunks.push(c));

  await new Promise((r) => setTimeout(r, 200));

  const id = Date.now();
  const sendInit = { jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } } };
  const sendInitNotif = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
  const sendCall = { jsonrpc: "2.0", id: id + 1, method: "tools/call",
    params: { name, arguments: args } };

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

  try { child.stdin.end(); } catch {}
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 50));

  if (!response) {
    const stderrTail = Buffer.concat(stderrChunks).toString("utf8").slice(-300);
    throw new Error(`MCP tools/call ${name} timeout(${timeoutMs}ms). stderr: ${stderrTail}`);
  }
  return response;
}

/**
 * 从 tools/call 响应里抽出 isError + content[0].text;提取 local_path 字段。
 * writeLocalRender 在 content[0].text 里写 JSON: { "format": "svg", "local_path": "/abs/path" }。
 *
 * 注:不使用 regex 抽路径 —— 路径含中文 + 空格(/.../Agnes AI接入/...),regex 的 \S 会在空格处
 * 截断,误抓到 /media-gen-mcp/... 等错误子串。改 JSON.parse 更稳健。
 */
function parseCallResult(resp) {
  const result = resp.result;
  if (!result) throw new Error(`no result in response: ${JSON.stringify(resp).slice(0, 300)}`);
  const text = result.content?.[0]?.text ?? "";
  let localPath = null;
  try {
    const obj = JSON.parse(text);
    localPath = obj.local_path ?? null;
  } catch {
    // 若 text 不是 JSON(如 P0-2 错误归一化返回的中文消息),localPath 保持 null
  }
  return { isError: !!result.isError, text, localPath };
}

// ═══════════════════════════════════════════════════════════════════════
// 测试 setup/teardown:每 test 前 clean tmp outDir,避免读到旧文件
// ═══════════════════════════════════════════════════════════════════════
function freshOut() {
  rmSync(TMP_OUT, { recursive: true, force: true });
  mkdirSync(TMP_OUT, { recursive: true });
  return TMP_OUT;
}

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 1:QR code SVG(qr-basic-svg 对应 fixture)
// 用户视角:「我喂个 URL,期望拿到 SVG 文件,与 golden byte-identical」
// ═══════════════════════════════════════════════════════════════════════
test("user journey QR SVG: 用户喂 https://example.com → 拿到 SVG 文件 ≡ golden", async () => {
  const outDir = freshOut();
  const resp = await callTool("generate_qrcode", {
    text: "https://example.com",
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "qr/basic.svg"), "utf8");
  // 复用与 golden.test.ts 完全相同的 compareSvg
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 QR SVG ≠ golden qr/basic.svg。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 2:QR code PNG(qr-url-png 对应 fixture,含 margin=4 / width=256 / ECL=M)
// 用户视角:「我喂参数化 URL,期望拿到 PNG,既 byte-identical 又能被扫码器识别」
// ═══════════════════════════════════════════════════════════════════════
test("user journey QR PNG: 用户喂参数化 URL → 拿到 PNG byte ≡ golden + jsQR 解码回原文", async () => {
  const outDir = freshOut();
  const params = JSON.parse(
    readFileSync(fileURLToPath(new URL("../test/golden/fixtures/qr/url.json", import.meta.url)), "utf8"),
  );
  const resp = await callTool("generate_qrcode", { ...params, outDir });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshPng = readFileSync(localPath);
  const goldenPng = readFileSync(path.join(EXPECTED_DIR, "qr/url.png"));
  // 双校验:byte + jsQR 解码(与 golden.test.ts 完全相同)
  const byteR = comparePng(freshPng, goldenPng);
  assert.ok(byteR.ok, `用户拿到的 QR PNG byte ≠ golden qr/url.png。${byteR.reason ?? ""}`);
  const decR = verifyQrPng(freshPng, params.text);
  assert.ok(decR.ok, `用户拿到的 QR PNG jsQR 解码失败或 ≠ 原文:${decR.reasons.join("; ")}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 3:formula SVG(formula-basic-svg 对应 fixture)
// 用户视角:「我喂 LaTeX E=mc^2,期望拿到 SVG ≡ golden;MathJax 自增 ID 已 normalize」
// ═══════════════════════════════════════════════════════════════════════
test("user journey formula SVG: 用户喂 E=mc^2 → 拿到 SVG(MathJax IDs normalize 后 ≡ golden)", async () => {
  const outDir = freshOut();
  const resp = await callTool("generate_formula", {
    tex: "E=mc^2",
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "formula/basic.svg"), "utf8");
  // compareSvg 默认走 normalizeMathJaxIds(no-op 安全 + formula 用例正好需要)
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 formula SVG ≠ golden formula/basic.svg(经 MathJax ID normalize)。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 4:chart SVG(chart-bar-svg 对应 fixture)
// 用户视角:「我喂 Vega-Lite bar spec,期望拿到 SVG ≡ golden」
// ═══════════════════════════════════════════════════════════════════════
test("user journey chart SVG: 用户喂 Vega-Lite bar 8 行数据 → 拿到 SVG ≡ golden", async () => {
  const outDir = freshOut();
  const spec = JSON.parse(
    readFileSync(fileURLToPath(new URL("../test/golden/fixtures/chart/bar-basic.json", import.meta.url)), "utf8"),
  );
  const resp = await callTool("generate_chart", {
    spec,
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "chart/bar-basic.svg"), "utf8");
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 chart SVG ≠ golden chart/bar-basic.svg。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 5:card SVG(card-cjk-svg 对应 fixture,fontFamily=Noto Sans SC → 0 fetch 离线)
// 用户视角:「我喂中文 title + CJK family,期望拿到 SVG ≡ golden;CDN 不参与,byte 完全离线确定」
// ═══════════════════════════════════════════════════════════════════════
test("user journey card SVG: 用户喂中文 title + Noto Sans SC → 拿到 SVG(0 fetch 离线)≡ golden", async () => {
  const outDir = freshOut();
  const props = JSON.parse(
    readFileSync(fileURLToPath(new URL("../test/golden/fixtures/card/cjk-og.json", import.meta.url)), "utf8"),
  );
  // 注:fixture 不含 format 字段,handler 默认会产 PNG。render.ts 在 golden 路径显式设 format=svg;
  // user journey 必须对齐(否则拿到的是 PNG 与 golden SVG byte 比对必失败)。
  const resp = await callTool("generate_card", { ...props, format: "svg", outDir });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "card/cjk-og.svg"), "utf8");
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 card SVG ≠ golden card/cjk-og.svg。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 6:render_svg SVG passthrough(rsvg-passthrough-svg 对应 fixture)
// 用户视角:「我喂一个 SVG,format=svg → 拿到原样 SVG(input == output)」
// ═══════════════════════════════════════════════════════════════════════
test("user journey render_svg SVG passthrough: 用户喂 SVG format=svg → 拿到原样 SVG ≡ input ≡ golden", async () => {
  const outDir = freshOut();
  const inputSvg = readFileSync(
    fileURLToPath(new URL("../test/golden/fixtures/render-svg/passthrough.svg", import.meta.url)),
    "utf8",
  );
  const resp = await callTool("render_svg", {
    svg: inputSvg,
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "render-svg/passthrough.svg"), "utf8");
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 render_svg passthrough ≠ golden。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 7:diagram D2 SVG(diagram-d2-svg 对应 fixture;D2 WASM ~2s 启动)
// 用户视角:「我喂 D2 DSL a -> b: hello,期望拿到 SVG ≡ golden」
// ═══════════════════════════════════════════════════════════════════════
test("user journey D2 SVG: 用户喂 a -> b: hello → 拿到 SVG ≡ golden", async () => {
  const outDir = freshOut();
  const code = readFileSync(
    fileURLToPath(new URL("../test/golden/fixtures/diagram/d2-basic.d2", import.meta.url)),
    "utf8",
  );
  const resp = await callTool("generate_diagram", {
    code,
    engine: "d2",
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "diagram/d2-basic.svg"), "utf8");
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 D2 SVG ≠ golden diagram/d2-basic.svg。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 用户旅程 8:diagram Graphviz SVG(diagram-graphviz-svg 对应 fixture)
// 用户视角:「我喂 DOT digraph G { A -> B; B -> C; C -> A; },期望拿到 SVG ≡ golden」
// ═══════════════════════════════════════════════════════════════════════
test("user journey Graphviz SVG: 用户喂 digraph → 拿到 SVG ≡ golden", async () => {
  const outDir = freshOut();
  const code = readFileSync(
    fileURLToPath(new URL("../test/golden/fixtures/diagram/graphviz-basic.dot", import.meta.url)),
    "utf8",
  );
  const resp = await callTool("generate_diagram", {
    code,
    engine: "graphviz",
    format: "svg",
    outDir,
  });
  const { isError, text, localPath } = parseCallResult(resp);
  assert.equal(isError, false, `不应 isError;got text: ${text.slice(0, 200)}`);
  assert.ok(localPath, `应抽出 local_path;text=${text.slice(0, 200)}`);

  const freshSvg = readFileSync(localPath, "utf8");
  const goldenSvg = readFileSync(path.join(EXPECTED_DIR, "diagram/graphviz-basic.svg"), "utf8");
  const r = compareSvg(freshSvg, goldenSvg);
  assert.ok(r.ok, `用户拿到的 Graphviz SVG ≠ golden diagram/graphviz-basic.svg。${r.diff ?? ""}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 清理:所有 test 跑完删 tmp outDir
// ═══════════════════════════════════════════════════════════════════════
test("cleanup tmp outDir", () => {
  rmSync(TMP_OUT, { recursive: true, force: true });
  assert.ok(true, "tmp cleaned");
});
