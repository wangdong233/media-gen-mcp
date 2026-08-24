/**
 * flow.enabled=false S000 硬门 集成测试(真实 server 进程 + stdio MCP 协议)。
 *
 * 2026-08-24 合包吸收自 flow-mcp:门在任何 CDP 探测/生成提交之前生效 —— 无 Chrome、无 API key、
 * 零网络零积分即可全量跑(CI 常绿;对照 flow-tools.integration.test.mjs 需真实 CDP 才 skip)。
 *
 * 配置隔离:MEDIA_GEN_MCP_CONFIG 指向 tmp config(吸收自 flow-mcp 的 FLOW_MCP_CONFIG 机制),
 * 绝不触碰本机 ~/.media-gen-mcp/config.json。
 *
 * 断言面(用户裁决验收 ①):flow.enabled=false 时
 *   - 工具仍注册(注册+门禁,禁用态自解释 —— 用户不会只见工具"消失")
 *   - 优先级链剔除:generate_image 的 provider 参数默认值 = 链剔除后的头(agnes)
 *   - 显式 provider=flow / flow 模型 / flow_status / flow_entity / get_video(provider=flow)
 *     → 结构化 "[flow] S000" 错(自带修复动作),绝不静默换渠道
 *   - create_video(provider=flow) 在任何提交之前被拦(结构性零积分)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── tmp config:flow.enabled=false + imageProviderPriority 链头为 flow(验证剔除) ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-gate-"));
const cfgPath = path.join(tmpDir, "config.json");
fs.writeFileSync(cfgPath, JSON.stringify({
  imageProviderPriority: ["flow", "agnes"],
  flow: { enabled: false },
}, null, 2));

// ── MCP server stdio 客户端(同 flow-tools.integration.test.mjs 范式) ──
let proc = null, buf = "", nextId = 0;
const pending = new Map();
function startServer() {
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
  proc.stderr.on("data", () => {}); // server 日志(链剔除 warn)不进测试输出
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

before(async () => {
  startServer();
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "flow-gate-it", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});
after(() => {
  if (proc) proc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("flow.enabled=false:S000 硬门(注册+门禁;零网络零积分)", () => {

  test("tools/list:24 工具仍注册(flow_status/flow_entity 在列 —— 禁用态自解释)", async () => {
    const r = await send("tools/list", {});
    const names = (r?.result?.tools ?? []).map((t) => t.name);
    assert.equal(names.length, 24);
    assert.ok(names.includes("flow_status"));
    assert.ok(names.includes("flow_entity"));
  });

  test("优先级链剔除:imageProviderPriority=[flow,agnes] + 禁用 → provider 默认值 = agnes", async () => {
    const r = await send("tools/list", {});
    const gen = (r?.result?.tools ?? []).find((t) => t.name === "generate_image");
    assert.equal(gen?.inputSchema?.properties?.provider?.default, "agnes", "链头 flow 被剔除后,默认回落 agnes");
  });

  test("generate_image(provider=flow) → [flow] S000 结构化错(显式点名,不静默换渠道)", async () => {
    const r = await callTool("generate_image", { prompt: "x", provider: "flow" });
    assert.ok(r.isError);
    assert.match(r.text, /^\[flow\] S000 /);
    assert.ok(r.text.includes("改回 true"), "禁用错自带修复动作");
  });

  test("generate_image(model=NARWHAL,未点名 provider)→ [flow] S000(模型归属路由同样拦截)", async () => {
    const r = await callTool("generate_image", { prompt: "x", model: "NARWHAL" });
    assert.ok(r.isError);
    assert.match(r.text, /\[flow\] S000 /);
  });

  test("create_video(provider=flow, abra_t2v_8s) → [flow] S000(提交之前被拦,结构性零积分)", async () => {
    const r = await callTool("create_video", { prompt: "x", provider: "flow", model: "abra_t2v_8s" });
    assert.ok(r.isError);
    assert.match(r.text, /\[flow\] S000 /);
  });

  test("get_video(provider=flow) → [flow] S000", async () => {
    const r = await callTool("get_video", { provider: "flow", taskId: "00000000-0000-4000-8000-000000000000" });
    assert.ok(r.isError);
    assert.match(r.text, /\[flow\] S000 /);
  });

  test("flow_status() / flow_entity() → [flow] S000(渠道专属工具入口即刻报错)", async () => {
    const a = await callTool("flow_status", {});
    assert.ok(a.isError);
    assert.match(a.text, /^\[flow\] S000 /);
    const b = await callTool("flow_entity", { action: "list" });
    assert.ok(b.isError);
    assert.match(b.text, /^\[flow\] S000 /);
  });

  test("对照:未知渠道报错不是 S000(门只针对被禁渠道,零网络)", async () => {
    const r = await callTool("generate_image", { prompt: "x", provider: "no-such-provider" });
    assert.ok(r.isError);
    assert.doesNotMatch(r.text, /S000/);
    assert.match(r.text, /Unknown provider/);
  });
});
