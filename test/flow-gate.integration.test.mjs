/**
 * 链即开关 集成测试(真实 server 进程 + stdio MCP 协议)。
 *
 * 2026-08-26:S000 硬门(flow.enabled)删除后,渠道启用的唯一控制源 = 优先级链。
 * 本文件验证新语义在真实 server 的行为面:
 *   - 链中不配置 flow = 不启用(provider 默认值不指向 flow,与旧「剔除」殊途同归)
 *   - 链中配置 flow = 启用(provider 默认值 = flow)
 *   - 显式 provider=flow 点名永远合法:错误只能来自环境前置(S1xx)或业务(S2xx/S4xx),
 *     绝不再出现 "[flow] S000"
 *
 * 零真实提交:仅 tools/list + 只读工具(flow_status/get_video 查询)。无 Chrome 时得 S1xx
 * 环境错(本地 ECONNREFUSED,ms 级);有 Chrome 时为只读查询(零积分)—— 两态都合法通过。
 *
 * 配置隔离:MEDIA_GEN_MCP_CONFIG 指向 tmp config,绝不触碰本机 ~/.media-gen-mcp/config.json。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── tmp configs:链不含 flow(未启用)/ 链含 flow(启用) ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-gate-"));
const cfgUnchained = path.join(tmpDir, "unchained.json");
fs.writeFileSync(cfgUnchained, JSON.stringify({ imageProviderPriority: ["agnes", "zhipu"] }, null, 2));
const cfgChained = path.join(tmpDir, "chained.json");
fs.writeFileSync(cfgChained, JSON.stringify({ imageProviderPriority: ["flow", "agnes"] }, null, 2));

// ── MCP server stdio 客户端(同 flow-tools.integration.test.mjs 范式;可重启换 config) ──
let proc = null, buf = "", nextId = 0;
const pending = new Map();
function startServer(cfgPath) {
  proc = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: PROJECT_ROOT,
    env: { ...process.env, MEDIA_GEN_MCP_CONFIG: cfgPath },
  });
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
}
function killServer() {
  if (proc) { proc.kill(); proc = null; }
  buf = "";
}
function send(method, params) {
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function callTool(name, args) {
  const r = await send("tools/call", { name, arguments: args });
  const text = r?.result?.content?.[0]?.text ?? "";
  return { isError: !!r?.result?.isError, text };
}
async function boot(cfgPath) {
  startServer(cfgPath);
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "flow-gate-it", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}
after(() => {
  killServer();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("链即开关(注册不受影响;链决定默认路由;点名永远合法;零真实提交)", () => {

  describe("链不含 flow(未启用)", () => {
    before(async () => { await boot(cfgUnchained); });
    after(() => killServer());

    test("tools/list:24 工具仍注册(flow_status/flow_entity 在列 —— 工具存在性与启用解耦)", async () => {
      const r = await send("tools/list", {});
      const names = (r?.result?.tools ?? []).map((t) => t.name);
      assert.equal(names.length, 24);
      assert.ok(names.includes("flow_status"));
      assert.ok(names.includes("flow_entity"));
    });

    test("provider 默认值 = agnes(flow 未入链 = 未启用,默认路由不指向 flow)", async () => {
      const r = await send("tools/list", {});
      const gen = (r?.result?.tools ?? []).find((t) => t.name === "generate_image");
      assert.equal(gen?.inputSchema?.properties?.provider?.default, "agnes");
    });

    test("显式 provider=flow(链外点名)→ 错误绝不再是 S000(环境/业务错,或只读成功)", async () => {
      // get_video 只读:无 Chrome → [flow] S1xx 环境错;有 Chrome → 查询不存在 id 的业务错。两态都非 S000。
      const r = await callTool("get_video", { provider: "flow", videoId: "00000000-0000-4000-8000-000000000000" });
      assert.doesNotMatch(r.text, /S000/, "S000 已删除 —— 链即开关,点名永远合法");
      // 若失败,应为结构化 flow 错(S1xx/S2xx/S4xx)而非裸崩
      if (r.isError) assert.match(r.text, /\[flow\] S[124]\d\d/);
    });
  });

  describe("链含 flow(启用)", () => {
    before(async () => { await boot(cfgChained); });
    after(() => killServer());

    test("provider 默认值 = flow(列入链 = 启用,链头即默认渠道)", async () => {
      const r = await send("tools/list", {});
      const gen = (r?.result?.tools ?? []).find((t) => t.name === "generate_image");
      assert.equal(gen?.inputSchema?.properties?.provider?.default, "flow");
    });

    test("flow_status() 正常入口(不再有入口门;无 Chrome → S1xx 环境错,有 Chrome → 快照)", async () => {
      const r = await callTool("flow_status", {});
      if (r.isError) {
        assert.doesNotMatch(r.text, /S000/);
        assert.match(r.text, /\[flow\] S1\d\d/, "失败只能是环境前置错(结构化,自带启动指引)");
      }
    });
  });

  test("对照:未知渠道报错不受影响(零网络)", async () => {
    await boot(cfgUnchained);
    try {
      const r = await callTool("generate_image", { prompt: "x", provider: "no-such-provider" });
      assert.ok(r.isError);
      assert.match(r.text, /Unknown provider/);
    } finally { killServer(); }
  });
});
