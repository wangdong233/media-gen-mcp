# Black Forest Labs FLUX 模型深度调研(2026)

> 数据来源:BFL 官方文档(docs.bfl.ml)、官方定价页(bfl.ai/pricing)、HuggingFace、Together AI、fal.ai、flowith 等第三方。所有价格以官方文档为准,第三方价格单列。**截至 2026 年 7 月,FLUX 仅有图像模型;文生视频模型仍在开发中,未发布。**

---

## 一、厂商概览

- **公司**:Black Forest Labs(BFL),德国前沿 AI 实验室,Stable Diffusion 原班团队创立。
- **定位**:构建"视觉智能"(visual intelligence),核心产品为 FLUX 系列文生图/图像编辑模型。
- **当前主力**:FLUX.2(2026 最新代,4 个商业变体 + 1 个开源变体)+ FLUX.1(上一代,含 Kontext 编辑模型)。
- **视频**:据 Wikipedia,截至 **2026 年 2 月文生视频模型仍在开发中**,尚无公开 API 或发布日期。**本报告视频维度结论:无可用视频模型。**

---

## 二、模型矩阵(全部为图像模型)

### FLUX.2 系列(最新代,基于兆像素 MP 计价)

| 模型 | 类型 | 参数 | 闭/开源 | 文生图起价 | 图像编辑起价 | 定位 |
|---|---|---|---|---|---|---|
| FLUX.2 [max] | 文生图+多参考编辑 | 32B | 闭源 | from $0.070/图 | from $0.070/图 | 最高质量,支持 grounding 实时联网检索 |
| FLUX.2 [pro] | 文生图+多参考编辑 | 32B | 闭源 | from $0.030/图 | from $0.045/图 | 生产级,速度与质量兼顾 |
| FLUX.2 [flex] | 文生图+编辑 | 32B | 闭源 | from $0.050/图 | from $0.050/图 | 细粒度控制、排版/小细节专精 |
| FLUX.2 [klein] 9B | 文生图+编辑 | 9B | 闭源 | from $0.015/图 | from $0.015/图 | 质量/速度平衡 |
| FLUX.2 [klein] 4B | 文生图+编辑 | 4B | 闭源 | from $0.014/图 | from $0.014/图 | 全系最低成本、最快速度 |
| FLUX.2 [dev] | 文生图+编辑 | — | **开源(非商业)** | **仅本地** | **仅本地** | 开源权重,无托管 API |

特色:多参考编辑(最多同时引用 **10 张图**)、4MP 输出、32K 文本 token、JSON 控制、姿态引导、生成式扩展、精确色彩匹配(hex)、可靠文字渲染。

### FLUX.1 系列(上一代,固定 credit/图)

| 模型 | 类型 | 闭/开源 | Credit/图 | 价格/图 | 定位 |
|---|---|---|---|---|---|
| FLUX.1 Kontext [pro] | 文字图像编辑+生成 | 闭源 | 4 credits | $0.04 | 自然语言编辑(换物/换色/加文字) |
| FLUX.1 Kontext [max] | 文字图像编辑+生成 | 闭源 | 8 credits | $0.08 | 最高质量编辑 |
| FLUX.1 Kontext [dev] | 文字图像编辑+生成 | **开源(非商业)** | — | — | 自托管编辑模型(12B,Flow Matching) |
| FLUX1.1 [pro] | 文生图 | 闭源 | 4 credits | $0.04 | 标准文生图基线,快+稳 |
| FLUX1.1 [pro] Ultra | 文生图 | 闭源 | 6 credits | $0.06 | 超高分辨率(4MP) |
| FLUX1.1 [pro] Raw | 文生图 | 闭源 | 6 credits | $0.06 | 真实摄影质感 |
| FLUX.1 [pro] | 文生图 | 闭源 | — | 旧版 | 上一代旗舰(已被 1.1 取代) |
| FLUX.1 Fill [pro] | Inpainting/Outpainting | 闭源 | 5 credits | $0.05 | 局部填充/外扩 |

### 开源权重模型(可自托管)

