/**
 * P0-4 产物守门员(单一真相源)。
 *
 * 三方共用(handler 运行时钩子 / scripts/check-render-output.mjs CLI / test 契约):
 *   - import { assertOutputClean, checkOutput, detectKind } from "./checks/output-checker.js";
 *
 * 设计立场(对齐 pares4/01-功能分析.md §2.1 / §6.1):
 *   - 三档 severity:fatal(任何 profile throw)/ error(hard-fail:strict throw,standard 降 warning)/ warning(永不 throw)
 *   - 灰度:standard 档默认只 fatal throw;两周观察后 hard-fail 升降档由决策表处理(pares4 §13)
 *   - 单一真相源:不在 handler / CLI / test 三处重复实现解码逻辑
 *   - LLM 友好:每个 issue message 都给定位 + 阈值 + 修复动词,不留 "[object Object]"
 *   - 同输入同输出可入 git:fatal/error/warning 判定纯函数,不依赖时间戳/随机/平台差异
 *
 * License:本文件为 P0-4 自研(解码/解析能力 = pngjs + jsqr + @xmldom/xmldom 标准库用法,
 * Archify 仅用作 wrapper 范式对偶参考,代码不引用 Archify 任何源码)。
 *
 * 历史边界(对齐 pares4 §1.边界表):P0-3(golden byte-compare)守测试期回归,
 * P0-4(本文件)守运行时合法性。重叠的 pngjs/jsQR 调用是有意的(P0-3 验证过的能力推到运行时);
 * 未抽到 src/checks/decode-helpers.ts 是 open point(pares4 OP-7),防 P0-4 范围蔓延。
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

export type Profile = "standard" | "strict";

export type Severity = "fatal" | "error" | "warning";

/**
 * fatal  = 任何 profile 都 throw → isError:true(file/readable, magic-bytes,
 *           svg/parseable, svg/has-root, container-decodable)
 * error  = hard-fail:strict profile throw,standard 降级 warning
 *           (decodable, dimensions-sane, svg/viewbox-nonzero, svg/no-nan-attrs, svg/has-content)
 * warning= 永不 throw(non-blank, tracks-present, file/min-size per-kind)
 */
export type Kind = "png" | "jpeg" | "webp" | "svg" | "mp4" | "gif" | "webm" | "unknown";

export interface CheckIssue {
  severity: Severity;
  /** "png/magic-bytes" / "svg/has-content" / "qrcode/decode-roundtrip" 等。 */
  code: string;
  /** LLM 友好:定位 + 阈值 + 修复动词。 */
  message: string;
  details?: Record<string, unknown>;
}

export interface CheckResult {
  /** "magic_bytes" / "decodable" / "decode_roundtrip" 等。 */
  name: string;
  ok: boolean;
  /** 人类可读,带 [code] 前缀。 */
  details: string[];
}

export interface OutputReport {
  schemaVersion: 1;
  profile: Profile;
  /** fail 当且仅当 fatals>0(任何 profile) 或 errors>0(strict)。 */
  status: "pass" | "fail";
  /** === (status === "pass")。 */
  ok: boolean;
  /** 绝对路径。 */
  file: string;
  kind: Kind;
  checks: CheckResult[];
  summary: { fatals: number; errors: number; warnings: number };
  metrics: {
    bytes?: number;
    width?: number;
    height?: number;
    svgDrawNodes?: number;
    mp4DurationMs?: number;
    mp4HasVideoTrack?: boolean;
  };
  issues: CheckIssue[];
}

export interface AssertOptions {
  /** "generate_qrcode" / "render_video" 等,路由工具专属检查。 */
  tool: string;
  format?: string;
  profile?: Profile;
  /** QR decode roundtrip 比对值 / 公式 has-glyphs 上下文等。 */
  originalInput?: unknown;
}

export interface CheckOptions {
  tool?: string;
  format?: string;
  profile?: Profile;
  originalInput?: unknown;
}

export type AssertResult =
  | { warnings: string[]; quality: OutputReport }
  | { fatal: Error; quality: OutputReport };

// ─────────────────────────────────────────────────────────────────────────────
// 全局开关 + profile 解析
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 全局紧急回滚开关(R11 风险缓解)。=1 时所有 checkOutput / assertOutputClean 直接放行,
 * 不读盘不 spawn。handler / CLI 都尊重。
 *
 * 与 profile 区别:profile=strict 是"严档";DISABLE=1 是"完全关"。
 */
function isDisabled(): boolean {
  return process.env.MEDIA_GEN_CHECK_DISABLE === "1";
}

function resolveProfile(p?: Profile): Profile {
  // CLI 第 6 段会显式设 strict;handler 默认 standard。env 优先级最高(灾难回滚用)。
  const fromEnv = process.env.MEDIA_GEN_CHECK_PROFILE as Profile | undefined;
  if (fromEnv === "strict" || fromEnv === "standard") return fromEnv;
  return p ?? "standard";
}

// ─────────────────────────────────────────────────────────────────────────────
// 同步依赖加载(pngjs / jsqr / @xmldom/xmldom 都是 CJS/ESM 混装,需 require 兜底)
// ─────────────────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);

// pngjs:纯 JS PNG 解码器(P0-3 已在 devDeps)。无 bundled types → 用 any 兜底。
// (tsconfig.test.json 关了 noImplicitAny 才能让 test/golden/helpers.ts 直接 import;
//  src/ 下 strict 模式开,故 require 形态。)
let PNG: { sync: { read: (buf: Buffer) => { width: number; height: number; data: Uint8Array } } } | null = null;
try {
  PNG = require("pngjs").PNG;
} catch {
  PNG = null;
}

// jsqr:QR 解码器(P0-3 已在 devDeps);运行时形如 CJS module.exports = factory()。
// namespace import 在 ESM 中也能取到 .default,但这里用 require 直接拿 callable 最稳。
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => { data: string } | null;
let jsQR: JsQrFn | null = null;
try {
  const mod: any = require("jsqr");
  jsQR = (mod?.default ?? mod) ?? null;
} catch {
  jsQR = null;
}

