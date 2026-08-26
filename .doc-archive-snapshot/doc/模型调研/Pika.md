# Pika 深度调研报告（2026）

> 厂商：Pika Labs（pika.art）｜定位：创意型 AI 视频生成平台｜最新模型：Pika 2.5（网页版，2026 年初发布）/ Pika 2.2（API 版）
> 调研日期：2026-07-13

---

## 一、核心结论（先看这个）

| 维度 | 结论 |
|------|------|
| **是否有文生图** | **否**。Pika 是纯视频生成平台，没有独立的文生图/图生图模型。所有功能均以"视频"为输出（文生视频、图生视频、关键帧、特效等）。 |
| **开源 vs 闭源** | **完全闭源**。无公开权重、无 HuggingFace 下载、无训练代码。只能通过网页版或 API 使用。 |
| **官方 API 渠道** | **Pika 自身不直接卖 API**。官方 API 通过 **fal.ai** 托管分发（[pika.art/api](https://pika.art/api) 官方页面明确写"Our API is now available through Fal.ai"）。 |
| **API 协议** | **fal 私有协议**（fal-client SDK / REST），**不是 OpenAI 兼容**（无 `/v1/images/generations`）。 |
| **适合 media-gen-mcp** | **custom**（需为 fal 写专属 provider）；第三方聚合可 easy，但非官方。 |

---

## 二、模型清单（全部为视频模型）

Pika 当前在售模型版本为 **Pika 2.5**（网页版主力）与 **Pika 2.2**（fal.ai API 端点）。围绕视频生成提供一组命名功能（Pikaframes / Pikaffects / Pikascenes / Pikatwists / Pikadditions / Pikaswaps / Pikaformance），本质都是同一代视频模型的不同应用管线。

| 模型/功能 | 版本 | 能力 | 渠道 | 备注 |
|-----------|------|------|------|------|
| **Pika 2.5** | v2.5 | 文生视频 / 图生视频 | 网页版（pika.art） | 2026 年初发布，画质/物理/运镜/提示词遵循度升级，内置音效生成 |
| **Pika 2.2** | v2.2 | 文生视频 / 图生视频 | fal.ai API | 网页版上一代；API 端点的主力版本。新增 Scene Effects（爆炸/融化/膨胀/压碎）、最长 10 秒 |
| **Pikaframes** | v2.2/v2.5 | 多关键帧平滑过渡 | 网页版 + fal.ai（`fal-ai/pika/v2.2/pikaframes`） | 多张关键帧图生成过渡视频，最长可达 20-25 秒（仅 480p 网页版） |
| **Pikascenes** | v2.2/v2.5 | 多参考图场景合成 | 网页版 + fal.ai（`fal-ai/pika/v2.2/pikascenes`） | 多张参考图融合到一个视频场景 |
| **Pikaffects** | v2.2/v2.5 | 物理特效（图生视频/视频生视频） | 网页版 | 爆炸、融化、蛋糕化等"现实扭曲"特效，5 秒 |
| **Pikatwists** | v2.2/v2.5 | 扭曲变形 | 网页版 | Turbo(720p) / Pro(1080p)，5 秒 |
| **Pikadditions** | v2.2/v2.5 | 向视频添加新元素 | 网页版 | 把新物体植入现有视频 |
| **Pikaswaps** | v2.2/v2.5 | 替换视频中的元素 | 网页版 | 换脸/换物 |
| **Pikaformance** | v2.2/v2.5 | 音频驱动视频（口型/动作同步） | 网页版 | 720p，按秒计费（3 credits/秒），最长 30 秒 |

> 注：Pika **没有**像 Stable Diffusion / Flux 那样的纯文生图端点。如果你的 media-gen-mcp 需要文生图，Pika 不适合；它是视频专用。

---

## 三、开源情况

- **状态：闭源（Closed Source）**
- 无公开模型权重，HuggingFace 上无官方 `pika` 权重仓库。
- 无训练代码、无数据集公开。
- 仅能通过 pika.art 网页版 或 fal.ai 托管的 API 调用。
- 对比：HuggingFace 开源视频模型生态以 CogVideoX、Stable Video Diffusion 等为主，**Pika 不在其中**。

---

## 四、免费额度与限速（重点核查）

### 1. 网页版（pika.art）—— Free 计划

| 项目 | 情况 |
|------|------|
| 免费额度 | **"Limited free access"（有限的免费访问）**。官方定价页未明确公布 Free 档的积分总数。第三方（Crazyrouter 博客，2026-04，Pika 2.2 时期）称为 **约 150 credits**，**需核实**（新 2.5 体系下可能已变）。 |
| 可用功能 | Free 档**仅限 480p**；可用部分功能：Text-to-Video/Image-to-Video 480p 5s（12 credits）、Pikaffects 图生视频（15 credits）、Pikascenes/Pikadditions/Pikaswaps 480p（20 credits）、Pikatwists Turbo 720p（60 credits）、Pikaformance 音频（3 credits/秒）。 |
| 水印 | **免费生成带水印**；去水印需升级到 Basic 及以上。 |
| 是否需信用卡 | 网页版免费注册**通常不需要信用卡**（行业惯例，邮箱/Google 登录即可），**需核实**。 |
| 限速（RPM/并发） | 官方公开页面**未公布** Free 档的具体 RPM/并发/每日上限。**需核实**。视频生成本质是异步任务（提交→轮询），无传统意义的"每分钟请求"限制，主要受积分总量约束。 |
| 商用权限 | **Free 档仅供个人/评估**，不含商用权。 |

### 2. fal.ai API —— 免费额度

| 项目 | 情况 |
|------|------|
| 免费额度 | **fal.ai 本身无针对 Pika 的固定免费额度**。fal.ai 新账号可能有少量试用额度，但**并非 Pika 专属**，**需核实**具体数额。 |
| 是否需信用卡 | fal.ai 调用 API 需**充值/绑定付款方式**（按量付费，预充值制）。**需核实**是否强制信用卡。 |
| 限速 | fal.ai 按账号层级有并发限制；具体 RPM/并发**需在 fal.ai 控制台查看**，官方未在 Pika 模型页公布固定数字。 |

---

## 五、付费价格（精确）

### A. 网页版订阅（Pika 2.5，年付价，积分制）

> 来源：[pika.art/pricing](https://pika.art/pricing) 官方页面 + [Flowith 2026-06-22 解读](https://flowith.io/blog/pika-art-pricing-2026-free-vs-basic-vs-pro/)。
> ⚠️ 官方页面价格为 JS 动态渲染，具体 $ 金额来自第三方 Flowith（较新），另一第三方 Crazyrouter（2026-04）给出的金额不同（Standard $8、Pro $28、Unlimited $58）。**金额存在版本差异，下单前务必以 pika.art 结账页实时价格为准。**

| 计划 | 价格（年付，第三方解读） | 月度积分（官方页面确认） | 分辨率 | 水印 | 商用 |
|------|--------------------------|--------------------------|--------|------|------|
| Free | $0 | 有限（约 150，需核实） | 仅 480p | 有 | 否 |
| Basic | ~$8/月（年付） | **80** | 仅 480p | 无 | 是 |
| Standard | ~$28/月（年付） | **700** | 全分辨率 | 无 | 是 |
| Pro | ~$76/月（年付） | **2,300** | 全分辨率 + 更快生成 | 无 | 是 |
| Fancy | 见结账页（需核实） | **6,000** | 全分辨率 | 无 | 是 |

> 积分数字（700 / 2300 / 6000）由官方定价页直接读取确认，可信度高。Basic 的 80 积分来自 Flowith，官方页面未直出该数字，**需核实**。

### B. 每次生成的积分消耗（官方定价页精确值，Pika 2.5）

**Text-to-Video & Image-to-Video（Model 2.5）**

| 分辨率 | 5 秒 | 10 秒 |
|--------|------|-------|
| 480p | 12 credits（Free 可用） | 24 credits（Paid） |
| 720p | 20 credits（Paid） | 40 credits（Paid） |
| 1080p | 40 credits（Paid） | 80 credits（Paid） |

**Pikaframes（Model 2.5，关键帧过渡）**

| 分辨率 | 5s | 10s | 10-15s | 15-20s | 20-25s |
|--------|----|-----|--------|--------|--------|
| 480p | 12(Free)/24(Paid) | 24 | 36 | 48 | 60 |
| 720p | 20 | 40 | 60 | 80 | 100（均 Paid） |
| 1080p | 40 | 80 | 120 | 160 | 200（均 Paid） |

**其他功能（均 5 秒）**

| 功能 | 480p | 720p | 1080p |
|------|------|------|-------|
| Pikaffects（图生视频） | 15 cr (Free) | — | 18 cr (Paid, 视频生视频) |
| Pikascenes | 20 cr (Free) | 35 cr (Paid) | 65 cr (Paid) |
| Pikatwists | — | 60 cr (Turbo, Free) | 80 cr (Pro, Paid) |
| Pikadditions & Pikaswaps | 20 cr (Free) | 35 cr (Paid) | 65 cr (Paid) |
| Pikaformance（音频视频，720p） | 3 credits/秒（Free & Paid 同价），最长 30 秒 | | |

### C. fal.ai API 按量付费（Pika 2.2，精确，官方模型页标注）

> 来源：[fal.ai/models/fal-ai/pika/v2.2/image-to-video](https://fal.ai/models/fal-ai/pika/v2.2/image-to-video) 页面明确标注。

| 分辨率 | 时长 | 单价 | 折算每秒 |
|--------|------|------|----------|
| 720p | 5 秒 | **$0.20** | ~$0.04/秒 |
| 1080p | 5 秒 | **$0.45** | ~$0.09/秒 |

**fal.ai 上 Pika 2.2 端点（用于 API 集成）：**
- 文生视频：`fal-ai/pika/v2.2/text-to-video`
- 图生视频：`fal-ai/pika/v2.2/image-to-video`
- 关键帧过渡：`fal-ai/pika/v2.2/pikaframes`
- 多参考场景：`fal-ai/pika/v2.2/pikascenes`
- 调用基础 URL：`https://fal.run/fal-ai/pika/v2.2/...`
- 鉴权：`Authorization: Key {FAL_KEY}`（fal 私有格式）

### D. 第三方聚合渠道（非官方，仅供参考）

| 渠道 | 价格 | 协议 | 备注 |
|------|------|------|------|
| Crazyrouter | 比 fal 直连便宜 35-50%（720p 8s ~$0.13-0.18） | **OpenAI 兼容**（`base_url=https://crazyrouter.com/v1`，`model="pika-2.2"`） | 第三方转售，非官方 |
| 多米 API（国内） | ~0.3 元/次 | 私有 | 限速 10 次/秒，每日上限 10000 次 |
| 302.AI | 按量 | 私有 | 提供 `pika/v2.2-t2v` |
| pikapikapika.io | 按量 | 私有 | 非官方封装 |

---

## 六、API 协议与 media-gen-mcp 适配评估

| 接入方式 | 协议 | 端点 | 适合 MCP | 说明 |
|----------|------|------|----------|------|
| **fal.ai 官方**（推荐） | **fal 私有协议** | `https://fal.run/fal-ai/pika/v2.2/*` | **custom** | 需用 `fal-client` SDK 或手写 REST（提交任务→轮询 task_id→取 video_url）。非 OpenAI 格式，需写专属 provider。异步轮询模式（建议自适应轮询：前 30s 每 2s、120s 内每 5s、之后每 10s）。 |
| Crazyrouter 等聚合 | OpenAI 兼容 | `https://crazyrouter.com/v1` | **easy** | 可直接复用 OpenAI 客户端，但属第三方转售，稳定性/合规性自担。 |
| pika.art 网页版 | 无 API | 仅 Web | **no-api** | 只能手动操作，无法程序化集成。 |

**media-gen-mcp 建议**：若要接 Pika，走 **fal.ai 官方 + custom provider**。需要实现：
1. 提交生成任务（POST 到 fal 端点）
2. 轮询任务状态（GET `/tasks/{task_id}`，或用 fal 的 webhook）
3. 下载返回的 video_url

不支持 OpenAI `/v1/images/generations` 同步返回模式，必须异步。

---

## 七、能力规格总结

| 项目 | 规格 |
|------|------|
| 最大分辨率 | **1080p**（网页版 Standard 及以上 / fal.ai） |
| 单次时长 | 文生视频/图生视频 **最长 10 秒**；Pikaframes 关键帧最长 **20-25 秒**（仅 480p） |
| 宽高比 | 16:9、9:16、1:1 等（API 支持 `aspect_ratio` 参数） |
| 帧率 | 官方未明确公布（需核实，行业常见 24fps） |
| 特色 | Scene Effects 物理特效（爆炸/融化/膨胀/压碎/溶解/冻结/燃烧/生长/缩小/悬浮）—— **这是 Pika 区别于 Runway/Kling/Veo 的独家卖点**；内置音效生成；Pikaformance 音频驱动口型同步 |
| 生成速度 | Pika 2.2 比 2.1 快 30-40%（官方称） |
| 商用权 | 所有付费计划含商用权；Free 仅限个人/评估 |

---

## 八、需要核实的事项（不编造）

1. **Free 档积分总数**：官方页面只写"Limited free access"，未给数字。150 credits 为第三方旧值（Pika 2.2 时期），2.5 体系下需核实。
2. **订阅 $ 金额**：官方页面 JS 渲染未直出，Flowith（$8/$28/$76）与 Crazyrouter（$8/$28/$58）存在差异，**以 pika.art 结账页实时价为准**。
3. **Basic 档 80 credits**：来自 Flowith，官方页面未直出该数字。
4. **网页版 Free 是否需信用卡**：需核实（惯例不需要）。
5. **fal.ai 是否强制信用卡**：需核实。
6. **RPM/并发/每日上限**：Pika 官方与 fal.ai 均未在公开页面公布固定限速数字，需登录控制台查看。
7. **fal.ai 是否已上架 Pika 2.5**：目前公开端点为 v2.2，2.5 似乎仅限网页版，需核实 fal.ai 是否已更新。
8. **帧率**：官方未公布。

---

## 九、信息来源

- [Pika 官方定价页](https://pika.art/pricing)（积分消耗表、计划层级——一手）
- [Pika 官方 API 页](https://pika.art/api)（确认 API 由 fal.ai 托管——一手）
- [fal.ai Pika v2.2 Image-to-Video 模型页](https://fal.ai/models/fal-ai/pika/v2.2/image-to-video)（720p 5s $0.20 / 1080p 5s $0.45——一手）
- [fal.ai Pika v2.1 Text-to-Video API 文档](https://fal.ai/models/fal-ai/pika/v2.1/text-to-video/api)（端点命名规律）
- [Flowith：Pika Art Pricing 2026](https://flowith.io/blog/pika-art-pricing-2026-free-vs-basic-vs-pro/)（2026-06-22 订阅金额解读）
- [Crazyrouter：Pika 2.2 API 集成指南](https://crazyrouter.com/en/blog/pika-2-2-api-integration-video-pipelines-2026)（2026-04，旧价目 + 集成代码）
- [fal.ai 官方博客：Pika API is now powered by fal](https://blog.fal.ai/pika-api-is-now-powered-by-fal/)
- [Flowith：Pika 2.5 评测](https://flowith.io/blog/pika-2-5-turning-imagination-into-shareable-ai-video/)（2.5 于 2026 年初发布）
- [Morphic：Pika 2.5 技术升级](https://morphic.com/ai-glossary/Pika-25)