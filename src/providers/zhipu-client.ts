// src/providers/zhipu-client.ts
/**
 * 智谱 HTTP 客户端(认证 + request + 错误形状单一真源,R-CI-02)。
 *
 * zhipu.ts(图像/视频)与 glm-vision.ts(视觉)共用,避免两处复制 Bearer + fetch + JSON 解析。
 * 独立文件(review high:不能作 zhipu.ts 内部 class —— glm-vision.ts 无法 import 内部 class)。
 *
 * 端点(同源双镜像,调研附录 2 D1·4):open.bigmodel.cn/api(国内)/ api.z.ai/api(国际),
 * 同一把 {id}.{secret} api_key 可用(zhipu.ts:126 注释已标)。
 *
 * 认证:Authorization: Bearer {api_key}({id}.{secret} 整串作 Bearer,v4 OpenAI 兼容 ——
 * 调研 A 维度:JWT 是 SDK 可选优化非必需,plain Bearer 直连 v4)。
 *
 * 合规:仅接受 open.bigmodel.cn 标准 api_key。Code Plan key(ZAI_API_KEY)绑定
 * api.z.ai/api/coding/* 专用端点 + 限 9 个白名单工具,不能用(调研附录 2 D2)。
 */
import { withRetry } from "./http.js";

export interface ZhipuClientConfig {
  apiKey: string;
  baseUrl: string;
}

export class ZhipuClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(c: ZhipuClientConfig) {
    this.apiKey = (c.apiKey ?? "").trim();
    this.baseUrl = (c.baseUrl || "https://open.bigmodel.cn/api").replace(/\/$/, "");
  }

  /**
   * 发起认证请求。返回解析后的 JSON;非 2xx 抛带 .status/.body 的错误(沿用 provider 错误形状)。
   * 5xx/网络 → withRetry 指数退避;4xx 立即抛(含 429/1302,由调用方 classifyZhipuError 分流)。
   *
   * @param overrideKey KeyPool 选定的 key(覆盖默认 apiKey),glm-vision 多 key 轮换用;
   *                    zhipu.ts(图像/视频)不传,用默认 apiKey。
   */
  async request(path: string, init: RequestInit = {}, overrideKey?: string): Promise<any> {
    const key = (overrideKey ?? this.apiKey).trim();
    if (!key) throw new Error("ZHIPU_API_KEY is not set");
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    return withRetry(async () => {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      if (!res.ok) {
        const msg = json?.error?.message ?? json?.message ?? text;
        const e = new Error(`Zhipu ${res.status}: ${msg}`);
        (e as any).status = res.status;
        (e as any).body = json;
        throw e;
      }
      return json;
    }, { tag: "Zhipu" });
  }
}
