import { config } from "../config.js";
import { AgnesProvider } from "./agnes.js";
import { ZhipuProvider } from "./zhipu.js";
import { TesseractProvider } from "./tesseract.js";
import { PaddleocrProvider } from "./paddle.js";
import { VlmProvider } from "./vlm.js";
import { GlmVisionProvider } from "./glm-vision.js";
import { FlowProvider, FLOW_MNEMONIC_RE } from "./flow.js";
import { PixverseProvider } from "./pixverse.js";
import { GeminiWebProvider } from "./gemini-web.js";
import { SiliconflowProvider } from "./siliconflow.js";
import { PixaiProvider } from "./pixai.js";
import { CloudflareProvider } from "./cloudflare.js";
import { ImagineartProvider } from "./imagineart.js";
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
    projectId: config.providers.flow?.settings?.projectId ?? process.env.MEDIA_GEN_FLOW_PROJECT_ID, // env 通道:消费方(如 AIGC 产线脚本)可显式钉死项目,优先级最高
    models: config.providers.flow?.models,
    // 顶级 flow 段引用:toolDeadlineMs = 长操作防 stall 截止;videoConfirm/confirmTtlMs = 计费确认门。
    // 传对象引用供测试 live 修改。(原 enabled/S000 硬门已删,链即开关。)
    flowCfg: config.flow,
  }),
  pixverse: new PixverseProvider({ // PixVerse 订阅池(spawn 官方 CLI --json;契约 doc/PixVerse-provider集成.md)。
    // 渠道准入(对齐 flow):requiresOptIn()=true —— pixverse 消耗订阅积分(09-14 终局裁决:CLI 无
    // Relax 免费池,Standard 无免费白名单),未显式同意(点名或 priority 链列入)不进任何隐式链。
    // 🔴 全模式计费确认门(image/video 一律两段式 confirmToken)+ CLI 版本锁(optionalDependencies
    // 精确锁 1.4.3,禁裸 npx)+ 成本账本(~/.media-gen-mcp/pixverse-cost-ledger.json,命中优先于静态首估)。
    bin: process.env.PIXVERSE_BIN || config.providers.pixverse?.settings?.bin,
    models: config.providers.pixverse?.models,
    pixverseCfg: config.pixverse,
  }),
  siliconflow: new SiliconflowProvider({ // 硅基流动(渠道工厂飞轮 v2 #1,2026-09-23 GO;Kolors 免费+代金券付费线)。
    // requiresOptIn=true(池含付费模型;Kolors 免费但实名门槛)—— 点名即用;真机门需用户注册配 key。
    apiKey: config.providers.siliconflow?.apiKey ?? process.env.SILICONFLOW_API_KEY,
    baseUrl: config.providers.siliconflow?.baseUrl,
  }),
  pixai: new PixaiProvider({ // PixAI(渠道工厂飞轮轮 7 GO,2026-09-23;动漫垂直,模式 B:免费积分跟账号走)。
    // requiresOptIn=true —— 凭证三选一:apiKey(官方 REST v2,计费未公开)/token(GraphQL 免费通道,
    // DevTools 手动取)/email+password(recaptcha 自动登录,脆弱逆向)。10,000 积分/日≈12 张 Standard。
    apiKey: config.providers.pixai?.apiKey ?? process.env.PIXAI_API_KEY,
    token: config.providers.pixai?.token ?? process.env.PIXAI_TOKEN,
    email: config.providers.pixai?.email ?? process.env.PIXAI_EMAIL,
    password: config.providers.pixai?.password ?? process.env.PIXAI_PASSWORD,
    baseUrl: config.providers.pixai?.baseUrl,
  }),
  cloudflare: new CloudflareProvider({ // Cloudflare Workers AI(渠道工厂飞轮轮 12 GO,2026-09-23;C 类:image-only)。
    // requiresOptIn=true —— 10,000 neurons/天全账号续杯(Workers Paid 超额自动计费,需档位警示);
    // flux-2 多参考编辑 REST 直达;SDXL 双 $0 Beta。凭证 = API Token + Account ID 双必需。
    apiToken: config.providers.cloudflare?.apiToken ?? config.providers.cloudflare?.apiKey ?? process.env.CLOUDFLARE_API_TOKEN,
    accountId: config.providers.cloudflare?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
    baseUrl: config.providers.cloudflare?.baseUrl,
  }),
  imagineart: new ImagineartProvider({ // ImagineArt(渠道工厂飞轮轮 13 GO,2026-09-23;官方 MCP 同池免费 100 credits/日)。
    // requiresOptIn=true —— spawn 官方 CLI(PixVerse 先例,版本锁 0.10.0);免费产出限非商用。
    // 凭证:一次性 `login --no-browser`(~/.imagine-mcp/)或 config providers.imagineart.token(env 正道)。
    token: config.providers.imagineart?.token ?? process.env.IMAGINE_MCP_TOKEN,
  }),
  gemini: new GeminiWebProvider({ // Gemini 网页渠道(CDP UI 驱动;调研 doc/Gemini渠道调研-2026-09-22.md)。
    // 渠道准入(对齐 flow/pixverse):requiresOptIn()=true —— Google AI 订阅算力配额制(视频消耗
    // 显著,实测单条 ≈15-20% 5h 窗口)+ 本机 Chrome 路由隐私边界;未显式同意不进任何隐式链。
    // 端口参数化(lasso browse 通道硬编码 9222 教训):providers.gemini.cdpPort / GEMINI_CDP_PORT。
    cdpPort: (() => {
      const raw = process.env.GEMINI_CDP_PORT;
      if (raw != null && raw !== "") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
          console.warn(`[media-gen-mcp] ⚠️ GEMINI_CDP_PORT="${raw}" 非法(须为正整数端口),已忽略并回落 config/默认 9225。`);
          return undefined;
        }
        return n;
      }
      return config.providers.gemini?.settings?.cdpPort;
    })(),
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

