import { config } from "../config.js";
import { AgnesProvider } from "./agnes.js";
import { ZhipuProvider } from "./zhipu.js";
import { TesseractProvider } from "./tesseract.js";
import { PaddleocrProvider } from "./paddle.js";
import { VlmProvider } from "./vlm.js";
import { GlmVisionProvider } from "./glm-vision.js";
import { FlowProvider } from "./flow.js";
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
    // pares7: extra_body 显式注入(review fix high 架构 R-DEP-03:对齐 agnes/zhipu/glm-vision 的
    // 「provider 配置统一由 registry 注入」约定,移除 vlm.ts 构造器直读全局 config 的 fallback 通道)。
    extra_body: config.providers.vlm?.extraBody,
  }),
  "glm-vision": new GlmVisionProvider({ // pares7: 智谱 GLM-4.6V-Flash 免费视觉层 + paddle 云端 fallback,tier=9
    apiKeys: config.providers["glm-vision"]?.apiKeys,
    apiKey: config.providers["glm-vision"]?.apiKey,
    baseUrl: config.providers["glm-vision"]?.baseUrl,
    model: config.providers["glm-vision"]?.models?.default,
  }),
  flow: new FlowProvider({ // Google Flow(经本机 Chrome CDP 页面上下文;契约 doc/flow-api-contract.md)。
    // 渠道准入(C 任务):flow 实现 capabilities()(能力事实)+ requiresOptIn()=true(准入策略)——
    // 未显式同意(provider/model 点名或 <modality>ProviderPriority 列入)时不进任何隐式 fallback 链
    // (取代旧门禁「不实现 capabilities」,见 types.ts MediaProviderBase.requiresOptIn)。
    // 无默认视频模型:提交视频消耗积分,必须显式指定(或 config providers.flow.models.video.default)。
    cdpPort: config.providers.flow?.settings?.cdpPort,
    projectId: config.providers.flow?.settings?.projectId,
    models: config.providers.flow?.models,
  }),
};

// pares7: glm-vision 多 key 违约警告(智谱 User Agreement §2/§3 禁多账号/共享;Code Plan key 不可用)
{
  // 去重计数(对齐 KeyPool 构造函数 Set 去重,review:免 [k1,k1] 误报)
  const glmKeys = [...new Set((config.providers["glm-vision"]?.apiKeys ?? []).filter(Boolean))];
  if (glmKeys.length > 1) {
    console.warn(
      `[media-gen-mcp] ⚠️ glm-vision 配置了 ${glmKeys.length} 个不重复 api_key(多 key 轮换)。智谱 User Agreement §2/§3 禁止多账号/账号共享,多 key 轮换可能违约(平台有权封号且订阅费不退)。请确认:(1) 所有 key 均为合规自有账号;(2) 非 Code Plan key(Code Plan 限 9 个白名单工具,media-gen-mcp 不在内)。`,
    );
  }
}

// ── C 任务:渠道优先级链(config 解析 + 测试注入缝)。 ──

/** 测试注入缝:非 null 覆盖 config(隔离 ~/.media-gen-mcp/config.json 差异,保 CI 确定性)。仅供测试消费。 */
export const __priorityOverrideForTests: { image?: string[] | null; video?: string[] | null } = {};

/** 未知 provider 名的优先级项剔除时的告警(每模态至多一次,防刷屏)。 */
const warnedUnknownPriority = new Set<string>();

/**
 * per-modality 优先级链(config.imageProviderPriority / videoProviderPriority,已小写/去重)。
 * 校验:未知 provider 名剔除 + warn(不 fatal —— 配置错误不该杀死 server);已知但不具备该模态
 * 能力的项保留(list 头选择与 fallback 排序各自再按能力过滤)。未配置 = undefined(现行为)。
 */
export function getProviderPriority(modality: "image" | "video"): string[] | undefined {
  const override = __priorityOverrideForTests[modality];
  const raw = override !== undefined
    ? (override ?? undefined)
    : (modality === "image" ? config.imageProviderPriority : config.videoProviderPriority);
  if (!raw?.length) return undefined;
  const valid = raw.filter((n) => {
    const ok = Object.prototype.hasOwnProperty.call(registry, n);
    if (!ok && !warnedUnknownPriority.has(`${modality}:${n}`)) {
      warnedUnknownPriority.add(`${modality}:${n}`);
      console.warn(`[media-gen-mcp] ⚠️ ${modality}ProviderPriority 中的 "${n}" 不是已注册 provider,已忽略。Available: ${Object.keys(registry).join(", ")}`);
    }
    return ok;
  });
  return valid.length ? valid : undefined;
}

/** provider 是否具备模态方法组(头选择用;窄化守卫 as*Provider 的宽松前置)。 */
function hasModality(p: MediaProvider, modality: "image" | "video"): boolean {
  return modality === "image"
    ? typeof p.generateImage === "function" && typeof p.listImageModels === "function"
    : typeof p.createVideo === "function" && typeof p.videoConstraints === "function" && typeof p.listVideoModels === "function";
}

