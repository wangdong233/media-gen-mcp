# 开源 AI 生图/视频生态调研与架构方案

> 调研日期：2026-07-18 | 调研方法：5-agent 并行 WebSearch + 1-agent 综合评估
> 调研范围：开源图像/视频模型、已有 MCP 项目、云托管平台、前沿技术
> 发现总数：**200 个**（5 维度）| 评估推荐：**15 个**（5 integrate + 4 evaluate + 6 monitor）
> 当前项目：media-gen-mcp v0.9.0，12 工具，Agnes+Zhipu 云 API + 8 本地确定性工具

---

## 一、核心发现

### 图像生成模型（Top 8）

| 模型 | 参数 | 开源 | 本地 | 特色 | 接入价值 |
|---|---|---|---|---|---|
| **FLUX.2** (dev/max/klein) | 32B/4B/9B | ✅ | ✅ | 开源 SOTA，多参考图，FP8 量化 | **极高**：SiliconFlow/fal 已托管 |
| **Qwen-Image** / 2512 | 20B | ✅ Apache2.0 | ✅ | 中英双语文字渲染 SOTA | **极高**：阿里百炼 OpenAI 兼容 |
| **Qwen-Image-Edit** | 20B | ✅ Apache2.0 | ✅ | 指令式图像编辑（文字/对象/风格） | **高**：补齐编辑能力缺口 |
| **Z-Image-Turbo** | 6B | ✅ | ✅ | 开源 Elo #1，亚秒推理，16GB GPU | **极高**：Ollama 本地兜底首选 |
| **FLUX.1 Kontext** [dev] | 12B | ✅ | ✅ | 角色身份保持编辑 SOTA | **高**：编辑能力另一路径 |
| HunyuanImage 3.0 | 80B MoE | ✅ | ✅(需大GPU) | 击败 Nano Banana | 中：仅云 API 可行 |
| CogView4-6B | 6B | ✅ Apache2.0 | ✅ | 智谱开源底座，中英原生 | 中-高：离线兜底 |
| SD3.5 / SDXL+Lightning | 8B/2.5B | ✅ | ✅ | ComfyUI 生态最成熟 | 中：质量已落后新模型 |

### 视频生成模型（Top 6）

| 模型 | 参数 | 开源 | 本地 | 特色 | 接入价值 |
|---|---|---|---|---|---|
| **Wan 2.1/2.2** | 14B | ✅ Apache2.0 | ✅ | 中英双语文字特效视频，首尾帧，4K | **高**：fal 已托管，keyframes 对口 |
| **HunyuanVideo** 1.5 | 13B | ✅ | ✅(14GB VRAM) | 消费级 GPU 友好 SOTA | **极高**：最低 VRAM 开源视频 |
| **LTX-Video** / LTX-2 | 13B | ✅ | ✅ | 实时+音视频同步+消费级 | **极高**：填补实时/音轨空白 |
| CogVideoX 1.5 | 5B | ✅ Apache2.0 | ✅ | 智谱开源底座 | 高：与现有 Zhipu 平滑迁移 |
| Step-Video-T2V | 30B | ✅ MIT | ✅(需H100) | MIT 协议最友好 | 中-高：云 provider 备选 |
| Mochi-1 | 10B | ✅ Apache2.0 | ✅ | 已被 Wan/Hunyuan 超越 | 中：备份/对比基线 |

### 已有 MCP 的项目（Top 8）

| 项目 | 类型 | 本地 | 接入价值 |
|---|---|---|---|
| **ComfyUI 官方 MCP** | 本地 MCP | ✅ | **最强补充**：挂本地 ComfyUI 走免费开源模型 |
| **fal.ai 官方 MCP** | 云 MCP | ❌ | **最高接入**：单一 endpoint 上千模型 |
| **flux-mcp** (BFL官方) | 云 MCP | ❌ | FLUX.2 官方 MCP，editing/composition |
| Runway MCP | 云 MCP | ❌ | Gen-4 电影感运镜，差异化 |
| WaveSpeed MCP | 云 MCP | ❌ | 聚合 Kling+Wan+Z-Image |
| MidjourneyMCP | 云 MCP | ❌ | MJ 美学风格，当前完全缺失 |
| tehw0lf/flux-mcp | 本地 MCP | ✅ | 本地 FLUX GPU，零成本 |
| RamboRogers/fal-mcp | 云 MCP | ❌ | fal 图+视频统一，参考实现 |

