/**
 * flow 工具集成测试(MCP server 全链路:stdio 协议 → handler → provider → CDP 页面上下文)。
 *
 * 🔴🔴 安全铁律(审查 03 验收条款,逐字执行):
 *   本文件只打【零消耗只读端点】—— session / credits / projectInitialData / getMediaUrlRedirect(下载)。
 *   绝不出现任何生成提交调用(batchAsyncGenerateVideoText / batchGenerateImages 的 POST 路径),
 *   绝不等待或触发真实提交 —— create_video 在本文件里只测"参数校验拒绝路径"(抛错先于任何提交)
 *   与"确认挑战返回路径"(needConfirm 先于任何提交,零消耗;B-finding-1 补 live 正向用例)。
 *   实测对象 = 验收指定的 2 条已有视频 mediaId(2026-08-21 生成,SUCCESSFUL):
 *     60679485-0863-4007-8ea1-314ed661168d / fe8b13c7-f7be-44a4-847d-8b6e843a5ff4
 *
 * 前置:CDP 127.0.0.1:9223(lasso Chrome,labs.google 已登录,页面在 Flow 项目页)。
 * CDP 不可达时全部 skip(非 fail)—— 五阶段门禁在无 Chrome 环境(如 CI)仍绿。
 * 跑前必须 npm run build(dist/index.js 存在;npm test 已按此顺序编排)。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MEDIA_A = "60679485-0863-4007-8ea1-314ed661168d";
const MEDIA_B = "fe8b13c7-f7be-44a4-847d-8b6e843a5ff4";
const CDP_PORT = 9223;
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── CDP 探活:不可达 → skip 全部 ──
// 探活预算(2026-08-31 live 实证):全量 npm test 并行起 560 测时,模块加载期本机饱和,
// 旧 2s 预算可被健康 CDP 的 /json/version 挤爆 → live 套件被误 skip(2157ms 实测复现)。
// Chrome 未启动时 ECONNREFUSED 是即时失败,放宽预算不拖慢常规 skip 路径。
async function cdpAlive() {
  if (process.env.FLOW_IT_SKIP === "1") return false;
  // CI 语义守卫:CI=true(含本地 CI-parity:HOME=mktemp + CI=true)强制不真连 —— 干净 HOME 下
  // flow-project.json 缺失,真连会触发 ensureProjectId 自动新建项目(🔴 教训:账号被 CI 门禁污染)。
  // CI runner 本就无 Chrome(ECONNREFUSED 即时 skip),此守卫把该语义固化,不依赖运行环境巧合。
  if (process.env.CI === "true") return false;
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
  } catch { return false; }
  // B3 自有修复:端口可达 ≠ 登录有效 —— 追加零消耗业务端点探测(projectInitialData)。
  // 实证半态两变体:①session API 401;②session 200 但 tRPC 401 UNAUTHORIZED(next-auth 半失效)
  // —— 用真实业务端点探测才能覆盖两者。
  // 2026-08-31 live 实证(B-finding-1 验证时发现):伪造/不存在 projectId 一律 400 BAD_REQUEST,
  // 旧探针('probe')在本机健康登录态下也拿不到 200 → live 门永久 skip、套件从不真跑。
  // 改用 ~/.media-gen-mcp/flow-project.json 的真 projectId(只读,与 flow_status 同端点零消耗);
  // 无状态文件时退回 UUID 占位 —— 400 仍证明 tRPC 以非 401 处理了请求(半态只会 401),同样算健康。
  const projId = (() => {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".media-gen-mcp/flow-project.json"), "utf-8"));
      if (typeof p.projectId === "string" && /^[0-9a-f][0-9a-f-]{6,63}$/i.test(p.projectId)) return p.projectId;
    } catch { /* 无状态文件 → 占位 UUID */ }
    return "00000000-0000-4000-8000-000000000000";
  })();
  try {
    const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
    const page = (pages || []).find((t) => t.type === "page" && /labs\.google/.test(t.url));
    if (!page) return false;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); setTimeout(rej, 8000, new Error("timeout")); });
    const healthy = await new Promise((resolve) => {
      const id = 1;
      ws.onmessage = (m) => {
        try {
          const d = JSON.parse(m.data);
          if (d.id === id) {
            const v = d.result?.result?.value;
            resolve(typeof v === "object" && v !== null && (v.http === 200 || v.http === 400));
          }
        } catch { resolve(false); }
      };
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: `(async()=>{try{const inp=encodeURIComponent(JSON.stringify({json:{projectId:'${projId}'}}));const r=await fetch('/fx/api/trpc/flow.projectInitialData?input='+inp,{credentials:'include'});return {http:r.status}}catch(e){return {http:0}}})()`, awaitPromise: true, returnByValue: true } }));
      setTimeout(() => resolve(false), 20000);
    });
    try { ws.close(); } catch {}
    return healthy;
  } catch { return false; }
}

