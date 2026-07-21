// 一次性生成 P0-4 反例 fixture(对齐 pares4/01-功能分析.md §6.2)。
// 用法:node scripts/build-p04-fixtures.mjs(由开发者手动跑,产物 commit)
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

const DIR = path.resolve("test/fixtures/check-render-output");
mkdirSync(DIR, { recursive: true });

// ── 反例 1:zero.png(0 字节)→ file/readable fatal ──
writeFileSync(path.join(DIR, "zero.png"), Buffer.alloc(0));

// ── 反例 2:html-as.png(HTML 错误页存 .png)→ png/magic-bytes fatal ──
writeFileSync(path.join(DIR, "html-as.png"), Buffer.from("<html><body>404 Not Found</body></html>", "utf8"));

// ── 反例 3:nan.svg(SVG 含 NaN 字面量)→ svg/no-nan-attrs(error/strict throw) ──
writeFileSync(
  path.join(DIR, "nan.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="NaN" height="10" fill="red"/></svg>\n`,
);

// ── 反例 4:empty-formula.svg(根 svg 但无绘制节点)→ svg/has-content(error) ──
writeFileSync(
  path.join(DIR, "empty-formula.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>\n`,
);

// ── 反例 5:truncated.png(PNG signature + 0x00 截断)→ png/decodable error ──
// 完整 8 字节 PNG signature,后面跟 8 字节 0x00(IHDR 头缺,解码失败)
writeFileSync(
  path.join(DIR, "truncated.png"),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x48, 0x44, 0x52]),
);

// ── 反例 6:zero-viewbox.svg(viewBox 宽高为 0)→ svg/viewbox-nonzero error ──
writeFileSync(
  path.join(DIR, "zero-viewbox.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"><rect width="10" height="10"/></svg>\n`,
);

// ── 正例 1:valid.mp4(1s 纯色视频)→ container-decodable + tracks-present 通过 ──
// 用 ffmpeg-static 直接生成(避免依赖 Chrome render_video);testsrc 生成 1 秒 10x10 纯色
const validMp4 = path.join(DIR, "valid.mp4");
const r = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi",
  "-i", "color=c=red:s=16x16:d=1:r=10",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  validMp4,
], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
if (r.status !== 0) {
  console.error("ffmpeg 生成 valid.mp4 失败:");
  console.error(r.stderr);
  process.exit(1);
}

// ── 正例 2:valid.gif(1s 纯色 GIF)→ container-decodable 通过(gif) ──
const validGif = path.join(DIR, "valid.gif");
const r2 = spawnSync(ffmpegPath, [
  "-y",
  "-f", "lavfi",
  "-i", "color=c=blue:s=16x16:d=0.5:r=5",
  "-pix_fmt", "rgb24",
  validGif,
], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
if (r2.status !== 0) {
  console.error("ffmpeg 生成 valid.gif 失败:");
  console.error(r2.stderr);
  process.exit(1);
}

console.log("OK: fixtures written to", DIR);
console.log("  zero.png / html-as.png / nan.svg / empty-formula.svg / truncated.png / zero-viewbox.svg");
console.log("  valid.mp4 / valid.gif");
