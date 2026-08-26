# Stability AI 深度调研报告(2026 最新)

> 调研日期:2026-07-13|数据来源:官方 platform.stability.ai / stability.ai / Hugging Face / 社区交叉核实
> 核心结论:**Stability AI 的官方 API 目前只提供"图像"生成服务;"视频"生成 API 已于 2025-07-24 正式下线,仅保留开源权重自托管。**

---

## 一、最重要的结论(务必先看)

### 1. 视频 API 已下线 — 这是最大的坑
官方价格更新页([stability.ai/api-pricing-update-25](https://stability.ai/api-pricing-update-25))明确写道:

> **Service deprecations:We will be discontinuing two API endpoints on July 24, 2025:**
> - **Stable Video API**(稳定视频 API)
> - Stable Diffusion 1.6 API

> While **Stable Video will no longer be available via API**, you can still deploy the model in your environment with a **Self-Hosted License**.

含义:
- **截至 2026 年,Stability AI 官方平台不提供任何"文生视频 / 图生视频" API。**
- Stable Video Diffusion(SVD / SVD-XT)只能通过 **Hugging Face 下载权重自托管**(开源),或走第三方托管商(如 Replicate / Fal / Segmind / VoltageGPU)。
- 网上流传的"image-to-video 端点 3 credits / 次"是 **2025-07-24 之前的过时信息**,现已失效。

### 2. 图像 API 仍在运营,价格体系为"积分制"
- **1 credit = $0.01**(100 credits = $1 USD)。
- 注册即赠 **25 credits(一次性,$0.25)**,**无循环免费额度**。
- 限速:**150 请求 / 10 秒**(单 key),超限返回 429 + 60 秒冷却;一个账号最多 **10 个 API key**。
- **非 OpenAI 兼容**:私有 REST API(v2beta),需自写 provider。

---

## 二、图像模型总览(文生图 / 图生图)

### A. 当前 API 可用的图像服务(Stable Image 品牌 + SD3.5 家族)

| 模型/服务 | 参数量 | 开源权重 | API 单图积分 | 单图 USD | 定位 |
|---|---|---|---|---|---|
| **Stable Image Ultra** | (基于 SD3.5) | 否(API 专享) | **8 credits** | **$0.08** | 旗舰,照片级真实感 |
| **Stable Diffusion 3.5 Large** | 8B | 是 | **6.5 credits** | **$0.065** | 顶级基础模型 |
| **Stable Diffusion 3.5 Large Turbo** | 8B(蒸馏) | 是 | **4 credits** | **$0.04** | 蒸馏加速版,4 步出图 |
| **Stable Diffusion 3.5 Medium** | 2.6B | 是 | **3.5 credits** | **$0.035** | 中端,消费级显卡可跑 |
| **Stable Image Core** | (SDXL 继任) | 否(API 专享) | **3 credits** | **$0.03** | 快速、低成本 |
| **Stable Diffusion XL 1.0** | 3.5B | 是 | **~0.9 credits**(≤30 步) | **~$0.009** | 最便宜,OpenRAIL++许可 |

> 注:2025-08-01 的官方调价表([stability.ai/api-pricing-update-25](https://stability.ai/api-pricing-update-25))**未列入上述"生成"类基础模型**,说明 Core/Ultra/SD3.5/SDXL 的单价 **未上涨**;调价只影响 Upscale/Control/Edit/3D/Audio 等附加服务。SDXL 社区曾热议"近 5 倍涨幅"(从 ~0.2 积分涨到 ~0.9 积分),现价约 **0.9 credits/图(≤30 步)**,与新表一致。

### B. 辅助图像服务(2025-08-01 生效价,均未变)

| 类别 | 服务 | 积分 | USD |
|---|---|---|---|
| **放大 Upscale** | Creative Upscaler(4K,带提示词) | 60 | $0.60 |
| | Conservative Upscaler(4K,保真) | 40 | $0.40 |
| | Fast Upscaler(4×,至 4MP) | 2 | $0.02 |
| **编辑 Edit** | Inpaint / Erase / Remove BG / Search Replace | 5 | $0.05 |
| | Outpaint | 4 | $0.04 |
| | Replace Background & Relight | 8 | $0.08 |
| **控制 Control** | Structure / Sketch / Style Guide | 5 | $0.05 |
| | Style Transfer | 8 | $0.08 |

---

## 三、视频模型总览(全部无官方 API,仅开源自托管)

| 模型 | 帧数 / 时长 | 分辨率 | 开源权重 | 许可证 | 备注 |
|---|---|---|---|---|---|
| **Stable Video Diffusion (SVD)** | 14 帧(图生视频) | 1024×576 等 | 是 | Stability Community License | 图像条件生成短视频 |
| **SVD-XT**(img2vid-xt) | 25 帧 | 1024×576 | 是 | Community License | SVD 的 25 帧版,约 2 秒 |
| **Stable Video 4D 2.0** | 视频→4D | — | 是(2025-05-20 发布) | Community License | 视频转 4D,非文生视频 |
| **Stable Video 3D** | 单图→3D | — | 是 | Community License | 3D 重建 |

- 帧率可在 **3–30 FPS** 间自定义;官方宣传"2 分钟内出片"。
- **官方 API 已下线**(2025-07-24),只能自托管或走第三方:
  - 第三方托管价(参考):Replicate / Fal / Segmind / VoltageGPU 约 **$0.02–$0.15/秒**;VoltageGPU 新用户赠 $5。
- **Stable Video 产品页仍写"Text-to-Video"**,但这是自托管能力描述,**不等于有官方 API**。

---

## 四、免费额度与限速(精确,最高优先级)

### 免费额度
| 项目 | 数值 | 说明 |
|---|---|---|
| **注册赠送积分** | **25 credits(=$0.25)** | 一次性,创建 Stability 账号即得(支持 Google 登录) |
| **是否需信用卡** | **否**(注册赠送部分) | 仅购买额外积分时才需绑定付款 |
| **循环免费额度** | **无** | 不提供每月 recurring free credits |
| **过期机制** | 官方未明确公布过期日;赠送积分一般长期有效(**需核实**具体到期策略) |

**25 积分能做什么:**
- Stable Image Ultra:**3 张**($0.08×3=$0.24)
- SD3.5 Large:**3 张**(6.5×3=19.5 credits)
- SD3.5 Medium:**7 张**
- Stable Image Core:**8 张**($0.03×8=$0.24)
- SDXL 1.0:**约 27 张**

### 限速(限次)
| 项目 | 数值 |
|---|---|
| **请求速率** | **150 请求 / 10 秒**(单 API key),即 **900 RPM** |
| **超限惩罚** | 返回 HTTP 429 + **60 秒冷却超时** |
| **API key 数量** | 单账号最多 **10 个 key**(可轮询分流) |
| **并发数** | 官方未公布硬性并发上限,以 150 req/10s 速率为准 |
| **每日/每月上限** | **无固定上限**,按 credits 余额消费,余额耗尽即停 |

> 建议:生产环境实现指数退避(exponential backoff)+ 多 key 轮询。

---

## 五、付费价格表(精确)

### 图像生成(按图计费)
| 模型 | 积分/图 | USD/图 | 100 张成本 |
|---|---|---|---|
| Stable Image Ultra | 8 | **$0.08** | $8.00 |
| SD3.5 Large | 6.5 | **$0.065** | $6.50 |
| SD3.5 Large Turbo | 4 | **$0.04** | $4.00 |
| SD3.5 Medium | 3.5 | **$0.035** | $3.50 |
| Stable Image Core | 3 | **$0.03** | $3.00 |
| SDXL 1.0(≤30 步) | ~0.9 | **~$0.009** | ~$0.90 |

### 积分购买
- **$1 USD = 100 credits**(1 credit = $0.01)。
- 在账号 Billing 面板按需购买,**无订阅制强制消费**(按量付费)。
- 企业可谈 **bulk 批量折扣 / 自定义价**(联系 sales)。

### 视频(无官方 API)
- 官方:**无 API,无官方计价**。
- 第三方托管:**约 $0.02–$0.15/秒**(因平台而异,需核实具体厂商)。
- 自托管:**免费**(仅 GPU 硬件 + 电费成本)。

### 音频 / 3D(供参考)
- Stable Audio 2.5(至 3 分钟):**20 credits($0.20)/次**
- Stable Audio 3.0(至 6 分钟):**26 credits($0.26)/次**
- Stable Fast 3D:**10 credits($0.10)/次**;SPAR3D:**4 credits($0.04)/次**

---

## 六、API 协议与端点(关键)

### 协议定性:**私有 REST API,非 OpenAI 兼容**

| 维度 | 详情 |
|---|---|
| **Base URL** | `https://api.stability.ai` |
| **API 版本** | v2beta |
| **认证** | `Authorization: Bearer $STABILITY_API_KEY`(header) |
| **OpenAI 兼容** | **否**。没有 `/v1/images/generations`。请求/响应 schema 是 Stability 私有格式(multipart/form-data,字段如 `prompt`/`negative_prompt`/`aspect_ratio`/`seed`/`output_format`) |
| **图像生成端点** | `POST https://api.stability.ai/v2beta/stable-image/generate/{service}`,service ∈ `core` / `ultra` / `sd3`(SD3.5 家族,带 `model` 子字段)等 |
| **图生图** | 同端点,带 `image` 字段(jpeg/png/webp,边长 ≥64px) |
| **视频端点** | **已下线**(原 `/v2beta/stable-image/generate/image-to-video`,2025-07-24 停用) |
| **响应** | 默认返回二进制图片(`Accept: image/*`),或 JSON(`Accept: application/json` 含 base64) |
| **失败计费** | 仅对**成功**生成扣 credits,失败不扣 |

### 想用 OpenAI 兼容协议?
- 经 **LiteLLM** 适配器桥接(LiteLLM 把 `/v1/images/generations` 翻译成 Stability 私有 REST);
- 或自写薄代理层映射 schema;
- NVIDIA NIM 可在 OpenAI 兼容端点后跑 SD 家族(自托管)。

---

## 七、开源权重下载地址

| 模型 | Hugging Face 仓库 | 许可证 | 商用门槛 |
|---|---|---|---|
| **SD3.5 Large**(8B) | [stabilityai/stable-diffusion-3.5-large](https://huggingface.co/stabilityai/stable-diffusion-3.5-large) | Stability Community License | 年营收 < $1M 免费;以上需 Enterprise |
| **SD3.5 Large Turbo** | [stabilityai/stable-diffusion-3.5-large-turbo](https://huggingface.co/stabilityai/stable-diffusion-3.5-large-turbo) | Community License | 同上 |
| **SD3.5 Medium**(2.6B) | [stabilityai/stable-diffusion-3.5-medium](https://huggingface.co/stabilityai/stable-diffusion-3.5-medium) | Community License | 同上 |
| **SDXL 1.0**(3.5B) | [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) | **OpenRAIL++-M**(更开放) | 商用宽松 |
| **SVD**(14 帧) | [stabilityai/stable-video-diffusion-img2vid](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid) | Stability Community License | 营收 < $1M 免费 |
| **SVD-XT**(25 帧) | [stabilityai/stable-video-diffusion-img2vid-xt](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt) | Community License | 同上 |
| 推理代码 | [github.com/Stability-AI/sd3.5](https://github.com/Stability-AI/sd3.5)、[github.com/stability-ai/generative-models](https://github.com/stability-ai/generative-models)(SVD) | — | — |

> SD3.5 需在 HF 页面"Agree and access repository"接受许可后,用 HF token 才能下载。

---

## 八、media-gen-mcp 适配建议

| 模型类别 | 适配难度 | 说明 |
|---|---|---|
| **图像(SD3.5/Core/Ultra/SDXL via 官方 API)** | **custom**(私有 provider) | 私有 REST v2beta,需自写 provider 封装 `api.stability.ai`;不兼容 OpenAI `/v1/images/generations`。**不是 easy**。若经 LiteLLM 桥接可降为 easy。 |
| **图像(自托管 SD3.5/SDXL)** | custom / easy | 自托管后可用 ComfyUI/vLLM 类服务包成 OpenAI 兼容端点。 |
| **视频(SVD/SVD-XT)** | **no-api**(官方无 API) | 官方 API 已下线。要么自托管(重,需 GPU),要么走第三方 API(Replicate/Fal/Segmind,各为独立 custom provider)。**不适合直接接入 media-gen-mcp 的"统一官方 API"路径。** |

**结论:** 若 media-gen-mcp 要接 Stability,**只接图像、走 custom provider**(私有 REST),视频应改接其他厂商(如 Runway / Pika / 可灵 / Wan)或通过第三方托管商接入 SVD。

---

## 九、能力速览

### 图像
- **SD3.5 Large**:8B MMDiT,1024×1024 及多比例(1:1/16:9/9:16/3:2/2:3),强排版/提示词遵循。
- **SD3.5 Large Turbo**:4 步出图,速度极快。
- **SD3.5 Medium**:2.6B,消费级显卡(如 RTX 4090)可本地跑。
- **Stable Image Ultra/Core**:API 专享,1.5MP,Ultra 约 6–10 秒/图。
- 支持:文生图、图生图、Inpaint、Outpaint、Control(Structure/Sketch/Style)、放大。

### 视频(自托管)
- SVD:14 帧;SVD-XT:25 帧;3–30 FPS 可调;~2 秒短片;2 分钟内生成;1.5MP。

---

## 十、来源

- [Stability AI 官方定价页](https://platform.stability.ai/pricing)
- [API 价格更新(2025-08-01)](https://stability.ai/api-pricing-update-25) ← **视频 API 下线权威公告**
- [API Key 限速知识库](https://kb.stability.ai/knowledge-base/api-key-rate-limit-information)
- [REST API v2beta 参考](https://platform.stability.ai/docs/api-reference)
- [Release Notes](https://platform.stability.ai/docs/release-notes)
- [Stable Video 产品页](https://stability.ai/stable-video)
- [SD3.5 Large(HF)](https://huggingface.co/stabilityai/stable-diffusion-3.5-large)、[Medium](https://huggingface.co/stabilityai/stable-diffusion-3.5-medium)、[Large Turbo](https://huggingface.co/stabilityai/stable-diffusion-3.5-large-turbo)
- [SVD-XT(HF)](https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt)
- [LiteLLM Stability 适配](https://docs.litellm.ai/docs/providers/stability)
- [第三方价格对比(AtlasCloud 2026)](https://www.atlascloud.ai/blog/guides/cheapest-ai-video-generation-api-2026)

> ⚠️ **需核实项**:① 25 赠送积分的精确过期策略(官方未明示);② SDXL 1.0 现价是否确为 0.9 credits(社区有"近 5 倍涨幅"争议,建议下单前在 Billing 面板确认);③ 是否需信用卡注册(社区普遍反映"注册赠送无需绑卡",但官方未在定价页明说)。