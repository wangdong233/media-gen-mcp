/**
 * 钉死守卫端到端集成测试(三审 finding-1 回归;真实 server 进程 + stdio MCP 协议)。
 *
 * 🔴🔴 零积分安全设计(同 flow-confirm.integration.test.mjs 范式):tmp config 把
 * providers.flow.cdpPort 指向死端口 + providers.zhipu.baseUrl 指向死 HTTP 端口 ——
 * 无论本机 Chrome/网络状态如何,两条链路都结构性不可达:
 *   - flow 侧:ensureReady 在 S100(CDP 不可连)处失败,请求从未提交(生图本就 0 点);
 *   - zhipu 侧:连接拒绝(fetch TypeError),绝不触达真实 API。
 *
 * 断言面(契约收窄为「opt-in 渠道钉死;免费渠道带告警回落」后):
 *   1. 显式 provider=flow(opt-in)+ 环境前置失败 → 直抛 [flow] S100,绝不 fallback
 *      (mutant:钉死失效 → 会回落 zhipu → 文本出现 fallback 告警/首例不再是 flow 错)
 *   2. 显式 provider=zhipu(免费)+ 失败 → 带告警按链回落到 flow(链内 opt-in 成员),
 *      最终错误是 flow 的 S100(证明回落确实发生;mutant:免费渠道也钉死 → 无 fallback 告警)
 *   3. schema 契约同步:generate_image provider 描述与 list_models routingNote 均按收窄后措辞
 *      (不再宣称「显式点名任意 provider 即钉死」)
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
const DEAD_HTTP_PORT = 9301;

async function portAlive(port) {
  return await new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}

// ── MCP server stdio 客户端(同 flow-confirm.integration.test.mjs 范式)──
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
    return { isError: !!r?.result?.isError, text };
  };
  const start = async () => {
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "provider-pin-it", version: "1" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  };
  return { proc, send, callTool, start };
}

function writeCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-pin-"));
  const cfgPath = path.join(dir, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({
    // 网络错误零重试:连接拒绝立即抛(测试确定性 + 不引入退避延迟)
    http: { maxRetries: 0 },
    // 链 = [flow, zhipu]:flow 显式列入(知情同意),使「免费渠道失败回落到 flow」可达
    imageProviderPriority: ["flow", "zhipu"],
    providers: {
      flow: { cdpPort: DEAD_CDP_PORT },              // 死端口:结构性零积分
      zhipu: {                                        // 死 HTTP 端口 + 假 key(仅过 configured 门)
        apiKey: "pin-test-key",
        baseUrl: `http://127.0.0.1:${DEAD_HTTP_PORT}`,
        models: { image: { default: "cogview-3-flash", available: ["cogview-3-flash"] } },
      },
    },
  }, null, 2));
  return { dir, cfgPath };
}

describe("钉死守卫集成(死端口 CDP + 死端口 zhipu;确定性零积分)", { skip: await (async () => (await portAlive(DEAD_CDP_PORT)) || (await portAlive(DEAD_HTTP_PORT)))() }, () => {
  const { dir, cfgPath } = writeCfg();
  const c = makeClient(cfgPath);

  before(async () => { await c.start(); });
  after(() => {
    c.proc.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("显式 provider=flow(opt-in)+ 环境前置失败 → 直抛 [flow] S1xx,零 fallback 告警", async () => {
    const { isError, text } = await c.callTool("generate_image", { prompt: "pin-guard-probe", provider: "flow" });
    assert.ok(isError, "钉死 = 失败直抛");
    assert.match(text, /\[flow\] S1\d\d /, "首例错误是 flow 的环境前置错(S100/S101/S102)");
    assert.doesNotMatch(text, /已自动 fallback/, "opt-in 渠道显式点名绝不静默回落(语义劫持防护)");
  });

  test("显式 provider=zhipu(免费)+ 失败 → 带告警按链回落到 flow(链内 opt-in 成员承接)", async () => {
    const { isError, text } = await c.callTool("generate_image", { prompt: "free-fallthrough-probe", provider: "zhipu" });
    assert.ok(isError, "回落目标(flow 死 CDP)也失败 → 最终错误");
    assert.match(text, /已自动 fallback 到 "flow"/, "免费渠道显式点名后失败仍按链回落(带告警,非钉死)");
    assert.match(text, /\[flow\] S1\d\d /, "回落后的最终错误来自 flow(证明回落确实发生,而非 zhipu 直抛)");
  });

  test("schema 契约同步:provider 描述按收窄后措辞(opt-in 钉死;免费渠道回落)", async () => {
    const r = await c.send("tools/list", {});
    const gi = r.result.tools.find((t) => t.name === "generate_image");
    const desc = gi.inputSchema.properties.provider.description;
    assert.match(desc, /naming an opt-in provider \(flow\) pins it/, "收窄后的钉死承诺(opt-in 限定)在册");
    assert.match(desc, /free providers \(agnes\/zhipu\) named explicitly still fall through/, "免费渠道回落语义在册");
    assert.doesNotMatch(desc, /explicitly naming a provider pins it/, "旧的全渠道钉死措辞必须移除(契约与实现分歧源)");
  });

  test("list_models routingNote 同步:显式点名 opt-in 渠道才钉死", async () => {
    const { text } = await c.callTool("list_models", {});
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    assert.ok(parsed, "list_models 返回 JSON");
    assert.match(parsed.imageRoutingNote, /显式点名 opt-in 渠道/, "routingNote 收窄为 opt-in 钉死");
    assert.match(parsed.imageRoutingNote, /免费渠道.*带告警回落/, "routingNote 声明免费渠道回落语义");
  });
});
