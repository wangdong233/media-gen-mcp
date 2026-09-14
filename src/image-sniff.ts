/** 媒体字节嗅探(magic bytes)——中立模块(2026-09-14 F7:第二消费者 pixverse 出现,自 flow.ts 迁出;两 provider 共用单一实现)。 */
export function sniffImage(bytes: Buffer): { mimeType?: string; width?: number; height?: number } {
  const latin = (s: number, e: number) => bytes.subarray(s, e).toString("latin1");
  const be16 = (o: number) => bytes.readUInt16BE(o);
  const le16 = (o: number) => bytes.readUInt16LE(o);
  try {
    if (bytes.length > 24 && latin(0, 8) === "\x89PNG\r\n\x1a\n" && latin(12, 16) === "IHDR") {
      return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes.length > 10 && (latin(0, 6) === "GIF87a" || latin(0, 6) === "GIF89a")) {
      return { mimeType: "image/gif", width: le16(6), height: le16(8) };
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      // JPEG:扫 SOF0-3/5-7/9-11/13-15 段取尺寸(逐段跳过,容错截断)
      let o = 2;
      while (o + 9 < bytes.length) {
        if (bytes[o] !== 0xff) { o++; continue; }
        const marker = bytes[o + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { mimeType: "image/jpeg", height: be16(o + 5), width: be16(o + 7) };
        }
        const len = be16(o + 2);
        if (len < 2) break;
        o += 2 + len;
      }
      return { mimeType: "image/jpeg" };
    }
    if (bytes.length > 30 && latin(0, 4) === "RIFF" && latin(8, 12) === "WEBP") {
      const chunk = latin(12, 16);
      if (chunk === "VP8X") return { mimeType: "image/webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { mimeType: "image/webp", width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = bytes.readUInt32LE(21);
        return { mimeType: "image/webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return { mimeType: "image/webp" };
    }
  } catch { /* 嗅探失败按未知处理 */ }
  return {};
}
