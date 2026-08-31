/**
 * flow 自愈与跨进程确认令牌白盒测试(2026-08-31,产线日志#15/#13/#14/#4/#7/#9 六项修复的验收面)。
 * 全程零网络零积分:
 *   - Provider 级用 StubTransport(同 flow-confirm.test.ts 范式;reload/notes 为本批新增可选通道)
 *   - Transport 级用本地 fake CDP(http /json/list + /json/new + WebSocket Page.navigate/Runtime.evaluate)
 *
 * 断言面:
 *   A. 确认令牌跨进程(日志#15,S320 真缺陷):
 *      1. 两 Provider 实例(模拟两进程,同 secret 文件)A 签发 → B 校验通过
 *      2. 顺序重放跨实例阻断:A 消费后 B/C 同 token 拒绝(并发首消费存在毫秒级理论 TOCTOU 窗口,
 *         单用户本地工具可接受 —— 威胁模型评估见 flow.ts consumedConfirmTokens 字段注释)
 *      3. 不同 secret 文件(不同 HOME)→ 跨实例校验 S320 不符(HMAC 真绑定文件)
 *      4. secret 文件 0600/32B;consumed 文件 {version,tokens} 形状 + 0600;TTL 过期条目读时惰性清理
 *      5. 写盘并集:他进程后落盘的消费条目不被本进程写盘抹掉(丢失更新防线,B 白盒)
 *      6. S320/S321 hint 增补跨进程说明(旧版绑定进程/本版安装级已支持跨进程)
 *   B. 401 自愈(日志#13/#14):tRPC 401 且 ensureReady 曾通过 → 自动 reload 一次 + 重试(带 warning);
 *      仍 401 → S201 hint 指向「刷新页面即恢复,无需重登」;session 端点(next-auth)不自愈(原语义)
 *   C. 无 labs target 自动开页(日志#4):PUT /json/new + 主动 Page.navigate → 复探一次;仍无 → 原 S101
 *   D. S103 evaluate 瞬态超时退避一次(日志#7/#9):仅这一类自愈;仍超时 → 原错误
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const require_ = createRequire(import.meta.url);
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const { FlowProvider, FlowError, CdpFlowTransport } = require_(path.join(distDir, "providers/flow.js"));

// ═══ A. 确认令牌跨进程(StubTransport,同 flow-confirm.test.ts 范式) ═══

class StubTransport {
  calls: Array<{ url: string; method: string }> = [];
  notes: string[] = [];
  healReloadSettleMs = 10;
  reloadCount = 0;
  /** 失败序列注入(自愈测试):sessionNetFailBefore 前 N 次 pageFetch(session) 抛 S200;openS100FailOnce / rcFailOnce / downloadBytesSeq */
  sessionNetFailBefore = 0;
  sessionCalls = 0;
  openS100FailOnce = false;
  rcFailOnce = false;
  downloadBytesSeq: Buffer[] = [];
  /** projectInitialData 的脚本化状态序列(耗尽后沿用末位);默认 200。 */
  pidStatus: number[] = [];
  constructor(private readonly opts: any = {}) {}
  async open() {
    if (this.openS100FailOnce) {
      this.openS100FailOnce = false;
      throw new FlowError("S100", "CDP 127.0.0.1:9223 不可连(stub 模拟)");
    }
    if (this.opts.openError) throw this.opts.openError;
    return { pageUrl: "https://labs.google/fx/zh/tools/flow/project/test-project" };
  }
  async reload() {
    this.reloadCount++;
    if (this.opts.reloadEffect) this.opts.reloadEffect();
  }
  async pageFetch(args: any) {
    this.calls.push(args);
    if (args.url.includes("/fx/api/auth/session")) {
      this.sessionCalls++;
      if (this.sessionCalls <= this.sessionNetFailBefore) {
        throw new FlowError("S200", "页面 fetch 异常: Failed to fetch (stub 模拟 #21)");
      }
      if (this.opts.sessionStatus) return this.json({}, this.opts.sessionStatus);
      return this.json({ user: { email: "tester@example.com" }, access_token: "ya29.stub" });
    }
    if (args.url.includes("credits?key=")) {
      return this.json({ credits: 868, serviceTier: "SERVICE_TIER_INTERMEDIATE" });
    }
    if (args.url.includes("media.getMediaUrlRedirect")) {
      const buf = this.downloadBytesSeq.length > 1 ? this.downloadBytesSeq.shift()! : this.downloadBytesSeq[0] ?? Buffer.from("x");
      return { ok: true, status: 200, contentType: "video/mp4", bodyB64: buf.toString("base64") };
    }
    if (args.url.includes("flow.projectInitialData")) {
      const status = this.pidStatus.length > 1 ? this.pidStatus.shift() : this.pidStatus[0] ?? 200;
      return this.json({ result: { data: { json: { projectContents: { media: [] }, modelConfig: { videoModelFamilies: [] } } } } }, status);
    }
    if (args.method === "POST" && args.url.includes("/video:")) {
      return this.json({ remainingCredits: 856, media: [{ name: "media-new-1" }] });
    }
    return this.json({}, 404);
  }
  async recaptchaToken() {
    if (this.rcFailOnce) {
      this.rcFailOnce = false;
      throw new FlowError("S104", "reCAPTCHA token 获取失败(stub 模拟)");
    }
    return "stub-rc";
  }
  json(obj: any, status = 200) {
    return { ok: status < 400, status, contentType: "application/json", bodyB64: Buffer.from(JSON.stringify(obj)).toString("base64") };
  }
}