// ── 渠道路由(0.22.0 起:优先级链已废弃)。 ──
//
// 2026-09-23 用户裁决 + 深度分析定谳:渠道选择是「调用时点」的业务决策(免费试稿 → 付费定稿),
// 静态优先级链(装机时点决策)表达不了任务内变化,且链头为计费渠道时产生确认门摩擦。
// 新契约:
//   - provider 缺省 = 免费池(agnes → zhipu 容灾互备,硬编码,不可配);
//   - opt-in 渠道(gemini/pixverse/flow)点名即用 —— 费用安全由计费确认门(pixverse/flow
//     两段式 confirmToken)与配额警示(gemini)兜底,不再依赖「链内列入=知情同意」;
//   - config 的 *ProviderPriority / MEDIA_*_PROVIDER_PRIORITY 读到即废弃警告并忽略(config.ts 发警告)。
// 保留的函数签名仅为消费方(index.ts/check-schema)兼容,行为恒「无链」。

/** 测试注入缝(0.22.0 起无效,保留导出面兼容既有 import;链语义测试已改写为「配置无效」断言)。 */
export const __priorityOverrideForTests: { image?: string[] | null; video?: string[] | null } = {};

/** 优先级链原始值(已废弃):恒 undefined。 */
export function getRawProviderPriority(_modality: "image" | "video"): string[] | undefined {
  return undefined;
}

/** 优先级链(已废弃):恒 undefined。provider 缺省 = defaultXxxProvider(免费池头)。 */
export function getProviderPriority(_modality: "image" | "video"): string[] | undefined {
  return undefined;
}

