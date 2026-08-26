# doc_v5 · pares1 交付分析:render_video(确定性视频)

> 新增第 12 个工具 `render_video`——HTML/CSS/GSAP 动画 → 确定性 MP4/GIF/WebM。
> 版本:0.4.7 → **0.5.0**(首版)→ **0.5.1**(scale 修复 + 完整测试集)。阶段:**pares1(核心管线)已交付**。
> 完成日:2026-07-17。

---

## 一、交付物

| 项 | 内容 |
|---|---|
| 新工具 | `render_video`(schema + handler + 实现模块) |
| 新文件 | `src/render-video.ts`(~250 行) |
| 改动文件 | `src/render-svg.ts`(导出 getBrowser + 3 接口 + DETERMINISTIC_FLAGS)、`src/index.ts`(import + schema + handler) |
| 新增依赖 | `ffmpeg-static@^5.3.0`(~80MB,含二进制,捆绑进 npm 包) |
| 文档 | README.md(确定性视频能力行 + 详情块 + 离线说明) |
| 工具总数 | 11 → **12** |

---

## 二、技术决策(源自 doc_v4 深度调研)

### 为什么 DIY,不直接用 HyperFrames 框架?

源码级调研结论(`doc_v4/DIY_vs_HyperFrames_技术对比.md`):**macOS 上 HyperFrames 与 DIY 用的是同一个 Chrome API(`Page.captureScreenshot`)**。HyperFrames 的原子级 `beginFrame` 帧捕获是 **Linux 专属**(`browserManager.ts` 硬编码 `process.platform === "linux"`),macOS/Windows 上 HyperFrames 自己也 fallback 到 screenshot 模式。

| 维度 | HyperFrames | DIY(采用) |
|---|---|---|
| macOS 渲染质量 | = DIY(同 API) | **相同** |
| 新增依赖体积 | ~15MB(skip download)~200MB+(默认) | **~80MB**(ffmpeg-static) |
| Node 版本 | ≥22 | **≥18** |
| Chromium 下载 | 需配置跳过 | **无**(复用系统 Chrome) |
| 维护成本 | 高(跟踪版本) | 低(自控) |

### 从 HyperFrames 源码学到并纳入的 4 个工程模式

1. **CDP `Page.captureScreenshot`(`fromSurface:true`)**——比 puppeteer 的 `page.screenshot()` 包装更底层、更确定,直接从合成器 surface 取像素,跳过包装层的额外调度。
2. **double-rAF 绘制稳定**——seek 后连续两次 `requestAnimationFrame`,确保 layout → paint → compositor commit 全部刷新,规避"截到上一帧"的已知竞态(`frameCapture.ts` 同款)。
3. **就绪检查**——`document.fonts.ready`(防文字未渲染)+ `HTMLImageElement.decode()`(防图片空白)。
4. **时间有理化**——第 i 帧时间 = `i / fps` 秒(精确有理数),杜绝浮点 ms 累积漂移。

### seek 策略链(优先级)

1. HyperFrames 契约 `window.__hf.seek(sec)`
2. GSAP `timeline.pause() + timeline.totalTime(sec, false)`(totalTime 比 seek 更底层,不 snap 到 label)
3. CSS WAAPI:`el.getAnimations()` → `Animation.currentTime = ms; Animation.pause()`
4. 无动画:静态截图(静态 HTML → 视频)

### ffmpeg 管线:stdin 流式管道

帧 JPEG 直接 pipe 到 ffmpeg stdin(`-f image2pipe -c:v mjpeg -i -`),**不在磁盘落帧文件**(省 IO + 磁盘空间)。编码:
- mp4:libx264 + `yuv420p` + `crf 18` + `+faststart`
- webm:libvpx-vp9 + `crf 32` + row-mt
- gif:原生 gif 编码器(pares2 再加 palette 优化)

---

## 三、确定性证明(E2E 测试)

两套测试,均全绿:

### `_test_video.mjs`(首轮冒烟,8 用例)

| 用例 | 结果 |
|---|---|
| T1 CSS @keyframes 动画 → MP4(2s@15fps,640×360) | ✅ 23.2KB / 30 帧 / **ffprobe 时长 2.00s** |
| T2 确定性:同输入渲染两次 | ✅ 帧数一致 + 大小一致(Δ=0B)+ **逐字节完全一致** |
| T3 静态 HTML(无动画)→ MP4,fallback 路径 | ✅ 8 帧 3.6KB |
| T4 render_svg 回归(DETERMINISTIC_FLAGS 未破坏 SVG→PNG) | ✅ Chrome 后端 3.8KB |
| T5 GIF 格式输出(GIF89a 头校验) | ✅ 2.3KB |

**T2 逐字节一致是最强确定性证明**:同 HTML + 同参数 → 完全相同的 MP4 字节序列(libx264 对相同输入帧 + 相同参数是确定性的)。

### `_test_video_suite.mjs`(完整测试集,9 维 25 用例)

