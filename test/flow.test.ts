/**
 * flow provider 单元测试(白盒;零网络零消耗 —— 全程 StubTransport,不触碰真实 CDP/积分)。
 *
 * 覆盖面(审查验收指定):
 *   1. 错误契约:所有错误 `[flow] S\d+ ` 前缀(项目错误前缀规范)
 *   2. 前置检测缓存 TTL 30s(二次 ensureReady 不重复探测;过期重探)
 *   3. 媒体状态机映射(契约 §2.3/§5:SUCCESSFUL/SCHEDULED/FAILED/缺状态)
 *   4. 模型目录与 key 解析(mnemonic 组合/冲突/未知;白盒纯函数)
 *   5. submitOnly 队列语义(createVideo 只提交返回 handle,绝不等待;🔴 经 stub 隔离,零真实消耗)
 *   6. 参数校验拒绝路径(模式↔image/keyframes 交叉校验 S301;ratio/duration 白名单;无默认视频模型)
 *   7. fallback 安全:flow 永不进入免费 fallback 链(不破坏 agnes 默认路由)
 *   10. 模式门禁 S303 带依据(契约 §7.3/§9 + E 轮:开放 t2v/i2v/interpolation/r2v/extension/upsampler;edit 与 upsampler_4k 拒绝并说明原因)
 *   16. 带图链路 wire(契约 §7.1/§7.2/§7.3 live 实证形状:uploadMedia/imageInputs/startImage+endImage/v2 requests[])
 *   11. durationSeconds 吸附 + resolution/negativePrompt 丢弃告警(audit finding-3/4/10)
 *   12. getVideo kind 门禁 S403 + 下载字节完整性 S402(audit finding-11/18)
 *   13. 生图 aspect/seed 直通 + outputs mediaId/seed + UPSAMPLE key 区分拒绝(audit finding-2/6/9/13)
 *   14. flowStatus per-key creditMapping/requirements 透传 + abra i2v/r2v 积分按时长(audit finding-8)
 *
 * 导入方式:test tsconfig rootDir=test,不能直接 import ../../src —— 与 integration.error-format.mjs
 * 同范式,经 createRequire 引编译产物 dist/providers/flow.js(npm test 先 build 再 build:tests,顺序保证存在)。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
// 编译产物在 dist-test/ → 项目根 = ../,dist = ../dist(源 .ts 在 test/ 时 IDE 静态解析不受影响,运行时以此为准)
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const {
  FlowProvider,
  FlowError,
  FLOW_VIDEO_MODELS,
  FLOW_IMAGE_MODELS,
  FLOW_VIDEO_DURATIONS,
  mapMediaStatus,
  resolveVideoModelKey,
  sizeToImageAspect,
  estimateVideoCredits,
  staticTierCosts,
  formatTierMatrix,
  isFlowMediaIdLike,
  EDIT_WIRE_WARNING,
  OPEN_VIDEO_MODES,
} = require_(path.join(distDir, "providers/flow.js"));

// ── StubTransport:零网络零消耗;记录所有出站请求供断言 ──

class StubTransport {
  calls: Array<{ url: string; method: string; bodyB64?: string }> = [];
  sessionCount = 0;
  rcCalls: Array<{ siteKey: string; action: string }> = [];
  uploadCount = 0;
  upsampleCount = 0;
  deleteBodies: any[] = [];
  shareBodies: any[] = [];
  cancelBodies: any[] = [];
  workflows: any[] = [];
  externalRef: any[] = [];
  media: any[];
  submitMedia: any[];
  openError: any;
  sessionBody: any;
  downloadB64: string;
  downloadCt: string;
  modelConfig: any;
  creditsBody: any;
  constructor(opts: any = {}) {
    this.media = opts.media ?? [];
    this.submitMedia = opts.submitMedia ?? [{ name: "media-new-1", mediaStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" }];
    this.openError = opts.openError ?? null;
    this.sessionBody = opts.sessionBody ?? { user: { email: "tester@example.com" }, access_token: "ya29.stub-token" };
    this.creditsBody = opts.creditsBody ?? { credits: 868, serviceTier: "SERVICE_TIER_INTERMEDIATE" };
    // 默认下载体精确等于 doneMedia 的 mediaBlobSize(2351072)—— getVideo 有字节完整性校验(finding-18)
    const fake = Buffer.from("fake-mp4-bytes");
    this.downloadB64 = opts.downloadB64 ?? Buffer.concat([fake, Buffer.alloc(2351072 - fake.length)]).toString("base64");
    this.downloadCt = opts.downloadCt ?? "video/mp4";
    this.modelConfig = opts.modelConfig ?? { videoModelFamilies: [], imageModelFamilies: [] };
    this.workflows = opts.workflows ?? [];
    this.externalRef = opts.externalRef ?? [];
  }
  async open() {
    if (this.openError) throw this.openError;
    return { pageUrl: "https://labs.google/fx/zh/tools/flow/project/test-project" };
  }
  async pageFetch(args) {
    this.calls.push(args);
    if (args.url.includes("/fx/api/auth/session")) {
      this.sessionCount++;
      return this.json(this.sessionBody);
    }
    if (args.url.includes("credits?key=")) return this.json(this.creditsBody);
    if (args.url.includes("flow.projectInitialData")) {
      return this.json({ result: { data: { json: { projectContents: { media: this.media, workflows: this.workflows, externalReferenceMedia: this.externalRef }, modelConfig: this.modelConfig } } } });
    }
    if (args.url.includes("media.getMediaUrlRedirect")) {
      return { ok: true, status: 200, contentType: this.downloadCt, bodyB64: this.downloadB64 };
    }
    // 两个真实提交端点在测试里只经 stub 落到这三个分支(零真实网络):
    if (args.method === "POST" && args.url.includes("/flow/uploadImage")) {
      this.uploadCount = (this.uploadCount ?? 0) + 1;
      return this.json({ media: { name: `upload-${this.uploadCount}`, image: { dimensions: { width: 64, height: 64 } } } });
    }
    if (args.method === "POST" && args.url.includes("/video:")) {
      return this.json({ remainingCredits: 856, media: this.submitMedia });
    }
    if (args.method === "POST" && args.url.includes("flowMedia:cancelGeneration")) {
      this.cancelBodies.push(JSON.parse(Buffer.from(args.bodyB64, "base64").toString("utf8")));
      return this.json({});
    }
    if (args.method === "POST" && args.url.includes("flow.share.shareMedia")) {
      this.shareBodies.push(JSON.parse(Buffer.from(args.bodyB64, "base64").toString("utf8")));
      return this.json({ result: { data: { json: { result: { mediaShareId: "share-" + (this.shareBodies.length) + "-uuid" } } } } });
    }
    if (args.method === "POST" && args.url.includes("flowMedia:")) {
      return this.json({ media: this.submitMedia });
    }
    if (args.method === "POST" && args.url.includes("/flow/upsampleImage")) {
      this.upsampleCount = (this.upsampleCount ?? 0) + 1;
      return this.json({ media: { name: `up-${this.upsampleCount}` } });
    }
    if (args.method === "POST" && args.url.includes("flow:batchDeleteAssets")) {
      this.deleteBodies = this.deleteBodies ?? [];
      let body: any = {};
      try { body = JSON.parse(Buffer.from(args.bodyB64, "base64").toString("utf8")); } catch {}
      this.deleteBodies.push(body);
      if (Array.isArray(body.mediaIds)) {
        const set = new Set(body.mediaIds);
        this.media = this.media.filter((m: any) => !set.has(m?.name));
      }
      return this.json({});
    }
    return { ok: false, status: 404, contentType: "text/plain", bodyB64: Buffer.from("stub: no route").toString("base64") };
  }
  async recaptchaToken(siteKey: string, action: string) {
    this.rcCalls.push({ siteKey, action });
    return "stub-recaptcha-token";
  }
  json(obj, status = 200) {
    return { ok: status < 400, status, contentType: "application/json", bodyB64: Buffer.from(JSON.stringify(obj)).toString("base64") };
  }
}

const MEDIA_ID_A = "60679485-0863-4007-8ea1-314ed661168d"; // 验收指定的真实已完成视频(此处仅作字符串 fixture)
/** 1x1 PNG data: URI(带图链路测试输入;嗅探 → image/png 1x1 → SQUARE)。 */
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_1PX_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const doneMedia = (name, extra = {}) => ({
  name,
  mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL" }, mediaBlobSize: "2351072", createTime: "2026-08-21T18:13:16Z" },
  video: { generatedVideo: { seed: 18075, model: "abra_t2v_8s", prompt: "a serene mountain lake at dawn" } },
  dimensions: { length: "8s" },
  ...extra,
});

function newProvider(opts: any = {}) {
  const t = new StubTransport(opts);
  const p = new FlowProvider({ transport: t, projectId: "proj-test", ...(opts.providerCfg ?? {}) });
  return { t, p };
}

// ═══ 1. 错误契约 ═══

describe("flow 错误契约([flow] S\\d+ 前缀)", () => {
  test("FlowError 消息带 [flow] S 码 + Hint", () => {
    const e = new FlowError("S100", "CDP 不可连", { hint: "launch chrome" });
    assert.match(e.message, /^\[flow\] S\d+ /);
    assert.ok(e.message.includes("Hint: launch chrome"));
    assert.equal(e.code, "S100");
  });
  test("无 flowStatus 时不伪造 .status(非瞬时,不被重试/fallback 掩盖)", () => {
    const e = new FlowError("S300", "x");
    assert.equal((e as any).status, undefined);
  });
  test("flowStatus=0 标记瞬时(供 poll 重试语义)", () => {
    const e = new FlowError("S103", "x", { flowStatus: 0 });
    assert.equal((e as any).status, 0);
  });
});

// ═══ 2. 前置检测缓存 TTL 30s ═══

describe("前置检测缓存(TTL 30s)", () => {
  test("TTL 内二次 ensureReady 不重复探测 session(sessionCount 恒 1)", async () => {
    const { t, p } = newProvider();
    const r1 = await p.ensureReady();
    const r2 = await p.ensureReady();
    assert.equal(t.sessionCount, 1);
    assert.equal(r1.email, "tester@example.com");
    assert.equal(r2.email, r1.email);
  });
  test("TTL 过期后重新探测(sessionCount=2)", async () => {
    const { t, p } = newProvider();
    await p.ensureReady();
    p.preflightTtlMs = 0; // 白盒:立即过期
    await p.ensureReady();
    assert.equal(t.sessionCount, 2);
  });
  test("open 失败(S100)原样传播且不缓存", async () => {
    const { p } = newProvider({ openError: new FlowError("S100", "CDP 127.0.0.1:9223 不可连") });
    await assert.rejects(() => p.ensureReady(), (e: any) => e.code === "S100" && /^\[flow\] S100 /.test(e.message));
  });
  test("session 无 access_token → S102", async () => {
    const { p } = newProvider({ sessionBody: {} });
    await assert.rejects(() => p.ensureReady(), (e: any) => e.code === "S102");
  });
});

// ═══ 3. 媒体状态机(契约 §2.3/§5) ═══

