/**
 * Provider 抽象层。
 *
 * 设计目标:工具层只依赖这套接口,不感知任何厂商私有协议。
 * 新增一家厂商 = 新增一个 MediaProvider 实现 + 在 registry 注册。
 * 详见 README「扩展:新增 Provider」。
 */

export type ImageMode = "text-to-image" | "image-to-image";
export type VideoMode = "text-to-video" | "image-to-video" | "keyframes";
export type Resolution = "480p" | "720p" | "1080p";
export type TaskStatus = "queued" | "in_progress" | "completed" | "failed" | "timeout";

/** 模态(pares5:加 vision 第三模态,与 image/video 同位 peer)。 */
export type Modality = "image" | "video" | "vision";

/** 图像识别任务(4 类,各自产出 shape 不同——故 4 工具而非 1 工具+enum,避 R-ABS-01 分流)。 */
export type VisionTask = "extract-text" | "extract-table" | "analyze-chart" | "describe-image";

/** 通用图像请求(文生图 / 图生图)。 */
export interface ImageRequest {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  /** 图生图输入:公网 URL 或 data URI;base64 直传也可(取决于 provider)。 */
  images?: string[];
  mode?: ImageMode;
  /**
   * 比例直传("16:9"/"9:16"/"1:1"/"3:4"/"4:3")。provider 支持时消费(flow 映射到 5 种
   * IMAGE_ASPECT_RATIO_* 枚举);不支持的 provider(agnes/zhipu)由工具层告警后忽略
   * (项目纪律:provider 丢弃参数必须出 warning,不静默)。
   */
  aspect?: string;
  /**
   * 复现/锁定结果用 seed。provider 支持时消费(flow 直入请求体 seed 字段);
   * 不支持的 provider 由工具层告警后忽略。绝不经 extra 透传(extra 会被
   * agnes/zhipu 的 Object.assign(body, extra) 直透上游请求体)。
   */
  seed?: number;
  /** provider 私有字段透传口(如 Agnes 的 return_base64 / extra_body.response_format)。 */
  extra?: Record<string, unknown>;
}

export interface ImageOutput {
  url?: string;
  b64?: string;
  /** flow:该张对应的 Flow mediaId(经 flow_status(mediaId) 可复下载/对账;其他 provider 不填)。 */
  mediaId?: string;
  /** flow:该张的实际生成 seed(响应侧回读,复现用)。 */
  seed?: number;
}

export interface ImageResult {
  outputs: ImageOutput[];
  raw?: unknown;
  /** provider 是否在产出上打了水印(zhipu 免费档可能强制)。 */
  watermarked?: boolean;
  /** provider 侧产生的告警(如 n 被忽略),透传给调用方。 */
  warnings?: string[];
}

/** 通用视频请求(文生 / 图生 / 关键帧)。 */
export interface VideoRequest {
  prompt: string;
  model?: string;
  mode?: VideoMode;
  /** 图生视频:单图 URL。 */
  image?: string;
  /** 关键帧:多图 URL 数组。 */
  keyframes?: string[];
  /** 参考图:多图 URL 数组(flow r2v 模式;上传后作 referenceImages 引用)。 */
  images?: string[];
  /** 视频源 mediaId(flow extension/upsampler 模式:项目内已有视频的引用,无需上传)。 */
  videoMediaId?: string;
  resolution?: Resolution;
  ratio?: string;
  numFrames?: number;
  frameRate?: number;
  seed?: number;
  negativePrompt?: string;
  /** 若设置,provider 据此挑选最接近的合法 numFrames(Agnes 仅 81/121/161/241/441)。 */
  durationSeconds?: number;
  extra?: Record<string, unknown>;
}

/** 异步任务句柄(提交后返回,用于轮询)。 */
export interface VideoHandle {
  taskId?: string;
  videoId?: string;
}

export interface VideoTask extends VideoHandle {
  status: string;
  raw?: unknown;
  /** provider 侧告警(如 zhipu 丢弃 ratio/negativePrompt/seed),透传给调用方。 */
  warnings?: string[];
}

export interface VideoResult {
  status: TaskStatus;
  progress?: number;
  /** 成品直链(仅 status=completed 时出现)。 */
  url?: string;
  error?: string;
  raw?: unknown;
}

/** 图像模态的数学约束(对称于 videoConstraints),供工具层前置校验/吸附 + schema 展示。 */
export interface ImageConstraints {
  minSide: number;
  maxSide: number;
  multipleOf: number;
  maxPixels: number;
}

