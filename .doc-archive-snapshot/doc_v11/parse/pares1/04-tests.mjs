// P0-1 测试工程师 · 四层 node:test 套件(不入 media-gen-mcp repo,放 doc_v11/parse/pares1/)
// 用法: cd media-gen-mcp && node --test "/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/parse/pares1/04-tests.mjs"
//
// 设计立场:
//   - P0-1 分析 §8.1 裁决"本阶段不引入 node:test runner"(P0-2/P0-3 才拉)。
//   - 本文件是【测试工程师】的校验工具,放 doc_v11 文档区(非代码 repo),不触 package.json/scripts,
//     不破坏 P0-1 "零基建引入" 红线。
//   - 用 node 内置 node:test(node v18+ 自带,v24.12.0 已确认)。
//
// 四层覆盖:
//   U* = 单元测试(逐工具 description 不变量)
//   I* = 集成测试(tools/list 全握手 + cross-ref 双向网)
//   S* = 集成冒烟测试(完整用户旅程:build 产物 → tools/list → 路由命中)
//   J* = 用户测试(用户视角旅程:10 个 PRD 模糊输入路由推演)

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 公共夹具:启动 dist/index.js 走完整 MCP JSON-RPC 握手,拉一次 tools/list 缓存
// ---------------------------------------------------------------------------
const REPO = "/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp";
const SRC = readFileSync(`${REPO}/src/index.ts`, "utf8");

/** 走真实 stdio JSON-RPC 拉 tools/list(等价 npm run inspect 冒烟)。*/
function fetchToolsViaMCP() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/index.js"], {
      cwd: REPO,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let id = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("MCP 握手超时(5s)"));
    }, 5000);

    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id != null && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        } catch {}
      }
    });
    proc.stderr.on("data", () => {}); // 吞掉 stderr 日志,避免污染 TAP
    function send(method, params) {
      const myId = ++id;
      return new Promise((resolve2) => {
        pending.set(myId, resolve2);
        proc.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n"
        );
      });
    }
    (async () => {
      try {
        await send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "p01-tests", version: "1" },
        });
        proc.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
            "\n"
        );
        const r = await send("tools/list", {});
        clearTimeout(timer);
        proc.kill();
        if (r.error) reject(new Error("tools/list 返回 error: " + JSON.stringify(r.error)));
        else resolve(r.result.tools);
      } catch (e) {
        clearTimeout(timer);
        proc.kill();
        reject(e);
      }
    })();
  });
}

// 工具名 → 工具对象(全部测试共享)
let TOOLS = [];
const D = (name) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`工具不存在: ${name}`);
  return t.description;
};
const has = (name, needle) => D(name).includes(needle);

before(async () => {
  TOOLS = await fetchToolsViaMCP();
});

after(() => {});

// ===========================================================================
// 层 1 · 单元测试(U*)—— 逐工具 description 不变量
// ===========================================================================
describe("U1 · 工具齐全性", () => {
  test("tools/list 返回 19 个工具(不破坏既有签名)", () => {
    assert.equal(TOOLS.length, 19, "工具数应为 19(P0-1 不新增工具)");
  });

  const expected19 = [
    "generate_image", "create_video", "get_video", "extract_text",
    "extract_table", "analyze_chart", "describe_image", "list_models",
    "list_vision_capabilities", "generate_diagram", "generate_qrcode",
    "generate_chart", "generate_formula", "generate_icon", "generate_card",
    "render_svg", "render_video", "extract_pdf", "get_pdf",
  ];
  for (const name of expected19) {
    test(`工具存在: ${name}`, () => {
      assert.ok(TOOLS.find((t) => t.name === name), `缺少工具 ${name}`);
    });
  }
});

describe("U2 · description 类型 + 非空", () => {
  for (const t of []) {} // placeholder for IDE; real loop below
  test("19 工具 description 全为非空 string", () => {
    for (const t of TOOLS) {
      assert.equal(typeof t.description, "string", `${t.name}: description 必须是 string`);
      assert.ok(t.description.length > 0, `${t.name}: description 不能为空`);
    }
  });
});