/** 模拟一个独立进程:每个实例 = 独立 FlowProvider + 独立 StubTransport,共享(或独占)secret 文件。 */
function newProcess(dir: string, opts: any = {}) {
  const t = new StubTransport(opts);
  const p = new FlowProvider({ transport: t as any, projectId: "proj-test" });
  p.confirmSecretFile = path.join(dir, "flow-confirm-secret");
  p.confirmConsumedFile = path.join(dir, "flow-confirm-consumed.json");
  return { t, p };
}

describe("确认令牌跨进程(日志#15:安装级稳定密钥 + 消费表持久化)", () => {
  test("两实例(模拟两进程,同 secret 文件):A 签发 → B 校验通过(旧版此处必 S320)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-ok-"));
    const A = newProcess(dir);
    const B = newProcess(dir);
    const challenge = await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    assert.ok(challenge?.confirmToken, "A(进程一)第一段签发令牌");
    // B 是全新实例(新内存 Map、重读 secret 文件)—— 等价于第二个 node 进程
    const pass = await B.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, challenge.confirmToken);
    assert.equal(pass, undefined, "B(进程二)应能校验 A 签发的令牌(跨进程安装级密钥)");
    // secret 文件形状:32B、0600
    const st = fs.statSync(path.join(dir, "flow-confirm-secret"));
    assert.equal(st.size, 32, "secret 文件 32 字节");
    assert.equal(st.mode & 0o777, 0o600, "secret 文件权限 0600");
  });

  test("顺序重放跨实例阻断:A 消费后 B 同 token → S320 已使用(并发首消费毫秒级窗口为已知接受残留)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-consume-"));
    const A = newProcess(dir);
    const B = newProcess(dir);
    const c = await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    // A 消费(第二段)
    assert.equal(await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken), undefined);
    // 消费表已落盘且形状正确;权限 0600(文件含 TTL 内仍有效的一次性令牌,防同机他用户可读)
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "flow-confirm-consumed.json"), "utf-8"));
    assert.equal(raw.version, 1);
    assert.ok(raw.tokens && typeof raw.tokens[c!.confirmToken] === "number", "消费表记录该 token 的过期时刻");
    assert.equal(fs.statSync(path.join(dir, "flow-confirm-consumed.json")).mode & 0o777, 0o600, "consumed 文件权限 0600");
    // B(另一进程)重放同 token → 必须拒绝
    await assert.rejects(
      B.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken),
      (e: any) => e.code === "S320" && /已使用/.test(e.message),
      "顺序跨进程重放必须被拒(并发首消费的理论窗口见 flow.ts 字段注释,非本用例断言面)",
    );
    // 第三实例 C(消费后新起)同样拒绝 —— 读时合并磁盘消费表
    const C = newProcess(dir);
    await assert.rejects(
      C.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken),
      (e: any) => e.code === "S320" && /已使用/.test(e.message),
    );
  });

  test("写盘并集:B 写盘不抹掉 A 后落盘的消费条目(跨进程丢失更新防线,B 白盒)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-union-"));
    const consumedFile = path.join(dir, "flow-confirm-consumed.json");
    const A = newProcess(dir);
    const B = newProcess(dir);
    const cA = await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    const cB = await B.p.beginSubmissionConfirm({ prompt: "y", model: "abra_t2v_10s" });
    // 时序模拟丢失更新窗口:B 先 sync(此刻盘上还是空)→ A 消费并落盘 T_A → B 才写自己的 T_B。
    // 旧代码(只写本进程内存)会把 T_A 抹掉,T_A 在 TTL 内变回可重放;新代码写内存 ∪ 盘上未过期的并集。
    const pB = B.p as any;
    pB.syncConsumedFromDisk(); // 盘上无文件 → B 内存表仍空(此刻未见到 T_A)
    assert.equal(await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, cA!.confirmToken), undefined);
    pB.consumedConfirmTokens.set(cB!.confirmToken, Date.now() + 60_000);
    pB.persistConsumedTokens();
    const raw = JSON.parse(fs.readFileSync(consumedFile, "utf-8"));
    assert.ok(typeof raw.tokens[cA!.confirmToken] === "number", "A 的消费条目在 B 写盘后仍存在(并集写盘,未被抹掉)");
    assert.ok(typeof raw.tokens[cB!.confirmToken] === "number", "B 自己的消费条目已写入");
    // 新进程读到的是并集 → T_A 仍不可重放(丢失更新若发生,这里会放行)
    const C = newProcess(dir);
    await assert.rejects(
      C.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, cA!.confirmToken),
      (e: any) => e.code === "S320" && /已使用/.test(e.message),
    );
  });

  test("不同 secret 文件(不同 HOME)→ 跨实例校验 S320 不符(HMAC 真绑定密钥文件)", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-b-"));
    const A = newProcess(dirA);
    const B = newProcess(dirB);
    const c = await A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await assert.rejects(
      B.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken),
      (e: any) => e.code === "S320" && /与当前请求不符/.test(e.message) && !/已使用/.test(e.message),
      "密钥不同源 → 签名不匹配(而非消费拒绝)",
    );
  });

  test("TTL 过期的消费条目读时惰性清理(消费表不无限膨胀)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-ttl-"));
    // 预置一个已过期的消费条目
    const consumedFile = path.join(dir, "flow-confirm-consumed.json");
    fs.writeFileSync(consumedFile, JSON.stringify({ version: 1, tokens: { "fvc1.stale.0.aaaa": 1 } }));
    const A = newProcess(dir, {});
    const p = A.p as any;
    p.confirmTtlMs = () => 60_000;
    p.syncConsumedFromDisk();
    assert.equal(p.consumedConfirmTokens.size, 0, "过期条目(exp=1)读时被清理");
  });

  test("S320/S321 hint 增补跨进程说明(指向进程边界/安装级令牌)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-hint-"));
    const A = newProcess(dir);
    await assert.rejects(
      A.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, "bogus-token"),
      (e: any) => e.code === "S320" && /跨进程/.test(e.message) && /安装级/.test(e.message),
      "格式非法 hint 应含跨进程说明",
    );
    const B = newProcess(fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-hint2-")));
    const c = await B.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_10s" });
    await assert.rejects(
      B.p.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c!.confirmToken),
      (e: any) => e.code === "S320" && /跨进程/.test(e.message),
      "参数变化 S320 hint 应含跨进程说明",
    );
    const short = new FlowProvider({ transport: new StubTransport() as any, projectId: "proj-test", flowCfg: { confirmTtlMs: 60 } });
    const dirS = fs.mkdtempSync(path.join(os.tmpdir(), "flow-xproc-s321-"));
    short.confirmSecretFile = path.join(dirS, "s");
    short.confirmConsumedFile = path.join(dirS, "c.json");
    const c2 = await short.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" });
    await new Promise((r) => setTimeout(r, 80));
    await assert.rejects(
      short.beginSubmissionConfirm({ prompt: "x", model: "abra_t2v_8s" }, c2!.confirmToken),
      (e: any) => e.code === "S321" && /跨进程/.test(e.message),
      "S321 过期 hint 应含跨进程说明",
    );
  });
});

