/**
 * PixVerse provider 单元测试(白盒;零 spawn 零消耗 —— 全程 PixverseTransport stub,绝不触碰
 * 真实 CLI/订阅积分;CI 积分红线)。对齐 flow-confirm.test.ts 的 StubTransport 先例。
 *
 * 覆盖面(2026-09-14 审查 P0-3:1410 行 provider 此前零测试覆盖):
 *   1. mapCliFailure 退出码 0-7 单表全映射(capabilities.json 逐字契约)+ partial 载荷一等公民
 *      + exit-2 超时恢复 + exit-3 OAuth Authorize URL + 412 第三方 hint + 500047 内部码;
 *   2. 纯函数白盒:collectTaskIds / extractJson / extractAuthorizeUrl / compareSemver /
 *      aspectFromSize / staticEstimateCredits / costLedgerKey / parsePixverseSection(config);
 *   3. 🔴 计费确认门(两段式):挑战 → 令牌 → 复调放行;参数篡改 S320;过期 S321;单次消费 S322
 *      (含跨实例持久化);garbage token S320;门关闭豁免;未过门提交 S323;
 *   4. 🔴 P0-1 HMAC 回归:mint→verify 确定性往返(审查离线复现路径)+ 幂等键 = 令牌 idem 字段
 *      (非 MAC)+ 跨实例同 secret 通过/不同 secret S320 —— 期望值来自 HMAC 结构不变量;
 *   5. 🔴 P0-2 模态判别显式化:最小合法 VideoRequest {prompt, model}(零 video 专有字段)必须
 *      走视频门(旧 looksLikeVideoRequest 形状猜测正是把它误判成 image);图像/视频钩子各自独立;
 *      跨模态误调 → 显式 S300 而非静默错路由;flow 图像豁免 = 不实现钩子;
 *   6. 账本优先级:asset list 观测 cost_credits 落账本 → 下次预估命中(无漂移告警);
 *   7. registry/index 接线:pixverse 注册 + requiresOptIn 双模态 true + 双钩子在册;
 *   8. 提交主路径:create args 携 --idempotency-key(=令牌 idem 字段)+ --no-wait + --audio。
 *
 * 导入方式:与 flow.test.ts 同范式(createRequire 引编译产物 dist/)。
 * 状态文件全部重定向到临时目录(绝不写真实 ~/.media-gen-mcp)。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const {
  PixverseProvider,
  PixverseError,
  mapCliFailure,
  collectTaskIds,
  extractJson,
  extractAuthorizeUrl,
  compareSemver,
  aspectFromSize,
  staticEstimateCredits,
  costLedgerKey,
  PIXVERSE_PINNED_VERSION,
} = require_(path.join(distDir, "providers/pixverse.js"));
const { parsePixverseSection } = require_(path.join(distDir, "config.js"));
const reg = require_(path.join(distDir, "providers/registry.js"));

// ── Stub transport(零 spawn;按 args 路由应答) ──

type Reply = { stdout?: string; stderr?: string; code?: number };

function defaultReply(args: string[]): Reply {
  const j = (o: unknown) => JSON.stringify(o);
  if (args[0] === "-V") return { stdout: `${PIXVERSE_PINNED_VERSION}\n` };
  if (args[0] === "capabilities") {
    if (args.length === 2) return { stdout: j({}) }; // bundle 摘要探测:无 modes → 跳过 state 写
    // per-model 能力:qwen-image 暴露 quality 枚举(免「能力表未声明」噪声),其余空表
    if (args[2] === "image" && args[4] === "qwen-image") {
      return { stdout: j({ capability: { parameters: { quality: { enum: ["720p", "1080p"], default: "720p", on_invalid: "adjust" } }, models: {} } }) };
    }
    return { stdout: j({ capability: { parameters: {}, models: {} } }) };
  }
  if (args[0] === "account" && args[1] === "info") return { stdout: j({ credits: { total: 500 } }) };
  if (args[0] === "account" && args[1] === "slots") {
    return { stdout: j({ image: { remaining: 3, limit: 3 }, video: { remaining: 3, limit: 3 }, shared_pool: true }) };
  }
  if (args[0] === "asset" && args[1] === "list") {
    return { stdout: j({ items: [{ id: 424242, cost_credits: 5, model: "qwen-image", quality: "720p" }] }) };
  }
  if (args[0] === "task" && args[1] === "status") {
    return { stdout: j({ id: args[2], status_code: 1, image_url: "https://example.com/img.png", video_url: "https://example.com/v.mp4" }) };
  }
  if (args[0] === "create") {
    if (args[1] === "image") return { stdout: j({ image_id: 424242 }) };
    return { stdout: j({ video_id: 777 }) };
  }
  return { stdout: j({}) };
}

class StubTransport {
  calls: string[][] = [];
  notes: string[] = [];
  private reply: (args: string[]) => Reply;
  constructor(reply?: (args: string[]) => Reply) {
    this.reply = reply ?? defaultReply;
  }
  async resolveBin(): Promise<string | null> { return "/stub/bin/pixverse"; }
  async run(args: string[]): Promise<{ stdout: string; stderr: string; code: number; resolvedBin?: string }> {
    this.calls.push(args);
    const r = this.reply(args);
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code ?? 0, resolvedBin: "/stub/bin/pixverse" };
  }
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pixverse-test-"));
}

/** 状态文件全部重定向临时目录(绝不写真实 ~/.media-gen-mcp)。 */
function makeP(opts: { cfg?: Record<string, unknown>; reply?: (args: string[]) => Reply; shared?: { dir: string } } = {}) {
  const t = new StubTransport(opts.reply);
  const p: any = new PixverseProvider({ transport: t, pixverseCfg: opts.cfg ?? {} });
  const dir = opts.shared?.dir ?? tmpDir();
  p.stateFile = path.join(dir, "state.json");
  p.confirmSecretFile = path.join(dir, "confirm-secret");
  p.confirmConsumedFile = path.join(dir, "confirm-consumed.json");
  p.costLedgerFile = path.join(dir, "cost-ledger.json");
  return { p, t, dir };
}

