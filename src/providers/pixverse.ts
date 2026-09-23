/**
 * PixVerse provider —— spawn 官方 CLI(`pixverse --json`,订阅积分池)。
 *
 * 契约依据:doc/PixVerse-provider集成.md(2026-09-14;浓缩自《PixVerse深度参考手册-集成视角-2026-09-12》
 * + 其 09-14 勘误/终局裁决 + 官方 README + 本机 live 零消耗实测)。
 *
 * 架构(手册 §9 蓝图 + E 轮裁决修订):
 *   - 通道:spawn CLI `--json`(stdout 恒 JSON,错误/进度走 stderr),绝不裸调私有 API/官方 MCP;
 *   - 🔴 版本锁(E 必加):optionalDependencies 精确锁 pixverse@1.4.3,spawn 走锁定安装的本地 bin
 *     (解析链 PIXVERSE_BIN → 逐级上溯 node_modules/.bin/pixverse → npx -y pixverse@<pinned> 兜底);
 *     禁裸 `npx pixverse`(本会话实证 npx 每次重解析 latest,静默漂移);CLI 升级 = 显式 act
 *     (改依赖/配置)+ CHANGELOG 评审;
 *   - 🔴 启动自检(E 必加):`pixverse -V` + capabilities bundle 摘要与缓存快照 diff;版本不匹配 →
 *     响亮告警 + 每次结果携带 degraded warning(绝不静默继续);Node 版本前置检测(仓 engines>=18 vs
 *     CLI engines>=22.12)不足时结构化错误而非 npx 报错碎片;
 *   - 🔴 成本账本落盘(E 必加):提交后 model+quality+duration+audio+count → 实际 cost_credits 持久化
 *     到 ~/.media-gen-mcp/pixverse-cost-ledger.json;静态预估表只作首估(手册 §6.2 已证漂移:v6-360p
 *     实扣 4cr/s vs 手册 5cr/s),ledger 命中优先;「已漂移,以实际扣减为准」告警在有观测值后自动消失;
 *     缺失≠免费铁则保留;
 *   - 🔴 确认门覆盖所有扣费 create 模式(E 必加;09-14 终局裁决:CLI 不能吃 Relax 免费池 —— Standard
 *     无免费白名单,qwen-image 实扣 5/10cr —— 故 image/video 一律过门;Relax 免门设计作废);
 *   - 退出码 0-7 单表映射(capabilities.json 逐字);内部 code(如 500047)仅 advisory;
 *   - 非零退出防御性双解析(先 stdout 后 stderr;exit-5 partial 载荷通道未 live 验证);
 *   - 显式 --no-wait + 自轮询(2/5/10s 梯度;done=1 / retry=5,9,10 / failed=7,8);
 *   - 提交前零成本预检 account info 余额 + slots(实证 shared_pool:true,image/video 各 3);
 *   - exit-7(CONCURRENCY_LIMIT)退避 5s/10s/20s ×3 复用同 idempotency key,不过门;
 *   - exit-3(OAuth 30 天无静默刷新)一等公民:结构化错误附 stderr 捕获的 Authorize URL(--json 模式
 *     不开浏览器,URL 走 stderr)+ `pixverse auth login` 指引;
 *   - 412 advisory(不预探测):Standard 档第三方模型失败 → hint「降原生 v6 或升级」;
 *   - MVP 分期:P1 = create image/video + task/asset/account/capabilities 五组命令;P2(未接)=
 *     voice/music/transition/reference/extend/modify/upscale/motion-control/template;canvas/miniapps/
 *     saved 明确不接(93 命令只取核心面,控维护面)。
 *
 * 错误契约(对齐 [flow] S 码先例):`[pixverse] S<code> <消息> Hint: <修复提示>`
 *   S1xx 环境(bin 缺失/版本漂移/Node 不足/认证过期)| S2xx spawn 传输 | S3xx 参数/确认门
 *   | S4xx 生成结果(exit 5/4/7/6/2、任务不存在)
 *
 * 铁律:测试代码不得让本 provider spawn 真实 CLI(注入 PixverseTransport stub 除外);
 * CI 零真实提交(积分红线)。requireOptIn=true(订阅积分误耗红线,flow 先例):未显式同意
 * (provider/model 点名或 <modality>ProviderPriority 列入)时不进任何隐式 fallback 链。
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  MediaProviderBase,
  ImageProvider,
  ImageOutput,
  VideoProvider,
  ImageRequest,
  ImageResult,
  VideoRequest,
  VideoTask,
  VideoHandle,
  VideoResult,
  ProviderCapabilities,
  ProviderHealth,
  Modality,
  SubmissionConfirm,
} from "./types.js";
import { sniffImage } from "../image-sniff.js";

// ── 常量(手册 §3 + 2026-09-14 本机 live 实测) ──

/** 🔴 版本锁(E 必加):optionalDependencies 精确锁;升级 = 显式 act + CHANGELOG 评审。 */
export const PIXVERSE_PINNED_VERSION = "1.4.3";
/** CLI npm engines 要求(Node >= 22.12.0;README 逐字)。仓 engines >= 18 → 运行时前置检测。 */
export const PIXVERSE_CLI_NODE_MIN = "22.12.0";
/** CLI 自轮询梯度(capabilities.json contract.polling 逐字:"intervals=2s,5s,10s")。 */
export const PIXVERSE_POLL_INTERVALS_MS = [2_000, 5_000, 10_000] as const;
/** 任务状态机(contract.polling 逐字:"done=1; retry=5,9,10; failed=7,8")。 */
export const PIXVERSE_STATUS_DONE = 1;
export const PIXVERSE_STATUS_RETRY = new Set([5, 9, 10]);
export const PIXVERSE_STATUS_FAILED = new Set([7, 8]);
/** 工具级截止(防 stall 红线 ≤120s;对齐 flow DEFAULT_TOOL_DEADLINE_MS)。 */
const DEFAULT_TOOL_DEADLINE_MS = 110_000;
/** 确认令牌默认 TTL(两段式往返阅读时间;对齐 flow)。 */
const DEFAULT_CONFIRM_TTL_MS = 600_000;
/** 单次 spawn(非轮询)超时:CLI 提交/查询本身的硬上限。 */
const SPAWN_TIMEOUT_MS = 60_000;
/** 启动自检/ensureCli 结果缓存 TTL(版本一日不变即有效;能力表静态于 CLI 版本)。 */
const SELFCHECK_TTL_MS = 24 * 60 * 60 * 1000;

const STATE_DIR = path.join(os.homedir(), ".media-gen-mcp");
const PIXVERSE_STATE_FILE = path.join(STATE_DIR, "pixverse-state.json");
const PIXVERSE_CONFIRM_SECRET_FILE = path.join(STATE_DIR, "pixverse-confirm-secret");
const PIXVERSE_CONFIRM_CONSUMED_FILE = path.join(STATE_DIR, "pixverse-confirm-consumed.json");
const PIXVERSE_COST_LEDGER_FILE = path.join(STATE_DIR, "pixverse-cost-ledger.json");
const CONFIRM_TOKEN_PREFIX = "pvc1";

const INSTALL_HINT =
  `安装:①重新安装本包让 optionalDependencies 落锁定的本地 bin(npm i media-gen-mcp-server)②或全局装锁定版本 npm i -g pixverse@${PIXVERSE_PINNED_VERSION} 后设 PIXVERSE_BIN 指向其 bin ③临时兜底自动走 npx -y pixverse@${PIXVERSE_PINNED_VERSION}(冷缓存有下载延迟)`;

// ── 错误类型:所有 pixverse 错误统一 [pixverse] S<code> 前缀(项目错误前缀规范) ──

export class PixverseError extends Error {
  /** S 码(S1xx 环境/S2xx 传输/S3xx 参数与确认门/S4xx 生成结果),供测试与调用方机读。 */
  readonly code: string;
  /** 环境前置未就绪标记:请求从未提交(bin 缺失/Node 不足/未认证)→ 优先级链可推进/钉死守卫拦下。 */
  readonly precondition?: true;
  /** 触发本错误的 CLI 进程退出码(0-7;无 CLI 交互时 undefined),advisory。 */
  readonly cliExitCode?: number;
  /** CLI/后端内部 code(如 500047 任务不存在;stderr JSON 的 code 字段),仅 advisory。 */
  readonly internalCode?: number;

  constructor(
    code: string,
    message: string,
    opts?: { hint?: string; precondition?: boolean; cliExitCode?: number; internalCode?: number },
  ) {
    super(`[pixverse] ${code} ${message}${opts?.hint ? ` Hint: ${opts.hint}` : ""}`);
    this.name = "PixverseError";
    this.code = code;
    if (opts?.precondition) this.precondition = true;
    if (opts?.cliExitCode !== undefined) this.cliExitCode = opts.cliExitCode;
    if (opts?.internalCode !== undefined) this.internalCode = opts.internalCode;
  }
}

// ── 传输层:CLI spawn 抽象(生产 = NodeCliTransport;测试注入 stub,零 spawn 零消耗) ──

export interface CliSpawnResult {
  stdout: string;
  stderr: string;
  code: number;
  /** 实际使用的 bin 解析结果(诊断/自检用;stub 不填)。 */
  resolvedBin?: string;
}

export interface PixverseTransport {
  /** 执行一次 pixverse CLI(args 不含 bin 名与 --json —— 由传输层统一追加 --json)。 */
  run(args: string[], opts?: { timeoutMs?: number }): Promise<CliSpawnResult>;
  /** bin 解析(不执行;ensureCli 自检用)。返回 null = 解析失败。 */
  resolveBin(): Promise<string | null>;
  /** 自愈 note 通道(provider 公共入口 drain 进结果 warnings;stderr 在 push 时留痕)。 */
  notes?: string[];
}

