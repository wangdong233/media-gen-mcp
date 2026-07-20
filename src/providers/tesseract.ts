/**
 * TesseractProvider —— 进程内 OCR 兜底(pares5 M1,M1 审查修复版)。
 *
 * 定位:vision 模态的零配置兜底 provider(对称 generate_diagram 内置 D2 WASM)。
 * 仅做 extract-text(数字/验证码/拉丁/中文弱);表格/图表/描述不声明,M2 paddle 接入后退居 fallback。
 *
 * 设计要点(采纳 pares4 审查 finding-1):接口层只暴露语义级 hints(BCP-47/segmentation/digitOnly),
 * 引擎参数(tesseract lang 文件名 / PSM / char_whitelist)下沉到本文件内部翻译,不泄漏到 types.ts。
 *
 * M1 审查修复:
 * - blocks 提取:tesseract.js Page 无 lines 字段,改走 data.blocks[].paragraphs[].lines[],且 recognize 显式 {blocks:true}
 * - BCP47 翻译表:key 全小写(查表 toLowerCase 对齐)+ 补 zh-CN/zh-TW/zh-HK 等region 变体 + fallback 递归查表(en-US→eng)
 * - setParameters 合并语义:whitelist 显式清空(非 digitOnly→""),免跨调用残留
 * - getWorker 并发安全:workerPromise 串行化(防 TOCTOU 竞态导致孤儿 worker)
 *
 * WASM worker 生命周期(0.7.0 教训):单例懒加载 + 跨调用复用 + lang 变更才重建;
 * MCP server 长驻 worker 常驻无害;独立脚本/测试用 terminateTesseractForTest 防 pin。
 */
import { createWorker, PSM } from "tesseract.js";
import type { Worker } from "tesseract.js";
import type {
  MediaProviderBase,
  VisionProvider,
  VisionRequest,
  VisionResult,
  VisionTask,
  VisionConstraints,
  VisionOptionDescriptors,
  ProviderCapabilities,
  ProviderHealth,
  TextBlock,
  ExtractTextHints,
} from "./types.js";

/**
 * BCP-47 → tesseract lang 文件名(全小写 key,与 bcp47ToTesseract 的 toLowerCase 对齐)。
 * 覆盖常见 region 变体(zh-CN/zh-TW/zh-HK/zh-SG/zh-MO),免 split 出 "zh" 崩溃(tesseract 无 zh.traineddata)。
 */
const BCP47_TO_TESS: Record<string, string> = {
  "zh-hans": "chi_sim", "zh-cn": "chi_sim", "zh-sg": "chi_sim",
  "zh-hant": "chi_tra", "zh-tw": "chi_tra", "zh-hk": "chi_tra", "zh-mo": "chi_tra",
  en: "eng", ja: "jpn", ko: "kor",
};

/** BCP-47 → tesseract lang(导出供测试)。先全量查表,未命中取主子标签再查表(en-US→"en"→"eng"),最后才透传。 */
export function bcp47ToTesseract(lang: string): string {
  const key = lang.toLowerCase();
  if (BCP47_TO_TESS[key]) return BCP47_TO_TESS[key];
  const main = key.split("-")[0];
  return BCP47_TO_TESS[main] ?? main;
}

/** 语义级 segmentation → tesseract PSM enum(tesseract.js 导出,类型安全)。 */
const SEG_TO_PSM: Record<string, PSM> = {
  auto: PSM.AUTO,
  "single-line": PSM.SINGLE_LINE,
  "single-char": PSM.SINGLE_CHAR,
  "sparse-text": PSM.SPARSE_TEXT,
};

// 单例 worker(in-progress promise 串行化,防并发 TOCTOU 竞态)。
let workerPromise: Promise<Worker> | null = null;
let workerLang = "";

function getWorker(tessLangs: string[]): Promise<Worker> {
  const langStr = tessLangs.length ? tessLangs.join("+") : "eng";
  if (workerPromise && workerLang === langStr) return workerPromise;
  if (workerPromise) {
    // lang 变:串行 terminate 旧 → createWorker 新(后到的等前一个完成,无竞态)
    workerPromise = workerPromise.then(async (w) => {
      try { await w.terminate(); } catch { /* 忽略 */ }
      return createWorker(langStr);
    });
  } else {
    workerPromise = createWorker(langStr);
  }
  workerLang = langStr;
  return workerPromise;
}

/** 测试/独立脚本用:终止 worker 防 pin 事件循环(server 长驻无需调用)。 */
export async function terminateTesseractForTest(): Promise<void> {
  if (workerPromise) {
    try { const w = await workerPromise; await w.terminate(); } catch { /* 忽略 */ }
    workerPromise = null;
    workerLang = "";
  }
}

export class TesseractProvider implements MediaProviderBase, VisionProvider {
  readonly name = "tesseract";

