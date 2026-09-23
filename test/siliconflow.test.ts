/**
 * SiliconFlow 硅基流动渠道单元测试(白盒;零网络零消耗 —— stub fetch/download,绝不真调 API/扣代金券)。
 *
 * 覆盖:
 *   1. 模型目录/能力/channelInfo(状态随 key 配置翻转)/costCatalog 静态价
 *   2. 生图:images[].url 信封(非 OpenAI data[])→ 立即下载转 data:URI;n>1 循环;n 警示
 *   3. 视频:submit→taskId→poll(轮询缝)→ Succeed 下载/Failed reason/超时;keyframes S301;5s 固定告警
 *   4. 错误:S100 无 key/S101 401/S201 429/S300 参数;notifyUnavailable 熔断
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SiliconflowProvider, SiliconflowError,
  SILICONFLOW_IMAGE_MODELS, SILICONFLOW_VIDEO_MODELS, SILICONFLOW_PRICES_CNY,
} = require("../dist/providers/siliconflow.js");

function mkResp(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, json: async () => JSON.parse(text), text: async () => text };
}
/** 脚本化 fetch:path → status/body 表。 */
function makeProvider(script: Record<string, Array<{ status: number; body: unknown }>>, apiKey = "sk-test") {
  const calls: { path: string; body: any }[] = [];
  const downloads: string[] = [];
  const p = new SiliconflowProvider({
    apiKey,
    fetchImpl: async (url: string, init: RequestInit) => {
      const path = url.replace("https://api.siliconflow.cn", "");
      calls.push({ path, body: JSON.parse(String(init.body)) });
      const q = script[path];
      const next = q?.shift() ?? { status: 200, body: {} };
      if (next.status >= 400 && next.status < 500 && next.status !== 429) {
        // 非瞬时 4xx:withRetry 不重试,直接抛 SiliconflowError —— 用 json 包装让 request 抛
      }
      return mkResp(next.status, next.body);
    },
    downloadImpl: async (u: string) => { downloads.push(u); return new Uint8Array([1, 2, 3, 4]).buffer; },
  });
  return { p, calls, downloads };
}

describe("siliconflow 目录/说明/成本", () => {
  test("模型目录与常量一致;免费模型在册", () => {
    const { p } = makeProvider({});
    assert.deepEqual(p.listImageModels(), SILICONFLOW_IMAGE_MODELS);
    assert.deepEqual(p.listVideoModels(), SILICONFLOW_VIDEO_MODELS);
    assert.ok(SILICONFLOW_IMAGE_MODELS.includes("Kwai-Kolors/Kolors"));
    assert.equal(SILICONFLOW_PRICES_CNY["Kwai-Kolors/Kolors"], 0);
  });
  test("channelInfo:无 key=blocked-on-login,有 key=live;字段齐", () => {
    const noKey = new SiliconflowProvider({});
    const keyed = makeProvider({}).p;
    assert.equal(noKey.channelInfo().status, "blocked-on-login");
    const ci = keyed.channelInfo();
    assert.equal(ci.status, "live");
    assert.equal(ci.capabilities.keyframes, false, "无首尾帧如实");
    assert.ok(ci.prerequisites.some((x) => x.includes("siliconflow.cn")));
  });
  test("costCatalog:静态价全覆盖(¥;unit per-image)", () => {
    const { p } = makeProvider({});
    const cat = p.costCatalog();
    assert.equal(cat["Tongyi-MAI/Z-Image-Turbo"].credits, 0.10);
    assert.equal(cat["Wan-AI/Wan2.2-T2V-A14B"].mode, "video");
    assert.equal(Object.keys(cat).length, SILICONFLOW_IMAGE_MODELS.length + SILICONFLOW_VIDEO_MODELS.length);
  });
});

describe("siliconflow 生图(images[].url 信封 + 立即下载)", () => {
  test("默认 Kolors:请求体含 model/prompt/image_size;产物转 data:URI", async () => {
    const { p, calls, downloads } = makeProvider({
      "/v1/images/generations": [{ status: 200, body: { images: [{ url: "https://tmp/x.png" }], timings: { inference: 0.1 }, seed: 7 } }],
    });
    const r = await p.generateImage({ prompt: "a cat" } as any);
    assert.match(r.outputs[0].url, /^data:image\/png;base64,/);
    assert.equal(downloads.length, 1, "URL 1h TTL → 立即下载");
    assert.equal(calls[0].body.model, "Kwai-Kolors/Kolors");
    assert.equal(calls[0].body.image_size, "1024x1024");
    assert.ok(r.warnings!.some((w) => w.includes("免费模型")));
  });
  test("n=3:循环 3 次独立调用 + seed 递增 + 告警", async () => {
    const { p, calls } = makeProvider({
      "/v1/images/generations": [1, 2, 3].map(() => ({ status: 200, body: { images: [{ url: "https://tmp/y.png" }] } })),
    });
    const r = await p.generateImage({ prompt: "x", n: 3, seed: 42 } as any);
    assert.equal(r.outputs.length, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => c.body.seed), [42, 43, 44]);
    assert.ok(r.warnings!.some((w) => w.includes("batch_size")));
  });
  test("响应信封异常(无 images)→ S400", async () => {
    const { p } = makeProvider({ "/v1/images/generations": [{ status: 200, body: { data: [] } }] });
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "S400" && /images\[\]/.test(e.message));
  });
  test("i2i:Edit-2509 传 3 张数组;普通 Edit 单张+多图告警;非 Edit 模型 → S302", async () => {
    const { p, calls } = makeProvider({ "/v1/images/generations": [{ status: 200, body: { images: [{ url: "https://tmp/e.png" }] } }] });
    const r = await p.generateImage({ prompt: "edit", model: "Qwen/Qwen-Image-Edit-2509", images: ["https://a/1.png", "https://a/2.png", "https://a/3.png", "https://a/4.png"] } as any);
    assert.deepEqual(calls[0].body.image, ["https://a/1.png", "https://a/2.png", "https://a/3.png"], "≤3 张,数组,第 4 张截断");
    assert.ok(r.warnings!.some((w) => w.includes("截断")));
    const single = makeProvider({ "/v1/images/generations": [{ status: 200, body: { images: [{ url: "https://tmp/e.png" }] } }] });
    const r2 = await single.p.generateImage({ prompt: "edit", model: "Qwen/Qwen-Image-Edit", images: ["https://a/1.png", "https://a/2.png"] } as any);
    assert.equal(single.calls[0].body.image, "https://a/1.png");
    assert.ok(r2.warnings!.some((w) => w.includes("images[0]")));
    await assert.rejects(p.generateImage({ prompt: "x", model: "Kwai-Kolors/Kolors", images: ["https://a/1.png"] } as any), (e: any) => e.code === "S302");
  });
});

