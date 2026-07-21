#!/usr/bin/env node
/**
 * P0-4 产物守门员 CLI 黑盒。
 *
 * 用法:
 *   node scripts/check-render-output.mjs <file> [--profile=standard|strict] [--tool=...] [--format=...]
 *   node scripts/check-render-output.mjs --qr <file> --expected <text>      (QR decode roundtrip)
 *
 * 输出:stdout = 结构化 JSON(OutputReport,见 src/checks/output-checker.ts)
 * 退出码:0 ⇔ report.ok === true
 *
 * 接入位置:
 *   - npm test 第 6 段(对齐 pares4 §3.2):MEDIA_GEN_CHECK_PROFILE=strict node scripts/check-render-output.mjs test/golden/expected/qr/url.png
 *   - npm run check:render <file>(ad-hoc 任意产物)
 *
 * 设计:CLI 黑盒与 src/index.ts handler 钩子共用同一份编译产物 dist/checks/output-checker.js,
 * 保证运行时与 CLI 校验语义 100% 一致(单一真相源)。
 *
 * License:本文件为 P0-4 自研。
 */
import { checkOutput } from "../dist/checks/output-checker.js";

const argv = process.argv.slice(2);

function parseFlag(name) {
  // --name=value / --name value 两种形态
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(`--${name}=`.length);
  }
  return undefined;
}

function usage() {
  return [
    "Usage: check-render-output.mjs <file> [--profile=standard|strict] [--tool=...] [--format=...] [--original-input=<json>]",
    "       check-render-output.mjs --help",
    "",
    "Options:",
    "  --profile=strict|standard   严档/标准档(默认 standard 或 env MEDIA_GEN_CHECK_PROFILE)",
    "  --tool=<name>               触发工具专属检查(generate_qrcode/generate_formula/render_svg 等)",
    "  --format=<fmt>              format 提示(svg/png/mp4/...);不传则按 magic bytes 自动检测",
    "  --original-input=<json>     工具专属上下文(JSON 字符串,如 '{\"text\":\"https://...\"}' for QR roundtrip)",
    "  --help                      显示本帮助",
    "",
    "Output: stdout = JSON(OutputReport);exit 0 ⇔ ok===true",
  ].join("\n");
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

// 第一个非 flag 参数 = file
const file = argv.find((a) => !a.startsWith("--"));
if (!file) {
  process.stderr.write(usage() + "\n");
  process.stderr.write("\nERROR: 缺少 <file> 参数。\n");
  process.exit(2);
}

const profile = parseFlag("profile");
const tool = parseFlag("tool");
const format = parseFlag("format");
const originalInputRaw = parseFlag("original-input");
let originalInput;
if (originalInputRaw !== undefined) {
  try {
    originalInput = JSON.parse(originalInputRaw);
  } catch (e) {
    process.stderr.write(`ERROR: --original-input 不是合法 JSON: ${e?.message ?? e}\n`);
    process.exit(2);
  }
}

const opts = {
  tool,
  format,
  profile,
  originalInput,
};

try {
  const report = await checkOutput(file, opts);
  // stdout 仅 JSON,人类可读 summary 写到 stderr(防 stdout 污染 JSON.parse)
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.stderr.write(
    `\n[${report.profile}] ${report.ok ? "PASS" : "FAIL"} ${report.kind} ${report.file}\n` +
      `  summary: fatals=${report.summary.fatals} errors=${report.summary.errors} warnings=${report.summary.warnings}\n` +
      `  checks(${report.checks.length}): ${report.checks.map((c) => `${c.name}=${c.ok ? "ok" : "X"}`).join(", ")}\n`,
  );
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  // checkOutput 设计上不抛;真到这里是环境/路径异常
  process.stderr.write(`ERROR: checkOutput 抛错(设计上不该发生): ${e?.message ?? e}\n`);
  if (e?.stack) process.stderr.write(e.stack + "\n");
  process.exit(3);
}
