import { config } from "../config.js";
import { AgnesProvider } from "./agnes.js";
import { ZhipuProvider } from "./zhipu.js";
import { TesseractProvider } from "./tesseract.js";
import { PaddleocrProvider } from "./paddle.js";
import { VlmProvider } from "./vlm.js";
import { GlmVisionProvider } from "./glm-vision.js";
import type { MediaProvider, ImageProvider, VideoProvider, VisionProvider, VisionTask, Modality } from "./types.js";

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
  tesseract: new TesseractProvider(), // pares5 M1: 进程内 WASM OCR 兜底,零配置
  paddle: new PaddleocrProvider({ // pares5 M2: PaddleX serving REST 全能主力(中文 SOTA+表格+图表+描述)
    baseUrl: config.providers.paddle?.baseUrl,
  }),
  vlm: new VlmProvider({ // pares5 M3: vLLM OpenAI 兼容,describe/analyze-chart 增强 + fallback
    baseUrl: config.providers.vlm?.baseUrl,
    apiKey: config.providers.vlm?.apiKey,
    model: config.providers.vlm?.models?.default,
  }),
  "glm-vision": new GlmVisionProvider({ // pares7: 智谱 GLM-4.6V-Flash 免费视觉层 + paddle 云端 fallback,tier=9
    apiKeys: config.providers["glm-vision"]?.apiKeys,
    apiKey: config.providers["glm-vision"]?.apiKey,
    baseUrl: config.providers["glm-vision"]?.baseUrl,
    model: config.providers["glm-vision"]?.models?.default,
  }),
};

// pares7: glm-vision 多 key 违约警告(智谱 User Agreement §2/§3 禁多账号/共享;Code Plan key 不可用)
{
  const glmKeys = (config.providers["glm-vision"]?.apiKeys ?? []).filter(Boolean);
  if (glmKeys.length > 1) {
    console.warn(
      `[media-gen-mcp] ⚠️ glm-vision 配置了 ${glmKeys.length} 个 api_key(多 key 轮换)。智谱 User Agreement §2/§3 禁止多账号/账号共享,多 key 轮换可能违约(平台有权封号且订阅费不退)。请确认:(1) 所有 key 均为合规自有账号;(2) 非 Code Plan key(Code Plan 限 9 个白名单工具,media-gen-mcp 不在内)。`,
    );
  }
}

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

// ── pares5: 能力组类型守卫(能力断言 + 友好报错,非裸 ! 断言,R-DEP-03 安全)。 ──

/** provider 是否有 vision 能力(实现 VisionProvider 全部必选:recognize + visionTasks + listVisionModels)。 */
export function isVisionProvider(p: MediaProvider): p is MediaProvider & VisionProvider {
  return typeof p.recognize === "function" && typeof p.visionTasks === "function" && typeof p.listVisionModels === "function";
}
/** 窄化为 ImageProvider,无能力时抛清晰错(校验 listImageModels + generateImage)。 */
export function asImageProvider(p: MediaProvider): MediaProvider & ImageProvider {
  if (typeof p.generateImage !== "function" || typeof p.listImageModels !== "function") {
    throw new Error(`provider "${p.name}" 不支持 image 能力(generateImage 或 listImageModels 未实现)。`);
  }
  return p as MediaProvider & ImageProvider;
}
/** 窄化为 VideoProvider,无能力时抛清晰错(校验 VideoProvider 全部必选:5 个方法)。 */
export function asVideoProvider(p: MediaProvider): MediaProvider & VideoProvider {
  if (typeof p.createVideo !== "function" || typeof p.videoConstraints !== "function"
    || typeof p.listVideoModels !== "function" || typeof p.estimateGenerationSeconds !== "function" || typeof p.getVideo !== "function") {
    throw new Error(`provider "${p.name}" 不支持 video 能力(createVideo 或 videoConstraints 或 listVideoModels 或 estimateGenerationSeconds 或 getVideo 未实现)。`);
  }
  return p as MediaProvider & VideoProvider;
}
/** 窄化为 VisionProvider,无能力时抛清晰错。 */
export function asVisionProvider(p: MediaProvider): MediaProvider & VisionProvider {
  if (!isVisionProvider(p)) {
    throw new Error(`provider "${p.name}" 不支持 vision 能力(recognize 或 visionTasks 或 listVisionModels 未实现)。`);
  }
  return p;
}

