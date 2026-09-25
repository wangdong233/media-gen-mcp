// doc/OCR_测试集/gen-fixtures.mjs
/**
 * OCR 可控测试夹具生成器(pares5 vision 识图测试)。
 *
 * 用 @napi-rs/canvas 程序化渲染「已知文本」的图片 → 得到像素清晰、可读、ground-truth 确定
 * 的测试样本。比 AI 生图可靠(AI 生图文字常乱码无法做准确率计分),比网图可控(网图无 ground-truth)。
 *
 * 5 个可控场景:s1 中英混排 / s2 数字 / s3 代码 / s6 多语 / s8 公式。
 * 每场景渲染 <id>.png + 落 <id>.txt(ground-truth 文本,供 OCR 准确率计分)。
 *
 * 真实条件场景(s4 小票 / s5 菜单 / s7 聊天)走网图搜索(见 OCR 测试工作流),不入本脚本。
 *
 * 字体:macOS PingFang.ttc(CJK)。Linux/CI 需改用 Noto Sans CJK。
 * 运行:node doc/OCR_测试集/gen-fixtures.mjs
 */
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;

// 注册 CJK 字体(macOS PingFang;失败则 fallback 系统默认,中文可能 tofu)
try {
  GlobalFonts.registerFromPath("/System/Library/Fonts/PingFang.ttc", "PingFang");
} catch { /* 非 macOS 环境,依赖系统默认 CJK 字体 */ }
const CJK = '"PingFang", "Noto Sans CJK SC", "STHeiti", sans-serif';
const MONO = '"Menino", "Courier New", monospace';

/** 渲染多行文本到 PNG。lines: [{text, font, size, color, y?}]。返 PNG buffer。 */
function render(width, height, bg, draw) {
  const c = createCanvas(width, height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  draw(ctx);
  return c.toBuffer("image/png");
}

function writeFix(id, png, txt) {
  writeFileSync(join(OUT, `${id}.png`), png);
  writeFileSync(join(OUT, `${id}.txt`), txt);
  console.log(`  ✅ ${id}.png (${png.length} bytes) + ${id}.txt (${txt.length} chars)`);
}

// ── s1 中英混排说明书 ──
{
  const lines = [
    ["电源适配器使用说明书", 30, CJK, "#111"],
    ["", 8, CJK, "#111"],
    ["请使用原装电源适配器。", 22, CJK, "#111"],
    ["Use only the original power adapter.", 22, CJK, "#333"],
    ["", 10, CJK, "#111"],
    ["输入: AC 100-240V 50/60Hz", 22, CJK, "#111"],
    ["Input: AC 100-240V 50/60Hz", 22, CJK, "#333"],
    ["输出: DC 5V 2A", 22, CJK, "#111"],
    ["Output: DC 5V 2A", 22, CJK, "#333"],
    ["", 10, CJK, "#111"],
    ["警告: 请勿短路", 22, CJK, "#c00"],
    ["Warning: Do not short circuit", 22, CJK, "#c00"],
  ];
  const png = render(700, 420, "#fff", (ctx) => {
    let y = 40;
    for (const [text, size, font, color] of lines) {
      if (text) { ctx.fillStyle = color; ctx.font = `${size}px ${font}`; ctx.fillText(text, 30, y); }
      y += size + 14;
    }
  });
  const truth = lines.filter((l) => l[0]).map((l) => l[0]).join("\n");
  writeFix("s1_manual", png, truth);
}

// ── s2 数字(身份证/银行卡/手机号) ──
{
  const items = [
    ["身份证号", "110101199003078888"],
    ["银行卡号", "6222020012345678901"],
    ["手机号码", "13800138000"],
  ];
  const png = render(720, 360, "#fff", (ctx) => {
    let y = 60;
    for (const [label, num] of items) {
      ctx.fillStyle = "#666"; ctx.font = `20px ${CJK}`; ctx.fillText(label, 40, y);
      ctx.fillStyle = "#111"; ctx.font = `bold 40px ${MONO}`; ctx.fillText(num, 40, y + 44);
      y += 100;
    }
  });
  const truth = items.map(([, n]) => n).join("\n");
  writeFix("s2_digits", png, truth);
}

// ── s3 代码截图 ──
{
  const code = `function greet(name) {
  const msg = "Hello, " + name;
  console.log(msg);
  return msg;
}

greet("World");`;
  const png = render(720, 360, "#1e1e2e", (ctx) => {
    ctx.font = `20px ${MONO}`;
    const lines = code.split("\n");
    lines.forEach((line, i) => {
      ctx.fillStyle = "#89dceb";
      // 简单语法着色:关键字 function/const/return 蓝色,字符串 黄色
      ctx.fillStyle = "#cdd6f4";
      ctx.fillText(line, 30, 36 + i * 28);
    });
  });
  writeFix("s3_code", png, code);
}

// ── s6 多语包装(中英日韩) ──
{
  const rows = [
    ["中文", "水", "甘油", "烟酰胺"],
    ["English", "Water", "Glycerin", "Niacinamide"],
    ["日本語", "水", "グリセリン", "ナイアシンアミド"],
    ["한국어", "물", "글리세린", "나이아신아마이드"],
  ];
  const png = render(820, 360, "#fff", (ctx) => {
    ctx.font = `22px ${CJK}`;
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        ctx.fillStyle = c === 0 ? "#888" : "#111";
        ctx.font = c === 0 ? `italic 20px ${CJK}` : `22px ${CJK}`;
        ctx.fillText(cell, 40 + c * 200, 50 + r * 70);
      });
    });
  });
  const truth = rows.map((r) => r.join(" ")).join("\n");
  writeFix("s6_multilang", png, truth);
}

