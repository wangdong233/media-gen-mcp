import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { contrastRatio as _cr, parseAllHex as _pah } from "./color-utils.js";
import os from "node:os";
import { createRequire } from "node:module";

/**
 * 文本卡片 / OG / social card(Satori + resvg)—— 结构化字段 → SVG → PNG。
 * 用户说"给这篇文章生成一张分享卡片" → Claude 调 generate_card(title=..., subtitle=...) → PNG(1200×630)。
 *
 * 字体策略:Satori 必须传入字体数据(ArrayBuffer)。
 *  - 默认 Geist 内置(@fontsource/geist-sans,离线);非默认字体从 jsDelivr @fontsource 按需取。
 *  - **CJK(中日韩)内置**:依赖 @fontsource/noto-sans-sc,文本含 CJK 时自动加载其 chinese-simplified
 *    子集(.woff;Satori 不支持 woff2)作为回退字体,逐字形回退,无需用户配置、离线可用。
 *  - 自定义字体:传 fontPath 指向本地 .ttf/.otf/.woff(覆盖默认;CJK 仍叠加 Noto 回退兜底)。
 * 第二个联网工具(与 icon 同);fontPath 或已缓存的 CJK 字体可离线。
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
    let buf: Buffer;
    try {
      buf = await fs.readFile(fontPath);
    } catch (e: any) {
      const code = (e as NodeJS.ErrnoException)?.code;
      throw new Error(
        `fontPath "${fontPath}" 读取失败:${code === "ENOENT" ? "文件不存在" : code || "IO/权限错误"}。可去掉 fontPath 用默认字体,或指向 .ttf/.otf/.woff 字体文件。`,
      );
    }
    return { name: family, data: toArrayBuffer(buf), weight, style: "normal" };
  }
  // 默认 Geist 优先走本地 bundle(离线确定性);不可用回退 CDN
  if (family.toLowerCase() === "geist") {
    const geist = await loadGeistFont(weight);
    if (geist) return geist;
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
        `fontFamily fetch failed (non-default @fontsource fontFamily needs network; offline: pass fontPath): ${e?.message ?? String(e)}.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `fontFamily "${family}" fetch failed (HTTP ${res.status}) — pass the @fontsource package slug exactly (lowercase with hyphens, e.g. "open-sans"), or use fontPath for a local font file.`,
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

// ── CJK 内置字体(Noto Sans SC chinese-simplified 子集,从 @fontsource 依赖读取,离线) ──
const CJK_FAMILY = "Noto Sans SC";
const CJK_FONT_KEY = "noto-sans-sc-cjk";
let cjkFontDirResolved: string | null | undefined; // undefined=未探测

/** 定位 @fontsource/noto-sans-sc 的 files 目录;失败返回 null(降级,不崩)。 */
function resolveCjkFontDir(): string | null {
  if (cjkFontDirResolved !== undefined) return cjkFontDirResolved;
  try {
    const pkgPath = createRequire(import.meta.url).resolve(
      "@fontsource/noto-sans-sc/package.json",
    );
    cjkFontDirResolved = path.join(path.dirname(pkgPath), "files");
  } catch {
    cjkFontDirResolved = null;
  }
  return cjkFontDirResolved;
}

/** 加载 CJK 字体(400/700);不可用返回 null(调用方降级,中文回退 tofu 但不阻断)。 */
async function loadCJKFont(weight: FontWeight): Promise<LoadedFont | null> {
  const key = `${CJK_FONT_KEY}@${weight}`;
  const cached = memFontCache.get(key);
  if (cached) return { name: CJK_FAMILY, data: cached, weight, style: "normal" };
  const dir = resolveCjkFontDir();
  if (!dir) return null;
  const file = path.join(dir, `noto-sans-sc-chinese-simplified-${weight}-normal.woff`);
  try {
    if (!fsSync.existsSync(file)) return null;
    const buf = await fs.readFile(file);
    const ab = toArrayBuffer(buf);
    memFontCache.set(key, ab);
    return { name: CJK_FAMILY, data: ab, weight, style: "normal" };
  } catch {
    return null;
  }
}

