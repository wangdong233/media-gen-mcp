/**
 * browser-pool 单元测试(2026-09-02 attach 切换 → 2026-09-03 legacy 自管池提前退役,
 * 原 browser-pool.test.ts 整删后本文件是池的唯一测试家;对接契约 §一/§二)。
 *
 * 覆盖任务验收点(mock ensure/connect + 真 spawn 假 lasso 二进制,零真实 Chrome attach、零积分):
 *  1. RENDER_MODE 二态 —— auto/attach 解析;已退役 legacy 与非法值 warn(每值一次)后按 auto
 *  2. attach 语义 —— mock ensure 输出 → connect 收到 {browserWSEndpoint, defaultViewport:null};
 *     单飞(两次渲染 connect 一次);断连自清理后重 ensure
 *  3. heartbeat 启停 —— acquire/release 引用计数驱动;渲染存续期间周期 touch;归零停表
 *  4. 降级文案 —— RENDER_BROWSER_UNAVAILABLE 模板(npx 自愈命令 + lasso README 指引 +
 *     stderr 原样透传;🔴 永不再含 legacy 逃生门句);🔴 绝不静默回落自管 launch
 *     (自管池已随 2026-09-03 退役物理删除,「绝不回落」随物理删除单调成立)
 *  5. ensure 解析链 —— MEDIA_GEN_LASSO_BIN 真 spawn(假二进制:单行 JSON / exit 3 + stderr /
 *     ENOENT);stdout 污染/缺 wsEndpoint 拒绝
 *  6. 归还 = disconnect 严禁 close —— shutdownBrowser 后 disconnect 被调、close 零调用;
 *     setAttachProviderForTests(null,null) 全量复位(归还连接 + 清注入)
 *  7. render_svg/render-video 降级联动 —— ensure 失败 → resvg 降级告警带修复指引 / 结构化错误上抛
 *  8. SIGTERM 信号路径不等在飞 ensure(2026-09-03 项1)—— 子进程在飞慢 ensure(15s)期间收
 *     SIGTERM 必须 <8s 退出(修复前形态=滞留满 npx 90s 预算类等待)
 *  9. exit 钩子 —— 模块加载即注册('exit' 必注册;SIGINT/SIGTERM 受
 *     MEDIA_GEN_NO_SIGNAL_HANDLERS 门控,子进程验证)—— 自原 browser-pool.test.ts 迁入
 *     (信号路径 attach 语义不变,与 legacy 无关故迁出保留)
 * 10. F3 导出面盘点钉死 —— 值导出恰 15 符号(2026-09-03 legacy 退役 18→14);三渲染消费方
 *     值导入并集恰 5 符号且无第四消费方(与 src/browser-pool.ts 公共 API 节 F3 注释互为钉死)
 *     —— 自原 browser-pool.test.ts 迁入并适配二态计数
 *
 * License:本文件为 attach 切换自研。
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const pool: any = await import(pathToFileURL(path.join(distDir, "browser-pool.js")).href);
const renderSvgMod: any = await import(pathToFileURL(path.join(distDir, "render-svg.js")).href);
const renderVideoMod: any = await import(pathToFileURL(path.join(distDir, "render-video.js")).href);

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 可附着 mock 浏览器(真 disconnect/close 计数 —— 断言归还语义)。 */
function makeConnectable() {
  const state = { disconnectCalls: 0, closeCalls: 0, disconnectedListeners: [] as (() => void)[] };
  const raw = {
    async newPage() { return { async close() {} }; },
    async disconnect() { state.disconnectCalls++; },
    async close() { state.closeCalls++; },
    once(ev: string, cb: () => void) { if (ev === "disconnected") state.disconnectedListeners.push(cb); },
  };
  return { raw, state };
}

/** mock ensure + mock connector 组合注入;返回观察面。 */
async function injectAttach(wsEndpoint = "ws://127.0.0.1:9224/devtools/browser/test-uuid", touchPath?: string) {
  const calls = { ensureCalls: 0, connectOpts: [] as any[] };
  const conn = makeConnectable();
  await pool.setAttachProviderForTests(
    async () => { calls.ensureCalls++; return { wsEndpoint, touchPath }; },
    async (opts: any) => { calls.connectOpts.push(opts); return conn.raw; },
  );
  return { calls, conn };
}