describe("siliconflow 视频(submit/poll 异步)", () => {
  test("t2v:taskId + 计费告警;ratio 映射 image_size", async () => {
    const { p, calls } = makeProvider({ "/v1/video/submit": [{ status: 200, body: { requestId: "req-1" } }] });
    const t = await p.createVideo({ prompt: "v" } as any);
    assert.equal(t.status, "submitted");
    assert.equal(t.taskId, "req-1");
    assert.equal(calls[0].body.image_size, "1280x720");
    assert.ok(t.warnings!.some((w) => w.includes("¥2")));
  });
  test("i2v + 9:16 → 720x1280 + image 直传;keyframes → S301", async () => {
    const { p, calls } = makeProvider({ "/v1/video/submit": [{ status: 200, body: { requestId: "r2" } }] });
    const t = await p.createVideo({ prompt: "v", model: "Wan-AI/Wan2.2-I2V-A14B", image: "data:image/png;base64,xx", ratio: "9:16" } as any);
    assert.equal(calls[0].body.image_size, "720x1280");
    assert.equal(calls[0].body.image, "data:image/png;base64,xx");
    await assert.rejects(p.createVideo({ prompt: "v", keyframes: ["https://a/1.png", "https://a/2.png"] } as any), (e: any) => e.code === "S301");
  });
  test("poll:Succeed → 下载 data:video;Failed → reason;超时 → timeout", async () => {
    // Succeed 路径
    const ok = makeProvider({
      "/v1/video/submit": [{ status: 200, body: { requestId: "ok-1" } }],
      "/v1/video/status": [
        { status: 200, body: { status: "InProgress" } },
        { status: 200, body: { status: "Succeed", results: { videos: [{ url: "https://tmp/v.mp4" }] } } },
      ],
    });
    ok.p.pollIntervalMs = 1;
    const t1 = await ok.p.createVideo({ prompt: "v" } as any);
    const r1 = await ok.p.getVideo({ taskId: t1.taskId } as any);
    assert.equal(r1.status, "completed");
    assert.match(String(r1.url), /^data:video\/mp4;base64,/);
    // Failed 路径
    const bad = makeProvider({
      "/v1/video/submit": [{ status: 200, body: { requestId: "bad-1" } }],
      "/v1/video/status": [{ status: 200, body: { status: "Failed", reason: "内容审核未通过" } }],
    });
    bad.p.pollIntervalMs = 1;
    const t2 = await bad.p.createVideo({ prompt: "v" } as any);
    const r2 = await bad.p.getVideo({ taskId: t2.taskId } as any);
    assert.equal(r2.status, "failed");
    assert.match(String(r2.error), /内容审核/);
    // 超时路径
    const slow = makeProvider({
      "/v1/video/submit": [{ status: 200, body: { requestId: "slow-1" } }],
      "/v1/video/status": [{ status: 200, body: { status: "InQueue" } }],
    });
    slow.p.pollIntervalMs = 1; slow.p.pollDeadlineMs = 30;
    const t3 = await slow.p.createVideo({ prompt: "v" } as any);
    const r3 = await slow.p.getVideo({ taskId: t3.taskId } as any);
    assert.equal(r3.status, "timeout");
    assert.match(String(r3.error), /10min/);
  });
});

describe("siliconflow 错误/门禁", () => {
  test("S100:无 key(结构化指引)", async () => {
    const p = new SiliconflowProvider({});
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "S100" && /account\/ak/.test(e.message));
  });
  test("S101:401 Invalid token(precondition)", async () => {
    const { p } = makeProvider({ "/v1/images/generations": [{ status: 401, body: { msg: "Invalid token" } }] });
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "S101");
  });
  test("S300:未知模型/400", async () => {
    const { p } = makeProvider({});
    await assert.rejects(p.generateImage({ prompt: "x", model: "no-such" } as any), (e: any) => e.code === "S300");
  });
  test("notifyUnavailable:429/5xx 打熔断;health 反映", () => {
    const { p } = makeProvider({});
    p.notifyUnavailable(new SiliconflowError("S201", "x", { sfStatus: 429 }));
    assert.equal(p.health().cooldown, true);
  });
  test("requiresOptIn=true(池含付费模型);capabilities keyframes=false", () => {
    const { p } = makeProvider({});
    assert.equal(p.requiresOptIn("image"), true);
    assert.equal(p.capabilities().video.keyframes, false);
  });
});