| 模型 | 许可证 | 商用 | 下载地址 |
|---|---|---|---|
| **FLUX.1 [schnell]** | **Apache 2.0** | ✅ 可商用 | huggingface.co/black-forest-labs/FLUX.1-schnell(12B 参数,蒸馏模型,1-4 步推理) |
| FLUX.1 [dev] | FLUX.1 Non-Commercial License | ❌ 仅非商业 | huggingface.co/black-forest-labs/FLUX.1-dev |
| FLUX.1 Kontext [dev] | 非商业 | ❌ 仅非商业 | HuggingFace |
| FLUX.2 [dev] | 非商业 | ❌ 仅非商业 | HuggingFace(最新代开源权重) |
| 推理代码 | — | — | github.com/black-forest-labs/flux |

> **唯一可免费商用**的是 **FLUX.1 [schnell]**(Apache 2.0)。其余 dev 变体均仅限非商业研究。

---

## 三、免费额度与限速(重点核实)

### 1. BFL 官方 API(bfl.ai)— 无免费额度

- **免费额度:无。** 纯预付费 credit 模式,**1 credit = $0.01 USD**。
- **新账户是否送 credit**:官方文档未明确说明,第三方(flowith)称"有时为新账户提供试用 credit",**【需核实】当前是否仍有注册赠送**。
- **充值门槛**:预付费,可在 dashboard 充值(如 $50/次)。**【需核实】是否需绑定信用卡**——文档无明确说明,实测需在 dashboard 添加付款方式后购买 credit。
- **限速(并发制,非 RPM)**:
  - 大多数端点:**最大 24 个并发请求**
  - `flux-kontext-max`:**最大 6 个并发请求**
  - 超限返回 HTTP **429**,建议指数退避重试
  - **未公布 RPM/每日/每月上限**——以并发数为限,消费由 credit 余额决定。**官方无公开 RPM 表【需核实更高 tier 的 RPM】**。

### 2. Together AI — FLUX.1 [schnell] 免费端点(可用性需核实)

