# 聚合平台文生图/文生视频模型深度调研：fal · Replicate · SiliconFlow

> 调研时间：2026-07｜数据来源：各平台官方定价页/文档 + 第三方对比（TeamDay、CheckThat、PricePerToken）。所有数字尽量取自官方页；查不清处明确标注"需核实"。
> 核心结论：**SiliconFlow 是唯一 OpenAI 原生兼容（easy）的平台**；fal 与 Replicate 均为私有协议（custom，需写 provider）。

---

## 一、平台总览对比

| 维度 | **fal.ai** | **Replicate** | **SiliconFlow（硅基流动）** |
|---|---|---|---|
| 定位 | GenAI 媒体推理聚合（图像/视频为主） | 模型托管 + 社区模型聚合（最全开源） | 开源模型推理云（LLM+多模态，国内主力） |
| 计费模式 | 预付积分，按输出计费（每图/每秒） | 预付积分，按 GPU 秒 或 输入/输出计费 | 按需付费（每图/每视频/token） |
| **新用户免费额度** | 约 **$1** 促销积分（Sandbox 可试全模型，官方未公开固定数额，**需核实**）| 邀请链接 **$10** 积分（12 个月过期）；无永久免费层 | 国际版 **$1** 免费积分；国内版注册送 **14 元**（约 $2）|
| 限速机制 | **并发制**：新号默认 2 并发，随充值升到 40；无固定 RPM | 无支付方式：**1 req/s，6 req/min**；有支付方式后放宽 | 模型广场标 RPM；FLUX schnell 免费版有限流 |
| **API 协议** | **私有**（`fal.run/{model}`、fal-client）| **私有**（`api.replicate.com/v1/predictions`）| **OpenAI 兼容**（`api.siliconflow.cn/v1`，`images.generate()`）|
| 信用卡要求 | 不强制（可仅用促销积分）| 不强制（但无卡则被限速 6 req/min）| 不强制 |
| 适合 MCP | **custom**（私有协议，需写 provider）| **custom**（私有 REST，需写 provider）| **easy**（OpenAI SDK 直接接入）|
| 模型数量 | 1000+（媒体生成为主）| 数千（社区开源最全 + 部分闭源）| 100+（开源为主，含国产全家桶）|

---

## 二、fal.ai 详细

### 2.1 文生图/图生图模型（官方定价页 2026）

fal 采用"按输出计费"，图像按张数或每兆像素(MP)计费。

| 模型 | 计费单位 | 单价 | 每 $1 产出 | 说明 |
|---|---|---|---|---|
| **Seedream V4** | 每图 | **$0.03** | 33 张 | 字节跳动图像模型 |
| **Flux Kontext Pro** | 每图 | **$0.04** | 25 张 | 图像编辑 |
| **Nanobanana** | 每图 | **$0.0398** | 25 张 | Google Gemini 系 |
| **Qwen Image** | 每兆像素 | **$0.02** | 50 MP | 阿里通义 |

**2026 最新图像模型族**（见 fal.ai 底部导航）：Seedream 5.0、GPT Image 2、Flux 2、Nano Banana 2、Nano Banana Pro、Ideogram 4、Krea 2、Qwen Image 2.0。

### 2.2 文生视频/图生视频模型（官方定价页 2026）

视频按输出秒数或单个视频计费。

| 模型 | 计费单位 | 单价 | 每 $1 产出 | 说明 |
|---|---|---|---|---|
| **Wan 2.5** | 每秒 | **$0.05** | 20 秒 | 阿里万相 |
| **Kling 2.5 Turbo Pro** | 每秒 | **$0.07** | 14 秒 | 快手可灵 |
| **Veo 3** | 每秒 | **$0.40** | 3 秒 | Google，最贵 |
| **Ovi** | 每视频 | **$0.20** | 5 个视频 | — |

**2026 最新视频模型族**：Seedance 2.0（字节）、Gemini Omni、Kling 3.0、Veo 3.1、Grok Imagine 1.5、HappyHorse 1.0（阿里）、Wan 2.7、LTX 2.3、PixVerse V6。

### 2.3 免费/限速/付费（fal）

- **免费额度**：新账号送约 **$1 促销积分**（来源 Sandbox 文档 + 第三方），可用于全模型试用。**官方未公开固定数额，需核实**。促销积分可能过期，现金充值的积分不过期。
- **限速（重点）**：fal **不用 RPM，用并发**。新号默认 **2 个并发请求**，随累计充值自动升到 **40 并发**。超额请求自动排队、最多重试 10 次后返回 429。部署到自家 Serverless 端点不受此限。
- **付费**：纯预付积分，无订阅。GPU 租用另计：H100 低至 $1.89/hr，B300 低至 $4.49/hr，B200 低至 $3.49/hr。
- **协议**：私有。端点 `https://fal.run/{model-id}`（同步）/ `https://queue.fal.run/{model-id}`（队列）。需 fal-client 或自行封装，**非 OpenAI 格式**。

