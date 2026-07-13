import { D2 } from "@terrastruct/d2";
import { Resvg } from "@resvg/resvg-js";
import type { DiagramEngine, DiagramRequest, DiagramRenderOutput } from "./types.js";

/**
 * D2 引擎(@terrastruct/d2 WASM)—— 进程内、无浏览器、无 spawn。
 *
 * CQ-1 修复:D2 实例 lazy singleton(复用 worker + WASM),避免每次 new 泄漏 OS 线程 + 22MB 堆。
 * 串行队列:D2.sendMessage 用共享 currentResolve/currentReject,并发会竞态(MCP stdio 通常顺序,但保险)。
 */
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

      const compiled = await d2.compile(req.code);

      // CQ-2:theme → themeID(D2 接受数字 ID)
      const themeNum = req.theme != null ? Number(req.theme) : NaN;
      const renderOpts = Number.isFinite(themeNum)
        ? { ...compiled.renderOptions, themeID: themeNum }
        : compiled.renderOptions;

      const svg = await d2.render(compiled.diagram, renderOpts);

      let png: Buffer | undefined;
      if (req.format === "png") {
        const resvg = new Resvg(svg);
        png = Buffer.from(resvg.render().asPng());
      }
      return { svg, png };
    };

    // 串行化:防 D2.sendMessage 并发竞态
    const result = run();
    this.chain = this.chain.then(
      () => result,
      () => result,
    );
    return result as Promise<DiagramRenderOutput>;
  }
}
