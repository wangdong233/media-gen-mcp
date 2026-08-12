/**
 * extract-image-meta —— 从 PNG/AI 生成图提取嵌入的生成参数(提示词逆向)。
 *
 * 纯本地解析 PNG tEXt/iTXt/zTXt chunks:
 *   - ComfyUI API workflow(keyword="prompt",JSON)→ 提取正向/负向 prompt、模型、采样、seed、尺寸
 *   - ComfyUI full workflow(keyword="workflow",JSON)→ 原始图结构(includeRaw 时)
 *   - A1111 WebUI(keyword="parameters",多行文本)→ 正则解析正负向 + Steps/CFG/Seed/Model/Size
 * 与 generate_image 闭环:Agnes 后端跑 ComfyUI,产物 PNG 嵌完整 workflow → 本工具逆向出 prompt/参数。
 * 零 AI、零网络(除非 imageSource 是 URL,需 fetch)。
 *
 * License:P0-6 自研(标准 PNG chunk 解析 + ComfyUI/A1111 启发式,无第三方源码引用)。
 */
import { readFileSync, existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import * as zlib from "node:zlib";

export interface ExtractImageMetaRequest {
  /** 图片源:本地路径 / data URI / http(s) URL。PNG 最丰富(嵌 ComfyUI/A1111 元数据)。 */
  imageSource: string;
  /** 是否返回原始 workflow JSON(默认 false,仅结构化摘要)。 */
  includeRaw?: boolean;
}

export interface PngTextChunk {
  keyword: string;
  type: "tEXt" | "iTXt" | "zTXt";
  text: string;
}

export interface ImageMetaResult {
  /** 检测到的生成器(ComfyUI / A1111 / 无嵌入元数据)。 */
  generator: "ComfyUI" | "A1111" | "none";
  positivePrompt?: string;
  negativePrompt?: string;
  model?: string;
  sampler?: string;
  steps?: number;
  cfg?: number;
  scheduler?: string;
  /** 种子(ComfyUI 可能是大数;A1111 是数字串,用 string 兜底)。 */
  seed?: number | string;
  size?: { width: number; height: number };
  /** 所有 text chunk 的摘要(keyword/type/preview)。 */
  chunks: { keyword: string; type: string; textPreview: string }[];
  /** 原始 workflow JSON object,includeRaw=true 时。 */
  rawWorkflow?: unknown;
  warnings: string[];
}

/** 读图片源 → Buffer(本地路径 / data URI / URL)。 */
async function readImageBuffer(source: string): Promise<Buffer> {
  const s = source.trim();
  if (s.startsWith("data:")) {
    const m = s.match(/^data:[^;]*;base64,(.*)$/s);
    if (m) return Buffer.from(m[1], "base64");
    throw new Error("data URI 必须是 base64 编码(data:image/png;base64,...)");
  }
  if (s.startsWith("http://") || s.startsWith("https://")) {
    const res = await fetch(s);
    if (!res.ok) throw new Error(`URL fetch 失败 (${res.status}): ${s}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!existsSync(s)) throw new Error(`文件不存在: ${s}`);
  return readFileSync(s);
}

/** 解析 PNG 所有 text chunk(tEXt/iTXt/zTXt);非 PNG 返回空数组。 */
function parsePngTextChunks(buf: Buffer): PngTextChunk[] {
  const chunks: PngTextChunk[] = [];
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return chunks;
  }
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("latin1", o + 4, o + 8);
    if (o + 8 + len > buf.length) break; // 截断防越界
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      if (nul >= 0) chunks.push({ keyword: data.toString("latin1", 0, nul), type: "tEXt", text: data.toString("utf8", nul + 1) });
    } else if (type === "iTXt") {
      const nul = data.indexOf(0);
      if (nul >= 0) {
        const keyword = data.toString("latin1", 0, nul);
        let p = nul + 1;
        const compFlag = data[p]; p += 2; // compFlag + compMethod
        const lt = data.indexOf(0, p);
        const tt = lt >= 0 ? data.indexOf(0, lt + 1) : -1;
        if (tt >= 0) {
          let text = data.toString("utf8", tt + 1);
          if (compFlag === 1) { try { text = zlib.inflateSync(data.subarray(tt + 1)).toString("utf8"); } catch { /* 降级原文 */ } }
          chunks.push({ keyword, type: "iTXt", text });
        }
      }
    } else if (type === "zTXt") {
      const nul = data.indexOf(0);
      if (nul >= 0) {
        const keyword = data.toString("latin1", 0, nul);
        try {
          const text = zlib.inflateSync(data.subarray(nul + 2)).toString("utf8");
          chunks.push({ keyword, type: "zTXt", text });
        } catch { /* 解压失败跳过 */ }
      }
    }
    o += 8 + len + 4; // length + type + data + crc
    if (type === "IEND") break;
  }
  return chunks;
}

/** ComfyUI workflow JSON 可能含 NaN/Infinity(JSON 非法,实测 ERNIE 产物含 is_changed: NaN),清洗后 parse。 */
function safeParseWorkflow(json: string): any | null {
  try { return JSON.parse(json); } catch {
    try { return JSON.parse(json.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null")); } catch { return null; }
  }
}

/** 解析 ComfyUI API workflow(节点图)→ 提取 prompt/模型/采样/seed/尺寸。 */
function parseComfyUI(workflow: any): Partial<ImageMetaResult> {
  const out: Partial<ImageMetaResult> = {};
  if (!workflow || typeof workflow !== "object") return out;
  const nodes = Object.values(workflow) as any[];
  const find = (cls: string) => nodes.filter((n) => n?.class_type === cls);

  const resolveText = (val: any, depth = 0): string | undefined => {
    if (typeof val === "string") return val;
    if (Array.isArray(val) && depth < 6) {
      const ref = workflow[val[0]];
      if (!ref) return undefined;
      if (typeof ref.inputs?.value === "string") return ref.inputs.value; // PrimitiveStringMultiline
      if (typeof ref.inputs?.text === "string") return ref.inputs.text; // CLIPTextEncode 明文
      return resolveText(ref.inputs?.text, depth + 1);
    }
    return undefined;
  };
  const resolveNum = (v: any): number | undefined => {
    if (typeof v === "number") return v;
    if (Array.isArray(v)) { const ref = workflow[v[0]]; return typeof ref?.inputs?.value === "number" ? ref.inputs.value : undefined; }
    return undefined;
  };

  // KSampler(采样参数)
  const ks = find("KSampler")[0] || find("KSamplerAdvanced")[0];
  if (ks?.inputs) {
    if (typeof ks.inputs.steps === "number") out.steps = ks.inputs.steps;
    if (typeof ks.inputs.cfg === "number") out.cfg = ks.inputs.cfg;
    if (typeof ks.inputs.sampler_name === "string") out.sampler = ks.inputs.sampler_name;
    if (typeof ks.inputs.scheduler === "string") out.scheduler = ks.inputs.scheduler;
    if (typeof ks.inputs.seed === "number") out.seed = ks.inputs.seed;
    // 正向/负向(positive/negative 引用链)
    if (ks.inputs.positive) out.positivePrompt = resolveText(ks.inputs.positive);
    if (ks.inputs.negative) out.negativePrompt = resolveText(ks.inputs.negative);
  }

  // seed 兜底:Seed 节点 / KSampler 引用
  if (out.seed === undefined) {
    const seedNode = nodes.find((n) => typeof n?.inputs?.seed === "number" && /seed/i.test(n._meta?.title ?? n.class_type ?? ""));
    if (seedNode) out.seed = seedNode.inputs.seed;
  }

  // 模型
  const ckpt = nodes.find((n) => typeof n?.inputs?.ckpt_name === "string");
  if (ckpt) out.model = ckpt.inputs.ckpt_name;

  // 正向/负向兜底:title 含 Positive/Negative 的 CLIPTextEncode
  if (!out.positivePrompt || !out.negativePrompt) {
    for (const n of find("CLIPTextEncode")) {
      const title = (n._meta?.title ?? "").toLowerCase();
      const t = typeof n.inputs?.text === "string" ? n.inputs.text : resolveText(n.inputs?.text);
      if (!t) continue;
      if (!out.positivePrompt && title.includes("positive")) out.positivePrompt = t;
      if (!out.negativePrompt && title.includes("negative")) out.negativePrompt = t;
    }
  }

  // 尺寸
  const eli = find("EmptyLatentImage")[0];
  if (eli?.inputs) {
    const w = resolveNum(eli.inputs.width);
    const h = resolveNum(eli.inputs.height);
    if (w && h) out.size = { width: w, height: h };
  }

  return out;
}

/** 解析 A1111 WebUI parameters(多行文本)→ 正负向 + Steps/CFG/Seed/Model/Size。 */
function parseA1111(text: string): Partial<ImageMetaResult> {
  const out: Partial<ImageMetaResult> = {};
  const negIdx = text.indexOf("\nNegative prompt:");
  if (negIdx >= 0) {
    out.positivePrompt = text.slice(0, negIdx).trim();
    const after = text.slice(negIdx + 1);
    const paramsLineIdx = after.search(/\n[A-Z][\w ]*:/);
    out.negativePrompt = (paramsLineIdx >= 0 ? after.slice(0, paramsLineIdx) : after).replace(/^Negative prompt:\s*/, "").trim();
  } else {
    const lines = text.trim().split("\n");
    const nonParam = lines.filter((l) => !/^[A-Z][\w ]*:/.test(l));
    if (nonParam.length) out.positivePrompt = nonParam.join(" ").trim();
  }
  const kv: Record<string, string> = {};
  const lastLine = text.trim().split("\n").pop() ?? "";
  for (const part of lastLine.split(",")) {
    const m = part.match(/^\s*([\w ]+):\s*(.+?)\s*$/);
    if (m) kv[m[1].trim().toLowerCase()] = m[2].trim();
  }
  if (kv.steps) out.steps = Number(kv.steps);
  if (kv["cfg scale"]) out.cfg = Number(kv["cfg scale"]);
  if (kv.sampler) out.sampler = kv.sampler;
  if (kv.seed) out.seed = kv.seed;
  if (kv.model) out.model = kv.model;
  if (kv.size && kv.size.includes("x")) {
    const [w, h] = kv.size.split("x").map(Number);
    if (w && h) out.size = { width: w, height: h };
  }
  return out;
}

export async function extractImageMeta(req: ExtractImageMetaRequest): Promise<ImageMetaResult> {
  const warnings: string[] = [];
  if (!req.imageSource || !req.imageSource.trim()) {
    throw new Error("imageSource 必填(本地路径 / data URI / URL)");
  }
  const buf = await readImageBuffer(req.imageSource);
  const chunks = parsePngTextChunks(buf);
  const result: ImageMetaResult = { generator: "none", chunks: [], warnings };

  if (chunks.length === 0) {
    warnings.push("未找到 PNG text chunk(可能不是 AI 生成图,或元数据被剥离)。");
  }
  for (const c of chunks) {
    result.chunks.push({
      keyword: c.keyword,
      type: c.type,
      textPreview: c.text.slice(0, 200) + (c.text.length > 200 ? `…(+${c.text.length - 200})` : ""),
    });
  }

  // 优先 ComfyUI(keyword=prompt),其次 A1111(keyword=parameters)
  const promptChunk = chunks.find((c) => c.keyword === "prompt");
  const workflowChunk = chunks.find((c) => c.keyword === "workflow");
  const paramsChunk = chunks.find((c) => c.keyword === "parameters");

  if (promptChunk) {
    const wf = safeParseWorkflow(promptChunk.text);
    if (wf) {
      result.generator = "ComfyUI";
      Object.assign(result, parseComfyUI(wf));
      if (req.includeRaw) result.rawWorkflow = wf;
    } else {
      warnings.push("keyword=prompt 的 chunk 非合法 JSON(即使清洗 NaN/Infinity 后)。");
    }
  } else if (paramsChunk) {
    result.generator = "A1111";
    Object.assign(result, parseA1111(paramsChunk.text));
  }

  if (req.includeRaw && workflowChunk) {
    const fullWf = safeParseWorkflow(workflowChunk.text);
    if (fullWf) result.rawWorkflow = result.rawWorkflow ?? fullWf;
  }

  return result;
}
