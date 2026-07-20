// src/pdf/render.ts
/**
 * PDF → PNG 渲染层(pares6 PDF 管线)。
 *
 * 栈:pdfjs-dist(Apache-2.0)+ @napi-rs/canvas(MIT 预编译,零系统依赖)。
 * 用 pdfjs-dist/legacy/build/pdf.mjs(Node 22+ 兼容;主 build 依赖 DOMMatrix 在 Node 未定义)。
 *
 * 设计要点(参 doc_v10/pares6/pdf-pipeline.md §3 / §5 步骤 3 / 风险 R1-R3):
 * - 顶层 dynamic import:pdfjs-dist 缺失时抛友好错误(含安装命令),不破坏 16 工具零配置承诺。
 * - workerSrc 显式指向 pdfjs-dist/build/pdf.worker.mjs(file:// URL);Node 在 worker_threads 自动加载。
 * - cMapUrl + standardFontDataUrl 显式指向包内 cmaps/standard_fonts(中文 PDF / 标准 14 字体 PDF 必需)。
 * - NodeCanvasFactory 由 pdfjs-dist 自动选择(getDocument 内部判定 isNodeJS),无需手传。
 * - AsyncGenerator 逐页产出 PNG data URI,render 后立即 canvas.cleanup() 控内存(风险 R5)。
 * - 单页错误隔离:yield 不中断,抛给调用方决定后续策略。
 *
 * URI 接受三种形态(对齐 extract_text 的 isImageUri + 本地文件 data URI 约定):
 *   - http(s):// 远程 PDF
 *   - data:application/pdf;base64,... / data:application/pdf,...
 *   - file:// / 绝对路径 / 相对路径 —— 由 CC 先读为 data URI 后再传;为兼容 user 直接传 .pdf 路径,
 *     本函数也接受,但仅限已存在路径(无路径穿越风险:读取内容而非名)。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

export interface RenderPageResult {
  /** 1-based 页码 */
  page: number;
  /** PNG data URI(可直接作为 provider recognize 的 image 输入) */
  dataUri: string;
  /** 渲染像素宽(scale 应用后) */
  width: number;
  /** 渲染像素高(scale 应用后) */
  height: number;
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
const MAX_SCALE = 3.0;

/** 动态 import 的 pdfjs 模块类型片段(仅本文件用,不外泄给 types.ts)。 */
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDocument>; destroy?: () => Promise<void> };
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  cleanup: () => Promise<void>;
  destroy?: () => Promise<void>;
}
interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
    canvasFactory?: unknown;
  }) => { promise: Promise<void> };
  cleanup: () => Promise<void>;
}

/** 标记 workerSrc 是否已设置(模块级单次,避免每次 getDocument 重设)。 */
let workerConfigured = false;

/**
 * 加载 pdfjs-dist(顶层 dynamic import)。
 * 缺失 → 抛友好错误。npm install 时 pdfjs-dist 进 optionalDependencies,
 * base 安装不会拉它;调用 extract_pdf 时若缺,提示用户安装。
 */
async function loadPdfjs(): Promise<{
  mod: PdfjsModule;
  workerPath: string;
  cmapsDir: string;
  fontsDir: string;
}> {
  let mod: PdfjsModule;
  try {
    // legacy build(Node 兼容;主 build 依赖 DOMMatrix)
    mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  } catch (e: any) {
    throw new Error(
      "PDF 处理依赖 pdfjs-dist 未安装。请运行:\n  npm install pdfjs-dist@^6 @napi-rs/canvas@^1\n(在 media-gen-mcp 项目根目录或全局安装后重启 MCP server)",
    );
  }
  // 定位包内资源(worker / cmaps / standard_fonts)。createRequire 兼容 npm 缓存运行时。
  let pkgRoot: string;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    pkgRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  } catch {
    throw new Error(
      "pdfjs-dist 安装异常(无法解析其 package.json)。请重装:npm install pdfjs-dist@^6 @napi-rs/canvas@^1",
    );
  }
  if (!workerConfigured) {
    // build/pdf.worker.mjs(legacy 不含 worker,主 build 共用)
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(pkgRoot, "build", "pdf.worker.mjs"),
    ).href;
    workerConfigured = true;
  }
  return {
    mod,
    workerPath: path.join(pkgRoot, "build", "pdf.worker.mjs"),
    cmapsDir: path.join(pkgRoot, "cmaps") + path.sep,
    fontsDir: path.join(pkgRoot, "standard_fonts") + path.sep,
  };
}

