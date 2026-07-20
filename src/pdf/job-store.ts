// src/pdf/job-store.ts
/**
 * 进程内 PDF 异步任务存储(pares6 PDF 管线)。
 *
 * 设计(参 doc_v10/pares6/pdf-pipeline.md §2.3 / §4.2 / §4.4):
 * - 单租户 MCP server 每 CC 会话一个进程,无跨进程共享需求 → Map 足够(参 video 模态的 waitVideo)
 * - TTL 30min(默认;config.pdf.jobTtlMs 可调),后台 sweeper 每 5min 清理过期
 * - fire-and-forget:extract_pdf 异步分支注册后立即返回 handle,pipeline.ts 后台 run
 * - 进度回写:每页完成时调用 onProgress 回调(setProgress)(进度推送由 pipeline 持有 emitProgress)
 *
 * 状态机:registered → in_progress → completed | failed
 *   - registered:刚注册尚未启动(in_progress 由 runPdfPipeline 主动 set)
 *   - in_progress:正在渲染/识别中
 *   - completed:pages 全部完成(可能含 perPageWarnings,但任务本身成功)
 *   - failed:致命错误(render 失败 / 所有页均失败)
 *
 * 内存安全(风险 R7):完成后 job 仍保 TTL 内供 get_pdf 读取;过期 sweeper 释放。
 * perPageWarnings 不计页数:即使一页 OCR 失败也有 pageResult,任务保持 completed。
 */
import { config } from "../config.js";
import type { TextBlock } from "../providers/types.js";

/** 单页产出(对齐 extract_text handler 的 VisionResult 形状,但 page 维度在外层)。 */
export interface PdfPageResult {
  page: number;
  /** OCR 后该页全文(text-layer 快路径直接用;OCR 路径为 recognize 后处理拼接) */
  text: string;
  /** OCR 路径有 blocks(text-layer 路径无);outputFormat=json 时透传 */
  blocks?: TextBlock[];
  /** 该页警告(provider fallback / ignoreAreas 剔除 / TBPU 降级等) */
  warnings?: string[];
  /** 该页失败标志(单页失败不影响整体 completed,但用户可见) */
  failed?: boolean;
}

export type PdfJobStatus = "registered" | "in_progress" | "completed" | "failed";

export interface PdfJob {
  id: string;
  source: string;
  /** 输入参数快照(供 get_pdf 重算落盘/诊断) */
  input: {
    pageRange?: string;
    textStrategy: "auto" | "ocr-only" | "text-layer-only";
    languages?: string[];
    digitOnly?: boolean;
    segmentation?: string;
    layout?: string;
    ignoreAreas?: unknown;
    mergePages?: boolean;
    outputFormat?: string;
    scale?: number;
    provider?: string;
    name?: string;
    outDir?: string;
    download?: boolean;
  };
  status: PdfJobStatus;
  /** 已完成页数(进度推送用) */
  done: number;
  /** 目标页数(pageRange 解析后) */
  total: number;
  /** 进度百分比 0-100 */
  progress: number;
  /** 已产出页(顺序 = pageRange 解析后的目标顺序,不是源页码顺序) */
  pages: PdfPageResult[];
  warnings: string[];
  /** 错误详情(status=failed 时) */
  error?: string;
  /** 创建时间(ms,用于 TTL) */
  createdAt: number;
  /** 最后活跃时间(每次 update 刷新) */
  updatedAt: number;
  /** provider 实际选用(extract_pdf 异步分支返回的 provider_used,防 get_pdf 时错位) */
  providerUsed?: string;
}

const store = new Map<string, PdfJob>();

/** TTL(默认 30min)。 */
const TTL_MS = config.pdf?.jobTtlMs ?? 30 * 60 * 1000;
/** sweeper 间隔(默认 5min)。 */
const SWEEP_INTERVAL_MS = Math.min(TTL_MS, 5 * 60 * 1000);

// 后台 sweeper:setInterval 每隔一段时间清理过期任务(无需 unref 也可:MCP server 长驻;
// 但为防测试脚本 pin 事件循环,加 unref)
let sweeperTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweeper(): void {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of store) {
      if (now - job.updatedAt > TTL_MS) {
        store.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweeperTimer.unref?.(); // 不阻止 Node 退出(测试/独立脚本场景)
}

/** 注册新 job,返回 id(handle)。 */
export function registerPdfJob(source: string, input: PdfJob["input"], total: number): string {
  const id = `pdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const job: PdfJob = {
    id,
    source,
    input,
    status: "registered",
    done: 0,
    total,
    progress: 0,
    pages: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
  store.set(id, job);
  ensureSweeper();
  return id;
}

/** 读取 job(不存在返 undefined;调用方决定如何反馈)。 */
export function getPdfJob(id: string): PdfJob | undefined {
  return store.get(id);
}

/** 更新 job 的部分字段(浅合并)。 */
export function updatePdfJob(id: string, patch: Partial<PdfJob>): PdfJob | undefined {
  const j = store.get(id);
  if (!j) return undefined;
  Object.assign(j, patch);
  j.updatedAt = Date.now();
  return j;
}

/** 推一页结果 + 重算进度。 */
export function pushPageResult(id: string, page: PdfPageResult): PdfJob | undefined {
  const j = store.get(id);
  if (!j) return undefined;
  j.pages.push(page);
  j.done = j.pages.length;
  j.progress = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
  j.updatedAt = Date.now();
  return j;
}

/** 显式删除(测试用,API 层不调用)。 */
export function deletePdfJob(id: string): void {
  store.delete(id);
}

/** 测试用:停 sweeper 防 pin 事件循环。 */
export function shutdownPdfJobStoreForTest(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
  store.clear();
}