function pushNote(t: PixverseTransport | null, note: string): void {
  console.error(`[pixverse] ${note}`);
  const notes = (t as { notes?: string[] })?.notes;
  if (Array.isArray(notes)) notes.push(note);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** semver 主.次.修 比较器(engines 检测用;只支持纯数字段)。 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map((x) => Number(x) || 0);
  const pb = b.split("-")[0].split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** dist 文件所在目录(逐级上溯找 node_modules/.bin/pixverse 的起点)。 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * 锁定本地 bin 查找:从 dist 目录逐级上溯 node_modules/.bin/pixverse。
 * optionalDependencies 的安装落点:消费方根 node_modules(pnpm 布局也能命中 .bin 链接或真实包 bin)。
 * 同步函数导出供单测白盒。
 */
export function findLocalPixverseBin(startDir: string = MODULE_DIR): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const bin = path.join(dir, "node_modules", ".bin", "pixverse");
    try {
      if (fs.existsSync(bin)) return bin;
    } catch { /* 忽略不可读目录 */ }
    const pkgBin = path.join(dir, "node_modules", "pixverse", "dist", "index.js");
    try {
      if (fs.existsSync(pkgBin)) return pkgBin;
    } catch { /* 同上 */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 生产传输:spawn 解析链 PIXVERSE_BIN → 锁定本地 bin → npx -y pixverse@<pinned>(🔴 禁裸 npx:
 * 实证每次重解析 latest 静默漂移;钉版本的 npx 是确定性兜底)。全部调用统一追加 --json。
 */
export class NodeCliTransport implements PixverseTransport {
  readonly notes: string[] = [];
  private warnedNpx = false;
  constructor(private readonly binOverride?: string, private readonly pinnedVersion: string = PIXVERSE_PINNED_VERSION) {}

  async resolveBin(): Promise<string | null> {
    const env = this.binOverride ?? process.env.PIXVERSE_BIN;
    if (env && env.trim()) {
      if (fs.existsSync(env.trim())) return env.trim();
      throw new PixverseError("S100", `PIXVERSE_BIN 指向的文件不存在:"${env}"`, { hint: INSTALL_HINT, precondition: true });
    }
    const local = findLocalPixverseBin();
    if (local) return local;
    return "npx"; // 兜底标记(经 npxArgs 包装)
  }

  private isNpx(bin: string): boolean {
    return bin === "npx";
  }

  async run(args: string[], opts: { timeoutMs?: number } = {}): Promise<CliSpawnResult> {
    const resolved = await this.resolveBin();
    if (resolved == null) {
      throw new PixverseError("S100", `未找到 pixverse CLI(解析链 PIXVERSE_BIN → 本地锁定 bin → npx 兜底均未命中)`, { precondition: true, hint: INSTALL_HINT });
    }
    const bin = resolved;
    const useNpx = this.isNpx(bin);
    const finalArgs = [...(useNpx ? ["-y", `pixverse@${this.pinnedVersion}`] : []), ...args, "--json"];
    if (useNpx && !this.warnedNpx) {
      this.warnedNpx = true;
      pushNote(this, `未找到锁定安装的本地 pixverse bin,已兜底 npx -y pixverse@${this.pinnedVersion}(钉版本,非裸 npx;冷缓存有下载延迟)。${INSTALL_HINT}`);
    }
    const timeoutMs = opts.timeoutMs ?? SPAWN_TIMEOUT_MS;
    const child = spawnDirect(bin, finalArgs, timeoutMs);
    return child.promise;
  }
}

function spawnDirect(bin: string, args: string[], timeoutMs: number): { promise: Promise<CliSpawnResult> } {
  let stdout = "", stderr = "";
  let timedOut = false;
  const child = spawn(bin, args, { windowsHide: true });
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
  }, timeoutMs);
  child.stdout?.on("data", (d) => { stdout += d.toString(); });
  child.stderr?.on("data", (d) => { stderr += d.toString(); });
  const promise = new Promise<CliSpawnResult>((resolve, reject) => {
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(new PixverseError("S200", `CLI 进程启动失败(${e.message})`, { hint: INSTALL_HINT, precondition: true }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PixverseError("S201", `CLI 执行超时(>${Math.round(timeoutMs / 1000)}s),进程已终止`, { hint: "重试;持续超时检查代理与网络" }));
        return;
      }
      resolve({ stdout, stderr, code: code ?? -1, resolvedBin: bin });
    });
  });
  return { promise };
}

// ── 静态目录(capabilities create --json 2026-09-14 本机实测;能力缓存优先,此为兜底) ──

/** P1 开放的 create video 模型(capabilities create --json modes.video.models 逐字,25 个)。 */
export const PIXVERSE_VIDEO_MODELS: string[] = [
  "v6", "pixverse-c1", "seedance-2.5", "seedance-2.0-standard", "seedance-2.0-fast",
  "seedance-2.0-mini", "minimax-h3", "flux-3.0", "wan-3.0", "gemini-omni-flash",
  "happyhorse-1.0", "kling-o3-pro", "kling-o3-standard", "kling-o3-4k", "kling-3.0-pro",
  "kling-3.0-standard", "kling-3.0-4k", "grok-imagine-1.5", "grok-imagine", "veo-3.1-lite",
  "veo-3.1-standard", "veo-3.1-fast", "sora-2-pro", "sora-2", "v5.6",
];

/** P1 开放的 create image 模型(modes.image.models 逐字,14 个)。 */
export const PIXVERSE_IMAGE_MODELS: string[] = [
  "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.0", "gemini-3.1-flash",
  "gemini-3.1-flash-lite", "qwen-image", "gemini-3.0", "gemini-2.5-flash",
  "seedream-5.0-pro", "seedream-5.0-lite", "seedream-4.5", "seedream-4.0",
  "kling-image-o3", "kling-image-v3",
];

/** 原生模型集(412 advisory 判定:第三方 = 不在此集;off_peak 仅原生透传 —— 手册 §5.4)。 */
export const PIXVERSE_NATIVE_MODELS = new Set(["v6", "pixverse-c1", "v5.6", "v5.5", "v5"]);

/**
 * 静态首估表(E 必加配套:仅首估,ledger 命中优先;手册 §4/§6.2 + 09-14 勘误实测值)。
 * video:v6/c1 按 [无音, 有音] cr/秒(360p 取勘误实测 4;其余手册值,静态必带漂移告警)。
 * image:per 张(qwen-image 720p/1080p = 09-14 实测 5/10cr;NB2 2160p = 手册 60)。
 * 导出供单测白盒。
 */
export function staticEstimateCredits(sig: { mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; audio?: boolean; count?: number }): number | null {
  const count = sig.count ?? 1;
  if (sig.mode === "image") {
    const per = staticImageCredits(sig.model, sig.quality);
    return per == null ? null : per * count;
  }
  const rates = staticVideoRates(sig.model, sig.quality);
  if (rates == null || sig.durationSeconds == null) return null;
  return rates * Math.max(1, Math.round(sig.durationSeconds)) * count;
}

function staticVideoRates(model: string, quality?: string): number | null {
  const q = (quality ?? "720p").replace(/p$/, "");
  const table: Record<string, Record<string, [number, number]>> = {
    "v6": { "360": [4, 7], "540": [7, 9], "720": [9, 12], "1080": [18, 23] },
    "pixverse-c1": { "360": [6, 8], "540": [8, 10], "720": [10, 13], "1080": [19, 24] },
  };
  const m = table[model];
  if (!m) return null;
  const pair = m[q] ?? m["720"];
  return pair[1]; // 未暴露 audio 开关 → 保守取有音档(高估值)
}

function staticImageCredits(model: string, quality?: string): number | null {
  if (model === "qwen-image") return quality === "720p" ? 5 : 10;
  if (model === "gemini-3.1-flash" && quality === "2160p") return 60;
  return null;
}

// ── 成本账本(E 必加:~/.media-gen-mcp/pixverse-cost-ledger.json;命中优先于静态表) ──

export interface CostLedgerEntry {
  credits: number;
  observedAt: string;
  /** 观测来源(asset list cost_credits)。 */
  source: string;
}

/**
 * 账本签名键:mode|model|quality|duration|audio|count(视频 duration 含秒;图像 duration=0)。
 * 导出供单测白盒。
 */
export function costLedgerKey(sig: { mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; audio?: boolean; count?: number }): string {
  return [
    sig.mode, sig.model, sig.quality ?? "", sig.mode === "video" ? `${Math.round(sig.durationSeconds ?? 0)}s` : "0",
    sig.audio === false ? "0" : "1", sig.count ?? 1,
  ].join("|");
}

function readLedgerFile(file: string): Record<string, CostLedgerEntry> {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf-8"));
    return j?.entries && typeof j.entries === "object" && !Array.isArray(j.entries) ? j.entries : {};
  } catch { return {}; }
}

// ── 能力表(启动惰性;capabilities 命令免登录免网络,零消耗) ──

export interface PixverseCapability {
  /** per-model 参数覆盖(models.<id>.parameters);缺省回退共享 parameters。 */
  shared: Record<string, any>;
  model: Record<string, any>;
}

/** 参数吸附结果(on_invalid=adjust 吸附 + warning;reject 且不在 enum → S301)。 */
export function adsorbParam(
  cap: PixverseCapability | undefined,
  name: string,
  value: string | number | undefined,
  label: string,
): { value: string | number | undefined; warning?: string } {
  if (value === undefined) return { value: undefined };
  const spec = cap?.model?.[name] ?? cap?.shared?.[name];
  if (!spec) return { value, warning: `能力表未声明参数 ${label},已原样透传(以 CLI 运行时校验为准)。` };
  const enumVals: unknown[] | undefined = spec.enum;
  if (spec.supported === false) {
    throw new PixverseError("S301", `${label} 不被该模型支持(capabilities: supported=false)`);
  }
  if (!enumVals?.length) return { value };
  const contains = enumVals.some((x) => String(x) === String(value));
  if (contains) return { value };
  if (spec.on_invalid === "reject") {
    throw new PixverseError("S301", `${label}="${value}" 非法(该模型仅支持:${enumVals.join(" / ")})`);
  }
  // on_invalid=adjust(实证:quality/duration/aspect_ratio/count 均静默改账单参数 → 预吸附 + 响亮告警)
  const nums = enumVals.map(Number).filter((n) => Number.isFinite(n));
  let snapped: string | number;
  if (typeof value === "number" || (typeof value === "string" && nums.length === enumVals!.length && /^\d+$/.test(value))) {
    const v = Number(value);
    snapped = nums.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), nums[0]);
  } else {
    // 最近似比例吸附("W:H" 数值最近)
    const ratio = (x: string) => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(x); return m ? Number(m[1]) / Number(m[2]) : NaN; };
    const v = ratio(String(value));
    if (!Number.isFinite(v)) {
      throw new PixverseError("S301", `${label}="${value}" 非法(仅支持:${enumVals.join(" / ")})`);
    }
    const strs = enumVals.map(String);
    snapped = strs.reduce((a, b) => (Math.abs(ratio(b) - v) < Math.abs(ratio(a) - v) ? b : a), strs[0]);
  }
  return { value: snapped, warning: `${label}="${value}" 不在该模型合法集,已吸附为 "${snapped}"(CLI on_invalid=adjust 会静默改此账单参数 —— 预吸附并告警,防静默漂移)。` };
}

