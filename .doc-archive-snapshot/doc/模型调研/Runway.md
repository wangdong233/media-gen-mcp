# Runway 文生图 / 文生视频 模型深度调研(2026)

> 数据截至 2026-07。核心限额/价格均来自 Runway 官方文档(docs.dev.runwayml.com)与官网定价页(runwayml.com/pricing),第三方数据仅作交叉验证并标注。

---

## 一、厂商概述

Runway 是头部 AI 媒体生成平台,2026 年其 API 已从"自研模型 API"演变为"多模型聚合媒体平台":既托管**自研模型**(Gen-4.5、Gen-4 Turbo、Aleph 2、Act-Two、HappyHorse 等),也**聚合第三方模型**(Google Veo 3.1 / Gemini Image、OpenAI GPT Image 2、字节 Seedance 2.0 / Seedream 5、ElevenLabs 音频、Magnific 放大等)。统一用 **credit(积分)** 计费。

**关键定位:**
- 闭源 SaaS + API,所有模型均**不开源**。
- API 为**私有协议**(异步任务模式,非 OpenAI 兼容)。
- 文档站:`https://docs.dev.runwayml.com`;开发门户:`https://dev.runwayml.com`。

---

## 二、模型清单(官方 API 暴露的全部模型)

### 视频生成模型(文生视频 / 图生视频 / 视频编辑)

| 模型名(model) | 输入 | 输出 | 归属 | 状态 |
|---|---|---|---|---|
| `gen4.5` | Text 或 Image | Video | **Runway 自研**(旗舰) | 在售 |
| `gen4_turbo` | Image | Video(图生视频) | **Runway 自研** | 在售 |
| `aleph2` | Video + Text/Image | Video(视频编辑/续作) | **Runway 自研** | 在售 |
| `act_two` | Image 或 Video | Video(动作/表演一致性) | **Runway 自研** | 在售 |
| `happyhorse_1_0` | Text 或 Image | Video | Runway 平台托管(名义"开源"实际未放权) | 在售 |
| `seedance2` | Text/Image/Video | Video | 字节跳动(聚合) | 在售,支持 4K |
| `seedance2_fast` | Text/Image/Video | Video | 字节跳动(聚合) | 在售 |
| `seedance2_mini` | Text/Image/Video | Video | 字节跳动(聚合) | 在售 |
| `veo3` | Text 或 Image | Video | Google(聚合) | 在售 |
| `veo3.1` | Text 或 Image | Video(可选音频) | Google(聚合) | 在售 |
| `veo3.1_fast` | Text 或 Image | Video | Google(聚合) | 在售 |
| `gemini_omni_flash` | Text/Image/Video | Video(可选音频) | Google(聚合) | 在售 |
| `gen4_aleph` | Video + Text/Image | Video | Runway 自研 | **已弃用** |
| `gen3a_turbo` | — | Video | Runway 自研 | **已弃用** |

### 图像生成模型(文生图 / 图生图)

| 模型名(model) | 输入 | 输出 | 归属 |
|---|---|---|---|
| `gen4_image` | Text + 参考图(References) | Image | **Runway 自研**(旗舰文生图) |
| `gen4_image_turbo` | Text + 参考图 | Image(快速) | **Runway 自研** |
| `seedream5_pro` | Text | Image | 字节跳动(聚合) |
| `gemini_image3_pro` | Text + 参考图 | Image | Google(聚合,即 Nano Banana Pro) |
| `gpt_image_2` | Text + 参考图 | Image | OpenAI(聚合) |
| `gemini_2.5_flash` | Text + 参考图 | Image | Google(聚合) |

> 另有放大类:`magnific_precision_upscaler_v2`(图像)、`magnific_video_upscaler_creative`(视频),以及实时数字人 `gwm1_avatars`、音频类 `seed_audio` / ElevenLabs 系列——不在文生图/视频核心范围,从略。

---

## 三、开源 vs 闭源

