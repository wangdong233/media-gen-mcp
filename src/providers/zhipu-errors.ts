// src/providers/zhipu-errors.ts
/**
 * 智谱 API 错误分类器(业务码分流,pares7)。
 *
 * 独立模块 **不放 http.ts**(review high:http.ts 是 generic 基础设施,
 * 装 provider 私有业务码会触发 R-ABS-01 反向违例 —— generic 模块不该持有 provider 私有知识)。
 *
 * 智谱限额信号(调研 A 维度 + 附录 2):HTTP 429 + body.error.code 业务码细分(非标准 Retry-After 头)。
 *   - 瞬态(重试同 key 或跨 provider fallback,不动 key 状态):1302 并发超限也可切 key,见下
 *   - key 短期冷却 → 切下一 key:1302 账号并发超限(多 key 不同账号可缓解)
 *   - key 永久耗尽 → 切下一 key:1113 欠费 / 1308·1310·1316·1317·1318 额度耗尽 / 1311 套餐不含模型 / 1313 公平策略
 *   - 401(1000/1001/1003):review P0 —— plain Bearer 直连 v4 未用真 key 100% 坐实前,
 *     401 按 transient(不 markExhausted),避免偶发 401 误永久禁用 key
 *   - 1305 平台过载 / 网络层 TypeError / 未知码 → transient(保守,不动 key)
 *   - 1211 模型退役 / 1208 内容审核 / 1303 QPM → transient(非 key 问题,换模型/改 prompt)
 */

export type ZhipuErrorClass =
  /** key 短期限额(1302 账号并发超限)→ markLimited + 切下一 key */
  | "key-cool"
  /** key 永久失效(额度耗尽/key 失效/套餐不含)→ markExhausted + 切下一 key */
  | "key-dead"
  /** 瞬态/平台过载/鉴权未验证/未知 → 不动 key 池(交 withRetry 或 provider 级 fallback) */
  | "transient";

/** 永久耗尽业务码(切下一 key)。来源:智谱 api-code.md + 附录 2 D2·6。 */
const KEY_DEAD_CODES = new Set<string>([
  "1113", // 账户欠费(粘性,充值)
  "1308", // 已达 N 单位上限(粘性,带 reset)
  "1310", // 每周/每月上限(粘性,本次调研 1310 反向坐实 Code Plan 周配额)
  "1316", // 5 小时上限
  "1317", // 7 天上限
  "1318", // 子账号上限
  "1311", // 订阅套餐不含该模型(切 key 或降级模型)
  "1313", // 公平使用策略被限(账号级长规避)
]);

/** 短期冷却业务码(切下一 key 缓解)。 */
const KEY_COOL_CODES = new Set<string>([
  "1302", // 账号速率/并发超限(瞬态,多 key 不同账号可缓解)
]);

/**
 * 分类智谱错误。接收完整 error 对象(非 body)—— review critical:
 * 网络层 TypeError/status=0 走 transient(不动 key 池,交 withRetry);
 * 未知 body.error.code 默认 transient(保守,不 markExhausted,review condition)。
 */
export function classifyZhipuError(e: any): ZhipuErrorClass {
  // 网络层(无 HTTP 响应):TypeError / status=0
  if (e?.name === "TypeError" || e?.status === 0) return "transient";
  const code = String(e?.body?.error?.code ?? e?.body?.code ?? "");
  if (KEY_DEAD_CODES.has(code)) return "key-dead";
  if (KEY_COOL_CODES.has(code)) return "key-cool";
  // 401(1000/1001/1003):review P0 保守 transient(Bearer 未坐实前不 markExhausted)
  // 1305 平台过载 / 1211 模型退役 / 1208 内容审核 / 1303 QPM / 未知码 → transient
  return "transient";
}
