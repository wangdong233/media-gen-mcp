/**
 * P0-4 产物守门员测试。
 *
 * 覆盖三层(pares4/01-功能分析.md §9.1):
 *   1. 单元层:7 类产物正反例 + profile 双轨(直接 import dist/checks/output-checker.js)
 *   2. CLI 黑盒层:scripts/check-render-output.mjs 退出码 + JSON schema(execFileSync + JSON.parse)
 *   3. meta 测试:src/index.ts 中 assertOutputClean 调用数 === 11(防未来漏装钩子)
 *
 * .mjs 不进 tsconfig.test.json(对齐 test/*.mjs P0-2 范式),npm test 第二段 node --test test/*.mjs 天然覆盖。
 *
 * License:本文件为 P0-4 自研。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { checkOutput, assertOutputClean, detectKind } from "../dist/checks/output-checker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/check-render-output");
const GOLDEN = path.join(ROOT, "test/golden/expected");

// ─────────────────────────────────────────────────────────────────────────────
// 单元层:detectKind magic bytes
// ─────────────────────────────────────────────────────────────────────────────

describe("detectKind", () => {
  test("PNG signature → png", () => {
    const buf = readFileSync(path.join(GOLDEN, "qr/url.png"));
    assert.equal(detectKind(buf), "png");
  });
  test("SVG text → svg", () => {
    const buf = readFileSync(path.join(GOLDEN, "formula/basic.svg"));
    assert.equal(detectKind(buf), "svg");
  });
  test("MP4 ftyp → mp4", () => {
    const buf = readFileSync(path.join(FIXTURES, "valid.mp4"));
    assert.equal(detectKind(buf), "mp4");
  });
  test("HTML → unknown", () => {
    const buf = Buffer.from("<html><body>404</body></html>");
    assert.equal(detectKind(buf), "unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 单元层:正例 fixture(7 类产物,复用 P0-3 golden + 本阶段 valid.mp4/gif)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkOutput positive cases", () => {
  test("PNG 正例:qr/url.png PASS (strict)", async () => {
    const r = await checkOutput(path.join(GOLDEN, "qr/url.png"), { format: "png", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.equal(r.kind, "png");
    assert.equal(r.summary.fatals, 0);
    assert.equal(r.summary.errors, 0);
    assert.equal(r.metrics.width, 256);
    assert.equal(r.metrics.height, 256);
  });

  test("SVG 正例:formula/basic.svg PASS (strict)", async () => {
    const r = await checkOutput(path.join(GOLDEN, "formula/basic.svg"), { format: "svg", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.equal(r.kind, "svg");
    assert.ok((r.metrics.svgDrawNodes ?? 0) > 0, "应含绘制节点");
  });

  test("SVG 正例:chart/bar-basic.svg PASS (strict)", async () => {
    const r = await checkOutput(path.join(GOLDEN, "chart/bar-basic.svg"), { format: "svg", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
  });

  test("SVG 正例:card/cjk-og.svg PASS (strict)", async () => {
    const r = await checkOutput(path.join(GOLDEN, "card/cjk-og.svg"), { format: "svg", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
  });

  test("SVG 正例:render-svg/passthrough.svg PASS (strict)", async () => {
    const r = await checkOutput(path.join(GOLDEN, "render-svg/passthrough.svg"), { format: "svg", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
  });

  test("MP4 正例:valid.mp4 PASS (strict)", async () => {
    const r = await checkOutput(path.join(FIXTURES, "valid.mp4"), { format: "mp4", profile: "strict" });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.equal(r.kind, "mp4");
    assert.equal(r.metrics.mp4HasVideoTrack, true);
  });

  test("GIF 正例:valid.gif PASS (strict)", async () => {
    const r = await checkOutput(path.join(FIXTURES, "valid.gif"), { format: "gif", profile: "strict" });
    // valid.gif 912B > GIF 最小 1024B → min-size warning(non-fatal)
    assert.equal(r.summary.fatals, 0);
    assert.equal(r.ok, true);
    assert.equal(r.kind, "gif");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 单元层:反例 fixture + 三档 severity 路由
// ─────────────────────────────────────────────────────────────────────────────

describe("checkOutput negative cases + severity routing", () => {
  test("zero.png (0B) → file/readable fatal(任何 profile fail)", async () => {
    const standard = await checkOutput(path.join(FIXTURES, "zero.png"), { profile: "standard" });
    const strict = await checkOutput(path.join(FIXTURES, "zero.png"), { profile: "strict" });
    assert.equal(standard.ok, false);
    assert.equal(strict.ok, false);
    assert.ok(standard.issues.some((i) => i.code === "file/readable" && i.severity === "fatal"));
    assert.equal(standard.summary.fatals, 1);
  });

  test("html-as.png + format=png → png/magic-bytes fatal", async () => {
    const r = await checkOutput(path.join(FIXTURES, "html-as.png"), { format: "png", profile: "standard" });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === "png/magic-bytes" && i.severity === "fatal"));
  });

  test("truncated.png → png/decodable error:strict fail, standard pass(error 降 warning)", async () => {
    const standard = await checkOutput(path.join(FIXTURES, "truncated.png"), { format: "png", profile: "standard" });
    const strict = await checkOutput(path.join(FIXTURES, "truncated.png"), { format: "png", profile: "strict" });
    assert.equal(standard.ok, true, "standard 档 error 降级 warning,不 fail");
    assert.equal(strict.ok, false, "strict 档 error throw");
    assert.ok(strict.issues.some((i) => i.code === "png/decodable" && i.severity === "error"));
    assert.equal(strict.summary.errors, 1);
  });

  test("nan.svg → svg/no-nan-attrs error:strict fail", async () => {
    const standard = await checkOutput(path.join(FIXTURES, "nan.svg"), { format: "svg", profile: "standard" });
    const strict = await checkOutput(path.join(FIXTURES, "nan.svg"), { format: "svg", profile: "strict" });
    assert.equal(standard.ok, true, "standard 档 error 降 warning");
    assert.equal(strict.ok, false);
    assert.ok(strict.issues.some((i) => i.code === "svg/no-nan-attrs" && i.severity === "error"));
  });

  test("empty-formula.svg → svg/has-content error:strict fail", async () => {
    const strict = await checkOutput(path.join(FIXTURES, "empty-formula.svg"), { format: "svg", profile: "strict" });
    assert.equal(strict.ok, false);
    assert.ok(strict.issues.some((i) => i.code === "svg/has-content" && i.severity === "error"));
  });

  test("zero-viewbox.svg → svg/viewbox-nonzero error:strict fail", async () => {
    const strict = await checkOutput(path.join(FIXTURES, "zero-viewbox.svg"), { format: "svg", profile: "strict" });
    assert.equal(strict.ok, false);
    assert.ok(strict.issues.some((i) => i.code === "svg/viewbox-nonzero" && i.severity === "error"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 单元层:工具专属检查(QR roundtrip / formula has-glyphs)
// ─────────────────────────────────────────────────────────────────────────────

describe("tool-specific checks", () => {
  test("QR roundtrip:generate_qrcode + 正确 originalInput → PASS", async () => {
    const r = await checkOutput(path.join(GOLDEN, "qr/url.png"), {
      tool: "generate_qrcode",
      format: "png",
      profile: "strict",
      originalInput: { text: "https://example.com/path?query=1&other=2" },
    });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.ok(r.checks.some((c) => c.name === "decode_roundtrip" && c.ok));
  });

  test("QR roundtrip:originalInput 不匹配 → error", async () => {
    const r = await checkOutput(path.join(GOLDEN, "qr/url.png"), {
      tool: "generate_qrcode",
      format: "png",
      profile: "strict",
      originalInput: { text: "https://different-url.example.com/" },
    });
    assert.ok(r.issues.some((i) => i.code === "qrcode/decode-roundtrip"));
  });

  test("QR SVG:qr/basic.svg + tool=generate_qrcode → svg-has-modules PASS", async () => {
    const r = await checkOutput(path.join(GOLDEN, "qr/basic.svg"), {
      tool: "generate_qrcode",
      format: "svg",
      profile: "strict",
    });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.ok(r.checks.some((c) => c.name === "svg-has-modules" && c.ok));
  });

  test("formula/has-glyphs:formula/basic.svg + tool=generate_formula → PASS", async () => {
    const r = await checkOutput(path.join(GOLDEN, "formula/basic.svg"), {
      tool: "generate_formula",
      format: "svg",
      profile: "strict",
    });
    assert.equal(r.ok, true, `issues: ${JSON.stringify(r.issues)}`);
    assert.ok(r.checks.some((c) => c.name === "has-glyphs" && c.ok));
  });

  test("formula/has-glyphs:空 svg → error", async () => {
    const r = await checkOutput(path.join(FIXTURES, "empty-formula.svg"), {
      tool: "generate_formula",
      format: "svg",
      profile: "strict",
    });
    assert.ok(r.issues.some((i) => i.code === "formula/has-glyphs" && i.severity === "error"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 单元层:assertOutputClean handler 钩子入口
// ─────────────────────────────────────────────────────────────────────────────

describe("assertOutputClean handler entry", () => {
  test("合法产物 → {warnings, quality}(可能空数组)", async () => {
    const r = await assertOutputClean(path.join(GOLDEN, "qr/url.png"), {
      tool: "generate_qrcode",
      format: "png",
      originalInput: { text: "https://example.com/path?query=1&other=2" },
    });
    assert.ok(!("fatal" in r), "不应 fatal");
    assert.ok(Array.isArray(r.warnings));
    assert.equal(r.quality.ok, true);
  });

  test("zero.png → {fatal, quality}(任何 profile throw)", async () => {
    const r = await assertOutputClean(path.join(FIXTURES, "zero.png"), {
      tool: "generate_image",
      format: "png",
      profile: "standard",
    });
    assert.ok("fatal" in r, "应 fatal");
    assert.ok(r.fatal instanceof Error);
    assert.match(r.fatal.message, /\[file\/readable\]/);
  });

  test("truncated.png + strict → fatal(strict 档 error throw)", async () => {
    const r = await assertOutputClean(path.join(FIXTURES, "truncated.png"), {
      tool: "generate_image",
      format: "png",
      profile: "strict",
    });
    assert.ok("fatal" in r);
  });

  test("truncated.png + standard → warnings[](standard 档 error 降 warning)", async () => {
    const r = await assertOutputClean(path.join(FIXTURES, "truncated.png"), {
      tool: "generate_image",
      format: "png",
      profile: "standard",
    });
    assert.ok(!("fatal" in r));
    assert.ok(r.warnings.some((w) => w.includes("png/decodable")));
  });

  test("MEDIA_GEN_CHECK_DISABLE=1 → 直接放行,checks=disabled", async () => {
    const prev = process.env.MEDIA_GEN_CHECK_DISABLE;
    process.env.MEDIA_GEN_CHECK_DISABLE = "1";
    try {
      const r = await assertOutputClean(path.join(FIXTURES, "zero.png"), {
        tool: "generate_image",
        format: "png",
      });
      assert.ok(!("fatal" in r), "DISABLE 模式不 throw");
      assert.equal(r.quality.ok, true);
      assert.equal(r.quality.profile, "standard");
    } finally {
      if (prev === undefined) delete process.env.MEDIA_GEN_CHECK_DISABLE;
      else process.env.MEDIA_GEN_CHECK_DISABLE = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI 黑盒层:scripts/check-render-output.mjs
// ─────────────────────────────────────────────────────────────────────────────

describe("CLI check-render-output.mjs", () => {
  const CLI = path.join(ROOT, "scripts/check-render-output.mjs");

  function runCli(args) {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout;
  }

  function runCliExpectFail(args) {
    // execFileSync 会抛非零退出码错误,catch 后取 stdout(依然写了 JSON)
    try {
      return execFileSync("node", [CLI, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      // 非零退出码时 e.stdout 仍含 JSON(CLI 在 exit 前已写)
      return (e.stdout ?? "").toString();
    }
  }

  test("合法 png + strict → exit 0 + JSON.ok=true", () => {
    const out = runCli([path.join(GOLDEN, "qr/url.png"), "--profile=strict"]);
    const r = JSON.parse(out);
    assert.equal(r.ok, true);
    assert.equal(r.profile, "strict");
    assert.equal(r.kind, "png");
    assert.equal(r.schemaVersion, 1);
  });

  test("zero.png → exit 1 + JSON.ok=false + fatals=1", () => {
    const out = runCliExpectFail([path.join(FIXTURES, "zero.png")]);
    const r = JSON.parse(out);
    assert.equal(r.ok, false);
    assert.equal(r.summary.fatals, 1);
  });

  test("nan.svg + strict → exit 1 + svg/no-nan-attrs error", () => {
    const out = runCliExpectFail([path.join(FIXTURES, "nan.svg"), "--format=svg", "--profile=strict"]);
    const r = JSON.parse(out);
    assert.equal(r.ok, false);
    assert.equal(r.summary.errors, 1);
    assert.ok(r.issues.some((i) => i.code === "svg/no-nan-attrs"));
  });

  test("nan.svg + standard → exit 0(error 不影响 ok,降级逻辑在 assertOutputClean)", () => {
    const out = runCli([path.join(FIXTURES, "nan.svg"), "--format=svg", "--profile=standard"]);
    const r = JSON.parse(out);
    assert.equal(r.ok, true);
    // summary 按原始 severity 计数,profile 决定如何反应(不动 summary)
    assert.equal(r.summary.errors, 1);
    assert.equal(r.summary.warnings, 0);
    // 但 status=pass(standard 档 error 不 fail)
    assert.equal(r.status, "pass");
  });

  test("--help 显示帮助", () => {
    // --help 后 exit 0,不需要解析
    const out = runCli(["--help"]);
    assert.match(out, /Usage:/);
    assert.match(out, /--profile/);
  });

  test("QR roundtrip:--original-input JSON 解析", () => {
    const out = runCli([
      path.join(GOLDEN, "qr/url.png"),
      "--tool=generate_qrcode",
      "--format=png",
      `--original-input=${JSON.stringify({ text: "https://example.com/path?query=1&other=2" })}`,
    ]);
    const r = JSON.parse(out);
    assert.equal(r.ok, true);
    assert.ok(r.checks.some((c) => c.name === "decode_roundtrip" && c.ok));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// meta 测试:防未来漏装钩子(R6 风险缓解)
// ─────────────────────────────────────────────────────────────────────────────

describe("handler 钩子覆盖完整性 meta", () => {
  test("src/index.ts 中 assertOutputClean 调用数 === 11(渲染工具数;generate_interactive_diagram + generate_nested_diagram 跳过)", () => {
    const src = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    const calls = (src.match(/assertOutputClean\(/g) || []).length;
    // 11 个有 local_path 的 raster/vector 渲染工具(generate_image / create_video / get_video /
    // generate_diagram / generate_qrcode / generate_chart / generate_formula / generate_icon /
    // generate_card / render_svg / render_video)。
    // flow_status 的媒体下载钩子已随 Google Flow 渠道分离至 flow-mcp(24→22 工具,12→11 处调用)。
    // P0-5 generate_interactive_diagram + P0-5B generate_nested_diagram 均产 local_path 但**故意跳过**
    // assertOutputClean(HTML 是 viewer 容器,非 raster/vector;契约 asserts S2/S4/S9/S11/S_NESTED 在
    // renderInteractiveHtml / buildNestedHtml 内部做)。若未来新增 raster/vector 渲染工具,同步插入钩子并更新此断言。
    assert.equal(
      calls,
      11,
      `assertOutputClean 调用数=${calls},预期 11;若新增 raster/vector 渲染工具,需同步插入钩子并更新此断言。`,
    );
  });

  test("src/index.ts 中 assertOutputClean 已 import", () => {
    const src = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    assert.match(src, /from\s+["']\.\/checks\/output-checker\.js[""]/);
  });
});
