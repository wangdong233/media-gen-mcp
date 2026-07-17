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