/** 把 source URI 解析为 Uint8Array。支持 http(s)/data:/file:// + 本地路径。 */
async function readSourceBytes(source: string, timeoutMs: number): Promise<Uint8Array> {
  // http(s)
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) throw new Error(`下载 PDF 失败:HTTP ${res.status} ${source}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  // data:
  const dataMatch = /^data:application\/pdf;([a-zA-Z0-9!#$&'*+.^_`|~-]*),(.*)$/is.exec(source);
  if (dataMatch) {
    const encoded = dataMatch[2] ?? "";
    const buf = /base64/i.test(dataMatch[1] ?? "")
      ? Buffer.from(encoded, "base64")
      : Buffer.from(decodeURIComponent(encoded), "utf-8");
    // pdfjs 6.x 严格拒 Buffer:必须为 Uint8Array(即便 Buffer 是其子类)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // file:// 或本地路径
  const local = source.startsWith("file://") ? source.slice("file://".length) : source;
  const b = await readFile(local);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/**
 * 逐页渲染 PDF 为 PNG data URI。
 *
 * AsyncGenerator 语义:每页 yield 一次,中间页错误 throw(由调用方决定是否继续)。
 * 总是尝试 loadingTask.destroy()(无论成功/失败,释放 worker + 字体缓存)。
 */
export async function* iterPdfPages(
  opts: IterPdfOptions,
): AsyncGenerator<RenderPageResult, void, void> {
  const scale = Math.min(Math.max(opts.scale ?? 2.0, 0.5), MAX_SCALE);
  const { mod, cmapsDir, fontsDir } = await loadPdfjs();
  const bytes = await readSourceBytes(opts.source, opts.fetchTimeoutMs ?? 60_000);

  const loadingTask = mod.getDocument({
    data: bytes,
    // 显式禁用 Node 字体子系统(依赖 freetype,可能未装);用 standard_fonts 数据
    useSystemFonts: false,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    standardFontDataUrl: fontsDir,
    // 不强制 disableWorker;worker 在 Node 22+ 由 worker_threads 加载,默认 on
    isEvalSupported: false,
    // NodeCanvasFactory 由 pdfjs 自动选择(无需手传)
  });

  let doc: PdfDocument | null = null;
  try {
    doc = await loadingTask.promise;
    const total = doc.numPages;
    const targets = opts.pages?.length
      ? opts.pages.filter((p) => p >= 1 && p <= total)
      : Array.from({ length: total }, (_, i) => i + 1);

    for (const pageNo of targets) {
      const page = await doc.getPage(pageNo);
      try {
        const viewport = page.getViewport({ scale });
        // 用 pdfjs 自带的 NodeCanvasFactory(通过 canvasFactory 参数注入,避免依赖 doc.canvasFactory 字段名)
        const CanvasFactoryCtor =
          (mod as any).NodeCanvasFactory ?? (await import("pdfjs-dist/legacy/build/pdf.mjs" as string)).NodeCanvasFactory;
        const factory = new CanvasFactoryCtor();
        const cAndCtx = (factory as any).create(viewport.width, viewport.height);
        await page.render({
          canvasContext: cAndCtx.context,
          viewport,
          canvasFactory: factory,
        }).promise;
        // canvas.toBuffer("image/png") —— @napi-rs/canvas 原生支持 PNG 编码
        const pngBuf: Buffer = cAndCtx.canvas.toBuffer("image/png");
        const dataUri = "data:image/png;base64," + pngBuf.toString("base64");
        yield { page: pageNo, dataUri, width: viewport.width, height: viewport.height };
        // 显式释放(风险 R5)。pdfjs 6.x:page.cleanup 同步返 bool;factory.destroy 异步
        (factory as any).reset?.();
      } finally {
        try { page.cleanup(); } catch { /* pdfjs 6.x 同步,无 reject */ }
      }
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
  const bytes = await readSourceBytes(source, fetchTimeoutMs ?? 60_000);
  const loadingTask = mod.getDocument({
    data: bytes,
    useSystemFonts: false,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    standardFontDataUrl: fontsDir,
    isEvalSupported: false,
  });
  try {
    const doc = await loadingTask.promise;
    const n = doc.numPages;
    await doc.cleanup().catch(() => {});
    return n;
  } finally {
    await loadingTask.destroy?.().catch(() => {});
  }
}
