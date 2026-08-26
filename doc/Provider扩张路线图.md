# Provider 扩张路线图(全渠道图景)

> **定位**:活文档。回答三个问题——①现在接了哪些渠道(现状矩阵);②业界还有哪些可接的渠道(全渠道图景 + 智谱价格速查表);③下一个接谁、按什么判据(扩张路线)。
> **来源**:现状 = 代码实况(2026-08-26,24 工具,v0.14.0);全渠道图景 = 2026-07 模型调研快照(19 家厂商逐档核对,原始档案见文末归档指针,价格以官方现价为准)。
> **关联文档**:`Agnes 开通指引.md` / `Zhipu 开通指引.md`(开通配置)/ `Agnes_vs_Zhipu_横评.md`(已接入两家对比)/ `flow-api-contract.md`(Flow 渠道 wire 契约)/ `架构要求清单.md`(渠道治理规则)。

---

## 1. 现状矩阵(2026-08-26,代码实况)

### 1.1 生成渠道(3 家)

| 渠道 | 模态 | 计费 | 接入方式 | 定位 |
|---|---|---|---|---|
| **agnes** | 图 + 视频 | 免费层(临时 $0,无 SLA,高峰排队) | OpenAI 兼容 | 默认链头,免费起步 |
| **zhipu** | 图 + 视频 | 图有永久免费档(CogView-3-Flash),视频有免费档(CogVideoX-Flash),旗舰按次 ¥0.06-1 | 图 OpenAI 兼容 / 视频私有异步端点 | 中文原生 fallback |
| **flow** | 图 + 视频 + 实体/语音 | 图/上采样/实体 **0 积分**;视频 **7-100 积分/条**(abra 7-20 / veo lite 10 / fast 20 / quality 100) | 本地 Chrome CDP 页面上下文(lasso 9223),无 API key | 高质量视频(veo/abra),**计费确认门**强制二段式确认 |

### 1.2 识别渠道(4 档)

tesseract(内置零配置,英文/数字)→ glm-vision(云,中文 SOTA + 看图问答)→ paddle(自托管 PaddleX,表格/票据)→ vlm(自托管 vLLM,问答/手写)。能力自省:`list_vision_capabilities`。

### 1.3 渠道治理(所有渠道共用)

- **优先级链**:工具参数点名 > 模态优先级链(`imageProviderPriority` 等,失败按序 fall through)> 全局默认。点名免费渠道(agnes/zhipu)失败仍可带警告回落;点名 opt-in 渠道(flow)则**钉定**,错误如实上报不静默换渠道。
- **链即开关**:渠道是否启用由优先级链是否包含它决定(不配置 = 不启用;列出 = 启用)。原 S000 硬禁用门(`flow.enabled=false`)已于 2026-08-26 删除 —— 与链语义重复的正交维度;显式点名永远合法,环境不可用由前置检测结构化报告。
- **计费确认门**(flow 视频):预估消耗 >0 积分且无 `confirmToken` → 返回挑战(needConfirm/estimatedCost/confirmToken/TTL),**绝不提交**;带令牌二次调用才放行(令牌与 key+预估+prompt+输入引用绑定,单次消费)。

---

## 2. 智谱(Zhipu)节

### 2.1 价格速查表(2026-07 核对;现价以 bigmodel.cn 为准)

**文生图**:

| 模型 | 国内(¥/次) | 国际($/图) | Batch(¥/次) | 备注 |
|------|-----------|-----------|------------|------|
| CogView-3-Flash | **免费** | — | — | 永久免费 |
| CogView-4 | **¥0.06** | **$0.01** | ¥0.03 | 开源 6B(Apache 2.0) |
| GLM-Image | 需核实 | $0.015 | — | 国际版 |

**文生视频**:

| 模型 | 国内(¥/次) | 国际($/视频) | Batch(¥/次) | 备注 |
|------|-----------|-------------|------------|------|
| CogVideoX-Flash | **免费** | — | — | 永久免费,4K/60fps |
| CogVideoX-2 | **¥0.5** | 需核实 | ¥0.25 | 性价比 |
| CogVideoX-3 | **¥1** | **$0.20** | 不支持 | 旗舰,4K/60fps/首尾帧/音频 |

> 汇率参考:¥1 ≈ $0.14(2026-07);国内人民币价通常更优惠。国际版(Z.AI)与国内部分模型/价格有差异,免费模型国际版同样免费。
> 免费额度:新用户 2000 万 Tokens 主要供 GLM 文本模型;图/视频按"次"计费与 token 无关,免费档不消耗任何额度。

### 2.2 接入要点

- 文生图 **OpenAI 兼容**(`open.bigmodel.cn/api/paas/v4/`),easy;文生视频私有异步端点(`/videos/generations`),custom(已实现 provider)。
- 限速机制:429 → 解析 → 写入 `rateLimits` → TTL 过期降级(限流自学习,项目已内置)。
- 开通配置详见 [`Zhipu 开通指引.md`](Zhipu%20开通指引.md);与 Agnes 的实测对比见 [`Agnes_vs_Zhipu_横评.md`](Agnes_vs_Zhipu_横评.md)。

