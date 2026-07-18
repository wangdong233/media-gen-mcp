import { config } from "../config.js";
import { AgnesProvider } from "./agnes.js";
import { ZhipuProvider } from "./zhipu.js";
import type { MediaProvider, ProviderCapabilities } from "./types.js";

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

/**
 * 能力判断:provider 是否能承接指定模态+模式的请求(pares3 fallback 能力谈判)。
 * 未实现 capabilities() 的 provider 保守返回 false(不承接 fallback)。
 *
 * mode 推断须与 provider createVideo 内部一致(agnes/zhipu 都按 keyframes → image → text 优先级),
 * 否则用户传 image 但不传 mode 时,此处按 text-to-video 误判能力,future t2v-only provider 会咬 i2v。
 */
function capableOf(
  p: MediaProvider,
  modality: "image" | "video",
  req?: { images?: string[]; image?: string; mode?: string; keyframes?: string[] },
): boolean {
  const cap = p.capabilities?.();
  if (!cap) return false;
  if (modality === "image") {
    return req?.images?.length ? cap.image.imageToImage : cap.image.textToImage;
  }
  const mode = req?.mode ??
    (req?.keyframes?.length ? "keyframes" : req?.image ? "image-to-video" : "text-to-video");
  if (mode === "text-to-video") return cap.video.textToVideo;
  if (mode === "image-to-video") return cap.video.imageToVideo;
  if (mode === "keyframes") return cap.video.keyframes;
  return false;
}

/**
 * 免费 Provider 自动 Fallback(pares3):当前 provider 不可用时,找另一个免费 provider 承接。
 * 排除 currentName → 按 health(configured & !cooldown) + capableOf 能力矩阵过滤 → 按 tier 降序。
 * 返回 undefined 表示无可用 fallback(两家都挂/无能力承接)。
 */
export function getFallbackProvider(
  currentName: string,
  modality: "image" | "video",
  req?: { images?: string[]; image?: string; mode?: string; keyframes?: string[] },
): MediaProvider | undefined {
  const candidates = listProviders()
    .filter((n) => n.toLowerCase() !== currentName.toLowerCase())
    .map((n) => getProvider(n))
    .filter((p) => p.health?.().configured !== false)
    .filter((p) => p.health?.().cooldown !== true)
    .filter((p) => capableOf(p, modality, req));
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => (b.tier?.() ?? 0) - (a.tier?.() ?? 0));
  return candidates[0];
}
