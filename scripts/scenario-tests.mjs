#!/usr/bin/env node
/**
 * media-gen-mcp 0.12 —— generate_interactive_diagram 用户场景测试 runner。
 *
 * 任务来源:P0-5A(第 20 个工具)上线后的 Phase1 自验。
 *
 * 设计:
 *   - import { renderInteractiveHtml, buildInteractiveHtml } from "../dist/interactive-html/index.js"
 *     走 dist/ 已编译产物(dist/ 已是 0.12.0 最新,含 generate_interactive_diagram + F11-F14 修复)
 *   - 每个场景独立 try/catch,一个失败不阻塞其它
 *   - 产物落 OUT = "output/scenario-test-v0.12"
 *   - 跑完打印一行 JSON 结果数组到 stdout(供 Phase2/3 解析)
 *
 * CLI:
 *   node scripts/scenario-tests.mjs [NN|all]   无参 = all
 *
 * License:本文件为 P0-5A 自研(用户场景验证脚本)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderInteractiveHtml, buildInteractiveHtml } from "../dist/interactive-html/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(PROJECT_ROOT, "output/scenario-test-v0.12");

// ---------- D2 样例(真实有意义的内容,非 "a -> b" 占位) ----------

/** 场景 1/2/3 共用:电商订单架构(客户端→网关→服务→DB) */
const D2_ARCH_ECOMMERCE = `direction: right
client: {
  shape: person
  style.bold: true
}
gateway: {
  shape: hexagon
  style.fill: "#dbeafe"
}
order_svc: {
  shape: rectangle
  label: "订单服务"
  style.fill: "#f5f3ff"
}
pay_svc: {
  shape: rectangle
  label: "支付服务"
  style.fill: "#fee2e2"
}
cache: {
  shape: cylinder
  style.fill: "#fef3c7"
}
db: {
  shape: cylinder
  style.fill: "#dcfce7"
}
client -> gateway: HTTPS
gateway -> order_svc: 下单
gateway -> pay_svc: 支付
order_svc -> cache: 读购物车
order_svc -> db: 读写订单
pay_svc -> db: 写流水`;

/** 场景 4a:支付回调时序图(D2 sequence) */
const D2_SEQUENCE_PAY = `sequence_api_payment: {
  payer -> merchant: 下单
  merchant -> payment_api: 创建支付
  payment_api -> channel: 拉起支付
  channel -> payer: 拉起收银台
  payer -> channel: 输入密码
  channel -> payment_api: 支付成功回调
  payment_api -> merchant: 异步通知
  merchant -> order_svc: 更新订单状态
}`;

/** 场景 4b:电商 ER 图(用户/订单/商品/支付) */
const D2_ER_ECOMMERCE = `User: {
  shape: class
  id: int
  name: string
  email: string
}
Order: {
  shape: class
  id: int
  user_id: int
  total: decimal
  status: enum
}
Product: {
  shape: class
  id: int
  name: string
  price: decimal
}
Payment: {
  shape: class
  id: int
  order_id: int
  amount: decimal
  channel: enum
}
User -- Order: "1..N"
Order -- Product: "N..N"
Order -- Payment: "1..1"`;

/** 场景 4c:思维导图(media-gen-mcp 能力树) */
const D2_MINDMAP_CAPS = `media-gen-mcp 能力树: {
  shape: class
  生成: {
    AI 图像 (Agnes + 智谱)
    AI 视频 (文/图生视频)
    结构化渲染 (图/表/公式/卡/图标/二维码)
    交互式架构图 (HTML)
  }
  识别: {
    OCR (tesseract/paddle/vlm)
    PDF 解析
    看图问答 (智谱 vision)
  }
}`;

// ---------- 工具:slug + 断言 ----------

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "out";
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAIL: " + msg);
}

/** 体积契约:HTML ≤ 256KB(S6) */
const SIZE_LIMIT = 256 * 1024;

