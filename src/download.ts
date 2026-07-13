import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * 下载产物到本地。Agnes 产物 URL(platform-outputs.agnes-ai.space)实测免鉴权。
 * - 带超时(AbortSignal),避免网络挂起无限阻塞工具调用。
 * - 流式落盘(reader → writeStream),避免大视频全量入内存。
 * - 失败时清理半成品文件。
 * 返回绝对路径,便于 CC 用 Read 看图 / 用 open 看视频。
 */
export async function downloadAsset(
  url: string,
  kind: "img" | "vid",
  outDir: string,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const ext = kind === "vid" ? ".mp4" : ".png";
  const name = `${kind}_${crypto.randomUUID().slice(0, 12)}${ext}`;
  const fp = path.join(outDir, name);

  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} -> HTTP ${res.status}`);
  }

  const ws = fsSync.createWriteStream(fp);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && !ws.write(value)) {
        await new Promise<void>((r) => ws.once("drain", () => r())); // 处理背压
      }
    }
    await new Promise<void>((resolve, reject) => {
      ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    ws.destroy(); // 显式释放文件句柄
    await fs.unlink(fp).catch(() => {}); // 清理半成品
    throw e;
  }
  return fp;
}
