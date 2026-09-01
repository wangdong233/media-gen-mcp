import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { acquireBrowser, releaseBrowser, BrowserUnavailableError, type BrowserLike, type PageLike, type CDPSessionLike } from "./browser-pool.js";

/**
 * 确定性视频渲染(HTML/CSS/GSAP 动画 → MP4/GIF/WebM)。
 * DIY seek+screenshot+ffmpeg 管线,复用 browser-pool.ts 进程级 Chrome 单例池
 * (2026-09-01 P0 根治:单例 + 引用计数 + 5min 空闲回收 + exit 钩子 + 固定前缀 profile)。
 *
 * 原理(doc_v4/v5 调研):每帧 seek 到精确时间点 → 截图 → 串成帧序列 → ffmpeg 拼成视频。
 * 同输入→同输出:每帧时间点有理化(frameIdx/fps),不依赖实时时钟或 rAF 时序。
 *
 * HyperFrames 源码学习的 4 个工程模式(已纳入):
 * ① CDP `Page.captureScreenshot`(`fromSurface:true`)比 puppeteer 的 page.screenshot 包装更底层、
 *    更确定(直接从合成器 surface 取像素,跳过包装层的额外调度)。
 * ② double-rAF 绘制稳定:seek 后连续两次 requestAnimationFrame,确保 layout+paint+commit 全部刷新
 *    (HyperFrames frameCapture.ts 同款;规避"首帧未渲染完成"的已知问题)。
 * ③ 就绪检查:document.fonts.ready(防文字未渲染)+ HTMLImageElement.decode()(防图片空白)。
 * ④ 时间有理化:第 i 帧时间 = i/fps 秒(精确有理数),杜绝浮点 ms 累积漂移。
 *
 * seek 优先级:① HyperFrames 契约 window.__hf.seek > ② GSAP timeline.pause+totalTime >
 *             ③ CSS WAAPI(el.getAnimations → Animation.currentTime=ms;pause)> ④ 无动画(静态截图)。
 *
 * 性能:帧直接 pipe 到 ffmpeg stdin,不在磁盘落帧文件(省 IO + 磁盘空间)。
 */

export interface RenderVideoRequest {
  /** HTML 源码(含内联 CSS/JS 动画)。必填。 */
  html: string;
  /** 帧率(默认 30,上限 60)。 */
  fps?: number;
  /** 时长(秒,必填,上限 120)。 */
  duration: number;
  /** 像素宽(默认 1920)。 */
  width?: number;
  /** 像素高(默认 1080)。 */
  height?: number;
  /** 输出格式:mp4(默认)/ gif / webm。 */
  format?: "mp4" | "gif" | "webm";
  /** Retina 倍率(默认 1;2 = 2× 像素)。 */
  scale?: number;
  /** 每帧 JPEG 质量(1-100,默认 90)。 */
  quality?: number;
  /** 进度回调(0-100),由调用方接入 MCP notifications/progress。 */
  onProgress?: (pct: number) => void;
}

export interface RenderVideoOutput {
  /** MP4/GIF/WebM 视频数据。 */
  video: Buffer;
  /** 输出 MIME 类型。 */
  mimeType: string;
  /** 输出文件扩展名(不含点)。 */
  ext: string;
  /** 实际渲染的帧数。 */
  frameCount: number;
  /** 用时(毫秒)。 */
  elapsedMs: number;
  /** 截断/降级提示(如 fps×duration 超 MAX_FRAMES 被截断)。 */
  warning?: string;
}

const MAX_FRAMES = 3600; // 防失控:60s@60fps 或 120s@30fps
const MAX_DURATION = 120;

// ffmpeg-static 路径(lazy import;失败时尝试系统 ffmpeg)
let ffmpegPath: string | null | undefined;
async function getFFmpegPath(): Promise<string> {
  if (ffmpegPath !== undefined) return ffmpegPath!;
  try {
    const mod = await import("ffmpeg-static");
    // ffmpeg-static 的 default 是可执行文件路径(string);新版可能挂 在 default 或作为 path 导出
    const p = (mod as any).default ?? (mod as any).path;
    ffmpegPath = typeof p === "string" && p ? p : null;
  } catch {
    ffmpegPath = null;
  }
  // 兜底:系统 ffmpeg(PATH 可见时)
  if (!ffmpegPath) {
    try {
      const which = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
      if (which.status === 0) ffmpegPath = "ffmpeg";
    } catch { /* ignore */ }
  }
  return ffmpegPath!;
}

/**
 * 在页面上 seek 到指定时间(秒,精确有理数)。
 * 策略链:① HyperFrames __hf.seek > ② GSAP timeline > ③ CSS WAAPI > ④ 无动画
 */