export function getProvider(name?: string): MediaProvider {
  const n = (name ?? config.defaultProvider).toLowerCase();
  // 0.22.0 通用渠道禁用(config.disabledProviders;默认 ["flow"] 死域):路由层单点结构性拒绝,
  // 零网络零 CDP 动作 —— 显式点名/模型归属路由/自省全路径共用此闸。
  if ((config.disabledProviders ?? []).includes(n)) {
    const dead = n === "flow" ? "(Google Flow 2026-09-10 起 L3 账号地区门禁死域,默认禁用)" : "";
    throw new Error(
      `Provider "${n}" 已被禁用 ${dead}。替代渠道:图像 → agnes/zhipu(免费)或 gemini/pixverse(点名);视频 → agnes/zhipu(免费)或 gemini(Omni)/pixverse(点名)。如需解禁/调整,改 config.json 的 disabledProviders(默认 ["flow"];写 [] 解禁全部)。`,
    );
  }
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
 *
 * 注:原 S000 硬门(disabledReason 拦截显式点名)已于 2026-08-26 删除 —— 链即开关:
 * 不配置进链 = 不自动路由;显式点名永远合法,环境不可用由 provider 前置检测结构化报告。
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
  // flow 助记视频 key(abra_t2v + durationSeconds → flow.ts resolveVideoModelKey 解析完整 key)
  // 归 flow 命名空间:归属校验不得在到达助记解析之前把文档化的调用形态拦下(schema model 描述
  // 承诺 "or mnemonic+durationSeconds (abra_t2v + 8)")。正则与 resolveVideoModelKey 同一约定。
  const isFlowMnemonic = modality === "video" && FLOW_MNEMONIC_RE.test(model); // 同 flow.ts resolveVideoModelKey 真源
  const owns = (p: MediaProvider) => modelsOf(p).includes(model) || (isFlowMnemonic && p.name === "flow");

  if (owns(target)) return { provider: target, autoRouted: false };

  const disabledSet = new Set(config.disabledProviders ?? []);
  const owners = listProviders()
    .filter((n) => !disabledSet.has(n.toLowerCase())) // 禁用渠道不参与模型归属(死渠道模型无归属,显式点名在 getProvider 拦截)
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
  // 0.22.0:链已废弃,缺省 = legacy 默认(免费池头 agnes;defaultXxxProvider 仍可配)。
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
  const disabledSet = new Set(config.disabledProviders ?? []);
  const out: Record<string, any> = {};
  for (const n of names) {
    if (disabledSet.has(n.toLowerCase())) {
      // 禁用渠道:诚实可见但不可用(零方法组;点名单查也返回禁用条目而非抛,自省工具语义)。
      // channelInfo 说明卡仍附上(死域原因/解禁法对调用方有信息价值;经内部表直取,不走 getProvider 拦截)。
      const ci = typeof registry[n].channelInfo === "function" ? registry[n].channelInfo!() : undefined;
      out[n] = { disabled: true, note: "渠道已禁用(disabledProviders);模型清单不可用,调用一律被路由层拒绝", ...(ci ? { channelInfo: ci } : {}) };
      continue;
    }
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
      ...(typeof prov.costCatalog === "function" ? { costCatalog: prov.costCatalog() } : {}),
      ...(typeof prov.channelInfo === "function" ? { channelInfo: prov.channelInfo() } : {}),
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
  const disabledSet = new Set(config.disabledProviders ?? []);
  const providers: any[] = [];
  const taskCoverage: Record<string, string[]> = {};

  for (const n of names) {
    if (disabledSet.has(n.toLowerCase())) continue; // 禁用渠道零实例化(与 buildListModelsDetail 同语义;P1-1 修复)
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
 * 候选过滤(vision 模态不受影响,保持 pares5 语义):
 *   - 排除 currentName
 *   - configured 过滤(免费渠道 agnes/zhipu 恒 configured)
 *   - cooldown 过滤(60s 熔断窗口内跳过,notifyUnavailable 置位)
 *   - capableOf 能力矩阵(capabilities() 事实声明)
 *   - 渠道准入:requiresOptIn(modality) 的 provider 永不放行(opt-in 渠道只能显式点名,
 *     0.22.0 起无链豁免通道 —— 语义比链时代更严:隐式路径永远免费)
 *
 * 排序(0.22.0:priority 链已废弃,只剩 tier 降序 —— 免费池内 agnes/zhipu 序):
 */
export function getFallbackProvider(currentName: string, modality: Modality, req?: FallbackReq): MediaProvider | undefined {
  // 0.22.0:链已废弃 —— 候选 = 非禁用 + 非 current + configured + 非熔断 + 能力胜任 + 非 optIn
  // (optIn 永不承接隐式回落,无链豁免通道);排序 = tier 降序(免费池内 agnes/zhipu 序)。
  const disabled = new Set(config.disabledProviders ?? []);
  const candidates = listProviders()
    .filter((n) => !disabled.has(n.toLowerCase()))
    .filter((n) => n.toLowerCase() !== currentName.toLowerCase())
    .map((n) => getProvider(n))
    .filter((p) => p.health?.().configured !== false)
    .filter((p) => p.health?.().cooldown !== true)
    .filter((p) => capableOf(p, modality, req))
    .filter((p) => p.requiresOptIn?.(modality) !== true);
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => (b.tier?.() ?? 0) - (a.tier?.() ?? 0));
  return candidates[0];
}
