// src/pdf/pipeline.ts
/**
 * PDF 异步识别管线编排(pares6 PDF 管线核心)。
 *
 * 职责(参 doc_v10/pares6/pdf-pipeline.md §3 / §4 / §5 步骤 6):
 * 1. 加载源 PDF,确定总页数 + 解析 pageRange
 * 2. textStrategy 决策:
 *    - text-layer-only:只走 getTextContent,跳过 OCR
 *    - ocr-only:只走 render→recognize,跳过文本层
 *    - auto(默认):先 text-layer,有则用;否则 OCR
 * 3. OCR 路径:
 *    - page 1 选 provider(含 fallback 钉定);page 2..N 用同家(对齐 get_video 铁律:poll 路径不 fallback)
 *    - per-page:recognize → filterIgnoreAreas → applyTbpu(铁律:剔除先于排版)
 *    - emitProgress 每页一次
 * 4. mergePages 决策:true=拼接全文;false=只返 pages[]
 *
 * 同步/异步决策:
 *    - estPerPage 按 provider(tesseract=4s,paddle=2s,vlm=6s,其他=4s)
 *    - est = pages × estPerPage + render_overhead(pages × 1s)
 *    - est ≤ ASYNC_THRESHOLD_SECONDS=60:同步走完
 *    - est > 60:异步注册 job,fire-and-forget 后台 run,返 handle
 *
 * 接口零侵入:recognize 接口不变(per-page 单图 URI,本管线 render→PNG 后调用)。
 */
import type { ExtractTextHints, MediaProvider, VisionProvider, VisionResult } from "../providers/types.js";
import { isFallbackWorthy } from "../providers/http.js";
import { getFallbackProvider } from "../providers/registry.js";
import { filterIgnoreAreas, parseIgnoreAreas, type IgnoreAreaInput } from "../vision/ignore-area.js";
import { applyTbpu } from "../vision/tbpu.js";
import { iterPdfPages, getPdfPageCount } from "./render.js";
import { extractTextLayer } from "./text-layer.js";
import { parsePageRange } from "./page-range.js";
import {
  registerPdfJob,
  updatePdfJob,
  pushPageResult,
  getPdfJob,
  type PdfJob,
  type PdfPageResult,
} from "./job-store.js";

/** 工具层用的 ASYNC_THRESHOLD_SECONDS(对齐 src/index.ts:47)。 */
export const ASYNC_THRESHOLD_SECONDS = 60;

/** per-provider OCR 单页耗时粗估(秒,偏保守)。 */
const EST_PER_PAGE_SECONDS: Record<string, number> = {
  tesseract: 4,
  paddle: 2,
  vlm: 6,
};
const EST_RENDER_PER_PAGE_SECONDS = 1;

export type TextStrategy = "auto" | "ocr-only" | "text-layer-only";

export interface PdfPipelineInput {
  source: string;
  pageRange?: string;
  textStrategy?: TextStrategy;
  languages?: string[];
  digitOnly?: boolean;
  segmentation?: ExtractTextHints["segmentation"];
  layout?: ExtractTextHints["layout"];
  ignoreAreasRaw?: unknown; // 原始 MCP 参数(parseIgnoreAreas 校验)
  mergePages?: boolean; // 默认 true
  outputFormat?: "text" | "markdown" | "json"; // 默认 text
  scale?: number;
  provider?: string; // 首选 provider
}

export interface PdfPipelineResult {
  /** 实际使用的 provider(可能 = 首选 或 fallback) */
  providerUsed: string;
  /** 解析后的目标页(升序) */
  pages: PdfPageResult[];
  /** 走的路径(text-layer / ocr / mixed) */
  path: "text-layer" | "ocr" | "mixed";
  /** 拼接后的全文(mergePages=true 时) */
  text?: string;
  /** 全局告警 */
  warnings: string[];
  /** pageRange 解析 + 越界告警 */
  rangeWarnings: string[];
  /** 总页数(文档级,不是目标页数) */
  totalPages: number;
}

/** 进度回调:type 签名对齐 index.ts 的 emitProgress。 */
export type ProgressEmitter = (pct: number, message?: string) => void;

/**
 * 估算总耗时(秒)。供同步/异步决策。
 * pages:目标页数;providerName:用于 per-page 估时。
 */
export function estimatePdfSeconds(pages: number, providerName: string): number {
  const perPage = EST_PER_PAGE_SECONDS[providerName] ?? 4;
  return pages * (perPage + EST_RENDER_PER_PAGE_SECONDS);
}

