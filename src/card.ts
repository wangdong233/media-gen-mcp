import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 文本卡片 / OG / social card(Satori + resvg)—— 结构化字段 → SVG → PNG。
 * 用户说"给这篇文章生成一张分享卡片" → Claude 调 generate_card(title=..., subtitle=...) → PNG(1200×630)。
 *
 * 字体策略:Satori 必须传入字体数据(ArrayBuffer)。
 *  - 默认从 jsDelivr @fontsource 按需取(Inter,Latin),磁盘+内存缓存(~/.media-gen-mcp/fonts/)。
 *  - 中文/自定义字体:传 fontPath 指向本地 .ttf/.otf/.woff(中文卡片需 CJK 字体,默认 Inter 仅 Latin)。
 * 这是第二个联网工具(与 icon 同);fontPath 可完全离线。
 */

const FONT_CACHE_DIR = path.join(os.homedir(), ".media-gen-mcp", "fonts");
const FONT_CDN = "https://cdn.jsdelivr.net/npm/@fontsource";
const memFontCache = new Map<string, ArrayBuffer>();

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: "normal";
}

/** 从 Buffer 取独立 ArrayBuffer(Buffer.buffer 可能是 ArrayBuffer,需显式窄化)。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = buf.buffer as ArrayBuffer;
  return ab.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadFont(
  family: string,
  weight: FontWeight,
  fontPath?: string,
): Promise<LoadedFont> {
  if (fontPath) {
    const buf = await fs.readFile(fontPath);
    return { name: family, data: toArrayBuffer(buf), weight, style: "normal" };
  }
  const key = `${family.toLowerCase()}@${weight}`;
  const cached = memFontCache.get(key);
  if (cached) return { name: family, data: cached, weight, style: "normal" };

  await fs.mkdir(FONT_CACHE_DIR, { recursive: true });
  const file = path.join(FONT_CACHE_DIR, `${key}.woff`);
  let buf: Buffer;
  if (fsSync.existsSync(file)) {
    buf = await fs.readFile(file);
  } else {
    const pkg = family.toLowerCase();
    const url = `${FONT_CDN}/${pkg}/files/${pkg}-latin-${weight}-normal.woff`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e: any) {
      throw new Error(
        `default font fetch failed (card tool needs network for default font): ${e?.message ?? String(e)}. Provide fontPath for offline use.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `default font "${family}" weight ${weight} unavailable (${res.status}). Try a different fontFamily or pass fontPath.`,
      );
    }
    buf = Buffer.from(await res.arrayBuffer());
    try {
      await fs.writeFile(file, buf);
    } catch {
      /* 缓存写失败不阻塞 */
    }
  }
  const ab = toArrayBuffer(buf);
  memFontCache.set(key, ab);
  return { name: family, data: ab, weight, style: "normal" };
}

export interface CardRequest {
  /** 主标题(必填)。 */
  title: string;
  subtitle?: string;
  /** 正文/描述(较长)。 */
  body?: string;
  /** 页脚(作者/日期/域名)。 */
  footer?: string;
  /** 布局模板:og(默认,左对齐层次)/ quote(居中引言)/ minimal(标题+副标题)。 */
  template?: "og" | "quote" | "minimal";
  width?: number;
  height?: number;
  /** 背景色。 */
  bg?: string;
  /** 文字主色。 */
  color?: string;
  /** 强调色(竖条/页脚)。 */
  accent?: string;
  /** 字体族(默认 Inter,仅 Latin;中文需 fontPath 指向 CJK 字体)。 */
  fontFamily?: string;
  /** 本地字体文件路径(.ttf/.otf/.woff)。 */
  fontPath?: string;
  format?: "svg" | "png";
  name?: string;
}

export interface CardRenderOutput {
  svg: string;
  png?: Buffer;
}

// Satori VNode(无 React 依赖的对象形式)
type Node = { type: string; props: { style?: any; children?: any } };

function txt(text: string, style: any): Node {
  return { type: "div", props: { style, children: text } };
}

