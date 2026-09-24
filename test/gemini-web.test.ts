/**
 * Gemini 网页渠道单元测试(白盒;零网络零 CDP 零生成 —— 全程 GeminiTransport stub,
 * 绝不 attach 真实 Chrome/消耗订阅配额;配额红线)。对齐 flow/pixverse 的 StubTransport 先例。
 *
 * 覆盖面:
 *   1. 模型目录/能力矩阵/requiresOptIn(链即开关准入);
 *   2. UI 驱动序列 happy path(image/video):表达式序列断言(open→navigate→login→menu→item→badge→focus→insert→send→poll→fetch);
 *   3. 错误码全路径:S100/S101(菜单钮/菜单项)/S102 未登录/S103 eval 异常/S300 模型/S301 视频 i2v/S400 页面报错(含配额上限文案)/S410 轮询超时;
 *   4. getVideo 会话生命周期:happy 消费/二次取 failed/未知 handle/S410 转in_progress;
 *   5. warnings 纪律:不消费参数逐一告警(n>1/size/aspect/seed/images)、配额警示文案、自愈 note 前缀;
 *   6. registry 接线:注册名/priority 链合法。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 测试隔离:gemini 不在出厂白名单,须显式启用后才可解析(2026-09-24 白名单模型)——
// 在 require registry 之前写独立 fixture,绝不读真用户 config(此前依赖真配置=隔离缺陷)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-web-"));
fs.writeFileSync(path.join(tmpDir, "config.json"), JSON.stringify({
  defaultImageProvider: "agnes",
  enabledProviders: ["agnes", "zhipu", "gemini"],
  providers: { agnes: { apiKey: "k" } },
}, null, 2));
process.env.MEDIA_GEN_MCP_CONFIG = path.join(tmpDir, "config.json");

const require = createRequire(import.meta.url);
const {
  GeminiWebProvider,
  GeminiError,
  CdpGeminiTransport,
  GEMINI_IMAGE_MODELS,
  GEMINI_VIDEO_MODELS,
  DEFAULT_GEMINI_CDP_PORT,
} = require("../dist/providers/gemini-web.js");
const { getProvider, listProviders, getProviderPriority, __priorityOverrideForTests } = require("../dist/providers/registry.js");

// ── Stub 传输(脚本化响应;按表达式特征路由) ──

interface Scripted { match: RegExp; ret: unknown }

class StubTransport {
  notes: string[] = [];
  evalCalls: string[] = [];
  typed: string[] = [];
  navigated: string | null = null;
  opened = false;
  script: Scripted[] = [];

  async open() { this.opened = true; return { pageUrl: "https://gemini.google.com/app" }; }
  async navigate(url: string) { this.navigated = url; }
  async insertText(text: string) { this.typed.push(text); }
  async eval(expr: string) {
    this.evalCalls.push(expr);
    for (const s of this.script) if (s.match.test(expr)) return s.ret;
    throw new Error(`stub 未覆盖表达式: ${expr.slice(0, 90)}`);
  }
}

/** 生成器侧匹配键(与 gemini-web.ts 表达式特征一一对应)。 */
const M = {
  login: /Google 账号/,
  menuBtn: /上传和工具/,
  modeItem: /制作图片|制作视频/,
  badge: /badge/,
  focus: /rich-textarea/,
  send: /发送/,
  pollImage: /imgActions/, // EXPR_POLL_IMAGE 独有标志(canvas 表达式也含 naturalWidth,防误计)
  pollVideo: /querySelector\('video'\)/,
  fetch: /await fetch\(/,
  canvas: /createElement\('canvas'\)/,
};

function happyScript(kind: "image" | "video", extra: Partial<Record<keyof typeof M, unknown>> = {}): Scripted[] {
  const b64 = Buffer.from("fake-media-bytes").toString("base64");
  // extra 条目前置(stub 首个匹配赢)——override 必须压过默认 happy 响应
  const overrides: Scripted[] = Object.entries(extra).map(([k, v]) => ({ match: (M as any)[k], ret: v }));
  return [
    ...overrides,
    { match: M.login, ret: { logged: true, account: "Google 账号: Dong Wang (x@gmail.com)", url: "https://gemini.google.com/app" } },
    { match: M.menuBtn, ret: { ok: true } },
    { match: M.modeItem, ret: { ok: true, matched: kind === "image" ? "制作图片" : "制作视频" } },
    { match: M.badge, ret: { badge: kind === "image" ? "使用 Nano Banana 2 生成" : "使用 Omni 生成" } },
    { match: M.focus, ret: { ok: true } },
    { match: M.send, ret: { ok: true } },
    { match: M.canvas, ret: { b64, contentType: "image/jpeg", w: 1024, h: 1024, bytes: 16 } },
    { match: M.fetch, ret: { b64, contentType: "video/mp4", bytes: 16 } },
    { match: kind === "image" ? M.pollImage : M.pollVideo, ret: kind === "image"
      ? { count: 1, src: "blob:https://gemini.google.com/uuid", ready: true, err: null }
      : { src: "https://contribution.usercontent.google.com/download?c=xyz", ready: true, err: null, dur: 8 },
    },
  ];
}

function makeProvider(script: Scripted[] = [], notes: string[] = []) {
  const stub = new StubTransport();
  stub.script = script;
  stub.notes = notes;
  const p = new GeminiWebProvider({ transport: stub as any });
  p.navSettleMs = 1; p.menuSettleMs = 1; p.modeSettleMs = 1; p.typeSettleMs = 1; p.pollIntervalMs = 1;
  p.imagePollDeadlineMs = 300; p.videoPollDeadlineMs = 300;
  return { p, stub };
}

const exprCount = (stub: StubTransport, re: RegExp) => stub.evalCalls.filter((e) => re.test(e)).length;

// ── 1. 目录/能力/准入 ──

describe("gemini 模型目录与能力矩阵", () => {
  test("listImageModels/listVideoModels 与常量一致(F4 单一真源)", () => {
    const { p } = makeProvider();
    assert.deepEqual(p.listImageModels(), GEMINI_IMAGE_MODELS);
    assert.deepEqual(p.listVideoModels(), GEMINI_VIDEO_MODELS);
    assert.deepEqual([...p.listImageModels(), ...p.listVideoModels()], p.listModels());
  });

  test("capabilities:t2i/t2v true,i2i/keyframes false(MVP 边界如实)", () => {
    const { p } = makeProvider();
    const cap = p.capabilities();
    assert.equal(cap.image.textToImage, true);
    assert.equal(cap.image.imageToImage, false);
    assert.equal(cap.video.textToVideo, true);
    assert.equal(cap.video.imageToVideo, false);
    assert.equal(cap.video.keyframes, false);
  });

  test("requiresOptIn 两模态 true(订阅配额+隐私边界;链即开关准入)", () => {
    const { p } = makeProvider();
    assert.equal(p.requiresOptIn("image"), true);
    assert.equal(p.requiresOptIn("video"), true);
  });

  test("默认 CDP 端口 9225(与 flow 9223 独立;lasso browse 硬编码教训)", () => {
    assert.equal(DEFAULT_GEMINI_CDP_PORT, 9225);
  });

  test("videoConstraints 单档 192 帧@24fps(UI 固定档如实)", () => {
    const { p } = makeProvider();
    const vc = p.videoConstraints();
    assert.deepEqual(vc.allowedNumFrames, [192]);
    assert.equal(vc.defaultNumFrames, 192);
    assert.equal(vc.defaultFrameRate, 24);
  });
});

// ── 2. UI 驱动序列 happy path ──

describe("gemini UI 驱动序列", () => {
  test("generateImage happy:表达式序列完整 + b64 产物", async () => {
    const { p, stub } = makeProvider(happyScript("image"));
    const r = await p.generateImage({ prompt: "a red circle", model: "nano-banana-2" } as any);
    assert.match(String(r.outputs[0].url), /^data:image\/jpeg;base64,/);
    assert.equal((r as any).raw.engine.includes("Nano Banana 2"), true);
    // 序列断言:login→menu→item→badge→focus→send→poll→fetch 各恰一次
    assert.equal(exprCount(stub, M.login), 1);
    assert.equal(exprCount(stub, M.menuBtn), 1);
    assert.equal(exprCount(stub, M.modeItem), 1);
    assert.equal(exprCount(stub, M.pollImage), 1);
    assert.equal(exprCount(stub, M.canvas), 1, "图像产物经 canvas 抓取(fetch(blob) 不可用)");
    assert.equal(exprCount(stub, M.fetch), 0, "图像不再走 fetch");
    assert.equal(stub.navigated, "https://gemini.google.com/app"); // 每次生成开干净对话
    assert.deepEqual(stub.typed, ["a red circle"]); // 可信输入管道
  });

  test("createVideo happy:伪 handle + submitted + 配额警示文案", async () => {
    const { p, stub } = makeProvider(happyScript("video"));
    const task = await p.createVideo({ prompt: "a cat walking" } as any);
    assert.equal(task.status, "submitted");
    assert.ok(String(task.taskId).startsWith("gemini-"));
    assert.ok(task.warnings!.some((w) => w.includes("配额警示") && w.includes("5 小时")));
    assert.equal(exprCount(stub, M.pollVideo), 0, "提交即返回,不轮询");
  });

  test("getVideo happy:轮询直链 → data:URI;会话消费后二次取 failed", async () => {
    const { p, stub } = makeProvider(happyScript("video"));
    const task = await p.createVideo({ prompt: "v" } as any);
    const r = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r.status, "completed");
    assert.ok(String(r.url).startsWith("data:video/mp4;base64,"));
    assert.equal(exprCount(stub, M.pollVideo), 1);
    assert.equal(exprCount(stub, M.fetch), 1);
    const r2 = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r2.status, "failed");
    assert.match(String(r2.error), /不存在/);
  });

  test("getVideo 未知 handle:failed 而非抛错(poll 路径不抛)", async () => {
    const { p } = makeProvider(happyScript("video"));
    const r = await p.getVideo({ taskId: "gemini-nope" } as any);
    assert.equal(r.status, "failed");
  });
});

