/**
 * 白盒修复回归 · server 级(2026-08-27 全工具审计,G 任务):stdio 直连 dist/index.js,
 * 只做零网络/零积分的参数校验路径与本地渲染路径(绝无任何生成提交)。
 *
 * 覆盖:
 *   1. E-01 防覆盖避让:同名重渲染 → -2 序号(writeLocalRender 与 extract 落盘同 downloadAsset 语义)
 *   2. B-01 显式点名不支持 task 的 provider → 门禁错误指路 list_vision_capabilities(不静默换渠道)
 *   3. C-07 theme 参数错:未知名/越界 themeID → 清晰错误,无「未识别的错误形态」噪声尾
 *   4. A-04 numFrames × durationSeconds 互斥的 handler 前置拦截(先于任何 provider 调用)
 *   5. A-01 助记 model(abra_t2v)不再被工具层报「未知模型」(错误若发生也不含该文案;
 *      本机 CDP 在场时走到确认挑战 needConfirm,离线时 S1xx 前置错 —— 两者都证明归属校验已放行)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "whitebox-server-"));

let proc = null, buf = "", nextId = 0, stderrLog = "";
const pending = new Map();
function send(method, params) {
  const myId = ++nextId;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
  });
}
function call(name, args) {
  return send("tools/call", { name, arguments: args });
}

before(async () => {
  // HOME 隔离:A-01 的 flow 确认门会签发令牌(日志#15 后密钥落 ~/.media-gen-mcp)—— 测试进程
  // 指到 tmp,绝不写真实 HOME(与 flow-confirm/flow-localinput 集成同一纪律)。
  // 🔴 三重防线(2026-08-31 同名项目根因修复):本测试 HOME 隔离后 A-01 的确认门路径曾在
  // CDP 活着时真实 createProject(每次 npm test 一个同名项目,stderr 被吞三重静默)。
  // ① 死端口(config cdpPort=9299,refreshCatalogIfStale 静默失败回落静态,needConfirm 语义保留)
  // ② FLOW_NEVER_CREATE_PROJECT=1 探针护栏(文件 miss 即结构化拒,结构性不可建项目)
  // ③ stderr 收集 + after 断言无「已自动新建」(把留痕从"日志"升级为"会红的门禁")
  const probeCfg = path.join(tmpOut, "probe-config.json");
  fs.writeFileSync(probeCfg, JSON.stringify({ providers: { flow: { settings: { cdpPort: 9299 } } } }));
  proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], cwd: PROJECT_ROOT, env: { ...process.env, HOME: tmpOut, MEDIA_GEN_MCP_CONFIG: probeCfg, FLOW_NEVER_CREATE_PROJECT: "1" } });
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
      } catch { /* 忽略非 JSON 行 */ }
    }
  });
  proc.stderr.on("data", (chunk) => { stderrLog += chunk.toString(); /* 收集:after 断言无自动新建(门禁化) */ });
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "whitebox-it", version: "1" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

after(async () => {
  try { proc?.kill(); } catch { /* ignore */ }
  // 🔴 门禁化(根因修复第③层):本套件任何一次真实 createProject 都必须红 —— "自动新建"的
  // stderr 留痕从"日志"升级为"会失败的断言"(此前被静默吞掉,是同名项目三重静默之一)。
  assert.ok(!stderrLog.includes("已自动新建"), `测试期间发生 Flow 项目自动新建(账号污染)!stderr:\n${stderrLog.slice(-400)}`);
  fs.rmSync(tmpOut, { recursive: true, force: true });
});

const textOf = (r) => (r?.result?.content?.[0]?.text ?? "");
const isErr = (r) => r?.result?.isError === true;
const dataOf = (r) => { try { return JSON.parse(textOf(r)); } catch { return null; } };

