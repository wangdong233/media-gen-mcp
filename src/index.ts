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
import { getProvider, listProviders, resolveProvider, buildListModelsDetail, buildVisionCapabilitiesDetail, getFallbackProvider, asImageProvider, asVideoProvider, asVisionProvider } from "./providers/registry.js";
import { isFallbackWorthy } from "./providers/http.js";
import type { ImageResult, VideoMode, Resolution, VideoTask, ExtractTextHints, ExtractTableHints, AnalyzeChartHints, DescribeImageHints, VisionResult, VisionTask } from "./providers/types.js";
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
import { renderVideo } from "./render-video.js";
import { applyTbpu } from "./vision/tbpu.js";
import { filterIgnoreAreas, parseIgnoreAreas } from "./vision/ignore-area.js";
import {
  runPdfPipeline,
  runPdfAsync,
  estimatePdfSeconds,
  buildResultFromJob,
  getPdfJob,
  type PdfPipelineInput,
} from "./pdf/pipeline.js";
import { getPdfPageCount } from "./pdf/render.js";
import { parsePageRange } from "./pdf/page-range.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 版本从 package.json 读,杜绝发版时 serverInfo.version 漏改(dist/index.js → ../package.json)
const PKG_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
).version as string;

const ASYNC_THRESHOLD_SECONDS = 60;
// mode/resolution 共享常量:schema enum + handler 白名单同源,消除多处字面量漂移(审查 medium)
const VIDEO_MODES = ["text-to-video", "image-to-video", "keyframes"] as const;
const RESOLUTIONS = ["480p", "720p", "1080p"] as const;

const server = new Server(
  { name: "media-gen-mcp", version: PKG_VERSION },
  { capabilities: { tools: {} } },
);

/** URI 校验(http(s): / data:),generate_image images / create_video image+keyframes / vision image 共用(pares5 抽取,消除重复正则,R-CI-01)。 */
const isImageUri = (u: string) => /^(https?:|data:)/i.test(u);

/**
 * pares6: PDF source URI 校验。
 * 接受:http(s):// / data:application/pdf / file:// / 本地路径(.pdf 后缀,CC 可直接传本地文件)。
 * 与 isImageUri 不同:PDF 路径本地文件允许(渲染层会 readFile),因为 CC Read 工具不能把 PDF 转 data URI。
 */
const isPdfSource = (u: string) =>
  /^(https?:|data:application\/pdf|file:)/i.test(u) || /\.pdf$/i.test(u);

/**
 * pares5 M2: vision task 通用执行(provider 解析 + 能力门禁 + fallback 链)。
 * extract_table/analyze_chart/describe_image 共用,避 3 处重复 fallback 逻辑(R-CI-08 DRY)。
 * extract_text(M1)因 hints/outputFormat 特殊保持独立,但 fallback 语义与此一致。
 */
async function runVisionTask(
  task: VisionTask,
  image: string,
  providerName: string | undefined,
  hints?: ExtractTextHints | ExtractTableHints | AnalyzeChartHints | DescribeImageHints,
): Promise<{ result: VisionResult; providerUsed: string; warnings: string[] }> {
  if (!isImageUri(image)) throw new Error("`image` 须为 http(s): 或 data: URI;本地文件请先读取为 data URI 再传入。");
  const resolved = resolveProvider(providerName, undefined, "vision");
  let activeProvider = asVisionProvider(resolved.provider);
  if (!activeProvider.visionTasks().includes(task)) {
    throw new Error(`provider "${activeProvider.name}" 不支持 ${task}(支持:${[...activeProvider.visionTasks()].join(",")})。`);
  }
  const warnings: string[] = [];
  let result: VisionResult;
  try {
    result = await activeProvider.recognize({ image, task, hints });
  } catch (e: any) {
    if (!isFallbackWorthy(e)) throw e;
    const fb = getFallbackProvider(activeProvider.name, "vision", { task });
    if (!fb) throw e;
    activeProvider.notifyUnavailable?.(e);
    warnings.push(`provider "${resolved.provider.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${fb.name}"。`);
    activeProvider = asVisionProvider(fb);
    if (!activeProvider.visionTasks().includes(task)) throw e;
    result = await activeProvider.recognize({ image, task, hints });
  }
  // 透传 provider 返回的 warnings(对称 extract_text handler)
  if (result.warnings?.length) warnings.push(...result.warnings);
  return { result, providerUsed: activeProvider.name, warnings };
}