async function seekToTime(page: PageLike, timeSec: number): Promise<void> {
  await page.evaluate((sec: number) => {
    const ms = sec * 1000;
    // ① HyperFrames 契约
    const hf = (window as any).__hf;
    if (hf && typeof hf.seek === "function") { hf.seek(sec); return; }
    // ② GSAP timeline(totalTime 比 seek 更底层,不 snap 到 label)
    const tl = (window as any).__tl ?? (window as any).timeline ?? (window as any).__gsapTimeline;
    if (tl && typeof tl.pause === "function") {
      tl.pause();
      if (typeof tl.totalTime === "function") tl.totalTime(sec, false);
      else if (typeof tl.seek === "function") tl.seek(sec, false);
      return;
    }
    // ③ CSS WAAPI:遍历所有元素的 Animation,设置 currentTime + pause
    const els = document.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement;
      const getAnims = (el as any).getAnimations;
      if (typeof getAnims !== "function") continue;
      let anims: any[] = [];
      try { anims = getAnims.call(el); } catch { continue; }
      for (const anim of anims) {
        // 先 pause 再设 currentTime(与 GSAP 分支同序):运行中的动画先赋 currentTime 后 pause,
        // pause 要到下一动画帧才提交,冻结瞬间会落回墙钟 → 两次渲染帧不一致(非确定)。
        // 先 pause(commit pending)再赋值,currentTime 固定在指定时刻 → 确定性渲染。
        try { anim.pause(); } catch { /* swallow */ }
        try { anim.currentTime = ms; } catch { /* swallow */ }
      }
    }
    // ④ 无动画:页面静态,无需任何操作
  }, timeSec);
}

/**
 * double-rAF 绘制稳定(HyperFrames frameCapture 同款)。
 * 连续两次 requestAnimationFrame,确保 seek 后 layout → paint → compositor commit 全部完成,
 * 规避"截到上一帧"的已知竞态。
 */
async function waitForDraw(page: PageLike): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }),
  );
}

/** 等待页面就绪:字体加载 + 图片解码完成。 */
async function waitForReady(page: PageLike): Promise<void> {
  await page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve());
  await page.evaluate(async () => {
    const imgs = document.querySelectorAll("img");
    const tasks: Promise<unknown>[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i] as HTMLImageElement;
      // decode() 在已 complete 的图上也会 resolve;未加载的图等解码完成
      if (typeof img.decode === "function") {
        tasks.push(img.decode().catch(() => {}));
      }
    }
    if (tasks.length) await Promise.all(tasks);
  });
  // 首帧 paint 落地
  await waitForDraw(page);
}

/**
 * CDP 截图(HyperFrames 偏好,比 page.screenshot 包装更确定)。
 * 必须显式传 clip.scale —— 实测无 clip 时 CDP captureScreenshot 在 headless 下忽略
 * viewport 的 deviceScaleFactor(输出退回 CSS 像素)。clip.scale 才是真正的光栅倍率。
 * 输出维度 = width×scale × height×scale。
 */
async function captureFrame(
  client: CDPSessionLike,
  width: number,
  height: number,
  scale: number,
  format: "jpeg" | "png",
  quality: number,
): Promise<Buffer> {
  const res = await client.send("Page.captureScreenshot", {
    format,
    ...(format === "jpeg" ? { quality } : {}),
    clip: { x: 0, y: 0, width, height, scale },
    captureBeyondViewport: false,
    fromSurface: true,
    optimizeForSpeed: false,
  });
  return Buffer.from(res.data, "base64");
}

/** 写帧到 ffmpeg stdin,处理背压。 */
function writeFrame(stdin: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    stdin.once("error", onErr);
    const ok = stdin.write(chunk);
    if (ok) { stdin.removeListener("error", onErr); resolve(); }
    else stdin.once("drain", () => { stdin.removeListener("error", onErr); resolve(); });
  });
}

