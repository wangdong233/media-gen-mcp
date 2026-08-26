# Luma AI 文生图 / 文生视频模型深度调研(2026年7月)

> 厂商:Luma AI(Luma Labs),官网 https://lumalabs.ai
> 调研日期:2026-07-13
> 数据来源:官方定价页 lumalabs.ai/pricing、官方 API 页 lumalabs.ai/api、官方文档 docs.lumalabs.ai、官方公告 lumalabs.ai/news/uni-1-1-api,辅以第三方交叉验证。

---

## 一、厂商概览

Luma AI 是总部位于美国的创意 AI 平台,核心产品为 **Dream Machine**(Web 创作平台)+ **Luma API**(开发者 REST API)。2026 年其原生模型矩阵已演化为两大旗舰:

- **Uni(图像)**:统一智能(Unified Intelligence)自回归推理图像模型,推理与生成在同一模型内完成。当前版本 **Uni-1.1 / Uni-1.1 Max**。
- **Ray(视频)**:电影级视频生成模型,号称"世界首个推理视频模型"。当前版本 **Ray3.2**(旗舰,原生 1080p + 16-bit HDR)。

⚠️ 重要提示:Luma 平台(dream machine web app)还**聚合了第三方模型**(Veo 3/3.1、Kling 2.6/3.0/Omni、Seedance 2.0/Mini、GPT Image 1.5/2、Nano Banana/Pro、Seedream 等),这些**非 Luma 原生**,本报告聚焦 Luma 自研模型。

| 维度 | 结论 |
|---|---|
| 开源/闭源 | **全部闭源**,无权重、无下载 |
| API 协议 | **私有 REST API**(异步:创建→轮询→取结果),**非 OpenAI 兼容** |
| API 端点 | `https://api.lumalabs.ai` |
| 原生图像模型 | Uni-1.1(推荐)、Uni-1.1 Max、Photon-1 / Photon-Flash-1(旧版,仍在 API 文档) |
| 原生视频模型 | Ray3.2(旗舰)、Ray3.14、Ray3(上一代)、Ray-2 / Ray-Flash-2(旧版,仍在 API 文档) |

---

## 二、模型清单(原生 Luma 模型)

### 图像模型(Image)

| 模型 | 定位 | 状态 | 分辨率 | 备注 |
|---|---|---|---|---|
| **Uni-1.1** | 推理图像生成(推荐) | 当前主力 | 2048px | 文生图 + 自然语言编辑;~31 秒/张;支持 ≤9 张参考图 |
| **Uni-1.1 Max** | 高质量档 | 当前 | 2048px | 质量/成本更高 |
| **Uni-1** | 上一代 | 平台仍可用 | 2048px | 平台 30 credits/张 |
| **Photon-1** | 旧版性价比 | 旧版(API 文档仍在) | 1080p | ~$0.015/张 |
| **Photon-Flash-1** | 旧版极速/低价 | 旧版(API 文档仍在) | 1080p | ~$0.002/张 |

### 视频模型(Video)

| 模型 | 定位 | 状态 | 原生分辨率 | 时长 | 特色 |
|---|---|---|---|---|---|
| **Ray3.2** | 电影级旗舰 | 当前主力 | 1080p | T2V/I2V 5s/10s;V2V 最长 20s | 16-bit HDR 原生 + EXR 导出;多关键帧(单 clip 最多 16 个关键帧) |
| **Ray3.14** | 平台变体 | 当前(平台定价页) | 1080p | 按秒计 | 成本结构低于 Ray3.2(HDR 4×) |
| **Ray3** | 上一代旗舰 | 2025-09 发布 | 1080p | 5s/10s | "推理视频模型"、首个 16-bit HDR;HDR 请求可能回落到 Ray3 |
| **Ray-2** | 旧版 | 旧版(API 文档仍在) | 1080p | 10s | ~$0.19/秒 |
| **Ray-Flash-2**(Ray 2 Flash) | 旧版极速/低价 | 旧版(API 文档仍在) | 720p | 30s | ~$0.06/秒(11 credits/秒) |

---

## 三、免费额度(最高优先级,精确标注)

### 1. Web 端(Dream Machine 应用)

| 项目 | 现状(2026-07) |
|---|---|
| 免费计划 | **已基本取消 / 严重受限**。官方现行定价页 `lumalabs.ai/pricing` **不再列出 Free 档**,仅显示 Plus / Pro / Ultra。 |
| 历史免费额度 | 此前为约 **30 次生成/月**(5 秒、720p、带水印、无音频、禁商用)。 |
| 现状说明 | Reddit/CheckThat.ai 等多个 2026 来源反映 Luma 已转向"付费为主",社区反馈"无免费 credits"。部分第三方营销页仍残留"每日免费 credits"字样,**疑为过期信息**。 |
| 是否需信用卡 | Web 注册通常**不需信用卡**;但实际可用免费额度**已近乎为零**。 |

> ⚠️ **免费额度标注:需核实**。以官方定价页为准,当前**实质上无可用免费视频生成额度**。如需零成本试用,只能通过第三方平台(如 Replicate 的免费额度、fal.ai 试用额度)间接体验。

