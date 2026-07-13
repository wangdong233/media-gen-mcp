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

/** 通用图像请求(文生图 / 图生图)。 */
export interface ImageRequest {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  /** 图生图输入:公网 URL 或 data URI;base64 直传也可(取决于 provider)。 */
  images?: string[];
  mode?: ImageMode;
  /** provider 私有字段透传口(如 Agnes 的 return_base64 / extra_body.response_format)。 */
  extra?: Record<string, unknown>;
}

export interface ImageOutput {
  url?: string;
  b64?: string;
}

export interface ImageResult {
  outputs: ImageOutput[];
  raw?: unknown;
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
}

export interface VideoResult {
  status: TaskStatus;
  progress?: number;
  /** 成品直链(仅 status=completed 时出现)。 */
  url?: string;
  error?: string;
  raw?: unknown;
}

export interface ImageProvider {
  readonly name: string;
  listModels(): string[];
  generateImage(req: ImageRequest): Promise<ImageResult>;
}

export interface VideoProvider {
  readonly name: string;
  listModels(): string[];
  /** 声明该 provider 的视频约束,供工具层构建 schema(避免在通用层硬编码厂商专有值)。 */
  videoConstraints(): {
    allowedNumFrames: number[];
    defaultNumFrames: number;
    defaultFrameRate: number;
  };
  /** 估算生成耗时(秒),供工具层决定同步/异步 + 给用户预估。粗估、偏保守即可。 */
  estimateGenerationSeconds(numFrames: number, frameRate?: number): number;
  createVideo(req: VideoRequest): Promise<VideoTask>;
  getVideo(handle: VideoHandle): Promise<VideoResult>;
}

/** 一个同时具备图像与视频能力的 provider(Agnes 即如此)。 */
export interface MediaProvider extends ImageProvider, VideoProvider {}
