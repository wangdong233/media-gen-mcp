# Google 文生图/文生视频模型深度调研(2026)

> 数据来源:Google Cloud Vertex AI 官方定价页、Gemini Developer API 官方定价页、Gemini API OpenAI 兼容文档、Gemini API 限速文档(均于 2026-07 抓取核实)。第三方聚合站(如某些博客声称的"$0.75/秒 Veo 3")与官方数据**不符**,本报告以官方为准并已标注冲突点。

---

## 一、最重磅发现(必须先看)

1. **Imagen 4 全系已弃用**:官方定价页明确警告 — `imagen-4.0-generate-001`、`imagen-4.0-ultra-generate-001`、`imagen-4.0-fast-generate-001` 将于 **2026 年 8 月 17 日关停**,迁移目标为 **Gemini 2.5 Flash Image(Nano Banana)**。调研日(2026-07-13)距关停仅约 1 个月,**新项目不应再选 Imagen 4**。
2. **Veo 3 与 Veo 2 已于 2026 年 6 月 30 日关停**(已过期),当前视频主力是 **Veo 3.1**(含 Fast / Lite 三档)。
3. **价格纠偏**:多方第三方站流传 "Veo 3 = $0.75/秒"。官方 Vertex AI 与 Gemini API 双源确认 **Veo 3 / Veo 3.1 标准(视频+音频)= $0.40/秒**,$0.75 为错误信息(可能来自早期预览或转售价)。
4. **开发层无免费额度**:Gemini Developer API 定价页对所有图像(Imagen 4、Nano Banana 全系)与视频(Veo)模型,Free Tier 一律标注 **"Not available"**。"免费"只存在于消费级 Gemini App(滚动配额,非固定数)和 GCP 新账户 $300/90 天试用额度。

---

## 二、模型总览表

### 2.1 文生图 / 图生图(闭源,无开源权重)

| 模型 | API model ID | 状态 | 计费 | 标准价 | OpenAI 兼容 |
|---|---|---|---|---|---|
| **Gemini 3 Pro Image(Nano Banana Pro)** 🍌 | `gemini-3-pro-image` | ✅ 当前主力 | 按 token | $0.134/图(1K-2K)、$0.24/图(4K) | ✅ `/v1/images/generations` |
| **Gemini 3.1 Flash Image(Nano Banana 2)** 🍌 | `gemini-3.1-flash-image` | ✅ 当前(高速) | 按 token | $0.067/图(1K)、$0.151/图(4K) | ✅ `/v1/images/generations` |
| **Gemini 2.5 Flash Image(Nano Banana)** 🍌 | `gemini-2.5-flash-image` | ✅ 当前(Imagen 4 迁移目标) | 按图 | $0.039/图 | ✅ `/v1/images/generations` |
| Imagen 4(Standard) | `imagen-4.0-generate-001` | ⚠️ 弃用(8/17 关停) | 按图 | $0.04/图 | ❌ 仅原生 `:predict` |
| Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | ⚠️ 弃用(8/17 关停) | 按图 | $0.06/图 | ❌ |
| Imagen 4 Fast | `imagen-4.0-fast-generate-001` | ⚠️ 弃用(8/17 关停) | 按图 | $0.02/图 | ❌ |
| Imagen 3 / 3 Fast | `imagen-3.0-generate-002` | ✅ 可用(Vertex AI) | 按图 | $0.04 / $0.02 | ❌ |

### 2.2 文生视频 / 图生视频(闭源)

| 模型 | API model ID | 状态 | 标准价(视频+音频) | OpenAI 兼容 |
|---|---|---|---|---|
| **Veo 3.1** | `veo-3.1-generate-preview` | ✅ 当前主力 | $0.40/秒(720p/1080p)、$0.60/秒(4K) | ✅ `/v1/videos`(Sora 兼容,异步) |
| **Veo 3.1 Fast** | `veo-3.1-fast-generate-preview` | ✅ 当前(快速) | $0.10(720p)~$0.30/秒(4K) | ✅ |
| **Veo 3.1 Lite** | `veo-3.1-lite-generate-preview` | ✅ 当前(最快/最省) | $0.05(720p)~$0.08/秒(1080p;不支持4K) | ✅ |
| Veo 3 | `veo-3.0-generate-001` | ❌ 已关停(6/30) | $0.40/秒 | — |
| Veo 2 | `veo-2.0-generate-001` | ❌ 已关停(6/30) | $0.35/秒 | — |

