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
    const upper = name.toUpperCase();
    out[name] = {
      apiKey: p.apiKey ?? process.env[`${upper}_API_KEY`] ?? "",
      baseUrl: p.baseUrl ?? process.env[`${upper}_BASE_URL`] ?? "",
      videoMinIntervalMs: num(`${upper}_VIDEO_MIN_INTERVAL_MS`, 62_000, p.videoMinIntervalMs),
      models: p.models,
      rateLimits: p.rateLimits ?? {},
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
  } catch (e: any) {
    console.error(`[media-gen-mcp] 回写 ${CONFIG_FILE} 失败:${e?.message}`);
  }
}
