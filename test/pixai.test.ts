/**
 * PixAI 渠道单元测试(白盒;零网络零积分 —— stub fetch/download,绝不真调 GraphQL/REST/扣每日配额)。
 *
 * 覆盖:
 *   1. 目录/能力/channelInfo 三态(无凭证 blocked/有 token live/apiKey 通道翻转)/costCatalog
 *   2. GraphQL 免费通道:claim 幂等+余额回读/parameters 组装(modelId+priority:1000+seed "" vs 数字)/
 *      轮询终态/outputs.batch[].mediaId vs outputs.mediaId/media PUBLIC 取回
 *   3. REST 通道:v2 create 严格 body(aspectRatio 枚举/seed/promptHelper disable)/v1 轮询/mediaUrls null 过滤
 *   4. 契约纪律(D1):provider 恒单张忽略 req.n;quality/extra 告警;size 16 倍数 snap;i2i 公网 URL 门
 *   5. 错误:P100 无凭证/P101 401/P102 recaptcha 失败降级指引/P300 未知模型/P302 i2i 形态/熔断
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PixaiProvider, PixaiError, PIXAI_MODEL_NAMES } = require("../dist/providers/pixai.js");

function mkResp(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, headers, json: async () => JSON.parse(text), text: async () => text };
}
/** GraphQL 脚本化:按 query 关键词路由到队列。 */
function makeProvider(script: Record<string, Array<{ status: number; body: unknown; headers?: Record<string, string> }>>, creds: { token?: string; apiKey?: string; email?: string; password?: string } = { token: "jwt-token" }) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const downloads: string[] = [];
  const p = new PixaiProvider({
    ...creds,
    disableStoredTokenLoad: true,
    fetchImpl: async (url: string, init: RequestInit) => {
      let parsedBody: any = null;
      if (init.body != null) { try { parsedBody = JSON.parse(String(init.body)); } catch { parsedBody = String(init.body); } } // form 体保原串
      calls.push({ url, body: parsedBody, headers: init.headers });
      // recaptcha 两步(登录前置):anchor 吐 HTML token,reload 吐 rresp
      if (url.includes("recaptcha/api2/anchor")) {
        const anchorHtml = { ok: true, status: 200, headers: {}, json: async () => { throw new Error("not json"); }, text: async () => '<input id="recaptcha-token" value="anchor-tok">' };
        return anchorHtml;
      }
      if (url.includes("recaptcha/api2/reload")) {
        const textResp = { ok: true, status: 200, headers: {}, json: async () => { throw new Error("not json"); }, text: async () => '["rresp","exec-tok"]' };
        return textResp;
      }
      const key = url.includes("/graphql") ? routeGql(String(init.body)) : url.replace("https://api.pixai.art", "");
      const q = script[key];
      const next = q?.shift() ?? { status: 200, body: {} };
      return mkResp(next.status, next.body, next.headers);
    },
    downloadImpl: async (u: string) => { downloads.push(u); return new Uint8Array([9, 9, 9]).buffer; },
  });
  p.persistToken = false;
  p.pollIntervalMs = 1;
  p.pollDeadlineMs = 800; // 测试默认短截止(脚本队列耗尽→默认 {} → status 空串,防 300s 空转)
  return { p, calls, downloads };
}
function routeGql(body: string): string {
  if (body.includes("dailyClaimQuota")) return "claim";
  if (body.includes("quotaAmount")) return "quota";
  if (body.includes("createGenerationTask")) return "create";
  if (body.includes("task(id:")) return "task";
  if (body.includes("media(id:")) return "media";
  if (body.includes("login")) return "login";
  return "other";
}

