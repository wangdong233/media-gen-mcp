# Agnes AI 文生图 / 文生视频模型深度调研（2026）

> 调研日期：2026-07-13｜信息时效：2026 年 6–7 月
> 厂商：Agnes AI（新加坡 AI Lab，模型由旗下 **Sapiens AI** 开发，自称全球 Top 10 AI Lab）
> 官网 https://agnes-ai.com/ ｜ API 平台 https://platform.agnes-ai.com/ ｜ 文档 https://wiki.agnes-ai.com/

---

## 一、一句话定位

Agnes AI 自 **2026-06-01** 起对外宣称：将旗下**文本 + 图像 + 视频**三类核心模型 API **无限期免费（indefinitely free）、无需候补名单（no waitlist）**开放，号称全球首家「全模态 API 同时免费」的 AI Lab。当前图像/视频的标准价格已被官方**临时下调至 $0**（见各模型定价表），但保留标准价作为「恢复收费时的基准」。

> ⚠️ 注意：免费 ≠ 有 SLA。官方服务条款明确写明「免费计划不提供 SLA，也不保证服务可用性」。视频接口为异步任务，高峰期 500/502/503 报错常见。建议作为**原型/Demo/试错/低频生产**使用，不建议作为唯一生产基础设施。

---

## 二、模型总览

| 模型 | 类别 | 模型名（API） | 端点 | 当前状态 |
|---|---|---|---|---|
| Agnes Image 2.0 Flash | 文生图 / 图生图 / 多图合成 | `agnes-image-2.0-flash` | `POST /v1/images/generations` | 免费（标准价 $0.003/图，现 $0/图） |
| Agnes Image 2.1 Flash | 文生图 / 图生图（高信息密度优化） | `agnes-image-2.1-flash` | `POST /v1/images/generations` | 免费（标准价 $0.003/图，现 $0/图） |
| Agnes Video V2.0 | 文生视频 / 图生视频 / 关键帧动画（含音频） | `agnes-video-v2.0` | `POST /v1/videos`（异步） | 免费（标准价 $0.005/秒，现 $0/秒） |

> 另有文本模型 `agnes-2.0-flash`（256K→已升级 1M 上下文，走 `/v1/chat/completions`，OpenAI 兼容），不在本次图像/视频调研范围，仅作体系完整性提及。

---

## 三、免费额度与限速（最高优先级，精确标注）

### 3.1 免费额度

| 项目 | 说明 |
|---|---|
| 免费额度 | **无限期（indefinitely）、无固定额度上限**，官方明确表态不是「7 天试用」也不是「用完即止的一次性赠送」 |
| 生效日期 | 2026-06-01 起 |
| 是否需候补名单 | 否（no waitlist） |
| 是否需信用卡 | 官方文档/公开报道**未提及需绑定信用卡**即可在 API 平台（platform.agnes-ai.com）邮箱注册、创建 API Key 调用。标注：**「无需信用卡」需核实**（文档未显式声明，亦未要求，但请以注册页实际流程为准） |
| 是否到期 | 否（indefinitely，但官方保留随时调整策略的权利；社区普遍预期「不会永久免费」，建议关注政策变更） |
| 当前实际单价 | 图像 $0/图，视频 $0/秒（标准价被临时下调至 0） |

### 3.2 限速 / 限次（RPM 与并发）

| 维度 | 数值 | 来源与可信度 |
|---|---|---|
| 文本模型 RPM | **约 20 次/分钟**（founder Bruce Yang 原话：「我们限制了 RPM……大概每分钟 20 次」，用于防止 token 二次倒卖） | 创始人访谈，较可信 |
| 图像模型 RPM（1K 分辨率） | **约 20 RPM** | 第三方实测（tinyash），**需核实** |
| 图像模型 RPM（4K 分辨率） | **约 1 RPM** | 第三方实测（tinyash），**需核实** |
| 视频 RPM / 并发 | 官方文档**未明确公开**；视频为异步任务，受队列调度约束（高峰排队明显） | **需核实** |
| 每日 / 每月上限 | 官方未公开明确的每日/每月总量硬上限；描述为「不限调用量」，仅靠 RPM 节流 | **需核实**是否存在隐性日限/月限 |
| 信用（Credit）体系 | 平台另有信用制：**1 信用 = $0.005**，批量购买可获**最多 +15% 额外信用**。该体系主要对应 Agent 平台/高可靠性场景，与当前「免费 API 调用」并行存在 | aibase，较可信 |

> 结论：能确认的是「无限期免费 + 约 20 RPM 量级限速（防滥用）」；精确的并发数、日/月硬上限官方未文档化，**建议生产前自行压测并以官方最新条款为准**。

---

## 四、付费价格（标准价，精确）

### 4.1 图像定价