/**
 * 能力表参数缺省值(model.parameters 优先,shared.parameters 兜底)。
 * 用途:未显式传 quality/duration 时,CLI 会用模型默认 —— 确认门/账本签名按同一默认落键,
 * 保证 ledger 写键(实际观测)与读键(下次预估)一致。
 */
export function capDefault(cap: PixverseCapability | undefined, name: string): string | number | undefined {
  const spec = cap?.model?.[name] ?? cap?.shared?.[name];
  const d = spec?.default;
  return d !== undefined && d !== null ? (d as string | number) : undefined;
}

/** size("WxH")→ 最近似比例("16:9" 等);解析失败返回 undefined。导出供单测。 */
export function aspectFromSize(size?: string): string | undefined {
  const m = size ? /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/i.exec(size) : null;
  if (!m) return undefined;
  const w = Number(m[1]), h = Number(m[2]);
  if (!w || !h) return undefined;
  const table = ["1:1", "16:9", "9:16", "4:3", "3:4", "5:4", "4:5", "3:2", "2:3", "21:9", "2:1", "1:2"];
  const ratio = (x: string) => { const [a, b] = x.split(":").map(Number); return a / b; };
  const r = w / h;
  return table.reduce((a, b) => (Math.abs(ratio(b) - r) < Math.abs(ratio(a) - r) ? b : a), table[0]);
}

// ── 退出码映射(capabilities.json exit_codes 逐字;0-7 单表) ──

/** 从文本(JSON 或纯文本)提取首个 JSON 对象(防御:stdout/stderr 混排时容错提取)。 */
export function extractJson(text: string): any | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* 继续扫描 */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return undefined; }
  }
  return undefined;
}

/** stderr 捕获 OAuth Authorize URL(--json 模式不开浏览器,URL 走 stderr;手册 §3.2)。 */
export function extractAuthorizeUrl(stderr: string): string | undefined {
  const m = /(https:\/\/app\.pixverse\.ai\/oauth\/authorize\?\S+)/i.exec(stderr ?? "");
  return m ? m[1] : undefined;
}

/**
 * 非零退出的统一映射(E:先 stdout 后 stderr 双解析 —— exit-5 partial 载荷通道未 live 验证)。
 * 返回 { error } 或 { payload }(payload = 部分成功载荷,partial 一等公民)。
 * 导出供单测白盒。
 */
export function mapCliFailure(
  code: number,
  stdout: string,
  stderr: string,
  ctx: { mode: string; model?: string },
): { error: PixverseError } | { payload: any } {
  const out = extractJson(stdout);
  const err = extractJson(stderr);
  const stderrMsg = (err?.error ?? stderr.trim().split("\n").filter((l) => !l.startsWith("npm ")).join(" ").slice(0, 200)) || "(stderr 空)";
  const internalCode = typeof err?.code === "number" ? err.code : undefined;
  const thirdParty = ctx.model ? !PIXVERSE_NATIVE_MODELS.has(ctx.model) : false;
  const hint412 = thirdParty
    ? ` Standard 档第三方模型可能不可用(useapi 412 冲突两源未裁决):降级原生 v6 或升级订阅后再试(不做预探测 —— 会扣分/占并发,失败即报即降)。`
    : "";
  switch (code) {
    case 2: { // TIMEOUT:已拿任务 ID 时转轮询恢复(手册 §3.3)
      const ids = collectTaskIds(out ?? err);
      if (ids.length) return { payload: { status: "submitted", ...(out ?? err), __recoveredFromTimeout: true } };
      return { error: new PixverseError("S404", `CLI 等待超时(exit 2):${stderrMsg}`, { cliExitCode: 2, internalCode, hint: "任务可能仍在后台;稍后用 task status 复查" }) };
    }
    case 3: { // AUTH_EXPIRED(OAuth 30 天无静默刷新 → 一等公民:附 Authorize URL + auth login 指引)
      const url = extractAuthorizeUrl(stderr);
      return {
        error: new PixverseError("S103", `认证过期/无效(exit 3):${stderrMsg}`, {
          precondition: true, cliExitCode: 3, internalCode,
          hint: `重新登录:npx pixverse@${PIXVERSE_PINNED_VERSION} auth login(OAuth 设备流,30 天有效;任意设备完成授权均可)${url ? `。Authorize URL:${url}` : ""};无人值守可设 PIXVERSE_ACCESS_KEY 环境变量`,
        }),
      };
    }
    case 4:
      return { error: new PixverseError("S402", `积分/订阅额度不足(exit 4):${stderrMsg}`, { cliExitCode: 4, internalCode, hint: "npx pixverse@1.4.3 account info 查余额;订阅档位见 app.pixverse.ai/subscribe" }) };
    case 5: { // GENERATION_FAILED(1.4.0 起含部分批次失败)→ 必查部分成功
      const payload = out ?? err;
      if (payload && (Array.isArray(payload.items) || Array.isArray(payload.failed_ids))) {
        return { payload };
      }
      return { error: new PixverseError("S400", `生成失败(exit 5):${stderrMsg}`, { cliExitCode: 5, internalCode, hint: `重生成须换新 idempotency key(失败确认后有意重生成不复用旧 key)${hint412}` }) };
    }
    case 6:
      return { error: new PixverseError("S405", `参数校验失败(exit 6,不重试):${stderrMsg}`, { cliExitCode: 6, internalCode, hint: "按 stderr 提示修正参数;能力枚举可经 capabilities 查询(零消耗)" }) };
    case 7:
      return { error: new PixverseError("S403", `并发额度已满(exit 7):${stderrMsg}`, { cliExitCode: 7, internalCode, hint: "并发槽已占(Standard 3;account slots 可查);稍后重试" }) };
    case 1:
    default: {
      if (internalCode === 500047) {
        return { error: new PixverseError("S406", `任务不存在或已不可用(内部 code 500047):${stderrMsg}`, { cliExitCode: code, internalCode }) };
      }
      return { error: new PixverseError("S407", `CLI 通用错误(exit ${code}):${stderrMsg}${hint412}`, { cliExitCode: code, internalCode, hint: hint412 ? hint412.trim() : "查看 stderr 详情;重试前确认参数" }) };
    }
  }
}

/** 从提交响应收集任务 id(手册 §3.7:video_id/video_ids/image_id/image_ids/items[];id 键因模态而异)。 */
export function collectTaskIds(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  const ids: string[] = [];
  for (const k of ["video_ids", "image_ids", "audio_ids"]) {
    if (Array.isArray(obj[k])) ids.push(...obj[k].map(String));
  }
  for (const k of ["video_id", "image_id", "audio_id", "id"]) {
    if (obj[k] != null) ids.push(String(obj[k]));
  }
  if (Array.isArray(obj.items)) {
    for (const it of obj.items) {
      for (const k of ["video_id", "image_id", "id"]) {
        if (it?.[k] != null) ids.push(String(it[k]));
      }
    }
  }
  return [...new Set(ids)];
}

// ── Provider ──

export interface PixverseProviderConfig {
  /** bin 显式覆盖(默认 PIXVERSE_BIN env → 本地锁定 bin → npx 钉版本兜底)。 */
  bin?: string;
  /** config providers.pixverse.models.{image,video}.default。 */
  models?: { image?: { default?: string }; video?: { default?: string } };
  /** 顶级 pixverse 运行时段(registry 注入 config.pixverse 对象引用;测试可 live 修改)。 */
  pixverseCfg?: { toolDeadlineMs?: number; confirm?: boolean; confirmTtlMs?: number; pinnedVersion?: string };
  /** 测试注入 stub(零 spawn 零消耗)。 */
  transport?: PixverseTransport;
}

export class PixverseProvider implements MediaProviderBase, ImageProvider, VideoProvider {
  channelInfo(): import("./types.js").ChannelInfo {
    return {
      status: "live",
      cost: "订阅积分池(CLI 同池;一切提交过两段式计费确认门)",
      freeQuota: "无免费层(09-14 终局:CLI 无 Relax 池;qwen-image 1080p 实扣 10cr)",
      capabilities: { t2i: true, i2i: true, t2v: true, i2v: true, keyframes: true },
      limits: ["并发 Standard=3(超限 S403 退避 5/10/20s)", "Node ≥22.12(引擎前置 S102)", "价格三态 costCatalog 可查(实测>静态>unknown)"],
      watermark: "无",
      prerequisites: ["PixVerse 订阅 + CLI 登录(npx pixverse login)"],
      risks: ["商用条款矛盾(ToS 非商用 vs 博客 FAQ 允许——书面确认前勿商用产出)"],
    };
  }

  readonly name = "pixverse";
  private readonly transport: PixverseTransport;
  private readonly cfgModels?: PixverseProviderConfig["models"];
  private readonly pixverseCfg?: NonNullable<PixverseProviderConfig["pixverseCfg"]>;
  /** 能力缓存(mode+model → capability;静态于 CLI 版本,进程生命周期有效)。 */
  private capabilityCache = new Map<string, PixverseCapability>();
  /** ensureCli 结果缓存(版本 + 摘要;TTL 24h,持久化 state 文件)。 */
  private cliCheck: { at: number; version: string; degraded: boolean } | null = null;
  private checking: Promise<void> | null = null;
  private lastReadyAt: number | null = null;
  private cooldownUntil = 0;
  private cooldownError: Error | null = null;
  cooldownMs = 60_000; // 实例字段便于测试调短
  /** 已确认(过门)的提交上下文:digest → { idemKeyBase, seq, expiresAt }。 */
  private confirmed = new Map<string, { idemKeyBase: string; seq: number; expiresAt: number }>();
  // 测试注入缝(对齐 flow confirmSecretFile 先例;null = 默认 ~/.media-gen-mcp/ 下)
  stateFile: string | null = null;
  confirmSecretFile: string | null = null;
  confirmConsumedFile: string | null = null;
  costLedgerFile: string | null = null;
  private confirmSecretCache: Buffer | null = null;
  private confirmMintSeq = 0;