describe("mapMediaStatus 状态机", () => {
  test("SUCCESSFUL → completed(带 rawStatus)", () => {
    const r = mapMediaStatus(doneMedia("m1"));
    assert.equal(r.status, "completed");
    assert.equal(r.rawStatus, "MEDIA_GENERATION_STATUS_SUCCESSFUL");
  });
  test("SCHEDULED → in_progress", () => {
    const r = mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" } } });
    assert.equal(r.status, "in_progress");
  });
  test("FAILED(未观察枚举)→ 失败并回传原文(契约 §5 预答)", () => {
    const r = mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_FAILED" } } });
    assert.equal(r.status, "failed");
    assert.ok(r.error.includes("MEDIA_GENERATION_STATUS_FAILED"));
  });
  test("无 mediaStatus 但已有 generatedVideo → completed(实测:已完成资产不带 mediaStatus)", () => {
    const r = mapMediaStatus({ video: { generatedVideo: { model: "abra_t2v_8s" } } });
    assert.equal(r.status, "completed");
  });
  test("无状态无结果 → failed", () => {
    assert.equal(mapMediaStatus({}).status, "failed");
  });
});

// ═══ 4. 模型目录与 key 解析(白盒纯函数) ═══

describe("模型目录", () => {
  test("实测快照 key 逐字在目录(2026-08-22 projectInitialData 核对)", () => {
    for (const k of ["abra_t2v_4s", "abra_t2v_10s", "abra_i2v_6s", "abra_r2v_8s", "abra_edit",
      "veo_3_1_t2v_lite", "veo_3_1_interpolation_lite", "veo_3_1_t2v_fast_portrait_ultra",
      "veo_3_1_i2v_s", "veo_3_1_upsampler_1080p", "veo_3_1_t2v_lite_low_priority"]) {
      assert.ok(FLOW_VIDEO_MODELS.includes(k), `缺 ${k}`);
    }
    assert.deepEqual(FLOW_IMAGE_MODELS, ["GEM_PIX_2", "NARWHAL", "HARBOR_SEAL", "GEM_PIX_2_UPSAMPLE_2K"]);
    assert.deepEqual([...FLOW_VIDEO_DURATIONS], [4, 6, 8, 10]);
  });
  test("videoConstraints:duration×24fps 映射通用 numFrames 语义", () => {
    const p = new FlowProvider({ transport: new StubTransport() });
    assert.deepEqual(p.videoConstraints(), {
      allowedNumFrames: [96, 144, 192, 240], defaultNumFrames: 192, defaultFrameRate: 24, allowedFrameRates: [24],
    });
  });
});

describe("resolveVideoModelKey", () => {
  test("mnemonic + duration 组合完整 key", () => {
    const r = resolveVideoModelKey("abra_t2v", 8);
    assert.equal(r.key, "abra_t2v_8s");
  });
  test("显式 key 自带时长,与 durationSeconds 冲突 → S301", () => {
    assert.throws(() => resolveVideoModelKey("abra_t2v_8s", 4), (e: any) => e.code === "S301");
  });
  test("未知模型 → S300", () => {
    assert.throws(() => resolveVideoModelKey("not_a_model"), (e: any) => e.code === "S300");
  });
  test("veo 无后缀 key + 4s → 自动切 _4s 变体并告警", () => {
    const r = resolveVideoModelKey("veo_3_1_t2v_fast", 4);
    assert.equal(r.key, "veo_3_1_t2v_fast_4s");
    assert.ok(r.warnings.length >= 1);
  });
  test("veo + 10s → S301(veo 家族无 10s)", () => {
    assert.throws(() => resolveVideoModelKey("veo_3_1_t2v_lite", 10), (e: any) => e.code === "S301");
  });
  test("durationSeconds 非法(非 4/6/8/10)→ S301", () => {
    assert.throws(() => resolveVideoModelKey("abra_t2v", 7), (e: any) => e.code === "S301");
  });
});

describe("sizeToImageAspect / estimateVideoCredits", () => {
  test("WxH → 最近似比例枚举", () => {
    assert.equal(sizeToImageAspect("1024x1024"), "SQUARE");
    assert.equal(sizeToImageAspect("1920x1080"), "LANDSCAPE");
    assert.equal(sizeToImageAspect("720x1280"), "PORTRAIT");
    assert.equal(sizeToImageAspect("768x1024"), "PORTRAIT_THREE_FOUR");
    assert.equal(sizeToImageAspect("1024x768"), "LANDSCAPE_FOUR_THREE");
    assert.equal(sizeToImageAspect(undefined), "LANDSCAPE");
    assert.equal(sizeToImageAspect("bogus"), "LANDSCAPE");
  });
  test("积分估算(契约 §3 表)", () => {
    assert.equal(estimateVideoCredits("abra_t2v_4s"), 7);
    assert.equal(estimateVideoCredits("abra_t2v_8s"), 12);
    assert.equal(estimateVideoCredits("abra_edit"), 20);
    assert.equal(estimateVideoCredits("veo_3_1_t2v_lite"), 10);
    assert.equal(estimateVideoCredits("veo_3_1_t2v_fast_4s"), 20);
    assert.equal(estimateVideoCredits("veo_3_1_t2v"), 100);
    assert.equal(estimateVideoCredits("veo_3_1_upsampler_1080p"), 0);
  });
});

// ═══ 5. submitOnly 队列语义(🔴 零消耗:StubTransport 隔离,无任何真实网络/积分) ═══

describe("createVideo submitOnly 语义(stub 隔离,零真实消耗)", () => {
  test("提交即返回 queued handle,绝不轮询等待;v2 wire(契约 §7.3:requests[]/videoModelKey/useV2ModelConfig)", async () => {
    const { t, p } = newProvider();
    const task = await p.createVideo({ prompt: "a test", model: "abra_t2v_8s" });
    assert.equal(task.status, "queued");
    assert.equal(task.taskId, "media-new-1");
    assert.ok(task.warnings.some((w) => w.includes("预计消耗 12 积分")), "提交 warning 应含积分预估");
    // submit-only:calls 里不应有 projectInitialData(那属于轮询路径 getVideo)
    assert.ok(!t.calls.some((c) => c.url.includes("projectInitialData")), "createVideo 不得轮询");
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("/video:"));
    assert.ok(post, "应有且仅有一次提交 POST");
    assert.equal(post.url, "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText", "t2v 模式 → Text 端点(契约 §7.3 端点表)");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    // v2 请求体(2026-08-23 live 实证;旧顶层 structuredPrompt/seed/videoModelControlInput 会 400 Unknown name)
    assert.equal(body.useV2ModelConfig, true);
    assert.equal(body.requests.length, 1);
    const item = body.requests[0];
    assert.equal(item.videoModelKey, "abra_t2v_8s");
    assert.equal(item.aspectRatio, "VIDEO_ASPECT_RATIO_LANDSCAPE");
    assert.equal(item.outputSpec.resolution, "VIDEO_RESOLUTION_720P");
    assert.deepEqual(item.textInput.structuredPrompt.parts, [{ text: "a test" }]);
    assert.equal(item.textInput.prompt, "a test");
    assert.ok(typeof item.metadata.mediaIdSeed === "string" && item.metadata.mediaIdSeed.length > 20);
    assert.equal(item.startImage, undefined, "t2v 不带 startImage");
    assert.equal(item.endImage, undefined, "t2v 不带 endImage");
    assert.equal(body.mediaGenerationContext.audioFailurePreference, "BLOCK_SILENCED_VIDEOS");
    assert.equal(body.clientContext.tool, "PINHOLE");
    assert.equal(body.clientContext.recaptchaContext.token, "stub-recaptcha-token");
    // reCAPTCHA action(2026-08-23 live 双 200 实证:i2v/首尾帧均用 VIDEO_GENERATION)
    assert.deepEqual(t.rcCalls, [{ siteKey: "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV", action: "VIDEO_GENERATION" }]);
  });
  test("9:16 → PORTRAIT;seed 透传(v2 wire)", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "abra_t2v_8s", ratio: "9:16", seed: 42 });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/video:")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].aspectRatio, "VIDEO_ASPECT_RATIO_PORTRAIT");
    assert.equal(body.requests[0].seed, 42);
  });
});

// ═══ 5b. 带图链路 wire(契约 §7.1/§7.2/§7.3,live 实证形状;stub 隔离,零真实消耗) ═══

describe("带图链路 wire 构造(i2v/首尾帧/图生图/上传;stub 隔离零消耗)", () => {
  test("uploadMedia:data: URI → /v1/flow/uploadImage,body 带 imageBytes/mediaIdSeed/mimeType 且无 reCAPTCHA(契约 §7.1)", async () => {
    const { t, p } = newProvider();
    const up = await p.uploadMedia(PNG_1PX);
    assert.equal(up.mediaId, "upload-1");
    assert.equal(up.mimeType, "image/png");
    assert.equal(up.width, 1);
    assert.equal(up.imageAspect, "SQUARE", "1x1 嗅探 → SQUARE");
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("/flow/uploadImage"));
    assert.ok(post, "应有上传 POST");
    assert.equal(post.url, "https://aisandbox-pa.googleapis.com/v1/flow/uploadImage");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.ok(body.imageBytes.length > 50, "imageBytes = base64 原始字节");
    assert.equal(body.mimeType, "image/png");
    assert.ok(body.mediaIdSeed && body.workflowIdSeed, "mediaIdSeed/workflowIdSeed 必填(契约 §7.1)");
    assert.equal(body.isUserUploaded, true);
    assert.deepEqual(body.cropCoordinates, {});
    assert.equal(body.clientContext.recaptchaContext, undefined, "上传不需要 reCAPTCHA(契约 §7.4 实证)");
    assert.deepEqual(t.rcCalls, [], "uploadMedia 全程零 reCAPTCHA 调用");
  });
  test("i2v:image → StartImage 端点 + startImage{aspectRatio,mediaId}(契约 §7.3 live 形状)", async () => {
    const { t, p } = newProvider();
    const task = await p.createVideo({ prompt: "x", model: "abra_i2v_8s", image: PNG_1PX });
    assert.equal(task.taskId, "media-new-1");
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("/video:"));
    assert.equal(post.url, "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage", "i2v → StartImage 端点");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].videoModelKey, "abra_i2v_8s");
    // oneof source:只发 mediaId(与 imageBytes 同发会 400,契约 §7.3 实证)
    assert.deepEqual(body.requests[0].startImage, { aspectRatio: "IMAGE_ASPECT_RATIO_SQUARE", mediaId: "upload-1" });
    assert.equal(body.requests[0].startImage.imageBytes, undefined, "mediaId 与 imageBytes 是 oneof,不得同发");
    assert.equal(body.requests[0].endImage, undefined);
    assert.ok(t.calls.some((c) => c.method === "POST" && c.url.includes("/flow/uploadImage")), "先上传后提交");
    assert.deepEqual(t.rcCalls, [{ siteKey: "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV", action: "VIDEO_GENERATION" }]);
    assert.ok(task.warnings.some((w) => w.includes("预计消耗 12 积分")), "abra_i2v_8s = 12 点");
  });
  test("首尾帧:keyframes 2 张 → StartAndEndImage 端点 + startImage/endImage 各自 mediaId", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: [PNG_1PX, PNG_1PX_B] });
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("/video:"));
    assert.equal(post.url, "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartAndEndImage");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].videoModelKey, "veo_3_1_interpolation_lite");
    assert.equal(body.requests[0].startImage.mediaId, "upload-1", "keyframes[0] → startImage");
    assert.equal(body.requests[0].endImage.mediaId, "upload-2", "keyframes[1] → endImage(两次独立上传)");
  });
  test("_fl 族 key 也走首尾帧端点(videoModeOfKey: _fl = interpolation)", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "veo_3_1_i2v_s_fast_fl", keyframes: [PNG_1PX, PNG_1PX_B] });
    assert.ok(t.calls.some((c) => c.method === "POST" && c.url.includes("batchAsyncGenerateVideoStartAndEndImage")));
  });
  test("图生图:images[0]=BASE_IMAGE + images[1..]=REFERENCE;比例强制 UNSPECIFIED(契约 §7.2 live 形状)", async () => {
    const submitted = { name: "img-b1" };
    const { t, p } = newProvider({
      submitMedia: [submitted],
      media: [{ name: "img-b1", image: { generatedImage: { seed: 9 } } }],
      downloadCt: "image/png",
    });
    const r = await p.generateImage({ prompt: "golden sunset version", images: [PNG_1PX, PNG_1PX_B], aspect: "16:9" });
    assert.equal(r.outputs.length, 1);
    assert.ok(r.warnings.some((w: string) => w.includes("强制 IMAGE_ASPECT_RATIO_UNSPECIFIED")), "显式比例被忽略须告警");
    const uploads = t.calls.filter((c) => c.method === "POST" && c.url.includes("/flow/uploadImage"));
    assert.equal(uploads.length, 2, "两张图各上传一次");
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("flowMedia:batchGenerateImages"));
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.deepEqual(body.requests[0].imageInputs, [
      { imageInputType: "IMAGE_INPUT_TYPE_BASE_IMAGE", name: "upload-1" },
      { imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: "upload-2" },
    ]);
    assert.equal(body.requests[0].imageAspectRatio, "IMAGE_ASPECT_RATIO_UNSPECIFIED", "带底图比例随底图(客户端实证)");
  });
  test("images 超上限(>10)→ S301(零提交零上传)", async () => {
    const { t, p } = newProvider();
    const many = Array.from({ length: 11 }, () => PNG_1PX);
    await assert.rejects(
      () => p.generateImage({ prompt: "x", images: many }),
      (e: any) => e.code === "S301" && e.message.includes("最多 10"),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交/上传");
  });
});