// @xmldom/xmldom:SVG 解析(P0-4 唯一新增 devDep,已传递装,显式锁)。
type DOMParserCtor = new (opts?: {
  locator?: unknown;
  errorHandler?: (level: string, msg: string) => void;
}) => { parseFromString: (src: string, mime: string) => unknown };
let DOMParserCtor: DOMParserCtor | null = null;
try {
  const mod: any = require("@xmldom/xmldom");
  DOMParserCtor = mod?.DOMParser ?? null;
} catch {
  DOMParserCtor = null;
}

// @napi-rs/canvas:optionalDependencies;--no-optional 缺失时 try-import 兜底(R5 风险缓解)。
// 仅用于 JPEG/WebP 像素解码(缺失时退化为只做 magic-bytes + warning)。
type CanvasLoadImage = (src: Buffer | string) => Promise<{ width: number; height: number }>;
let canvasLoadImage: CanvasLoadImage | null = null;
try {
  const mod: any = require("@napi-rs/canvas");
  canvasLoadImage = mod?.loadImage ?? null;
} catch {
  canvasLoadImage = null;
}

// ffmpeg-static:已 dependencies(render-video 用),复用 spawn 不新增暴露。
let ffmpegPath: string | null = null;
try {
  ffmpegPath = require("ffmpeg-static") as unknown as string;
} catch {
  // 兜底:ffmpeg-static 缺失时退化为只做 magic-bytes + warning(container-decodable 降级)
  ffmpegPath = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// detectKind:format 提示 + magic bytes 启发式
// ─────────────────────────────────────────────────────────────────────────────

const SIG_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIG_JPEG_FF = Buffer.from([0xff, 0xd8, 0xff]);
const SIG_WEBP_RIFF = Buffer.from("RIFF", "ascii");
const SIG_WEBP_WEBP = Buffer.from("WEBP", "ascii");
// MP4/WEBM 容器签名散(brand box ftyp + 可变 brand),不靠 magic bytes,只靠 ffmpeg probe。

export function detectKind(buf: Buffer, format?: string): Kind {
  // format 提示:caller 已知 handler 声明的 format,优先信任(与 svg/mp4/gif/webm 一致)。
  // 注意:这里不做 magic-bytes 校验 —— 那 strict 校验在 checkRaster 里仍会再守一道(fatal/`<kind>/magic-bytes`),
  // 此处只负责"路由到正确的检查分支",避免对 format hint 做无意义的死代码三元。
  // 历史 bug:曾写 `return buf.length >= 8 && buf.subarray(0,8).equals(SIG_PNG) ? "png" : "png"`
  // 两个分支同值,签名校验结果被丢弃(dead code),且让 caller 误传 format=png 校验 JPEG 字节时被盲信。
  if (format === "svg") return "svg";
  if (format === "png") return "png";
  if (format === "mp4" || format === "gif" || format === "webm") return format;

  if (buf.length >= 8 && buf.subarray(0, 8).equals(SIG_PNG)) return "png";
  if (buf.length >= 3 && buf.subarray(0, 3).equals(SIG_JPEG_FF)) return "jpeg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).equals(SIG_WEBP_RIFF) &&
    buf.subarray(8, 12).equals(SIG_WEBP_WEBP)
  ) {
    return "webp";
  }
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  // SVG:文本,前 512 字节里含 <svg 或 xmlns
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString("utf8").toLowerCase();
  if (head.includes("<svg") || head.includes("xmlns=\"http://www.w3.org/2000/svg\"")) {
    return "svg";
  }
  // MP4:ftyp box 在前 32 字节("????ftypXXXX")
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return "mp4";
  }
  // WEBM:EBML magic
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return "webm";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// 容器探活:ffmpeg spawnSync + 5s timeout(R8 风险缓解)
// ─────────────────────────────────────────────────────────────────────────────

interface FfprobeResult {
  ok: boolean;
  /** exit code 0 = 容器可解;非 0 / timeout / spawn 失败都为 false。 */
  decodable: boolean;
  hasVideoTrack: boolean;
  durationMs?: number;
  timedOut: boolean;
  /**
   * ffmpeg 二进制缺失 / spawn ENOENT → 探活器本身不可用(非产物问题)。
   * caller 应降级 warning,绝不 fatal 产物(产物可能完全合法,仅本机无 ffmpeg 无法自动校验)。
   */
  checkerUnavailable?: boolean;
  errorMessage?: string;
}