**全部闭源。** Runway 自研模型(Gen-4.5 / Gen-4 / Aleph 2 / Act-Two)均无公开权重、无推理代码,GitHub 组织(github.com/runwayml,62 个仓库)只含媒体解码工具与教学材料,无任何生成模型权重。`happyhorse_1_0` 名义"开源"但 HuggingFace 页面 404、无官方仓库,实际闭源。第三方聚合模型(Veo / Gemini / GPT Image / Seedance)本身亦闭源。

---

## 四、免费额度 + 限速(最高优先级,精确)

### 4.1 API(开发者,dev.runwayml.com)

| 项目 | 说明 |
|---|---|
| **API 免费额度** | **无。** 新账号不自动赠送 API credit。API 最低充值 **$10 = 1,000 credits** 起步(官方 setup 文档明确)。免费 API credit 仅在官方 Hackathon 等活动期间发放(如 2026-04 API Hackathon)。 |
| **是否需信用卡** | 不强制信用卡,但需在 Billing 充值 ≥ $10 才能调用。 |
| **RPM(每分钟请求)** | **无 RPM 限制**——只要在"每日生成上限"内即可;超并发的任务自动排队(状态 `THROTTLED`),无需客户端限流。 |
| **并发数 / 每日上限 / 月消费上限** | 按 **Tier** 阶梯,充值越多自动升级,见下表(限速为"每模型、每组织";视频模型共享并发,图像模型共享并发)。 |

**官方 API Tier 限速表(权威):**

| Tier | 最大并发 | 每日生成上限 | 月消费上限 | 达成条件 |
|---|---|---|---|---|
| 1 | **1** | **50** | **$100** | 默认(充值后) |
| 2 | **3** | **500** | **$500** | 累计充值达 $50 后立即生效 |
| 3 | **5** | **1,000** | **$2,000** | 累计充值达 $100 后立即生效 |
| 4 | **10** | **5,000** | **$20,000** | 累计充值达 $1,000 后立即生效 |
| 5 | **20** | **25,000** | **$100,000** | 累计充值达 $5,000 后立即生效 |

> 超并发:任务被排队而非拒绝;超每日上限:返回 `429 Too Many Requests`。每日上限为 24 小时滚动窗口(非固定时刻重置)。企业级更高并发需发 exception 申请(enterprise@runwayml.com)。

### 4.2 消费者 Web 平台(runwayml.com)

| 套餐 | 价格 | 额度 | 说明 |
|---|---|---|---|
| **Free** | $0 | **125 一次性 credits**(非每月,用完即止) | 仅可访问 Gen-4 Turbo 图生视频、Gen-4 文生图等入门模型;带水印;3 个编辑项目;5GB 存储 |
| Standard | $12/月(年付)/ $15/月(月付) | 625 credits/月 | 全模型、4K 放大、无水印 |
| Pro | $28/月(年付)/ $35/月(月付) | 2,250 credits/月 | 自定义语音、500GB 存储、最佳模型 |
| Max | $76/月(年付)/ $95/月(月付) | 9,500 credits/月 | credit 滚存 1 个月、最新模型优先 |
| Enterprise | 联系销售 | 自定义 | SSO、团队分析等 |

> 注意:消费者平台的 125 免费 credit 与 API 体系**不互通**——不能拿 Web 免费 credit 跑 API。

---

## 五、付费价格(精确,官方 credit = $0.01)

### 5.1 视频生成(每秒,credits)

