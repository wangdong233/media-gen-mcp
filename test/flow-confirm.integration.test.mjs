/**
 * flow 计费确认门集成测试(真实 server 进程 + stdio MCP 协议;零网络零积分 —— 确定性)。
 *
 * 🔴🔴 零积分安全设计(比"Chrome 不在才跑"更强):tmp config 把 providers.flow.cdpPort 指向
 * 死端口 —— 无论本机 Chrome 是否在跑,provider 都连不上 CDP:第二段(有效 token)放行后
 * createVideo 在环境检测 S100 处失败,结构上不可能触达真实提交端点。任何机器确定性常绿;
 * 提交链路的正向验证由 flow-confirm.test.ts 的 stub transport 单测覆盖(零真实网络)。
 * 第一段(挑战)本身永不提交。
 *
 * 断言面(用户核心诉求②):
 *   - create_video(provider=flow)无 token → 非 isError 的 needConfirm 响应(预估 + 令牌 + TTL + hint)
 *   - 错 token → [flow] S320;无 model → S300 先于挑战(校验同源)
 *   - 有效 token → 过门后进入提交路径(S100 环境错,证明未被门拦)
 *   - flow.videoConfirm=false → 不出挑战直接进提交路径(开关生效)
 *   - schema:confirmToken 参数已文档化
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
/** 死端口(测试启动时再探活确认;被占用则全量 skip,绝不碰 9223 真 Chrome)。 */
const DEAD_CDP_PORT = 9299;

async function portAlive(port) {
  return await new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}

// ── MCP server stdio 客户端(同 flow-gate.integration.test.mjs 范式) ──
function makeClient(cfgPath) {
  const proc = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT,
    env: { ...process.env, MEDIA_GEN_MCP_CONFIG: cfgPath },
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
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "flow-confirm-it", version: "1" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { proc, send, callTool, start };
}

function writeCfg(flowSection) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-confirm-"));
  const cfgPath = path.join(dir, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({
    ...(flowSection ? { flow: flowSection } : {}),
    providers: { flow: { cdpPort: DEAD_CDP_PORT } }, // 死端口:结构性零积分(不碰 9223 真 Chrome)
  }, null, 2));
  return { dir, cfgPath };
}

describe("flow 计费确认门集成(死端口 CDP;确定性零积分)", { skip: await (async () => await portAlive(DEAD_CDP_PORT))() }, () => {
  const gateOn = writeCfg(null);            // 默认:确认门开
  const gateOff = writeCfg({ videoConfirm: false });
  const c1 = makeClient(gateOn.cfgPath);
  const c2 = makeClient(gateOff.cfgPath);

  before(async () => { await c1.start(); await c2.start(); });
  after(() => {
    c1.proc.kill(); c2.proc.kill();
    try { fs.rmSync(gateOn.dir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(gateOff.dir, { recursive: true, force: true }); } catch {}
  });

  test("schema:create_video 有 confirmToken 参数(两段式文档化)", async () => {
    const r = await c1.send("tools/list", {});
    const cv = r.result.tools.find((t) => t.name === "create_video");
    assert.ok(cv.inputSchema.properties.confirmToken, "confirmToken 参数在册");
    assert.match(cv.inputSchema.properties.confirmToken.description, /needConfirm/);
  });

  test("第一段:无 token → needConfirm 响应(非 isError;静态预估 12 + 令牌 + TTL)", async () => {
    const { isError, parsed, text } = await c1.callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s" });
    assert.equal(isError, false, text.slice(0, 200));
    assert.equal(parsed.needConfirm, true);
    assert.equal(parsed.provider, "flow");
    assert.equal(parsed.model, "abra_t2v_8s");
    assert.equal(parsed.estimatedCost, 12, "CDP 不可达 → 静态契约表兜底");
    assert.equal(parsed.costSource, "static");
    assert.match(parsed.confirmToken, /^fvc1\./);
    assert.equal(parsed.expiresInSeconds, 600);
    assert.match(parsed.hint, /confirmToken/);
  });

  test("第二段(错 token)→ [flow] S320(不提交)", async () => {
    const { isError, text } = await c1.callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s", confirmToken: "bogus" });
    assert.ok(isError);
    assert.match(text, /^\[flow\] S320 /);
  });

  test("第二段(有效 token)→ 过门进入提交路径:环境检测 S100(证明门已放行,结构性零积分)", async () => {
    const first = await c1.callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s" });
    assert.equal(first.isError, false);
    const second = await c1.callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s", confirmToken: first.parsed.confirmToken });
    assert.ok(second.isError, "放行后应到达 createVideo 的环境检测");
    assert.match(second.text, /\[flow\] S(100|101|102|103) /, "CDP 环境错(而非确认门错)证明已过门");
    assert.doesNotMatch(second.text, /S32[01]/);
  });

  test("无 model → S300 先于挑战(校验同源早失败)", async () => {
    const { isError, text } = await c1.callTool("create_video", { prompt: "x", provider: "flow" });
    assert.ok(isError);
    assert.match(text, /^\[flow\] S300 /);
    assert.ok(text.includes("消耗积分"));
  });

  test("flow.videoConfirm=false → 不出挑战,直接进提交路径(开关生效;S100 环境错)", async () => {
    const { isError, text, parsed } = await c2.callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s" });
    assert.ok(isError, "门关后直达 createVideo");
    assert.equal(parsed, null, "无 needConfirm JSON 响应");
    assert.match(text, /\[flow\] S(100|101|102|103) /);
  });
});