### 云托管平台（Top 6）

| 平台 | 协议 | 定价 | 接入价值 |
|---|---|---|---|
| **SiliconFlow** 硅基流动 | OpenAI 兼容 | 极低(国内) | **最高，零改造成本**：base_url+key 即挂入 |
| **fal.ai** | REST(submit+poll) | 中 | **最高**：覆盖 Wan/Hunyuan/FLUX 全系 |
| **Replicate** | REST(predict) | 中 | 高：模型库最广，社区方案最多 |
| **Together AI** | OpenAI 兼容 | 低 | 高：与 SiliconFlow 同构 |
| HuggingFace Inference | REST | 极低(¥0.0001/图) | 高：价格杀手 |
| Cloudflare Workers AI | REST | 低 | 独特：边缘推理，速度卖点 |

---

## 二、评估结论

### integrate（立即接入，5 个 high）

| # | 技术 | Effort | 理由 |
|---|---|---|---|
| 1 | **SiliconFlow Provider** | M | 一次解锁 FLUX.2/Qwen-Image/Z-Image/CogView4/SD3.5/Kolors 6+ 开源 SOTA；OpenAI 兼容零改造 |
| 2 | **Fal Provider** | M | 视频侧杠杆最高：Wan2.5/HunyuanVideo/HunyuanImage/FLUX Kontext；复用现有 poll.ts |
| 3 | **Ollama Provider** | M | 首个本地 provider，填补 100% 依赖云的战略缺口；Z-Image-Turbo/FLUX Klein/CogView4 已上 Ollama |
| 4 | **generate_image_edit 工具** | M | 补齐缺失的指令式编辑；Qwen-Image-Edit+FLUX Kontext 开源双雄 |
| 5 | **MediaProvider 接口扩展** | M | capabilities()/tier()/pricing()/health()/lifecycle()，provider 增多后 router 需要元数据 |

### evaluate（深入评估，4 个）

| # | 技术 | 理由 |
|---|---|---|
| 1 | **Routing Orchestrator 层** | intent+capability+cost+latency-aware 智能选 provider（provider 增多后必需） |
| 2 | **ComfyUI Bridge Provider** | 通用本地（ControlNet/LoRA/IPAdapter），但工作流脆性高 |
| 3 | AliBailian 直连 | 阿里百炼（Qwen-Image/Wan 第一方），但 SiliconFlow 已覆盖 |
| 4 | Diffusers in-process | 无需 ComfyUI 的本地，但 python-shell/onnxruntime 复杂 |

### monitor（关注，6 个）

Replicate(备选 fal) / HunyuanImage 3.0(80B 云) / Wan2.5 本地 / CogView4 本地(已覆盖) / 旧模型(SD3.5/SDXL/SANA) / DMD2 蒸馏技术

---

## 三、架构方案（接受重大重构）

### 总体策略

从"Agnes/Zhipu 云 API 包装器 + 8 本地工具"→ **"多源、多模态、可路由的媒体生成平台"**

三条原则：
1. **云优先、本地 opt-in** — MCP 用户开箱即用，不假设有 GPU；本地 provider 环境探活自动注册
2. **多模型单 provider** — SiliconFlow + Fal 两家覆盖 15+ 开源 SOTA，避免 provider 爆炸
3. **8 个结构化本地工具不变** — 它们是"tier=local, capability=specific-format"的确定性 provider

### 5 层架构

