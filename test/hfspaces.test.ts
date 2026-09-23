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
function makeProvider(postJson: any = { event_id: "ev-1" }, sseFrames: Array<{ event: string; data: string | null }> = [], downloads: string[] = [], token?: string) {
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
    assert.equal(ci.capabilities.t2i, false, "video-only 渠道勿虚报图能力");
    assert.equal(ci.capabilities.keyframes, true, "relay 首末帧接力=keyframes 能力");
    assert.ok(ci.limits.some((x) => x.includes("video-only")));
    assert.ok(ci.cost.includes("2min"), "配额口径在 cost 字段(匿名 2min/免费号 5min)");
    assert.deepEqual(p.listVideoModels(), HFSPACES_MODEL_NAMES);
    assert.equal(p.requiresOptIn("video"), true);
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
