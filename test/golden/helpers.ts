import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import * as jsQRns from "jsqr";

// jsqr 的 d.ts 声明 `export default jsQR`(ES default),但运行时是 CJS `module.exports = factory()`。
// 用 namespace import + .default 取出 callable,绕过类型/运行时形态不一致(jsqr 长期打包怪癖)。
const jsQR: (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) =>
  { data: string } | null = (jsQRns as any).default ?? (jsQRns as any);

/**
 * P0-3 Golden byte-compare helpers(自研;Archify 范式对偶,代码不引用 Archify 任何源码)。
 *
 * 7 个 helper(原 PRD §4.4 的 6 个 + R-01 新增 normalizeMathJaxIds):
 *   1. normalizeNewlines      只抹 CRLF(唯一规范化;过度规范化会掩盖真回归)
 *   2. normalizeMathJaxIds    R-01:抹 MathJax SVG 的 MJX-N- 自增计数器(lazy singleton)
 *   3. compareSvg             SVG 全文 ===(默认链路含 normalizeMathJaxIds,对非 MathJax SVG no-op)
 *   4. stripPngMetadata       PNG 元数据 strip(KEEP:IHDR/PLTE/tRNS/IDAT/IEND)
 *   5. comparePng             strip 后 Buffer.equals
 *   6. verifyQrPng            QR 双校验:PNG → jsQR 解码回原文等比
 *   7. assertNoNaNOrUndefined NaN/undefined 守门(先决保证)
 *
 * License:本文件为 P0-3 自研(normalizeNewlines/normalizeMathJaxIds 为通用正则,无版权)。
 */

/** 唯一规范化:只处理 CRLF。不过度规范化(会掩盖真回归)。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * R-01:抹 MathJax SVG 的 MJX-N- 自增计数器(lazy singleton 内部状态)。
 *
 * 实证(2026-07-21):src/formula.ts:23-35 的 lazy singleton 在内部维护自增计数器,
 * 每次 html.convert() 都把 ID 前缀从 `MJX-1-` 递增到 `MJX-2-`、`MJX-3-`…。
 * 同进程连跑 2 次 renderFormula({tex:"E=mc^2"}) 产出的 SVG byte 不同。
 *
 * 跨进程一致(每 fresh Node 进程都从 MJX-1- 起),但 golden workflow 的 render:golden
 * (写盘)与 npm test(读盘)是两个独立进程,加上未来可能在同进程顺序变更/并行,防御性 normalize。
 *
 * 对非 MathJax SVG 是 no-op(无 MJX- 前缀时 replace 不命中),可安全在所有 svg-byte 路径调用。
 */
export function normalizeMathJaxIds(svg: string): string {
  return svg.replace(/MJX-\d+-/g, "MJX-N-");
}

/** SVG byte-compare:规范化后全文 ===。默认链路含 normalizeMathJaxIds(对非 MathJax SVG no-op)。 */
export function compareSvg(
  fresh: string,
  checked: string,
  opts?: { preNormalize?: (s: string) => string },
): { ok: boolean; diff?: string } {
  // 若 case 显式提供 preNormalize(如 formula case 设 (s)=>s.replace(/MJX-\d+-/g,"MJX-N-"))
  // 则尊重 case-specific 钩子;否则用全局默认 normalizeMathJaxIds(no-op 安全)。
  const norm = opts?.preNormalize ?? normalizeMathJaxIds;
  const a = normalizeNewlines(norm(fresh));
  const b = normalizeNewlines(norm(checked));
  if (a === b) return { ok: true };
  const i = [...a].findIndex((c, idx) => c !== b[idx]);
  return {
    ok: false,
    diff: `first diff at char ${i}: fresh=${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} checked=${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`,
  };
}

/**
 * P0-5:HTML byte-compare。归一化 CRLF 后全文 ===。
 *
 * 实测 D2 默认渲染已 byte-identical(P0-5A §0.6 / open_point #2 实证);固定 salt
 * + noXMLTag + viewer 模板确定性 → 同输入两次 byte-identical。
 *
 * 与 compareSvg 区别:不抹 MathJax MJX-N-(HTML 无 MathJax),仅 normalize CRLF。
 * 若未来 HTML 内出现自增计数器(类似 MJX-N-),在此加 normalize 钩子。
 */
export function compareHtml(
  fresh: string,
  checked: string,
): { ok: boolean; diff?: string } {
  const a = normalizeNewlines(fresh);
  const b = normalizeNewlines(checked);
  if (a === b) return { ok: true };
  const i = [...a].findIndex((c, idx) => c !== b[idx]);
  return {
    ok: false,
    diff: `first diff at char ${i}: fresh=${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))} checked=${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`,
  };
}

/**
 * PNG 元数据 strip:丢弃 tEXt/zTXt/iTXt/tIME/eXIf/pHYs/sBIT/cHRM/gAMA/iCCP 等,
 * 只保留 IHDR+PLTE+tRNS+IDAT+IEND。等价 pngcrush -ow -rem allb。
 *
 * 规避 resvg/libpng 不同版本写不同 Software/tIME 字段导致的 byte 漂移。
 */
export function stripPngMetadata(buf: Buffer): Buffer {
  const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  const out: Buffer[] = [buf.subarray(0, 8)]; // PNG signature(8 字节)
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    // chunk 布局:4(len) + 4(type) + len(data) + 4(CRC)
    const chunkEnd = off + 12 + len;
    if (KEEP.has(type)) out.push(buf.subarray(off, chunkEnd));
    off = chunkEnd;
  }
  return Buffer.concat(out);
}

/** PNG byte-compare:strip 元数据后 Buffer.equals()。 */
export function comparePng(fresh: Buffer, checked: Buffer): { ok: boolean; reason?: string } {
  const a = stripPngMetadata(fresh);
  const b = stripPngMetadata(checked);
  if (a.equals(b)) return { ok: true };
  return {
    ok: false,
    reason: `fresh ${fresh.length}B / checked ${checked.length}B; after strip: ${a.length}B vs ${b.length}B`,
  };
}

/**
 * QR 双校验:PNG → jsQR 解码回原文,与期望原文等比。
 *
 * byte-compare 由调用方先做(comparePng);本 helper 只做解码语义校验,确保 PNG 不仅 byte 稳,
 * 且扫码器能识别(jsQR 是工业级 WASM 纯 JS 解码器,与 zxing 同源)。
 */
export function verifyQrPng(png: Buffer, expectedText: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const parsed = PNG.sync.read(png);
  const decoded = jsQR(new Uint8ClampedArray(parsed.data), parsed.width, parsed.height);
  if (!decoded) reasons.push("jsQR 解码失败(扫码器可能识别不出)");
  else if (decoded.data !== expectedText) reasons.push(`jsQR 解码 ≠ 原文:得 ${JSON.stringify(decoded.data)}`);
  return { ok: reasons.length === 0, reasons };
}

/** Archify NaN 守门:先决保证,任何 NaN/undefined 都不会污染 golden。 */
export function assertNoNaNOrUndefined(svg: string): void {
  if (/NaN|undefined/.test(svg)) {
    throw new Error(`rendered SVG contains NaN/undefined (would corrupt golden): ${svg.slice(0, 200)}...`);
  }
}

/** 读 expected/ 文件为字符串(SVG 用)。 */
export function readExpectedText(expectedAbsPath: string): string {
  return normalizeNewlines(readFileSync(expectedAbsPath, "utf8"));
}

/** 读 expected/ 文件为 Buffer(PNG 用)。 */
export function readExpectedBuf(expectedAbsPath: string): Buffer {
  return readFileSync(expectedAbsPath);
}
