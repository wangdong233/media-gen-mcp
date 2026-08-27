#!/usr/bin/env node
/**
 * check-readme-sync.mjs — README.md (中文) <-> README.en.md (English) 机械同步闸门
 *
 * 只校验「结构」与「数字」,不校验翻译措辞:
 *   1. 标题结构      — ATX 标题(代码围栏外)的层级序列必须一致(条数 + 每级深度)
 *   2. 代码块计数    — 围栏代码块数量一致(内容不比对:块内注释是翻译过的)
 *   3. 表格结构      — 每张表格的行数序列一致
 *   4. 工具/配置名   — 行内代码 span(无空白/无 CJK 的机器 token,含工具名、
 *                      模型 key、错误码、环境变量)多重集一致 → 工具清单漂移即红
 *   5. 数字类字段    — 全文(标题行除外;标题序号中=一二三 / 英=1.2.3 表示法不同)
 *                      数字多重集一致,含积分/上限/端口/版本号;
 *                      单位归一:2k=2000、128K=128000、20 万=200000(两侧同规则)
 *
 * 用法: node scripts/check-readme-sync.mjs [zhReadme] [enReadme]
 *   缺省 README.md / README.en.md;可传临时副本做红/绿自测。
 * 不一致 exit 1 并打印差异清单;一致 exit 0。
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const zhPath = args[0] ?? 'README.md';
const enPath = args[1] ?? 'README.en.md';

const CJK_RE = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
const MAX_REPORT = 40;

function fail(msg) {
  console.error(`[check-readme-sync] FAIL — ${msg}`);
  process.exit(1);
}

function parse(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
  }
  const lines = raw.split(/\r?\n/);
  const headings = []; // { level, text, line }
  const spans = [];    // { token, line }
  const tableRuns = []; // rows per table block
  let fenceCount = 0;
  let inFence = false;
  let tableRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (/^\s*(```|~~~)/.test(line)) {
      if (tableRun > 0) { tableRuns.push(tableRun); tableRun = 0; }
      if (inFence) {
        inFence = false;
      } else {
        inFence = true;
        fenceCount++;
      }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2].trim(), line: lineNo });
      continue; // 标题行不参与表格/span 解析
    }

    if (/^\s*\|/.test(line)) {
      tableRun++;
      continue;
    }
    if (tableRun > 0) { tableRuns.push(tableRun); tableRun = 0; }

    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1];
      // 只比对「机器 token」:不含空白、不含 CJK、不含省略号。
      // span 内嵌翻译说明(如 {needConfirm:true, 积分预估...})两侧都跳过。
      if (token.length === 0) continue;
      if (/\s/.test(token)) continue;
      if (CJK_RE.test(token)) continue;
      if (token.includes('…') || token.includes('...')) continue;
      spans.push({ token, line: lineNo });
    }
  }
  if (tableRun > 0) tableRuns.push(tableRun);
  if (inFence) fail(`${path}: unbalanced code fence (opened but never closed)`);

  // 数字提取:全文(代码围栏内外都算——JSON 端口/尺寸同样是契约),
  // 仅排除标题行(中文「一、二、」vs 英文「1. 2.」表示法不同)。
  const headingLines = new Set(headings.map((h) => h.line));
  const numbers = [];
  for (let i = 0; i < lines.length; i++) {
    if (headingLines.has(i + 1)) continue;
    for (const n of extractNumbers(lines[i])) numbers.push({ token: n, line: i + 1 });
  }

  return { path, headings, spans, numbers, fenceCount, tableRuns };
}

/** 数字归一提取:千分位去逗号;k/K → ×1000;万 → ×10000(对两侧文本同规则应用)。 */
function extractNumbers(text) {
  let t = text.replace(/(\d),(?=\d{3}(\D|$))/g, '$1');
  t = t.replace(/(\d),(?=\d{3}(\D|$))/g, '$1'); // 处理 1,234,567 双组
  t = t.replace(/(\d+(?:\.\d+)?)\s*[kK](?![a-zA-Z0-9])/g, (_, n) => String(Math.round(parseFloat(n) * 1000)));
  t = t.replace(/(\d+(?:\.\d+)?)\s*万(?![a-zA-Z0-9])/g, (_, n) => String(Math.round(parseFloat(n) * 10000)));
  return t.match(/\d+(?:\.\d+)?/g) ?? [];
}

