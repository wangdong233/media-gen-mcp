/**
 * vision 四工具本地图片路径输入集成测试(#2 输入面收敛,2026-09-03;stdio MCP + mock PaddleX)。
 *
 * 架构验收点:extract_text / extract_table / analyze_chart / describe_image 的 `image` 与
 * 生成域(generate_image / create_video)走同一 localizeImageInput 单源 —— 绝对本地路径 →
 * 工具侧读文件 + magic 嗅探转 data: URI(≤15MB);相对路径结构化拒绝(提示转绝对)。
 *
 * 零网络零积分:vision provider = paddle,baseUrl 指 127.0.0.1 mock PaddleX(discard-warnings
 * 同款);全程无真实生成提交、无 tesseract WASM 依赖。
 *
 * 断言面(每工具一正一拒):
 *   1. schema:四工具 image 描述文档化本地路径支持(与生成域同款短语)
 *   2. 正向:本地 PNG → 通过校验到达 mock paddle;响应 warnings 含「已由工具侧读取转 data: URI」;
 *      mock 收到的 file 字段恰为该 PNG 的 base64(证明真转了 data: URI,而非透传路径字符串)
 *   3. 拒绝:相对路径 → 结构化错误含「绝对」(runVisionTask 抛 / extract_text return err 两通道同文案)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("vision 四工具本地路径输入(#2 单源;mock PaddleX,零网络零积分)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-localinput-"));

  let proc = null;
  let send = null;
  const pending = new Map();
  /** 每次 mock PaddleX 收到的请求体(断言 file 字段用)。 */
  const seen = [];
  let server, baseUrl;

  const callTool = async (name, args) => {
    const r = await send("tools/call", { name, arguments: args });
    const text = r?.result?.content?.[0]?.text ?? "";
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { isError: !!r?.result?.isError, text, parsed };
  };

  before(async () => {
    // ── mock PaddleX(记录请求体;同 discard-warnings.test.mjs 范式)──
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}
        seen.push({ url: req.url, body: parsed });
        res.setHeader("Content-Type", "application/json");
        if (req.url.includes("/ocr")) {
          res.end(JSON.stringify({ result: { ocrResults: [{ rec_texts: ["mock 文本"], rec_scores: [0.99] }] } }));
        } else {
          res.end(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "mock 描述" } }] } }));
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const cfgPath = path.join(dir, "config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ providers: { paddle: { baseUrl } } }, null, 2));

    proc = spawn("node", ["dist/index.js"], {
      stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT,
      env: { ...process.env, MEDIA_GEN_MCP_CONFIG: cfgPath, HOME: dir },
    });
    let buf = "", nextId = 0;
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
      }
    });
    proc.stderr.on("data", () => {});
    send = (method, params) => new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vision-localinput-it", version: "1" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  });
  after(() => {
    try { proc?.kill(); } catch {}
    try { server?.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  // 1x1 PNG(whitebox/B-01 同款 fixture;magic 嗅探可过)
  const pngPath = path.join(dir, "vision.png");
  fs.writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const pngB64 = fs.readFileSync(pngPath).toString("base64");

  test("schema:四工具 image 描述文档化本地路径支持(与生成域同短语)", async () => {
    const r = await send("tools/list", {});
    const tools = r.result.tools;
    for (const name of ["extract_text", "extract_table", "analyze_chart", "describe_image"]) {
      const t = tools.find((x) => x.name === name);
      assert.match(t.inputSchema.properties.image.description, /absolute local file path/, `${name}.image 描述含本地路径`);
    }
  });

  // 每工具正向:本地 PNG → mock paddle 收到 base64 + 响应含本地化 note
  for (const [tool, respKey] of [
    ["extract_text", "text"],
    ["extract_table", "table"],
    ["analyze_chart", "description"],
    ["describe_image", "description"],
  ]) {
    test(`${tool}:绝对本地路径 → 到达 provider(mock 收到 data:URI 的 base64)+ 本地化告警`, async () => {
      seen.length = 0;
      const { isError, text, parsed } = await callTool(tool, { image: pngPath, provider: "paddle", download: false, outDir: dir });
      assert.equal(isError, false, text.slice(0, 300));
      assert.ok(parsed.warnings?.some((w) => w.includes("已由工具侧读取转 data: URI")), `${tool} 应含本地化告警,实际:${parsed.warnings?.join(" | ")}`);
      // 机械断言:provider 收到的恰是本地文件内容(paddle file 字段 = data:URI 剥前缀后的 base64)
      const last = seen[seen.length - 1];
      assert.equal(last?.body?.file, pngB64, `${tool}:mock PaddleX 应收到 PNG base64(data: URI 化),实际:${String(last?.body?.file).slice(0, 40)}…`);
      assert.ok(parsed[respKey] != null, `${tool} 应有 ${respKey} 结果`);
    });
    test(`${tool}:相对路径 → 结构化拒绝(提示转绝对)`, async () => {
      const { isError, text } = await callTool(tool, { image: "relative/vision.png", provider: "paddle" });
      assert.ok(isError, "相对路径必须被拒");
      assert.match(text, /绝对/, `应提示转绝对路径,实际:${text.slice(0, 200)}`);
      assert.doesNotMatch(text, /Paddle|errorCode/, "输入层错误,未到 provider");
    });
  }
});