// ── 3. 错误码全路径 ──

describe("gemini 错误码路径", () => {
  test("S102 未登录(precondition;login hint 带 visible 指引)", async () => {
    const { p } = makeProvider(happyScript("image", { login: { logged: false, account: null } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S102");
      assert.equal(e.precondition, true);
      assert.match(e.message, /mode visible|完成 Google 登录/);
      return true;
    });
  });

  test("S101 菜单按钮缺失:附可见标签诊断", async () => {
    const { p } = makeProvider(happyScript("image", { menuBtn: { ok: false, stage: "menu-btn", visibleLabels: ["主菜单", "设置"] } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S101");
      assert.match(e.message, /主菜单/);
      return true;
    });
  });

  test("S101 菜单项缺失:附菜单文本(UI 改版诊断)", async () => {
    const { p } = makeProvider(happyScript("image", { modeItem: { ok: false, stage: "menu-item", menuText: "文件 云端硬盘" } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S101");
      assert.match(e.message, /文件 云端硬盘/);
      return true;
    });
  });

  test("S103 页面执行异常(__err 透传)", async () => {
    const { p } = makeProvider(happyScript("image", { menuBtn: { __err: "document is not defined" } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S103");
      assert.match(e.message, /document is not defined/);
      return true;
    });
  });

  test("S300 未知模型(图像/视频各一)", async () => {
    const { p: pi } = makeProvider();
    await assert.rejects(pi.generateImage({ prompt: "x", model: "gpt-image" } as any), (e: any) => e.code === "S300");
    const { p: pv } = makeProvider();
    await assert.rejects(pv.createVideo({ prompt: "x", model: "abra" } as any), (e: any) => e.code === "S300");
  });

  test("S301 视频 i2v/keyframes 不支持(显式拒,不静默丢)", async () => {
    const { p } = makeProvider();
    await assert.rejects(p.createVideo({ prompt: "x", image: "https://a/b.png" } as any), (e: any) => {
      assert.equal(e.code, "S301");
      assert.match(e.message, /文生视频/);
      return true;
    });
  });

  test("S400 页面报错立即失败(配额上限文案附 5h 窗口指引)", async () => {
    const { p } = makeProvider(happyScript("image", { pollImage: { count: 0, src: null, ready: false, err: "达到每日上限" } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S400");
      assert.match(e.message, /达到每日上限/);
      assert.match(e.message, /5h 滚动|5 小时/);
      return true;
    });
  });

  test("S410 轮询超时(图像);getVideo S410 转 in_progress 会话保留", async () => {
    const { p: pi } = makeProvider(happyScript("image", { pollImage: { count: 0, src: null, ready: false, err: null } }));
    pi.imagePollDeadlineMs = 50; pi.pollIntervalMs = 10;
    await assert.rejects(pi.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S410");
      assert.match(e.message, /轮询超时/);
      return true;
    });
    // video 路径:S410 → in_progress(可再 getVideo)
    const { p: pv } = makeProvider(happyScript("video", { pollVideo: { src: "", ready: false, err: null } }));
    pv.videoPollDeadlineMs = 50; pv.pollIntervalMs = 10;
    const task = await pv.createVideo({ prompt: "v" } as any);
    const r = await pv.getVideo({ taskId: task.taskId } as any);
    assert.equal(r.status, "in_progress");
  });

  test("S200 产物下载失败(canvas __err 透传,瞬态 status=0)", async () => {
    const { p } = makeProvider(happyScript("image", { canvas: { __err: "tainted canvas" } }));
    await assert.rejects(p.generateImage({ prompt: "x" } as any), (e: any) => {
      assert.equal(e.code, "S200");
      assert.equal(e.geminiStatus, 0);
      return true;
    });
  });
});

// ── 4. warnings 纪律 ──

describe("gemini warnings 纪律(不消费参数必告警)", () => {
  test("图像:n>1/size/aspect/seed/images 逐一告警", async () => {
    const { p } = makeProvider(happyScript("image"));
    const r = await p.generateImage({ prompt: "x", n: 3, size: "1024x1024", aspect: "16:9", seed: 42, images: ["https://a/b.png"] } as any);
    const w = r.warnings!.join("\n");
    assert.match(w, /n=3/);
    assert.match(w, /size/);
    assert.match(w, /aspect/);
    assert.match(w, /seed/);
    assert.match(w, /图生图/);
  });

  test("视频:ratio/seed/negativePrompt 告警忽略;配额警示常在", async () => {
    const { p } = makeProvider(happyScript("video"));
    const t = await p.createVideo({ prompt: "x", ratio: "16:9", seed: 1, negativePrompt: "blur" } as any);
    const w = t.warnings!.join("\n");
    assert.match(w, /ratio/);
    assert.match(w, /seed/);
    assert.match(w, /negativePrompt/);
    assert.match(w, /配额警示/);
  });

  test("自愈 note drain:前缀 [自愈] 进 warnings", async () => {
    const { p } = makeProvider(happyScript("image"), ["模式徽章未确认"]);
    const r = await p.generateImage({ prompt: "x" } as any);
    assert.ok(r.warnings!.some((x) => x.startsWith("[自愈]") && x.includes("模式徽章")));
  });
});

// ── 5. registry 接线 ──

describe("gemini registry 接线", () => {
  test("已注册:provider 名/清单可见;priority 链可含 gemini", () => {
    assert.ok(listProviders().includes("gemini"));
    const p: any = getProvider("gemini");
    assert.equal(p.name, "gemini");
    assert.equal(typeof p.generateImage, "function");
    assert.equal(typeof p.createVideo, "function");
    assert.equal(p.requiresOptIn("image"), true);
    // 0.22.0:链已废弃 —— 配置对 gemini 同样无效(恒 undefined,缺省走免费池)
    __priorityOverrideForTests.image = ["gemini", "agnes"];
    assert.equal(getProviderPriority("image"), undefined);
    __priorityOverrideForTests.image = null;
  });

  test("CdpGeminiTransport 可构造(端口参数化;不真连)", () => {
    const t = new CdpGeminiTransport(9333);
    assert.ok(t);
    assert.equal(typeof t.open, "function");
  });

  test("GeminiError 前缀/字段机读性", () => {
    const e = new GeminiError("S100", "msg", { precondition: true, geminiStatus: 0, hint: "h" });
    assert.match(e.message, /^\[gemini\] S100 msg/);
    assert.equal(e.code, "S100");
    assert.equal(e.precondition, true);
    assert.equal(e.geminiStatus, 0);
    assert.equal((e as any).status, 0);
  });
});

// ── 6. 传输层白盒(fake CDP;P1-C 审查补齐) ──

import http from "node:http";
import { WebSocketServer } from "ws";

interface FakeGeminiCdp {
  port: number;
  state: {
    listCalls: number; newTabUrls: string[]; navigated: string[];
    geminiAppeared: boolean; startWithGemini: boolean;
    newTabFails: boolean; noWsOnAttach: boolean; evalPlan: string[];
    insertTexts: string[];
  };
  close(): Promise<void>;
}

function startFakeGeminiCdp(): Promise<FakeGeminiCdp> {
  const state: FakeGeminiCdp["state"] = {
    listCalls: 0, newTabUrls: [], navigated: [], geminiAppeared: false, startWithGemini: false,
    newTabFails: false, noWsOnAttach: false, evalPlan: ["ok"], insertTexts: [],
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
        if (m.method === "Input.insertText") {
          state.insertTexts.push(m.params.text);
          ws.send(JSON.stringify({ id: m.id, result: {} }));
          return;
        }
        if (m.method === "Runtime.evaluate") {
          const behavior = state.evalPlan.length > 1 ? state.evalPlan.shift()! : state.evalPlan[0];
          if (behavior === "drop") return; // 不响应 → CdpConnection 超时
          if (behavior === "exception") {
            ws.send(JSON.stringify({ id: m.id, result: { exceptionDetails: { text: "page blew up", exception: { description: "TypeError: page blew up" } } } }));
            return;
          }
          ws.send(JSON.stringify({ id: m.id, result: { result: { value: { ok: true } } } }));
          return;
        }
        ws.send(JSON.stringify({ id: m.id, result: {} }));
      });
    });
    const server = http.createServer((req: any, res: any) => {
      const u = new URL(req.url!, "http://127.0.0.1");
      if (u.pathname === "/json/list") {
        state.listCalls++;
        const has = state.startWithGemini || state.geminiAppeared;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(has
          ? [{ type: "page", url: state.noWsOnAttach ? "https://gemini.google.com/app" : "https://gemini.google.com/app/abc", ...(state.noWsOnAttach ? {} : { webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/GEM` }) }]
          : [{ type: "page", url: "chrome://newtab/", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/OTHER` }]));
        return;
      }
      if (u.pathname === "/json/new" && req.method === "PUT") {
        state.newTabUrls.push(decodeURIComponent(u.search.slice(1)));
        res.setHeader("content-type", "application/json");
        if (state.newTabFails) { res.statusCode = 500; res.end("{}"); return; }
        state.geminiAppeared = true;
        res.end(JSON.stringify({ type: "page", url: "about:blank", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/devtools/page/NEWTAB` }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as any).port, state,
        close: async () => {
          for (const c of (wss as any).clients ?? []) { try { c.terminate(); } catch { /* ignore */ } }
          await new Promise<void>((r) => wss.close(() => r()));
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

describe("gemini CdpGeminiTransport 传输层(fake CDP;P1-C 补齐)", () => {
  test("open 成功:定位 gemini page + eval + insertText 通", async () => {
    const cdp = await startFakeGeminiCdp();
    try {
      cdp.state.startWithGemini = true;
      const t = new CdpGeminiTransport(cdp.port);
      const { pageUrl } = await t.open();
      assert.match(pageUrl, /gemini\.google\.com\/app/);
      const v = await t.eval("1+1");
      assert.deepEqual(v, { ok: true });
      await t.insertText("hello");
      assert.deepEqual(cdp.state.insertTexts, ["hello"]); // 可信输入管道走 Input.insertText
      t.dispose();
    } finally { await cdp.close(); }
  });

  test("open S100:CDP 不可连(死端口,precondition)", async () => {
    const t = new CdpGeminiTransport(1); // 1 端口基本必拒
    await assert.rejects(t.open(), (e: any) => e.code === "S100" && e.precondition === true);
  });

  test("open S101:无 gemini page + 自动开页失败(附已尝试文案)", async () => {
    const cdp = await startFakeGeminiCdp();
    try {
      cdp.state.newTabFails = true;
      const t = new CdpGeminiTransport(cdp.port);
      t.healNewTabSettleMs = 10;
      await assert.rejects(t.open(), (e: any) => {
        assert.equal(e.code, "S101");
        assert.match(e.message, /已尝试自动开页未果/);
        assert.match(e.message, /launch-chrome|gemini\.google\.com/);
        return true;
      });
    } finally { await cdp.close(); }
  });

  test("open 自愈:/json/new + Page.navigate 后复探成功(带 warning)", async () => {
    const cdp = await startFakeGeminiCdp();
    try {
      const t = new CdpGeminiTransport(cdp.port);
      t.healNewTabSettleMs = 10;
      const { pageUrl } = await t.open();
      assert.match(pageUrl, /gemini\.google\.com/);
      assert.equal(cdp.state.newTabUrls.length, 1);
      assert.ok(cdp.state.newTabUrls[0].includes("gemini.google.com/app"));
      assert.equal(cdp.state.navigated.length, 1, "/json/new 不落地导航,须主动 Page.navigate");
      assert.ok((t.notes as string[]).some((n) => n.includes("自愈")), "自愈必须带 warning 留痕");
    } finally { await cdp.close(); }
  });

  test("eval 页面异常 → S103 且连接复位(下次 eval 重连)", async () => {
    const cdp = await startFakeGeminiCdp();
    try {
      cdp.state.startWithGemini = true;
      const t = new CdpGeminiTransport(cdp.port);
      await t.open();
      cdp.state.evalPlan = ["exception", "ok"];
      await assert.rejects(t.eval("boom"), (e: any) => {
        assert.equal(e.code, "S103");
        assert.match(e.message, /page blew up/);
        return true;
      });
      // 复位后重新 open 幂等成功,eval 恢复
      await t.open();
      const v = await t.eval("again");
      assert.deepEqual(v, { ok: true });
    } finally { await cdp.close(); }
  });

  test("attach 无 webSocketDebuggerUrl → S103(页面可能正在关闭)", async () => {
    const cdp = await startFakeGeminiCdp();
    try {
      cdp.state.startWithGemini = true;
      cdp.state.noWsOnAttach = true;
      const t = new CdpGeminiTransport(cdp.port);
      await assert.rejects(t.open(), (e: any) => e.code === "S103" && /webSocketDebuggerUrl/.test(e.message));
    } finally { await cdp.close(); }
  });
});

// ── 7. R5 审查修复回归(P1-B/D/E) ──

describe("gemini 审查修复回归(P1-B/D/E)", () => {
  test("P1-D:S400 视频终态 failed 且会话删除(不再 in_progress 空转)", async () => {
    const { p } = makeProvider(happyScript("video", { pollVideo: { src: "", ready: false, err: "达到每日上限" } }));
    const task = await p.createVideo({ prompt: "v" } as any);
    const r = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r.status, "failed");
    assert.match(String(r.error), /达到每日上限/);
    // 会话已删:同 handle 再取 → 不存在(终态,不再挂 in_progress)
    const r2 = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r2.status, "failed");
    assert.match(String(r2.error), /不存在/);
  });

  test("P1-E:交错守卫 —— 未取件会话存续期拒绝新提交(S303);取件后放行", async () => {
    const { p } = makeProvider(happyScript("video"));
    const task = await p.createVideo({ prompt: "first" } as any);
    // 未取件:新视频提交被拒(防 ensureFreshChat 导航走其产物页)
    await assert.rejects(p.createVideo({ prompt: "second" } as any), (e: any) => {
      assert.equal(e.code, "S303");
      assert.match(e.message, /get_video/);
      return true;
    });
    // 图像提交同样被拒(单页 UI,一样会摧毁产物页)
    await assert.rejects(p.generateImage({ prompt: "img" } as any), (e: any) => e.code === "S303");
    // 取件后放行
    const r = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r.status, "completed");
    const t2 = await p.createVideo({ prompt: "second" } as any);
    assert.equal(t2.status, "submitted");
  });

  test("P1-B:numFrames/frameRate/mode 异值告警(丢弃必告警铁律)", async () => {
    const { p } = makeProvider(happyScript("video"));
    const t = await p.createVideo({ prompt: "x", numFrames: 121, frameRate: 30, mode: "image-to-video" } as any);
    const w = t.warnings!.join("\n");
    assert.match(w, /numFrames=121.*已忽略/);
    assert.match(w, /frameRate=30.*已忽略/);
    assert.match(w, /mode=image-to-video.*已忽略/);
    // 同值不告警(噪声纪律)
    const { p: p2 } = makeProvider(happyScript("video"));
    const t2 = await p2.createVideo({ prompt: "x", numFrames: 192, frameRate: 24 } as any);
    assert.ok(!t2.warnings!.some((x) => x.includes("numFrames=192")), "同值不该告警");
  });

  test("P2-3:getVideo 入口 open(WS 复位后自愈)——stub open 被调用", async () => {
    const { p, stub } = makeProvider(happyScript("video"));
    const task = await p.createVideo({ prompt: "v" } as any);
    stub.opened = false; // 模拟复位
    const r = await p.getVideo({ taskId: task.taskId } as any);
    assert.equal(r.status, "completed");
    assert.equal(stub.opened, true, "getVideo 须先 open 重连");
  });
});

// ── 8. channelInfo 守护(0.23.0 渠道工厂飞轮:说明卡三处一致的真源) ──

describe("channelInfo 渠道说明卡(五存量渠道全量在位)", () => {
  const { getProvider, listProviders } = require("../dist/providers/registry.js");
  test("五生成渠道全部实现且字段完整(costCatalog 被误删两次的同款守护)", () => {
    const { buildListModelsDetail } = require("../dist/providers/registry.js");
    for (const n of ["agnes", "zhipu", "gemini", "pixverse", "flow"]) {
      // 统一经 detail 拿(flow 缺省不在白名单,getProvider 会拦;未启用条目也附 channelInfo —— 说明卡对死域渠道同样有价值)
      const ci = (buildListModelsDetail(n)[n] as any).channelInfo;
      assert.ok(ci, `${n} 须实现 channelInfo`);
      assert.ok(["live", "blocked-on-login", "disabled"].includes(ci.status), `${n} status 合法`);
      for (const k of ["cost", "freeQuota", "watermark"]) assert.ok(typeof ci[k] === "string" && ci[k], `${n}.${k} 非空`);
      for (const k of ["capabilities", "limits", "prerequisites", "risks"]) assert.ok(ci[k] != null, `${n}.${k} 在位`);
      for (const cap of ["t2i", "i2i", "t2v", "i2v", "keyframes"]) assert.equal(typeof ci.capabilities[cap], "boolean", `${n}.capabilities.${cap} 显式 boolean`);
    }
  });
  test("registry buildListModelsDetail 透出 channelInfo", () => {
    const { buildListModelsDetail } = require("../dist/providers/registry.js");
    const d = buildListModelsDetail("gemini");
    assert.equal(d.gemini.channelInfo.status, "live");
    assert.equal(d.gemini.channelInfo.capabilities.keyframes, false, "gemini 首尾帧=false 如实");
  });
  test("flow 说明卡 status=disabled(死域如实呈现;经 detail 禁用条目)", () => {
    const { buildListModelsDetail } = require("../dist/providers/registry.js");
    const entry: any = buildListModelsDetail("flow").flow;
    assert.equal(entry.disabled, true);
    assert.equal(entry.channelInfo.status, "disabled");
    assert.ok(entry.channelInfo.risks.some((r: string) => r.includes("死域") || r.includes("死亡")));
  });
});
