# doc_v4 补充:DIY vs HyperFrames 技术对比(源码级深度调研)

> 补充《离线图片视频生成_深度调研.md》。基于 HyperFrames 引擎源码逐行分析,确定 DIY 方案是否够用。
> 日期:2026-07-17

---

## 核心结论(一句话)

**在 macOS 上,HyperFrames 和 DIY 用的是同一个 Chrome API(`Page.captureScreenshot`)。** HyperFrames 的"seek-based 确定性"分两半:seek(JS 函数调用)可 DIY(~5 行);原子级 beginFrame 帧捕获是 Linux 专属功能,macOS 上 HyperFrames 自己也 fallback 到 screenshot。**所以 DIY 方案在 macOS 上效果与 HyperFrames 无差距。**

---

## 一、HyperFrames 的"seek"到底是什么?

不是 `document.timeline.currentTime`(只读)。是一个**契约**:HTML 页面暴露 `window.__hf.seek(timeSeconds)`,引擎在每帧截图前调用它。

引擎源码(`frameCapture.ts` L1515-1521,macOS 路径):
```js
const seekCapture = async (frameIdx) => {
  const t = quantizeTimeToFrame(frameIdx / fps, fps);
  await page.evaluate((tt) => {
    const hf = window.__hf;
    if (hf && typeof hf.seek === "function") hf.seek(tt);
  }, t);
  return pageScreenshotCapture(page, options);  // 就是 Page.captureScreenshot
};
```

**seek 做的事**(取决于动画库):
- **GSAP**:`timeline.pause()` + `timeline.seek(t, false)`(14 行适配器,HyperFrames 全部源码就这点)
- **CSS 动画**:遍历 `document.querySelectorAll("*")` → `el.getAnimations()` → 每个 `Animation.currentTime = ms; Animation.pause()`
- **CSS 无动画的元素**:`animationDelay = -${seconds}s`(负延迟技巧)

**这两段代码我可以 5 行复制。**

---

## 二、beginFrame vs screenshot:差距在哪?

| | `HeadlessExperimental.beginFrame`(Linux 专属) | `Page.captureScreenshot`(macOS/Windows/Linux 通用) |
|---|---|---|
| 原理 | 一次 CDP 调用 = 布局+绘制+合成+截图(原子操作) | 分步:setContent → 等待 → screenshot(非原子) |
| 确定性 | 100%(Chrome 内部时钟驱动) | ~95%(偶有首帧渲染未完成) |
| 平台 | **仅 Linux + chrome-headless-shell** | 所有平台 |
| HyperFrames macOS 行为 | **不可用**(browserManager.ts 硬编码 `process.platform === "linux"` 检查) | **使用此路径**(与 DIY 相同) |

**关键发现**:HyperFrames 在 macOS 上**自己也是 screenshot 模式**,beginFrame 的优势我们拿不到——无论用不用 HyperFrames。

---

## 三、DIY 方案 vs HyperFrames:功能差距清单

| HyperFrames 有但 DIY 没有的 | 对 MCP 视频有用? | DIY 补偿方案 |
|---|---|---|
| beginFrame 原子捕获 | ❌ macOS 无 | 无需(同平台 HyperFrames 也没有) |
| 字体就绪轮询 | ✅ 防文字未渲染 | `await page.evaluate(() => document.fonts.ready)` |
| 图片解码等待 | ✅ 防图片空白 | `await img.decode()` per image |
| `<video>` 帧注入 | ⚠️ 视频内嵌 | MCP 场景暂不需要(用户要的是动效,不是视频剪辑) |
| 静帧去重(hasDamage) | ✅ 性能优化(省截图) | 不做也行(多截几张而已) |
| HDR/WebGPU readback | ❌ 不需要 | — |
| Studio 预览 | ❌ MCP 不需要 | — |
| 音频同步时钟 | ⚠️ 字幕配音频 | 后续如需再加 |

**MCP 实际场景**(文字飞入/图表增长/轮播/品牌片头):**100% 是 GSAP/CSS 动画 + 文字 + 图片**。DIY seek+screenshot 完全覆盖,只需加 3 个就绪检查(fonts.ready / img.decode / 基础 paint 等待)。

---

## 四、HyperFrames 依赖真实代价(精确版)

| 配置方式 | npm 新增 | Chromium 下载 | FFmpeg | Node 版本 |
|---|---|---|---|---|
| 默认(`npm i hyperframes`) | ~200MB+ | ✅ ~170MB(puppeteer postinstall) | 系统安装 | ≥22 |
| `PUPPETEER_SKIP_DOWNLOAD=true` + 系统 Chrome | ~15MB | ❌ 跳过 | 系统/`ffmpeg-static` | ≥22(可能 20 能跑) |
| **DIY(推荐)** | **~80MB**(`ffmpeg-static`)| **❌** | `ffmpeg-static` 打包 | **≥18** |

**DIY 只需新增 1 个依赖**:`ffmpeg-static`(~80MB,含二进制)。puppeteer-core + 系统 Chrome **已有**(来自 render_svg)。

---

## 五、DIY 方案代码量估算

| 模块 | 行数 | 说明 |
|---|---|---|
| Chrome 复用 + 页面加载 | ~15 | 复用 render-svg.ts 的 getBrowser() |
| seek 函数(GSAP/CSS) | ~10 | page.evaluate 注入 |
| 帧循环 + screenshot | ~15 | for loop + screenshot per frame |
| ffmpeg 帧拼接 | ~10 | spawn ffmpeg 或 fluent-ffmpeg |
| 就绪检查 | ~5 | fonts.ready + img.decode |
| **总计** | **~55 行** | |

对比:render-svg.ts 现有 ~180 行,render-video.ts 预计 ~200 行(含 schema/handler)。

---

## 六、最终结论

| 维度 | HyperFrames | DIY |
|---|---|---|
| macOS 渲染质量 | = DIY(同 API) | ✅ 相同 |
| 新增依赖体积 | ~15MB(skip download)或 ~200MB+(默认) | **~80MB**(ffmpeg-static) |
| Node 版本 | ≥22 | **≥18** |
| Chromium 下载 | 需配置跳过 | **无** |
| 开发复杂度 | 低(框架封装好) | 中(~55 行) |
| 维护成本 | 高(跟踪 HyperFrames 版本) | 低(自己掌控) |
| 效果差距 | — | **macOS 上零差距** |

**推荐:DIY。** 在 macOS 上 HyperFrames 没有质量优势(beginFrame 不可用),却有依赖代价(Node ≥22 + 可能下载 Chromium)。DIY ~55 行代码,复用已有 Chrome + 新增 ffmpeg-static(~80MB),Node ≥18 兼容。

如果未来部署到 Linux Docker 且需要生产级帧确定性,**那时再引入 HyperFrames 的 beginFrame 模式**。