function multiset(items, key) {
  const map = new Map(); // key -> { count, lines: [] }
  for (const it of items) {
    const k = key(it);
    let e = map.get(k);
    if (!e) { e = { count: 0, lines: [] }; map.set(k, e); }
    e.count++;
    if (e.lines.length < 6) e.lines.push(it.line);
  }
  return map;
}

function diffMultisets(zhMap, enMap) {
  const diffs = [];
  for (const [k, z] of zhMap) {
    const e = enMap.get(k);
    if (!e || e.count !== z.count) {
      diffs.push({ key: k, zh: z, en: e ?? { count: 0, lines: [] } });
    }
  }
  for (const [k, e] of enMap) {
    if (!zhMap.has(k)) diffs.push({ key: k, zh: { count: 0, lines: [] }, en: e });
  }
  return diffs.sort((a, b) => b.zh.count + b.en.count - (a.zh.count + a.en.count));
}

function fmtLines(e) {
  return e.count === 0 ? '-' : `${e.lines.join(',')}${e.lines.length < e.count ? ',…' : ''}`;
}

const zh = parse(zhPath);
const en = parse(enPath);
const problems = [];

// ① 标题结构(层级序列)
if (zh.headings.length !== en.headings.length) {
  problems.push(`[headings] 标题条数不一致: zh=${zh.headings.length} (${zhPath}) en=${en.headings.length} (${enPath})`);
}
const nHead = Math.min(zh.headings.length, en.headings.length);
for (let i = 0; i < nHead; i++) {
  if (zh.headings[i].level !== en.headings[i].level) {
    problems.push(
      `[headings] 第 ${i + 1} 个标题层级不一致: zh H${zh.headings[i].level} (L${zh.headings[i].line} "${zh.headings[i].text.slice(0, 40)}") vs en H${en.headings[i].level} (L${en.headings[i].line} "${en.headings[i].text.slice(0, 40)}")`,
    );
    break; // 只报第一处层级分歧,避免刷屏
  }
}

// ② 代码块计数
if (zh.fenceCount !== en.fenceCount) {
  problems.push(`[code-blocks] 围栏代码块数量不一致: zh=${zh.fenceCount} en=${en.fenceCount}`);
}

// ③ 表格行数序列
const tZh = zh.tableRuns.join(',');
const tEn = en.tableRuns.join(',');
if (tZh !== tEn) {
  problems.push(`[tables] 表格行数序列不一致(每张表按行数):\n    zh (${zh.tableRuns.length} tables): [${tZh}]\n    en (${en.tableRuns.length} tables): [${tEn}]`);
}

// ④ 工具/配置名(行内代码 span)多重集
const spanDiff = diffMultisets(
  multiset(zh.spans, (s) => s.token),
  multiset(en.spans, (s) => s.token),
);
for (const d of spanDiff) {
  const kind = /_|^[A-Za-z0-9-.:\/[\]()<>=$"{}/]+$/.test(d.key) && d.key.includes('_') ? 'tool/config name' : 'code token';
  problems.push(
    `[spans] ${kind} \`${d.key}\`: zh=${d.zh.count} (${fmtLines(d.zh)}) en=${d.en.count} (${fmtLines(d.en)})`,
  );
}

// ⑤ 数字类字段(积分/上限/版本号/端口/尺寸…)多重集
const numDiff = diffMultisets(
  multiset(zh.numbers, (x) => x.token),
  multiset(en.numbers, (x) => x.token),
);
for (const d of numDiff) {
  problems.push(
    `[numbers] 数字 "${d.key}": zh=${d.zh.count} (${fmtLines(d.zh)}) en=${d.en.count} (${fmtLines(d.en)})`,
  );
}

if (problems.length > 0) {
  console.error(`[check-readme-sync] ${zhPath} <-> ${enPath}`);
  console.error(`FAIL — ${problems.length} 处结构/数字不一致(翻译措辞不校验):`);
  for (const p of problems.slice(0, MAX_REPORT)) console.error(`  - ${p}`);
  if (problems.length > MAX_REPORT) console.error(`  … and ${problems.length - MAX_REPORT} more`);
  console.error('修复方向: 以一侧为准同步另一侧的数字/工具名/结构,再跑本检查。');
  process.exit(1);
}

console.log(
  `[check-readme-sync] ${zhPath} <-> ${enPath} OK — headings ${zh.headings.length}/${en.headings.length}, code blocks ${zh.fenceCount}/${en.fenceCount}, tables ${zh.tableRuns.length} (rows [${tZh}]), code spans ${zh.spans.length}/${en.spans.length}, numbers ${zh.numbers.length}/${en.numbers.length}`,
);
process.exit(0);
