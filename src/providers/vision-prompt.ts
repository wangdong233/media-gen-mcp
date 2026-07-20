// src/providers/vision-prompt.ts
/**
 * vision task → prompt 构造(共用 helper,R-CI-08 DRY-as-decisions)。
 *
 * 从 vlm.ts:35-44 抽出,供 vlm(vLLM)与 glm-vision(智谱 GLM-4.6V)共用 —— 两 provider
 * 走同一 OpenAI 兼容 chat/completions,prompt 构造逻辑同源,避免两处复制。
 */
import type { VisionRequest, DescribeImageHints } from "./types.js";

/**
 * 按 task 构造 user prompt。
 * - describe-image:用户 question=VQA;无则默认描述指令
 * - analyze-chart:严格 JSON 输出指令
 * - extract-text:提取文字保留排版
 * - extract-table:HTML 表格输出
 */
export function promptFor(req: VisionRequest): string {
  if (req.task === "describe-image") {
    const q = (req.hints as DescribeImageHints | undefined)?.question;
    return q ? q : "Describe this image in detail (scene, objects, any text, layout).";
  }
  if (req.task === "analyze-chart") {
    return 'Extract all data points from this chart. Return ONLY valid JSON: {"type":"bar|line|pie|scatter","axes":{"x":"...","y":"..."},"series":[{"name":"...","points":[{"x":"...","y":0}]}]}.';
  }
  if (req.task === "extract-text") {
    return "Extract all text from this image. Output only the extracted text, preserving original layout and line breaks. Do not add any explanation.";
  }
  if (req.task === "extract-table") {
    return "Extract the table from this image. Return the table in HTML format (<table>...</table>), preserving merged cells and multi-level headers. Do not add explanation.";
  }
  return "Analyze this image.";
}