// ═══ 6. 校验拒绝路径(全部零网络:抛错先于任何 POST) ═══

describe("校验拒绝(开放集边界;全部零网络:抛错先于任何 POST)", () => {
  test("无 model → S300(刻意无默认,防误耗积分)+ 消耗表 hint", async () => {
    const { t, p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x" }),
      (e: any) => e.code === "S300" && e.message.includes("消耗积分") && e.message.includes("Hint:"),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交");
  });
  test("t2v key + image → S301(指路 i2v key,提交点不静默换模)", async () => {
    const { t, p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_t2v_8s", image: PNG_1PX }),
      (e: any) => e.code === "S301" && e.message.includes("abra_i2v_8s"),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交");
  });
  test("i2v key 无 image → S301(指路 t2v key)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_i2v_8s" }),
      (e: any) => e.code === "S301" && e.message.includes("image"),
    );
  });
  test("interpolation key 无 keyframes → S301;keyframes≠2 张 → S301;t2v key + keyframes → S301", async () => {
    const { t, p } = newProvider();
    await assert.rejects(() => p.createVideo({ prompt: "x", model: "veo_3_1_interpolation_lite" }), (e: any) => e.code === "S301");
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: [PNG_1PX] }),
      (e: any) => e.code === "S301" && e.message.includes("2 张"),
    );
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_t2v_lite", keyframes: [PNG_1PX, PNG_1PX_B] }),
      (e: any) => e.code === "S301" && e.message.includes("interpolation"),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交");
  });
  test("image 与 keyframes 互斥 → S301", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_i2v_8s", image: PNG_1PX, keyframes: [PNG_1PX, PNG_1PX_B] }),
      (e: any) => e.code === "S301" && e.message.includes("互斥"),
    );
  });
  test("ratio 1:1 → S301(视频仅 16:9/9:16)", async () => {
    await assert.rejects(() => newProvider().p.createVideo({ prompt: "x", model: "abra_t2v_8s", ratio: "1:1" }), (e: any) => e.code === "S301");
  });
  test("未知图片模型 → S300;supportsImageToImage=true(2026-08-23 开放带图)", async () => {
    const { p } = newProvider();
    assert.equal(p.supportsImageToImage(), true);
    await assert.rejects(() => p.generateImage({ prompt: "x", model: "NOPE" }), (e: any) => e.code === "S300");
  });
  test("uploadMedia 非 URI 输入 → S301(本地路径拒绝,与工具层 H3 对称)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.uploadMedia("/Users/local/file.png"),
      (e: any) => e.code === "S301" && e.message.includes("http(s)"),
    );
  });
});

// ═══ 7. getVideo / mediaStatus(零消耗只读路径) ═══