/** 写一个假 lasso 二进制(shell 脚本)供 MEDIA_GEN_LASSO_BIN 真 spawn。 */
function writeFakeLasso(script: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "browser-pool-attach-"));
  const fp = path.join(dir, "lasso-mcp");
  writeFileSync(fp, `#!/bin/sh\n${script}\n`, "utf8");
  chmodSync(fp, 0o755);
  return fp;
}

const ENV_KEYS = ["MEDIA_GEN_RENDER_MODE", "MEDIA_GEN_LASSO_BIN", "MEDIA_GEN_RENDER_HEARTBEAT_MS"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  await pool.setAttachProviderForTests(null, null); // 全量复位(归还连接 + 清 ensure/connector 注入)
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await pool.shutdownBrowser();
  await pool.setAttachProviderForTests(null, null);
});

describe("browser-pool attach:RENDER_MODE 二态(对接 §二.d;legacy 已退役)", () => {
  test("未设/auto/attach 解析正确;空串按 auto", () => {
    delete process.env.MEDIA_GEN_RENDER_MODE;
    assert.equal(pool.resolveRenderMode(), "auto");
    process.env.MEDIA_GEN_RENDER_MODE = "auto";
    assert.equal(pool.resolveRenderMode(), "auto");
    process.env.MEDIA_GEN_RENDER_MODE = " ATTACH ";
    assert.equal(pool.resolveRenderMode(), "attach", "trim+lowercase 归一");
    process.env.MEDIA_GEN_RENDER_MODE = "";
    assert.equal(pool.resolveRenderMode(), "auto");
  });

  test("env=legacy(已退役,2026-09-03):resolveRenderMode 返回 auto 且 warn 已退役提示", () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m?: unknown) => { warns.push(String(m)); };
    try {
      process.env.MEDIA_GEN_RENDER_MODE = "legacy";
      assert.equal(pool.resolveRenderMode(), "auto", "legacy 值必须落入 warn+auto 通路(自管池已物理删除)");
      assert.ok(warns.some((w) => /MEDIA_GEN_RENDER_MODE="legacy" 已退役.*按 auto/.test(w)), "退役 warn 必须明示已退役语义");
    } finally {
      console.warn = origWarn;
    }
    // 注:legacy warn 每值每进程一次,本文件内由本测试消费;后续测试设 legacy 不再重复 warn
  });

  test("非法值:warn(每值每进程一次)后按 auto", () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m?: unknown) => { warns.push(String(m)); };
    try {
      process.env.MEDIA_GEN_RENDER_MODE = "bogus";
      assert.equal(pool.resolveRenderMode(), "auto");
      assert.equal(pool.resolveRenderMode(), "auto"); // 二次解析不重复 warn
      process.env.MEDIA_GEN_RENDER_MODE = "other";
      assert.equal(pool.resolveRenderMode(), "auto");
      assert.equal(warns.length, 2, "两个不同非法值各 warn 一次");
      assert.match(warns[0], /MEDIA_GEN_RENDER_MODE="bogus" 非法\(合法值 auto\|attach\).*按 auto/);
    } finally {
      console.warn = origWarn;
    }
    // 注:warn 去重集合是模块级的;node --test 每文件独立子进程,且本套件不再复用 bogus/other
  });

  test("resolveRenderMode 显式 env 入参(不读 process.env)", () => {
    process.env.MEDIA_GEN_RENDER_MODE = "auto";
    assert.equal(pool.resolveRenderMode({ MEDIA_GEN_RENDER_MODE: "attach" }), "attach");
    assert.equal(pool.resolveRenderMode({ MEDIA_GEN_RENDER_MODE: "legacy" }), "auto", "入参形态下 legacy 同样 warn+auto");
  });
});

