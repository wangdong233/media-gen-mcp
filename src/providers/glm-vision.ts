/**
 * GlmVisionProvider —— 智谱 GLM-4.6V 视觉 provider(pares7)。
 *
 * 定位:智谱开放平台 **GLM-4.6V-Flash(永久免费)**,128K 上下文 + OCR + 复杂表格 + 图表 + VQA 全覆盖。
 * 作 paddle(中文 SOTA 主力 tier=10)的**云端 fallback** + vlm(自托管 vLLM tier=8)的**零配置替代**。
 * tier=9:vision 链 paddle(10)→ glm-vision(9)→ vlm(8)→ tesseract(1)。
 *
 * 端点:open.bigmodel.cn/api/paas/v4/chat/completions(OpenAI 兼容,Bearer {id}.{secret})。
 * 与 zhipu.ts 图像/视频**同源**(共享 ZhipuClient)。
 *
 * 多 key 轮换:apiKeys 数组 → KeyPool 轮换 + classifyZhipuError 业务码分流
 * (1302 切 key / 额度耗尽切 key / 401 保守 transient)。
 *
 * **合规(调研附录 2 D2)**:仅接受 open.bigmodel.cn 标准 api_key。
 *   - Code Plan key(ZAI_API_KEY)不可用:绑定 api.z.ai/api/coding/* 专用端点 + 限 9 个白名单工具 + 违规封号不退款
 *   - 多 key 轮换违约风险:智谱 User Agreement §2/§3 禁多账号/共享 —— apiKeys.length>1 时 registry 层 warn
 *
 * 与 vlm.ts(vLLM)的 3 处差异(独立 provider 的根本原因,调研 C 维度):
 *   1) 端点前缀 /paas/v4 vs vlm 的 /v1
 *   2) Bearer 必填(智谱)vs vlm apiKey 可空(自托管)
 *   3) 错误处理加 classifyZhipuError 业务码分流(KeyPool 驱动)
 */
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
import { ZhipuClient } from "./zhipu-client.js";
import { KeyPool } from "./key-pool.js";
import { classifyZhipuError } from "./zhipu-errors.js";
import { promptFor } from "./vision-prompt.js";