/** 构造 ExtractTextHints(复用 extract_text handler 形状)。 */
function buildHints(input: PdfPipelineInput, ignoreAreas: IgnoreAreaInput[] | undefined): ExtractTextHints {
  return {
    languages: input.languages,
    digitOnly: input.digitOnly,
    segmentation: input.segmentation,
    layout: input.layout,
    // IgnoreAreaInput 接受 {x,y,w,h} 或 [[x1,y1],[x2,y2]];ExtractTextHints 类型签名仅前者,
    // 与 extract_text handler 一致用 as 透传(filterIgnoreAreas 实际接受两形态,类型窄化不影响运行时)。
    ignoreAreas: ignoreAreas as ExtractTextHints["ignoreAreas"],
  };
}

/** 拼接全文:页间用 \n\f\n(form feed 分页符,与 PDF 语义对齐)。 */
function mergePageText(pages: PdfPageResult[]): string {
  return pages.map((p) => p.text ?? "").join("\n\f\n");
}

/**
 * 选定 OCR provider(含 fallback 钉定,只在 page 1 决策)。
 * 返回选定 provider + 是否走了 fallback(供 warning 透传)。
 *
 * 类型:接受 MediaProvider & VisionProvider(用 .name/.notifyUnavailable from MediaProviderBase +
 * .visionTasks/.recognize from VisionProvider)。
 */
function pinOcrProvider(
  preferred: MediaProvider & VisionProvider,
): { provider: MediaProvider & VisionProvider; warnings: string[] } {
  // 不预先 try/fallback:由 page 1 的 recognize 实际错误驱动。这里仅校验 task 支持。
  // 跨页 fallback 钉定 = "page 1 失败才 fallback,选定后 N 页不 fallback"。
  return { provider: preferred, warnings: [] };
}

/**
 * 单页 OCR 路径:render→PNG→recognize→filterIgnoreAreas→applyTbpu。
 * 单页错误不抛:返 failed=true 的 PdfPageResult,任务继续。
 */
async function recognizeOnePage(
  dataUri: string,
  pageNo: number,
  provider: MediaProvider & VisionProvider,
  hints: ExtractTextHints,
  ignoreAreas: IgnoreAreaInput[] | undefined,
  layout: ExtractTextHints["layout"],
  warnings: string[],
  /** 是否允许本页 fallback(provider 失败时换一家,仅 page 1 = true) */
  allowFallback: boolean,
): Promise<{ result: VisionResult; providerUsed: string }> {
  let activeProvider: MediaProvider & VisionProvider = provider;
  let result: VisionResult;
  try {
    result = await activeProvider.recognize({ image: dataUri, task: "extract-text", hints });
  } catch (e: any) {
    if (!isFallbackWorthy(e) || !allowFallback) throw e;
    const fbRaw = getFallbackProvider(activeProvider.name, "vision", { task: "extract-text" });
    if (!fbRaw) throw e;
    const fb = fbRaw as MediaProvider & VisionProvider;
    if (!fb.visionTasks().includes("extract-text")) throw e;
    activeProvider.notifyUnavailable?.(e);
    warnings.push(
      `provider "${activeProvider.name}" 不可用(${(e as Error)?.message?.slice(0, 80)}),已自动 fallback 到 "${fb.name}"(后续页将全部使用 ${fb.name})。`,
    );
    activeProvider = fb;
    result = await activeProvider.recognize({ image: dataUri, task: "extract-text", hints });
  }
  // per-page 后处理:filterIgnoreAreas 先于 applyTbpu(对齐 extract_text handler:src/index.ts:767-781)
  if (result.blocks && result.blocks.length) {
    const filtered = filterIgnoreAreas(result.blocks, ignoreAreas);
    if (filtered.dropped > 0) {
      warnings.push(`第 ${pageNo} 页:ignoreAreas 剔除 ${filtered.dropped} 个文本块。`);
    }
    if (filtered.noBboxKept > 0) {
      warnings.push(`第 ${pageNo} 页:${filtered.noBboxKept} 个块无 bbox,已保留。`);
    }
    const tbpu = applyTbpu(filtered.blocks, layout);
    if (tbpu.warnings?.length) warnings.push(...tbpu.warnings);
    result = { ...result, blocks: tbpu.blocks, text: tbpu.text };
  }
  return { result, providerUsed: activeProvider.name };
}

/**
 * 同步运行 PDF 管线(完整执行,返回结果)。
 * 异步路径由 runPdfAsync 包一层 job-store,本函数是其核心。
 */
