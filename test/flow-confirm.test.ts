/**
 * flow 计费确认门单元测试(白盒;零网络零消耗 —— 全程 StubTransport,不触碰真实 CDP/积分)。
 *
 * 用户核心诉求②的验收面(create_video 路由到/显式用 flow 时两段式确认):
 *   1. 两段式:无 confirmToken → {needConfirm, estimatedCost, confirmToken, expiresInSeconds}
 *      (且绝不提交 —— stub 无任何 /video: POST);带 token → undefined 放行(createVideo 到达提交端点)
 *   2. wrong token → [flow] S320(与当前请求不符/格式非法)
 *   3. 过期 → [flow] S321(TTL 由 flow.confirmTtlMs 控制)
 *   4. 参数变化(模型/时长)→ 令牌绑定失效 S320(确认后改参数不能复用令牌)
 *   5. 0 积分提交(veo_3_1_upsampler_1080p)不触发门;flow.videoConfirm=false 整门关闭
 *   6. 预估来源:动态 creditMapping(projectInitialData 实时价)> 静态契约表兜底;
 *      未知价 key(目录新增、静态表无价)→ estimatedCost=null 保守仍确认
 *   7. 校验同源早失败:无模型 S300 / 形状错 S301 在第一段(挑战前)暴露
 *   8. 非 flow 渠道零影响:agnes/zhipu 未实现钩子(undefined)
 *
 * 导入方式:与 flow.test.ts 同范式(createRequire 引编译产物 dist/)。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { FlowProvider, FlowError, staticTierCosts } = require_(path.join(distDir, "providers/flow.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── StubTransport(零网络零消耗;路由同 flow.test.ts 范式) ──

class StubTransport {
  calls: Array<{ url: string; method: string }> = [];
  constructor(private readonly opts: any = {}) {}
  async open() {
    if (this.opts.openError) throw this.opts.openError;
    return { pageUrl: "https://labs.google/fx/zh/tools/flow/project/test-project" };
  }
  async pageFetch(args: any) {
    this.calls.push(args);
    if (args.url.includes("/fx/api/auth/session")) {
      return this.json({ user: { email: "tester@example.com" }, access_token: "ya29.stub" });
    }
    if (args.url.includes("credits?key=")) {
      return this.json({ credits: 868, serviceTier: "SERVICE_TIER_INTERMEDIATE" });
    }
    if (args.url.includes("flow.projectInitialData")) {
      return this.json({ result: { data: { json: {
        projectContents: { media: [] },
        modelConfig: this.opts.modelConfig ?? { videoModelFamilies: [] },
      } } } });
    }
    if (args.method === "POST" && args.url.includes("/video:")) {
      return this.json({ remainingCredits: 856, media: [{ name: "media-new-1" }] });
    }
    return this.json({}, 404);
  }
  async recaptchaToken() { return "stub-rc"; }
  json(obj: any, status = 200) {
    return { ok: status < 400, status, contentType: "application/json", bodyB64: Buffer.from(JSON.stringify(obj)).toString("base64") };
  }
}

function newProvider(providerCfg: any = {}, transportOpts: any = {}) {
  const t = new StubTransport(transportOpts);
  const p = new FlowProvider({ transport: t as any, projectId: "proj-test", ...providerCfg });
  return { t, p };
}

// ═══ 1. 两段式 ═══

describe("计费确认门:两段式(无 token 返挑战 → 带 token 放行)", () => {
  test("第一段:needConfirm 挑战(预估 + 令牌 + TTL + hint),且 stub 零提交(无 /video: POST)", async () => {
    const { t, p } = newProvider();
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    assert.ok(c, "应返回挑战");
    assert.equal(c.needConfirm, true);
    assert.equal(c.provider, "flow");
    assert.equal(c.model, "abra_t2v_8s");
    assert.equal(c.estimatedCost, 12, "静态 per-tier 矩阵:abra 8s = 12 点(全 tier 同价)");
    assert.equal(c.costSource, "static-tier", "无动态 creditMapping → 静态 per-tier 矩阵兜底(§14.4;tier 盲 'static' 仅在矩阵无该 key 时出现)");
    assert.equal(c.currentBalance, 868, "附带当前余额(0 点只读 credits)");
    assert.equal(c.estimatedBalanceAfter, 856);
    assert.match(c.confirmToken, /^fvc1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-f]{32}$/);
    assert.equal(c.expiresInSeconds, 600, "默认 TTL 10 分钟");
    assert.match(String(c.hint), /confirmToken/);
    // B9:期望价数字取自 staticTierCosts 真源(改真源本断言随变,不落手写价;estimatedCost 数值锚定见上行)
    assert.ok(String(c.hint).includes(`${String(staticTierCosts("abra_t2v_8s")!.SERVICE_TIER_INTERMEDIATE)} 积分`), "hint 含真源价数字");
    assert.ok(!t.calls.some((x) => x.method === "POST" && x.url.includes("/video:")), "第一段绝不提交");
  });

  test("第二段:同请求 + 有效 token → undefined 放行(随后 createVideo 到达提交端点)", async () => {
    const { t, p } = newProvider();
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    const pass = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken);
    assert.equal(pass, undefined, "校验通过 → 放行提交");
    // 放行后 createVideo 真正提交(stub 端点;证明门没有吞掉提交路径)
    const task = await p.createVideo({ prompt: "x", model: "abra_t2v_8s" });
    assert.equal(task.taskId, "media-new-1");
    assert.ok(t.calls.some((x) => x.method === "POST" && x.url.includes("/video:")));
  });
});

// ═══ 2. wrong token ═══

describe("计费确认门:wrong token → [flow] S320", () => {
  test("伪造格式 → S320(提示由第一段返回)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, "garbage-token"),
      (e: any) => e.code === "S320" && /\[flow\] S320 /.test(e.message) && e.message.includes("格式非法"),
    );
  });
  test("他请求签发的 token(参数变化)→ S320(令牌与「key+预估」绑定)", async () => {
    const { p } = newProvider();
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_10s" }, c!.confirmToken),
      (e: any) => e.code === "S320" && e.message.includes("与当前请求不符"),
    );
  });
  test("同模型不同时长(mnemonic + durationSeconds)→ 同样 S320(最终 key 变化)", async () => {
    const { p } = newProvider();
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v", durationSeconds: 10 }, c!.confirmToken),
      (e: any) => e.code === "S320",
    );
  });
});

// ═══ 3. 过期 ═══

describe("计费确认门:过期 → [flow] S321(TTL 可配)", () => {
  test("confirmTtlMs=60 → 80ms 后复用 → S321(提示重新获取)", async () => {
    const { p } = newProvider({ flowCfg: { confirmTtlMs: 60 } });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await sleep(80);
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken),
      (e: any) => e.code === "S321" && e.message.includes("已过期") && e.message.includes("重新调用"),
    );
  });
  test("TTL 内复用有效(60ms 窗口内第二段成功)", async () => {
    const { p } = newProvider({ flowCfg: { confirmTtlMs: 5_000 } });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    const pass = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken);
    assert.equal(pass, undefined);
  });
});

// ═══ 4. 免费提交 / 配置关闭 / 非 flow 渠道 ═══

describe("计费确认门:豁免面", () => {
  test("0 积分提交(veo_3_1_upsampler_1080p)→ undefined 不触发门", async () => {
    const { t, p } = newProvider();
    const r = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_upsampler_1080p", videoMediaId: "vid-src-1" });
    assert.equal(r, undefined);
    assert.ok(!t.calls.some((x) => x.method === "POST" && x.url.includes("/video:")));
  });
  test("flow.videoConfirm=false → 整门关闭(付费 key 也直接 undefined)", async () => {
    const { p } = newProvider({ flowCfg: { videoConfirm: false } });
    assert.equal(await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }), undefined);
  });
  test("非 flow 渠道未实现钩子 → undefined(handler 直提交,零影响)", async () => {
    assert.equal(typeof (reg.getProvider("agnes") as any).beginSubmissionConfirm, "undefined");
    assert.equal(typeof (reg.getProvider("zhipu") as any).beginSubmissionConfirm, "undefined");
  });
});

// ═══ 5. 预估来源(动态 creditMapping 优先) ═══

describe("计费确认门:预估来源", () => {
  test("动态 creditMapping(当前 serviceTier 的 cost)> 静态表:33 覆盖 12", async () => {
    const { p } = newProvider({}, {
      modelConfig: { videoModelFamilies: [{ usages: [{ key: "abra_t2v_8s", creditMapping: { SERVICE_TIER_INTERMEDIATE: { cost: 33 } } }] }] },
    });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    assert.equal(c!.estimatedCost, 33);
    assert.equal(c!.costSource, "dynamic");
    assert.equal(c!.estimatedBalanceAfter, 868 - 33);
  });
  test("动态目录新增 key(静态表无价)→ estimatedCost=null 保守仍要求确认", async () => {
    const { p } = newProvider({}, {
      modelConfig: { videoModelFamilies: [{ usages: [{ key: "future_family_9s" }] }] },
    });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "future_family_9s" });
    assert.equal(c!.estimatedCost, null);
    assert.match(String(c!.hint), /以实际扣减为准/);
  });
  test("环境不可用(Chrome 未开)→ 静态表兜底,门照常工作", async () => {
    const { p } = newProvider({}, { openError: new FlowError("S100", "CDP 不可连") });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_lite" });
    assert.equal(c!.estimatedCost, 10);
    assert.equal(c!.costSource, "static");
    assert.equal(c!.currentBalance, undefined, "余额不可得时不编造");
  });
});

// ═══ 6. 校验同源早失败(第一段即暴露,不让用户确认一个注定失败的请求) ═══

describe("计费确认门:校验同源早失败", () => {
  test("无 model → S300(与 createVideo 同一真源文案)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x" }),
      (e: any) => e.code === "S300" && e.message.includes("消耗积分"),
    );
  });
  test("形状错(t2v key + image)→ S301 指路 i2v key(先于挑战)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s", image: "https://example.com/a.png" }),
      (e: any) => e.code === "S301" && e.message.includes("abra_i2v_8s"),
    );
  });
  test("ratio 非 16:9/9:16(generation key)→ S301 先于挑战(审计 A-02:不让用户确认注定失败的请求)", async () => {
    const { p } = newProvider();
    for (const bad of ["1:1", "4:3", "3:4"]) {
      await assert.rejects(
        () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s", ratio: bad }),
        (e: any) => e.code === "S301" && e.message.includes("16:9 / 9:16"),
        `ratio=${bad} 应在确认门第一段即 S301`,
      );
    }
    // 合法值仍返挑战(门不被新校验误伤)
    const ok = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s", ratio: "9:16" });
    assert.equal(ok?.needConfirm, true, "ratio=9:16 应正常返回确认挑战");
  });
  test("ratio 校验豁免 extension/upsampler(方向继承源视频)", async () => {
    const { p } = newProvider();
    // upsampler 0 积分不触发门(undefined),但不该因 ratio=1:1 抛 S301
    const r = await p.beginSubmissionConfirm({ prompt: "placeholder", model: "veo_3_1_upsampler_1080p", videoMediaId: "01234567-89ab-cdef-89ab-cdef01234567", ratio: "1:1" });
    assert.equal(r, undefined, "upsampler(0 积分)即使 ratio=1:1 也不应被 ratio 校验拦截");
  });
});

// ═══ B2-high 回归:单次消费(防重放) + digest 绑 prompt ═══

describe("确认令牌单次消费(B2-high:同一令牌二次提交 → S320 已使用)", () => {
  test("同 token 第二次校验 → S320 已使用(单次消费语义,防重复扣积分)", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    assert.ok(c1?.confirmToken, "第一段应返回令牌");
    const pass = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c1.confirmToken);
    assert.equal(pass, undefined, "首次带 token 应放行");
    await assert.rejects(
      p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c1.confirmToken),
      (e: any) => /\[flow\] S320/.test(e.message) && /已使用/.test(e.message),
      "同 token 二次必须被拒(重放防护)",
    );
  });
  test("重取新 token 可正常放行(单次消费不锁死流程)", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c1!.confirmToken!);
    const c2 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    const pass2 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c2!.confirmToken!);
    assert.equal(pass2, undefined, "重取的新 token 应放行");
  });
});

describe("digest 绑定 prompt(F4:参数变化令牌失效)", () => {
  test("同 key 同价但 prompt 变化 → S320 不符", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "original", model: "abra_t2v_8s" });
    await assert.rejects(
      p.beginSubmissionConfirm({ prompt: "tampered", model: "abra_t2v_8s" }, c1!.confirmToken!),
      (e: any) => /\[flow\] S320/.test(e.message) && /不符/.test(e.message),
      "prompt 变化必须使令牌失效",
    );
  });
});

describe("digest 绑定输入引用(三审 finding-3:确认后换输入引用不能复用令牌)", () => {
  test("同 key 同价但 videoMediaId 变化(extension)→ S320 不符", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-1" });
    await assert.rejects(
      p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-2" }, c1!.confirmToken!),
      (e: any) => /\[flow\] S320/.test(e.message) && /不符/.test(e.message),
      "确认后换源视频(videoMediaId)必须使令牌失效",
    );
  });
  test("images 参考集变化(r2v 增删参考图)→ S320 不符", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: ["https://example.com/a.png"] });
    await assert.rejects(
      p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: ["https://example.com/a.png", "https://example.com/b.png"] }, c1!.confirmToken!),
      (e: any) => e.code === "S320",
      "参考图集合变化必须使令牌失效",
    );
  });
  test("keyframes 变化(interpolation 换首尾帧)→ S320 不符", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: ["https://example.com/first.png", "https://example.com/last.png"] });
    await assert.rejects(
      p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: ["https://example.com/first2.png", "https://example.com/last.png"] }, c1!.confirmToken!),
      (e: any) => e.code === "S320",
      "首尾帧变化必须使令牌失效",
    );
  });
  test("参考图仅顺序调换(images 是集合,排序后入摘)→ 令牌仍有效(语义等价不误杀)", async () => {
    const { p } = newProvider();
    const c1 = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: ["https://example.com/a.png", "https://example.com/b.png"] });
    const pass = await p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: ["https://example.com/b.png", "https://example.com/a.png"] }, c1!.confirmToken!);
    assert.equal(pass, undefined, "顺序无关的参考图集合不应使令牌失效");
  });
});