// C 任务:videoProviderPriority 显式列入 flow = 用户知情同意付费档,启动时强提示(积分红线)。
{
  const vPrio = config.videoProviderPriority;
  if (vPrio?.includes("flow")) {
    console.warn(
      `[media-gen-mcp] ⚠️ videoProviderPriority 包含 "flow":Flow 视频消耗积分(abra 7-20 / veo 10-100 点每条)。仅当你在 config.json 显式如此配置时才会走到该链;未列入时 flow 视频只能显式 provider=flow 调用。`,
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
 *
 * C 任务:未显式指定 provider 且配置了 <modality>ProviderPriority 时,链头 = 优先级链上
 * 首个「具备该模态能力且不在 60s 熔断窗口」的成员(惰性:不主动探测,只读本地 health);
 * 链全熔断/全无能力 → 落回 legacy 默认(defaultXxxProvider)。未配置 priority = 现行为零漂移。
 */
export function resolveProvider(
  name: string | undefined,
  model: string | undefined,
  modality: Modality,
): { provider: MediaProvider; autoRouted: boolean; routedFrom?: string } {
  const targetName = name ?? defaultHead(modality);
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
 * C 任务:模态默认链头。priority 链存在时 = 链上首个「有该模态能力 && 非熔断」成员;
 * 否则 = legacy 默认。只读本地状态(health/cooldown),零网络零探测 —— 探测只发生在
 * 「轮到该 provider 真正尝试」时(provider 自身 ensureReady,30s 正缓存),满足惰性化约束。
 */
function defaultHead(modality: Modality): string {
  if (modality === "image" || modality === "video") {
    const prio = getProviderPriority(modality);
    if (prio?.length) {
      for (const n of prio) {
        const p = registry[n];
        if (!p || !hasModality(p, modality)) continue;
        if (p.health?.().cooldown === true) continue; // 60s 熔断窗口内跳过(链自动降级)
        return n;
      }
    }
  }
  return modality === "image" ? config.defaultImageProvider :
    modality === "video" ? config.defaultVideoProvider :
    config.defaultVisionProvider;
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
  const tierOf = (n: string) => providers.find((p) => p.name === n)?.tier ?? 0;
  const configuredOf = (task: string) => (taskCoverage[task] ?? []).filter((n) => {
    const p = providers.find((x) => x.name === n);
    return p?.configured !== false;
  });

  for (const task of Object.keys(taskCoverage)) {
    const all = taskCoverage[task] ?? [];
    const cfg = configuredOf(task);
    // defaultVision(默认 tesseract)只在它真支持该 task 时才作兜底/默认 ——
    // 否则会误导(如 extract-table/describe-image/analyze-chart,tesseract 不支持,
    // 却出现在这些 task 的链里/被当默认)。实测(gapfillers 场景)暴露的既有瑕疵,此处修。
    const defaultSupportsTask = all.includes(defaultVision);
    if (cfg.length === 0) {
      // 无 configured:候选列 +(若 defaultVision 支持该 task)默认兜底
      guidance[task] = defaultSupportsTask
        ? `未配置 provider(候选:${all.join("/")});默认走 ${defaultVision}(零配置兜底)`
        : `未配置 provider(候选:${all.join("/")});该 task 无零配置兜底,需配候选之一`;
    } else {
      // 按 tier 降序列 configured(fallback 链顺序)—— glm-vision/paddle/vlm 全自动包含,不再硬编码
      const ordered = cfg.slice().sort((a, b) => tierOf(b) - tierOf(a));
      const tail = ordered.includes(defaultVision) || !defaultSupportsTask
        ? ""
        : ` → ${defaultVision}(兜底)`;
      guidance[task] = `fallback 链:${ordered.join(" → ")}${tail}`;
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
 * Provider 自动 Fallback(pares3;C 任务统一进优先级机制):当前 provider 不可用时,找下一个候选承接。
 *
 * 候选过滤(vision 模态不受 priority 影响,保持 pares5 语义):
 *   - 排除 currentName
 *   - configured 过滤对「priority 链内成员」豁免(optIn provider 如 flow 首次探测前 configured=false,
 *     显式列入即视为已同意,允许被尝试 —— 探测由尝试本身惰性触发)
 *   - cooldown 过滤(60s 熔断窗口内跳过,notifyUnavailable 置位)
 *   - capableOf 能力矩阵(capabilities() 事实声明)
 *   - 渠道准入:requiresOptIn(modality) 的 provider 仅在显式列入 priority 链时放行
 *     (默认 = 旧「不实现 capabilities()」门禁的等价物:flow 永不进隐式免费链)
 *
 * 排序(单一管线,优先级与 fallback 两机制在此统一):
 *   1. priority 链内按 list 位置升序(用户的偏好序)
 *   2. 链外成员按 tier 降序(legacy 免费链行为,未配置时全走此序 → 零回归)
 */
export function getFallbackProvider(currentName: string, modality: Modality, req?: FallbackReq): MediaProvider | undefined {
  const prio = modality === "image" || modality === "video" ? getProviderPriority(modality) : undefined;
  const pos = (n: string) => {
    const i = prio?.indexOf(n.toLowerCase()) ?? -1;
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const inPriority = (n: string) => prio?.includes(n.toLowerCase()) === true;
  const candidates = listProviders()
    .filter((n) => n.toLowerCase() !== currentName.toLowerCase())
    .map((n) => getProvider(n))
    .filter((p) => p.health?.().configured !== false || inPriority(p.name))
    .filter((p) => p.health?.().cooldown !== true)
    .filter((p) => capableOf(p, modality, req))
    .filter((p) => !p.requiresOptIn?.(modality) || inPriority(p.name));
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => (pos(a.name) - pos(b.name)) || ((b.tier?.() ?? 0) - (a.tier?.() ?? 0)));
  return candidates[0];
}
