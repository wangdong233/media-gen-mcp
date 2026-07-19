/**
 * PaddleocrProvider —— PaddleX serving REST 客户端(pares5 M2,M2 审查修复版)。
 *
 * 定位:vision 模态全能主力(中文 SOTA + 表格 + 图表 + 描述)。tier=10,高于 tesseract(1)兜底。
 *
 * 关键决策(pares5 M2 调研):不走 paddleocr-mcp --http(MCP 协议),改走 PaddleX 原生 serving REST。
 * 用户部署:pip install paddlex paddlepaddle && paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
 *
 * 端点:POST /ocr(extract-text)+ POST /layout-parsing(table/chart/describe;chart 加 useChartRecognition)。
 *
 * M2 审查修复:
 * - extractText 解析:ocrResults[] 每元素是「一图」含并行数组 rec_texts[]/rec_scores[],展开(原假设每元素一行→真实接入空串)
 * - errorCode 检查:PaddleX 应用层错误是 HTTP 200 + body.errorCode!=0(原只判 !res.ok 漏掉)
 * - hints 处理:extract-table 按 hints.format 返回(html 提 <table> / markdown 返 md 段);chartType/question paddle 不支持(PaddleOCR-VL 是文档解析非 VQA),schema 标注 M3 vlm 支持
 * - fileType 删(uriToPaddleFile 只返 file;PaddleX server 自动识别 URL/base64)
 */
import { withRetry } from "./http.js";
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
  ChartOut,
  ExtractTableHints,
} from "./types.js";

interface PaddleConfig {
  baseUrl?: string;
}

/** image URI → PaddleX file 字段(PaddleX 自动识别 URL/base64,无需 fileType)。 */
export function uriToPaddleFile(uri: string): string {
  const m = uri.match(/^data:[^;]+;base64,(.+)$/);
  return m ? m[1] : uri;
}

export class PaddleocrProvider implements MediaProviderBase, VisionProvider {
  readonly name = "paddle";
  private readonly baseUrl: string;
  private cooldownUntil = 0;
  private lastErrorAt: string | undefined;

  constructor(c: PaddleConfig) {
    this.baseUrl = (c.baseUrl ?? "").replace(/\/$/, "");
  }

  listModels(): string[] {
    return [];
  }
  listVisionModels(): string[] {
    return [];
  }
  visionTasks(): readonly VisionTask[] {
    return ["extract-text", "extract-table", "analyze-chart", "describe-image"];
  }
  visionConstraints(): VisionConstraints {
    return { languages: ["en", "zh-Hans", "zh-Hant", "ja", "ko"] };
  }
  capabilities(): ProviderCapabilities {
    return {
      image: { textToImage: false, imageToImage: false },
      video: { textToVideo: false, imageToVideo: false, keyframes: false },
    };
  }
  health(): ProviderHealth {
    return {
      configured: !!this.baseUrl,
      cooldown: this.cooldownUntil > Date.now(),
      ...(this.lastErrorAt ? { lastErrorAt: this.lastErrorAt } : {}),
    };
  }
  tier(): number {
    return 10;
  }
  notifyUnavailable(_e: any): void {
    this.cooldownUntil = Date.now() + 60_000;
    this.lastErrorAt = new Date().toISOString();
  }

