/**
 * flow.enabled S000 硬门 + toolDeadlineMs 防 stall 截止单元测试
 * (2026-08-24 合包时吸收自 flow-mcp test/flow-config.test.ts / S000 门禁与 withDeadline 用例)。
 *
 * 覆盖面:
 *   1. parseFlowSection 容错:缺省 enabled=true / 仅显式 false 才禁用 / 类型错回默认开;
 *      toolDeadlineMs 默认 110s / 非法值(非正数/类型错)回默认
 *   2. FlowProvider.disabledReason():S000 文案自带配置路径 + 修复动作;未禁用 = undefined
 *   3. 优先级链剔除(硬门①):flow.enabled=false → getProviderPriority 剔 flow,链降级
 *   4. 显式点名拦截(硬门②):resolveProvider 显式 provider=flow / flow 模型 auto-route → S000;
 *      enabled=true 显式点名正常解析(对照,零回归)
 *   5. 防 stall 截止:长操作超 toolDeadlineMs → [flow] S410 结构化错(底层不取消);
 *      缺省截止不小于默认量级(不立即误抛)
 *
 * 导入方式:与 provider-priority.test.ts 同范式(createRequire 引编译产物 dist/;
 * npm test 先 build 再 build:tests,顺序保证存在)。
 * 测试隔离铁律:__priorityOverrideForTests 置 null + config.flow.enabled 用后必还原
 * (registry 的 FlowProvider 持 config.flow 对象引用,live 翻转即生效)。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { parseFlowSection, config } = require_(path.join(distDir, "config.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));
const { getProviderPriority, resolveProvider } = reg;
const { FlowProvider, FlowError } = require_(path.join(distDir, "providers/flow.js"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(() => {
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
  delete process.env.FLOW_TOOL_DEADLINE_MS;
});
after(() => {
  // 双保险:无论用例内部怎么翻,结束后必回「默认开」(隔离后续 dist-test 用例)
  config.flow.enabled = true;
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
});

/** 禁用翻转助手:改 config.flow.enabled(registry 的 FlowProvider 持同一对象引用,live 生效)。 */
async function withFlowDisabled<T>(fn: () => T | Promise<T>): Promise<T> {
  config.flow.enabled = false;
  try {
    return await fn();
  } finally {
    config.flow.enabled = true;
  }
}

// ═══ 1. 配置解析(顶级 flow 段) ═══

describe("parseFlowSection(容错:仅显式 false 才禁用)", () => {
  test("缺省/空对象 → enabled=true + toolDeadlineMs=110s(默认开,配置错误不 fatal)", () => {
    assert.deepEqual(parseFlowSection(undefined), { enabled: true, toolDeadlineMs: 110_000 });
    assert.deepEqual(parseFlowSection({}), { enabled: true, toolDeadlineMs: 110_000 });
    assert.deepEqual(parseFlowSection(null), { enabled: true, toolDeadlineMs: 110_000 });
  });

  test('flow.enabled=false 显式禁用;truthy / 类型错(字符串 "false")= 默认开', () => {
    assert.equal(parseFlowSection({ enabled: false }).enabled, false);
    assert.equal(parseFlowSection({ enabled: true }).enabled, true);
    assert.equal(parseFlowSection({ enabled: "false" }).enabled, true, "字符串 false 不禁用(类型错=默认开)");
    assert.equal(parseFlowSection({ enabled: 0 }).enabled, true, "0 是显式 falsy 但非布尔 —— 与 flow-mcp 同语义:仅字面 false 禁用");
  });

  test("toolDeadlineMs:合法值透传;非正数/类型错回默认 110s", () => {
    assert.equal(parseFlowSection({ toolDeadlineMs: 5_000 }).toolDeadlineMs, 5_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: -5 }).toolDeadlineMs, 110_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: "90s" }).toolDeadlineMs, 110_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: Number.NaN }).toolDeadlineMs, 110_000);
  });
});

// ═══ 2. provider 侧 S000 事实陈述 ═══

describe("FlowProvider.disabledReason(S000 文案:配置路径 + 修复动作)", () => {
  test("enabled=false → '[flow] S000' 前缀 + 配置文件路径 + 改回 true 指引", () => {
    const p = new FlowProvider({ flowCfg: { enabled: false }, configFile: "/tmp/cfg-x.json" });
    const msg = p.disabledReason()!;
    assert.match(msg, /^\[flow\] S000 /);
    assert.ok(msg.includes("/tmp/cfg-x.json"), "文案自带配置文件路径");
    assert.ok(msg.includes("改回 true"), "文案自带修复动作");
  });

  test("enabled=true / 未传 flowCfg → undefined(无门)", () => {
    assert.equal(new FlowProvider({ flowCfg: { enabled: true } }).disabledReason(), undefined);
    assert.equal(new FlowProvider({}).disabledReason(), undefined);
  });
});

// ═══ 3. 硬门①:优先级链剔除 ═══

