#!/usr/bin/env node
/**
 * render-watchdog —— render 管线 Chrome 孤儿看门狗(P0 根因报告 §8.3 兜底,2026-09-01)。
 *
 * 背景:render 管线(render-svg.ts / export-png.ts / render-video.ts)曾每次渲染 launch
 * 新无头 Chrome,spawner 被 SIGKILL 时空闲定时器随宿主消亡 → Chrome reparent 到
 * launchd(PPID=1)成真孤儿;两天 83 发孤儿舰队曾致整机 Load 680 冻结
 * (doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md)。
 * 上游已由 src/browser-pool.ts(进程级单例 + exit 钩子)根治;本脚本是 SIGKILL
 * 无解时的外部最后一道防线(报告 §8.3)。
 *
 * 孤儿判定(三重与,零误伤):
 *   ① 指纹(Chrome 族二进制 + 以下之一):puppeteer_dev_chrome_profile 前缀
 *      (legacy puppeteer 默认临时 profile,真身 Chrome 物理上不含,§9 已验证)、
 *      media-gen-mcp-render 前缀(browser-pool P0 根治后的固定可识别 profile)、
 *      或 DETERMINISTIC_FLAGS 特征对(--run-all-compositor-stages-before-draw
 *      + --force-color-profile=srgb);
 *   ② spawner 已死:PPID=1(reparent 到 launchd)或 PPID 不在进程表;
 *      在跑渲染的 Chrome 必有活 spawner → 永不误伤(哪怕马拉松 render_video 超 10 分钟);
 *   ③ 存活 ≥ 600s(默认,--min-age-sec 可调)。
 *
 * 用法:
 *   node scripts/render-watchdog.mjs            # dry-run(默认):只侦察报告,不动任何进程
 *   node scripts/render-watchdog.mjs --clean    # 执行清理:SIGTERM 孤儿 → 2s 后 SIGKILL 幸存者
 *   node scripts/render-watchdog.mjs --json     # 机器可读输出(MCP/脚本消费)
 *
 * 退出码:0 = 正常;2 = 告警(Chrome 主进程 > 10 或 swap used > 4GB,阈值可调);
 *        1 = 运行错误(ps 不可用等)。
 * 定时:LaunchAgent 模板见 doc/渲染看门狗-LaunchAgent安装指引.md(不自动安装,用户手动装)。
 *
 * 零依赖(Node ≥18),构建产物缺失也能跑(急救场景优先可用)。
 * 纯函数(parseEtime/parsePsOutput/classifyProcesses/pickStaleProfileDirs)导出供
 * test/render-watchdog.test.mjs fixture 单测。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── 指纹常量(与 src/render-selfcheck.ts 保持同步;test 机械校验双源一致)──
// 双前缀:legacy puppeteer 默认临时 profile + browser-pool 固定前缀(2026-09-01 P0 根治后)。
export const PROFILE_DIR_TOKENS = ["puppeteer_dev_chrome_profile", "media-gen-mcp-render"];
export const FINGERPRINT_FLAG_STRONG = "--run-all-compositor-stages-before-draw";
export const FINGERPRINT_FLAG_PAIR = "--force-color-profile=srgb";

// ── 默认阈值 ──
export const DEFAULT_ORPHAN_AGE_SEC = 600; // 孤儿最小存活(报告 §8.3:10 分钟)
export const DEFAULT_DIR_AGE_MIN = 60; // profile 目录陈年判定(mtime 年龄)
export const DEFAULT_ALERT_CHROME_MAIN = 10; // Chrome 主进程数告警线
export const DEFAULT_ALERT_SWAP_GB = 4; // swap used 告警线(GB)

const PS_COLUMNS = "pid=,ppid=,etime=,command=";

// ─────────────────────────── 纯函数:解析 ───────────────────────────

/** ps etime 字段 → 秒。格式:MM:SS | HH:MM:SS | DD-HH:MM:SS。无法解析返回 null。 */
export function parseEtime(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  const parts = s.trim().split("-"); // ["2-03:04:05"] → ["2", "03:04:05"]
  const days = parts.length === 2 ? Number(parts[0]) : 0;
  if (parts.length > 2 || Number.isNaN(days)) return null;
  const hms = (parts.length === 2 ? parts[1] : parts[0]).split(":").map(Number);
  if (hms.some((n) => Number.isNaN(n)) || hms.length < 2 || hms.length > 3) return null;
  const [h, m, sec] = hms.length === 3 ? hms : [0, hms[0], hms[1]];
  return days * 86400 + h * 3600 + m * 60 + sec;
}

