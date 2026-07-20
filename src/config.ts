import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 配置文件:`~/.media-gen-mcp/config.json`(home 全局)。
 * npm 发布 + npx 运行时,包在 npm 缓存(__dirname 不可写/不持久),配置必须在用户 home。
 * 本地 node 开发同样读 home(一致)。
 *
 * 优先级:config.json > 环境变量 > 默认值。
 */
export const CONFIG_FILE = path.join(os.homedir(), ".media-gen-mcp", "config.json");

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