export async function runPdfPipeline(
  input: PdfPipelineInput,
  preferredProvider: MediaProvider & VisionProvider,
  emit?: ProgressEmitter,
): Promise<PdfPipelineResult> {
  if (!preferredProvider.visionTasks().includes("extract-text")) {
    throw new Error(
      `provider "${preferredProvider.name}" 不支持 extract-text(支持:${[...preferredProvider.visionTasks()].join("/")})。`,
    );
  }

  // 1. 解析 ignoreAreas(失败即抛 —— 调用方应先 try/catch)
  const ignoreAreas = parseIgnoreAreas(input.ignoreAreasRaw);

  // 2. 确定总页数 + pageRange
  const totalPages = await getPdfPageCount(input.source);
  const range = parsePageRange(input.pageRange, totalPages);
  const targetPages = range.pages.length ? range.pages : Array.from({ length: totalPages }, (_, i) => i + 1);

  const warnings: string[] = [];
  if (range.warnings.length) warnings.push(...range.warnings);

  const textStrategy: TextStrategy = input.textStrategy ?? "auto";
  const layout = input.layout;
  const hints = buildHints(input, ignoreAreas);

  const pageResults: PdfPageResult[] = [];
  let providerUsed = preferredProvider.name;
  let path: PdfPipelineResult["path"] = "ocr";

  // 3. text-layer 快路径(text-layer-only 或 auto 探测)
  const tryTextLayer = textStrategy === "text-layer-only" || textStrategy === "auto";
  let textLayerPages: Map<number, string> | null = null;
  if (tryTextLayer) {
    try {
      const tl = await extractTextLayer(input.source, targetPages);
      if (tl.hasLayer && textStrategy === "text-layer-only") {
        // 强制 text-layer 路径:即使部分页空也用(用户显式指定)
        path = "text-layer";
        for (const p of tl.pages) {
          pageResults.push({
            page: p.page,
            text: p.text,
            warnings: p.itemCount === 0 ? ["该页文本层为空(扫描页?)。"] : undefined,
          });
          emit?.(Math.round((pageResults.length / targetPages.length) * 100), `第 ${p.page}/${targetPages[0]}页(text-layer)`);
        }
        const result: PdfPipelineResult = {
          providerUsed,
          pages: pageResults,
          path,
          warnings,
          rangeWarnings: range.warnings,
          totalPages,
          ...(input.mergePages !== false ? { text: mergePageText(pageResults) } : {}),
        };
        return result;
      }
      if (tl.hasLayer && textStrategy === "auto") {
        // auto 模式:有文本层就用,但要检测假阳性(平均字数 < 10 视为可疑,告警 + 保留页供 OCR fallback)
        const avgChars = tl.pages.reduce((s, p) => s + p.text.length, 0) / Math.max(1, tl.pages.length);
        if (avgChars >= 10) {
          path = "text-layer";
          for (const p of tl.pages) {
            pageResults.push({ page: p.page, text: p.text });
          }
          const progress = Math.round((pageResults.length / targetPages.length) * 100);
          emit?.(progress, `text-layer ${pageResults.length}/${targetPages.length} 页`);
          if (avgChars < 50) {
            warnings.push(`文本层平均每页 ${avgChars.toFixed(0)} 字,质量较低;若识别效果不佳,可改用 textStrategy=ocr-only 强制 OCR。`);
          }
          return {
            providerUsed,
            pages: pageResults,
            path,
            warnings,
            rangeWarnings: range.warnings,
            totalPages,
            ...(input.mergePages !== false ? { text: mergePageText(pageResults) } : {}),
          };
        }
        // 假阳性:保留 text-layer 结果作 fallback,但仍走 OCR
        textLayerPages = new Map(tl.pages.filter((p) => p.text).map((p) => [p.page, p.text]));
        warnings.push(`文本层平均每页 ${avgChars.toFixed(0)} 字(< 10),疑为扫描件假阳性,改走 OCR 路径。`);
      }
    } catch (e: any) {
      // text-layer 失败(text-layer-only 模式抛;auto 模式降级到 OCR)
      if (textStrategy === "text-layer-only") throw e;
      warnings.push(`text-layer 探测失败(${(e as Error)?.message?.slice(0, 80)}),改走 OCR 路径。`);
    }
  }

  if (textStrategy === "ocr-only" || textStrategy === "auto") {
    path = textStrategy === "ocr-only" ? "ocr" : (textLayerPages ? "mixed" : "ocr");
    // 选定 provider(含 page 1 fallback 决策)
    const pinned = pinOcrProvider(preferredProvider);
    let activeProvider: MediaProvider & VisionProvider = pinned.provider;
    providerUsed = activeProvider.name;

    // 4. render → per-page recognize + 后处理
    const pagesGenerator = iterPdfPages({
      source: input.source,
      scale: input.scale,
      pages: targetPages,
    });
    let firstPage = true;
    for await (const rendered of pagesGenerator) {
      try {
        const { result, providerUsed: pUsed } = await recognizeOnePage(
          rendered.dataUri,
          rendered.page,
          activeProvider,
          hints,
          ignoreAreas,
          layout,
          warnings,
          firstPage, // 仅 page 1 允许 fallback
        );
        if (pUsed !== activeProvider.name) {
          // page 1 fallback 命中:钉定后续页用同家
          activeProvider = (await resolveProviderByName(pUsed)) ?? activeProvider;
          providerUsed = activeProvider.name;
        }
        pageResults.push({
          page: rendered.page,
          text: result.text ?? "",
          blocks: result.blocks,
        });
      } catch (e: any) {
        // 单页失败:若 textLayer 备份有 → 用;否则记 failed
        const tlText = textLayerPages?.get(rendered.page);
        pageResults.push({
          page: rendered.page,
          text: tlText ?? "",
          warnings: [`第 ${rendered.page} 页 OCR 失败(${(e as Error)?.message?.slice(0, 100)})${tlText ? ",已回退到文本层。" : "。"}`],
          failed: !tlText,
        });
      }
      firstPage = false;
      const pct = Math.round((pageResults.length / targetPages.length) * 100);
      emit?.(pct, `第 ${pageResults.length}/${targetPages.length} 页(ocr)`);
    }
  }

  return {
    providerUsed,
    pages: pageResults,
    path,
    warnings,
    rangeWarnings: range.warnings,
    totalPages,
    ...(input.mergePages !== false ? { text: mergePageText(pageResults) } : {}),
  };
}