function buildTools() {
  // create_video 的 schema 约束按"视频模态默认 provider"展示,与实际路由一致
  // (例:defaultVideoProvider=zhipu 时展示 150/300,而非 agnes 的 81/121/...;handler 仍按实际 provider 复算 vc)
  const vc = asVideoProvider(getProvider(config.defaultVideoProvider)).videoConstraints();

  return [
    {
      name: "generate_image",
      description:
        "Generate or edit an AI image (text-to-image 文生图/AI画图; or image-to-image 图生图 via `images`) using free models (Agnes AI default, or Zhipu). Output downloads locally and the path is returned; no local rendering libs needed.\n\nWHEN: subject is photographic or illustrated (写实图/插画/概念图/original logo artwork / 原创品牌主视觉); user says 'AI画图 / 文生图 / generate an image of ...' and wants AI-generated pixels.\n\nAVOID:\n- Text-heavy cards / OG images / posters / quote cards / cover images → use `generate_card` instead (deterministic Satori render, no AI variability, same input → same output).\n- An existing brand logo (Iconify 200k+ vector set) → use `generate_icon` instead; this tool only draws ORIGINAL logo artwork.\n\nNEXT: call `list_models` first to discover available model names and size constraints per provider.\n\nMultilingual triggers: 画像 · imagen · image · Bild · изображение · imagem (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image description." },
          model: {
            type: "string",
            description: "Optional; omit to use the provider default. Call list_models to see options.",
          },
          size: { type: "string", description: "e.g. 1024x1024. Zhipu requires each side 512-2880, multiple of 16, pixels ≤ 2^21 — the tool auto-snaps to a valid size; Agnes accepts free size." },
          n: { type: "number", description: "Number of images (1-8). Provider APIs ignore batch n, so the tool fans out N parallel single-image requests; partial success returns fewer + a `warnings` field." },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Image-to-image inputs (public URL or data URI). Omit for text-to-image.",
          },
          watermark: { type: "boolean", default: false, description: "true = keep provider watermark (Zhipu). Default false requests watermark off; some free-tier models may still embed one — see response `watermarked` flag." },
          download: { type: "boolean", default: true },
          name: { type: "string", description: "Output filename (without extension); multi-image adds -1/-2/… suffix. Defaults to img_<uuid>." },
          outDir: { type: "string", description: "产物落盘目录,省略用默认(会话目录/output)。" },
          provider: { type: "string", default: config.defaultImageProvider },
        },
        required: ["prompt"],
      },
    },
    {
      name: "create_video",
      description:
        "Create an AI video (text-to-video / image-to-video / keyframe animation; 文生视频/图生视频/关键帧动画/让这张图动起来/做个动画) via free models (Agnes AI default, or Zhipu). Smart async: long videos return a handle to poll with `get_video`; short ones block until done.\n\nWHEN: user wants photorealistic or AI-generated video (写实视频 / AI 合成画面 / 让这张图动起来). AVOID when the user wants deterministic motion graphics — see below.\n\nAVOID:\n- HTML/CSS/GSAP motion graphics / kinetic typography / animated charts / brand intros (deterministic, same input → same output, no AI) → use `render_video` instead.\n\nNEXT: if the call returns a handle (async mode), poll with `get_video` until status=done. Call `list_models` first to verify allowed numFrames per provider (Agnes constraints vary by resolution).\n\nMultilingual triggers: 動画 · vídeo · vidéo · Video · видео · vídeo (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video content description." },
          model: { type: "string", description: "Optional; omit to use the provider default video model." },
          mode: { type: "string", enum: [...VIDEO_MODES] },
          image: { type: "string", description: "image-to-video: single image URL." },
          keyframes: { type: "array", items: { type: "string" }, description: "keyframes: image URL array." },
          resolution: { type: "string", enum: [...RESOLUTIONS], default: "720p", description: "Provider may snap to nearest preset (Agnes size_mapping)." },
          ratio: { type: "string", description: "16:9 / 9:16 / 1:1 / 4:3 / 3:4 (preferred over raw size)." },
          numFrames: { type: "number", enum: vc.allowedNumFrames, default: vc.defaultNumFrames, description: "Allowed: " + vc.allowedNumFrames.join("/") + " (provider-specific; cross-provider routing re-validates per actual provider — check list_models)." },
          frameRate: { type: "number", enum: vc.allowedFrameRates, default: vc.defaultFrameRate, description: "允许值 " + vc.allowedFrameRates.join("/") + " (provider 专有;跨 provider 路由后按实际 provider 复算)" },
          durationSeconds: { type: "number", description: "If set, auto-pick the nearest valid numFrames (~3/5/10/18s)." },
          seed: { type: "number" },
          negativePrompt: { type: "string" },
          wait: { type: "boolean", description: "省略=智能(预估≤60s 同步、>60s 异步返回 handle);true=阻塞等待(发 progress);false=立即返回 handle。" },
          timeoutMs: { type: "number", default: 900000 },
          pollIntervalMs: { type: "number", default: 10000 },
          download: { type: "boolean", default: true },
          name: { type: "string", description: "Output filename (without extension). Defaults to vid_<uuid>." },
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
          name: { type: "string", description: "Output filename (without extension). Defaults to vid_<uuid>." },
          outDir: { type: "string", description: "下载落盘目录,省略用默认。与 create_video 一致以避免异步轮询落盘到别处。" },
          provider: { type: "string", default: config.defaultVideoProvider, description: "Provider: 'agnes' or 'zhipu' — 用任务创建时的 provider 查询(默认 agnes)。" },
        },
      },
    },
    {
      name: "extract_text",
      description:
        "Extract/recognize text from an image (OCR / 文字识别 / 文字提取 / 画像からの文字起こし) — verification codes, digits, license plates, printed Latin, or Chinese documents. Zero-config: tesseract runs in-process (WASM, bundled). Chinese accuracy is weak by default; configure a `paddleocr` provider for Chinese SOTA. The reverse operation is generate_image (text→image).\n\nNEXT: for multi-page PDFs use `extract_pdf`; for tables use `extract_table`; for charts use `analyze_chart`; for handwriting/scene/formula use `describe_image`.\n\nMultilingual triggers: 文字识别 · OCR · 文字提取 · 文字起こし · texto · textoerkennung (ja/es/de).",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Image URI: http(s):// or data: URI. Read local files into a data URI before passing." },
          languages: { type: "array", items: { type: "string" }, description: "BCP-47 language codes (e.g. en / zh-Hans / zh-Hant / ja / ko). Default [en]; use [zh-Hans,en] for Chinese." },
          digitOnly: { type: "boolean", description: "Recognize digits only (verification code / digit readout) → whitelist 0-9." },
          segmentation: { type: "string", enum: ["auto", "single-line", "single-char", "sparse-text"], default: "auto", description: "Layout assumption: auto=fully automatic / single-line=one line of text (captcha) / single-char=one character / sparse-text=scattered text." },
          outputFormat: { type: "string", enum: ["text", "json"], default: "text", description: "text=full text only; json=includes blocks (bbox+confidence per line)." },
          layout: { type: "string", enum: ["none", "natural", "plain", "code"], default: "none", description: "Layout post-processing (provider-agnostic TBPU, Umi-OCR algorithm port): none=no processing (default, join by newline) / natural=multi-column natural paragraphs (best for documents, GapTree+ParagraphParse) / plain=multi-column plain text flow (no hard line breaks) / code=single-column code block (preserve indentation). Apply when document has multi-column layout or paragraph wrapping issues." },
          ignoreAreas: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] }, description: "Ignore regions (watermark / red stamp / header-footer) — blocks whose bbox falls fully inside any area are dropped. Coordinates in image pixel space; {x,y,w,h} = origin+size. Filtering runs before layout." },
          provider: { type: "string", description: "Vision provider; default config.defaultVisionProvider (tesseract fallback; paddle/vlm need configuration)." },
          name: { type: "string", description: "Output filename (no extension; saved as .txt when text is extracted)." },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
          download: { type: "boolean", default: true, description: "Save extracted text as .txt (default true)." },
        },
        required: ["image"],
      },
    },
    {
      name: "extract_table",
      description:
        "Recognize a table from an image → HTML/Markdown/JSON (表格识别/表格提取/tabla): invoices, receipts, financial statements, academic paper tables. Requires a `paddleocr` provider (PaddleX serving, Chinese SOTA); no pure-JS fallback (tesseract cannot parse table structure — a clear error is returned, not a silent OCR downgrade).\n\nNEXT: for plain text in the same image use `extract_text`; for chart data use `analyze_chart`; for a natural-language description of the image use `describe_image`.\n\nMultilingual triggers: 表格识别 · 表格提取 · tabla · 表 (ja/es/de).",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Image URI: http(s):// or data: URI. Read local files into a data URI before passing." },
          format: { type: "string", enum: ["html", "markdown", "json", "latex"], default: "html", description: "Output format for the table content." },
          provider: { type: "string", description: "Vision provider; default paddle (requires configured baseUrl)." },
          name: { type: "string", description: "Output filename (no extension)." },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
          download: { type: "boolean", default: true, description: "Save table content to file (default true)." },
        },
        required: ["image"],
      },
    },
    {
      name: "analyze_chart",
      description:
        "Extract data points FROM an existing chart IMAGE (图表识别/图表数据提取/Chart OCR): reverse-engineer bar/line/pie/scatter charts into structured data series. Requires a `paddleocr` provider (PP-Chart2Table via useChartRecognition); if paddle is unconfigured, call `list_vision_capabilities` first to warn the user instead of hitting a 503.\n\nWHEN: user says '识别这张图表的数据 / extract data from this chart / chart OCR / 读出图里的数值' and provides a chart image.\n\nAVOID:\n- Rendering a chart FROM data → use `generate_chart` instead (the inverse operation).\n\nNEXT: companion to `extract_table` for tabular data in the same image (try extract_table if the chart has an underlying data table).\n\nMultilingual triggers: 图表识别 · 图表数据 · gráfico · Chart-Daten · Graphik (ja/es/de).",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Chart image URI: http(s):// or data: URI." },
          chartType: { type: "string", enum: ["bar", "line", "pie", "scatter", "auto"], default: "auto", description: "Chart type hint (auto lets provider decide)." },
          provider: { type: "string" },
          name: { type: "string" },
          outDir: { type: "string" },
          download: { type: "boolean", default: true },
        },
        required: ["image"],
      },
    },
    {
      name: "describe_image",
      description:
        "VLM image understanding — natural-language description or visual QA (图像描述/看图说话/VQA/describir imagen): handwritten text, complex layouts, scenes, formulas→LaTeX. Requires `paddleocr` provider (PaddleOCR-VL); M3+ adds `vlm` provider for enhanced VQA. Leave `question` empty for a default description.\n\nAVOID: clean printed text/digits/captchas → use `extract_text` instead (faster, structured output). This tool is for handwriting / complex layouts / scene understanding / formula→LaTeX.\n\nMultilingual triggers: 图像描述 · 看图说话 · 描述图片 (ja/es/de).",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Image URI: http(s):// or data: URI." },
          question: { type: "string", description: "Optional VQA question; empty = default description. Note: paddle provider (PaddleOCR-VL) gives a default description and ignores the question; full VQA via question requires the M3+ vlm provider." },
          provider: { type: "string" },
          name: { type: "string" },
          outDir: { type: "string" },
          download: { type: "boolean", default: true },
        },
        required: ["image"],
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
      name: "list_vision_capabilities",
      description:
        "Introspect vision (image recognition) provider capabilities BEFORE calling extract_text/extract_table/analyze_chart/describe_image — shows which providers are configured, what each supports (tasks/languages/latency/accuracy), per-task caveats, and routing guidance. Use this to avoid runtime errors (e.g. extract_table needs paddle; if paddle is unconfigured you can warn the user upfront instead of hitting a 503). Output is dynamic: reflects configured/cooldown/lastErrorAt at call time. Pure local, no network.\n\nNEXT: this is the recommended first call BEFORE `extract_text`/`extract_table`/`analyze_chart`/`describe_image` to avoid runtime 503 (call it once, then route to the right vision tool).\n\nMultilingual triggers: 能力自省 · 能力 introspect · capacités · Fähigkeiten (zh/en/fr/de).",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Optional; filter to one provider (e.g. 'paddle'). Omit for all vision providers (tesseract/paddle/vlm)." },
        },
      },
    },
    {
      name: "generate_diagram",
      description:
        "Generate architecture / flowchart / sequence / class / ER / mindmap diagrams (架构图/流程图/时序图/类图/ER图/思维导图/示意图), rendered locally to vector SVG. The D2 and Graphviz engines are BUILT IN (WASM, bundled with this tool) — you do NOT need d2/dot/graphviz installed, do NOT run `which d2`/`which dot`, and do NOT shell out to them or write DOT files by hand; just call this tool and provide the D2 or DOT DSL. Prefer this for structured technical diagrams (architecture, flowchart, sequence, ER, class). LIMITS: D2 produces clean auto-laid-out diagrams with shapes/connections/basic style (fill/stroke/shadow/border-radius/gradients) — it does NOT support SVG filters (feGaussianBlur glow/blur), ambient lighting, vignette, pattern grids, or artistic depth effects. For highly stylized '酷炫/霓虹/科技感' graphics requiring glow/blur/depth beyond what D2 offers, use `render_svg` (hand-written SVG with feGaussianBlur) instead. mermaid is not supported in-process (needs a browser); use d2 or graphviz instead. Multilingual triggers: 図 · diagrama · diagramme · Diagramm · диаграмма · diagrama (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "D2 or DOT source code. D2 SYNTAX (full docs: https://d2lang.com):\nRULE 1: in { } blocks, each property on its OWN LINE (newline-separated). WRONG: `x: { fill: red; shape: oval }`. RIGHT:\nx: {\n  shape: oval\n  style.fill: red\n}\nRULE 2 (CRITICAL): `#` starts a COMMENT. Hex colors MUST be quoted: `style.fill: \"#f0ff3a\"` (WRONG: `style.fill: #f0ff3a`). Named colors don't need quotes: `style.fill: red`. Gradients: `style.fill: \"linear-gradient(#hex, #hex)\"` (quoted) or `style.fill: linear-gradient(red, blue)` (named).\nRULE 3 (CRITICAL): numeric properties accept INTEGERS ONLY (NOT floats). `style.stroke-width: 2` ✅, `style.stroke-width: 1.5` ❌ ERROR.\nSHAPES: rectangle(default), oval, circle, diamond, hexagon, cylinder, cloud, person, page, step, stored_data, package.\nLAYOUT: `direction: right` (or left/up/down) at top level only.\nCONNECTIONS: `a -> b: label`, `a <-> b`, chain `a -> b -> c`.\nSTYLE (value types matter!):\n  style.fill / style.stroke / style.font-color → color: named (red) or hex QUOTED (\"#ff0000\") or gradient QUOTED.\n  style.stroke-width → INTEGER 0-15 (NOT float!)\n  style.stroke-dash → INTEGER 0-10\n  style.font-size → INTEGER 8-100\n  style.border-radius → INTEGER 0-20\n  style.opacity → FLOAT 0-1\n  style.shadow / style.3d / style.double-border / style.bold / style.italic → true or false\n  style.text-transform → uppercase / lowercase / title / none\n  width / height → INTEGER (pixels)\nCONTAINERS: nested { }; cross-ref `parent.child`.\nICONS: `icon: lucide:server` (Iconify set:name, auto-resolved by this tool).\nEXAMPLE (styled):\ndirection: right\ndb: {\n  shape: cylinder\n  style.fill: \"#1a1a2e\"\n  style.stroke: \"#f0ff3a\"\n  style.stroke-width: 2\n  style.shadow: true\n}\napi: {\n  shape: hexagon\n  style.fill: \"#16213e\"\n  style.border-radius: 14\n}\napi -> db: query\nMISTAKES: (1) space-separating properties on one line = ERROR. (2) Unquoted hex (# starts comment) = ERROR. (3) Float for integer property (1.5 for stroke-width) = ERROR. (4) Referencing by label not key. (5) `direction:` is top-level only.\nGraphviz DOT (semicolons OK): digraph G { rankdir=LR; A -> B; C }" },
          engine: { type: "string", enum: ["d2", "graphviz", "mermaid"], default: "d2", description: "Render engine: d2 (D2 WASM, default) or graphviz (DOT). mermaid is listed for discoverability but unsupported in-process — use d2/graphviz." },
          format: { type: "string", enum: ["svg", "png"], default: "svg", description: "Output format (svg = vector high-res)" },
          diagramType: { type: "string", description: "Currently ignored — diagram type is determined by DSL syntax (e.g. D2 shape: sequence_diagram). Reserved for future use." },
          theme: { type: "string", description: "D2 only; named: 'default'(0)/'neutral'(1), or numeric themeID; unknown names error (see d2 --themes)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["code"],
      },
    },
    {
      name: "generate_qrcode",
      description: "Generate a QR code (二维码) as SVG or PNG from text/URL. Pure local rendering — no qrencode/zbar/system install, no AI, no network. Just call with the text/URL to encode.\n\nNEXT: embed into a `generate_card` poster via the `logo` prop, or rasterize larger via `render_svg`.\n\nMultilingual triggers: QRコード · código QR · code QR · QR-Code · QR-код · código QR (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Content to encode (URL or text)" },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          margin: { type: "number", description: "Margin in modules (default 2)" },
          errorCorrectionLevel: { type: "string", enum: ["L", "M", "Q", "H"], default: "M" },
          dark: { type: "string", description: "Foreground color, default #000000" },
          light: { type: "string", description: "Background color, default #ffffff" },
          width: { type: "number", description: "PNG 目标像素宽(默认 ~scale×modules;打印海报建议 ≥300);仅 png 生效,SVG 矢量无固定像素宽" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["text"],
      },
    },
    {
      name: "generate_chart",
      description: "Generate bar / line / pie / area / scatter charts and data visualizations (柱状图/折线图/饼图/散点图/数据可视化) from your data — Claude converts your numbers/CSV/data into a Vega-Lite spec internally; you just pass the data and chart type. Vega-Lite + vega are BUILT IN (bundled); no matplotlib / Python / graphviz / system install. Renders to vector SVG. No AI; same input → same output.\n\nWHEN: user says '柱状图 / 折线图 / 饼图 / 画个图 / chart / graph / visualize data / dashboard' or hands you CSV/numbers and wants a rendered chart.\n\nAVOID:\n- Extracting data FROM an existing chart IMAGE → use `analyze_chart` instead (the inverse operation).\n- Writing Python/matplotlib → use this tool instead (no env setup).\n\nNEXT: for self-contained output, pass image marks as data URIs (external URLs are NOT embedded).\n\nMultilingual triggers: グラフ · gráfico · graphique · Diagramm · график · gráfico (ja/es/fr/de/ru/pt).",
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
        "Render a math formula to vector SVG (数学公式/公式渲染/方程). Pass the formula as LaTeX (e.g. E=mc^2, \\frac{a}{b}, \\sum_{i=1}^n i^2) — even simple formulas qualify; the user need not say 'LaTeX'. MathJax is BUILT IN (bundled) — no KaTeX/system install, no font dependency; just call this tool. Prefer this over any manual approach. Pure local, no AI.\n\nNEXT: embed the SVG result in `generate_card` (formula as body) or rasterize larger via `render_svg`.\n\nMultilingual triggers: 数式 · fórmula · formule · Formel · формула · fórmula (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          tex: { type: "string", description: "LaTeX source, e.g. \\frac{a}{b} or \\sum_{i=1}^{n} i^2" },
          display: { type: "boolean", default: true, description: "true=block (display) style, false=inline" },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          fontSize: { type: "number", description: "Font size in em (default 18). Affects glyph size + SVG/PNG output dimensions." },
          width: { type: "number", description: "Target pixel width for PNG (default 600); SVG ignores this" },
          color: { type: "string", description: "Foreground color (default black)" },
          background: { type: "string", description: "PNG background (default #ffffff; set 'transparent' for transparent). Avoids low-contrast invisible output." },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["tex"],
      },
    },
    {
      name: "generate_icon",
      description:
        "Fetch and render a vector icon / logo / symbol / favicon (图标/logo/符号) from Iconify — 200k+ icons. Renders to SVG/PNG locally. Needs network (Iconify API); cached after first fetch. Browse at https://icon-sets.iconify.design. No AI.\n\nAVOID: original illustrated logo ARTWORK → use `generate_image` instead (AI draws original pixels). This tool fetches EXISTING vector icons from the Iconify 200k+ set by ID (e.g. `mdi:home`).\n\nMultilingual triggers: アイコン · icono · icône · Symbol · значок · ícone (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          icon: { type: "string", description: "Iconify icon ID, format: SET:NAME. Common sets: mdi (Material Design), lucide (Lucide), logos (brand logos), fa-solid / fa-brands (Font Awesome). Examples: mdi:home, lucide:gem, logos:github, fa-brands:twitter. Browse all at https://icon-sets.iconify.design" },
          size: { type: "number", description: "Pixel size (square), default 128" },
          color: { type: "string", description: "Foreground color. Default 'currentColor' (SVG inherits surrounding text color; for PNG or standalone file pass explicit color — else black-on-transparent may be invisible on dark bg)." },
          background: { type: "string", description: "PNG background (default: white when color=currentColor, transparent otherwise; pass #ffffff/#000000 to override)." },
          format: { type: "string", enum: ["svg", "png"], default: "svg" },
          name: { type: "string", description: "Output filename (without extension); defaults to sanitized icon ID" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["icon"],
      },
    },
    {
      name: "generate_card",
      description:
        "Generate a share card / OG image / quote card / poster / cover image (分享卡/分享图/封面图/海报/引言卡/金句卡/OG图; default 1200x630 PNG). The rendering engine is BUILT IN and runs entirely in-process — do NOT write HTML+CSS and screenshot it with headless Chrome/Puppeteer/Playwright, do NOT use Pillow/PIL/Python, and do NOT hand-code SVG; just call this tool with title/subtitle/body and it renders deterministically. Prefer this for ANY text/card/OG/poster/cover-image request. (For illustrated or photographic subjects, use generate_image instead.) Supports 5 templates (og/quote/minimal/hero/panel), gradient title + glow effects, embedded logo/avatar, Chinese + Japanese kanji auto, color emoji auto. LIMITS: Japanese kana and Korean need fontPath; titleGradient + glow don't combine; no JS execution / no animation (those would need a browser).\n\nNEXT: pair with `generate_image` for illustrated artwork (Logos/插画) that this card layout can embed via the `logo` prop.\n\nMultilingual triggers: カード · tarjeta · carte · Karte · карточка · cartão (ja/es/fr/de/ru/pt).",
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
          glow: { type: "string", description: "Title glow (text-shadow). Pass 'true' to auto-derive from accent color, or a full text-shadow CSS value like '0 0 40px rgba(245,158,11,.6)'. Pass 'false' to disable. Does NOT combine with titleGradient (shadow is clipped when text is gradient-filled)." },
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
        "Render SVG source to high-quality PNG or SVG. Dual backend: resvg (92% filter fidelity, in-process) or Chrome (100% filter fidelity, needs system Chrome/Edge). AUTO-selects: SVG contains <filter>/<feGaussianBlur>/<feTurbulence> AND Chrome available → Chrome; else resvg. No AI; same input → same output.\n\nWHEN: '酷炫/霓虹/科技感' graphics with glow/blur/depth that `generate_diagram` cannot produce — write the SVG (feGaussianBlur, radial gradients, feTurbulence, etc.) and this tool rasterizes it.\n\nAVOID:\n- Structured technical diagrams (architecture / flowchart / sequence / ER / class / mindmap) → use `generate_diagram` instead (auto-layout via D2/Graphviz, no hand-written SVG needed).\n- Text-heavy cards / OG / posters → use `generate_card` instead (deterministic layout).\n\nNEXT: pair with `generate_diagram` for hybrid flows (D2 for structure, render_svg for stylized overlays).\n\nMultilingual triggers: SVG 渲染 · render SVG · SVG-Nebeneffekte (zh/en/de).",
      inputSchema: {
        type: "object",
        properties: {
          svg: { type: "string", description: "SVG source code (XML string starting with <svg). Can include feGaussianBlur, feMerge, gradients, patterns — all SVG filter primitives supported." },
          format: { type: "string", enum: ["svg", "png"], default: "png", description: "Output format (png = rasterized; svg = pass-through)" },
          width: { type: "number", description: "Target pixel width for PNG (resvg backend uses this; Chrome backend uses SVG intrinsic size × scale, ignoring width). Default: auto-detect." },
          backend: { type: "string", enum: ["auto", "resvg", "chrome"], default: "auto", description: "Rendering backend: 'auto' = detect filters + Chrome availability; 'resvg' = force lightweight (92%); 'chrome' = force Chrome (100%, needs Chrome installed)" },
          scale: { type: "number", description: "Retina scale factor for Chrome backend (default 2; only affects Chrome renders)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["svg"],
      },
    },
    {
      name: "render_video",
      description:
        "Render HTML/CSS/GSAP animation to a deterministic MP4/GIF/WebM video. Input: HTML source (with CSS animations or GSAP timeline) + fps + duration. Engine: headless Chrome (seek-based frame capture, HyperFrames-style) + ffmpeg (frame stitching). No AI, deterministic (same input → same output).\n\nWHEN: product intros, animated charts/text motion graphics, brand intros, slideshows, kinetic typography (Animation · animación · animation · Animation · анимация).\n\nAVOID: photorealistic or AI-generated video (写实视频) → use `create_video` instead.\n\nNEXT: pair with `create_video` when a project needs both AI photorealistic clips and deterministic motion graphics. Needs: system Chrome/Edge + ffmpeg (bundled via ffmpeg-static).\n\nMultilingual triggers: Animation · animación · animation · Animation · анимация (ja/es/fr/de/ru).",
      inputSchema: {
        type: "object",
        properties: {
          html: { type: "string", description: "HTML source (with inline CSS/JS animations). Include a GSAP timeline on window.__tl/window.timeline, or expose window.__hf.seek(t), or use pure CSS @keyframes — all auto-detected." },
          fps: { type: "number", description: "Frames per second (default 30, max 60)" },
          duration: { type: "number", description: "Duration in seconds (required, max 120)" },
          width: { type: "number", description: "Pixel width (default 1920)" },
          height: { type: "number", description: "Pixel height (default 1080)" },
          format: { type: "string", enum: ["mp4", "gif", "webm"], default: "mp4", description: "Output format (mp4 default, best compatibility)" },
          scale: { type: "number", description: "Retina scale factor (default 1; 2 for 2× pixels)" },
          quality: { type: "number", description: "Per-frame JPEG quality 1-100 (default 90; lower = smaller file)" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["html", "duration"],
      },
    },
    {
      name: "extract_pdf",
      description:
        "Extract text from a PDF document (PDF识别/多页OCR/财务报表/发票/扫描件文字提取): supports both digital PDFs (with embedded text layer → instant text extraction) and scanned PDFs (rendered to images → OCR via configured vision provider). Smart async: long PDFs return a handle to poll with get_pdf; short ones block until done. Requires `pdfjs-dist` + `@napi-rs/canvas` (run `npm install pdfjs-dist @napi-rs/canvas` in the media-gen-mcp install dir if missing). Companion to extract_text (which is single-image).\n\nNEXT: for single images use `extract_text`; poll async jobs with `get_pdf`.\n\nMultilingual triggers: PDF识别 · PDF文字提取 · PDF OCR · 多页OCR · tabla PDF (zh/es/de).",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "PDF source: http(s):// URL / data:application/pdf;base64,... / file:// path / local .pdf path. Unlike extract_text, local paths are accepted (PDF rendering happens in-process)." },
          pageRange: { type: "string", description: "Page selector (1-based, comma-separated): '3' / '1-10' / '1,3,5-7' / 'odd' / 'even' / 'last' / 'all' (default). Pages outside [1,total] are dropped with a warning." },
          textStrategy: { type: "string", enum: ["auto", "ocr-only", "text-layer-only"], default: "auto", description: "auto (default) = try embedded text layer first, fall back to OCR if missing/sparse; ocr-only = force render+OCR every page; text-layer-only = only use embedded text (skip OCR, even if empty)." },
          languages: { type: "array", items: { type: "string" }, description: "BCP-47 language codes for OCR path (same as extract_text). Default [en]; [zh-Hans,en] for Chinese PDFs." },
          digitOnly: { type: "boolean", description: "OCR digits only (per-page, same as extract_text)." },
          segmentation: { type: "string", enum: ["auto", "single-line", "single-char", "sparse-text"], default: "auto", description: "OCR layout assumption (per-page, same as extract_text)." },
          layout: { type: "string", enum: ["none", "natural", "plain", "code"], default: "none", description: "Per-page TBPU layout post-processing (same as extract_text). natural=multi-column paragraphs (best for documents); none=join by newline." },
          ignoreAreas: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] }, description: "Ignore regions per page (watermark/stamp/header-footer). Coordinates in the rendered page pixel space (scale-applied). Blocks whose bbox falls fully inside any area are dropped. Applied per-page (not globally)." },
          mergePages: { type: "boolean", default: true, description: "true (default) = join all pages into a single `text` field (page separator = form feed \\f); false = return only `pages[]` without merging." },
          outputFormat: { type: "string", enum: ["text", "markdown", "json"], default: "text", description: "Output format: text/markdown saved as .txt/.md (page text joined); json saved as .json with pages[]+blocks. Markdown wraps each page in '## Page N' headers." },
          scale: { type: "number", description: "PDF render scale for OCR path (default 2.0, high DPI). Clamped to [0.5, 3.0]. Higher = better OCR accuracy but more memory." },
          concurrency: { type: "number", description: "Page concurrency (default 1 = serial; max 4). Memory-safe default; raise only for short PDFs with fast providers." },
          wait: { type: "boolean", description: "Omit = smart (estimated ≤60s sync, >60s async returns handle); true = block until done (emits progress); false = immediately return handle." },
          provider: { type: "string", description: "OCR vision provider; default config.defaultVisionProvider (tesseract fallback; paddle recommended for Chinese)." },
          download: { type: "boolean", default: true, description: "Save extracted text to file (default true)." },
          name: { type: "string", description: "Output filename (without extension). Defaults to pdf_<uuid>." },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["source"],
      },
    },
    {
      name: "get_pdf",
      description:
        "Poll and retrieve a PDF extraction task created by extract_pdf (by pdfId). Companion to extract_pdf — use it after an async PDF returns a handle, or to check progress of a long PDF extraction.",
      inputSchema: {
        type: "object",
        properties: {
          pdfId: { type: "string", description: "PDF job handle returned by extract_pdf (async mode)." },
          download: { type: "boolean", default: true, description: "Save extracted text to file once completed (default true)." },
          name: { type: "string", description: "Output filename (without extension). Defaults to pdf_<uuid>." },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["pdfId"],
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
        const outDir = resolveOutDir(a.outDir);
        const model = optString(a.model);
        // model↔provider 校验 + 自动路由(消除 "cogview-4 配 agnes → 503 No available channel" 这类不透明错误)
        const resolved = resolveProvider(optString(a.provider), model, "image");
        const p = asImageProvider(resolved.provider);
        const warnings: string[] = [];
        if (resolved.autoRouted) {
          warnings.push(`model 自动路由:provider "${resolved.routedFrom}" → "${p.name}"。`);
        }
        // n 批量:钳制 1-8;provider 忽略 n,工具层并发 fan-out(N 次单图调用 + 聚合)
        const reqN = optNumber(a.n);
        const n = reqN && reqN > 1 ? Math.min(Math.max(1, Math.floor(reqN)), 8) : 1;
        if (reqN && reqN > 8) warnings.push(`n=${reqN} 超上限,已钳制为 8。`);
        // H3:images[] 须为 URI(与 create_video 对称,防本地路径/相对路径 silent 进 body)
        const imgs = toStringArray(a.images);
        if (imgs?.some((u) => !isImageUri(u))) {
          return err("`images` 每项须为 http(s): 或 data: URI;本地文件请先读取为 data URI 再传入。");
        }
        // images 图生图:provider 不支持时拒绝(免静默丢弃 — zhipu cogview 纯文生图,传 images 会忽略)
        if (imgs?.length && p.supportsImageToImage?.() === false) {
          return err(`provider "${p.name}" 不支持图生图(images 会被忽略)。请改用 agnes,或去掉 images 走纯文生图。`);
        }
        const extra = a.watermark === true ? { watermark_enabled: true } : undefined;
        const makeOne = async (): Promise<{ result: ImageResult; providerName: string }> => {
          try {
            const result = await p.generateImage({ prompt, model, size: optString(a.size) ?? "1024x1024", images: imgs, extra });
            return { result, providerName: p.name };
          } catch (e: any) {
            // pares3: 免费 Provider 自动 Fallback(Agnes 挂 → Zhipu 免费层)
            if (!isFallbackWorthy(e)) throw e;
            const fbRaw = getFallbackProvider(p.name, "image", { images: imgs });
            if (!fbRaw) throw e;
            const fb = asImageProvider(fbRaw);
            if (imgs?.length && fb.supportsImageToImage?.() === false) throw e; // 双保险
            // size 按目标 provider 自有规则重吸附(走接口方法,非硬编码厂商函数;agnes 无 snapImageSize → 原值)
            const baseSize = optString(a.size) ?? "1024x1024";
            const fbSize = fb.snapImageSize?.(baseSize) ?? baseSize;
            warnings.push(`provider "${p.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${fb.name}"(免费)。`);
            p.notifyUnavailable?.(e);
            try {
              const result = await fb.generateImage({ prompt, model: undefined, size: fbSize, images: imgs, extra });
              return { result, providerName: fb.name };
            } catch (fbErr: any) {
              // fb 也失败:同样打 cooldown(仅 fallback-worthy 错,免 4xx 业务错也熔断),让后续请求跳过它
              if (isFallbackWorthy(fbErr)) fb.notifyUnavailable?.(fbErr);
              throw fbErr;
            }
          }
        };
        const { results: rawResults, firstError } = await runPool(Array.from({ length: n }, () => makeOne), 3);
        const pairs = rawResults.filter((x): x is { result: ImageResult; providerName: string } => !!x);
        const results = pairs.map((x) => x.result);
        const outputs = results.flatMap((r) => r.outputs);
        const watermarked = results.some((r) => r.watermarked);
        results.forEach((r) => r.warnings?.forEach((w: string) => warnings.push(w)));
        // 去重:n>1 fan-out 命中同一 fallback 时,makeOne 会推 n 条相同 warning(仅保留首条)
        for (let i = warnings.length - 1; i >= 0; i--) {
          if (warnings.indexOf(warnings[i]) !== i) warnings.splice(i, 1);
        }
        // 实际产出 provider(可能多张来自不同 provider,如部分命中 fallback;聚合去重)
        const providerUsed = Array.from(new Set(pairs.map((x) => x.providerName))).join(",");
        if (outputs.length === 0) {
          // 保留 fallback 路径 + 首例错误诊断(免外层 catch 只看到通用错误,无法判断是 401 还是 fb 也挂了)
          const firstMsg = firstError ? ` 首例:${(firstError as Error)?.message?.slice(0, 100) ?? "未知"}。` : "";
          const detail = warnings.length ? ` 诊断:${warnings.slice(0, 3).join(" / ")}` : "";
          throw new Error(`图像生成失败(0 张产出,可能 provider 限流或鉴权问题)。${firstMsg}${detail}`);
        }
        if (outputs.length < n) warnings.push(`请求 ${n} 张,实际得到 ${outputs.length} 张(部分调用失败${firstError ? `;首例:${(firstError as Error)?.message?.slice(0, 80) ?? "未知"}` : ""})。`);
        // 落盘:name 单张直用,多张加 -i 后缀防覆盖
        let localPaths: string[] = [];
        if (a.download !== false) {
          const outs = outputs.filter((o) => o.url);
          const base = optString(a.name);
          localPaths = await Promise.all(
            outs.map((o, idx) =>
              downloadAsset(o.url!, "img", outDir, base ? (outs.length > 1 ? `${base}-${idx + 1}` : base) : undefined),
            ),
          );
        }
        return ok({
          outputs,
          local_paths: localPaths,
          provider_used: providerUsed,
          ...(watermarked ? { watermarked: true } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }

      case "create_video": {
        const prompt = requireString(a.prompt, "prompt");
        const outDir = resolveOutDir(a.outDir);
        // M5:ratio 白名单(不只检格式,防 999:999 走到 API 行为未定义)
        const RATIO_OK = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
        const ratio = optString(a.ratio);
        if (ratio && !RATIO_OK.has(ratio)) {
          return err('ratio 须为 "16:9" / "9:16" / "1:1" / "4:3" / "3:4" 之一。');
        }
        const image = optString(a.image);
        if (image && !isImageUri(image)) return err("`image` 须为 http(s): 或 data: URI。");
        const keyframes = toStringArray(a.keyframes);
        if (keyframes?.some((u) => !isImageUri(u))) return err("`keyframes` 每项须为 http(s): 或 data: URI。");
        // M4:numFrames 与 durationSeconds 互斥(防 silent 覆盖 + estimate 错位导致长时间阻塞)
        if (optNumber(a.numFrames) != null && optNumber(a.durationSeconds) != null) {
          return err("`numFrames` 与 `durationSeconds` 互斥,二选一(numFrames 精确;durationSeconds 自动吸附最近合法帧数)。");
        }
        // mode/resolution 白名单(防非法 enum 穿透到 provider API,前置清晰报错)
        const VALID_MODE = new Set<string>(VIDEO_MODES);
        const VALID_RESOLUTION = new Set<string>(RESOLUTIONS);
        const mode = optString(a.mode);
        if (mode && !VALID_MODE.has(mode)) return err("mode 须为 text-to-video / image-to-video / keyframes。");
        const resolution = optString(a.resolution);
        if (resolution && !VALID_RESOLUTION.has(resolution)) return err("resolution 须为 480p / 720p / 1080p。");

        // model↔provider 校验 + 自动路由
        const model = optString(a.model);
        const resolved = resolveProvider(optString(a.provider), model, "video");
        const p = asVideoProvider(resolved.provider);
        const vc = p.videoConstraints();
        const warnings: string[] = [];
        if (resolved.autoRouted) {
          warnings.push(`model 自动路由:provider "${resolved.routedFrom}" → "${p.name}"。`);
        }
        // H2:frameRate 须在 provider 允许集(跨 provider 路由后按实际 provider 校验,如 cogvideox 要求 30/60)
        let frameRate = optNumber(a.frameRate) ?? vc.defaultFrameRate;
        if (!vc.allowedFrameRates.includes(frameRate)) {
          warnings.push(`frameRate ${frameRate} 不被 ${p.name} 支持(允许 ${vc.allowedFrameRates.join("/")}),已吸附为 ${vc.defaultFrameRate}。`);
          frameRate = vc.defaultFrameRate;
        }
        // effFrames:numFrames > durationSeconds 吸附 > 默认
        let effFrames =
          optNumber(a.numFrames) ??
          (optNumber(a.durationSeconds) !== undefined
            ? nearestAllowed(optNumber(a.durationSeconds)! * frameRate, vc.allowedNumFrames)
            : vc.defaultNumFrames);
        // H1:resolution×ratio 组合上限(agnes 实测 1080p≤241/720p≤441),防超限碰 API 400
        const maxF = p.maxFramesFor?.(optString(a.resolution), ratio);
        if (maxF != null && effFrames > maxF) {
          warnings.push(`numFrames ${effFrames} 超过 ${optString(a.resolution) ?? "当前分辨率"}上限 ${maxF}(provider 实测约束),已降为 ${maxF}。`);
          effFrames = maxF;
        }

        const estimated = p.estimateGenerationSeconds(effFrames, frameRate);
        const wait = a.wait === true || (a.wait === undefined && estimated <= ASYNC_THRESHOLD_SECONDS);

        // pares3: create_video fallback(铁律:仅 submit 可 fallback,poll 路径绝不 fallback)
        let activeProvider = p;
        let created: VideoTask;
        try {
          created = await p.createVideo({
            prompt, model, mode: mode as VideoMode | undefined, image, keyframes,
            resolution: resolution as Resolution | undefined, ratio, numFrames: effFrames, frameRate,
            durationSeconds: optNumber(a.durationSeconds), seed: optNumber(a.seed), negativePrompt: optString(a.negativePrompt),
          });
        } catch (e: any) {
          if (!isFallbackWorthy(e)) throw e;
          const fbRaw = getFallbackProvider(p.name, "video", { mode, keyframes, image });
          if (!fbRaw) throw e;
          const fb = asVideoProvider(fbRaw);
          // numFrames/frameRate 按目标 provider 约束重吸附
          const fbVc = fb.videoConstraints();
          let fbFrames = nearestAllowed(effFrames, fbVc.allowedNumFrames);
          let fbFps = frameRate;
          if (!fbVc.allowedFrameRates.includes(fbFps)) fbFps = fbVc.defaultFrameRate;
          // 复钳 fb 的 resolution×ratio numFrames 上限(如 agnes 1080p≤241;防 fallback 反而制造 API 400)
          const fbMaxF = fb.maxFramesFor?.(optString(a.resolution), ratio);
          if (fbMaxF != null && fbFrames > fbMaxF) {
            warnings.push(`fallback numFrames ${fbFrames} 超过 ${fb.name} 的 ${optString(a.resolution) ?? "当前分辨率"}上限 ${fbMaxF},已降为 ${fbMaxF}。`);
            fbFrames = fbMaxF;
          }
          warnings.push(`provider "${p.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${fb.name}"(免费),numFrames ${effFrames}→${fbFrames}。`);
          p.notifyUnavailable?.(e);
          activeProvider = fb;
          // 关键:不透传 durationSeconds —— Agnes.createVideo 会优先用 framesForDuration(durationSeconds) 重推导 numFrames,
          // 完全忽略传入的 fbFrames(1080p + durationSeconds∈[13,18]s 会推出 441>241 上限碰 API 400,正是 maxFramesFor 要防的场景)。
          // 强制走 numFrames 路径,让上面的 fbFrames clamp 真正生效。
          try {
            created = await fb.createVideo({
              prompt, model: undefined, mode: mode as VideoMode | undefined, image, keyframes,
              resolution: resolution as Resolution | undefined, ratio, numFrames: fbFrames, frameRate: fbFps,
              seed: optNumber(a.seed), negativePrompt: optString(a.negativePrompt),
            });
          } catch (fbErr: any) {
            if (isFallbackWorthy(fbErr)) fb.notifyUnavailable?.(fbErr);
            throw fbErr;
          }
        }
        created.warnings?.forEach((w: string) => warnings.push(w));
        // 异步 hint 用实际句柄键(videoId 优先,否则 taskId)+ 实际 provider(activeProvider 防 fallback 后错位)
        const handleKey = created.videoId ? `videoId="${created.videoId}"` : `taskId="${created.taskId}"`;
        const handleHint = `get_video(${handleKey}${activeProvider.name !== config.defaultVideoProvider ? `, provider="${activeProvider.name}"` : ""})`;

        if (!wait) {
          return ok({
            ...created,
            async: true,
            provider_used: activeProvider.name,
            ...(warnings.length ? { warnings } : {}),
          });
        }

        let done: Awaited<ReturnType<typeof waitVideo>>;
        try {
          done = await waitVideo({
            provider: activeProvider,
            handle: { videoId: created.videoId, taskId: created.taskId },
            timeoutMs: optNumber(a.timeoutMs),
            pollIntervalMs: optNumber(a.pollIntervalMs),
            onProgress: (pct, status) => emitProgress(pct, status),
          });
        } catch (e: unknown) {
          // failed:返回 handle 供 get_video 复查(而非抛错丢掉句柄)。
          // provider_used 必须是 activeProvider —— fallback 后任务实际在 fb 上,poll 路径不再 fallback,
          // 用户按此字段调 get_video 必须打到正确的 provider(否则 agnes 查 zhipu 的 task → not found)。
          // 同步补 handleHint(已用 activeProvider 构造),给一条可直接复制的 get_video 复查命令。
          return ok({
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
            provider_used: activeProvider.name,
            videoId: created.videoId,
            taskId: created.taskId,
            hint: `任务失败,可用 ${handleHint} 复查最终状态/错误详情。`,
            ...(warnings.length ? { warnings } : {}),
          });
        }
        let localPath: string | null = null;
        if (done.status === "completed" && done.url && a.download !== false) {
          localPath = await downloadAsset(done.url, "vid", outDir, optString(a.name));
        }
        const timeoutHint = done.status === "timeout" ? { hint: `等待超时但任务仍在后端生成;稍后用 ${handleHint} 拉取。` } : {};
        return ok({ ...done, provider_used: activeProvider.name, local_path: localPath, ...timeoutHint, ...(warnings.length ? { warnings } : {}) });
      }

      case "get_video": {
        if (!a.videoId && !a.taskId) {
          return err("get_video requires `videoId` (preferred) or `taskId`");
        }
        const p = asVideoProvider(getProvider(optString(a.provider) ?? config.defaultVideoProvider));
        const r = await p.getVideo({ videoId: optString(a.videoId), taskId: optString(a.taskId) });
        let localPath: string | null = null;
        if (r.status === "completed" && r.url && a.download !== false) {
          localPath = await downloadAsset(r.url, "vid", resolveOutDir(a.outDir), optString(a.name));
        }
        // 非终态给 retry 提示(免调用方盲目重试,不知何时再问)
        const retryAfter = Math.max(5, Math.round(config.video.pollIntervalMs / 1000));
        const retryHint = (r.status === "queued" || r.status === "in_progress")
          ? { retry_after_seconds: retryAfter, hint: `生成中,约 ${retryAfter}s 后再次调用 get_video 拉取。` }
          : {};
        return ok({ ...r, local_path: localPath, ...retryHint });
      }

      case "extract_text": {
        const image = requireString(a.image, "image");
        if (!isImageUri(image)) return err("`image` 须为 http(s): 或 data: URI;本地文件请先读取为 data URI 再传入。");
        const resolved = resolveProvider(optString(a.provider), optString(a.model), "vision");
        let activeProvider = asVisionProvider(resolved.provider);
        if (!activeProvider.visionTasks().includes("extract-text")) {
          return err(`provider "${activeProvider.name}" 不支持 extract-text(支持:${[...activeProvider.visionTasks()].join("/")})。`);
        }
        // ignoreAreas 严格校验(parseIgnoreAreas 接受 {x,y,w,h} / [[x1,y1],[x2,y2]] 两形态,非法即抛 → isError)
        let ignoreAreas;
        try {
          ignoreAreas = parseIgnoreAreas(a.ignoreAreas);
        } catch (e: any) {
          return err(e?.message ?? String(e));
        }
        const layout = optString(a.layout) as ExtractTextHints["layout"];
        const hints: ExtractTextHints = {
          languages: toStringArray(a.languages),
          digitOnly: a.digitOnly === true,
          segmentation: optString(a.segmentation) as ExtractTextHints["segmentation"],
          layout,
          ignoreAreas: ignoreAreas as ExtractTextHints["ignoreAreas"],
        };
        const outputFormat = optString(a.outputFormat) ?? "text";
        const warnings: string[] = [];
        let result: VisionResult;
        try {
          result = await activeProvider.recognize({ image, task: "extract-text", hints });
        } catch (e: any) {
          // pares3 fallback 链复用(M1 仅 tesseract;M2 paddle 接入后 tesseract↔paddle 自动切换)
          if (!isFallbackWorthy(e)) throw e;
          const fb = getFallbackProvider(activeProvider.name, "vision", { task: "extract-text" });
          if (!fb) throw e;
          activeProvider.notifyUnavailable?.(e);
          activeProvider = asVisionProvider(fb);
          if (!activeProvider.visionTasks().includes("extract-text")) throw e;
          warnings.push(`provider "${resolved.provider.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${activeProvider.name}"。`);
          result = await activeProvider.recognize({ image, task: "extract-text", hints });
        }
        // 透传 provider 返回的 warnings(tesseract 限制性 PSM 空结果回退告警等)
        if (result.warnings?.length) warnings.push(...result.warnings);
        // pares5 TBPU 后处理(provider-agnostic):先 filterIgnoreAreas(去水印/红章)→ 再 applyTbpu(排版重排)。
        // 铁律:剔除先于排版,避免被剔除块参与 GapTree 干扰列分隔线检测。
        // 仅在 provider 返回 blocks 时运行;无 blocks(仅 text)时跳过,免空 blocks 覆盖有效 text。
        if (result.blocks && result.blocks.length) {
          const filtered = filterIgnoreAreas(result.blocks, ignoreAreas);
          if (filtered.dropped > 0) {
            warnings.push(`ignoreAreas 剔除 ${filtered.dropped} 个文本块。`);
          }
          if (filtered.noBboxKept > 0) {
            warnings.push(`${filtered.noBboxKept} 个块无 bbox 无法判定忽略区,已保留。`);
          }
          const tbpu = applyTbpu(filtered.blocks, layout);
          if (tbpu.warnings?.length) warnings.push(...tbpu.warnings);
          result = { ...result, blocks: tbpu.blocks, text: tbpu.text };
        }
        let localPath: string | null = null;
        if (result.text && a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const safeName = path.basename(optString(a.name) ?? `ocr_${Date.now().toString(36)}`);
          localPath = path.join(outDir, `${safeName}.txt`);
          await fs.writeFile(localPath, result.text, "utf-8");
        }
        if (activeProvider.name === "tesseract") {
          warnings.push("使用 tesseract 进程内 OCR(零配置兜底,中文精度弱);配置 paddleocr provider 可获中文 SOTA。");
        }
        return ok({
          text: result.text,
          ...(outputFormat === "json" && result.blocks?.length ? { blocks: result.blocks } : {}),
          provider_used: activeProvider.name,
          ...(localPath ? { local_path: localPath } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }
      case "extract_table": {
        const image = requireString(a.image, "image");
        const hints: ExtractTableHints = { format: (optString(a.format) ?? "html") as "html" | "markdown" | "json" | "latex" };
        const { result, providerUsed, warnings } = await runVisionTask("extract-table", image, optString(a.provider), hints);
        let localPath: string | null = null;
        if (result.table?.content && a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          // 扩展名按 provider 实际返回的 format(非用户 hints.format),免 format=latex 但 provider 返 html→.tex 装 html 内容
          const actualFormat = result.table.format ?? "html";
          const ext = actualFormat === "html" ? "html" : actualFormat === "markdown" ? "md" : "txt";
          const safeName = path.basename(optString(a.name) ?? `table_${Date.now().toString(36)}`);
          localPath = path.join(outDir, `${safeName}.${ext}`);
          await fs.writeFile(localPath, result.table.content, "utf-8");
        }
        return ok({
          ...(result.table ? { table: result.table } : {}),
          provider_used: providerUsed,
          ...(localPath ? { local_path: localPath } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }
      case "analyze_chart": {
        const image = requireString(a.image, "image");
        const hints: AnalyzeChartHints = { chartType: optString(a.chartType) as AnalyzeChartHints["chartType"] };
        const { result, providerUsed, warnings } = await runVisionTask("analyze-chart", image, optString(a.provider), hints);
        let localPath: string | null = null;
        const content = result.chart ? JSON.stringify(result.chart, null, 2) : result.description;
        if (content && a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const safeName = path.basename(optString(a.name) ?? `chart_${Date.now().toString(36)}`);
          localPath = path.join(outDir, `${safeName}.json`);
          await fs.writeFile(localPath, content, "utf-8");
        }
        return ok({
          ...(result.chart ? { chart: result.chart } : {}),
          ...(result.description ? { description: result.description } : {}),
          provider_used: providerUsed,
          ...(localPath ? { local_path: localPath } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }
      case "describe_image": {
        const image = requireString(a.image, "image");
        const question = optString(a.question);
        const hints: DescribeImageHints | undefined = question ? { question } : undefined;
        const { result, providerUsed, warnings } = await runVisionTask("describe-image", image, optString(a.provider), hints);
        let localPath: string | null = null;
        if (result.description && a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const safeName = path.basename(optString(a.name) ?? `desc_${Date.now().toString(36)}`);
          localPath = path.join(outDir, `${safeName}.md`);
          await fs.writeFile(localPath, result.description, "utf-8");
        }
        return ok({
          description: result.description,
          provider_used: providerUsed,
          ...(localPath ? { local_path: localPath } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }
      case "list_models": {
        return ok({ providers: listProviders(), detail: buildListModelsDetail(optString(a.provider)) });
      }

      case "list_vision_capabilities": {
        // pares6: 自省工具。零网络(仅 health/visionConstraints/describeVisionOptions)。
        return ok(buildVisionCapabilitiesDetail(optString(a.provider)));
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
          width: optNumber(a.width),
        });
        const fp = await writeLocalRender(outDir, "qr", optString(a.name), format, rendered);
        return ok({ format, local_path: fp, ...(rendered.warnings?.length ? { warnings: rendered.warnings } : {}) });
      }

      case "generate_chart": {
        if (!a.spec || typeof a.spec !== "object") {
          return err("spec (Vega-Lite JSON object) is required");
        }
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderChart({ spec: a.spec, format });
        const fp = await writeLocalRender(outDir, "chart", optString(a.name), format, rendered);
        return ok({ format, local_path: fp, ...(rendered.warnings?.length ? { warnings: rendered.warnings } : {}) });
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
          background: optString(a.background),
        });
        const fp = await writeLocalRender(outDir, "formula", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
      }

      case "generate_icon": {
        const iconId = requireString(a.icon, "icon");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        const rendered = await renderIcon({
          name: iconId,
          size: optNumber(a.size),
          color: optString(a.color),
          background: optString(a.background),
          format,
        });
        const outName = optString(a.name) ?? iconId.replace(/[^a-zA-Z0-9._-]+/g, "-");
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
        return ok({ format, local_path: fp, ...(rendered.warnings?.length ? { warnings: rendered.warnings } : {}) });
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

      case "render_video": {
        const html = requireString(a.html, "html");
        const outDir = resolveOutDir(a.outDir);
        const format: "mp4" | "gif" | "webm" =
          a.format === "gif" ? "gif" : a.format === "webm" ? "webm" : "mp4";
        const rendered = await renderVideo({
          html,
          duration: optNumber(a.duration) ?? 0,
          fps: optNumber(a.fps),
          width: optNumber(a.width),
          height: optNumber(a.height),
          format,
          scale: optNumber(a.scale),
          quality: optNumber(a.quality),
          onProgress: (pct) => emitProgress(pct, `rendering frames… (${pct}%)`),
        });
        // 视频落盘(Buffer → 文件,sanitize name 同 writeLocalRender)
        await fs.mkdir(outDir, { recursive: true });
        const safeName = path.basename(optString(a.name) ?? `video_${Date.now().toString(36)}`);
        const fp = path.join(outDir, `${safeName}.${rendered.ext}`);
        await fs.writeFile(fp, rendered.video);
        return ok({
          format,
          mime_type: rendered.mimeType,
          frame_count: rendered.frameCount,
          elapsed_ms: rendered.elapsedMs,
          local_path: fp,
          ...(rendered.warning ? { warning: rendered.warning } : {}),
        });
      }

      case "extract_pdf": {
        // pares6: PDF 异步识别管线。镜像 create_video/get_video 异步模式 + 复用 extract_text per-page 后处理。
        const source = requireString(a.source, "source");
        if (!isPdfSource(source)) {
          return err("`source` 须为 http(s):// / data:application/pdf / file:// 或本地 .pdf 路径。");
        }
        // 校验 ignoreAreas 早期失败(同 extract_text)
        let ignoreAreasRaw: unknown;
        try {
          // 先 parse 校验合法性(若非法 isError 退出);原值透传给 pipeline 内部再 parse
          parseIgnoreAreas(a.ignoreAreas);
          ignoreAreasRaw = a.ignoreAreas;
        } catch (e: any) {
          return err(e?.message ?? String(e));
        }
        // concurrency 钳制 [1,4](防大并发 OOM)。v1 pipeline 实际为串行(concurrency 仅校验,不改变行为);v2 加并行池后启用。
        const reqConc = optNumber(a.concurrency);
        if (reqConc && (reqConc < 1 || reqConc > 4)) {
          return err("`concurrency` 须在 [1, 4] 区间(v1 实际为串行;此参数保留给 v2 并行池)。");
        }
        // scale 钳制 [0.5, 3.0](render.ts 内部再钳一次,这里前置给清晰错)
        const reqScale = optNumber(a.scale);
        if (reqScale != null && (reqScale < 0.5 || reqScale > 3.0)) {
          return err("`scale` 须在 [0.5, 3.0] 区间(大 PDF OOM 保护)。");
        }
        // textStrategy 白名单
        const textStrategy = optString(a.textStrategy);
        if (textStrategy && !["auto", "ocr-only", "text-layer-only"].includes(textStrategy)) {
          return err("`textStrategy` 须为 auto / ocr-only / text-layer-only。");
        }
        const outputFormat = (optString(a.outputFormat) ?? "text") as "text" | "markdown" | "json";

        // 解析 provider(对齐 extract_text:resolveProvider + asVisionProvider + task 门禁)
        const resolved = resolveProvider(optString(a.provider), optString(a.model), "vision");
        const preferred = asVisionProvider(resolved.provider);
        if (!preferred.visionTasks().includes("extract-text")) {
          return err(`provider "${preferred.name}" 不支持 extract-text(支持:${[...preferred.visionTasks()].join("/")})。`);
        }

        // 同步/异步决策:先确定总页数 + pageRange,再用【目标页数】估耗时/OOM 门禁
        // 审查数据#3:maxPages 原用文档总页数,pageRange 子集请求(如 300 页 PDF 取 1-5)被误拒;改为 targetCount
        let totalPages: number;
        try {
          totalPages = await getPdfPageCount(source);
        } catch (e: any) {
          return err(`PDF 加载失败:${e instanceof Error ? e.message : String(e)}`);
        }
        if (totalPages <= 0) return err("PDF 无任何页面。");
        const range = parsePageRange(optString(a.pageRange), totalPages);
        const targetCount = range.pages.length || totalPages;
        const maxPages = (config as any).pdf?.maxPages ?? 200;
        if (targetCount > maxPages) {
          return err(`目标页数 ${targetCount}(pageRange 解析后)超过上限 ${maxPages}(OOM 保护,可经 config.pdf.maxPages 调优)。文档总页数 ${totalPages}。`);
        }
        const estSeconds = estimatePdfSeconds(targetCount, preferred.name);
        const wait = a.wait === true || (a.wait === undefined && estSeconds <= ASYNC_THRESHOLD_SECONDS);

        const pipelineInput: PdfPipelineInput = {
          source,
          pageRange: optString(a.pageRange),
          textStrategy: textStrategy as PdfPipelineInput["textStrategy"],
          languages: toStringArray(a.languages),
          digitOnly: a.digitOnly === true,
          segmentation: optString(a.segmentation) as ExtractTextHints["segmentation"],
          layout: optString(a.layout) as ExtractTextHints["layout"],
          ignoreAreasRaw,
          mergePages: a.mergePages === false ? false : true,
          outputFormat,
          // 审查架构#4:per-call scale 缺省时回落 config.pdf.scale(原死配置,用户配 PDF_SCALE 现生效)
          scale: reqScale ?? (config as any).pdf?.scale,
          provider: optString(a.provider),
        };
        const warnings: string[] = [];
        if (range.warnings.length) warnings.push(...range.warnings);
        if (resolved.autoRouted) {
          warnings.push(`model 自动路由:provider "${resolved.routedFrom}" → "${preferred.name}"。`);
        }

        if (!wait) {
          // 异步:fire-and-forget 注册 job
          const pdfId = runPdfAsync(
            pipelineInput,
            preferred,
            targetCount,
            totalPages,
            (pct, msg) => emitProgress(pct, msg),
          );
          return ok({
            async: true,
            pdfId,
            status: "in_progress",
            total_pages: totalPages,
            target_pages: targetCount,
            estimated_seconds: estSeconds,
            provider_used: preferred.name,
            hint: `get_pdf(pdfId="${pdfId}")`,
            ...(warnings.length ? { warnings } : {}),
          });
        }

        // 同步:跑完(审查规范/业务/端到端:删原 no-op try/catch — 顶层 catch 已统一兜底)
        const result = await runPdfPipeline(pipelineInput, preferred, (pct, msg) => emitProgress(pct, msg));
        // 把 pipeline 产出的 warnings 与早期 warnings 合并去重
        for (const w of result.warnings) {
          if (!warnings.includes(w)) warnings.push(w);
        }
        // 落盘
        let localPath: string | null = null;
        if (a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const safeName = path.basename(optString(a.name) ?? `pdf_${Date.now().toString(36)}`);
          const ext = outputFormat === "json" ? ".json" : outputFormat === "markdown" ? ".md" : ".txt";
          localPath = path.join(outDir, `${safeName}${ext}`);
          let fileContent: string;
          if (outputFormat === "json") {
            fileContent = JSON.stringify({
              provider_used: result.providerUsed,
              path: result.path,
              total_pages: result.totalPages,
              pages: result.pages,
            }, null, 2);
          } else if (outputFormat === "markdown") {
            fileContent = result.pages.map((p) => `## Page ${p.page}\n\n${p.text ?? "(empty)"}`).join("\n\n---\n\n");
          } else {
            fileContent = result.text ?? result.pages.map((p) => p.text ?? "").join("\n\f\n");
          }
          await fs.writeFile(localPath, fileContent, "utf-8");
        }
        if (result.path === "text-layer" && preferred.name === "tesseract") {
          // 走 text-layer 时 tesseract 未被实际调用,不必加兜底提示
        } else if (result.path !== "text-layer" && preferred.name === "tesseract") {
          warnings.push("使用 tesseract 进程内 OCR(零配置兜底,中文精度弱);配置 paddleocr provider 可获中文 SOTA。");
        }
        return ok({
          path: result.path,
          total_pages: result.totalPages,
          target_pages: result.pages.length,
          pages: result.pages,
          ...(result.text != null ? { text: result.text } : {}),
          provider_used: result.providerUsed,
          ...(localPath ? { local_path: localPath } : {}),
          ...(warnings.length ? { warnings } : {}),
        });
      }

      case "get_pdf": {
        // 镜像 get_video:读 job-store;非终态给 retry 提示
        const pdfId = requireString(a.pdfId, "pdfId");
        const job = getPdfJob(pdfId);
        if (!job) {
          return err(`pdfId "${pdfId}" 不存在(可能已过期,job TTL ${(config as any).pdf?.jobTtlMs ? Math.round(((config as any).pdf.jobTtlMs / 1000 / 60)) : 30} 分钟)。请重新调用 extract_pdf。`);
        }
        if (job.status === "in_progress" || job.status === "registered") {
          const retryAfter = 5;
          return ok({
            status: job.status,
            pdfId: job.id,
            progress: job.progress,
            done: job.done,
            total: job.total,
            retry_after_seconds: retryAfter,
            hint: `识别中(已完成 ${job.done}/${job.total} 页),约 ${retryAfter}s 后再次调用 get_pdf 拉取。`,
          });
        }
        if (job.status === "failed") {
          return ok({
            status: "failed",
            pdfId: job.id,
            error: job.error ?? "unknown error",
            provider_used: job.providerUsed,
            hint: `任务失败。修正后请重新调用 extract_pdf。`,
            ...(job.warnings.length ? { warnings: job.warnings } : {}),
          });
        }
        // completed
        const mergePages = job.input.mergePages !== false;
        const built = buildResultFromJob(job, mergePages);
        // 落盘(同 extract_pdf 同步路径)
        let localPath: string | null = null;
        if (a.download !== false) {
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const safeName = path.basename(optString(a.name) ?? `pdf_${job.id}`);
          const outputFormat = (job.input.outputFormat ?? "text") as "text" | "markdown" | "json";
          const ext = outputFormat === "json" ? ".json" : outputFormat === "markdown" ? ".md" : ".txt";
          localPath = path.join(outDir, `${safeName}${ext}`);
          let fileContent: string;
          if (outputFormat === "json") {
            fileContent = JSON.stringify({
              provider_used: built.providerUsed,
              path: built.path,
              total_pages: built.totalPagesDoc,
              pages: built.pages,
              ...(built.rangeWarnings?.length ? { range_warnings: built.rangeWarnings } : {}),
            }, null, 2);
          } else if (outputFormat === "markdown") {
            fileContent = built.pages.map((p) => `## Page ${p.page}\n\n${p.text ?? "(empty)"}`).join("\n\n---\n\n");
          } else {
            fileContent = built.text ?? built.pages.map((p) => p.text ?? "").join("\n\f\n");
          }
          await fs.writeFile(localPath, fileContent, "utf-8");
        }
        return ok({
          status: "completed",
          pdfId: job.id,
          ...(built.path ? { path: built.path } : {}),
          ...(built.totalPagesDoc != null ? { total_pages: built.totalPagesDoc } : {}),
          pages: built.pages,
          ...(built.text != null ? { text: built.text } : {}),
          provider_used: built.providerUsed,
          ...(localPath ? { local_path: localPath } : {}),
          ...(built.rangeWarnings?.length ? { range_warnings: built.rangeWarnings } : {}),
          ...(built.warnings.length ? { warnings: built.warnings } : {}),
        });
      }

      default:
        return err(`unknown tool: ${req.params.name}`);
    }
  } catch (e: unknown) {
    return err(e instanceof Error ? e.message : String(e));
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

/** 简单并发池:capacity 个 worker 拉取 tasks;单任务抛错隔离为 null,不影响其他;收集首错供调用方诊断。供 generate_image 的 n 批量 fan-out 用。 */
async function runPool<T>(tasks: (() => Promise<T>)[], capacity: number): Promise<{ results: (T | null)[]; firstError: any }> {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  let firstError: any = null;
  let i = 0;
  const workers = Array.from({ length: Math.min(capacity, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch (e) { results[idx] = null; if (!firstError) firstError = e; }
    }
  });
  await Promise.all(workers);
  return { results, firstError };
}
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

await server.connect(new StdioServerTransport());