describe("getVideo(零消耗轮询/取件)", () => {
  test("completed → data:video/mp4 URI(供工具层 downloadAsset 落盘)", async () => {
    const { p } = newProvider({ media: [doneMedia(MEDIA_ID_A)] });
    const r = await p.getVideo({ taskId: MEDIA_ID_A });
    assert.equal(r.status, "completed");
    assert.match(r.url, /^data:video\/mp4;base64,/);
    assert.equal(r.raw.model, "abra_t2v_8s");
    assert.equal(r.raw.seed, 18075);
  });
  test("SCHEDULED → in_progress(不下载)", async () => {
    const { p } = newProvider({ media: [{ name: "m-run", mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" } } }] });
    const r = await p.getVideo({ taskId: "m-run" });
    assert.equal(r.status, "in_progress");
    assert.equal(r.url, undefined);
  });
  test("FAILED → failed + 原文", async () => {
    const { p } = newProvider({ media: [{ name: "m-bad", mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_FAILED" } } }] });
    const r = await p.getVideo({ taskId: "m-bad" });
    assert.equal(r.status, "failed");
    assert.ok(r.error.includes("MEDIA_GENERATION_STATUS_FAILED"));
  });
  test("mediaId 不在项目 → S400", async () => {
    const { p } = newProvider({ media: [] });
    await assert.rejects(() => p.mediaStatus("ghost-id"), (e: any) => e.code === "S400");
    await assert.rejects(() => p.getVideo({ taskId: "ghost-id" }), (e: any) => e.code === "S400");
  });
  test("mediaStatus 结构字段(kind/model/seed/bytes/created/prompt)", async () => {
    const { p } = newProvider({ media: [doneMedia(MEDIA_ID_A)] });
    const st = await p.mediaStatus(MEDIA_ID_A);
    assert.equal(st.kind, "video");
    assert.equal(st.model, "abra_t2v_8s");
    assert.equal(st.seed, 18075);
    assert.equal(st.bytes, 2351072);
    assert.equal(st.durationSeconds, 8);
    assert.ok(st.prompt.includes("mountain lake"));
  });
});

// ═══ 7b. F 轮:缩略图下载 wire(§2.6 勘误 / §10.9;零消耗只读路径) ═══

describe("getMediaBytes thumbnail(2026-08-23 F 轮 live 勘误回归)", () => {
  // live 实证:2,508,689B 视频的缩略图 = 43,007B raw JPEG(FF D8 开头),非 base64 文本(§10.9)
  const THUMB_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(37, 0x11)]);
  test("thumbnail=true → URL 带 MEDIA_URL_TYPE_THUMBNAIL + 返回 raw JPEG 字节(FF D8)", async () => {
    const { t, p } = newProvider({
      media: [doneMedia("v-done")],
      downloadB64: THUMB_JPEG.toString("base64"),
      downloadCt: "image/jpeg",
    });
    const got = await p.getMediaBytes("v-done", { thumbnail: true });
    const call = t.calls.find((c: any) => c.url.includes("mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL"));
    assert.ok(call, "缩略图下载必须带 mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL(§2.6)");
    assert.equal(got.contentType, "image/jpeg");
    assert.equal(got.buf[0], 0xff);
    assert.equal(got.buf[1], 0xd8, "raw JPEG magic(FF D8)—— §2.6 勘误:非 base64 文本");
    // 回归锚点:缩略图字节数与本资产 mediaBlobSize(2351072)本就不同 —— 工具层完整性闸门
    // 不得拿缩略图字节对比原资产尺寸(旧 bug:已完成视频取缩略图 100% 误报 S402,见 index.ts flow_status)
    assert.notEqual(got.buf.length, 2351072);
  });
  test("无 thumbnail → 原始资产下载(URL 无 mediaUrlType)", async () => {
    const { t, p } = newProvider({ media: [doneMedia("v-done")] });
    await p.getMediaBytes("v-done");
    const call = t.calls.find((c: any) => c.url.includes("media.getMediaUrlRedirect"));
    assert.ok(call);
    assert.ok(!call.url.includes("mediaUrlType"), "默认原始资产不带 mediaUrlType");
  });
});

// ═══ 8. fallback 安全(不破坏 agnes 默认路由) ═══

describe("fallback 安全", () => {
  // C 任务:隔离 ~/.media-gen-mcp/config.json(本机已配 imageProviderPriority 含 flow)——
  // 显式置 null = 强制「未配置优先级」语义,断言 legacy 免费链行为(与 CI 无 config 环境逐字节一致)。
  const reg = require_(path.join(distDir, "providers/registry.js"));
  reg.__priorityOverrideForTests.image = null;
  reg.__priorityOverrideForTests.video = null;

  test("flow 实现 capabilities()(能力事实)+ requiresOptIn(准入策略)→ 未显式同意时任何模态的免费 fallback 都不选 flow", () => {
    const { getFallbackProvider, getProvider } = reg;
    // 能力事实:capableOf 谈判可用(优先级链经同一管线);准入策略:两模态都 optIn-only
    const flow = getProvider("flow");
    assert.deepEqual(flow.capabilities(), {
      image: { textToImage: true, imageToImage: true },
      video: { textToVideo: true, imageToVideo: true, keyframes: true },
    });
    assert.equal(flow.requiresOptIn("image"), true);
    assert.equal(flow.requiresOptIn("video"), true);
    const scenarios = [
      ["image", {}], ["image", { images: ["https://a/b.png"] }],
      ["video", {}], ["video", { mode: "text-to-video" }], ["video", { mode: "image-to-video", image: "https://a/b.png" }], ["video", { mode: "keyframes", keyframes: ["https://a/b.png"] }],
      ["vision", { task: "extract-text" }],
    ];
    for (const [modality, req] of scenarios) {
      const fb = getFallbackProvider("agnes", modality, req);
      assert.notEqual(fb?.name, "flow", `fallback(${modality}) 不得选中 flow`);
      const fb2 = getFallbackProvider("zhipu", modality, req);
      assert.notEqual(fb2?.name, "flow", `fallback(${modality}) 不得选中 flow`);
    }
  });
  test("health().configured 初始 false(CDP 从未就绪前不宣称可用)", () => {
    const p = new FlowProvider({ transport: new StubTransport() });
    assert.equal(p.health().configured, false);
  });
  test("环境前置错误带 precondition 标记(isChainAdvanceable 依据;业务错不带)", () => {
    const { isChainAdvanceable } = require_(path.join(distDir, "providers/http.js"));
    const mk = (code: string, opts?: any) => new FlowError(code, "x", opts);
    assert.equal(mk("S100", { precondition: true }).precondition, true);
    assert.equal(mk("S102", { precondition: true }).precondition, true);
    assert.equal(isChainAdvanceable(mk("S100", { precondition: true })), true, "S100 链推进");
    assert.equal(isChainAdvanceable(mk("S102", { precondition: true })), true, "S102 链推进");
    assert.equal(isChainAdvanceable(mk("S301")), false, "参数业务错不推进");
    assert.equal(isChainAdvanceable(mk("S103")), false, "S103 无 flowStatus 语义保留(不推进)");
    assert.equal(isChainAdvanceable(mk("S201", { flowStatus: 500 })), true, "上游 5xx 推进");
  });
});

// ═══ 9. generateImage 提交构造(stub 隔离,🔴 零真实消耗:0 点生图也仅走 stub) ═══

describe("generateImage(stub 隔离,零真实消耗)", () => {
  test("提交 → 已完成 → data: URI 产出(默认 NARWHAL / LANDSCAPE)", async () => {
    const submitted = { name: "img-1" };
    const { t, p } = newProvider({
      // 提交后 projectInitialData 立即返回已完成的图(带 generatedImage,无 mediaStatus —— 实测形状)
      media: [{ name: "img-1", image: { generatedImage: { seed: 7 } }, mediaMetadata: { mediaBlobSize: "1000963" } }],
      submitMedia: [submitted],
      downloadCt: "image/png",
      providerCfg: {},
    });
    const r = await p.generateImage({ prompt: "a cozy cabin" });
    assert.equal(r.outputs.length, 1);
    assert.match(r.outputs[0].url, /^data:image\/png;base64,/);
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("flowMedia:"));
    assert.ok(post, "应有生图提交(stub)");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].imageModelName, "NARWHAL");
    assert.equal(body.requests[0].imageAspectRatio, "IMAGE_ASPECT_RATIO_LANDSCAPE");
    assert.deepEqual(body.requests[0].structuredPrompt.parts, [{ text: "a cozy cabin" }]);
    assert.equal(body.requests.length, 1, "单次调用单请求(工具层 n 批量已 fan-out)");
    assert.deepEqual(body.requests[0].imageInputs, []);
    assert.equal(body.useNewMedia, true);
    assert.equal(body.clientContext.tool, "PINHOLE");
    assert.deepEqual(t.rcCalls, [{ siteKey: "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV", action: "IMAGE_GENERATION" }], "生图 action = IMAGE_GENERATION(重放验证)");
  });
  test("size 720x1280 → PORTRAIT", async () => {
    const { t, p } = newProvider({
      submitMedia: [{ name: "img-1" }],
      media: [{ name: "img-1", image: { generatedImage: {} } }],
      downloadCt: "image/png",
    });
    await p.generateImage({ prompt: "x", size: "720x1280" });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST").bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].imageAspectRatio, "IMAGE_ASPECT_RATIO_PORTRAIT");
  });
});

// ═══ 10. 模式门禁(契约 §7.3/§9:E 轮开放 r2v/extension/upsampler;E-parity 轮开放 edit §11.1) ═══

describe("非开放模式门禁(S303 带依据,零提交)", () => {
  const notOpen: Array<[string, RegExp]> = [
    ["veo_3_1_upsampler_4k", /UNAVAILABLE/],
  ];
  for (const [key, why] of notOpen) {
    test(`createVideo("${key}") → S303(依据:${key} 未开放)`, async () => {
      const { t, p } = newProvider();
      await assert.rejects(
        () => p.createVideo({ prompt: "x", model: key }),
        (e: any) => e.code === "S303" && e.message.includes(key) && why.test(e.message),
      );
      assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交");
    });
  }
  test("E 轮新开放模式不再 S303(r2v/extension/upsampler 形状/提交均已 live 验证;edit 已在 E-parity 放行 §11.1)", async () => {
    const { p } = newProvider({ media: [doneMedia("vid-src-1")] });
    // r2v 带 images / extension·upsampler 带 videoMediaId 均应走到 stub 提交(不再抛 S303)
    await p.createVideo({ prompt: "x", model: "abra_r2v_4s", images: [PNG_1PX] });
    await p.createVideo({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-1" });
    await p.createVideo({ prompt: "x", model: "veo_3_1_upsampler_1080p", videoMediaId: "vid-src-1" });
    // edit(E-parity §11.1):wire 探针定型 → 不再 S303;缺 videoMediaId → S301 指路(不是模式拒绝)
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_edit" }),
      (e: any) => e.code === "S301" && e.message.includes("videoMediaId"),
    );
  });
  test("开放集 key 直传可解析(resolveVideoModelKey 纯解析,i2v/interpolation 不再在 key 层 S303)", () => {
    for (const k of ["abra_i2v_8s", "veo_3_1_interpolation_lite", "veo_3_1_i2v_s_fast_fl", "veo_3_1_i2v_lite", "abra_r2v_8s", "veo_3_1_extension_lite", "veo_3_1_upsampler_1080p", "abra_edit"]) {
      assert.equal(resolveVideoModelKey(k).key, k, `${k} 应可解析`);
    }
    assert.equal(resolveVideoModelKey("abra_i2v", 8).key, "abra_i2v_8s", "mnemonic abra_i2v + 8 → 完整 key");
    assert.equal(resolveVideoModelKey("abra_r2v", 4).key, "abra_r2v_4s", "mnemonic abra_r2v + 4 → 完整 key");
  });
  test("t2v 族 key 不受门禁影响(正例)", () => {
    for (const k of ["abra_t2v_8s", "veo_3_1_t2v_lite", "veo_3_1_t2v_fast_ultra", "veo_3_1_t2v", "veo_3_1_t2v_lite_low_priority"]) {
      assert.equal(resolveVideoModelKey(k).key, k, `${k} 应放行`);
    }
  });
  test("动态目录优先校验(allowedKeys 参数,audit finding-7)", () => {
    // 静态目录外的 key:默认 S300;动态目录含它则放行(仍受模式门禁约束)
    assert.throws(() => resolveVideoModelKey("veo_3_2_t2v_8s"), (e: any) => e.code === "S300");
    const dyn = [...FLOW_VIDEO_MODELS, "veo_3_2_t2v_8s"];
    assert.equal(resolveVideoModelKey("veo_3_2_t2v_8s", undefined, dyn).key, "veo_3_2_t2v_8s");
    // 动态目录已下线的静态 key → 按动态目录 S300(不再放行)
    const shrunk = FLOW_VIDEO_MODELS.filter((k: string) => k !== "abra_t2v_10s");
    assert.throws(() => resolveVideoModelKey("abra_t2v_10s", undefined, shrunk), (e: any) => e.code === "S300");
  });
});

// ═══ 11. durationSeconds 吸附 + 丢弃参数告警(audit finding-3/4/10) ═══

describe("createVideo 吸附与丢弃告警(stub 隔离,零真实消耗;v2 wire 断言)", () => {
  test("durationSeconds=5(model=abra_t2v)→ 吸附 4s + warning(不再 S301)", async () => {
    const { t, p } = newProvider();
    const task = await p.createVideo({ prompt: "x", model: "abra_t2v", durationSeconds: 5 });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/video:")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].videoModelKey, "abra_t2v_4s");
    assert.ok(task.warnings.some((w: string) => w.includes("吸附为 4s")), `应含吸附告警,得 ${JSON.stringify(task.warnings)}`);
  });
  test("durationSeconds=12 → 吸附 10s", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "abra_t2v", durationSeconds: 12 });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/video:")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].videoModelKey, "abra_t2v_10s");
  });
  test("resolution=1080p → warning + 仍 720P(分辨率由 key 决定;v2 wire 在 outputSpec)", async () => {
    const { t, p } = newProvider();
    const task = await p.createVideo({ prompt: "x", model: "abra_t2v_8s", resolution: "1080p" });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/video:")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].outputSpec.resolution, "VIDEO_RESOLUTION_720P");
    assert.ok(task.warnings.some((w: string) => w.includes("resolution=1080p 已忽略")));
  });
  test("negativePrompt → 忽略告警(不静默丢弃)", async () => {
    const { p } = newProvider();
    const task = await p.createVideo({ prompt: "x", model: "abra_t2v_8s", negativePrompt: "blurry" });
    assert.ok(task.warnings.some((w: string) => w.includes("negativePrompt")));
  });
});

// ═══ 12. getVideo kind 门禁 + 下载完整性(audit finding-11/18) ═══

describe("getVideo kind 门禁与字节完整性", () => {
  test("image mediaId 经 getVideo → S403(不再把 JPEG 字节贴 .mp4)", async () => {
    const { p } = newProvider({ media: [{ name: "img-m", image: { generatedImage: { seed: 1 } } }] });
    await assert.rejects(
      () => p.getVideo({ taskId: "img-m" }),
      (e: any) => e.code === "S403" && e.message.includes("image") && e.message.includes("flow_status"),
    );
  });
  test("下载字节 ≠ mediaBlobSize → S402(截断检测)", async () => {
    const { p } = newProvider({
      media: [doneMedia(MEDIA_ID_A)],
      downloadB64: Buffer.from("short").toString("base64"),
    });
    await assert.rejects(() => p.getVideo({ taskId: MEDIA_ID_A }), (e: any) => e.code === "S402" && e.message.includes("≠"));
  });
});

// ═══ 13. 生图直通参数 aspect/seed + outputs 对应关系(audit finding-2/6/13) ═══

describe("generateImage aspect/seed 与 outputs mediaId/seed", () => {
  test("aspect 一等参数直达请求体(精确枚举,不经 size 猜测)", async () => {
    const { t, p } = newProvider({
      submitMedia: [{ name: "img-9" }],
      media: [{ name: "img-9", image: { generatedImage: { seed: 4242 } } }],
      downloadCt: "image/png",
    });
    const r = await p.generateImage({ prompt: "x", aspect: "3:4", seed: 999 });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST").bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].imageAspectRatio, "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");
    assert.equal(body.requests[0].seed, 999, "seed 一等字段直达请求体");
    assert.equal(r.outputs[0].mediaId, "img-9", "outputs 须携带 mediaId(flow_status 可反查复下载)");
    assert.equal(r.outputs[0].seed, 4242, "outputs 须携带实际生成 seed");
  });
  test("aspect 非法值 → S301 列合法集", () => {
    const { aspectRatioToImageAspect } = require_(path.join(distDir, "providers/flow.js"));
    assert.throws(() => aspectRatioToImageAspect("21:9"), (e: any) => e.code === "S301" && e.message.includes("16:9"));
    assert.equal(aspectRatioToImageAspect("16:9"), "LANDSCAPE");
    assert.equal(aspectRatioToImageAspect("1:1"), "SQUARE");
  });
  test("GEM_PIX_2_UPSAMPLE_2K 不带 images → S301 指路(E 轮:放大已实现,须给源图)", async () => {
    const { t, p } = newProvider();
    await assert.rejects(
      () => p.generateImage({ prompt: "x", model: "GEM_PIX_2_UPSAMPLE_2K" }),
      (e: any) => e.code === "S301" && e.message.includes("images[0]"),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST"), "拒绝路径不得有提交");
  });
});

// ═══ 14. flowStatus per-key 积分价/需求透传(audit finding-8) ═══

describe("flowStatus creditMapping/requirements 透传", () => {
  test("usages 含 creditMapping/requirements/creditsAtServiceTier(按当前 tier 取 cost)", async () => {
    const { p } = newProvider({
      modelConfig: {
        imageModelFamilies: [],
        videoModelFamilies: [{
          id: "abra",
          displayName: "Omni Flash",
          usages: [{
            key: "abra_t2v_8s",
            generationTimeSeconds: 120,
            supportedAspectRatios: ["VIDEO_ASPECT_RATIO_LANDSCAPE"],
            requirements: [["IMAGE_REQUIREMENT_NONE"]],
            creditMapping: { SERVICE_TIER_INTERMEDIATE: { cost: 12 }, SERVICE_TIER_FREE: { cost: 0 } },
          }],
        }],
      },
    });
    const st = await p.flowStatus();
    const u = st.video_families[0].usages[0];
    assert.equal(u.creditMapping.SERVICE_TIER_INTERMEDIATE.cost, 12);
    assert.equal(u.creditsAtServiceTier, 12, "按 stub credits 的 serviceTier 取 cost");
    assert.deepEqual(u.requirements, [["IMAGE_REQUIREMENT_NONE"]]);
    assert.equal(u.generationTimeSeconds, 120);
  });
  test("estimateVideoCredits:abra i2v/r2v 按时长(修恒 15 高估)", () => {
    assert.equal(estimateVideoCredits("abra_i2v_4s"), 7);
    assert.equal(estimateVideoCredits("abra_r2v_6s"), 10);
    assert.equal(estimateVideoCredits("abra_i2v_8s"), 12);
    assert.equal(estimateVideoCredits("abra_r2v_10s"), 15);
    assert.equal(estimateVideoCredits("abra_t2v_4s"), 7);
  });
});

// ═══ 15. 任务 D 验收:视频参数构造矩阵(usage key 精确断言;stub 隔离,零提交零消耗) ═══

describe("任务D 视频参数构造(usage key 断言,stub 隔离零提交)", () => {
  /** 提交(打到 stub)并返回请求体 requests[0](v2 wire)。 */
  async function postedItem(t: any, p: any, req: any): Promise<any> {
    await p.createVideo(req);
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    assert.ok(post, "应有提交 POST(打到 stub)");
    return JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8")).requests[0];
  }
  test("durationSeconds=5(等距 4/6,tie 取小)→ 吸附 abra_t2v_4s", async () => {
    const { t, p } = newProvider();
    const item = await postedItem(t, p, { prompt: "x", model: "abra_t2v", durationSeconds: 5 });
    assert.equal(item.videoModelKey, "abra_t2v_4s");
  });
  test("numFrames=120(@24fps = 5s)→ 同样吸附 abra_t2v_4s", async () => {
    const { t, p } = newProvider();
    const item = await postedItem(t, p, { prompt: "x", model: "abra_t2v", numFrames: 120 });
    assert.equal(item.videoModelKey, "abra_t2v_4s");
  });
  test("durationSeconds=7(|7-6|<|7-8|)→ 吸附 abra_t2v_6s", async () => {
    const { t, p } = newProvider();
    const item = await postedItem(t, p, { prompt: "x", model: "abra_t2v", durationSeconds: 7 });
    assert.equal(item.videoModelKey, "abra_t2v_6s");
  });
  test('ratio "9:16" → VIDEO_ASPECT_RATIO_PORTRAIT;缺省 → LANDSCAPE', async () => {
    const { t, p } = newProvider();
    const item = await postedItem(t, p, { prompt: "x", model: "veo_3_1_t2v_lite", ratio: "9:16" });
    assert.equal(item.aspectRatio, "VIDEO_ASPECT_RATIO_PORTRAIT");
    assert.equal(item.videoModelKey, "veo_3_1_t2v_lite");
    const { t: t2, p: p2 } = newProvider();
    assert.equal((await postedItem(t2, p2, { prompt: "x", model: "veo_3_1_t2v_lite" })).aspectRatio, "VIDEO_ASPECT_RATIO_LANDSCAPE");
  });
  test("keyframes 2 张(首尾帧)→ StartAndEndImage 端点 + 两端 mediaId(2026-08-23 开放,live 实证形状)", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "veo_3_1_interpolation_lite", keyframes: [PNG_1PX, PNG_1PX_B] });
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    assert.ok(post.url.includes("batchAsyncGenerateVideoStartAndEndImage"), "首尾帧端点");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].startImage.mediaId, "upload-1");
    assert.equal(body.requests[0].endImage.mediaId, "upload-2");
  });
  test("interpolation/首尾帧族 usage key 直传 → 解析放行(带图提交见 5b;不带图 → S301 指路)", () => {
    assert.equal(resolveVideoModelKey("veo_3_1_interpolation_lite").key, "veo_3_1_interpolation_lite");
  });
  test("image(i2v 起点图)→ StartImage 端点 + startImage.mediaId(2026-08-23 开放,live 实证形状)", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "abra_i2v_8s", image: PNG_1PX });
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    assert.ok(post.url.includes("batchAsyncGenerateVideoStartImage"), "i2v 端点");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].startImage.mediaId, "upload-1");
  });
  test("全 key 自带时长(abra_i2v_4s)且未传时长参数 → 不再伪冲突 S301(embedded 时长生效,实测暴露的回归)", async () => {
    const { t, p } = newProvider();
    const task = await p.createVideo({ prompt: "x", model: "abra_i2v_4s", image: PNG_1PX });
    assert.equal(task.taskId, "media-new-1");
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/video:")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].videoModelKey, "abra_i2v_4s", "key 原样提交,无 8s 伪冲突");
  });
  test("全 key 自带时长 + 冲突 durationSeconds → 仍 S301(显式冲突不被掩盖)", async () => {
    const { p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_i2v_4s", image: PNG_1PX, durationSeconds: 8 }),
      (e: any) => e.code === "S301" && e.message.includes("冲突"),
    );
  });
});

