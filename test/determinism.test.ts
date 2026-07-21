/**
 * P0-3 先决保证:6 个本地确定性渲染目标无 time/random 源 + formula/chart 同输入连跑 2 次 byte-identical。
 *
 * 这是 golden byte-compare 的"前提条件":若 renderer 本身含 time/random 源,刷新器与验证器
 * 跨进程跑出的 byte 必不同,golden 会 flaky;若同进程连跑 2 次都不同,任何 byte-compare 都无意义。
 *
 * License:本文件为 P0-3 自研。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

describe("renderer determinism(先决保证)", () => {
  it("6 个本地确定性渲染目标无 Math.random/Date.now/new Date/crypto.random/process.pid/builtAt/generatedAt 调用", () => {
    // narrowed scope(PRD §9 open_point 13 实证 0 匹配):不扫全 src/,会误伤
    // providers/handlers/pdf/render-video 管线的合法计时(轮询/缓存 TTL/日志时间戳)。
    // 仅扫 golden 覆盖的 6 个确定性渲染文件 + diagram 子目录。
    const out = execSync(
      `grep -rnE "Date\\.now|new Date|Math\\.random|crypto\\.random|process\\.pid|builtAt|generatedAt" ` +
      `src/qr.ts src/formula.ts src/chart.ts src/card.ts src/render-svg.ts src/diagram/ || true`,
      { encoding: "utf8" },
    ).trim();
    const lines = out.split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 0, `renderer 中发现时间/随机源,golden 会 flaky:\n${lines.join("\n")}`);
  });

  it("formula 同输入连跑 2 次产物经 normalizeMathJaxIds 后 byte-identical(R-01:MathJax 有自增 ID)", async () => {
    const { renderFormula } = await import("../dist/formula.js");
    const norm = (s: string) => s.replace(/MJX-\d+-/g, "MJX-N-");
    const a = await renderFormula({ tex: "E=mc^2", format: "svg" });
    const b = await renderFormula({ tex: "E=mc^2", format: "svg" });
    // 不 normalize 会因 MJX-1-/MJX-2- 自增而 differ;normalize 后 byte-identical(跨进程也一致)
    assert.equal(norm(a.svg), norm(b.svg), "formula 同输入两次渲染(normalizeMathJaxIds 后)不一致,无法做 golden");
  });

  it("Vega chart 同输入连跑 2 次产物 byte-identical(open_point 1 实证闭环)", async () => {
    const { renderChart } = await import("../dist/chart.js");
    const spec = {
      mark: "bar",
      encoding: { x: { field: "a", type: "nominal" }, y: { field: "v", type: "quantitative" } },
      data: { values: [{ a: "A", v: 28 }, { a: "B", v: 55 }] },
    };
    const a = await renderChart({ spec, format: "svg" });
    const b = await renderChart({ spec, format: "svg" });
    assert.equal(a.svg, b.svg, "Vega view.toSVG 同输入两次不一致,golden 需降级");
  });

  it("qrcode 同输入连跑 2 次 byte-identical(纯 JS 渲染,无状态)", async () => {
    const { renderQR } = await import("../dist/qr.js");
    const a = await renderQR({ text: "https://example.com", format: "svg" });
    const b = await renderQR({ text: "https://example.com", format: "svg" });
    assert.equal(a.svg, b.svg, "qrcode 同输入两次渲染不一致,无法做 golden");
  });

  it("card CJK 同输入连跑 2 次 byte-identical(open_point 7 实证 0 fetch + 跨进程 byte-identical)", async () => {
    const { renderCard } = await import("../dist/card.js");
    const props = {
      title: "测试卡片",
      subtitle: "Subtitle",
      fontFamily: "Noto Sans SC",
      width: 800,
      height: 420,
    };
    const a = await renderCard({ ...props, format: "svg" });
    const b = await renderCard({ ...props, format: "svg" });
    assert.equal(a.svg, b.svg, "card CJK 同输入两次渲染不一致,无法做 golden");
  });

  it("render_svg passthrough 同输入连跑 2 次 byte-identical(input==output)", async () => {
    const { renderSvg } = await import("../dist/render-svg.js");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
    const a = await renderSvg({ svg, format: "svg" });
    const b = await renderSvg({ svg, format: "svg" });
    assert.equal(a.svg, b.svg, "render_svg passthrough 同输入两次不一致,无法做 golden");
  });
});
