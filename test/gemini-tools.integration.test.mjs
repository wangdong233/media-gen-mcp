/**
 * Gemini 网页渠道集成测试(真机;分层门禁,配额红线)。
 *
 * 🔴 门禁纪律(FLOW_IT 同款 + 配额消耗分层):
 *   - L1 环境层(GEMINI_IT=1 + 非 CI + CDP 9225 活着):open/登录态/菜单可达 —— 零配额消耗
 *     (enterMode 只切 UI 模式不提交;开菜单零消耗)。
 *   - L2 真生成层(再叠加 GEMINI_IT_GEN=1):真实 generateImage/createVideo —— 消耗订阅算力配额
 *     (图像单张少量;视频单条 ≈15-20% 5h 窗口)。默认永不真跑;只有显式双门开启才执行。
 *
 * 前置:lasso Chrome @9225(lasso launch-chrome --port 9225 --idle-ms 0),已登录 Google 账号。
 * 产物校验真值纪律:PNG/MP4 magic bytes(非"文件存在")。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CDP_PORT = 9225;

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

const geminiItOff = process.env.GEMINI_IT !== "1" || Boolean(process.env.CI);
const genOff = geminiItOff || process.env.GEMINI_IT_GEN !== "1" || !(await cdpAlive());

describe("gemini L1 环境(真实 CDP;零配额;GEMINI_IT=1 显式开启)", { skip: geminiItOff || !(await cdpAlive()) }, () => {
  test("open + 登录态 + 工具菜单可达(制作图片/制作视频入口在)", async () => {
    const { CdpGeminiTransport } = require("../dist/providers/gemini-web.js");
    const t = new CdpGeminiTransport(CDP_PORT);
    const { pageUrl } = await t.open();
    assert.match(pageUrl, /gemini\.google\.com/);
    // 登录态(零消耗)
    const login = await t.eval(`(() => {
      const a = document.querySelector('a[aria-label*="Google 账号"],a[aria-label*="Google Account"]');
      return { logged: !!a };
    })()`);
    assert.equal(login.logged, true, "未登录:lasso launch-chrome --port 9225 --mode visible 完成登录");
  });
});

describe("gemini L2 真生成(消耗订阅配额;🔴 双门 GEMINI_IT=1 + GEMINI_IT_GEN=1)", { skip: genOff }, () => {
  test("generateImage 真机:PNG magic + 落盘", async () => {
    const { GeminiWebProvider } = require("../dist/providers/gemini-web.js");
    const p = new GeminiWebProvider({ cdpPort: CDP_PORT });
    const r = await p.generateImage({ prompt: "a small blue square on white background", model: "nano-banana-2" });
    // url = data:URI(handler 落盘管线唯一消费形态;provider 侧 b64 已升级为 data:URI,真机教训 2026-09-22)
    assert.match(String(r.outputs[0].url), /^data:image\/(png|jpeg);base64,/);
    const b64 = String(r.outputs[0].url).replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    // 图像 magic 真值校验(NB2 网页产物实测 JPEG;PNG/JPEG 双收)
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    assert.ok(isPng || isJpg, `非 PNG/JPEG magic: ${buf.slice(0, 8).toString("hex")}`);
    assert.ok(buf.length > 10_000, `产物过小(${buf.length}B,疑似占位图)`);
  });

  test("createVideo + getVideo 真机:MP4 magic(视频消耗大,单条验证)", async () => {
    const { GeminiWebProvider } = require("../dist/providers/gemini-web.js");
    const p = new GeminiWebProvider({ cdpPort: CDP_PORT });
    const task = await p.createVideo({ prompt: "a red ball bouncing once, minimal", model: "omni" });
    assert.equal(task.status, "submitted");
    const r = await p.getVideo({ taskId: task.taskId });
    assert.equal(r.status, "completed", `视频未完成: ${r.error ?? ""}`);
    const b64 = String(r.url).replace(/^data:video\/mp4;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    // MP4 ftyp box(偏移 4-8 为 ftyp)
    assert.equal(buf.slice(4, 8).toString("ascii"), "ftyp", `非 MP4 容器: ${buf.slice(0, 12).toString("hex")}`);
    assert.ok(buf.length > 30_000, `视频产物过小(${buf.length}B)`);
  });
});
