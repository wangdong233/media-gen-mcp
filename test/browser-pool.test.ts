/**
 * browser-pool 单元测试(2026-09-01 P0 根治,报告 §8.1/§8.2)。
 *
 * 覆盖任务验收点(全 mock launcher,零真实 Chrome/零网络/零积分):
 *  1. 单例复用 —— 两次 withBrowser 同一 browser 实例,launcher 只调一次
 *  2. 并发安全 —— 并发 withBrowser 单飞 launch 一次;引用计数正确归零
 *  3. 引用计数抑制空闲回收 —— 借用挂起期间 idle 到期不 close;归还后才回收
 *  4. 空闲回收 + profile 目录删除 —— MEDIA_GEN_BROWSER_IDLE_MS 调短,回收后 close + rm + exit 登记清零
 *  5. 异常路径归还 —— fn 抛错 → withBrowser reject、引用归零、浏览器保留复用(不误杀)
 *  6. 不可用路径 —— launcher 返回 null → BrowserUnavailableError、引用归零
 *  7. exit 钩子 —— 模块加载即注册('exit' 必注册;SIGINT/SIGTERM 受
 *     MEDIA_GEN_NO_SIGNAL_HANDLERS 门控,子进程验证);syncCleanupOnExit 同步 SIGKILL + rm 目录
 *  8. getBrowser probe 兼容语义 —— 不加引用计数;不可用返回 null
 *
 * License:本文件为 P0 根治自研。
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const pool: any = await import(pathToFileURL(path.join(distDir, "browser-pool.js")).href);

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** mock 浏览器形状(与 pool.BrowserLike 结构兼容;pool 经动态 import 为 any,无类型摩擦)。 */
interface MockBrowser {
  newPage(): Promise<unknown>;
  close(): Promise<void>;
  process(): { kill(signal?: string): void } | null;
  once?(event: string, listener: () => void): unknown;
}

interface MockState {
  launchCalls: number;
  closed: boolean;
  killSignals: (string | undefined)[];
  profileDir: string;
  disconnectListeners: (() => void)[];
}

function makeLauncher() {
  const state: MockState = {
    launchCalls: 0,
    closed: false,
    killSignals: [],
    profileDir: "",
    disconnectListeners: [],
  };
  const launcher = async (): Promise<{ browser: MockBrowser; profileDir: string }> => {
    state.launchCalls++;
    state.profileDir = mkdtempSync(path.join(os.tmpdir(), "browser-pool-test-"));
    const browser: MockBrowser = {
      async newPage() { throw new Error("pool 层测试不触 page"); },
      async close() { state.closed = true; },
      process: () => ({ kill: (sig?: string) => { state.killSignals.push(sig); } }),
      once: (ev: string, cb: () => void) => { if (ev === "disconnected") state.disconnectListeners.push(cb); },
    };
    return { browser, profileDir: state.profileDir };
  };
  return { launcher, state };
}

const IDLE_ENV = "MEDIA_GEN_BROWSER_IDLE_MS";
let savedIdleEnv: string | undefined;

beforeEach(async () => {
  savedIdleEnv = process.env[IDLE_ENV];
  await pool.setLauncherForTests(null); // 复位:关停残留实例 + 恢复默认 launcher
});

afterEach(async () => {
  if (savedIdleEnv === undefined) delete process.env[IDLE_ENV];
  else process.env[IDLE_ENV] = savedIdleEnv;
  await pool.shutdownBrowser();
  await pool.setLauncherForTests(null);
});

