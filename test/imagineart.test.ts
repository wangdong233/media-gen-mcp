/**
 * ImagineArt 渠道单元测试(白盒;零 spawn 零积分 —— Transport stub 注入)。
 *
 * 覆盖:
 *   1. 目录/channelInfo(未登录 blocked-on-login;status 缓存后 live+余额透出)/costCatalog
 *   2. image:args 组装(model/ratio/quality/image)/credits 警示分层/恒单张 D1/seed·size·extra 告警
 *   3. 双错误路:queue 期(stdout 空+exit 1+stderr;额度文本→I101)/wait 期(results[].error→I400)/
 *      exit 130 取消/非 JSON stdout→I202
 *   4. 未登录前置拦下(I100,指引 login --no-browser;防 CLI 自动开浏览器)
 *   5. 视频:伪 handle submitted→getVideo 结算 completed/failed;keyframes I301;i2v 首帧门
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ImagineartProvider, ImagineartError, IMAGINEART_IMAGE_MODELS } = require("../dist/providers/imagineart.js");

interface Call { args: string[]; timeoutMs?: number }
function makeProvider(script: Array<{ code?: number; stdout?: string; stderr?: string }>, opts: { signedIn?: boolean } = { signedIn: true }) {
  const calls: Call[] = [];
  const statusResp = { code: 0, stdout: JSON.stringify({ signedIn: opts.signedIn, tokenSource: "file", credits: { current: 87, unit: "credits" }, workspace: { name: "personal" } }) };
  const queue = [{ ...statusResp }, ...script];
  const downloads: string[] = [];
  const p = new ImagineartProvider({
    transport: {
      run: async (args: string[], o?: { timeoutMs?: number }) => {
        calls.push({ args, timeoutMs: o?.timeoutMs });
        const next = queue.shift() ?? { code: 0, stdout: JSON.stringify({ results: [{ id: "x", asset: { mediaUrl: "https://tmp/fallback.png" }, savedTo: null, error: null }] }) };
        return { stdout: next.stdout ?? "", stderr: next.stderr ?? "", code: next.code ?? 0 };
      },
    },
    downloadImpl: async (u: string) => { downloads.push(u); return new Uint8Array([7, 7]).buffer; },
  });
  return { p, calls, downloads };
}
const okImage = (url = "https://tmp/a.png") => ({ code: 0, stdout: JSON.stringify({ prompt: "x", workspace: "personal", results: [{ id: "u1", asset: { status: "complete", mediaUrl: url, metadata: { width: 1024, height: 1024 } }, savedTo: "/tmp/a.png", error: null }] }) });

describe("imagineart 目录/说明/成本", () => {
  test("channelInfo:未探活=blocked-on-login;status 后=live 且余额透出;免费产出非商用在册", async () => {
    const bare = makeProvider([], { signedIn: false });
    assert.equal(bare.p.channelInfo().status, "blocked-on-login"); // 未探活无缓存
    const { p } = makeProvider([okImage()]);
    await p.generateImage({ prompt: "x" } as any);
    const ci = p.channelInfo();
    assert.equal(ci.status, "live");
    assert.ok(ci.freeQuota.includes("87"), "status credits 透出");
    assert.ok(ci.limits.some((x) => x.includes("非商用")));
    assert.deepEqual(p.listImageModels(), Object.keys(IMAGINEART_IMAGE_MODELS));
  });
  test("costCatalog:credits 静态(z-image-turbo 5/wan-2-2 30)", () => {
    const { p } = makeProvider([]);
    const cat = p.costCatalog();
    assert.equal(cat["z-image-turbo"].credits, 5);
    assert.equal(cat["wan-2-2"].credits, 30);
    assert.equal(cat["wan-2-2"].unit, "per-clip");
  });
});

describe("imagineart image", () => {
  test("args 组装:image <prompt> --json --timeout 600 + model/ratio/quality/image;budget 档告警", async () => {
    const { p, calls, downloads } = makeProvider([okImage()]);
    const r = await p.generateImage({ prompt: "a cat", model: "z-image-turbo", aspect: "16:9", quality: "high", images: ["https://pub.example/x.png"] } as any);
    const args = calls[1].args; // [0]=status
    assert.equal(args[0], "image");
    assert.equal(args[1], "a cat");
    assert.ok(args.includes("--json"));
    assert.equal(args[args.indexOf("--model") + 1], "z-image-turbo");
    assert.equal(args[args.indexOf("--ratio") + 1], "16:9");
    assert.equal(args[args.indexOf("--quality") + 1], "high");
    assert.equal(args[args.indexOf("--image") + 1], "https://pub.example/x.png");
    assert.match(r.outputs[0].url, /^data:image\//);
    assert.equal(downloads.length, 1);
    assert.ok(r.warnings!.some((w) => w.includes("5 credits/张")));
  });
  test("主流档告警含省钱指引;nano-banana-2 24cr", async () => {
    const { p } = makeProvider([okImage()]);
    const r = await p.generateImage({ prompt: "x", model: "nano-banana-2" } as any);
    assert.ok(r.warnings!.some((w) => w.includes("24 credits/张") && w.includes("z-image-turbo")));
  });
  test("D1 恒单张+丢弃参数告警:seed/size/extra/多 images", async () => {
    const { p, calls } = makeProvider([okImage()]);
    const r = await p.generateImage({ prompt: "x", n: 3, seed: 1, size: "1024x1024", extra: { foo: 1 }, images: ["https://a/1.png", "https://a/2.png"] } as any);
    assert.equal(calls.filter((c) => c.args[0] === "image").length, 1);
    for (const k of ["恒单张", "seed", "size", "extra", "images[0]"]) assert.ok(r.warnings!.some((w) => w.includes(k)), `缺 ${k}`);
  });
  test("i2i 形态门:data:URI → I302", async () => {
    const { p } = makeProvider([okImage()]);
    await assert.rejects(p.generateImage({ prompt: "x", images: ["data:image/png;base64,zz"] } as any), (e: any) => e.code === "I302");
  });
});

describe("imagineart 双错误路(机器契约)", () => {
  test("queue 期失败:stdout 空+exit 1+stderr 额度文本 → I101;非额度文本 → I400", async () => {
    const { p } = makeProvider([{ code: 1, stdout: "", stderr: "generate_image failed: insufficient credits for this request" }]);
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I101" && /额度|配额/.test(e.message));
    const { p: p2 } = makeProvider([{ code: 1, stdout: "", stderr: "generate_image failed: model not available" }]);
    await assert.rejects(p2.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I400");
  });
  test("wait 期失败:results[].error → I400;exit 130 取消 → I201;stdout 非 JSON → I202", async () => {
    const { p } = makeProvider([{ code: 1, stdout: JSON.stringify({ results: [{ id: "u", asset: {}, error: "content policy rejected" }] }) }]);
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I400" && /content policy/.test(e.message));
    const { p: p130 } = makeProvider([{ code: 130, stdout: "", stderr: "cancelled" }]);
    await assert.rejects(p130.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I201");
    const { p: pBad } = makeProvider([{ code: 0, stdout: "not-json{" }]);
    await assert.rejects(pBad.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I202");
  });
  test("未登录前置拦下:I100 + login --no-browser 指引(防 CLI 自动开浏览器)", async () => {
    const { p, calls } = makeProvider([], { signedIn: false });
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => e.code === "I100" && /login --no-browser/.test(e.message) && e.precondition === true);
    assert.equal(calls.filter((c) => c.args[0] === "image").length, 0, "未登录不发起 image 命令");
  });
});

describe("imagineart 视频(伪 handle)", () => {
  test("submitted 伪 handle → getVideo 结算 completed(data:video);credits 告警", async () => {
    const { p } = makeProvider([{ code: 0, stdout: JSON.stringify({ results: [{ id: "v1", asset: { mediaUrl: "https://tmp/v.mp4" }, error: null }] }) }]);
    const t = await p.createVideo({ prompt: "v", model: "wan-2-2", ratio: "16:9", resolution: "720p" } as any);
    assert.equal(t.status, "submitted");
    assert.ok(t.taskId!.startsWith("imagineart-"));
    assert.ok(t.warnings!.some((w) => w.includes("30 credits/条")));
    const r = await p.getVideo({ taskId: t.taskId });
    assert.equal(r.status, "completed");
    assert.match(String(r.url), /^data:video\/mp4;base64,/);
    const again = await p.getVideo({ taskId: t.taskId });
    assert.equal(again.status, "failed", "伪 handle 单次结算(进程内)");
  });
  test("keyframes → I301;i2v 首帧不存在路径 → I302;失败传播", async () => {
    const { p } = makeProvider([]);
    await assert.rejects(p.createVideo({ prompt: "v", keyframes: ["https://a/1.png"] } as any), (e: any) => e.code === "I301");
    await assert.rejects(p.createVideo({ prompt: "v", image: "/no/such/file.png" } as any), (e: any) => e.code === "I302");
    const { p: pFail } = makeProvider([{ code: 0, stdout: JSON.stringify({ results: [{ id: "v", asset: {}, error: "video render failed" }] }) }]);
    const t = await pFail.createVideo({ prompt: "v" } as any);
    const r = await pFail.getVideo({ taskId: t.taskId! });
    assert.equal(r.status, "failed");
    assert.match(String(r.error), /video render failed/);
  });
  test("requiresOptIn=true;notifyUnavailable 记 lastErrorAt", () => {
    const { p } = makeProvider([]);
    assert.equal(p.requiresOptIn("image"), true);
    p.notifyUnavailable(new Error("x"));
    assert.ok(p.health().lastErrorAt);
  });
});