describe("E-01 防覆盖避让(同名重渲染 -2 序号)", () => {
  test("generate_qrcode 同 name 两次 → 第二次落盘 <name>-2.svg,首个文件不被覆盖", async () => {
    const a = await call("generate_qrcode", { text: "https://overwrite-test.example", format: "svg", name: "ow-test", outDir: tmpOut });
    assert.equal(isErr(a), false, textOf(a));
    const b = await call("generate_qrcode", { text: "https://overwrite-test.example", format: "svg", name: "ow-test", outDir: tmpOut });
    assert.equal(isErr(b), false, textOf(b));
    const pa = dataOf(a).local_path, pb = dataOf(b).local_path;
    assert.ok(pa.endsWith("ow-test.svg"), `首次应落 ow-test.svg:${pa}`);
    assert.ok(pb.endsWith("ow-test-2.svg"), `第二次应避让为 ow-test-2.svg:${pb}`);
    assert.ok(fs.existsSync(pa) && fs.existsSync(pb), "两个文件都应在盘");
  });
  test("extract_text 同 name 两次 → 第二次 .txt 避让 -2(6 处直写落盘同语义)", async () => {
    // 先用 generate_card(离线 Satori)造一张含真实文字的图,保证 tesseract 能提出非空文本
    const src = await call("generate_card", { title: "OCR 2026", template: "minimal", format: "png", name: "ow-src", outDir: tmpOut });
    assert.equal(isErr(src), false, textOf(src));
    const pngB64 = fs.readFileSync(dataOf(src).local_path).toString("base64");
    const img = `data:image/png;base64,${pngB64}`;
    const args = { image: img, name: "txt-ow", outDir: tmpOut, provider: "tesseract" };
    const a = await call("extract_text", args);
    const b = await call("extract_text", args);
    assert.equal(isErr(a), false, textOf(a));
    assert.equal(isErr(b), false, textOf(b));
    assert.ok(dataOf(a).local_path?.endsWith("txt-ow.txt"), `首次应落 txt-ow.txt:${dataOf(a).local_path}`);
    assert.ok(dataOf(b).local_path?.endsWith("txt-ow-2.txt"), `第二次应避让:${dataOf(b).local_path}`);
  });
});

describe("B-01 显式点名不支持 task 的 provider → 指路 list_vision_capabilities", () => {
  test("extract_table + provider=tesseract → 门禁错提到 list_vision_capabilities(tesseract 不支持表格)", async () => {
    const img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await call("extract_table", { image: img, provider: "tesseract" });
    assert.equal(isErr(r), true, "应报错(点名即钉死,不静默换渠道)");
    const t = textOf(r);
    assert.ok(t.includes("不支持 extract-table"), `实际:${t}`);
    assert.ok(t.includes("list_vision_capabilities"), `错误应指路自省工具:${t}`);
  });
});

describe("C-07 theme 参数错:清晰直抛,无维护者噪声尾", () => {
  test("theme=\"dark\"(未知名)→ unknown D2 theme,且无「未识别的错误形态」", async () => {
    const r = await call("generate_diagram", { code: "a -> b", theme: "dark" });
    assert.equal(isErr(r), true);
    const t = textOf(r);
    assert.ok(t.includes("unknown D2 theme"), `实际:${t}`);
    assert.ok(!t.includes("未识别的错误形态"), `不该把用户输入错包装成疑似 bug:${t}`);
  });
  test("theme=-9(越界)→ themeID 须为 0-300 的整数", async () => {
    const r = await call("generate_diagram", { code: "a -> b", theme: "-9" });
    assert.equal(isErr(r), true);
    const t = textOf(r);
    assert.ok(/0-300/.test(t), `实际:${t}`);
    assert.ok(!t.includes("未识别的错误形态"), t);
  });
  test("theme=1(合法数字)→ 正常渲染", async () => {
    const r = await call("generate_diagram", { code: "a -> b", theme: "1", name: "theme-ok", outDir: tmpOut });
    assert.equal(isErr(r), false, textOf(r));
  });
});

describe("A-04 numFrames × durationSeconds 互斥(handler 前置,先于 provider)", () => {
  test("双传 → 互斥错误", async () => {
    const r = await call("create_video", { prompt: "x", numFrames: 96, durationSeconds: 4 });
    assert.equal(isErr(r), true);
    assert.ok(textOf(r).includes("互斥"), `实际:${textOf(r)}`);
  });
});

describe("A-01 助记 model(abra_t2v)通过工具层归属校验", () => {
  test("provider=flow + model=abra_t2v → 不再报「未知模型」", async () => {
    const r = await call("create_video", { prompt: "x", provider: "flow", model: "abra_t2v", durationSeconds: 8 });
    const t = textOf(r);
    assert.ok(!t.includes("未知模型"), `助记 key 不应被归属校验拦截:${t}`);
    // 结果二选一(均为零消耗,证明已到达 flow 侧):确认挑战 needConfirm / 环境前置错 S1xx
    const d = dataOf(r);
    const challengeOk = d?.needConfirm === true;
    const preflightOk = isErr(r) && /\[flow\] S1\d\d/.test(t);
    assert.ok(challengeOk || preflightOk, `应为确认挑战(needConfirm)或 S1xx 前置错,实际:${t.slice(0, 160)}`);
  });
});