export async function renderVideo(req: RenderVideoRequest): Promise<RenderVideoOutput> {
  if (!req.html || !req.html.trim()) throw new Error("`html` is required");
  if (!req.duration || req.duration <= 0) throw new Error("`duration` (seconds, > 0) is required");
  if (req.duration > MAX_DURATION) throw new Error(`\`duration\` must be ≤ ${MAX_DURATION}s (got ${req.duration}s)`);

  const fps = req.fps && req.fps > 0 ? Math.min(60, Math.max(1, Math.floor(req.fps))) : 30;
  const duration = req.duration;
  const width = req.width && req.width > 0 ? Math.floor(req.width) : 1920;
  const height = req.height && req.height > 0 ? Math.floor(req.height) : 1080;
  const scale = req.scale && req.scale > 0 ? Math.max(1, Math.floor(req.scale)) : 1;
  const quality = req.quality && req.quality > 0 && req.quality <= 100 ? Math.floor(req.quality) : 90;
  const format: "mp4" | "gif" | "webm" = req.format ?? "mp4";
  const wantedFrames = Math.ceil(fps * duration);
  const totalFrames = Math.min(MAX_FRAMES, wantedFrames);
  const videoWarning = wantedFrames > MAX_FRAMES
    ? `fps×duration=${wantedFrames} 帧超过上限 ${MAX_FRAMES},已截断为 ${MAX_FRAMES}(实际时长约 ${MAX_FRAMES / fps}s);请降 fps 或 duration。`
    : undefined;

  // 输出路径(仍用 tmp 目录,产出单一视频文件;帧走 stdin 不落盘)
  const tmpDir = path.join(os.tmpdir(), `mcp-video-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = format === "gif" ? "gif" : format === "webm" ? "webm" : "mp4";
  const outputPath = path.join(tmpDir, `output.${ext}`);
  const startTime = Date.now();

  // 获取 Chrome(browser-pool 进程级单例;acquire 引用计数 +1,渲染全程抑制空闲回收)
  const browser: BrowserLike = await acquireBrowser().catch((e: unknown) => {
    if (e instanceof BrowserUnavailableError) {
      throw new Error("Chrome/Edge not available — needed for video frame capture (install Google Chrome or Microsoft Edge)");
    }
    throw e;
  });

  try {
    // ffmpeg
    const ffmpeg = await getFFmpegPath();
    if (!ffmpeg) throw new Error("ffmpeg not available — install ffmpeg-static (npm dependency) or system ffmpeg");

    // ffmpeg 参数:image2pipe 读 stdin → 目标编码
    const codec = format === "gif" ? "gif" : format === "webm" ? "libvpx-vp9" : "libx264";
    const extraArgs: string[] =
      format === "mp4"
        ? ["-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart"]
        : format === "webm"
          ? ["-b:v", "1M", "-crf", "32", "-row-mt", "1"]
          : ["-filter_complex", "split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5", "-loop", "0"]; // gif:palette 两 pass 优化(大幅减体积/提质量)

    const proc: ChildProcessWithoutNullStreams = spawn(ffmpeg, [
      "-y",
      "-framerate", String(fps),
      "-f", "image2pipe",
      "-c:v", "mjpeg",
      "-i", "-",
      "-c:v", codec,
      ...extraArgs,
      outputPath,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const ffmpegDone: Promise<void> = new Promise((resolve, reject) => {
      proc.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
      });
      proc.on("error", reject);
    });

    const page = await browser.newPage();
    let framesPiped = false;
    try {
      await page.setViewport({ width, height, deviceScaleFactor: scale });

      // 包裹 HTML:补 DOCTYPE + 重置默认外边距 + 防滚动条
      // 完整 HTML 文档(带 doctype/<html>)原样透传,尊重用户 head/样式;仅片段才包裹兜底
      const html = /^\s*<(?:!doctype\s+html|html[\s>])/i.test(req.html.trim())
        ? req.html
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;box-sizing:border-box;overflow:hidden;background:#000;}*{margin:0;padding:0;box-sizing:border-box;}</style></head><body>${req.html}</body></html>`;
      await page.setContent(html, { waitUntil: "load" }); // networkidle0 在 setContent 下会超时,用 load

      // 就绪:字体 + 图片 + 首帧 paint
      await waitForReady(page);

      // CDP session(HyperFrames 偏好的底层截图通道)
      const client = await page.createCDPSession();

      // 逐帧:seek → double-rAF → 截图 → pipe 到 ffmpeg
      for (let i = 0; i < totalFrames; i++) {
        const timeSec = i / fps; // 有理化时间,杜绝浮点漂移
        await seekToTime(page, timeSec);
        await waitForDraw(page);
        const frame = await captureFrame(client, width, height, scale, "jpeg", quality);
        await writeFrame(proc.stdin, frame);
        if (req.onProgress && (i % 3 === 0 || i === totalFrames - 1)) {
          req.onProgress(Math.round(((i + 1) / totalFrames) * 100));
        }
      }
      // 帧序列正常结束,关 stdin 让 ffmpeg 收尾
      proc.stdin.end();
      framesPiped = true;
    } catch (e) {
      // 帧捕获中途失败:必须终止 ffmpeg,否则 stdin 不 end → 进程挂死 + 泄漏
      try { proc.stdin.destroy(); } catch { /* ignore */ }
      try { proc.kill("SIGKILL"); } catch { /* ignore */ }
      throw e;
    } finally {
      await page.close().catch(() => {});
    }

    await ffmpegDone;

    // 防御:framesPiped=false 时 ffmpegDone 可能因 kill 已 reject,上面 throw 已抛,这里不应到达
    if (!framesPiped) throw new Error("frame capture produced no output");

    const video = fs.readFileSync(outputPath);
    const elapsedMs = Date.now() - startTime;
    const mimeType = format === "gif" ? "image/gif" : format === "webm" ? "video/webm" : "video/mp4";

    // 清理 tmp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

    return { video, mimeType, ext, frameCount: totalFrames, elapsedMs, ...(videoWarning ? { warning: videoWarning } : {}) };
  } finally {
    // 异常/成功路径都归还借用(引用计数 -1;归零后 browser-pool 接管空闲回收)
    releaseBrowser();
  }
}