interface GlmVisionConfig {
  apiKeys?: string[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class GlmVisionProvider implements MediaProviderBase, VisionProvider {
  readonly name = "glm-vision";
  private readonly client: ZhipuClient;
  private readonly pool: KeyPool;
  private readonly model: string;
  private cooldownUntil = 0;
  private lastErrorAt: string | undefined;

  constructor(c: GlmVisionConfig) {
    const keys = Array.isArray(c.apiKeys) && c.apiKeys.length
      ? c.apiKeys.map((k) => (k ?? "").trim()).filter(Boolean)
      : (c.apiKey ? [c.apiKey.trim()] : []);
    this.client = new ZhipuClient({ apiKey: keys[0] ?? "", baseUrl: c.baseUrl ?? "" });
    this.pool = new KeyPool(keys);
    this.model = c.model ?? "glm-4.6v-flash"; // 永久免费首选(调研 §2)
  }

  listModels(): string[] {
    return [];
  }
  listVisionModels(): string[] {
    return [];
  }
  visionTasks(): readonly VisionTask[] {
    // 全 4 task:作 paddle 云端 fallback + 免费 VQA 层
    // (GLM-4.6V-Flash 文档自述 OCR/复杂表格/图表/VQA 全覆盖 —— 调研 A 维度)
    return ["extract-text", "extract-table", "analyze-chart", "describe-image"];
  }
  visionConstraints(): VisionConstraints {
    return { languages: ["en", "zh-Hans", "zh-Hant", "ja", "ko"] };
  }
  describeVisionOptions(): VisionOptionDescriptors {
    // pares6 自描述。铁律:不返 tasks/languages/maxBytes(R-CI-08,三方法真值分工)
    return {
      role: "云端 GLM-4.6V 视觉(免费层 + paddle 云端 fallback)",
      latencyTier: "moderate",
      accuracyTier: "high",
      perTaskNotes: {
        "extract-text": "GLM-4.6V-Flash OCR(印刷/手写/艺术字),中文 SOTA",
        "extract-table": "复杂表格(多层表头/合并单元格/跨页)",
        "analyze-chart": "图表分析(柱/折线/饼/散点)",
        "describe-image": "完整 VQA(支持 question 参数)",
      },
      notes: "需配置 providers[\"glm-vision\"].apiKey(open.bigmodel.cn 标准 {id}.{secret},非 Code Plan key)。GLM-4.6V-Flash 永久免费。",
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
      configured: !!this.client.apiKey,
      cooldown: this.cooldownUntil > Date.now(),
      ...(this.lastErrorAt ? { lastErrorAt: this.lastErrorAt } : {}),
    };
  }
  tier(): number {
    return 9; // 介于 paddle(10)与 vlm(8)
  }
  notifyUnavailable(_e: any): void {
    this.cooldownUntil = Date.now() + 60_000;
    this.lastErrorAt = new Date().toISOString();
  }

  /** 单次 chat(给定 key)。返 message.content。 */
  private async chat(image: string, prompt: string, key: string): Promise<string> {
    const body = {
      model: this.model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: prompt },
        ],
      }],
    };
    const r = await this.client.request("/paas/v4/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
    }, key);
    return r?.choices?.[0]?.message?.content ?? "";
  }

  async recognize(req: VisionRequest): Promise<VisionResult> {
    if (!this.visionTasks().includes(req.task)) {
      throw new Error(`glm-vision 不支持 task="${req.task}"(支持:${[...this.visionTasks()].join("/")})。`);
    }
    if (!this.client.apiKey && this.pool.size === 0) {
      const e = new Error(
        'glm-vision 未配置 api_key。请在 config.json 设 providers["glm-vision"].apiKey 或 .apiKeys(智谱开放平台 {id}.{secret} 格式;Code Plan key 不可用)。',
      );
      (e as any).status = 503;
      throw e;
    }
    const prompt = promptFor(req);

    // KeyPool 轮换:单 key no-op,多 key 按 classifyZhipuError 分流切 key
    const maxAttempts = Math.max(1, this.pool.size);
    const tried = new Set<string>();
    let lastErr: any;
    for (let i = 0; i < maxAttempts; i++) {
      const key = this.pool.acquire();
      if (!key || tried.has(key)) break; // 全耗尽或全试过 → 退出让 provider 级 fallback
      tried.add(key);
      try {
        const content = await this.chat(req.image, prompt, key);
        return this.parseResult(req, content);
      } catch (e: any) {
        lastErr = e;
        const cls = classifyZhipuError(e);
        if (cls === "key-dead") {
          this.pool.markExhausted(key);
          continue; // 切下一 key
        }
        if (cls === "key-cool") {
          this.pool.markLimited(key);
          continue; // 切下一 key
        }
        // transient(1305 平台过载 / 网络 / 401 保守 / 未知):不动 key 池,抛给 provider 级 fallback
        throw e;
      }
    }

    // 全 key 耗尽:抛 isFallbackWorthy 错误,让 getFallbackProvider 切下一 provider(vlm/tesseract)
    if (!lastErr) {
      lastErr = new Error("glm-vision 所有 key 不可用(全限额/全耗尽)");
    }
    (lastErr as any).status = (lastErr as any).status ?? 429;
    throw lastErr;
  }

  /** 按 task 把 chat content 解析为 VisionResult(对齐 vlm.ts parse 逻辑)。 */
  private parseResult(req: VisionRequest, content: string): VisionResult {
    if (req.task === "describe-image") {
      return { task: "describe-image", description: content, raw: content };
    }
    if (req.task === "analyze-chart") {
      const m = content.match(/\{[\s\S]*\}/);
      let chart: any = { type: "auto", axes: {}, series: [] };
      if (m) {
        try { chart = JSON.parse(m[0]); } catch { /* 保留占位 */ }
      }
      return { task: "analyze-chart", chart, description: content, raw: content };
    }
    if (req.task === "extract-table") {
      const m = content.match(/<table[\s\S]*?<\/table>/i);
      const tableContent = m ? m[0] : content;
      return { task: "extract-table", table: { format: "html", content: tableContent }, raw: content };
    }
    // extract-text
    return { task: "extract-text", text: content, raw: content };
  }
}
