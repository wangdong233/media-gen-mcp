import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 配置文件:`~/.media-gen-mcp/config.json`(home 全局)。
 * npm 发布 + npx 运行时,包在 npm 缓存(__dirname 不可写/不持久),配置必须在用户 home。
 * 本地 node 开发同样读 home(一致)。
 *
 * 优先级:config.json > 环境变量 > 默认值。
 *
 * MEDIA_GEN_MCP_CONFIG env 可覆盖配置文件路径(测试注入缝,隔离本机 config 差异;
 * 吸收自 flow-mcp 的 FLOW_MCP_CONFIG 同机制)。
 */
export const CONFIG_FILE = process.env.MEDIA_GEN_MCP_CONFIG || path.join(os.homedir(), ".media-gen-mcp", "config.json");

function loadUserConfig(): Record<string, any> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch (e: any) {
    console.error(
      `[media-gen-mcp] 配置文件 ${CONFIG_FILE} 解析失败(${e?.message}),改用环境变量/默认值`,
    );
  }
  return {};
}

const userCfg = loadUserConfig();
const up = (userCfg.providers ?? {}) as Record<string, any>;

function num(envName: string, def: number, fileVal?: number): number {
  if (typeof fileVal === "number" && Number.isFinite(fileVal)) return fileVal;
  const v = process.env[envName];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? (n as number) : def;
}

/**
 * C 任务(渠道优先级链):解析 per-modality provider 优先级列表。
 * 来源:config.json 数组 > env 逗号分隔(如 MEDIA_IMAGE_PROVIDER_PRIORITY="flow,agnes,zhipu")。
 * 未配置 = undefined → 走 legacy 行为(defaultXxxProvider + tier 免费链,零回归)。
 * 非字符串/空项剔除、小写归一、去重(保序);结果为空数组也按未配置处理。
 * 导出供单测白盒(与 num 同范式)。
 */
export function parseProviderPriority(fileVal: unknown, envName: string): string[] | undefined {
  let raw: unknown[] | undefined;
  if (Array.isArray(fileVal)) raw = fileVal;
  else if (process.env[envName]) raw = String(process.env[envName]).split(",");
  if (!raw?.length) return undefined;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const n = x.trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names.length ? names : undefined;
}

/**
 * 渠道运行时段(顶级 "flow";2026-08-26 简化:删除 enabled/S000 硬门 ——
 * 渠道启用与否的唯一控制源 = 优先级链,链中不配置 flow 即不启用;显式 provider=flow
 * 点名永远合法,环境不可用由前置检测 S100-S102 结构化报告。视频费用安全由计费确认门兜底)。
 * 纯解析函数导出供单测白盒(与 parseProviderPriority 同范式:解析与 I/O 分离)。
 *
 *   - toolDeadlineMs:flow 长操作(生图轮询/视频提交/资产下载)的工具级截止,
 *     防 stall 红线 ≤120s;默认 110s;超时转结构化 [flow] S410(底层操作不取消,诚实降级)。
 *   - videoConfirm:计费确认门(两段式确认令牌)。默认 true —— 防误耗红线下,误门(多一次
 *     往返拿确认令牌)的代价远小于漏门(真实扣积分);仅显式 false 关闭。
 *   - confirmTtlMs:确认令牌 TTL,默认 10 分钟(两段式往返留足阅读时间;过期重取,防陈旧确认)。
 */
export function parseFlowSection(raw: unknown): { toolDeadlineMs: number; videoConfirm: boolean; confirmTtlMs: number } {
  const s = (raw ?? {}) as Record<string, any>;
  const deadline = num("FLOW_TOOL_DEADLINE_MS", 110_000, s.toolDeadlineMs);
  const ttl = num("FLOW_CONFIRM_TTL_MS", 600_000, s.confirmTtlMs);
  return {
    toolDeadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : 110_000,
    videoConfirm: s.videoConfirm !== false, // 计费确认门默认 on(仅显式 false 才关)
    confirmTtlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : 600_000,
  };
}

