// src/pdf/pipeline.ts
/**
 * PDF 异步识别管线编排(pares6 PDF 管线核心)。
 *
 * 职责(参 doc_v10/pares6/pdf-pipeline.md §3 / §4 / §5 步骤 6):
 * 1. 加载源 PDF,确定总页数 + 解析 pageRange
 * 2. textStrategy 决策:
 *    - text-layer-only:只走 getTextContent,跳过 OCR
 *    - ocr-only:只走 render→recognize,跳过文本层
 *    - auto(默认):先 text-layer;逐页判定 —— 非空文本层页走快路径,空页(扫描插入页)走 OCR
 *      (审查数据#2 修复:原只看平均字数 → 空页静默丢文本,现 per-page 判定 + 路由到 OCR)
 * 3. OCR 路径:
 *    - page 1 选 provider(含 fallback 钉定);page 2..N 用同家(对齐 get_video 铁律:poll 路径不 fallback)
 *    - per-page:recognize → filterIgnoreAreas → applyTbpu(铁律:剔除先于排版)
 *    - render 单页失败 → 记 failed 页,继续后续页(render.ts 错误哨兵)
 *    - emitProgress 每页一次,带 pageResult(异步路径逐页 pushPageResult,审查业务#1 修复)
 * 4. mergePages 决策:true=拼接全文;false=只返 pages[]
 *
 * 同步/异步决策由 index.ts 持有(ASYNC_THRESHOLD_SECONDS 工具层常量);本模块不持有。
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

/**
 * 进度回调:type 签名对齐 index.ts 的 emitProgress + 携带 pageResult。
 * 异步路径(runPdfAsync)用 pageResult 逐页 pushPageResult(审查业务#1 修复:
 * 原仅批量末尾 push,get_pdf 进度 hint 与 progress% 自相矛盾)。
 */
export type ProgressEmitter = (pct: number, message?: string, pageResult?: PdfPageResult) => void;

/**
 * 估算总耗时(秒)。供同步/异步决策。
 * pages:目标页数;providerName:用于 per-page 估时。
 *
 * 注:est 恒按 OCR 单页耗时估,text-layer 命中时实际更快(<1s)。偏保守 ——
 *宁可把可同步完成的数字 PDF 推异步,也不把耗时 OCR 任务阻塞同步。
 *若用户确知是数字 PDF,可显式传 wait=true 或 textStrategy=text-layer-only。
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

/** text-layer 路径忽略的 hints(审查业务#5:digitOnly/segmentation/ignoreAreas 仅 OCR 路径生效,应告知用户)。 */
function textLayerHintsWarning(input: PdfPipelineInput, ignoreAreas: IgnoreAreaInput[] | undefined): string | null {
  const ignored: string[] = [];
  if (input.digitOnly) ignored.push("digitOnly");
  if (input.segmentation) ignored.push("segmentation");
  if (ignoreAreas?.length) ignored.push("ignoreAreas");
  // layout(TBPU)同样只作用于 OCR 路径的 blocks;text-layer 页无 blocks 可重排(审计 B-11 补漏)
  if (input.layout && input.layout !== "none") ignored.push("layout");
  if (!ignored.length) return null;
  return `text-layer 路径不应用 ${ignored.join("/")} hints(这些仅 OCR 路径生效)。如需应用,请改用 textStrategy=ocr-only。`;
}

