/**
 * local-image.ts —— 图片输入本地化单源(#2 收敛,2026-09-03)。
 *
 * 生成域(generate_image images / create_video image+keyframes+images,日志#16)与
 * vision 域(extract_text / extract_table / analyze_chart / describe_image)共用同一入口:
 * 绝对本地路径 → 工具侧读文件 + magic-bytes 嗅探 mime(jpg/png/webp/gif)转 data: URI,
 * 消除客户端被迫 base64 的 stdio 开销(1MB JPG → ~1.4MB data URI 文本,单条 JSON-RPC 消息暴涨)。
 * 上限 LOCAL_IMAGE_INPUT_MAX_BYTES(15MB,超出结构化拒绝);相对路径拒绝并提示转绝对;
 * http(s)/data: 原样透传。两域输入面一致 —— 🔴 禁止在任何域另起第二份实现。
 *
 * 依赖方向:本模块是工具层输入规整(跨 provider 中性),sniffImage/上限常量的真源在
 * providers/flow.ts(首个消费者所在),此处只 import 不复制。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { sniffImage, LOCAL_IMAGE_INPUT_MAX_BYTES } from "./providers/flow.js";

/** URI 校验(http(s): / data:),生成域与 vision 域图片输入共用(R-CI-01 单源)。 */
export const isImageUri = (u: string) => /^(https?:|data:)/i.test(u);

/**
 * 图片输入本地化:http(s)/data: 原样透传;绝对本地路径读文件 → 嗅探 → data: URI(成功时向
 * warnings 推一条「已由工具侧读取转 data: URI」note);相对路径/超限/非图片字节/读取失败 →
 * 结构化错误(调用方自选错误通道:handler return err 或 throw)。
 */
export async function localizeImageInput(
  u: string,
  label: string,
  warnings: string[],
): Promise<{ ok: true; uri: string } | { ok: false; error: string }> {
  if (isImageUri(u)) return { ok: true, uri: u };
  if (!path.isAbsolute(u)) {
    return { ok: false, error: `${label} 须为 http(s): / data: URI 或绝对本地路径(收到 "${u.slice(0, 60)}";相对路径请转为绝对路径,工具侧会读文件转 data: URI)` };
  }
  let bytes: Buffer;
  try {
    const st = await fs.stat(u);
    if (!st.isFile()) return { ok: false, error: `${label} 本地路径不是常规文件:"${u}"` };
    if (st.size > LOCAL_IMAGE_INPUT_MAX_BYTES) {
      return { ok: false, error: `${label} 本地文件 ${Math.round(st.size / 1024 / 1024)}MB 超上限 ${Math.round(LOCAL_IMAGE_INPUT_MAX_BYTES / 1024 / 1024)}MB(工具侧服务端读取;请压缩或改传 http(s) URL)` };
    }
    bytes = Buffer.from(await fs.readFile(u));
    // 纵深防御(B 白盒 2026-08-31):stat→read 窗口内文件被替换/增长时,以实际读入字节复查
    // (data: URI 化还会再膨胀 ~1.33x,超限必须在进内存转 URI 前拦下)
    if (bytes.length > LOCAL_IMAGE_INPUT_MAX_BYTES) {
      return { ok: false, error: `${label} 本地文件 ${Math.round(bytes.length / 1024 / 1024)}MB 超上限 ${Math.round(LOCAL_IMAGE_INPUT_MAX_BYTES / 1024 / 1024)}MB(工具侧服务端读取;请压缩或改传 http(s) URL)` };
    }
  } catch (e: any) {
    return { ok: false, error: `${label} 本地文件读取失败:"${u}"(${e?.code ?? e?.message ?? e})` };
  }
  const sniffed = sniffImage(bytes);
  if (!sniffed.mimeType) {
    return { ok: false, error: `${label} 本地文件无法识别图片格式(前 8 字节非 PNG/JPEG/GIF/WEBP):"${u}"` };
  }
  warnings.push(`${label} 本地文件已由工具侧读取转 data: URI(${sniffed.mimeType},${Math.round(bytes.length / 1024)}KB):${u}`);
  return { ok: true, uri: `data:${sniffed.mimeType};base64,${bytes.toString("base64")}` };
}