---

## 3. 全渠道图景(未接入渠道,2026-07 调研快照)

> 图例:🎁 免费梯队(有真实免费额度)/ 💵 付费梯队;适配 ✅ OpenAI 兼容开箱即用 / 🟡 需写 provider(私有或异步协议)/ ❌ 无官方 API。
> ⚠️ 价格/限额变动频繁,接入前务必官方核实;此处只保留**决策相关的关键事实**。

### 3.1 文生图

| 渠道 | 梯队 | 适配 | 关键事实 |
|---|---|---|---|
| SiliconFlow 硅基流动 | 🎁 聚合 | ✅ | **≤9B 模型永久免费**;国际 $1/国内 ¥14 注册赠额;OpenAI 兼容 |
| 字节即梦 Seedream | 💵 | ✅ | 新户赠 50 万 tokens/模型,需实名无需信用卡 |
| 阿里通义万相 Wan | 💵 | 🟡 | 有真实免费额度(图 50 张/90 天,仅中国内地节点);DashScope 异步 |
| Stability AI | 🎁 | 🟡 | 注册一次性赠 25 credits(≈$0.25);限速宽松(150 req/10s) |
| Black Forest Labs FLUX | 💵 | 🟡 | 1 credit=$0.01,24 并发;BFL 私有异步 REST |
| Ideogram / Runway / Luma / Kling / Minimax / Vidu / OpenAI / Google | 💵 | ✅或🟡 | API 均无免费层;最低充值 $10 起;按 credit/并发分档 |
| Midjourney | 💵 | ❌ | 无 API,仅 Web+Discord;非官方代理有封号风险——**不接** |

### 3.2 文生视频

| 渠道 | 梯队 | 适配 | 关键事实 |
|---|---|---|---|
| **OpenAI Sora** | 💵 | 🟡 | 🔴 **整个 Videos API 与 Sora 2 模型 2026-09-24 关停,无继任**——**不接** |
| Google Veo 3.1 | 💵 | ✅/🟡 | Sora 兼容端点 + 原生;GCP 新户 $300/90 天(API 无免费层);Flow 渠道已覆盖其消费级入口 |
| 字节 Seedance | 💵 | 🟡 | 新户赠 50 万 tokens/模型;异步任务接口 |
| 智谱 CogVideoX | 🎁 | 🟡 | **已接入**(Flash 免费) |

---

## 4. 扩张路线(优先级与判据)

### 4.1 接入判据(新增渠道必须全过)

1. **免费/低价层真实存在**(有官方文档佐证的永久免费档或等值赠额;纯付费需极低价,如 ¥0.06/图);
2. **协议可落 MediaProvider 契约**(generateImage/createVideo/getVideo/listModels/videoConstraints,OpenAI 兼容优先);
3. **合规**(API ToS 允许程序化调用;license 三梯队核查见 `架构要求清单.md` 原则);
4. **差异化**(补现有渠道空缺:模态/质量档/地域/离线能力,不做同质内耗)。

### 4.2 候选排序

| 优先级 | 渠道 | 理由 | 形态 |
|---|---|---|---|
| P1 | **SiliconFlow** | ✅ OpenAI 兼容 + ≤9B 永久免费,一个 provider 换来多模型选择面 | 云 provider |
| P2 | **字节即梦(Seedream/Seedance)** | ✅/🟡 赠额大、中文生态、图+视频双模态 | 云 provider |
| P3 | **Ollama** | 填补 100% 依赖云的战略缺口;Z-Image-Turbo(开源 Elo #1,亚秒推理)/CogView4-6B 已上 Ollama;进程内 SD 已证不实用,**sidecar 模式** | 首个本地 provider |
| evaluate | ComfyUI Bridge | 通用本地(ControlNet/LoRA/IPAdapter),但工作流脆性高,深入评估后再定 | 本地 sidecar |
| watch | Wan(真实免费额度)/Stability(限速宽松) | 免费层薄或一次性,观察政策变化 | 云 provider |
| no-go | Sora API(2026-09-24 关停)/ Midjourney(无 API) | 生命周期/合规硬伤 | — |

### 4.3 治理前提

新渠道一律沿用现有治理件:优先级链成员化(链即开关)、(若计费)确认门二段式、限流自学习。计费渠道红线:**绝不自动路由到消耗积分/费用的路径**(参照 flow 视频确认门设计)。

---

## 5. 归档指针

19 家厂商单档调研全文(OpenAI/Google/字节/BFL/Stability/Ideogram/Runway/Luma/Kling/Minimax/Wan/Vidu/智谱/Agnes/Midjourney/聚合平台)+ 总览对比,见仓库 `.doc-archive-snapshot/doc/模型调研/`(2026-07 快照,只读存档;价格为当时核对值)。本文为该档案的**活性蒸馏**,渠道扩张落地后回写 §1 现状矩阵。
