/**
 * P0-2 §4.5 Step 11 / §8.1 验收清单 CI grep 防御脚本。
 *
 * 断言 d2.ts / graphviz.ts / chart.ts / index.ts 的 HINT / remediation 文本
 * 不含跨引擎回退触发子串(SVG data parsing / Font not found / No time to read)。
 *
 * 这些子串曾在 PRD §4.3.4 旧版的"按内容猜测路由"方案中作为触发器,但经实测既漏匹配(resvg
 * 实际抛的是 `default font-family '' not found`,而非连续的 'Font not found')又误匹配
 * (D2 HINT 文本未来若引用这些字样会被误路由到 resvg patterns)。P0-2 §4.3.4 升级为
 * 结构性路由([resvg] 前缀 + engineHint 参数)后,这些子串不再作为触发依据。
 *
 * 此脚本防御未来文本漂移 —— 任何维护者若在 d2/graphviz/chart/index 的错误/HINT/remediation
 * 文本里写入了这三个子串,会让此脚本失败,提醒改用结构性信号。
 *
 * **接入位置**:与 check-schema.mjs 同目录(scripts/),语义对齐。**不接入 npm test**
 * (保 P0-3 立场 —— P0-3 才正式引入 test 基建);P0-2 实施者本地跑、CI 接入留给 P0-3。
 *
 * 运行:node scripts/check-error-text.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 受检文件:跨引擎回退触发子串严禁出现在这些文件的"运行时错误/HINT/remediation 文本"里。
// (handlers/error-format.ts 例外 —— resvg patterns 表里的 rx 字面量是基于实测重写的合法引用。)
const FILES_TO_CHECK = [
  "src/diagram/d2.ts",
  "src/diagram/graphviz.ts",
  "src/chart.ts",
  "src/index.ts",
];

// 跨引擎回退触发子串(PRD §4.3.4 旧版脆弱方案遗留)。
// 注:'SVG data parsing' 在 src/render-svg.ts 的兜底 rx 里出现是允许的(handler 层兜底识别,
// 不是跨引擎回退触发器),但本脚本不检 render-svg.ts。
const FORBIDDEN_SUBSTRINGS = [
  "Font not found",       // resvg 实际抛的是 'default font-family \'\' not found',不连续
  "No time to read",      // resvg native 二进制零命中,PRD 凭印象误写
];

// 'SVG data parsing' 单列:这是合法的 resvg 错误串,允许出现在 resvg patterns 表的 rx 里
// (handlers/error-format.ts),但严禁出现在 d2/graphviz/chart 的 HINT 文本里。
// 单独处理以避免误伤 resvg patterns 表的合法 rx 字面量。
const SVG_DATA_PARSING_FORBIDDEN_FILES = [
  "src/diagram/d2.ts",
  "src/diagram/graphviz.ts",
  "src/chart.ts",
];

let pass = 0, fail = 0;
const ok = (m) => { console.log("  ✅ " + m); pass++; };
const bad = (m) => { console.error("  ❌ " + m); fail++; };

console.log("[P0-2] 跨引擎回退触发子串防御(d2/graphviz/chart/index 严禁含 Font not found / No time to read / SVG data parsing)");

for (const rel of FILES_TO_CHECK) {
  const fp = path.join(ROOT, rel);
  let content;
  try {
    content = readFileSync(fp, "utf-8");
  } catch (e) {
    bad(`${rel}: 文件读取失败 (${e?.message ?? String(e)})`);
    continue;
  }
  for (const sub of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(sub)) {
      bad(`${rel}: 含跨引擎回退触发子串 "${sub}" —— 这会让未来的内容匹配路由误判,改用 [resvg] 前缀或 engineHint 参数`);
    } else {
      ok(`${rel}: 不含 "${sub}"`);
    }
  }
  if (SVG_DATA_PARSING_FORBIDDEN_FILES.includes(rel)) {
    if (content.includes("SVG data parsing")) {
      bad(`${rel}: 含 "SVG data parsing" —— 严禁出现在引擎层 HINT 文本(仅 handler 层 resvg patterns / render-svg.ts 兜底 rx 允许)`);
    } else {
      ok(`${rel}: 不含 "SVG data parsing"`);
    }
  }
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