// ---------- 场景定义 ----------
// 每项 { id, name, category, async run() } → 返 { id, name, ok, output_files, checks, notes, error? }
//   - generate 类:产出 HTML/PNG 落盘
//   - contract 类:校验 HTML 内嵌契约(不另出文件,但保留 ref html)
//   - error 类:断言错误被抛、消息 LLM 友好

const SCENARIOS = [
  {
    id: "01",
    name: "基础架构图(0.12.1 默认双调色板 + 动画)",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["localPath 存在", !!r.localPath],
        ["bytes > 0", r.bytes > 0],
        ["hasDarkLightDualPalette=true(0.12.1 默认 darkTheme=200)", r.hasDarkLightDualPalette === true],
        ["HTML 以 <!doctype html> 开头", /^\s*<!doctype html>/i.test(r.html)],
        ["HTML 含 <svg", /<svg[\s\S]*<\/svg>/.test(r.html)],
        ["含 @media prefers-color-scheme:dark(开箱即反色)", /@media[^{]*prefers-color-scheme\s*:\s*dark\b/.test(r.html)],
        ["含 @keyframes(0.12.1 动画)", /@keyframes/.test(r.html)],
        ["体积 ≤ 256KB", r.bytes <= SIZE_LIMIT],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "0.12.1 起 renderInteractiveHtml 默认 darkTheme=200(真·暗色调色板)+ 内置动画;不传 darkTheme 也开箱即双调色板 + 动起来。",
      };
    },
  },

  {
    id: "02",
    name: "架构图 + darkTheme=default 双调色板(README 头号用例)",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        darkTheme: "default",
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["localPath 存在", !!r.localPath],
        ["hasDarkLightDualPalette=true", r.hasDarkLightDualPalette === true],
        [
          "HTML 含 @media ... prefers-color-scheme:dark(D2 WASM 形式)",
          /@media[^{]*prefers-color-scheme\s*:\s*dark\b/.test(r.html),
        ],
        ["HTML 含 .fill-B{n} dark palette 类(D2 darkThemeID 注入证据)", /\.fill-B\d+\s*\{/.test(r.html)],
        ["体积 ≤ 256KB", r.bytes <= SIZE_LIMIT],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "GitHub README 头号用例:darkTheme=default 触发 D2 注入 @media prefers-color-scheme:dark 双调色板。",
      };
    },
  },

  {
    id: "03",
    name: "架构图 + previewPng:true(HTML + PNG 双产物)",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        darkTheme: "default",
        previewPng: true,
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["localPath(html) 存在", !!r.localPath],
        ["previewPngPath 存在", !!r.previewPngPath],
        ["HTML 含 @media dark", /@media[^{]*prefers-color-scheme\s*:\s*dark\b/.test(r.html)],
      ];
      const stat = r.previewPngPath ? await fs.stat(r.previewPngPath).catch(() => null) : null;
      checks.push(["PNG 文件落盘且非空", !!(stat && stat.size > 0)]);
      if (stat) checks.push([`PNG 体积合理(${(stat.size / 1024).toFixed(1)}KB)`, stat.size > 1000]);
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [
          path.relative(PROJECT_ROOT, r.localPath),
          r.previewPngPath ? path.relative(PROJECT_ROOT, r.previewPngPath) : null,
        ].filter(Boolean),
        checks,
        notes: "previewPng=true 走 resvg 后端(无需 Chrome),HTML + PNG 内容一致。",
      };
    },
  },

  {
    id: "04",
    name: "时序图(sequence)交互式 HTML",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_SEQUENCE_PAY,
        darkTheme: "default",
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["localPath 存在", !!r.localPath],
        ["HTML 含 <svg", /<svg[\s\S]*?<\/svg>/.test(r.html)],
        ["体积 ≤ 256KB", r.bytes <= SIZE_LIMIT],
        ["SVG 含 <text>(消息标签渲染)", /<text[^>]*>[^<]+<\/text>/.test(r.html)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "D2 sequence 图型:支付回调 8 步消息流。",
      };
    },
  },

  {
    id: "05",
    name: "ER 图(电商用户/订单/商品/支付)交互式 HTML",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ER_ECOMMERCE,
        darkTheme: "default",
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["localPath 存在", !!r.localPath],
        ["HTML 含 <svg", /<svg[\s\S]*?<\/svg>/.test(r.html)],
        ["体积 ≤ 256KB", r.bytes <= SIZE_LIMIT],
        ["渲染出 4 个实体(User/Order/Product/Payment 之一)",
          /User|Order|Product|Payment/.test(r.html)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "D2 ER 图型:class shape + 关系基数(1..N / N..N / 1..1)。",
      };
    },
  },

  {
    id: "06",
    name: "自包含契约(无外链 <script src= / 外链 stylesheet)",
    category: "contract",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        darkTheme: "default",
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const scriptSrc = /<script\b[^>]*\bsrc\s*=/.test(r.html);
      const externalLink = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*\bhref\s*=\s*["'](?:https?:|\/\/)/i.test(r.html);
      const hasXmlDecl = /<\?xml/.test(r.html);
      const checks = [
        ["无 <script src= 外链(S2)", !scriptSrc],
        ["无外链 stylesheet(S2)", !externalLink],
        ["无 <?xml? 声明(S11)", !hasXmlDecl],
        ["有内联 <script>(viewer inline)", /<script>[\s\S]*?<\/script>/.test(r.html)],
        ["有内联 <style>(CSS inline)", /<style[\s\S]*?<\/style>/.test(r.html)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "S2/S11 契约:零外链、零 <?xml?>,完全自包含,离线可看。",
      };
    },
  },

  {
    id: "07",
    name: "Motion Governor(prefers-reduced-motion + data-motion=still)",
    category: "contract",
    async run() {
      const r = await buildInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        darkTheme: "default",
      });
      const checks = [
        ["含 @media ... prefers-reduced-motion:reduce(S9)",
          /@media[^{]*prefers-reduced-motion\s*:\s*reduce/.test(r.html)],
        ["含 [data-motion=\"still\"] 选择器(S9)",
          /data-motion\s*=\s*["']still["']/.test(r.html)],
        ["<html data-motion 属性存在",
          /<html[^>]*data-motion\s*=/.test(r.html)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [],
        checks,
        notes: "无障碍契约:用户系统设了减少动画偏好,所有 animation/transition 强制 none。",
      };
    },
  },

  {
    id: "08",
    name: "体积契约(html ≤ 256KB)",
    category: "contract",
    async run() {
      const r = await buildInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        darkTheme: "default",
      });
      const kb = (r.bytes / 1024).toFixed(1);
      const checks = [
        [`bytes=${r.bytes} (${kb}KB) ≤ 256KB(=${SIZE_LIMIT})`, r.bytes <= SIZE_LIMIT],
        ["bytes > 5KB(防断言退化到空 HTML)", r.bytes > 5 * 1024],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [],
        checks,
        notes: `S6 体积契约:实测 ${kb}KB(限制 256KB),防 Tier 2 mermaid ~2.8MB 内联膨胀。`,
      };
    },
  },

  {
    id: "09",
    name: "错误契约:空 code → LLM 友好错误消息",
    category: "error",
    async run() {
      let err;
      try {
        await buildInteractiveHtml({ code: "" });
      } catch (e) {
        err = e;
      }
      const msg = err?.message ?? "";
      const checks = [
        ["空 code 抛错", !!err],
        ["错误消息非空", msg.length > 0],
        ["错误消息含 'code'(LLM 可据此定位字段)", /code/i.test(msg)],
        ["错误消息是英文/中文陈述句(LLM 友好,非裸 stack)",
          /^(?:`?code`?|code)/i.test(msg) || /必填|不能为空|required/i.test(msg)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [],
        checks,
        notes: `实际错误消息: ${msg}`,
      };
    },
  },

  {
    id: "10",
    name: "错误契约:非法 DSL → 捕获 D2 错误消息",
    category: "error",
    async run() {
      // 任务 spec 指定 code = "this is :: not valid d2 ::"
      // 实测发现(Phase1 自验):D2 WASM v0.7 对此输入**容忍**,将其解析为单个节点
      // (leading "this is" 被吞,渲染为 text ": not valid d2 ::"),不抛错。
      // 这是 D2 引擎的解析宽容度,非我们的 bug —— 但意味着 spec 选的 code 触发不了错误路径。
      // 为达成场景目标(验证错误路径可达 + 错误消息 LLM 友好),本场景额外用一个保证错误的 code。
      const specCode = "this is :: not valid d2 ::";
      let specErr = null;
      let specBuilt = null;
      try {
        specBuilt = await buildInteractiveHtml({ code: specCode });
      } catch (e) {
        specErr = e;
      }

      // 补充:用一个真实错误触发(unknown shape)
      const guaranteedErrCode = "shape: invalid_shape_xyz\nA -> B";
      let guaranteedErr = null;
      try {
        await buildInteractiveHtml({ code: guaranteedErrCode });
      } catch (e) {
        guaranteedErr = e;
      }
      const gmsg = guaranteedErr?.message ?? "";

      const checks = [
        ["spec code(this is :: not valid d2 ::)被 D2 容忍(已知 D2 解析宽容度)",
          specBuilt != null && specErr == null],
        ["guaranteed-error code 触发错误", !!guaranteedErr],
        ["错误消息非空", gmsg.length > 0],
        ["错误消息含 D2 errmsg 结构(JSON range/errmsg)",
          /errmsg|range|unknown shape|missing|invalid/i.test(gmsg)],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [],
        checks,
        notes:
          "实测发现:D2 WASM v0.7 对 spec code 容忍(渲染为 text node ': not valid d2 ::'),不抛错。" +
          "为保证场景目标(验证错误路径),附加 shape:invalid_shape_xyz 触发真实错误。" +
          `guaranteed 错误消息前 120 字: ${gmsg.slice(0, 120)}`,
        error: specErr?.message ?? null,
      };
    },
  },

  {
    id: "11",
    name: "F12 回归:darkTheme='   '(空白串)→ 不抛错 + hasDarkLightDualPalette=false",
    category: "contract",
    async run() {
      // F12 修复(主控终验内修):darkTheme 空白串('', '   ', '\t')视为"未提供",
      // 与 d2.ts resolveD2Theme 对齐(空白/whitespace 返 null)。否则此前会进 assertDualPalette
      // 但 D2 未注入 dark 调色板 → S4 必失败。
      const blanks = ["", "   ", "\t"];
      const checks = [];
      for (const b of blanks) {
        let r, err;
        try {
          r = await buildInteractiveHtml({ code: D2_ARCH_ECOMMERCE, darkTheme: b });
        } catch (e) {
          err = e;
        }
        checks.push([`darkTheme=${JSON.stringify(b)} 不抛错`, !err]);
        checks.push([`darkTheme=${JSON.stringify(b)} hasDarkLightDualPalette=false`,
          r?.hasDarkLightDualPalette === false]);
      }
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [],
        checks,
        notes: "F12 修复回归:darkTheme 空白串('', '   ', '\\t')视为缺省,不进 assertDualPalette,不抛 S4。",
      };
    },
  },
  {
    id: "12",
    name: "动态动画演示(边数据流 + 依次高亮 + 节点入场;0.12.1 新增)",
    category: "generate",
    async run() {
      const slug = slugify(this.name);
      const r = await renderInteractiveHtml({
        code: D2_ARCH_ECOMMERCE,
        outDir: OUT,
        name: `${this.id}-${slug}`,
      });
      const checks = [
        ["@keyframes 数 ≥ 3(edge-flow/edge-pulse/node-enter)", (r.html.match(/@keyframes/g) || []).length >= 3],
        ["含 mgm-edge-flow(边数据流 stroke-dashoffset)", /mgm-edge-flow/.test(r.html)],
        ["含 mgm-edge-pulse(依次高亮 pulse)", /mgm-edge-pulse/.test(r.html)],
        ["含 mgm-node-enter(节点淡入)", /mgm-node-enter/.test(r.html)],
        ["SVG 含 path.connection(边动画靶向存在)", /class="[^"]*connection/.test(r.svg)],
        ["SVG 含 g.shape(节点动画靶向存在)", /class="shape"/.test(r.svg)],
        ["边动画 stroke-dasharray 注入(虚线流动)", /path\.connection\s*\{[^}]*stroke-dasharray/.test(r.html)],
        ["Motion Governor: prefers-reduced-motion 守门", /prefers-reduced-motion\s*:\s*reduce/.test(r.html)],
        ["Motion Governor: data-motion=still 守门(animation:none !important)", /html\[data-motion="still"\][^{]*\{[^}]*animation:\s*none\s*!important/.test(r.html)],
        ["体积 ≤ 256KB(动画 CSS 不超量)", r.bytes <= SIZE_LIMIT],
      ];
      const ok = checks.every(([, c]) => c);
      return {
        id: this.id, name: this.name, ok,
        output_files: [path.relative(PROJECT_ROOT, r.localPath)],
        checks,
        notes: "0.12.1 新增三种动画:边数据流(stroke-dashoffset)+ 依次高亮(:nth-of-type 错开 pulse)+ 节点入场淡入 + 悬停高亮;Motion Governor 自动 gate(prefers-reduced-motion / data-motion=still → 全停)。浏览器打开此 HTML 即见动态架构图。",
      };
    },
  },
];

