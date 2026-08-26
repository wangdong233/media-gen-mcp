import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * 自定义文件名清洗:basename 去路径穿越 + 剥调用方自带扩展名(防双扩展)+ 仅替文件系统危险字符;
 * 保留中文等 Unicode 字符(此前用 [^\w.\-] 会把中文全替成 _);空名/未传返回 ""(调用方 UUID/默认名兜底)。
 * 抽出导出:flow_status 的自定义落盘名复用同一清洗(与 downloadAsset 一致 —— audit finding-14)。
 */
export function sanitizeFileBase(nameHint?: string): string {
  if (!nameHint || !nameHint.trim()) return "";
  return path
    .basename(nameHint.trim())
    .replace(/\.(png|jpe?g|gif|webm|mp4|mov|webp)$/i, "")
    .replace(/[/\\<>:"|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "");
}

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
  nameHint?: string,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });

  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) {
    throw new Error(`download ${url} -> HTTP ${res.status}`);
  }
  // 按 content-type 选扩展(img 可能是 jpeg/webp;vid 固定 mp4),避免 jpg/webp 字节贴 .png 扩展名
  const ct = res.headers.get("content-type") ?? "";
  let ext: string;
  if (kind === "vid") {
    ext = ct.includes("webm") ? ".webm" : ".mp4";
  } else {
    ext = ".png";
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = ".jpg";
    else if (ct.includes("webp")) ext = ".webp";
    else if (ct.includes("gif")) ext = ".gif";
    else if (ct.includes("svg")) ext = ".svg";
  }
  const base = sanitizeFileBase(nameHint) || `${kind}_${crypto.randomUUID().slice(0, 12)}`;
  // 防覆盖:目标已存在时自动加 -2/-3… 序号避让,绝不静默覆盖既有文件(用户指定同名重下/取件是
  // 高频操作;覆盖旧产物违背"看一眼再覆盖"纪律)。UUID 兜底名不会撞,仅在显式 name 时可能触发。
  let fp = path.join(outDir, base + ext);
  for (let i = 2; fsSync.existsSync(fp); i++) fp = path.join(outDir, `${base}-${i}${ext}`);

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