describe("browser-pool:单例与并发(P0 §8.1)", () => {
  test("两次渲染复用同一 browser 实例,launcher 只调一次", async () => {
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    const seen: MockBrowser[] = [];
    await pool.withBrowser((b: MockBrowser) => { seen.push(b); return Promise.resolve(1); });
    await pool.withBrowser((b: MockBrowser) => { seen.push(b); return Promise.resolve(2); });
    assert.equal(state.launchCalls, 1, "第二次调用必须复用单例,不得再 launch");
    assert.equal(seen.length, 2);
    assert.strictEqual(seen[0], seen[1], "两次借用必须是同一实例");
    assert.equal(pool.getBrowserPoolState().launchCount, 1);
  });

  test("并发 withBrowser:单飞 launch 一次,全部拿到同一实例,引用计数归零", async () => {
    const { launcher, state } = makeLauncher();
    // 慢 launch:放大并发窗口,验证单飞锁
    const slow = async () => { await delay(40); return launcher(); };
    await pool.setLauncherForTests(slow);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => pool.withBrowser(async (b: MockBrowser) => { await delay(10); return { i, b }; })),
    );
    assert.equal(state.launchCalls, 1, "并发必须共享同一次 launch(单飞锁)");
    for (const r of results) assert.strictEqual(r.b, results[0].b, "并发借用必须是同一实例");
    const st = pool.getBrowserPoolState();
    assert.equal(st.refCount, 0, "全部归还后引用计数必须归零");
    assert.equal(st.launched, true, "默认空闲 5min 内实例保留(热复用)");
  });

  test("空闲回收(默认 5min 可被 env 调短):归还后 close + 删 profile 目录 + exit 登记清零", async () => {
    process.env[IDLE_ENV] = "20";
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await pool.withBrowser(() => Promise.resolve());
    assert.ok(existsSync(state.profileDir), "借用期间 profile 目录存在");
    assert.equal(pool.getBrowserPoolState().exitEntries, 1, "launch 后必须进程级登记");
    await delay(250); // idle 20ms + 异步 close 余量
    assert.equal(state.closed, true, "空闲到期必须 close 浏览器");
    assert.equal(existsSync(state.profileDir), false, "空闲回收必须删除 profile 目录(旧实现 114 目录/7.2GB 残留的根治点)");
    const st = pool.getBrowserPoolState();
    assert.equal(st.launched, false);
    assert.equal(st.exitEntries, 0, "close 后必须从 exit 登记移除");
  });

  test("借用挂起期间空闲到期不回收(引用计数抑制);归还后才回收", async () => {
    process.env[IDLE_ENV] = "20";
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const job = pool.withBrowser(async () => { await gate; });
    await delay(150); // 若无引用计数,20ms idle 早已 close
    assert.equal(state.closed, false, "长渲染期间浏览器绝不能被空闲回收拆掉");
    assert.equal(pool.getBrowserPoolState().refCount, 1);
    release();
    await job;
    await delay(250);
    assert.equal(state.closed, true, "归还归零后空闲回收生效");
  });

  test("再次借用会重置空闲计时(touch 语义)", async () => {
    process.env[IDLE_ENV] = "120";
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await pool.withBrowser(() => Promise.resolve());
    await delay(60); // 走到 60/120ms
    await pool.withBrowser(() => Promise.resolve()); // touch:计时从现在重新武装
    await delay(60); // 距上次 touch 仅 60ms < 120ms
    assert.equal(state.closed, false, "touch 必须重置空闲计时");
    await delay(200);
    assert.equal(state.closed, true);
  });
});

