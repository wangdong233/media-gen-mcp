#!/usr/bin/env node
/**
 * E2E 工具批测(真实 stdio JSON-RPC 驱动 dist server —— 与 CC 消费方式一致)
 *
 * 定位:npm test(白盒 stub)之上的**真实链路**自动化验收 —— L0 本地引擎/L1 免费云(本机 config 的
 * agnes/zhipu/glm-vision key)/L2 Google Flow(CDP 9223,零积分操作;视频只到确认门第一段 needConfirm,
 * 🔴 绝不真实提交)/L3' attach 渲染档(lasso render-chrome,golden 对比 = attach 双渲 byte-identical)。
 * 有网络/Chrome 依赖,不进 npm test 门禁,手动/按需跑。
 *
 * 用法:node scripts/e2e-tools.mjs [--only L0|L1|L2|L3'|<工具名逗号>]
 */
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SERVER = path.resolve(import.meta.dirname, "../dist/index.js");
const OUT = path.resolve(process.cwd(), "output", "e2e");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

const proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
let buf = ""; const pending = new Map(); let nextId = 1;
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try { const msg = JSON.parse(line); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {}
  }
});
proc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

function call(method, params, timeoutMs = 110_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时(>${Math.round(timeoutMs / 1000)}s)`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
async function tool(name, args, timeoutMs) {
  const r = await call("tools/call", { name, arguments: args }, timeoutMs);
  const text = (r.result?.content ?? []).map((c) => c.text).join("\n");
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { isError: r.result?.isError === true || r.error != null, text, parsed, raw: r };
}

// ── 断言 helper ──
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✖ ${name}${detail ? ` — ${String(detail).slice(0, 180)}` : ""}`); }
}
const fileOk = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };

