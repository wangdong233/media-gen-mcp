// src/providers/key-pool.ts
/**
 * 多 key 轮换池(横切通用模块,R-CI-02 单一真源)。
 *
 * 供 glm-vision(智谱)/ vlm / paddle 等需要多 key 的 provider 共用。当前仅 glm-vision 消费,
 * 但独立文件 + 无 provider 类型参数,未来 vlm/paddle 多 key 场景零改动接入(R-CI-02)。
 *
 * 状态机三态(pares7 智谱视觉整合 + review conditions):
 *   live → cooling(markLimited,cooldownUntil 过后由 acquire 自动恢复 live)
 *   live → exhausted(markExhausted,永久禁用 —— 额度耗尽/key 失效)
 *
 * 并发安全(review high):Node 单线程,markLimited/markExhausted **纯同步无 await**,
 * 收到限额立即标状态,下一 acquire 同步代码立即跳过(同步块天然原子)。
 * 允许短暂并发同 key(乐观策略),失败后 markLimited 后续自动切,无需 Promise 队列串行化。
 *
 * 退化:keys 为空 → acquire() 返 undefined;单元素 → 单 key no-op(失败即不可用)。
 *
 * 合规(智谱 ToS):KeyPool 是通用机制,不感知 key 来源/品牌。多账号/key 轮换的 ToS 违约风险
 * 在 provider/registry 层 warning(见 glm-vision 注册),不在本模块判定。
 */
export type KeyState = "live" | "cooling" | "exhausted";

export interface KeyEntry {
  key: string;
  status: KeyState;
  /** 冷却到期时间戳(ms);0 = 无冷却。cooling 态据此自动恢复。 */
  cooldownUntil: number;
  /** 最后一次 acquire 时刻(ms);0 = 未用过。LRU tiebreak 用。 */
  lastUsedAt: number;
}

export interface KeyPoolHealth {
  total: number;
  live: number;
  cooling: number;
  exhausted: number;
}

export interface KeyPoolOptions {
  /** 限额冷却默认时长(ms),markLimited 未传时用。默认 60_000(对齐 zhipu.ts cooldown)。 */
  defaultCooldownMs?: number;
}

export class KeyPool {
  private entries: KeyEntry[] = [];
  private rrIndex = 0;
  private readonly defaultCooldownMs: number;

  constructor(keys: string[] | undefined, opts: KeyPoolOptions = {}) {
    this.defaultCooldownMs = opts.defaultCooldownMs ?? 60_000;
    const seen = new Set<string>();
    for (const k of keys ?? []) {
      const key = (k ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // 冷启动(review medium):全 live,cooldownUntil/lastUsedAt = 0
      this.entries.push({ key, status: "live", cooldownUntil: 0, lastUsedAt: 0 });
    }
  }

  /** 是否启用轮换(>1 个 key)。单 key 或空 → false(no-op 模式,调用方走单 key 直连)。 */
  get enabled(): boolean {
    return this.entries.length > 1;
  }

  /** key 总数(去重后)。 */
  get size(): number {
    return this.entries.length;
  }

  /**
   * 选一个可用 key:round-robin 跳过 cooling(未过期)/exhausted;
   * 过期 cooling 自动恢复 live。全不可用(全 cooling/全 exhausted)→ 返 undefined
   * (调用方 throw isFallbackWorthy 错误,让 provider 级 fallback 接管,review medium)。
   * 同步,无 await(并发安全)。
   */
  acquire(): string | undefined {
    if (this.entries.length === 0) return undefined;
    const now = Date.now();
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.rrIndex + i) % this.entries.length;
      const e = this.entries[idx];
      if (this.isAvailable(e, now)) {
        this.rrIndex = (idx + 1) % this.entries.length;
        e.lastUsedAt = now;
        return e.key;
      }
    }
    return undefined;
  }

  /** 状态谓词 + 过期 cooling 自动恢复。 */
  private isAvailable(e: KeyEntry, now: number): boolean {
    if (e.status === "exhausted") return false;
    if (e.status === "cooling") {
      if (e.cooldownUntil > now) return false;
      e.status = "live"; // 冷却到期自动恢复
      e.cooldownUntil = 0;
    }
    return true;
  }

  /** 标限额冷却(瞬态 429/1302 等)。纯同步,无 await。 */
  markLimited(key: string, cooldownMs?: number): void {
    const e = this.find(key);
    if (!e) return;
    e.status = "cooling";
    e.cooldownUntil = Date.now() + (cooldownMs ?? this.defaultCooldownMs);
  }

  /** 标永久耗尽(额度耗尽/key 失效/套餐不含模型)。纯同步。 */
  markExhausted(key: string): void {
    const e = this.find(key);
    if (!e) return;
    e.status = "exhausted";
    e.cooldownUntil = 0;
  }

  /** 全部 key 是否都已不可用(全 cooling 未过期 / 全 exhausted)。 */
  allUnavailable(): boolean {
    const now = Date.now();
    return this.entries.every((e) => !this.isAvailable(e, now));
  }

  /** 健康摘要(只计数,不输出 key 值 —— 防 key 泄露到日志)。 */
  health(): KeyPoolHealth {
    const now = Date.now();
    let live = 0, cooling = 0, exhausted = 0;
    for (const e of this.entries) {
      this.isAvailable(e, now); // 触发自动恢复
      if (e.status === "live") live++;
      else if (e.status === "cooling") cooling++;
      else exhausted++;
    }
    return { total: this.entries.length, live, cooling, exhausted };
  }

  private find(key: string): KeyEntry | undefined {
    return this.entries.find((e) => e.key === key);
  }
}