// ── Geist 内置 Latin 字体(@fontsource/geist-sans,离线;默认正文字体)──
const GEIST_FAMILY = "Geist";
const GEIST_FONT_KEY = "geist-latin";
let geistFontDirResolved: string | null | undefined;

/** 定位 @fontsource/geist-sans 的 files 目录;失败返回 null(降级 CDN,不崩)。 */
function resolveGeistFontDir(): string | null {
  if (geistFontDirResolved !== undefined) return geistFontDirResolved;
  try {
    const pkgPath = createRequire(import.meta.url).resolve(
      "@fontsource/geist-sans/package.json",
    );
    geistFontDirResolved = path.join(path.dirname(pkgPath), "files");
  } catch {
    geistFontDirResolved = null;
  }
  return geistFontDirResolved;
}

/** 加载 Geist Latin 字体(指定 weight);不可用返回 null(调用方降级 CDN/fontPath)。 */
async function loadGeistFont(weight: FontWeight): Promise<LoadedFont | null> {
  const key = `${GEIST_FONT_KEY}@${weight}`;
  const cached = memFontCache.get(key);
  if (cached) return { name: GEIST_FAMILY, data: cached, weight, style: "normal" };
  const dir = resolveGeistFontDir();
  if (!dir) return null;
  const file = path.join(dir, `geist-sans-latin-${weight}-normal.woff`);
  try {
    if (!fsSync.existsSync(file)) return null;
    const buf = await fs.readFile(file);
    const ab = toArrayBuffer(buf);
    memFontCache.set(key, ab);
    return { name: GEIST_FAMILY, data: ab, weight, style: "normal" };
  } catch {
    return null;
  }
}

/** 检测文本是否含 CJK 统一表意 / 扩展 A 字符。 */
const CJK_RE = /[一-鿿㐀-䶿]/;
function hasCJK(text: string | undefined | null): boolean {
  return !!text && CJK_RE.test(text);
}

/** 检测背景值是否为 CSS 渐变串(linear-gradient/radial-gradient/conic-gradient)。 */
function isGradient(bg: string): boolean {
  return /gradient\s*\(/i.test(bg);
}

/** 把颜色转成 rgba(...,alpha)。复用 parseHex(消除重复解析);无 hex 兜底白色。 */
function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : `rgba(255,255,255,${alpha})`;
}