const j = (o: unknown) => JSON.stringify(o);

// ── 1. mapCliFailure:退出码 0-7 单表(capabilities.json 逐字契约) ──

describe("pixverse mapCliFailure 退出码单表(0-7)", () => {
  const ctx = { mode: "video", model: "v6" };

  test("exit 2 + 已拿任务 ID → 转轮询恢复 payload(手册 §3.3)", () => {
    const m = mapCliFailure(2, j({ video_id: "123" }), "timeout", ctx) as any;
    assert.ok("payload" in m, "有任务 ID 时不报错,恢复为 partial payload");
    assert.equal(m.payload.status, "submitted");
    assert.equal(m.payload.__recoveredFromTimeout, true);
    assert.equal(m.payload.video_id, "123");
  });
  test("exit 2 无任务 ID → S404(提示 task status 复查)", () => {
    const m = mapCliFailure(2, "", "cli wait timeout", ctx) as any;
    assert.ok(m.error instanceof PixverseError);
    assert.equal(m.error.code, "S404");
    assert.equal(m.error.cliExitCode, 2);
    assert.match(m.error.message, /task status/);
  });
  test("exit 3 → S103 一等公民:precondition + stderr 捕获 Authorize URL + auth login 指引", () => {
    const stderr = `please authorize: https://app.pixverse.ai/oauth/authorize?client_id=xyz&code=abc`;
    const m = mapCliFailure(3, "", stderr, ctx) as any;
    assert.equal(m.error.code, "S103");
    assert.equal(m.error.precondition, true);
    assert.equal(m.error.cliExitCode, 3);
    assert.match(m.error.message, /auth login/);
    assert.match(m.error.message, /https:\/\/app\.pixverse\.ai\/oauth\/authorize\?client_id=xyz/);
  });
  test("exit 4 → S402 积分不足(附 account info 指引)", () => {
    const m = mapCliFailure(4, "", j({ error: "insufficient credits" }), ctx) as any;
    assert.equal(m.error.code, "S402");
    assert.match(m.error.message, /account info/);
  });
  test("exit 5 + items[] → partial payload 一等公民(1.4.0 起部分批次失败)", () => {
    const m = mapCliFailure(5, j({ items: [{ image_id: 1, status: "done" }], failed_ids: [2] }), "", { mode: "image", model: "qwen-image" }) as any;
    assert.ok("payload" in m);
    assert.deepEqual(m.payload.failed_ids, [2]);
  });
  test("exit 5 纯失败 → S400 + 重生成换幂等键指引", () => {
    const m = mapCliFailure(5, "", j({ error: "generation failed" }), ctx) as any;
    assert.equal(m.error.code, "S400");
    assert.match(m.error.message, /idempotency/);
  });
  test("exit 5 第三方模型 → 412 advisory hint(降原生 v6;不预探测)", () => {
    const m = mapCliFailure(5, "", j({ error: "useapi conflict" }), { mode: "video", model: "kling-3.0-pro" }) as any;
    assert.equal(m.error.code, "S400");
    assert.match(m.error.message, /412/);
    assert.match(m.error.message, /v6/);
  });
  test("exit 5 原生模型 → 无 412 hint", () => {
    const m = mapCliFailure(5, "", j({ error: "x" }), { mode: "video", model: "v6" }) as any;
    assert.equal(m.error.code, "S400");
    assert.doesNotMatch(m.error.message, /412/);
  });
  test("exit 6 → S405 参数校验失败(不重试)", () => {
    const m = mapCliFailure(6, "", "invalid param --duration", ctx) as any;
    assert.equal(m.error.code, "S405");
    assert.equal(m.error.cliExitCode, 6);
  });
test("F5 版本锁单源:package.json optionalDependencies.pixverse === PIXVERSE_PINNED_VERSION(双源失配=本地 bin 与 npx 兜底装不同版本)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(distDir, "..", "package.json"), "utf-8"));
  assert.equal(pkg.optionalDependencies?.pixverse ?? pkg.dependencies?.pixverse, PIXVERSE_PINNED_VERSION, "升级 pixverse CLI 必须同步改两处并以本测试守护");
});
test("submitWithRetry 退避:exit7×2 后第 3 次成功(mutation 补测——复用同 args/同 key,退避次数 2/3)", async () => {
  let n = 0;
  const { p } = makeP({
    reply: (args) => {
      if (args.includes("create") && args.includes("image")) {
        n++;
        if (n <= 2) return { code: 7, stderr: "concurrency limit" };
        return { code: 0, stdout: JSON.stringify({ status: "completed", image_id: 42, image_url: "https://x/i.png" }) };
      }
      return defaultReply(args);
    },
  });
  (p as any).backoffsForTests = [1, 1, 1]; // 测试缝:无则真 5s/10s 退避(见下 fallback)
  const submit = (p as any).submitWithRetry.bind(p);
  const j = await submit(["create", "image", "--prompt", "x"], { mode: "image", model: "qwen-image", count: 1 });
  assert.equal(j.image_id, 42, "第 3 次成功载荷返回");
  assert.equal(n, 3, "恰好重试两次");
});

  test("exit 7 → S403 并发额度满(Standard 3 槽)", () => {
    const m = mapCliFailure(7, "", "concurrency limit", ctx) as any;
    assert.equal(m.error.code, "S403");
    assert.equal(m.error.cliExitCode, 7);
  });
  test("exit 1 通用 → S407", () => {
    const m = mapCliFailure(1, "", "boom", ctx) as any;
    assert.equal(m.error.code, "S407");
    assert.equal(m.error.cliExitCode, 1);
  });
  test("exit 1 + 内部 code 500047(stderr JSON)→ S406 任务不存在(internalCode advisory)", () => {
    const m = mapCliFailure(1, "", j({ code: 500047, error: "task not found" }), ctx) as any;
    assert.equal(m.error.code, "S406");
    assert.equal(m.error.internalCode, 500047);
  });
  test("stderr 非 JSON 时提取纯文本并滤掉 npm 噪声行", () => {
    const m = mapCliFailure(1, "", "npm warn deprecated foo\nreal error here", ctx) as any;
    assert.equal(m.error.code, "S407");
    assert.match(m.error.message, /real error here/);
    assert.doesNotMatch(m.error.message, /npm warn/);
  });
  test("stdout 优先于 stderr 双解析(exit-5 partial 载荷通道)", () => {
    const m = mapCliFailure(5, j({ items: [{ image_id: 9 }] }), j({ error: "some failed" }), { mode: "image", model: "v6" }) as any;
    assert.ok("payload" in m, "stdout 带 items → partial 载荷优先");
  });
});

