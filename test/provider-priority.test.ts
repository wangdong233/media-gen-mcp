/**
 * 渠道路由单元测试(0.22.0 语义:优先级链已废弃 + disabledProviders 禁用表)—— 零网络零消耗。
 *
 * 新契约(2026-09-23 用户裁决,链体系移除):
 *   - provider 缺省 = 免费池头(defaultImageProvider,agnes;agnes↔zhipu 容灾互备);
 *   - opt-in 渠道(gemini/pixverse)点名即用;flow 经 disabledProviders 禁用(默认含 flow,死域);
 *   - 优先级链配置读到即忽略(config.ts 打废弃警告);getProviderPriority 恒 undefined。
 *
 * 覆盖面:
 *   1. parseProviderPriority:config 数组 / env csv / 小写归一 / 去重(解析仍在,供废弃警告路径)
 *   2. getProviderPriority:恒 undefined(链废弃;override/config 均无效)
 *   3. resolveProvider:未点名恒 defaultImageProvider;model 归属自动路由(禁用渠道不参与归属)
 *   4. getFallbackProvider:免费池 tier 降序;optIn 永不承接;禁用渠道永不承接
 *   5. isChainAdvanceable:precondition(S1xx)推进;S301 业务错不推进;上游 5xx/429 推进
 *   6. flow 60s 软熔断:notifyUnavailable → health().cooldown;ensureReady 冷却窗口内零探测直抛
 *   7. isRequestPinned(钉死守卫):opt-in 渠道显式点名 → 钉死直抛;免费渠道不钉死
 *   8. disabledProviders(0.22.0):默认 ["flow"];getProvider 单点拦截(零网络零 CDP);
 *      禁用渠道的模型无归属;解禁走独立 fixture 套件(test/provider-disabled.test.ts)
 *
 * 导入方式:与 flow.test.ts 同范式(createRequire 引编译产物 dist/;npm test 先 build 再 build:tests)。
 * 测试隔离铁律双层(2026-08-24 CI 加固,延续):① override 缝置 null;② tmp fixture 经
 * MEDIA_GEN_MCP_CONFIG 注入(本文件 fixture 未写 disabledProviders → 出厂默认 ["flow"] 生效,
 * 与真实用户环境一致)。node --test 每文件独立进程,env 不外泄。
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

// ── 自足 fixture(必须先落盘 + 设 env,再 require dist:config.ts 模块加载时读此 env)──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-priority-"));
const cfgPath = path.join(tmpDir, "config.json");
fs.writeFileSync(cfgPath, JSON.stringify({
  defaultImageProvider: "agnes",
  providers: {
    agnes: { apiKey: "test-agnes-key" },
    zhipu: {
      apiKey: "test-zhipu-key",
      models: {
        image: { available: ["cogview-3-flash", "cogview-4", "cogview-4-250304", "glm-image"] },
        video: { available: ["cogvideox-flash", "cogvideox-2", "cogvideox-3"] },
      },
    },
  },
}, null, 2));
process.env.MEDIA_GEN_MCP_CONFIG = cfgPath;

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { parseProviderPriority, CONFIG_FILE, config } = require_(path.join(distDir, "config.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));
const { getProviderPriority, getFallbackProvider, resolveProvider, getProvider } = reg;
const { FlowProvider, FlowError } = require_(path.join(distDir, "providers/flow.js"));
const { isChainAdvanceable, isFallbackWorthy, isRequestPinned } = require_(path.join(distDir, "providers/http.js"));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

before(() => {
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
});

// ═══ 0. 测试环境自足性 ═══

describe("测试环境自足性(fixture 注入缝机械化盯防)", () => {
  test("CONFIG_FILE 指向本文件 tmp fixture;zhipu configured + 模型目录非空(路由两前提)", () => {
    assert.equal(CONFIG_FILE, cfgPath, "fixture 注入失效 = 隔离缝被回退");
    assert.equal(getProvider("zhipu").health().configured, true);
    assert.ok((getProvider("zhipu").listImageModels() as string[]).includes("cogview-4"));
    assert.ok((getProvider("zhipu").listVideoModels() as string[]).length > 0);
    assert.equal(getProvider("agnes").health().configured, true);
  });
  test("出厂默认:disabledProviders = ['flow'](死域渠道,配置化默认非硬代码)", () => {
    assert.deepEqual(config.disabledProviders, ["flow"]);
  });
});

// ═══ 1. 配置解析(保留:废弃警告路径仍在解析)═══

describe("parseProviderPriority(配置形态:config 数组 > env csv;0.22.0 起仅供电量废弃警告)", () => {
  test("config 数组:小写归一 + 去重(保序)", () => {
    assert.deepEqual(parseProviderPriority(["Agnes", "agnes", "Zhipu"], "NOPE"), ["agnes", "zhipu"]);
  });
  test("env 逗号分隔:trim + 剔空", () => {
    process.env.PROV_PRI_TEST_ENV = " agnes , ,zhipu,";
    try {
      assert.deepEqual(parseProviderPriority(undefined, "PROV_PRI_TEST_ENV"), ["agnes", "zhipu"]);
    } finally {
      delete process.env.PROV_PRI_TEST_ENV;
    }
  });
  test("全空/空数组 → undefined", () => {
    assert.equal(parseProviderPriority([], "NOPE"), undefined);
    assert.equal(parseProviderPriority(undefined, "NOPE"), undefined);
  });
});

// ═══ 2. 链已废弃:getProviderPriority 恒 undefined ═══

describe("getProviderPriority(0.22.0 废弃:恒 undefined)", () => {
  test("override 注入与 config 均无效(链语义已移除)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes"];
    try {
      assert.equal(getProviderPriority("image"), undefined, "配置链不再生效");
      assert.equal(reg.getRawProviderPriority("image"), undefined);
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("null override 同样 undefined(隔离缝语义不变)", () => {
    assert.equal(getProviderPriority("image"), undefined);
    assert.equal(getProviderPriority("video"), undefined);
  });
});

// ═══ 3. resolveProvider:未点名恒默认;归属路由不受链影响 ═══

describe("resolveProvider(未点名 = defaultImageProvider;model 归属自动路由)", () => {
  test("未点名 → legacy 默认 defaultImageProvider(免费池头;链配置无效)", () => {
    reg.__priorityOverrideForTests.image = ["flow", "agnes", "zhipu"];
    try {
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, config.defaultImageProvider);
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("他家 model → 自动路由不变(model 归属优先;例:agnes 头 + cogview-4 → zhipu)", () => {
    const r = resolveProvider(undefined, "cogview-4", "image");
    assert.equal(r.provider.name, "zhipu");
    assert.equal(r.autoRouted, true);
    assert.equal(r.routedFrom, config.defaultImageProvider);
  });
  test("禁用渠道的模型不参与归属(flow 助记/目录 key 均无归属 → 未知模型)", () => {
    for (const m of ["abra_t2v", "abra_i2v", "abra_t2v_8s", "NARWHAL"]) {
      assert.throws(() => resolveProvider(undefined, m, m.startsWith("abra") ? "video" : "image"), (e: any) =>
        e.message.includes("未知模型"), `${m} 应无归属(flow 禁用)`);
    }
  });
});

// ═══ 4. getFallbackProvider(免费池 tier 降序;optIn/禁用永不承接)═══

describe("getFallbackProvider(免费池容灾;optIn 与禁用渠道永不承接)", () => {
  test("agnes 失败 → zhipu(免费池互备,tier 序);永不落 flow/gemini/pixverse", () => {
    assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu");
    assert.equal(getFallbackProvider("zhipu", "image", {})?.name, "agnes");
    const videoFb = getFallbackProvider("agnes", "video", { mode: "text-to-video" })?.name;
    assert.equal(videoFb, "zhipu");
    for (const cur of ["agnes", "zhipu"]) {
      assert.notEqual(getFallbackProvider(cur, "image", {})?.name, "flow", "禁用渠道不承接");
      assert.notEqual(getFallbackProvider(cur, "image", {})?.name, "gemini", "optIn 渠道不承接");
      assert.notEqual(getFallbackProvider(cur, "image", {})?.name, "pixverse", "optIn 渠道不承接");
    }
  });
  test("链配置对 fallback 排序同样无效(恒 tier 序)", () => {
    reg.__priorityOverrideForTests.image = ["pixverse", "zhipu"];
    try {
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("熔断窗口内跳过(cooldown 过滤保留;免费池内降级)", () => {
    const zhipu = getProvider("zhipu");
    const prev = zhipu.cooldownMs;
    zhipu.cooldownMs = 40;
    try {
      zhipu.notifyUnavailable(new Error("probe"));
      assert.equal(zhipu.health().cooldown, true);
      assert.equal(getFallbackProvider("agnes", "image", {}), undefined, "zhipu 熔断 → 免费池无候选(不落 optIn)");
    } finally {
      return sleep(50).then(() => { zhipu.cooldownMs = prev; });
    }
  });
});

// ═══ 4b. 钉死守卫(纯函数语义保留;opt-in 例子换活渠道 gemini)═══

describe("isRequestPinned(钉死守卫:opt-in 渠道显式点名直抛;免费渠道带告警回落)", () => {
  test("opt-in 渠道:显式 provider 或 model 归属 → 钉死;默认路由到达不钉死", () => {
    assert.equal(isRequestPinned("gemini", undefined, true), true, "显式 provider=gemini 钉死");
    assert.equal(isRequestPinned(undefined, "nano-banana-2", true), true, "model 归属路由到 gemini 同样钉死");
    assert.equal(isRequestPinned(undefined, undefined, true), false, "默认路由(现已不可能到达 optIn,防御保留)");
  });
  test("免费渠道(agnes/zhipu):显式点名也不钉死(失败仍按免费池回落带 warning)", () => {
    assert.equal(isRequestPinned("agnes", undefined, false), false);
    assert.equal(isRequestPinned("zhipu", "cogview-4", false), false);
    assert.equal(isRequestPinned(undefined, undefined, false), false);
  });
  test("与 registry 真源一致(gemini/pixverse opt-in;agnes/zhipu 免费[未实现钩子=undefined])", () => {
    assert.equal(getProvider("gemini").requiresOptIn?.("image"), true);
    assert.equal(getProvider("pixverse").requiresOptIn?.("image"), true);
    assert.ok(getProvider("agnes").requiresOptIn?.("image") !== true, "免费渠道未实现钩子(undefined)≠ opt-in");
    assert.ok(getProvider("zhipu").requiresOptIn?.("image") !== true);
  });
});

// ═══ 5. isChainAdvanceable(失败分类;纯函数保留)═══

describe("isChainAdvanceable(= isFallbackWorthy ∪ 环境前置失败)", () => {
  const mk = (code: string, opts?: any) => new FlowError(code, "x", opts);
  test("S100/S101/S102/S104 precondition → 推进", () => {
    for (const c of ["S100", "S101", "S102", "S104"]) {
      assert.equal(isChainAdvanceable(mk(c, { precondition: true })), true, c);
    }
  });
  test("S301 参数错 / S401 媒体错 → 不推进", () => {
    assert.equal(isChainAdvanceable(mk("S301")), false);
    assert.equal(isChainAdvanceable(mk("S401")), false);
  });
  test("上游 5xx / 429 → 推进", () => {
    assert.equal(isChainAdvanceable(mk("S201", { flowStatus: 500 })), true);
    assert.equal(isChainAdvanceable(mk("S103", { flowStatus: 0 })), true);
  });
});

// ═══ 6. flow 60s 软熔断(直构实例;不经 getProvider —— flow 默认禁用)═══

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
  test("冷却窗口内 ensureReady 直抛缓存错误(opens 不增);过期重探", async () => {
    const t = new DeadCdpTransport();
    const p = new FlowProvider({ transport: t as any });
    p.cooldownMs = 50;
    p.healCdpBackoffMs = 1;
    const e1 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.ok(e1 instanceof FlowError && e1.code === "S100");
    assert.equal(t.opens, 2, "初次探测 + S100 自愈重探一次");
    p.notifyUnavailable(e1);
    assert.equal(p.health().cooldown, true);
    const e2 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.equal(e2, e1, "窗口内直抛缓存错误(零探测)");
    await sleep(110);
    const e3 = await p.ensureReady().then(() => null, (e: any) => e);
    assert.equal(t.opens, 4, "窗口过期重探");
    assert.ok(e3 instanceof FlowError);
  });
});

// ═══ 8. disabledProviders(0.22.0 配置化禁用;单点拦截)═══

describe("disabledProviders(默认 ['flow'];getProvider 路由层单点拦截)", () => {
  test("getProvider('flow') 抛禁用错(含替代渠道指引与解禁说明;零网络零 CDP)", () => {
    assert.throws(() => getProvider("flow"), (e: any) => {
      assert.match(e.message, /已被禁用/);
      assert.match(e.message, /L3 账号地区门禁死域/);
      assert.match(e.message, /替代渠道/);
      assert.match(e.message, /disabledProviders/);
      return true;
    });
  });
  test("resolveProvider 显式点名 flow 同样被拦(点名即用只属于活渠道)", () => {
    assert.throws(() => resolveProvider("flow", undefined, "image"), (e: any) => e.message.includes("已被禁用"));
  });
  test("env 形态:MEDIA_DISABLED_PROVIDERS 覆盖默认(见独立解禁套件 provider-disabled.test.ts)", () => {
    // 本文件 fixture 未配置 → 出厂默认;解禁/自定义行为在独立 fixture 套件覆盖
    assert.deepEqual(config.disabledProviders, ["flow"]);
  });
});
