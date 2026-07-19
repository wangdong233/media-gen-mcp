/**
 * TesseractProvider —— 进程内 OCR 兜底(pares5 M1)。
 *
 * 定位:vision 模态的零配置兜底 provider(对称 generate_diagram 内置 D2 WASM)。
 * 仅做 extract-text(数字/验证码/拉丁/中文弱);表格/图表/描述不声明,M2 paddle 接入后退居 fallback 兜底。
 *
 * 设计要点(采纳 pares4 审查 finding-1):接口层只暴露语义级 hints(BCP-47/segmentation/digitOnly),
 * 引擎参数(tesseract lang 文件名 / PSM 编号 / char_whitelist)下沉到本文件内部翻译,不泄漏到 types.ts。
 *
 * WASM worker 生命周期(0.7.0 教训):单例懒加载 + 跨调用复用 + lang 变更才重建;
 * MCP server 长驻(StdioServerTransport 保活),worker 常驻无害;独立脚本/测试用 terminateForTest 防 pin。
 */
import { createWorker } from "tesseract.js";
import type {
  MediaProviderBase,
  VisionProvider,
  VisionRequest,
  VisionResult,
  VisionTask,
  VisionConstraints,
  ProviderCapabilities,
  ProviderHealth,
  TextBlock,
  ExtractTextHints,
} from "./types.js";

/** BCP-47 → tesseract lang 文件名(常见映射 + 主子标签透传)。 */
const BCP47_TO_TESS: Record<string, string> = {
  "zh-hans": "chi_sim",
  "zh-hant": "chi_tra",
  en: "eng",
  ja: "jpn",
  ko: "kor",
};
function bcp47ToTesseract(lang: string): string {
  const key = lang.toLowerCase();
  return BCP47_TO_TESS[key] ?? key.split("-")[0];
}

/** 语义级 segmentation → tesseract PSM(tessedit_pageseg_mode)。 */
const SEG_TO_PSM: Record<string, string> = {
  auto: "3",
  "single-line": "7",
  "single-char": "10",
  "sparse-text": "11",
};

// 单例 worker(跨调用复用;lang 变更才重建)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let worker: any = null;
let workerLang = "";

async function getWorker(tessLangs: string[]): Promise</* eslint-disable-next-line @typescript-eslint/no-explicit-any */ any> {
  const langStr = tessLangs.length ? tessLangs.join("+") : "eng";
  if (worker && workerLang === langStr) return worker;
  if (worker) {
    try { await worker.terminate(); } catch { /* 忽略 */ }
    worker = null;
  }
  worker = await createWorker(langStr);
  workerLang = langStr;
  return worker;
}

/** 测试/独立脚本用:终止 worker 防 pin 事件循环(server 长驻无需调用)。 */
export async function terminateTesseractForTest(): Promise<void> {
  if (worker) {
    try { await worker.terminate(); } catch { /* 忽略 */ }
    worker = null;
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
    return { languages: ["en", "zh-Hans", "zh-Hant", "ja", "ko"], maxImageBytes: 10 * 1024 * 1024 };
  }
  capabilities(): ProviderCapabilities {
    // 纯识别 provider,无生成能力
    return {
      image: { textToImage: false, imageToImage: false },
      video: { textToVideo: false, imageToVideo: false, keyframes: false },
    };
  }
  health(): ProviderHealth {
    return { configured: true, cooldown: false };
  }
  tier(): number {
    return 1; // fallback 兜底,最低优先
  }
  notifyUnavailable(_e: any): void {
    // 进程内 WASM 恒可用,no-op(保留接口对称)
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
    const psm = SEG_TO_PSM[h.segmentation ?? "auto"] ?? "3";

    const w = await getWorker(tessLangs);
    const params: Record<string, string> = { tessedit_pageseg_mode: psm };
    if (h.digitOnly) params.tessedit_char_whitelist = "0123456789";
    await w.setParameters(params);

    const { data } = await w.recognize(req.image);
    const text = (data?.text ?? "").trim();
    const blocks: TextBlock[] = (data?.lines ?? [])
      .map((ln: any) => ({
        text: (ln.text ?? "").trim(),
        bbox: ln.bbox ? [ln.bbox.x0, ln.bbox.y0, ln.bbox.x1, ln.bbox.y1] as [number, number, number, number] : undefined,
        confidence: typeof ln.confidence === "number" ? ln.confidence : undefined, // 0-100
        level: "line" as const,
      }))
      .filter((b: TextBlock) => b.text);

    return { task: "extract-text", text, blocks, raw: data };
  }
}