describe("pixai 目录/说明/成本", () => {
  test("模型目录;channelInfo 无凭证=blocked-on-login,有 token=live;prerequisites 含 token 三路", () => {
    const bare = new PixaiProvider({});
    bare.persistToken = false;
    assert.equal(bare.channelInfo().status, "blocked-on-login");
    assert.deepEqual(bare.listImageModels(), PIXAI_MODEL_NAMES);
    const { p } = makeProvider({});
    const ci = p.channelInfo();
    assert.equal(ci.status, "live");
    assert.equal(ci.capabilities.t2v, false, "API 无视频如实");
    assert.ok(ci.prerequisites.some((x) => x.includes("api.pixai.art:token")));
    assert.ok(ci.limits.some((x) => x.includes("API 无视频")));
  });
  test("apiKey 通道:i2i 能力翻转为 false(REST 无图像输入);acceptsImageInputRef 仅 http(s)", () => {
    const { p } = makeProvider({}, { apiKey: "sk-pixai" });
    assert.equal(p.supportsImageToImage(), false);
    assert.equal(p.acceptsImageInputRef("https://a/1.png"), true);
    assert.equal(p.acceptsImageInputRef("data:image/png;base64,xx"), false);
    const gql = makeProvider({});
    assert.equal(gql.p.supportsImageToImage(), true);
  });
  test("costCatalog:积分/张(真机实测 tsubaki2=2100/haruka2=4100);无视频条目", () => {
    const { p } = makeProvider({});
    const cat = p.costCatalog();
    assert.equal(cat.tsubaki2.credits, 2100);
    assert.equal(cat.haruka2.credits, 4100);
    assert.equal(Object.values(cat).every((v: any) => v.mode === "image"), true);
  });
});

describe("pixai GraphQL 免费通道", () => {
  test("完整链路:claim→create(priority:1000/seed \"\")→poll→media PUBLIC→data:URI;claim 告警含余额", async () => {
    const { p, calls, downloads } = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      quota: [{ status: 200, body: { data: { me: { quotaAmount: "9800" } } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-1", status: "waiting" } } } }],
      task: [
        { status: 200, body: { data: { task: { id: "t-1", status: "running", outputs: {} } } } },
        { status: 200, body: { data: { task: { id: "t-1", status: "completed", outputs: { batch: [{ mediaId: "m-1" }, { mediaId: "m-2" }] } } } } },
      ],
      media: [
        { status: 200, body: { data: { media: { id: "m-1", urls: [{ variant: "PUBLIC", url: "https://tmp/1.png" }] } } } },
        { status: 200, body: { data: { media: { id: "m-2", urls: [{ variant: "THUMBNAIL", url: "https://tmp/t.png" }, { variant: "PUBLIC", url: "https://tmp/2.png" }] } } } },
      ],
    });
    const r = await p.generateImage({ prompt: "1girl" } as any);
    assert.equal(r.outputs.length, 2, "单次请求上游返回 batch 多产物时全数取回(恒单张=一次 create 调用,非一张产出)");
    assert.match(r.outputs[0].url, /^data:image\/png;base64,/);
    assert.equal(downloads.length, 2, "两个 mediaId 各自下载;THUMBNAIL 变体跳过只取 PUBLIC");
    const createBody = calls.find((c) => c.url.includes("/graphql") && routeGql(JSON.stringify(c.body)) === "create")!.body;
    assert.equal(createBody.variables.parameters.priority, 1_000, "不传 priority 进公共队列慢排队");
    assert.equal(createBody.variables.parameters.seed, "", "seed 未指定=空串服务端随机");
    assert.equal(createBody.variables.parameters.modelId, "1983308862240288769", "tsubaki2 默认");
    assert.ok(r.warnings!.some((w) => w.includes("claim")));
    assert.ok(r.warnings!.some((w) => w.includes("9800")), "claim 告警回读余额(quotaAmount 字符串 parseInt)");
  });
  test("claim 进程内幂等:第二次生成不再 claim", async () => {
    const { p, calls } = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [1, 2].map(() => ({ status: 200, body: { data: { createGenerationTask: { id: "t-x", status: "completed" } } } })),
      task: [1, 2].map(() => ({ status: 200, body: { data: { task: { id: "t-x", status: "completed", outputs: { mediaId: "m-9" } } } } })),
      media: [1, 2].map(() => ({ status: 200, body: { data: { media: { id: "m-9", urls: [{ variant: "PUBLIC", url: "https://tmp/9.png" }] } } } })),
    });
    await p.generateImage({ prompt: "a" } as any);
    await p.generateImage({ prompt: "b" } as any);
    const claimCalls = calls.filter((c) => c.url.includes("/graphql") && routeGql(JSON.stringify(c.body)) === "claim");
    assert.equal(claimCalls.length, 1, "同日只 claim 一次");
  });
  test("i2i:公网 URL 进 parameters.mediaUrl;data: URI → P302 明确拒绝;seed 数字直传", async () => {
    const { p, calls } = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-i", status: "completed" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-i", status: "completed", outputs: { mediaId: "m-i" } } } } }],
      media: [{ status: 200, body: { data: { media: { id: "m-i", urls: [{ variant: "PUBLIC", url: "https://tmp/i.png" }] } } } }],
    });
    await p.generateImage({ prompt: "edit", images: ["https://pub.example/x.png"], seed: 42 } as any);
    const params = calls.find((c) => routeGql(JSON.stringify(c.body)) === "create")!.body.variables.parameters;
    assert.equal(params.mediaUrl, "https://pub.example/x.png");
    assert.equal(params.seed, 42, "显式数字 verbatim");
    const bad = makeProvider({});
    await assert.rejects(bad.p.generateImage({ prompt: "x", images: ["data:image/png;base64,zz"] } as any), (e: any) => e.code === "P302" && /公网/.test(e.message));
  });
});