function probeContainer(file: string): FfprobeResult {
  // ⚠️ require('ffmpeg-static') 返回路径字符串即使二进制从未下载(postinstall 在屏蔽 GitHub/release
  // 二进制下载的网络下被跳过,binary 不在盘)。此时 !ffmpegPath 兜底失效 → 必须 existsSync 实测二进制在盘。
  // 否则 spawnSync 返回 ENOENT + 空 stderr → 下面 hasVideo/hasDuration 全 false → decodable:false →
  // checkContainer 误判合法视频为 fatal "moov atom 缺失"(实测:agnes/zhipu 生成的合法 MP4 全被误杀)。
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    return {
      ok: false,
      decodable: false,
      hasVideoTrack: false,
      timedOut: false,
      checkerUnavailable: true,
      errorMessage: "ffmpeg-static 二进制缺失(postinstall 未下二进制,常见于屏蔽 release 二进制的网络),容器探活跳过",
    };
  }
  try {
    const r = spawnSync(ffmpegPath, ["-i", file, "-f", "null", "-"], {
      timeout: 15000, // 5s→15s:CPU 过载环境 ffmpeg spawn 偶发慢(实测 Load94),给余量防 flaky timeout
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // 防御:existsSync 后到 spawn 间二进制被删 / spawn 层 ENOENT → 同样判 checker 不可用,绝不 fatal 产物。
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        decodable: false,
        hasVideoTrack: false,
        timedOut: false,
        checkerUnavailable: true,
        errorMessage: "ffmpeg-static spawn ENOENT(二进制缺失),容器探活跳过",
      };
    }
    // ffmpeg 把元数据写到 stderr,exit code 通常非 0(null muxer 不接受 stdin 路径)
    // 但若容器能被 ffmpeg 读 → 至少能 stderr 出 Duration/Video: 信息;读不出来 → truly bad。
    const stderr = r.stderr ?? "";
    const hasVideo = /Video:\s/i.test(stderr);
    const hasDuration = /Duration:\s*\d+:\d+:\d/i.test(stderr);
    // 真正无法识别的容器:stderr 含 "Invalid data found" / "No such file" / 完全空
    const invalid = /Invalid data found when processing input|No such file or directory|Could not find tag for codec|moov atom not found/i.test(stderr);
    // timedOut 不在 @types/node 的 SpawnSyncReturns 上(实现层有),用 signal/error 启发式
    const timedOut = r.signal === "SIGTERM" || Boolean((r as any).timedOut) || /TIMEDOUT/i.test(r.error?.message ?? "");
    if (timedOut) {
      return { ok: false, decodable: false, hasVideoTrack: false, timedOut: true, errorMessage: "ffmpeg 5s timeout" };
    }
    if (invalid) {
      return { ok: false, decodable: false, hasVideoTrack: hasVideo, timedOut: false, errorMessage: "ffmpeg 拒绝输入" };
    }
    // 容器合法(ffmpeg 能解出 stream 信息)
    let durationMs: number | undefined;
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      const [_, hh, mm, ss] = m;
      durationMs = ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000;
    }
    return {
      ok: true,
      decodable: hasVideo || hasDuration,
      hasVideoTrack: hasVideo,
      durationMs,
      timedOut: false,
    };
  } catch (e: any) {
    return {
      ok: false,
      decodable: false,
      hasVideoTrack: false,
      timedOut: false,
      errorMessage: e?.message ?? String(e),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口 checkOutput:跑完所有检查,返结构化 report(不抛)
// ─────────────────────────────────────────────────────────────────────────────

const DRAW_NODE_TAGS = new Set([
  "path",
  "use",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "image",
]);

/** 递归遍历 DOM 树,统计绘制节点 + 检测 NaN/Infinity/undefined 字面量。 */
function inspectSvgDom(
  node: any,
  acc: { drawNodes: number; nanAttrs: string[] },
): void {
  if (!node || typeof node !== "object") return;
  const tag = (node.tagName ?? "").toLowerCase();
  if (DRAW_NODE_TAGS.has(tag)) acc.drawNodes++;
  // attrs NaN/undefined/infinity 字面量扫描
  const attrs = node.attributes;
  if (attrs && typeof attrs.length === "number") {
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs.item(i);
      if (!a) continue;
      const v = String(a.value ?? "");
      // 排除合法的 "Infinity" / "NaN" 字符串(极少见,但 SVG2 允许某些 attr 用 "Infinity" 字符串字面值)
      // 此处保守:严格匹配裸 NaN/Infinity/-Infinity/undefined 字面量
      if (/(^|[("\s=])(NaN|Infinity|-Infinity|undefined)(?=[)"\s]|$)/i.test(v)) {
        acc.nanAttrs.push(`${tag}@${a.name}=${v}`);
      }
    }
  }
  // 子节点递归
  const kids = node.childNodes;
  if (kids && typeof kids.length === "number") {
    for (let i = 0; i < kids.length; i++) {
      inspectSvgDom(kids.item(i), acc);
    }
  }
}

/** 推入 issue + 对应 CheckResult(ok=false 时)。 */
function pushIssue(
  issues: CheckIssue[],
  checks: CheckResult[],
  severity: Severity,
  code: string,
  message: string,
  checkName: string,
  details?: Record<string, unknown>,
): void {
  issues.push({ severity, code, message, details });
  checks.push({ name: checkName, ok: false, details: [`[${code}] ${message}`] });
}

function pushOk(
  checks: CheckResult[],
  checkName: string,
  code: string,
  details: string[],
): void {
  checks.push({ name: checkName, ok: true, details: [`[${code}] ${details.join("; ")}`] });
}

/**
 * 主入口:跑完所有检查,返结构化 report(绝不抛)。
 * 错误一律落到 issues/checks 里。MEDIA_GEN_CHECK_DISABLE=1 时直接放行(report status=pass)。
 */
export async function checkOutput(filePath: string, opts: CheckOptions = {}): Promise<OutputReport> {
  const profile = resolveProfile(opts.profile);
  const tool = opts.tool ?? "";
  const format = opts.format;

  // 紧急回滚(R11):直接放行,所有检查 noop。CLI 第 6 段会跑此分支(env 不设则正常)。
  if (isDisabled()) {
    return {
      schemaVersion: 1,
      profile,
      status: "pass",
      ok: true,
      file: path.resolve(filePath),
      kind: "unknown",
      checks: [{ name: "disabled", ok: true, details: ["[check/disabled] MEDIA_GEN_CHECK_DISABLE=1 全跳过(R11 回滚)"] }],
      summary: { fatals: 0, errors: 0, warnings: 0 },
      metrics: {},
      issues: [],
    };
  }

  const abs = path.resolve(filePath);
  const issues: CheckIssue[] = [];
  const checks: CheckResult[] = [];
  const metrics: OutputReport["metrics"] = {};

  // ── file/readable(fatal):fs.stat + readFile > 0 ──
  let buf: Buffer | null = null;
  try {
    const st = statSync(abs);
    metrics.bytes = st.size;
    if (st.size === 0) {
      pushIssue(
        issues,
        checks,
        "fatal",
        "file/readable",
        `产物文件 0 字节,无法判定格式:${abs}`,
        "readable",
      );
    } else {
      buf = readFileSync(abs);
      pushOk(checks, "readable", "file/readable", [`size=${st.size}B`]);
    }
  } catch (e: any) {
    pushIssue(
      issues,
      checks,
      "fatal",
      "file/readable",
      `产物文件读取失败:${e?.message ?? String(e)}`,
      "readable",
    );
  }

  // file/readable fail → 后续检查无法进行,直接装配 report
  if (!buf || buf.length === 0) {
    return finalize(abs, "unknown", profile, checks, issues, metrics);
  }

  // ── file/min-size(per-kind warning)──
  // 阈值(对齐 pares4 §6.1 warning 表):
  //   PNG/JPEG/WebP > 64B;SVG > 32B;MP4/GIF/WebM > 1KB
  const kind = detectKind(buf, format);
  const minSizeFor = (k: Kind): number => {
    if (k === "png" || k === "jpeg" || k === "webp") return 64;
    if (k === "svg") return 32;
    if (k === "mp4" || k === "gif" || k === "webm") return 1024;
    return 32; // unknown 给宽容阈值
  };
  const minSize = minSizeFor(kind);
  if (metrics.bytes !== undefined && metrics.bytes < minSize) {
    pushIssue(
      issues,
      checks,
      "warning",
      "file/min-size",
      `产物 ${metrics.bytes}B < ${kind} 最小阈值 ${minSize}B,可能是占位/损坏文件;若内容确实最简可忽略`,
      "min-size",
    );
  } else {
    pushOk(checks, "min-size", "file/min-size", [`${metrics.bytes}B ≥ ${minSize}B (${kind})`]);
  }

  // ── 按种类路由检查 ──
  if (kind === "png" || kind === "jpeg" || kind === "webp") {
    await checkRaster(kind, buf, issues, checks, metrics);
  } else if (kind === "svg") {
    checkSvg(buf, issues, checks, metrics);
  } else if (kind === "mp4" || kind === "gif" || kind === "webm") {
    checkContainer(abs, kind, issues, checks, metrics);
  } else {
    // unknown kind:warning,不阻断
    pushIssue(
      issues,
      checks,
      "warning",
      "file/unknown-kind",
      `无法识别产物种类(magic bytes 均不匹配);format 提示=${format ?? "(未提供)"}`,
      "kind-detect",
    );
  }

  // ── 工具专属检查(按 tool 字段触发)──
  if (tool === "generate_qrcode") {
    runQrcodeSpecifics(buf, kind, opts, issues, checks, metrics);
  } else if (tool === "generate_formula") {
    runFormulaSpecifics(buf, kind, issues, checks);
  } else if (tool === "render_svg") {
    runRenderSvgSpecifics(buf, kind, opts, issues, checks, metrics);
  }

  return finalize(abs, kind, profile, checks, issues, metrics);
}

// ─────────────────────────────────────────────────────────────────────────────
// 光栅(PNG/JPEG/WebP)检查
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JPEG/WebP 完整性预校验:防止 @napi-rs/canvas.loadImage() 在 truncated/malformed
 * 输入上 SIGSEGV(native crash,Node try/catch 无法捕获 → 整个 MCP server 进程被杀)。
 *
 * 不替代 canvas 完整解码,只挡死"开头合法但结构不全 / 末尾截断"这类典型场景
 * (provider 半截 dataURI / 网络中断 / 极小 fixture)。PNG 不需要走这条路径
 * (pngjs 是纯 JS,异常 try/catch 能抓)。
 *
 * 返回 ok:false 时 caller 不应调用 canvasLoadImage,直接记 decodable error。
 *
 * 历史:第一版只查末尾 EOI 标记,实测 22B fixture(只含 SOI+APP0+EOI 无 SOF/SOS)
 * 仍触发 SIGSEGV → 改为段遍历 + 强制要求 SOFn + SOS + EOI 三件齐全。
 */
function preValidateNativeRasterPayload(
  kind: "jpeg" | "webp",
  buf: Buffer,
): { ok: true } | { ok: false; reason: string } {
  if (kind === "jpeg") {
    // JPEG 结构:SOI(FFD8) ... 段(APPn/COM/SOFn/DHT/SOS 等) ... EOI(FFD9)
    // canvas loadImage 在缺 SOF(尺寸未定义)/ SOS(无扫描数据)/ EOI(截断)时 SIGSEGV。
    if (buf.length < 6) {
      return { ok: false, reason: `JPEG 仅 ${buf.length}B(< 6),无法容纳 SOI+SOF;疑似截断` };
    }
    let off = 2; // 跳过 SOI(FFD8)
    let hasSof = false;
    let hasSos = false;
    let safeStop = false;
    // 段遍历上限:防恶意 buffer 死循环(buf.length 自然上限)
    while (off + 4 <= buf.length && !safeStop) {
      if (buf[off] !== 0xff) break; // 段结构损坏
      const marker = buf[off + 1];
      if (marker === 0xff) {
        // FF FF 填充,跳一字节继续
        off++;
        continue;
      }
      if (marker === 0x00) {
        // FF 00 是 stuffed byte(扫描数据内),不应出现在段头;段结构损坏
        break;
      }
      // standalone 段(无长度字段):SOI 已过,EOI=结束,RSTn/TEM 直接跳
      if (marker === 0xd9 /* EOI */) {
        safeStop = true;
        break;
      }
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 /* TEM */) {
        off += 2;
        continue;
      }
      // SOFn(FFC0-FFCF,排除 C4=DHT / C8=JPG / C12=DAC):尺寸定义段
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc /* DAC */
      ) {
        hasSof = true;
      }
      // SOS(FFDA):扫描数据起点
      if (marker === 0xda) {
        hasSos = true;
        // SOS 后跟熵编码扫描数据(直至下个 marker),遍历到此为止够用了
        safeStop = true;
        break;
      }
      // 读段长(BE 16)前先确保还有 4 字节
      const segLen = (buf[off + 2] << 8) | buf[off + 3];
      if (segLen < 2) break; // 段长非法(< 2 含自身长度字段)
      off += 2 + segLen;
    }
    // 末尾必须有 EOI(FFD9);SOS 内的扫描数据以 EOI 收尾
    const hasEoiAtEnd =
      buf.length >= 2 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
    if (!hasSof) {
      return { ok: false, reason: `JPEG 缺 SOFn 段(尺寸未定义,仅 ${buf.length}B);解码器会 SIGSEGV` };
    }
    if (!hasSos) {
      return { ok: false, reason: `JPEG 缺 SOS 段(无扫描数据,仅 ${buf.length}B);解码器会 SIGSEGV` };
    }
    if (!hasEoiAtEnd) {
      return { ok: false, reason: `JPEG 末尾无 EOI(FFD9)标记(长度 ${buf.length}B),疑似截断;解码器会 SIGSEGV` };
    }
    return { ok: true };
  }
  // WebP:RIFF header 0-3(RIFF), 4-7(chunk size LE), 8-11(WEBP)
  // 文件总长度应 ≥ 8 + RIFF 声明长度;截断时不满足。
  if (buf.length < 12) {
    return { ok: false, reason: `WebP 仅 ${buf.length}B(< 12),RIFF header 不完整;疑似截断` };
  }
  const riffLen = buf.readUInt32LE(4);
  if (buf.length < 8 + riffLen) {
    return {
      ok: false,
      reason: `WebP RIFF 声明 ${riffLen}B payload 但文件仅 ${buf.length}B(应 ≥ ${8 + riffLen}B);疑似截断,解码器会 SIGSEGV`,
    };
  }
  return { ok: true };
}