| 模型 | 标准价 | 当前价 | 换算 |
|---|---|---|---|
| agnes-image-2.0-flash | **$0.003 / 图** | **$0 / 图**（免费） | 即 $3 / 1000 张 |
| agnes-image-2.1-flash | **$0.003 / 图** | **$0 / 图**（免费） | 即 $3 / 1000 张 |

### 4.2 视频定价

| 模型 | 标准价 | 当前价 | 换算 |
|---|---|---|---|
| agnes-video-v2.0 | **$0.005 / 秒** | **$0 / 秒**（免费） | 即 $0.3 / 分钟；$18 / 小时 |

### 4.3 订阅 / 信用包

- 无强制订阅。平台采用**按量信用制**：1 信用 = $0.005，批量充值赠 +15% 信用。
- 当前图像/视频 API 调用本身计费为 0，信用主要消耗在 Agent 应用平台（非免费）或未来恢复收费后的按量扣减。

> 备注：以上标准价来源于 Agnes 官方文档定价表与公开报道（ofweek：图像 $3/1000 张；官方 video v2.0 文档：$0.005/秒），数据相互印证。当前实际收费为 $0。

---

## 五、协议与端点（OpenAI 兼容性判定）

**Base URL：** `https://apihub.agnes-ai.com/v1`
**认证：** `Authorization: Bearer YOUR_API_KEY`

| 能力 | 端点 | OpenAI 兼容？ | 备注 |
|---|---|---|---|
| 文本对话 | `POST /v1/chat/completions` | ✅ 兼容 | 可直接配进任意 OpenAI SDK / Custom Provider |
| 图像生成 | `POST /v1/images/generations` | ✅ 路径兼容，⚠️ **参数有差异** | `response_format` **必须放在 `extra_body` 内**，放顶层会返回 400；图生图输入图放 `extra_body.image` 数组（或顶层 `image` 数组，两版文档表述略有出入），**不需要** `tags:["img2img"]` |
| 视频生成 | `POST /v1/videos`（创建）+ `GET /agnesapi?video_id=` 或 `GET /v1/videos/{task_id}`（轮询） | ❌ 非标准 | OpenAI 无原生视频端点；为**私有异步任务模式**（创建任务→返回 video_id/task_id→轮询至 completed→取 url） |

**图像端点的关键「坑」**（接 MCP 时务必处理）：
1. `response_format` 不可放请求体顶层 → 必须放 `extra_body`；
2. 文生图仅需 `model` + `prompt` + `size`；
3. 图生图：输入图 URL 或 Data URI Base64 放 `image` 数组；
4. 客户端超时建议设 **60s–360s**（高分辨率/复杂 prompt 较慢）。

**视频端点的异步流程**：
1. `POST /v1/videos` 带参数 → 返回 `{task_id, video_id, status:"queued"}`；
2. 轮询 `GET /agnesapi?video_id=xxx`（推荐）直至 `status:"completed"`；
3. 取响应体 `url` 字段（mp4 直链）。

---

## 六、模型能力详解

### 6.1 Agnes Image 2.0 / 2.1 Flash（图像）

| 维度 | 说明 |
|---|---|
| 支持工作流 | 文生图、图生图、多图合成（multi-image composition）、图像编辑（换背景/换物/风格迁移/局部修改） |
| 输出尺寸 | 由 `size` 参数控制，如 `1024x768` / `1024x1024` / `768x1024`；支持 1K–4K 分辨率范围（4K 限速 1 RPM） |
| 输出格式 | URL 或 Base64（b64_json）二选一 |
| 输入（图生图） | 公网 HTTPS 图片 URL，或 Data URI Base64 |
| 2.0 vs 2.1 差异 | 2.1 Flash 针对**高信息密度图像**（复杂布局/丰富细节/密集元素）优化；2.0 更偏通用与图生图。社区习惯：文生图优先 2.1，图生图优先 2.0（SkillHub 描述，非官方硬性规定） |
| 多模态理解（注） | 另有教程将 `agnes-image-2.1-flash` 经 `/v1/chat/completions` 用于「图片识别/视觉理解」（Cherry Studio 教程），即该模型名在对话端点下亦可作视觉理解用。**此能力与生图是不同调用路径，需核实当前是否同一名多能** |
| 评测 | Image 2.0 Flash 入选 Artificial Analysis 图像编辑榜单，**ELO 1184，Top 20** |
| 开发者 | Sapiens AI（Agnes AI 旗下） |

### 6.2 Agnes Video V2.0（视频）