- 2024 年曾公告"FLUX.1 [schnell] **3 个月免费无限** API 访问"([公告](https://www.together.ai/blog/flux-api-is-now-available-on-together-ai-new-pro-free-access-to-flux-schnell))。
- **当前状态【需核实】**:社区报告免费端点仍存在,限速约 **60 RPM / ~60,000 请求/月**(GitHub 指南 fabiomatricardi/FLUX1-Schenll_TAI-freeAPI)。
- 平台通用使用:Together AI **已取消免费试用 credit**,需**最低 $5 充值**才能使用 serverless。免费 schnell 端点是否独立于充值门槛**【需核实】**。
- 付费 schnell:$0.0027/图(~$0.05/兆像素)。

### 3. 第三方平台(fal.ai / Replicate / OpenRouter 等)

- 多数提供新用户试用 credit(额度各异,**【需核实】具体数值**)。
- fal.ai:FLUX.2 schnell ~$0.002/图、dev ~$0.020/图、pro ~$0.045/图。
- Replicate:按计算秒计费,schnell ~$0.003/图。
- OpenRouter:托管 FLUX.2 klein 4B 等,按 MP 计费。

### 4. 自托管(完全免费)

- **FLUX.1 [schnell]**(Apache 2.0)或 dev 变体本地部署:**无任何 API 费用**,仅需自备 GPU(RTX 4090 24GB 起步,schnell fp16 需 ~12GB VRAM)。
- 可在 Modal 等 serverless GPU 平台免费层运行 dev 模型。

> **免费方案总结**:① 自托管 schnell(真免费、可商用);② Together AI schnell 免费端点(限速,可用性需核实);③ 各平台新用户试用 credit;④ BFL 官方无免费。

---

## 四、付费价格表(精确)

### BFL 官方价格(权威来源:docs.bfl.ml/quick_start/pricing)

**计价规则**:FLUX.2 按**输出兆像素(MP)**线性计价,分辨率越高越贵;FLUX.1 按固定 credit/图。1 credit = $0.01。

#### FLUX.2(每图 from 价,为基础分辨率起始价)

| 模型 | 文生图 | 图像编辑 | $50 ≈ 可生成图数(基础分辨率) |
|---|---|---|---|
| FLUX.2 [klein] 4B | from $0.014 | from $0.014 | ~3,571 张 |
| FLUX.2 [klein] 9B | from $0.015 | from $0.015 | ~3,333 张 |
| FLUX.2 [pro] | from $0.030 | from $0.045 | ~1,666 张(文生图) |
| FLUX.2 [flex] | from $0.050 | from $0.050 | ~1,000 张 |
| FLUX.2 [max] | from $0.070 | from $0.070 | ~714 张 |
| FLUX.2 [dev] | 仅本地 | 仅本地 | 开源自托管 |

> **批量**:支持 batch 请求摊薄成本(如 FLUX.2 [pro] 批量 4 张 from $0.12)。微调端点(Beta)按基础端点同价。

#### FLUX.1(固定每图)

| 模型 | Credit | 价格/图 |
|---|---|---|
| FLUX1.1 [pro] | 4 | $0.04 |
| FLUX1.1 [pro] Ultra | 6 | $0.06 |
| FLUX1.1 [pro] Raw | 6 | $0.06 |
| FLUX.1 Fill [pro] | 5 | $0.05 |
| FLUX.1 Kontext [pro] | 4 | $0.04 |
| FLUX.1 Kontext [max] | 8 | $0.08 |

#### 第三方价格对比(参考,2026 年约值)

| 供应商 | schnell | dev | pro/max | 特点 |
|---|---|---|---|---|
| BFL 官方 | — | — | pro from $0.030 | 直连,质量最高 |
| fal.ai | $0.002 | $0.020 | pro $0.045 | 最快、最便宜 |
| Replicate | $0.003 | $0.028 | pro $0.055 | 按秒计费,易集成 |
| Together AI | $0.003 | $0.025 | pro $0.050 | 多模型,企业 SLA |
| RunPod | $0.002-0.004 | $0.015-0.025 | pro $0.035-0.050 | GPU 秒计费 |

> **视频模型价格:无(未发布)。**

---

## 五、协议与端点(关键,决定 MCP 集成难度)

### BFL 官方 API — 私有 REST,**非 OpenAI 兼容**

- **基础端点**:
  - 全球:`https://api.bfl.ai`
  - 欧洲(GDPR):`https://api.eu.bfl.ai`
  - 美国:`https://api.us.bfl.ai`
- **调用模式**:**异步**——POST 提交任务 → 响应返回 `id` + `polling_url` → GET 轮询 `polling_url` 直到 `status: Ready`。
- **认证**:HTTP header `x-key: <BFL_API_KEY>`(部分文档用 `Authorization: Bearer`)。
- **端点示例**:`POST /v1/flux-2-pro-preview`、`/v1/flux-kontext-pro` 等(按模型不同 path 不同)。
- **关键限制**:
  - 生成图 URL **10 分钟过期**,必须立即下载;
  - **无 CORS**,不能浏览器直连;
  - 结果需"下载后自托管再 serve"。
- **结论**:**不是 `/v1/images/generations` 格式,不兼容 OpenAI SDK**,且是异步轮询模型 → 集成需写自定义 provider。

### fal.ai — model-specific API,**非完全 OpenAI 兼容**

- 原生使用**模型专属 API shape**(每个模型不同端点),非统一 `/v1/images`。
- 部分 LLM 端点提供 OpenAI Responses API 兼容(经 OpenRouter router),但图像端点不统一。
- 通过 **CometAPI / OpenRouter 式聚合**可获得更统一的接口。

### Azure Foundry — 可用 OpenAI SDK 代理 FLUX 2.0 Pro

- 微软 Azure Foundry 托管 FLUX 2.0 Pro,**可用 openai Python SDK 调用**——这是目前最接近"OpenAI 兼容"的官方途径。

### MCP 官方支持

- BFL 已发布**官方 FLUX MCP server**(docs.bfl.ml 有 MCP & Agent Skills 文档),可直接接入 MCP 客户端。

---

## 六、能力概览

| 维度 | FLUX.2 | FLUX.1 |
|---|---|---|
| 最大分辨率 | **4MP**(任意宽高比) | FLUX1.1 Ultra 4MP;标准 2MP |
| 文本 token | 32K | 较短 |
| 生成速度 | sub-10 秒 | FLUX1.1 较快 |
| 多参考编辑 | 最多 **10 张图**同时引用 | Kontext 支持图像编辑 |
| 文字渲染 | 生产级可靠(复杂排版/UI) | 一般 |
| 色彩控制 | 精确 hex 匹配 | 无 |
| 视频生成 | ❌ 无(开发中) | ❌ 无 |

---

## 七、适合 media-gen-mcp 的适配建议

| 接入方式 | 难度 | 说明 |
|---|---|---|
| **Azure Foundry 代理 FLUX 2.0 Pro** | **easy** | 用 openai SDK 调用,最接近 OpenAI 兼容 |
| **BFL 官方 FLUX MCP server** | **easy** | 官方已提供 MCP,直接挂载即可 |
| BFL 官方 REST API(私有异步) | **custom** | 需写 provider:提交→轮询 polling_url→下载图(10 分钟过期),处理 429 退避 |
| fal.ai / Replicate REST | **custom** | model-specific shape,各写各的 provider |
| OpenRouter / CometAPI 聚合 | **easy** | 统一接口,可能有 OpenAI 兼容 |
| 自托管 FLUX.1 schnell | **no-api**(本地推理)或 **custom** | Apache 2.0 可商用,无 API 费用 |

**推荐方案**:
1. **最省事**:直接用 BFL 官方 FLUX MCP server(easy,官方背书)。
2. **要 OpenAI 兼容**:走 Azure Foundry 或 OpenRouter 聚合(easy)。
3. **要完全免费 + 商用**:自托管 FLUX.1 schnell(Apache 2.0,no-api)。
4. **要最高质量 + 编辑**:BFL 官方 REST 写 custom provider(FLUX.2 max / Kontext)。

---

## 八、关键风险与待核实项

1. **【需核实】** BFL 新账户是否赠送免费 credit、是否强制绑定信用卡。
2. **【需核实】** Together AI FLUX.1 schnell 免费端点 2026 年是否仍可用、是否独立于 $5 充值门槛。
3. **【需核实】** BFL 各付费 tier 的精确 RPM/每日上限(官方仅公布并发数 24/6)。
4. **FLUX.2 "from" 起价**为基础分辨率;4MP 大图实际费用显著高于起价(按 MP 线性增长),生产预算需用官方定价计算器按目标分辨率核算。
5. **视频模型**:BFL 视频模型尚未发布,若有视频需求需等待或转用其他厂商。

---

## 来源

- [BFL 官方定价](https://bfl.ai/pricing)
- [BFL 文档定价页](https://docs.bfl.ml/quick_start/pricing)(最权威价格表)
- [BFL API 集成指南](https://docs.bfl.ml/api_integration/integration_guidelines)(端点/限速)
- [BFL FLUX.2 模型页](https://bfl.ai/models/flux-2)
- [BFL FLUX 1.1 Pro 模型页](https://bfl.ai/models/flux-pro)
- [BFL 文档首页](https://docs.bfl.ai/)
- [HuggingFace FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell)
- [HuggingFace FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev)
- [GitHub FLUX 推理仓库](https://github.com/black-forest-labs/flux)
- [Together AI FLUX.1 schnell](https://www.together.ai/models/flux-1-schnell)
- [Together AI FLUX 公告](https://www.together.ai/blog/flux-api-is-now-available-on-together-ai-new-pro-free-access-to-flux-schnell)
- [flowith FLUX 2 定价 2026](https://flowith.io/blog/flux-2-pro-pricing-2026-dev-vs-pro-vs-schnell-api/)
- [fal.ai FLUX.2](https://fal.ai/flux-2)
- [Wikipedia Flux model](https://en.wikipedia.org/wiki/Flux_(text-to-image_model))