/** 异步包装:注册 job → 后台 run → 完成时写 job。返回 job id。 */
export function runPdfAsync(
  input: PdfPipelineInput,
  preferredProvider: MediaProvider & VisionProvider,
  targetPages: number,
  totalPages: number,
  emit?: ProgressEmitter,
): string {
  const id = registerPdfJob(input.source, {
    pageRange: input.pageRange,
    textStrategy: input.textStrategy ?? "auto",
    languages: input.languages,
    digitOnly: input.digitOnly,
    segmentation: input.segmentation,
    layout: input.layout,
    ignoreAreas: input.ignoreAreasRaw,
    mergePages: input.mergePages,
    outputFormat: input.outputFormat,
    scale: input.scale,
    provider: input.provider,
  }, targetPages);
  updatePdfJob(id, { status: "in_progress", total: totalPages });

  // fire-and-forget
  setImmediate(() => {
    (async () => {
      try {
        const result = await runPdfPipeline(input, preferredProvider, (pct, msg) => {
          updatePdfJob(id, { progress: pct });
          emit?.(pct, msg);
        });
        // 把 pages 逐条 push 进 job(保持进度可见,虽然一次性完成也可)
        for (const p of result.pages) {
          pushPageResult(id, p);
        }
        updatePdfJob(id, {
          status: "completed",
          progress: 100,
          providerUsed: result.providerUsed,
          warnings: result.warnings,
        });
        // 全文缓存到 input 字段不合适;get_pdf 读 job.pages 后由 handler 重新拼接
        // 但我们仍要把 mergePages=true 时的 text 给 handler —— 通过把所有 pages.text 在 get_pdf 时 join
      } catch (e: any) {
        updatePdfJob(id, {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })().catch(() => {
      updatePdfJob(id, { status: "failed", error: "unknown async error" });
    });
  });

  return id;
}

/** resolveProviderByName 异步包装(用于 fallback 钉定时换 provider)。 */
async function resolveProviderByName(name: string): Promise<(MediaProvider & VisionProvider) | null> {
  try {
    const { getProvider, asVisionProvider } = await import("../providers/registry.js");
    const p = getProvider(name);
    // p 是 MediaProvider;asVisionProvider 守卫后返回 MediaProvider & VisionProvider
    return asVisionProvider(p);
  } catch {
    return null;
  }
}

/** get_pdf 读取 job 后做最终装配(handler 复用)。 */
export function buildResultFromJob(job: PdfJob, mergePages: boolean): {
  pages: PdfPageResult[];
  text?: string;
  providerUsed?: string;
  warnings: string[];
} {
  return {
    pages: job.pages,
    ...(mergePages ? { text: mergePageText(job.pages) } : {}),
    providerUsed: job.providerUsed,
    warnings: job.warnings ?? [],
  };
}

/** 重新导出 job-store helper,避免 index.ts 多 import。 */
export { getPdfJob };
