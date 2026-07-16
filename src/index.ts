#!/usr/bin/env node
/**
 * media-gen-mcp —— 面向 Claude Code 的多模态(图像+视频)MCP server。
 * provider 可插拔;Agnes AI 为首个实现。详见 README。
 *
 * 工具层不硬编码厂商专有值:约束从 provider.videoConstraints() 读,模型默认交 provider,
 * 默认 provider 名来自 config —— 新增 provider 时本文件无需改动。
 *
 * 视频智能异步:省略 wait 时,按 estimateGenerationSeconds() 估算,>60s 自动转异步
 * (返回 handle + 预估),由调用方(CC)后台轮询 + 完成唤醒通知。
 *
 * 配置:key 与 provider 连接信息从 ~/.media-gen-mcp/config.json 读取(优先于 env),
 * 接入命令不带任何 key —— 新增 provider 只在配置文件加一段(开闭)。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { config } from "./config.js";
import { getProvider, listProviders } from "./providers/registry.js";
import { waitVideo } from "./poll.js";
import { downloadAsset } from "./download.js";
import fs from "node:fs/promises";
import { getDiagramEngine, MERMAID_UNSUPPORTED_MSG } from "./diagram/render.js";
import { renderQR } from "./qr.js";
import { renderChart } from "./chart.js";
import { renderFormula } from "./formula.js";
import { renderIcon } from "./icon.js";
import { renderCard } from "./card.js";
import { renderSvg } from "./render-svg.js";

const ASYNC_THRESHOLD_SECONDS = 60;

const server = new Server(
  { name: "media-gen-mcp", version: "0.4.0" },
  { capabilities: { tools: {} } },
);

function buildTools() {
  // create_video 的 schema 约束按"视频模态默认 provider"展示,与实际路由一致
  // (例:defaultVideoProvider=zhipu 时展示 150/300,而非 agnes 的 81/121/...;handler 仍按实际 provider 复算 vc)
  const vc = getProvider(config.defaultVideoProvider).videoConstraints();

  return [
    {
      name: "generate_image",
      description:
        "Generate or edit an AI image — text-to-image (文生图/AI画图) or image-to-image (图生图, pass `images`) — via free models (Agnes AI default, or Zhipu). Use this for photographic or illustrated subjects (写实图/插画/概念图/Logo 设计图). Output downloads locally and the path is returned. No local rendering libs needed; this calls the AI model for you. Multilingual triggers: 画像 · imagen · image · Bild · изображение · imagem (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image description." },
          model: {
            type: "string",
            description: "Optional; omit to use the provider default. Call list_models to see options.",
          },
          size: { type: "string", description: "e.g. 1024x1024 (provider may snap to nearest preset)." },
          n: { type: "number" },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Image-to-image inputs (public URL or data URI). Omit for text-to-image.",
          },
          download: { type: "boolean", default: true },
          outDir: { type: "string", description: "产物落盘目录,省略用默认(会话目录/output)。" },
          provider: { type: "string", default: config.defaultImageProvider },
        },
        required: ["prompt"],
      },
    },
    {
      name: "create_video",
      description:
        "Create an AI video — text-to-video, image-to-video, or keyframe animation (文生视频/图生视频/关键帧动画/让这张图动起来/做个动画) — via free models (Agnes AI default, or Zhipu). Use this for any '生成视频/做动画' request; no local video tools needed. Smart async: long videos return a handle to poll with get_video; short ones block until done. Multilingual triggers: 動画 · vídeo · vidéo · Video · видео · vídeo (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video content description." },
          model: { type: "string", description: "Optional; omit to use the provider default video model." },
          mode: { type: "string", enum: ["text-to-video", "image-to-video", "keyframes"] },
          image: { type: "string", description: "image-to-video: single image URL." },
          keyframes: { type: "array", items: { type: "string" }, description: "keyframes: image URL array." },
          resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "720p", description: "Provider may snap to nearest preset (Agnes size_mapping)." },
          ratio: { type: "string", description: "16:9 / 9:16 / 1:1 / 4:3 / 3:4 (preferred over raw size)." },
          numFrames: { type: "number", enum: vc.allowedNumFrames, default: vc.defaultNumFrames, description: "Provider-specific allowed values (Agnes: 8n+1, ≤441)." },
          frameRate: { type: "number", default: vc.defaultFrameRate },
          durationSeconds: { type: "number", description: "If set, auto-pick the nearest valid numFrames (~3/5/10/18s)." },
          seed: { type: "number" },
          negativePrompt: { type: "string" },
          wait: { type: "boolean", description: "省略=智能(预估≤60s 同步、>60s 异步返回 handle);true=阻塞等待(发 progress);false=立即返回 handle。" },
          timeoutMs: { type: "number", default: 900000 },
          pollIntervalMs: { type: "number", default: 10000 },
          download: { type: "boolean", default: true },
          outDir: { type: "string", description: "产物落盘目录,省略用默认(会话目录/output)。" },
          provider: { type: "string", default: config.defaultVideoProvider },
        },
        required: ["prompt"],
      },
    },
    {
      name: "get_video",
      description:
        "Poll and optionally download a video task created by create_video (by videoId or taskId). Companion to create_video — use it after an async video returns a handle, or to check/retrieve any video task.",
      inputSchema: {
        type: "object",
        properties: {
          videoId: { type: "string" },
          taskId: { type: "string", description: "legacy fallback endpoint" },
          download: { type: "boolean", default: true },
          provider: { type: "string", default: config.defaultVideoProvider },
        },
      },
    },
    {
      name: "list_models",
      description: "List available AI image/video models and video constraints per provider (Agnes / Zhipu). Use to discover model names (e.g. cogview-4, agnes-video-v2.0) and allowed video frame counts before calling generate_image / create_video.",
      inputSchema: {
        type: "object",
        properties: { provider: { type: "string" } },
      },
    },
    {
      name: "generate_diagram",
      description:
        "Generate architecture / flowchart / sequence / class / ER / mindmap diagrams (架构图/流程图/时序图/类图/ER图/思维导图/示意图), rendered locally to vector SVG. The D2 and Graphviz engines are BUILT IN (WASM, bundled with this tool) — you do NOT need d2/dot/graphviz installed, do NOT run `which d2`/`which dot`, and do NOT shell out to them or write DOT files by hand; just call this tool and provide the D2 or DOT DSL. Prefer this for structured technical diagrams (architecture, flowchart, sequence, ER, class). LIMITS: D2 produces clean auto-laid-out diagrams with shapes/connections/basic style (fill/stroke/shadow/border-radius/gradients) — it does NOT support SVG filters (feGaussianBlur glow/blur), ambient lighting, vignette, pattern grids, or artistic depth effects. For highly stylized '酷炫/霓虹/科技感' graphics requiring glow/blur/depth beyond what D2 offers, hand-writing SVG is appropriate. mermaid is not supported in-process (needs a browser); use d2 or graphviz instead. Multilingual triggers: 図 · diagrama · diagramme · Diagramm · диаграмма · diagrama (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "D2 or DOT source code. D2 SYNTAX (full docs: https://d2lang.com):\nRULE 1: in { } blocks, each property on its OWN LINE (newline-separated). WRONG: `x: { fill: red; shape: oval }`. RIGHT:\nx: {\n  shape: oval\n  style.fill: red\n}\nRULE 2 (CRITICAL): `#` starts a COMMENT. Hex colors MUST be quoted: `style.fill: \"#f0ff3a\"` (WRONG: `style.fill: #f0ff3a`). Named colors don't need quotes: `style.fill: red`. Gradients: `style.fill: \"linear-gradient(#hex, #hex)\"` (quoted) or `style.fill: linear-gradient(red, blue)` (named).\nRULE 3 (CRITICAL): numeric properties accept INTEGERS ONLY (NOT floats). `style.stroke-width: 2` ✅, `style.stroke-width: 1.5` ❌ ERROR.\nSHAPES: rectangle(default), oval, circle, diamond, hexagon, cylinder, cloud, person, page, step, stored_data, package.\nLAYOUT: `direction: right` (or left/up/down) at top level only.\nCONNECTIONS: `a -> b: label`, `a <-> b`, chain `a -> b -> c`.\nSTYLE (value types matter!):\n  style.fill / style.stroke / style.font-color → color: named (red) or hex QUOTED (\"#ff0000\") or gradient QUOTED.\n  style.stroke-width → INTEGER 0-15 (NOT float!)\n  style.stroke-dash → INTEGER 0-10\n  style.font-size → INTEGER 8-100\n  style.border-radius → INTEGER 0-20\n  style.opacity → FLOAT 0-1\n  style.shadow / style.3d / style.double-border / style.bold / style.italic → true or false\n  style.text-transform → uppercase / lowercase / title / none\n  width / height → INTEGER (pixels)\nCONTAINERS: nested { }; cross-ref `parent.child`.\nICONS: `icon: lucide:server` (Iconify set:name, auto-resolved by this tool).\nEXAMPLE (styled):\ndirection: right\ndb: {\n  shape: cylinder\n  style.fill: \"#1a1a2e\"\n  style.stroke: \"#f0ff3a\"\n  style.stroke-width: 2\n  style.shadow: true\n}\napi: {\n  shape: hexagon\n  style.fill: \"#16213e\"\n  style.border-radius: 14\n}\napi -> db: query\nMISTAKES: (1) space-separating properties on one line = ERROR. (2) Unquoted hex (# starts comment) = ERROR. (3) Float for integer property (1.5 for stroke-width) = ERROR. (4) Referencing by label not key. (5) `direction:` is top-level only.\nGraphviz DOT (semicolons OK): digraph G { rankdir=LR; A -> B; C }" },
          engine: { type: "string", enum: ["d2", "graphviz", "mermaid"], default: "d2", description: "Render engine: d2 (D2 WASM, default) or graphviz (DOT). mermaid is listed for discoverability but unsupported in-process — use d2/graphviz." },
          format: { type: "string", enum: ["svg", "png"], default: "svg", description: "Output format (svg = vector high-res)" },
          diagramType: { type: "string", description: "Diagram type hint (flowchart/sequence/class/architecture...)" },
          theme: { type: "string", description: "Theme (D2 theme name or ID; d2 only)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["code"],
      },
    },
    {
      name: "generate_qrcode",
      description: "Generate a QR code (二维码) as SVG or PNG from text/URL. Pure local rendering — no qrencode/zbar/system install, no AI, no network. Just call with the text/URL to encode. Multilingual triggers: QRコード · código QR · code QR · QR-Code · QR-код · código QR (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Content to encode (URL or text)" },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          margin: { type: "number", description: "Margin in modules (default 2)" },
          errorCorrectionLevel: { type: "string", enum: ["L", "M", "Q", "H"], default: "M" },
          dark: { type: "string", description: "Foreground color, default #000000" },
          light: { type: "string", description: "Background color, default #ffffff" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["text"],
      },
    },
    {
      name: "generate_chart",
      description: "Generate bar / line / pie / area / scatter charts and data visualizations (柱状图/折线图/饼图/散点图/数据可视化) from your data — Claude converts your numbers/CSV/data into a Vega-Lite spec internally; you just pass the data and chart type. Vega-Lite + vega are BUILT IN (bundled) — no matplotlib, no Python, no graphviz, no system install needed; prefer this over writing Python/matplotlib. Renders to vector SVG. No AI. NOTE: Vega image marks with external URLs are NOT embedded; use data URIs for self-contained output. Multilingual triggers: グラフ · gráfico · graphique · Diagramm · график · gráfico (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          spec: { type: "object", description: "Vega-Lite v5 spec (JSON object). Docs: https://vega.github.io/vega-lite/docs/.\nSkeleton: { data: {...}, mark: '...', encoding: {...} }.\nMARK TYPES: 'bar'(bar chart), 'line'(line), 'area', 'circle'/'point'(scatter), 'arc'(pie/donut, needs theta channel), 'tick', 'text'.\nDATA: { values: [{a:'A',b:28},{a:'B',b:55}] }.\nENCODING channels: x, y, color, size, shape, opacity, text, theta. Field types: 'quantitative'(numbers), 'nominal'(categories), 'temporal'(dates), 'ordinal'(ordered).\nPIE/DONUT: mark='arc' + encoding.theta (NOT 'angle' — v5 changed). Donut: add mark.innerRadius.\nAGGREGATION: { aggregate:'sum', field:'v', type:'quantitative' }.\nEXAMPLE bar: { data:{values:[{cat:'A',v:28}]}, mark:'bar', encoding:{x:{field:'cat',type:'nominal'},y:{field:'v',type:'quantitative'}} }\nMISTAKES: (1) pie uses 'theta' not 'angle'; mark is 'arc' not 'pie'. (2) Always set type on x/y. (3) mark object needs type key.\nNOTE: image marks with external URLs NOT embedded; use data URIs." },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["spec"],
      },
    },
    {
      name: "generate_formula",
      description:
        "Render a math formula to vector SVG (数学公式/公式渲染/方程). Pass the formula as LaTeX (e.g. E=mc^2, \\frac{a}{b}, \\sum_{i=1}^n i^2) — even simple formulas qualify; the user need not say 'LaTeX'. MathJax is BUILT IN (bundled) — no KaTeX/system install, no font dependency; just call this tool. Prefer this over any manual approach. Pure local, no AI. Multilingual triggers: 数式 · fórmula · formule · Formel · формула · fórmula (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          tex: { type: "string", description: "LaTeX source, e.g. \\frac{a}{b} or \\sum_{i=1}^{n} i^2" },
          display: { type: "boolean", default: true, description: "true=block (display) style, false=inline" },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          fontSize: { type: "number", description: "Font size in em (default 18)" },
          width: { type: "number", description: "Target pixel width for PNG (default 600); SVG ignores this" },
          color: { type: "string", description: "Foreground color (default black)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["tex"],
      },
    },
    {
      name: "generate_icon",
      description:
        "Fetch and render a vector icon / logo / symbol / favicon (图标/logo/符号) by name from Iconify — 200k+ icons across Material Design (mdi:), Lucide, Font Awesome (fa:), Heroicons, simple-icons (logos:), etc. Renders to SVG/PNG locally — no need to curl SVG files from the web or hand-write SVG paths; just call this tool with the prefix:name. Needs network (Iconify API); cached after first fetch. Browse names at https://icon-sets.iconify.design. No AI. Multilingual triggers: アイコン · icono · icône · Symbol · значок · ícone (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Icon name as prefix:name, e.g. mdi:home, logos:github, lucide:check. Also used (sanitized) as the output filename." },
          size: { type: "number", description: "Pixel size (square), default 128" },
          color: { type: "string", description: "Foreground color (default currentColor; PNG defaults to black)" },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["name"],
      },
    },
    {
      name: "generate_card",
      description:
        "Generate a share card / OG image / quote card / poster / cover image (分享卡/分享图/封面图/海报/引言卡/金句卡/OG图; default 1200x630 PNG). The rendering engine is BUILT IN and runs entirely in-process — do NOT write HTML+CSS and screenshot it with headless Chrome/Puppeteer/Playwright, do NOT use Pillow/PIL/Python, and do NOT hand-code SVG; just call this tool with title/subtitle/body and it renders deterministically. Prefer this for ANY text/card/OG/poster/cover-image request. (For illustrated or photographic subjects, use generate_image instead.) Supports 5 templates (og/quote/minimal/hero/panel), gradient title + glow effects, embedded logo/avatar, Chinese + Japanese kanji auto, color emoji auto. LIMITS: Japanese kana and Korean need fontPath; titleGradient + glow don't combine; no JS execution / no animation (those would need a browser). Multilingual triggers: カード · tarjeta · carte · Karte · карточка · cartão (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Main title (required)" },
          subtitle: { type: "string", description: "Subtitle / kicker (accent color)" },
          body: { type: "string", description: "Body / description text" },
          footer: { type: "string", description: "Footer (author / date / domain)" },
          template: { type: "string", enum: ["og", "quote", "minimal", "hero", "panel"], default: "og", description: "Layout template. Fields shown: og/panel = title+subtitle+body+footer; quote = title(as quote)+body+footer; minimal = title+subtitle; hero = title+subtitle+footer. (og=left hierarchy, quote=centered quote, minimal=bare, hero=big showcase, panel=glass panel)" },
          width: { type: "number", description: "Pixel width (default 1200, OG standard)" },
          height: { type: "number", description: "Pixel height (default 630, OG standard)" },
          bg: { type: "string", description: "Background: a solid color (default #0f172a) OR a CSS gradient string, e.g. linear-gradient(135deg, #4f46e5, #06b6d4) / radial-gradient(circle at 30% 30%, #f59e0b, #ef4444)" },
          color: { type: "string", description: "Title text color (default #f8fafc). Note: only the title uses this; subtitle uses accent, body/footer use a muted gray." },
          accent: { type: "string", description: "Accent color (default #6366f1)" },
          titleGradient: { type: "string", description: "CSS gradient applied to the title text via background-clip:text, e.g. linear-gradient(90deg,#f59e0b,#ef4444). Note: does not combine with glow (Satori drops the shadow when text is clipped to a gradient — use one or the other)." },
          glow: { type: "string", description: "Title glow (text-shadow). Pass true (as the string 'true') to derive from accent, or a full text-shadow value like '0 0 40px rgba(245,158,11,.6)'." },
          blob: { type: "boolean", default: true, description: "hero template only: blurred accent blob behind the title for depth (default true)" },
          quoteStyle: { type: "string", enum: ["top", "flank"], default: "top", description: "quote template only: 'top' = big quote mark above the text (default); 'flank' = large quote marks flank the text left/right on the same line, wrapping it" },
          logo: { type: "string", description: "Embedded image (brand logo / avatar): a URL, data URI, or local file path (.png/.jpg/.webp/.svg). Placed at the top of the card content." },
          logoSize: { type: "number", description: "Logo pixel size (square edge), default 88" },
          logoRound: { type: "boolean", default: false, description: "Logo circular (for avatars); default false = rounded square" },
          fontFamily: { type: "string", description: "Font family from @fontsource (default Inter, Latin only)" },
          fontPath: { type: "string", description: "Local base-font file path (.ttf/.otf/.woff) to override the default Inter; optional (CJK auto-supported via built-in Noto Sans SC)" },
          format: { type: "string", enum: ["svg", "png"], default: "png" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["title"],
      },
    },
    {
      name: "render_svg",
      description:
        "Render SVG source to high-quality PNG or SVG. Dual backend: resvg (92% filter fidelity, in-process, lightweight) or Chrome (100% filter fidelity, needs system Chrome/Edge). AUTO-selects: if SVG contains <filter>/<feGaussianBlur>/<feTurbulence> AND Chrome is available → Chrome; else resvg. Use this for '酷炫/霓虹/科技感' graphics with glow/blur/depth that D2 cannot produce — write the SVG (with feGaussianBlur, radial gradients, etc.) and this tool renders it. No AI.",
      inputSchema: {
        type: "object",
        properties: {
          svg: { type: "string", description: "SVG source code (XML string starting with <svg). Can include feGaussianBlur, feMerge, gradients, patterns — all SVG filter primitives supported." },
          format: { type: "string", enum: ["svg", "png"], default: "png", description: "Output format (png = rasterized; svg = pass-through)" },
          width: { type: "number", description: "Target pixel width for PNG (default: auto-detect from SVG viewBox/width)" },
          backend: { type: "string", enum: ["auto", "resvg", "chrome"], default: "auto", description: "Rendering backend: 'auto' = detect filters + Chrome availability; 'resvg' = force lightweight (92%); 'chrome' = force Chrome (100%, needs Chrome installed)" },
          scale: { type: "number", description: "Retina scale factor for Chrome backend (default 2; only affects Chrome renders)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["svg"],
      },
    },
  ];
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildTools() }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, any>;
  const progressToken = (req.params as any)?._meta?.progressToken;

  const emitProgress = (pct: number, message?: string) => {
    try {
      const params: Record<string, unknown> = { progress: pct, total: 100 };
      if (message) params.message = message;
      if (progressToken !== undefined) params.progressToken = progressToken;
      const r = (server as any).notification?.({ method: "notifications/progress", params });
      if (r && typeof r.then === "function") r.catch(() => {});
    } catch {
      /* best-effort */
    }
  };

  /** 解析 outDir:用户指定 → resolve;否则 config.outDir(默认会话目录/output)。 */
  const resolveOutDir = (v: unknown) =>
    optString(v) ? path.resolve(optString(v)!) : config.outDir;

  /** 本地渲染落盘(diagram/qr/chart 共用)。sanitize name(BL-04)+ png 断言(DL-02)+ 去重(R-CI-02)。 */
  async function writeLocalRender(
    outDir: string,
    prefix: string,
    name: string | undefined,
    format: "svg" | "png",
    rendered: { svg?: string; png?: Buffer },
  ): Promise<string> {
    await fs.mkdir(outDir, { recursive: true });
    const safeName = path.basename(name ?? `${prefix}_${Date.now().toString(36)}`); // BL-04: sanitize
    const ext = format === "png" ? ".png" : ".svg";
    const fp = path.join(outDir, safeName + ext);
    if (format === "png") {
      if (!rendered.png) throw new Error(`${prefix} engine produced no PNG`); // DL-02: 断言
      await fs.writeFile(fp, rendered.png);
    } else {
      if (!rendered.svg) throw new Error(`${prefix} engine produced no SVG`);
      await fs.writeFile(fp, rendered.svg, "utf-8");
    }
    return fp;
  }

  try {
    switch (req.params.name) {
      case "generate_image": {
        const prompt = requireString(a.prompt, "prompt");
        const p = getProvider(optString(a.provider) ?? config.defaultImageProvider);
        const outDir = resolveOutDir(a.outDir);
        const r = await p.generateImage({
          prompt,
          model: optString(a.model),
          size: optString(a.size),
          n: optNumber(a.n),
          images: toStringArray(a.images),
        });
        let localPaths: string[] = [];
        if (a.download !== false) {
          localPaths = await Promise.all(
            r.outputs.filter((o) => o.url).map((o) => downloadAsset(o.url!, "img", outDir)),
          );
        }
        return ok({ outputs: r.outputs, local_paths: localPaths });
      }

      case "create_video": {
        const prompt = requireString(a.prompt, "prompt");
        const p = getProvider(optString(a.provider) ?? config.defaultVideoProvider);
        const vc = p.videoConstraints();
        const outDir = resolveOutDir(a.outDir);
        const frameRate = optNumber(a.frameRate) ?? vc.defaultFrameRate;
        const effFrames =
          optNumber(a.numFrames) ??
          (optNumber(a.durationSeconds) !== undefined
            ? nearestAllowed(optNumber(a.durationSeconds)! * frameRate, vc.allowedNumFrames)
            : vc.defaultNumFrames);
        const estimated = p.estimateGenerationSeconds(effFrames, frameRate);
        const wait = a.wait === true || (a.wait === undefined && estimated <= ASYNC_THRESHOLD_SECONDS);

        const created = await p.createVideo({
          prompt,
          model: optString(a.model),
          mode: optString(a.mode) as any,
          image: optString(a.image),
          keyframes: toStringArray(a.keyframes),
          resolution: optString(a.resolution) as any,
          ratio: optString(a.ratio),
          numFrames: optNumber(a.numFrames),
          frameRate: optNumber(a.frameRate),
          durationSeconds: optNumber(a.durationSeconds),
          seed: optNumber(a.seed),
          negativePrompt: optString(a.negativePrompt),
        });

        if (!wait) {
          return ok({
            ...created,
            async: true,
            estimated_seconds: estimated,
            estimated_human: humanDuration(estimated),
            threshold_seconds: ASYNC_THRESHOLD_SECONDS,
            hint: `预估生成 ${humanDuration(estimated)}(>${ASYNC_THRESHOLD_SECONDS}s 已转异步)。任务在后端生成,完成后调用方应通知用户;查询用 get_video(videoId="${created.videoId}")。`,
          });
        }

        const done = await waitVideo({
          provider: p,
          handle: { videoId: created.videoId, taskId: created.taskId },
          timeoutMs: optNumber(a.timeoutMs),
          pollIntervalMs: optNumber(a.pollIntervalMs),
          onProgress: (pct, status) => emitProgress(pct, status),
        });
        let localPath: string | null = null;
        if (done.status === "completed" && done.url && a.download !== false) {
          localPath = await downloadAsset(done.url, "vid", outDir);
        }
        return ok({ ...done, local_path: localPath });
      }

      case "get_video": {
        if (!a.videoId && !a.taskId) {
          return err("get_video requires `videoId` (preferred) or `taskId`");
        }
        const p = getProvider(optString(a.provider) ?? config.defaultVideoProvider);
        const r = await p.getVideo({ videoId: optString(a.videoId), taskId: optString(a.taskId) });
        let localPath: string | null = null;
        if (r.status === "completed" && r.url && a.download !== false) {
          localPath = await downloadAsset(r.url, "vid", config.outDir);
        }
        return ok({ ...r, local_path: localPath });
      }

      case "list_models": {
        const names = a.provider ? [String(a.provider)] : listProviders();
        const out: Record<string, { models: string[]; videoConstraints: unknown; estimate_example: string }> = {};
        for (const n of names) {
          const prov = getProvider(n);
          const dv = prov.videoConstraints().defaultNumFrames;
          out[n] = {
            models: prov.listModels(),
            videoConstraints: prov.videoConstraints(),
            estimate_example: `${dv} 帧 → ~${prov.estimateGenerationSeconds(dv)}s 生成`,
          };
        }
        return ok({ providers: listProviders(), detail: out });
      }

      case "generate_diagram": {
        const code = requireString(a.code, "code");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const engineName = optString(a.engine) ?? "d2";
        if (engineName === "mermaid") return err(MERMAID_UNSUPPORTED_MSG);
        const engine = getDiagramEngine(engineName);
        if (!engine) return err(`unknown diagram engine: ${engineName} (supported: d2, graphviz)`);
        if (!engine.isAvailable()) return err(`diagram engine "${engineName}" not available`);
        const rendered = await engine.render({
          code,
          engine: engineName as any,
          format,
          theme: optString(a.theme),
          diagramType: optString(a.diagramType) ?? optString(a.type),
          name: optString(a.name),
        });
        const fp = await writeLocalRender(outDir, "diagram", optString(a.name), format, rendered);
        return ok({ engine: engineName, format, local_path: fp });
      }

      case "generate_qrcode": {
        const text = requireString(a.text, "text");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderQR({
          text,
          format,
          margin: optNumber(a.margin),
          errorCorrectionLevel: optString(a.errorCorrectionLevel) as any,
          dark: optString(a.dark),
          light: optString(a.light),
        });
        const fp = await writeLocalRender(outDir, "qr", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
      }

      case "generate_chart": {
        if (!a.spec || typeof a.spec !== "object") {
          return err("spec (Vega-Lite JSON object) is required");
        }
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderChart({ spec: a.spec, format });
        const fp = await writeLocalRender(outDir, "chart", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
      }

      case "generate_formula": {
        const tex = requireString(a.tex, "tex");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderFormula({
          tex,
          display: a.display === false ? false : undefined,
          format,
          fontSize: optNumber(a.fontSize),
          width: optNumber(a.width),
          color: optString(a.color),
        });
        const fp = await writeLocalRender(outDir, "formula", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
      }

      case "generate_icon": {
        const iconName = requireString(a.name, "name");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderIcon({
          name: iconName,
          size: optNumber(a.size),
          color: optString(a.color),
          format,
        });
        // 输出文件名由图标名派生("mdi:home"→"mdi-home");writeLocalRender 再做 basename 清洗
        const outName = iconName.replace(/[^a-zA-Z0-9._-]+/g, "-");
        const fp = await writeLocalRender(outDir, "icon", outName, format, rendered);
        return ok({ format, local_path: fp });
      }

      case "generate_card": {
        const title = requireString(a.title, "title");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "svg" ? "svg" : "png";
        const rendered = await renderCard({
          title,
          subtitle: optString(a.subtitle),
          body: optString(a.body),
          footer: optString(a.footer),
          template: optString(a.template) as any,
          width: optNumber(a.width),
          height: optNumber(a.height),
          bg: optString(a.bg),
          color: optString(a.color),
          accent: optString(a.accent),
          titleGradient: optString(a.titleGradient),
          glow: a.glow === true ? true : a.glow === "true" ? true : optString(a.glow),
          blob: a.blob === false ? false : a.blob === "false" ? false : undefined,
          quoteStyle: optString(a.quoteStyle) as any,
          logo: optString(a.logo),
          logoSize: optNumber(a.logoSize),
          logoRound: a.logoRound === true || a.logoRound === "true",
          fontFamily: optString(a.fontFamily),
          fontPath: optString(a.fontPath),
          format,
        });
        const fp = await writeLocalRender(outDir, "card", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
      }

      case "render_svg": {
        const svg = requireString(a.svg, "svg");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "svg" ? "svg" : "png";
        const rendered = await renderSvg({
          svg,
          format,
          width: optNumber(a.width),
          backend: optString(a.backend) as any,
          scale: optNumber(a.scale),
        });
        const fp = await writeLocalRender(outDir, "svg", optString(a.name), format, rendered);
        return ok({ format, backend: rendered.backendUsed, warning: rendered.warning, local_path: fp });
      }

      default:
        return err(`unknown tool: ${req.params.name}`);
    }
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
});

// ── 参数解析助手 ──

function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`\`${name}\` is required and must be a non-empty string`);
  }
  return v;
}
function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function optNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.filter((x): x is string => typeof x === "string" && !!x.trim());
  return arr.length ? arr : undefined;
}
function nearestAllowed(target: number, allowed: number[]): number {
  let best = allowed[0] ?? target;
  let bestDelta = Infinity;
  for (const f of allowed) {
    const d = Math.abs(f - target);
    if (d < bestDelta) { bestDelta = d; best = f; }
  }
  return best;
}
function humanDuration(sec: number): string {
  if (sec < 60) return `约 ${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `约 ${m} 分 ${s} 秒` : `约 ${m} 分钟`;
}
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

await server.connect(new StdioServerTransport());