describe("pixai REST 通道(apiKey)", () => {
  test("v2 create 严格 body + v1 轮询 + mediaUrls null 过滤 + 计费未公开告警;images → P302", async () => {
    const { p, calls } = makeProvider({
      "/v2/image/create": [{ status: 200, body: { id: "r-1", status: "waiting", outputs: {} } }],
      "/v1/task/r-1": [
        { status: 200, body: { id: "r-1", status: "running", outputs: { mediaUrls: [] } } },
        { status: 200, body: { id: "r-1", status: "completed", outputs: { mediaIds: ["m"], mediaUrls: [null, "https://tmp/r.png"] } } },
      ],
    }, { apiKey: "sk-pixai" });
    const r = await p.generateImage({ prompt: "x", aspect: "9:16", seed: 7 } as any);
    const createCall = calls.find((c) => c.url.endsWith("/v2/image/create"));
    assert.equal(createCall!.body.aspectRatio, "9:16");
    assert.equal(createCall!.body.size, "1k");
    assert.equal(createCall!.body.promptHelper, "disable", "确定性:不服务端增强");
    assert.equal(createCall!.body.seed, 7);
    assert.equal(createCall!.body.mode, "standard", "tsubaki 默认 mode");
    assert.equal(createCall!.headers.authorization, "Bearer sk-pixai");
    assert.equal(r.outputs.length, 1, "null url 过滤");
    assert.ok(r.warnings!.some((w) => w.includes("计费未公开")));
    await assert.rejects(p.generateImage({ prompt: "x", images: ["https://a/1.png"] } as any), (e: any) => e.code === "P302" && /REST/.test(e.message));
  });
});

describe("pixai 契约纪律(S6 教训固化)", () => {
  test("D1:provider 恒单张忽略 req.n(n>1 告警含单价;禁 n² 双重扇出)", async () => {
    const { p, calls } = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-n", status: "completed" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-n", status: "completed", outputs: { mediaId: "m-n" } } } } }],
      media: [{ status: 200, body: { data: { media: { id: "m-n", urls: [{ variant: "PUBLIC", url: "https://tmp/n.png" }] } } } }],
    });
    const r = await p.generateImage({ prompt: "x", n: 4 } as any);
    assert.equal(r.outputs.length, 1);
    assert.equal(calls.filter((c) => routeGql(JSON.stringify(c.body)) === "create").length, 1);
    assert.ok(r.warnings!.some((w) => w.includes("恒单张")));
  });
  test("quality/extra 告警忽略;size 非 16 倍数 snap+告警;无 aspect 枚举告警", async () => {
    const { p } = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-s", status: "completed" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-s", status: "completed", outputs: { mediaId: "m-s" } } } } }],
      media: [{ status: 200, body: { data: { media: { id: "m-s", urls: [{ variant: "PUBLIC", url: "https://tmp/s.png" }] } } } }],
    });
    const r = await p.generateImage({ prompt: "x", quality: "1080p", extra: { foo: 1 }, size: "1000x1000", aspect: "21:9" } as any);
    assert.ok(r.warnings!.some((w) => w.includes("quality")));
    assert.ok(r.warnings!.some((w) => w.includes("extra")));
    assert.ok(r.warnings!.some((w) => w.includes("16 倍数")));
    assert.ok(r.warnings!.some((w) => w.includes("21:9")));
  });
});