  constructor(c: PixverseProviderConfig = {}) {
    this.transport = c.transport ?? new NodeCliTransport(c.bin, c.pixverseCfg?.pinnedVersion ?? PIXVERSE_PINNED_VERSION);
    this.cfgModels = c.models;
    this.pixverseCfg = c.pixverseCfg;
    // 启动自检(E 必加):构造即异步预热(绝不阻塞 MCP 握手;失败静默 —— 首次真实使用时结构化报错)。
    // node --test 环境(NODE_TEST_CONTEXT)跳过 —— CI 不 spawn 真实 CLI(测试纪律);可用
    // MEDIA_GEN_PIXVERSE_SELFCHECK=0 显式关闭。
    if (!process.env.NODE_TEST_CONTEXT && process.env.MEDIA_GEN_PIXVERSE_SELFCHECK !== "0") {
      void this.ensureCli().catch(() => { /* 自检失败不阻断构造;首次使用时结构化报错 */ });
    }
  }

  // ── MediaProviderBase ──
  capabilities(): ProviderCapabilities {
    return {
      image: { textToImage: true, imageToImage: true },
      video: { textToVideo: true, imageToVideo: true, keyframes: false }, // keyframes(transition)为 P2 未接
    };
  }
  requiresOptIn(_modality: Modality): boolean {
    // 订阅积分误耗红线(flow 先例):未显式同意(点名或 priority 链列入)不进任何隐式 fallback 链。
    return true;
  }

  /** 价格目录(2026-09-14):静态首估+台账命中合并的三态视图,list_models 透出供调用方选型。 */
  costCatalog(): Record<string, { mode: "image" | "video"; credits?: number; unit: "per-image" | "cr/sec" | "unknown"; source: "ledger" | "static" | "none" }> {
    const out: Record<string, { mode: "image" | "video"; credits?: number; unit: "per-image" | "cr/sec" | "unknown"; source: "ledger" | "static" | "none" }> = {};
    const ledger = this.readLedger();
    for (const model of PIXVERSE_IMAGE_MODELS) {
      const per = staticImageCredits(model, "1080p");
      const hit = ledger[costLedgerKey({ mode: "image", model, quality: "1080p", count: 1 })];
      out[model] = hit
        ? { mode: "image", credits: hit.credits, unit: "per-image", source: "ledger" }
        : per != null
          ? { mode: "image", credits: per, unit: "per-image", source: "static" }
          : { mode: "image", unit: "unknown", source: "none" };
    }
    for (const model of PIXVERSE_VIDEO_MODELS) {
      const rates = staticVideoRates(model, "720p");
      const hit = ledger[costLedgerKey({ mode: "video", model, quality: "720p", durationSeconds: 5, count: 1 })];
      out[model] = hit
        ? { mode: "video", credits: Math.round(hit.credits / 5), unit: "cr/sec", source: "ledger" }
        : rates != null
          ? { mode: "video", credits: rates, unit: "cr/sec", source: "static" }
          : { mode: "video", unit: "unknown", source: "none" };
    }
    return out;
  }

  listModels(): string[] { return [...this.listImageModels(), ...this.listVideoModels()]; }
  listImageModels(): string[] { return [...PIXVERSE_IMAGE_MODELS]; }
  listVideoModels(): string[] { return [...PIXVERSE_VIDEO_MODELS]; }
  supportsImageToImage(): boolean { return true; }
  /** 输入引用例外:CLI --image/--images 接受 asset_id(数字形态;媒体四态 local/https/asset_id/media_path)。 */
  acceptsImageInputRef(value: string): boolean {
    return /^\d{6,}$/.test(value.trim());
  }
  health(): ProviderHealth {
    return { configured: this.lastReadyAt != null, cooldown: this.cooldownUntil > Date.now() };
  }
  tier(): number { return 0; }
  notifyUnavailable(e: any): void {
    this.cooldownUntil = Date.now() + this.cooldownMs;
    this.cooldownError = e instanceof Error ? e : new Error(String(e));
    console.error(`[media-gen-mcp] pixverse 不可用(${(e as Error)?.message?.slice(0, 60)}),${Math.round(this.cooldownMs / 1000)}s 内优先级链跳过`);
  }

  // ── 工具层约束接口 ──
  videoConstraints() {
    // duration 1-15s(v6 全程;其他模型更窄,提交前按能力表吸附)× 24fps
    const durations = Array.from({ length: 15 }, (_, i) => i + 1);
    return {
      allowedNumFrames: durations.map((d) => d * 24),
      defaultNumFrames: 5 * 24,
      defaultFrameRate: 24,
      allowedFrameRates: [24],
    };
  }
  estimateGenerationSeconds(_numFrames: number): number { return 130; }
  maxFramesFor(): number | undefined { return undefined; }

  // ── 防 stall 工具级截止 ──

  private toolDeadlineMs(): number {
    const v = this.pixverseCfg?.toolDeadlineMs;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_TOOL_DEADLINE_MS;
  }
  private async withToolDeadline<T>(p: Promise<T>, label: string): Promise<T> {
    const ms = this.toolDeadlineMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PixverseError("S410",
        `${label} 超过工具层截止 ${Math.round(ms / 1000)}s(防 stall 红线)`,
        { hint: "底层提交不取消 —— 任务可能仍在后台生成;稍后 get_video(taskId=…)/task status 复查取件" })), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 自愈 note drain(与 warnings 合并上浮)。 */
  private attachNotes<T>(r: T): T {
    const notes = (this.transport as { notes?: string[] }).notes;
    if (Array.isArray(notes) && notes.length && r && typeof r === "object") {
      const w = (r as { warnings?: string[] }).warnings;
      (r as { warnings?: string[] }).warnings = [...(Array.isArray(w) ? w : []), ...notes.splice(0, notes.length)];
    }
    return r;
  }

  // ── CLI 自检(版本锁 + Node 前置 + capabilities 摘要 diff;E 必加) ──

  private pinnedVersion(): string {
    return this.pixverseCfg?.pinnedVersion ?? PIXVERSE_PINNED_VERSION;
  }

  private statePath(file: string | null, def: string): string {
    return file ?? def;
  }

  /**
   * Node 引擎前置检测:仓 engines>=18 vs CLI engines>=22.12(npm 实证)。
   * 不足 → S102 结构化错误(而非让 CLI/npx 吐报错碎片)。
   */
  assertNodeEngine(): void {
    if (compareSemver(process.versions.node, PIXVERSE_CLI_NODE_MIN) < 0) {
      throw new PixverseError("S102",
        `当前 Node ${process.versions.node} 低于 pixverse CLI 要求的 ${PIXVERSE_CLI_NODE_MIN}(本包 engines>=18,CLI 更严)`,
        { precondition: true, hint: `升级 Node ≥ ${PIXVERSE_CLI_NODE_MIN} 后使用 provider=pixverse;其他 provider(agnes/zhipu/flow)不受影响` });
    }
  }