describe("browser-pool attach:ensure→connect 与单飞", () => {
  test("connect 收到 {browserWSEndpoint, defaultViewport:null};两次渲染单飞 ensure+connect 各一次", async () => {
    const { calls, conn } = await injectAttach("ws://127.0.0.1:9224/devtools/browser/abc");
    await pool.withBrowser(() => Promise.resolve(1));
    await pool.withBrowser(() => Promise.resolve(2));
    assert.equal(calls.ensureCalls, 1, "已有附着实例必须复用,不得重复 ensure");
    assert.equal(calls.connectOpts.length, 1, "两次渲染共享同一次 connect(单飞)");
    // 🔴 选项名 = browserWSEndpoint(对接 §一.5 勘误:webSocketDebuggerUrl 照抄直接 throw)
    assert.equal(calls.connectOpts[0].browserWSEndpoint, "ws://127.0.0.1:9224/devtools/browser/abc");
    assert.strictEqual(calls.connectOpts[0].defaultViewport, null, "defaultViewport 必须为 null(页面级 setViewport 由渲染方自管)");
    assert.equal(conn.state.disconnectCalls, 0, "渲染归还不得断连(连接留用热复用)");
    const st = pool.getBrowserPoolState();
    assert.equal(st.attached, true);
    assert.equal(st.attachCount, 1);
    assert.equal(st.wsEndpoint, "ws://127.0.0.1:9224/devtools/browser/abc");
  });

  test("并发 withBrowser:单飞一次 connect,全部同一实例,引用归零", async () => {
    let gate!: () => void;
    const held = new Promise<void>((r) => { gate = r; });
    const { calls, conn } = await injectAttach();
    const slowConnector = async (opts: any) => { await delay(30); calls.connectOpts.push(opts); return conn.raw; };
    await pool.setAttachProviderForTests(async () => ({ wsEndpoint: "ws://x/devtools/browser/y" }), slowConnector);
    const jobs = Array.from({ length: 3 }, () => pool.withBrowser(async () => { await held; }));
    await delay(10); // 放大并发窗口
    gate();
    await Promise.all(jobs);
    assert.equal(calls.connectOpts.length, 1, "并发必须共享同一次 connect");
    assert.equal(pool.getBrowserPoolState().refCount, 0);
  });

  test("断连自清理:disconnected 触发后槽位清空,下次 acquire 重新 ensure+connect", async () => {
    const { calls, conn } = await injectAttach();
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(conn.state.disconnectedListeners.length, 1);
    conn.state.disconnectedListeners[0](); // 模拟 CDP 断连
    assert.equal(pool.getBrowserPoolState().attached, false, "断连只做消费方侧自清理");
    assert.equal(conn.state.closeCalls, 0, "断连自清理绝不能调 close(会杀共享渲染档)");
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(calls.ensureCalls, 2, "断连后重新 ensure");
    assert.equal(calls.connectOpts.length, 2);
  });

  test("getBrowser probe:attach 档可用返回实例、失败返回 null(旧 render-svg 契约)", async () => {
    await pool.setAttachProviderForTests(
      async () => { throw new Error("ensure exit 3"); },
      null,
    );
    assert.equal(await pool.getBrowser(), null, "probe 失败必须返回 null 而非抛错");
    const { conn } = await injectAttach();
    const b = await pool.getBrowser();
    assert.ok(b, "可用时 probe 返回包装实例");
    assert.equal(conn.state.disconnectCalls, 0);
    assert.equal(pool.getBrowserPoolState().refCount, 0, "probe 不占引用");
  });
});

