/**
 * 渠道优先级链单元测试(Flow 分离后 agnes/zhipu 双渠道语义)—— 零网络零消耗(全程 override 注入,
 * 不触真实 API/积分)。
 *
 * 覆盖面:
 *   1. parseProviderPriority:config 数组 / env csv / 小写归一 / 去重 / 非法项剔除 / 空 → undefined
 *   2. getProviderPriority:override 注入缝 + 未知 provider 剔除(warn 不 fatal)
 *   3. resolveProvider 链头:priority[0];熔断窗口内跳过(链降级到下一成员);未配置 = legacy 默认(零回归)
 *   4. getFallbackProvider 排序统一:priority 位置优先于 tier(可向上回落);熔断过滤;
 *      requiresOptIn 准入门禁框架(runtime 注入缝验证 —— 分离后本包无 optIn 成员)
 *   5. isChainAdvanceable / isFallbackWorthy:上游 5xx/401/403/429/网络错推进;业务 4xx 不推进;
 *      precondition 仅链 walk 推进(单跳 fallback 既有路径不认)
 *   6. 钉死守卫 isRequestPinned(2026-08-24 行为决策,选项 b):显式点名 provider / model 归属路由
 *      → 钉死直抛不回落;仅默认路由(链头)失败按序推进。附 src/index.ts 守卫顺序 meta 断言。
 *
 * Flow 分离注记(2026-08-24):flow 渠道(链头跳过/熔断/CDP 前置失败语义)已随渠道整体迁入
 * flow-mcp,由该包 flow.test.ts 承接;本文件只测本包存量双渠道。agnes/zhipu 无 precondition 型
 * 环境错(直连 HTTP API),S1xx 前置类用 isChainAdvanceable 的 duck-typing 形状({precondition:true})覆盖框架语义。
 *
 * 导入方式:与 golden.test.ts 同范式(createRequire 引编译产物 dist/;npm test 先 build 再 build:tests)。
 * 测试隔离铁律:__priorityOverrideForTests 置 null,隔离 ~/.media-gen-mcp/config.json 的本机差异
 * (本机已配 agnes/zhipu key+models;CI 无 config)—— 两环境断言结果逐字节一致;依赖 models
 * 配置的用例(模型归属路由)在无配置环境显式 skip,不 false-fail。
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(ROOT, "dist");
const { parseProviderPriority, config } = require_(path.join(distDir, "config.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));
const { getProviderPriority, getFallbackProvider, resolveProvider, getProvider } = reg;
const { isChainAdvanceable, isFallbackWorthy, isRequestPinned } = require_(path.join(distDir, "providers/http.js"));

// 默认「未配置优先级」(legacy 语义);个别用例按需覆盖后必须还原。
before(() => {
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;
});

/**
 * 熔断窗口操纵(零睡眠确定性):agnes/zhipu 的 health().cooldown = cooldownUntil > Date.now(),
 * 直接改实例字段模拟窗口内/过期,免 60s 真等。返回还原函数(调用方 finally 必须执行)。
 */
function setCooldown(p: any, on: boolean): () => void {
  const prev = p.cooldownUntil ?? 0;
  p.cooldownUntil = on ? Date.now() + 60_000 : Math.max(0, Date.now() - 1);
  return () => { p.cooldownUntil = prev; };
}

/** duck-typing 错误形状(provider request() 抛的 HTTP 错 / 环境前置错)。 */
const mkErr = (status?: number, precondition?: boolean) => {
  const e: any = new Error("x");
  if (status !== undefined) e.status = status;
  if (precondition) e.precondition = true;
  return e;
};

// ═══ 1. 配置解析 ═══