| 维度 | 说明 |
|---|---|
| 支持工作流 | 文生视频、图生视频（官方推荐，效果更可控）、关键帧动画（keyframes，多图过渡） |
| 生成模式 | `ti2vid`（文/图→视频）、`keyframes` |
| 标准分辨率档位 | **480p / 720p / 1080p**（升级版提及支持 4K 超清，需核实当前 API 是否开放 4K） |
| 宽高比 | 16:9、9:16、1:1、4:3、3:4 |
| 时长控制 | `seconds = num_frames / frame_rate`；`num_frames ≤ 441` 且须满足 `8n+1`；`frame_rate` 1–60。24fps 下最长约 18 秒 |
| 推荐时长档 | 3s(81帧)、5s(121帧)、10s(241帧)、18s(441帧)，均 @24fps |
| 音频 | 支持**音画同出**（Image to Video with Audio，已入 Artificial Analysis 榜单） |
| 默认尺寸 | width 1152 × height 768（16:9 示例） |
| 可复现 | 支持固定 `seed`；支持 `negative_prompt` |
| 异步任务 | 创建→queued→in_progress→completed/failed；失败有 error 字段 |
| 评测 | 入选 Artificial Analysis「Image to Video (With Audio)」榜单 |

---

## 七、开源 vs 闭源

**全部闭源（专有）**。Agnes AI / Sapiens AI **未公开任何模型权重、训练代码或下载地址**。接入方式仅限官方 API（无自部署、无本地推理）。社区有基于其免费 API 封装的 Gradio Web UI / MCP 工具（如 GitHub `you-want/agnes-image-tool`），但底层仍依赖云端 API。

---

## 八、适合 media-gen-mcp 的接入判定

| 模型 | 接入难度 | 判定 | 理由 |
|---|---|---|---|
| agnes-image-2.0/2.1-flash | 低 | **easy**（OpenAI 兼容） | 端点 `/v1/images/generations` 与 OpenAI SDK 路径一致；仅需做一层适配：把 `response_format` 注入 `extra_body`、图生图输入图注入 `image` 数组、超时拉长到 60–360s。可复用现有 OpenAI image provider，加一个轻量 wrapper |
| agnes-video-v2.0 | 中 | **custom**（需写私有 provider） | `/v1/videos` 为私有异步协议，OpenAI 无对应端点；需自实现「创建任务 + 轮询 video_id + 取 mp4 url」的 provider，并处理 503/排队重试 |

> 综合建议：Agnes AI 在 media-gen-mcp 里可作为一个**高性价比（当前免费）的多模态 provider**：
> - 图像：走 easy 路线，几乎零成本接入；
> - 视频：走 custom 路线，写一个异步 provider，但因当前 $0/秒，是「零成本文生视频」的稀缺选项（社区已有 Agnes AI + O4OpenAI 协议转换 + ArcReel 的零成本短视频流水线案例）。
> - 风险提示：无 SLA、可能恢复收费、RPM 受限（~20/min）、国内网络需自测可达性（`apihub.agnes-ai.com`）。

---

## 九、关键信息来源

- 官方 Image 2.0 Flash 文档：https://agnes-ai.com/doc/agnes-image-20-flash （定价表 $0.003/图，现 $0）
- 官方 Video V2.0 文档：https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-v20 （定价表 $0.005/秒，现 $0；异步 API）
- 量子位报道（2026-06-01 全模态免费）：https://www.qbitai.com/2026/06/427332.html
- 腾讯云开发者社区（端点/参数/SLA 说明）：https://cloud.tencent.com/developer/article/2683093
- 知乎创始人访谈（RPM ~20/min）：https://zhuanlan.zhihu.com/p/2047721265620857728
- GitHub API 实现参考：https://github.com/you-want/agnes-image-tool/blob/main/image-api.md
- aibase（信用制 1 信用=$0.005，批量 +15%）：https://top.aibase.com/tool/agnes-ai
- ofweek（图像 $3/1000 张）：https://mp.ofweek.com/ai/a256714323657
- tinyash（图像 RPM 1K=20/4K=1，需核实）：https://www.tinyash.com/blog/agnes-ai-free-multimodal-api-complete-guide/
- inews.qq（单周 567 万图 / 237 万秒视频）：https://view.inews.qq.com/a/20260626A04AYX00

---

## 十、待核实清单（绝不编造）

1. **是否需信用卡**：文档/报道均未提，注册流程需亲自确认。
2. **视频 RPM / 并发上限 / 每日硬上限**：官方未公开数字。
3. **4K 视频与 4K 图像**是否已对免费 API 开放，还是仅升级版/付费通道可用。
4. **图像 RPM（1K=20 / 4K=1）**来自第三方实测，官方未文档化。
5. `agnes-image-2.1-flash` 是否在 `/v1/chat/completions` 下同时承担「视觉理解」能力（一名多能需确认）。
6. 免费政策**是否/何时**恢复标准收费（$0.003/图、$0.005/秒）。
7. 国内网络对 `apihub.agnes-ai.com` 的直连可达性与延迟。