// ── 2. 纯函数白盒 ──

describe("pixverse 纯函数", () => {
  test("collectTaskIds:video_id(s)/image_id(s)/items[]/audio_id 全形态去重", () => {
    assert.deepEqual(collectTaskIds({ video_id: "a", video_ids: ["a", "b"] }), ["a", "b"]);
    assert.deepEqual(collectTaskIds({ image_ids: ["1", "2"] }), ["1", "2"]);
    assert.deepEqual(collectTaskIds({ items: [{ video_id: "x" }, { image_id: "y" }, { id: "z" }] }), ["x", "y", "z"]);
    assert.deepEqual(collectTaskIds({ audio_id: "q" }), ["q"]);
    assert.deepEqual(collectTaskIds(null), []);
  });
  test("extractJson:整串/混排提取/失败 undefined", () => {
    assert.deepEqual(extractJson(j({ a: 1 })), { a: 1 });
    assert.deepEqual(extractJson(`noise before {"a":1} noise after`), { a: 1 });
    assert.equal(extractJson("not json at all"), undefined);
    assert.equal(extractJson(""), undefined);
  });
  test("extractAuthorizeUrl:仅捕获 app.pixverse.ai oauth Authorize URL", () => {
    assert.equal(extractAuthorizeUrl("go to https://app.pixverse.ai/oauth/authorize?x=1 now"), "https://app.pixverse.ai/oauth/authorize?x=1");
    assert.equal(extractAuthorizeUrl("https://evil.example.com/oauth/authorize?x=1"), undefined);
  });
  test("compareSemver:主.次.修 比较(engines 检测)", () => {
    assert.ok(compareSemver("22.12.0", "22.12.0") === 0);
    assert.ok(compareSemver("24.1.0", "22.12.0") > 0);
    assert.ok(compareSemver("18.20.0", "22.12.0") < 0);
    assert.ok(compareSemver("22.13.0-beta", "22.12.0") > 0, "预发布后缀不参与比较");
  });
  test("aspectFromSize:WxH → 最近似比例;默认/畸形 → undefined", () => {
    assert.equal(aspectFromSize("1920x1080"), "16:9");
    assert.equal(aspectFromSize("720x1280"), "9:16");
    assert.equal(aspectFromSize("1024x1024"), "1:1");
    assert.equal(aspectFromSize("abc"), undefined);
    assert.equal(aspectFromSize(undefined), undefined);
  });
  test("staticEstimateCredits:qwen-image 720p/1080p 实测价 + v6 有音保守档 + 未知 null", () => {
    assert.equal(staticEstimateCredits({ mode: "image", model: "qwen-image", quality: "720p", count: 1 }), 5);
    assert.equal(staticEstimateCredits({ mode: "image", model: "qwen-image", quality: "1080p", count: 2 }), 20);
    assert.equal(staticEstimateCredits({ mode: "image", model: "gpt-image-2.5-flare" }), null);
    assert.equal(staticEstimateCredits({ mode: "video", model: "v6", quality: "720p", durationSeconds: 5 }), 60, "v6-720p 有音 12cr/s × 5s");
    assert.equal(staticEstimateCredits({ mode: "video", model: "v6", quality: "360p", durationSeconds: 5 }), 35, "360p 勘误实测 7(有音)× 5s");
    assert.equal(staticEstimateCredits({ mode: "video", model: "sora-2-pro", durationSeconds: 5 }), null);
    assert.equal(staticEstimateCredits({ mode: "video", model: "v6", durationSeconds: undefined }), null);
  });
  test("costLedgerKey:mode|model|quality|duration|audio|count(写读对齐)", () => {
    assert.equal(costLedgerKey({ mode: "image", model: "qwen-image", quality: "720p", count: 1 }), "image|qwen-image|720p|0|1|1");
    assert.equal(costLedgerKey({ mode: "video", model: "v6", quality: "720p", durationSeconds: 5, audio: true, count: 1 }), "video|v6|720p|5s|1|1");
    assert.equal(costLedgerKey({ mode: "video", model: "v6", quality: undefined, durationSeconds: 5, audio: false, count: 1 }), "video|v6||5s|0|1");
  });
});

