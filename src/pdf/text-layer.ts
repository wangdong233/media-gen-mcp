// src/pdf/text-layer.ts
/**
 * 数字 PDF 文本层快路径(pares6 PDF 管线)。
 *
 * pdfjs page.getTextContent() 返回嵌入文本层(数字 PDF / OCR 后嵌入文本的扫描件)。
 * 对纯扫描件(图像页)返回空 items —— 调用方据此切换到 OCR 路径。
 *
 * 设计要点(参 doc_v10/pares6/pdf-pipeline.md §3 决策 / 风险 R12):
 * - 与 render.ts 共享 pdfjs 加载(cmaps/standard_fonts/workerSrc);但单独导出以避免不必要渲染。
 * - 空 text layer 判定:items 全空串 → 视为无文本层(返回 hasLayer=false)。
 * - 假阳性(扫描件嵌入 OCR 文本但质量差):由 pipeline.ts 的平均字数阈值告警提示用户切 ocr-only。
 *
 * 坐标空间:pdfjs item.transform 为 PDF 内部坐标系(原点左下,y 向上)。
 * 此处仅拼接 text,不做坐标映射;若需 bbox(用于 ignoreAreas / tbpu),仍走 OCR 路径
 * (provider 返回的 bbox 是图像像素坐标,与 ignoreAreas 坐标空间一致)。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

export interface TextLayerPage {
  page: number;
  text: string;
  /** 该页提取的文本 item 数量(诊断用) */
  itemCount: number;
}

export interface TextLayerResult {
  /** 是否任一页有非空文本层 */
  hasLayer: boolean;
  pages: TextLayerPage[];
}

interface PdfjsTextModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfTextDocument>; destroy?: () => Promise<void> };
}
interface PdfTextDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfTextPage>;
  cleanup: () => Promise<void>;
  destroy?: () => Promise<void>;
}
interface PdfTextPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
  cleanup: () => Promise<void>;
}

let workerConfigured = false;

async function loadPdfjsForText(): Promise<{
  mod: PdfjsTextModule;
  cmapsDir: string;
  fontsDir: string;
}> {
  let mod: PdfjsTextModule;
  try {
    mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsTextModule;
  } catch {
    throw new Error(
      "PDF 处理依赖 pdfjs-dist 未安装。请运行:npm install pdfjs-dist@^6 @napi-rs/canvas@^1",
    );
  }
  if (!workerConfigured) {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkgRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(pkgRoot, "build", "pdf.worker.mjs"),
    ).href;
    workerConfigured = true;
    return {
      mod,
      cmapsDir: path.join(pkgRoot, "cmaps") + path.sep,
      fontsDir: path.join(pkgRoot, "standard_fonts") + path.sep,
    };
  }
  // worker 已配但 cmaps/fonts 路径仍要算
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pkgRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    mod,
    cmapsDir: path.join(pkgRoot, "cmaps") + path.sep,
    fontsDir: path.join(pkgRoot, "standard_fonts") + path.sep,
  };
}

async function readBytes(source: string, timeoutMs: number): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) throw new Error(`下载 PDF 失败:HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const m = /^data:application\/pdf;([a-zA-Z0-9!#$&'*+.^_`|~-]*),(.*)$/is.exec(source);
  if (m) {
    const enc = m[2] ?? "";
    const buf = /base64/i.test(m[1] ?? "")
      ? Buffer.from(enc, "base64")
      : Buffer.from(decodeURIComponent(enc), "utf-8");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const local = source.startsWith("file://") ? source.slice("file://".length) : source;
  const b = await readFile(local);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

/**
 * 提取 PDF 文本层。
 * @param source PDF URI
 * @param pages 1-based 页码(未传 = 全部)
 * @returns hasLayer + per-page text;若所有目标页 text 都为空,hasLayer=false
 */
export async function extractTextLayer(
  source: string,
  pages?: number[],
  fetchTimeoutMs?: number,
): Promise<TextLayerResult> {
  const { mod, cmapsDir, fontsDir } = await loadPdfjsForText();
  const bytes = await readBytes(source, fetchTimeoutMs ?? 60_000);
  const loadingTask = mod.getDocument({
    data: bytes,
    useSystemFonts: false,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    standardFontDataUrl: fontsDir,
    isEvalSupported: false,
  });

  let doc: PdfTextDocument | null = null;
  try {
    doc = await loadingTask.promise;
    const total = doc.numPages;
    const targets = pages?.length ? pages.filter((p) => p >= 1 && p <= total) : Array.from({ length: total }, (_, i) => i + 1);

    const outPages: TextLayerPage[] = [];
    let anyNonEmpty = false;
    for (const pageNo of targets) {
      const page = await doc.getPage(pageNo);
      try {
        const tc = await page.getTextContent();
        // 每个 item.str 拼接(空字符串自然无贡献);pdfjs 还会塞入空白/换行 item,保留原序
        let text = "";
        let itemCount = 0;
        for (const it of tc.items) {
          const s = (it as { str?: string }).str ?? "";
          if (s) {
            text += s;
            itemCount++;
          }
        }
        text = text.trim();
        if (text) anyNonEmpty = true;
        outPages.push({ page: pageNo, text, itemCount });
      } finally {
        try { page.cleanup(); } catch { /* pdfjs 6.x 同步 */ }
      }
    }
    return { hasLayer: anyNonEmpty, pages: outPages };
  } finally {
    if (doc) await doc.cleanup().catch(() => {});
    await loadingTask.destroy?.().catch(() => {});
  }
}
