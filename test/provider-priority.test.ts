/**
 * C 任务(渠道优先级链)单元测试 —— 零网络零消耗(全程 override 注入 / Stub transport,不触真实 CDP/积分)。
 *
 * 覆盖面:
 *   1. parseProviderPriority:config 数组 / env csv / 小写归一 / 去重 / 非法项剔除 / 空 → undefined
 *   2. getProviderPriority:override 注入缝 + 未知 provider 剔除(warn 不 fatal)
 *   3. resolveProvider 链头:priority[0];熔断窗口内跳过(链降级到下一成员);未配置 = legacy 默认(零回归)
 *   4. getFallbackProvider 排序统一:priority 位置优先于 tier;optIn 门禁(未列入不进任何链,列入才进;
 *      链内成员豁免 configured 过滤 —— flow 首次探测前 configured=false)
 *   5. isChainAdvanceable:precondition(S1xx)推进;S301 业务错不推进;上游 5xx/429 推进
 *   6. flow 60s 软熔断:notifyUnavailable → health().cooldown;ensureReady 冷却窗口内零探测直抛缓存错误;
 *      窗口过期自动重探
 *   7. isRequestPinned(三审 finding-1):opt-in 渠道(flow)显式点名 → 钉死直抛;免费渠道
 *      (agnes/zhipu)显式点名 → 不钉死(失败按链回落带 warning)—— 与收窄后的 schema 契约一致
 *
 * 导入方式:与 flow.test.ts 同范式(createRequire 引编译产物 dist/;npm test 先 build 再 build:tests)。
 * 测试隔离铁律:__priorityOverrideForTests 置 null,隔离 ~/.media-gen-mcp/config.json 的本机差异
 * (本机已配 imageProviderPriority 含 flow;CI 无 config)—— 两环境断言结果逐字节一致。
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { parseProviderPriority } = require_(path.join(distDir, "config.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));
const { getProviderPriority, getFallbackProvider, resolveProvider, getProvider } = reg;
const { FlowProvider, FlowError } = require_(path.join(distDir, "providers/flow.js"));
const { isChainAdvanceable, isFallbackWorthy, isRequestPinned } = require_(path.join(distDir, "providers/http.js"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 默认「未配置优先级」(legacy 语义);个别用例按需覆盖后必须还原。
before(() => {
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
});

// ═══ 1. 配置解析 ═══

describe("parseProviderPriority(配置形态:config 数组 > env csv)", () => {
  test("config 数组:小写归一 + 去重(保序)", () => {
    assert.deepEqual(parseProviderPriority(["Flow", "agnes", "zhipu", "AGNES"], "X_NONE"), ["flow", "agnes", "zhipu"]);
  });
  test("env 逗号分隔:trim + 剔空", () => {
    process.env.X_NONE = "flow, zhipu ,,agnes";
    try {
      assert.deepEqual(parseProviderPriority(undefined, "X_NONE"), ["flow", "zhipu", "agnes"]);
    } finally {
      delete process.env.X_NONE;
    }
  });
  test("config 数组优先于 env;非法项(非字符串)剔除", () => {
    process.env.X_NONE = "zhipu";
    try {
      assert.deepEqual(parseProviderPriority(["flow", 42, null as any, "agnes"], "X_NONE"), ["flow", "agnes"]);
    } finally {
      delete process.env.X_NONE;
    }
  });
  test("全空/空数组 → undefined(= 未配置 = legacy 行为)", () => {
    assert.equal(parseProviderPriority([], "X_NONE"), undefined);
    assert.equal(parseProviderPriority(["", "  "], "X_NONE"), undefined);
    assert.equal(parseProviderPriority(undefined, "X_NONE"), undefined);
  });
});

// ═══ 2. registry 优先级解析 ═══

describe("getProviderPriority(override 注入缝 + 未知 provider 剔除)", () => {
  test("未知 provider 名剔除(warn 不 fatal),已知保序", () => {
    reg.__priorityOverrideForTests.image = ["flow", "no-such-provider", "agnes"];
    try {
      assert.deepEqual(getProviderPriority("image"), ["flow", "agnes"]);
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("null override = 强制未配置(隔离本机 config 差异)", () => {
    assert.equal(getProviderPriority("image"), undefined);
    assert.equal(getProviderPriority("video"), undefined);
  });
});

// ═══ 3. resolveProvider 链头 ═══

describe("resolveProvider 链头(priority[0];熔断跳过;未配置零回归)", () => {
  test("配置 imageProviderPriority=[flow,agnes,zhipu] 且未点名 provider → 链头 = flow", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "flow");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("链头 + 他家 model → 自动路由不变(model 归属优先)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      const r = resolveProvider(undefined, "cogview-4", "image");
      assert.equal(r.provider.name, "zhipu");
      assert.equal(r.autoRouted, true);
      assert.equal(r.routedFrom, "flow");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("未配置 priority → legacy 默认 defaultImageProvider(零回归)", () => {
    const { config } = require_(path.join(distDir, "config.js"));
    assert.equal(resolveProvider(undefined, undefined, "image").provider.name, config.defaultImageProvider);
  });
  test("链头在 60s 熔断窗口内 → 降级到下一成员;窗口过期恢复(惰性:只读 health,零探测)", async () => {
    const flow = getProvider("flow");
    const prevCooldownMs = flow.cooldownMs;
    flow.cooldownMs = 40; // 实例字段,便于测试调短
    flow.notifyUnavailable(new FlowError("S100", "CDP 不可连", { precondition: true }));
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.equal(flow.health().cooldown, true);
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "agnes", "熔断窗口内链头降级 agnes");
      await sleep(90);
      assert.equal(flow.health().cooldown, false);
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "flow", "窗口过期恢复 flow 链头");
    } finally {
      reg.__priorityOverrideForTests.image = null;
      flow.cooldownMs = prevCooldownMs;
    }
  });
});

// ═══ 4. getFallbackProvider 排序统一(优先级与 fallback 同一管线)═══

describe("getFallbackProvider(priority 位置优先于 tier;optIn 门禁)", () => {
  test("priority=[zhipu,agnes]:fallback(flow) → zhipu(list 序战胜 tier,agnes tier=10 > zhipu=5)", () => {
    reg.__priorityOverrideForTests.image = ["zhipu", "agnes"];
    try {
      assert.equal(getFallbackProvider("flow", "image", {})?.name, "zhipu");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("priority=[flow,agnes,zhipu]:fallback(flow) → agnes;fallback(agnes) → flow(链=偏好序,可向上回落)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.equal(getFallbackProvider("flow", "image", {})?.name, "agnes");
      // agnes 失败 → 链上下一可用 = flow(pos 0;经 config 显式同意放行 optIn+configured 豁免)
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "flow");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("未配置 priority:optIn 门禁生效 —— flow 不进任何模态隐式链;视频链 = agnes↔zhipu(零回归)", () => {
    assert.notEqual(getFallbackProvider("agnes", "image", {})?.name, "flow");
    assert.notEqual(getFallbackProvider("zhipu", "image", {})?.name, "flow");
    assert.equal(getFallbackProvider("agnes", "video", { mode: "text-to-video" })?.name, "zhipu");
    assert.notEqual(getFallbackProvider("agnes", "video", { mode: "text-to-video" })?.name, "flow");
  });
  test("flow 在熔断窗口内 → 即使列入链也被跳过(cooldown 过滤对链内成员同样生效)", async () => {
    const flow = getProvider("flow");
    const prevCooldownMs = flow.cooldownMs;
    flow.cooldownMs = 40;
    flow.notifyUnavailable(new Error("cooldown probe"));
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu", "flow 熔断 → 跳过");
      await sleep(90);
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "flow", "窗口过期 → flow 回链");
    } finally {
      reg.__priorityOverrideForTests.image = null;
      flow.cooldownMs = prevCooldownMs;
    }
  });
});

// ═══ 4b. 钉死守卫(三审 finding-1:契约收窄后的语义回归)═══

describe("isRequestPinned(钉死守卫:opt-in 渠道显式点名直抛;免费渠道带告警回落)", () => {
  test("opt-in 渠道:显式 provider 或 model 归属 → 钉死;默认路由到达不钉死(链可推进)", () => {
    assert.equal(isRequestPinned("flow", undefined, true), true, "显式 provider=flow 钉死");
    assert.equal(isRequestPinned(undefined, "NARWHAL", true), true, "model 归属路由到 flow 同样钉死");
    assert.equal(isRequestPinned(undefined, undefined, true), false, "链头默认路由到达 opt-in 渠道不钉死(环境前置失败可推进)");
  });
  test("免费渠道(agnes/zhipu):显式点名也不钉死(失败仍按链回落带 warning;零回归基线)", () => {
    assert.equal(isRequestPinned("agnes", undefined, false), false);
    assert.equal(isRequestPinned("zhipu", "cogview-4", false), false, "model 归属免费渠道同样不钉死");
    assert.equal(isRequestPinned(undefined, undefined, false), false);
  });
  test("与 registry 真源一致:resolveProvider 解析结果的 requiresOptIn 喂入判定(opt-in=flow,免费=agnes/zhipu)", () => {
    const flowOptIn = resolveProvider("flow", undefined, "image").provider.requiresOptIn?.("image") === true;
    const agnesOptIn = resolveProvider("agnes", undefined, "image").provider.requiresOptIn?.("image") === true;
    const zhipuOptIn = resolveProvider("zhipu", undefined, "image").provider.requiresOptIn?.("image") === true;
    assert.equal(flowOptIn, true, "flow 是唯一 opt-in 渠道(当前注册表)");
    assert.equal(agnesOptIn, false);
    assert.equal(zhipuOptIn, false);
    // 端到端语义:显式点名 flow → 直抛;显式点名 agnes/zhipu → 不钉死(可回落,见 getFallbackProvider 用例)
    assert.equal(isRequestPinned("flow", undefined, flowOptIn), true);
    assert.equal(isRequestPinned("agnes", undefined, agnesOptIn), false);
    assert.equal(isRequestPinned("zhipu", undefined, zhipuOptIn), false);
  });
});

// ═══ 5. isChainAdvanceable(失败分类)═══

describe("isChainAdvanceable(= isFallbackWorthy ∪ 环境前置失败)", () => {
  const mk = (code: string, opts?: any) => new FlowError(code, "x", opts);
  test("S100/S101/S102/S104 precondition → 推进(请求从未提交,非业务错)", () => {
    for (const c of ["S100", "S101", "S102", "S104"]) {
      assert.equal(isChainAdvanceable(mk(c, { precondition: true })), true, c);
    }
  });
  test("S301 参数错 / S401 媒体错 → 不推进(保留原始错误)", () => {
    assert.equal(isChainAdvanceable(mk("S301")), false);
    assert.equal(isChainAdvanceable(mk("S401")), false);
  });
  test("上游 5xx / 401 / 429(带 flowStatus)→ 推进(既有 isFallbackWorthy 语义)", () => {
    assert.equal(isChainAdvanceable(mk("S201", { flowStatus: 500 })), true);
    assert.equal(isChainAdvanceable(mk("S201", { flowStatus: 429 })), true);
    assert.equal(isChainAdvanceable(mk("S103", { flowStatus: 0 })), true);
  });
  test("isFallbackWorthy 语义保留(precondition 不泄漏进单跳 fallback 既有路径)", () => {
    assert.equal(isFallbackWorthy(mk("S100", { precondition: true })), false, "S100 无 status → 单跳 fallback 仍不认(现行为)");
    const httpish: any = new Error("rate limited");
    httpish.status = 429;
    assert.equal(isFallbackWorthy(httpish), true);
  });
});

// ═══ 6. flow 60s 软熔断(零探测快速失败)═══

/** open() 永远失败的 stub:S100 precondition(模拟 Chrome/CDP 未开)。 */
class DeadCdpTransport {
  opens = 0;
  async open() {
    this.opens++;
    throw new FlowError("S100", "CDP 127.0.0.1:9223 不可连", { precondition: true });
  }
  async pageFetch() { throw new Error("unreachable"); }
  async recaptchaToken() { throw new Error("unreachable"); }
}