// ── MCP server stdio 客户端(同 scripts/check-schema.mjs 范式) ──
let proc = null, buf = "", nextId = 0;
const pending = new Map();
function startServer() {
  proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT });
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
  proc.stderr.on("data", () => {}); // server 日志不进测试输出
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
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { isError: !!r?.result?.isError, text, parsed };
}

before(async () => {
  if (!(await cdpAlive())) return;
  startServer();
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "flow-it", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});
after(() => { if (proc) proc.kill(); });

describe("flow 工具集成(真实 CDP;仅零消耗端点)", { skip: await (async () => !(await cdpAlive()))() }, () => {

  test("tools/list:flow_status 注册在列(23 工具;flow_entity 已按用户裁决移除 2026-08-26)", async () => {
    const r = await send("tools/list", {});
    const names = r.result.tools.map((t) => t.name);
    assert.ok(names.includes("flow_status"), `flow_status 缺失:${names.join(",")}`);
    assert.ok(!names.includes("flow_entity"), "flow_entity 应已移除");
    assert.equal(names.length, 23);
  });

  test("flow_status 全量自省:登录邮箱/积分/动态目录/媒体列表", async () => {
    const { isError, parsed, text } = await callTool("flow_status", {});
    assert.equal(isError, false, text.slice(0, 200));
    assert.equal(parsed.ok, true);
    assert.match(parsed.email, /@/);
    assert.equal(typeof parsed.credits.credits, "number");
    assert.ok(parsed.credits.credits >= 0);
    assert.ok(parsed.video_families.length >= 5, "视频家族目录非空");
    assert.ok(parsed.video_families.some((f) => f.usages.some((u) => u.key === "abra_t2v_8s")));
    assert.ok(parsed.media.some((m) => m.mediaId === MEDIA_A));
    assert.ok((parsed.preset_voices ?? []).length >= 30, "30 预设语音折入快照(§11.6)");
  });

  test("flow_status 批量参数互斥校验(纯参数校验路径,零网络)", async () => {
    const { isError, text } = await callTool("flow_status", { mediaId: MEDIA_A, shareMediaIds: [MEDIA_A] });
    assert.equal(isError, true);
    assert.match(text, /互斥/);
  });

  test("flow_status mediaId:已有视频状态查询(MEDIA_A → completed/abra_t2v_8s)", async () => {
    const { isError, parsed, text } = await callTool("flow_status", { mediaId: MEDIA_A, download: false });
    assert.equal(isError, false, text.slice(0, 200));
    assert.equal(parsed.status, "completed");
    assert.equal(parsed.kind, "video");
    assert.equal(parsed.model, "abra_t2v_8s");
    assert.equal(parsed.rawStatus, "MEDIA_GENERATION_STATUS_SUCCESSFUL");
    assert.equal(parsed.download, undefined); // download:false 不落盘
  });

  test("flow_status mediaId + thumbnail → 200 落盘 raw JPEG(缩略图字节 ≠ mediaBlobSize 不得误报 S402;契约 §10.9 勘误回归)", { timeout: 120_000 }, async () => {
    // 零消耗只读端点(getMediaUrlRedirect;F 轮 live:2.5MB 视频的缩略图 = 43,007B raw JPEG)
    // 旧 bug:完整性闸门拿缩略图字节对比原资产 mediaBlobSize → 已完成视频 100% 误报 "[flow] S402 下载不完整"
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-it-thumb-"));
    const { isError, parsed, text } = await callTool("flow_status", { mediaId: MEDIA_A, thumbnail: true, outDir });
    assert.equal(isError, false, text.slice(0, 300));
    assert.equal(parsed.status, "completed");
    assert.ok(parsed.local_path?.endsWith(".jpg"), `local_path=${parsed.local_path}`);
    const buf = fs.readFileSync(parsed.local_path);
    assert.equal(buf[0], 0xff, "JPEG magic 第一字节 FF");
    assert.equal(buf[1], 0xd8, "JPEG magic 第二字节 D8(§2.6 勘误:raw JPEG 字节,非 base64 文本)");
    assert.ok(parsed.downloaded_bytes > 0);
    assert.ok(parsed.downloaded_bytes !== parsed.bytes, `缩略图 ${parsed.downloaded_bytes}B 应 ≠ 原资产 mediaBlobSize ${parsed.bytes}B(本就不同,不得触发 S402)`);
  });

  test("flow_status mediaId + download:真实下载 mp4(magic bytes 校验)", { timeout: 120_000 }, async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-it-"));
    const { isError, parsed, text } = await callTool("flow_status", { mediaId: MEDIA_B, download: true, outDir });
    assert.equal(isError, false, text.slice(0, 200));
    assert.equal(parsed.status, "completed");
    assert.ok(parsed.local_path?.endsWith(".mp4"), `local_path=${parsed.local_path}`);
    const st = fs.statSync(parsed.local_path);
    assert.ok(st.size > 100_000, `mp4 过小(${st.size}B)`);
    const head = fs.readFileSync(parsed.local_path).subarray(4, 8).toString("latin1");
    assert.equal(head, "ftyp", "mp4 magic bytes");
    assert.ok(parsed.downloaded_bytes > 100_000);
  });

  test("flow_status 未知 mediaId → 结构化 [flow] S400", async () => {
    const { isError, text } = await callTool("flow_status", { mediaId: "not-a-real-media-id" });
    assert.equal(isError, true);
    assert.match(text, /^\[flow\] S400 /);
  });

  test("get_video provider=flow:零消耗取件 + 落盘(响应剔除 data: URI 防上下文爆炸)", { timeout: 120_000 }, async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-it-vid-"));
    const { isError, parsed, text } = await callTool("get_video", { provider: "flow", taskId: MEDIA_A, outDir, name: "flow_it_media_a" });
    assert.equal(isError, false, text.slice(0, 300));
    assert.equal(parsed.status, "completed");
    assert.equal(parsed.url, undefined, "data: URI 必须从响应剔除");
    assert.ok(parsed.url_omitted.includes("已省略"));
    assert.ok(parsed.local_path.endsWith(".mp4"));
    assert.ok(fs.statSync(parsed.local_path).size > 100_000);
    assert.equal(parsed.raw.model, "abra_t2v_8s");
  });

  test("create_video provider=flow 校验拒绝:无 model → [flow] S300(零提交)", async () => {
    // 零消耗:provider 在任何提交前抛错(视频提交消耗积分,本测试只验证拒绝路径)
    const { isError, text } = await callTool("create_video", { provider: "flow", prompt: "integration guard" });
    assert.equal(isError, true);
    assert.match(text, /^\[flow\] S300 /);
    assert.ok(text.includes("消耗积分"), "S300 应说明消耗语义(刻意无默认模型)");
  });

  test("create_video provider=flow 校验拒绝:t2v key + image → [flow] S301 指路 i2v key(零提交)", async () => {
    // 零消耗:provider 在任何提交前抛错(模式↔参数交叉校验;2026-08-23 开放 i2v,形状不匹配给出指路错误)
    const { isError, text } = await callTool("create_video", {
      provider: "flow", prompt: "x", model: "abra_t2v_8s", image: "https://example.com/a.png",
    });
    assert.equal(isError, true);
    assert.match(text, /^\[flow\] S301 /);
    assert.ok(text.includes("abra_i2v_8s"), "应指路 i2v key");
  });

  test("generate_image provider=flow 校验拒绝:images 相对路径 → 工具层结构化拒绝(零提交)", async () => {
    const { isError, text } = await callTool("generate_image", {
      provider: "flow", prompt: "x", images: ["local/a.png"],
    });
    assert.equal(isError, true);
    // 工具层输入校验先于 provider,不触达 provider POST。日志#16 起绝对本地路径已被接受+本地化
    // (读取失败/超限/嗅探失败等分支由死端口套件 flow-localinput.integration.test.mjs 确定性覆盖),
    // 拒绝路径用相对路径触发(仍走结构化拒绝分支)。
    assert.ok(/data: URI|http\(s\)/.test(text), text.slice(0, 160));
  });

  test("create_video provider=flow 正向:本地绝对路径 PNG keyframes → 工具侧本地化,到达确认门(needConfirm,零提交)", { timeout: 120_000 }, async () => {
    // B-finding-1 补 live 正向用例(参照 flow-localinput.integration.test.mjs 的 needConfirm 断言):
    // 日志#16 本地路径链路在真实 CDP 下的正向证明 —— 绝对路径 PNG 由工具侧读取转 data: URI
    // (否则旧 URI 校验会先拒绝),keyframes 随确认门第一段返回挑战。结构上零提交:挑战返回
    // 先于上传/提交,不消耗积分、不触发生成 POST。
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-it-kf-"));
    const pngPath = path.join(tmpDir, "k.png");
    fs.writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    try {
      const { isError, parsed, text } = await callTool("create_video", {
        provider: "flow", prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: [pngPath, pngPath],
      });
      assert.equal(isError, false, text.slice(0, 200));
      assert.equal(parsed.needConfirm, true, "本地 keyframes 通过输入校验,走到确认挑战(未提交)");
      assert.match(parsed.confirmToken, /^fvc1\./);
      assert.doesNotMatch(text, /须为 http/, "不再是旧的 URI 校验拒绝");
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test("list_models:flow 在册(77+ 静态视频目录 + 4 图片模型)", async () => {
    const { isError, parsed } = await callTool("list_models", {});
    assert.equal(isError, false);
    assert.ok(parsed.providers.includes("flow"));
    assert.ok(parsed.detail.flow.videoModels.includes("abra_t2v_8s"));
    assert.ok(parsed.detail.flow.videoModels.includes("veo_3_1_t2v_lite"));
    assert.deepEqual(parsed.detail.flow.imageModels, ["GEM_PIX_2", "NARWHAL", "HARBOR_SEAL", "GEM_PIX_2_UPSAMPLE_2K"]);
  });
});
