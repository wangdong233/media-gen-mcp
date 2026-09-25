// doc/OCR_测试集/run-ocr.mjs
/**
 * 用本 MCP 的 extract_text 工具(经 MCP handler 全链路,含 filterIgnoreAreas+applyTbpu)
 * 识别一张图片,输出 JSON。供 OCR 对比测试复用。
 *
 * 用法(在项目根目录运行):
 *   node doc/OCR_测试集/run-ocr.mjs --image doc/OCR_测试集/s1_manual.png \
 *     --params '{"languages":["zh-Hans","en"],"layout":"natural"}'
 *
 * 输出(stdout 末行 JSON):{ isError, text, blocks, provider }
 *   digitOnly/segmentation/layout/languages/ignoreAreas 等均经 --params 透传给 extract_text。
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let image = null;
let params = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--image") { image = args[i + 1]; i++; }
  else if (args[i] === "--params") { params = JSON.parse(args[i + 1]); i++; }
}
if (!image) { console.error("missing --image <path>"); process.exit(2); }

const ext = image.toLowerCase().split(".").pop();
const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
  : ext === "webp" ? "image/webp"
  : ext === "gif" ? "image/gif"
  : "image/png";
const dataUri = `data:${mime};base64,` + readFileSync(image).toString("base64");

const cwd = process.cwd();
const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], cwd });
let buf = "", id = 0;
const pending = new Map();
proc.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
proc.stderr.on("data", () => {});
const send = (m, p) => new Promise((r) => { const i = ++id; pending.set(i, r); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method: m, params: p }) + "\n"); });
const notify = (m, p) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: m, params: p }) + "\n");

try {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "run-ocr", version: "1" } });
  notify("notifications/initialized", {});
  const r = await send("tools/call", { name: "extract_text", arguments: { image: dataUri, ...params } });
  const txt = r.result?.content?.[0]?.text ?? "{}";
  let parsed = {};
  try { parsed = JSON.parse(txt); } catch { parsed = { text: txt }; }
  const out = {
    isError: !!r.result?.isError,
    text: parsed.text ?? "",
    blocks: parsed.blocks?.length ?? 0,
    provider: parsed.provider_used,
  };
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ isError: true, text: "", error: e?.message ?? String(e) }));
} finally {
  proc.kill();
  process.exit(0);
}