/** 单行 ps 输出 → {pid, ppid, etimeSec, command} | null(列布局:pid ppid etime command...)。 */
export function parsePsLine(line) {
  const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/);
  if (!m) return null;
  const etimeSec = parseEtime(m[3]);
  return {
    pid: Number(m[1]),
    ppid: Number(m[2]),
    etimeSec: etimeSec === null ? null : etimeSec,
    command: m[4].trim(),
  };
}

/** 整份 `ps -Axo pid=,ppid=,etime=,command=` 输出 → 进程行数组(坏行静默跳过)。 */
export function parsePsOutput(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const row = parsePsLine(line);
    if (row) out.push(row);
  }
  return out;
}

/** 命令行是否 Chrome 族二进制(防 `node -e`/grep 等恰含指纹串的非浏览器进程误伤)。 */
export function isChromeFamilyBinary(cmd) {
  return /(Google Chrome|chrome-headless-shell|chrome_crashpad|google-chrome|chromium|chrome\.exe|msedge|microsoft-edge)/i.test(
    cmd,
  );
}

/** 命令行是否 render 管线指纹(Chrome 族二进制 + 临时 profile 前缀 或 DETERMINISTIC_FLAGS 特征对)。 */
export function isRenderChrome(cmd) {
  if (!isChromeFamilyBinary(cmd)) return false;
  return (
    PROFILE_DIR_TOKENS.some((t) => cmd.includes(t)) ||
    (cmd.includes(FINGERPRINT_FLAG_STRONG) && cmd.includes(FINGERPRINT_FLAG_PAIR))
  );
}

/** Chrome 族子进程(Helper/renderer/gpu/utility/crashpad —— 非主进程)。 */
export function isHelperCmd(cmd) {
  return cmd.includes("--type=") || cmd.includes("crashpad");
}

/** 系统 Chrome/Edge 主进程(用于"Chrome 主进程 > N"告警;含真身,只计数不清理)。 */
export function isChromeMainCmd(cmd) {
  return (
    /(MacOS\/Google Chrome|chrome\.exe|google-chrome|chromium|chrome-headless-shell|MacOS\/Microsoft Edge|msedge\.exe|microsoft-edge)/i.test(
      cmd,
    ) && !isHelperCmd(cmd)
  );
}

/**
 * 进程表分类。
 * orphan 判定 = 指纹 + 非子进程 + (PPID=1 或 PPID 不在进程表) + 存活 ≥ minAgeSec。
 * 在跑渲染(活 spawner)永不入 orphan 集 —— 马拉松 render_video 不误伤。
 */
export function classifyProcesses(rows, { minAgeSec = DEFAULT_ORPHAN_AGE_SEC } = {}) {
  const allPids = new Set(rows.map((r) => r.pid));
  // 自身排除:看门狗/调用方进程(理论上不含指纹,双保险)
  const rows_ = rows.filter((r) => r.pid !== process.pid);
  const renderFamily = rows_.filter((r) => isRenderChrome(r.command));
  const renderMains = renderFamily.filter((r) => !isHelperCmd(r.command));
  const renderHelpers = renderFamily.filter((r) => isHelperCmd(r.command));
  const spawnerDead = (r) => r.ppid === 1 || !allPids.has(r.ppid);
  const oldEnough = (r) => r.etimeSec !== null && r.etimeSec >= minAgeSec;
  const orphanMains = renderMains.filter((r) => spawnerDead(r) && oldEnough(r));
  // spawner 已死但未到清理线(年轻孤儿):只侦察不清理,下轮看门狗再收
  const youngOrphanMains = renderMains.filter((r) => spawnerDead(r) && !oldEnough(r));
  const orphanMainPids = new Set(orphanMains.map((r) => r.pid));
  // 孤儿主进程的直属子进程(Helper/crashpad):随主进程一起清
  const orphanHelpers = renderHelpers.filter((r) => orphanMainPids.has(r.ppid));
  const chromeMainTotal = rows_.filter((r) => isChromeMainCmd(r.command)).length;
  return {
    allPids,
    renderFamily,
    renderMains,
    renderHelpers,
    orphanMains,
    youngOrphanMains,
    orphanHelpers,
    chromeMainTotal,
  };
}

/** macOS `sysctl -n vm.swapusage` → used 字节数;无法解析返回 null。 */
export function parseSwapUsageMac(text) {
  const m = String(text).match(/used\s*=\s*([\d.]+)\s*([KMGT]?)/i);
  if (!m) return null;
  const mult = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2].toUpperCase()] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/** Linux /proc/meminfo → used 字节数;无法解析返回 null。 */