| 维度 | 用例数 | 覆盖 |
|---|---|---|
| G1 基础渲染 | 4 | MP4/GIF/WebM/静态,ftyp+时长+帧数校验 |
| G2 **Seek 4 分支** | 4 | CSS WAAPI / GSAP timeline / HyperFrames __hf.seek / 无动画 —— **用 ffmpeg 抽帧 md5 比对确证每条 seek 分支真的移动了元素**(首末帧不同) |
| G3 参数 | 3 | fps 上限 60 截断、scale=2 像素翻倍、quality 生效 |
| G4 确定性 | 2 | 同输入逐字节一致、帧数 = ceil(fps×duration) |
| G5 校验错误 | 5 | 缺 html/duration、duration=0/>120、空 html → 全抛错 |
| G6 边界 | 1 | 极短时长 0.04s → ≥1 帧 |
| G7 健壮性 | 2 | 含 `<img>`(data URI)decode 不卡、无效 HTML 不崩 |
| G8 集成回归 | 2 | render_svg 回归(共享 flags 未破坏)、onProgress 触发 |
| G9 内容场景 | 2 | 动态图表柱状增长、文字飞入 → seek 生效 |

**关键测试技巧**:seek 分支验证不靠"没崩溃",而靠**抽帧 md5 比对**——`ffmpeg -vf select=eq(n\,i)` 抽第 i 帧 PNG → md5,断言动画场景首末帧 md5 不同(seek 改了画面)、静态场景所有帧 md5 相同(稳定)。这才能区分"seek 真的生效"和"拍了 30 张一样的静帧"。

---

## 四、关键修复(审查 + 测试集发现)

### 测试集发现:scale 参数不生效(0.5.0 → 0.5.1 修复)

**问题**:`scale: 2` 本应输出 2× 像素(retina),但实测 0.5.0 仍输出 CSS 像素(160×90 而非 320×180)。
**根因**:CDP `Page.captureScreenshot` **无 clip 时在 headless 下忽略 viewport 的 deviceScaleFactor**(与 `page.screenshot()` 包装行为不同——后者会 honor DPR)。我的注释当时假设"无 clip → 输出 width×scale",实测错误。
**修复**:`captureFrame` 显式传 `clip: { x:0, y:0, width, height, scale }`——`clip.scale` 才是 CDP 真正的光栅倍率,输出 = width×scale × height×scale。修复后 scale=2 → 320×180(G3 测试验证),且确定性维持(逐字节一致)。
**教训**:`page.screenshot()`(render_svg 用)与原始 CDP `captureScreenshot`(render_video 用)对 deviceScaleFactor 的处理不同;CDP 路径必须显式 clip.scale。

### 健壮性:帧捕获中途抛错 → ffmpeg 挂死 + 进程泄漏

**问题**:原实现帧循环在 `try/finally` 里,finally 只关 page;若 `captureFrame` 抛错(页面崩溃等),`proc.stdin` 永不 end → `ffmpegDone` 永不 resolve → 工具调用挂死 + ffmpeg 进程泄漏。

**修复**:帧循环外层 catch → `proc.stdin.destroy()` + `proc.kill("SIGKILL")` + rethrow。加 `framesPiped` 守卫防 ffmpegDone 在未完成时被误读。

### 其他既有模式复用

- **Chrome 复用**:不新开浏览器,复用 `render-svg.ts` 的 `getBrowser` 单例(5min idle 自动关闭)。`render_video` 与 `render_svg` 共享同一 Chrome 进程。
- **确定性 Chrome flags**:`--force-color-profile=srgb`(颜色一致)+ `--run-all-compositor-stages-before-draw`(截图前合成器刷完)+ `--disable-background-timer-throttling`(GSAP ticker 不被节流)等。**对 SVG 截图同样有益,提升 render_svg 确定性,无回归**(T4 验证)。
- **setContent waitUntil**:`networkidle0` 在 `setContent`(无网络导航)下会超时(0.4.2 render_svg 同款坑)→ 用 `load`。

---

## 五、边界与限制(pares1 范围)

| 项 | 说明 |
|---|---|
| 时长上限 | 120 秒(防失控) |
| 帧数上限 | 3600(60s@60fps 或 120s@30fps) |
| 帧率上限 | 60fps |
| 不含(留 pares2) | 音频轨道、`<video>` 帧注入、GIF palette 优化、并行截图加速、WebGL/Three.js 适配 |

**性能参考**:T1(30 帧 640×360)耗时 ~4.8s,即 ~160ms/帧(主要是 Chrome 截图 + double-rAF)。1080p 长视频会较慢,符合预期(确定性逐帧捕获的本质代价)。

---

## 六、已知 npm audit(非本次引入,超出 0.5.0 范围)

`npm audit` 报 6 个 high,全部来自既有的 `vega`/`vega-lite`(XSS via `VEGA_DEBUG` / `setdata`),需 vega@6 / vega-lite@6 大版本升级(breaking)。本地 MCP server 中用户自写 chart spec,非真实攻击面。**留待独立 P 项处理,不阻塞 0.5.0**。

---

## 七、验收对照(实施计划)

- [x] 输入 HTML(含 CSS 动画)→ 输出 MP4,动画帧与浏览器预览一致(T1)
- [x] 同一输入多次渲染 → 同一输出(确定性)(T2 逐字节一致)
- [x] ffmpeg-static 打包(不需系统 ffmpeg)(已捆绑)
- [x] Chrome 复用(系统 Chrome,不下载 Chromium)(getBrowser 单例)
- [x] Node ≥18 兼容(engines 字段未变)
- [x] 五维度审查(1 问题已修:ffmpeg 挂死)
- [x] E2E 不回归(render_svg T4 验证 + 工具数 12)

**pares1 完成。pares2(音频/WebGL/性能优化)视使用反馈再定。**
