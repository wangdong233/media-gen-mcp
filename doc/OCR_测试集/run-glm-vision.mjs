// doc/OCR_测试集/run-glm-vision.mjs
/**
 * glm-vision(GLM-4.6V-Flash)专属维度测试:s9 复杂表格 + s10 VQA。
 *
 * 直接调 GlmVisionProvider.recognize() —— 不经 MCP handler(因 run-ocr.mjs 仅暴露 extract_text)。
 * Key 来自 ZAI_API_KEY({id}.{secret} 整串作 Bearer,open.bigmodel.cn/api/paas/v4 直连 —— 见
 * zhipu-client.ts L8-9 注释)。
 *
 * 失败记录:1305(平台过载 backoff 内置 0/1s/2s × 3 次)、1302(并发切 key)、key-dead、网络 → 全记录。
 *
 * 用法:node doc/OCR_测试集/run-glm-vision.mjs
 * 输出:stdout 末行 JSON [{id, desc, truth, glmText, acc, ok, error?}]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GlmVisionProvider } from "../../dist/providers/glm-vision.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// ── 配置 glm-vision provider(直接用 ZAI_API_KEY,{id}.{secret} 整串作 Bearer) ──
const apiKey = process.env.ZAI_API_KEY ?? process.env.GLM_VISION_API_KEY ?? "";
if (!apiKey) {
  console.log(JSON.stringify({ isError: true, error: "ZAI_API_KEY not in env" }));
  process.exit(2);
}
// 用 open.bigmodel.cn 国内端点(zhipu-client.ts 默认),Code Plan key 风险自负(调研附录 2 D2)
const provider = new GlmVisionProvider({ apiKey, baseUrl: "https://open.bigmodel.cn/api" });

// ── LCS 字符级相似度(去空白/去 tag),用于 HTML 表格 vs ground-truth ──
function normalize(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]+>/g, " ")       // 去 HTML tag
    .replace(/[#|>`\-*]/g, " ")     // 去 markdown 装饰
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, "")            // 去所有空白(中文不要空格)
    .toLowerCase();
}
function lcs(a, b) {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}
function charAcc(truth, candidate) {
  const t = normalize(truth);
  const c = normalize(candidate);
  if (t.length === 0) return c.length === 0 ? 1 : 0;
  return lcs(t, c) / t.length;
}

// ── 读图 → data URI ──
function dataUri(path) {
  const buf = readFileSync(path);
  return "data:image/png;base64," + buf.toString("base64");
}

// ── 数字提取(用于 s10 VQA 计分:答案中 "3" 和 "2" 是否都对) ──
function extractNumbers(s) {
  return (String(s ?? "").match(/\d+/g) ?? []).map(Number);
}

const results = [];

// ── s9 复杂表格(extract-table, hints.format=html) ──
{
  const id = "s9_table";
  const desc = "复杂表格(多层表头 + 合并单元格):2026 上半年季度销售报表(产品 A/B/C × Q1/Q2 × 数量/金额)";
  const truth = readFileSync(join(__dirname, "s9_table.txt"), "utf8").trim();
  const image = dataUri(join(__dirname, "s9_table.png"));
  console.error(`\n[${id}] extract-table hints={format:html} 调用中...`);
  const t0 = Date.now();
  try {
    const r = await provider.recognize({ image, task: "extract-table", hints: { format: "html" } });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const glmText = r?.table?.content ?? r?.raw ?? "";
    const acc = charAcc(truth, glmText);
    console.error(`  ✅ ${elapsed}s acc=${acc.toFixed(3)} contentLen=${glmText.length}`);
    console.error(`  --- glmText(前 400 字)---\n  ${glmText.slice(0, 400).replace(/\n/g, "\n  ")}`);
    results.push({ id, desc, truth, glmText, acc, ok: true, elapsedS: Number(elapsed) });
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const err = { status: e?.status, body: e?.body, message: e?.message };
    console.error(`  ❌ ${elapsed}s 失败: ${JSON.stringify(err).slice(0, 300)}`);
    results.push({ id, desc, truth, glmText: "", acc: 0, ok: false, error: err, elapsedS: Number(elapsed) });
  }
}

// ── s10 VQA(describe-image with question) ──
{
  const id = "s10_vqa";
  const desc = "VQA 看图问答:3 个红苹果 + 2 个绿苹果(canvas 画圆)。问「几个红?几个绿?」";
  const truthFull = readFileSync(join(__dirname, "s10_vqa.txt"), "utf8").trim();
  const answer = "3 个红苹果,2 个绿苹果";
  const image = dataUri(join(__dirname, "s10_vqa.png"));
  const question = "图中有几个红苹果?几个绿苹果?";
  console.error(`\n[${id}] describe-image hints={question} 调用中...`);
  const t0 = Date.now();
  try {
    const r = await provider.recognize({ image, task: "describe-image", hints: { question } });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const glmText = r?.description ?? r?.raw ?? "";
    // VQA 计分:答案中是否含 3 和 2 两个数字(语义对齐)
    const nums = extractNumbers(glmText);
    const hasRed3 = /3\s*个?\s*(红|red)/i.test(glmText) || nums.includes(3);
    const hasGreen2 = /2\s*个?\s*(绿|green)/i.test(glmText) || nums.includes(2);
    const acc = (hasRed3 && hasGreen2) ? 1 : (hasRed3 || hasGreen2) ? 0.5 : 0;
    console.error(`  ✅ ${elapsed}s acc=${acc.toFixed(3)} nums=${JSON.stringify(nums)}`);
    console.error(`  --- glmText ---\n  ${glmText.replace(/\n/g, "\n  ")}`);
    results.push({ id, desc, truth: answer, glmText, acc, ok: true, elapsedS: Number(elapsed), numsFound: nums });
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const err = { status: e?.status, body: e?.body, message: e?.message };
    console.error(`  ❌ ${elapsed}s 失败: ${JSON.stringify(err).slice(0, 300)}`);
    results.push({ id, desc, truth: answer, glmText: "", acc: 0, ok: false, error: err, elapsedS: Number(elapsed) });
  }
}

console.log("\n" + JSON.stringify(results));