// ═══ B. 401 自愈(日志#13/#14:access_token ~1h 陈旧,reload 即恢复) ═══

describe("S201 401 自愈(reload 一次 + 重试一次,带 warning)", () => {
  test("projectInitialData 401 → 自动 reload + 重试成功;warning 上浮结果 warnings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-401-heal-"));
    let reloaded = false;
    const { p, t } = newProcess(dir, { reloadEffect: () => { reloaded = true; } });
    // 第一次 projectInitialData 401,reload 后 200
    t.pidStatus = [401, 200];
    const snap = await p.flowStatus();
    assert.equal((snap as any).ok, true, "自愈后快照成功");
    assert.equal(t.reloadCount, 1, "reload 恰好一次");
    assert.ok(reloaded, "reload 副作用生效(等价页面刷新)");
    const pidCalls = t.calls.filter((c) => c.url.includes("flow.projectInitialData")).length;
    assert.equal(pidCalls, 2, "projectInitialData 重试恰好一次(共 2 次)");
    const warnings = (snap as any).warnings as string[] | undefined;
    assert.ok(warnings?.some((w) => /access_token 陈旧/.test(w) && /自动刷新/.test(w)), `结果 warnings 应含自愈 note:${JSON.stringify(warnings)}`);
  });

  test("持续 401 → S201,hint 指向「刷新/重开 Flow 页即恢复(无需重新登录)」", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-401-stubborn-"));
    const { p, t } = newProcess(dir);
    t.pidStatus = [401, 401];
    await assert.rejects(
      p.flowStatus(),
      (e: any) => e.code === "S201" && e.message.includes("仍 401") && /无需重新登录/.test(e.message),
      "重试仍 401 → 结构化 S201 + 会话过期 hint",
    );
    assert.equal(t.reloadCount, 1, "只重试一次(不无限 reload)");
  });

  test("session 端点(next-auth,非 tRPC/aisandbox)401 → 不自愈,原 S201 语义", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-401-session-"));
    const { p, t } = newProcess(dir, { sessionStatus: 401 });
    await assert.rejects(
      p.flowStatus(),
      (e: any) => e.code === "S201" && /session 查询 HTTP 401/.test(e.message),
      "session 端点 401 保持原错误(自愈边界 = tRPC/aisandbox)",
    );
    assert.equal(t.reloadCount, 0, "session 401 不触发 reload");
  });
});

