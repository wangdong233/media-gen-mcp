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
 *
 * pares7: Unlimited-OCR(baidu/Unlimited-OCR)长文档解析支持。
 *   - extra_body 顶层透传(images_config/custom_logit_processor/custom_params/skip_special_tokens),
 *     沿用 agnes.ts:300 既成先例 `if (req.extra) Object.assign(body, req.extra)`,但加 stream 守卫
 *     (用户照抄 infer.py 的 stream:true 会撞现有非 SSE 解析)。
 *   - model-aware 短 prompt 覆盖封在 promptForUnlimited()(不进 vision-prompt.ts 共用源,铁律 5)。
 *   - 优先级:req.extra(per-call,任意 task 生效) → this.extraBody(config 默认,**仅 extract-text/extract-table 生效**) → 无(零回归)。
 *   - task 门控(review fix high):this.extraBody 默认仅在 OCR task 摊入,与 promptForUnlimited 的 prompt 门控对称 ——
 *     describe-image(VQA)/analyze-chart(JSON 抽取)不带 extra_body,防 NoRepeatNGram 压制 VQA 描述、
 *     skip_special_tokens=false 泄漏 OCR 结构 token、image_mode=gundam 切片破坏场景级理解。
 *   - 配 Unlimited-OCR 时 visionTasks() 通放 4 task(全能 OCR 模型)。
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
  ExtractTableHints,
} from "./types.js";

interface VlmConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** pares7: config 默认 extra_body(Unlimited-OCR images_config/custom_logit_processor 等顶层扩展)。req.extra 可覆盖。 */
  extra_body?: Record<string, unknown>;
}

/** 按 task 构造 prompt(pares7 抽到 vision-prompt.ts 共用,见 promptFor import)。 */

export class VlmProvider implements MediaProviderBase, VisionProvider {
  readonly name = "vlm";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  /** pares7: extra_body 默认(registry 从 config.json providers.vlm.extra_body 注入);req.extra 可覆盖(优先级高)。 */
  private readonly extraBody?: Record<string, unknown>;
  private cooldownUntil = 0;
  private lastErrorAt: string | undefined;

  constructor(c: VlmConfig) {
    this.baseUrl = (c.baseUrl ?? "").replace(/\/$/, "");
    this.apiKey = c.apiKey ?? "";
    this.model = c.model ?? "Qwen2.5-VL-7B-Instruct";
    // pares7: extra_body 经 registry.ts 注入(对齐 agnes/zhipu/glm-vision 的「provider 配置统一由 registry 注入」约定)。
    // review fix high(架构 R-DEP-03):移除 `?? config.providers.vlm?.extraBody` fallback,
    // 配置入口归一为 registry 注入通道(provider 内部不直读全局 config),测试可直接断言构造器收到 extra_body。
    this.extraBody = c.extra_body;
  }

