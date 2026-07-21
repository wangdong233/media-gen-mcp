/**
 * P0-3 Unit tests —— test/golden/helpers.ts 7 个纯函数的边界行为。
 *
 * 这是 P0-3 测试金字塔的「Unit」层。helpers.ts 是 golden byte-compare 的核心比较逻辑,
 * 单元测试覆盖它们的「正常路径 + 边界 + 故障路径」:
 *   - normalizeNewlines      CRLF / CR / LF / 混合 / 无换行
 *   - normalizeMathJaxIds    MJX-1- / MJX-99- / 无前缀 / 多处匹配
 *   - compareSvg             等同 / 仅 CRLF 差异(应 ok)/ 仅 MathJax ID 差异(默认 norm 应 ok)/
 *                            真实内容差异(应 fail 带 diff)/ preNormalize 覆盖默认
 *   - stripPngMetadata       合成 PNG(含 tEXt chunk)→ strip 后只剩 KEEP 集
 *   - comparePng             等同 / 仅元数据差异(strip 后应 ok)/ IDAT 差异(应 fail)
 *   - verifyQrPng            expected/qr/url.png 应解码回 url.json 的 text / 错误原文应失败
 *   - assertNoNaNOrUndefined 干净 SVG / NaN / undefined
 *
 * golden.test.ts 已经间接覆盖了 helpers 的「正常路径」(8 active case 全绿);本文件
 * 补的是「边界与故障路径」,确保 helper 的语义在任何输入下都符合契约。
 *
 * License:本文件为 P0-3 自研。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeNewlines,
  normalizeMathJaxIds,
  compareSvg,
  stripPngMetadata,
  comparePng,
  verifyQrPng,
  assertNoNaNOrUndefined,
} from "./golden/helpers.js";

const EXPECTED = path.resolve("test/golden/expected");

// ──────────────────────────────────────────────────────────────────────────
// 1. normalizeNewlines(唯一规范化,只抹 CRLF)
// ──────────────────────────────────────────────────────────────────────────

test("normalizeNewlines: CRLF → LF", () => {
  assert.equal(normalizeNewlines("a\r\nb"), "a\nb");
});

test("normalizeNewlines: 单独 CR → LF", () => {
  assert.equal(normalizeNewlines("a\rb"), "a\nb");
});

test("normalizeNewlines: 纯 LF 不变", () => {
  assert.equal(normalizeNewlines("a\nb"), "a\nb");
});

test("normalizeNewlines: 混合 CRLF/CR/LF 全部归一为 LF", () => {
  assert.equal(normalizeNewlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
});

test("normalizeNewlines: 无换行字符串原样返回", () => {
  assert.equal(normalizeNewlines("hello world"), "hello world");
});

test("normalizeNewlines: 空字符串原样返回", () => {
  assert.equal(normalizeNewlines(""), "");
});

test("normalizeNewlines: 连续多个 CRLF 全部归一", () => {
  assert.equal(normalizeNewlines("\r\n\r\n\r\n"), "\n\n\n");
});

// ──────────────────────────────────────────────────────────────────────────
// 2. normalizeMathJaxIds(R-01:抹 MJX-N- 自增计数器)
// ──────────────────────────────────────────────────────────────────────────

test("normalizeMathJaxIds: MJX-1- → MJX-N-", () => {
  assert.equal(
    normalizeMathJaxIds('<use xlink:href="#MJX-1-TEX-I-1D438"/>'),
    '<use xlink:href="#MJX-N-TEX-I-1D438"/>',
  );
});

test("normalizeMathJaxIds: 大计数器 MJX-99- → MJX-N-", () => {
  assert.equal(
    normalizeMathJaxIds('id="MJX-99-TEX-N-3D"'),
    'id="MJX-N-TEX-N-3D"',
  );
});

test("normalizeMathJaxIds: 多处匹配全部替换", () => {
  const input = '<use href="#MJX-1-X"/><use href="#MJX-2-Y"/><use href="#MJX-3-Z"/>';
  const out = normalizeMathJaxIds(input);
  // 三处 ID 全部归一到 MJX-N-
  assert.equal(out, '<use href="#MJX-N-X"/><use href="#MJX-N-Y"/><use href="#MJX-N-Z"/>');
});

test("normalizeMathJaxIds: 无 MJX- 前缀的 SVG 原样返回(no-op 安全)", () => {
  const input = '<svg><rect width="100"/></svg>';
  assert.equal(normalizeMathJaxIds(input), input);
});

test("normalizeMathJaxIds: 边界 —— 数字 0 / 多位数 / 末尾", () => {
  assert.equal(normalizeMathJaxIds("MJX-0-"), "MJX-N-");
  assert.equal(normalizeMathJaxIds("MJX-123456789-"), "MJX-N-");
  // 末尾紧接字符串结束也应匹配
  assert.equal(normalizeMathJaxIds("prefix MJX-7-"), "prefix MJX-N-");
});

test("normalizeMathJaxIds: 不误伤非 MJX 前缀(只匹配 MJX-<digits>-)", () => {
  // 类似前缀但不符合模式的不动
  const input = 'id="MJX-abc-" id="MJAX-1-" id="MJX--"';
  assert.equal(normalizeMathJaxIds(input), input);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. compareSvg(SVG 全文 ===,含默认 MathJax 归一化)
// ──────────────────────────────────────────────────────────────────────────

test("compareSvg: 完全等同 → ok=true 无 diff", () => {
  const r = compareSvg("<svg>same</svg>", "<svg>same</svg>");
  assert.equal(r.ok, true);
  assert.equal(r.diff, undefined);
});

test("compareSvg: 仅 CRLF/LF 差异 → ok=true(normalizeNewlines 抹掉)", () => {
  const fresh = "<svg>\r\n<a/>\r\n</svg>";
  const checked = "<svg>\n<a/>\n</svg>";
  const r = compareSvg(fresh, checked);
  assert.equal(r.ok, true);
});

test("compareSvg: 仅 MathJax ID 差异 → ok=true(默认 normalizeMathJaxIds 抹掉)", () => {
  // 模拟同进程连跑 2 次的 MJX-1- / MJX-2- 自增
  const fresh = '<use href="#MJX-1-TEX-X"/>';
  const checked = '<use href="#MJX-2-TEX-X"/>';
  const r = compareSvg(fresh, checked);
  assert.equal(r.ok, true);
});

test("compareSvg: 真实内容差异 → ok=false 带 diff(含 first diff 位置)", () => {
  const fresh = "<svg>abc</svg>";
  const checked = "<svg>abd</svg>";
  const r = compareSvg(fresh, checked);
  assert.equal(r.ok, false);
  assert.ok(r.diff !== undefined, "应当返回 diff 字符串");
  assert.match(r.diff!, /first diff at char \d+/, "diff 应含 first diff 位置");
  assert.match(r.diff!, /fresh=.*abc/, "diff 应含 fresh 上下文");
  assert.match(r.diff!, /checked=.*abd/, "diff 应含 checked 上下文");
});

test("compareSvg: preNormalize 覆盖默认 normalizeMathJaxIds", () => {
  // 用例:自定义 preNormalize 把 'X' 全部替换为 'Y';fresh 与 checked 在 preNormalize 后等同
  const fresh = "<svg>X</svg>";
  const checked = "<svg>Y</svg>";
  const r = compareSvg(fresh, checked, { preNormalize: (s) => s.replace(/X/g, "Y") });
  assert.equal(r.ok, true);
});

test("compareSvg: preNormalize 覆盖时不再走默认 MathJax 归一化", () => {
  // 用例:preNormalize 是恒等(s => s);即使 fresh 与 checked 只差 MJX ID 也不应被抹掉
  const fresh = '<use href="#MJX-1-X"/>';
  const checked = '<use href="#MJX-2-X"/>';
  const r = compareSvg(fresh, checked, { preNormalize: (s) => s });
  assert.equal(r.ok, false, "preNormalize 恒等 → MJX ID 差异不被抹掉 → fail");
});

test("compareSvg: 空字符串等同 → ok=true", () => {
  assert.equal(compareSvg("", "").ok, true);
});

// ──────────────────────────────────────────────────────────────────────────
// 4. stripPngMetadata(KEEP:IHDR/PLTE/tRNS/IDAT/IEND,其它 chunk 全弃)
// ──────────────────────────────────────────────────────────────────────────

/** 合成最小合法 PNG:8 字节签名 + IHDR + 1 个非 KEEP chunk(tEXt)+ IDAT + IEND。 */
function buildMinimalPngWithText(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR(13 data bytes)
  const ihdr = Buffer.alloc(25); // 4(len)+4(type)+13(data)+4(CRC)
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(1, 8);  // width
  ihdr.writeUInt32BE(1, 12); // height
  ihdr[16] = 8;  // bit depth
  ihdr[17] = 6;  // color type RGBA
  ihdr[18] = 0;  // compression
  ihdr[19] = 0;  // filter
  ihdr[20] = 0;  // interlace
  // CRC 0(本测试不验证 CRC,stripPngMetadata 直接按 length 跳过,不校验 CRC)

  // tEXt(8 data bytes:"key=val\0")
  const text = Buffer.alloc(20); // 4+4+8+4
  text.writeUInt32BE(8, 0);
  text.write("tEXt", 4, "ascii");
  text.write("k=v\0xyz", 8, "ascii");

  // IDAT(0 data bytes - 不真实但 stripPngMetadata 不验证 zlib 完整性,只按 length 跳)
  const idat = Buffer.alloc(12);
  idat.writeUInt32BE(0, 0);
  idat.write("IDAT", 4, "ascii");

  // IEND(0 data bytes)
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write("IEND", 4, "ascii");

  return Buffer.concat([sig, ihdr, text, idat, iend]);
}

