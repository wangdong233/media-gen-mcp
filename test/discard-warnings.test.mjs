/**
 * B10 丢弃告警政策统一回归(2026-08-27):schema 已声明「xxx only」但运行时静默丢弃的参数,
 * 现全部按「丢弃必告警」补运行时 warning。本文件逐处钉文案 + 钉「被消费时不告警」。
 *
 * 覆盖(12 个丢弃点):
 *   1. generate_card blob(仅 hero 消费)/ quoteStyle(仅 quote 消费)
 *   2. generate_diagram theme(仅 D2 消费;graphviz 丢弃)/ diagramType(两引擎都不消费)
 *   3. generate_qrcode width(仅 PNG 消费)
 *   4. generate_formula width / background(仅 PNG 消费)
 *   5. generate_icon background(仅 PNG 消费;iconDiscardWarnings 纯函数,renderIcon 必联网故钉纯函数)
 *   6. render_svg scale(仅 Chrome 消费)/ width(仅 resvg 消费;含 svg 直通两参皆丢)
 *   7. describe_image question(paddle 不消费;本文件起 127.0.0.1 mock PaddleX,零外网)
 *   8. extract_image_meta includeRaw(仅 ComfyUI workflow JSON 可消费)
 *   9. server 级:丢弃告警经 handler 合并透出 + generate_card 的 blob 显式 true 不再被塌缩
 *
 * 跑前必须 npm run build(npm test 已按此顺序编排)。除 mock PaddleX(127.0.0.1)外零网络。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(PROJECT_ROOT, "dist");
const { renderCard } = require_(path.join(distDir, "card.js"));
const { renderQR } = require_(path.join(distDir, "qr.js"));
const { renderFormula } = require_(path.join(distDir, "formula.js"));
const { iconDiscardWarnings } = require_(path.join(distDir, "icon.js"));
const { renderSvg, renderSvgDiscardWarnings } = require_(path.join(distDir, "render-svg.js"));
const { GraphvizEngine } = require_(path.join(distDir, "diagram", "graphviz.js"));
const { D2Engine } = require_(path.join(distDir, "diagram", "d2.js"));
const { PaddleocrProvider } = require_(path.join(distDir, "providers", "paddle.js"));
const { extractImageMeta } = require_(path.join(distDir, "extract-image-meta.js"));

// ─────────────────────────── 1. generate_card 模板专属参数 ───────────────────────────
describe("B10 generate_card blob/quoteStyle 模板专属丢弃告警", () => {
  test("blob 显式传入 + 非 hero 模板 → 警告「仅 hero 模板消费」", async () => {
    const r = await renderCard({ title: "Hello", template: "og", blob: false });
    assert.ok(r.warnings?.some((w) => w.includes("blob 仅 hero 模板消费")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("blob 显式 true + 非 hero 模板 → 同样告警(handler 保留显式 true 后不再塌缩)", async () => {
    const r = await renderCard({ title: "Hello", template: "panel", blob: true });
    assert.ok(r.warnings?.some((w) => w.includes("blob 仅 hero 模板消费")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("blob + hero 模板(消费方)→ 无 blob 丢弃警告", async () => {
    const r = await renderCard({ title: "Hello", template: "hero", blob: false });
    assert.ok(!r.warnings?.some((w) => w.includes("blob 仅 hero")), `不该告警:${r.warnings?.join(" | ")}`);
  });
  test("quoteStyle 显式传入 + 非 quote 模板 → 警告「仅 quote 模板消费」", async () => {
    const r = await renderCard({ title: "Hello", template: "og", quoteStyle: "flank" });
    assert.ok(r.warnings?.some((w) => w.includes("quoteStyle 仅 quote 模板消费")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("quoteStyle + quote 模板(消费方)→ 无 quoteStyle 丢弃警告", async () => {
    const r = await renderCard({ title: "Hello", template: "quote", quoteStyle: "flank" });
    assert.ok(!r.warnings?.some((w) => w.includes("quoteStyle 仅 quote")), `不该告警:${r.warnings?.join(" | ")}`);
  });
  test("不传 blob/quoteStyle(默认)→ 无模板专属丢弃警告(默认调用不该收到自己没造成的警告)", async () => {
    const r = await renderCard({ title: "Hello", template: "og" });
    assert.ok(!r.warnings?.some((w) => w.includes("仅 hero 模板消费") || w.includes("仅 quote 模板消费")));
  });
});

// ─────────────────────────── 2. generate_diagram 引擎无关参数 ───────────────────────────
describe("B10 generate_diagram theme/diagramType 引擎丢弃告警", () => {
  const gv = new GraphvizEngine();
  test("graphviz + theme → 警告「仅 D2 引擎消费」", async () => {
    const r = await gv.render({ code: "digraph G { A -> B; }", engine: "graphviz", theme: "200" });
    assert.ok(r.warnings?.some((w) => w.includes("theme 仅 D2 引擎消费,graphviz 已忽略")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("graphviz 无 theme → 无 theme 丢弃警告", async () => {
    const r = await gv.render({ code: "digraph G { A -> B; }", engine: "graphviz" });
    assert.ok(!r.warnings?.some((w) => w.includes("theme 仅 D2")));
  });
  test("graphviz + diagramType → 警告「目前不影响渲染」", async () => {
    const r = await gv.render({ code: "digraph G { A -> B; }", engine: "graphviz", diagramType: "flowchart" });
    assert.ok(r.warnings?.some((w) => w.includes("diagramType 目前不影响渲染")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("d2 + diagramType → 同款「目前不影响渲染」警告(两引擎都不消费)", async () => {
    const d2 = new D2Engine();
    const r = await d2.render({ code: "a -> b", engine: "d2", diagramType: "sequence" });
    assert.ok(r.warnings?.some((w) => w.includes("diagramType 目前不影响渲染")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("d2 + theme(消费方)→ 无丢弃警告(d2 真消费 theme)", async () => {
    const d2 = new D2Engine();
    const r = await d2.render({ code: "a -> b", engine: "d2", theme: "1" });
    assert.ok(!r.warnings?.length, `d2 消费 theme/diagramType 未传,不该有丢弃告警:${r.warnings?.join(" | ")}`);
  });
});

// ─────────────────────────── 3. generate_qrcode width(PNG only) ───────────────────────────
describe("B10 generate_qrcode width SVG 丢弃告警", () => {
  test("format=svg + width → 警告「仅 PNG 输出消费」", async () => {
    const r = await renderQR({ text: "https://example.com", format: "svg", width: 300 });
    assert.ok(r.warnings?.some((w) => w.includes("width 仅 PNG 输出消费")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("format=png + width(消费方)→ 无 width 丢弃警告", async () => {
    const r = await renderQR({ text: "https://example.com", format: "png", width: 300 });
    assert.ok(!r.warnings?.some((w) => w.includes("width 仅 PNG")));
  });
});

// ─────────────────────────── 4. generate_formula width/background(PNG only) ───────────────────────────
describe("B10 generate_formula width/background SVG 丢弃告警", () => {
  test("svg(默认)+ width/background → 两条丢弃警告", async () => {
    const r = await renderFormula({ tex: "E=mc^2", width: 600, background: "#ffffff" });
    assert.ok(r.warnings?.some((w) => w.includes("width 仅 PNG 输出消费")), `width 实际:${r.warnings?.join(" | ")}`);
    assert.ok(r.warnings?.some((w) => w.includes("background 仅 PNG 输出消费")), `background 实际:${r.warnings?.join(" | ")}`);
  });
  test("format=png + width/background(消费方)→ 无丢弃警告", async () => {
    const r = await renderFormula({ tex: "E=mc^2", format: "png", width: 600, background: "#ffffff" });
    assert.ok(!r.warnings?.length, `png 消费两参,不该有丢弃告警:${r.warnings?.join(" | ")}`);
  });
});

// ─────────────────────────── 5. generate_icon background(PNG only;纯函数钉文案) ───────────────────────────
describe("B10 generate_icon background SVG 丢弃告警(iconDiscardWarnings)", () => {
  test("svg(默认)+ background → 警告「仅 PNG 输出消费」", () => {
    const w = iconDiscardWarnings({ name: "mdi:home", background: "#ffffff" });
    assert.ok(w.some((x) => x.includes("background 仅 PNG 输出消费")), `实际:${w.join(" | ")}`);
  });
  test("format=png + background(消费方)→ 无丢弃警告", () => {
    assert.equal(iconDiscardWarnings({ name: "mdi:home", format: "png", background: "#ffffff" }).length, 0);
  });
});

// ─────────────────────────── 6. render_svg scale/width(后端专属) ───────────────────────────
describe("B10 render_svg scale/width 后端专属丢弃告警", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
  test("resvg 后端 + scale → 警告「仅 Chrome 后端消费」(端到端)", async () => {
    const r = await renderSvg({ svg: SVG, format: "png", backend: "resvg", scale: 3 });
    assert.equal(r.backendUsed, "resvg");
    assert.ok(r.warnings?.some((w) => w.includes("scale 仅 Chrome 后端消费,resvg 后端已忽略")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("resvg 后端 + width(消费方)→ 无丢弃警告(端到端)", async () => {
    const r = await renderSvg({ svg: SVG, format: "png", backend: "resvg", width: 200 });
    assert.equal(r.warnings?.length ?? 0, 0);
  });
  test("svg 直通 + width/scale → 两条丢弃警告(端到端)", async () => {
    const r = await renderSvg({ svg: SVG, format: "svg", width: 200, scale: 2 });
    assert.equal(r.backendUsed, "passthrough");
    assert.ok(r.warnings?.some((w) => w.includes("width 仅 PNG 栅格化消费")), `width 实际:${r.warnings?.join(" | ")}`);
    assert.ok(r.warnings?.some((w) => w.includes("scale 仅 Chrome 后端 PNG 渲染消费")), `scale 实际:${r.warnings?.join(" | ")}`);
  });
  test("chrome 后端 + width → 警告「仅 resvg 后端消费」(纯函数钉文案;Chrome 路径不依赖本机 Chrome 在场)", () => {
    const w = renderSvgDiscardWarnings({ svg: SVG, width: 200, backend: "chrome" }, "chrome");
    assert.ok(w.some((x) => x.includes("width 仅 resvg 后端消费,Chrome 后端按 SVG 内在尺寸×scale 渲染,已忽略 width")), `实际:${w.join(" | ")}`);
  });
  test("chrome 后端 + scale(消费方)→ 无丢弃警告(纯函数)", () => {
    assert.equal(renderSvgDiscardWarnings({ svg: SVG, scale: 2, backend: "chrome" }, "chrome").length, 0);
  });
});

// ─────────────────────────── 7. describe_image question(paddle 不消费) ───────────────────────────
describe("B10 describe_image question 在 paddle 的丢弃告警(127.0.0.1 mock PaddleX,零外网)", () => {
  let server, baseUrl;
  before(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "mock 描述" } }] } }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server?.close(); });
  test("describe-image + question → 警告「paddle 不支持 question」", async () => {
    const p = new PaddleocrProvider({ baseUrl });
    const r = await p.recognize({ image: "data:image/png;base64,aGk=", task: "describe-image", hints: { question: "这是什么" } });
    assert.ok(r.warnings?.some((w) => w.includes("paddle 不支持 question,已忽略")), `实际:${r.warnings?.join(" | ")}`);
  });
  test("describe-image 不带 question → 无丢弃警告", async () => {
    const p = new PaddleocrProvider({ baseUrl });
    const r = await p.recognize({ image: "data:image/png;base64,aGk=", task: "describe-image" });
    assert.ok(!r.warnings?.length, `不该告警:${r.warnings?.join(" | ")}`);
  });
});

// ─────────────────────────── 8. extract_image_meta includeRaw(ComfyUI only) ───────────────────────────
describe("B10 extract_image_meta includeRaw 无 workflow JSON 丢弃告警", () => {
  // 最小合法 1x1 PNG(signature+IHDR+IDAT+IEND,CRC 零占位 —— 解析器不校验 CRC,同 whitebox-fixes 先例)
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  }
  const ihdr = chunk("IHDR", (() => { const d = Buffer.alloc(13); d.writeUInt32BE(1, 0); d.writeUInt32BE(1, 4); d[8] = 8; d[9] = 0; return d; })());
  const iend = chunk("IEND", Buffer.alloc(0));
  const pngB64 = (extraChunks) =>
    Buffer.concat([PNG_SIG, ihdr, ...(extraChunks ?? []), iend]).toString("base64");

  test("includeRaw=true + 无 workflow JSON(普通图/A1111)→ 警告「未生效」", async () => {
    const r = await extractImageMeta({ imageSource: `data:image/png;base64,${pngB64()}`, includeRaw: true });
    assert.ok(r.warnings.some((w) => w.includes("includeRaw 未生效")), `实际:${r.warnings.join(" | ")}`);
  });
  test("includeRaw=true + 带 workflow JSON(ComfyUI,消费方)→ 无「未生效」警告", async () => {
    // tEXt chunk:keyword\0text(keyword=workflow,合法 JSON → rawWorkflow 挂上)
    const textChunk = chunk("tEXt", Buffer.concat([Buffer.from("workflow\0"), Buffer.from('{"nodes":{}}')]));
    const r = await extractImageMeta({ imageSource: `data:image/png;base64,${pngB64([textChunk])}`, includeRaw: true });
    assert.ok(r.rawWorkflow, "rawWorkflow 应已挂上");
    assert.ok(!r.warnings.some((w) => w.includes("includeRaw 未生效")), `不该告警:${r.warnings.join(" | ")}`);
  });
});

// ─────────────────────────── 9. server 级:handler 合并透出 + blob 显式 true 不塌缩 ───────────────────────────
describe("B10 server 级丢弃告警透出(stdio 直连 dist/index.js,零网络渲染路径)", () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "discard-warn-"));
  let proc = null, buf = "", nextId = 0;
  const pending = new Map();
  function send(method, params) {
    const myId = ++nextId;
    return new Promise((resolve) => {
      pending.set(myId, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  }
  const call = (name, args) => send("tools/call", { name, arguments: args });
  before(async () => {
    proc = spawn("node", [path.join(distDir, "index.js")], { stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT });
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        } catch { /* 非 JSON 行忽略 */ }
      }
    });
    proc.stderr.on("data", () => { /* server 日志,不打断 */ });
    await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "discard-warn-it", version: "1" } });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  });
  after(() => {
    try { proc?.kill(); } catch { /* ignore */ }
    fs.rmSync(tmpOut, { recursive: true, force: true });
  });
  const dataOf = (r) => { try { return JSON.parse(r?.result?.content?.[0]?.text ?? ""); } catch { return null; } };

  test("generate_card blob=true + og 模板 → 响应 warnings 含 blob 丢弃告警(显式 true 不再被 handler 塌缩)", async () => {
    const r = await call("generate_card", { title: "Discard Warn", template: "og", blob: true, outDir: tmpOut });
    const d = dataOf(r);
    assert.equal(r?.result?.isError, undefined, "不该出错");
    assert.ok(d.warnings?.some((w) => w.includes("blob 仅 hero 模板消费")), `实际:${d.warnings?.join(" | ")}`);
  });
  test("generate_card quoteStyle=flank + og 模板 → 响应 warnings 含 quoteStyle 丢弃告警", async () => {
    const r = await call("generate_card", { title: "Discard Warn", template: "og", quoteStyle: "flank", outDir: tmpOut });
    const d = dataOf(r);
    assert.ok(d.warnings?.some((w) => w.includes("quoteStyle 仅 quote 模板消费")), `实际:${d.warnings?.join(" | ")}`);
  });
  test("generate_diagram engine=graphviz + theme → 响应 warnings 含 theme 丢弃告警(引擎级告警经 handler 合并透出)", async () => {
    const r = await call("generate_diagram", { code: "digraph G { A -> B; }", engine: "graphviz", theme: "200", outDir: tmpOut });
    const d = dataOf(r);
    assert.equal(r?.result?.isError, undefined, "不该出错");
    assert.ok(d.warnings?.some((w) => w.includes("theme 仅 D2 引擎消费,graphviz 已忽略")), `实际:${d.warnings?.join(" | ")}`);
  });
  test("generate_qrcode format=svg + width → 响应 warnings 含 width 丢弃告警", async () => {
    const r = await call("generate_qrcode", { text: "https://discard-warn.example", format: "svg", width: 300, outDir: tmpOut });
    const d = dataOf(r);
    assert.ok(d.warnings?.some((w) => w.includes("width 仅 PNG 输出消费")), `实际:${d.warnings?.join(" | ")}`);
  });
  test("render_svg format=svg + scale → 响应 warnings 含 scale 丢弃告警(passthrough 直通)", async () => {
    const r = await call("render_svg", {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>',
      format: "svg", scale: 2, outDir: tmpOut,
    });
    const d = dataOf(r);
    assert.equal(r?.result?.isError, undefined, "不该出错");
    assert.ok(d.warnings?.some((w) => w.includes("scale 仅 Chrome 后端 PNG 渲染消费")), `实际:${d.warnings?.join(" | ")}`);
  });
});