| 模型 | 分辨率 | credits/秒 | 折合 USD/秒 |
|---|---|---|---|
| `gen4.5` | 720p/1080p | **12** | **$0.12/s** |
| `gen4_turbo` | — | **5** | **$0.05/s** |
| `act_two` | — | **5** | **$0.05/s** |
| `aleph2` | — | **28**(单次最少 56) | **$0.28/s** |
| `seedance2` | 480p/720p | 36 | $0.36/s |
| `seedance2` | 1080p | 40 | $0.40/s |
| `seedance2` | **4K** | **150** | **$1.50/s** |
| `seedance2_fast` | 480p/720p | 29 | $0.29/s |
| `seedance2_mini` | 480p/720p | 16(单次最少 64) | $0.16/s |
| `veo3` | — | 40 | $0.40/s |
| `veo3.1`(含音频) | — | 40 | $0.40/s |
| `veo3.1`(无音频) | — | 20 | $0.20/s |
| `veo3.1_fast`(含音频) | — | 15 | $0.15/s |
| `veo3.1_fast`(无音频) | — | 10 | $0.10/s |
| `happyhorse_1_0` | 720p | 15 | $0.15/s |
| `happyhorse_1_0` | 1080p | 30 | $0.30/s |
| `gemini_omni_flash`(文生视频) | 720p | 10 | $0.10/s |
| `gemini_omni_flash`(图生视频) | 720p | 10 + 1(首帧) | $0.10/s + $0.01 |
| `gemini_omni_flash`(视频生视频) | 720p | 11(按输入秒,封顶 10s)+ 1/参考图 | $0.11/s |

> 典型 5s 片段成本:`gen4.5` = 60 credits($0.60);`gen4_turbo` = 25 credits($0.25);`seedance2 1080p 5s` = 200 credits($2.00)。

### 5.2 图像生成(每图,credits)

| 模型 | 规格 | credits/图 | 折合 USD/图 |
|---|---|---|---|
| `gen4_image` | 720p | **5** | **$0.05/图** |
| `gen4_image` | 1080p | **8** | **$0.08/图** |
| `gen4_image_turbo` | 任意分辨率 | **2** | **$0.02/图** |
| `seedream5_pro` | 1K | 5 | $0.05/图 |
| `seedream5_pro` | 2K | 9 | $0.09/图 |
| `gemini_image3_pro`(Nano Banana Pro) | 1K/2K | 20 | $0.20/图 |
| `gemini_image3_pro` | 4K | 40 | $0.40/图 |
| `gemini_2.5_flash` | 任意 | 5 | $0.05/图 |
| `gpt_image_2` | 按 quality × 分辨率 | 1–41 | $0.01–$0.41/图(见下) |

**`gpt_image_2` 价格矩阵(credits/图,× outputCount):**

| 质量 quality | 1K / 2K | 4K(含 auto) |
|---|---|---|
| low | 1($0.01) | 2($0.02) |
| medium | 5($0.05) | 11($0.11) |
| high(默认) | 20($0.20) | 41($0.41) |
| auto | 20($0.20) | 41($0.41) |

### 5.3 放大(Upscale,补充)

- 图像放大 `magnific_precision_upscaler_v2`:25 credits/图($0.25),输出超 4096px 则 150 credits($1.50)。
- 视频放大 `magnific_video_upscaler_creative`:按输出帧计费。720p/1K = $0.007/帧(10s@30fps = 210 credits);2K = $0.009/帧(270 credits);4K = $0.012/帧(360 credits)。

---

## 六、协议与端点

| 项目 | 详情 |
|---|---|
| **协议** | **私有 REST API**,**非 OpenAI 兼容**(非 `/v1/images/generations` 标准格式) |
| **Base URL** | `https://api.dev.runwayml.com` |
| **认证** | Bearer Token(API Key,在 dev.runwayml.com 获取),Header:`Authorization: Bearer <key>` |
| **调用模式** | **异步任务制**:POST 创建任务返回 `id`(HTTP 202),再轮询 `GET /v1/tasks/{id}` 获取状态与结果;不支持同步返回 |
| **主要端点** | `POST /v1/text_to_video`(文生视频);`POST /v1/image_to_video`(图生视频);`POST /v1/text_to_image`(文生图/图生图,支持参考图);`POST /v1/video_upscale`(视频放大);另有 recipes(产品广告等多步配方) |
| **输入资源** | 图片/视频需为可公开访问的 URL(或先用资产接口上传) |
| **文档** | https://docs.dev.runwayml.com/api/ |

> LiteLLM 提供了一个封装层(`docs.litellm.ai/docs/providers/runwayml/images`),可把 Runway 包成类 OpenAI 调用,但底层仍是 Runway 私有异步协议。

---

## 七、能力规格