// ═══ C/D. Transport 级自愈(fake CDP:本地 http + WebSocket) ═══

interface FakeCdp {
  port: number;
  wsPort: number;
  state: {
    listCalls: number;
    newTabUrls: string[];
    navigated: string[];
    newTabFails: boolean;
    labsAppeared: boolean;
    startWithLabs: boolean;
    /** Runtime.evaluate 行为脚本(耗尽沿用末位):"drop" = 不响应(制造超时)/ "ok" = 正常 __flowFetch。 */
    evaluatePlan: Array<"drop" | "ok">;
  };
  close(): Promise<void>;
}

function startFakeCdp(): Promise<FakeCdp> {
  const state: FakeCdp["state"] = {
    listCalls: 0, newTabUrls: [], navigated: [], newTabFails: false, labsAppeared: false, startWithLabs: false,
    evaluatePlan: ["ok"],
  };
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    const wsPort = (wss.address() as any).port;
    wss.on("connection", (ws: any) => {
      ws.on("message", (raw: any) => {
        const m = JSON.parse(raw.toString());
        if (m.method === "Page.navigate") {
          state.navigated.push(m.params.url);
          ws.send(JSON.stringify({ id: m.id, result: { frameId: "f1", loaderId: "l1" } }));
          return;
        }
        if (m.method === "Runtime.evaluate") {
          const behavior = state.evaluatePlan.length > 1 ? state.evaluatePlan.shift()! : state.evaluatePlan[0];
          if (behavior === "drop") return; // 不响应 → CdpConnection 超时(evalTimeout)
          const payload = { __flowFetch: { ok: true, status: 200, contentType: "application/json", bodyB64: Buffer.from(JSON.stringify({ fine: true })).toString("base64") } };
          ws.send(JSON.stringify({ id: m.id, result: { result: { value: payload } } }));
          return;
        }
        ws.send(JSON.stringify({ id: m.id, result: {} }));
      });
    });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url!, "http://127.0.0.1");
      if (u.pathname === "/json/list") {
        state.listCalls++;
        const hasLabs = state.startWithLabs || state.labsAppeared;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(hasLabs
          ? [{ type: "page", url: "https://labs.google/fx/zh/tools/flow/project/fake-1", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/LABS` }]
          : [{ type: "page", url: "chrome://newtab/", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/OTHER` }]));
        return;
      }
      if (u.pathname === "/json/new" && req.method === "PUT") {
        // 真实 Chrome 契约:PUT /json/new?<bare-url>(URL 直接作 query,无参数名)
        state.newTabUrls.push(decodeURIComponent(u.search.slice(1)));
        res.setHeader("content-type", "application/json");
        if (state.newTabFails) { res.statusCode = 500; res.end("{}"); return; }
        state.labsAppeared = true; // 自愈成功路径:开页后复探能见到 labs 页(失败路径不置位)
        res.end(JSON.stringify({ type: "page", url: "about:blank", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/NEWTAB` }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({
        port, wsPort, state,
        close: async () => {
          for (const c of (wss as any).clients ?? []) { try { c.terminate(); } catch { /* ignore */ } }
          await new Promise<void>((r) => wss.close(() => r()));
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

describe("S101 无 labs target 自动开页(日志#4;fake CDP)", () => {
  let cdp: FakeCdp;
  before(async () => { cdp = await startFakeCdp(); });
  after(async () => { await cdp.close(); });

  function newTransport() {
    const t = new CdpFlowTransport(cdp.port);
    t.healNewTabSettleMs = 30; // 测试注入缝:不等 8s
    return t;
  }

  test("无 labs target → PUT /json/new + 主动 Page.navigate → 复探成功,带 warning note", async () => {
    const t = newTransport();
    const opened = await t.open({ newTabUrl: "https://labs.google/fx/tools/flow/project/proj-xyz" });
    assert.equal(opened.pageUrl.includes("labs.google"), true, "开页自愈后定位到 labs 页");
    assert.equal(cdp.state.listCalls, 2, "复探恰好一次(共 2 次 /json/list)");
    assert.deepEqual(cdp.state.newTabUrls, ["https://labs.google/fx/tools/flow/project/proj-xyz"], "PUT /json/new 带目标项目页 URL");
    assert.deepEqual(cdp.state.navigated, ["https://labs.google/fx/tools/flow/project/proj-xyz"], "新 tab 被主动导航(/json/new 的 url 参数本机不落地)");
    assert.ok(t.notes.some((n: string) => /自动开新标签页/.test(n)), `自愈 note 应入 transport.notes:${t.notes}`);
  });

  test("自愈失败(/json/new 500)→ 复探仍无 labs → 原 S101(hint 不变)", async () => {
    cdp.state.newTabFails = true;
    cdp.state.labsAppeared = false;
    cdp.state.startWithLabs = false;
    cdp.state.listCalls = 0;
    const t = newTransport();
    await assert.rejects(
      t.open({ newTabUrl: "https://labs.google/fx/tools/flow" }),
      (e: any) => e.code === "S101" && /在 Chrome 打开 https:\/\/labs\.google\/fx\/tools\/flow/.test(e.message) && e.precondition === true,
      "自愈未果 → 原错误与 hint 均不变",
    );
    cdp.state.newTabFails = false;
  });

  test("provider 侧:flowTabUrl 读 projectFile 的 projectUrl/projectId 注入 newTabUrl", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-taburl-"));
    const p = new FlowProvider({ transport: new StubTransport() as any });
    p.projectFile = path.join(dir, "flow-project.json");
    // 仅有 projectId(旧格式文件)→ 推导项目页 URL
    fs.writeFileSync(p.projectFile, JSON.stringify({ provider: "flow", projectId: "p-111" }));
    assert.equal((p as any).flowTabUrl(), "https://labs.google/fx/tools/flow/project/p-111");
    // 显式 projectUrl 优先
    fs.writeFileSync(p.projectFile, JSON.stringify({ provider: "flow", projectId: "p-111", projectUrl: "https://labs.google/fx/zh/tools/flow/project/p-222" }));
    assert.equal((p as any).flowTabUrl(), "https://labs.google/fx/zh/tools/flow/project/p-222");
    // 无文件 → 缺省
    fs.unlinkSync(p.projectFile);
    assert.equal((p as any).flowTabUrl(), "https://labs.google/fx/tools/flow");
  });
});

describe("S103 evaluate 瞬态超时自动退避一次(日志#7/#9;fake CDP WS)", () => {
  let cdp: FakeCdp;
  before(async () => { cdp = await startFakeCdp(); cdp.state.startWithLabs = true; });
  after(async () => { await cdp.close(); });

  test("首 evaluate 无响应(超时)→ 退避重试一次成功,warning note 留痕", async () => {
    const t = new CdpFlowTransport(cdp.port);
    t.healEvalBackoffMs = 30;
    await t.open(); // pageFetch 前置:定位 labs page target(本组 startWithLabs=true)
    cdp.state.evaluatePlan = ["drop", "ok"]; // 第一次不响应,第二次正常
    const resp = await t.pageFetch({ url: "https://labs.google/fx/api/trpc/x", method: "GET", headers: {} }, 300);
    assert.equal(resp.status, 200, "退避重试后取到响应");
    assert.ok(t.notes.some((n: string) => /CDP 瞬态超时已自动退避/.test(n)), `note:${t.notes}`);
  });

  test("两次都超时 → 原错误([flow] S103,仍限一次自愈)", async () => {
    const t = new CdpFlowTransport(cdp.port);
    t.healEvalBackoffMs = 20;
    await t.open();
    cdp.state.evaluatePlan = ["drop", "drop"];
    await assert.rejects(
      t.pageFetch({ url: "https://labs.google/fx/api/trpc/x", method: "GET", headers: {} }, 200),
      (e: any) => e.code === "S103" && /超时/.test(e.message),
      "重试仍超时 → 原错误上抛",
    );
  });
});


describe("网络/环境瞬态自愈四件(日志#21 系统性审计:可自愈不报人工)", () => {
  function newP(opts: any = {}) {
    const t = new StubTransport(opts);
    const p = new FlowProvider({ transport: t as any, projectId: "proj-test" });
    p.healNetBackoffMs = 5; p.healCdpBackoffMs = 5; p.healRcBackoffMs = 5; // F1:缝在 provider(字段宿主),勿接到 transport stub
    return { t, p };
  }

  test("① session 网络失败×1(Chrome 刚重启/代理握手窗口)→ 退避重试即愈(不再要人工)", async () => {
    const { t, p } = newP();
    t.sessionNetFailBefore = 1;
    const r = await p.ensureReady();
    assert.ok(r.email, "重试后就绪");
    assert.ok(t.notes.some((n: string) => n.includes("退避") && n.includes("Flow 页面网络未就绪")), "自愈 note");
  });

  test("② session 网络失败×2 → 自动 reload Flow 页(=人工刷新自动化)后即愈", async () => {
    const { t, p } = newP();
    t.sessionNetFailBefore = 2;
    const r = await p.ensureReady();
    assert.ok(r.email);
    assert.ok(t.reloadCount >= 1, "自动 reload 过页面");
    assert.ok(t.notes.some((n: string) => n.includes("自动 reload Flow 页面")), "reload note");
  });

  test("③ session 网络失败持续 → 抛错带场景化 hint(Chrome 刚重启/代理可达性),非通用文案", async () => {
    const { t, p } = newP();
    t.sessionNetFailBefore = 99;
    await assert.rejects(
      () => p.ensureReady(),
      (e: any) => e.code === "S200" && e.message.includes("已自动退避+刷新页面重试仍失败") && /Chrome 刚重启|代理/.test(e.message),
    );
  });

  test("④ S100 CDP 瞬态不可连(Chrome 正在启动)→ 退避重探一次即愈", async () => {
    const { t, p } = newP();
    t.openS100FailOnce = true;
    const r = await p.ensureReady();
    assert.ok(r.email);
    assert.ok(t.notes.some((n: string) => n.includes("CDP 瞬态不可连")), "重探 note");
  });

  test("⑤ S104 reCAPTCHA 瞬态失败 → 自动重取一次(提交前零副作用)", async () => {
    const { t, p } = newP();
    t.rcFailOnce = true;
    const tok = await (p as any).recaptchaTokenAuto("site", "IMAGE_GENERATION");
    assert.equal(tok, "stub-rc", "重取成功");
    assert.ok(t.notes.some((n: string) => n.includes("reCAPTCHA token 获取瞬态失败")), "重取 note");
  });

  test("⑥ S402 下载截断 → 自动重下一次即愈;两次都截断才抛'下载不完整(两次)'", async () => {
    const mkMedia = () => ({
      result: { data: { json: {
        projectContents: {
          media: [{
            name: "m-trunc",
            mediaMetadata: { mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL" }, mediaBlobSize: "100" },
            video: { generatedVideo: { model: "abra_t2v_8s", seed: 1 } },
          }],
          modelConfig: { videoModelFamilies: [] },
        },
      } } },
    });
    // 一次截断 → 重下即愈
    const a = newP();
    a.t.downloadBytesSeq = [Buffer.alloc(50, 7), Buffer.alloc(100, 7)];
    const fa = a.t.pageFetch.bind(a.t);
    (a.t as any).pageFetch = async (args: any) => (args.url.includes("flow.projectInitialData") ? (a.t as any).json(mkMedia()) : fa(args));
    const st = await a.p.getVideo({ taskId: "m-trunc" });
    assert.equal(st.status, "completed", "重下后成功");
    assert.ok(((st as any).warnings ?? []).some((n: string) => n.includes("自动重新下载一次")), "重下 note 必须上浮结果 warnings");
    // 两次都截断 → 抛
    const b = newP();
    b.t.downloadBytesSeq = [Buffer.alloc(50, 7), Buffer.alloc(60, 7)];
    const fb = b.t.pageFetch.bind(b.t);
    (b.t as any).pageFetch = async (args: any) => (args.url.includes("flow.projectInitialData") ? (b.t as any).json(mkMedia()) : fb(args));
    await assert.rejects(() => b.p.getVideo({ taskId: "m-trunc" }), (e: any) => e.code === "S402" && e.message.includes("两次"));
  });
});