/**
 * 单页 OCR 路径:render→PNG→recognize→filterIgnoreAreas→applyTbpu。
 * 单页错误不抛:返 failed=true 的 PdfPageResult,任务继续。
 *
 * 返回 provider 实例(非 name 字符串)——调用方直接赋值,消除 name→instance 的来回 roundtrip
 * (审查规范#7/架构#1:原弃实例只回 name,调用方再 resolveProviderByName 二次查表)。
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
): Promise<{ result: VisionResult; provider: MediaProvider & VisionProvider }> {
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
  return { result, provider: activeProvider };
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
  /** auto 混合模式下,需要 OCR 的页(文本层为空的扫描页);null = 全部目标页走 OCR */
  let ocrPages: number[] | null = null;
  /** text-layer 缓存(供 OCR 单页失败时回退到文本层) */
  let textLayerPages: Map<number, string> | null = null;

  // 3. text-layer 快路径(text-layer-only 或 auto 探测)
  const tryTextLayer = textStrategy === "text-layer-only" || textStrategy === "auto";
  if (tryTextLayer) {
    try {
      const tl = await extractTextLayer(input.source, targetPages);
      if (tl.hasLayer && textStrategy === "text-layer-only") {
        // 强制 text-layer 路径:即使部分页空也用(用户显式指定)
        path = "text-layer";
        for (const p of tl.pages) {
          const pr: PdfPageResult = {
            page: p.page,
            text: p.text,
            warnings: p.itemCount === 0 ? ["该页文本层为空(扫描页?)。"] : undefined,
          };
          pageResults.push(pr);
          emit?.(Math.round((pageResults.length / targetPages.length) * 100), `第 ${pageResults.length}/${targetPages.length} 页(text-layer)`, pr);
        }
        const hWarn = textLayerHintsWarning(input, ignoreAreas);
        if (hWarn) warnings.push(hWarn);
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
      if (tl.hasLayer && textStrategy === "auto") {
        // auto 模式逐页判定(审查数据#2 修复:原只看平均字数,空页静默丢文本)
        const textLayerByPage = new Map<number, string>();
        const emptyPages: number[] = [];
        for (const p of tl.pages) {
          if (p.text) textLayerByPage.set(p.page, p.text);
          else emptyPages.push(p.page);
        }

        if (emptyPages.length === 0) {
          // 全部目标页有非空文本层 → 纯 text-layer 快路径
          path = "text-layer";
          for (const p of tl.pages) {
            const pr: PdfPageResult = { page: p.page, text: p.text };
            pageResults.push(pr);
            emit?.(Math.round((pageResults.length / targetPages.length) * 100), `第 ${pageResults.length}/${targetPages.length} 页(text-layer)`, pr);
          }
          const avgChars = tl.pages.reduce((s, p) => s + p.text.length, 0) / Math.max(1, tl.pages.length);
          if (avgChars < 50) {
            warnings.push(`文本层平均每页 ${avgChars.toFixed(0)} 字,质量较低;若识别效果不佳,可改用 textStrategy=ocr-only 强制 OCR。`);
          }
          const hWarn = textLayerHintsWarning(input, ignoreAreas);
          if (hWarn) warnings.push(hWarn);
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

        // 混合:有文本层的页走 text-layer,空页走 OCR
        path = "mixed";
        textLayerPages = textLayerByPage;
        ocrPages = emptyPages;
        for (const page of textLayerByPage.keys()) {
          const pr: PdfPageResult = { page, text: textLayerByPage.get(page)! };
          pageResults.push(pr);
          emit?.(Math.round((pageResults.length / targetPages.length) * 100), `第 ${pageResults.length}/${targetPages.length} 页(text-layer)`, pr);
        }
        warnings.push(`${textLayerByPage.size} 页有文本层(走 text-layer 快路径),${emptyPages.length} 页文本层为空(扫描页?改走 OCR)。`);
        const hWarn = textLayerHintsWarning(input, ignoreAreas);
        if (hWarn) warnings.push(hWarn);
      }
    } catch (e: any) {
      // text-layer 失败(text-layer-only 模式抛;auto 模式降级到 OCR)
      if (textStrategy === "text-layer-only") throw e;
      warnings.push(`text-layer 探测失败(${(e as Error)?.message?.slice(0, 80)}),改走 OCR 路径。`);
    }
  }

  if (textStrategy === "ocr-only" || textStrategy === "auto") {
    if (path !== "mixed") {
      path = textStrategy === "ocr-only" ? "ocr" : "ocr"; // auto-no-layer → ocr
    }
    // 选定 provider(审查规范#2/业务#6/端到端#6:pinOcrProvider 是纯死代码,已删;直接用 preferred)
    let activeProvider: MediaProvider & VisionProvider = preferredProvider;
    providerUsed = activeProvider.name;
    const pagesToOcr = ocrPages ?? targetPages;

    // 4. render → per-page recognize + 后处理(render 单页失败由 generator yield error 哨兵)
    const pagesGenerator = iterPdfPages({
      source: input.source,
      scale: input.scale,
      pages: pagesToOcr,
    });
    let firstPage = true;
    for await (const rendered of pagesGenerator) {
      // render 错误哨兵:记 failed 页,继续后续页(审查业务#2:原 render 错逃出 generator → 整任务 failed)
      if (rendered.error) {
        const pr: PdfPageResult = {
          page: rendered.page,
          text: textLayerPages?.get(rendered.page) ?? "",
          warnings: [`第 ${rendered.page} 页渲染失败(${rendered.error.slice(0, 100)})。`],
          failed: !textLayerPages?.has(rendered.page),
        };
        pageResults.push(pr);
        const pct = Math.round((pageResults.length / targetPages.length) * 100);
        emit?.(pct, `第 ${pageResults.length}/${targetPages.length} 页(渲染失败)`, pr);
        firstPage = false;
        continue;
      }
      try {
        const { result, provider: pUsed } = await recognizeOnePage(
          rendered.dataUri!,
          rendered.page,
          activeProvider,
          hints,
          ignoreAreas,
          layout,
          warnings,
          firstPage, // 仅首个 OCR 页允许 fallback
        );
        if (pUsed !== activeProvider) {
          // 首页 fallback 命中:钉定后续页用同家(直接用实例,无需 name→provider 查表)
          activeProvider = pUsed;
          providerUsed = activeProvider.name;
        }
        const pr: PdfPageResult = {
          page: rendered.page,
          text: result.text ?? "",
          blocks: result.blocks,
        };
        pageResults.push(pr);
      } catch (e: any) {
        // recognize 单页失败:若 textLayer 备份有 → 用;否则记 failed
        const tlText = textLayerPages?.get(rendered.page);
        const pr: PdfPageResult = {
          page: rendered.page,
          text: tlText ?? "",
          warnings: [`第 ${rendered.page} 页 OCR 失败(${(e as Error)?.message?.slice(0, 100)})${tlText ? ",已回退到文本层。" : "。"}`],
          failed: !tlText,
        };
        pageResults.push(pr);
      }
      firstPage = false;
      const pct = Math.round((pageResults.length / targetPages.length) * 100);
      emit?.(pct, `第 ${pageResults.length}/${targetPages.length} 页(ocr)`, pageResults[pageResults.length - 1]);
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
  // 审查数据#1/端到端#3 修复:不覆写 total(registerPdfJob 已正确设为目标页数;原 total:totalPages 把分母变成文档总页数)
  updatePdfJob(id, { status: "in_progress" });

  // fire-and-forget
  setImmediate(() => {
    (async () => {
      try {
        const result = await runPdfPipeline(input, preferredProvider, (pct, msg, pageResult) => {
          // 审查业务#1 修复:逐页 pushPageResult(done/pages 实时可见,get_pdf hint 不再撒谎)
          if (pageResult) pushPageResult(id, pageResult);
          else updatePdfJob(id, { progress: pct });
          emit?.(pct, msg);
        });
        updatePdfJob(id, {
          status: "completed",
          progress: 100,
          providerUsed: result.providerUsed,
          warnings: result.warnings,
          // 审查数据#6/业务#4/端到端#5 修复:异步 get_pdf 补 path/totalPages/rangeWarnings(与同步 extract_pdf 对齐)
          path: result.path,
          totalPagesDoc: result.totalPages,
          rangeWarnings: result.rangeWarnings,
        });
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

/** get_pdf 读取 job 后做最终装配(handler 复用)。 */
export function buildResultFromJob(job: PdfJob, mergePages: boolean): {
  pages: PdfPageResult[];
  text?: string;
  providerUsed?: string;
  path?: string;
  totalPagesDoc?: number;
  rangeWarnings?: string[];
  warnings: string[];
} {
  return {
    pages: job.pages,
    ...(mergePages ? { text: mergePageText(job.pages) } : {}),
    providerUsed: job.providerUsed,
    path: job.path,
    totalPagesDoc: job.totalPagesDoc,
    rangeWarnings: job.rangeWarnings,
    warnings: job.warnings ?? [],
  };
}

/** 重新导出 job-store helper,避免 index.ts 多 import。 */
export { getPdfJob };