// ── s8 数学公式 ──
{
  const formulas = [
    "E = mc^2",
    "a^2 + b^2 = c^2",
    "x = (-b +- sqrt(b^2 - 4ac)) / 2a",
    "sum(i=1..n) i = n(n+1)/2",
  ];
  const png = render(720, 320, "#fff", (ctx) => {
    ctx.fillStyle = "#111"; ctx.font = `28px ${MONO}`;
    formulas.forEach((f, i) => ctx.fillText(f, 40, 60 + i * 60));
  });
  writeFix("s8_formula", png, formulas.join("\n"));
}

// ── s4 中文超市小票(原网图为荷兰文库拉索小票,不符"中文小票"场景 → 程序化渲染中文可控版) ──
{
  const rows = [
    ["永辉超市(朝阳区店)", 28, CJK, "#111"],
    ["================================", 18, MONO, "#111"],
    ["矿泉水 550ml   x2    4.00", 20, MONO, "#111"],
    ["全麦面包       x1    8.50", 20, MONO, "#111"],
    ["鸡蛋 10枚      x1   12.80", 20, MONO, "#111"],
    ["纯牛奶 1L      x1    9.90", 20, MONO, "#111"],
    ["--------------------------------", 18, MONO, "#111"],
    ["小计:              35.20", 20, MONO, "#111"],
    ["会员优惠:           -2.00", 20, MONO, "#c00"],
    ["增值税(6%):         1.20", 20, MONO, "#666"],
    ["================================", 18, MONO, "#111"],
    ["合计:              34.40", 24, CJK, "#111"],
    ["微信支付:           34.40", 20, CJK, "#111"],
    ["2026-07-20 14:30:25", 18, MONO, "#666"],
  ];
  const png = render(560, 560, "#fff", (ctx) => {
    let y = 40;
    for (const [text, size, font, color] of rows) {
      ctx.fillStyle = color; ctx.font = `${size}px ${font}`; ctx.fillText(text, 30, y);
      y += size + 12;
    }
  });
  const truth = rows.filter((l) => l[0] && !/^[=-]+$/.test(l[0])).map((l) => l[0]).join("\n");
  writeFix("s4_receipt", png, truth);
}

// ── s7 中文微信聊天(原网图为孟加拉语,不符"中文聊天"场景 → 程序化渲染中文可控版) ──
{
  // 气泡:[from, time, msg, side]  side: "left"=对方(白底灰边) "right"=自己(绿底白字)
  const bubbles = [
    { from: "张三", time: "14:02", msg: "你今晚有空吗", side: "left" },
    { from: "我", time: "14:03", msg: "有的,几点", side: "right" },
    { from: "张三", time: "14:03", msg: "七点老地方见", side: "left" },
    { from: "我", time: "14:05", msg: "好的,不见不散", side: "right" },
  ];
  const png = render(540, 560, "#ededed", (ctx) => {
    let y = 40;
    for (const b of bubbles) {
      // 时间戳居中
      ctx.fillStyle = "#999"; ctx.font = `16px ${CJK}`;
      const tw = ctx.measureText(b.time).width;
      ctx.fillText(b.time, (540 - tw) / 2, y);
      y += 30;
      // 气泡
      const isLeft = b.side === "left";
      const padX = 18, padY = 14;
      ctx.font = `22px ${CJK}`;
      const mw = ctx.measureText(b.msg).width;
      const bw = mw + padX * 2;
      const bh = 22 + padY * 2;
      const bx = isLeft ? 60 : 540 - 60 - bw;
      ctx.fillStyle = isLeft ? "#fff" : "#95ec69";
      // 圆角矩形
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(bx + r, y);
      ctx.lineTo(bx + bw - r, y); ctx.arcTo(bx + bw, y, bx + bw, y + r, r);
      ctx.lineTo(bx + bw, y + bh - r); ctx.arcTo(bx + bw, y + bh, bx + bw - r, y + bh, r);
      ctx.lineTo(bx + r, y + bh); ctx.arcTo(bx, y + bh, bx, y + bh - r, r);
      ctx.lineTo(bx, y + r); ctx.arcTo(bx, y, bx + r, y, r);
      ctx.fill();
      ctx.fillStyle = isLeft ? "#111" : "#111";
      ctx.font = `22px ${CJK}`;
      ctx.fillText(b.msg, bx + padX, y + padY + 18);
      y += bh + 24;
    }
  });
  const truth = bubbles.map((b) => `${b.time}\n${b.msg}`).join("\n");
  writeFix("s7_chat", png, truth);
}

