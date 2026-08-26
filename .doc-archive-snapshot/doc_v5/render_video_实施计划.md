# doc_v5: render_video 工具实施计划

> 目标:新增第 12 个工具 `render_video`——HTML/动画 → 确定性视频(MP4),DIY 方案(seek+screenshot+ffmpeg)。
> 基于 doc_v4 深度调研结论:macOS 上 HyperFrames 无质量优势(beginFrame Linux 专属),DIY ~55 行,新增仅 ffmpeg-static(~80MB)。
> 版本:0.5.0

---

## 阶段拆分

### pares1: render_video 核心管线(HTML → 帧序列 → MP4)

**功能**:
- 输入:HTML 源码(含 CSS/GSAP 动画) + fps + duration + width/height
- 管线:puppeteer-core 启动系统 Chrome → 加载 HTML → seek 每帧 → screenshot → ffmpeg 拼帧 → MP4
- seek 支持:GSAP(`timeline.pause + seek`) + CSS(WAAPI `Animation.currentTime`)+ 无动画(直接截图)
- 就绪检查:fonts.ready + img.decode

**不包含**(pares2):
- 音频轨道
- 视频内嵌(<video> 帧注入)
- 预览/studio
- 高级特效(WebGL/Three.js)

**实现文件**:`src/render-video.ts`(~200 行) + `src/index.ts` schema/handler

**依赖新增**:`ffmpeg-static`(~80MB,含二进制)

### pares2: 增强(视 pares1 结果决定是否需要)

- 音频叠加(可选)
- 更多动画适配器
- 性能优化(帧缓存、并行截图)
- 模板预设

---

## pares1 详细设计

### 工具描述(WHEN/HOW/LIMITS)

```
render_video: Render HTML/CSS/GSAP animation to a deterministic MP4 video.
Input: HTML source (with CSS animations or GSAP timeline) + fps + duration.
Output: MP4 video file.
Engine: headless Chrome (seek-based frame capture) + ffmpeg (frame stitching).
No AI, deterministic (same input → same output).
Use for: product intro animations, animated charts, text motion graphics, brand intros, slideshows.
NOT for: photorealistic video (use create_video/AI for that).
Needs: system Chrome/Edge + ffmpeg (bundled via ffmpeg-static).
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `html` | string | ✅ | HTML source (with inline CSS/JS animations) |
| `fps` | number | opt | Frames per second (default 30) |
| `duration` | number | ✅ | Duration in seconds |
| `width` | number | opt | Pixel width (default 1920) |
| `height` | number | opt | Pixel height (default 1080) |
| `format` | string | opt | Output format: "mp4" (default) / "gif" / "webm" |
| `scale` | number | opt | Retina scale (default 1; 2 for 2x) |
| `quality` | number | opt | JPEG quality per frame (default 90; 1-100) |
| `name` | string | opt | Output filename |
| `outDir` | string | opt | Output directory |

### seek 策略

1. 检测 `window.__hf?.seek`(HyperFrames 兼容契约)
2. 检测 `window.gsap?.timeline` 或全局 timeline
3. 通用 fallback:遍历 `el.getAnimations()` → `Animation.currentTime = ms; Animation.pause()`
4. 无动画:直接截图(静态 HTML → 视频)

### ffmpeg 管线

```bash
ffmpeg -y -framerate {fps} -i frame_{:05d}.jpg -c:v libx264 -pix_fmt yuv420p -crf 18 {output}.mp4
```

或通过 Node spawn 管道(避免写帧文件到磁盘):
```
puppeteer screenshot → stdout pipe → ffmpeg stdin → output.mp4
```

---

## 验收标准

- [ ] 输入 HTML(含 CSS 动画)→ 输出 MP4,动画帧与浏览器预览一致
- [ ] 同一输入多次渲染→同一输出(确定性)
- [ ] ffmpeg-static 打包(不需系统 ffmpeg)
- [ ] Chrome 复用(系统 Chrome,不下载 Chromium)
- [ ] Node ≥18 兼容
- [ ] 五维度审查零问题
- [ ] 全量 E2E(12 工具)不回归
