import { Resvg } from "@resvg/resvg-js";

/**
 * 矢量图标(Iconify)—— 按需从 Iconify 公共 API 取 SVG → 本地 SVG/PNG。
 * 用户说"给我一个 GitHub 的 logo 图标" → Claude 调 generate_icon(name="logos:github") → SVG/PNG。
 *
 * 取舍(见排期文档):不打包 @iconify/json 全集(~70MB,会让 npx 安装变重)。
 * 改用 Iconify 免费 API 按需取单个图标 + 内存缓存(LRU,256 项)。
 * 代价:这是本 server 中唯一需要联网的工具(diagram/qr/chart/formula 全本地)。
 * 离线时抛清晰错误。图标浏览:https://icon-sets.iconify.design
 */
const ICONIFY_API = "https://api.iconify.design";
const CACHE_CAP = 256;

// Map 保持插入顺序,实现简易 LRU:超容量删最旧。key = name@size@color。
const cache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    cache.delete(key); // 重置为最新
    cache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, val: string): void {
  cache.set(key, val);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export interface IconRequest {
  /** 图标名 prefix:name,如 "mdi:home" / "logos:github" / "lucide:check"。 */
  name: string;
  /** 像素尺寸(正方形,默认 128)。 */
  size?: number;
  /** 前景色(默认 currentColor,即透明背景需调用方指定;渲染 PNG 默认 currentColor=黑)。 */
  color?: string;
  format?: "svg" | "png";
}

export interface IconRenderOutput {
  svg: string;
  png?: Buffer;
}

export async function renderIcon(req: IconRequest): Promise<IconRenderOutput> {
  if (!req.name || !req.name.trim()) throw new Error("`name` is required");
  const name = req.name.trim();
  if (!name.includes(":")) {
    throw new Error(`icon name must be "prefix:name" (e.g. "mdi:home"); got "${name}"`);
  }
  const size = req.size && req.size > 0 ? Math.floor(req.size) : 128;
  const color = req.color && req.color.trim() ? req.color.trim() : "currentColor";

  const cacheKey = `${name}@${size}@${color}`;
  let svg = cacheGet(cacheKey);
  if (!svg) {
    const params = new URLSearchParams({ width: String(size), height: String(size) });
    if (color !== "currentColor") params.set("color", color);
    // 编码 prefix 与 name,但保留 ":" 字面量(Iconify 路径约定 prefix:name)
    const [prefix, ...rest] = name.split(":");
    const iconPath = `${encodeURIComponent(prefix!)}:${encodeURIComponent(rest.join(":"))}`;
    const url = `${ICONIFY_API}/${iconPath}.svg?${params.toString()}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e: any) {
      throw new Error(
        `Iconify request failed (icon tool needs network): ${e?.message ?? String(e)}`,
      );
    }
    if (res.status === 404) {
      throw new Error(
        `icon not found: "${name}". Browse valid names at https://icon-sets.iconify.design`,
      );
    }
    if (!res.ok) {
      throw new Error(`Iconify API error ${res.status}: ${res.statusText}`);
    }
    svg = await res.text();
    if (!svg || !svg.trim().startsWith("<svg")) {
      throw new Error(`Iconify returned non-SVG for "${name}"`);
    }
    cacheSet(cacheKey, svg);
  }

  let png: Buffer | undefined;
  if (req.format === "png") {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
      background: color === "currentColor" ? "#ffffff" : undefined,
    });
    png = Buffer.from(resvg.render().asPng());
  }
  return { svg, png };
}

/** 仅供测试:清空图标缓存。 */
export function _clearIconCache(): void {
  cache.clear();
}
