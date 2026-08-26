# Ideogram 深度调研报告(2026)

> 调研日期:2026-07-13|官方定价页最后修订:2025-08-06
> 核心结论:Ideogram 是一家**专注文生图**的厂商,**没有视频生成产品**;最新版 **Ideogram 4.0 已开源权重(非商用许可)**;API 为**私有协议(非 OpenAI 兼容)**,按图计费。

---

## 一、厂商概览

| 项目 | 内容 |
|---|---|
| 厂商 | Ideogram, Inc.(加拿大) |
| 定位 | 文生图 / 图生图 / 图像编辑,最强项是**图像内文字渲染(Typography)**,准确率约 90% |
| 官网 | https://ideogram.ai |
| API 定价页 | https://ideogram.ai/api-pricing/(每图明码标价,无需订阅) |
| 开发者文档 | https://developer.ideogram.ai/ideogram-api/api-overview |
| 订阅页 | https://ideogram.ai/pricing |
| 视频生成 | **无**(Ideogram 截至 2026 年未推出任何文生视频/图生视频产品) |

---

## 二、模型清单(全部为图像模型)

### 当前主力模型(官方 API 在售)

| 模型 | 版本 | 每图价格(标准生成) | 说明 |
|---|---|---|---|
| **Ideogram 4.0 Turbo** | 最新(2025) | $0.03 | 最快档,9.3B 参数,开源权重 |
| **Ideogram 4.0 Default** | 最新 | $0.06 | 默认质量档 |
| **Ideogram 4.0 Quality** | 最新 | $0.10 | 最高质量档,原生 2K |
| **Ideogram 3.0 Flash** | V3 | $0.03 | 极速档 |
| **Ideogram 3.0 Turbo** | V3 | $0.03 | 快速档 |
| **Ideogram 3.0 Default** | V3 | $0.06 | 默认档 |
| **Ideogram 3.0 Quality** | V3 | $0.09 | 高质量档 |

### 旧版本(仍可通过 API 调用)

| 模型 | 每图价格 |
|---|---|
| Ideogram 2.0 Turbo / Default | $0.05 / $0.08 |
| Ideogram 2a Turbo / Default | $0.025 / $0.04 |
| Ideogram 1.0 Turbo / Default | $0.02 / $0.06 |

> 注:2.0 Quality($0.12)、2a Quality($0.06)、1.0 Quality($0.09)为官方标注"不支持组合"。

### 特殊能力模型/端点(按图/按输入另计)

| 能力 | 价格 |
|---|---|
| 3.0 角色参考(Character Reference) | Turbo $0.10 / Default $0.15 / Quality $0.20 |
| 透明背景生成(3.0) | Turbo $0.04 / Default $0.07 / Quality $0.10 |
| 透明生成 + 放大(3.0,1X/2X/4X) | $0.04~$0.26(按倍率) |
| Gemini 集成(1K/2K) | $0.20/图 |
| Gemini 集成(4K) | $0.36/图 |
| Instructional Edit(文字指令编辑,任意图) | $0.20/图 |
| Ideogram Upscale(2X,按输入图) | $0.06/输入图 |
| Describe(图像转文字描述) | $0.01/输入图 |
| Topaz 高清放大(2K/4K/8K) | $0.12 / $0.24 / $0.48 |
| Layerize(分层,按输入) | $0.09/输入图 |
| Generate + Layerize(3.0) | Turbo $0.12 / Default $0.15 / Quality $0.18 |
| 自定义模型训练(Self-Serve) | $40.00/每次训练 |
| 自定义模型生成(4.0/3.0 Custom) | Turbo $0.06 / Default $0.12 / Quality $0.18~0.20 |

---

## 三、开源 vs 闭源

| 模型 | 开源状态 | 权重 / 许可 |
|---|---|---|
| **Ideogram 4.0** | **开源权重**(Ideogram 首个开源 T2I 模型) | Hugging Face:`ideogram-ai/ideogram-4-nf4`、FP8 版本,**Gated**(需同意条款)。<br>许可:**Ideogram Non-Commercial Model Agreement**(研究/评估/个人项目免费,**商用需另购商业许可**)。<br>⚠️ 非 Apache,非完全自由商用。 |
| Ideogram 4.0 规格 | 9.3B 参数,34 层单流 Diffusion Transformer | 量化:NF4 / FP8;NF4 需 **单卡 24GB VRAM**;分辨率 256–2048px/边,原生 2K,宽高比灵活(16 的倍数);max 2048 文本 token。 |
| Ideogram 3.0 及更早 | **闭源** | 仅 API 访问,无公开权重。 |