/** pares5: fallback 能力谈判请求特征(审查 finding:抽类型避免 capableOf/getFallbackProvider 两处重复声明,R-CI-08)。 */
export type FallbackReq = { images?: string[]; image?: string; mode?: string; keyframes?: string[]; task?: VisionTask };

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
  modality: Modality,
): { provider: MediaProvider; autoRouted: boolean; routedFrom?: string } {
  const targetName = name ?? (
    modality === "image" ? config.defaultImageProvider :
    modality === "video" ? config.defaultVideoProvider :
    config.defaultVisionProvider
  );
  const target = getProvider(targetName);
  if (!model) return { provider: target, autoRouted: false };

  const modelsOf = (p: MediaProvider): string[] =>
    modality === "image" ? (p.listImageModels?.() ?? [])
    : modality === "video" ? (p.listVideoModels?.() ?? [])
    : (p.listVisionModels?.() ?? []);
  const owns = (p: MediaProvider) => modelsOf(p).includes(model);

  if (owns(target)) return { provider: target, autoRouted: false };

  const owners = listProviders()
    .filter((n) => n.toLowerCase() !== targetName.toLowerCase())
    .map((n) => ({ name: n, p: getProvider(n) }))
    .filter((x) => owns(x.p));

  if (owners.length === 1) {
    return { provider: owners[0].p, autoRouted: true, routedFrom: targetName };
  }

  const available = modelsOf(target);
  const availStr = available.length ? available.join(", ") : "(无)";
  const modalityLabel = modality === "image" ? "图像" : modality === "video" ? "视频" : "识别";
  if (owners.length === 0) {
    throw new Error(
      `未知模型 "${model}"。provider "${targetName}" 的${modalityLabel}模型可用:${availStr}。调用 list_models 查看全部 provider 的模型。`,
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
    const vc = prov.videoConstraints?.();
    const ic = prov.imageConstraints?.() ?? null;
    const visionOk = isVisionProvider(prov);
    const dv = vc?.defaultNumFrames;
    out[n] = {
      models: prov.listModels(),
      imageModels: prov.listImageModels?.() ?? [],
      videoModels: prov.listVideoModels?.() ?? [],
      visionModels: visionOk ? prov.listVisionModels() : undefined,
      visionTasks: visionOk ? prov.visionTasks() : undefined,
      videoConstraints: vc ?? null,
      imageConstraints: ic,
      imageConstraintsNote: ic ? undefined : "no hard size constraints (provider accepts free size)",
      ...(dv != null && typeof prov.estimateGenerationSeconds === "function"
        ? { estimate_example: `${dv} 帧 → ~${prov.estimateGenerationSeconds(dv)}s 生成` }
        : {}),
    };
  }
  return out;
}

/**
 * pares6: 构造 list_vision_capabilities 的 detail(per-provider 能力矩阵 + per-task 路由)。
 *
 * 对称 `buildListModelsDetail`(导出函数 → handler / 测试 / 诊断同一真值源)。
 *
 * 三方法真值分工(R-CI-08 双声明防护):
 *   - tasks ← visionTasks()
 *   - languages/maxImageBytes ← visionConstraints()
 *   - role/latency/accuracy/perTaskNotes/notes ← describeVisionOptions()
 *   - configured/cooldown/lastErrorAt ← health()
 *   - tier ← tier()
 *
 * 副作用铁律:仅读 health/visionConstraints/describeVisionOptions,零网络/零懒加载 —— 自省无副作用。
 *
 * taskCoverage 排序确定性:configured 优先 → tier 降序 → 注册顺序(tiebreak)。
 */
export function buildVisionCapabilitiesDetail(provider?: string): {
  defaultVisionProvider: string;
  providers: any[];
  taskCoverage: Record<string, string[]>;
  routingGuidance: Record<string, string>;
} {
  const names = provider ? [provider] : listProviders();
  const providers: any[] = [];
  const taskCoverage: Record<string, string[]> = {};

  for (const n of names) {
    const p = getProvider(n);
    if (!isVisionProvider(p)) continue; // 跳过 agnes/zhipu(非 vision)
    const h = p.health?.() ?? { configured: true, cooldown: false };
    const vc = p.visionConstraints?.() ?? {};
    const opt = p.describeVisionOptions?.();
    const tasks = [...p.visionTasks()];

    providers.push({
      name: n,
      configured: h.configured !== false,
      cooldown: h.cooldown === true,
      tier: p.tier?.() ?? 0,
      role: opt?.role,
      tasks,
      languages: vc.languages,
      maxImageBytes: vc.maxImageBytes,
      latencyTier: opt?.latencyTier,
      accuracyTier: opt?.accuracyTier,
      perTaskNotes: opt?.perTaskNotes,
      notes: opt?.notes,
      lastErrorAt: h.lastErrorAt,
    });

    for (const t of tasks) {
      (taskCoverage[t] ??= []).push(n);
    }
  }

  // taskCoverage 排序:configured 优先 → tier 降序 → 注册顺序(确定性 tiebreak)
  for (const t of Object.keys(taskCoverage)) {
    taskCoverage[t].sort((a, b) => {
      const pa = getProvider(a), pb = getProvider(b);
      const ca = pa.health?.().configured !== false ? 1 : 0;
      const cb = pb.health?.().configured !== false ? 1 : 0;
      if (ca !== cb) return cb - ca;
      const ta = pa.tier?.() ?? 0, tb = pb.tier?.() ?? 0;
      if (tb !== ta) return tb - ta;
      return 0; // 注册顺序 = registry 插入顺序(sort 稳定)
    });
  }

  return {
    defaultVisionProvider: config.defaultVisionProvider,
    providers,
    taskCoverage,
    routingGuidance: buildVisionRoutingGuidance(taskCoverage, providers, config.defaultVisionProvider),
  };
}

/**
 * 构造 per-task 路由建议(给 CC 一句话决策)。基于 taskCoverage + provider configured 状态推导,
 * 非硬编码 provider 名(若用户配置变化,建议自动跟随)。
 */
function buildVisionRoutingGuidance(
  taskCoverage: Record<string, string[]>,
  providers: any[],
  defaultVision: string,
): Record<string, string> {
  const guidance: Record<string, string> = {};
  const configuredOf = (task: string) => (taskCoverage[task] ?? []).filter((n) => {
    const p = providers.find((x) => x.name === n);
    return p?.configured !== false;
  });
  const hasPaddle = providers.some((p) => p.name === "paddle" && p.configured !== false);

  for (const task of Object.keys(taskCoverage)) {
    const configured = configuredOf(task);
    if (task === "extract-text") {
      guidance[task] = hasPaddle
        ? `paddle 中文 SOTA 优先(若 configured);否则 ${defaultVision} 兜底`
        : `默认 ${defaultVision}(零配置兜底);中文文档建议配 paddle(accuracyTier=high)`;
    } else if (task === "extract-table") {
      guidance[task] = configured.length
        ? "paddle 支持;已 configured"
        : "仅 paddle 支持;未配置时返回清晰错误,无静默降级到 OCR(请配置 providers.paddle.baseUrl)";
    } else if (task === "analyze-chart") {
      guidance[task] = configured.length
        ? "paddle 主力 + vlm fallback(按 configured 状态)"
        : "需配置 paddle 或 vlm;未配置时返回清晰错误";
    } else if (task === "describe-image") {
      const vlmCfg = providers.some((p) => p.name === "vlm" && p.configured !== false);
      guidance[task] = vlmCfg
        ? "需 question(VQA)用 vlm;paddle 仅默认描述(忽略 question)"
        : "paddle 仅默认描述;完整 VQA(带 question)需配置 vlm provider";
    } else {
      guidance[task] = configured.length
        ? `可用:${configured.join(", ")}`
        : "暂无 configured 的 provider";
    }
  }
  return guidance;
}

/**
 * 能力判断:provider 是否能承接指定模态+模式的请求(pares3 fallback 能力谈判)。
 * 未实现 capabilities() 的 provider 保守返回 false(不承接 fallback)。
 *
 * mode 推断须与 provider createVideo 内部一致(agnes/zhipu 都按 keyframes → image → text 优先级),
 * 否则用户传 image 但不传 mode 时,此处按 text-to-video 误判能力,future t2v-only provider 会咬 i2v。
 */
function capableOf(p: MediaProvider, modality: Modality, req?: FallbackReq): boolean {
  if (modality === "vision") {
    // vision 能力谈判:isVisionProvider + task 在 visionTasks() 内(单一真值源;ProviderCapabilities 不含 vision 字段)
    return isVisionProvider(p) && !!req?.task && p.visionTasks().includes(req.task);
  }
  const cap = p.capabilities?.();
  if (!cap) return false;
  if (modality === "image") {
    return req?.images?.length ? cap.image.imageToImage : cap.image.textToImage;
  }
  // video
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
export function getFallbackProvider(currentName: string, modality: Modality, req?: FallbackReq): MediaProvider | undefined {
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
