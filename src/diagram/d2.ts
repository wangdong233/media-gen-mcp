import { D2 } from "@terrastruct/d2";
import { Resvg } from "@resvg/resvg-js";
import type { DiagramEngine, DiagramRequest, DiagramRenderOutput } from "./types.js";

/**
 * D2 引擎(@terrastruct/d2 WASM)—— 进程内、无浏览器、无 spawn。
 *
 * CQ-1 修复:D2 实例 lazy singleton(复用 worker + WASM),避免每次 new 泄漏 OS 线程 + 22MB 堆。
 * 串行队列:D2.sendMessage 用共享 currentResolve/currentReject,并发会竞态(MCP stdio 通常顺序,但保险)。
 *
 * 图标修复:D2 WASM 不嵌入 `icon:` 数据,留 <image href="set:name"> 光引用 → 碎图。
 * render 后后处理:fetch Iconify → 光栅化 PNG → 嵌 data URI(resvg 对 PNG-in-SVG 渲染可靠);
 * 无图标时不动(保持离线);无效图标名(404)移除该 <image>(优雅,节点仍显示文字)。
 */

// D2 图标解析(set:name → dataUri | null),进程内缓存;仅当 D2 产出含 icon 引用时才联网
const ICONIFY_API = "https://api.iconify.design";
const d2IconCache = new Map<string, string | null>();

async function resolveD2Icons(svg: string): Promise<string> {
  const refs = [...svg.matchAll(/<image\s+href="([a-z0-9_-]+):([a-z0-9_-]+)"/gi)];
  if (!refs.length) return svg; // 无图标引用 → 不动(保持离线确定性)
  let out = svg;
  for (const m of refs) {
    const set = m[1], name = m[2], key = `${set}:${name}`;
    let dataUri: string | null | undefined = d2IconCache.get(key);
    if (dataUri === undefined) {
      try {
        const res = await fetch(`${ICONIFY_API}/${set}/${name}.svg?color=%23334155`);
        if (!res.ok) { d2IconCache.set(key, null); dataUri = null; }
        else {
          const iconSvg = await res.text();
          const pngBuf = Buffer.from(new Resvg(iconSvg, { fitTo: { mode: "width", value: 64 } }).render().asPng());
          dataUri = `data:image/png;base64,${pngBuf.toString("base64")}`;
          d2IconCache.set(key, dataUri);
        }
      } catch {
        d2IconCache.set(key, null);
        dataUri = null;
      }
    }
    if (dataUri) {
      out = out.split(`href="${set}:${name}"`).join(`href="${dataUri}"`);
    } else {
      // 无效图标名(404):移除该 <image> 元素,避免碎图占位
      out = out.replace(new RegExp(`<image[^>]*href="${set}:${name}"[^>]*/>`,"gi"), "");
    }
  }
  return out;
}

// D2 主题名 → themeID(d2 WASM RenderOptions 仅接受 themeID: number;名映射免"传 dark 实际无效"的试错)
const D2_THEME_NAME_TO_ID: Record<string, number> = { default: 0, neutral: 1 };
/** 数字 themeID 合法范围(d2 --themes 实测目录 0-300;越界会在 WASM 深处炸出不可读错误,前置拦)。 */
const D2_THEME_ID_MAX = 300;
function resolveD2Theme(theme?: string): number | null {
  if (theme == null || theme.trim() === "") return null;
  const t = theme.trim();
  const num = Number(t);
  if (Number.isFinite(num)) {
    if (!Number.isInteger(num) || num < 0 || num > D2_THEME_ID_MAX) {
      throw new Error(`D2 themeID 须为 0-${D2_THEME_ID_MAX} 的整数(收到 "${t}")。已知名: ${Object.keys(D2_THEME_NAME_TO_ID).join("/")};完整目录见 d2 --themes。`);
    }
    return num;
  }
  const id = D2_THEME_NAME_TO_ID[t.toLowerCase()];
  if (id != null) return id;
  throw new Error(`unknown D2 theme "${t}". 已知名: ${Object.keys(D2_THEME_NAME_TO_ID).join("/")}; 或传数字 themeID(0-${D2_THEME_ID_MAX},见 d2 --themes)。`);
}
// D2 PNG box-bounded zoom(防大架构图产出超大 PNG),与 graphviz 配置对齐(白底 + 中文字体兜底)
const D2_MAX_W = 2000, D2_MAX_H = 2000;
function d2FitTo(svg: string): { mode: "zoom"; value: number } | { mode: "width"; value: number } {
  const vb = svg.match(/viewBox="[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  if (vb) {
    const w = parseFloat(vb[1]), h = parseFloat(vb[2]);
    if (w > 0 && h > 0) return { mode: "zoom", value: Math.min(D2_MAX_W / w, D2_MAX_H / h) };
  }
  return { mode: "width", value: 1600 };
}

/**
 * DOT 误入 D2 启发式(预编译前的 input 检测,不是 errmsg 归一化范畴)。
 * 从原 enhanceD2Error 首分支提取(2026-07-21 P0-2 §4.4 删除前的提取动作)。
 * 保留在 d2.ts 是因为这是 input-based 启发式,与错误归一化(handler 层 normalizeEngineError)不同层。
 * 最终归宿可能是 P1-1 的 DSL pre-flight lint 层;P0-2 期内保留行为不变。
 * 返回 HINT 后缀(带前导空格,可直接拼到 errmsg 后),或 null。
 */