describe("flow 60s 软熔断(notifyUnavailable → ensureReady 零探测)", () => {
  test("失败后 notifyUnavailable:冷却窗口内 ensureReady 直抛缓存错误(opens 计数不增);过期重探", async () => {
    const t = new DeadCdpTransport();
    const p = new FlowProvider({ transport: t as any });
    p.cooldownMs = 50; // 实例字段,便于测试调短
    const e1 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.ok(e1 instanceof FlowError && e1.code === "S100");
    assert.equal(e1.precondition, true);
    assert.equal(t.opens, 1);
    assert.equal(p.health().cooldown, false, "失败本身不打熔断(链 walk 的 notifyUnavailable 负责)");
    p.notifyUnavailable(e1);
    assert.equal(p.health().cooldown, true);
    const e2 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.equal(e2, e1, "冷却窗口内直抛缓存错误(零探测)");
    assert.equal(t.opens, 1, "窗口内不重复探测 CDP");
    await sleep(110);
    const e3 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.equal(t.opens, 2, "窗口过期重探");
    assert.ok(e3 instanceof FlowError);
  });
  test("registry flow 实例同语义(notifyUnavailable 后 health().cooldown,供链头跳过)", () => {
    const flow = getProvider("flow");
    const prev = flow.cooldownMs;
    flow.cooldownMs = 30;
    flow.notifyUnavailable(new Error("probe"));
    try {
      assert.equal(flow.health().cooldown, true);
    } finally {
      // 还原:等待窗口过期,免污染同文件后续用例
      return sleep(35).then(() => { flow.cooldownMs = prev; });
    }
  });
});