describe("config parsePixverseSection", () => {
  test("缺省:toolDeadline 110s + 门开 + TTL 10min,无 pinnedVersion", () => {
    assert.deepEqual(parsePixverseSection(undefined), { toolDeadlineMs: 110_000, confirm: true, confirmTtlMs: 600_000 });
    assert.deepEqual(parsePixverseSection({}), { toolDeadlineMs: 110_000, confirm: true, confirmTtlMs: 600_000 });
  });
  test("显式覆盖 + 非法值回退默认 + pinnedVersion 语义版本才收", () => {
    assert.deepEqual(
      parsePixverseSection({ toolDeadlineMs: 5_000, confirm: false, confirmTtlMs: 1_000, pinnedVersion: "1.4.4" }),
      { toolDeadlineMs: 5_000, confirm: false, confirmTtlMs: 1_000, pinnedVersion: "1.4.4" },
    );
    assert.deepEqual(parsePixverseSection({ toolDeadlineMs: -1, confirmTtlMs: 0 }), { toolDeadlineMs: 110_000, confirm: true, confirmTtlMs: 600_000 });
    assert.equal(parsePixverseSection({ pinnedVersion: "1.4" }).pinnedVersion, undefined);
    assert.equal(parsePixverseSection({ confirm: true }).confirm, true, "仅显式 false 关门");
  });
});