export function parseSwapMeminfo(text) {
  const total = String(text).match(/^SwapTotal:\s+(\d+)\s*kB/m);
  const free = String(text).match(/^SwapFree:\s+(\d+)\s*kB/m);
  if (!total) return null;
  return (Number(total[1]) - (free ? Number(free[1]) : 0)) * 1024;
}

/**
 * 陈年 profile 目录挑选(纯分类)。
 * stale = mtime 年龄 ≥ dirAgeMs 且 目录名未被任何活进程命令行引用(在用目录绝不删)。
 */
export function pickStaleProfileDirs(dirInfos, psText, { now = Date.now(), dirAgeMs = DEFAULT_DIR_AGE_MIN * 60_000 } = {}) {
  const stale = [];
  for (const d of dirInfos) {
    if (now - d.mtimeMs < dirAgeMs) continue;
    if (psText && psText.includes(d.name)) continue; // 活进程仍引用 → 不是陈年
    stale.push(d);
  }
  return stale;
}

// ─────────────────────────── 命令行 ───────────────────────────

function parseArgs(argv) {
  const opts = {
    clean: false,
    json: false,
    minAgeSec: DEFAULT_ORPHAN_AGE_SEC,
    dirAgeMin: DEFAULT_DIR_AGE_MIN,
    alertChromeMain: DEFAULT_ALERT_CHROME_MAIN,
    alertSwapGB: DEFAULT_ALERT_SWAP_GB,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clean") opts.clean = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--min-age-sec") opts.minAgeSec = numArg(argv, ++i, a, opts, 1);
    else if (a === "--dir-age-min") opts.dirAgeMin = numArg(argv, ++i, a, opts, 1);
    else if (a === "--alert-chrome-main") opts.alertChromeMain = numArg(argv, ++i, a, opts, 0);
    else if (a === "--alert-swap-gb") opts.alertSwapGB = numArg(argv, ++i, a, opts, 0);
    else opts.error = `未知参数:${a}(--help 查看用法)`;
  }
  return opts;
}
/** 数值参数解析:min = 合法下限(告警阈值允许 0 = 恒触发;年龄类须 >0)。 */
function numArg(argv, i, flag, opts, min) {
  const v = Number(argv[i]);
  if (!(v >= min) || !Number.isFinite(v)) opts.error = `${flag} 需要 ≥${min} 的数值(得到:${argv[i] ?? "缺失"})`;
  return v;
}

// ─────────────────────────── 采集(非纯) ───────────────────────────