/**
 * 动态构造 providers:遍历 config.json 的 providers 块,字段通用化。
 * 新增 provider 只需 config.json 加块 + registry.ts 注册 + 实现文件 —— config.ts 零改动。
 * env 回退按约定 `<UPPER(NAME)>_API_KEY` 等。
 */
function buildProviders(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, raw] of Object.entries(up)) {
    const p = (raw ?? {}) as Record<string, any>;
    // env 前缀:连字符→下划线(glm-vision → GLM_VISION_API_KEY,POSIX shell 标识符合法)
    const upper = name.toUpperCase().replace(/-/g, "_");
    // apiKeys(pares7):config.json `apiKeys: [...]` 或 env `${UPPER}_API_KEYS`(逗号分隔);单 key apiKey 向后兼容
    const apiKeysFromEnv = process.env[`${upper}_API_KEYS`];
    const apiKeys = Array.isArray(p.apiKeys)
      ? p.apiKeys.filter((k) => typeof k === "string" && k.trim()).map((k: string) => k.trim())
      : (apiKeysFromEnv ? String(apiKeysFromEnv).split(",").map((s) => s.trim()).filter(Boolean) : []);
    out[name] = {
      apiKey: p.apiKey ?? process.env[`${upper}_API_KEY`] ?? "",
      apiKeys,
      baseUrl: p.baseUrl ?? process.env[`${upper}_BASE_URL`] ?? "",
      videoMinIntervalMs: num(`${upper}_VIDEO_MIN_INTERVAL_MS`, 62_000, p.videoMinIntervalMs),
      models: p.models,
      rateLimits: p.rateLimits ?? {},
      // 原始块整体透传:provider 专属字段(如 flow 的 cdpPort/projectId)无需在 config.ts
      // 逐个白名单 —— 保持「新增 provider config.ts 零改动」的开闭承诺(硬约束 #4 架构)。
      settings: p,
      // pares7: vlm extra_body 透传(Unlimited-OCR images_config/custom_logit_processor/custom_params/
      // skip_special_tokens 等顶层扩展字段)。接受 camelCase 或 snake_case;缺省不发 Object.assign(零回归)。
      ...(p.extraBody ?? p.extra_body ? { extraBody: p.extraBody ?? p.extra_body } : {}),
    };
  }
  return out;
}