  listModels(): string[] {
    return [];
  }
  listVisionModels(): string[] {
    return [];
  }
  visionTasks(): readonly VisionTask[] {
    // pares7: Unlimited-OCR 是全能 OCR 模型(单图/多页文档解析 + VQA),配此 model 时全 4 task 通放;
    // 否则保留 M3 原行为(只 describe-image/analyze-chart,Qwen2.5-VL 也强于这两项)。
    if (this.isUnlimitedOcr(this.model)) {
      return ["extract-text", "extract-table", "describe-image", "analyze-chart"];
    }
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
      notes: "需配置 providers.vlm.baseUrl(指向 vLLM,如 http://127.0.0.1:8000);Qwen2.5-VL Apache-2.0。pares7:配 Unlimited-OCR 模型时全 4 task 通放,extra_body 默认仅对 extract-text/extract-table 摊入(describe-image/analyze-chart 不带,防 OCR 配方污染 VQA/JSON)。",
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

  /** 检测 model 名是否含 unlimited-ocr(大小写不敏感)。req.model 优先于 this.model。 */
  private isUnlimitedOcr(model?: string): boolean {
    return (model ?? "").toLowerCase().includes("unlimited-ocr");
  }

  /**
   * pares7: Unlimited-OCR model-aware prompt 覆盖。
   * 命中 unlimited-ocr 且 task∈{extract-text,extract-table} → 'document parsing.'(README 单图契约,2 词短 prompt 贴训练分布);
   * 其余(describe-image VQA / analyze-chart JSON 抽取 / 非 Unlimited-OCR 模型)→ 走原 promptFor(req)。
   * model-aware 逻辑封在 vlm.ts 内,不污染 vision-prompt.ts 的 vlm/glm-vision 共用源(铁律 5)。
   */
  private promptForUnlimited(req: VisionRequest): string {
    const model = req.model ?? this.model;
    if (
      this.isUnlimitedOcr(model) &&
      (req.task === "extract-text" || req.task === "extract-table")
    ) {
      // media-gen-mcp VisionRequest 是单图契约,故固定走单图 prompt(不产 'Multi page parsing.')
      return "document parsing.";
    }
    return promptFor(req);
  }

  /**
   * 单次 chat。
   * pares7: extra 可选透传顶层扩展字段(Unlimited-OCR 的 images_config/custom_logit_processor/...),
   * 沿用 agnes.ts:300 既成先例 Object.assign;extra 缺省时 body 形状完全不变(铁律 4 零回归)。
   */
  private async chat(
    image: string,
    prompt: string,
    extra?: Record<string, unknown>,
  ): Promise<string> {
    if (!this.baseUrl) {
      const e = new Error(
        'vlm baseUrl 未配置。请在 config.json 设 providers.vlm.baseUrl(指向 vLLM,如 http://127.0.0.1:8000)。部署:pip install vllm && vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000',
      );
      (e as any).status = 503;
      throw e;
    }
    // pares7 stream 守卫:vlm.ts 非 SSE 解析,用户照抄 infer.py 的 stream:true 会撞 JSON.parse 拿到 'data: {...}' 碎片
    // → 抛 fallback-worthying 5xx → 错位降级到 tesseract/paddle 静默掉点。这里前置 reject + 清晰错误。
    if (extra?.stream === true) {
      const e = new Error(
        'vlm 不解析 SSE 流,请移除 extra.stream(vLLM/SGLang 非 stream 模式同样工作,只是长文档需调高 server 超时,如 vLLM --timeout-keepalive 或 SGLang REQUEST_TIMEOUT)',
      );
      (e as any).status = 400;
      throw e;
    }
    const url = `${this.baseUrl}/v1/chat/completions`;
    return withRetry(async () => {
      // body 先构造基础形状,再 Object.assign 摊平 extra(对齐 agnes.ts:300 既成先例)
      // Unlimited-OCR 的扩展字段全是顶层(images_config/custom_logit_processor/custom_params/skip_special_tokens),
      // 顶层摊平正中靶心,零嵌套处理。
      const body: any = {
        model: this.model,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image } },
            { type: "text", text: prompt },
          ],
        }],
      };
      if (extra) Object.assign(body, extra);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
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
      throw new Error(
        `vlm 仅支持 ${[...this.visionTasks()].join(" / ")}(task="${req.task}" 不支持)。${
          this.isUnlimitedOcr(req.model ?? this.model) ? "" : "extract-text/table 请用 tesseract/paddle。"
        }`,
      );
    }
    // pares7: extra 优先级 req.extra(per-call,任意 task 生效) → this.extraBody(config 默认,**仅 OCR task**) → undefined(零回归,不发扩展键)
    // review fix high(对称 promptForUnlimited):this.extraBody 默认仅在 OCR task 摊入,
    // describe-image(VQA)/analyze-chart(JSON 抽取)不带 extra_body —— 防 NoRepeatNGram(ngram_size=35)压制 VQA
    // 合理重复词、skip_special_tokens=false 泄漏 OCR 结构 token 污染 description/JSON.parse、image_mode=gundam
    // (crop_mode=true)切片整图破坏场景级 VQA 整体理解。req.extra 显式传入时仍按原优先级任意 task 生效(per-call override)。
    const ocrTask = req.task === "extract-text" || req.task === "extract-table";
    const extra = req.extra ?? (ocrTask ? this.extraBody : undefined);
    const prompt = this.promptForUnlimited(req);
    const content = await this.chat(req.image, prompt, extra);
    if (req.task === "describe-image") {
      return { task: "describe-image", description: content, raw: content };
    }
    // analyze-chart:content 含 JSON(尝试提取 parse;失败则占位 + 返原文 description)
    if (req.task === "analyze-chart") {
      const chartMatch = content.match(/\{[\s\S]*\}/);
      let chart: any = { type: "auto", axes: {}, series: [] };
      if (chartMatch) {
        try { chart = JSON.parse(chartMatch[0]); } catch { /* 保留占位 */ }
      }
      return { task: "analyze-chart", chart, description: content, raw: content };
    }
    // pares7: Unlimited-OCR 通放时承接 extract-text/extract-table(parse 逻辑对齐 glm-vision.ts)
    if (req.task === "extract-table") {
      const fmt = (req.hints as ExtractTableHints | undefined)?.format ?? "html";
      const tableContent = fmt === "html"
        ? (content.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? content)
        : content; // markdown/latex/csv/json:用模型原文(prompt 已要求对应格式)
      return { task: "extract-table", table: { format: fmt, content: tableContent }, raw: content };
    }
    // extract-text
    return { task: "extract-text", text: content, raw: content };
  }
}
