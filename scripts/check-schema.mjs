// schema 真源锁:断言 create_video 的 numFrames/frameRate enum === 视频链头的 videoConstraints()。
// 自适应(agnes/zhipu/flow 均可),不硬编码。入库(scripts/,非 _ 前缀),接入 npm test + prepublishOnly,防 schema↔运行时漂移进发版。
// C 任务:链头 = videoProviderPriority[0](若配置且具备 video 能力,与 src/index.ts buildTools 同真源)→ 否则 defaultVideoProvider。
import { spawn } from "node:child_process";
import { config } from "../dist/config.js";
import { getProvider, asVideoProvider } from "../dist/providers/registry.js";

let effProvider = config.videoProviderChainHead;
try {
  effProvider = asVideoProvider(getProvider(effProvider)).name;
} catch {
  effProvider = config.defaultVideoProvider; // 链头无 video 能力(配置异常)→ 回落 legacy 默认
}
const vc = getProvider(effProvider).videoConstraints();
console.log(`默认 video provider = ${effProvider} → allowedNumFrames ${JSON.stringify(vc.allowedNumFrames)} / allowedFrameRates ${JSON.stringify(vc.allowedFrameRates)}\n`);

const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "", id = 0;
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
function send(method, params) {
  const myId = ++id;
  return new Promise((resolve) => { pending.set(myId, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n"); });
}

let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✅ " + m); pass++; };
const bad = (m) => { console.error("  ❌ " + m); fail++; };
const eq = (a, b, m) => JSON.stringify(a) === JSON.stringify(b) ? ok(m) : bad(`${m} (得 ${JSON.stringify(a)}, 期 ${JSON.stringify(b)})`);

try {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "schema-check", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const r = await send("tools/list", {});
  const tools = r.result.tools;

  console.log("[G1] create_video schema enum === videoConstraints(单一真源,自适应 provider)");
  const cv = tools.find((t) => t.name === "create_video");
  if (!cv) bad("create_video 工具未找到");
  else {
    eq(cv.inputSchema.properties.numFrames.enum, vc.allowedNumFrames, `numFrames.enum === ${effProvider} allowedNumFrames`);
    eq(cv.inputSchema.properties.frameRate.enum, vc.allowedFrameRates, `frameRate.enum === ${effProvider} allowedFrameRates`);
  }

  console.log("[G2] 22 工具齐全(pares5 M2 +extract_table/analyze_chart/describe_image;pares6 +list_vision_capabilities/extract_pdf/get_pdf;P0-5 +generate_interactive_diagram;P0-5B +generate_nested_diagram;P0-6 +extract_image_meta。flow_status/flow_entity 已随 Google Flow 渠道分离至 flow-mcp,本包回落 22)");
  eq(tools.map((t) => t.name).sort(), ["analyze_chart", "create_video", "describe_image", "extract_image_meta", "extract_pdf", "extract_table", "extract_text", "generate_card", "generate_chart", "generate_diagram", "generate_formula", "generate_icon", "generate_image", "generate_interactive_diagram", "generate_nested_diagram", "generate_qrcode", "get_pdf", "get_video", "list_models", "list_vision_capabilities", "render_svg", "render_video"], "22 工具齐全");

  console.log("[G3] mode/resolution schema enum 与共享常量一致(0.8.1 单一真源)");
  if (cv) {
    eq(cv.inputSchema.properties.mode.enum, ["text-to-video", "image-to-video", "keyframes"], "mode.enum 三值");
    eq(cv.inputSchema.properties.resolution.enum, ["480p", "720p", "1080p"], "resolution.enum 三值");
  }
} catch (e) {
  bad("抛错: " + (e?.message ?? String(e)));
} finally {
  proc.kill();
}
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
