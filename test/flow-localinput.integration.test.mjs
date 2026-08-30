/**
 * 本地图片路径输入集成测试(日志#16;真实 server 进程 + stdio MCP;零网络零积分 —— 死端口 CDP)。
 *
 * generate_image(images)/ create_video(image/keyframes/images)新增:绝对本地路径 → 工具侧读文件
 * + magic-bytes 嗅探 mime 转 data: URI(≤15MB);相对路径结构化拒绝(提示转绝对)。
 * 🔴 零积分安全设计(同 flow-confirm.integration.test.mjs):tmp config 把 providers.flow.cdpPort
 * 指向死端口 —— 正向路径在环境检测 S100 处失败/确认挑战处返回,结构上不可能触达真实提交端点。
 *
 * 断言面:
 *   1. schema:generate_image.images / create_video.image/keyframes/images 描述文档化本地路径支持
 *   2. 相对路径 → 结构化错误(提示转绝对)
 *   3. 绝对路径不存在 → 读取失败错误
 *   4. 超 15MB → 上限拒绝(读文件前拦截)
 *   5. 非图片字节(文本文件)→ 无法识别图片格式
 *   6. 合法 PNG 本地路径 → 通过输入校验(到达 flow provider:generate_image S100 / create_video needConfirm)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEAD_CDP_PORT = 9298;

async function portAlive(port) {
  return await new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}

function makeClient(cfgPath, homeDir) {
  const proc = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT,
    env: { ...process.env, MEDIA_GEN_MCP_CONFIG: cfgPath, HOME: homeDir },
  });
  let buf = "", nextId = 0;
  const pending = new Map();
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
  const send = (method, params) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const callTool = async (name, args) => {
    const r = await send("tools/call", { name, arguments: args });
    const text = r?.result?.content?.[0]?.text ?? "";
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { isError: !!r?.result?.isError, text, parsed };
  };
  const start = async () => {
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "flow-localinput-it", version: "1" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { proc, send, callTool, start };
}

describe("本地图片路径输入(日志#16;死端口 CDP,确定性零积分)", { skip: await (async () => await portAlive(DEAD_CDP_PORT))() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-localinput-"));
  const cfgPath = path.join(dir, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ providers: { flow: { cdpPort: DEAD_CDP_PORT } } }, null, 2));
  const client = makeClient(cfgPath, dir);

  // 输入 fixture
  const pngPath = path.join(dir, "base.png");
  fs.writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const txtPath = path.join(dir, "not-an-image.txt");
  fs.writeFileSync(txtPath, "hello world this is definitely not an image");
  const bigPath = path.join(dir, "big.png");
  { const fh = fs.openSync(bigPath, "w"); fs.writeSync(fh, Buffer.from([0x89])); fs.truncateSync(bigPath, 15 * 1024 * 1024 + 1); fs.closeSync(fh); }

  before(async () => { await client.start(); });
  after(() => {
    client.proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("schema:本地路径支持已文档化(generate_image.images / create_video.image/keyframes/images)", async () => {
    const r = await client.send("tools/list", {});
    const tools = r.result.tools;
    const gi = tools.find((t) => t.name === "generate_image");
    assert.match(gi.inputSchema.properties.images.description, /absolute local file path/, "generate_image.images 描述含本地路径");
    const cv = tools.find((t) => t.name === "create_video");
    for (const field of ["image", "keyframes", "images"]) {
      assert.match(cv.inputSchema.properties[field].description, /absolute local file path/, `create_video.${field} 描述含本地路径`);
    }
  });

  test("相对路径 → 结构化拒绝(提示转绝对路径)", async () => {
    const { isError, text } = await client.callTool("generate_image", { prompt: "x", provider: "flow", images: ["relative/base.png"] });
    assert.ok(isError);
    assert.match(text, /绝对/);
    assert.doesNotMatch(text, /\[flow\] S\d/, "输入层错误,未到 provider");
  });

  test("绝对路径不存在 → 读取失败错误(含路径与原因)", async () => {
    const { isError, text } = await client.callTool("generate_image", { prompt: "x", provider: "flow", images: [path.join(dir, "nope.png")] });
    assert.ok(isError);
    assert.match(text, /读取失败/);
  });

  test("超 15MB → 上限拒绝(读文件前拦截)", async () => {
    const { isError, text } = await client.callTool("generate_image", { prompt: "x", provider: "flow", images: [bigPath] });
    assert.ok(isError);
    assert.match(text, /15MB/);
  });

  test("非图片字节(文本文件)→ 无法识别图片格式", async () => {
    const { isError, text } = await client.callTool("create_video", { prompt: "x", provider: "flow", model: "veo_3_1_i2v_lite", image: txtPath });
    assert.ok(isError);
    assert.match(text, /无法识别图片格式/);
  });

  test("合法 PNG 本地路径(generate_image images)→ 通过输入校验,到达 flow provider(S100 环境错)", async () => {
    const { isError, text } = await client.callTool("generate_image", { prompt: "x", provider: "flow", images: [pngPath] });
    assert.ok(isError, "死端口 → 环境错(证明输入已被接受并进入 provider)");
    assert.match(text, /\[flow\] S1\d\d/, "flow 环境前置错(而非输入校验错)");
    assert.doesNotMatch(text, /须为 http/, "不再是旧的 URI 校验拒绝");
  });

  test("合法 PNG 本地路径(create_video keyframes)→ 到达确认门(needConfirm 挑战,零提交)", async () => {
    const { isError, parsed, text } = await client.callTool("create_video", {
      prompt: "x", provider: "flow", model: "veo_3_1_interpolation_lite", keyframes: [pngPath, pngPath],
    });
    assert.equal(isError, false, text.slice(0, 200));
    assert.equal(parsed.needConfirm, true, "本地 keyframes 通过校验,走到确认挑战(未提交)");
    assert.match(parsed.confirmToken, /^fvc1\./);
  });
});
