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

console.log("\n7 个可控夹具生成完毕 → doc/OCR_测试集/");
