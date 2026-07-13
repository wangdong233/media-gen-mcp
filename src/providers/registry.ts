import { config } from "../config.js";
import { AgnesProvider } from "./agnes.js";
import { ZhipuProvider } from "./zhipu.js";
import type { MediaProvider } from "./types.js";

/**
 * Provider 注册表。新增 provider 时:
 *   1. 实现 MediaProvider(参考 agnes.ts)
 *   2. 在此 import 并加入 registry
 *   3. 在 config.ts 加该 provider 的连接配置
 * 工具层与 CC 接入零改动。
 */
const registry: Record<string, MediaProvider> = {
  agnes: new AgnesProvider({
    ...(config.providers.agnes ?? {}),
    rateLimitTtlMs: config.rateLimitTtlMs,
  }),
  zhipu: new ZhipuProvider({
    ...(config.providers.zhipu ?? {}),
    rateLimitTtlMs: config.rateLimitTtlMs,
  }),
};

export function getProvider(name?: string): MediaProvider {
  const n = (name ?? config.defaultProvider).toLowerCase();
  const p = registry[n];
  if (!p) {
    throw new Error(
      `Unknown provider "${n}". Available: ${Object.keys(registry).join(", ")}.`,
    );
  }
  return p;
}

export function listProviders(): string[] {
  return Object.keys(registry);
}