> 社区争议:Reddit 等处有人误称 Ideogram 4.0 为 Apache 许可,**不准确**,以官方 LICENSE.md(Ideogram Non-Commercial Model Agreement)为准。

下载地址:https://huggingface.co/ideogram-ai/ideogram-4-nf4

---

## 四、免费额度与限速(重点,精确标注)

### 1) Web / App 消费端(订阅计划)

| 计划 | 价格 | 额度 / 限速 | 备注 |
|---|---|---|---|
| **Free** | $0 | **10 slow credits / 天**(约 40 图/周;每 credit = 1 prompt,可出 4 张变体) | 仅慢速队列(30–60s/图);**所有图片公开**;不能上传参考图;Describe 功能每次扣 1 credit;每日重置 |
| Basic | ~$7–8/月 | 100 slow credits/天 + 400 priority credits/月 | 私密生成、可上传图 |
| Plus | ~$15–20/月(年付 $15) | 1,000 priority credits/月 + 无限 slow | priority credits 不滚存 |
| Pro | $42/月 | 3,500 priority credits/月 + 无限 slow | 含角色一致性等高级功能 |
| Team | ~$20/用户/月 | 1,500 priority credits/用户/月 | 集中计费 |
| 加油包(Top-up) | $4/包 | 100–250 credits/包(按计划),最多 10 包/次 | **加油包 credits 可滚存**,月度计划 credits 不可滚存 |

> ⚠️ **免费额度口径冲突,需核实**:官方 pricing 页面文字一度出现"10 free credits per **week**",而多家第三方测评(2026-04)实测为"10 credits / **day**"。建议以官方页面实时显示为准。**免费计划无需信用卡**(Google/Apple/Microsoft 登录即可)。

### 2) API 端(开发者)

| 项目 | 说明 |
|---|---|
| **API 免费额度** | **无**(官方 API Pricing 为纯按图计费,页面未提及任何免费 trial credits)。第三方平台(Kie.ai、302.AI)会送新用户试用 credits,但非官方。 |
| **信用卡** | **需核实**:官方未在定价页明确说明,但 API 按量计费一般需绑定支付方式/充值后调用。 |
| **限速(并发)** | **默认 10 个 in-flight(并发)请求**(官方 API Overview 明确)。 |
| **RPM / 每日上限** | 官方未公布 RPM 或每日/每月硬上限,仅以"10 并发"约束吞吐。 |
| **扩容** | 需更大规模联系 partnership@ideogram.ai(企业/批量定价)。 |

---

## 五、付费价格总表(官方,2025-08-06 修订,精确)

> 全部为 **per output image**(按输出图计价),除非另注"per input"。

**标准生成(Generate / Remix / Edit / Reframe / Replace Background 共用此价):**

| 模型 | Turbo | Default | Quality |
|---|---|---|---|
| Ideogram 4.0 | $0.03 | $0.06 | $0.10 |
| Ideogram 3.0 | $0.03(Flash 同价) | $0.06 | $0.09 |
| Ideogram 3.0 + 角色参考 | $0.10 | $0.15 | $0.20 |
| Ideogram 2.0 | $0.05 | $0.08 | —(不支持) |
| Ideogram 2a | $0.025 | $0.04 | —(不支持) |
| Ideogram 1.0 | $0.02 | $0.06 | —(不支持) |

**订阅 vs API 经济性对比**:订阅 credit 折算约 $0.0015/图(3.0 Turbo),API 同模型 $0.03/图 —— **API 约比订阅贵 20 倍**(引自 CheckThat.ai 测算)。

---

## 六、API 协议(关键:非 OpenAI 兼容)

| 项目 | 内容 |
|---|---|
| **协议类型** | **私有 REST API**(非 OpenAI 兼容) |
| **Base URL** | `https://api.ideogram.ai` |
| **认证方式** | Header:`Api-Key: <你的密钥>`(注意:不是 OpenAI 的 `Authorization: Bearer`) |
| **主要端点** | `POST /v1/ideogram-v4/generate`(4.0)<br>`POST /v1/ideogram-v3/generate`(3.0)<br>`POST /v1/ideogram-v3/edit`(图像编辑)<br>另有 Remix / Reframe / Replace Background / Describe / Upscale / Layerize 等端点 |
| **请求体差异** | 用 `prompt`、`aspect_ratio`、`style_preset`、`rendering_speed` 等字段(非 OpenAI 的 `model`/`size`/`n`) |
| **响应体** | `{data: [{url, ...}]}`(返回 URL,需自行下载) |
| **获取 OpenAI 兼容接口** | 经第三方网关:Together AI、Segmind、Cloudflare AI Gateway、LiteLLM、AIHubMix 等可把 Ideogram 包装成 `/v1/images/generations` 协议。 |