describe("browser-pool attach:heartbeat 启停(对接 §一.2)", () => {
  test("渲染存续期间周期 touch;归零停表 + 归还 touch 一次", async () => {
    const touchDir = mkdtempSync(path.join(os.tmpdir(), "attach-touch-"));
    const touchPath = path.join(touchDir, "chrome-touch-9224");
    writeFileSync(touchPath, "0\n", "utf8");
    process.env.MEDIA_GEN_RENDER_HEARTBEAT_MS = "50"; // 测试调短(封顶 60s 契约不变)
    const mtime = () => statSync(touchPath).mtimeMs;
    utimesSync(touchPath, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000)); // 拉开差距
    const before = mtime();

    await injectAttach("ws://127.0.0.1:9224/devtools/browser/hb", touchPath);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const job = pool.withBrowser(async () => { await gate; });
    await delay(30);
    assert.equal(pool.getBrowserPoolState().heartbeatArmed, true, "有活跃借用期间 heartbeat 必须武装");
    assert.ok(mtime() > before, "acquire 前置 touch 已生效");
    const mid = mtime();
    await delay(180); // > 3 个周期
    assert.ok(mtime() > mid, "渲染挂起期间 heartbeat 必须周期 touch(仅首尾 touch 覆盖不了长渲染)");
    release();
    await job;
    assert.equal(pool.getBrowserPoolState().heartbeatArmed, false, "引用归零必须停 heartbeat");
    rmSync(touchDir, { recursive: true, force: true });
  });

  test("touchPath 缺省(旧版 lasso):不武装 heartbeat,渲染照常", async () => {
    await injectAttach("ws://127.0.0.1:9224/devtools/browser/no-touch", undefined);
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(pool.getBrowserPoolState().heartbeatArmed, false);
    assert.equal(pool.getBrowserPoolState().attached, true);
  });

  test("touch 失败仅 warn 不阻断渲染(文件被删)", async () => {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (m?: unknown) => { warns.push(String(m)); };
    try {
      await injectAttach("ws://127.0.0.1:9224/devtools/browser/dead-touch", "/nonexistent-dir-xyz/chrome-touch-9224");
      process.env.MEDIA_GEN_RENDER_HEARTBEAT_MS = "50";
      await pool.withBrowser(() => Promise.resolve());
      assert.equal(pool.getBrowserPoolState().attached, true, "触碰失败不阻断渲染(降级为 lasso 自身信号)");
      assert.ok(warns.some((w) => /render-chrome touch 失败/.test(w)), "触碰失败必须 warning 上浮");
    } finally {
      console.warn = origWarn;
    }
  });

  // (原「attach 下 idle 定时器不武装」测试随 2026-09-03 legacy 自管池退役删除:
  //  idleTimerArmed 字段与 MEDIA_GEN_BROWSER_IDLE_MS 一并移除,idle 回收整体归 lasso)
});

