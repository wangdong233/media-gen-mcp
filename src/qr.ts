import QRCode from "qrcode";

/**
 * QR 码生成(qrcode npm,纯 JS,零二进制依赖)。
 * 用户说"生成一个指向 xxx 的 QR 码" → Claude 调 generate_qrcode(text=...) → SVG/PNG。
 */
export interface QRRequest {
  /** 编码内容(URL/文本),必填。 */
  text: string;
  format?: "svg" | "png";
  /** 边距(模块数)。 */
  margin?: number;
  /** 纠错级别:L/M/Q/H。 */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** 暗色(前景)。 */
  dark?: string;
  /** 亮色(背景)。 */
  light?: string;
  /** PNG 目标像素宽(默认 ~scale×modules,短 URL≈116/长 URL≈196;打印海报建议 ≥300)。 */
  width?: number;
}

export interface QRRenderOutput {
  svg?: string;
  png?: Buffer;
}

export async function renderQR(req: QRRequest): Promise<QRRenderOutput> {
  const colorRe = /^(#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-z]+)$/i;
  if (req.dark && !colorRe.test(req.dark)) throw new Error(`dark must be hex (#000000) or CSS color name; got ${JSON.stringify(req.dark)}`);
  if (req.light && !colorRe.test(req.light)) throw new Error(`light must be hex (#ffffff) or CSS color name; got ${JSON.stringify(req.light)}`);
  const opts: QRCode.QRCodeRenderersOptions = {
    margin: req.margin ?? 2,
    errorCorrectionLevel: req.errorCorrectionLevel ?? "M",
    color: {
      dark: req.dark ?? "#000000",
      light: req.light ?? "#ffffff",
    },
  };
  const format = req.format ?? "svg";
  if (format === "png") {
    const pngOpts = { ...opts, type: "png" as const };
    if (req.width && req.width > 0) (pngOpts as any).width = Math.floor(req.width);
    const png = await QRCode.toBuffer(req.text, pngOpts);
    return { png };
  }
  const svg = await QRCode.toString(req.text, { ...opts, type: "svg" });
  return { svg };
}
