/**
 * HTTP 瞬时错误重试(共享基础设施)。
 *
 * 背景:agnes/zhipu 的 request() 原本对 5xx(503 Service busy / ServiceUnavailable)零重试,
 * 直接抛给调用方,调用方只能手动重试。poll.ts 已为轮询路径实现过 isTransient + 指数退避,
 * 这里把它上移为所有 provider 提交/查询路径的共享能力 —— 瞬时错误在工具内部自动恢复,
 * 不依赖调用方(CC)试错。
 *
 * 策略:5xx / status=0 / fetch TypeError → 指数退避重试(maxRetries 次);4xx 立即抛(业务错误)。
 */
import { config } from "../config.js";

/**
 * 判断错误是否值得 fallback 到另一家 provider(5xx/网络/鉴权/限流 → YES;业务 4xx / 配置错 / 校验错 → NO)。
 *
 * 与 isTransient 的关系:isTransient = 同一 provider 内是否重试(瞬时错误);
 * isFallbackWorthy = 是否换 provider 重试。语义更宽(多认 401/403/429,因为鉴权挂一家时换一家有意义)。
 *
 * 判定规则:
 * - 有 .status(provider request() 抛出的 HTTP 错):0(网络层无码)/ ≥500 / 401 / 403 / 429 → YES
 * - 无 .status:仅 fetch 网络层 TypeError → YES;其余(provider 内部校验/配置错,如
 *   "image model 未配置" / "image-to-video requires image")→ NO,保留原始错误给用户,免误导排查方向
 *   且避免对 fb 发无谓调用 + 把 primary 错误打入 60s 熔断(配置错不会自愈)。
 */
export function isFallbackWorthy(e: any): boolean {
  const s = e?.status;
  if (typeof s === "number") {
    return s === 0 || s >= 500 || s === 401 || s === 403 || s === 429;
  }
  return e?.name === "TypeError";
}

/**
 * C 任务:渠道链推进判定(isFallbackWorthy 的超集,仅优先级链 walk 消费)。
 *
 * 增补一类:provider 自声明的「环境前置未就绪」错误(e.precondition === true,如 flow 的
 * S100 CDP 不可连 / S101 无页面 / S102 未登录 / S104 reCAPTCHA 失败)—— 请求从未提交,
 * 不是业务错误,链头是「默认路由」(非显式点名)时应推进到下一渠道,而非把环境错误抛给用户。
 *
 * 与 isFallbackWorthy 分开而未合并:单跳 fallback 既有路径(vision/pdf 等)语义保持逐字节不变;
 * 本函数仅供 generate_image 链式 walk 与 create_video 的链头(非钉死)路径使用。
 * 显式点名的 provider(如 provider=flow)在调用方先被钉死守卫拦下,永不走到这里。
 */
export function isChainAdvanceable(e: any): boolean {
  return isFallbackWorthy(e) || e?.precondition === true;
}

/**
 * 钉死守卫(纯函数,导出供 provider-priority.test.ts 白盒):请求是否「钉死」目标渠道 ——
 * 链式 walk 失败时直抛原始错误,绝不静默换成他渠道产物。
 *
 * 【行为决策记录 2026-08-24 三审 finding-1(选项②:收窄契约承诺,而非泛化行为)】
 * 钉死范围 = 显式点名(provider=X 或 model 归属路由)**且**目标渠道 requiresOptIn(modality)=true
 * (当前仅 flow):
 *   - opt-in 渠道承载计费/隐私边界,用户点名的是「这个渠道」,失败直抛(audit finding-15 语义劫持防护);
 *   - 免费渠道(agnes/zhipu)显式点名后失败仍按链回落(带 warning)—— 保持 145f83e 基线行为(零回归),
 *     schema/generate_image provider 描述与 list_models routingNote 已同步收窄为
 *     "naming an opt-in provider (flow) pins it; free providers fall through with a warning"。
 * 注:0fa1fc4(已 revert)曾把钉死泛化到全渠道;合包后回到 opt-in 钉死。本函数是该决策的
 * 单一可测真源 —— handler 不得内联重写此判定(防语义漂移)。
 */
export function isRequestPinned(
  explicitProvider: string | null | undefined,
  model: string | null | undefined,
  requiresOptIn: boolean,
): boolean {
  return (explicitProvider != null || model != null) && requiresOptIn === true;
}

/** 判断错误是否为"瞬时"(值得重试):5xx、网络层错误(fetch TypeError / status=0)。 */
export function isTransient(e: any): boolean {
  const s = e?.status ?? 0;
  return s >= 500 || s === 0 || e?.name === "TypeError";
}

export interface RetryOpts {
  maxRetries?: number;
  baseMs?: number;
  maxMs?: number;
  /** 日志标签(如 "Agnes" / "Zhipu")。 */
  tag?: string;
}

/**
 * 包裹一个异步操作,对瞬时错误指数退避重试,4xx/业务错误立即抛。
 * fn 失败时应抛出带 `.status` / `.body` 的错误(沿用 provider request() 的错误形状)。
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? config.http.maxRetries;
  const baseMs = opts.baseMs ?? config.http.retryBaseMs;
  const maxMs = opts.maxMs ?? config.http.retryMaxMs;
  const tag = opts.tag ?? "http";
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isTransient(e)) throw e; // 4xx 等非瞬时错误直接抛,不重试
      if (attempt < maxRetries) {
        const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
        console.error(
          `[media-gen-mcp] ${tag} ${e?.status ?? "network"} 错误 (第 ${attempt + 1}/${maxRetries} 次),${backoff}ms 后重试`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}
