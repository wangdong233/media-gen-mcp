/**
 * P0-3 Golden byte-compare 主入口。
 *
 * 遍历 GOLDEN 数组,对每条 case 调 render(tool, fixture) 拿 fresh 产物,
 * 与 test/golden/expected/<file> 做 byte 比对:
 *   - svg-byte        fresh → normalizeMathJaxIds → normalizeNewlines → === checked
 *   - png-byte        fresh → stripPngMetadata → Buffer.equals(checked)
 *   - qr-png-verify   byte + jsQR 解码回原文等比
 *
 * 失败信息含刷新命令(照搬 Archify 句式):
 *   "fresh render differs from test/golden/expected/<file>; if the change is intentional,
 *    run `npm run render:golden` and commit. <diff>"
 *
 * License:本文件为 P0-3 自研。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "./golden/render.js";
import { GOLDEN } from "./golden/golden.config.js";
import { compareSvg, comparePng, verifyQrPng, assertNoNaNOrUndefined } from "./golden/helpers.js";

const EXPECTED = path.resolve("test/golden/expected");

describe("golden byte-compare", () => {
  for (const c of GOLDEN) {
    // skipReason case:it.skip 并打印原因(网络依赖、跨平台 byte 不一致等)
    const fn = c.skipReason ? it.skip : it;
    fn(c.id, async () => {
      const { svg, png, input } = await render(c.tool, c.fixturePath);
      const expectedPath = path.join(EXPECTED, c.expectedPath);
      const expected = readFileSync(expectedPath);

      if (c.compareStrategy === "svg-byte") {
        if (!svg) throw new Error(`${c.id}: renderer 未返 svg`);
        assertNoNaNOrUndefined(svg);
        const checked = expected.toString("utf8");
        // R-01:formula 的 preNormalize 抹 MJX-N-;其它 case preNormalize undefined →
        // compareSvg 内部默认走 normalizeMathJaxIds(no-op 安全)
        const r = compareSvg(svg, checked, c.preNormalize ? { preNormalize: c.preNormalize } : undefined);
        assert.ok(
          r.ok,
          `${c.id}: fresh render differs from test/golden/expected/${c.expectedPath}; if the change is intentional, run \`npm run render:golden\` and commit. ${r.diff ?? ""}`,
        );
      } else if (c.compareStrategy === "png-byte") {
        if (!png) throw new Error(`${c.id}: renderer 未返 png`);
        const r = comparePng(png, expected);
        assert.ok(
          r.ok,
          `${c.id}: fresh PNG differs from test/golden/expected/${c.expectedPath}; if intentional, run \`npm run render:golden\`. ${r.reason ?? ""}`,
        );
      } else if (c.compareStrategy === "qr-png-verify") {
        if (!png) throw new Error(`${c.id}: renderer 未返 png`);
        // 双校验:byte + jsQR 解码
        const r = comparePng(png, expected);
        assert.ok(r.ok, `${c.id}: QR PNG byte differs. ${r.reason ?? ""}`);
        const v = verifyQrPng(png, String(input));
        assert.ok(v.ok, `${c.id}: QR decode verify failed: ${v.reasons.join("; ")}`);
      }
    });
  }
});

// 显式注册 skipReason case 的说明(it.skip 不会真正运行,但 console 输出会含 skipReason)
describe("golden skip reasons", () => {
  for (const c of GOLDEN) {
    if (c.skipReason) {
      it.skip(`${c.id}: ${c.skipReason}`, () => {});
    }
  }
});