describe("parseProviderPriority(配置形态:config 数组 > env csv)", () => {
  test("config 数组:小写归一 + 去重(保序)", () => {
    assert.deepEqual(parseProviderPriority(["Zhipu", "agnes", "AGNES"], "X_NONE"), ["zhipu", "agnes"]);
  });
  test("env 逗号分隔:trim + 剔空", () => {
    process.env.X_NONE = "agnes, zhipu ,,agnes";
    try {
      assert.deepEqual(parseProviderPriority(undefined, "X_NONE"), ["agnes", "zhipu"]);
    } finally {
      delete process.env.X_NONE;
    }
  });
  test("config 数组优先于 env;非法项(非字符串)剔除", () => {
    process.env.X_NONE = "zhipu";
    try {
      assert.deepEqual(parseProviderPriority(["agnes", 42, null as any, "zhipu"], "X_NONE"), ["agnes", "zhipu"]);
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
  test("未知 provider 名剔除(warn 不 fatal;如分离后残留的 \"flow\" 配置),已知保序", () => {
    reg.__priorityOverrideForTests.image = ["agnes", "flow", "zhipu"];
    try {
      // flow 已随渠道分离出本包 registry → 剔除 + warn,剩余链照常生效(配置错误不杀 server)
      assert.deepEqual(getProviderPriority("image"), ["agnes", "zhipu"]);
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
  test("配置 imageProviderPriority=[zhipu,agnes] 且未点名 provider → 链头 = zhipu(list 位置优先于 tier:agnes=10 > zhipu=5)", () => {
    reg.__priorityOverrideForTests.image = ["zhipu", "agnes"];
    try {
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "zhipu");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("链头 + 他家 model → 自动路由不变(model 归属优先)", () => {
    const zhipu = getProvider("zhipu");
    const agnes = getProvider("agnes");
    const zhipuOnly = zhipu.listImageModels().filter((m: string) => !agnes.listImageModels().includes(m));
    if (!zhipuOnly.length) {
      console.log("  [skip] 本环境无 zhipu models 配置(如 CI)→ 模型归属路由用例跳过");
      return;
    }
    reg.__priorityOverrideForTests.image = ["agnes", "zhipu"];
    try {
      const r = resolveProvider(undefined, zhipuOnly[0], "image");
      assert.equal(r.provider.name, "zhipu");
      assert.equal(r.autoRouted, true);
      assert.equal(r.routedFrom, "agnes");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("未知 model → 友好报错(列 target 可用模型;两环境一致:无配置时 availStr=(无))", () => {
    assert.throws(() => resolveProvider("agnes", "no-such-model-xyz", "image"), /未知模型 "no-such-model-xyz"/);
  });
  test("未配置 priority → legacy 默认 defaultImageProvider(零回归)", () => {
    assert.equal(resolveProvider(undefined, undefined, "image").provider.name, config.defaultImageProvider);
  });
  test("链头在 60s 熔断窗口内 → 降级到下一成员;窗口过期恢复(零睡眠:直接操纵 cooldownUntil)", () => {
    const zhipu = getProvider("zhipu");
    const restore = setCooldown(zhipu, true);
    reg.__priorityOverrideForTests.image = ["zhipu", "agnes"];
    try {
      assert.equal(zhipu.health().cooldown, true);
      assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "agnes", "熔断窗口内链头降级 agnes");
      restore();
      const restore2 = setCooldown(zhipu, false);
      try {
        assert.equal(zhipu.health().cooldown, false);
        assert.equal(resolveProvider(undefined, undefined, "image").provider.name, "zhipu", "窗口过期恢复 zhipu 链头");
      } finally {
        restore2();
      }
    } finally {
      reg.__priorityOverrideForTests.image = null;
      restore();
    }
  });
});

// ═══ 4. getFallbackProvider 排序统一(优先级与 fallback 同一管线)═══

describe("getFallbackProvider(priority 位置优先于 tier;熔断过滤;optIn 门禁)", () => {
  test("priority=[zhipu,agnes](zhipu 在前):fallback(agnes) → zhipu;fallback(zhipu) → agnes(链 = 偏好序,可向上回落,tier 反序不影响)", () => {
    reg.__priorityOverrideForTests.image = ["zhipu", "agnes"];
    try {
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu");
      assert.equal(getFallbackProvider("zhipu", "image", {})?.name, "agnes");
    } finally {
      reg.__priorityOverrideForTests.image = null;
    }
  });
  test("未配置 priority:legacy tier 免费链零回归(本机已配 key 时 agnes↔zhipu 双向互备;CI 无 config 时未配置成员被诚实过滤)", () => {
    const bothConfigured = getProvider("agnes").health().configured && getProvider("zhipu").health().configured;
    if (bothConfigured) {
      assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu");
      assert.equal(getFallbackProvider("zhipu", "image", {})?.name, "agnes");
      assert.equal(getFallbackProvider("agnes", "video", { mode: "text-to-video" })?.name, "zhipu");
      assert.equal(getFallbackProvider("zhipu", "video", { mode: "text-to-video" })?.name, "agnes");
    } else {
      // CI(无 ~/.media-gen-mcp/config.json):两 provider 均未配置且未显式列入 priority
      // → 不进隐式链(过滤诚实;配 key 或列入 priority 后即恢复互备)
      assert.equal(getFallbackProvider("agnes", "image", {}), undefined);
    }
  });
  test("链上唯一下一成员在熔断窗口内 → undefined(调用方保留原始错误,不无限等待)", () => {
    const zhipu = getProvider("zhipu");
    const restore = setCooldown(zhipu, true);
    reg.__priorityOverrideForTests.image = ["agnes", "zhipu"];
    try {
      assert.equal(getFallbackProvider("agnes", "image", {}), undefined, "zhipu 熔断 → agnes 无候选");
    } finally {
      reg.__priorityOverrideForTests.image = null;
      restore();
    }
  });
  test("requiresOptIn 门禁框架(runtime 注入缝):未列入 priority 的 optIn 成员不进隐式链;显式列入才放行", () => {
    const zhipu = getProvider("zhipu");
    // 模拟未来 optIn 型 provider(本包现无成员;框架为 flow 类渠道保留,语义由 flow-mcp 生产验证)
    (zhipu as any).requiresOptIn = () => true;
    try {
      // 未配置 priority:optIn 成员被准入门禁拦下(agnes 无 fallback 候选)
      assert.equal(getFallbackProvider("agnes", "image", {}), undefined, "optIn 未列入 → 不进隐式链");
      // 显式列入 priority = 知情同意 → 放行(configured 豁免同理:显式列入即视为已同意)
      reg.__priorityOverrideForTests.image = ["agnes", "zhipu"];
      try {
        assert.equal(getFallbackProvider("agnes", "image", {})?.name, "zhipu", "optIn 显式列入 → 进链");
      } finally {
        reg.__priorityOverrideForTests.image = null;
      }
      // 未列入时链头也不选它(defaultHead 只读 priority;optIn 只能经显式列入进入链)
      reg.__priorityOverrideForTests.image = null;
      assert.notEqual(resolveProvider(undefined, undefined, "image").provider.name, "zhipu");
    } finally {
      delete (zhipu as any).requiresOptIn;
      reg.__priorityOverrideForTests.image = null;
    }
  });
});

// ═══ 5. 失败分类(isChainAdvanceable = isFallbackWorthy ∪ 环境前置失败)═══

describe("isChainAdvanceable / isFallbackWorthy(失败分类)", () => {
  test("上游 5xx / 0(网络层) / 401 / 403 / 429 → 推进(换渠道有意义)", () => {
    for (const s of [0, 500, 502, 503, 401, 403, 429]) {
      assert.equal(isChainAdvanceable(mkErr(s)), true, `status=${s}`);
    }
  });
  test("业务 4xx(400/422)→ 不推进(保留原始错误)", () => {
    assert.equal(isChainAdvanceable(mkErr(400)), false);
    assert.equal(isChainAdvanceable(mkErr(422)), false);
  });
  test("无 status:仅网络层 TypeError 推进;其余(内部校验/配置错)不推进", () => {
    const netErr: any = new TypeError("fetch failed");
    assert.equal(isChainAdvanceable(netErr), true);
    assert.equal(isChainAdvanceable(new Error("image model 未配置")), false);
  });
  test("precondition(环境前置未就绪)仅链 walk 推进;单跳 fallback 既有路径(isFallbackWorthy)不认 —— 两语义分立保持", () => {
    const pre = mkErr(undefined, true);
    assert.equal(isChainAdvanceable(pre), true, "链头(默认路由)环境错推进");
    assert.equal(isFallbackWorthy(pre), false, "单跳 fallback 不认 precondition(现行为,vision/pdf 路径零回归)");
  });
  test("isFallbackWorthy 语义保留(status 驱动,与基线一致)", () => {
    assert.equal(isFallbackWorthy(mkErr(503)), true);
    assert.equal(isFallbackWorthy(mkErr(429)), true);
    assert.equal(isFallbackWorthy(mkErr(400)), false);
  });
});

// ═══ 6. 钉死守卫(2026-08-24 行为决策,选项 b:全渠道统一钉死)═══

describe("isRequestPinned(钉死守卫:直抛不回落)", () => {
  test("显式点名 provider → 钉死(zhipu 被点名后 5xx/限流也直抛,绝不静默换 agnes)", () => {
    assert.equal(isRequestPinned("zhipu", undefined), true);
    assert.equal(isRequestPinned("agnes", undefined), true);
  });
  test("model 归属路由 → 钉死(model 本身即渠道归属声明;如 cogview-4 → zhipu 失败不静默换模型)", () => {
    assert.equal(isRequestPinned(undefined, "cogview-4"), true);
    assert.equal(isRequestPinned("zhipu", "cogview-4"), true, "点名 + model 同时给 → 钉死");
  });
  test("默认路由(未传 provider 且未传 model,经链头到达)→ 不钉死,失败按序推进", () => {
    assert.equal(isRequestPinned(undefined, undefined), false);
    assert.equal(isRequestPinned(null, null), false);
  });
  test("决策记录:钉死守卫自 2026-08-24 起对全渠道生效(基线仅 flow;泛化 = 兑现工具描述契约,commit message 已声明)", () => {
    // 契约原文见 src/index.ts generate_image provider 参数描述:
    // "explicitly naming a provider pins it (no silent substitution)"
    const src = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    assert.match(src, /explicitly naming a provider pins it \(no silent substitution\)/, "工具描述契约仍在发布");
  });
});

describe("钉死守卫接线 meta(守卫顺序:pinned 短路在前,链推进判定在后)", () => {
  test("image 链 walk:const pinned = isRequestPinned(...) + if (pinned || hop >= MAX_CHAIN_HOPS || !isChainAdvanceable(e)) throw", () => {
    const src = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    assert.match(src, /const pinned = isRequestPinned\(optString\(a\.provider\), model\);/, "image walk 走统一谓词");
    assert.match(
      src,
      /if \(pinned \|\| hop >= MAX_CHAIN_HOPS \|\| !isChainAdvanceable\(e\)\) throw e;/,
      "pinned 必须短路在链推进判定之前(顺序回归 = 钉死失效)",
    );
  });
  test("video 提交路径:const pinnedVideo = isRequestPinned(...) + if (pinnedVideo || !isChainAdvanceable(e)) throw", () => {
    const src = readFileSync(path.join(ROOT, "src/index.ts"), "utf8");
    assert.match(src, /const pinnedVideo = isRequestPinned\(optString\(a\.provider\), model\);/, "video 走统一谓词");
    assert.match(
      src,
      /if \(pinnedVideo \|\| !isChainAdvanceable\(e\)\) throw e;/,
      "pinnedVideo 必须短路在链推进判定之前",
    );
  });
});