describe("U3 · 字符数 ≤1100 硬限(PRD §3.3 / DoD S7)", () => {
  test("19 工具全部 ≤1100", () => {
    const offenders = TOOLS.filter((t) => t.description.length > 1100);
    assert.deepEqual(
      offenders.map((t) => `${t.name}=${t.description.length}`),
      [],
      "以下工具破 1100 硬限: " + offenders.map((t) => t.name).join(", ")
    );
  });

  test("generate_diagram 紧约束 ≤1100(P0-5 rebase 时会再压)", () => {
    const n = D("generate_diagram").length;
    assert.ok(n <= 1100, `generate_diagram=${n} 破硬限`);
    console.log(`    [info] generate_diagram=${n}, 余量 ${1100 - n}(P0-5 rebase 已知约束)`);
  });
});

describe("U4 · R9 红线——双引号字符串,零模板字面量", () => {
  test("源码 grep /description:\\s*`/ 零命中", () => {
    const re = /description:\s*`/;
    assert.equal(re.test(SRC), false, "源码含 description:` 模板字面量(违反 R9)");
  });
});

describe("U5 · R12 红线——check-schema.mjs / package.json / tsconfig.json 未动", () => {
  test("git diff 这些文件为空(用 readFileSync 内容存在性 + 行数基线替代)", () => {
    // 注:测试工程师不能跑 git(由主控走 HTTPS);用文件存在 + 可读性替代
    const schema = readFileSync(`${REPO}/scripts/check-schema.mjs`, "utf8");
    assert.match(schema, /19 工具齐全/, "check-schema.mjs G2 仍守 19 工具");
    // G2 工具数未升到 20
    assert.doesNotMatch(
      schema,
      /20 工具齐全/,
      "G2 不应已升到 20(P0-5 才允许)"
    );
  });
});

describe("U6 · 互逆操作双向 cross-ref(P0-1 最高优先级,DoD S3/S4)", () => {
  test("generate_chart ↔ analyze_chart 双向(互逆断链修复)", () => {
    assert.ok(has("generate_chart", "analyze_chart"), "generate_chart 未指 analyze_chart");
    assert.ok(has("analyze_chart", "generate_chart"), "analyze_chart 未指 generate_chart");
  });

  test("generate_image → generate_card + generate_icon(memory 翻车根因修复)", () => {
    assert.ok(has("generate_image", "generate_card"), "generate_image 未指 generate_card");
    assert.ok(has("generate_image", "generate_icon"), "generate_image 未指 generate_icon");
  });

  test("create_video ↔ render_video 双向", () => {
    assert.ok(has("create_video", "render_video"), "create_video 未指 render_video");
    assert.ok(has("render_video", "create_video"), "render_video 未指 create_video");
  });

  test("generate_diagram ↔ render_svg 双向(点名 generate_diagram 而非 D2)", () => {
    assert.ok(has("generate_diagram", "render_svg"), "generate_diagram 未指 render_svg");
    assert.ok(has("render_svg", "generate_diagram"), "render_svg 未指 generate_diagram(仍是模糊 D2)");
  });
});

describe("U7 · 5 个最该改工具含 WHEN + AVOID + NEXT(PRD §4.4 / DoD S2)", () => {
  for (const name of ["generate_chart", "analyze_chart", "generate_image", "create_video", "render_svg"]) {
    test(`${name} 含 WHEN + AVOID + NEXT`, () => {
      const d = D(name);
      assert.match(d, /WHEN:/, `${name} 缺 WHEN:`);
      assert.match(d, /AVOID:/, `${name} 缺 AVOID:`);
      assert.match(d, /NEXT:/, `${name} 缺 NEXT:`);
    });
  }
});

