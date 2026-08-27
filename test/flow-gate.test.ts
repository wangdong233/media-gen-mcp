/**
 * 渠道治理单元测试:链即开关 + toolDeadlineMs 防 stall 截止
 * (2026-08-26 简化:S000 硬门 flow.enabled/disabledReason 删除 —— 渠道启用唯一控制源 = 优先级链,
 *  链中不配置 = 不启用;显式 provider=flow 点名永远合法,环境不可用由前置检测 S1xx 结构化报告)。
 *
 * 覆盖面:
 *   1. parseFlowSection 容错:toolDeadlineMs 默认 110s / 非法值回默认;
 *      videoConfirm 默认开仅显式 false 关;confirmTtlMs 非法回默认 10min
 *   2. 链即开关语义:未配置链 → resolveProvider 未点名不指向 flow(optIn 门禁,provider-priority
 *      详测;此处钉契约要点)+ 显式 provider=flow 点名永远合法(原 S000 拦截的反向断言)
 *   3. 防 stall 截止:长操作超 toolDeadlineMs → [flow] S410 结构化错(底层不取消);
 *      缺省截止不小于默认量级(不立即误抛);0 点工具入口(flowStatus/mediaStatus/deleteAssets/
 *      shareMedia/cancelGenerations)逐一同样受保护(三审 finding-5;listPresetVoices 已随角色域移除删)
 *
 * 导入方式:与 provider-priority.test.ts 同范式(createRequire 引编译产物 dist/;
 * npm test 先 build 再 build:tests,顺序保证存在)。
 * 测试隔离铁律:__priorityOverrideForTests 用后必还原。
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { parseFlowSection } = require_(path.join(distDir, "config.js"));
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
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
});

// ═══ 1. 配置解析(顶级 flow 段;enabled 已删 —— 链即开关) ═══

describe("parseFlowSection(容错:非法值回默认,配置错误不 fatal)", () => {
  const DEFAULTS = { toolDeadlineMs: 110_000, videoConfirm: true, confirmTtlMs: 600_000 };
  test("缺省/空对象 → 全默认(110s 截止 + 确认门开 + 10min TTL)", () => {
    assert.deepEqual(parseFlowSection(undefined), DEFAULTS);
    assert.deepEqual(parseFlowSection({}), DEFAULTS);
    assert.deepEqual(parseFlowSection(null), DEFAULTS);
  });

  test("历史 enabled 键已删除:解析结果不再含 enabled(未知键静默忽略)", () => {
    const r = parseFlowSection({ enabled: false }) as Record<string, unknown>;
    assert.equal("enabled" in r, false, "enabled 字段已随 S000 硬门删除(链即开关)");
  });

  test("toolDeadlineMs:合法值透传;非正数/类型错回默认 110s", () => {
    assert.equal(parseFlowSection({ toolDeadlineMs: 5_000 }).toolDeadlineMs, 5_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: -5 }).toolDeadlineMs, 110_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: "90s" }).toolDeadlineMs, 110_000);
    assert.equal(parseFlowSection({ toolDeadlineMs: Number.NaN }).toolDeadlineMs, 110_000);
  });

  test("videoConfirm:默认开(防误耗红线下误门代价远小于漏门);仅显式 false 关;confirmTtlMs 非法回默认 10min", () => {
    assert.equal(parseFlowSection({}).videoConfirm, true);
    assert.equal(parseFlowSection({ videoConfirm: false }).videoConfirm, false);
    assert.equal(parseFlowSection({ videoConfirm: "false" }).videoConfirm, true, "字符串 false 不关(类型错=默认开)");
    assert.equal(parseFlowSection({ confirmTtlMs: 60_000 }).confirmTtlMs, 60_000);
    assert.equal(parseFlowSection({ confirmTtlMs: -1 }).confirmTtlMs, 600_000);
    assert.equal(parseFlowSection({ confirmTtlMs: "10m" }).confirmTtlMs, 600_000);
  });
});

// ═══ 2. 链即开关(原 S000 硬门的替代语义;详细链行为见 provider-priority.test.ts) ═══

describe("链即开关(不配置 = 不自动路由;显式点名永远合法)", () => {
  test("未配置链:resolveProvider 未点名 → 不指向 flow(optIn 门禁;详细矩阵见 provider-priority.test.ts)", () => {
    reg.__priorityOverrideForTests.image = null;
    const r = resolveProvider(undefined, undefined, "image");
    assert.notEqual(r.provider.name, "flow", "flow 未列入链 = 未启用,默认路由绝不指向它");
  });

  test("显式 provider=flow 点名 → 正常解析(原 S000 拦截的反向钉死:点名永远合法)", () => {
    reg.__priorityOverrideForTests.image = null;
    assert.equal(resolveProvider("flow", undefined, "image").provider.name, "flow");
  });

  test("配置链含 flow → getProviderPriority 保留(列入 = 启用,保序)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.deepEqual(getProviderPriority("image"), ["flow", "agnes", "zhipu"]);
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });

  test("FlowProvider 不再实现 disabledReason(钩子已删,防回潮)", () => {
    const p = new FlowProvider({});
    assert.equal((p as any).disabledReason, undefined, "S000 钩子已删除 —— 渠道启用唯一控制源是优先级链");
  });

  test("未知渠道报错不受影响(零网络)", () => {
    assert.throws(() => resolveProvider("no-such-provider", undefined, "image"), /Unknown provider/);
  });
});

// ═══ 3. 防 stall 截止(withDeadline 思想,provider 边界) ═══

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
    const p = new FlowProvider({ transport: new HangingTransport() as any, flowCfg: { toolDeadlineMs: 60 } });
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

  // 三审 finding-5:0 点只读/管理工具路径(flowStatus/mediaStatus/deleteAssets/shareMedia/
  // cancelGenerations)曾缺工具级截止 —— 单次(listPresetVoices 已删)
  // pageFetch 有 45s eval 超时,但多步链(逐 id 循环 + 前后 projectData)可叠加远超 120s 红线。
  // 每个入口都必须在 toolDeadlineMs 处转 [flow] S410(mutant:去掉任一包裹 → 该用例超时失败)。
  test("0 点工具入口全部受截止保护:悬挂 CDP → S410(逐一覆盖,缺包裹即败)", async () => {
    const expectS410 = async (label: string, fn: () => Promise<unknown>) => {
      // 双保险 race:若缺截止包裹(悬挂),1.5s 后以明确断言消息失败,而非钉住测试进程
      const e = (await Promise.race([
        Promise.resolve().then(fn).then(
          () => { throw new Error(`${label}: 应在截止处抛 S410,实际正常返回`); },
          (err: unknown) => err,
        ),
        sleep(1500).then(() => new Error(`${label}: 1.5s 内未抛 S410 —— 缺 withToolDeadline 包裹(防 stall 红线)`)),
      ])) as { code?: string; message?: string };
      assert.ok(e && e.code === "S410", `${label}: 期望 S410,实际 ${e?.message?.slice(0, 120)}`);
    };
    const mk = () => new FlowProvider({ transport: new HangingTransport() as any, flowCfg: { toolDeadlineMs: 60 } });
    await expectS410("flowStatus()", () => mk().flowStatus());
    await expectS410("mediaStatus(id)", () => mk().mediaStatus("media-x-1"));
    await expectS410("deleteAssets(ids)", () => mk().deleteAssets(["media-x-1"]));
    await expectS410("shareMedia(ids)", () => mk().shareMedia(["media-x-1"]));
    await expectS410("cancelGenerations(ids)", () => mk().cancelGenerations(["media-x-1"]));
  });
});