  /**
   * CLI 自检:bin 解析 → `pixverse -V`(版本 vs 锁定值)→ capabilities bundle 摘要与 state 快照 diff。
   * 版本不匹配 → 响亮告警(stderr)+ degraded(每次结果带 warning),绝不静默继续。
   * 结果缓存 TTL 24h(持久化 pixverse-state.json,跨进程)。
   */
  async ensureCli(force = false): Promise<{ version: string; degraded: boolean }> {
    this.assertNodeEngine();
    if (this.cooldownUntil > Date.now() && this.cooldownError) throw this.cooldownError;
    if (this.cooldownUntil <= Date.now()) this.cooldownError = null;
    if (!force && this.cliCheck && Date.now() - this.cliCheck.at < SELFCHECK_TTL_MS) {
      return { version: this.cliCheck.version, degraded: this.cliCheck.degraded };
    }
    if (this.checking) return this.checking.then(() => ({ version: this.cliCheck!.version, degraded: this.cliCheck!.degraded }));
    this.checking = (async () => {
      const bin = await this.transport.resolveBin();
      if (bin == null) {
        throw new PixverseError("S100", `未找到 pixverse CLI(解析链 PIXVERSE_BIN → 本地锁定 bin → npx 兜底均未命中)`, { precondition: true, hint: INSTALL_HINT });
      }
      // -V(--json 由传输层追加;实测 -V 容忍 --json,stdout 输出版本号)
      const r = await this.transport.run(["-V"], { timeoutMs: 30_000 });
      const version = (r.stdout.trim() || r.stderr.trim()).split("\n").pop()?.trim() ?? "";
      if (!/^\d+\.\d+\.\d+/.test(version)) {
        throw new PixverseError("S200", `CLI 版本探测失败(-V 输出非语义:"${version.slice(0, 40)}")`, { precondition: true, hint: INSTALL_HINT });
      }
      let degraded = false;
      if (version !== this.pinnedVersion()) {
        degraded = true;
        console.error(`[pixverse] ⚠️ CLI 版本漂移:实测 ${version} ≠ 锁定 ${this.pinnedVersion()}(provider 标记 degraded;能力表/退出码契约可能不符)。升级 = 显式 act:改 package.json optionalDependencies + CHANGELOG 评审。${INSTALL_HINT}`);
      }
      // capabilities bundle 摘要 diff(离线零消耗;摘要 = 退出码表 + 模型数)
      try {
        const cap = await this.transport.run(["capabilities", "create"], { timeoutMs: 30_000 });
        const bundle = extractJson(cap.stdout);
        if (bundle?.modes) {
          const digest = crypto.createHash("sha256").update(JSON.stringify(bundle.modes)).digest("hex").slice(0, 16);
          const stateFile = this.statePath(this.stateFile, PIXVERSE_STATE_FILE);
          let prev: any;
          try { prev = JSON.parse(fs.readFileSync(stateFile, "utf-8")); } catch { /* 首次 */ }
          if (prev?.capabilitiesDigest && prev.capabilitiesDigest !== digest) {
            console.error(`[pixverse] ⚠️ capabilities bundle 摘要变化(${prev.capabilitiesDigest} → ${digest});模型/参数枚举可能与静态目录不符,以运行时能力表为准`);
          }
          try {
            fs.mkdirSync(path.dirname(stateFile), { recursive: true });
            const tmp = `${stateFile}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify({ version, capabilitiesDigest: digest, checkedAt: new Date().toISOString() }, null, 2));
            fs.renameSync(tmp, stateFile);
          } catch { /* 落盘失败不阻断(内存缓存仍有效) */ }
        }
      } catch { /* capabilities 探测失败不阻断版本自检结论 */ }
      this.cliCheck = { at: Date.now(), version, degraded };
      this.lastReadyAt = Date.now();
    })();
    try {
      await this.checking;
    } finally {
      this.checking = null;
    }
    return { version: this.cliCheck!.version, degraded: this.cliCheck!.degraded };
  }

  /** degraded 提示(每次 pixverse 结果携带;版本匹配时返回空)。 */
  private degradedWarnings(): string[] {
    return this.cliCheck?.degraded
      ? [`CLI 版本 ${this.cliCheck.version} ≠ 锁定 ${this.pinnedVersion()}(degraded;能力契约可能漂移,结果以实际为准)`]
      : [];
  }

  // ── 只读数据面(零消耗:account/task/capabilities;手册 §0「能力表获取免登录免网络」) ──

  /** `account info --json`(零消耗;提交前记账/预检余额)。 */
  async accountInfo(): Promise<{ credits?: { total?: number; membership?: number; daily?: number; bonus?: number }; memberLabel?: string; [k: string]: unknown }> {
    await this.ensureCli();
    const r = await this.transport.run(["account", "info"], { timeoutMs: 30_000 });
    if (r.code !== 0) {
      const m = mapCliFailure(r.code, r.stdout, r.stderr, { mode: "account" });
      if ("error" in m) throw m.error;
      throw new PixverseError("S207", `account info 非零退出但带载荷(异常形状):${r.stdout.slice(0, 120)}`);
    }
    const j = extractJson(r.stdout);
    if (!j?.credits) throw new PixverseError("S202", `account info 输出非预期 JSON:${r.stdout.slice(0, 120)}`);
    return j;
  }

  /** `account slots --json`(零消耗;并发预检:shared_pool,image/video 各 3)。 */
  async accountSlots(): Promise<{ image?: { remaining?: number; limit?: number }; video?: { remaining?: number; limit?: number }; shared_pool?: boolean }> {
    await this.ensureCli();
    const r = await this.transport.run(["account", "slots"], { timeoutMs: 30_000 });
    if (r.code !== 0) {
      const m = mapCliFailure(r.code, r.stdout, r.stderr, { mode: "account" });
      if ("error" in m) throw m.error;
      throw new PixverseError("S207", "account slots 非零退出但带载荷(异常形状)");
    }
    return extractJson(r.stdout) ?? {};
  }

  /** `task status <id> --type <video|image> --json`(零消耗;getVideo 底层)。 */
  async taskStatus(id: string, type: "video" | "image"): Promise<any> {
    await this.ensureCli();
    const r = await this.transport.run(["task", "status", id, "--type", type], { timeoutMs: 30_000 });
    if (r.code !== 0) {
      const m = mapCliFailure(r.code, r.stdout, r.stderr, { mode: "task", model: undefined });
      if ("error" in m) throw m.error;
      return m.payload;
    }
    const j = extractJson(r.stdout);
    if (!j) throw new PixverseError("S202", `task status 输出非 JSON:${(r.stdout + r.stderr).slice(0, 160)}`);
    return j;
  }

  /** `asset list --type <t> --json`(零消耗;cost_credits 观测源)。 */
  async assetList(type: "video" | "image"): Promise<any[]> {
    await this.ensureCli();
    const r = await this.transport.run(["asset", "list", "--type", type], { timeoutMs: 30_000 });
    if (r.code !== 0) return []; // 观测 best-effort
    const j = extractJson(r.stdout);
    return Array.isArray(j?.items) ? j.items : [];
  }

  /** 能力表查询(capabilities create <mode> --model <id> --json;位置参数形态 —— 实证 --mode 已不存在)。 */
  private async capability(mode: "video" | "image", model: string): Promise<PixverseCapability | undefined> {
    const key = `${mode}:${model}`;
    const hit = this.capabilityCache.get(key);
    if (hit) return hit;
    const r = await this.transport.run(["capabilities", "create", mode, "--model", model], { timeoutMs: 30_000 });
    if (r.code !== 0) return undefined; // 静态目录兜底
    const j = extractJson(r.stdout);
    const cap = j?.capability;
    if (!cap) return undefined;
    const modelParams = cap.models?.[model]?.parameters;
    const built: PixverseCapability = { shared: cap.parameters ?? {}, model: modelParams ?? {} };
    this.capabilityCache.set(key, built);
    return built;
  }

  // ── 确认门(两段式;E 必加:覆盖所有扣费 create 模式 —— CLI 无免费池,09-14 终局裁决) ──

  private confirmEnabled(): boolean {
    return this.pixverseCfg?.confirm !== false;
  }
  private confirmTtlMs(): number {
    const v = this.pixverseCfg?.confirmTtlMs;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_CONFIRM_TTL_MS;
  }

  private confirmSecret(): Buffer {
    if (this.confirmSecretCache?.length) return this.confirmSecretCache;
    const file = this.statePath(this.confirmSecretFile, PIXVERSE_CONFIRM_SECRET_FILE);
    try {
      const raw = fs.readFileSync(file);
      if (raw.length >= 32) {
        this.confirmSecretCache = raw;
        return raw;
      }
    } catch { /* 走创建 */ }
    let secret = crypto.randomBytes(32);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, secret, { mode: 0o600 });
      fs.renameSync(tmp, file);
      const settled = fs.readFileSync(file);
      if (settled.length >= 32) secret = settled;
    } catch { /* 落盘失败退化为进程内密钥(保守安全) */ }
    this.confirmSecretCache = secret;
    return secret;
  }

  /** 请求计费摘要:mode|model|quality|duration|count|audio|offPeak|prompt 指纹|输入引用指纹(D 核心)。 */
  private confirmDigest(sig: {
    mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; count: number;
    audio?: boolean; offPeak?: boolean; prompt: string; negativePrompt?: string; inputs: string[];
  }): string {
    const promptFp = crypto.createHash("sha256").update(`${sig.prompt ?? ""}#${sig.negativePrompt ?? ""}`).digest("hex").slice(0, 12);
    const inputsFp = crypto.createHash("sha256").update([...sig.inputs].sort().join("#")).digest("hex").slice(0, 12);
    return crypto.createHash("sha256")
      .update(`${sig.mode}|${sig.model}|${sig.quality ?? ""}|${sig.durationSeconds ?? 0}|${sig.count}|${sig.audio === false ? 0 : 1}|${sig.offPeak === true ? 1 : 0}|${promptFp}|${inputsFp}`)
      .digest("hex").slice(0, 24);
  }

  /**
   * 令牌内嵌 idempotency key(E:挑战时生成,复调提取 —— 同 token 重试安全复用同 key;
   * 新挑战(确认失败后的有意重生成)→ 新 key,兑现「确认失败换新 key」纪律)。
   * 格式:pvc1.<issuedAt36>.<seq36>.<idemKey(uuid 无横线)>.<mac32>
   */
  private mintConfirmToken(digest: string, idemKey: string): string {
    const issuedAt = Date.now().toString(36);
    const seq = (this.confirmMintSeq++).toString(36);
    const mac = crypto.createHmac("sha256", this.confirmSecret()).update(`${issuedAt}.${seq}.${digest}.${idemKey}`).digest("hex").slice(0, 32);
    return `${CONFIRM_TOKEN_PREFIX}.${issuedAt}.${seq}.${idemKey}.${mac}`;
  }

  private verifyConfirmToken(token: string, digest: string): string {
    const reget = "不带 confirmToken 重新调用(原参数)即可获取新预估与令牌";
    const m = new RegExp(`^${CONFIRM_TOKEN_PREFIX}\\.([0-9a-z]+)\\.([0-9a-z]+)\\.([0-9a-f]{32})\\.([0-9a-f]{32})$`).exec(token);
    if (!m) {
      throw new PixverseError("S320", `confirmToken 格式非法(应为 ${CONFIRM_TOKEN_PREFIX}.<时刻>.<序号>.<idem>.<签名>,由确认门第一段返回)`, { hint: reget });
    }
    const issuedAt = parseInt(m[1], 36);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt < -30_000) {
      throw new PixverseError("S320", "confirmToken 签发时间非法(时钟异常)", { hint: reget });
    }
    if (Date.now() - issuedAt > this.confirmTtlMs()) {
      throw new PixverseError("S321", `confirmToken 已过期(TTL ${Math.round(this.confirmTtlMs() / 1000)}s)`, { hint: `${reget};确认后尽快提交` });
    }
    // MAC 输入与 mintConfirmToken 严格同构:issuedAt.seq.digest.idemKey(m[3] 是 idemKey,
    // m[4] 是令牌尾部的 MAC 本体 —— 2026-09-14 审查 P0-1:旧实现把两组错位使用,任何令牌都无法
    // 通过自校验,两段式门在第二段恒抛 S320)。回归测试 test/pixverse.test.ts「HMAC 不变量」钉死。
    const expect = crypto.createHmac("sha256", this.confirmSecret()).update(`${m[1]}.${m[2]}.${digest}.${m[3]}`).digest("hex").slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(m[4], "hex"), Buffer.from(expect, "hex"))) {
      throw new PixverseError("S320", "confirmToken 与当前请求不符(model/quality/duration/count/audio/prompt/输入引用 任一变化都会改变令牌绑定)", { hint: `${reget};确认后请勿改动参数` });
    }
    // 单次消费(跨进程持久化;对齐 flow 日志#15 机制)
    this.syncConsumedFromDisk();
    if (this.consumedConfirmTokens.has(token)) {
      throw new PixverseError("S322", "confirmToken 已使用(单次消费语义,防重复扣积分;跨进程持久化)", { hint: `${reget};复调不带 token 会返回新预估与令牌` });
    }
    this.consumedConfirmTokens.set(token, issuedAt + this.confirmTtlMs());
    this.persistConsumedTokens();
    return m[3]; // idemKey(hex;令牌第 4 段 —— P0-1 同源错位修复:旧实现误返回 m[4]=MAC)
  }

  private consumedConfirmTokens = new Map<string, number>();
  private syncConsumedFromDisk(): void {
    const file = this.statePath(this.confirmConsumedFile, PIXVERSE_CONFIRM_CONSUMED_FILE);
    let raw: any;
    try { raw = JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return; }
    const tokens = raw?.tokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return;
    const now = Date.now();
    for (const [t, exp] of Object.entries(tokens)) {
      if (typeof exp === "number" && exp > now) this.consumedConfirmTokens.set(t, exp);
    }
  }
  private persistConsumedTokens(): void {
    const file = this.statePath(this.confirmConsumedFile, PIXVERSE_CONFIRM_CONSUMED_FILE);
    const now = Date.now();
    for (const [t, exp] of this.consumedConfirmTokens) if (exp <= now) this.consumedConfirmTokens.delete(t);
    try {
      const disk = JSON.parse(fs.readFileSync(file, "utf-8"))?.tokens;
      if (disk && typeof disk === "object" && !Array.isArray(disk)) {
        for (const [t, exp] of Object.entries(disk)) {
          if (typeof exp === "number" && exp > now && !this.consumedConfirmTokens.has(t)) this.consumedConfirmTokens.set(t, exp);
        }
      }
    } catch { /* 并集退化 */ }
    const tokens: Record<string, number> = {};
    for (const [t, exp] of this.consumedConfirmTokens) tokens[t] = exp;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, tokens }, null, 0), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch { /* 写失败保守为进程内单次消费 */ }
  }