/** 解析颜色串首个 #hex(#RGB/#RRGGBB;渐变取首个 stop)→ [r,g,b];无 hex 返回 null。 */
function parseHex(color: string): [number, number, number] | null {
  const m = color.match(/#([0-9a-f]{6}|[0-9a-f]{3})/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** WCAG 相对亮度(渐变取首个 hex stop)。无 hex 返回 null。用于 muted/blob/panel 随 bg 明暗自适应。 */
function luminanceOf(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function isLightBg(bg: string): boolean {
  const l = luminanceOf(bg);
  return l != null && l > 0.5; // 0.5 = 自定义启发式阈值(非 WCAG AA 4.5),作 muted/blob/panel 明暗自适应
}
/** WCAG 对比度(1.0=无对比)。取两色首个 hex;任一无 hex 返回 null。 */
function contrastRatio(c1: string, c2: string): number | null {
  const l1 = luminanceOf(c1), l2 = luminanceOf(c2);
  if (l1 == null || l2 == null) return null;
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

// ── emoji(twemoji PNG via CDN,data URI 内联以便 resvg 渲染) ──
const TWEMOJI_PNG_CDN = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";
const EMOJI_CACHE_DIR = path.join(os.homedir(), ".media-gen-mcp", "emoji");
const emojiDataUriCache = new Map<string, string | null>();

/** emoji 字符 → twemoji PNG 的 base64 data URI。
 *  三级缓存:内存 → 磁盘(~/.media-gen-mcp/emoji/) → CDN。
 *  落盘保证:成功取过一次即跨重启/跨代理抖动复用(VPN 间歇拦 jsDelivr 时仍可用)。
 *  fetch 失败返回 undefined(降级 tofu,不阻断)。 */
async function emojiToDataUri(segment: string): Promise<string | undefined> {
  // codepoint:过滤 variation selector FE0F,保留 ZWJ 200D(序列 emoji)
  const cp = [...segment]
    .map((c) => c.codePointAt(0)!)
    .filter((p) => p !== 0xfe0f)
    .map((p) => p.toString(16))
    .join("-");
  // 1. 内存缓存(含负缓存:null = 本进程内已知取不到)
  if (emojiDataUriCache.has(cp)) return emojiDataUriCache.get(cp) ?? undefined;

  let buf: Buffer | undefined;
  // 2. 磁盘缓存
  const file = path.join(EMOJI_CACHE_DIR, `${cp}.png`);
  try {
    if (fsSync.existsSync(file)) buf = await fs.readFile(file);
  } catch {
    buf = undefined;
  }
  // 3. CDN 取(磁盘未命中)
  if (!buf) {
    const url = `${TWEMOJI_PNG_CDN}/${cp}.png`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer());
        // 落盘(失败不阻断)
        try {
          await fs.mkdir(EMOJI_CACHE_DIR, { recursive: true });
          await fs.writeFile(file, buf);
        } catch {
          /* 磁盘写失败忽略 */
        }
      }
    } catch {
      buf = undefined;
    }
  }

  if (!buf) {
    emojiDataUriCache.set(cp, null); // 本进程负缓存(避免代理 down 时反复请求;重启重试)
    return undefined;
  }
  const uri = `data:image/png;base64,${buf.toString("base64")}`;
  emojiDataUriCache.set(cp, uri);
  return uri;
}

export interface CardRequest {
  /** 主标题(必填)。 */
  title: string;
  subtitle?: string;
  /** 正文/描述(较长)。 */
  body?: string;
  /** 页脚(作者/日期/域名)。 */
  footer?: string;
  /** 布局模板:og(默认,左对齐层次)/ quote(居中引言)/ minimal(标题+副标题)/ hero(居中大字展示)/ panel(玻璃面板)。 */
  template?: "og" | "quote" | "minimal" | "hero" | "panel";
  width?: number;
  height?: number;
  /** 背景色或 CSS 渐变串。 */
  bg?: string;
  /** 文字主色。 */
  color?: string;
  /** 强调色(竖条/页脚/辉光派生)。 */
  accent?: string;
  /** 标题文字渐变(CSS gradient 串,如 linear-gradient(90deg,#f59e0b,#ef4444));走 background-clip:text。 */
  titleGradient?: string;
  /** 标题辉光(text-shadow)。true=用 accent 派生;字符串=直接作 text-shadow 值(如 "0 0 40px rgba(245,158,11,.6)")。 */
  glow?: boolean | string;
  /** hero 模板:标题背后加模糊光斑(filter:blur)做纵深感,默认 true。 */
  blob?: boolean;
  /** quote 模板引号样式:"top"(默认,大引号在文字上方)或 "flank"(左右大引号夹住文字、同行包裹)。 */
  quoteStyle?: "top" | "flank";
  /** 内嵌图片(logo/avatar/品牌标):URL、data URI 或本地文件路径(.png/.jpg/.webp/.svg)。置于内容顶部。 */
  logo?: string;
  /** logo 像素尺寸(边长,默认 88)。 */
  logoSize?: number;
  /** logo 是否圆形(avatar 用,默认 false=圆角方形)。 */
  logoRound?: boolean;
  /** 字体族(默认 Geist,内置离线;中文自动叠加 Noto Sans SC;自定义传 fontPath)。 */
  fontFamily?: string;
  /** 本地字体文件路径(.ttf/.otf/.woff)。 */
  fontPath?: string;
  format?: "svg" | "png";
}

export interface CardRenderOutput {
  svg: string;
  png?: Buffer;
  warnings?: string[];
}

// Satori VNode(无 React 依赖的对象形式)
type CardStyle = Record<string, unknown>;
type Node = { type: string; props: { style?: CardStyle; children?: string | Node | (string | Node)[]; src?: string } };

function txt(text: string, style: CardStyle): Node {
  return { type: "div", props: { style, children: text } };
}

/** og 模板:列布局 [内容行(flex:1) + 页脚],内容行 = 竖强调条 + 文本列。纯 flex,无 absolute。 */
function layoutOG(opts: { title: Node; sub: Node | null; body: Node | null; footer: Node | null; logo: Node | null; accent: string }): Node {
  const textChildren: Node[] = [];
  if (opts.logo) textChildren.push(opts.logo);
  textChildren.push(opts.title);
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
        style: { display: "flex", paddingLeft: 28 },
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

/** quote 模板:居中引言。quoteStyle:"top"(默认,大引号在文字上方)或 "flank"(左右大引号夹住文字、同行 baseline 对齐)。title(必填)作引言,body 可选副行,footer 作署名。 */
function layoutQuote(req: CardRequest, opts: { title: Node; body: Node | null; footer: Node | null; logo: Node | null; accent: string; fontStack: string }): Node {
  const inner: Node[] = [];
  if (opts.logo) inner.push(opts.logo);
  if (req.quoteStyle === "flank") {
    // 左右大引号夹住引言,同行 baseline 对齐(引号比文字大,形成包裹)
    inner.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "center",
          gap: 28,
        },
        children: [
          txt("“", { fontFamily: opts.fontStack, fontSize: 150, color: opts.accent, lineHeight: 1 }),
          opts.title,
          txt("”", { fontFamily: opts.fontStack, fontSize: 150, color: opts.accent, lineHeight: 1 }),
        ],
      },
    });
  } else {
    inner.push(txt("“", { fontFamily: opts.fontStack, fontSize: 160, color: opts.accent, lineHeight: 1, marginBottom: -40 }));
    inner.push(opts.title);
  }
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
function layoutMinimal(opts: { title: Node; sub: Node | null; logo: Node | null }): Node {
  const inner: Node[] = [];
  if (opts.logo) inner.push(opts.logo);
  inner.push(opts.title);
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

/** hero 模板:居中大字标题(+可选模糊光斑纵深感)+ 副标题 + 可选页脚(credit/署名)。展示型。 */
function layoutHero(opts: { title: Node; sub: Node | null; footer: Node | null; logo: Node | null; accent: string; bg: string; blob: boolean }): Node {
  const contentChildren: Node[] = [];
  if (opts.logo) contentChildren.push(opts.logo);
  contentChildren.push(opts.title);
  if (opts.sub) contentChildren.push(opts.sub);
  if (opts.footer) {
    // credit/署名:副标题下方,小字 muted,与展示主区分开
    contentChildren.push({
      type: "div",
      props: { style: { display: "flex", marginTop: 16 }, children: [opts.footer] },
    });
  }
  const content: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
      },
      children: contentChildren,
    },
  };
  const outerChildren: Node[] = [];
  if (opts.blob) {
    // 模糊光斑:绝对定位在内容背后,filter:blur 做纵深
    outerChildren.push({
      type: "div",
      props: {
        style: {
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: isLightBg(opts.bg) ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.18)",
          filter: "blur(120px)",
          opacity: 0.55,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        },
      },
    });
  }
  outerChildren.push(content);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: "0 90px",
        position: "relative",
      },
      children: outerChildren,
    },
  };
}

