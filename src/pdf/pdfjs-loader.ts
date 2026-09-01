// src/pdf/pdfjs-loader.ts
/**
 * pdfjs-dist 共享加载层(pares6 PDF 管线)。
 *
 * 抽出原因(5 维审查 finding 规范#1 / 业务#7 / 架构#1):render.ts 与 text-layer.ts
 * 原各自维护一份 ~80 行近重复的 loadPdfjs/PdfjsModule/PdfDocument/readBytes/workerConfigured,
 * 改 worker 路径或 cmaps 策略时两处易漂移。本模块收敛为单一真值源,两消费者 re-import。
 *
 * 职责:
 * - loadPdfjs():dynamic import pdfjs-dist/legacy/build/pdf.mjs + 配 workerSrc + 算 cmaps/fonts 路径
 * - readPdfBytes():source URI → Uint8Array(http(s)/data:/file 三分支)
 * - 统一类型(PdfjsModule/PdfDocument/PdfPage),render 与 text-layer 共用
 *
 * pdfjs-dist 6.x Node 调通要点(无现成文档,实测):
 * - 必须用 legacy/build/pdf.mjs(主 build 引 DOMMatrix,Node 未定义 → ReferenceError)
 * - workerSrc 用 createRequire(import.meta.url).resolve 算 pkgRoot + pathToFileURL → file:// URL
 * - cMapUrl/standardFontDataUrl 必须带尾斜杠(pdfjs getFactoryUrlProp 校验)
 * - data 必须 Uint8Array(pdfjs 6.x 显式拒 Buffer,即便其 instanceof Uint8Array)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

/** 动态 import 的 pdfjs 模块类型(统一,render + text-layer 共用)。 */
export interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: Record<string, unknown>) => {
    promise: Promise<PdfDocument>;
    destroy?: () => Promise<void>;
  };
}

export interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  cleanup: () => Promise<void>;
  destroy?: () => Promise<void>;
}

/**
 * 统一页接口:render 用 getViewport/render,text-layer 用 getTextContent。
 * getTextContent items 带 str + hasEOL(pdfjs TextItem,用于高质量换行拼接)。
 */
export interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: unknown;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  cleanup: () => Promise<void>;
}

/** 标记 workerSrc 是否已设(模块级单次,避免每次 getDocument 重设)。 */
let workerConfigured = false;
/** 缓存 pkgRoot + 路径(一次解析,后续复用)。 */
let cachedPaths: { workerPath: string; cmapsDir: string; fontsDir: string } | null = null;

/** pdfjs-dist 缺失时的统一安装提示(不含 canvas —— text-layer 路径用不到)。 */
export const PDFJS_INSTALL_HINT =
  "PDF 处理依赖 pdfjs-dist 未安装。请运行:\n  npm install pdfjs-dist@^6\n(在 media-gen-mcp 项目根目录或全局安装后重启 MCP server)";

/** pdfjs-dist + canvas 都缺失时的安装提示(OCR 渲染路径需要 canvas)。 */
export const PDFJS_CANVAS_INSTALL_HINT =
  "PDF(OCR 路径)依赖 pdfjs-dist + @napi-rs/canvas 未安装。请运行:\n  npm install pdfjs-dist@^6 @napi-rs/canvas@^1\n(在 media-gen-mcp 项目根目录或全局安装后重启 MCP server)";

/**
 * 加载 pdfjs-dist + 解析资源路径(workerSrc 仅配一次)。
 * 缺失 → 抛友好错误(含安装命令),不破坏零配置承诺。
 */
export async function loadPdfjs(): Promise<{
  mod: PdfjsModule;
  cmapsDir: string;
  fontsDir: string;
}> {
  let mod: PdfjsModule;
  try {
    // legacy build(Node 兼容;主 build 依赖 DOMMatrix)
    mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  } catch {
    throw new Error(PDFJS_INSTALL_HINT);
  }

  if (!cachedPaths) {
    let pkgRoot: string;
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      pkgRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
    } catch {
      throw new Error(
        "pdfjs-dist 安装异常(无法解析其 package.json)。请重装:npm install pdfjs-dist@^6",
      );
    }
    cachedPaths = {
      // build/pdf.worker.mjs(legacy 不含 worker,主 build 共用)
      workerPath: path.join(pkgRoot, "build", "pdf.worker.mjs"),
      // 尾斜杠:pdfjs getFactoryUrlProp 校验,无斜杠抛 "must include trailing slash"
      cmapsDir: path.join(pkgRoot, "cmaps") + path.sep,
      fontsDir: path.join(pkgRoot, "standard_fonts") + path.sep,
    };
  }

  if (!workerConfigured) {
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(cachedPaths.workerPath).href;
    workerConfigured = true;
  }

  return { mod, cmapsDir: cachedPaths.cmapsDir, fontsDir: cachedPaths.fontsDir };
}

/**
 * 把 source URI 解析为 Uint8Array(支持 http(s)/data:/file:// + 本地路径)。
 * render 与 text-layer 共用,消除两份近乎一致的 readSourceBytes/readBytes。
 *
 * pdfjs 6.x 严格拒 Buffer:即便 Buffer instanceof Uint8Array 也拒,必须 Uint8Array 视图包裹。
 */
export async function readPdfBytes(source: string, timeoutMs: number): Promise<Uint8Array> {
  // http(s)
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) throw new Error(`下载 PDF 失败:HTTP ${res.status} ${source}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  // data:application/pdf[;base64],...
  const dataMatch = /^data:application\/pdf;([a-zA-Z0-9!#$&'*+.^_`|~-]*),(.*)$/is.exec(source);
  if (dataMatch) {
    const encoded = dataMatch[2] ?? "";
    const buf = /base64/i.test(dataMatch[1] ?? "")
      ? Buffer.from(encoded, "base64")
      : Buffer.from(decodeURIComponent(encoded), "utf-8");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // file:// 或本地路径(绝对/相对)
  const local = source.startsWith("file://") ? source.slice("file://".length) : source;
  const b = await readFile(local);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/** 构造 pdfjs getDocument 公共参数(cmaps/fonts/字体子系统关闭,render 与 text-layer 一致)。 */
export function buildPdfDocParams(bytes: Uint8Array, cmapsDir: string, fontsDir: string): Record<string, unknown> {
  return {
    data: bytes,
    // 显式禁用 Node 字体子系统(依赖 freetype,可能未装);用 standard_fonts 数据
    useSystemFonts: false,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    standardFontDataUrl: fontsDir,
    isEvalSupported: false,
  };
}