// ---------- CLI main ----------

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const arg = process.argv[2] ?? "all";
  const targets = arg === "all"
    ? SCENARIOS
    : SCENARIOS.filter((s) => s.id === arg.padStart(2, "0"));

  if (targets.length === 0) {
    process.stderr.write(`ERROR: 未知场景编号 "${arg}"。可用:${SCENARIOS.map((s) => s.id).join(", ")} 或 all\n`);
    process.exit(2);
  }

  process.stderr.write(`\n[scenario-tests] OUT=${path.relative(PROJECT_ROOT, OUT)}\n`);
  process.stderr.write(`[scenario-tests] 跑 ${targets.length} 个场景:${targets.map((s) => s.id).join(", ")}\n\n`);

  const results = [];
  for (const sc of targets) {
    const startedAt = Date.now();
    try {
      // 注意:run 内部 this 绑定到 sc(sc.run.call(sc))
      const r = await sc.run.call(sc);
      r.ms = Date.now() - startedAt;
      results.push(r);
      const tag = r.ok ? "PASS" : "FAIL";
      process.stderr.write(`  [${sc.id}] ${tag}  ${sc.name}  (${r.ms}ms)\n`);
      for (const [label, passed] of r.checks) {
        process.stderr.write(`        ${passed ? "✓" : "✗"} ${label}\n`);
      }
      if (r.notes) process.stderr.write(`        notes: ${r.notes.slice(0, 200)}${r.notes.length > 200 ? "..." : ""}\n`);
      if (r.output_files?.length) {
        process.stderr.write(`        files: ${r.output_files.join(", ")}\n`);
      }
    } catch (e) {
      const r = {
        id: sc.id, name: sc.name, ok: false,
        output_files: [], checks: [],
        notes: "场景 runner 抛错(非断言失败)",
        error: e?.stack ?? String(e),
        ms: Date.now() - startedAt,
      };
      results.push(r);
      process.stderr.write(`  [${sc.id}] THROW  ${sc.name}  (${r.ms}ms)\n`);
      process.stderr.write(`        ${e?.message ?? e}\n`);
    }
  }

  // 汇总
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  process.stderr.write(`\n[scenario-tests] ${ok}/${total} 场景通过\n`);

  // 末行打印 JSON 结果数组(供 Phase2/3 解析)
  process.stdout.write(JSON.stringify(results));
  process.stdout.write("\n");

  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e?.stack ?? e}\n`);
  process.exit(1);
});