describe("getProviderPriority(flow.enabled=false → 链剔除)", () => {
  test("链 [flow,agnes,zhipu] → [agnes,zhipu](flow 被剔除,链自动降级)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    return withFlowDisabled(() => {
      assert.deepEqual(getProviderPriority("image"), ["agnes", "zhipu"]);
    });
  });

  test("链全为 flow → undefined(等价未配置,回落 legacy 默认)", () => {
    reg.__priorityOverrideForTests.video = ["flow"];
    return withFlowDisabled(() => {
      assert.equal(getProviderPriority("video"), undefined);
    });
  });

  test("enabled=true(默认):链保留 flow(对照,零回归)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes"];
    try {
      assert.deepEqual(getProviderPriority("image"), ["flow", "agnes"]);
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
});

// ═══ 4. 硬门②:显式点名 / 模型归属路由拦截 ═══

describe("resolveProvider(明确指向被禁渠道 → S000,绝不静默换渠道)", () => {
  test("显式 provider=flow → 抛 [flow] S000(含修复动作)", () => {
    return withFlowDisabled(() => {
      assert.throws(
        () => resolveProvider("flow", undefined, "image"),
        (e: any) => /^\[flow\] S000 /.test(e.message) && e.message.includes("改回 true"),
      );
    });
  });

  test("flow 模型(NARWHAL)auto-route 到 flow → 同样 S000(不让模型归属绕过门)", () => {
    return withFlowDisabled(() => {
      assert.throws(() => resolveProvider("agnes", "NARWHAL", "image"), /\[flow\] S000 /);
    });
  });

  test("链头剔除后默认路由不指向 flow:resolveProvider(未点名) 正常解析非 flow 渠道", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes"];
    return withFlowDisabled(() => {
      const r = resolveProvider(undefined, undefined, "image");
      assert.notEqual(r.provider.name, "flow");
    });
  });

  test("enabled=true(默认):显式 provider=flow 正常解析(对照,零回归)", () => {
    assert.equal(resolveProvider("flow", undefined, "image").provider.name, "flow");
  });

  test("未知渠道报错不受门影响(非 S000;零网络)", () => {
    assert.throws(() => resolveProvider("no-such-provider", undefined, "image"), /Unknown provider/);
  });
});

// ═══ 5. 防 stall 戥止(withDeadline 思想,provider 边界) ═══

/** 悬挂传输:open 成功、pageFetch 悬挂 hangMs 后拒绝 —— 模拟 CDP 页面 fetch 卡死(零网络)。
 * 必须最终 settle(而非永挂):withToolDeadline 的截止 timer 只在 race settle 后才 clear,
 * 永挂会让默认截止(110s)的 timer 钉住 node --test 子进程的事件循环。 */
class HangingTransport {
  constructor(private readonly hangMs = Number.POSITIVE_INFINITY) {}
  async open() {
    return { pageUrl: "https://labs.google/fx/tools/flow" };
  }
  async pageFetch(): Promise<never> {
    if (this.hangMs === Number.POSITIVE_INFINITY) return await new Promise(() => {});
    await sleep(this.hangMs);
    throw new FlowError("S200", "悬挂到期(测试占位)");
  }
  async recaptchaToken(): Promise<string> {
    return "tok";
  }
}

describe("toolDeadlineMs(长操作截止 → [flow] S410)", () => {
  test("generateImage 超截止 → FlowError S410(结构化;提示 flow_status 复查 —— 底层不取消)", async () => {
    const p = new FlowProvider({ transport: new HangingTransport() as any, flowCfg: { enabled: true, toolDeadlineMs: 60 } });
    await assert.rejects(
      () => p.generateImage({ prompt: "x" } as any),
      (e: any) => {
        assert.ok(e instanceof FlowError, `应抛 FlowError,实际:${e?.constructor?.name}`);
        assert.equal(e.code, "S410");
        assert.match(e.message, /工具层截止/);
        assert.match(e.message, /flow_status/, "S410 提示经 flow_status 复查(诚实降级)");
        return true;
      },
    );
  });

  test("正常完成不受截止影响(快路径原样返回)", async () => {
    // StubTransport 快速完成 → 截止(即使 1ms)不误伤 —— Promise.race 先竞到结果
    const quick = new FlowProvider({
      transport: {
        open: async () => ({ pageUrl: "https://labs.google/fx/tools/flow" }),
        pageFetch: async () => { throw new FlowError("S200", "快速失败占位"); },
        recaptchaToken: async () => "tok",
      } as any,
      flowCfg: { toolDeadlineMs: 60_000 },
    });
    // 快速失败的业务错原样抛出(S200),不是 S410 —— 证明截止没有吞掉/改写正常路径错误
    await assert.rejects(() => quick.generateImage({ prompt: "x" } as any), (e: any) => e.code === "S200");
  });

  test("缺省截止为默认量级(110s):悬挂操作在短观察窗内不误抛 S410", async () => {
    // hangMs=250 < 观察断言后 settle → race 收敛 → 110s 截止 timer 被 clear(不钉住测试进程)
    const p = new FlowProvider({ transport: new HangingTransport(250) as any });
    let rejected = false;
    const probe = p.generateImage({ prompt: "x" } as any).catch(() => { rejected = true; });
    await sleep(150);
    assert.equal(rejected, false, "150ms 内不得误抛(默认截止 110s,而非过小默认)");
    await probe; // 等 settle(250ms 悬挂拒绝),清 timer + 吞掉占位错
  });
});