### Gen-4.5(旗舰文/图生视频)
- 时长:**5s / 8s / 10s**
- 分辨率:**720p**(默认)/ **1080p**;4K 需通过 upscale
- 宽高比:16:9、9:16、1:1 等
- 强项:电影级视觉保真、运动一致性、提示遵循;官方称"全球评分第一的视频模型"
- 仅支持 Text-to-Video 与 Image-to-Video(关键帧扩展后续开放)

### Gen-4 Turbo
- 图生视频为主,5 credits/s(最便宜的自研视频模型),1080p,带相机控制、运动笔刷

### Gen-4 Image / Image Turbo
- 文生图 + 参考图(References,角色/风格一致性);720p / 1080p;Turbo 任意分辨率且仅 2 credits

### Aleph 2 / Act-Two
- Aleph 2:视频编辑/续作(视频 + 文本/图像输入)
- Act-Two:动作与表演一致性(表演捕捉升级,头像/面部/身体追踪)

### 第三方聚合
- Seedance 2.0:支持 **4K**,运动质量强(字节)
- Veo 3.1:支持音频生成(Google)
- GPT Image 2 / Gemini Image 3 Pro:高质量文生图(OpenAI / Google)

---

## 八、适合 media-gen-mcp 评估

| 维度 | 结论 |
|---|---|
| **适配等级** | **custom**(需自写 provider) |
| **原因** | 私有协议 + 异步任务轮询模式,与 OpenAI `/v1/images/generations` 同步返回格式不兼容,无法直接 easy 接入 |
| **接入要点** | 1) 实现 Bearer 认证;2) POST 创建任务 → 轮询 `GET /v1/tasks/{id}` 直到 `SUCCEEDED`;3) 处理 `THROTTLED`(排队)与 `429`(超每日上限);4) 输入图/视频需先转成公网 URL |
| **不能 no-api** | API 可用,无需走 Web 爬取 |
| **推荐首选模型** | 文生图:`gen4_image_turbo`($0.02/图,极便宜)/ `gen4_image`(1080p $0.08);文生视频:`gen4_turbo`($0.05/s,性价比最高)/ `gen4.5`($0.12/s,质量最高) |
| **成本预警** | 4K 视频(seedance2 $1.50/s)与 veo3($0.40/s)成本高;务必在 provider 层加预算/credit 闸 |

---

## 九、需核实 / 风险点

1. **Gen-4.5 是否支持文生图**:官方 Help 明确 Gen-4.5 当前**仅** Text-to-Video / Image-to-Video;文生图请用 `gen4_image`(已确认)。
2. **`gpt_image_2` / `gemini_image3_pro` 的 credit 价**为官方定价页数据,但模型更新较快,接入前建议在 dev portal 复核。
3. **第三方"每秒 $0.12 / 每图 $0.05"等报价**(crazyrouter、pixazo 等)与官方 credit 换算偶有出入,以官方 `$0.01/credit` × credit 数为准。
4. **月付价格**($15/$35/$95)来自第三方汇总(checkthat.ai / saascrmreview),官网默认展示年付价($12/$28/$76),月付价需在官网切换 billing cycle 复核。
5. **HappyHorse 归属**:Runway API 将其列为可用模型,但该模型"开源"宣传存疑(无公开权重),实质仅 API 可用。

---

## 十、来源

- 官方 API 定价:https://docs.dev.runwayml.com/guides/pricing/
- 官方 API 限速 Tier:https://docs.dev.runwayml.com/usage/tiers/
- 官方模型清单:https://docs.dev.runwayml.com/guides/models/
- 官方 API Reference:https://docs.dev.runwayml.com/api/
- 官方 Setup(最低充值 $10):https://docs.dev.runwayml.com/guides/setup/
- 官网消费者定价:https://runwayml.com/pricing
- Gen-4.5 介绍:https://runwayml.com/research/introducing-runway-gen-4.5
- 月付价格交叉验证:https://checkthat.ai/brands/runway/pricing 、https://saascrmreview.com/runway-ml-pricing/
- Act-Two 介绍:https://www.vp-land.com/p/runway-s-act-two-is-here