  listModels(): string[] {
    return [];
  }
  listVisionModels(): string[] {
    return [];
  }
  visionTasks(): readonly VisionTask[] {
    return ["extract-text"];
  }
  visionConstraints(): VisionConstraints {
    // M1 审查:maxImageBytes 删(handler 未消费,YAGNI;M2/M3 真要时再加 + handler 校验)
    return { languages: ["en", "zh-Hans", "zh-Hant", "ja", "ko"] };
  }
  describeVisionOptions(): VisionOptionDescriptors {
    // pares6: 自描述维度。铁律:不返 tasks/languages/maxBytes(R-CI-08,三方法真值分工)
    return {
      role: "零配置兜底(进程内 WASM)",
      latencyTier: "instant",
      accuracyTier: "low",
      perTaskNotes: {
        "extract-text": "拉丁字母/数字强(验证码、车牌);中文弱(配置 paddle 升中文 SOTA)",
      },
      notes: "M2 paddle / M3 vlm 接入后退居 fallback,恒可用(无 baseUrl 依赖)",
    };
  }
  capabilities(): ProviderCapabilities {
    return {
      image: { textToImage: false, imageToImage: false },
      video: { textToVideo: false, imageToVideo: false, keyframes: false },
    };
  }
  health(): ProviderHealth {
    return { configured: true, cooldown: false };
  }
  tier(): number {
    return 1;
  }
  notifyUnavailable(_e: any): void {
    // 进程内 WASM 恒可用,no-op(保留接口对称)
  }

  /**
   * 单次识别(给定 PSM)。抽成 helper 供 recognize 主流程 + 限制性 PSM 空结果回退复用。
   *
   * blocks 提取:tesseract.js Page 无 lines 字段,走 data.blocks[].paragraphs[].lines[]。
   */
  private async recognizeWithPsm(
    image: string,
    tessLangs: string[],
    psm: PSM,
    digitOnly: boolean,
  ): Promise<{ text: string; blocks: TextBlock[]; raw: unknown }> {
    const w = await getWorker(tessLangs);
    // whitelist 显式清空(非 digitOnly→""):setParameters 是合并语义,不清则跨调用残留
    await w.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: digitOnly ? "0123456789" : "",
    });
    // 显式开启 blocks 输出(默认 blocks=false);Page.blocks[].paragraphs[].lines[] 是真实层级
    const { data } = await w.recognize(image, {}, { blocks: true });
    const text = (data?.text ?? "").trim();
    const lines = (data?.blocks ?? [])
      .flatMap((b: any) => (b?.paragraphs ?? []).flatMap((p: any) => p?.lines ?? []));
    const blocks: TextBlock[] = lines
      .map((ln: any) => ({
        text: (ln.text ?? "").trim(),
        bbox: ln.bbox ? [ln.bbox.x0, ln.bbox.y0, ln.bbox.x1, ln.bbox.y1] as [number, number, number, number] : undefined,
        confidence: typeof ln.confidence === "number" ? ln.confidence : undefined,
        level: "line" as const,
      }))
      .filter((b: TextBlock) => b.text);
    return { text, blocks, raw: data };
  }

  async recognize(req: VisionRequest): Promise<VisionResult> {
    if (req.task !== "extract-text") {
      throw new Error(
        `tesseract 仅支持 extract-text(task="${req.task}" 不支持)。表格/图表/描述请配置 paddleocr 或 vlm provider。`,
      );
    }
    const h = (req.hints as ExtractTextHints | undefined) ?? {};
    const bcpLangs = h.languages?.length ? h.languages : ["en"];
    const tessLangs = bcpLangs.map(bcp47ToTesseract);
    const requestedPsm = SEG_TO_PSM[h.segmentation ?? "auto"] ?? PSM.AUTO;

    let { text, blocks, raw } = await this.recognizeWithPsm(
      req.image, tessLangs, requestedPsm, h.digitOnly ?? false,
    );
    const warnings: string[] = [];

    // 🔧 bug 修复(OCR 测试集 s2 发现):限制性 PSM(single-line/single-char/sparse-text)
    // 对多行/复杂版面图会整页返空 —— PSM 7 假设整页单行,多行图版面分析失败直接吐空。
    // 自动回退 PSM.AUTO 重试一次(保留 digitOnly 白名单 → 干净数字);有结果则用并 warning 告知调用方。
    if (requestedPsm !== PSM.AUTO && !text && blocks.length === 0) {
      const fb = await this.recognizeWithPsm(req.image, tessLangs, PSM.AUTO, h.digitOnly ?? false);
      if (fb.text || fb.blocks.length) {
        warnings.push(
          `segmentation="${h.segmentation}" 未识别到文本(图片可能非单行/单字符版式),已自动回退 auto 模式重试。`,
        );
        text = fb.text;
        blocks = fb.blocks;
        raw = fb.raw;
      }
    }

    return {
      task: "extract-text",
      text,
      blocks,
      raw,
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