---

## 三、Replicate 详细

### 3.1 文生图/图生图模型（官方定价页示例）

Replicate 多数模型按"GPU 运行秒"计费，部分按"输出张数/输出秒"计费（以下为输出计费的代表作）。

| 模型 | 计费单位 | 单价 | 说明 |
|---|---|---|---|
| **black-forest-labs/flux-1.1-pro** | 每图 | **$0.04** | FLUX Pro 高质量 |
| **black-forest-labs/flux-dev** | 每图 | **$0.025** | 12B 开源 |
| **black-forest-labs/flux-schnell** | 每千图 | **$3.00**（≈$0.003/图）| 最快、最便宜 |
| **ideogram-ai/ideogram-v3-quality** | 每图 | **$0.09** | 文字渲染强 |
| **recraft-ai/recraft-v3** | 每图 | **$0.04** | 长文本/多风格 |

文生视频（按输出秒计费代表作）：

| 模型 | 计费单位 | 单价 | 说明 |
|---|---|---|---|
| **wavespeedai/wan-2.1-i2v-480p** | 每秒 | **$0.09** | 图生视频 480P |
| **wavespeedai/wan-2.1-i2v-720p** | 每秒 | **$0.25** | 图生视频 720P |

Replicate 同样托管 **Kling、Veo、Wan** 等视频模型（见 `replicate.com/collections/text-to-video`），但视频模型数量少于 fal。

### 3.2 GPU 硬件按秒计费（自定义/社区模型）

| 硬件 | 每秒 | 每小时 |
|---|---|---|
| Nvidia T4 | $0.000225 | $0.81 |
| Nvidia L40S | $0.000975 | $3.51 |
| Nvidia A100 80GB | $0.001400 | $5.04 |
| Nvidia H100 | $0.001525 | $5.49 |

### 3.3 免费/限速/付费（Replicate）

- **免费额度**：**无永久免费层、无月度赠送**。通过邀请链接注册得 **$10 促销积分**（签发后 **12 个月过期**）。另有 Try-for-Free 合集可免卡试玩部分模型。
- **限速（重点）**：若账号**未绑定支付方式**，强制限速 **1 请求/秒、最多 6 请求/分钟**。绑定支付方式后放宽（具体值未公开，**需核实**）。
- **付费**：已全面转预付积分；可设月度消费上限（如 $10/月）。初创企业可申请 **$1K–$10K 积分**（审核 3–14 个工作日）。
- **协议**：私有 REST，`POST https://api.replicate.com/v1/predictions`（异步，提交后轮询结果）。需自行封装，**非 OpenAI 格式**。

---

## 四、SiliconFlow（硅基流动）详细 — 最适合 MCP

### 4.1 文生图/图生图模型（国际版官方定价，每张图 USD）

| 模型 | 单价（每图） | 开源情况 |
|---|---|---|
| **FLUX.2 [flex]** | **$0.06** | 闭源（Black Forest Labs）|
| **FLUX.2 [pro]** | **$0.03** | 闭源 |
| **FLUX 1.1 [pro]** | **$0.04** | 闭源 |
| **FLUX 1.1 [pro] Ultra** | **$0.06** | 闭源 |
| **FLUX.1 Kontext [max]** | **$0.08** | 闭源 |
| **FLUX.1 Kontext [pro]** | **$0.04** | 闭源 |
| **FLUX.1-dev** | **$0.014** | **开源**（权重 HuggingFace）|
| **Z-Image-Turbo** | **$0.005** | 自研（需核实开源）|
| **Qwen-Image / Qwen-Image-Edit** | 按 MP 计 | 阿里开源 |

国内版另有按"¥0.006/百万像素/Step"计费（FLUX.1-schnell 收费版不限流；1024×1024、4 步 ≈ ¥0.025/张）。**FLUX.1-schnell 免费版有限流，可零成本体验**。

### 4.2 文生视频/图生视频模型（国际版官方定价，每个视频 USD）

| 模型 | 单价（每视频） | 能力 |
|---|---|---|
| **Wan2.2-I2V-A14B** | **$0.29** | 图生视频 |
| **Wan2.2-T2V-A14B** | **$0.29** | 文生视频 |
| **Wan2.1-T2V-14B / Turbo** | 约 $0.21（Turbo，需核实）| 文生视频，中英文字 |
| **Lightricks/LTX-Video** | ¥0.14/视频（需核实 USD）| 轻量视频 |