export interface ImageProvider {
  /** 仅图像模型清单(供 model↔provider 路由校验)。 */
  listImageModels(): string[];
  generateImage(req: ImageRequest): Promise<ImageResult>;
  /** 是否支持图生图(images 输入)。false 时工具层拒绝 images,免静默丢弃(zhipu cogview 纯文生图)。 */
  supportsImageToImage?(): boolean;
  /** 声明该 provider 的图像 size 约束(若有);无硬约束返回 undefined(如 agnes)。 */
  imageConstraints?(): ImageConstraints | undefined;
  /**
   * 把任意 size 吸附到该 provider 的合法值(由 provider 自实现其厂商规则)。
   * 有 imageConstraints 的 provider 应同时实现此方法,让 fallback 路径按目标 provider 规则重吸附,
   * 而非工具层硬编码某一家厂商的吸附函数。无约束的 provider 不实现(工具层直用原值)。
   */
  snapImageSize?(size: string): string;
}

export interface VideoProvider {
  /** 仅视频模型清单(供 model↔provider 路由校验)。 */
  listVideoModels(): string[];
  /** 声明该 provider 的视频约束,供工具层构建 schema(避免在通用层硬编码厂商专有值)。 */
  videoConstraints(): {
    allowedNumFrames: number[];
    defaultNumFrames: number;
    defaultFrameRate: number;
    allowedFrameRates: number[];
  };
  /** 估算生成耗时(秒),供工具层决定同步/异步 + 给用户预估。粗估、偏保守即可。 */
  estimateGenerationSeconds(numFrames: number, frameRate?: number): number;
  /** 给定 resolution×ratio 下 numFrames 上限(无约束返回 undefined)。工具层前置钳制,免 CC 试错碰 API 400。 */
  maxFramesFor?(resolution?: string, ratio?: string): number | undefined;
  createVideo(req: VideoRequest): Promise<VideoTask>;
  getVideo(handle: VideoHandle): Promise<VideoResult>;
}

// ── pares5: vision 模态(图像识别)类型。语义级 what,不泄漏引擎 how(采纳审查 finding-1)。 ──

/** 各 task 的 hints —— 按 task 形状不同(4 工具而非 1 工具+enum 的根本原因)。 */
export interface ExtractTextHints {
  /** BCP-47(如 zh-Hans/zh-Hant/en/ja);provider 内部映射为引擎 lang 文件名(tesseract→chi_sim / paddle→自带多语)。 */
  languages?: string[];
  /** 语义契约「仅输出数字」;各引擎各自实现(tesseract→char_whitelist / paddle→rec 字典约束),不绑死引擎参数名。 */
  digitOnly?: boolean;
  /** 语义级版面假设;provider 翻译为自家 PSM(tesseract 0-13)/版面策略。 */
  segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";
  /**
   * 排版后处理策略(provider-agnostic,handler 层 applyTbpu 实施,不进 provider):
   * - none=不处理(默认,等价 join("\n"))
   * - natural=多栏-自然段(文档首选,GapTree+ParagraphParse)
   * - plain=多栏-纯文本流(无硬换行)
   * - code=单栏-代码段(保缩进)
   * 完整 8 策略透传口见 LayoutStrategy(multi-para/single-line 等)。
   */
  layout?: "none" | "natural" | "plain" | "code";
  /**
   * 忽略区域坐标(去水印/红章/页眉页脚)。handler 层 filterIgnoreAreas 先于 layout 执行,
   * 块 bbox 完全落在任一 AABB 内才剔除。每项为 {x,y,w,h}(原点+尺寸)。
   */
  ignoreAreas?: Array<{ x: number; y: number; w: number; h: number }>;
}
export interface ExtractTableHints {
  format?: "html" | "markdown" | "json" | "latex";
}
export interface AnalyzeChartHints {
  chartType?: "bar" | "line" | "pie" | "scatter" | "auto";
}
export interface DescribeImageHints {
  /** 留空=默认描述提示;存在=VQA 回答该问题。 */
  question?: string;
}

/** 通用识别请求(4 task 共用;image URI-only,与 create_video 同源约束)。 */
export interface VisionRequest {
  image: string;
  task: VisionTask;
  /** 按 task 窄化;OCR 语种只在 ExtractTextHints.languages 单点承载(采纳 finding-5:无顶层 languages 双口)。 */
  hints?: ExtractTextHints | ExtractTableHints | AnalyzeChartHints | DescribeImageHints;
  model?: string;
  /** provider 私有字段透传口,对称于 ImageRequest.extra。 */
  extra?: Record<string, unknown>;
}

/** 各 task 产出形态(VisionResult 按 task 携带不同字段)。 */
export interface TextBlock {
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
  level: "word" | "line" | "paragraph";
}
export interface TableOut {
  format: string;
  content: string;
}
export interface ChartOut {
  type: string;
  axes: Record<string, string>;
  series: { name?: string; points: { x: string | number; y: number }[] }[];
}