```
┌─────────────────────────────────────────────────────┐
│ 层 1 — MCP 工具层（12 → 14 工具）                    │
│   保留 12 + 新增 generate_image_edit + list_providers│
├─────────────────────────────────────────────────────┤
│ 层 2 — Router/Orchestrator（新增，平台"大脑"）        │
│   输入: intent(t2i/i2i/edit/t2v/i2v/keyframes) +    │
│         constraints(bilingual? resolution? cost?)   │
│   策略: cloud-first(默认) / local-first / cheapest / │
│         fastest / quality-first / explicit           │
│   输出: { provider, reason }                         │
├─────────────────────────────────────────────────────┤
│ 层 3 — Provider 抽象层（扩展 MediaProvider 接口）     │
│   +capabilities() / tier() / pricing() / health()    │
│   +supportsImageEdit() / editImage()                 │
│   所有新方法 optional，老 provider 零破坏             │
├─────────────────────────────────────────────────────┤
│ 层 4 — 具体实现                                       │
│   云: AgnesProvider | ZhipuProvider | SiliconFlow★  │
│       | FalProvider★ | (Replicate) | (Together)     │
│   本地: OllamaProvider★ | (ComfyUIBridge)            │
│   确定性: D2Engine | VegaLite | MathJax | Satori     │
│         | QRCode | Iconify | Resvg | renderVideo    │
├─────────────────────────────────────────────────────┤
│ 层 5 — 基础设施                                       │
│   http.ts(withRetry) | poll.ts | config.ts          │
│   download.ts | color-utils.ts | registry.ts        │
└─────────────────────────────────────────────────────┘
```

### 分阶段实施

**阶段 1（0.10.0，短期）**：接口扩展 + SiliconFlow + Ollama
- MediaProvider 接口加 capabilities/tier/pricing/health（optional，零破坏）
- 新增 SiliconFlowProvider（OpenAI 兼容，与 ZhipuProvider 同构 → 抽 OpenAICompatBase）
- 新增 OllamaProvider（环境探活：GET {OLLAMA_HOST}/api/tags → 动态注册）
- 效果：一次解锁 6+ 开源图像 SOTA + 首个本地/离线能力

**阶段 2（0.11.0，短期）**：Fal + generate_image_edit
- 新增 FalProvider（REST submit+poll，复用 poll.ts，覆盖 Wan/Hunyuan/FLUX 系视频+图像）
- 新增 generate_image_edit 工具（ImageProvider + supportsImageEdit/editImage）
- 效果：补齐视频开源 SOTA + 图像编辑能力

**阶段 3（0.12.0，中期）**：Router 层 + list_providers
- 新增 Router/Orchestrator（intent + capability + cost + latency + health → provider 选择）
- list_models 升级为 list_providers（输出 capabilities/tier/pricing/latency/health）
- 效果：CC 能基于能力（不只是模型名）选 provider；用户策略可配

**阶段 4（0.13.0+，长期）**：ComfyUI Bridge + 高级
- ComfyUI Bridge Provider（ControlNet/LoRA/IPAdapter 精确控制）
- 音轨（LTX-Video 音视频同步）
- 实时预览（流式帧推送）
- 自定义模型/LoRA 支持

### 关键风险 + 缓解

| 风险 | 缓解 |
|---|---|
| GPU 依赖（多数用户无 GPU） | cloud-first 默认；本地 provider 全 opt-in（探活才注册） |
| 模型体积大（6-80GB） | 不在 MCP 内自动拉模型；ollama pull 是用户显式动作 |
| Provider API 变更频繁 | 适配器保持薄；HTTP 复用 http.ts withRetry 单一事实源 |
| 成本不可预期（按图/秒计费） | list_providers 暴露 pricing；生成响应回传 cost estimate |
| 工具数膨胀（12→14+） | 合并 image-edit 进 generate_image（instruction 参数）或保持独立但描述区分 |
| 启动时间（health check） | 启动只同步探活（env 是否存在），HTTP health lazy + 后台 |

---

## 四、与现有架构的关系

当前 media-gen-mcp 的 **Provider 可插拔架构**（MediaProvider 接口 + registry）天然支持扩展：
- SiliconFlow/Ollama：OpenAI 兼容 → 与 ZhipuProvider 同构，抽 OpenAICompatBase 共享
- Fal：REST submit+poll → 与 Agnes createVideo 同构，复用 poll.ts
- Router：resolveProvider 已做 model↔provider 路由 → 自然扩展为 intent+capability 路由

**不需要推翻现有架构**——是在现有 Provider 抽象上增加新的实现 + 一层 Router。

---

> 本调研基于 2026-07-18 WebSearch 实时结果。开源 AI 领域迭代极快（月级），建议每季度复审。
