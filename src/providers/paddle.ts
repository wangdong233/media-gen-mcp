/**
 * PaddleocrProvider —— PaddleX serving REST 客户端(pares5 M2)。
 *
 * 定位:vision 模态全能主力(中文 SOTA + 表格 + 图表 + 描述)。tier=10,高于 tesseract(1)兜底。
 *
 * 关键决策(pares5 M2 5-agent 调研):不走 paddleocr-mcp --http(那是 MCP JSON-RPC over StreamableHTTP,
 * 需握手+会话+SSE,issue #16586/#16316 用户都误判协议打 /ocr 拿 404)。
 * 改走 PaddleX 原生 serving REST —— Node fetch 一个 POST 搞定,对称 Agnes/Zhipu。
 *
 * 用户部署:pip install paddlex paddlepaddle && paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
 * 配 providers.paddle.baseUrl = "http://127.0.0.1:8080"。未配时 health().configured=false。
 *
 * 端点:
 * - POST /ocr —— extract-text(PP-OCRv6,中文 SOTA)
 * - POST /layout-parsing —— extract-table/analyze-chart/describe-image(PP-StructureV3 + PaddleOCR-VL;chart 加 useChartRecognition:true)
 *
 * 注:layout-parsing 真实响应的精确结构(markdown 表格/图表数据)需用户实际部署验证;
 * 本文件解析走多路径兜底 + markdown 提取,M2 mock 测 handler 逻辑,真实响应留用户测试 + 后续按实际调整。
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
  TableOut,
  ChartOut,
} from "./types.js";

interface PaddleConfig {
  baseUrl?: string;
  rateLimitTtlMs: number;
}

/**
 * image URI → PaddleX serving 的 file 字段。
 * data:URI → base64 裸串(剥 data:image/png;base64, 前缀,server 自动识别);
 * http(s):// → 原样(server 拉取)。
 */
export function uriToPaddleFile(uri: string): { file: string; fileType: number } {
  const m = uri.match(/^data:[^;]+;base64,(.+)$/);
  if (m) return { file: m[1], fileType: 1 };
  return { file: uri, fileType: 1 };
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
      return json;
    }, { tag: "Paddle" });
  }

  async recognize(req: VisionRequest): Promise<VisionResult> {
    const { file, fileType } = uriToPaddleFile(req.image);
    if (req.task === "extract-text") return this.extractText(file, fileType);
    return this.layoutParsing(file, fileType, req);
  }

  private async extractText(file: string, fileType: number): Promise<VisionResult> {
    const r = await this.request("/ocr", { file, fileType });
    const results = r?.result?.ocrResults ?? r?.ocrResults ?? r?.result ?? [];
    const blocks: TextBlock[] = (Array.isArray(results) ? results : [])
      .map((o: any) => ({
        text: (o.text ?? o.rec_text ?? "").trim(),
        bbox: undefined,
        confidence: typeof (o.score ?? o.confidence) === "number" ? (o.score ?? o.confidence) : undefined,
        level: "line" as const,
      }))
      .filter((b: TextBlock) => b.text);
    const text = blocks.map((b) => b.text).join("\n");
    return { task: "extract-text", text, blocks, raw: r };
  }

  private async layoutParsing(file: string, fileType: number, req: VisionRequest): Promise<VisionResult> {
    const useChart = req.task === "analyze-chart";
    const r = await this.request("/layout-parsing", { file, fileType, useChartRecognition: useChart });
    const pages = r?.result?.layoutParsingResults ?? r?.layoutParsingResults ?? [];
    const md = pages.map((p: any) => p?.markdown?.text ?? p?.markdown ?? "").join("\n\n");

    if (req.task === "extract-table") {
      // PP-StructureV3 表格在 markdown 内联 HTML;提取首个 <table> 块
      const tableMatch = md.match(/<table[\s\S]*?<\/table>/i);
      const content = tableMatch ? tableMatch[0] : md;
      const tableOut: TableOut = { format: "html", content };
      return { task: "extract-table", table: tableOut, raw: r };
    }
    if (req.task === "analyze-chart") {
      // useChartRecognition 输出格式待真实响应精确确认;M2 先返回 markdown 描述 + 占位 chart 结构
      const chartOut: ChartOut = { type: "auto", axes: {}, series: [] };
      return { task: "analyze-chart", chart: chartOut, description: md, raw: r };
    }
    // describe-image(PaddleOCR-VL markdown 描述)
    return { task: "describe-image", description: md, raw: r };
  }
}