function detectDotAsD2(code: string): string | null {
  if (/^(strict\s+)?(di)?graph\b/mi.test(code.trim()) || /\brankdir\b/mi.test(code)) {
    return ' HINT: 这看起来像 Graphviz DOT 语法。D2 语法不同,请设 engine:"graphviz"。';
  }
  return null;
}

// keep-alive 句柄:有在飞渲染时 ref() 保活让 await 落地;空闲 unref() → 独立进程(测试/脚本/嵌入式)
// 可自然退出。MCP server 由 StdioServerTransport 保活,不受影响。修复 d2 worker 永不释放导致的 hang。
const d2KeepAlive = setInterval(() => {}, 1e9);
d2KeepAlive.unref();
let d2Active = 0;

export class D2Engine implements DiagramEngine {
  readonly name = "d2" as const;
  private d2?: D2;
  private chain: Promise<unknown> = Promise.resolve();
  private unrefApplied = false;

  isAvailable(): boolean {
    return true;
  }

  listTypes(): string[] {
    return ["flowchart", "sequence", "class", "architecture", "mindmap", "er"];
  }

  async render(req: DiagramRequest): Promise<DiagramRenderOutput> {
    const run = async (): Promise<DiagramRenderOutput> => {
      // CQ-1:lazy singleton,复用 D2(worker + 22MB WASM),不每次 new
      this.d2 ??= new D2();
      const d2 = this.d2;
      // worker 首次 ready 后 unref —— 保留 compile/render 功能 + server 复用,只是不再 pin 事件循环
      if (!this.unrefApplied) {
        this.unrefApplied = true;
        Promise.resolve((d2 as any).ready).then(
          () => {
            try { (d2 as any).worker?.unref?.(); } catch { /* ignore */ }
          },
          () => {},
        );
      }

      let compiled;
      try {
        compiled = await d2.compile(req.code);
      } catch (e: any) {
        // P0-2 §4.4:engine 层只抛裸 errmsg(不再走 enhanceD2Error 的 9 条 HINT)。
        // HINT 知识已迁入 src/handlers/error-format.ts 的 knownErrorPatterns.d2(handler 层统一归一化)。
        // DOT 误入 D2 启发式(非 errmsg 匹配)保留在此处 —— input-based,与归一化不同层。
        const rawErrmsg = e?.message ?? String(e);
        const dotHint = detectDotAsD2(req.code);
        throw new Error(dotHint ? `${rawErrmsg}${dotHint}` : rawErrmsg);
      }

      // CQ-2:theme → themeID(D2 接受数字 ID)
      // P0-5A §3.2:最小加性方案 —— 三杠杆(darkThemeID/noXMLTag/salt)条件展开合并。
      //   generate_diagram 路径不传这三字段 → 三展开项全 false → renderOpts 退化为
      //   { ...compiled.renderOptions, ...(themeID != null && { themeID }) } → 与改造前 byte-identical。
      //   darkThemeID 必须严格全大写(Go 反序列化大小写敏感,驼峰 darkThemeId 会静默不生效)。
      const themeID = resolveD2Theme(req.theme);
      const darkThemeID = req.darkTheme != null ? resolveD2Theme(req.darkTheme) : null;
      const renderOpts = {
        ...compiled.renderOptions,
        ...(themeID != null ? { themeID } : {}),
        ...(darkThemeID != null ? { darkThemeID } : {}),        // C1: 大写 ID
        ...(req.noXMLTag === true ? { noXMLTag: true } : {}),   // C2: HTML 内联必去 <?xml?>
        ...(req.salt ? { salt: req.salt } : {}),                // C3: 固定 salt(多图防 ID 冲突)
      };

      const svg = await d2.render(compiled.diagram, renderOpts);
      const resolved = await resolveD2Icons(svg); // 修复 icon: 碎图(解析 Iconify → 嵌 data URI)

      let png: Buffer | undefined;
      if (req.format === "png") {
        // P0-2 §4.3.4:PNG 复用路径的 resvg 错误加 [resvg] 前缀,handler 层 normalizeEngineError
        // 用结构性信号(engineHint/前缀)路由到 resvg patterns 表,替代脆弱的内容匹配。
        try {
          const resvg = new Resvg(resolved, {
            background: "#ffffff",
            fitTo: d2FitTo(resolved),
            font: { loadSystemFonts: true, defaultFontFamily: "PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" },
          });
          png = Buffer.from(resvg.render().asPng());
        } catch (e: any) {
          throw new Error("[resvg] " + (e?.message ?? String(e)));
        }
      }
      return { svg: resolved, png };
    };

    // active refcount:渲染中 ref 保活(防 worker unref 导致在飞 render 被判 unsettled 提前退出),空闲 unref
    d2Active++;
    if (d2Active === 1) d2KeepAlive.ref();
    // 串行化修正:run() 在链里惰性启动(真正串行 sendMessage),防并发 currentResolve 竞态 → 孤儿 promise hang
    const result = this.chain.catch(() => undefined).then(() => run());
    this.chain = result.catch(() => undefined); // catch 防 rejection 成 unhandled 杀进程
    try {
      return await result;
    } finally {
      d2Active--;
      if (d2Active === 0) d2KeepAlive.unref();
    }
  }
}