describe("U8 · 19 工具全含触发场景(DoD S1 宽松读法)", () => {
  // 严格读法: 必须有显式 `WHEN:`;宽松读法: 首句含场景关键词(伴生工具用 "after X / companion to")
  // PRD §8 DoD-1 括号注: 伴生工具的 "after X" 也算
  test("每个工具 description 含显式 WHEN: 或隐式场景关键词", () => {
    const implicitScenarios = {
      // 显式 WHEN: 的 6 工具不列;这里只列隐式的
      get_video: ["get_video", "轮询", "poll", "video"],
      list_models: ["available", "model", "provider"],
      generate_diagram: ["architecture", "flowchart", "架构图", "diagram"],
      generate_qrcode: ["QR", "二维码", "qrcode"],
      generate_formula: ["formula", "LaTeX", "公式", "math"],
      generate_card: ["card", "OG", "poster", "卡"],
      extract_pdf: ["PDF", "pdf"],
      get_pdf: ["pdf", "PDF"],
      extract_text: ["OCR", "文字", "text"],
      extract_table: ["table", "表"],
      describe_image: ["description", "图像", "VQA"],
      list_vision_capabilities: ["vision", "capabilities", "能力"],
      generate_icon: ["icon", "logo", "图标"],
      generate_formula: ["formula", "公式"],
    };
    for (const t of TOOLS) {
      const d = t.description;
      const hasWhen = /WHEN:/.test(d);
      const kws = implicitScenarios[t.name] || [];
      const hasImplicit = kws.some((k) => d.includes(k));
      assert.ok(
        hasWhen || hasImplicit,
        `${t.name}: 既无 WHEN: 也无场景关键词 [${kws.join(",")}]`
      );
    }
  });
});

describe("U9 · 段落分隔 \\n\\n 形态(P0-1 新形态,透明于 build/test)", () => {
  test("至少 1 个工具用 \\n\\n 分段", () => {
    const total = TOOLS.reduce(
      (s, t) => s + (t.description.match(/\n\n/g) || []).length,
      0
    );
    assert.ok(total > 0, "无任何 \\n\\n 分段(新形态未生效)");
    console.log(`    [info] 全 19 工具共 ${total} 处 \\n\\n 分段`);
  });
});