/** panel 模板:标题/副标题/正文置于玻璃面板(border+圆角+阴影+半透明)内,浮于背景。 */
function layoutPanel(opts: { title: Node; sub: Node | null; body: Node | null; footer: Node | null; logo: Node | null; accent: string; bg: string }): Node {
  const inner: Node[] = [];
  if (opts.logo) inner.push(opts.logo);
  inner.push(opts.title);
  if (opts.sub) inner.push(opts.sub);
  if (opts.body) inner.push(opts.body);
  const panel: Node = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "60px 64px",
        borderRadius: 28,
        border: isLightBg(opts.bg) ? "2px solid rgba(15,23,42,0.10)" : "2px solid rgba(255,255,255,0.12)",
        boxShadow: isLightBg(opts.bg) ? "0 30px 80px rgba(0,0,0,0.12)" : "0 30px 80px rgba(0,0,0,0.45)",
        background: isLightBg(opts.bg) ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.05)",
        maxWidth: 880,
      },
      children: inner,
    },
  };
  const outerChildren: Node[] = [panel];
  if (opts.footer) {
    outerChildren.push({
      type: "div",
      props: { style: { display: "flex", marginTop: 8 }, children: [opts.footer] },
    });
  }
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
        padding: "0 80px",
      },
      children: outerChildren,
    },
  };
}

