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

/** 增强 D2 错误信息:解析 D2 技术性错误,追加可操作 HINT(让 Claude 首次纠对,不试错)。 */
function enhanceD2Error(msg: string, _code: string): string {
  let hint = "";
  if (/number between/i.test(msg)) hint = " HINT: D2 numeric properties (stroke-width, font-size, border-radius, stroke-dash, width, height) accept INTEGERS ONLY — floats like 1.5 are invalid, use 1 or 2.";
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

export class D2Engine implements DiagramEngine {
  readonly name = "d2" as const;
  private d2?: D2;
  private chain: Promise<unknown> = Promise.resolve();

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

      let compiled;
      try {
        compiled = await d2.compile(req.code);
      } catch (e: any) {
        throw new Error(enhanceD2Error(e?.message ?? String(e), req.code));
      }

      // CQ-2:theme → themeID(D2 接受数字 ID)
      const themeNum = req.theme != null ? Number(req.theme) : NaN;
      const renderOpts = Number.isFinite(themeNum)
        ? { ...compiled.renderOptions, themeID: themeNum }
        : compiled.renderOptions;

      const svg = await d2.render(compiled.diagram, renderOpts);
      const resolved = await resolveD2Icons(svg); // 修复 icon: 碎图(解析 Iconify → 嵌 data URI)

      let png: Buffer | undefined;
      if (req.format === "png") {
        const resvg = new Resvg(resolved);
        png = Buffer.from(resvg.render().asPng());
      }
      return { svg: resolved, png };
    };

    // 串行化:防 D2.sendMessage 并发竞态。catch 防止 run() rejection 成 unhandled → 杀进程
    const result = run();
    this.chain = this.chain
      .then(() => result, () => result)
      .catch(() => undefined);
    return result as Promise<DiagramRenderOutput>;
  }
}