> 视频另有「仅视频(无音频)」价:Veo 3.1 标准 $0.20/秒(720p/1080p)、$0.40/秒(4K)。需省成本可选无音频。

---

## 三、价格精确明细(官方核实)

### 3.1 Imagen 系列(Vertex AI / Gemini API 通用,按图计费)

| 项 | 价格(USD) |
|---|---|
| Imagen 4 Fast(弃用) | $0.02 / 图 |
| Imagen 4 Standard(弃用) | $0.04 / 图 |
| Imagen 4 Ultra(弃用) | $0.06 / 图 |
| Imagen 4 放大(Upscaling 至 2K/3K/4K) | $0.06 / 图 |
| Imagen 3 / 3 Fast | $0.04 / $0.02 图 |
| Imagen 视觉描述(Visual Captioning) | $0.0015 / 图 |

### 3.2 Nano Banana 系列(按 token 计费,Gemini API 标准档)

| 模型 | 输入(文本/图) | 图像输出等效单价 |
|---|---|---|
| Gemini 3 Pro Image(Nano Banana Pro) | $2.00/1M token($0.0011/图) | 1K-2K:$0.134/图;4K:$0.24/图 |
| Gemini 3.1 Flash Image(Nano Banana 2) | $0.50/1M token | 0.5K:$0.045;1K:$0.067;2K:$0.101;4K:$0.151 /图 |
| Gemini 2.5 Flash Image(Nano Banana) | $0.30/1M token | $0.039/图(≤1024×1024) |

> token 换算口径:1K(1024×1024)≈1120 token,图像输出按 $60/1M token(Nano Banana 2)或 $120/1M token(Nano Banana Pro)。

### 3.3 Veo 视频系列(Gemini API 与 Vertex AI 价格一致)

| 模型 | 仅视频 | 视频+音频 |
|---|---|---|
| Veo 3.1 | 720p/1080p $0.20/秒;4K $0.40/秒 | 720p/1080p **$0.40/秒**;4K **$0.60/秒** |
| Veo 3.1 Fast | 720p $0.08;1080p $0.10;4K $0.25 /秒 | 720p $0.10;1080p $0.12;4K $0.30 /秒 |
| Veo 3.1 Lite | 720p $0.03;1080p $0.05 /秒(无4K) | 720p $0.05;1080p $0.08 /秒(无4K) |

> **计费规则**:按实际生成的视频秒数计费;生成失败(如音频处理问题)不收费。最长 8 秒/次,可 Extend 续生成。

---

## 四、免费额度与限速(重点核查)

### 4.1 开发层 API — 图像/视频模型【无免费额度】

Gemini Developer API 官方定价页对 **Imagen 4、Nano Banana 全系、Veo 全系** 的 Free Tier 均标注 **"Not available"**。即:**经 API 调用图像/视频生成,无任何免费调用,必须开启付费**。

⚠️ 陷阱:一旦在 Gemini API 项目开启 billing(付费),该项目的免费层 **完全消失**(连文本模型也变全部计费)。

### 4.2 限速(Rate Limits)

官方文档([ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits),更新于 2026-07-03):

- 限速按 **项目(project)** 而非 API key 计算;RPD(每日请求数)于太平洋时间午夜重置。
- 具体每模型的 RPM/TPM 数字 **未在文档公开**,需在 Google AI Studio 控制台查看。**预览(preview)模型限速更严格**。
- **消费型限速(spend-based,滚动 10 分钟窗口)**:

| 使用层级 | 10 分钟内消费上限 |
|---|---|
| Free | 不适用(无消费) |
| Tier 1 | $10 |
| Tier 2 | $200 |
| Tier 3 | $200 |

  触发返回 `429 RESOURCE_EXHAUSTED`。Veo 3.1 标准 $0.40/秒 ⇒ Tier 1 在 10 分钟内约只能生成 25 秒视频(≈3 段 8 秒),对视频生成限制明显。

- **Batch API**:并发批次请求上限 100;输入文件 ≤2GB;存储 ≤20GB。

### 4.3 「免费」可得的两条路径

| 路径 | 额度 | 说明 |
|---|---|---|
| **消费级 Gemini App**(gemini.google.com) | 滚动算力配额,**非固定图数** | 每 5 小时滚动刷新 + 每周上限;社区实测:Nano Banana 约 10-20 图/天,Nano Banana Pro 仅 2-3 图/天。**无 API,不可程序化**。 |
| **Google Cloud 新账户试用** | **$300 信用额度,90 天有效** | 覆盖 Vertex AI 所有模型(含 Veo 3.1、Imagen)。需绑信用卡但不会自动扣费(额度耗尽或到期才计费)。**这是开发者唯一"免费"试 API 的方式**。 |

### 4.4 消费级订阅(Gemini App 内更高配额,非 API)

| 计划 | 月费 | 视频生成 |
|---|---|---|
| AI Plus | $4.99 | 基础 |
| AI Pro | $19.99 | 含 Veo 视频,约 90 段/月 |
| AI Ultra | $99.99(2026 I/O 由 $249.99 降价;**部分第三方仍报 $199.99-$249.99,需核实**) | 20x 配额,完整 Veo 3.1 4K |

