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
import { getProvider, listProviders, resolveProvider, buildListModelsDetail, buildVisionCapabilitiesDetail, getFallbackProvider, getProviderPriority, asImageProvider, asVideoProvider, asVisionProvider } from "./providers/registry.js";
import { FlowProvider, isFlowMediaIdLike } from "./providers/flow.js";
import { isFallbackWorthy, isChainAdvanceable } from "./providers/http.js";
import type { ImageResult, VideoMode, Resolution, VideoTask, ExtractTextHints, ExtractTableHints, AnalyzeChartHints, DescribeImageHints, VisionResult, VisionTask } from "./providers/types.js";
import { waitVideo } from "./poll.js";
import { downloadAsset, sanitizeFileBase } from "./download.js";
import fs from "node:fs/promises";
import { getDiagramEngine, MERMAID_UNSUPPORTED_MSG } from "./diagram/render.js";
import { renderInteractiveHtml } from "./interactive-html/index.js";
import { renderNestedDiagram } from "./nested-diagram/index.js";
import { renderQR } from "./qr.js";
import { renderChart } from "./chart.js";
import { renderFormula } from "./formula.js";
import { renderIcon } from "./icon.js";
import { renderCard } from "./card.js";
import { renderSvg } from "./render-svg.js";
import { renderVideo } from "./render-video.js";
import { extractImageMeta } from "./extract-image-meta.js";
import { normalizeEngineError } from "./handlers/error-format.js";
import { assertOutputClean } from "./checks/output-checker.js";
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
  // create_video 的 schema 约束按"视频模态链头"展示,与实际路由一致
  // (例:defaultVideoProvider=zhipu 时展示 150/300,而非 agnes 的 81/121/...;handler 仍按实际 provider 复算 vc)。
  // C 任务:链头 = videoProviderPriority[0](若配置且具备 video 能力)→ 否则 defaultVideoProvider。
  // 与 scripts/check-schema.mjs 用同一 videoProviderChainHead 真源(能力缺失时双方各自回落,保一致)。
  const videoHead = (() => {
    try { return asVideoProvider(getProvider(config.videoProviderChainHead)).name; }
    catch { return config.defaultVideoProvider; }
  })();
  const vc = asVideoProvider(getProvider(videoHead)).videoConstraints();

  return [
    {
      name: "generate_image",
      description:
        "Generate or edit an AI image (text-to-image 文生图/AI画图; or image-to-image 图生图 via `images`) using free models (Agnes AI default, or Zhipu). Output downloads locally and the path is returned; no local rendering libs needed.\n\nWHEN: subject is photographic or illustrated (写实图/插画/概念图/original logo artwork / 原创品牌主视觉); user says 'AI画图 / 文生图 / generate an image of ...' and wants AI-generated pixels.\n\nAVOID:\n- Text-heavy cards / OG images / posters / quote cards / cover images → use `generate_card` instead (deterministic Satori render, no AI variability, same input → same output).\n- An existing brand logo (Iconify 200k+ vector set) → use `generate_icon` instead; this tool only draws ORIGINAL logo artwork.\n\nNEXT: call `list_models` first to discover available model names and size constraints per provider. provider=flow (Google Flow via local Chrome): `aspect` (16:9/9:16/1:1/3:4/4:3) and `seed` are honored exactly; outputs carry `mediaId`+`seed` (re-download via `flow_status(mediaId)`); image generation is 0-credit. provider=flow also accepts `images` (image-to-image, live-verified): images[0] = base image (aspect follows the base), images[1..10] = references — each is uploaded to the Flow project first (0 credits). Image UPSCALE: model=GEM_PIX_2_UPSAMPLE_2K + images[0] (an existing image mediaId, or a URI to upload first) → 2K upscale, 0 credits, prompt ignored.\n\nMultilingual triggers: 画像 · imagen · image · Bild · изображение · imagem (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image description." },
          model: {
            type: "string",
            description: "Optional; omit to use the provider default. Call list_models to see options. provider=flow: GEM_PIX_2_UPSAMPLE_2K = 2K UPSCALE mode (requires images[0] = an existing image mediaId or a URI; 0 credits, prompt ignored).",
          },
          size: { type: "string", description: "e.g. 1024x1024. Zhipu requires each side 512-2880, multiple of 16, pixels ≤ 2^21 — the tool auto-snaps to a valid size; Agnes accepts free size. provider=flow: size maps to the nearest of 5 aspect ratios (1920x1080→16:9 / 720x1280→9:16 / 1024x1024→1:1 / 768x1024→3:4 / 1024x768→4:3); pass `aspect` for an exact ratio." },
          aspect: { type: "string", enum: ["16:9", "9:16", "1:1", "3:4", "4:3"], description: "Direct aspect ratio (provider=flow only — maps to Flow IMAGE_ASPECT_RATIO_*; exact, no size guessing). Other providers ignore it with a warning; use `size` there." },
          seed: { type: "number", description: "Seed for reproducible results (provider=flow only — goes straight into the request; the response echoes the actual per-image seed). Other providers ignore it with a warning." },
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
          provider: { type: "string", default: config.imageProviderChainHead, description: "Optional; omit to use the image provider chain head (imageProviderPriority[0] if configured, else defaultImageProvider). On failure the chain falls through in order (e.g. flow → agnes → zhipu); explicitly naming a provider pins it (no silent substitution)." },
        },
        required: ["prompt"],
      },
    },
    {
      name: "create_video",
      description:
        "Create an AI video (text-to-video / image-to-video / keyframe animation; 文生视频/图生视频/关键帧动画/让这张图动起来/做个动画) via free models (Agnes AI default, or Zhipu). Smart async: long videos return a handle to poll with `get_video`; short ones block until done.\n\nWHEN: user wants photorealistic or AI-generated video (写实视频 / AI 合成画面 / 让这张图动起来). AVOID when the user wants deterministic motion graphics — see below.\n\nAVOID:\n- HTML/CSS/GSAP motion graphics / kinetic typography / animated charts / brand intros (deterministic, same input → same output, no AI) → use `render_video` instead.\n\nNEXT: if the call returns a handle (async mode), poll with `get_video` until status=done. Call `list_models` first to verify allowed numFrames per provider (Agnes constraints vary by resolution). Flow provider (provider=\"flow\"): model = full usage key (live catalog via `flow_status`), durationSeconds ∈ {4,6,8,10}s (off-grid snaps nearest), ratio 16:9/9:16 only, ONE clip per call — repeat calls for x2-x4 (each bills credits and gets its own seed). Modes (2026-08-23 live-verified wire): text-to-video (t2v key), image-to-video (`image` + i2v key e.g. abra_i2v_8s; upload 0 credits), reference images (`images` 1-10 + r2v key e.g. abra_r2v_8s, 7-15 credits by duration), first+last frame (`keyframes` = exactly 2 images + interpolation/_fl key), extend (`videoMediaId` = an existing video's mediaId + extension key e.g. veo_3_1_extension_lite, 10 credits — references generated videos directly, no upload), upscale (`videoMediaId` + veo_3_1_upsampler_1080p, 0 credits), V2V edit (`videoMediaId` + prompt edit instruction + abra_edit, 20 credits — wire probe-verified, NOT yet live-submitted; the response carries a warning).\n\nMultilingual triggers: 動画 · vídeo · vidéo · Video · видео · vídeo (ja/es/fr/de/ru/pt).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video content description." },
          model: { type: "string", description: "Optional; omit to use the provider default video model. provider=flow: pass a FULL usage key (e.g. abra_t2v_8s / veo_3_1_t2v_lite / veo_3_1_upsampler_1080p) or mnemonic+durationSeconds (abra_t2v + 8) — the complete live catalog is in flow_status; open key families: t2v (text), i2v (+`image`), r2v (+`images`), interpolation/_fl (+`keyframes` 2), extension (+`videoMediaId`, e.g. veo_3_1_extension_lite / veo_3_1_extend_fast_landscape), upsampler (+`videoMediaId`, veo_3_1_upsampler_1080p = 0 credits; 4k tier-locked), edit (+`videoMediaId` + edit-instruction prompt, abra_edit = 20 credits, wire probe-verified)." },
          mode: { type: "string", enum: [...VIDEO_MODES] },
          image: { type: "string", description: "image-to-video: single image URL (http(s)/data:). provider=flow: START_IMAGE — upload (0 credits) then submit; requires an i2v key (e.g. abra_i2v_8s / veo_3_1_i2v_lite), a t2v key + image → structured S301 telling you the key to use." },
          keyframes: { type: "array", items: { type: "string" }, description: "keyframes: image URL array. provider=flow: exactly 2 images (first + last frame), requires an interpolation/_fl key (e.g. veo_3_1_interpolation_lite / veo_3_1_i2v_s_fast_fl); other counts or key families → structured S301." },
          images: { type: "array", items: { type: "string" }, description: "reference images (provider=flow only): 1-10 image URLs (http(s)/data:) for r2v keys (e.g. abra_r2v_8s / veo_3_1_r2v_lite) — uploaded (0 credits) then submitted as referenceImages. Mutually exclusive with image/keyframes/videoMediaId. Other providers ignore it with a warning." },
          videoMediaId: { type: "string", description: "provider=flow only: mediaId of an EXISTING video in the Flow project (see flow_status) as the source for extension keys (veo_3_1_extension_lite, 10 credits), V2V edit (abra_edit + prompt = the edit instruction, 20 credits) or the 0-credit upscaler (veo_3_1_upsampler_1080p) — references the generated video directly (videoInput:{mediaId}), no re-upload needed. Must be a completed video; images/in-progress ids → structured S301." },
          resolution: { type: "string", enum: [...RESOLUTIONS], default: "720p", description: "Provider may snap to nearest preset (Agnes size_mapping). provider=flow: ignored with a warning — resolution is decided by the model key (720P); for higher res use key variants (e.g. veo_3_1_t2v_fast_ultra) or the 0-credit veo_3_1_upsampler_1080p afterwards." },
          ratio: { type: "string", description: "16:9 / 9:16 / 1:1 / 4:3 / 3:4 (preferred over raw size). provider=flow: video supports 16:9 / 9:16 only (others → structured S301)." },
          numFrames: { type: "number", enum: vc.allowedNumFrames, default: vc.defaultNumFrames, description: "Allowed: " + vc.allowedNumFrames.join("/") + " (provider-specific; cross-provider routing re-validates per actual provider — check list_models). provider=flow: prefer durationSeconds (native set = 96/144/192/240 @24fps)." },
          frameRate: { type: "number", enum: vc.allowedFrameRates, default: vc.defaultFrameRate, description: "允许值 " + vc.allowedFrameRates.join("/") + " (provider 专有;跨 provider 路由后按实际 provider 复算)" },
          durationSeconds: { type: "number", description: "If set, auto-pick the nearest valid numFrames (~3/5/10/18s). provider=flow: legal set {4,6,8,10}s — off-grid values snap to the nearest with a warning (5→4s, 12→10s)." },
          seed: { type: "number" },
          negativePrompt: { type: "string" },
          wait: { type: "boolean", description: "省略=智能(预估≤60s 同步、>60s 异步返回 handle);true=阻塞等待(发 progress);false=立即返回 handle。" },
          timeoutMs: { type: "number", default: 900000 },
          pollIntervalMs: { type: "number", default: 10000 },
          download: { type: "boolean", default: true },
          name: { type: "string", description: "Output filename (without extension). Defaults to vid_<uuid>." },
          outDir: { type: "string", description: "产物落盘目录,省略用默认(会话目录/output)。" },
          provider: { type: "string", default: videoHead, description: "Optional; omit to use the video provider chain head (videoProviderPriority[0] if configured, else defaultVideoProvider). provider=flow bills credits — always pass it explicitly when Flow video is intended." },
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
          provider: { type: "string", default: videoHead, description: "Provider used at task creation: 'agnes' / 'zhipu' / 'flow' — defaults to the video provider chain head. create_video responses carry provider_used; pass it back here to poll the right backend." },
        },
      },
    },
    {
      name: "flow_status",
      description:
        "Google Flow introspection / media status / download / delete / share / cancel (ZERO-CREDIT; 零消耗自省/状态查询/媒体下载/媒体删除/分享链接/取消生成). Backed by the LOCAL Chrome session via CDP (lasso launch-chrome --port 9223, logged into labs.google) — every call runs as page-context fetch, no API keys needed. With NO mediaId: full snapshot (login email, credits balance, dynamic image/video model catalog with per-key generationTimeSeconds, 30 preset voices, project media list). With mediaId: one media's generation status (+ download the finished mp4/png locally). With deleteMediaIds: batch-delete project media (0 credits, IRREVERSIBLE — keeps flow_status polling payloads small). With shareMediaIds: create public share links (0 credits). With cancelMediaIds: cancel in-flight generations (0 credits). NEVER submits generation — video/image submission goes through create_video / generate_image with provider=\"flow\" (video costs credits: abra 7-20, veo lite 10 / fast 20 / quality 100 per clip; images & upscaling are 0-credit).\n\nWHEN: preflight before using the flow provider; poll a submitted mediaId; fetch an already-generated asset; check remaining credits; clean up accumulated media; share a result; cancel a wrong submission before it finishes.\n\nNEXT: create_video(provider=\"flow\", model=\"abra_t2v_8s\") submits (async handle → get_video(provider=\"flow\", taskId=…)); flow_status(mediaId=…) tracks it; flow_status(deleteMediaIds=[…]) deletes; flow_status(shareMediaIds=[…]) shares; flow_status(cancelMediaIds=[…]) cancels while in_progress.\n\nMultilingual triggers: flow 状态 · flow 积分 · Flow status (zh/en).",
      inputSchema: {
        type: "object",
        properties: {
          mediaId: { type: "string", description: "Optional: return this media's generation status instead of the full project snapshot (mediaId == create_video taskId)." },
          download: { type: "boolean", default: true, description: "With mediaId + completed status: download the asset (video/mp4 or image) locally." },
          thumbnail: { type: "boolean", default: false, description: "With mediaId: fetch the JPEG thumbnail (MEDIA_URL_TYPE_THUMBNAIL) instead of the original asset." },
          deleteMediaIds: { type: "array", items: { type: "string" }, description: "Batch-DELETE these project media (0 credits, IRREVERSIBLE 不可恢复; POST /v1/flow:batchDeleteAssets). Any unknown id → the whole batch is refused (S400, nothing deleted). Mutually exclusive with mediaId/shareMediaIds/cancelMediaIds. Use to keep the polling payload small." },
          shareMediaIds: { type: "array", items: { type: "string" }, description: "Create PUBLIC share links for these project media (0 credits; tRPC flow.share.shareMedia → mediaShareId). Returns shareUrl per media: https://labs.google/fx/tools/flow/shared/{image|video}/<mediaShareId> (prompt included). Mutually exclusive with mediaId/deleteMediaIds/cancelMediaIds." },
          cancelMediaIds: { type: "array", items: { type: "string" }, description: "CANCEL in-flight VIDEO generations for these mediaIds (0 credits; POST /v1/flowMedia:cancelGeneration body {mediaId}). Only in_progress media are submitted — completed/failed are reported as notCancelable; status re-checked after (expect MEDIA_GENERATION_STATUS_CANCELED). LIVE-VERIFIED BOUNDARY: image in-flight cancel returns 404 (images are not cancelable — bundle wires cancel for the video queue only); video E2E cancel is wire-verified but not yet live-submitted. Mutually exclusive with mediaId/deleteMediaIds/shareMediaIds." },
          name: { type: "string", description: "Output filename (without extension). Defaults to flow_<mediaId-prefix>." },
          outDir: { type: "string", description: "下载落盘目录,省略用默认(会话目录/output)。" },
        },
      },
    },
    {
      name: "flow_entity",
      description:
        "Google Flow character entities (角色实体, ZERO-CREDIT; 24th tool). Create/update CHARACTER entities and bind a preset voice for later audio/character generation. Create: tRPC flow.createEntity {projectId, collectionId:\"\"} (empty string passes zod — no collection needed); update: PATCH /v1/flow/entities with dotted updateMask (displayName / characterInfo.audioReferences=[{presetVoiceId}] / characterInfo.imageReferences=[{workflowId}]). Entity images attach via imageMediaIds (completed image mediaIds; the workflowId mapping is resolved automatically from project workflows). 30 preset voices are star-named (achernar/charon/kore/…) with descriptions — list them via action=voices or flow_status preset_voices.\n\nLIMITATION (honest): Flow has NO entity read endpoint (projectContents has no entities key; collections REST is CORS-blocked in page context) — only entities created via this tool are tracked, in a local mirror ~/.media-gen-mcp/flow-entities.json (aligned with flow-project.json precedent). action=list returns the mirror, not a server query.\n\nWHEN: 角色卡 / 建角色 / character entity / bind voice / 角色绑定语音 / 绑定形象图.\n\nNEXT: generate the character image first (generate_image provider=flow), then flow_entity(action=create, displayName=…, imageMediaIds=[…], presetVoiceId=…) wires it up; all operations are 0-credit.\n\nMultilingual triggers: 角色 · 实体 · character · entity · voice binding (zh/en).",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "list", "voices"], default: "create", description: "create = new CHARACTER entity (+optional displayName/presetVoiceId/imageMediaIds in one call); update = rename/rebind an entity from the local mirror (entityId required); list = local mirror records (Flow has no entity read endpoint); voices = 30 preset voices (id/displayName/description)." },
          entityId: { type: "string", description: "action=update: the entityId from create (must exist in the local mirror)." },
          displayName: { type: "string", description: "Character display name (create defaults to server's 'Untitled Character' if omitted; update renames)." },
          presetVoiceId: { type: "string", description: "Preset voice id to bind as the character voice (e.g. charon; see action=voices for all 30). Validated before submission." },
          imageMediaIds: { type: "array", items: { type: "string" }, description: "Completed image mediaIds (from generate_image provider=flow / flow_status) to attach as the character's look — resolved to workflowIds automatically." },
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
        "Generate architecture / flowchart / sequence / class / ER / mindmap diagrams (架构图/流程图/时序图/类图/ER图/思维导图/示意图), rendered locally to vector SVG. The D2 and Graphviz engines are BUILT IN (WASM, bundled with this tool) — you do NOT need d2/dot/graphviz installed, do NOT run `which d2`/`which dot`, and do NOT shell out to them or write DOT files by hand; just call this tool and provide the D2 or DOT DSL. Prefer this for structured technical diagrams (architecture, flowchart, sequence, ER, class). For system/software architecture diagrams specifically, prefer a functional layered layout — top-level `direction: down` + container bands per concern (user access / business capability / technical support) + an independent box per functional domain; this is advisory, and flowcharts/sequence/ER/mindmap keep their native layouts. See generate_nested_diagram's MANIFEST DESIGN for the full method. LIMITS: D2 produces clean auto-laid-out diagrams with shapes/connections/basic style (fill/stroke/shadow/border-radius/gradients) — it does NOT support SVG filters (feGaussianBlur glow/blur), ambient lighting, vignette, pattern grids, or artistic depth effects. For highly stylized '酷炫/霓虹/科技感' graphics requiring glow/blur/depth beyond what D2 offers, use `render_svg` (hand-written SVG with feGaussianBlur) instead. mermaid is not supported in-process (needs a browser); use d2 or graphviz instead. Multilingual triggers: 図 · diagrama · diagramme · Diagramm · диаграмма · diagrama (ja/es/fr/de/ru/pt).\n\nNEXT: for interactive HTML with theme switch + animation (theme follows system light/dark, open the .html in a browser), use generate_interactive_diagram.",
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
      name: "generate_interactive_diagram",
      description:
        "Generate a SELF-CONTAINED INTERACTIVE HTML diagram (交互式自包含HTML图) — open the .html in a browser to interact (pan/zoom, theme toggle, edge-flow + node animation). Theme follows the system light/dark setting via @media (prefers-color-scheme: dark) baked into the SVG. Single .html file, all CSS/JS inlined, zero external deps. Backend: D2 WASM (same DSL as generate_diagram, zero new deps). Optional PNG preview. NOTE: full interactivity needs a browser — GitHub README strips <script>, so a README embed is static (no viewer/animation); for a theme-switching image in README use generate_diagram's SVG output instead. Multilingual triggers: 交互式图 · interactive diagram · diagrama interactivo · diagramme interactif · interaktives Diagramm · интерактивная диаграмма (en/zh/es/fr/de/ru). " +
        "WHEN TO CHOOSE: architecture diagram you open in a browser to explore (pan/zoom/theme/animation); blog or doc diagram served as a downloadable .html; product demo with subtle animation. " +
        "AVOID: static SVG/PNG in docs (use generate_diagram, lighter); video output (use render_video); hand-coding SVG (use render_svg). " +
        "NEXT: open the HTML in a browser to interact; set previewPng=true for a PNG snapshot alongside. " +
        "ARCHITECTURE LAYOUT (when the diagram is a system architecture, not a flowchart/ER/sequence): prefer a FUNCTIONAL LAYERED layout over a technical-topology or code dump. `direction: down`; each layer a container band with one concern (user access / business capability WHAT / technical support HOW), styled with `style.fill` (light hex, quoted) + `style.stroke-dash: 3` (one property per line — full D2 rules live in generate_diagram's `code` field). Split the capability band into independent boxes that do NOT share a container, and keep cross-cutting concerns (quality gates, observability) in their own band, not stuffed into a capability box. Label layer-to-layer arrows with the value stream (user need -> engine/service -> artifact -> delivery). This is the single-diagram form of generate_nested_diagram's MANIFEST DESIGN — same user-first layered thinking, no drill-down.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "D2 DSL source (same syntax as generate_diagram — see its description for the full D2 syntax guide)." },
          theme: { type: "string", description: "Light theme (D2 themeID or 'default'/'neutral'). Default 'default'." },
          darkTheme: { type: "string", description: "Dark theme (D2 themeID; '200' is a real dark palette). When set, D2 inks BOTH palettes + @media (prefers-color-scheme: dark) into the SVG so dark mode uses the dark palette. Defaults to '200' (auto dark palette). Pass '' to force single-palette (no auto-switch)." },
          title: { type: "string", description: "HTML <title> and visible heading. Default 'Interactive Diagram'." },
          previewPng: { type: "boolean", default: false, description: "Also export a PNG snapshot (puppeteer-core if Chrome available, else resvg fallback). Default false (Chrome launch is slow)." },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["code"],
      },
    },
    {
      name: "generate_nested_diagram",
      description:
        "Generate a NESTED / drill-down architecture diagram as a SELF-CONTAINED HTML (嵌套架构图/可下钻架构图). Pass a manifest tree: each node is one abstraction layer (id + label + a D2 diagram + optional children). Open the .html in a browser — click a layer to drill into its internal architecture, the breadcrumb trail navigates back to any ancestor, and the URL hash deep-links a specific path. Single .html file, all CSS/JS inlined, theme follows system light/dark. Backend: D2 WASM (same DSL as generate_diagram, zero new deps). Read-only navigation of a frozen manifest (NOT an editor). Optional root-layer PNG preview. NOTE: like generate_interactive_diagram, full interactivity needs a browser — GitHub README strips <script>, so an embed is static. " +
        "WHEN TO CHOOSE: a complex system you want to explore layer-by-layer in a browser (top architecture → drill into each subsystem → drill into a sub-subsystem or a sequence diagram); architecture documentation served as a downloadable .html where reviewers click through the abstraction stack. " +
        "AVOID: a single flat diagram (use generate_diagram or generate_interactive_diagram); editable / collaborative architecture tooling (this is read-only navigation). " +
        "NEXT: you (the producer) write the manifest tree AND add drill links inside each parent layer's D2 DSL via `node_key: { link: \"drill:<child-id>\" }` on the nodes that should be clickable. A node with diagram=\"\" (empty string) is a grouping container (renders clickable child cards, has no own diagram). Open the HTML in a browser to explore; set previewPng=true for a root-layer PNG snapshot. " +
        "MANIFEST DESIGN (how to layer — applies unless the user gives an explicit architecture spec): structure the tree as abstraction layers from the user's purpose DOWNWARD, not as a code/module dump. Top layer = what the user does or sees (user value / business capability); each drill reveals the next deeper abstraction (capability -> technical implementation -> module internals). Favor deep modules (small interface, thick implementation hidden below) and one clean concern per layer (no complecting). When the top layer is a whole-system architecture (diagramType architecture), prefer a FUNCTIONAL LAYERED layout: top-level `direction: down`, each layer a container band with one concern (user access / business capability WHAT / technical support HOW), each functional domain inside a band as its OWN box (visibly partitioned, not blended), and cross-cutting concerns (quality gates, observability) in their own band, not folded into a capability box. Use D2 containers with `style.fill` (light hex, quoted) + `style.stroke-dash: 3` for the bands, one property per line (full D2 syntax lives in generate_diagram's `code` field). Label layer-to-layer arrows with the value stream (user need -> engine/service -> artifact -> delivery). C4 System Context (actors around a black box) is also a valid top layer when the audience is stakeholders and the drill chain goes Context -> Container -> Component; the functional-layered layout is just better when the goal is to show partitioned internal domains. For other top-layer topologies (sequence/er/class/flowchart) use that type's native layout. Avoid two proven failure modes at the top: a pure technical dump (MCP entry / dispatcher / engine as the whole story) and a pure user-scenario view (user jobs, not business capability). Write node labels in user-intelligible language and a one-line WHY note (what user problem this layer solves), not technical WHAT. Default to this user-first layered analysis (simple-architecture thinking); only mirror a provided spec verbatim if the user explicitly supplies one.",
      inputSchema: {
        type: "object",
        properties: {
          manifest: {
            type: "object",
            description: "Manifest tree root (producer-declared abstraction tree). Each node: id (REQUIRED, ^[a-z0-9-]+$, tree-unique), label (REQUIRED, UI text), diagram (REQUIRED, D2 DSL source; empty string \"\" = grouping container that MUST have children), diagramType (optional; architecture|sequence|er|class|flowchart; default architecture), children (optional array of nodes; omitted/empty = leaf), notes (optional WHY annotation, producer-only). To make a node clickable, add a drill link in its PARENT's D2: `node_key: { link: \"drill:<that-child-id>\" }`.",
          },
          theme: { type: "string", description: "Light theme (D2 themeID or 'default'/'neutral'), shared across the whole tree. Default 'default'." },
          darkTheme: { type: "string", description: "Dark theme (D2 themeID; '200' is a real dark palette), shared across the whole tree. Defaults to '200' (auto dark palette). Pass '' to force single-palette (no auto-switch)." },
          title: { type: "string", description: "HTML <title> and visible heading. Default = manifest.label." },
          previewPng: { type: "boolean", default: false, description: "Also export a root-layer PNG snapshot. Default false." },
          name: { type: "string", description: "Output filename (without extension)" },
          outDir: { type: "string", description: "Output directory, default session-dir/output" },
        },
        required: ["manifest"],
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
          accent: { type: "string", description: "Accent color (default #0d9488, teal-600)" },
          titleGradient: { type: "string", description: "CSS gradient applied to the title text via background-clip:text, e.g. linear-gradient(90deg,#f59e0b,#ef4444). Note: does not combine with glow (Satori drops the shadow when text is clipped to a gradient — use one or the other)." },
          glow: { type: "string", description: "Title glow (text-shadow). Pass 'true' to auto-derive from accent color, or a full text-shadow CSS value like '0 0 40px rgba(245,158,11,.6)'. Pass 'false' to disable. Does NOT combine with titleGradient (shadow is clipped when text is gradient-filled)." },
          blob: { type: "boolean", default: true, description: "hero template only: blurred accent blob behind the title for depth (default true)" },
          quoteStyle: { type: "string", enum: ["top", "flank"], default: "top", description: "quote template only: 'top' = big quote mark above the text (default); 'flank' = large quote marks flank the text left/right on the same line, wrapping it" },
          logo: { type: "string", description: "Embedded image (brand logo / avatar): a URL, data URI, or local file path (.png/.jpg/.webp/.svg). Placed at the top of the card content." },
          logoSize: { type: "number", description: "Logo pixel size (square edge), default 88" },
          logoRound: { type: "boolean", default: false, description: "Logo circular (for avatars); default false = rounded square" },
          fontFamily: { type: "string", description: "Font family from @fontsource (default Geist, built-in offline, Latin only; CJK auto-stacked via Noto Sans SC)" },
          fontPath: { type: "string", description: "Local base-font file path (.ttf/.otf/.woff) to override the default Geist; optional (CJK auto-supported via built-in Noto Sans SC)" },
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
    {
      name: "extract_image_meta",
      description:
        "Extract embedded generation metadata from a PNG / AI-generated image — reverse-engineer the prompt and params (逆向提示词/参数). Parses PNG tEXt/iTXt/zTXt chunks locally: ComfyUI workflow JSON (Agnes outputs embed the full ComfyUI prompt+model+sampler+seed+size) and A1111 WebUI parameters. Returns structured: generator (ComfyUI/A1111/none), positive/negative prompt, model, sampler, steps, cfg, seed, size, raw chunk list. Zero AI, zero network (unless imageSource is a URL). " +
        "WHEN TO CHOOSE: user shows an AI-generated image and asks 'what prompt was this / 什么参数生成的 / 逆向 prompt / 提取生成参数'. " +
        "AVOID: ordinary photos (no embedded metadata, generator=none); for AI visual understanding (scene/object description) use describe_image. " +
        "NEXT: recover the prompt, then re-run generate_image with it to reproduce. Multilingual triggers: 逆向提示词 · extract prompt · 提取参数 · prompt reverse · 生成参数 (en/zh).",
      inputSchema: {
        type: "object",
        properties: {
          imageSource: { type: "string", description: "Image source: local file path / data URI / http(s) URL. PNG is richest (embeds ComfyUI/A1111 metadata)." },
          includeRaw: { type: "boolean", default: false, description: "Also return the raw workflow JSON object (default false, structured summary only)." },
        },
        required: ["imageSource"],
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
        // flow 专属直通参数(audit finding-2/6):通用 schema 的 aspect/seed 仅 flow 分支消费;
        // agnes/zhipu 不识别 → 按项目纪律告警后忽略(不静默丢弃),且绝不塞进 extra
        // (extra 会被 agnes/zhipu 的 Object.assign(body, extra) 直透上游请求体)。
        const aspect = optString(a.aspect);
        const imageSeed = optNumber(a.seed);
        const flowDirect = p.name === "flow";
        if (!flowDirect) {
          if (aspect) warnings.push(`provider "${p.name}" 不支持 aspect(仅 flow 生图支持 16:9/9:16/1:1/3:4/4:3),已忽略;请用 size 控制尺寸。`);
          if (imageSeed != null) warnings.push(`provider "${p.name}" 不支持 seed,已忽略。`);
        }
        // n 批量:钳制 1-8;provider 忽略 n,工具层并发 fan-out(N 次单图调用 + 聚合)
        const reqN = optNumber(a.n);
        const n = reqN && reqN > 1 ? Math.min(Math.max(1, Math.floor(reqN)), 8) : 1;
        if (reqN && reqN > 8) warnings.push(`n=${reqN} 超上限,已钳制为 8。`);
        // H3:images[] 须为 URI(与 create_video 对称,防本地路径/相对路径 silent 进 body)
        const imgs = toStringArray(a.images);
        // flow 放大例外:images[0] 允许传已有图片的 mediaId(存在性/类型交给 provider findMedia 结构化 S400/S301;
        // 形状 = UUID 或 UUID 派生名,如 §10.7 实证的 <源id>_upsampled —— 启发式定义在 provider 的 isFlowMediaIdLike)
        const flowUpscale = p.name === "flow" && model === "GEM_PIX_2_UPSAMPLE_2K";
        const uriOk = (u: string) => isImageUri(u) || (flowUpscale && imgs?.length === 1 && isFlowMediaIdLike(u));
        if (imgs?.some((u) => !uriOk(u))) {
          return err("`images` 每项须为 http(s): 或 data: URI;本地文件请先读取为 data URI 再传入。(provider=flow + GEM_PIX_2_UPSAMPLE_2K 时 images[0] 也接受已有图片的 mediaId)");
        }
        // images 图生图:provider 不支持时拒绝(免静默丢弃 — zhipu cogview 纯文生图,传 images 会忽略)
        if (imgs?.length && p.supportsImageToImage?.() === false) {
          return err(`provider "${p.name}" 不支持图生图(images 会被忽略)。请改用 agnes,或去掉 images 走纯文生图。`);
        }
        const extra = a.watermark === true ? { watermark_enabled: true } : undefined;
        // C 任务:渠道优先级链式 walk(复用 getFallbackProvider 的排序/熔断/能力谈判管线,不旁路)。
        // 钉死守卫(audit finding-15 语义劫持防护):flow 经「显式点名」到达(provider=flow 或
        // flow 模型 auto-route)→ 失败直抛,绝不静默换成 agnes 产物;
        // flow 经「默认路由」到达(imageProviderPriority 链头,config 显式同意)→ 环境前置失败
        // (S1xx precondition)与 fallback-worthy 错按序推进到下一渠道(agnes → zhipu)。
        const flowPinned = resolved.provider.name === "flow"
          && (optString(a.provider) != null || model != null);
        // 链长上限(priority 链 ≤3 成员 + 防御余量;每跳失败即 notifyUnavailable 打熔断,天然防 ping-pong)
        const MAX_CHAIN_HOPS = 4;
        const makeOne = async (): Promise<{ result: ImageResult; providerName: string }> => {
          let active = p;
          let activeIsFlowDirect = flowDirect;
          let activeModel: string | undefined = model;
          let activeSize = optString(a.size) ?? "1024x1024";
          for (let hop = 0; ; hop++) {
            try {
              const result = await active.generateImage({ prompt, model: activeModel, size: activeSize, images: imgs, extra, ...(activeIsFlowDirect ? { aspect, seed: imageSeed } : {}) });
              return { result, providerName: active.name };
            } catch (e: any) {
              // pares3 语义保留:非 fallback-worthy 的业务错直抛;钉死链(flow 显式点名)直抛。
              // isChainAdvanceable = isFallbackWorthy ∪ 环境前置失败(请求从未提交,非业务错)。
              if (flowPinned || hop >= MAX_CHAIN_HOPS || !isChainAdvanceable(e)) throw e;
              const fbRaw = getFallbackProvider(active.name, "image", { images: imgs });
              if (!fbRaw) throw e;
              const fb = asImageProvider(fbRaw);
              if (imgs?.length && fb.supportsImageToImage?.() === false) throw e; // 双保险
              // size 按目标 provider 自有规则重吸附(走接口方法,非硬编码厂商函数;agnes 无 snapImageSize → 原值)
              activeSize = fb.snapImageSize?.(activeSize) ?? activeSize;
              warnings.push(`provider "${active.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${fb.name}"(免费)。`);
              active.notifyUnavailable?.(e);
              // 离开 flow 时 aspect/seed 不再适用(flow-only 直通参数),按「丢弃必告警」纪律明示
              if (activeIsFlowDirect && (aspect || imageSeed != null)) {
                warnings.push(`fallback 到 "${fb.name}":aspect/seed 仅 flow 支持,已忽略。`);
              }
              active = fb;
              activeIsFlowDirect = false;
              activeModel = undefined; // model 归属失败方(fallback 目标用其默认模型,现行为)
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
        // P0-4 产物守门员:对每张落盘产物做合法性校验(magic-bytes / decodable / dimensions-sane / non-blank)。
        // standard 档 fatal → isError;hard-fail 降级 warning;warning 合并到响应 warnings[]。
        // 注意:不传 format 提示 —— downloadAsset 按 provider 返回的 content-type 动态选扩展名
        // (.png/.jpg/.webp/.gif/.svg),硬编码 format=png 会让合法 JPEG/WebP 被 PNG 签名校验误报 fatal
        // (破坏 §6.1 "原本能成功的调用继续成功")。让 detectKind 按 magic bytes 自动路由到对应分支。
        const imageWarnings: string[] = [];
        for (const fp of localPaths) {
          const checked = await assertOutputClean(fp, { tool: "generate_image" });
          if ("fatal" in checked) return err(checked.fatal.message);
          imageWarnings.push(...checked.warnings);
        }
        warnings.push(...imageWarnings);
        // 同 create_video/get_video:flow 的 data: URI 成品(可达数百 KB)不进响应,防灌爆调用方上下文。
        const outsOut = outputs.map((o, i) => {
          if (!o || typeof o.url !== "string" || !o.url.startsWith("data:")) return o;
          const kb = Math.round(o.url.length / 1024);
          const lp = localPaths[i];
          const rest = { ...(o as Record<string, unknown>) };
          delete rest.url;
          return { ...rest, url_omitted: `data: URI(${kb}KB)已省略;${lp ? "成品已落盘 local_paths" : "传 download=true 可落盘"}`, ...(lp ? { local_path: lp } : {}) };
        });
        return ok({
          outputs: outsOut,
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
        // flow 专属:r2v 参考图数组 + extension/upsampler 视频源 mediaId(其他 provider 忽略并告警)
        const refImages = toStringArray(a.images);
        if (refImages?.some((u) => !isImageUri(u))) return err("`images` 每项须为 http(s): 或 data: URI(参考图)。");
        const videoMediaId = optString(a.videoMediaId);
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
        // flow 直通参数(images=r2v 参考图 / videoMediaId=extension·upsampler 视频源):其他 provider 告警忽略
        const flowVideo = p.name === "flow";
        if (!flowVideo && (refImages?.length || videoMediaId)) {
          warnings.push(`provider "${p.name}" 不支持 images(参考图)/videoMediaId(仅 flow 的 r2v/extension/upsampler 模式),已忽略。`);
        }
        try {
          created = await p.createVideo({
            prompt, model, mode: mode as VideoMode | undefined, image, keyframes,
            ...(flowVideo ? { images: refImages, videoMediaId } : {}),
            resolution: resolution as Resolution | undefined, ratio, numFrames: effFrames, frameRate,
            durationSeconds: optNumber(a.durationSeconds), seed: optNumber(a.seed), negativePrompt: optString(a.negativePrompt),
          });
        } catch (e: any) {
          // pares3: create_video fallback(铁律:仅 submit 可 fallback,poll 路径绝不 fallback)
          // flow 钉死守卫(audit finding-15):显式 provider=flow / flow 模型 auto-route 后,
          // 用户点名的是 Flow 的 Veo/abra,静默 fallback 成 agnes 视频是语义劫持。
          // C 任务:flow 经「默认路由」到达(仅当 videoProviderPriority 显式列入 flow)时,
          // 环境前置失败(S1xx)/fallback-worthy 错允许单跳推进(默认配置下链头永不为 flow,零漂移)。
          const flowPinnedVideo = p.name === "flow"
            && (optString(a.provider) != null || model != null);
          if (flowPinnedVideo || !isChainAdvanceable(e)) throw e;
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
        // flow provider 的成品 url 是 data: URI(整段 base64,视频可达 MB 级);
        // 已落盘或用户关下载时从响应剔除,防多 MB JSON 灌爆调用方上下文。
        const doneOut: Record<string, unknown> = { ...done };
        if (typeof doneOut.url === "string" && (doneOut.url as string).startsWith("data:")) {
          const kb = Math.round((doneOut.url as string).length / 1024);
          doneOut.url_omitted = `data: URI(${kb}KB)已省略;${localPath ? "成品已落盘 local_path" : "传 download=true 可落盘"}`;
          delete doneOut.url;
        }
        // P0-4 产物守门员:MP4 容器探活(fatal=container-decodable,warning=tracks-present)。
        if (localPath) {
          const checked = await assertOutputClean(localPath, { tool: "create_video", format: "mp4" });
          if ("fatal" in checked) return err(checked.fatal.message);
          warnings.push(...checked.warnings);
        }
        const timeoutHint = done.status === "timeout" ? { hint: `等待超时但任务仍在后端生成;稍后用 ${handleHint} 拉取。` } : {};
        return ok({ ...doneOut, provider_used: activeProvider.name, local_path: localPath, ...timeoutHint, ...(warnings.length ? { warnings } : {}) });
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
        // 同 create_video:flow 的 data: URI 成品不进响应(防 MB 级 JSON)
        const rOut: Record<string, unknown> = { ...r };
        if (typeof rOut.url === "string" && (rOut.url as string).startsWith("data:")) {
          const kb = Math.round((rOut.url as string).length / 1024);
          rOut.url_omitted = `data: URI(${kb}KB)已省略;${localPath ? "成品已落盘 local_path" : "传 download=true 可落盘"}`;
          delete rOut.url;
        }
        // P0-4 产物守门员:MP4 容器探活(同 create_video)。
        const videoWarnings: string[] = [];
        if (localPath) {
          const checked = await assertOutputClean(localPath, { tool: "get_video", format: "mp4" });
          if ("fatal" in checked) return err(checked.fatal.message);
          videoWarnings.push(...checked.warnings);
        }
        // 非终态给 retry 提示(免调用方盲目重试,不知何时再问)
        const retryAfter = Math.max(5, Math.round(config.video.pollIntervalMs / 1000));
        const retryHint = (r.status === "queued" || r.status === "in_progress")
          ? { retry_after_seconds: retryAfter, hint: `生成中,约 ${retryAfter}s 后再次调用 get_video 拉取。` }
          : {};
        return ok({ ...rOut, local_path: localPath, ...retryHint, ...(videoWarnings.length ? { warnings: videoWarnings } : {}) });
      }

      case "flow_status": {
        // Google Flow 零消耗自省/状态/下载(契约 doc/flow-api-contract.md §2.2/§2.3/§2.6)。
        // 铁律:本工具绝不触发生成 —— 提交路径只在 create_video/generate_image(provider=flow,消耗积分)。
        const p = getProvider("flow");
        if (!(p instanceof FlowProvider)) {
          return err("flow_status 仅支持 flow provider(registry 注册异常)");
        }
        const mediaId = optString(a.mediaId);
        const deleteMediaIds = toStringArray(a.deleteMediaIds);
        const shareMediaIds = toStringArray(a.shareMediaIds);
        const cancelMediaIds = toStringArray(a.cancelMediaIds);
        const batchParams = [
          ["mediaId(状态查询)", mediaId],
          ["deleteMediaIds(删除)", deleteMediaIds?.length ? deleteMediaIds : null],
          ["shareMediaIds(分享)", shareMediaIds?.length ? shareMediaIds : null],
          ["cancelMediaIds(取消)", cancelMediaIds?.length ? cancelMediaIds : null],
        ].filter(([, v]) => v) as Array<[string, unknown]>;
        if (batchParams.length > 1) {
          return err(`flow_status 参数互斥:${batchParams.map(([n]) => n).join(" + ")} 同时传入,一次只能选一种。`);
        }
        if (deleteMediaIds?.length) {
          // 0 点删除(不可逆;provider 内部先整批校验存在性,有未知 id 整批不删)
          const del = await p.deleteAssets(deleteMediaIds);
          return ok({
            ok: true,
            deleted: del.deleted,
            deleted_count: del.deleted.length,
            requested_count: deleteMediaIds.length,
            media_remaining: del.mediaRemaining,
            hint: `删除不可逆;剩余 ${del.mediaRemaining} 个 media,不带参数调 flow_status 可查看全量。`,
          });
        }
        if (shareMediaIds?.length) {
          // 0 点分享链接(tRPC flow.share.shareMedia;公开可访问含提示词)
          const sh = await p.shareMedia(shareMediaIds);
          return ok({
            ok: true,
            shared: sh.shared,
            shared_count: sh.shared.length,
            hint: sh.hint,
          });
        }
        if (cancelMediaIds?.length) {
          // 0 点取消 in-flight 生成(POST /v1/flowMedia:cancelGeneration;只对生成中的媒体有效)
          const cx = await p.cancelGenerations(cancelMediaIds);
          return ok({
            ok: true,
            canceled: cx.canceled,
            canceled_count: cx.canceled.length,
            not_cancelable: cx.notCancelable,
            status_after: cx.statusAfter,
            hint: cx.canceled.length
              ? "取消已提交;status_after 若仍显示 in_progress 属状态转移延迟(tRPC 读侧有缓存),稍后用 flow_status(mediaId) 复查(期望终态 MEDIA_GENERATION_STATUS_CANCELED)。"
              : "没有可取消的媒体(全部已完成或非生成中;图片生成本就不可取消 —— 契约 §11.3 live 实证 404);详见 not_cancelable。",
          });
        }
        if (!mediaId) {
          return ok(await p.flowStatus());
        }
        const st = await p.mediaStatus(mediaId);
        let localPath: string | null = null;
        let contentType: string | null = null;
        let downloadedBytes = 0;
        const dlWarnings: string[] = [];
        if (st.status === "completed" && a.download !== false) {
          const got = await p.getMediaBytes(mediaId, { thumbnail: a.thumbnail === true });
          // 传输完整性(audit finding-18):仅原始资产可按 mediaBlobSize 比对(防截断/错误 content-type 字节照写)。
          // 缩略图(MEDIA_URL_TYPE_THUMBNAIL)是服务端另行生成的 JPEG,与本资产 mediaBlobSize 本就不同
          // (2026-08-23 live 实证:2,508,689B 视频的缩略图仅 43,007B raw JPEG —— 拿缩略图字节对比原资产
          // 尺寸会让已完成视频 100% 误报 S402,契约 §2.6 勘误)。
          if (!a.thumbnail && st.bytes && got.buf.length !== st.bytes) {
            return err(`[flow] S402 下载不完整:${got.buf.length}B ≠ mediaBlobSize ${st.bytes}B(疑似截断),请重试 flow_status`);
          }
          contentType = got.contentType;
          downloadedBytes = got.buf.length;
          const outDir = resolveOutDir(a.outDir);
          await fs.mkdir(outDir, { recursive: true });
          const ct = got.contentType;
          // 扩展名:content-type 优先;未知 ct 按 media kind 兜底(防视频字节贴 .png —— audit finding-12)
          const ext = ct.includes("webm") ? ".webm"
            : ct.includes("video") || ct.includes("mp4") ? ".mp4"
            : ct.includes("jpeg") || ct.includes("jpg") ? ".jpg"
            : ct.includes("webp") ? ".webp"
            : st.kind === "video" ? ".mp4" : ".png";
          // 自定义名走 downloadAsset 同款清洗(audit finding-14:防 : ? 控制字符原样进文件名)
          const safeName = sanitizeFileBase(optString(a.name)) || `flow_${mediaId.slice(0, 8)}`;
          localPath = path.join(outDir, safeName + ext);
          await fs.writeFile(localPath, got.buf);
          // P0-4 产物守门员(第 4 条落盘路径补齐,audit finding-12):视频传 mp4 容器探活;
          // 图片/缩略图不传 format,让 magic bytes 自动路由到对应检查分支
          const formatHint = ext === ".mp4" ? "mp4" : ext === ".webm" ? "webm" : undefined;
          const checked = await assertOutputClean(localPath, { tool: "flow_status", ...(formatHint ? { format: formatHint } : {}) });
          if ("fatal" in checked) return err(checked.fatal.message);
          dlWarnings.push(...checked.warnings);
        }
        const retryHint = st.status === "in_progress"
          ? { retry_after_seconds: 10, hint: "生成中,约 10s 后再次调用 flow_status(同一 mediaId)拉取。" }
          : {};
        return ok({
          ...st,
          ...(contentType ? { content_type: contentType } : {}),
          ...(downloadedBytes ? { downloaded_bytes: downloadedBytes } : {}),
          ...(localPath ? { local_path: localPath } : {}),
          ...retryHint,
          ...(dlWarnings.length ? { warnings: dlWarnings } : {}),
        });
      }

      case "flow_entity": {
        // Google Flow 角色实体(第 24 工具;全 0 点 —— create/update/voices 均不触生成提交)。
        // 读侧局限(诚实):Flow 无实体读端点 → list 只回本地镜像(契约 §9.6/§11.4)。
        const p = getProvider("flow");
        if (!(p instanceof FlowProvider)) {
          return err("flow_entity 仅支持 flow provider(registry 注册异常)");
        }
        const action = optString(a.action) ?? "create";
        if (action === "list") {
          const entities = p.listEntities();
          return ok({
            ok: true,
            entities,
            count: entities.length,
            hint: entities.length
              ? "本地镜像记录(Flow 无实体读端点,只追踪本工具创建的实体);更新请用 action=update + entityId。"
              : "镜像为空:用 action=create 创建;Flow 无服务端实体读端点,非本工具创建的实体无法枚举(契约 §9.6)。",
          });
        }
        if (action === "voices") {
          const voices = await p.listPresetVoices();
          return ok({ ok: true, voices, count: voices.length, hint: "30 预设语音(projectInitialData externalReferenceMedia 只读);绑定用 presetVoiceId(如 charon)。" });
        }
        if (action === "create") {
          const created = await p.createEntity({
            displayName: optString(a.displayName),
            presetVoiceId: optString(a.presetVoiceId),
            imageMediaIds: toStringArray(a.imageMediaIds),
          });
          return ok({
            ok: true,
            ...created,
            hint: `实体已创建${created.presetVoiceId ? `并绑定语音 ${created.presetVoiceId}` : ""}${created.imageWorkflowIds?.length ? `并绑定形象图 ${created.imageWorkflowIds.length} 张` : ""};本地镜像已更新(~/.media-gen-mcp/flow-entities.json)。全 0 点。`,
          });
        }
        if (action === "update") {
          const entityId = optString(a.entityId);
          if (!entityId) return err("action=update 需要 entityId(action=create 的返回)。");
          const updated = await p.updateEntity(entityId, {
            displayName: optString(a.displayName),
            presetVoiceId: optString(a.presetVoiceId),
            imageMediaIds: toStringArray(a.imageMediaIds),
          });
          return ok({ ok: true, ...updated, hint: "实体已更新(PATCH updateMask 只动变更字段);本地镜像已同步。" });
        }
        return err(`action 非法:"${action}"(合法:create / update / list / voices)`);
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
        // C 任务:透出渠道优先级链(配置时),给 CC 一句话可读的路由真值(providerPriority 头 = 默认路由)
        const imgChain = getProviderPriority("image");
        const vidChain = getProviderPriority("video");
        return ok({
          providers: listProviders(),
          detail: buildListModelsDetail(optString(a.provider)),
          ...(imgChain ? { imageProviderPriority: imgChain, imageRoutingNote: `image 默认路由按链走:${imgChain.join(" → ")}(链头失败/前置不满足时按序回落;显式点名 provider 则钉死)` } : {}),
          ...(vidChain ? { videoProviderPriority: vidChain, videoRoutingNote: `video 默认路由按链走:${vidChain.join(" → ")}(未配置时 = ${config.defaultVideoProvider} + 免费层 fallback;flow 视频消耗积分,须显式列入或点名)` } : {}),
        });
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
        // P0-2:引擎 stderr 归一化(D2 JSON 数组 / Graphviz 修复后的 syntax error 对 LLM 难读)
        let rendered;
        try {
          rendered = await engine.render({
            code,
            engine: engineName as any,
            format,
            theme: optString(a.theme),
            diagramType: optString(a.diagramType) ?? optString(a.type),
            name: optString(a.name),
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // PNG 复用路径抛的 resvg 错带 `[resvg] ` 前缀(P0-2 §4.3.4),用 engineHint 路由到 resvg patterns 表
          const isResvg = /^\[resvg\] /i.test(msg);
          const normalized = normalizeEngineError(
            isResvg ? "resvg" : (engineName === "graphviz" ? "graphviz" : "d2"),
            msg.replace(/^\[resvg\] /i, ""),
            { input: code, raw: msg },
            isResvg ? "resvg" : undefined,
          );
          throw new Error(normalized); // 顶层 catch 转 err(normalized)
        }
        const fp = await writeLocalRender(outDir, "diagram", optString(a.name), format, rendered);
        // P0-4 产物守门员:SVG/PNG 合法性(无 NaN 字面量 / 有绘制节点 / viewbox 非零)。
        const checked = await assertOutputClean(fp, { tool: "generate_diagram", format, originalInput: { engine: engineName } });
        if ("fatal" in checked) return err(checked.fatal.message);
        return ok({ engine: engineName, format, local_path: fp, ...(checked.warnings.length ? { warnings: checked.warnings } : {}) });
      }

      case "generate_interactive_diagram": {
        // P0-5:第 20 工具 —— 自包含交互式 HTML 图(D2 双调色板 + viewer + motion governor)。
        const code = requireString(a.code, "code");
        const outDir = resolveOutDir(a.outDir);
        try {
          const result = await renderInteractiveHtml({
            code,
            theme: optString(a.theme),
            darkTheme: optString(a.darkTheme),
            title: optString(a.title) ?? "Interactive Diagram",
            previewPng: a.previewPng === true,
            name: optString(a.name),
            outDir,
          });
          // HTML 不走 assertOutputClean —— P0-4 守 raster/vector 渲染产物;HTML 是 viewer 容器,
          // 契约 asserts S2/S6/S9/S11 已在 renderInteractiveHtml 内部 assertSelfContained/assertSizeUnder
          // 等做过。handler 拿到的 result 已经过契约断言。
          return ok({
            local_path: result.localPath,
            bytes: result.bytes,
            has_dual_palette: result.hasDarkLightDualPalette,
            ...(result.previewPngPath ? { preview_png_path: result.previewPngPath } : {}),
            hint: "Open the .html in a browser to interact (pan/zoom/theme/animation). Theme follows your system light/dark setting.",
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // F13(主控终验内修):契约 assert(S2/S4/S6/S9/S11)以 "S\d+ " 开头,是 interactive-html
          // 自身契约违反,直接抛 [interactive-html] 前缀,不归一化到 d2 —— 否则用户看到 "[d2] S6 ..."
          // 会误以为 D2 出错,而实测 D2 已成功(契约错发生在 D2 渲染之后的 HTML 断言阶段)。
          if (/^S\d+\s/.test(msg)) {
            throw new Error("[interactive-html] " + msg);
          }
          // 引擎错(D2 / resvg PNG 路径)沿用 generate_diagram 归一化范式。
          // resvg 错经 [resvg] 前缀路由(见 export-png.ts renderSvgToPngBuffer);否则按 d2 归一化。
          const isResvg = /^\[resvg\] /i.test(msg);
          const normalized = normalizeEngineError(
            isResvg ? "resvg" : "d2",
            msg.replace(/^\[resvg\] /i, ""),
            { input: code, raw: msg },
            isResvg ? "resvg" : undefined,
          );
          throw new Error(normalized); // 顶层 catch 转 err(normalized)
        }
      }

      case "generate_nested_diagram": {
        // P0-5B:第 21 工具 —— 嵌套架构图(template-store + viewer-stack drill 导航)。
        // 注:manifest==null 由 buildNestedHtml 内 prefixed 检查兜底(在 try 内 → catch 第一分支直抛);
        // 此处不重复裸检查(nit 审查:避免无前缀裸 Error 与 F13 路由不一致)。
        const manifest = a.manifest;
        const outDir = resolveOutDir(a.outDir);
        try {
          const result = await renderNestedDiagram({
            manifest,
            theme: optString(a.theme),
            darkTheme: optString(a.darkTheme),
            title: optString(a.title),
            previewPng: a.previewPng === true,
            name: optString(a.name),
            outDir,
          });
          return ok({
            local_path: result.localPath,
            bytes: result.bytes,
            layers: result.layerCount,
            has_dual_palette: result.hasDarkLightDualPalette,
            ...(result.previewPngPath ? { preview_png_path: result.previewPngPath } : {}),
            hint: 'Open the .html in a browser. Click a layer to drill in; breadcrumb or Esc to go back; URL hash deep-links a path. Drill links come from `link: "drill:<id>"` in each layer\'s D2.',
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // F13-style 错误路由:[nested-diagram] 前缀(V1-V5 / S_NESTED_* / E_ENGINE / manifest required)直抛不归一化
          if (/^\[nested-diagram\] /.test(msg)) throw new Error(msg);
          // 通用契约 assert S2/S4/S6/S9/S11(interactive-html/asserts 抛,无前缀)归 [nested-diagram]
          if (/^S\d+\s/.test(msg)) throw new Error("[nested-diagram] " + msg);
          // 引擎错(D2 / resvg PNG 路径)沿用 generate_diagram 归一化范式。
          // input 传空串:nit 审查 —— manifest 非 D2 源,传 JSON.stringify(manifest) 会标错输入源
          // (pickD2Offending 取整 manifest 单行 split 后 offendingConstruct 错位)。D2 错本身已含足够信息。
          const isResvg = /^\[resvg\] /i.test(msg);
          const normalized = normalizeEngineError(
            isResvg ? "resvg" : "d2",
            msg.replace(/^\[resvg\] /i, ""),
            { input: "", raw: msg },
            isResvg ? "resvg" : undefined,
          );
          throw new Error(normalized);
        }
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
        // P0-4 产物守门员 + QR decode roundtrip(jsQR 解码回原文 byte 级等比)。
        const checked = await assertOutputClean(fp, { tool: "generate_qrcode", format, originalInput: { text } });
        if ("fatal" in checked) return err(checked.fatal.message);
        const mergedWarnings = [...(rendered.warnings ?? []), ...checked.warnings];
        return ok({ format, local_path: fp, ...(mergedWarnings.length ? { warnings: mergedWarnings } : {}) });
      }

      case "generate_chart": {
        if (!a.spec || typeof a.spec !== "object") {
          return err("spec (Vega-Lite JSON object) is required");
        }
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "png" ? "png" : "svg";
        // P0-2:Vega-Lite compile/render 错归一化 + PNG 复用路径 resvg 错经 [resvg] 前缀路由
        let rendered;
        try {
          rendered = await renderChart({ spec: a.spec, format });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          const isResvg = /^\[resvg\] /i.test(msg);
          const normalized = normalizeEngineError(
            isResvg ? "resvg" : "vega-lite",
            msg.replace(/^\[resvg\] /i, ""),
            { input: a.spec as Record<string, unknown>, raw: msg },
            isResvg ? "resvg" : undefined,
          );
          throw new Error(normalized);
        }
        const fp = await writeLocalRender(outDir, "chart", optString(a.name), format, rendered);
        // P0-4 产物守门员:SVG no-nan-attrs(Vega 除零守门)/ has-content / viewbox-nonzero。
        const checked = await assertOutputClean(fp, { tool: "generate_chart", format });
        if ("fatal" in checked) return err(checked.fatal.message);
        const mergedWarnings = [...(rendered.warnings ?? []), ...checked.warnings];
        return ok({ format, local_path: fp, ...(mergedWarnings.length ? { warnings: mergedWarnings } : {}) });
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
        // P0-4 产物守门员 + formula/has-glyphs(path 或 use > 0,守 MathJax 字体未加载)。
        const checked = await assertOutputClean(fp, { tool: "generate_formula", format, originalInput: { tex } });
        if ("fatal" in checked) return err(checked.fatal.message);
        return ok({ format, local_path: fp, ...(checked.warnings.length ? { warnings: checked.warnings } : {}) });
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
        // P0-4 产物守门员:SVG 合法性(Iconify 输出 / raster fallback magic-bytes)。
        const checked = await assertOutputClean(fp, { tool: "generate_icon", format, originalInput: { icon: iconId } });
        if ("fatal" in checked) return err(checked.fatal.message);
        return ok({ format, local_path: fp, ...(checked.warnings.length ? { warnings: checked.warnings } : {}) });
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
        // P0-4 产物守门员:SVG has-content 守 Satori 空输出 / PNG magic-bytes + dimensions。
        const checked = await assertOutputClean(fp, { tool: "generate_card", format, originalInput: { title } });
        if ("fatal" in checked) return err(checked.fatal.message);
        const mergedWarnings = [...(rendered.warnings ?? []), ...checked.warnings];
        return ok({ format, local_path: fp, ...(mergedWarnings.length ? { warnings: mergedWarnings } : {}) });
      }

      case "render_svg": {
        const svg = requireString(a.svg, "svg");
        const outDir = resolveOutDir(a.outDir);
        const format: "svg" | "png" = a.format === "svg" ? "svg" : "png";
        // P0-2:resvg 栅格化错归一化(Chrome 后端错对 LLM 已清晰,不归一化)
        let rendered;
        try {
          rendered = await renderSvg({
            svg,
            format,
            width: optNumber(a.width),
            backend: optString(a.backend) as any,
            scale: optNumber(a.scale),
          });
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // resvg 错识别:优先看 [resvg] 前缀(render_svg.ts renderWithResvg 已对齐
          // chart/d2/graphviz 三处 PNG 复用路径统一加 [resvg] 前缀,结构性信号 100% 可靠);
          // 兜底用内容 rx(已基于 resvg native 二进制实测重写,见 handlers/error-format.ts resvg patterns)。
          // P0-2 第 2 轮审查修复:原 `[^']{0,5}` 字符类排除单引号,匹配不上 resvg 实际抛的
          //   "default font-family '' not found"(中间含 '')与 "No match for 'PingFang SC' font-family."
          //   (含 '...'),完全漏掉字体加载失败信号。同步 error-format.ts:335 改 `.{0,15}` / `.{0,30}`
          //   允许引号 + 补 "font doesn't have a family name" 分支。
          const isResvgErr = /^\[resvg\] /i.test(msg)
            || /SVG data parsing failed|default font-family.{0,15}not found|No match for.{0,30}font-family|Failed to load a font face|malformed font|font doesn't have a family name/i.test(msg);
          const normalized = isResvgErr
            ? normalizeEngineError("resvg", msg.replace(/^\[resvg\] /i, ""), { input: svg, raw: msg }, "resvg")
            : msg;
          throw new Error(normalized);
        }
        const fp = await writeLocalRender(outDir, "svg", optString(a.name), format, rendered);
        // P0-4 产物守门员:chrome 后端时守 chrome-pixel-variance(防空白页);resvg 后端走标准 png/* 矩阵。
        const checked = await assertOutputClean(fp, { tool: "render_svg", format, originalInput: { backend: rendered.backendUsed } });
        if ("fatal" in checked) return err(checked.fatal.message);
        return ok({ format, backend: rendered.backendUsed, warning: rendered.warning, local_path: fp, ...(checked.warnings.length ? { warnings: checked.warnings } : {}) });
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
        // P0-4 产物守门员:ffmpeg 容器探活(fatal=container-decodable / warning=tracks-present)。
        const checked = await assertOutputClean(fp, { tool: "render_video", format });
        if ("fatal" in checked) return err(checked.fatal.message);
        return ok({
          format,
          mime_type: rendered.mimeType,
          frame_count: rendered.frameCount,
          elapsed_ms: rendered.elapsedMs,
          local_path: fp,
          ...(rendered.warning ? { warning: rendered.warning } : {}),
          ...(checked.warnings.length ? { warnings: checked.warnings } : {}),
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

      case "extract_image_meta": {
        const meta = await extractImageMeta({
          imageSource: requireString(a.imageSource, "imageSource"),
          ...(a.includeRaw !== undefined ? { includeRaw: a.includeRaw === true } : {}),
        });
        return ok({
          generator: meta.generator,
          ...(meta.positivePrompt ? { positivePrompt: meta.positivePrompt } : {}),
          ...(meta.negativePrompt ? { negativePrompt: meta.negativePrompt } : {}),
          ...(meta.model ? { model: meta.model } : {}),
          ...(meta.sampler ? { sampler: meta.sampler } : {}),
          ...(meta.steps !== undefined ? { steps: meta.steps } : {}),
          ...(meta.cfg !== undefined ? { cfg: meta.cfg } : {}),
          ...(meta.scheduler ? { scheduler: meta.scheduler } : {}),
          ...(meta.seed !== undefined ? { seed: meta.seed } : {}),
          ...(meta.size ? { size: meta.size } : {}),
          chunks: meta.chunks,
          ...(meta.rawWorkflow !== undefined ? { rawWorkflow: meta.rawWorkflow } : {}),
          ...(meta.warnings.length ? { warnings: meta.warnings } : {}),
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