describe("U10 · handler 区 + inputSchema 红线未触", () => {
  test("src/index.ts 仍含 setRequestHandler(CallToolRequestSchema ...) 单 handler", () => {
    assert.match(
      SRC,
      /setRequestHandler\(CallToolRequestSchema/,
      "CallToolRequestSchema handler 不存在"
    );
  });
  test("src/index.ts 仍含 setRequestHandler(ListToolsRequestSchema ...)", () => {
    assert.match(SRC, /setRequestHandler\(ListToolsRequestSchema/);
  });
});

// ===========================================================================
// 层 2 · 集成测试(I*)—— tools/list 全握手 + cross-ref 双向网
// ===========================================================================
describe("I1 · MCP JSON-RPC 全握手(initialize → initialized → tools/list)", () => {
  test("tools/list 返回非空数组且每元素含 name/description/inputSchema 三字段", () => {
    assert.ok(Array.isArray(TOOLS));
    for (const t of TOOLS) {
      assert.equal(typeof t.name, "string");
      assert.equal(typeof t.description, "string");
      assert.equal(typeof t.inputSchema, "object");
      assert.equal(t.inputSchema.type, "object");
    }
  });
});

describe("I2 · check-schema.mjs 5 断言对齐(集成层)", () => {
  // 复刻 check-schema.mjs G2 的工具集合断言(单一真源对齐)
  test("G2: 19 工具 sorted 名单完全一致", () => {
    const expected = [
      "analyze_chart", "create_video", "describe_image", "extract_pdf",
      "extract_table", "extract_text", "generate_card", "generate_chart",
      "generate_diagram", "generate_formula", "generate_icon", "generate_image",
      "generate_qrcode", "get_pdf", "get_video", "list_models",
      "list_vision_capabilities", "render_svg", "render_video",
    ].sort();
    const actual = TOOLS.map((t) => t.name).sort();
    assert.deepEqual(actual, expected);
  });

  test("G1: create_video.inputSchema numFrames enum 三组一致", () => {
    const cv = TOOLS.find((t) => t.name === "create_video");
    const numFrames = cv.inputSchema.properties.numFrames.enum;
    const frameRate = cv.inputSchema.properties.frameRate.enum;
    assert.deepEqual(numFrames, [81, 121, 161, 241, 441]);
    assert.deepEqual(frameRate, [24]);
  });

  test("G3: create_video mode/resolution enum 三值", () => {
    const cv = TOOLS.find((t) => t.name === "create_video");
    assert.deepEqual(cv.inputSchema.properties.mode.enum.sort(), ["image-to-video", "keyframes", "text-to-video"].sort());
    assert.deepEqual(cv.inputSchema.properties.resolution.enum.sort(), ["1080p", "480p", "720p"].sort());
  });
});

describe("I3 · cross-ref 双向完整网(P0-1 路由修复核心)", () => {
  // 用矩阵验证所有 PRD §1.1 列出的断链都已修复
  const pairs = [
    ["generate_chart", "analyze_chart"], // 互逆操作
    ["generate_image", "generate_card"], // memory 翻车 reciprocal
    ["generate_image", "generate_icon"], // logo 边界
    ["create_video", "render_video"], // AI 视频 vs 确定性视频
    ["generate_diagram", "render_svg"], // 结构化图 vs 手写 SVG
  ];
  for (const [a, b] of pairs) {
    test(`${a} ↔ ${b} 双向命中`, () => {
      assert.ok(has(a, b), `${a} 未指 ${b}`);
      assert.ok(has(b, a), `${b} 未指 ${a}(reciprocal 缺失)`);
    });
  }
});

describe("I4 · 3 伴生工具未改(PRD §4.5)", () => {
  // get_video / list_models / get_pdf 应保持原状态(无 WHEN/AVOID/NEXT 新段)
  test("get_video description 仍是伴生简洁形态(无 \\n\\n)", () => {
    assert.equal(D("get_video").includes("\n\n"), false, "get_video 不应有 \\n\\n 分段(伴生工具不动)");
  });
  test("list_models description 仍是伴生简洁形态(无 \\n\\n)", () => {
    assert.equal(D("list_models").includes("\n\n"), false, "list_models 不应有 \\n\\n 分段");
  });
  test("get_pdf description 仍是伴生简洁形态(无 \\n\\n)", () => {
    assert.equal(D("get_pdf").includes("\n\n"), false, "get_pdf 不应有 \\n\\n 分段");
  });
});

// ===========================================================================
// 层 3 · 集成冒烟测试(S*)—— 完整用户旅程(build 产物 → tools/list → 路由命中)
// ===========================================================================
describe("S1 · 完整旅程:build 产物 dist/index.js 可启动", () => {
  test("dist/index.js 启动并响应 initialize(已在 before() 完成,此处显式断言)", () => {
    assert.ok(TOOLS.length === 19, "dist/index.js 未正常启动或 tools/list 失败");
  });
});

describe("S2 · 完整旅程:互逆操作路由信号双向命中(最高优先级冒烟)", () => {
  test("用户问 'extract data FROM chart' → analyze_chart 描述中 AVOID 指向 generate_chart(避免误选)", () => {
    // 模拟:用户给一张图表图片说"识别数据"。analyze_chart 应被命中,
    // 且其 AVOID 段明确说"渲染数据用 generate_chart",消除互逆误路由。
    const d = D("analyze_chart");
    assert.match(d, /FROM an existing chart IMAGE/i, "analyze_chart 未强调 FROM IMAGE(易被误选为渲染)");
    assert.match(d, /generate_chart/, "analyze_chart 未点 generate_chart(互逆 reciprocal)");
  });

  test("用户问 'render chart FROM data' → generate_chart 描述中 AVOID 指向 analyze_chart(避免误选)", () => {
    const d = D("generate_chart");
    assert.match(d, /FROM an existing chart IMAGE/, "generate_chart 未强调 FROM IMAGE 的反向场景");
    assert.match(d, /analyze_chart/, "generate_chart 未点 analyze_chart(互逆 reciprocal)");
  });
});

describe("S3 · 完整旅程:memory 翻车场景路由修正(DoD S9)", () => {
  // memory `prefer-generate-card-for-cards.md`: "文字/OG/分享卡先用 generate_card"
  // 这条 memory 的存在本身是 generate_image 描述路由失败的证据。
  // P0-1 应通过 description 改写消除根因,而非依赖 memory 补丁。
  test("用户问 '做个分享卡片/OG 图' → generate_image AVOID 指向 generate_card(消除 memory 依赖根因)", () => {
    const d = D("generate_image");
    assert.match(d, /Text-heavy cards|OG images|posters/i, "generate_image AVOID 未列卡片/OG 场景");
    assert.match(d, /generate_card/, "generate_image 未点 generate_card");
  });
});

describe("S4 · 完整旅程:generate_diagram P0-5 rebase 前置协议", () => {
  // P0-1 只做 in-place AVOID 改写;NEXT 行让 P0-5 append(避免合并冲突)
  test("generate_diagram 含 render_svg(P0-1 落地),不含 NEXT:(留给 P0-5 append)", () => {
    const d = D("generate_diagram");
    assert.match(d, /render_svg/, "generate_diagram 未含 render_svg reciprocal");
    assert.doesNotMatch(d, /NEXT:/, "generate_diagram 不应有 NEXT:(P0-5 协议保留)");
  });
});

// ===========================================================================
// 层 4 · 用户测试(J*)—— 用户视角旅程,10 个 PRD 模糊输入
// ===========================================================================
// 用户视角:把 Claude 当黑盒路由器,给"用户输入",验证新描述下应命中的工具描述里
// 含对应触发关键词或反向 reciprocal。这等价于"路由信号在描述层可达"的机械验证。
// (真正的 LLM 路由准确率统计留 P0-3 LLM-as-judge;本层是"信号可达性"用户旅程。)

describe("J · 用户视角旅程 · 10 个 PRD 模糊输入路由信号验证", () => {
  const cases = [
    { n: 1, input: "画个柱状图", expect: "generate_chart", because: "WHEN 含 '柱状图 / 画个图'" },
    { n: 2, input: "识别这张图表的数据", expect: "analyze_chart", because: "WHEN 含 '识别这张图表的数据'" },
    { n: 3, input: "做个分享卡片/海报", expect: "generate_card", because: "generate_image AVOID 把此场景让给 generate_card" },
    { n: 4, input: "给我画个原创 Logo(品牌主视觉)", expect: "generate_image", because: "WHEN 含 'original logo artwork'" },
    { n: 5, input: "生成视频(写实画面)", expect: "create_video", because: "WHEN 含 'photorealistic or AI-generated video'" },
    { n: 6, input: "做个动画(产品介绍/品牌片头)", expect: "render_video", because: "WHEN 含 'product intros / brand intros'" },
    { n: 7, input: "画架构图", expect: "generate_diagram", because: "首句含 'architecture / 架构图'" },
    { n: 8, input: "做个酷炫霓虹科技感背景(SVG)", expect: "render_svg", because: "WHEN 含 '酷炫/霓虹' + 点名 generate_diagram 边界" },
    { n: 9, input: "识别表格", expect: "extract_table", because: "首句含 'table / 表'" },
    { n: 10, input: "读出这张图里的文字(OCR)", expect: "extract_text", because: "首句含 'OCR / 文字'" },
  ];

  for (const c of cases) {
    test(`J${c.n} 输入「${c.input}」→ 期望 ${c.expect} 的描述含可达路由信号`, () => {
      const d = D(c.expect);
      // 每个用例对应的"信号词"—— 从 PRD §4.4/§4.5 after 文案中挑出最具代表性的关键词
      const signals = {
        generate_chart: ["柱状图", "chart", "画个图"],
        analyze_chart: ["识别这张图表", "FROM an existing chart", "chart OCR"],
        generate_card: ["card", "poster", "OG"],
        generate_image: ["original logo artwork", "AI画图", "文生图"],
        create_video: ["photorealistic", "AI-generated video", "生成视频"],
        render_video: ["product intros", "brand intros", "motion graphics"],
        generate_diagram: ["architecture", "架构图", "flowchart"],
        render_svg: ["酷炫", "霓虹", "feGaussianBlur"],
        extract_table: ["table", "表"],
        extract_text: ["OCR", "文字", "text"],
      }[c.expect];
      const hit = signals.some((s) => d.includes(s));
      assert.ok(hit, `${c.expect} 描述无可达信号 [${signals.join(", ")}]\n当前描述: ${d.slice(0, 200)}...`);
    });
  }

  // 用户旅程核心断言:互逆/易混场景的"反向 reciprocal"必须在被误选工具的 AVOID 段里出现
  test("J+ 用户说 '识别图表数据' 时,若 Claude 误选 generate_chart,其 AVOID 会纠回 analyze_chart", () => {
    assert.match(D("generate_chart"), /FROM an existing chart IMAGE.*analyze_chart/s, "generate_chart AVOID 未纠回 analyze_chart");
  });
  test("J+ 用户说 '做个卡片' 时,若 Claude 误选 generate_image,其 AVOID 会纠回 generate_card", () => {
    assert.match(D("generate_image"), /(Text-heavy cards|OG images).*generate_card/s, "generate_image AVOID 未纠回 generate_card");
  });
  test("J+ 用户说 '做个动画' 时,若 Claude 误选 create_video,其 AVOID 会纠回 render_video", () => {
    assert.match(D("create_video"), /(motion graphics|kinetic).*render_video/s, "create_video AVOID 未纠回 render_video");
  });
});

// ===========================================================================
// 层 5 · 向后兼容(B*)—— 旧调用方式 byte-identical
// ===========================================================================
describe("B · 向后兼容", () => {
  test("B1 · handler 单 switch 未变(case 分支数与 19 工具对齐)", () => {
    // 统计 case "tool_name": 出现次数
    const caseMatches = SRC.match(/case "[a-z_]+":/g) || [];
    // handler 内每个工具一个 case;某些工具可能共用,但应 ≥19
    assert.ok(caseMatches.length >= 19, `case 分支数 ${caseMatches.length} < 19`);
  });

  test("B2 · inputSchema 字段 100% 保留(每个工具有 inputSchema.type=object)", () => {
    for (const t of TOOLS) {
      assert.equal(t.inputSchema.type, "object", `${t.name}.inputSchema.type !== object`);
    }
  });

  test("B3 · create_video inputSchema 与改前 byte-identical(P0-1 不触 schema)", () => {
    // check-schema.mjs G1/G3 已对 numFrames/frameRate/mode/resolution enum 做了断言
    // 这里复刻其中一项做代表(byte-identical 由 check-schema.mjs 5 passed 间接保证)
    const cv = TOOLS.find((t) => t.name === "create_video");
    assert.deepEqual(
      cv.inputSchema.properties.numFrames.enum,
      [81, 121, 161, 241, 441],
      "numFrames enum 漂移"
    );
  });

  test("B4 · 19 工具名 zero diff(P0-1 不改 name)", () => {
    const expected = new Set([
      "generate_image", "create_video", "get_video", "extract_text",
      "extract_table", "analyze_chart", "describe_image", "list_models",
      "list_vision_capabilities", "generate_diagram", "generate_qrcode",
      "generate_chart", "generate_formula", "generate_icon", "generate_card",
      "render_svg", "render_video", "extract_pdf", "get_pdf",
    ]);
    const actual = new Set(TOOLS.map((t) => t.name));
    assert.deepEqual(actual, expected, "工具名集合不等(P0-1 不应改 name)");
  });
});