> 订阅价变动频繁,以 [one.google.com/about/google-ai-plans](https://one.google.com/intl/en_us/about/google-ai-plans/) 实时为准。订阅仅提升 Gemini App 内配额,**不提供 API 访问**。

---

## 五、协议与端点(适配 media-gen-mcp 关键)

### 5.1 OpenAI 兼容端点 ✅(Nano Banana 图像 + Veo 3.1 视频)

官方 OpenAI 兼容文档([ai.google.dev/gemini-api/docs/openai](https://ai.google.dev/gemini-api/docs/openai),更新于 2026-06-22)明确支持:

**Base URL**:`https://generativelanguage.googleapis.com/v1beta/openai/`
**鉴权**:`Authorization: Bearer $GEMINI_API_KEY`

| 能力 | 端点 | 支持模型 | 说明 |
|---|---|---|---|
| 文生图/图生图 | `POST /v1/images/generations` | `gemini-2.5-flash-image`、`gemini-3-pro-image-preview`(**Nano Banana 系列**) | 参数:`prompt`、`model`、`n`、`size`、`response_format`;宽高比、安全设置等走 `extra_body` |
| 文生视频 | `POST /v1/videos`(Sora 兼容) | `veo-3.1-generate-preview`(**Veo 3.1**) | **异步长任务**:返回 operation ID,轮询 `GET /v1/videos/{id}` 取结果;`duration_seconds`(4/6/8)、`resolution`、`aspect_ratio`、`image`(图生视频首帧)等走 `extra_body` |

### 5.2 原生端点(Imagen 系列 — 非 OpenAI 兼容)

Imagen 4 / Imagen 3 需用 Gemini 原生 `:predict` 或 Vertex AI 端点,**不能**通过 `/v1/images/generations` 调用(部分社区报告会 404)。

- Gemini API 原生:`POST .../v1beta/models/imagen-4.0-generate-001:predict`
- Vertex AI:`POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/publishers/google/models/imagen-4.0-generate-001:predict`

> 因 Imagen 4 即将关停,原生端点对 MCP 价值不大。

### 5.3 开源情况

**全部闭源**,无公开权重、无可下载模型、无可自部署版本。Imagen / Nano Banana / Veo / Lyria 均仅经 Google 托管 API 提供。

---

## 六、能力规格

### 6.1 图像

| 能力 | Nano Banana 系列(Gemini Image) | Imagen 4 |
|---|---|---|
| 分辨率 | 512px / 1K(1024²)/ 2K(2048²)/ 4K(4096²) | 默认 1024²,可 Upscale 至 2K/3K/4K |
| 单次出图 | 最多 10 张 | 1 张(+ upscale) |
| 图生图/编辑 | ✅ 原生编辑(标注、修改) | ✅(Inpainting/编辑 $0.02-0.06) |
| 文字渲染 | ✅ 优秀(Nano Banana Pro 最佳) | ✅ 显著改进 |
| 推理能力 | ✅ Gemini 3 推理(复杂构图/真实世界知识) | 无 |
| 最大输入 token | 65,536 | — |

### 6.2 视频(Veo 3.1)

| 能力 | 规格 |
|---|---|
| 最长时长 | 8 秒/次(可 Extend 续 ~7 秒) |
| 分辨率 | 720p / 1080p / 4K |
| 帧率 | 24 FPS |
| 原生音频 | ✅ 同步语音/音效/配音(Veo 3 系列核心卖点) |
| 输入 | 文本提示 / 参考图(图生视频)/ 起止帧插值 / 风格参考(最多 3 图) |
| 生成耗时 | 8 秒 1080p 约 2-3 分钟 |
| 控制 | 负向提示、seed、运镜、人物生成策略 |

---

## 七、media-gen-mcp 适配评估

| 模型组 | 适配难度 | 理由 |
|---|---|---|
| **Nano Banana 全系**(`gemini-2.5-flash-image` / `gemini-3-pro-image-preview` / `gemini-3.1-flash-image`) | **easy** | 完整 OpenAI 兼容 `/v1/images/generations`,只需设 base_url + GEMINI_API_KEY 即可走现有 OpenAI provider |
| **Veo 3.1 全系**(Standard/Fast/Lite) | **custom**(半易) | 走 OpenAI 兼容 `/v1/videos`,但需实现 **异步轮询逻辑**(create→poll `GET /v1/videos/{id}`),多数现成 images provider 不含此流程,需自写 provider |
| **Imagen 4 / Imagen 3** | **custom** | 仅原生 `:predict` 端点,且 Imagen 4 即将关停,**不建议接入** |

**推荐接入优先级**:① Gemini 2.5 Flash Image(便宜 $0.039/图、OpenAI 兼容、Imagen 4 官方迁移目标)→ ② Gemini 3.1 Flash Image(更快)→ ③ Gemini 3 Pro Image(最高质量)→ ④ Veo 3.1 Lite(最省视频, $0.03-0.05/秒)→ ⑤ Veo 3.1 Fast / Standard。

---

## 八、需核实 / 注意事项

1. **每模型精确 RPM/TPM**:官方未公开具体数字,须在 Google AI Studio 控制台查看;preview 模型限速更严。
2. **AI Ultra 订阅现价**:官方页 $99.99/月,但多个第三方仍报 $199.99-$249.99,可能因地区/促销/时效差异,**以官方页为准**。
3. **Gemini App 免费配额**:非固定数字,Google 用滚动 5 小时算力窗口 + 周上限,社区实测 10-20 图/天波动较大。
4. **Veo 失败重试成本**:社区有报告称 Veo 实际成本可达标价的 5-16 倍(因失败重试),生产环境需预算缓冲。
5. **Veo 3.1 为 preview**:模型在稳定前可能变更,限速更严。

---

## 来源(官方优先)

- Vertex AI 定价(图像/视频核价):https://cloud.google.com/vertex-ai/generative-ai/pricing
- Gemini Developer API 定价(免费层标注):https://ai.google.dev/gemini-api/docs/pricing
- OpenAI 兼容端点(图像/视频协议):https://ai.google.dev/gemini-api/docs/openai
- 限速文档:https://ai.google.dev/gemini-api/docs/rate-limits
- Veo 3.1 模型页:https://deepmind.google/models/veo/
- Nano Banana Pro 介绍:https://blog.google/innovation-and-ai/products/nano-banana-pro/
- Google AI 订阅计划:https://one.google.com/intl/en_us/about/google-ai-plans/