// ── 用例(分档;skip 逻辑:--only 过滤 + 环境探测) ──
const L2FLOW = (() => { try { return /\bCDP\b/.test("") || fs.existsSync(process.env.HOME + "/.media-gen-mcp/flow-project.json"); } catch { return false; } })();
const CASES = [
  // ═══ L0 本地引擎(免 Key 免网络)═══
  { lvl: "L0", tool: "generate_card", name: "card OG 出图", args: { title: "E2E 验收卡", subtitle: "media-gen-mcp", template: "og" }, check: (r) => { check("card 返回 local_path 且文件非空", r.parsed?.local_path && fileOk(r.parsed.local_path)); } },
  { lvl: "L0", tool: "generate_qrcode", name: "qrcode 矢量", args: { text: "https://github.com/wangdong233/media-gen-mcp" }, check: (r) => check("qrcode svg 产出", (r.parsed?.local_path ?? r.parsed?.file ?? "").length > 0) },
  { lvl: "L0", tool: "generate_formula", name: "formula LaTeX", args: { tex: "\\int_0^\\infty e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2}" }, check: (r) => check("formula svg 产出", (r.parsed?.local_path ?? r.parsed?.file ?? "").length > 0) },
  { lvl: "L0", tool: "generate_diagram", name: "diagram D2", args: { code: "direction: right\na -> b: t" }, check: (r) => check("diagram svg 产出", (r.parsed?.local_path ?? r.parsed?.file ?? "").length > 0) },
  { lvl: "L0", tool: "generate_chart", name: "chart Vega-Lite", args: { spec: { data: { values: [{ a: "A", b: 28 }, { a: "B", b: 55 }] }, mark: "bar", encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } } } }, check: (r) => check("chart svg 产出", (r.parsed?.local_path ?? r.parsed?.file ?? "").length > 0) },
  { lvl: "L0", tool: "list_models", name: "list_models 自省", args: {}, check: (r) => { const j = JSON.stringify(r.parsed ?? r.text); check("list_models 含 agnes/zhipu/flow 七家", /agnes/.test(j) && /zhipu/.test(j) && /flow/.test(j)); } },
  { lvl: "L0", tool: "list_vision_capabilities", name: "vision 能力自省", args: {}, check: (r) => check("vision 能力返回", !r.isError) },
  { lvl: "L0", tool: "extract_text", name: "OCR 损坏图(进程兜底:快速错误且 server 存活)", args: { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAUUlEQVR4nO3QMQ0AMAgEQXCf7l1KwUgK33MBPvVM7gY6/jCA9wzgPQP+MOA9A/4w4D0D/jDgPQP+MOA9A/4w4D0D/jDgPQP+MOA9A84BaQQEg6yFXoAAAAAElFTkSuQmCC" }, timeout: 30_000, check: (r) => check("坏图 → 错误返回(而非击穿 server)", r.isError) },
  { lvl: "L0", tool: "extract_text", name: "OCR 好图正向(1x1 PNG,空文本也算成功)", args: { image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }, timeout: 90_000, check: (r) => check("好图 OCR 成功返回", !r.isError) },

  // ═══ L1 免费云(本机 config key)═══
  { lvl: "L1", tool: "generate_image", name: "agnes 生图(免费)", args: { prompt: "a minimal red circle on white background, flat vector", provider: "agnes", name: "e2e-agnes" }, timeout: 100_000, check: (r) => { check("agnes 图落盘", r.parsed?.local_paths?.[0] && fileOk(r.parsed.local_paths[0])); } },

  // ═══ L2 Google Flow(零积分;🔴 视频只到确认门第一段)═══
  { lvl: "L2", tool: "flow_status", name: "flow 快照(自愈链上的入口)", args: {}, skip: !L2FLOW, check: (r) => { const j = JSON.stringify(r.parsed ?? r.text); check("快照含积分与目录", /credits/.test(j) && /(video_families|image_families)/.test(j)); } },
  { lvl: "L2", tool: "generate_image", name: "flow 生图 0 积分 + 本地路径输入(改动面)", args: { prompt: "a paper crane on a desk, soft light", provider: "flow", seed: 424242, name: "e2e-flow" }, timeout: 110_000, skip: !L2FLOW, check: (r) => { const o = r.parsed?.outputs?.[0] ?? {}; check("flow 图落盘+mediaId+seed 回读", o.mediaId && o.seed === 424242 && r.parsed.local_paths?.[0] && fileOk(r.parsed.local_paths[0])); } },
  { lvl: "L2", tool: "create_video", name: "确认门第一段 needConfirm(🔴 零提交)", args: { prompt: "e2e confirm-gate probe, not for submission", provider: "flow", model: "veo_3_1_t2v_lite" }, skip: !L2FLOW, check: (r) => { const j = JSON.stringify(r.parsed ?? r.text); check("返回 needConfirm+confirmToken 且未提交", /needConfirm/.test(j) && /confirmToken/.test(j) && !/taskId/.test(j)); } },
  { lvl: "L2", tool: "create_video", name: "ratio 非法在确认门即拒(改动面 A1)", args: { prompt: "x", provider: "flow", model: "veo_3_1_t2v_lite", ratio: "1:1" }, skip: !L2FLOW, check: (r) => check("S301 前置拒绝(不进确认)", r.isError && /S301/.test(r.text)) },
  { lvl: "L2", tool: "create_video", name: "tier 不可用 key 不发令牌(改动面 B9 前置)", args: { prompt: "x", provider: "flow", model: "veo_3_1_t2v_fast_ultra" }, skip: !L2FLOW, check: (r) => check("S303+per-tier 矩阵", r.isError && /S303/.test(r.text) && /UNAVAILABLE/.test(r.text)) },
];

// ── 执行 ──
const t0 = Date.now();
const init = await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
console.log(`[e2e] server=${path.basename(SERVER)} init=${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
await call("notifications/initialized", {});
fs.mkdirSync(OUT, { recursive: true });

const onlyKeys = only ? only.split(",").map((k) => k.trim()) : null;
const selected = CASES.filter((c) => c.skip !== true && (!onlyKeys || onlyKeys.some((k) => c.lvl === k || c.tool === k)));
console.log(`[e2e] 选中 ${selected.length}/${CASES.length} 例${onlyKeys?.includes("L3'") || !onlyKeys ? " +L3' 档" : ""}\n`);
for (const c of selected) {
  const s = Date.now();
  console.log(`▶ [${c.lvl}] ${c.tool} — ${c.name}`);
  try {
    const r = await tool(c.tool, c.args, c.timeout ?? 60_000);
    c.check(r);
  } catch (e) { check(`${c.name} 调用成功`, false, e.message); }
  console.log(`  (${((Date.now() - s) / 1000).toFixed(1)}s)\n`);
}

// ═══ L3' attach 渲染档(lasso render-chrome;对接契约 §三.2 消费方迁移门槛)═══
// golden 对比 = 同一 SVG 经 attach 渲染档双渲 byte-identical(需求 §五验收 2 的 E2E 化;
// 仓内无 Chrome 后端 golden fixture,byte-identity 即迁移硬门槛)。
if (!onlyKeys || onlyKeys.includes("L3'") || onlyKeys.includes("L3")) {
  console.log(`▶ [L3'] attach 渲染档 — lasso render-chrome golden 对比`);
  const t3 = Date.now();
  try { await runL3Prime(); } catch (e) { check("L3' 档执行成功", false, e.message); }
  console.log(`  (${((Date.now() - t3) / 1000).toFixed(1)}s)\n`);
}
proc.kill();
console.log(`════ E2E 汇总:${pass} pass / ${fail} fail / ${selected.length} 例,${((Date.now() - t0) / 1000).toFixed(0)}s ════`);
if (failures.length) { console.log("失败清单:"); failures.forEach((f) => console.log("  ✖ " + f)); process.exit(1); }
process.exit(0);

async function runL3Prime() {
  if (process.env.MEDIA_GEN_RENDER_MODE === "legacy") {
    console.log("  ↷ skip:MEDIA_GEN_RENDER_MODE=legacy(逃生门钉死,attach 不可达)");
    return;
  }
  // lasso 可用性探测:显式 bin > PATH 直查;不可得即 skip(lasso 未装,非 fail)
  const lassoBin = process.env.MEDIA_GEN_LASSO_BIN?.trim() || (() => {
    const r = spawnSync("lasso-mcp", ["render-chrome", "--status"], { timeout: 10_000, encoding: "utf8" });
    return r.error ? null : "lasso-mcp";
  })();
  if (!lassoBin) {
    console.log("  ↷ skip:lasso-mcp 不可用(装:npm i -g lasso-mcp,或设 MEDIA_GEN_LASSO_BIN)");
    return;
  }

  // 1) ensure:exit 0 + stdout 单行 JSON 字段齐(对接 §一.1)
  const ensure1 = spawnSync(lassoBin, ["render-chrome", "--ensure"], { timeout: 30_000, encoding: "utf8" });
  let info1 = null;
  try { info1 = JSON.parse((ensure1.stdout ?? "").trim().split("\n").pop()); } catch {}
  check("ensure exit 0 + wsEndpoint/touchPath 字段齐", ensure1.status === 0 && !!info1?.wsEndpoint && !!info1?.touchPath, `exit=${ensure1.status} stdout=${(ensure1.stdout ?? "").slice(0, 120)}`);

  // 2) 幂等:二次 ensure → reused:true
  const ensure2 = spawnSync(lassoBin, ["render-chrome", "--ensure"], { timeout: 30_000, encoding: "utf8" });
  let info2 = null;
  try { info2 = JSON.parse((ensure2.stdout ?? "").trim().split("\n").pop()); } catch {}
  check("ensure 幂等:二次 reused=true", ensure2.status === 0 && info2?.reused === true);

  // 3) attach 双渲 golden 对比:同一含滤镜 SVG 渲两次,Chrome 后端 byte-identical
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><filter id="g"><feGaussianBlur stdDeviation="5"/></filter></defs><rect width="320" height="180" fill="#010409"/><circle cx="160" cy="90" r="48" fill="#f59e0b" filter="url(#g)"/></svg>`;
  const r1 = await tool("render_svg", { svg: SVG, backend: "chrome", name: "e2e-attach-1" });
  const r2 = await tool("render_svg", { svg: SVG, backend: "chrome", name: "e2e-attach-2" });
  check("attach 双渲 backend=chrome(经渲染档,非 resvg 降级)", r1.parsed?.backend === "chrome" && r2.parsed?.backend === "chrome", `backend=${r1.parsed?.backend}/${r2.parsed?.backend} warning=${r1.parsed?.warning ?? "-"}`);
  const h = (p) => { try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch { return null; } };
  const h1 = h(r1.parsed?.local_path), h2 = h(r2.parsed?.local_path);
  check("attach golden 对比:双渲 PNG byte-identical", !!h1 && h1 === h2, `${h1?.slice(0, 16)} vs ${h2?.slice(0, 16)}`);
  const pngHead = h1 ? fs.readFileSync(r1.parsed.local_path).subarray(0, 4).toString("hex") : "";
  check("PNG magic bytes", pngHead === "89504e47", pngHead);

  // 4) render_video 经 attach(短样例,帧捕获 + ffmpeg 全链)
  const rv = await tool("render_video", { html: "<!DOCTYPE html><html><body style=\"margin:0;background:#000\"><div style=\"width:100px;height:60px;background:linear-gradient(90deg,red,yellow);animation:w 1s linear infinite alternate\"></div><style>@keyframes w{from{transform:translateX(0)}to{transform:translateX(200px)}}</style></body></html>", duration: 1, fps: 10, width: 320, height: 180, format: "mp4", name: "e2e-attach-video" }, 90_000);
  check("render_video 经 attach 产帧视频", !rv.isError && rv.parsed?.frame_count >= 5 && fileOk(rv.parsed?.local_path), `isError=${rv.isError} frames=${rv.parsed?.frame_count}`);

  // 5) 收尾自省:渲染档仍存活(消费方归还 = disconnect,生命周期归 lasso)
  const st = spawnSync(lassoBin, ["render-chrome", "--status"], { timeout: 10_000, encoding: "utf8" });
  let status = null;
  try { status = JSON.parse((st.stdout ?? "").trim().split("\n").pop()); } catch {}
  check("渲染档归还后仍存活(disconnect 非 close)", st.status === 0 && status?.running === true);
}