  /** 账本读取(测试注入缝感知)。 */
  private readLedger(): Record<string, CostLedgerEntry> {
    return readLedgerFile(this.statePath(this.costLedgerFile, PIXVERSE_COST_LEDGER_FILE));
  }

  /** 账本记录(原子写;观测 best-effort,失败不阻断结果)。 */
  private recordCost(sig: { mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; audio?: boolean; count?: number }, credits: number, source: string): void {
    const file = this.statePath(this.costLedgerFile, PIXVERSE_COST_LEDGER_FILE);
    const key = costLedgerKey(sig);
    try {
      const entries = readLedgerFile(file);
      entries[key] = { credits, observedAt: new Date().toISOString(), source };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e: any) {
      console.error(`[pixverse] 成本账本落盘失败(${e?.message});内存语义不受影响`);
    }
  }

  /** 预估:ledger 命中优先(无漂移告警)→ 静态首估(必带漂移告警)→ null(以实际扣减为准)。 */
  private lookupEstimate(sig: { mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; audio?: boolean; count?: number }): {
    credits: number | null; source: "ledger" | "static" | "unknown";
  } {
    const hit = this.readLedger()[costLedgerKey(sig)];
    if (hit && typeof hit.credits === "number") return { credits: hit.credits, source: "ledger" };
    const est = staticEstimateCredits(sig);
    return { credits: est, source: est == null ? "unknown" : "static" };
  }

  /** 门通用第一段/第二段(图像与视频共用;handler 在提交点前调用)。 */
  private async gateImpl(
    sig: { mode: "video" | "image"; model: string; quality?: string; durationSeconds?: number; count: number; audio?: boolean; offPeak?: boolean; prompt: string; negativePrompt?: string; inputs: string[] },
    adsorbedWarnings: string[],
    confirmToken?: string,
  ): Promise<SubmissionConfirm | undefined> {
    if (!this.confirmEnabled()) {
      // 门关闭(显式配置):仍走幂等键路径(每次提交随机 UUID)
      return undefined;
    }
    await this.ensureCli();
    const digest = this.confirmDigest(sig);
    if (!confirmToken) {
      // 零成本预检:余额 + slots(E:提交前记账;失败不阻断预估 —— 但认证过期要早失败)
      let balance: number | undefined;
      try {
        const acct = await this.accountInfo();
        balance = acct?.credits?.total;
        const slots = await this.accountSlots();
        const slotKey = sig.mode === "image" ? "image" : "video";
        const remaining = slots?.[slotKey]?.remaining;
        if (typeof remaining === "number" && sig.count > remaining) {
          throw new PixverseError("S403", `并发槽不足:${sig.mode} 剩余 ${remaining},本次需 ${sig.count}(shared_pool:${slots.shared_pool === true ? "是" : "否"})`, { hint: "等待在途任务完成(account slots 可查)后重试" });
        }
      } catch (e) {
        if (e instanceof PixverseError) throw e; // 预检结构化错(认证过期带 Authorize URL/槽不足)早失败
        /* 余额不可得(非结构化异常)→ 不阻断预估 */
      }
      const est = this.lookupEstimate(sig);
      const driftWarning = est.source === "static"
        ? [`静态预估表可能已漂移(手册 §6.2 实证:v6-360p 实扣 4cr/s vs 手册 5cr/s),以实际扣减为准;观测值落账本后本告警自动消失`]
        : [];
      const idemKey = crypto.randomUUID().replace(/-/g, "");
      return {
        needConfirm: true,
        provider: "pixverse",
        model: sig.model,
        estimatedCost: est.credits,
        costSource: est.source === "unknown" ? "unknown" : est.source,
        ...(balance != null && est.credits != null
          ? { currentBalance: balance, estimatedBalanceAfter: Math.max(0, balance - est.credits) }
          : balance != null ? { currentBalance: balance } : {}),
        confirmToken: this.mintConfirmToken(digest, idemKey),
        expiresInSeconds: Math.round(this.confirmTtlMs() / 1000),
        warnings: [...this.degradedWarnings(), ...adsorbedWarnings, ...driftWarning],
        hint: `本次 ${sig.mode === "image" ? "generate_image" : "create_video"}(provider=pixverse)将消耗订阅积分(09-14 终局裁决:CLI 无 Relax 免费池,Standard 无免费白名单 —— qwen-image 实扣 5/10cr)。预估 ${est.credits == null ? "未知(以实际扣减为准;缺失≠免费)" : `${est.credits} 积分(${est.source === "ledger" ? "账本观测值" : "静态首估"})`}。确认请用原参数加 confirmToken 重新调用;model/quality/duration/count/prompt/输入引用任一变化都会使令牌失效;令牌单次消费。config 顶级 pixverse.confirm=false 可关闭本门(不推荐)。`,
      };
    }
    const idemHex = this.verifyConfirmToken(confirmToken, digest);
    // 登记:提交路径按 digest 匹配提取 idemKeyBase(n>1 fan-out 时派生 -k<i> 子键)
    this.confirmed.set(digest, { idemKeyBase: idemHex, seq: 0, expiresAt: Date.now() + this.confirmTtlMs() });
    return undefined;
  }

  /** 已确认请求的幂等键(未过门且门开 → 抛 S323 提示走两段式;n=1 直用 base)。 */
  private takeIdemKey(digest: string, suffixIndex?: number): string {
    const ctx = this.confirmed.get(digest);
    if (!ctx) {
      if (!this.confirmEnabled()) return crypto.randomUUID(); // 门显式关闭:每次随机
      throw new PixverseError("S323", "本请求未过计费确认门(须先不带 confirmToken 调用获取挑战,再带令牌复调)", { hint: "两段式:第一段返回 needConfirm+confirmToken;第二段原参数+令牌提交" });
    }
    if (ctx.expiresAt < Date.now()) {
      this.confirmed.delete(digest);
      throw new PixverseError("S323", "确认已过期(令牌 TTL 窗口外提交)", { hint: "重新走两段式确认" });
    }
    const i = suffixIndex ?? ctx.seq++;
    return suffixIndex == null && i === 0 ? ctx.idemKeyBase : `${ctx.idemKeyBase}-k${i}`;
  }

  // ── 图像(E 必加:图像也过门 —— 09-14 终局裁决 CLI 生图走计费通道) ──