describe("pixai 错误/门禁", () => {
  test("P100:无凭证(结构化指引含 DevTools 路径;不读宿主 token 存储)", async () => {
    const p = new PixaiProvider({ disableStoredTokenLoad: true });
    p.persistToken = false;
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P100" && /api\.pixai\.art:token/.test(e.message));
  });
  test("P101:401 Invalid token(precondition;4xx 零重试)", async () => {
    const { p } = makeProvider({ claim: [{ status: 401, body: { errors: [{ message: "You must be logged in", extensions: { code: "UNAUTHENTICATED" } }] } }] });
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P101" && e.precondition === true);
  });
  test("P102:email/password 登录失败 → 降级指引(手动 token)", async () => {
    const { p } = makeProvider({ login: [{ status: 200, body: { data: { login: { id: "u" } } } }] }, { email: "a@b.c", password: "pw" });
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P102" && /Local Storage/.test(e.message));
  });
  test("登录成功路径:响应头 Token 取 JWT 并复用(第二次生成不再 login)", async () => {
    const { p, calls } = makeProvider({
      login: [{ status: 200, body: { data: { login: { id: "u" } } }, headers: { token: "jwt-fresh" } }],
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-l", status: "completed" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-l", status: "completed", outputs: { mediaId: "m-l" } } } } }],
      media: [{ status: 200, body: { data: { media: { id: "m-l", urls: [{ variant: "PUBLIC", url: "https://tmp/l.png" }] } } } }],
    }, { email: "a@b.c", password: "pw" });
    const r = await p.generateImage({ prompt: "x" } as any);
    assert.equal(r.outputs.length, 1);
    const logins = calls.filter((c) => c.body && routeGql(JSON.stringify(c.body)) === "login");
    assert.equal(logins.length, 1);
    const gqlAuth = calls.find((c) => c.url.includes("/graphql") && routeGql(JSON.stringify(c.body)) === "create")!.headers.authorization;
    assert.equal(gqlAuth, "Bearer jwt-fresh");
  });
  test("B-3 回归:HTTP-200+errors[](非 UNAUTHENTICATED)→ P301 且零重试(status=400)", async () => {
    let hits = 0;
    const p = new PixaiProvider({
      token: "jwt-token", disableStoredTokenLoad: true,
      fetchImpl: async (_u: string, _i: RequestInit) => {
        hits++;
        // 第 1 发=claim(放行),第 2 发=create(业务错)——若 P301 被误判瞬时,第 3 发起退避重试
        if (hits === 1) return mkResp(200, { data: { dailyClaimQuota: true } });
        return mkResp(200, { errors: [{ message: "quota exceeded", extensions: { code: "BAD_USER_INPUT" } }] });
      },
      downloadImpl: async () => new ArrayBuffer(4),
    });
    p.persistToken = false; p.pollIntervalMs = 1; p.pollDeadlineMs = 300;
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P301");
    assert.equal(hits, 3, "claim+余额回读+create 各 1 次,零重试(P301 带 status=400;余额读失败内部吞)");
  });
  test("P300:未知模型;任务 failed → P401;轮询超时 → P402", async () => {
    const { p } = makeProvider({});
    await assert.rejects(p.generateImage({ prompt: "x", model: "nope" } as any), (e: any) => e.code === "P300");
    const failed = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-f", status: "waiting" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-f", status: "failed", outputs: {} } } } }],
    });
    await assert.rejects(failed.p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P401");
    const slow = makeProvider({
      claim: [{ status: 200, body: { data: { dailyClaimQuota: true } } }],
      create: [{ status: 200, body: { data: { createGenerationTask: { id: "t-t", status: "waiting" } } } }],
      task: [{ status: 200, body: { data: { task: { id: "t-t", status: "running", outputs: {} } } } }],
    });
    slow.p.pollDeadlineMs = 20;
    await assert.rejects(slow.p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "P402" && /taskId 复查/.test(e.message));
  });
  test("notifyUnavailable:429/5xx 熔断;health;requiresOptIn=true", () => {
    const { p } = makeProvider({});
    p.notifyUnavailable(new PixaiError("P201", "x", { httpStatus: 429 }));
    assert.equal(p.health().cooldown, true);
    assert.equal(p.requiresOptIn("image"), true);
    assert.equal(p.capabilities().video.textToVideo, false);
  });
});