async function checkRaster(
  kind: "png" | "jpeg" | "webp",
  buf: Buffer,
  issues: CheckIssue[],
  checks: CheckResult[],
  metrics: OutputReport["metrics"],
): Promise<void> {
  // magic-bytes (fatal)
  const sigOk =
    (kind === "png" && buf.length >= 8 && buf.subarray(0, 8).equals(SIG_PNG)) ||
    (kind === "jpeg" && buf.length >= 3 && buf.subarray(0, 3).equals(SIG_JPEG_FF)) ||
    (kind === "webp" &&
      buf.length >= 12 &&
      buf.subarray(0, 4).equals(SIG_WEBP_RIFF) &&
      buf.subarray(8, 12).equals(SIG_WEBP_WEBP));
  if (!sigOk) {
    pushIssue(
      issues,
      checks,
      "fatal",
      `${kind}/magic-bytes`,
      `${kind} 文件签名不匹配(前 8 字节 ${buf.subarray(0, 8).toString("hex")}),可能是错误扩展名或损坏;请重新生成`,
      "magic_bytes",
    );
    // 不继续解码(magic 不对,decoder 必失败 → 误报)
    return;
  }
  pushOk(checks, "magic_bytes", `${kind}/magic-bytes`, ["签名匹配"]);

  // decodable (error / hard-fail)
  let width: number | undefined;
  let height: number | undefined;
  let decodable = false;
  let decodeReason = "";
  if (kind === "png" && PNG) {
    try {
      const parsed = PNG.sync.read(buf);
      width = parsed.width;
      height = parsed.height;
      decodable = true;
    } catch (e: any) {
      decodeReason = e?.message ?? String(e);
    }
  } else if (kind === "jpeg" || kind === "webp") {
    if (canvasLoadImage) {
      // SIGSEGV 防护:truncated JPEG/WebP 会让 @napi-rs/canvas.loadImage native crash,
      // Node try/catch 无法捕获 → 整个 server 进程被杀。先做最小完整性预校验。
      const pre = preValidateNativeRasterPayload(kind, buf);
      if (!pre.ok) {
        decodeReason = pre.reason;
      } else {
        try {
          // @napi-rs/canvas loadImage 同步签名是 Buffer → Promise<{width,height}>
          const img = await canvasLoadImage(buf);
          width = img.width;
          height = img.height;
          decodable = true;
        } catch (e: any) {
          decodeReason = e?.message ?? String(e);
        }
      }
    } else {
      // R5 兜底:无 @napi-rs/canvas → 降级 warning,不做像素解码
      pushIssue(
        issues,
        checks,
        "warning",
        `${kind}/no-decoder`,
        `未装 @napi-rs/canvas,${kind} 像素解码跳过(magic-bytes 已校验);若需深度校验请装该 optional dep`,
        "decodable",
      );
    }
  } else if (kind === "png" && !PNG) {
    pushIssue(
      issues,
      checks,
      "warning",
      "png/no-decoder",
      "未装 pngjs,PNG 像素解码跳过;devDependencies 应含 pngjs",
      "decodable",
    );
  }

  if (decodable && width !== undefined && height !== undefined) {
    metrics.width = width;
    metrics.height = height;
    pushOk(checks, "decodable", `${kind}/decodable`, [`${width}x${height}`]);
    // dimensions-sane (error):width*height ≤ 16M,防内存爆 / 损坏 IHDR
    const area = width * height;
    if (width > 0 && height > 0 && area <= 16_000_000) {
      pushOk(checks, "dimensions-sane", `${kind}/dimensions-sane`, [`area=${area}`]);
    } else {
      pushIssue(
        issues,
        checks,
        "error",
        `${kind}/dimensions-sane`,
        `${kind} 尺寸 ${width}x${height}(area=${area})异常:超出 16M 像素上限或非正;可能 IHDR 损坏,请重新生成`,
        "dimensions-sane",
      );
    }
    // non-blank (warning,仅 PNG;JPEG/WebP 像素格式依赖 canvas 解码后访问 RGBA)
    if (kind === "png") {
      checkPngNonBlank(buf, issues, checks, width, height);
    }
  } else if (kind === "png") {
    // PNG 解码失败但 magic bytes 对 → 截断 / IHDR 损坏 → hard-fail
    pushIssue(
      issues,
      checks,
      "error",
      "png/decodable",
      `PNG 解码失败(签名正确但数据截断或 IHDR 损坏):${decodeReason};请重新生成`,
      "decodable",
    );
  } else if ((kind === "jpeg" || kind === "webp") && decodeReason) {
    // JPEG/WebP 解码失败(magic bytes 对但数据截断,或 pre-validate 拒绝)→ hard-fail
    // 与 PNG 对称:之前该分支静默(只有 PNG 走 error push),现补齐避免 truncated JPEG 静默通过。
    pushIssue(
      issues,
      checks,
      "error",
      `${kind}/decodable`,
      `${kind} 解码失败(签名正确但数据截断或损坏):${decodeReason};请重新生成`,
      "decodable",
    );
  }
}

