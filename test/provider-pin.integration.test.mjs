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
    // 0.22.0:链已废弃(优先级配置被忽略);免费池回落 = agnes↔zhipu(均配死端口,回落后同样失败,
    // 产生 fallback 告警 + 最终错误,断言回落确实发生)
    providers: {
      agnes: {                                        // 哑 key + 死端口(承接回落后同样失败;绝不打真网)
        apiKey: "pin-test-key-agnes",
        baseUrl: `http://127.0.0.1:${DEAD_HTTP_PORT}`,
      },
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

  test("显式 provider=flow(禁用渠道)→ 路由层禁用拦截,零网络零 CDP 零 fallback(0.22.0)", async () => {
    const { isError, text } = await c.callTool("generate_image", { prompt: "disabled-guard-probe", provider: "flow" });
    assert.ok(isError, "禁用 = 直抛");
    assert.match(text, /已被禁用/, "禁用错(含死域背景)");
    assert.match(text, /disabledProviders/, "错误附解禁指引(配置化非硬代码)");
    assert.match(text, /替代渠道/, "错误附替代渠道");
    assert.doesNotMatch(text, /已自动 fallback/, "禁用渠道绝不静默回落");
  });

  test("显式 provider=zhipu(免费)+ 失败 → 带告警按免费池回落到 agnes(0.22.0:回落只落免费渠道)", async () => {
    const { isError, text } = await c.callTool("generate_image", { prompt: "free-fallthrough-probe", provider: "zhipu" });
    // agnes 也失败(fixture 死 baseUrl)→ 最终错误;但回落告警必须出现且回落目标是免费渠道
    assert.ok(isError, "回落目标(agnes)也失败 → 最终错误");
    assert.match(text, /已自动 fallback 到 "agnes"/, "免费渠道显式点名后失败仍回落(带告警,非钉死)");
    assert.doesNotMatch(text, /已自动 fallback 到 "(flow|gemini|pixverse)"/, "回落永不落 opt-in/禁用渠道");
  });

  test("schema 契约同步:provider 描述按收窄后措辞(opt-in 钉死;免费渠道回落)", async () => {
    const r = await c.send("tools/list", {});
    const gi = r.result.tools.find((t) => t.name === "generate_image");
    const desc = gi.inputSchema.properties.provider.description;
    assert.match(desc, /Naming gemini\/pixverse pins that channel/, "点名即用+钉死承诺(活 opt-in 渠道)在册");
    assert.match(desc, /naming a free channel still fails over within the free pool/, "免费池回落语义在册");
    assert.match(desc, /disabledProviders/, "禁用机制(配置化)在描述中可见");
    assert.doesNotMatch(desc, /explicitly naming a provider pins it/, "旧的全渠道钉死措辞必须移除(契约与实现分歧源)");
  });

  test("list_models routingNote 同步:显式点名 opt-in 渠道才钉死", async () => {
    const { text } = await c.callTool("list_models", {});
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    assert.ok(parsed, "list_models 返回 JSON");
    assert.match(parsed.imageRoutingNote, /点名即用且钉死/, "routingNote:opt-in 点名即用+钉死");
    assert.match(parsed.imageRoutingNote, /免费渠道.*带告警回落/, "routingNote:免费池回落语义");
    assert.match(parsed.imageRoutingNote, /disabledProviders/, "routingNote:禁用机制可见");
  });
});
