import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

/**
 * 文本卡片 / OG / social card(Satori + resvg)—— 结构化字段 → SVG → PNG。
 * 用户说"给这篇文章生成一张分享卡片" → Claude 调 generate_card(title=..., subtitle=...) → PNG(1200×630)。
 *
 * 字体策略:Satori 必须传入字体数据(ArrayBuffer)。
 *  - 默认从 jsDelivr @fontsource 按需取(Inter,Latin),磁盘+内存缓存(~/.media-gen-mcp/fonts/)。
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

/** 检测文本是否含 CJK 统一表意 / 扩展 A 字符。 */
const CJK_RE = /[一-鿿㐀-䶿]/;
function hasCJK(text: string | undefined | null): boolean {
  return !!text && CJK_RE.test(text);
}

/** 检测背景值是否为 CSS 渐变串(linear-gradient/radial-gradient/conic-gradient)。 */
function isGradient(bg: string): boolean {
  return /gradient\s*\(/i.test(bg);
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

/** quote 模板:居中大字引言。title(必填)作引言主体,body 可选副行,footer 作署名。 */
function layoutQuote(req: CardRequest, opts: { title: any; body: any; footer: any; accent: string; color: string; fontStack: string }): Node {
  const inner: Node[] = [];
  inner.push(txt("“", { fontFamily: opts.fontStack, fontSize: 160, color: opts.accent, lineHeight: 1, marginBottom: -40 }));
  inner.push(opts.title);
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

/** hero 模板:居中大字标题(+可选模糊光斑纵深感)+ 副标题。展示型。 */
function layoutHero(opts: { title: any; sub: any; accent: string; blob: boolean }): Node {
  const contentChildren: Node[] = [opts.title];
  if (opts.sub) contentChildren.push(opts.sub);
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
          background: opts.accent,
          filter: "blur(120px)",
          opacity: 0.45,
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
function layoutPanel(opts: { title: any; sub: any; body: any; footer: any; accent: string }): Node {
  const inner: Node[] = [opts.title];
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
        border: "2px solid rgba(255,255,255,0.12)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        background: "rgba(255,255,255,0.05)",
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

  // CJK 检测:任一字段含 CJK → 加载内置 Noto Sans SC 作为回退,逐字形回退
  const needsCJK =
    hasCJK(req.title) || hasCJK(req.subtitle) || hasCJK(req.body) || hasCJK(req.footer);

  const baseFonts = await Promise.all([
    loadFont(family, 400, req.fontPath),
    loadFont(family, 700, req.fontPath),
  ]);
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
  const glowValue =
    glowRaw === true
      ? accent.startsWith("#")
        ? `0 0 40px ${accent}99`
        : "0 0 40px rgba(255,255,255,0.55)"
      : typeof glowRaw === "string" && glowRaw.trim()
        ? glowRaw.trim()
        : undefined;
  const titleSize = template === "hero" ? 104 : template === "panel" ? 72 : 76;
  const titleStyle: Record<string, unknown> = {
    fontFamily: fontStack,
    fontSize: titleSize,
    fontWeight: 700,
    lineHeight: 1.12,
    letterSpacing: -1,
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
  if (glowValue) titleStyle.textShadow = glowValue;

  const titleNode = txt(req.title, titleStyle);
  const subNode = req.subtitle
    ? txt(req.subtitle, { fontFamily: fontStack, fontSize: 40, fontWeight: 700, color: accent, lineHeight: 1.2 })
    : null;
  const bodyNode = req.body ? txt(req.body, { fontFamily: fontStack, fontSize: 32, color: muted, lineHeight: 1.4 }) : null;
  const footerNode = req.footer ? txt(req.footer, { fontFamily: fontStack, fontSize: 28, color: muted }) : null;

  let layout: Node;
  if (template === "quote") {
    layout = layoutQuote(req, { title: titleNode, body: bodyNode, footer: footerNode, accent, color, fontStack });
  } else if (template === "minimal") {
    layout = layoutMinimal({ title: titleNode, sub: subNode });
  } else if (template === "hero") {
    layout = layoutHero({ title: titleNode, sub: subNode, accent, blob: req.blob !== false });
  } else if (template === "panel") {
    layout = layoutPanel({ title: titleNode, sub: subNode, body: bodyNode, footer: footerNode, accent });
  } else {
    layout = layoutOG(req, { title: titleNode, sub: subNode, body: bodyNode, footer: footerNode, accent });
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
  return { svg, png };
}
