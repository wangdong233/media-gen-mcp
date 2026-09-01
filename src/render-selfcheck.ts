/**
 * P0 §8.3 看门狗自愈 —— render 管线 Chrome 孤儿 self-check(2026-09-01)。
 *
 * 根因:render 管线 launch 的无头 Chrome 在 spawner 被 SIGKILL 时空闲定时器随宿主消亡,
 * Chrome reparent 到 launchd(PPID=1)成真孤儿,两天 83 发曾致整机 Load 680 冻结
 * (doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md)。
 *
 * 本模块 = 渲染调用侧的轻量自省:Chrome 渲染路径前后查一次孤儿计数,超阈值把告警
 * 上浮进渲染结果 warnings(不抛错、不阻塞、失败静默)。彻底清理由外部看门狗承担:
 *   node scripts/render-watchdog.mjs        # dry-run 侦察
 *   node scripts/render-watchdog.mjs --clean # 执行清理
 *
 * 孤儿判定(与 scripts/render-watchdog.mjs 同源逻辑,零误伤):
 *   指纹(Chrome 族二进制 + puppeteer_dev_chrome_profile / media-gen-mcp-render
 *   临时 profile 双前缀 或 DETERMINISTIC_FLAGS 特征对)
 *   + 非子进程(无 --type=/crashpad)+ spawner 已死(PPID=1 或 PPID 不在进程表)。
 *   在跑渲染的 Chrome 必有活 spawner(我们自己)→ 永不自误计数。
 *
 * 🔴 指纹 token 与 scripts/render-watchdog.mjs 双源同步维护,
 *    test/render-watchdog.test.mjs「指纹常量双源一致性」机械校验防漂移。
 *
 * 确定性纪律:node --test 环境(NODE_TEST_CONTEXT)与 MEDIA_GEN_RENDER_SELFCHECK=0
 * 下直接跳过 —— 测试不依赖机器实时进程状态。
 */
import { execFile } from "node:child_process";

const PROFILE_DIR_TOKENS = ["puppeteer_dev_chrome_profile", "media-gen-mcp-render"];
const FINGERPRINT_FLAG_STRONG = "--run-all-compositor-stages-before-draw";
const FINGERPRINT_FLAG_PAIR = "--force-color-profile=srgb";
const CHROME_BINARY_RX = /(Google Chrome|chrome-headless-shell|chrome_crashpad|google-chrome|chromium|chrome\.exe|msedge|microsoft-edge)/i;

/** self-check 告警线:孤儿主进程达到该数才上浮 warning(单发残留不制造噪音)。 */
export const RENDER_SELFCHECK_ALERT_MAINS = 3;
/** 节流:同进程内最多每 5 分钟真扫一次(ps ~几十 ms,但没必要每渲染都付)。 */
const THROTTLE_MS = 5 * 60_000;
const SCAN_TIMEOUT_MS = 3_000;

let cachedAt = 0;
let cachedWarning: string | undefined | null = null; // null = 本进程尚未扫过
let inflight: Promise<string | undefined> | null = null;

/**
 * 命令行是否 render 管线指纹:Chrome 族二进制 + (临时 profile 双前缀 或
 * DETERMINISTIC_FLAGS 特征对)。非浏览器进程(node -e/grep 恰含指纹串)不命中。
 */
export function isRenderChromeCmd(cmd: string): boolean {
  if (!CHROME_BINARY_RX.test(cmd)) return false;
  return (
    PROFILE_DIR_TOKENS.some((t) => cmd.includes(t)) ||
    (cmd.includes(FINGERPRINT_FLAG_STRONG) && cmd.includes(FINGERPRINT_FLAG_PAIR))
  );
}

/**
 * 纯函数:`ps -Axo pid=,ppid=,command=` 全表 → render 孤儿主进程数。
 * 孤儿 = 指纹 + 非子进程 + (PPID=1 或 PPID 不在进程表)。
 */
export function countOrphanRenderMains(psText: string): number {
  const rows: { pid: number; ppid: number; command: string }[] = [];
  const pids = new Set<number>();
  for (const line of String(psText).split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3].trim() });
    pids.add(Number(m[1]));
  }
  let n = 0;
  for (const r of rows) {
    if (!isRenderChromeCmd(r.command)) continue;
    if (r.command.includes("--type=") || r.command.includes("crashpad")) continue;
    if (r.ppid === 1 || !pids.has(r.ppid)) n++;
  }
  return n;
}

function scanOnce(): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-Axo", "pid=,ppid=,command="],
      { timeout: SCAN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`ps failed: ${err.message}${stderr ? ` (${String(stderr).trim()})` : ""}`));
        else resolve(countOrphanRenderMains(String(stdout)));
      },
    );
  });
}

/**
 * 渲染调用自省:孤儿计数超阈值时返回告警文案(含清理指引),否则 undefined。
 * 轻量不阻塞:节流 5min、3s 超时、任何失败静默返回 undefined、并发去重单飞。
 */
export async function maybeRenderOrphanWarning(): Promise<string | undefined> {
  if (process.env.MEDIA_GEN_RENDER_SELFCHECK === "0") return undefined;
  if (process.env.NODE_TEST_CONTEXT) return undefined; // 测试环境确定性:不依赖机器进程状态
  if (cachedWarning !== null && Date.now() - cachedAt < THROTTLE_MS) return cachedWarning;
  if (inflight) return inflight;
  inflight = (async (): Promise<string | undefined> => {
    try {
      const count = await scanOnce();
      cachedWarning =
        count >= RENDER_SELFCHECK_ALERT_MAINS
          ? `[render-watchdog] 检测到 ${count} 个 render 管线 Chrome 孤儿进程(指纹命中且 spawner 已死)——疑似 P0 泄漏复发(参见 doc/2026-09-01-Chrome泄漏致整机冻结-P0根因报告.md)。清理:npm run watchdog:render:clean;侦察:node scripts/render-watchdog.mjs。本告警不阻塞本次渲染。`
          : undefined;
    } catch {
      cachedWarning = undefined; // 失败静默(非 macOS/Linux 无 ps 等)
    } finally {
      cachedAt = Date.now();
      inflight = null;
    }
    return cachedWarning;
  })();
  return inflight;
}
