/**
 * render-watchdog 单测(P0 §8.3 看门狗,2026-09-01)。
 *
 * 两层:
 *  A. 纯函数 fixture 单测 —— parseEtime / parsePsOutput / classifyProcesses /
 *     parseSwapUsage* / pickStaleProfileDirs。fixture 直接取自 2026-09-01 实机
 *     `ps -Axo pid=,ppid=,etime=,command=` 抓包(含真身 Chrome / 在跑渲染 / 真孤儿)。
 *  B. 真跑 dry-run —— 子进程执行 scripts/render-watchdog.mjs --json:
 *     断言 JSON 结构 + 「dry-run 零动作」(不 kill 不删目录) + 退出码语义
 *     (exit 2 ⟺ alerts 非空;0/2 均为合法终态 —— 告警取决于机器实时状态,不钉死具体值)。
 *  C. 指纹双源一致性 —— scripts/render-watchdog.mjs 与 src/render-selfcheck.ts
 *     的三个指纹 token 必须逐字相同(双源维护,机械化防漂移)。
 *
 * 纯本地零网络零积分;不杀任何真实进程(清理路径只测纯分类,不测 clean 副作用)。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wd = await import(path.join(PROJECT_ROOT, "scripts", "render-watchdog.mjs"));
// dist 构建产物(npm test 先 build;独立裸跑未构建时为 null → 相关用例 skip)
const distSelfcheckPath = path.join(PROJECT_ROOT, "dist", "render-selfcheck.js");
const sc = fs.existsSync(distSelfcheckPath) ? await import(pathToFileURL(distSelfcheckPath).href) : null;

// ── fixture:实机抓包改写(2026-09-01,孤立 pid 无碰撞)──
const REAL_USER_CHROME =
  "542     1 04-21:30:24 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DET_FLAGS =
  "--no-sandbox --disable-gpu --font-render-hinting=full --force-color-profile=srgb --run-all-compositor-stages-before-draw --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding";
const orphanMainLine = (pid, age) =>
  `  ${pid}     1 ${age} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new about:blank ${DET_FLAGS} --remote-debugging-port=0 --user-data-dir=/var/folders/T/puppeteer_dev_chrome_profile-78W27w`;
const inflightLine = (pid, spawner, age) =>
  `  ${pid} ${spawner} ${age} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new about:blank ${DET_FLAGS} --remote-debugging-port=0 --user-data-dir=/var/folders/T/puppeteer_dev_chrome_profile-DHpnBM`;
const helperLine = (pid, ppid) =>
  `  ${pid} ${ppid}    03:10 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/150.0.7871.182/Helpers/Google Chrome Helper --type=renderer --user-data-dir=/var/folders/T/puppeteer_dev_chrome_profile-78W27w`;
const crashpadLine = (pid, ppid) =>
  `  ${pid} ${ppid}    00:12 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/150.0.7871.182/Helpers/chrome_crashpad_handler --monitor-self-annotation=ptype=crashpad-handler --database=/var/folders/T/puppeteer_dev_chrome_profile-78W27w/Crashpad`;
const spawnerLine = (pid) => `  ${pid}     1    00:30 node /some/project/dist/index.js`;

// ═══════════════════ A1. parseEtime ═══════════════════
describe("parseEtime(ps etime 字段 → 秒)", () => {
  test("MM:SS", () => assert.equal(wd.parseEtime("05:23"), 323));
  test("HH:MM:SS", () => assert.equal(wd.parseEtime("1:02:03"), 3723));
  test("DD-HH:MM:SS", () => assert.equal(wd.parseEtime("2-03:04:05"), 183845));
  test("launchd 实抓 05-00:47:18", () => assert.equal(wd.parseEtime("05-00:47:18"), 5 * 86400 + 2838));
  test("垃圾输入 → null", () => {
    assert.equal(wd.parseEtime(""), null);
    assert.equal(wd.parseEtime("abc"), null);
    assert.equal(wd.parseEtime(null), null);
    assert.equal(wd.parseEtime("1-2-3:00"), null);
  });
});

// ═══════════════════ A2. parsePsOutput ═══════════════════
describe("parsePsOutput(ps 全表 → 行对象)", () => {
  test("实抓行:pid/ppid/etimeSec/command 四列齐", () => {
    const rows = wd.parsePsOutput("    1     0 05-00:47:18 /sbin/launchd");
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { pid: rows[0].pid, ppid: rows[0].ppid, etimeSec: rows[0].etimeSec },
      { pid: 1, ppid: 0, etimeSec: 5 * 86400 + 2838 },
    );
    assert.equal(rows[0].command, "/sbin/launchd");
  });
  test("表头/空行静默跳过", () => {
    assert.equal(wd.parsePsOutput("  PID  PPID ETIME COMMAND\n\n   garbage-line").length, 0);
  });
  test("command 含多空格不截断", () => {
    const rows = wd.parsePsOutput(`  542     1 04-21:30:24 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`);
    assert.ok(rows[0].command.startsWith("/Applications/Google Chrome"));
  });
});

// ═══════════════════ A3. classifyProcesses(零误伤核心) ═══════════════════
describe("classifyProcesses(孤儿三重判定)", () => {
  const build = (lines) => wd.parsePsOutput(lines.join("\n"));

  test("真身 Chrome(裸命令行):不入 render 族,计入 chromeMainTotal", () => {
    const cls = wd.classifyProcesses(build([REAL_USER_CHROME]));
    assert.equal(cls.renderFamily.length, 0);
    assert.equal(cls.chromeMainTotal, 1);
    assert.equal(cls.orphanMains.length, 0);
  });

  test("真孤儿(指纹+ppid=1+存活 45min)→ cleanable", () => {
    const cls = wd.classifyProcesses(build([orphanMainLine(55761, "45:00")]));
    assert.equal(cls.orphanMains.length, 1);
    assert.equal(cls.orphanMains[0].pid, 55761);
    assert.equal(cls.youngOrphanMains.length, 0);
  });

  test("年轻孤儿(ppid=1 但 05:00)→ young 不 cleanable(下轮再收)", () => {
    const cls = wd.classifyProcesses(build([orphanMainLine(55761, "05:00")]));
    assert.equal(cls.orphanMains.length, 0);
    assert.equal(cls.youngOrphanMains.length, 1);
  });

  test("spawner 死但 ppid≠1(ppid=99999 不在进程表)→ 仍判孤儿", () => {
    const cls = wd.classifyProcesses(build([inflightLine(55761, 99999, "12:00")]));
    assert.equal(cls.orphanMains.length, 1);
  });

  test("🔴 零误伤关键用例:在跑渲染(活 spawner)哪怕存活 15 分钟也永不判孤儿", () => {
    const lines = [spawnerLine(50291), inflightLine(53684, 50291, "15:00")];
    const cls = wd.classifyProcesses(build(lines));
    assert.equal(cls.renderMains.length, 1);
    assert.equal(cls.orphanMains.length, 0, "马拉松 render_video(>10min)不得误伤");
    assert.equal(cls.youngOrphanMains.length, 0);
  });

  test("孤儿的 Helper 子进程随主进清理集;活 spawner 的 Helper 不进", () => {
    const lines = [
      orphanMainLine(55761, "45:00"),
      helperLine(55800, 55761), // 孤儿 main 的 renderer
      spawnerLine(50291),
      inflightLine(53684, 50291, "02:00"),
      helperLine(53700, 53684), // 在跑渲染的 renderer
    ];
    const cls = wd.classifyProcesses(build(lines));
    assert.equal(cls.orphanHelpers.length, 1);
    assert.equal(cls.orphanHelpers[0].pid, 55800);
  });

  test("crashpad(无 --type=)按子进程归类,不算主进程", () => {
    const lines = [crashpadLine(53686, 1)];
    const cls = wd.classifyProcesses(build(lines));
    assert.equal(cls.renderMains.length, 0);
    assert.equal(cls.renderHelpers.length, 1);
  });

  test("puppeteer 默认参数 launch(profile 前缀命中但无 DET_FLAGS 对)同属指纹", () => {
    // 实抓 53684 型:puppeteer 默认 flags(含 --force-color-profile=srgb 但无 run-all-compositor)
    const line =
      "  53684 50291    04:40 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new about:blank --remote-debugging-pipe --user-data-dir=/var/folders/T/puppeteer_dev_chrome_profile-DHpnBM";
    const cls = wd.classifyProcesses(wd.parsePsOutput([spawnerLine(50291), line].join("\n")));
    assert.equal(cls.renderFamily.length, 1, "profile 前缀单独即命中指纹");
  });

  test("browser-pool 新前缀(media-gen-mcp-render-<pid>-XXXX)孤儿同判", () => {
    const line =
      `  55900     1    42:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new about:blank ${DET_FLAGS} --remote-debugging-port=0 --user-data-dir=/var/folders/T/media-gen-mcp-render-50291-aB3xY9`;
    const cls = wd.classifyProcesses(wd.parsePsOutput(line));
    assert.equal(cls.orphanMains.length, 1, "P0 根治后的固定前缀 profile 孤儿必须可识别");
  });

  test("🔴 二进制门:node -e/grep 恰含指纹串的非浏览器进程不命中(零误伤)", () => {
    const lines = [
      `  60001     1    12:00 node -e "pgrep -f puppeteer_dev_chrome_profile | wc -l; pkill -f media-gen-mcp-render"`,
      `  60002     1    12:00 grep --color=auto -n puppeteer_dev_chrome_profile /tmp/log.txt`,
    ];
    const cls = wd.classifyProcesses(wd.parsePsOutput(lines.join("\n")));
    assert.equal(cls.renderFamily.length, 0, "非 Chrome 二进制即便含指纹串也绝不判孤儿");
  });

  test("lasso/flow 的 CDP attach Chrome(真实 profile,无指纹)不命中", () => {
    // 实抓形态:用户手工/lasso 启动的可见 Chrome,--user-data-dir=$HOME/.media-gen-mcp/chrome-profile
    const line =
      "  53700     1    10:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9223 --user-data-dir=/Users/wangdong/.media-gen-mcp/chrome-profile";
    const cls = wd.classifyProcesses(wd.parsePsOutput(line));
    assert.equal(cls.renderFamily.length, 0, "flow 调试 Chrome(登录 labs.google 用)绝不误伤");
    assert.equal(cls.chromeMainTotal, 1, "仍计入 Chrome 主进程总数(告警口径)");
  });
});

// ═══════════════════ A4. swap 解析 ═══════════════════
describe("swap 用量解析", () => {
  test("macOS sysctl 实抓格式", () => {
    const b = wd.parseSwapUsageMac("total = 6144.00M  used = 5094.00M  free = 1050.00M  (encrypted)");
    assert.equal(b, Math.round(5094 * 1024 * 1024));
  });
  test("macOS G 单位 + 解析失败 → null", () => {
    assert.equal(wd.parseSwapUsageMac("total = 8.00G  used = 4.50G  free = 3.50G"), Math.round(4.5 * 1024 ** 3));
    assert.equal(wd.parseSwapUsageMac("garbage"), null);
  });
  test("Linux /proc/meminfo", () => {
    const b = wd.parseSwapMeminfo("SwapTotal:       1048572 kB\nSwapFree:        524286 kB\n");
    assert.equal(b, (1048572 - 524286) * 1024);
    assert.equal(wd.parseSwapMeminfo("nope"), null);
  });
});

// ═══════════════════ A5. 陈年 profile 目录挑选 ═══════════════════
describe("pickStaleProfileDirs(在用目录绝不删)", () => {
  const now = Date.now();
  const dir = (name, ageMin) => ({ name, full: `/tmp/${name}`, mtimeMs: now - ageMin * 60_000, sizeBytes: 1024 });
  test("陈年且无活进程引用 → stale", () => {
    const stale = wd.pickStaleProfileDirs([dir("puppeteer_dev_chrome_profile-aBc123", 90)], "", { now });
    assert.equal(stale.length, 1);
  });
  test("陈年但活进程命令行仍引用 → 保留(零误伤)", () => {
    const d = dir("puppeteer_dev_chrome_profile-aBc123", 90);
    const stale = wd.pickStaleProfileDirs([d], `  55761     1 45:00 ... --user-data-dir=/var/folders/T/${d.name}`, { now });
    assert.equal(stale.length, 0);
  });
  test("新鲜目录(30min < 60min 线)→ 保留", () => {
    const stale = wd.pickStaleProfileDirs([dir("puppeteer_dev_chrome_profile-x", 30)], "", { now });
    assert.equal(stale.length, 0);
  });
  test("自定义陈年线生效", () => {
    const stale = wd.pickStaleProfileDirs([dir("puppeteer_dev_chrome_profile-y", 20)], "", { now, dirAgeMs: 10 * 60_000 });
    assert.equal(stale.length, 1);
  });
});

// ═══════════════════ C. 指纹双源一致(watchdog.mjs ↔ selfcheck.ts) ═══════════════════
describe("指纹常量双源一致性(防漂移)", () => {
  test("src/render-selfcheck.ts 与 scripts/render-watchdog.mjs 全部 token 逐字一致", () => {
    const selfcheckSrc = fs.readFileSync(path.join(PROJECT_ROOT, "src", "render-selfcheck.ts"), "utf8");
    const tokens = [
      ...wd.PROFILE_DIR_TOKENS,
      wd.FINGERPRINT_FLAG_STRONG,
      wd.FINGERPRINT_FLAG_PAIR,
    ];
    for (const token of tokens) {
      assert.ok(
        selfcheckSrc.includes(`"${token}"`),
        `src/render-selfcheck.ts 缺指纹 token "${token}"(双源必须同步维护)`,
      );
    }
  });
});

// ═══════════════════ D. TS self-check 纯函数(需 dist;独立裸跑未构建时 skip) ═══════════════════
describe("render-selfcheck(src/render-selfcheck.ts,经 dist)", () => {
  test("countOrphanRenderMains:孤儿计入;在跑渲染/真身/Helper 不计", { skip: !sc }, () => {
    const psText = [
      REAL_USER_CHROME,
      orphanMainLine(55761, "45:00"),
      helperLine(55800, 55761),
      spawnerLine(50291),
      inflightLine(53684, 50291, "15:00"),
    ].join("\n");
    assert.equal(sc.countOrphanRenderMains(psText), 1);
  });

  test("countOrphanRenderMains 与 watchdog classifyProcesses 同判(双源行为一致性)", { skip: !sc }, () => {
    const psText = [spawnerLine(50291), inflightLine(53684, 50291, "99:00")].join("\n");
    assert.equal(sc.countOrphanRenderMains(psText), 0, "马拉松在跑渲染两源都不得误判");
  });

  test("MEDIA_GEN_RENDER_SELFCHECK=0 时 maybeRenderOrphanWarning 直接跳过(确定性纪律)", { skip: !sc }, async () => {
    const prev = process.env.MEDIA_GEN_RENDER_SELFCHECK;
    process.env.MEDIA_GEN_RENDER_SELFCHECK = "0";
    try {
      assert.equal(await sc.maybeRenderOrphanWarning(), undefined);
    } finally {
      if (prev === undefined) delete process.env.MEDIA_GEN_RENDER_SELFCHECK;
      else process.env.MEDIA_GEN_RENDER_SELFCHECK = prev;
    }
  });
});

// ═══════════════════ B. 真跑 dry-run(子进程) ═══════════════════
describe("真跑 dry-run(零动作 + 退出码语义)", () => {
  const run = (args) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [path.join(PROJECT_ROOT, "scripts", "render-watchdog.mjs"), ...args],
        { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) }),
      );
    });

  test("正常机器状态(无孤儿或仅年轻孤儿):结构完整 + dry-run 零动作", async () => {
    const r = await run(["--json"]);
    assert.ok([0, 2].includes(r.code), `退出码应为 0/2,实际 ${r.code}(stderr:${r.stderr.slice(0, 200)})`);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.ok, true);
    assert.equal(rep.mode, "dry-run");
    // 零动作:dry-run 不得杀进程/删目录
    assert.deepEqual(rep.orphans.killedSigterm, []);
    assert.deepEqual(rep.orphans.killedSigkill, []);
    assert.deepEqual(rep.profileDirs.removed, []);
    // 计数一致性
    assert.ok(rep.orphans.main >= 0 && rep.orphans.young >= 0);
    assert.ok(
      rep.orphans.main + rep.orphans.young <= rep.fleet.renderMainTotal,
      "孤儿数(可清理+年轻)不得超过 render 主进程总数",
    );
    // 退出码语义:exit 2 ⟺ 有告警
    assert.equal(rep.exitCode === 2, rep.alerts.length > 0);
    assert.equal(r.code, rep.exitCode);
  });

  test("告警阈值可调:--alert-chrome-main 0 必触发 chrome 告警(机器有 Chrome 时)", async () => {
    const r = await run(["--json", "--alert-chrome-main", "0"]);
    assert.ok([0, 2].includes(r.code));
    const rep = JSON.parse(r.stdout);
    // chromeMainTotal≥1 的机器(开发机常态)必告警;CI 无 Chrome 时降级为结构断言
    if (rep.fleet.chromeMainTotal >= 1) {
      assert.equal(r.code, 2);
      assert.ok(rep.alerts.some((a) => a.includes("Chrome 主进程")));
    }
  });

  test("--help → exit 0;坏参数 → exit 1", async () => {
    const h = await run(["--help"]);
    assert.equal(h.code, 0);
    assert.ok(h.stdout.includes("零误伤"));
    const bad = await run(["--nonsense"]);
    assert.equal(bad.code, 1);
  });
});