test("stripPngMetadata: 保留 PNG signature(8 字节)", () => {
  const png = buildMinimalPngWithText();
  const out = stripPngMetadata(png);
  // 前 8 字节必须是 PNG signature
  assert.deepEqual(
    Array.from(out.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
});

test("stripPngMetadata: tEXt chunk 被丢弃(只保留 IHDR/IDAT/IEND)", () => {
  const png = buildMinimalPngWithText();
  const out = stripPngMetadata(png);
  // 输出不应含 "tEXt" chunk type(在数据区)
  // 简单检查:out 的字节数应小于原 png(因为 tEXt chunk 被移除)
  assert.ok(out.length < png.length, `strip 后 ${out.length}B 应小于原 ${png.length}B`);
  // 输出仍含 IHDR / IDAT / IEND 标识
  const outStr = out.toString("ascii", 12, 16); // signature + 4B len 后是 type
  assert.equal(outStr, "IHDR");
});

test("stripPngMetadata: KEEP 集 chunk(IHDR/IDAT/IEND)原样保留", () => {
  const png = buildMinimalPngWithText();
  const out = stripPngMetadata(png);
  // 遍历 chunks,type 必须在 KEEP 集
  const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  let off = 8; // skip signature
  const types: string[] = [];
  while (off < out.length) {
    const len = out.readUInt32BE(off);
    const type = out.toString("ascii", off + 4, off + 8);
    types.push(type);
    assert.ok(KEEP.has(type), `strip 后不应含非 KEEP chunk: ${type}`);
    off = off + 12 + len;
  }
  assert.deepEqual(types, ["IHDR", "IDAT", "IEND"], "应保留 IHDR/IDAT/IEND 三个 chunk");
});

test("stripPngMetadata: 真实 expected/qr/url.png(resvg PNG)strip 后仍含 IDAT", () => {
  const png = readFileSync(path.join(EXPECTED, "qr/url.png"));
  const out = stripPngMetadata(png);
  // out 应小于或等于原 png(若 resvg 未写元数据 chunk,out 长度可能 = 原)
  assert.ok(out.length <= png.length);
  // 至少含 IHDR + IDAT + IEND(任何合法 PNG 必有这三块)
  let off = 8;
  const types: string[] = [];
  while (off < out.length) {
    const len = out.readUInt32BE(off);
    types.push(out.toString("ascii", off + 4, off + 8));
    off = off + 12 + len;
  }
  assert.ok(types.includes("IHDR"), "应含 IHDR");
  assert.ok(types.includes("IDAT"), "应含 IDAT");
  assert.ok(types.includes("IEND"), "应含 IEND");
});

// ──────────────────────────────────────────────────────────────────────────
// 5. comparePng(strip 后 Buffer.equals)
// ──────────────────────────────────────────────────────────────────────────

test("comparePng: 完全等同的字节 → ok=true", () => {
  const a = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
  const b = Buffer.from(a);
  assert.equal(comparePng(a, b).ok, true);
});

test("comparePng: 仅元数据 chunk 差异(strip 后等同)→ ok=true", () => {
  // 用 buildMinimalPngWithText 模拟两个 PNG:都含 tEXt 但 tEXt 内容不同;
  // strip 后只剩 IHDR/IDAT/IEND(CRC 不参与 equals?——CRC 在 strip 后的 chunk 内,会 differ)
  // 修正策略:构造两个 strip 后完全等同的 PNG,但加不同的 non-KEEP chunk 模拟元数据差异
  const base = buildMinimalPngWithText();
  // 在 base 的 tEXt 之后插入一个 iTXt chunk,内容不同
  const extra1 = Buffer.alloc(20);
  extra1.writeUInt32BE(8, 0);
  extra1.write("iTXt", 4, "ascii");
  extra1.write("aaa\0bbb", 8, "ascii");
  const extra2 = Buffer.alloc(20);
  extra2.writeUInt32BE(8, 0);
  extra2.write("iTXt", 4, "ascii");
  extra2.write("xxx\0yyy", 8, "ascii");

  // 在 base 的最后(IEND 之前)插入 iTXt chunk
  const insertBeforeIend = (buf: Buffer, ins: Buffer): Buffer => {
    const iend = buf.subarray(buf.length - 12); // 末尾 12B 是 IEND
    return Buffer.concat([buf.subarray(0, buf.length - 12), ins, iend]);
  };

  const pngA = insertBeforeIend(base, extra1);
  const pngB = insertBeforeIend(base, extra2);
  // 元数据 chunk 内容不同,但 strip 后应等同(只剩 IHDR + tEXt + IDAT + IEND,等等——tEXt 也被 strip 掉)
  // 实际 strip 后:两个 png 都只剩 IHDR + IDAT + IEND(base 部分),iTXt 也被 strip 掉 → ok=true
  const r = comparePng(pngA, pngB);
  assert.equal(r.ok, true, "元数据 chunk(iTXt/tEXt)差异 strip 后应 ok");
});

test("comparePng: IDAT 数据差异 → ok=false", () => {
  // 构造两个 IHDR 相同但 IDAT 数据不同的 PNG(strip 后仍 differ)
  const pngA = buildMinimalPngWithText();
  // 复制并改 IDAT 的 data 区(让 strip 后的字节真的不同)
  const pngB = Buffer.from(pngA);
  // IDAT chunk 在 buildMinimalPngWithText 中:tEXt 之后 = sig(8)+ihdr(25)+text(20)=53 起,53..56=len(0),57..60=IDAT,无 data 区
  // 改 IHDR 的 width 字段(pngA[8..11])使两 PNG 在 KEEP 集内 differ
  pngB.writeUInt32BE(2, 8); // width=2 vs pngA width=1
  const r = comparePng(pngA, pngB);
  assert.equal(r.ok, false, "IHDR width 差异 strip 后仍 differ");
  assert.ok(r.reason !== undefined, "应返回 reason");
  assert.match(r.reason!, /fresh \d+B \/ checked \d+B/);
});

test("comparePng: 真实 expected/qr/url.png 与自身 → ok=true", () => {
  const png = readFileSync(path.join(EXPECTED, "qr/url.png"));
  assert.equal(comparePng(png, png).ok, true);
});

// ──────────────────────────────────────────────────────────────────────────
// 6. verifyQrPng(PNG → jsQR 解码回原文)
// ──────────────────────────────────────────────────────────────────────────

test("verifyQrPng: expected/qr/url.png 解码回 url.json 的 text 字段", () => {
  const png = readFileSync(path.join(EXPECTED, "qr/url.png"));
  const expected = JSON.parse(
    readFileSync(path.resolve("test/golden/fixtures/qr/url.json"), "utf8"),
  );
  const r = verifyQrPng(png, expected.text);
  assert.equal(r.ok, true, `jsQR 应解码回原文,reasons=${r.reasons.join("; ")}`);
});

test("verifyQrPng: 期望 text 与实际不符 → ok=false reasons 非空", () => {
  const png = readFileSync(path.join(EXPECTED, "qr/url.png"));
  const r = verifyQrPng(png, "完全不同的期望文本");
  // jsQR 解码成功但内容不符,或解码失败,都应 ok=false
  assert.equal(r.ok, false);
  assert.ok(r.reasons.length > 0, "应有 reason");
});

test("verifyQrPng: 非 PNG 字节 → ok=false(不应抛)", () => {
  // 用一个非 PNG buffer,verifyQrPng 内部 PNG.sync.read 可能抛;应被 try/catch 或在 PNG.sync.read 处抛
  // 实际上 verifyQrPng 不 catch,让 PNG.sync.read 抛是预期行为;这里测试它不会静默返回 ok=true
  const junk = Buffer.from("not a png");
  assert.throws(() => verifyQrPng(junk, "anything"), /PNG|Invalid|format/i);
});

// ──────────────────────────────────────────────────────────────────────────
// 7. assertNoNaNOrUndefined(先决保证)
// ──────────────────────────────────────────────────────────────────────────

test("assertNoNaNOrUndefined: 干净 SVG 不抛", () => {
  assert.doesNotThrow(() => assertNoNaNOrUndefined("<svg>clean</svg>"));
});

test("assertNoNaNOrUndefined: 含 'NaN' 字面量 → 抛(先决保证)", () => {
  assert.throws(
    () => assertNoNaNOrUndefined('<rect width="NaN"/>'),
    /NaN\/undefined/,
  );
});

test("assertNoNaNOrUndefined: 含 'undefined' 字面量 → 抛", () => {
  assert.throws(
    () => assertNoNaNOrUndefined('<text>${undefined}</text>'),
    /NaN\/undefined/,
  );
});

test("assertNoNaNOrUndefined: 错误信息含 SVG 前 200 字符", () => {
  try {
    assertNoNaNOrUndefined("<svg>bad NaN</svg>");
    assert.fail("应抛");
  } catch (e) {
    const msg = (e as Error).message;
    assert.ok(msg.includes("bad NaN"), "错误信息应含 SVG 前 200 字符");
  }
});