### 2. API 端(开发者)

| 项目 | 现状 |
|---|---|
| 免费 API 层 | **无**。API 纯按量付费(pay-as-you-go),注册需绑定付费方式。 |
| 试用 credits | 官方未公开承诺新用户免费 API credits(需核实)。 |

---

## 四、限速 / 限次(精确标注)

### API Build 档(按量付费)

| 限制项 | 数值 | 说明 |
|---|---|---|
| 速率限制 | **共享资源池,峰值期会触发限流** | 官方营销页仅写"Rate limits apply, no latency SLA",**未公开具体 RPM/并发数 → 需核实**。 |
| 延迟 SLA | **无** | Build 档不保证延迟。 |

### API Scale 档(专用容量)

| 限制项 | 数值 |
|---|---|
| 单位定义 | 1 unit = **1 RPM(Base 基础档)** 或 **0.4 RPM(Max 高吞吐档)** |
| 起订 | **最少 4 units**(即 Base 4 RPM 起,或 Max 1.6 RPM 起) |
| 包含 | SLA、内容审核、prompt 增强、**不用于训练保证(no-train guarantee)** |

> ⚠️ **Build 档具体 RPM 需核实**(官方营销页未明示数字)。Scale 档以上数字来自官方 `lumalabs.ai/api` 页,可信。
> 注:`docs.luma.com/reference/rate-limits`(GET 500/5min、POST 100/5min)是**另一家公司 Luma(日历应用)** 的文档,**与 Luma AI 无关**,切勿混淆。

---

## 五、付费价格(精确,USD)

### A. API 按量付费(Build 档)—— 官方直接定价

#### Ray3.2 视频(SDR 基准价,来自 `lumalabs.ai/api`)

| 任务 | 540p | 720p | 1080p |
|---|---|---|---|
| 文生视频 / 图生视频(5 秒) | $0.15 | $0.30 | **$1.20** |
| 文生视频 / 图生视频(10 秒) | $0.45 | $0.90 | **$3.60** |
| 视生视频 V2V(5 秒) | $0.72 | $1.44 | $2.16 |
| 视生视频 V2V(10 秒) | $1.08 | $2.16 | $4.32 |
| Reframe(每秒) | $0.06 | $0.12 | $0.36 |

- **HDR 输出 = 2× SDR 价格**
- **HDR + EXR 输出 = 3× SDR 价格**
- 无最低消费;失败生成不收费。

#### Uni-1.1 图像(来自官方公告 + 第三方交叉验证)

| 档位 | 价格/张 | 备注 |
|---|---|---|
| **Uni-1.1(标准)** | **~$0.0404/张** | 2048px;~31 秒/张 |
| **Uni-1.1 Max** | **~$0.10/张** | 更高质量 |
| Image Edit(自然语言编辑) | **~$0.0434/张** | 改图 |

#### 旧版模型(仍在 API,第三方报价)

| 模型 | 价格 |
|---|---|
| Photon-1 | ~$0.015/张(1080p);Replicate 上 ~$0.03/张 |
| Photon-Flash-1 | ~$0.002/张 |
| Ray-2 | ~$0.19/秒(~$0.95/5s 1080p) |
| Ray-Flash-2(Ray 2 Flash) | ~$0.06/秒(11 credits/秒) |

### B. Web 端订阅(Dream Machine,credit 制,来自 `lumalabs.ai/pricing`)

| 套餐 | 月付 | 年付(省 20%) | Credits | 说明 |
|---|---|---|---|---|
| Plus | $30/月 | $300/年 | 10,000 | Luma + 第三方模型;商用授权 |
| Pro | $90/月 | $900/年 | 40,000 | 含 4× Luma Agents 用量 |
| Ultra | $300/月 | $3,000/年 | 150,000 | 含 15× Luma Agents 用量 |
| Team / Enterprise | 联系销售 | — | — | SSO、团队管理、用量分析、定制微调 |

#### Credit 换算参考(平台 credit 成本)
- Plus:$30 / 10,000 = **$0.003/credit**
- Pro:$90 / 40,000 = **$0.00225/credit**
- Ultra:$300 / 150,000 = **$0.002/credit**

#### 平台原生模型 credit 消耗(摘录)
| 模型 / 任务 | Credit 消耗 |
|---|---|
| Ray3.2 T2V/I2V 1080p | 400 credits/5s;1200 credits/10s |
| Ray3.2 T2V/I2V 720p | 100 credits/5s;300 credits/10s |
| Ray3.2 T2V/I2V 540p | 50 credits/5s;150 credits/10s |
| Ray3.2 T2V/I2V Draft | 20 credits/5s;60 credits/10s |
| Ray3.14 T2V/I2V 1080p | 80 credits/秒 |
| Uni-1(图像) | 30 credits/张 |
| Upscale 到 1080p | 10 credits/秒 |
| Upscale 到 4K | 17 credits/秒 |

---

## 六、协议与端点

