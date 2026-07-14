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

const ASYNC_THRESHOLD_SECONDS = 60;

const server = new Server(
  { name: "media-gen-mcp", version: "0.3.2" },
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
        "Generate or edit an image via the active provider (default Agnes AI). Text-to-image by default; pass `images` (URL or data URI array) for image-to-image. Output downloads to OUT_DIR (or `outDir` arg) and the local path is returned.",
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
        "Create a video via the active provider (default Agnes AI). Text-to-video by default; `image` for image-to-video; `keyframes` for keyframe animation. Smart async: omit `wait` → if estimated generation > 60s, returns a handle immediately (caller polls/notifies); otherwise blocks to completion. Agnes limits video creation to 1 req/min; the server serializes submits.",
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
        "Poll a video task by videoId (preferred) or taskId, and optionally download the result mp4.",
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
      description: "List available models and video constraints per provider (and the providers themselves).",
      inputSchema: {
        type: "object",
        properties: { provider: { type: "string" } },
      },
    },
    {
      name: "generate_diagram",
      description:
        "Generate a structured diagram from DSL code, rendered locally to SVG (vector, high-res) — no AI, deterministic. Engines: d2 (D2 syntax, default — covers flowchart/sequence/class/ER/mindmap/architecture) and graphviz (DOT syntax). Claude generates the DSL; this tool renders it. NOTE: mermaid is not supported in-process (needs a browser); use d2 or graphviz instead.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "DSL source code (D2 or DOT/Graphviz syntax). Generated by Claude." },
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
      description: "Generate a QR code (SVG vector or PNG) from text/URL. Pure local rendering, no AI, no network.",
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
      description: "Generate a data visualization chart (bar/line/pie/area/scatter) from Vega-Lite spec. Claude generates the Vega-Lite JSON; this tool renders it to SVG (vector). Pure local, no AI.",
      inputSchema: {
        type: "object",
        properties: {
          spec: { type: "object", description: "Vega-Lite specification (JSON object). Claude generates this." },
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
        "Render a LaTeX math formula to SVG (vector) via MathJax. Glyph paths are embedded (no font dependency). Claude writes the LaTeX; this tool renders it. Example: tex='E=mc^2' or tex='\\\\frac{a}{b}'. Pure local, no AI.",
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
        "Fetch and render a vector icon by name (prefix:name, e.g. 'mdi:home', 'logos:github', 'lucide:check') to SVG (vector) or PNG. Uses the Iconify public API + in-memory cache. NOTE: this is the only tool that needs network. Browse names at https://icon-sets.iconify.design. No AI.",
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
        "Generate a text card / OG image / social share card (default 1200x630 PNG) from structured fields via Satori + resvg. No AI. Useful for blog OG images, quote cards, share cards. Default font Inter (Latin); CJK (Chinese/Japanese/Korean) is built-in (auto-detected, Noto Sans SC fallback, offline). Supports solid or CSS-gradient backgrounds, and renders emoji in color (twemoji, auto). Default font fetch + emoji need network (cached); pass fontPath to override the base font fully offline.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Main title (required)" },
          subtitle: { type: "string", description: "Subtitle / kicker (accent color)" },
          body: { type: "string", description: "Body / description text" },
          footer: { type: "string", description: "Footer (author / date / domain)" },
          template: { type: "string", enum: ["og", "quote", "minimal", "hero", "panel"], default: "og", description: "Layout template (og=default hierarchy, quote=centered quote, minimal=title+subtitle, hero=big centered showcase, panel=content in a glass panel)" },
          width: { type: "number", description: "Pixel width (default 1200, OG standard)" },
          height: { type: "number", description: "Pixel height (default 630, OG standard)" },
          bg: { type: "string", description: "Background: a solid color (default #0f172a) OR a CSS gradient string, e.g. linear-gradient(135deg, #4f46e5, #06b6d4) / radial-gradient(circle at 30% 30%, #f59e0b, #ef4444)" },
          color: { type: "string", description: "Text color (default #f8fafc)" },
          accent: { type: "string", description: "Accent color (default #6366f1)" },
          titleGradient: { type: "string", description: "CSS gradient applied to the title text via background-clip:text, e.g. linear-gradient(90deg,#f59e0b,#ef4444)" },
          glow: { type: "string", description: "Title glow (text-shadow). Pass true (as the string 'true') to derive from accent, or a full text-shadow value like '0 0 40px rgba(245,158,11,.6)'." },
          blob: { type: "boolean", default: true, description: "hero template only: blurred accent blob behind the title for depth (default true)" },
          fontFamily: { type: "string", description: "Font family from @fontsource (default Inter, Latin only)" },
          fontPath: { type: "string", description: "Local base-font file path (.ttf/.otf/.woff) to override the default Inter; optional (CJK auto-supported via built-in Noto Sans SC)" },
          format: { type: "string", enum: ["svg", "png"], default: "png" },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["title"],
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
          fontFamily: optString(a.fontFamily),
          fontPath: optString(a.fontPath),
          format,
        });
        const fp = await writeLocalRender(outDir, "card", optString(a.name), format, rendered);
        return ok({ format, local_path: fp });
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