describe("browser-pool attach:降级模板 RENDER_BROWSER_UNAVAILABLE(对接 §二.d)", () => {
  test("模板全要素:npx 自愈命令 + lasso README 指引 + stderr 原样透传,永不含 legacy 逃生门;error 形状", async () => {
    await pool.setAttachProviderForTests(
      async () => { const e: any = new Error("cmd failed"); e.code = 3; e.stderr = "port 9224 occupied by non-render process"; throw e; },
      null,
    );
    await assert.rejects(
      pool.withBrowser(() => Promise.resolve()),
      (e: Error & { code?: string }) => {
        assert.equal(e.name, "BrowserUnavailableError");
        assert.equal(e.code, "RENDER_BROWSER_UNAVAILABLE");
        assert.match(e.message, /确定性渲染需 lasso 渲染档/);
        assert.match(e.message, /npx -y lasso-mcp render-chrome --ensure/);
        assert.match(e.message, /未装 lasso 见其 README/);
        assert.match(e.message, /port 9224 occupied by non-render process/, "ensure stderr 原样透传");
        // 2026-09-03 legacy 提前退役:模板永不再含逃生门句与退役日(钉死不复活)
        assert.doesNotMatch(e.message, /legacy/, "模板不得再含 legacy 逃生门句");
        assert.doesNotMatch(e.message, /2026-12-01/, "模板不得再含旧退役日");
        return true;
      },
    );
    assert.equal(pool.getBrowserPoolState().refCount, 0, "降级路径也必须归还引用计数");
  });

  test("MEDIA_GEN_RENDER_MODE=attach 强制档:失败同上报错(不回落)", async () => {
    process.env.MEDIA_GEN_RENDER_MODE = "attach";
    await pool.setAttachProviderForTests(async () => { throw new Error("timeout-ish"); }, null);
    await assert.rejects(
      pool.withBrowser(() => Promise.resolve()),
      (e: Error & { code?: string }) => e.code === "RENDER_BROWSER_UNAVAILABLE",
    );
  });

  test("render_svg 降级联动:ensure 失败 → resvg 降级 + 告警带修复指引", async () => {
    await pool.setAttachProviderForTests(
      async () => { const e: any = new Error("x"); e.code = 2; e.stderr = "chrome binary missing"; throw e; },
      null,
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><defs><filter id="b"><feGaussianBlur stdDeviation="2"/></filter></defs><circle cx="40" cy="30" r="20" fill="red" filter="url(#b)"/></svg>`;
    const out = await renderSvgMod.renderSvg({ svg });
    assert.equal(out.backendUsed, "resvg", "attach 失败必须降级 resvg(功能性回退,非自管 launch)");
    assert.match(out.warning, /渲染档\(lasso render-chrome\)不可用.*resvg/);
    assert.match(out.warning, /render-chrome --ensure/);
    assert.ok(out.png?.length, "降级路径必须产 PNG");
  });

  test("render_video 降级联动:结构化错误原样上抛(不被旧文案吞掉)", async () => {
    await pool.setAttachProviderForTests(
      async () => { const e: any = new Error("x"); e.code = 4; e.stderr = "launch timeout"; throw e; },
      null,
    );
    await assert.rejects(
      renderVideoMod.renderVideo({ html: "<html><body>x</body></html>", duration: 1, fps: 10 }),
      (e: Error & { code?: string }) => {
        assert.equal(e.code, "RENDER_BROWSER_UNAVAILABLE", "render-video 不得改写结构化降级模板");
        assert.match(e.message, /确定性渲染需 lasso 渲染档/);
        return true;
      },
    );
  });
});

describe("browser-pool attach:ensure 解析链真 spawn(MEDIA_GEN_LASSO_BIN)", () => {
  test("假 lasso 二进制:exit 0 + 单行 JSON → connect 用其 wsEndpoint(ensure 真走 spawn 链)", async () => {
    const fake = writeFakeLasso(
      `echo '{"wsEndpoint":"ws://127.0.0.1:9224/devtools/browser/fake","port":9224,"startedAt":1,"reused":true,"touchPath":"/tmp/fake-touch","pid":1}'`,
    );
    process.env.MEDIA_GEN_LASSO_BIN = fake;
    const connectOpts: any[] = [];
    const ensureCallsBefore = pool.getBrowserPoolState().ensureCalls;
    await pool.setAttachProviderForTests(
      null, // ensure 走真 spawn(MEDIA_GEN_LASSO_BIN 命中假二进制)
      async (opts: any) => { connectOpts.push(opts); return makeConnectable().raw; },
    );
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(connectOpts[0].browserWSEndpoint, "ws://127.0.0.1:9224/devtools/browser/fake");
    assert.equal(pool.getBrowserPoolState().ensureCalls, ensureCallsBefore + 1, "本例恰好新增一次真 spawn ensure");
    rmSync(path.dirname(fake), { recursive: true, force: true });
  });

  test("exit 3 + stderr → 降级错误含 exit 码与 stderr 透传", async () => {
    const fake = writeFakeLasso(`echo "port occupied" >&2; exit 3`);
    process.env.MEDIA_GEN_LASSO_BIN = fake;
    await assert.rejects(
      pool.withBrowser(() => Promise.resolve()),
      (e: Error & { code?: string }) => {
        assert.equal(e.code, "RENDER_BROWSER_UNAVAILABLE");
        assert.match(e.message, /exit 3: port occupied/);
        return true;
      },
    );
    rmSync(path.dirname(fake), { recursive: true, force: true });
  });

  test("MEDIA_GEN_LASSO_BIN 不存在(ENOENT)→ 降级错误含安装指引", async () => {
    process.env.MEDIA_GEN_LASSO_BIN = "/nonexistent/lasso-mcp-xyz";
    await assert.rejects(
      pool.withBrowser(() => Promise.resolve()),
      (e: Error) => /可执行文件不存在.*MEDIA_GEN_LASSO_BIN/.test(e.message),
    );
  });

  test("stdout 非 JSON / 缺 wsEndpoint → 拒绝 attach", async () => {
    const fake = writeFakeLasso(`echo 'not json at all'`);
    process.env.MEDIA_GEN_LASSO_BIN = fake;
    await assert.rejects(pool.withBrowser(() => Promise.resolve()), /不可解析|wsEndpoint/);
    rmSync(path.dirname(fake), { recursive: true, force: true });

    const fake2 = writeFakeLasso(`echo '{"port":9224}'`);
    process.env.MEDIA_GEN_LASSO_BIN = fake2;
    await assert.rejects(pool.withBrowser(() => Promise.resolve()), /wsEndpoint/);
    rmSync(path.dirname(fake2), { recursive: true, force: true });
  });

  test("resolveLassoEnsure 解析链:MEDIA_GEN_LASSO_BIN > PATH > npx 兜底", async () => {
    process.env.MEDIA_GEN_LASSO_BIN = "/explicit/lasso-mcp";
    let r = pool.resolveLassoEnsure();
    assert.equal(r.file, "/explicit/lasso-mcp");
    assert.deepEqual(r.args, ["render-chrome", "--ensure"]);
    assert.equal(r.timeoutMs, 25_000);
    delete process.env.MEDIA_GEN_LASSO_BIN;
    // PATH 直查(lasso-mcp 本机已装;未装机器上落到 npx —— 两种都合法,断言形态)
    r = pool.resolveLassoEnsure();
    if (/lasso-mcp/.test(r.file) && !/^npx/.test(path.basename(r.file))) {
      assert.equal(r.timeoutMs, 25_000, "PATH 直查预算 25s");
      assert.ok(!r.args.includes("-y"), "PATH 直查不经 npx");
    } else {
      assert.equal(r.timeoutMs, 90_000, "npx 兜底预算放宽 90s");
      assert.deepEqual(r.args, ["-y", "lasso-mcp", "render-chrome", "--ensure"]);
    }
  });
});

describe("browser-pool attach:归还 = disconnect 严禁 close(对接 §一.5)", () => {
  test("shutdownBrowser → disconnect 被调、close 零调用(共享渲染档存活)", async () => {
    const { conn } = await injectAttach();
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(conn.state.disconnectCalls, 0, "热复用期间不断连");
    await pool.shutdownBrowser();
    assert.equal(conn.state.disconnectCalls, 1, "归还必须 disconnect");
    assert.equal(conn.state.closeCalls, 0, "🔴 严禁 close —— connect 实例的 close 会杀掉共享渲染档");
    assert.equal(pool.getBrowserPoolState().attached, false);
  });

  test("syncCleanupOnExit:仅清本地连接态,绝不杀共享渲染档", async () => {
    const { conn } = await injectAttach();
    await pool.withBrowser(() => Promise.resolve());
    pool.syncCleanupOnExit();
    assert.equal(pool.getBrowserPoolState().attached, false);
    assert.equal(conn.state.closeCalls, 0, "exit 路径绝不能触碰共享渲染档");
    assert.equal(conn.state.disconnectCalls, 0, "exit(同步)不发起异步 disconnect,连接随进程消亡");
  });
});

describe("browser-pool attach:SIGTERM 信号路径不等在飞 ensure(2026-09-03 项1)", () => {
  test("在飞 ensure(慢二进制 15s)期间收 SIGTERM:子进程快速退出(<8s,不等 90s npx 预算类滞留)", async () => {
    const fake = writeFakeLasso(`sleep 15; echo '{"wsEndpoint":"ws://127.0.0.1:9224/devtools/browser/slow"}'`);
    const modUrl = pathToFileURL(path.join(distDir, "browser-pool.js")).href;
    const script = `
      import(${JSON.stringify(modUrl)}).then((m) => {
        m.withBrowser(() => Promise.resolve()).catch(() => {}); // 触发在飞 ensure(fake 二进制 sleep 15s)
        console.log("ARMED");
      });
    `;
    const childEnv: NodeJS.ProcessEnv = { ...process.env, MEDIA_GEN_LASSO_BIN: fake };
    delete childEnv.MEDIA_GEN_NO_SIGNAL_HANDLERS; // 信号钩子必须在(否则默认 SIGTERM 即杀,测不出等待路径)
    const child = spawn(process.execPath, ["-e", script], {
      env: childEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let armed = false;
    child.stdout.on("data", (d: Buffer) => { if (d.toString().includes("ARMED")) armed = true; });
    const deadline = Date.now() + 10_000;
    while (!armed && Date.now() < deadline) await delay(50);
    assert.ok(armed, "子进程必须先进入在飞 ensure 状态(ARMED)");
    await delay(250); // 让 execFileAsync 真正拉起慢二进制
    const exit = new Promise<{ code: number | null }>((r) => child.on("exit", (c) => r({ code: c })));
    const t0 = Date.now();
    child.kill("SIGTERM");
    const { code } = await exit;
    const elapsed = Date.now() - t0;
    rmSync(path.dirname(fake), { recursive: true, force: true });
    assert.equal(code, 0, "信号钩子路径 exit 0(断连后退出)");
    assert.ok(elapsed < 8_000, `SIGTERM 后 ${elapsed}ms 才退出 —— 信号路径在等在飞 ensure(修复前形态=滞留满 ensure 预算)`);
  });
});

describe("browser-pool attach:测试复位语义(原 legacy 逃生门注入隔离节随 2026-09-03 退役删除,复位覆盖保留)", () => {
  test("setAttachProviderForTests(null,null) 复位:disconnect 归还 + 注入清空", async () => {
    const { conn, calls } = await injectAttach();
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(pool.getBrowserPoolState().attached, true);
    await pool.setAttachProviderForTests(null, null); // 复位 = releaseAttach 归还连接 + 清 ensure/connector 注入
    assert.equal(pool.getBrowserPoolState().attached, false);
    assert.equal(conn.state.disconnectCalls, 1, "复位即归还连接(disconnect)");
    assert.equal(conn.state.closeCalls, 0);
    assert.equal(pool.getBrowserPoolState().refCount, 0);
    // 注入已清空:后续 acquire 走真 ensure 解析链 —— 用假 lasso 二进制钉住 MEDIA_GEN_LASSO_BIN
    // 保持 hermetic(不真跑 lasso/npx);connect 到假 wsEndpoint 失败由 getBrowser probe 吞掉,
    // ensureCalls 增量证明真链路执行、mock 计数不增证明注入确已清空
    const fake = writeFakeLasso(`echo '{"wsEndpoint":"ws://127.0.0.1:9224/devtools/browser/reset-probe"}'`);
    process.env.MEDIA_GEN_LASSO_BIN = fake;
    try {
      const ensureCallsBefore = pool.getBrowserPoolState().ensureCalls;
      await pool.getBrowser();
      assert.equal(pool.getBrowserPoolState().ensureCalls, ensureCallsBefore + 1, "注入清空后 ensure 走真 spawn 链路");
      assert.equal(calls.ensureCalls, 1, "mock ensure 不再被调用(注入已清)");
    } finally {
      rmSync(path.dirname(fake), { recursive: true, force: true });
    }
  });
});

// ── 迁入自原 test/browser-pool.test.ts(2026-09-03 legacy 退役整删;三测与 legacy 无关故保留)──

describe("browser-pool:exit 钩子(P0 §8.2 堵 SIGKILL 以外的孤儿路径;attach 语义)", () => {
  test("模块加载即注册 'exit' 钩子(本测试进程内已加载)", () => {
    assert.ok(process.listenerCount("exit") >= 1, "'exit' 钩子必须无条件注册");
  });

  test("默认注册 SIGINT/SIGTERM;MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时跳过(子进程验证)", () => {
    const modUrl = pathToFileURL(path.join(distDir, "browser-pool.js")).href;
    const script = `
      import(${JSON.stringify(modUrl)}).then((m) => {
        console.log(JSON.stringify({
          exit: process.listenerCount("exit"),
          sigint: process.listenerCount("SIGINT"),
          sigterm: process.listenerCount("SIGTERM"),
        }));
        return m.shutdownBrowser();
      }).catch((e) => { console.error(String(e)); process.exit(1); });
    `;
    const run = (guarded: boolean) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.MEDIA_GEN_NO_SIGNAL_HANDLERS;
      if (guarded) env.MEDIA_GEN_NO_SIGNAL_HANDLERS = "1";
      return JSON.parse(execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env,
      }).trim());
    };
    // 默认(未设 guard):信号钩子注册
    const unguarded = run(false);
    assert.ok(unguarded.exit >= 1, "子进程:'exit' 钩子必须注册");
    assert.ok(unguarded.sigint >= 1 && unguarded.sigterm >= 1, "默认必须注册 SIGINT/SIGTERM(断连后退出)");
    // guard 生效:信号钩子不注册(独立脚本/测试不被全局 handler 干扰)
    const guarded = run(true);
    assert.ok(guarded.exit >= 1, "guard 只关信号钩子,'exit' 兜底仍必须注册");
    assert.equal(guarded.sigint, 0, "MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时不得注册 SIGINT");
    assert.equal(guarded.sigterm, 0, "MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时不得注册 SIGTERM");
  });
});

describe("browser-pool:导出面盘点钉死(F3,2026-09-03 legacy 退役收缩 18→14 —— 注释在 src/browser-pool.ts 公共 API 节)", () => {
  /** 递归收集 dist 下全部 .js(找 browser-pool 的运行时 import 方,测试在 dist-test 不算)。 */
  function walkJs(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walkJs(p));
      else if (e.name.endsWith(".js")) out.push(p);
    }
    return out;
  }

  test("运行时值导出恰 15 符号(20 含类型);三渲染消费方值导入并集恰 5 符号且无第四消费方", () => {
    const runtimeExports = Object.keys(pool);
    assert.equal(runtimeExports.length, 15, "运行时值导出面变化必须是有意为之:同步 F3 注释 + 本断言 + 三消费方核查(2026-09-03 +clampIntEnv=15)");
    // legacy 退役删除面(2026-09-03):LEGACY_ESCAPE_REMOVAL_DATE / PROFILE_DIR_PREFIX /
    // DEFAULT_BROWSER_IDLE_MS / setLauncherForTests —— 18-4=14,+clampIntEnv(边界语义可观测口)=15,残留即退役不彻底
    for (const gone of ["LEGACY_ESCAPE_REMOVAL_DATE", "PROFILE_DIR_PREFIX", "DEFAULT_BROWSER_IDLE_MS", "setLauncherForTests"]) {
      assert.ok(!runtimeExports.includes(gone), `legacy 专属导出 "${gone}" 必须已删除`);
    }

    // 值导入并集(类型在编译期擦除,BrowserLike/PageLike/CDPSessionLike 不出现在 dist import 行)
    const allowed = ["BrowserUnavailableError", "RENDER_UNAVAILABLE_CODE", "acquireBrowser", "releaseBrowser", "withBrowser"];
    const importers = walkJs(distDir)
      .filter((f) => /from\s+"[^"]*browser-pool\.js"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(distDir, f));
    assert.deepEqual(
      [...importers].sort(),
      ["interactive-html/export-png.js", "render-svg.js", "render-video.js"],
      "browser-pool 的运行时消费方必须恰为三渲染文件 —— 出现第四消费方即 F3 盘点失效",
    );
    const imported = new Set<string>();
    for (const rel of importers) {
      const m = readFileSync(path.join(distDir, rel), "utf8").match(/import\s+\{([^}]*)\}\s+from\s+"[^"]*browser-pool\.js"/);
      assert.ok(m, `${rel} 应有具名 import(上述过滤器按 import 语句命中)`);
      for (const name of (m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        assert.ok(allowed.includes(name), `${rel} 导入新符号 "${name}" —— 运行时 API 子集扩张,须同步 F3 注释与本用例`);
        imported.add(name);
      }
    }
    assert.deepEqual([...imported].sort(), allowed, "5 个值符号必须全部在用(出现死符号=该清理而非扩面)");
  });
test("clampIntEnv 边界语义直接钉死(low finding:legacy 删除后唯一存活消费方 heartbeat 的夹取/截断须有直接断言)", () => {
  // 直测导出的 clampIntEnv(raw, fallback, min, max):负值夹下界/越上界夹封顶/小数截断/非有限回落
  assert.equal(pool.clampIntEnv("-5", 30000, 50, 60000), 50, "负值夹到下界");
  assert.equal(pool.clampIntEnv("70000", 30000, 50, 60000), 60000, "越上界夹到封顶");
  assert.equal(pool.clampIntEnv("2000.9", 30000, 50, 60000), 2000, "小数截断");
  assert.equal(pool.clampIntEnv("abc", 30000, 50, 60000), 30000, "非有限回落 fallback");
  assert.equal(pool.clampIntEnv(undefined, 30000, 50, 60000), 30000, "未设回落 fallback");
});
});