describe("browser-pool:异常与不可用路径", () => {
  test("fn 抛错 → withBrowser 拒绝,引用归零,浏览器保留复用(不误杀)", async () => {
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await assert.rejects(
      pool.withBrowser(() => Promise.reject(new Error("render boom"))),
      /render boom/,
    );
    assert.equal(state.closed, false, "业务异常不得关闭单例(下次渲染继续复用)");
    assert.equal(pool.getBrowserPoolState().refCount, 0, "异常路径 finally 必须归还引用");
    // 复用不受影响
    await pool.withBrowser((b: MockBrowser) => Promise.resolve(b));
    assert.equal(state.launchCalls, 1);
  });

  test("launcher 返回 null → BrowserUnavailableError,引用归零,可重试", async () => {
    await pool.setLauncherForTests(async () => null);
    await assert.rejects(pool.withBrowser(() => Promise.resolve()), (e: Error) => e.name === "BrowserUnavailableError");
    assert.equal(pool.getBrowserPoolState().refCount, 0, "不可用路径也必须归还引用");
    // 环境恢复后可重新 launch
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(state.launchCalls, 1);
  });

  test("launcher 意外抛错(非「不可用」)→ 错误上抛且引用计数不泄漏", async () => {
    await pool.setLauncherForTests(async () => { throw new Error("mkdtemp exploded"); });
    await assert.rejects(pool.withBrowser(() => Promise.resolve()), /mkdtemp exploded/);
    assert.equal(pool.getBrowserPoolState().refCount, 0, "launch 意外异常路径也必须回退引用计数");
    // 顺序调用方重试不受污染
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await pool.withBrowser(() => Promise.resolve());
    assert.equal(state.launchCalls, 1);
  });

  test("getBrowser probe 兼容语义:不加引用计数;不可用返回 null(旧 render-svg 契约)", async () => {
    await pool.setLauncherForTests(async () => null);
    assert.equal(await pool.getBrowser(), null);
    const { launcher } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    const b = await pool.getBrowser();
    assert.ok(b, "可用时 probe 返回实例");
    assert.equal(pool.getBrowserPoolState().refCount, 0, "probe 不占引用(渲染主路径才计数)");
  });

  test("close 失败兜底同步 SIGKILL + 仍删 profile 目录", async () => {
    process.env[IDLE_ENV] = "20";
    const profileDir = mkdtempSync(path.join(os.tmpdir(), "browser-pool-test-"));
    const state = { killSignals: [] as string[] };
    const badBrowser: MockBrowser = {
      async newPage() { throw new Error("unused"); },
      async close() { throw new Error("chrome already dead"); },
      process: () => ({ kill: (sig?: string) => { state.killSignals.push(sig ?? "?"); } }),
    };
    await pool.setLauncherForTests(async () => ({ browser: badBrowser, profileDir }));
    await pool.withBrowser(() => Promise.resolve());
    await delay(250);
    assert.deepEqual(state.killSignals, ["SIGKILL"], "close 抛错时必须同步 SIGKILL 兜底(防孤儿)");
    assert.equal(existsSync(profileDir), false, "兜底路径同样删除 profile 目录");
  });
});

describe("browser-pool:exit 钩子(P0 §8.2 —— 堵 SIGKILL 以外的孤儿路径)", () => {
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
    assert.ok(unguarded.sigint >= 1 && unguarded.sigterm >= 1, "默认必须注册 SIGINT/SIGTERM(关 Chrome 后退出)");
    // guard 生效:信号钩子不注册(独立脚本/测试不被全局 handler 干扰)
    const guarded = run(true);
    assert.ok(guarded.exit >= 1, "guard 只关信号钩子,'exit' 兜底仍必须注册");
    assert.equal(guarded.sigint, 0, "MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时不得注册 SIGINT");
    assert.equal(guarded.sigterm, 0, "MEDIA_GEN_NO_SIGNAL_HANDLERS=1 时不得注册 SIGTERM");
  });

  test("syncCleanupOnExit:同步 SIGKILL Chrome 主进程 + rmSync profile 目录 + 登记清零(零 await)", async () => {
    const { launcher, state } = makeLauncher();
    await pool.setLauncherForTests(launcher);
    await pool.withBrowser(() => Promise.resolve());
    assert.ok(existsSync(state.profileDir));
    pool.syncCleanupOnExit(); // 'exit' 钩子注册的正是这个函数体
    assert.deepEqual(state.killSignals, ["SIGKILL"], "exit 路径必须同步杀主进程(Helper 随管道断退出)");
    assert.equal(existsSync(state.profileDir), false, "exit 路径必须同步删 profile 目录");
    const st = pool.getBrowserPoolState();
    assert.equal(st.exitEntries, 0);
    assert.equal(st.launched, false, "清理后池内不得残留已杀实例(幂等)");
  });
});