| 项目 | 详情 |
|---|---|
| 协议类型 | **私有 REST API(异步)**,**非 OpenAI 兼容** |
| Base URL | `https://api.lumalabs.ai` |
| 工作流 | ① POST 创建生成任务 → 返回 generation ID → ② GET 轮询状态(直到 completed)→ ③ 取回结果 URL |
| 认证 | Bearer Token(API key) |
| SDK | 官方 **Python** 与 **JavaScript/TypeScript** SDK |
| MCP | 官方 MCP server:`github.com/lumalabs/luma-api-mcp` |
| 第三方代理 | Replicate、fal.ai、Vercel AI SDK、AIMLAPI 等可提供 OpenAI 兼容封装(经第三方,非官方) |

**关键结论**:Luma 原生 API **不支持** `/v1/images/generations` 这类 OpenAI 标准端点,必须用其私有"创建-轮询"模式。

---

## 七、能力(分辨率 / 时长 / 特色)

### 图像(Uni-1.1)
- 分辨率:**2048px**
- 宽高比:1:1、9:16、16:9 等标准比例
- 格式:PNG / JPEG
- 特色:**推理式生成**(先理解意图再出图);单次支持 **≤9 张参考图**(角色/构图/风格/身份保持);**自然语言编辑**(改背景/光线/局部);多语言原生渲染(含中文/日文/阿拉伯文);出图 ~31 秒。
- 排名:Image Arena 文生图 + 图像编辑 **Top 3 实验室**;Human Preference Elo 多项 #1。

### 视频(Ray3.2)
- 原生分辨率:**1080p**(全模式)
- HDR:**原生 16-bit 色彩**(业界首个),支持 EXR 导出,可与实拍素材在 DaVinci Resolve / Nuke 中合成
- 时长:T2V/I2V = 5s 或 10s;**V2V 最长 20 秒**;Modify 模式可达 18s;Extensions 可累计至 ~30s
- 关键帧:**多关键帧(Multi-Keyframe)**,单 clip 内可设最多 **16 个关键帧**
- Draft Mode:低分辨率预览,比正式渲染快/省 5-10×,便于快速试创意
- 模式:T2V、I2V、V2V、Reframe(改宽高比)、Extend(延长)、Interpolate

---

## 八、适合 media-gen-mcp 的评估

| 模型 | 适配难度 | 理由 |
|---|---|---|
| Uni-1.1(图像) | **custom** | 私有 REST(创建+轮询),非 OpenAI 兼容,需写自定义 provider |
| Ray3.2(视频) | **custom** | 同上,异步轮询模式,需自定义 provider |

**整体结论:Luma 所有原生模型 = `custom`**(必须为 media-gen-mcp 编写私有 provider)。

- ✅ 优势:质量顶尖(电影级 HDR 视频、推理式图像)、官方提供 Python/JS SDK 与 MCP server 可参考、价格在同类中有竞争力("不到同类一半价格/延迟")。
- ⚠️ 劣势:**无免费 API 层**、**无 OpenAI 兼容端点**(不能直接复用 OpenAI provider)、Build 档速率限制不透明、异步轮询增加集成复杂度。
- 变通方案:若想用 OpenAI 兼容方式接 Luma,可走 **fal.ai / Replicate / AIMLAPI** 等第三方代理(但价格略高、非官方直连)。

---

## 九、需要核实的事项(诚实标注)

1. **免费额度**:官方现行定价页已无 Free 档;2026 年社区反映免费层"已基本取消"。确切是否还残留极少量免费 credits **需核实**(以官方页实时为准)。
2. **Build 档 API 具体 RPM / 并发数**:官方营销页仅写"rate limits apply",**未公开精确数字,需核实**(建议登录 API dashboard 或联系销售确认)。
3. **Ray3.14 与 Ray3.2 的关系**:平台定价页同时列出两者,Ray3.14 成本更低(HDR 4×)、Ray3.2 为旗舰(HDR 2×/3× + EXR)。两者定位差异的具体说明 **需核实官方文档**。
4. **旧版模型(Ray-2 / Photon)长期可用性**:当前 API 文档仍引用,但 Luma 已迭代到 Ray3.2 / Uni-1.1,旧版**随时可能下线**(Ray 1.6 已被第三方确认弃用)。生产环境建议用最新版。

---

## 十、信息来源

- 官方定价页:https://lumalabs.ai/pricing(credit 消耗、订阅套餐)
- 官方 API 页:https://lumalabs.ai/api(Ray3.2 / Uni-1.1 API 价格、Build/Scale 档)
- 官方 API 文档:https://docs.lumalabs.ai/docs/api(端点、模型能力)
- 官方公告 Uni-1.1 API:https://lumalabs.ai/news/uni-1-1-api(2048px、~31s、参考图、定价档)
- 官方 Photon 页:https://lumalabs.ai/photon(旧版图像模型价格)
- 官方 Reframe 文档:https://docs.lumalabs.ai/docs/reframe-video-image(ray-2/ray-flash-2/photon-1 模型参数)
- 第三方:The Decoder、Artificial Analysis、Apiframe、Flowith 2026 定价指南、CheckThat.ai(交叉验证价格与免费层状态)