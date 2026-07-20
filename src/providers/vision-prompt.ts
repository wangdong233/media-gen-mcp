// src/providers/vision-prompt.ts
/**
 * vision task → prompt 构造(共用 helper,R-CI-08 DRY-as-decisions)。
 *
 * 从 vlm.ts:35-44 抽出,供 vlm(vLLM)与 glm-vision(智谱 GLM-4.6V)共用 —— 两 provider
 * 走同一 OpenAI 兼容 chat/completions,prompt 构造逻辑同源,避免两处复制。
 *
 * pares7 review 修复:按 task 消费对应 hints(describe→question / extract-text→digitOnly /
 * extract-table→format / analyze-chart→chartType),不再返回静态 prompt,与 tesseract/paddle
 * 行为对齐(否则 fallback 到 glm-vision 时 digitOnly/format 静默丢失)。
 */
import type {
  VisionRequest,
  DescribeImageHints,
  ExtractTextHints,
  ExtractTableHints,
  AnalyzeChartHints,
} from "./types.js";

/**
 * 按 task + hints 构造 user prompt。
 */
export function promptFor(req: VisionRequest): string {
  switch (req.task) {
    case "describe-image": {
      const q = (req.hints as DescribeImageHints | undefined)?.question;
      return q ? q : "Describe this image in detail (scene, objects, any text, layout).";
    }
    case "analyze-chart": {
      const ct = (req.hints as AnalyzeChartHints | undefined)?.chartType;
      const typeHint = ct ? ` (chart type hint: ${ct})` : "";
      return `Extract all data points from this chart${typeHint}. Return ONLY valid JSON: {"type":"bar|line|pie|scatter","axes":{"x":"...","y":"..."},"series":[{"name":"...","points":[{"x":"...","y":0}]}]}.`;
    }
    case "extract-text": {
      // digitOnly:只要数字(对标 tesseract char_whitelist + paddle 行为)
      if ((req.hints as ExtractTextHints | undefined)?.digitOnly) {
        return "Extract only digit characters (0-9) from this image. Output only the digits, no letters, spaces, punctuation, or explanation.";
      }
      return "Extract all text from this image. Output only the extracted text, preserving original layout and line breaks. Do not add any explanation.";
    }
    case "extract-table": {
      const fmt = (req.hints as ExtractTableHints | undefined)?.format ?? "html";
      if (fmt === "markdown") {
        return "Extract the table from this image. Return the table in Markdown format (using | and - delimiters), preserving merged cells and multi-level headers. Do not add explanation.";
      }
      if (fmt === "latex") {
        return "Extract the table from this image. Return the table in LaTeX tabular format. Do not add explanation.";
      }
      if (fmt === "json") {
        return "Extract the table from this image. Return the table as a JSON array of row objects. Do not add explanation.";
      }
      return "Extract the table from this image. Return the table in HTML format (<table>...</table>), preserving merged cells and multi-level headers. Do not add explanation.";
    }
    default:
      return "Analyze this image.";
  }
}