export const config = {
  defaultProvider: userCfg.defaultProvider ?? process.env.MEDIA_PROVIDER ?? "agnes",

  /** 图像模态默认 provider(未显式指定时);回退到 defaultProvider。 */
  defaultImageProvider:
    userCfg.defaultImageProvider ?? userCfg.defaultProvider ?? process.env.MEDIA_PROVIDER ?? "agnes",

  /** 视频模态默认 provider(未显式指定时);回退到 defaultProvider。 */
  defaultVideoProvider:
    userCfg.defaultVideoProvider ?? userCfg.defaultProvider ?? process.env.MEDIA_PROVIDER ?? "agnes",

  /** pares5: 识别模态默认 provider(未显式指定时);M1 起注册 tesseract 进程内兜底。与 image/video 一致,不暴露 per-modality env。 */
  defaultVisionProvider: userCfg.defaultVisionProvider ?? "tesseract",

  /**
   * C 任务:渠道优先级链(image 模态)。priority[0] = 未显式指定 provider 时的链头;
   * 链头失败(fallback-worthy / 环境前置失败)按序惰性推进。未配置 = undefined → 现行为
   * (defaultImageProvider + agnes/zhipu tier 免费链,零回归)。optIn provider(如 flow)
   * 只有显式列入本链才可被默认路由/链内回落选中。
   */
  imageProviderPriority: parseProviderPriority(userCfg.imageProviderPriority, "MEDIA_IMAGE_PROVIDER_PRIORITY"),

  /** C 任务:渠道优先级链(video 模态)。语义同上;默认不配置(agnes 免费),flow 需显式列入(视频消耗积分)。 */
  videoProviderPriority: parseProviderPriority(userCfg.videoProviderPriority, "MEDIA_VIDEO_PROVIDER_PRIORITY"),

  // 注:链头不再单设 getter(F1 后唯一真源 = registry getProviderPriority(modality)?.[0] ?? defaultXxxProvider,
  // src/index.ts buildTools 与 scripts/check-schema.mjs 用同一表达式;tsconfig noUnusedLocals 不覆盖
  // 未用类成员,曾经的 imageProviderChainHead/videoProviderChainHead getter 会以死代码形态存活)。

  /**
   * 顶级 "flow" 渠道运行时段(toolDeadlineMs 防 stall + 计费确认门开关/TTL)。
   * 对象整体注入 FlowProvider(registry 传引用,测试可 live 修改)。
   */
  flow: parseFlowSection(userCfg.flow),

  outDir: userCfg.outDir
    ? path.resolve(userCfg.outDir)
    : process.env.OUT_DIR
      ? path.resolve(process.env.OUT_DIR)
      : path.resolve(process.cwd(), "output"),

  video: {
    timeoutMs: num("VIDEO_TIMEOUT_MS", 900_000, userCfg?.video?.timeoutMs),
    pollIntervalMs: num("VIDEO_POLL_INTERVAL_MS", 10_000, userCfg?.video?.pollIntervalMs),
  },

  /** HTTP 瞬时错误(5xx/网络)重试:provider 提交/查询路径共享。可经 config.http 调优。 */
  http: {
    maxRetries: num("HTTP_MAX_RETRIES", 3, userCfg?.http?.maxRetries),
    retryBaseMs: num("HTTP_RETRY_BASE_MS", 1000, userCfg?.http?.retryBaseMs),
    retryMaxMs: num("HTTP_RETRY_MAX_MS", 8000, userCfg?.http?.retryMaxMs),
  },

  /** 学习限流 TTL(ms),过期降级基线;默认 7 天 */
  rateLimitTtlMs: num("RATE_LIMIT_TTL_MS", 7 * 24 * 60 * 60 * 1000, userCfg.rateLimitTtlMs),

  /**
   * pares6: PDF 异步识别管线配置。pdfjs-dist + @napi-rs/canvas 进 optionalDependencies,
   * 不安装时调 extract_pdf 返清晰错误,不破坏零配置承诺。
   */
  pdf: {
    /** 单 PDF 最大页数(按【目标页数】判定,pageRange 子集不误拒;风险 R5:OOM 保护),默认 200。 */
    maxPages: num("PDF_MAX_PAGES", 200, userCfg?.pdf?.maxPages),
    /** 异步 job TTL(ms),默认 30 分钟;钳制 ≥1s 防 busy-loop。 */
    jobTtlMs: num("PDF_JOB_TTL_MS", 30 * 60 * 1000, userCfg?.pdf?.jobTtlMs),
    /** 默认渲染 scale(高 DPI),默认 2.0;per-call scale 缺省时回落此值(审查架构#4:已接入,非死配置)。代码侧钳制到 [0.5, 3.0]。 */
    scale: num("PDF_SCALE", 2.0, userCfg?.pdf?.scale),
    /** 默认并发页数,默认 1(串行,内存安全)。v1 实际串行(参数校验但未消费);v2 并行池落地后启用。 */
    concurrency: num("PDF_CONCURRENCY", 1, userCfg?.pdf?.concurrency),
  },

  /** 各 provider 连接配置(动态遍历 config.json) */
  providers: buildProviders(),

  configFile: CONFIG_FILE,
};

/**
 * 原子回写 provider 字段到 config.json(temp + rename)。
 */
export async function persistProviderField(
  provider: string,
  field: string,
  value: unknown,
): Promise<void> {
  try {
    const raw = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, "utf-8") : "{}";
    const cfg = JSON.parse(raw) as Record<string, any>;
    cfg.providers = cfg.providers ?? {};
    cfg.providers[provider] = cfg.providers[provider] ?? {};
    cfg.providers[provider][field] = value;
    const tmp = CONFIG_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
    // pares7 review:含 key 字段强制 0600 权限(防多 key 泄露;每次写都重设,免被 tmp 重置)
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* Windows/非 POSIX 忽略 */ }
  } catch (e: any) {
    console.error(`[media-gen-mcp] 回写 ${CONFIG_FILE} 失败:${e?.message}`);
  }
}