function checkPngNonBlank(
  buf: Buffer,
  issues: CheckIssue[],
  checks: CheckResult[],
  width: number,
  height: number,
): void {
  if (!PNG) return;
  try {
    const parsed = PNG.sync.read(buf);
    const { data } = parsed;
    if (!data || data.length === 0) {
      pushIssue(issues, checks, "warning", "png/non-blank", "PNG RGBA 缓冲区为空", "non-blank");
      return;
    }
    // 抽样:每 N 个像素扫一个,计算 RGB 方差 + alpha 全 0 检测
    const step = Math.max(4, Math.floor((width * height) / 4096) * 4);
    let sum = 0;
    let sumSq = 0;
    let samples = 0;
    let anyOpaque = false;
    for (let i = 0; i + 3 < data.length; i += step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      const lum = (r + g + b) / 3;
      sum += lum;
      sumSq += lum * lum;
      samples++;
      if (alpha > 0) anyOpaque = true;
    }
    if (samples === 0) {
      pushOk(checks, "non-blank", "png/non-blank", ["样本 0(skip)"]);
      return;
    }
    const mean = sum / samples;
    const variance = sumSq / samples - mean * mean;
    if (!anyOpaque) {
      pushIssue(
        issues,
        checks,
        "warning",
        "png/non-blank",
        `PNG 全透明(alpha 全 0),可能是空图;若确为透明占位可忽略`,
        "non-blank",
        { mean, variance, samples },
      );
    } else if (variance < 1) {
      pushIssue(
        issues,
        checks,
        "warning",
        "png/non-blank",
        `PNG 像素方差 < 1(单色填充),可能是空白图;若确为纯色背景可忽略`,
        "non-blank",
        { mean: Number(mean.toFixed(2)), variance: Number(variance.toFixed(2)), samples },
      );
    } else {
      pushOk(checks, "non-blank", "png/non-blank", [`variance=${variance.toFixed(2)}`, `samples=${samples}`]);
    }
  } catch {
    // 解码失败已在 decodable 记 issue,这里 noop
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG 检查
// ─────────────────────────────────────────────────────────────────────────────

function checkSvg(
  buf: Buffer,
  issues: CheckIssue[],
  checks: CheckResult[],
  metrics: OutputReport["metrics"],
): void {
  const text = buf.toString("utf8");
  if (!DOMParserCtor) {
    pushIssue(
      issues,
      checks,
      "warning",
      "svg/no-parser",
      "未装 @xmldom/xmldom,SVG 解析跳过;devDependencies 应含 @xmldom/xmldom",
      "parseable",
    );
    return;
  }
  // svg/parseable (fatal):DOMParser 不抛
  const errors: string[] = [];
  let doc: any;
  try {
    const parser = new DOMParserCtor({
      errorHandler: (level: string, msg: string) => {
        // warning level 是 DTD 缺失等非阻断信息;error/fatal 才是真问题
        if (level === "error" || level === "fatalError") errors.push(msg);
      },
    });
    doc = parser.parseFromString(text, "image/svg+xml");
  } catch (e: any) {
    pushIssue(
      issues,
      checks,
      "fatal",
      "svg/parseable",
      `SVG 解析抛错:${e?.message ?? String(e)};XML 不合法,请检查生成器输出`,
      "parseable",
    );
    return;
  }
  if (errors.length > 0) {
    pushIssue(
      issues,
      checks,
      "fatal",
      "svg/parseable",
      `SVG 解析报 ${errors.length} 个 fatal error:${errors.slice(0, 2).join("; ")};XML 不合法`,
      "parseable",
      { errors: errors.slice(0, 5) },
    );
    return;
  }
  pushOk(checks, "parseable", "svg/parseable", ["DOMParser 无错"]);

  // svg/has-root (fatal):根元素 tagName === "svg"
  const root = doc?.documentElement;
  const rootTag = (root?.tagName ?? "").toLowerCase();
  if (rootTag !== "svg") {
    pushIssue(
      issues,
      checks,
      "fatal",
      "svg/has-root",
      `SVG 根元素应为 <svg>,实际为 <${rootTag || "(空)"}>;可能是 HTML 错误页`,
      "has-root",
    );
    return;
  }
  pushOk(checks, "has-root", "svg/has-root", [`<${rootTag}>`]);

  // 递归扫树
  const acc = { drawNodes: 0, nanAttrs: [] as string[] };
  inspectSvgDom(root, acc);
  metrics.svgDrawNodes = acc.drawNodes;

  // svg/no-nan-attrs (error):无 NaN/Infinity/-Infinity/undefined 字面量
  if (acc.nanAttrs.length > 0) {
    pushIssue(
      issues,
      checks,
      "error",
      "svg/no-nan-attrs",
      `SVG 含 ${acc.nanAttrs.length} 处 NaN/Infinity/undefined 字面量属性(前 3:${acc.nanAttrs.slice(0, 3).join(", ")});通常是渲染器除零或数值未初始化,请修渲染器`,
      "no-nan-attrs",
      { hits: acc.nanAttrs.slice(0, 10) },
    );
  } else {
    pushOk(checks, "no-nan-attrs", "svg/no-nan-attrs", ["0 hits"]);
  }

  // svg/viewbox-nonzero (error):viewBox 宽高 > 0 或 width/height > 0
  const vb = root.getAttribute?.("viewBox");
  let vbOk = false;
  let vbInfo = "";
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      vbOk = parts[2] > 0 && parts[3] > 0;
      vbInfo = `viewBox=${vb}(${parts[2]}x${parts[3]})`;
    } else {
      vbInfo = `viewBox=${vb}(非数字)`;
    }
  }
  if (!vbOk) {
    // 退化用 width/height attr
    const w = parseFloat(root.getAttribute?.("width") ?? "");
    const h = parseFloat(root.getAttribute?.("height") ?? "");
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      vbOk = true;
      vbInfo = `width=${w} height=${h}`;
    } else if (!vb) {
      vbInfo = "无 viewBox 也无 width/height";
    }
  }
  if (vbOk) {
    pushOk(checks, "viewbox-nonzero", "svg/viewbox-nonzero", [vbInfo]);
  } else {
    pushIssue(
      issues,
      checks,
      "error",
      "svg/viewbox-nonzero",
      `SVG 尺寸为 0 或缺失(${vbInfo});产物无法显示,请修渲染器`,
      "viewbox-nonzero",
    );
  }

  // svg/has-content (error):绘制节点数 > 0
  if (acc.drawNodes > 0) {
    pushOk(checks, "has-content", "svg/has-content", [`${acc.drawNodes} draw nodes`]);
  } else {
    pushIssue(
      issues,
      checks,
      "error",
      "svg/has-content",
      `SVG 无任何绘制节点(<path>/<use>/<rect>/<circle>/<line>/<polygon>/<text> 等),产物是空 svg 标签;通常是渲染器输出空内容`,
      "has-content",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 容器(MP4/GIF/WEBM)检查
// ─────────────────────────────────────────────────────────────────────────────

function checkContainer(
  file: string,
  kind: "mp4" | "gif" | "webm",
  issues: CheckIssue[],
  checks: CheckResult[],
  metrics: OutputReport["metrics"],
): void {
  const probe = probeContainer(file);
  // container-decodable (fatal):ffmpeg 能读 stream 信息
  if (!probe.ok || !probe.decodable) {
    if (probe.checkerUnavailable) {
      // 探活器不可用(ffmpeg 二进制缺失)→ 降级 warning,绝不阻断产物。产物本身可能完全合法
      // (本机仅缺 ffmpeg 无法自动校验);用 magic-bytes(ftyp)+ 文件大小 + 手动/视觉 QC 兜底。
      // 这是 probeContainer !ffmpegPath 兜底的原意,修正 require 返回空路径字符串的漏判。
      pushIssue(
        issues,
        checks,
        "warning",
        "mp4/checker-unavailable",
        `ffmpeg 二进制不可用,容器合法性自动校验跳过:${probe.errorMessage ?? ""};产物已落盘,请用播放器/视觉确认可播放`,
        "container-decodable",
      );
      metrics.mp4HasVideoTrack = probe.hasVideoTrack;
      return;
    }
    if (probe.timedOut) {
      // timeout 是 warning(R8):不阻断,可能大文件
      pushIssue(
        issues,
        checks,
        "warning",
        "mp4/timeout",
        `ffmpeg 探活 5s 超时(可能是大文件,容器合法性无法判定):${probe.errorMessage ?? ""}`,
        "container-decodable",
      );
    } else {
      pushIssue(
        issues,
        checks,
        "fatal",
        `${kind}/container-decodable`,
        `ffmpeg 拒绝输入或 moov atom 缺失:${probe.errorMessage ?? "容器损坏"},产物不可播放;请重新生成`,
        "container-decodable",
      );
    }
    metrics.mp4HasVideoTrack = probe.hasVideoTrack; // 防御:early return 前也设 metrics(免 undefined;probe.ok=false 时为 false 便于诊断)
    return;
  }
  pushOk(checks, "container-decodable", `${kind}/container-decodable`, [
    `ffmpeg 可解${probe.durationMs !== undefined ? `,duration=${probe.durationMs}ms` : ""}`,
  ]);

  if (probe.durationMs !== undefined) metrics.mp4DurationMs = probe.durationMs;
  metrics.mp4HasVideoTrack = probe.hasVideoTrack;

  // tracks-present (warning):ffmpeg stderr 含 Video: 或 Duration: 00:
  if (probe.hasVideoTrack) {
    pushOk(checks, "tracks-present", "mp4/tracks-present", ["Video: track found"]);
  } else {
    pushIssue(
      issues,
      checks,
      "warning",
      "mp4/tracks-present",
      "ffmpeg 未识别到视频轨(可能仅音频或容器结构特殊),产物可能不可正常播放",
      "tracks-present",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具专属检查
// ─────────────────────────────────────────────────────────────────────────────

function runQrcodeSpecifics(
  buf: Buffer,
  kind: Kind,
  opts: CheckOptions,
  issues: CheckIssue[],
  checks: CheckResult[],
  _metrics: OutputReport["metrics"],
): void {
  const originalInput = opts.originalInput as { text?: string } | undefined;
  const expectedText = originalInput?.text;
  if (kind === "png") {
    // qrcode/decode-roundtrip:jsQR 解码回原文
    if (!jsQR || !PNG) {
      pushIssue(
        issues,
        checks,
        "warning",
        "qrcode/no-decoder",
        "未装 jsqr 或 pngjs,QR roundtrip 校验跳过",
        "decode_roundtrip",
      );
      return;
    }
    try {
      const parsed = PNG.sync.read(buf);
      const decoded = jsQR(new Uint8ClampedArray(parsed.data), parsed.width, parsed.height);
      if (!decoded) {
        // R9:jsqr 解码失败可能是阈值问题,warning 不 error
        pushIssue(
          issues,
          checks,
          "warning",
          "qrcode/decode-roundtrip",
          "jsQR 解码失败(可能是低对比度/小尺寸阈值问题,肉眼扫码确认即可)",
          "decode_roundtrip",
        );
        return;
      }
      if (expectedText !== undefined && decoded.data !== expectedText) {
        pushIssue(
          issues,
          checks,
          "error",
          "qrcode/decode-roundtrip",
          `QR 解码 ≠ 原文:得 ${JSON.stringify(decoded.data.slice(0, 60))} 期 ${JSON.stringify(expectedText.slice(0, 60))};QR 编码异常`,
          "decode_roundtrip",
        );
      } else {
        pushOk(checks, "decode_roundtrip", "qrcode/decode-roundtrip", [
          `decoded=${decoded.data.length}B`,
          expectedText !== undefined ? "matches originalInput" : "no originalInput to compare",
        ]);
      }
    } catch (e: any) {
      pushIssue(
        issues,
        checks,
        "warning",
        "qrcode/decode-roundtrip",
        `QR roundtrip 内部异常:${e?.message ?? String(e)}`,
        "decode_roundtrip",
      );
    }
  } else if (kind === "svg") {
    // qrcode/svg-has-modules:<path> > 0 且根 svg 含 viewBox
    const text = buf.toString("utf8");
    const pathCount = (text.match(/<path[\s>]/g) || []).length;
    const hasVb = /<svg[^>]*\sviewBox\s*=/.test(text);
    if (pathCount > 0 && hasVb) {
      pushOk(checks, "svg-has-modules", "qrcode/svg-has-modules", [`${pathCount} paths`, "viewBox present"]);
    } else {
      pushIssue(
        issues,
        checks,
        "error",
        "qrcode/svg-has-modules",
        `QR SVG 应含多个 <path> 模块和 viewBox,实际 paths=${pathCount} viewBox=${hasVb};QR SVG 渲染异常`,
        "svg-has-modules",
      );
    }
  }
}

function runFormulaSpecifics(
  buf: Buffer,
  kind: Kind,
  issues: CheckIssue[],
  checks: CheckResult[],
): void {
  if (kind !== "svg") return;
  // R12:formula/has-glyphs:<path> 或 <use> > 0(MathJax SVG 用 <use> 引用 <path> defs)
  const text = buf.toString("utf8");
  const pathCount = (text.match(/<path[\s>]/g) || []).length;
  const useCount = (text.match(/<use[\s>]/g) || []).length;
  if (pathCount + useCount > 0) {
    pushOk(checks, "has-glyphs", "formula/has-glyphs", [`path=${pathCount}`, `use=${useCount}`]);
  } else {
    pushIssue(
      issues,
      checks,
      "error",
      "formula/has-glyphs",
      `公式 SVG 应含 <path> 或 <use> 字形,实际 path=${pathCount} use=${useCount};可能是 MathJax 字体未加载`,
      "has-glyphs",
    );
  }
}

function runRenderSvgSpecifics(
  buf: Buffer,
  kind: Kind,
  opts: CheckOptions,
  issues: CheckIssue[],
  checks: CheckResult[],
  _metrics: OutputReport["metrics"],
): void {
  // render-svg/chrome-pixel-variance:backend=chrome 时,RGB 方差 > 阈值(防 Chrome 抓空白页)
  const backend = (opts.originalInput as { backend?: string } | undefined)?.backend;
  if (backend !== "chrome" || kind !== "png") return;
  if (!PNG) {
    pushIssue(
      issues,
      checks,
      "warning",
      "render-svg/no-decoder",
      "未装 pngjs,chrome-pixel-variance 校验跳过",
      "chrome-pixel-variance",
    );
    return;
  }
  try {
    const parsed = PNG.sync.read(buf);
    const { data } = parsed;
    if (!data || data.length === 0) return;
    const step = Math.max(4, Math.floor((parsed.width * parsed.height) / 4096) * 4);
    let sum = 0;
    let sumSq = 0;
    let samples = 0;
    for (let i = 0; i + 3 < data.length; i += step) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += lum;
      sumSq += lum * lum;
      samples++;
    }
    if (samples === 0) return;
    const mean = sum / samples;
    const variance = sumSq / samples - mean * mean;
    // 阈值:Chrome 抓空白页(全白/全透明)方差 < 1;正常 SVG 栅格化 > 5
    if (variance < 1) {
      pushIssue(
        issues,
        checks,
        "warning",
        "render-svg/chrome-pixel-variance",
        `Chrome 后端 PNG 像素方差 ${variance.toFixed(2)} 过低(阈值 1),可能抓到空白页;检查 SVG 是否依赖远程字体或动画`,
        "chrome-pixel-variance",
        { variance: Number(variance.toFixed(2)), backend: "chrome" },
      );
    } else {
      pushOk(checks, "chrome-pixel-variance", "render-svg/chrome-pixel-variance", [`variance=${variance.toFixed(2)}`]);
    }
  } catch {
    // noop,已 decodable 记 issue
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 装配 report + assertOutputClean 入口
// ─────────────────────────────────────────────────────────────────────────────

function finalize(
  file: string,
  kind: Kind,
  profile: Profile,
  checks: CheckResult[],
  issues: CheckIssue[],
  metrics: OutputReport["metrics"],
): OutputReport {
  const fatals = issues.filter((i) => i.severity === "fatal").length;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  // status=fail 当且仅当 fatals>0 或 (strict profile 下 errors>0)
  const fail = fatals > 0 || (profile === "strict" && errors > 0);
  return {
    schemaVersion: 1,
    profile,
    status: fail ? "fail" : "pass",
    ok: !fail,
    file,
    kind,
    checks,
    summary: { fatals, errors, warnings },
    metrics,
    issues,
  };
}

/**
 * handler 钩子入口:基于 report 决定 throw 还是返 warnings。
 * - fatals > 0 → fatal throw(任何 profile)
 * - errors > 0 + strict → fatal throw
 * - 其它 → warnings[](标准档 error 也降为 warning)
 *
 * 返回 {fatal} 时 handler 调 err(fatal.message) → isError:true
 * 返回 {warnings} 时 handler 合并到响应 warnings[]
 */
export async function assertOutputClean(filePath: string, opts: AssertOptions): Promise<AssertResult> {
  const report = await checkOutput(filePath, opts);
  const fatals = report.issues.filter((i) => i.severity === "fatal");
  if (fatals.length > 0) {
    return {
      fatal: new Error(fatals.map((i) => `[${i.code}] ${i.message}`).join("; ")),
      quality: report,
    };
  }
  const hardFails = report.issues.filter((i) => i.severity === "error");
  if (hardFails.length > 0 && report.profile === "strict") {
    return {
      fatal: new Error(hardFails.map((i) => `[${i.code}] ${i.message}`).join("; ")),
      quality: report,
    };
  }
  const warnings = report.issues
    .filter((i) => i.severity === "warning" || (i.severity === "error" && report.profile === "standard"))
    .map((i) => `[${i.code}] ${i.message}`);
  return { warnings, quality: report };
}