/** 图片源解析:URL/data URI 原样;本地文件路径 → base64 data URI(按扩展名定 mime)。本地文件读失败抛错(与 fontPath 一致,不静默丢弃)。 */
async function resolveImageSrc(src: string): Promise<string> {
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) return src;
  const buf = await fs.readFile(src); // ENOENT/EACCES 等向上抛,让用户看到 logo 路径错了
  const ext = path.extname(src).toLowerCase();
  const mime =
    ext === ".svg" ? "image/svg+xml"
    : ext === ".png" ? "image/png"
    : ext === ".gif" ? "image/gif"
    : ext === ".webp" ? "image/webp"
    : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function renderCard(req: CardRequest): Promise<CardRenderOutput> {
  if (!req.title || !req.title.trim()) throw new Error("`title` is required");

  const width = req.width && req.width > 0 ? Math.floor(req.width) : 1200;
  const height = req.height && req.height > 0 ? Math.floor(req.height) : 630;
  const bg = req.bg && req.bg.trim() ? req.bg.trim() : "#0f172a";
  const color = req.color && req.color.trim() ? req.color.trim() : "#f8fafc";
  const accent = req.accent && req.accent.trim() ? req.accent.trim() : "#0d9488";
  const family = req.fontFamily && req.fontFamily.trim() ? req.fontFamily.trim() : "Geist";
  const template = req.template ?? "og";
  const warnings: string[] = [];
  const KNOWN_TPL = new Set(["og", "quote", "minimal", "hero", "panel"]);
  if (req.template && !KNOWN_TPL.has(req.template)) {
    warnings.push(`template "${req.template}" 未知,回退 og(支持:og/quote/minimal/hero/panel)。`);
  }
  const accentBgContrast = contrastRatio(accent, bg);
  if (accentBgContrast != null && accentBgContrast < 3.0) {
    warnings.push(`accent "${accent}" 与 bg 对比度过低(${accentBgContrast.toFixed(2)}:1),副标题/装饰条可能不可读(WCAG 大字 AA 需 ≥3:1),建议换 accent。`);
  }
  // 标题 color vs bg 对比(审查发现:默认浅色 color 在浅 bg 上标题消失)
  const colorBgContrast = contrastRatio(color, bg);
  if (colorBgContrast != null && colorBgContrast < 3.0) {
    warnings.push(`title color "${color}" 与 bg 对比度过低(${colorBgContrast.toFixed(2)}:1),标题可能不可见,建议改 color 或 bg。`);
  }
  // titleGradient 停止色 vs bg(渐变标题在浅 bg 上可能不可见)
  if (req.titleGradient) {
    const stops = _pah(req.titleGradient);
    if (stops.length > 0) {
      const allLowContrast = stops.every((s) => {
        const cr = contrastRatio(`#${s[0].toString(16).padStart(2,"0")}${s[1].toString(16).padStart(2,"0")}${s[2].toString(16).padStart(2,"0")}`, bg);
        return cr != null && cr < 3.0;
      });
      if (allLowContrast) warnings.push(`titleGradient 停止色在 bg 上对比度均 <3:1,渐变标题可能不可见,建议停止色与 bg 拉开亮度差。`);
    }
  }
  // 画布过小/过大(内容裁切/体积过大)
  if (width < 320 || height < 200) warnings.push(`画布 ${width}×${height} 过小,内容可能被裁;建议 ≥320×200。`);
  if (width > 4000 || height > 4000) warnings.push(`画布 ${width}×${height} 过大,PNG 体积大且字偏小;建议 ≤4000。`);

  const muted = isLightBg(bg) ? "#475569" : "#94a3b8";

  // CJK 检测:任一字段含 CJK → 加载内置 Noto Sans SC 作为回退,逐字形回退
  const needsCJK =
    hasCJK(req.title) || hasCJK(req.subtitle) || hasCJK(req.body) || hasCJK(req.footer);

  // fontPath(单文件):只注册 400,Satori 对 700 回退到它(单文件无真粗体,诚实);
  // 默认(CDN)分别取 400 与 700 两份(支持粗体)。
  // 显式 CJK family(Noto Sans SC/微软雅黑/苹方等)→ 用内置 CJK 字体(免 CDN latin-700 404;S03/S15 场景 bug 修复)
  const isCjkFamily = /noto.?sans.?(sc|cjk)|microsoft.?yahei|pingfang|simhei|simsun|source.?han/i.test(family);
  const baseFonts: LoadedFont[] = req.fontPath
    ? [await loadFont(family, 400, req.fontPath)]
    : isCjkFamily
      ? (await Promise.all([loadCJKFont(400), loadCJKFont(700)])).filter((f): f is LoadedFont => f !== null)
      : await Promise.all([loadFont(family, 400), loadFont(family, 700)]);
  let fonts: LoadedFont[] = [...baseFonts];
  if (needsCJK) {
    const cjk = await Promise.all([loadCJKFont(400), loadCJKFont(700)]);
    fonts = fonts.concat(cjk.filter((f): f is LoadedFont => f !== null));
  }
  // fontFamily 栈:needsCJK 时 base + Noto Sans SC;Satori 按栈逐字形回退
  const fontStack = needsCJK ? `${family}, ${CJK_FAMILY}` : family;

  // 标题特效:titleGradient(渐变文字 background-clip:text)+ glow(text-shadow 辉光)
  const titleGradient =
    typeof req.titleGradient === "string" && req.titleGradient.trim() ? req.titleGradient.trim() : undefined;
  const glowRaw = req.glow;
  let glowValue: string | undefined;
  if (glowRaw === true) {
    glowValue = `0 0 40px ${withAlpha(accent, 0.6)}`;
  } else if (typeof glowRaw === "string") {
    const t = glowRaw.trim().toLowerCase();
    if (t === "true" || t === "") glowValue = `0 0 40px ${withAlpha(accent, 0.6)}`; // "true" → 同 boolean true 自动派生
    else if (t && t !== "false") glowValue = glowRaw.trim(); // 自定义 text-shadow 值
  }
  const titleSize = template === "hero" ? 104 : template === "panel" ? 72 : 76;
  const titleStyle: Record<string, unknown> = {
    fontFamily: fontStack,
    fontSize: titleSize,
    fontWeight: 600,
    lineHeight: 1.12,
    letterSpacing: -Math.round(titleSize * 0.04),
    fontFeatureSettings: "'ss03', 'calt', 'liga', 'kern'",
  };
  if (titleGradient) {
    // 渐变文字:Satori 用 mask 把渐变裁到字形
    titleStyle.backgroundImage = titleGradient;
    titleStyle.backgroundClip = "text";
    titleStyle.WebkitBackgroundClip = "text";
    titleStyle.color = "transparent";
  } else {
    titleStyle.color = color;
  }
  if (glowValue && titleGradient) {
    // 互斥:渐变文字(text 裁到渐变)会丢 text-shadow → glow 静默失效,schema 已声明不兼容,显式 warn
    warnings.push("titleGradient 与 glow 不兼容(渐变文字会裁掉阴影),已忽略 glow。");
  } else if (glowValue) {
    titleStyle.textShadow = glowValue;
  }

  const titleNode = txt(req.title, titleStyle);
  const subNode = req.subtitle
    ? txt(req.subtitle, { fontFamily: fontStack, fontSize: 40, fontWeight: 500, color: accent, lineHeight: 1.2 })
    : null;
  const bodyNode = req.body ? txt(req.body, { fontFamily: fontStack, fontSize: 32, color: muted, lineHeight: 1.5 }) : null;
  const footerNode = req.footer ? txt(req.footer, { fontFamily: fontStack, fontSize: 28, color: muted }) : null;

  // logo:URL/data URI/本地路径 → Satori <img>(置于内容顶部)。本地路径读失败会抛错。
  let logoNode: Node | null = null;
  if (typeof req.logo === "string" && req.logo.trim()) {
    const logoSrc = await resolveImageSrc(req.logo.trim());
    const ls = req.logoSize && req.logoSize > 0 ? Math.floor(req.logoSize) : 88;
    logoNode = {
      type: "img",
      props: { src: logoSrc, style: { width: ls, height: ls, borderRadius: req.logoRound ? ls / 2 : 20 } },
    };
  }

  // 模板丢字段 warning(让用户知道哪些字段被该模板忽略,避免"传了以为生效")
  if (template === "minimal" && (req.body?.trim() || req.footer?.trim())) {
    warnings.push("body/footer 在 minimal 模板不渲染,已忽略(用 og/panel 渲染正文)。");
  }
  if (template === "hero" && req.body?.trim()) {
    warnings.push("body 在 hero 模板不渲染,已忽略(用 og/panel 渲染正文)。");
  }
  if (template === "quote" && req.subtitle?.trim()) {
    warnings.push("subtitle 在 quote 模板不渲染,已忽略。");
  }
  // 模板专属参数丢弃 warning(B10 丢弃必告警:传了"仅 X 模板消费"的参数但模板不是 X,不静默)。
  // 触发条件是「显式传入」(undefined = 未传,不警告);hero 消费 blob、quote 消费 quoteStyle 时不警告。
  if (req.blob !== undefined && template !== "hero") {
    warnings.push("blob 仅 hero 模板消费,已忽略(当前模板无标题光斑层)。");
  }
  if (req.quoteStyle != null && template !== "quote") {
    warnings.push(`quoteStyle 仅 quote 模板消费,已忽略(当前模板 ${template} 无引号布局)。`);
  }
  let layout: Node;
  if (template === "quote") {
    layout = layoutQuote(req, { title: titleNode, body: bodyNode, footer: footerNode, logo: logoNode, accent, fontStack });
  } else if (template === "minimal") {
    layout = layoutMinimal({ title: titleNode, sub: subNode, logo: logoNode });
  } else if (template === "hero") {
    layout = layoutHero({ title: titleNode, sub: subNode, footer: footerNode, logo: logoNode, accent, bg, blob: req.blob !== false });
  } else if (template === "panel") {
    layout = layoutPanel({ title: titleNode, sub: subNode, body: bodyNode, footer: footerNode, logo: logoNode, accent, bg });
  } else {
    layout = layoutOG({ title: titleNode, sub: subNode, body: bodyNode, footer: footerNode, logo: logoNode, accent });
  }

  // 渐变背景:bg 为 CSS gradient 串(linear/radial-gradient(...))→ Satori 用 backgroundImage 烘焙;
  // 纯色 → background。resvg 渲染 PNG 时,渐变已在 SVG 内(不能再传纯色 background,否则解析报错)。
  const bgIsGradient = isGradient(bg);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          ...(bgIsGradient ? { backgroundImage: bg } : { background: bg }),
        },
        children: layout,
      },
    },
    {
      width,
      height,
      fonts,
      // emoji:Satori 检测到 emoji 段时回调,返回 twemoji PNG data URI(内联,resvg 可渲染);
      // 非 emoji(CJK 等)返回 undefined,交已注册字体(Noto Sans SC)处理。
      loadAdditionalAsset: async (code: string, segment: string) =>
        code === "emoji" ? await emojiToDataUri(segment) : undefined,
    } as any,
  );

  let png: Buffer | undefined;
  if (req.format === "png") {
    const resvgOpts: ConstructorParameters<typeof Resvg>[1] = { fitTo: { mode: "width", value: width } };
    if (!bgIsGradient) resvgOpts.background = bg; // 仅纯色兜底;渐变已在 SVG 内
    const resvg = new Resvg(svg, resvgOpts);
    png = Buffer.from(resvg.render().asPng());
  }
  return { svg, png, warnings };
}
