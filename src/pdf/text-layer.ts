// src/pdf/text-layer.ts
/**
 * 数字 PDF 文本层快路径(pares6 PDF 管线)。
 *
 * pdfjs page.getTextContent() 返回嵌入文本层(数字 PDF / OCR 后嵌入文本的扫描件)。
 * 对纯扫描件(图像页)返回空 items —— 调用方据此切换到 OCR 路径。
 *
 * 设计要点(参 doc_v10/pares6/pdf-pipeline.md §3 决策 / 风险 R12):
 * - pdfjs 加载 + source 解析 + 类型,统一抽到 src/pdf/pdfjs-loader.ts(审查规范#1:消除与 render.ts 的重复)
 * - 安装提示只提 pdfjs-dist(审查规范#6:text-layer 路径不碰 canvas,原提示错列 @napi-rs/canvas 误导用户)
 * - 文本拼接用 hasEOL 行尾标志(审查数据#4:原直接 += 丢换行,多行文本被压成一行)
 * - 空 text layer 判定:items 全空串 → 视为无文本层(返回 hasLayer=false)
 * - 假阳性(扫描件嵌入 OCR 文本但质量差):由 pipeline.ts 的平均字数阈值告警提示用户切 ocr-only
 *
 * 坐标空间:pdfjs item.transform 为 PDF 内部坐标系(原点左下,y 向上)。
 * 此处仅拼接 text,不做坐标映射;若需 bbox(用于 ignoreAreas / tbpu),仍走 OCR 路径
 * (provider 返回的 bbox 是图像像素坐标,与 ignoreAreas 坐标空间一致)。
 */
import {
  loadPdfjs,
  readPdfBytes,
  buildPdfDocParams,
  PDFJS_INSTALL_HINT,
  type PdfDocument,
} from "./pdfjs-loader.js";

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
  const { mod, cmapsDir, fontsDir } = await loadPdfjs();
  const bytes = await readPdfBytes(source, fetchTimeoutMs ?? 60_000);
  const loadingTask = mod.getDocument(buildPdfDocParams(bytes, cmapsDir, fontsDir));

  let doc: PdfDocument | null = null;
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
        // 拼接:用 hasEOL 行尾标志插换行(审查数据#4 修复);pdfjs 还会塞空白/换行 item,保留原序
        let text = "";
        let itemCount = 0;
        for (const it of tc.items) {
          const s = it.str ?? "";
          if (s) {
            text += s;
            // pdfjs TextItem.hasEOL=true 表示该 item 是行尾 → 换行,还原视觉行序
            if (it.hasEOL) text += "\n";
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

/** 仅用于错误消息复用(本文件只用 pdfjs-dist,不用 canvas)。 */
export { PDFJS_INSTALL_HINT };
