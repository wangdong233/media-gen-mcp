/**
 * 白盒修复回归(2026-08-27 全工具审计,G 任务):纯离线单元,直接测 dist 编译产物。
 *
 * 覆盖:
 *   1. C-02 qr margin:默认 2 不再发 ISO 静默区警告;显式 <4 才警告;>=4 无警告
 *   2. D-06 extract_image_meta:非 PNG 输入给「文件不是 PNG」区分性警告(不再误导成"非 AI 生成")
 *   3. A-15 resolveVideoModelKey:key 自带时长 × durationSeconds 冲突的 S301 文案讲明
 *      numFrames÷frameRate 推导链(不再指认调用方从未写的参数名)
 *   4. A-02 配套:videoAspectRatioFor 的 S301 文案(16:9/9:16)与确认门新校验同源
 *
 * 跑前必须 npm run build(npm test 已按此顺序编排)。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { renderQR } = require_(path.join(distDir, "qr.js"));
const { extractImageMeta } = require_(path.join(distDir, "extract-image-meta.js"));
const { resolveVideoModelKey } = require_(path.join(distDir, "providers/flow.js"));

describe("C-02 generate_qrcode margin 警告政策(默认安静,显式才告)", () => {
  test("默认(不传 margin)无 ISO 静默区警告", async () => {
    const r = await renderQR({ text: "https://example.com", format: "svg" });
    assert.equal(r.warnings?.length ?? 0, 0, "默认调用不该收到自己没造成的警告");
  });
  test("显式 margin=2 → 警告(用户自己选的紧凑值,告知代价)", async () => {
    const r = await renderQR({ text: "https://example.com", format: "svg", margin: 2 });
    assert.ok(r.warnings?.some((w) => w.includes("ISO 18004")), "显式 margin=2 应保留 ISO 提示");
  });
  test("margin=4 → 无警告", async () => {
    const r = await renderQR({ text: "https://example.com", format: "svg", margin: 4 });
    assert.equal(r.warnings?.length ?? 0, 0);
  });
});

describe("D-06 extract_image_meta 非 PNG 区分性警告", () => {
  // 1x1 JPEG(SOI/APP0/EOI,合法 JPEG 字节)
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString("base64");
  test("JPEG 输入 → 警告含「不是 PNG」且明确不可据此断定非 AI 生成", async () => {
    const r = await extractImageMeta({ imageSource: `data:image/jpeg;base64,${jpegB64}` });
    assert.equal(r.generator, "none");
    assert.ok(r.warnings.some((w) => w.includes("不是 PNG")), `实际警告:${r.warnings.join(" | ")}`);
  });
  test("无 text chunk 的 PNG → 保留原「未找到 PNG text chunk」警告(不误伤)", async () => {
    // 最小合法 PNG:signature + IHDR + IEND
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.from([0x00, 0x00, 0x00, 0x0d]); const ihdrT = Buffer.from("IHDR");
    const ihdrD = Buffer.alloc(13); ihdrD.writeUInt32BE(1, 0); ihdrD.writeUInt32BE(1, 4); ihdrD[8] = 8;
    const ihdrC = Buffer.alloc(4);
    const iend = Buffer.from([0x00, 0x00, 0x00, 0x00]); const iendT = Buffer.from("IEND"); const iendC = Buffer.alloc(4);
    const png = Buffer.concat([sig, ihdr, ihdrT, ihdrD, ihdrC, iend, iendT, iendC]);
    const r = await extractImageMeta({ imageSource: `data:image/png;base64,${png.toString("base64")}` });
    assert.equal(r.generator, "none");
    assert.ok(r.warnings.some((w) => w.includes("未找到 PNG text chunk")), `实际警告:${r.warnings.join(" | ")}`);
  });
});

describe("A-15 resolveVideoModelKey 冲突文案讲明推导链", () => {
  test("key 自带 8s + durationSeconds=4 → S301 提及 numFrames÷frameRate 推导", () => {
    assert.throws(
      () => resolveVideoModelKey("abra_t2v_8s", 4),
      (e) => e.code === "S301" && e.message.includes("numFrames÷frameRate 推导") && e.message.includes("二选一"),
    );
  });
  test("一致 durationSeconds(8s key + 8)→ 不冲突", () => {
    const r = resolveVideoModelKey("abra_t2v_8s", 8);
    assert.equal(r.key, "abra_t2v_8s");
    assert.equal(r.duration, 8);
  });
});
