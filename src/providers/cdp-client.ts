import WebSocket from "ws";

/**
 * 公共 CDP WebSocket 客户端(gemini-web 抽出,flow 原实现单一真源化)。
 *
 * 从 flow.ts CdpConnection 原样迁移 + 错误参数化:连接期错误(WS error/close)统一带
 * 使用方注入的 launchHint;命令期(超时/发送失败)按原语义不带 hint。
 * 错误工厂由使用方注入(FlowError/GeminiError 各自命名空间),status 字段名经工厂映射
 * (flow 侧 flowStatus,gemini 侧 geminiStatus),本模块零渠道特定语义。
 *
 * 行为契约(与 flow.ts 原实现逐点一致,670 测守护):
 * - 懒连接 + 消息路由(id→pending)+ 单命令超时;连接断开自动失效,下次调用重连
 * - close 时拒绝全部 pending(页面导航/关闭场景)
 */

/** 错误工厂入参(status 经使用方映射为各自前缀的 status 字段;evalTimeout 供瞬态自愈判别)。 */
export interface CdpErrorOpts {
  hint?: string;
  status?: number;
  evalTimeout?: boolean;
}

/** 使用方错误工厂:产出各自命名空间的 S 码错误(FlowError/GeminiError)。 */
export type CdpErrorFactory = (code: string, message: string, opts?: CdpErrorOpts) => Error;

/** CDP WebSocket 客户端:懒连接 + 消息路由 + 超时;连接断开自动失效,下次调用重连。 */
export class CdpConnection {
  private ws: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** 页面导航/关闭导致 WS 断开时,把存活页 URL 记下来供 S103 诊断。 */
  lastCloseReason = "";

  constructor(
    private readonly wsUrl: string,
    private readonly makeError: CdpErrorFactory,
    private readonly launchHint?: string,
  ) {}

  private connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false });
      const onOpenTimeout = setTimeout(() => {
        if (!settled) { settled = true; ws.terminate(); reject(this.makeError("S103", "CDP WebSocket 连接超时")); }
      }, 10_000);
      ws.once("open", () => {
        if (settled) return;
        settled = true; clearTimeout(onOpenTimeout);
        this.ws = ws; resolve();
      });
      ws.once("error", (e: Error) => {
        if (settled) return;
        settled = true; clearTimeout(onOpenTimeout);
        reject(this.makeError("S103", `CDP WebSocket 错误: ${e.message}`, { hint: this.launchHint }));
      });
      ws.once("close", () => {
        this.lastCloseReason = this.lastCloseReason || "closed";
        this.ws = null;
        for (const [, p] of this.pending) p.reject(this.makeError("S103", "CDP 连接已断开(页面可能被导航/关闭)", { hint: this.launchHint, status: 0 }));
        this.pending.clear();
      });
      ws.on("message", (raw: WebSocket.RawData) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m?.id != null && this.pending.has(m.id)) {
            const p = this.pending.get(m.id)!;
            this.pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message ?? "CDP error"));
            else p.resolve(m.result);
          }
        } catch { /* 非 JSON 帧忽略 */ }
      });
    }).finally(() => { this.opening = null; });
    return this.opening;
  }

  /** 原始 CDP 命令(带超时;evaluate/Page.navigate 共用 pending 路由)。 */
  private async send(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    await this.connect();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.makeError("S103", `CDP ${method} 超时(>${Math.round(timeoutMs / 1000)}s)`, { status: 0, ...(method === "Runtime.evaluate" ? { evalTimeout: true } : {}) }));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.ws!.send(JSON.stringify({ id, method, params }));
      } catch (e: any) {
        clearTimeout(timer); this.pending.delete(id);
        reject(this.makeError("S103", `CDP 发送失败: ${e?.message ?? e}`, { status: 0 }));
      }
    });
  }

  async evaluate(expression: string, timeoutMs: number): Promise<unknown> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    return r;
  }

  /**
   * 原始 CDP 命令(公开;gemini-web 用于 Input.insertText 可信输入管道等非 evaluate 命令)。
   * 与 evaluate 同一 pending 路由/超时语义。
   */
  sendCommand(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    return this.send(method, params, timeoutMs);
  }

  /** 导航当前页面(Page.navigate 命令响应在导航发起即返回,不受上下文销毁影响)。 */
  navigate(url: string, timeoutMs = 15_000): Promise<void> {
    return this.send("Page.navigate", { url }, timeoutMs).then(() => undefined);
  }

  /** 重载当前页面(Page.reload;命令 ack 不依赖 JS 上下文存活)。 */
  reloadPage(timeoutMs = 15_000): Promise<void> {
    return this.send("Page.reload", {}, timeoutMs).then(() => undefined);
  }

  /** 立即断开(自愈临时连接用 —— WS 句柄是事件循环引用,不断开会挂住进程;主连接不调用)。 */
  dispose(): void {
    const ws = this.ws;
    this.ws = null;
    this.pending.clear();
    if (ws) { try { ws.terminate(); } catch { /* 已断开 */ } }
  }
}
