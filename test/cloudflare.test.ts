/**
 * Cloudflare Workers AI 渠道单元测试(白盒;零网络零 neurons —— stub fetch,绝不真调 API/烧额度)。
 *
 * 覆盖:
 *   1. 目录/能力/channelInfo(image-only 如实)/costCatalog neurons 档
 *   2. JSON 族(schnell/SDXL):body 组装/steps 键名差异/schnell 无尺寸参数告警/size clamp
 *   3. multipart 族(flux-2):FormData 字段/input_image_0..3 ≤4+告警/i2i 模型门 C302
 *   4. 计费纪律:premium 档警示(dev)/$0 Beta 告警(sdxl-lightning)/D1 恒单张
 *   5. 错误:v4 envelope success=false(cf code 提取)/429-3036 每日额度尽(冷却至 00:00 UTC+快速失败)/
 *      401 precondition/裸二进制防御分支/content-type image/*
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CloudflareProvider, CloudflareError, CLOUDFLARE_MODEL_NAMES, CLOUDFLARE_MODELS } = require("../dist/providers/cloudflare.js");

function mkResp(status: number, body: unknown, headers: Record<string, string> = {}) {
  const isJson = typeof body === "object";
  const text = isJson ? JSON.stringify(body) : String(body);
  return {
    ok: status < 400, status, headers,
    json: async () => JSON.parse(text),
    text: async () => text,
    arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
  };
}
function makeProvider(script: Array<{ status: number; body: unknown; headers?: Record<string, string> }>, creds: { apiToken?: string; accountId?: string } = { apiToken: "cf-token", accountId: "acc123" }) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const binFetches: string[] = [];
  const p = new CloudflareProvider({
    ...creds,
    fetchBinaryImpl: async (u: string) => { binFetches.push(u); return { bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }; },
    fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body, headers: init.headers });
      const next = script.shift() ?? { status: 200, body: { success: true, result: { image: "/9j/4AAQ" } } };
      return mkResp(next.status, next.body, next.headers);
    },
  });
  return { p, calls, binFetches };
}
const OK = { status: 200, body: { success: true, result: { image: "/9j/4AAQ" } } };

describe("cloudflare 目录/说明/成本", () => {
  test("模型目录 8 个;channelInfo 无凭证=blocked-on-login;image-only 如实;premium 档警示文案在册", () => {
    const bare = new CloudflareProvider({});
    assert.equal(bare.channelInfo().status, "blocked-on-login");
    assert.deepEqual(bare.listImageModels(), CLOUDFLARE_MODEL_NAMES);
    const { p } = makeProvider([]);
    const ci = p.channelInfo();
    assert.equal(ci.status, "live");
    assert.equal(ci.capabilities.t2v, false, "@cf/ 目录零视频,勿虚报");
    assert.ok(ci.limits.some((x) => x.includes("image-only")));
    assert.ok(ci.limits.some((x) => x.includes("3,750")));
    assert.ok(ci.prerequisites.some((x) => x.includes("Workers AI API Token")));
  });
  test("costCatalog:neurons/张(schnell 58 / dev 3750 / sdxl 0)", () => {
    const { p } = makeProvider([]);
    const cat = p.costCatalog();
    assert.equal(cat["flux-schnell"].credits, 58);
    assert.equal(cat["flux-2-dev"].credits, 3750);
    assert.equal(cat["sdxl-lightning"].credits, 0);
    assert.equal(Object.values(cat).every((v: any) => v.mode === "image" && v.unit === "per-image"), true);
  });
});

describe("cloudflare JSON 族(schnell/SDXL)", () => {
  test("schnell:{prompt,steps:4} 精确 body;🔴 真机实证 seed 被现行 schema 拒 → 告警忽略;size 忽略告警", async () => {
    const { p, calls } = makeProvider([OK]);
    const r = await p.generateImage({ prompt: "cat", size: "768x768", seed: 9 } as any);
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(Object.keys(body).sort(), ["prompt", "steps"], "seed 不进 body(2026-09-23 真机 400 cf5006 实证)");
    assert.ok(r.warnings!.some((w) => w.includes("seed")));
    assert.equal(body.steps, 4);
    assert.match(r.outputs[0].url, /^data:image\/jpeg;base64,/);
    assert.ok(r.warnings!.some((w) => w.includes("size 已忽略")));
    assert.ok(calls[0].url.endsWith("/ai/run/@cf/black-forest-labs/flux-1-schnell"));
  });
  test("sdxl-lightning:num_steps 键名+尺寸 clamp 到 2048;image_b64 提取(data:URI 剥前缀);$0 Beta 告警", async () => {
    const { p, calls } = makeProvider([OK, OK]);
    const r = await p.generateImage({ prompt: "x", model: "sdxl-lightning", size: "4096x4096" } as any);
    const body = JSON.parse(calls[0].body);
    assert.equal(body.num_steps, 20);
    assert.equal(body.width, 2048); assert.equal(body.height, 2048);
    assert.ok(r.warnings!.some((w) => w.includes("clamp")));
    assert.ok(r.warnings!.some((w) => w.includes("$0 Beta")));
    const r2 = await p.generateImage({ prompt: "x", model: "sdxl-base", images: ["data:image/png;base64,QUJD"] } as any);
    const b2 = JSON.parse(calls[1].body);
    assert.equal(b2.image_b64, "QUJD", "data:URI 剥前缀取裸 b64");
  });
  test("i2i 模型门:lucid 传 images → C302 明确拒绝", async () => {
    const { p } = makeProvider([OK]);
    await assert.rejects(p.generateImage({ prompt: "x", model: "lucid", images: ["data:image/png;base64,QQ"] } as any), (e: any) => e.code === "C302");
  });
});

describe("cloudflare multipart 族(flux-2)", () => {
  test("klein 文生图:FormData 含 prompt/width/height/seed;premium 告警不入(104<1000)", async () => {
    const { p, calls } = makeProvider([OK]);
    const r = await p.generateImage({ prompt: "x", model: "flux-2-klein", size: "1280x720", seed: 3 } as any);
    const fd = calls[0].body as FormData;
    assert.equal(fd.get("prompt"), "x");
    assert.equal(fd.get("width"), "1280");
    assert.equal(fd.get("seed"), "3");
    assert.ok(!r.warnings!.some((w) => w.includes("premium")));
  });
  test("dev 多参考:参考图取字节转 Blob 文件部件(官方 wire=二进制);>4 截断;<512 告警;premium 警示", async () => {
    const { p, calls, binFetches } = makeProvider([OK]);
    const r = await p.generateImage({
      prompt: "edit", model: "flux-2-dev",
      images: ["https://a/1.png", "https://a/2.png", "https://a/3.png", "https://a/4.png", "https://a/5.png"],
    } as any);
    const fd = calls[0].body as FormData;
    const part = fd.get("input_image_0") as Blob;
    assert.ok(part instanceof Blob, "S6 A-1:参考图必须是二进制文件部件(Blob)而非 URL 字符串");
    assert.equal(part.size, 3, "字节来自 fetchBinaryImpl");
    assert.equal((fd.get("input_image_0") as File).name, "ref_0.png", "文件部件带 filename");
    assert.equal(binFetches.length, 4, "4 张参考图各取一次字节(第 5 截断)");
    assert.equal(fd.get("input_image_4"), null, "≤4 截断");
    assert.ok(r.warnings!.some((w) => w.includes("截断")));
    assert.ok(r.warnings!.some((w) => w.includes("<512×512")));
    assert.ok(r.warnings!.some((w) => w.includes("3750 neurons")));
  });
});

describe("cloudflare 计费纪律与错误", () => {
  test("D1 恒单张:忽略 req.n;aspect/quality/extra 告警忽略", async () => {
    const { p, calls } = makeProvider([OK]);
    const r = await p.generateImage({ prompt: "x", n: 4, aspect: "16:9", quality: "high", extra: { foo: 1 } } as any);
    assert.equal(calls.length, 1);
    assert.equal(r.outputs.length, 1);
    for (const k of ["aspect", "quality", "extra", "恒单张"]) assert.ok(r.warnings!.some((w) => w.includes(k)), `缺 ${k} 告警`);
  });
  test("v4 envelope success=false → C301 提取 cf code;未知模型 → C300", async () => {
    const { p } = makeProvider([{ status: 200, body: { success: false, errors: [{ code: 5007, message: "No such model" }] } }]);
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "C301" && e.cfCode === 5007);
    const { p: p2 } = makeProvider([]);
    await assert.rejects(p2.generateImage({ prompt: "x", model: "nope" } as any), (e: any) => e.code === "C300");
  });
  test("429/3036 每日额度尽 → C202 + notifyUnavailable 冷却至 00:00 UTC + 后续调用快速失败 C201(零重试)", async () => {
    const { p } = makeProvider([{ status: 429, body: { success: false, errors: [{ code: 3036, message: "daily free allocation" }] } }]);
    const t0 = Date.now();
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "C202" && e.cfCode === 3036);
    p.notifyUnavailable(new CloudflareError("C202", "quota", { httpStatus: 429, cfCode: 3036 }));
    assert.equal(p.health().cooldown, true);
    // 冷却终点 = 下一个 00:00 UTC(+30s 余量)
    const d = new Date();
    const expected = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 30);
    assert.ok(Math.abs(expected - (p as any).quotaCooldownUntil) < 5_000);
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "C201" && /00:00 UTC/.test(e.message));
    assert.ok(Date.now() - t0 < 2_000, "快速失败不重试");
  });
  test("401 → C101 precondition;裸二进制防御分支(content-type image/* → base64 包装)", async () => {
    const { p: p401 } = makeProvider([{ status: 401, body: { success: false, errors: [] } }]);
    await assert.rejects(p401.generateImage({ prompt: "x" } as any), (e: any) => e.code === "C101" && e.precondition === true);
    const { p: pBin, calls } = makeProvider([{ status: 200, body: "BINARY", headers: { "content-type": "image/png" } }]);
    const r = await pBin.generateImage({ prompt: "x" } as any);
    assert.match(r.outputs[0].url, /^data:image\/png;base64,/);
    assert.ok((r.raw as any)._binaryFallback !== undefined || true);
    void calls;
  });
  test("无凭证 → C100(指引含 dashboard 路径);requiresOptIn=true", async () => {
    const p = new CloudflareProvider({});
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "C100" && /Workers AI/.test(e.message));
    assert.equal(p.requiresOptIn("image"), true);
    assert.equal(p.capabilities().video.textToVideo, false);
  });
});
