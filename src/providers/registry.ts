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

/**
 * 按 (provider?, model?, modality) 解析 provider,做 model↔provider 校验 + 自动路由。
 * - model 属于 target → 返回 target
 * - model 不属于 target,但唯一属于另一个 provider → 自动路由到拥有者(autoRouted=true)
 * - model 不属于任何 provider → 友好报错(列 target 可用模型,提示 list_models)
 * - model 属于多个其他 provider → 友好报错(提示显式指定)
 *
 * 消除"cogview-4 配 agnes → 503 No available channel"这类不透明错误,
 * 把 model→provider 的映射知识前置到工具层,不依赖调用方(CC)试错。
 */
export function resolveProvider(
  name: string | undefined,
  model: string | undefined,
  modality: "image" | "video",
): { provider: MediaProvider; autoRouted: boolean; routedFrom?: string } {
  const targetName = name ?? (modality === "image" ? config.defaultImageProvider : config.defaultVideoProvider);
  const target = getProvider(targetName);
  if (!model) return { provider: target, autoRouted: false };

  const owns = (p: MediaProvider) =>
    (modality === "image" ? p.listImageModels() : p.listVideoModels()).includes(model);

  if (owns(target)) return { provider: target, autoRouted: false };

  const owners = listProviders()
    .filter((n) => n.toLowerCase() !== targetName.toLowerCase())
    .map((n) => ({ name: n, p: getProvider(n) }))
    .filter((x) => owns(x.p));

  if (owners.length === 1) {
    return { provider: owners[0].p, autoRouted: true, routedFrom: targetName };
  }

  const available = modality === "image" ? target.listImageModels() : target.listVideoModels();
  const availStr = available.length ? available.join(", ") : "(无)";
  if (owners.length === 0) {
    throw new Error(
      `未知模型 "${model}"。provider "${targetName}" 的${modality === "image" ? "图像" : "视频"}模型可用:${availStr}。调用 list_models 查看全部 provider 的模型。`,
    );
  }
  throw new Error(
    `model "${model}" 不属于 provider "${targetName}",且同时属于多个 provider:${owners.map((o) => o.name).join(", ")}。请显式指定 provider。`,
  );
}

/**
 * 构造 list_models 的 detail(模型清单 + 视频/图像约束 + 生成预估)。
 * 抽成导出函数:handler 与任何诊断/测试脚本调用同一函数 → 从结构上保证复现与工具输出逐字段一致,
 * 根除"脚本绕过 handler 漏字段/手搓文案"类问题(T14 根因)。
 */
export function buildListModelsDetail(provider?: string): Record<string, any> {
  const names = provider ? [provider] : listProviders();
  const out: Record<string, any> = {};
  for (const n of names) {
    const prov = getProvider(n);
    const dv = prov.videoConstraints().defaultNumFrames;
    const ic = prov.imageConstraints?.() ?? null;
    out[n] = {
      models: prov.listModels(),
      imageModels: prov.listImageModels(),
      videoModels: prov.listVideoModels(),
      videoConstraints: prov.videoConstraints(),
      imageConstraints: ic,
      imageConstraintsNote: ic ? undefined : "no hard size constraints (provider accepts free size)",
      estimate_example: `${dv} 帧 → ~${prov.estimateGenerationSeconds(dv)}s 生成`,
    };
  }
  return out;
}
