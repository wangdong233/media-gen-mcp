import { config } from "./config.js";
import type { VideoProvider, VideoHandle, VideoResult } from "./providers/types.js";
import { isTransient } from "./providers/http.js";

export interface WaitOptions {
  provider: VideoProvider;
  handle: VideoHandle;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** 每次轮询回调,用于向客户端推送 progress 通知。 */
  onProgress?: (pct: number, status: string) => void;
}

/** 下限保护:避免 0/负值导致紧密轮询或立即超时。 */
const MIN_POLL_INTERVAL = 1000;
const MIN_TIMEOUT = 1000;
/** 单次 getVideo 对瞬时错误(5xx/网络)的有界重试,指数退避。 */
const MAX_TRANSIENT_RETRIES = 3;

async function getVideoWithRetry(
  provider: VideoProvider,
  handle: VideoHandle,
): Promise<VideoResult> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      return await provider.getVideo(handle);
    } catch (e: any) {
      lastErr = e;
      if (!isTransient(e)) throw e; // 4xx 等非瞬时错误直接抛,不重试
      if (attempt < MAX_TRANSIENT_RETRIES) {
        const backoff = Math.min(8000, 1000 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}

/**
 * 轮询直至 completed / failed / 超时。
 * - 瞬时错误(5xx/网络)有界重试,避免一次抖动导致长任务伪失败。
 * - 超时不抛错,返回 status="timeout" + 最后已知状态 —— 交给上层走"文件优先回退"
 *   (任务在后端仍可能完成,稍后可用 get_video 再捞)。
 */
export async function waitVideo(opts: WaitOptions): Promise<VideoResult> {
  const timeout = Math.max(MIN_TIMEOUT, opts.timeoutMs ?? config.video.timeoutMs);
  const interval = Math.max(
    MIN_POLL_INTERVAL,
    opts.pollIntervalMs ?? config.video.pollIntervalMs,
  );
  const deadline = Date.now() + timeout;

  for (;;) {
    const r = await getVideoWithRetry(opts.provider, opts.handle);
    opts.onProgress?.(r.progress ?? 0, r.status);

    if (r.status === "completed") return r;
    if (r.status === "failed") {
      const e = new Error(`video failed: ${r.error ?? "unknown"}`);
      (e as any).result = r;
      throw e;
    }

    if (Date.now() >= deadline) {
      // 复用本轮已取的 r(消除冗余请求与竞态):到此处 r 必非终态
      return { ...r, status: "timeout" as const };
    }
    await new Promise((x) => setTimeout(x, interval));
  }
}