function psAxo() {
  return new Promise((resolve, reject) => {
    execFile("ps", ["-Axo", PS_COLUMNS], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ps 失败:${err.message}${stderr ? ` (${String(stderr).trim()})` : ""}`));
      else resolve(String(stdout));
    });
  });
}

async function swapUsedBytes() {
  if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile("sysctl", ["-n", "vm.swapusage"], { timeout: 10_000 }, (err, stdout) => {
        resolve(err ? null : parseSwapUsageMac(stdout));
      });
    });
  }
  if (process.platform === "linux") {
    try {
      return parseSwapMeminfo(fs.readFileSync("/proc/meminfo", "utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

/** 枚举 $TMPDIR 下 render 管线临时 profile 目录(双前缀,带 mtime + 限定容量的体积估算)。 */
async function listProfileDirs(tmpdir) {
  let names;
  try {
    names = (await fs.promises.readdir(tmpdir)).filter((n) =>
      PROFILE_DIR_TOKENS.some((t) => n.startsWith(t + "-")),
    );
  } catch {
    return [];
  }
  const infos = [];
  for (const name of names) {
    const full = path.join(tmpdir, name);
    try {
      const st = await fs.promises.stat(full);
      if (st.isDirectory()) infos.push({ name, full, mtimeMs: st.mtimeMs, sizeBytes: 0 });
    } catch { /* 竞态消失 → 跳过 */ }
  }
  // 体积估算(容量封顶防巨目录拖死;失败即 0)
  let budget = 20_000; // 最多 stat 2 万个条目
  for (const info of infos) {
    info.sizeBytes = await dirSize(info.full, 4, (n) => (budget -= n) > 0);
  }
  return infos;
}
async function dirSize(dir, depth, hasBudget) {
  if (depth < 0 || !hasBudget(1)) return 0;
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full, depth - 1, hasBudget);
    else {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch { /* 跳过 */ }
    }
  }
  return total;
}

// ─────────────────────────── 清理动作 ───────────────────────────

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // 权限拒绝 = 活着但不归我们 → 视为幸存
  }
};

async function cleanOrphans(victims) {
  const sigterm = [];
  const sigkill = [];
  for (const v of victims) {
    try {
      process.kill(v.pid, "SIGTERM");
      sigterm.push(v.pid);
    } catch { /* 已死/无权限 → 记入幸存者由复核兜底 */ }
  }
  if (sigterm.length) await new Promise((r) => setTimeout(r, 2000)); // Chrome 优雅退出窗口
  for (const pid of sigterm) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        sigkill.push(pid);
      } catch { /* 忽略 */ }
    }
  }
  return { sigterm, sigkill };
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`[render-watchdog] 参数错误:${opts.error}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const report = {
    ok: true,
    mode: opts.clean ? "clean" : "dry-run",
    scannedAt: new Date().toISOString(),
    orphans: { main: 0, young: 0, helper: 0, cleanablePids: [], killedSigterm: [], killedSigkill: [], survivors: [] },
    fleet: { chromeMainTotal: 0, renderFamilyTotal: 0, renderMainTotal: 0, renderHelperTotal: 0 },
    swap: { usedBytes: null, usedGB: null },
    profileDirs: { total: 0, stale: [], bytesReclaimable: 0, removed: [], bytesReclaimed: 0 },
    alerts: [],
    exitCode: 0,
  };

  // 1. 侦察
  let psText;
  try {
    psText = await psAxo();
  } catch (e) {
    report.ok = false;
    console.error(`[render-watchdog] ${e.message}`);
    process.exit(1);
  }
  const rows = parsePsOutput(psText);
  const cls = classifyProcesses(rows, { minAgeSec: opts.minAgeSec });
  report.fleet = {
    chromeMainTotal: cls.chromeMainTotal,
    renderFamilyTotal: cls.renderFamily.length,
    renderMainTotal: cls.renderMains.length,
    renderHelperTotal: cls.renderHelpers.length,
  };
  report.orphans.main = cls.orphanMains.length;
  report.orphans.young = cls.youngOrphanMains.length;
  report.orphans.helper = cls.orphanHelpers.length;
  report.orphans.cleanablePids = cls.orphanMains.map((r) => r.pid);

  const swapBytes = await swapUsedBytes();
  report.swap = { usedBytes: swapBytes, usedGB: swapBytes === null ? null : round1(swapBytes / 1024 ** 3) };

  const dirs = await listProfileDirs(os.tmpdir());
  const stale = pickStaleProfileDirs(dirs, psText, { dirAgeMs: opts.dirAgeMin * 60_000 });
  report.profileDirs.total = dirs.length;
  report.profileDirs.stale = stale.map((d) => d.name);
  report.profileDirs.bytesReclaimable = stale.reduce((s, d) => s + d.sizeBytes, 0);

  // 2. 告警判定(清理前状态;清理动作后 fleet 已塌缩,但 swap 恢复有滞后,按发现时口径告警)
  if (cls.chromeMainTotal > opts.alertChromeMain) {
    report.alerts.push(`Chrome 主进程 ${cls.chromeMainTotal} 个 > ${opts.alertChromeMain}(疑似舰队再聚集)`);
  }
  if (swapBytes !== null && swapBytes > opts.alertSwapGB * 1024 ** 3) {
    report.alerts.push(`swap used ${report.swap.usedGB}GB > ${opts.alertSwapGB}GB(内存压力)`);
  }
  if (report.orphans.main > 0) {
    report.alerts.push(`render 孤儿主进程 ${report.orphans.main} 个存活超 ${Math.round(opts.minAgeSec / 60)} 分钟`);
  }

  // 3. 清理(仅 --clean)
  if (opts.clean && (cls.orphanMains.length || cls.orphanHelpers.length)) {
    const victims = [...cls.orphanMains, ...cls.orphanHelpers];
    const { sigterm, sigkill } = await cleanOrphans(victims);
    report.orphans.killedSigterm = sigterm;
    report.orphans.killedSigkill = sigkill;
    report.orphans.survivors = sigterm.filter((pid) => isAlive(pid) && !sigkill.includes(pid));
    // 复核:重扫一次确认(诚实验证,同止血后 Load 复核纪律)
    let after = 0;
    try {
      after = classifyProcesses(parsePsOutput(await psAxo()), { minAgeSec: opts.minAgeSec }).orphanMains.length;
    } catch { /* 复核失败不影响退出码 */ }
    if (after > 0) report.alerts.push(`清理后复核仍有 ${after} 个孤儿(下轮再清或人工排查)`);
  }
  if (opts.clean && stale.length) {
    let bytes = 0;
    for (const d of stale) {
      try {
        await fs.promises.rm(d.full, { recursive: true, force: true });
        report.profileDirs.removed.push(d.name);
        bytes += d.sizeBytes;
      } catch { /* 跳过 */ }
    }
    report.profileDirs.bytesReclaimed = bytes;
  }

  report.exitCode = report.alerts.length > 0 ? 2 : 0;

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report, opts);
  }
  process.exit(report.exitCode);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function printTextReport(r, opts) {
  const mb = (b) => (b >= 1024 ** 3 ? `${round1(b / 1024 ** 3)}GB` : `${Math.round(b / 1024 / 1024)}MB`);
  console.log(`[render-watchdog] ${r.mode} @ ${r.scannedAt}`);
  console.log(
    `  render 族进程:${r.fleet.renderMainTotal} 主 / ${r.fleet.renderHelperTotal} Helper` +
      `| 孤儿判定=指纹+spawner已死+存活≥${Math.round(opts.minAgeSec / 60)}min`,
  );
  console.log(
    `  可清理孤儿:${r.orphans.main} 主 + ${r.orphans.helper} Helper` +
      (r.orphans.cleanablePids.length ? ` (pid: ${r.orphans.cleanablePids.join(", ")})` : "") +
      (r.orphans.young ? ` | 另有 ${r.orphans.young} 个年轻孤儿(spawner 已死但未到清理线,下轮再收)` : ""),
  );
  console.log(`  Chrome 主进程总数:${r.fleet.chromeMainTotal} | swap used:${r.swap.usedGB ?? "?"}GB`);
  console.log(
    `  profile 目录:共 ${r.profileDirs.total} 个,陈年 ${r.profileDirs.stale.length} 个` +
      (r.profileDirs.stale.length ? ` (~${mb(r.profileDirs.bytesReclaimable)} 可回收)` : ""),
  );
  if (r.orphans.killedSigterm.length) {
    console.log(
      `  [clean] SIGTERM ${r.orphans.killedSigterm.length} 个,SIGKILL 升级 ${r.orphans.killedSigkill.length} 个,幸存 ${r.orphans.survivors.length} 个`,
    );
  }
  if (r.profileDirs.removed.length) {
    console.log(`  [clean] 删除陈年目录 ${r.profileDirs.removed.length} 个,回收 ~${mb(r.profileDirs.bytesReclaimed)}`);
  }
  if (r.alerts.length) {
    console.log(`  🔴 告警(exit 2):`);
    for (const a of r.alerts) console.log(`    - ${a}`);
  } else {
    console.log(`  ✅ 无告警(exit 0)`);
  }
  if (!opts.clean) console.log(`  (dry-run:只报告未清理;执行清理加 --clean)`);
}

const USAGE = `render-watchdog —— render 管线 Chrome 孤儿看门狗(P0 §8.3 兜底)

用法:node scripts/render-watchdog.mjs [选项]

选项:
  (无)            dry-run:只侦察报告,不动任何进程(默认)
  --clean          执行清理:SIGTERM 孤儿(指纹+spawner已死+存活≥min-age)→ 2s 后 SIGKILL 幸存者
                    + 删陈年 profile 目录(mtime≥dir-age-min 且无活进程引用)
  --json           机器可读 JSON 输出
  --min-age-sec N  孤儿最小存活秒数(默认 600 = 10 分钟)
  --dir-age-min N  profile 目录陈年线(默认 60 分钟)
  --alert-chrome-main N  Chrome 主进程数告警线(默认 10)
  --alert-swap-gb N      swap used 告警线 GB(默认 4)
  --help           本帮助

退出码:0 正常 | 2 告警(chrome 主进程超线 / swap 超线 / 存在孤儿) | 1 运行错误

零误伤保证:真身 Chrome 命令行不含指纹串(puppeteer_dev_chrome_profile / media-gen-mcp-render
临时 profile 前缀 / DETERMINISTIC_FLAGS 特征对;lasso/flow 的 CDP attach Chrome 也不含);
非 Chrome 二进制(node -e/grep 恰含指纹串)与活 spawner 的在跑渲染(PPID≠1)一律不命中。
定时调度:doc/渲染看门狗-LaunchAgent安装指引.md(用户手动安装)。`;

// 直接执行入口(test import 时不触发 main)
const invokedAsMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsMain) {
  main().catch((e) => {
    console.error(`[render-watchdog] 运行错误:${e?.message ?? e}`);
    process.exit(1);
  });
}