注意：**Kling / Vidu / CogVideo 不在 SiliconFlow 官方模型列表**，需去各自平台或 fal/Replicate。

### 4.3 免费/限速/付费（SiliconFlow）

- **免费额度**：国内版新用户注册送 **14 元**（约 2000 万 Qwen1.5-14B token，约 $2）；国际版 **$1 免费积分**。部分模型（≤9B 的 LLM、FLUX.1-schnell 免费版）**永久免费**但限速。
- **限速**：各模型在"模型广场"标注独立 RPM；FLUX.1-schnell 免费版有显式限流（具体 RPM 值**需核实**，收费版不限流）。
- **付费**：按需付费，无订阅/无最低承诺。可设月度消费上限。
- **协议（关键优势）**：**OpenAI 原生兼容**。`base_url=https://api.siliconflow.cn/v1`，直接用 OpenAI SDK：
  ```python
  client = OpenAI(api_key="...", base_url="https://api.siliconflow.cn/v1")
  client.images.generate(model="Kwai-Kolors/Kolors", prompt="a cat", size="1024x1024")
  ```
  支持 `/v1/images/generations`、`/v1/images/edits`、`/v1/models`。**media-gen-mcp 可零改造接入**。

---

## 五、限额/限速/收费精确核对清单

| 项目 | fal.ai | Replicate | SiliconFlow |
|---|---|---|---|
| 免费额度具体数 | ~$1（需核实）| $10（仅邀请链接，12 月过期）| $1 / 14 元 |
| 是否到期 | 促销积分到期；充值不过期 | $10 积分 12 月过期 | 额度长期有效（需核实）|
| 需信用卡 | 否 | 否（不绑则限速 6/min）| 否 |
| RPM | 无固定值（并发制）| 无卡：6/min；有卡：需核实 | 模型级标注，schnell 免费版限流 |
| 并发数 | 默认 2 → 充值升到 40 | — | — |
| 每日/每月上限 | 无硬上限，受并发约束 | 可设月度消费上限 | 可设月度消费上限 |
| 最低付费图价 | ~$0.02/MP（Qwen）| ~$0.003/图（flux-schnell）| ~$0.005/图（Z-Image-Turbo）|
| 最低付费视频价 | $0.05/秒（Wan 2.5）| $0.09/秒（wan-2.1 480p）| $0.21–0.29/视频（Wan）|
| 订阅制 | 无 | 无 | 无 |

---

## 六、media-gen-mcp 适配结论

| 平台 | 适配等级 | 原因 | 接入方式 |
|---|---|---|---|
| **SiliconFlow** | **easy** | OpenAI 原生兼容 `/v1/images/generations`，SDK 直用 | 复用现有 OpenAI provider，仅改 base_url + key |
| **fal.ai** | **custom** | 私有协议（fal.run），需写 provider；但模型最全、视频最强 | 写 fal provider（队列 API + webhook/轮询）|
| **Replicate** | **custom** | 私有 REST（异步 predictions），需写 provider | 写 Replicate provider（提交 + 轮询）|

**推荐组合**：MCP 主力用 **SiliconFlow**（OpenAI 兼容、免费起步、国产模型全、价格最低）作为 easy 默认；**fal.ai** 作为 custom provider 补充高端视频（Veo 3.1、Kling 3.0、Seedance 2.0）；**Replicate** 作为 custom provider 补充最全开源模型（FLUX 全系 + 社区长尾）。

---

## 数据来源

- [fal.ai 定价页](https://fal.ai/pricing)｜[fal 并发限制文档](https://fal.ai/docs/documentation/model-apis/concurrency-limits)｜[fal Sandbox 免费积分](https://fal.ai/docs/documentation/model-apis/sandbox)
- [Replicate 定价页](https://replicate.com/pricing)｜[Replicate 计费文档](https://replicate.com/docs/topics/billing)｜[Replicate 限速](https://replicate.com/docs/topics/predictions/rate-limits)
- [SiliconFlow 定价页](https://www.siliconflow.com/zh/pricing)｜[SiliconFlow 价格说明](https://docs.siliconflow.com/cn/faqs/billing-rules)｜[SiliconFlow 生图文档](https://docs.siliconflow.com/cn/userguide/capabilities/images)｜[SiliconFlow 视频文档](https://docs.siliconflow.cn/cn/userguide/capabilities/video)
- 第三方：[TeamDay 2026 对比](https://www.teamday.ai/blog/ai-api-pricing-comparison-2026)｜[PricePerToken](https://pricepertoken.com/image)｜[CheckThat Replicate 2026](https://checkthat.ai/brands/replicate/pricing)