// ── 3+4+5. 计费确认门(两段式)+ P0-1 HMAC 回归 + P0-2 模态判别 ──

describe("pixverse 计费确认门(两段式;stub 零 spawn)", () => {
  const IMG_REQ = { prompt: "a cat", model: "qwen-image", quality: "720p" };
  const VID_REQ = { prompt: "t2v clip", model: "v6", resolution: "720p" as const, durationSeconds: 5 };

  test("第一段:image 挑战(needConfirm + 静态预估 + 令牌格式 + TTL + 漂移告警)且零 create 提交", async () => {
    const { p, t } = makeP();
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.ok(c && c.needConfirm);
    assert.equal(c.provider, "pixverse");
    assert.equal(c.model, "qwen-image");
    assert.equal(c.estimatedCost, 5, "静态首估 qwen-image 720p = 5cr(09-14 实测)");
    assert.equal(c.costSource, "static");
    assert.match(c.confirmToken, /^pvc1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-f]{32}\.[0-9a-f]{32}$/);
    assert.equal(c.expiresInSeconds, 600);
    assert.ok(c.warnings.some((w: string) => /漂移|实际扣减/.test(w)), "静态来源必带漂移告警");
    assert.ok(!t.calls.some((a) => a[0] === "create"), "挑战段绝不提交(零 spawn create)");
  });

  test("第一段:video 挑战(duration × 静态费率;numFrames→duration 换算同价)", async () => {
    const { p } = makeP();
    const c = await p.beginVideoSubmissionConfirm(VID_REQ);
    assert.ok(c?.needConfirm);
    assert.equal(c.estimatedCost, 60, "v6-720p 有音保守 12cr/s × 5s");
    const c2 = await p.beginVideoSubmissionConfirm({ prompt: "t2v clip", model: "v6", resolution: "720p", numFrames: 120, frameRate: 24 });
    assert.equal(c2.estimatedCost, 60, "numFrames/frameRate 换算 5s 与 durationSeconds 同 digest 同价");
  });

  test("第二段:原参数 + 令牌 → undefined 放行(仍零提交;幂等上下文按 digest 登记)", async () => {
    const { p, t } = makeP();
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(await p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), undefined);
    assert.ok(!t.calls.some((a) => a[0] === "create"), "校验段是本地 HMAC,不 spawn");
  });

  test("参数篡改任一计费要素 → S320 与当前请求不符", async () => {
    const { p } = makeP();
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    await assert.rejects(() => p.beginImageSubmissionConfirm({ ...IMG_REQ, quality: "1080p" }, c.confirmToken), (e: any) => e.code === "S320" && /与当前请求不符/.test(e.message));
    await assert.rejects(() => p.beginImageSubmissionConfirm({ ...IMG_REQ, prompt: "tampered" }, c.confirmToken), /S320/);
    await assert.rejects(() => p.beginImageSubmissionConfirm({ ...IMG_REQ, n: 3 }, c.confirmToken), /S320/);
    await assert.rejects(() => p.beginImageSubmissionConfirm({ ...IMG_REQ, images: ["https://example.com/a.png"] }, c.confirmToken), /S320/);
  });

  test("video 篡改 duration/model → S320", async () => {
    const { p } = makeP();
    const c = await p.beginVideoSubmissionConfirm(VID_REQ);
    await assert.rejects(() => p.beginVideoSubmissionConfirm({ ...VID_REQ, durationSeconds: 8 }, c.confirmToken), /S320/);
    await assert.rejects(() => p.beginVideoSubmissionConfirm({ ...VID_REQ, model: "pixverse-c1" }, c.confirmToken), /S320/);
  });

  test("garbage/结构错位 token → S320 格式非法", async () => {
    const { p } = makeP();
    await assert.rejects(() => p.beginImageSubmissionConfirm(IMG_REQ, "garbage"), (e: any) => e.code === "S320" && /格式非法/.test(e.message));
    await assert.rejects(() => p.beginImageSubmissionConfirm(IMG_REQ, "pvc1.zz.zz.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), /S320/);
  });

  test("过期 → S321(TTL 可配)", async () => {
    const { p } = makeP({ cfg: { confirmTtlMs: 60 } });
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(c.expiresInSeconds, 0, "expiresInSeconds 随配置");
    await new Promise((r) => setTimeout(r, 90));
    await assert.rejects(() => p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), (e: any) => e.code === "S321" && /过期/.test(e.message));
  });

  test("单次消费:同令牌二次 → S322(防重复扣积分)", async () => {
    const { p } = makeP();
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(await p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), undefined);
    await assert.rejects(() => p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), (e: any) => e.code === "S322" && /已使用/.test(e.message));
  });

  test("单次消费后重取新令牌可正常放行(不锁死流程)", async () => {
    const { p } = makeP();
    const c1 = await p.beginImageSubmissionConfirm(IMG_REQ);
    await p.beginImageSubmissionConfirm(IMG_REQ, c1.confirmToken);
    const c2 = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.notEqual(c2.confirmToken, c1.confirmToken, "新挑战 → 新幂等键(确认失败换新 key 纪律)");
    assert.equal(await p.beginImageSubmissionConfirm(IMG_REQ, c2.confirmToken), undefined);
  });

  test("🔴 P0-1 HMAC 回归:mint→verify 确定性往返 + 返回值 = idem 字段(非 MAC)", () => {
    const { p } = makeP();
    const mint = (d: string, k: string) => (p as any).mintConfirmToken(d, k);
    const verify = (token: string, d: string) => (p as any).verifyConfirmToken(token, d);
    const digest = "deadbeefdeadbeefdeadbeef";
    const idem = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const token = mint(digest, idem);
    // 审查离线复现:旧实现 m[3]/m[4] 错位使用 → 任何令牌都无法通过自校验(第二段恒抛 S320)
    assert.equal(verify(token, digest), idem, "verify 返回令牌中的 idem 字段(旧实现误返回 MAC 段)");
    assert.throws(() => verify(token, "f00dbaadf00dbaadf00dbaad"), (e: any) => e.code === "S320");
    // 期望值来自 HMAC 结构不变量:对已签发令牌逐字段解析,独立重算 MAC 必须与令牌尾段一致
    const secret = fs.readFileSync(p.confirmSecretFile as string);
    const crypto = require_("node:crypto");
    const parts = token.split(".");
    const expectMac = crypto.createHmac("sha256", secret).update(`${parts[1]}.${parts[2]}.${digest}.${parts[3]}`).digest("hex").slice(0, 32);
    assert.equal(parts[4], expectMac, "令牌尾段 = HMAC(secret, issuedAt.seq.digest.idemKey)");
    assert.equal(parts[3], idem, "第 4 段是 idemKey 本体");
  });

  test("跨实例(模拟跨进程):同 secret 文件互认;不同 secret → S320;消费表跨实例 S322", async () => {
    const shared = tmpDir();
    const mk = () => makeP({ shared: { dir: shared } });
    const other = () => makeP(); // 独立目录(独立 secret)
    const A = mk();
    const B = mk();
    const C = mk();
    const c = await A.p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(await B.p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), undefined, "安装级稳定密钥:A 签发 B 校验通过");
    await assert.rejects(() => C.p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), (e: any) => e.code === "S322", "消费表持久化:第三实例同令牌已消费");
    const D = other();
    await assert.rejects(() => D.p.beginImageSubmissionConfirm(IMG_REQ, c.confirmToken), (e: any) => e.code === "S320" && /与当前请求不符/.test(e.message), "不同密钥文件 → HMAC 真绑定");
  });

  test("🔴 P0-2 模态判别显式化:最小合法 VideoRequest {prompt, model}(零 video 专有字段)必须走视频门", async () => {
    const { p } = makeP();
    const c = await p.beginVideoSubmissionConfirm({ prompt: "minimal", model: "v6" });
    assert.ok(c?.needConfirm, "旧 looksLikeVideoRequest 把该形态误判成 image → undefined(28 flow 测试红根因)");
    assert.equal(c.provider, "pixverse");
    assert.equal(c.model, "v6");
    assert.equal(c.estimatedCost, null, "无 duration → 静态表无法预估(null ≠ 免费,保守仍要求确认)");
    assert.equal(c.costSource, "unknown");
  });

  test("🔴 P0-2:双钩子各自独立;跨模态误调 → 显式 S300(非静默错路由)", async () => {
    const { p } = makeP();
    const img = await p.beginImageSubmissionConfirm({ prompt: "x", model: "qwen-image" });
    assert.ok(img?.needConfirm && img.model === "qwen-image");
    await assert.rejects(() => (p as any).beginVideoSubmissionConfirm({ prompt: "x", model: "qwen-image" }), (e: any) => e.code === "S300" && /未知视频模型/.test(e.message));
    await assert.rejects(() => (p as any).beginImageSubmissionConfirm({ prompt: "x", model: "v6" }), (e: any) => e.code === "S300" && /未知图片模型/.test(e.message));
  });

  test("P2 输入形态门口即拒(不让用户确认一个注定 S301 的请求)", async () => {
    const { p } = makeP();
    await assert.rejects(() => p.beginVideoSubmissionConfirm({ prompt: "x", model: "v6", keyframes: ["https://a.png", "https://b.png"] } as any), /S301/);
    await assert.rejects(() => p.beginVideoSubmissionConfirm({ prompt: "x", model: "v6", images: ["https://a.png"] } as any), /S301/);
  });

  test("并发槽预检:remaining 0 → S403 早失败(零消耗)", async () => {
    const { p } = makeP({
      reply: (args) => {
        if (args[0] === "account" && args[1] === "slots") return { stdout: j({ image: { remaining: 0, limit: 3 }, shared_pool: true }) };
        return defaultReply(args);
      },
    });
    await assert.rejects(() => p.beginImageSubmissionConfirm(IMG_REQ), (e: any) => e.code === "S403" && /并发槽不足/.test(e.message));
  });

  test("pixverse.confirm=false 显式关门:钩子 undefined + 提交走随机幂等键", async () => {
    const { p, t } = makeP({ cfg: { confirm: false } });
    assert.equal(await p.beginImageSubmissionConfirm(IMG_REQ), undefined);
    const r = await p.generateImage(IMG_REQ);
    assert.equal(r.outputs.length, 1);
    const create = t.calls.find((a) => a[0] === "create")!;
    const key = create[create.indexOf("--idempotency-key") + 1];
    assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "门关闭时每次提交随机 UUID 幂等键");
  });

  test("未过门提交 → S323(两段式指引)", async () => {
    const { p } = makeP();
    await assert.rejects(() => p.generateImage(IMG_REQ), (e: any) => e.code === "S323" && /确认门/.test(e.message));
    await assert.rejects(() => p.createVideo(VID_REQ), /S323/);
  });

  test("提交主路径:过门后 create args 携令牌 idem 字段作 --idempotency-key + --no-wait + --audio", async () => {
    const { p, t } = makeP();
    const c = await p.beginVideoSubmissionConfirm(VID_REQ);
    const tokenFields = c.confirmToken.split(".");
    assert.equal(await p.beginVideoSubmissionConfirm(VID_REQ, c.confirmToken), undefined, "第二段校验放行");
    const task = await p.createVideo(VID_REQ);
    assert.equal(task.taskId, "777");
    assert.equal(task.status, "queued");
    const create = t.calls.find((a) => a[0] === "create")!;
    assert.equal(create[1], "video");
    assert.equal(create[create.indexOf("--idempotency-key") + 1], tokenFields[3], "幂等键 = 令牌 idem 字段(P0-1 返回值修复的直接消费面)");
    assert.ok(create.includes("--no-wait"));
    assert.ok(create.includes("--audio"));
    assert.ok(create.includes("--duration"));
    assert.ok(create.includes("--quality"));
  });

  test("image 提交主路径 + 成本观测落账本 → 下次预估命中 ledger(无漂移告警)", async () => {
    const { p, t } = makeP();
    const c1 = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(await p.beginImageSubmissionConfirm(IMG_REQ, c1.confirmToken), undefined, "第二段校验放行");
    const r = await p.generateImage(IMG_REQ);
    assert.equal(r.outputs[0].url, "https://example.com/img.png");
    const create = t.calls.find((a) => a[0] === "create")!;
    assert.equal(create[create.indexOf("--idempotency-key") + 1], c1.confirmToken.split(".")[3]);
    assert.ok(create.includes("--quality"));
    // asset list 观测 cost_credits=5 → 账本落盘
    const ledger = JSON.parse(fs.readFileSync(p.costLedgerFile as string, "utf-8"));
    assert.equal(ledger.entries["image|qwen-image|720p|0|1|1"].credits, 5);
    // 第二次挑战:ledger 命中优先,无漂移告警
    const c2 = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(c2.estimatedCost, 5);
    assert.equal(c2.costSource, "ledger");
    assert.ok(!c2.warnings.some((w: string) => /漂移/.test(w)), "观测值落账本后漂移告警自动消失");
  });

  test("余额预检透出:currentBalance/estimatedBalanceAfter(观测可得时)", async () => {
    const { p } = makeP();
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.equal(c.currentBalance, 500);
    assert.equal(c.estimatedBalanceAfter, 495);
  });

  test("版本漂移 → degraded warning 随挑战透出(绝不静默)", async () => {
    const { p } = makeP({
      reply: (args) => (args[0] === "-V" ? { stdout: "9.9.9\n" } : defaultReply(args)),
    });
    const c = await p.beginImageSubmissionConfirm(IMG_REQ);
    assert.ok(c.warnings.some((w: string) => /9\.9\.9|≠ 锁定|degraded/.test(w)), "实测版本 ≠ 锁定 1.4.3 必带 degraded 告警");
  });
});