// ── s9 复杂表格(多层表头 + 合并单元格) ──
// glm-vision 强项维度:多层表头(产品 \ 季度 → Q1/Q2 子列) + 合并单元格(行表头列合并 + 列表头跨两季度)
// ground-truth = 表格纯文本(去 tag,行内 \t 分隔,与 HTML 表格语义对齐)
{
  // 表格语义:第一列=产品(A/B/C 三行合并),表头=「季度」(合并) → Q1 数量/金额 + Q2 数量/金额(子表头)
  // 数据:产品A Q1 120件 ¥1200 / Q2 150件 ¥1800;产品B Q1 80件 ¥960 / Q2 100件 ¥1400;产品C Q1 60件 ¥900 / Q2 90件 ¥1620
  const headers = [
    { text: "产品", sub: [] },                        // 0,0 占两行(rowspan=2)
    { text: "Q1 第一季度", sub: ["数量(件)", "金额(元)"] }, // 0,1-2 colspan=2
    { text: "Q2 第二季度", sub: ["数量(件)", "金额(元)"] }, // 0,3-4 colspan=2
  ];
  const rows = [
    { product: "产品 A", cells: ["120", "1200", "150", "1800"] },
    { product: "产品 B", cells: ["80", "960", "100", "1400"] },
    { product: "产品 C", cells: ["60", "900", "90", "1620"] },
  ];
  const W = 820, H = 360;
  const png = render(W, H, "#fff", (ctx) => {
    // 列宽:产品 160 + 4 个数据列 各 165
    const colX = [40, 200, 365, 530, 695];
    const colRight = [200, 365, 530, 695, 860];
    const rowH = 60, headerH1 = 50, headerH2 = 50;
    const topY = 40;
    const lineW = 1.5;
    // 整框
    ctx.strokeStyle = "#222"; ctx.lineWidth = lineW;
    ctx.strokeRect(40, topY, 820, headerH1 + headerH2 + rows.length * rowH);
    // 行表头列竖线(产品列右边界)
    ctx.beginPath(); ctx.moveTo(colX[1], topY); ctx.lineTo(colX[1], topY + headerH1 + headerH2 + rows.length * rowH); ctx.stroke();
    // Q1/Q2 横线(表头第一行下界)
    ctx.beginPath(); ctx.moveTo(40, topY + headerH1); ctx.lineTo(860, topY + headerH1); ctx.stroke();
    // Q1/Q2 中线(每个季度 → 数量/金额 两子列)
    ctx.beginPath();
    ctx.moveTo(colX[2], topY + headerH1); ctx.lineTo(colX[2], topY + headerH1 + headerH2 + rows.length * rowH);
    ctx.moveTo(colX[3], topY + headerH1); ctx.lineTo(colX[3], topY + headerH1 + headerH2 + rows.length * rowH);
    ctx.moveTo(colX[4], topY + headerH1); ctx.lineTo(colX[4], topY + headerH1 + headerH2 + rows.length * rowH);
    ctx.stroke();
    // 数据行横线
    for (let i = 1; i < rows.length; i++) {
      const y = topY + headerH1 + headerH2 + i * rowH;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(860, y); ctx.stroke();
    }
    // 文字:第一行产品(占两行,垂直居中)
    ctx.fillStyle = "#111"; ctx.font = `bold 22px ${CJK}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("产品", (colX[0] + colRight[0]) / 2, topY + (headerH1 + headerH2) / 2);
    // 第一行表头 Q1/Q2(各占两列)
    ctx.fillText("Q1 第一季度", (colX[1] + colRight[2]) / 2, topY + headerH1 / 2);
    ctx.fillText("Q2 第二季度", (colX[3] + colRight[4]) / 2, topY + headerH1 / 2);
    // 第二行子表头 数量/金额 × 2
    ctx.font = `18px ${CJK}`;
    ctx.fillText("数量(件)", (colX[1] + colRight[1]) / 2, topY + headerH1 + headerH2 / 2);
    ctx.fillText("金额(元)", (colX[2] + colRight[2]) / 2, topY + headerH1 + headerH2 / 2);
    ctx.fillText("数量(件)", (colX[3] + colRight[3]) / 2, topY + headerH1 + headerH2 / 2);
    ctx.fillText("金额(元)", (colX[4] + colRight[4]) / 2, topY + headerH1 + headerH2 / 2);
    // 数据行
    ctx.font = `20px ${CJK}`;
    rows.forEach((r, i) => {
      const y = topY + headerH1 + headerH2 + (i + 0.5) * rowH;
      ctx.font = `bold 20px ${CJK}`; ctx.fillText(r.product, (colX[0] + colRight[0]) / 2, y);
      ctx.font = `20px ${MONO}`;
      r.cells.forEach((c, j) => {
        ctx.fillText(c, (colX[1 + j] + colRight[1 + j]) / 2, y);
      });
    });
    // 标题
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `bold 26px ${CJK}`; ctx.fillStyle = "#111";
    ctx.fillText("2026 上半年季度销售报表(单位:元)", 40, 28);
  });
  // ground-truth:语义化纯文本(行内 tab 分隔,合并单元格用「合并标识」清晰化)
  const truth = [
    "产品\tQ1 第一季度\t\tQ2 第二季度\t",
    "\t数量(件)\t金额(元)\t数量(件)\t金额(元)",
    `${rows[0].product}\t${rows[0].cells.join("\t")}`,
    `${rows[1].product}\t${rows[1].cells.join("\t")}`,
    `${rows[2].product}\t${rows[2].cells.join("\t")}`,
  ].join("\n");
  writeFix("s9_table", png, truth);
}

// ── s10 VQA(可数元素图:3 红 + 2 绿苹果) ──
// glm-vision 强项维度:VQA(看图问答) —— 元素计数 + 颜色识别
// ground-truth = 预期答案(数字 + 颜色 + 名词,语义化)
{
  const W = 700, H = 360;
  // 3 个红苹果 + 2 个绿苹果,canvas 画圆 + 顶部小叶 + 高光
  const apples = [
    { x: 110, y: 200, color: "#e23b3b", dark: "#a01f1f" }, // 红 1
    { x: 230, y: 200, color: "#e23b3b", dark: "#a01f1f" }, // 红 2
    { x: 350, y: 200, color: "#e23b3b", dark: "#a01f1f" }, // 红 3
    { x: 470, y: 200, color: "#7cb342", dark: "#558b2f" }, // 绿 1
    { x: 590, y: 200, color: "#7cb342", dark: "#558b2f" }, // 绿 2
  ];
  const png = render(W, H, "#fafafa", (ctx) => {
    // 标题
    ctx.fillStyle = "#333"; ctx.font = `22px ${CJK}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("数一数图中有几个苹果", 30, 36);
    for (const a of apples) {
      // 苹果主体(略压扁的圆)
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, 38, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      // 暗部(右下)
      ctx.fillStyle = a.dark;
      ctx.beginPath();
      ctx.ellipse(a.x + 12, a.y + 10, 14, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // 高光(左上)
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.ellipse(a.x - 12, a.y - 12, 8, 5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // 叶子
      ctx.fillStyle = "#4caf50";
      ctx.beginPath();
      ctx.ellipse(a.x + 6, a.y - 36, 10, 5, -0.6, 0, Math.PI * 2);
      ctx.fill();
      // 茎
      ctx.strokeStyle = "#5d4037"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 32); ctx.lineTo(a.x + 2, a.y - 42); ctx.stroke();
    }
  });
  // ground-truth:VQA 答案(question 与 desc 的对齐口径)
  const question = "图中有几个红苹果?几个绿苹果?";
  const answer = "3 个红苹果,2 个绿苹果";
  const truth = `Q: ${question}\nA: ${answer}`;
  writeFix("s10_vqa", png, truth);
}

console.log("\n9 个可控夹具生成完毕 → doc/OCR_测试集/");
