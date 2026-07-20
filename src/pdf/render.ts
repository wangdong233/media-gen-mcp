// src/pdf/render.ts
/**
 * PDF → PNG 渲染层(pares6 PDF 管线)。
 *
 * 栈:pdfjs-dist(Apache-2.0)+ @napi-rs/canvas(MIT 预编译,零系统依赖)。
 *
 * 设计要点(参 doc_v10/pares6/pdf-pipeline.md §3 / §5 步骤 3 / 风险 R1-R5):
 * - pdfjs 加载 + source 解析 + 类型,统一抽到 src/pdf/pdfjs-loader.ts(审查规范#1:消除与 text-layer.ts 的重复)
 * - OCR 渲染用 @napi-rs/canvas 直连(createCanvas + canvasContext),不用 pdfjs 的 NodeCanvasFactory
 *   (pdfjs-dist v6 不再导出 NodeCanvasFactory —— 审查端到端#1 critical:原 `(mod as any).NodeCanvasFactory`
 *   为 undefined,new 必崩 TypeError;所有测试用 text-layer-only 绕开故未触发,OCR 路径 0 覆盖 100% 坏)
 * - AsyncGenerator 逐页产出:单页 render 错误不中断后续页(yield error 哨兵,由调用方记录 failed)
 *   (审查业务#2/数据#4:原 generator 无 catch,page.render 抛错会逃出 → 整任务 failed + 已成功页丢失)
 * - canvas 每页用完即废弃(由 GC 回收;@napi-rs/canvas 无显式 destroy API,作用域结束即释放)
 *
 * URI 接受三种形态(对齐 extract_text 的 isImageUri + 本地文件 data URI 约定):
 *   - http(s):// 远程 PDF
 *   - data:application/pdf;base64,... / data:application/pdf,...
 *   - file:// / 绝对路径 / 相对路径 —— 由 CC 先读为 data URI 后再传;为兼容 user 直接传 .pdf 路径,
 *     本函数也接受,但仅限已存在路径(无路径穿越风险:读取内容而非名)。
 */
import {
  loadPdfjs,
  readPdfBytes,
  buildPdfDocParams,
  PDFJS_CANVAS_INSTALL_HINT,
  type PdfDocument,
  type PdfPage,
} from "./pdfjs-loader.js";

export interface RenderPageResult {
  /** 1-based 页码 */
  page: number;
  /** PNG data URI(可直接作为 provider recognize 的 image 输入);error 时缺省 */
  dataUri?: string;
  /** 渲染像素宽(scale 应用后);error 时缺省 */
  width?: number;
  /** 渲染像素高(scale 应用后);error 时缺省 */
  height?: number;
  /** 单页 render 错误(不中断 generator,由调用方记录 failed 页)。 */
  error?: string;
}

export interface IterPdfOptions {
  /** PDF 来源 URI(http(s)/data:/file 绝对或相对路径)。 */
  source: string;
  /** 渲染倍率(默认 2.0,高 DPI;上限 3.0,风险 R5 内存保护)。 */
  scale?: number;
  /** 仅渲染这些页码(1-based,升序);未传 = 全部页。 */
  pages?: number[];
  /** 抛错前的 fetch 超时(远程 PDF),默认 60s。 */
  fetchTimeoutMs?: number;
}

/** 最大 scale(风险 R5:大 PDF OOM 保护)。 */
export const MAX_SCALE = 3.0;
/** 默认 scale(高 DPI;config.pdf.scale 或 per-call scale 可覆盖)。 */
export const DEFAULT_SCALE = 2.0;

/**
 * 动态加载 @napi-rs/canvas 的 createCanvas。
 * OCR 渲染路径需要;缺失 → 友好错误(对齐 pdfjs 缺失提示)。render.ts 是唯一 canvas 消费方。
 */
async function loadCanvas(): Promise<(w: number, h: number) => { getContext: (t: string) => unknown; toBuffer: (f: string) => Buffer }> {
  try {
    const mod = await import("@napi-rs/canvas");
    return (mod as any).createCanvas;
  } catch {
    throw new Error(PDFJS_CANVAS_INSTALL_HINT);
  }
}

/**
 * 逐页渲染 PDF 为 PNG data URI。
 *
 * AsyncGenerator 语义:每页 yield 一次。单页 render/getPage 错误不抛出 —— yield { page, error },
 * 由调用方记录为 failed 页并继续后续页(审查业务#2:200 页 PDF 0.5% 单页失败率即 ~63% 至少一页失败,
 * 必须容错)。doc 级错误(getDocument 失败)仍抛出(无法恢复)。
 * 总是尝试 loadingTask.destroy()(无论成功/失败,释放 worker + 字体缓存)。
 */
export async function* iterPdfPages(
  opts: IterPdfOptions,
): AsyncGenerator<RenderPageResult, void, void> {
  const scale = Math.min(Math.max(opts.scale ?? DEFAULT_SCALE, 0.5), MAX_SCALE);
  const { mod, cmapsDir, fontsDir } = await loadPdfjs();
  const bytes = await readPdfBytes(opts.source, opts.fetchTimeoutMs ?? 60_000);
  const createCanvas = await loadCanvas();

  const loadingTask = mod.getDocument(buildPdfDocParams(bytes, cmapsDir, fontsDir));

  let doc: PdfDocument | null = null;
  try {
    doc = await loadingTask.promise;
    const total = doc.numPages;
    const targets = opts.pages?.length
      ? opts.pages.filter((p) => p >= 1 && p <= total)
      : Array.from({ length: total }, (_, i) => i + 1);

    for (const pageNo of targets) {
      // 单页全包 try/catch:getPage/getViewport/render 任一抛错 → yield error 哨兵,不中断后续页
      let page: PdfPage | null = null;
      let result: RenderPageResult | null = null;
      try {
        page = await doc.getPage(pageNo);
        const viewport = page.getViewport({ scale });
        // @napi-rs/canvas 直连(审查端到端#1 critical 修复):pdfjs v6 不再导出 NodeCanvasFactory,
        // 用 createCanvas + canvasContext 传入即可正确渲染 PNG。
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext("2d") as unknown as Parameters<PdfPage["render"]>[0]["canvasContext"];
        await page.render({ canvasContext: ctx, viewport }).promise;
        const pngBuf: Buffer = (canvas as { toBuffer: (f: string) => Buffer }).toBuffer("image/png");
        result = {
          page: pageNo,
          dataUri: "data:image/png;base64," + pngBuf.toString("base64"),
          width: viewport.width,
          height: viewport.height,
        };
      } catch (e: any) {
        result = {
          page: pageNo,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        try { page?.cleanup(); } catch { /* pdfjs 6.x 同步,无 reject */ }
      }
      if (result) yield result;
    }
  } finally {
    if (doc) await doc.cleanup().catch(() => {});
    await loadingTask.destroy?.().catch(() => {});
  }
}

/**
 * 同步获取 PDF 总页数(用于 pageRange 解析前置)。
 * 单独导出,避免必须 yield 全部页才能拿到 numPages。
 */
export async function getPdfPageCount(
  source: string,
  fetchTimeoutMs?: number,
): Promise<number> {
  const { mod, cmapsDir, fontsDir } = await loadPdfjs();
  const bytes = await readPdfBytes(source, fetchTimeoutMs ?? 60_000);
  const loadingTask = mod.getDocument(buildPdfDocParams(bytes, cmapsDir, fontsDir));
  try {
    const doc = await loadingTask.promise;
    const n = doc.numPages;
    await doc.cleanup().catch(() => {});
    return n;
  } finally {
    await loadingTask.destroy?.().catch(() => {});
  }
}