示例(Python,3.0 生成):
```python
requests.post("https://api.ideogram.ai/v1/ideogram-v3/generate",
    headers={"Api-Key": "<apiKey>"},
    json={"prompt": "A picture of a cat", "rendering_speed": "TURBO"})
```

---

## 七、能力概览(分辨率 / 时长 / 特色)

| 维度 | 内容 |
|---|---|
| **图像分辨率** | 4.0:256–2048px/边,**原生 2K**(无需放大);3.0:最高约 2K |
| **宽高比** | 灵活,支持 16 的倍数任意组合(1:1、竖屏、横屏,最高约 6:1) |
| **视频时长** | **不适用(Ideogram 无视频产品)** |
| **文字渲染** | 行业领先,图像内文字准确率约 90%,适合 logo、海报、社媒图 |
| **编辑能力** | Remix(重混)、Edit(局部编辑/换脸)、Reframe(改比例)、Replace Background(换背景)、Instructional Edit(文字指令编辑,无需 mask) |
| **风格预设** | V3 端点支持 `style_preset`(如 90S_NOSTALGIA、JAPANDI_FUSION、SPOTLIGHT_80S 等) |
| **自定义模型** | 可上传品牌素材训练专属模型($40/次),生成时沿用品牌风格 |
| **透明背景 / 分层** | 支持透明 PNG 输出、Layerize 自动分层(主体/背景/元素) |

---

## 八、适合 media-gen-mcp 的接入评估

| 接入方式 | 评级 | 说明 |
|---|---|---|
| **原生 API(私有协议)** | **custom** | 需为 Ideogram 单独写 provider(Api-Key 认证、`/v1/ideogram-vX/generate` 端点、独特请求/响应字段),不能直接复用 OpenAI images 客户端。 |
| **经第三方 OpenAI 兼容网关** | **easy** | 通过 Together AI / Segmind / LiteLLM 等,可伪装成 `/v1/images/generations`,复用 OpenAI 兼容 provider,但多一层中转费。 |
| **自托管开源权重(4.0)** | **custom/自建** | NF4 量化单卡 24GB VRAM 可跑,但许可**非商用**(商用需授权),且需自建推理服务,维护成本高。 |
| **仅 Web(无 API)** | **no-api** | 若只调免费 Web 端,无 API 可接,不适合 MCP 自动化。 |

**推荐方案**:走**原生 API + 自写 provider**(custom),官方按图计费透明、质量最高;若 MCP 已有 OpenAI 兼容层且追求最小改动,可用 **Together AI 托管的 Ideogram**(easy)。

---

## 九、待核实 / 注意事项

1. **免费额度 day vs week**:官方页面与第三方口径不一致,需登录官网实时确认(当前以"10 credits/天"实测为准)。
2. **API 是否需信用卡 / 有无 trial credits**:官方未明确,建议注册开发者后台实测(标"需核实")。
3. **RPM / 每日上限**:官方仅公布"10 并发 in-flight",未公布 RPM 或日/月上限。
4. **Ideogram 4.0 商用许可**:开源权重为**非商用**,商用须另签许可,勿直接拿权重做商业服务。
5. **订阅 credits 不滚存**:月度 priority credits 月底清零,加油包 credits 才滚存。
6. **API 价格约为订阅单价的 20 倍**,高频场景算订阅更划算。

---

## Sources(主要来源)

- [Ideogram API Pricing(官方)](https://ideogram.ai/api-pricing/)
- [Ideogram API Overview(官方文档)](https://developer.ideogram.ai/ideogram-api/api-overview)
- [Ideogram Subscription Plans(官方)](https://ideogram.ai/pricing)
- [Ideogram 4.0 Blog(官方)](https://ideogram.ai/blog/ideogram-4.0/)
- [Ideogram 4.0 NF4 权重 - Hugging Face](https://huggingface.co/ideogram-ai/ideogram-4-nf4)
- [Ideogram Free Tier 2026 - HowDoIUseAI](https://howdoiuseai.com/blog/2026-04-16-ideogram-free-tier-2026-what-you-get-and-limits)
- [Ideogram Pricing 2026 - eesel.ai](https://www.eesel.ai/blog/ideogram-pricing)
- [Ideogram Pricing 2026 - CheckThat.ai](https://checkthat.ai/brands/ideogram/pricing)
- [Ideogram 4.0 Developer Guide - Evolink.ai](https://evolink.ai/blog/ideogram-4-0-what-developers-should-know)
- [Ideogram 3.0 API Guide - CrazyRouter](https://crazyrouter.com/en/blog/ideogram-3-0-api-pricing-integration-guide-2026)