// ── 7. registry / index 接线 ──

describe("pixverse registry 接线", () => {
  test("注册在册 + 双模态 requiresOptIn=true(订阅积分误耗红线)+ 双钩子实现", () => {
    const p: any = reg.getProvider("pixverse");
    assert.ok(p, "registry 含 pixverse");
    assert.equal(p.requiresOptIn("image"), true);
    assert.equal(p.requiresOptIn("video"), true);
    assert.equal(typeof p.beginImageSubmissionConfirm, "function");
    assert.equal(typeof p.beginVideoSubmissionConfirm, "function");
    assert.ok(p.listImageModels().includes("qwen-image"));
    assert.ok(p.listVideoModels().includes("v6"));
  });

  test("flow:视频门在册;图像豁免 = 不实现钩子(0 积分模态零影响)", () => {
    const flow: any = reg.getProvider("flow");
    assert.equal(typeof flow.beginVideoSubmissionConfirm, "function");
    assert.equal(flow.beginImageSubmissionConfirm, undefined, "flow 图片 0 点 → 不实现即豁免(P0-2 豁免路径,无形状猜测)");
  });

  test("免费渠道 agnes/zhipu:双钩子均不实现(直提交零影响)", () => {
    for (const name of ["agnes", "zhipu"]) {
      const p: any = reg.getProvider(name);
      assert.equal(p.beginImageSubmissionConfirm, undefined);
      assert.equal(p.beginVideoSubmissionConfirm, undefined);
    }
  });
});