export interface VisionResult {
  task: VisionTask;
  /** extract-text 全文。 */
  text?: string;
  /** extract-text 带坐标块。 */
  blocks?: TextBlock[];
  /** extract-table。 */
  table?: TableOut;
  /** analyze-chart。 */
  chart?: ChartOut;
  /** describe-image 自然语言答案。 */
  description?: string;
  raw?: unknown;
  warnings?: string[];
}

/**
 * vision 能力组约束。**不含 tasks**(采纳 finding-4):「支持哪些 task」的单一真值源是 visionTasks()。
 * 这里只留跨 task 的通用约束。
 */
export interface VisionConstraints {
  languages?: string[];
  maxImageBytes?: number;
}

/**
 * pares6: vision provider 自描述维度(参考 Umi-OCR self-describing options)。
 *
 * 铁律(R-CI-08 双声明防护):此处**只承载 role/latency/accuracy/notes** —— 不重复
 * `visionTasks()`(任务清单)和 `visionConstraints()`(语言/字节上限),三者形成分工表,
 * 见 vision-capabilities.md §3.1「三方法的真值分工」。
 */
export interface VisionOptionDescriptors {
  /** 角色定位(一句话),如「零配置兜底」「全能主力」「VQA 增强」。 */
  role: string;
  /** 延迟档位:instant(进程内)< fast(本地 serving)< moderate(本地 GPU 推理)< slow(云 API,本 MCP 不走)。 */
  latencyTier: "instant" | "fast" | "moderate" | "slow";
  /** 精度档位:low(兜底)< medium < high(SOTA)。 */
  accuracyTier: "low" | "medium" | "high";
  /** 按 task 细化的备注(任务粒度的 caveat),key 取自 VisionTask。 */
  perTaskNotes?: Partial<Record<VisionTask, string>>;
  /** 通用备注(部署/配置边界)。 */
  notes?: string;
}

/**
 * vision 能力组子接口(对称 ImageProvider/VideoProvider)。
 * pares5: 与 image/video 同位的第三模态 peer;asVisionProvider 守卫契约源 + 单一声明源。
 * pares6: 加可选 `describeVisionOptions()` —— 供 list_vision_capabilities 聚合(R-INT-03 god interface
 * 防护:可选方法,旧/外部 provider 不实现自动降级)。
 */
export interface VisionProvider {
  /** 仅识别模型清单(供 model↔provider 路由校验)。 */
  listVisionModels(): string[];
  /** 单一真值源:provider 支持哪些 task(对称 listImageModels/listVideoModels)。 */
  visionTasks(): readonly VisionTask[];
  recognize(req: VisionRequest): Promise<VisionResult>;
  visionConstraints?(): VisionConstraints | undefined;
  /** pares6: 自描述新维度,供 list_vision_capabilities 聚合(可选,避 R-INT-03)。 */
  describeVisionOptions?(): VisionOptionDescriptors;
}

/** Provider 能力矩阵(pares3:fallback 能力谈判基础;pares5:加 vision 维度)。 */
export interface ProviderCapabilities {
  image: { textToImage: boolean; imageToImage: boolean };
  video: { textToVideo: boolean; imageToVideo: boolean; keyframes: boolean };
  // pares5: vision 能力的单一真值源是 VisionProvider.visionTasks();不另设 vision 字段(审查 finding:零消费方的第二真值源,R-CI-08)。
}

/** Provider 健康状态(纯本地,无网络调用)。 */
export interface ProviderHealth {
  configured: boolean;
  cooldown: boolean;
  lastErrorAt?: string;
}

/**
 * pares5: 能力袋 MediaProvider(采纳审查 finding-2)。
 * 子接口 ImageProvider/VideoProvider/VisionProvider 是单一声明源(各自描述能力组形状);
 * MediaProvider 自动派生为组合,无需手动同步 20+ 签名 —— 消解 R-INT-03 god interface + R-CI-08 双声明。
 * image/video/vision 三能力组并列可选(非破坏性拓宽);class implements 此交叉 object type 仍成立。
 */
export interface MediaProviderBase {
  readonly name: string;
  listModels(): string[];
  /** 能力矩阵,供 fallback 路由判断能否承接。未实现 → 保守默认(不承接 fallback)。 */
  capabilities?(): ProviderCapabilities;
  /** 健康状态。未实现 → { configured: true, cooldown: false }。 */
  health?(): ProviderHealth;
  /** 优先级(数字大优先)。未实现 → 0。 */
  tier?(): number;
  /** fallback 失败时回调,让 provider 自更新 cooldown。 */
  notifyUnavailable?(e: any): void;
}

export type MediaProvider =
  & MediaProviderBase
  & Partial<ImageProvider>
  & Partial<VideoProvider>
  & Partial<VisionProvider>;