  /**
   * 图像提交主路径:能力吸附 → 门校验 → `create image --no-wait` → 自轮询 → outputs。
   * 测试铁律:测试不得让本方法 spawn 真实 CLI(stub transport 除外)。
   */
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    return this.attachNotes(await this.withToolDeadline(this.generateImageUnbounded(req), "pixverse 生图"));
  }

  private async generateImageUnbounded(req: ImageRequest): Promise<ImageResult> {
    await this.ensureCli();
    const warnings: string[] = [...this.degradedWarnings()];
    const model = req.model ?? this.cfgModels?.image?.default ?? "gpt-image-2.5-flare";
    if (!PIXVERSE_IMAGE_MODELS.includes(model)) {
      throw new PixverseError("S300", `未知图片模型 "${model}"。可用:${PIXVERSE_IMAGE_MODELS.join(", ")}`);
    }
    const cap = await this.capability("image", model);
    // 比例:一等 aspect > size 最近似(handler 默认 size "1024x1024" 视为无信号 → CLI 模型默认)
    let aspect: string | undefined = req.aspect;
    if (!aspect && req.size && req.size !== "1024x1024") {
      aspect = aspectFromSize(req.size);
      if (aspect) warnings.push(`size="${req.size}" 已映射为比例 ${aspect}(pixverse 按比例出图,无像素尺寸参数)。`);
    }
    const adsAspect = adsorbParam(cap, "aspect_ratio", aspect, "aspect");
    if (adsAspect.warning) warnings.push(adsAspect.warning);
    const adsQuality = adsorbParam(cap, "quality", req.quality, "quality");
    if (adsQuality.warning) warnings.push(adsQuality.warning);
    const n = req.n && req.n > 1 ? req.n : 1;
    // 🔴 仓库契约:provider 忽略 n,工具层并发 fan-out(每调用 count=1);n 只进计费摘要/预估。
    const adsCount = adsorbParam(cap, "count", n, "n");
    if (adsCount.warning && n > 1) warnings.push(adsCount.warning);
    // 输入:image(单参考)/ images(多参考;[0]=base)。data: URI → 临时文件(CLI 只吃 local_path/https/asset_id/media_path)
    const inputs: string[] = [];
    const tempFiles: string[] = [];
    let imageFlag: string | undefined;
    let imagesFlag: string[] | undefined;
    const allInputs = [...(req.images ?? [])];
    for (const u of allInputs) {
      const prepared = await this.prepareMediaInput(u, tempFiles, warnings);
      inputs.push(prepared.value);
      if (allInputs.length === 1) imageFlag = prepared.value;
      else (imagesFlag ??= []).push(prepared.value);
    }
    // 门校验(确认上下文按 digest 匹配 —— handler 已在提交前过门)。签名含能力默认值
    // (未传 quality 时 CLI 用模型默认;键一致性保证 ledger 写读对齐)。
    const sig = {
      mode: "image" as const, model,
      quality: (adsQuality.value ?? capDefault(cap, "quality")) as string | undefined,
      durationSeconds: undefined, count: n, prompt: req.prompt,
      inputs: allInputs,
    };
    const digest = this.confirmDigest(sig);
    const idemKey = this.takeIdemKey(digest);
    try {
      const args = ["create", "image", "--prompt", req.prompt, "--model", model, "--idempotency-key", idemKey, "--no-wait"];
      if (adsQuality.value) args.push("--quality", String(adsQuality.value));
      if (adsAspect.value) args.push("--aspect-ratio", String(adsAspect.value));
      if (imageFlag) args.push("--image", imageFlag);
      if (imagesFlag?.length) args.push("--images", ...imagesFlag);
      if (req.seed != null) args.push("--seed", String(req.seed));
      const submitted = await this.submitWithRetry(args, { mode: "image", model, count: 1 });
      const ids = collectTaskIds(submitted).map(String);
      if (!ids.length) {
        throw new PixverseError("S202", `提交响应无 image_id(s):${JSON.stringify(submitted).slice(0, 200)}`);
      }
      // 提交响应 resolved 参数 diff(1.1.8+ 含 resolved params;防御性形状探测)
      this.warnResolvedDrift(submitted, { quality: adsQuality.value, aspect_ratio: adsAspect.value }, warnings);
      const finished = await this.pollTasks(ids, "image");
      const outputs: ImageOutput[] = [];
      const w: string[] = [];
      for (const t of finished.done) {
        if (t.image_url) outputs.push({ url: t.image_url });
        else w.push(`image_id ${t.id} 已完成但无 image_url`);
      }
      for (const f of finished.failed) w.push(`image_id ${f.id} 生成失败(${f.status_code ?? "?"}${f.status ? "," + f.status : ""})。`);
      // 成本观测(asset list cost_credits;缺失≠免费)
      await this.observeCost("image", model, adsQuality.value as string | undefined, undefined, true, 1, ids, warnings);
      warnings.push(...w);
      if (finished.timeout.length && !outputs.length) {
        throw new PixverseError("S410",
          `图片生成超过工具层截止仍未完成(任务:${finished.timeout.join(",")};底层不取消)`,
          { hint: `稍后复查:npx pixverse@${PIXVERSE_PINNED_VERSION} task status <id> --type image(Relax 语义已被 09-14 裁决作废 —— 计费通道,慢速队列可能分钟级)` });
      }
      if (finished.timeout.length) {
        warnings.push(`${finished.timeout.length} 张超时未到终态(${finished.timeout.join(",")});稍后 npx pixverse@${PIXVERSE_PINNED_VERSION} task status <id> --type image 复查。`);
      }
      if (!outputs.length) {
        throw new PixverseError("S400", `图像生成失败(0 张产出;任务:${ids.join(",")})`, { hint: "任务详情可经 task status 复查" });
      }
      return { outputs, warnings: warnings.length ? warnings : undefined, raw: { submitted, tasks: finished } };
    } finally {
      await cleanupTempFiles(tempFiles);
    }
  }

  /** 媒体输入准备:data: URI → 临时文件;https 原样;纯数字 asset_id 原样;其他(本地路径形态)原样交 CLI(CLI 支持本地路径)。 */
  private async prepareMediaInput(u: string, tempFiles: string[], _warnings: string[]): Promise<{ value: string }> {
    const uri = String(u ?? "").trim();
    if (/^data:/i.test(uri)) {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(uri);
      if (!m) throw new PixverseError("S301", `data: URI 格式非法(前 60 字符:${uri.slice(0, 60)})`);
      const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
      if (!bytes.length) throw new PixverseError("S301", "data: URI 图片字节为空");
      const sniffed = sniffImage(bytes);
      const ext = sniffed.mimeType === "image/png" ? "png" : sniffed.mimeType === "image/webp" ? "webp" : sniffed.mimeType === "image/gif" ? "gif" : "jpg";
      const tmp = path.join(os.tmpdir(), `pixverse-mcp-${crypto.randomUUID()}.${ext}`);
      fs.writeFileSync(tmp, bytes);
      tempFiles.push(tmp);
      return { value: tmp };
    }
    if (/^https:\/\//i.test(uri)) return { value: uri }; // http:// 被 CLI 拒绝(手册 §3.5)
    if (/^http:\/\//i.test(uri)) {
      throw new PixverseError("S301", `images 输入 http:// 被 pixverse CLI 拒绝(仅 https:// / 本地路径 / asset_id / media_path):"${uri.slice(0, 60)}"`);
    }
    return { value: uri };
  }

  /** 视频生成通用提交(文生/图生)。 */
  async createVideo(req: VideoRequest): Promise<VideoTask> {
    return this.attachNotes(await this.withToolDeadline(this.createVideoUnbounded(req), "pixverse 视频提交"));
  }

  private async createVideoUnbounded(req: VideoRequest): Promise<VideoTask> {
    await this.ensureCli();
    const warnings: string[] = [...this.degradedWarnings()];
    const model = req.model ?? this.cfgModels?.video?.default ?? "v6";
    if (!PIXVERSE_VIDEO_MODELS.includes(model)) {
      throw new PixverseError("S300", `未知视频模型 "${model}"。可用:${PIXVERSE_VIDEO_MODELS.join(", ")}`);
    }
    const cap = await this.capability("video", model);
    // duration:durationSeconds 一等;否则 numFrames/frameRate 换算
    let duration: number | undefined = req.durationSeconds;
    if (duration == null && req.numFrames != null) {
      duration = Math.round(req.numFrames / (req.frameRate ?? 24));
    }
    const adsDur = adsorbParam(cap, "duration", duration, "duration");
    if (adsDur.warning) warnings.push(adsDur.warning);
    // resolution(480p/720p/1080p)→ quality 枚举最近似
    let quality: string | undefined = req.resolution;
    if (quality === "480p") quality = "540p"; // CLI 主流枚举无 480p(除 seedance/grok;吸附逻辑兜底)
    const adsQ = adsorbParam(cap, "quality", quality, "resolution→quality");
    if (adsQ.warning) warnings.push(adsQ.warning);
    // ratio → aspect_ratio
    const adsRatio = adsorbParam(cap, "aspect_ratio", req.ratio, "ratio");
    if (adsRatio.warning) warnings.push(adsRatio.warning);
    // negativePrompt 拼进 prompt(手册铁律 3:CLI 无 --negative-prompt)
    let prompt = req.prompt;
    if (req.negativePrompt?.trim()) {
      prompt = `${req.prompt}\n\n(Avoid: ${req.negativePrompt.trim()})`;
      warnings.push("pixverse CLI 无 negative-prompt,已折叠进 prompt 文本尾部((Avoid: …)形式)。");
    }
    // 输入形态(P1:image 单图 i2v;keyframes/multi-ref → P2 S301)
    const tempFiles: string[] = [];
    let imageFlag: string | undefined;
    const inputRefs: string[] = [];
    if (req.image) {
      const prepared = await this.prepareMediaInput(req.image, tempFiles, warnings);
      imageFlag = prepared.value;
      inputRefs.push(req.image);
    } else if (req.keyframes?.length) {
      throw new PixverseError("S301", "keyframes(首尾帧 = CLI transition 模式)为 P2 未接入(MVP 分期:E 裁决 P1 = create image/video)", { hint: "P1 开放:文生视频(prompt)/图生视频(image);首尾帧/多参考(reference)/voice/music/extend/modify/upscale 见 doc/PixVerse-provider集成.md P2 计划" });
    } else if (req.images?.length) {
      throw new PixverseError("S301", "多参考图视频(CLI reference 模式)为 P2 未接入(MVP 分期)", { hint: "P1 图生视频用 image(单图)" });
    }
    if (model === "grok-imagine-1.5" && !imageFlag) {
      throw new PixverseError("S301", "grok-imagine-1.5 仅图生视频(README:requires --image)", { hint: "换 image 输入或其他模型" });
    }
    const audio = req.extra?.audio === false ? false : true;
    const sig = {
      mode: "video" as const, model,
      quality: (adsQ.value ?? capDefault(cap, "quality")) as string | undefined,
      durationSeconds: typeof adsDur.value === "number"
        ? adsDur.value
        : typeof capDefault(cap, "duration") === "number" ? (capDefault(cap, "duration") as number) : undefined,
      count: 1, audio, offPeak: false, prompt: req.prompt, negativePrompt: req.negativePrompt,
      inputs: inputRefs,
    };
    const digest = this.confirmDigest(sig);
    const idemKey = this.takeIdemKey(digest);
    try {
      const args = ["create", "video", "--prompt", prompt, "--model", model, "--idempotency-key", idemKey, "--no-wait"];
      if (typeof adsDur.value === "number") args.push("--duration", String(adsDur.value));
      if (adsQ.value) args.push("--quality", String(adsQ.value));
      if (adsRatio.value) args.push("--aspect-ratio", String(adsRatio.value));
      if (imageFlag) args.push("--image", imageFlag);
      if (req.seed != null) args.push("--seed", String(req.seed));
      args.push(audio ? "--audio" : "--no-audio");
      const submitted = await this.submitWithRetry(args, { mode: "video", model, count: 1, durationSeconds: sig.durationSeconds, audio });
      const ids = collectTaskIds(submitted).map(String);
      if (!ids.length) {
        throw new PixverseError("S202", `提交响应无 video_id(s):${JSON.stringify(submitted).slice(0, 200)}`);
      }
      this.warnResolvedDrift(submitted, { quality: adsQ.value, duration: adsDur.value, aspect_ratio: adsRatio.value }, warnings);
      return { taskId: ids[0], status: "queued", warnings: warnings.length ? warnings : undefined, raw: submitted };
    } finally {
      await cleanupTempFiles(tempFiles);
    }
  }

  /** 提交 + exit-7 退避重试(5s/10s/20s ×3,复用同 idempotency key,不过门 —— 已确认过)。 */
  private async submitWithRetry(args: string[], ctx: { mode: "video" | "image"; model: string; count: number; durationSeconds?: number; audio?: boolean }): Promise<any> {
    const backoffs: number[] = (this as any).backoffsForTests ?? [5_000, 10_000, 20_000]; // 测试缝:注入短退避防 15s 真等 // 测试缝:注入短退避防 15s 真等
    let attempt = 0;
    for (;;) {
      const r = await this.transport.run(args, { timeoutMs: SPAWN_TIMEOUT_MS });
      if (r.code === 0) {
        const j = extractJson(r.stdout);
        if (!j) throw new PixverseError("S202", `CLI exit 0 但 stdout 非 JSON:${r.stdout.slice(0, 160)}`);
        return j;
      }
      const m = mapCliFailure(r.code, r.stdout, r.stderr, ctx);
      if ("payload" in m) return m.payload; // partial / timeout-recovered 一等公民载荷
      if (m.error.code === "S403" && attempt < backoffs.length) {
        // CONCURRENCY_LIMIT:退避后同 key 重试(幂等键语义:同逻辑请求重试复用)
        pushNote(this.transport, `并发额度满(exit 7):退避 ${backoffs[attempt] / 1000}s 后以同一 idempotency key 重试(${attempt + 1}/${backoffs.length})`);
        await sleep(backoffs[attempt]);
        attempt++;
        continue;
      }
      throw m.error;
    }
  }

  /** 提交响应 resolved 参数漂移检测(1.1.8+ 含 resolved params;形状未 live 定型 → 防御性探测常见位置)。 */
  private warnResolvedDrift(submitted: any, requested: Record<string, unknown>, warnings: string[]): void {
    const resolved = submitted?.resolved ?? submitted?.resolved_params ?? submitted?.params;
    if (!resolved || typeof resolved !== "object") return;
    for (const [k, v] of Object.entries(requested)) {
      const rv = (resolved as any)[k];
      if (rv !== undefined && v !== undefined && String(rv) !== String(v)) {
        warnings.push(`CLI resolved 参数 ${k}="${rv}" ≠ 请求值 "${v}"(on_invalid=adjust 静默改账单参数 —— 以 resolved 为准,预估可能偏低)。`);
      }
    }
  }

  /**
   * 自轮询(--no-wait 后):2/5/10s 梯度循环;done=1 收 URL;retry=5,9,10 继续;failed=7,8 终态。
   * deadline 到 → 返回 {done, failed, timeout}(图像路径由调用方决定报错或提示复查)。
   */
  private async pollTasks(ids: string[], type: "video" | "image", deadlineMs?: number): Promise<{
    done: any[]; failed: any[]; timeout: string[];
  }> {
    const deadline = Date.now() + (deadlineMs ?? this.toolDeadlineMs() - 5_000);
    const pending = new Set(ids);
    const done: any[] = []; const failed: any[] = []; const timeout: string[] = [];
    let tick = 0;
    for (;;) {
      for (const id of [...pending]) {
        let t: any;
        try {
          t = await this.taskStatus(id, type);
        } catch (e) {
          if (e instanceof PixverseError && (e.code === "S406" || e.code === "S404")) {
            failed.push({ id, error: e.message });
            pending.delete(id);
            continue;
          }
          throw e;
        }
        const sc = Number(t?.status_code ?? t?.status);
        if (sc === PIXVERSE_STATUS_DONE) { done.push(t); pending.delete(id); }
        else if (PIXVERSE_STATUS_FAILED.has(sc)) { failed.push({ id, ...t }); pending.delete(id); }
        // retry(5,9,10)或其他未知 → 继续
      }
      if (!pending.size) return { done, failed, timeout };
      if (Date.now() >= deadline) { timeout.push(...pending); return { done, failed, timeout }; }
      await sleep(PIXVERSE_POLL_INTERVALS_MS[Math.min(tick, PIXVERSE_POLL_INTERVALS_MS.length - 1)]);
      tick++;
    }
  }

  /** 成本观测(asset list 匹配 id → cost_credits;缺失≠免费;best-effort)。 */
  private async observeCost(
    mode: "video" | "image", model: string, quality: string | undefined, durationSeconds: number | undefined,
    audio: boolean, count: number, ids: string[], warnings: string[],
  ): Promise<void> {
    try {
      const items = await this.assetList(mode);
      const byId = new Map(items.map((it) => [String(it.id ?? it.asset_id ?? it.image_id ?? it.video_id), it]));
      let observed: number | undefined;
      for (const id of ids) {
        const it = byId.get(String(id));
        if (typeof it?.cost_credits === "number") { observed = (observed ?? 0) + it.cost_credits; }
      }
      if (observed != null) {
        this.recordCost({ mode, model, quality, durationSeconds, audio, count }, observed, "asset-list");
      } else {
        warnings.push("CLI 响应未回报本次 cost_credits(缺失≠免费);以实际扣减为准,预估未落账本。");
      }
    } catch { /* 观测失败不阻断 */ }
  }

  // ── 计费确认门(handler 提交点前调用;图像门 = E 必加「门覆盖全模式」) ──
  // 模态经钩子名显式表达(types.ts P0-2 判别显式化):两个钩子各自把模态传给 gateImpl,
  // 无请求形状猜测(最小合法 VideoRequest {prompt, model} 曾被旧 looksLikeVideoRequest 误判)。

  async beginImageSubmissionConfirm(req: ImageRequest & { n?: number }, confirmToken?: string): Promise<SubmissionConfirm | undefined> {
    // 门显式关闭 → undefined(直接提交,幂等键走随机路径)
    if (!this.confirmEnabled()) return undefined;
    await this.ensureCli();
    const warnings: string[] = [...this.degradedWarnings()];
    const model = req.model ?? this.cfgModels?.image?.default ?? "gpt-image-2.5-flare";
    if (!PIXVERSE_IMAGE_MODELS.includes(model)) {
      throw new PixverseError("S300", `未知图片模型 "${model}"。可用:${PIXVERSE_IMAGE_MODELS.join(", ")}`);
    }
    // 挑战前能力预吸附(E:实证 on_invalid=adjust 会静默改账单参数)
    const cap = await this.capability("image", model);
    let aspect: string | undefined = req.aspect;
    if (!aspect && req.size && req.size !== "1024x1024") aspect = aspectFromSize(req.size);
    const adsAspect = adsorbParam(cap, "aspect_ratio", aspect, "aspect");
    if (adsAspect.warning) warnings.push(adsAspect.warning);
    const adsQuality = adsorbParam(cap, "quality", req.quality, "quality");
    if (adsQuality.warning) warnings.push(adsQuality.warning);
    const n = req.n && req.n > 1 ? req.n : 1;
    const adsCount = adsorbParam(cap, "count", n, "n");
    if (adsCount.warning && n > 1) warnings.push(adsCount.warning);
    const sig = {
      mode: "image" as const, model,
      quality: (adsQuality.value ?? capDefault(cap, "quality")) as string | undefined,
      durationSeconds: undefined, count: n, prompt: req.prompt, inputs: req.images ?? [],
    };
    return this.gateImpl(sig, warnings, confirmToken);
  }

  async beginVideoSubmissionConfirm(req: VideoRequest, confirmToken?: string): Promise<SubmissionConfirm | undefined> {
    // 门显式关闭 → undefined(直接提交,幂等键走随机路径)
    if (!this.confirmEnabled()) return undefined;
    await this.ensureCli();
    const warnings: string[] = [...this.degradedWarnings()];
    const model = req.model ?? this.cfgModels?.video?.default ?? "v6";
    if (!PIXVERSE_VIDEO_MODELS.includes(model)) {
      throw new PixverseError("S300", `未知视频模型 "${model}"。可用:${PIXVERSE_VIDEO_MODELS.join(", ")}`);
    }
    const cap = await this.capability("video", model);
    let duration: number | undefined = req.durationSeconds;
    if (duration == null && req.numFrames != null) duration = Math.round(req.numFrames / (req.frameRate ?? 24));
    const adsDur = adsorbParam(cap, "duration", duration, "duration");
    if (adsDur.warning) warnings.push(adsDur.warning);
    let quality: string | undefined = req.resolution;
    if (quality === "480p") quality = "540p";
    const adsQ = adsorbParam(cap, "quality", quality, "resolution→quality");
    if (adsQ.warning) warnings.push(adsQ.warning);
    const adsRatio = adsorbParam(cap, "aspect_ratio", req.ratio, "ratio");
    if (adsRatio.warning) warnings.push(adsRatio.warning);
    // P2 输入形态在门口即拒(不让用户确认一个注定 S301 的请求)
    if (req.keyframes?.length) {
      throw new PixverseError("S301", "keyframes(transition)为 P2 未接入(MVP 分期)", { hint: "P1 开放:文生视频(prompt)/图生视频(image)" });
    }
    if (req.images?.length) {
      throw new PixverseError("S301", "多参考图(reference)为 P2 未接入(MVP 分期)", { hint: "P1 图生视频用 image(单图)" });
    }
    const audio = req.extra?.audio === false ? false : true;
    const sig = {
      mode: "video" as const, model,
      quality: (adsQ.value ?? capDefault(cap, "quality")) as string | undefined,
      durationSeconds: typeof adsDur.value === "number"
        ? adsDur.value
        : typeof capDefault(cap, "duration") === "number" ? (capDefault(cap, "duration") as number) : undefined,
      count: 1, audio, offPeak: false, prompt: req.prompt, negativePrompt: req.negativePrompt,
      inputs: req.image ? [req.image] : [],
    };
    return this.gateImpl(sig, warnings, confirmToken);
  }

  // ── 取件(零消耗 task status;getVideo 底层) ──

  async getVideo(handle: VideoHandle): Promise<VideoResult> {
    return this.attachNotes(await this.withToolDeadline(this.getVideoUnbounded(handle), `pixverse 取件 ${handle.taskId ?? handle.videoId ?? ""}`.trim()));
  }

  private async getVideoUnbounded(handle: VideoHandle): Promise<VideoResult> {
    const id = handle.taskId ?? handle.videoId;
    if (!id) throw new PixverseError("S301", "getVideo 需要 taskId(pixverse video_id)");
    await this.ensureCli();
    const t = await this.taskStatus(String(id), "video");
    const sc = Number(t?.status_code ?? t?.status);
    const raw = { id: t?.id ?? id, rawStatus: t?.status, model: t?.model, prompt: t?.prompt, duration: t?.duration };
    if (sc === PIXVERSE_STATUS_DONE && typeof t?.video_url === "string" && t.video_url) {
      // 成本观测 best-effort(完成后;不影响取件)
      try {
        const items = await this.assetList("video");
        const it = items.find((x) => String(x.id ?? x.video_id) === String(id));
        if (typeof it?.cost_credits === "number" && it.model) {
          this.recordCost({ mode: "video", model: it.model, quality: it.quality, durationSeconds: it.duration, audio: it.audio === 1, count: 1 }, it.cost_credits, "asset-list");
        }
      } catch { /* 观测失败不阻断 */ }
      return { status: "completed", url: t.video_url, raw };
    }
    if (PIXVERSE_STATUS_FAILED.has(sc)) {
      return { status: "failed", error: `生成失败(status_code=${sc}${t?.status ? "," + t.status : ""})`, raw };
    }
    if (PIXVERSE_STATUS_RETRY.has(sc)) {
      return { status: "in_progress", raw };
    }
    return { status: "in_progress", raw };
  }
}

async function cleanupTempFiles(tempFiles: string[]): Promise<void> {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* 已清理/不可达 */ }
  }
}