/** og 模板:列布局 [内容行(flex:1) + 页脚],内容行 = 竖强调条 + 文本列。纯 flex,无 absolute。 */
function layoutOG(req: CardRequest, opts: { title: any; sub: any; body: any; footer: any; accent: string }): Node {
  const textChildren: Node[] = [opts.title];
  if (opts.sub) textChildren.push(opts.sub);
  if (opts.body) textChildren.push(opts.body);
  const textColumn: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flex: 1,
        gap: 24,
        paddingLeft: 16,
      },
      children: textChildren,
    },
  };
  const accentBar: Node = {
    type: "div",
    props: { style: { width: 12, height: "100%", background: opts.accent, flexShrink: 0 } },
  };
  const contentRow: Node = {
    type: "div",
    props: {
      style: { display: "flex", flex: 1, width: "100%", alignItems: "stretch" },
      children: [accentBar, textColumn],
    },
  };
  const outerChildren: Node[] = [contentRow];
  if (opts.footer) {
    outerChildren.push({
      type: "div",
      props: {
        style: { display: "flex", paddingLeft: 28, color: opts.footer.props.style.color },
        children: [opts.footer],
      },
    });
  }
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "80px 80px 56px 104px",
      },
      children: outerChildren,
    },
  };
}

/** quote 模板:居中大字引言。 */
function layoutQuote(req: CardRequest, opts: { body: any; footer: any; accent: string; color: string }): Node {
  const inner: Node[] = [];
  inner.push(txt("“", { fontSize: 160, color: opts.accent, lineHeight: 1, marginBottom: -40 }));
  if (opts.body) inner.push(opts.body);
  if (opts.footer) inner.push(opts.footer);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: "0 120px",
        gap: 28,
      },
      children: inner,
    },
  };
}

/** minimal 模板:仅居中标题 + 副标题。 */
function layoutMinimal(opts: { title: any; sub: any }): Node {
  const inner: Node[] = [opts.title];
  if (opts.sub) inner.push(opts.sub);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: "0 100px",
        gap: 24,
      },
      children: inner,
    },
  };
}

export async function renderCard(req: CardRequest): Promise<CardRenderOutput> {
  if (!req.title || !req.title.trim()) throw new Error("`title` is required");

  const width = req.width && req.width > 0 ? Math.floor(req.width) : 1200;
  const height = req.height && req.height > 0 ? Math.floor(req.height) : 630;
  const bg = req.bg && req.bg.trim() ? req.bg.trim() : "#0f172a";
  const color = req.color && req.color.trim() ? req.color.trim() : "#f8fafc";
  const accent = req.accent && req.accent.trim() ? req.accent.trim() : "#6366f1";
  const family = req.fontFamily && req.fontFamily.trim() ? req.fontFamily.trim() : "Inter";
  const template = req.template ?? "og";

  const muted = "#94a3b8";

  const fonts = await Promise.all([
    loadFont(family, 400, req.fontPath),
    loadFont(family, 700, req.fontPath),
  ]);

  // 颜色降级:若 fontPath 加载失败已经抛错;此处字体已就绪
  const titleNode = txt(req.title, { fontSize: 76, fontWeight: 700, color, lineHeight: 1.15, letterSpacing: -1 });
  const subNode = req.subtitle
    ? txt(req.subtitle, { fontSize: 40, fontWeight: 700, color: accent, lineHeight: 1.2 })
    : null;
  const bodyNode = req.body ? txt(req.body, { fontSize: 32, color: muted, lineHeight: 1.4 }) : null;
  const footerNode = req.footer ? txt(req.footer, { fontSize: 28, color: muted }) : null;

  let layout: Node;
  if (template === "quote") {
    layout = layoutQuote(req, { body: bodyNode, footer: footerNode, accent, color });
  } else if (template === "minimal") {
    layout = layoutMinimal({ title: titleNode, sub: subNode });
  } else {
    layout = layoutOG(req, { title: titleNode, sub: subNode, body: bodyNode, footer: footerNode, accent });
  }

  const svg = await satori(
    { type: "div", props: { style: { width: "100%", height: "100%", background: bg, display: "flex" }, children: layout } },
    { width, height, fonts },
  );

  let png: Buffer | undefined;
  if (req.format === "png") {
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: bg });
    png = Buffer.from(resvg.render().asPng());
  }
  return { svg, png };
}