// ═══ 17. E 轮新能力 wire 断言(r2v/extension/upsampler/图片放大/删除;契约 §9.1-§9.5 + E 轮 bundle Zod;stub 隔离零提交) ═══

describe("E 轮:r2v/extension/upsampler 视频 wire(stub 隔离,零真实消耗)", () => {
  async function posted(t: any, p: any, req: any): Promise<{ url: string; item: any; body: any }> {
    await p.createVideo(req);
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    assert.ok(post, "应有提交 POST(打到 stub)");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    return { url: post.url, item: body.requests[0], body };
  }
  test("r2v:images 2 张 → ReferenceImages 端点 + referenceImages[].mediaId(§9.3 entry 形状)", async () => {
    const { t, p } = newProvider();
    const { url, item } = await posted(t, p, { prompt: "x", model: "abra_r2v_4s", images: [PNG_1PX, PNG_1PX_B] });
    assert.ok(url.includes("batchAsyncGenerateVideoReferenceImages"), "r2v 端点");
    assert.equal(item.videoModelKey, "abra_r2v_4s");
    assert.equal(item.referenceImages.length, 2);
    assert.equal(item.referenceImages[0].mediaId, "upload-1");
    assert.equal(item.referenceImages[1].mediaId, "upload-2");
    assert.ok(item.referenceImages[0].aspectRatio.startsWith("IMAGE_ASPECT_RATIO_"), "entry 带图比例");
    assert.equal(item.textInput.prompt, "x", "r2v 保留全量 textInput/outputSpec 字段集");
    assert.ok(item.outputSpec, "r2v 带 outputSpec(§7.3 全量形状)");
    assert.ok(!item.videoInput, "r2v 无 videoInput");
  });
  test("extension:videoMediaId → ExtendVideo 端点 + videoInput{mediaId} + 无 outputSpec(§9.2)", async () => {
    const { t, p } = newProvider({ media: [doneMedia("vid-src-1")] });
    const { url, item } = await posted(t, p, { prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-1" });
    assert.ok(url.includes("batchAsyncGenerateVideoExtendVideo"), "extension 端点");
    assert.deepEqual(item.videoInput, { mediaId: "vid-src-1" });
    assert.equal(item.videoModelKey, "veo_3_1_extension_lite");
    assert.ok(!item.outputSpec, "extension 无 outputSpec(§9.2 实证形状)");
    assert.ok(item.textInput, "extension 有 textInput(prompt 续写)");
    assert.equal(item.aspectRatio, "VIDEO_ASPECT_RATIO_LANDSCAPE", "源视频无 aspectRatio 回读时默认 LANDSCAPE");
  });
  test("extension:源视频带 aspectRatio → 继承源视频比例", async () => {
    const { t, p } = newProvider({
      media: [{ ...doneMedia("vid-src-9"), video: { generatedVideo: { model: "abra_t2v_8s", aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT" } } }],
    });
    const { item } = await posted(t, p, { prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-9" });
    assert.equal(item.aspectRatio, "VIDEO_ASPECT_RATIO_PORTRAIT");
  });
  test("upsampler:videoMediaId → UpsampleVideo 端点 + 仅 §9.1 字段集(无 textInput/outputSpec/promptExpansionInput)", async () => {
    const { t, p } = newProvider({ media: [doneMedia("vid-src-1")] });
    const { url, item } = await posted(t, p, { prompt: "ignored", model: "veo_3_1_upsampler_1080p", videoMediaId: "vid-src-1" });
    assert.ok(url.includes("batchAsyncGenerateVideoUpsampleVideo"), "upsampler 端点");
    assert.deepEqual(item.videoInput, { mediaId: "vid-src-1" });
    assert.equal(item.videoModelKey, "veo_3_1_upsampler_1080p");
    assert.ok(!item.textInput, "upsampler 无 textInput(§9.1)");
    assert.ok(!item.outputSpec, "upsampler 无 outputSpec(§9.1 证伪 outputSpec.videoUpsampleResolution)");
    assert.ok(!item.promptExpansionInput, "upsampler 无 promptExpansionInput(§9.1)");
    assert.ok(typeof item.seed === "number" && item.aspectRatio, "upsampler aspectRatio/seed 必填(§9.1)");
  });
  test("交叉校验拒绝路径(S301,零提交)", async () => {
    // r2v key 不带 images
    await assert.rejects(() => newProvider().p.createVideo({ prompt: "x", model: "abra_r2v_4s" }), (e: any) => e.code === "S301" && /r2v 模式 key 需要传 images/.test(e.message));
    // extension key 不带 videoMediaId
    await assert.rejects(() => newProvider().p.createVideo({ prompt: "x", model: "veo_3_1_extension_lite" }), (e: any) => e.code === "S301" && /videoMediaId/.test(e.message));
    // videoMediaId + i2v key(模式错配)
    const { p: p3, t: t3 } = newProvider({ media: [doneMedia("vid-src-1")] });
    await assert.rejects(() => p3.createVideo({ prompt: "x", model: "abra_i2v_4s", videoMediaId: "vid-src-1" }), (e: any) => e.code === "S301" && /extension\/upsampler/.test(e.message));
    assert.ok(!t3.calls.some((c: any) => c.method === "POST"));
    // image 媒体当视频源
    const { p: p4 } = newProvider({ media: [{ name: "img-m", image: { generatedImage: {} } }] });
    await assert.rejects(() => p4.createVideo({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "img-m" }), (e: any) => e.code === "S301" && /image 媒体/.test(e.message));
    // 生成中的视频当源
    const { p: p5 } = newProvider({ media: [{ name: "vid-run", mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" } } }] });
    await assert.rejects(() => p5.createVideo({ prompt: "x", model: "veo_3_1_upsampler_1080p", videoMediaId: "vid-run" }), (e: any) => e.code === "S301" && /生成中/.test(e.message));
    // F 轮修复回归:PENDING/ACTIVE(§10.6/§10.7 live 首次观察的两枚举,ACTIVE 是 ~2 分钟主生成态)
    // 旧手写 includes("SCHEDULED") 漏拦 → 未完成源可闯到真实提交;新守卫走 mapMediaStatus 单一真源全拦
    for (const st of ["MEDIA_GENERATION_STATUS_PENDING", "MEDIA_GENERATION_STATUS_ACTIVE"]) {
      const { p: pi } = newProvider({ media: [{ name: "vid-run", mediaMetadata: { mediaStatus: { mediaGenerationStatus: st } } }] });
      await assert.rejects(
        () => pi.createVideo({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-run" }),
        (e: any) => e.code === "S301" && /生成中/.test(e.message) && e.message.includes(st),
        `${st} 必须按 in_progress 拦截`,
      );
    }
    // F 轮修复回归:无 generatedVideo 的上传残留源(无 mediaGenerationStatus 无生成结果)也拒
    const { p: p5b } = newProvider({ media: [{ name: "vid-upload", mediaMetadata: {} }] });
    await assert.rejects(
      () => p5b.createVideo({ prompt: "x", model: "veo_3_1_upsampler_1080p", videoMediaId: "vid-upload" }),
      (e: any) => e.code === "S301" && /不能作源/.test(e.message),
      "上传残留源(无生成状态无产物)不得放行",
    );
    // 不存在的 videoMediaId
    const { p: p6 } = newProvider({ media: [doneMedia("vid-src-1")] });
    await assert.rejects(() => p6.createVideo({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "nope" }), (e: any) => e.code === "S400");
    // 输入形态互斥(image + images / image + videoMediaId)
    await assert.rejects(() => newProvider().p.createVideo({ prompt: "x", model: "abra_i2v_4s", image: PNG_1PX, images: [PNG_1PX_B] }), (e: any) => e.code === "S301" && /互斥/.test(e.message));
    const { p: p7 } = newProvider({ media: [doneMedia("vid-src-1")] });
    await assert.rejects(() => p7.createVideo({ prompt: "x", model: "veo_3_1_extension_lite", videoMediaId: "vid-src-1", image: PNG_1PX }), (e: any) => e.code === "S301" && /互斥/.test(e.message));
    // r2v 参考图超上限(§14.1 per-key:abra 7;旧版 tier 盲硬编码 10 是错的)
    await assert.rejects(() => newProvider().p.createVideo({ prompt: "x", model: "abra_r2v_4s", images: Array(11).fill(PNG_1PX) }), (e: any) => e.code === "S301" && /超上限\(该 key 7/.test(e.message));
  });
  test("estimateVideoCredits:E 轮新开放模式(upsampler_1080p=0 / extension_lite=10 / r2v 按时长)", () => {
    assert.equal(estimateVideoCredits("veo_3_1_upsampler_1080p"), 0);
    assert.equal(estimateVideoCredits("veo_3_1_extension_lite"), 10);
    assert.equal(estimateVideoCredits("veo_3_1_extend_fast_landscape"), 20);
    assert.equal(estimateVideoCredits("abra_r2v_4s"), 7);
  });
});

describe("E 轮:图片放大 upsampleImage wire(stub 隔离,零真实消耗)", () => {
  test("images[0]=URI → 上传 → upsampleImage(body 全 schema §9.5+E 轮 Zod)→ 轮询产出", async () => {
    const { t, p } = newProvider({
      media: [{ name: "up-1", image: { generatedImage: { seed: 5 } }, mediaMetadata: { mediaBlobSize: "100" } }],
      downloadCt: "image/png",
    });
    const r = await p.generateImage({ prompt: "请放大", model: "GEM_PIX_2_UPSAMPLE_2K", images: [PNG_1PX] });
    assert.equal(r.outputs.length, 1);
    assert.equal(r.outputs[0].mediaId, "up-1");
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("/flow/upsampleImage"));
    assert.ok(post, "应有 upsampleImage 提交(stub)");
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.mediaId, "upload-1", "源 = 上传返回的 mediaId");
    assert.equal(body.targetResolution, "UPSAMPLE_IMAGE_RESOLUTION_2K");
    assert.deepEqual(body.requestContext, {});
    assert.equal(body.clientContext.tool, "PINHOLE");
    assert.ok(!("imageModelName" in body), "无模型选择字段(§9.5 证伪 17 个候选)");
    const rc = t.rcCalls.find((c) => c.action === "IMAGE_GENERATION");
    assert.ok(rc, "reCAPTCHA action = IMAGE_GENERATION(§10.8 live 拦截实证;IMAGE_UPSAMPLING 会 403)");
    assert.ok(r.warnings?.some((w: string) => w.includes("不消费 prompt")), "prompt 忽略须告警");
  });
  test("images[0]=项目内 mediaId → 不再上传直接引用", async () => {
    const { t, p } = newProvider({
      media: [
        { name: "img-exist", image: { generatedImage: {} }, mediaMetadata: { mediaBlobSize: "100" } },
        { name: "up-1", image: { generatedImage: {} }, mediaMetadata: { mediaBlobSize: "100" } },
      ],
      downloadCt: "image/png",
    });
    await p.generateImage({ prompt: "x", model: "GEM_PIX_2_UPSAMPLE_2K", images: ["img-exist"] });
    const body = JSON.parse(Buffer.from(t.calls.find((c) => c.method === "POST" && c.url.includes("/flow/upsampleImage")).bodyB64, "base64").toString("utf8"));
    assert.equal(body.mediaId, "img-exist");
    assert.ok(!t.calls.some((c) => c.url.includes("/flow/uploadImage")), "已有 mediaId 不得重复上传");
  });
  test("mediaId 不存在 → S400;video 媒体作源 → S301", async () => {
    const { p } = newProvider();
    await assert.rejects(() => p.generateImage({ prompt: "x", model: "GEM_PIX_2_UPSAMPLE_2K", images: ["ghost"] }), (e: any) => e.code === "S400");
    const { p: p2 } = newProvider({ media: [doneMedia("vid-m")] });
    await assert.rejects(() => p2.generateImage({ prompt: "x", model: "GEM_PIX_2_UPSAMPLE_2K", images: ["vid-m"] }), (e: any) => e.code === "S301" && /video 媒体/.test(e.message));
  });
});

describe("E 轮:batchDeleteAssets wire(stub 隔离,零真实消耗)", () => {
  test("已知 id 整批删除 → body {mediaIds} + 回读校验", async () => {
    const { t, p } = newProvider({ media: [doneMedia("v1"), doneMedia("v2"), doneMedia("v3")] });
    const r = await p.deleteAssets(["v1", "v3"]);
    assert.deepEqual(r.deleted, ["v1", "v3"]);
    assert.equal(r.mediaRemaining, 1);
    const post = t.calls.find((c) => c.method === "POST" && c.url.includes("flow:batchDeleteAssets"));
    assert.ok(post);
    assert.deepEqual(JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8")), { mediaIds: ["v1", "v3"] }, "字段名 = mediaIds(§9.4)");
  });
  test("未知 id → S400 整批不提交(防部分删除)", async () => {
    const { t, p } = newProvider({ media: [doneMedia("v1")] });
    await assert.rejects(() => p.deleteAssets(["v1", "ghost"]), (e: any) => e.code === "S400" && e.message.includes("ghost"));
    assert.ok(!t.calls.some((c) => c.method === "POST" && c.url.includes("batchDeleteAssets")), "拒绝路径不得有删除提交");
    // 无删除副作用:v1 仍在项目里可查
    assert.equal((await p.mediaStatus("v1")).status, "completed");
  });
  test("空数组 → S301", async () => {
    await assert.rejects(() => newProvider().p.deleteAssets([]), (e: any) => e.code === "S301");
  });
});

// ═══ 18. E 轮 live 状态机补遗:MEDIA_GENERATION_STATUS_PENDING → in_progress(§10.5) ═══

describe("状态机 PENDING(2026-08-23 upsampler live 首次观察)", () => {
  test("MEDIA_GENERATION_STATUS_PENDING / ACTIVE → in_progress(旧版误判 failed 的回归;两枚举均 E 轮 live 首次观察)", () => {
    for (const st of ["MEDIA_GENERATION_STATUS_PENDING", "MEDIA_GENERATION_STATUS_ACTIVE"]) {
      const r = mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: st } } });
      assert.equal(r.status, "in_progress", st);
      assert.equal(r.rawStatus, st);
    }
  });
  test("SCHEDULED 仍 in_progress;真失败枚举仍 failed(契约 §5 预答不变)", () => {
    assert.equal(mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" } } }).status, "in_progress");
    assert.equal(mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_FAILED" } } }).status, "failed");
  });
  test("全生命周期序列 SCHEDULED→ACTIVE→SUCCESSFUL 逐次映射正确(extension live 实证序列,§10.6;任何一环误判 failed 都会让轮询提前终止)", () => {
    const seq = ["MEDIA_GENERATION_STATUS_SCHEDULED", "MEDIA_GENERATION_STATUS_ACTIVE", "MEDIA_GENERATION_STATUS_SUCCESSFUL"];
    const got = seq.map((st) => mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: st } } }).status);
    assert.deepEqual(got, ["in_progress", "in_progress", "completed"]);
  });
});

// ═══ 19. F 轮:mediaId 形状启发(§10.7 派生命名 <源id>_upsampled;工具层放行判断) ═══

describe("isFlowMediaIdLike(UUID 或 UUID 派生名)", () => {
  test("标准 UUID 放行", () => {
    assert.ok(isFlowMediaIdLike("60679485-0863-4007-8ea1-314ed661168d"));
    assert.ok(isFlowMediaIdLike(MEDIA_ID_A));
  });
  test("§10.7 派生命名放行:<源id>_upsampled(下划线,live 实证)与连字符变体", () => {
    assert.ok(isFlowMediaIdLike(`${MEDIA_ID_A}_upsampled`), "下划线后缀 = §10.7 实测 wire 命名");
    assert.ok(isFlowMediaIdLike(`${MEDIA_ID_A}-upsampled`), "连字符后缀同放行(非路径启发,存在性归 findMedia)");
  });
  test("路径/URI/空白/短名拒绝(防本地路径 silent 进 body)", () => {
    for (const bad of ["/Users/local/a.png", "img-exist", "a b c", "x:y", "../etc/passwd", ""]) {
      assert.ok(!isFlowMediaIdLike(bad), `应拒绝:${JSON.stringify(bad)}`);
    }
  });
});

// ═══ 20. E-parity 轮(2026-08-23):分享/取消/edit/实体(契约 §11;stub 隔离零真实消耗) ═══

describe("E-parity:分享 shareMedia(契约 §8.3 live + §11.2 URL 模板 bundle 解码)", () => {
  const doneImage = { name: "img-1", image: { generatedImage: { seed: 1, model: "NARWHAL" } } };
  const doneVideo = doneMedia("vid-1");
  test("逐 id 提交 tRPC body 形状(includePrompt true / inputMediaIds [] / inputEntityIds [] —— §8.3 空数组铁律)+ shareUrl 模板", async () => {
    const { t, p } = newProvider({ media: [doneImage, doneVideo] });
    const r = await p.shareMedia(["img-1", "vid-1"]);
    assert.equal(r.shared.length, 2);
    assert.deepEqual(t.shareBodies, [
      { json: { mediaId: "img-1", includePrompt: true, inputMediaIds: [], inputEntityIds: [] } },
      { json: { mediaId: "vid-1", includePrompt: true, inputMediaIds: [], inputEntityIds: [] } },
    ]);
    // URL 模板(bundle 0x2828/0xad1/0xb06):/fx/tools/flow/shared/{image|video}/<mediaShareId>
    assert.match(r.shared[0].shareUrl, /labs\.google\/fx\/tools\/flow\/shared\/image\/share-1-uuid$/);
    assert.match(r.shared[1].shareUrl, /labs\.google\/fx\/tools\/flow\/shared\/video\/share-2-uuid$/);
    assert.equal(r.shared[0].kind, "image");
    assert.equal(r.shared[1].kind, "video");
  });
  test("未知 id → S400 整批不提交", async () => {
    const { t, p } = newProvider({ media: [doneImage] });
    await assert.rejects(() => p.shareMedia(["img-1", "ghost"]), (e: any) => e.code === "S400" && e.message.includes("ghost"));
    assert.equal(t.shareBodies.length, 0, "整批拒绝,零提交");
  });
  test("空数组 → S301", async () => {
    await assert.rejects(() => newProvider().p.shareMedia([]), (e: any) => e.code === "S301");
  });
});

describe("E-parity:取消生成 cancelGenerations(契约 §11.3;bundle body={mediaId} 单值)", () => {
  const inFlight = { name: "job-1", mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_ACTIVE" } } };
  test("in_progress → 逐 id POST body {mediaId}(单值,非数组)+ 取消后复查状态", async () => {
    const { t, p } = newProvider({ media: [inFlight] });
    const r = await p.cancelGenerations(["job-1"]);
    assert.deepEqual(r.canceled, ["job-1"]);
    assert.deepEqual(t.cancelBodies, [{ mediaId: "job-1" }], "body 是单值 mediaId(bundle 提交构造器明文)");
    assert.equal(r.statusAfter.length, 1);
    assert.equal(r.notCancelable.length, 0);
  });
  test("已完成 → notCancelable 零提交(服务端不可取消,前端先验免 4xx)", async () => {
    const { t, p } = newProvider({ media: [doneMedia("v1")] });
    const r = await p.cancelGenerations(["v1"]);
    assert.deepEqual(r.canceled, []);
    assert.equal(r.notCancelable[0].mediaId, "v1");
    assert.equal(t.cancelBodies.length, 0, "非生成中不提交");
  });
  test("未知 id → S400 整批不提交;空数组 → S301", async () => {
    const { t, p } = newProvider({ media: [inFlight] });
    await assert.rejects(() => p.cancelGenerations(["job-1", "ghost"]), (e: any) => e.code === "S400");
    assert.equal(t.cancelBodies.length, 0);
    await assert.rejects(() => p.cancelGenerations([]), (e: any) => e.code === "S301");
  });
});

describe("E-parity:CANCELED 状态映射(§11.3;枚举经 bundle 字符串表实证)", () => {
  test("MEDIA_GENERATION_STATUS_CANCELED → failed 终态(取消生效的落点)", () => {
    const r = mapMediaStatus({ mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_CANCELED" } } });
    assert.equal(r.status, "failed");
    assert.equal(r.rawStatus, "MEDIA_GENERATION_STATUS_CANCELED");
    assert.match(r.error ?? "", /取消/);
  });
});

describe("E-parity:V2V edit 模式 wire(契约 §11.1;bundle Zod + 假 key 404 探针定型,live 未验证)", () => {
  test("OPEN_VIDEO_MODES 含 edit;abra_edit + videoMediaId + prompt → EditVideo 端点且顶层无 useV2ModelConfig", async () => {
    assert.ok(OPEN_VIDEO_MODES.has("edit"));
    const { t, p } = newProvider({ media: [doneMedia("vid-src-1")] });
    const r = await p.createVideo({ prompt: "make it snow", model: "abra_edit", videoMediaId: "vid-src-1" });
    assert.equal(r.status, "queued");
    assert.ok(r.warnings?.some((w: string) => w.includes(EDIT_WIRE_WARNING)), "提交响应必须带 live-未验证警示");
    const call = t.calls.find((c) => c.method === "POST" && c.url.includes("batchAsyncGenerateVideoEditVideo"));
    assert.ok(call, "命中 EditVideo 独立端点");
    const body = JSON.parse(Buffer.from(call.bodyB64, "base64").toString("utf8"));
    assert.equal(body.useV2ModelConfig, undefined, "§11.1:edit 是唯一不带 useV2ModelConfig 的端点(bundle 提交构造器明文)");
    const item = body.requests[0];
    assert.equal(item.videoModelKey, "abra_edit");
    assert.equal(item.videoInput.mediaId, "vid-src-1");
    assert.equal(item.textInput.prompt, "make it snow");
    assert.equal(item.promptExpansionInput, undefined, "edit item schema(_0x457c52)无 promptExpansionInput");
    assert.equal(item.outputSpec, undefined, "edit 不带 outputSpec(extension 同款;aspectRatio 按源继承)");
    assert.match(item.aspectRatio, /^VIDEO_ASPECT_RATIO_/);
  });
  test("edit 缺 prompt(编辑指令)→ S301;edit 缺 videoMediaId → S301 指路", async () => {
    const { t, p } = newProvider({ media: [doneMedia("vid-src-1")] });
    await assert.rejects(
      () => p.createVideo({ model: "abra_edit", videoMediaId: "vid-src-1" }),
      (e: any) => e.code === "S301" && /prompt/.test(e.message),
    );
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_edit" }),
      (e: any) => e.code === "S301" && /videoMediaId/.test(e.message),
    );
    assert.ok(!t.calls.some((c) => c.method === "POST" && c.url.includes("/video:")), "拒绝路径零提交");
  });
  test("edit 源守卫沿用:非视频源/生成中源 → S301(与 extension/upsampler 共用)", async () => {
    const imgMedia = { name: "img-only", image: { generatedImage: { seed: 1 } } };
    const { p } = newProvider({ media: [imgMedia] });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_edit", videoMediaId: "img-only" }),
      (e: any) => e.code === "S301" && /image/.test(e.message),
    );
  });
});

describe("预设语音(契约 §8.8;原 flow_entity 工具 2026-08-26 用户裁决移除,listPresetVoices 保留供 flow_status voices 消费)", () => {
  const VOICES = [
    { mediaId: "achernar", mediaType: "AUDIO", media: { audio: { generatedAudio: { name: "Achernar", description: "Female, soft, high pitch", isPresetAudioSample: true, audioSamplePath: "https://gstatic.com/aitestkitchen/voices/samples/Achernar.wav" } } } },
    { mediaId: "charon", mediaType: "AUDIO", media: { audio: { generatedAudio: { name: "Charon", description: "Male", isPresetAudioSample: true } } } },
  ];
  test("listPresetVoices:路径 e.media.audio.generatedAudio(§11.4 纠偏:非条目顶层)", async () => {
    const { p } = newProvider({ externalRef: VOICES });
    const voices = await p.listPresetVoices();
    assert.equal(voices.length, 2);
    assert.equal(voices[0].id, "achernar");
    assert.equal(voices[0].displayName, "Achernar");
    assert.equal(voices[0].description, "Female, soft, high pitch");
    assert.match(voices[0].sampleUrl ?? "", /Achernar\.wav$/);
  });
});

// ═══ 14. per-tier 价矩阵 + tier 门禁(契约 §14.4;D-4 双向修正;StubTransport 零真实消耗) ═══

describe("staticTierCosts per-tier 静态矩阵(§14.4;2026-08-27 live 快照蒸馏)", () => {
  test("abra 家族全 tier 同价(时长表)", () => {
    assert.deepEqual(staticTierCosts("abra_t2v_8s"), { SERVICE_TIER_ADVANCED: 12, SERVICE_TIER_INTERMEDIATE: 12, SERVICE_TIER_ENTRY: 12 });
    assert.deepEqual(staticTierCosts("abra_r2v_4s"), { SERVICE_TIER_ADVANCED: 7, SERVICE_TIER_INTERMEDIATE: 7, SERVICE_TIER_ENTRY: 7 });
    assert.deepEqual(staticTierCosts("abra_edit"), { SERVICE_TIER_ADVANCED: 20, SERVICE_TIER_INTERMEDIATE: 20, SERVICE_TIER_ENTRY: 20 });
  });
  test("双向方向一:ADVANCED-only 家族(fast_ultra/_4s/_6s/lite_4s/quality_4s)", () => {
    for (const k of ["veo_3_1_t2v_fast_ultra", "veo_3_1_t2v_fast_4s", "veo_3_1_t2v_fast_6s", "veo_3_1_r2v_fast_portrait_ultra", "veo_3_1_extend_fast_landscape_ultra", "veo_3_1_t2v_quality_4s", "veo_3_1_t2v_lite_4s", "veo_3_1_i2v_s_lite_6s_fl"]) {
      const m = staticTierCosts(k)!;
      const want = k.includes("_quality") ? 100 : k.includes("_lite") ? 5 : 10; // lite_4s/6s=5、fast 变体=10、quality 变体=100(live 快照逐字)
      assert.equal(m.SERVICE_TIER_ADVANCED, want, `${k} ADVANCED`);
      assert.equal(m.SERVICE_TIER_INTERMEDIATE, "UNAVAILABLE", `${k} INTERMEDIATE`);
      assert.equal(m.SERVICE_TIER_ENTRY, "UNAVAILABLE", `${k} ENTRY`);
    }
  });
  test("双向方向二:plain fast 在 ADVANCED 反 UNAVAILABLE(lite ADVANCED=5 价差)", () => {
    const fast = staticTierCosts("veo_3_1_t2v_fast")!;
    assert.equal(fast.SERVICE_TIER_ADVANCED, "UNAVAILABLE", "静态盲估 20 会在 ADVANCED 踩坑");
    assert.equal(fast.SERVICE_TIER_INTERMEDIATE, 20);
    assert.equal(fast.SERVICE_TIER_ENTRY, 20);
    const lite = staticTierCosts("veo_3_1_t2v_lite")!;
    assert.equal(lite.SERVICE_TIER_ADVANCED, 5, "lite ADVANCED=5(静态盲估 10 高估一倍)");
    assert.equal(lite.SERVICE_TIER_INTERMEDIATE, 10);
    const lp = staticTierCosts("veo_3_1_t2v_lite_low_priority")!;
    assert.equal(lp.SERVICE_TIER_ADVANCED, 0, "low_priority ADVANCED=0(静态盲估 10 是错的)");
    assert.equal(lp.SERVICE_TIER_INTERMEDIATE, "UNAVAILABLE");
  });
  test("upsampler 双档 + 未知家族", () => {
    assert.deepEqual(staticTierCosts("veo_3_1_upsampler_1080p"), { SERVICE_TIER_ADVANCED: 0, SERVICE_TIER_INTERMEDIATE: 0, SERVICE_TIER_ENTRY: "UNAVAILABLE" });
    assert.deepEqual(staticTierCosts("veo_3_1_upsampler_4k"), { SERVICE_TIER_ADVANCED: 50, SERVICE_TIER_INTERMEDIATE: "UNAVAILABLE", SERVICE_TIER_ENTRY: "UNAVAILABLE" });
    assert.equal(staticTierCosts("future_family_x"), undefined);
  });
  test("formatTierMatrix 人类可读串(门禁消息用)", () => {
    assert.equal(formatTierMatrix(staticTierCosts("veo_3_1_t2v_fast_ultra")), "ADVANCED=10 / INTERMEDIATE=UNAVAILABLE / ENTRY=UNAVAILABLE");
    assert.equal(formatTierMatrix(undefined), "");
  });
});

describe("tier 门禁(§14.4 UNAVAILABLE;提交点与确认门双拦;零提交)", () => {
  test("静态矩阵:INTERMEDIATE 档提交 fast_ultra → S303 带 per-tier 矩阵,零 POST", async () => {
    const { t, p } = newProvider(); // credits stub = INTERMEDIATE,目录空 → staticTierCosts 兜底
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_t2v_fast_ultra" }),
      (e: any) => e.code === "S303" && /UNAVAILABLE/.test(e.message) && /ADVANCED=10 \/ INTERMEDIATE=UNAVAILABLE \/ ENTRY=UNAVAILABLE/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST" && c.url.includes("/video:")), "拒绝路径不得有提交");
  });
  test("静态矩阵路径:目录未暖时 creditMapping[当前档]=UNAVAILABLE → S303(走 static-tier 价源)", async () => {
    // 注:此用例不经确认门预暖目录,提交点 noRefresh 只见静态矩阵 —— 断言走 static 路径。
    // 动态路径(真实 creditMapping 实时 UNAVAILABLE)由下一条「动态目录暖后」用例覆盖(mutation:禁用
    // lookupVideoCost 动态 UNAVAILABLE 分支后该用例必败)。
    const modelConfig = { videoModelFamilies: [{ usages: [{ key: "veo_3_1_t2v_fast_ultra", creditMapping: { SERVICE_TIER_ADVANCED: { cost: 10 }, SERVICE_TIER_INTERMEDIATE: { cost: "UNAVAILABLE" }, SERVICE_TIER_ENTRY: { cost: "UNAVAILABLE" } } }] }], imageModelFamilies: [] };
    const { t, p } = newProvider({ modelConfig });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_t2v_fast_ultra" }),
      (e: any) => e.code === "S303" && e.message.includes("动态目录实时值") === false && /UNAVAILABLE/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST" && c.url.includes("/video:")), "零提交");
  });
  test("动态目录暖后:creditMapping[当前档] 实时 UNAVAILABLE → S303(来源=动态目录实时值)", async () => {
    // 经 beginSubmissionConfirm 预暖目录(refreshCatalogIfStale)→ 提交点 lookupVideoCost 命中
    // 动态 creditMapping 的 UNAVAILABLE 分支(source:"dynamic")—— 独立于静态矩阵的第一道防线
    // (上游目录价漂移时仍正确拦截;mutation:禁用该分支则本用例退化为静态价源而失败)。
    const modelConfig = { videoModelFamilies: [{ usages: [{ key: "veo_3_1_t2v_fast_ultra", creditMapping: { SERVICE_TIER_ADVANCED: { cost: 10 }, SERVICE_TIER_INTERMEDIATE: { cost: "UNAVAILABLE" }, SERVICE_TIER_ENTRY: { cost: "UNAVAILABLE" } } }] }], imageModelFamilies: [] };
    const { t, p } = newProvider({ modelConfig });
    // 未知 key 在静态矩阵里无 per-tier 价,但动态目录有 → 确认门自身即应 S303(不发令牌)
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_fast_ultra" }),
      (e: any) => e.code === "S303" && e.message.includes("动态目录实时值") === true,
      "确认门暖目录后,UNAVAILABLE 必须以动态价源拦截",
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST" && c.url.includes("/video:")), "零提交");
  });
  test("ADVANCED 档:fast_ultra 放行 + 提交后预估用 per-tier 真值 10(不再盲估 20)", async () => {
    const { t, p } = newProvider({ creditsBody: { credits: 500, serviceTier: "SERVICE_TIER_ADVANCED" } });
    const r = await p.createVideo({ prompt: "x", model: "veo_3_1_t2v_fast_ultra" });
    assert.equal(r.taskId, "media-new-1");
    assert.ok(t.calls.some((c: any) => c.method === "POST" && c.url.includes("/video:")), "ADVANCED 档应放行提交(stub)");
    assert.ok((r.warnings ?? []).some((w: string) => w.includes("预计消耗 10 积分")), "提交后预估 = per-tier 真值 10");
  });
  test("确认门:UNAVAILABLE key 不发令牌(注定失败的请求不进入确认流程)", async () => {
    const { p } = newProvider(); // INTERMEDIATE
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_fast_ultra" }),
      (e: any) => e.code === "S303",
    );
  });
  test("确认门预估:tier 已知时用 static-tier 价(lite 在 INTERMEDIATE=10;全 tier 同价 key 不变)", async () => {
    const { p } = newProvider();
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_lite" });
    assert.equal(c!.estimatedCost, 10, "INTERMEDIATE lite=10");
    assert.equal(c!.costSource, "static-tier");
    const { p: pAdv } = newProvider({ creditsBody: { credits: 500, serviceTier: "SERVICE_TIER_ADVANCED" } });
    const cAdv = await pAdv.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_lite" });
    assert.equal(cAdv!.estimatedCost, 5, "ADVANCED lite=5(per-tier 真值,盲估 10 是高估)");
  });
  test("动态价优先级不变:creditMapping 有本档价 → dynamic(lite ADVANCED 动态 6 覆盖静态 5)", async () => {
    const modelConfig = { videoModelFamilies: [{ usages: [{ key: "veo_3_1_t2v_lite", creditMapping: { SERVICE_TIER_ADVANCED: { cost: 6 }, SERVICE_TIER_INTERMEDIATE: { cost: 10 }, SERVICE_TIER_ENTRY: { cost: 10 } } }] }], imageModelFamilies: [] };
    const { p } = newProvider({ modelConfig, creditsBody: { credits: 500, serviceTier: "SERVICE_TIER_ADVANCED" } });
    const c = await p.beginSubmissionConfirm({ prompt: "x", model: "veo_3_1_t2v_lite" });
    assert.equal(c!.estimatedCost, 6);
    assert.equal(c!.costSource, "dynamic");
  });
});

// ═══ 15. r2v 输入上限(§14.1 inputSpec;动态优先/静态兜底) ═══

describe("r2v per-key 输入上限(§14.1;旧版 tier 盲硬编码 10 是错的)", () => {
  test("静态兜底:veo r2v 4 张 → S301(该 key 3)", async () => {
    const { t, p } = newProvider();
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_r2v_lite", images: Array(4).fill(PNG_1PX) }),
      (e: any) => e.code === "S301" && /超上限\(该 key 3/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST"), "零提交零上传");
  });
  test("动态目录 inputSpec 优先:maxImageInputs=2 覆盖静态 7(经确认门暖目录后生效)", async () => {
    const modelConfig = { videoModelFamilies: [{ usages: [{ key: "abra_r2v_8s", inputSpec: { maxAudioReferences: 1 }, maxImageInputs: 2 }] }], imageModelFamilies: [] };
    const { t, p } = newProvider({ modelConfig });
    // 直呼 createVideo 不刷目录(提交路径不拉项目数据的不变量);确认门先行刷新 → 动态 inputSpec 生效
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: Array(3).fill(PNG_1PX) }),
      (e: any) => e.code === "S301" && /该 key 2.*目录 inputSpec/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST"), "零提交");
  });
  test("上限内放行:abra_r2v_8s 7 张照常提交(referenceImages 7 项)", async () => {
    const { t, p } = newProvider();
    await p.createVideo({ prompt: "x", model: "abra_r2v_8s", images: Array(7).fill(PNG_1PX) });
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.equal(body.requests[0].referenceImages.length, 7);
  });
});

// ═══ 16. referenceAudio 音频参考(§14.6;r2v 专属叠加,预设语音 mediaId;零真实提交) ═══

describe("referenceAudio(§14.6 假 key 404 探针定型;v1 收窄 = r2v + 预设语音)", () => {
  const VOICES = [
    { mediaId: "achernar", mediaType: "AUDIO", media: { audio: { generatedAudio: { name: "Achernar", isPresetAudioSample: true } } } },
    { mediaId: "charon", mediaType: "AUDIO", media: { audio: { generatedAudio: { name: "Charon", isPresetAudioSample: true } } } },
  ];
  test("r2v + audioMediaIds → 提交体 referenceAudio:[{mediaId}](wire 形状)+ 实验期告警", async () => {
    const { t, p } = newProvider({ externalRef: VOICES });
    const r = await p.createVideo({ prompt: "x", model: "abra_r2v_8s", images: [PNG_1PX], audioMediaIds: ["achernar", "charon"] });
    const post = t.calls.find((c: any) => c.method === "POST" && c.url.includes("/video:"));
    const body = JSON.parse(Buffer.from(post.bodyB64, "base64").toString("utf8"));
    assert.ok(post.url.includes("batchAsyncGenerateVideoReferenceImages"), "r2v 端点");
    assert.deepEqual(body.requests[0].referenceAudio, [{ mediaId: "achernar" }, { mediaId: "charon" }], "entry = {mediaId} 单字段(§14.1)");
    assert.equal(body.mediaGenerationContext.audioFailurePreference, "BLOCK_SILENCED_VIDEOS");
    assert.ok((r.warnings ?? []).some((w: string) => w.includes("实验期")), "实验期 disclaimer 告警");
  });
  test("非 r2v key + audioMediaIds → S301 指路(t2v 无 AUDIO_REFERENCE requirement)", async () => {
    const { t, p } = newProvider({ externalRef: VOICES });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_t2v_8s", audioMediaIds: ["achernar"] }),
      (e: any) => e.code === "S301" && /audioMediaIds/.test(e.message) && /r2v/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST"), "零提交");
  });
  test("超 per-key 上限:veo r2v(1)挂 2 个 → S301;abra r2v(5)挂 6 个 → S301", async () => {
    const { p } = newProvider({ externalRef: VOICES });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "veo_3_1_r2v_lite", images: [PNG_1PX], audioMediaIds: ["achernar", "charon"] }),
      (e: any) => e.code === "S301" && /audioMediaIds 数量 2 超上限\(该 key 1/.test(e.message),
    );
    const six = ["a", "b", "c", "d", "e", "f"];
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_r2v_8s", images: [PNG_1PX], audioMediaIds: six }),
      (e: any) => e.code === "S301" && /该 key 5/.test(e.message),
    );
  });
  test("非预设语音 mediaId → S301 结构化拒绝(网络侧存在性校验;mediaId 是 slug 非 UUID)", async () => {
    const { t, p } = newProvider({ externalRef: VOICES });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_r2v_8s", images: [PNG_1PX], audioMediaIds: ["not-a-voice"] }),
      (e: any) => e.code === "S301" && /非预设语音样本/.test(e.message) && /voices/.test(e.message),
    );
    assert.ok(!t.calls.some((c: any) => c.method === "POST" && c.url.includes("/video:")), "校验失败零提交");
  });
  test("r2v 无 images 只挂 audio → S301(audio 是 images 的叠加输入)", async () => {
    const { p } = newProvider({ externalRef: VOICES });
    await assert.rejects(
      () => p.createVideo({ prompt: "x", model: "abra_r2v_8s", audioMediaIds: ["achernar"] }),
      (e: any) => e.code === "S301" && /须同时传 images/.test(e.message),
    );
  });
  test("digest 绑定:确认后换 audioMediaIds → S320;同集合换序 → 仍有效(集合语义)", async () => {
    const { p } = newProvider({ externalRef: VOICES });
    const req0 = { prompt: "x", model: "abra_r2v_8s", images: ["https://e.com/a.png"], audioMediaIds: ["achernar", "charon"] };
    const c1 = await p.beginSubmissionConfirm(req0);
    // 先做 mismatch 断言(令牌尚未消费,拒绝只能由 digest 不匹配产生 —— mutation:从 confirmDigest
    // 删除 audioMediaIds 摘入后本断言必败);成功校验会消费令牌,故有效断言必须放最后。
    await assert.rejects(
      p.beginSubmissionConfirm({ ...req0, audioMediaIds: ["achernar"] }, c1!.confirmToken!),
      (e: any) => e.code === "S320",
      "确认后换音频样本必须使令牌失效(此时尚未消费,S320 只能来自 digest 不匹配)",
    );
    const pass = await p.beginSubmissionConfirm({ ...req0, audioMediaIds: ["charon", "achernar"] }, c1!.confirmToken!);
    assert.equal(pass, undefined, "集合换序语义等价,令牌仍有效(本次校验消费令牌)");
  });
  test("上限来源动态优先:inputSpec.maxAudioReferences=1 覆盖静态 5(abra;经确认门暖目录)", async () => {
    const modelConfig = { videoModelFamilies: [{ usages: [{ key: "abra_r2v_8s", inputSpec: { maxAudioReferences: 1 }, maxImageInputs: 7 }] }], imageModelFamilies: [] };
    const { p } = newProvider({ modelConfig, externalRef: VOICES });
    await assert.rejects(
      () => p.beginSubmissionConfirm({ prompt: "x", model: "abra_r2v_8s", images: [PNG_1PX], audioMediaIds: ["achernar", "charon"] }),
      (e: any) => e.code === "S301" && /该 key 1.*目录 inputSpec/.test(e.message),
    );
  });
});