  private async request(path: string, body: Record<string, unknown>): Promise<any> {
    if (!this.baseUrl) {
      const e = new Error(
        'paddle baseUrl 未配置。请在 config.json 设 providers.paddle.baseUrl(指向 PaddleX serving,如 http://127.0.0.1:8080)。部署:pip install paddlex paddlepaddle && paddlex --serve --pipeline PP-StructureV3.yaml --port 8080',
      );
      (e as any).status = 503;
      throw e;
    }
    const url = `${this.baseUrl}${path}`;
    return withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!res.ok) {
        const e = new Error(`Paddle ${res.status}: ${text.slice(0, 200)}`);
        (e as any).status = res.status;
        (e as any).body = json;
        throw e;
      }
      // PaddleX 应用层错误:HTTP 200 + body.errorCode != 0(M2 审查修复)
      const ec = json?.errorCode ?? json?.error_code;
      if (typeof ec === "number" && ec !== 0) {
        const e = new Error(`Paddle 应用层错误 errorCode=${ec}: ${json?.errorMsg ?? json?.error_msg ?? ""}`);
        (e as any).status = 502;
        (e as any).body = json;
        throw e;
      }
      return json;
    }, { tag: "Paddle" });
  }

  async recognize(req: VisionRequest): Promise<VisionResult> {
    const file = uriToPaddleFile(req.image);
    if (req.task === "extract-text") return this.extractText(file);
    return this.layoutParsing(file, req);
  }

  private async extractText(file: string): Promise<VisionResult> {
    const r = await this.request("/ocr", { file });
    // PaddleX /ocr:ocrResults[] 每元素是「一图」含并行数组 rec_texts[]/rec_scores[](M2 审查修复:原假设每元素一行→真实接入空串)
    const pages = r?.result?.ocrResults ?? r?.ocrResults ?? (r?.result ? [r.result] : []);
    const blocks: TextBlock[] = [];
    for (const pg of (Array.isArray(pages) ? pages : [])) {
      const texts: string[] = pg?.rec_texts ?? pg?.texts ?? (pg?.text ? [pg.text] : []);
      const scores: any[] = pg?.rec_scores ?? pg?.scores ?? [];
      texts.forEach((t, i) => {
        const txt = String(t ?? "").trim();
        if (!txt) return;
        blocks.push({
          text: txt,
          confidence: typeof scores[i] === "number" ? scores[i] : undefined,
          level: "line",
        });
      });
    }
    const text = blocks.map((b) => b.text).join("\n");
    return { task: "extract-text", text, blocks, raw: r };
  }

  private async layoutParsing(file: string, req: VisionRequest): Promise<VisionResult> {
    const useChart = req.task === "analyze-chart";
    const r = await this.request("/layout-parsing", { file, useChartRecognition: useChart });
    const pages = r?.result?.layoutParsingResults ?? r?.layoutParsingResults ?? [];
    const md = pages.map((p: any) => p?.markdown?.text ?? p?.markdown ?? "").join("\n\n");

    if (req.task === "extract-table") {
      // 按 hints.format(M2 审查修复:原硬编码 html,用户传 markdown/json/latex 拿到 html 内容)
      const format = (req.hints as ExtractTableHints | undefined)?.format ?? "html";
      const tableMatch = md.match(/<table[\s\S]*?<\/table>/i);
      if (format === "html") {
        const content = tableMatch ? tableMatch[0] : md;
        return { task: "extract-table", table: { format: "html", content }, raw: r };
      }
      if (format === "markdown") {
        // 返回 markdown 表格段(| ... |)或整页 md
        return { task: "extract-table", table: { format: "markdown", content: md }, raw: r };
      }
      // json/latex:paddle 不直接支持,warning + fallback html
      const content = tableMatch ? tableMatch[0] : md;
      return {
        task: "extract-table",
        table: { format: "html", content },
        raw: r,
        warnings: [`paddle 不支持 format="${format}",已 fallback 为 html。`],
      };
    }
    if (req.task === "analyze-chart") {
      // useChartRecognition 输出格式待真实响应精确确认;M2 返回 markdown 描述 + 占位 chart 结构
      const chartOut: ChartOut = { type: "auto", axes: {}, series: [] };
      return {
        task: "analyze-chart",
        chart: chartOut,
        description: md,
        raw: r,
        warnings: ["chart 数据为占位结构,真实 PaddleX chart 响应格式待用户部署验证。"],
      };
    }
    // describe-image(PaddleOCR-VL markdown 描述;VQA question 由 M3 vlm provider 支持,paddle 仅默认描述)
    return { task: "describe-image", description: md, raw: r };
  }
}
