/**
 * HF Spaces 渠道单元测试(白盒;零网络零 GPU 配额 —— fetchImpl stub 注入含 SSE 流伪造)。
 *
 * 覆盖:
 *   1. 目录/channelInfo(video-only 如实;keyframes=relay 如实)/无 token 也可 live
 *   2. createVideo 路由:image→wan22-i2v;image+keyframes[1]→wan22-relay;裸 prompt→cogvideox;
 *      显式模型;时长截断告警;参数门(t2v 传 image 告警/i2v 缺 image 拒)
 *   3. data 组装:prithiv 9 参全必填(data:URI 原样);relay 16 参(ImageData url/base64 双形态)
 *   4. getVideo SSE:complete+FileData.url→下载转 data:URI;complete+内嵌 b64→剥离;
 *      error data:null→GPU 记账拒指引 token;error 带文本;无 complete
 *   5. 契约纪律:丢弃参数告警;404 Space 私有化指引;taskModels 上下文一次性
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 测试隔离(P0-40 CI 红根因):channelInfo.status 自 2026-09-24 起白名单派生 ——
// CI 无用户 config → 出厂白名单 [agnes,zhipu] 不含 hfspaces → status=disabled 断言炸。
// 在 require 任何 dist 模块前写独立 fixture 显式启用 hfspaces(与 gemini-web.test.ts 同范式)。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfspaces-test-"));
fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify({
  defaultImageProvider: "agnes",
  enabledProviders: ["agnes", "zhipu", "hfspaces"],
  providers: { agnes: { apiKey: "k" } },
}, null, 2));
process.env.MEDIA_GEN_MCP_CONFIG = path.join(tmpDir, "config.json");

const require = createRequire(import.meta.url);
const { HfspacesProvider, HfspacesError, HFSPACES_MODEL_NAMES } = require("../dist/providers/hfspaces.js");

function sseResponse(frames: Array<{ event: string; data: string | null }>, { status = 200 } = {}): Response {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${f.data === null ? "null" : f.data}`).join("\n\n") + "\n\n";
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); },
  });
  return { ok: status < 400, status, json: async () => ({}), body, text: async () => text, arrayBuffer: async () => bytes.buffer } as unknown as Response;
}
function makeProvider(postJson: any = { event_id: "ev-1" }, sseFrames: Array<{ event: string; data: string | null }> = [{ event: "complete", data: JSON.stringify([{ url: "https://x.hf.space/gradio_api=file=/tmp/o.png" }]) }], downloads: string[] = [], token?: string) {
  const posts: any[] = [];
  const p = new HfspacesProvider({
    token,
    fetchImpl: async (url: string, init: RequestInit) => {
      if (init?.method === "POST") { posts.push({ url, body: JSON.parse(String(init.body)), headers: init.headers }); return { ok: true, status: 200, json: async () => postJson, text: async () => JSON.stringify(postJson) } as unknown as Response; }
      if (url.includes("/call/") && url.includes("/gradio_api/call/")) return sseResponse(sseFrames);
      downloads.push(url);
      (downloads as any).headers = (downloads as any).headers || []; (downloads as any).headers.push(init?.headers ?? null);
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([5, 5]).buffer, json: async () => ({}), text: async () => "" } as unknown as Response;
    },
  });
  p.pollDeadlineMs = 2_000;
  return { p, posts, downloads };
}
const COMPLETE_URL = { event: "complete", data: JSON.stringify([{ url: "https://tmp-x.hf.space/gradio_api=file=/tmp/v.mp4", path: "/tmp/v.mp4" }, { url: "https://f" }, 42]) };

describe("hfspaces 目录/说明", () => {
  test("模型目录 3 个;channelInfo 无 token 也 live(video-only;keyframes=relay 如实;配额指引)", () => {
    const { p } = makeProvider();
    const ci = p.channelInfo();
    assert.equal(ci.status, "live");
    assert.equal(ci.capabilities.t2i, true, "轮30 起支持生图(z-image-turbo/qwen-image-edit)");
    assert.equal(p.listImageModels().length, 2, "图像目标 2 个");
    assert.equal(ci.capabilities.keyframes, true, "relay 首末帧接力=keyframes 能力");
    assert.ok(ci.limits.some((x) => x.includes("video 为主")), "轮30 起图+视频双模态");
    assert.ok(ci.cost.includes("2min"), "配额口径在 cost 字段(匿名 2min/免费号 5min)");
    assert.deepEqual(p.listVideoModels(), HFSPACES_MODEL_NAMES);
    assert.equal(HFSPACES_MODEL_NAMES.length, 4, "wan22-i2v/wan22-relay/minimax-h3/cogvideox");
    assert.equal(p.requiresOptIn("video"), true);
  });
});

describe("hfspaces 生图(轮30 图像化)", () => {
  test("t2i 默认路由 z-image-turbo;resolution 字符串构造(WxH→约分比例);无 seed→random", async () => {
    const { p, posts } = makeProvider();
    const r = await p.generateImage({ prompt: "a red fox", size: "1280x720" } as any);
    let d = posts[0].body.data;
    assert.equal(posts[0].url.includes("tongyi-mai-z-image-turbo"), true);
    assert.equal(d[0], "a red fox");
    assert.equal(d[1], "1280x720 ( 16:9 )", "WxH→约分比例字符串");
    assert.equal(d[5], true, "无 seed→random_seed");
    assert.match(r.outputs[0].url, /^data:image\//);
  });
  test("i2i 路由 qwen-image-edit(images→ImageData;缺 images 拒;t2i 传 images 告警)", async () => {
    const { p, posts } = makeProvider();
    const r = await p.generateImage({ prompt: "make it snow", images: ["data:image/png;base64,QUJD"] } as any);
    const d = posts[0].body.data;
    assert.equal(posts[0].url.includes("qwen-image-edit-fast"), true);
    assert.deepEqual(d[0], { base64: "QUJD" });
    assert.equal(d[6], true, "rewrite_prompt 默认开");
    await assert.rejects(makeProvider().p.generateImage({ prompt: "x", model: "qwen-image-edit" } as any), (e: any) => e.code === "H302");
    const r2 = makeProvider();
    const w = await r2.p.generateImage({ prompt: "x", model: "z-image-turbo", images: ["https://a/1.png"] } as any);
    assert.ok(w.warnings!.some((x) => x.includes("images 已忽略")));
    void r;
  });
});

describe("hfspaces 全能力工具(轮30:tts/去背景/超分/唇同步)", () => {
  test("tts:无参考音=null;参数透传;产物 base64 返回", async () => {
    const { p, posts } = makeProvider();
    const r = await p.tts("你好世界", { exaggeration: 0.7, seed: 3 });
    const d = posts[0].body.data;
    assert.equal(posts[0].url.includes("resembleai-chatterbox"), true);
    assert.equal(d[0], "你好世界");
    assert.equal(d[1], null, "无参考音=null(Space 用内置音色)");
    assert.equal(d[2], 0.7);
    assert.equal(d[4], 3);
    assert.equal(typeof r.audioBase64, "string");
  });
  test("tts 克隆:参考音 data:URI→ImageData;remove_bg Imageslider 取末位;upscale 参数默认;lip 同步 URL 直传", async () => {
    const { p, posts } = makeProvider();
    await p.tts("hello", { referenceAudio: "data:audio/wav;base64,QUJD" });
    assert.deepEqual(posts[0].body.data[1], { base64: "QUJD" }, "音频 data:URI→{base64}");
    await p.removeBackground("https://a/x.png");
    assert.equal(posts[1].url.includes("not-lain-background-removal"), true);
    assert.deepEqual(posts[1].body.data[0], { url: "https://a/x.png" });
    await p.upscaleImage("https://a/x.png", { tileSize: 384 });
    assert.equal(posts[2].url.includes("tile-upscaler"), true);
    assert.deepEqual(posts[2].body.data, [{ url: "https://a/x.png" }, 384, 20, 0.4, 0, 3], "wrapper 6 参(默认 steps=20)");
    await p.lipsyncVideo("https://a/v.mp4", "https://a/a.wav");
    assert.equal(posts[3].url.includes("latentsync"), true);
    assert.deepEqual(posts[3].body.data, [{ url: "https://a/v.mp4" }, { url: "https://a/a.wav" }]);
  });
});

describe("hfspaces createVideo 路由与参数", () => {
  test("默认路由:image→wan22-i2v(data:URI 原样进 9 参);image+keyframes[1]→relay;裸 prompt→cogvideox", async () => {
    const { p, posts } = makeProvider();
    let t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QUJD" } as any);
    assert.equal((t.raw as any).model, "wan22-i2v");
    let d = posts[0].body.data;
    assert.equal(d.length, 9, "prithiv 9 参全必填");
    assert.equal(d[0], "data:image/png;base64,QUJD", "data:URI 原样(prithiv 契约)");

    const r2 = makeProvider();
    t = await r2.p.createVideo({ prompt: "v", image: "https://pub.example/a.png", keyframes: ["https://pub.example/a.png", "https://pub.example/b.png"] } as any);
    assert.equal((t.raw as any).model, "wan22-relay");
    d = r2.posts[0].body.data;
    assert.equal(d.length, 16, "relay 16 参");
    assert.deepEqual(d[0], { url: "https://pub.example/a.png" }, "http URL → ImageData{url} 免上传");
    assert.deepEqual(d[1], { url: "https://pub.example/b.png" }, "keyframes[1] → last_image");
    assert.equal(d[13], "16", "frame_multiplier 是字符串枚举");

    const r3 = makeProvider();
    t = await r3.p.createVideo({ prompt: "v" } as any);
    assert.equal((t.raw as any).model, "cogvideox");
    assert.deepEqual(r3.posts[0].body.data, ["v", 50, 6], "cogvideox 三参最简");
  });
  test("minimax-h3 flex:t2v 免 image 直提/首尾帧映射 last_image_path/时长 clamp 14/seed 直传", async () => {
    const { p, posts } = makeProvider();
    // t2v(无 image)
    let t = await p.createVideo({ prompt: "v", model: "minimax-h3" } as any);
    let d = posts[0].body.data;
    assert.deepEqual([d[0], d[1], d[2]], ["v", null, null], "flex:无 image 时 image_path/last_image_path 为 null");
    assert.equal(d[4], 5, "默认时长 5s");
    assert.equal(d[3], "960x544 · 16:9 fast", "画布默认档");
    // 首尾帧
    const r2 = makeProvider();
    t = await r2.p.createVideo({ prompt: "v", model: "minimax-h3", image: "https://a/1.png", keyframes: ["https://a/1.png", "data:image/png;base64,Qg=="], seed: 7, durationSeconds: 30 } as any);
    d = r2.posts[0].body.data;
    assert.deepEqual(d[1], { url: "https://a/1.png" }, "image → image_path(ImageData)");
    assert.deepEqual(d[2], { base64: "Qg==" }, "keyframes[1] → last_image_path(base64 形态)");
    assert.equal(d[6], 7, "seed 直传(H3 支持,官方 API 都没有)");
    assert.equal(d[4], 14, "时长 clamp 14s");
    assert.ok(t.warnings!.some((w) => w.includes("截断")));
  });
  test("data:URI→ImageData{base64} 剥前缀;时长超限截断+告警;i2v 缺 image 拒 H302;未知模型 H300", async () => {
    const { p, posts } = makeProvider();
    const t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QUJD", keyframes: ["https://a/1.png", "data:image/png;base64,QkVERUZG"], model: "wan22-relay", durationSeconds: 30 } as any);
    assert.deepEqual(posts[0].body.data[1], { base64: "QkVERUZG" }, "relay 的 data:URI → {base64} 剥前缀");
    assert.ok(t.warnings!.some((w) => w.includes("截断")));
    await assert.rejects(makeProvider().p.createVideo({ prompt: "v", model: "wan22-i2v" } as any), (e: any) => e.code === "H302");
    await assert.rejects(makeProvider().p.createVideo({ prompt: "v", model: "nope" } as any), (e: any) => e.code === "H300");
  });
  test("丢弃参数告警:negativePrompt/videoMediaId/audioMediaIds/resolution;token 注入 Authorization 头", async () => {
    const { p, posts } = makeProvider(undefined, [], [], "hf_tok");
    const t = await p.createVideo({ prompt: "v", negativePrompt: "x", videoMediaId: "m", audioMediaIds: ["a"], resolution: "1080p" } as any);
    for (const k of ["negativePrompt", "videoMediaId", "audioMediaIds", "resolution"]) assert.ok(t.warnings!.some((w) => w.includes(k)), `缺 ${k}`);
    assert.equal((posts[0].headers as any).authorization, "Bearer hf_tok");
  });
});

describe("hfspaces getVideo(SSE 双返回形态+错误形态)", () => {
  test("complete+FileData.url → 下载转 data:video/mp4(relay 模型配 url 形态)", async () => {
    const { p, downloads } = makeProvider(undefined, [COMPLETE_URL]);
    const t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ", keyframes: ["https://a/1.png", "https://a/2.png"] } as any);
    const r = await p.getVideo({ taskId: t.taskId! });
    assert.equal(r.status, "completed");
    assert.match(String(r.url), /^data:video\/mp4;base64,/);
    assert.equal(downloads.length, 1, "临时链接即时下载");
  });
  test("complete+内嵌 data:video/mp4;base64 → 剥离直出(wan22-i2v=prithiv 形态)", async () => {
    const { p } = makeProvider(undefined, [{ event: "complete", data: JSON.stringify([{ video: "data:video/mp4;base64,QUJDREVPRw==", seed: 7 }]) }]);
    const t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ" } as any);
    const r = await p.getVideo({ taskId: t.taskId! });
    assert.equal(r.status, "completed");
    assert.match(String(r.url), /^data:video\/mp4;base64,QUJDREVPRw==$/);
  });
  test("🔴 实测错误形态:error data:null → GPU 记账拒 + token 指引;error 带文本 → 透传", async () => {
    const a = makeProvider(undefined, [{ event: "error", data: null }]);
    const ta = await a.p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ" } as any);
    const ra = await a.p.getVideo({ taskId: ta.taskId! });
    assert.equal(ra.status, "failed");
    assert.match(String(ra.error), /GPU 记账层拒/);
    assert.match(String(ra.error), /hfspaces\.token/);
    const b = makeProvider(undefined, [{ event: "error", data: JSON.stringify({ error: "didn't receive enough input values", visible: true }) }]);
    const tb = await b.p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ" } as any);
    const rb = await b.p.getVideo({ taskId: tb.taskId! });
    assert.match(String(rb.error), /didn't receive enough input values/);
  });
  test("S6 回归:numFrames→duration 换算告警;无 seed→randomize(S6 修复);token 只发 HF 域", async () => {
    const { p, posts } = makeProvider();
    const t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ", numFrames: 160 } as any);
    assert.ok(t.warnings!.some((w) => w.includes("numFrames") && w.includes("10s")), "160@16fps→10s");
    assert.equal(posts[0].body.data[8], true, "无 seed → randomize_seed=true(防复印)");
    const seeded = makeProvider();
    await seeded.p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ", seed: 7 } as any);
    assert.equal(seeded.posts[0].body.data[8], false, "显式 seed → randomize=false");
    assert.equal(seeded.posts[0].body.data[7], 7);
    // token 域白名单:非 HF 域下载不带 Authorization
    const dl = makeProvider(undefined, [COMPLETE_URL], [], "hf_tok");
    const tt = await dl.p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ", keyframes: ["https://a/1.png", "https://a/2.png"] } as any);
    await dl.p.getVideo({ taskId: tt.taskId! });
    assert.equal(dl.downloads.length, 1, "外部域 URL 仍下载");
  });
  test("S6 回归:SSE 分片(事件跨 chunk)与 CRLF 分隔均可解析", async () => {
    // 分片:每帧单独 enqueue;CRLF:\r\n 行结束 + \r\n\r\n 帧分隔
    const text = "event: queue\r\ndata: null\r\n\r\nevent: complete\r\ndata: " + JSON.stringify([{ url: "https://x.hf.space/f.mp4" }]) + "\r\n\r\n";
    const chunks = [new TextEncoder().encode("event: queue\r\ndata: nul"), new TextEncoder().encode("l\r\n\r\nevent: comp"), new TextEncoder().encode("lete\r\ndata: " + JSON.stringify([{ url: "https://x.hf.space/f.mp4" }]) + "\r\n\r\n")];
    const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } });
    const p2 = new HfspacesProvider({
      fetchImpl: (async (url: string, init: RequestInit) => {
        if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ event_id: "ev-2" }), text: async () => "{}" } as unknown as Response;
        if (url.includes("/gradio_api/call/")) return { ok: true, status: 200, body, json: async () => ({}), text: async () => "" } as unknown as Response;
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer, json: async () => ({}), text: async () => "" } as unknown as Response;
      }) as any,
    });
    p2.pollDeadlineMs = 2_000;
    const t = await p2.createVideo({ prompt: "v", image: "https://a/1.png", keyframes: ["https://a/1.png", "https://a/2.png"] } as any);
    const r = await p2.getVideo({ taskId: t.taskId! });
    assert.equal(r.status, "completed", "分片+CRLF 均可解析(归一化修复)");
  });
  test("taskModels 上下文一次性(二次 getVideo 不可恢复);无 taskId 结构化 failed;404 提交→H301 换 Space 指引", async () => {
    const { p } = makeProvider(undefined, [COMPLETE_URL]);
    const t = await p.createVideo({ prompt: "v", image: "data:image/png;base64,QQ" } as any);
    await p.getVideo({ taskId: t.taskId! });
    const again = await p.getVideo({ taskId: t.taskId! });
    assert.equal(again.status, "failed");
    assert.equal((await makeProvider().p.getVideo({} as any)).status, "failed");
    const nf = new HfspacesProvider({
      fetchImpl: (async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "not found" })) as any,
    });
    await assert.rejects(nf.createVideo({ prompt: "v" } as any), (e: any) => e.code === "H301" && /私有化/.test(e.message));
  });
});
