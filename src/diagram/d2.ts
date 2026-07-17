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
function resolveD2Theme(theme?: string): number | null {
  if (theme == null || theme.trim() === "") return null;
  const t = theme.trim();
  const num = Number(t);
  if (Number.isFinite(num)) return num;
  const id = D2_THEME_NAME_TO_ID[t.toLowerCase()];
  if (id != null) return id;
  throw new Error(`unknown D2 theme "${t}". 已知名: ${Object.keys(D2_THEME_NAME_TO_ID).join("/")}; 或传数字 themeID(见 d2 --themes)。`);
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

/** 增强 D2 错误信息:解析 D2 技术性错误,追加可操作 HINT(让 Claude 首次纠对,不试错)。 */
function enhanceD2Error(msg: string, code: string): string {
  let hint = "";
  if (/^(strict\s+)?(di)?graph\b/mi.test(code.trim()) || /\brankdir\b/mi.test(code)) {
    hint = " HINT: 这看起来像 Graphviz DOT 语法。D2 语法不同,请设 engine:\"graphviz\"。";
  } else if (/number between/i.test(msg)) hint = " HINT: D2 numeric properties (stroke-width, font-size, border-radius, stroke-dash, width, height) accept INTEGERS ONLY — floats like 1.5 are invalid, use 1 or 2.";
  else if (/valid named color|hex code/i.test(msg)) hint = " HINT: hex colors MUST be QUOTED in D2 (style.fill: \"#ff0000\") because # starts a comment — unquoted #ff0000 is eaten as comment. Named colors like red don't need quotes.";
  else if (/one of/i.test(msg)) {
    const m = msg.match(/one of[^:]*:\s*(.+)/i);
    if (m) hint = ` HINT: valid values are: ${m[1].trim()}`;
  } else if (/maps must be terminated/i.test(msg)) hint = " HINT: in D2 map blocks { }, each property goes on its OWN LINE. Check for missing closing } or properties on the same line.";
  else if (/unexpected text after/i.test(msg)) hint = " HINT: D2 map properties must be one per line (newline-separated). Multiple properties on one line with spaces/semicolons can cause this.";
  else if (/non-integer/i.test(msg)) hint = " HINT: D2 requires integers (not floats) for this property.";
  else if (/missing value after/i.test(msg)) hint = " HINT: # starts a COMMENT in D2. If your value starts with # (like a hex color #ff0000), it MUST be quoted: style.fill: \"#ff0000\". Named colors like red don't need quotes.";
  return msg + (hint || "");
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
        throw new Error(enhanceD2Error(e?.message ?? String(e), req.code));
      }

      // CQ-2:theme → themeID(D2 接受数字 ID)
      const themeID = resolveD2Theme(req.theme);
      const renderOpts = themeID != null
        ? { ...compiled.renderOptions, themeID }
        : compiled.renderOptions;

      const svg = await d2.render(compiled.diagram, renderOpts);
      const resolved = await resolveD2Icons(svg); // 修复 icon: 碎图(解析 Iconify → 嵌 data URI)

      let png: Buffer | undefined;
      if (req.format === "png") {
        const resvg = new Resvg(resolved, {
          background: "#ffffff",
          fitTo: d2FitTo(resolved),
          font: { loadSystemFonts: true, defaultFontFamily: "PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" },
        });
        png = Buffer.from(resvg.render().asPng());
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
