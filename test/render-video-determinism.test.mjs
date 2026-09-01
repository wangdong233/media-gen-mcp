/**
 * D-01(high)回归:render_video 自播放 CSS @keyframes 的确定性。
 *
 * 根因(2026-08-27 审计):seekToTime 分支③ 先 anim.currentTime=ms 再 anim.pause() —— 运行中的
 * 动画 pause 要到下一动画帧才提交,冻结瞬间落回墙钟 → 两次渲染帧不一致,证伪「deterministic」
 * 核心承诺。修复:先 pause() 再 currentTime=ms(与 GSAP 分支同序)。
 *
 * 断言:同一自播放 CSS 动画连跑 2 次,输出 mp4 Buffer sha256 完全一致。
 * Chrome/Edge 不可用时整套 skip(同 nested-viewer.e2e 范式,CI 无 Chrome 不 fail)。
 * 纯本地:headless Chrome 帧捕获 + ffmpeg-static,零网络零积分。
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { renderVideo } = require_(path.join(distDir, "render-video.js"));
const { getBrowser } = require_(path.join(distDir, "render-svg.js"));
const { shutdownBrowser } = require_(path.join(distDir, "browser-pool.js"));

let chromeOk = false;
// 顶层探测(须在 test() 注册前完成 —— skip 选项在定义时求值,before() 里赋值太晚)
{
  const b = await getBrowser().catch(() => null);
  chromeOk = !!b;
}
after(async () => {
  // 经 browser-pool 自己的收尾路径关停单例(2026-09-01 P0 根治后 Chrome 生命周期归 pool),
  // 免测试进程挂着 Chrome 不退出
  await shutdownBrowser().catch(() => {});
});

const HTML = `<!DOCTYPE html><html><body style="margin:0;background:#000"><div style="width:200px;height:100px;background:linear-gradient(90deg,red,yellow);animation:w 1s linear infinite alternate;position:absolute;top:40px"></div><style>@keyframes w{from{transform:translateX(0)}to{transform:translateX(500px)}}</style></body></html>`;

describe("D-01 render_video CSS @keyframes 确定性(pause 先于 currentTime)", () => {
  test("同一自播放 CSS 动画连跑 2 次 → mp4 byte-identical", { skip: !chromeOk && "Chrome/Edge 不可用,skip(非 fail)" }, async () => {
    // 顺序执行(非并发):并发两页共享启动时刻,墙钟漂移会被相关性掩盖,串行才能暴露首帧冻结漂移
    const run = () => renderVideo({ html: HTML, duration: 1, fps: 10, width: 320, height: 180, format: "mp4" });
    const a = await run();
    const b = await run();
    assert.equal(a.frameCount, b.frameCount);
    assert.ok(a.frameCount >= 5, `帧数过少(${a.frameCount}),测试无区分度`);
    const ha = crypto.createHash("sha256").update(a.video).digest("hex");
    const hb = crypto.createHash("sha256").update(b.video).digest("hex");
    assert.equal(ha, hb, "自播放 CSS 动画两次渲染不一致 —— seekToTime 的 pause/currentTime 顺序回归(WAAPI 冻结落回墙钟)");
  });
});
