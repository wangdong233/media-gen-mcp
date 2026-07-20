/**
 * VlmProvider —— vLLM OpenAI 兼容 HTTP 客户端(pares5 M3)。
 *
 * 定位:describe-image(VQA)+ analyze-chart 的增强/fallback。tier=8(paddle=10 主力,tesseract=1 兜底)。
 * 走 vLLM 标准的 OpenAI 兼容 /v1/chat/completions(非 paddleocr-mcp 的 MCP 协议),Node fetch 直连。
 *
 * 用户部署(README 手册):
 *   pip install vllm && vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
 * 配 providers.vlm.baseUrl = "http://127.0.0.1:8000"(+ apiKey,vLLM 自托管可空)。
 *
 * License:Qwen2.5-VL 7B/32B = Apache-2.0(免费可商用);3B/72B 受限不用。对齐纯免费立场。
 * DashScope 云 API 是付费姿势,不进默认(文档说明边界)。
 */
import { withRetry } from "./http.js";
import { promptFor } from "./vision-prompt.js";
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
} from "./types.js";

interface VlmConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** 按 task 构造 prompt(pares7 抽到 vision-prompt.ts 共用,见 promptFor import)。 */

export class VlmProvider implements MediaProviderBase, VisionProvider {
  readonly name = "vlm";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private cooldownUntil = 0;
  private lastErrorAt: string | undefined;

  constructor(c: VlmConfig) {
    this.baseUrl = (c.baseUrl ?? "").replace(/\/$/, "");
    this.apiKey = c.apiKey ?? "";
    this.model = c.model ?? "Qwen2.5-VL-7B-Instruct";
  }

  listModels(): string[] {
    return [];
  }
  listVisionModels(): string[] {
    return [];
  }
  visionTasks(): readonly VisionTask[] {
    return ["describe-image", "analyze-chart"];
  }
  visionConstraints(): VisionConstraints {
    return { languages: ["en", "zh-Hans", "zh-Hant", "ja", "ko"] };
  }
  describeVisionOptions(): VisionOptionDescriptors {
    // pares6: 自描述维度。铁律:不返 tasks/languages/maxBytes(R-CI-08,三方法真值分工)
    return {
      role: "describe/chart 增强 + fallback(完整 VQA)",
      latencyTier: "moderate",
      accuracyTier: "high",
      perTaskNotes: {
        "describe-image": "支持 question 参数的完整 VQA(Qwen2.5-VL)",
        "analyze-chart": "提示工程抽取 JSON;失败返占位 + description",
      },
      notes: "需配置 providers.vlm.baseUrl(指向 vLLM,如 http://127.0.0.1:8000);Qwen2.5-VL Apache-2.0",
    };
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
    return 8;
  }
  notifyUnavailable(_e: any): void {
    this.cooldownUntil = Date.now() + 60_000;
    this.lastErrorAt = new Date().toISOString();
  }

  private async chat(image: string, prompt: string): Promise<string> {
    if (!this.baseUrl) {
      const e = new Error(
        'vlm baseUrl 未配置。请在 config.json 设 providers.vlm.baseUrl(指向 vLLM,如 http://127.0.0.1:8000)。部署:pip install vllm && vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000',
      );
      (e as any).status = 503;
      throw e;
    }
    const url = `${this.baseUrl}/v1/chat/completions`;
    return withRetry(async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!res.ok) {
        const e = new Error(`VLM ${res.status}: ${text.slice(0, 200)}`);
        (e as any).status = res.status;
        (e as any).body = json;
        throw e;
      }
      return json?.choices?.[0]?.message?.content ?? "";
    }, { tag: "VLM" });
  }

  async recognize(req: VisionRequest): Promise<VisionResult> {
    if (!this.visionTasks().includes(req.task)) {
      throw new Error(`vlm 仅支持 describe-image / analyze-chart(task="${req.task}" 不支持)。extract-text/table 请用 tesseract/paddle。`);
    }
    const prompt = promptFor(req);
    const content = await this.chat(req.image, prompt);
    if (req.task === "describe-image") {
      return { task: "describe-image", description: content, raw: content };
    }
    // analyze-chart:content 含 JSON(尝试提取 parse;失败则占位 + 返原文 description)
    const chartMatch = content.match(/\{[\s\S]*\}/);
    let chart: any = { type: "auto", axes: {}, series: [] };
    if (chartMatch) {
      try { chart = JSON.parse(chartMatch[0]); } catch { /* 保留占位 */ }
    }
    return { task: "analyze-chart", chart, description: content, raw: content };
  }
}
