# Agnes vs 智谱 图像/视频生成模型横评(2026)

> 对象:Agnes(Sapiens AI,新加坡)的 `agnes-image-2.0 / 2.1-flash`、`agnes-video-v2.0`;智谱 Zhipu / BigModel 的 `CogView-3-Flash`、`CogView-4`、`GLM-Image`、`CogVideoX-Flash`、`CogVideoX-3`。
> 数据时点:2026-07-10,主要来源 2024–2026 公开文档与报道。
> 一句话:**没有绝对的赢家。Agnes 在写实质感、图像编辑、原生音画同步视频和零成本全模态上更优;智谱在中文文字渲染、4K/60fps 视频控制、高并发、SLA 与国内合规上更优。** 对 `media-gen-mcp` 这类多供应商媒体生成场景,合理的姿势是"默认 Agnes + 按场景升级到智谱"。

---

## 一、总览结论

### 谁更好?

不是非此即彼,二者擅长完全不同的维度:

- **Agnes 赢在"质感与成本"**:盲评上榜(Artificial Analysis 图像编辑榜、image-to-video 榜均确在 Top 10),写实质感与电影感强于 GLM-Image(GLM-Image 的"画面质感"是其已知短板);视频原生同步音画(音画同步是 Pavo 宣传的核心卖点);全模态(文+图+视)永久免费、无 waitlist、OpenAI schema 纯兼容。代价是**无 SLA、限速为 RPM 硬上限、中文能力弱、新加坡主体有合规不确定性**。

- **智谱赢在"能力深度与生产稳定"**:`GLM-Image` 中文文字渲染 SOTA(Word Acc 0.9116 / NED 0.9557,中文渲染准确率约 97.88%);视频 `CogVideoX-3` 支持 4K(3840×2160)、30/60fps、首尾帧生成;限速为**并发模型**而非 RPM,可线性扩(T1–T4);有平台级 SLA 与错误码规范(1302 用户限流 / 1305 平台过载);国产、模型备案,国内合规友好。代价是**免费层仅 flash 系、视频限 6s、写实与电影感弱于 Agnes**。

### 各自适合谁?

| 你是谁 / 你要什么 | 选谁 |
|---|---|
| 摄影/商品图/电影感封面,要质感 | **Agnes** |
| 海报/PPT/营销图,要精确中文文字 | **智谱 GLM-Image** |
| 短片 ≤6s,要免费又要 4K/60fps | **智谱 CogVideoX-Flash** |
| 电影感长片、原生音画同步、多图关键帧 | **Agnes agnes-video-v2.0** |
| 高并发批量生产、排队任务 | **智谱**(并发可扩) |
| 零成本原型/个人/教学 | **Agnes** |
| 国内部署/合规备案 | **智谱** |
| 海外产品/英文场景、最快集成 | **Agnes**(OpenAI 兼容最纯) |

---

## 二、全维度对比表

| 维度 | Agnes | 智谱(Zhipu / BigModel) |
|---|---|---|
| **图像质量** | AA 图像编辑榜 Top 10(盲评 Elo,PR 自述,精确 Elo 未取到);写实质感、cinematic realism 占优 | GLM-Image 中文渲染 SOTA、知识密集图强;**写实/摄影级质感为已知短板** |
| **图像模型** | `agnes-image-2.0`、`agnes-image-2.1-flash`(支持 image-to-image 编辑、flexible sizes) | `CogView-3-Flash`(免费)、`CogView-4`(通用高质量)、`GLM-Image`(中文旗舰) |
| **图像分辨率** | 文档示例 1024×768;2.1-flash 支持 flexible sizes,**无明确上限披露** | GLM-Image 原生 1024×1024–2048×2048 任意比例;CogView-4 通用高质量 |
| **中文能力** | **弱**(新加坡团队,英文场景为主,无中文专项数据) | **强**:GLM-Image 中文渲染约 97.88%、Word Acc 0.9116 / NED 0.9557;CogSound 中文音效 |
| **视频质量** | AA image-to-video 榜 Top 10(PR 自述);原生同步音视频 | CogVideoX-5b 为 AA 榜知名开源选手,通常低于顶级闭源;4K/60fps/首尾帧控制明确 |
| **视频模型** | `agnes-video-v2.0`(支持 T2V / I2V / 多图 / 关键帧动画) | `CogVideoX-Flash`(免费 ≤6s)、`CogVideoX-3`(4K / 首尾帧 / quality·speed 模式) |
| **视频分辨率** | 文档示例 1152×768,**无 4K 披露** | **最高 4K(3840×2160)**,`size` 参数直选 |
| **视频帧率** | 示例 24fps | **30 / 60 fps 可选** |
| **视频时长** | 单片 ≈5s(按 `num_frames=121` / `frame_rate=24` 推算) | Flash ≤6s/片;CogVideoX-3 付费可更长 |
| **视频音效** | **原生同步音画**(核心卖点) | `with_audio=True`(CogSound),Flash / 3 均支持 |
| **限速模型** | **RPM(每分钟请求数)硬上限** | **并发数(在途任务数)**,非 RPM |
| **限速数值(免费)** | 文本 20 RPM、视频 20 RPM、图像按分辨率 RPM(GitHub 2026-06-22) | 新用户默认 **2 并发**,可申请提升 |
| **限速扩容** | Enterprise 40 RPM / Token Plan 视频 100 RPM(付费) | 提交申请,**10 个工作日审核**;T1–T4 / Coding Plan Lite–Pro–Max |
| **免费层范围** | **全模态(文+图+视)永久免费**,无 waitlist、无时限 | **仅 flash 系永久免费**(CogView-3-Flash / CogVideoX-Flash / GLM-4.x-Flash) |
| **免费层 SLA** | **无 SLA、无稳定性保障**(GitHub 明示"运营限制,非永久保证") | **有平台级 SLA / 稳定性保障**,错误码 1305 有明确处理规范 |
| **价格(付费·图像)** | 订阅 Pro $50 含图 4000 张/天;按量价格未披露 | CogView-3-Plus ≈**¥0.1/张**(约为海外同类 1/10–1/3) |
| **价格(付费·视频)** | **$0.30/min**(生成计费) | 清影 CogVideoX **¥0.5/次**(6s);CogVideoX-3 按 token/次 |
| **OpenAI 兼容** | **完全 OpenAI 风格**,Base URL `https://apihub.agnes-ai.com/v1`,仅需改 BaseURL/Key/Model | 兼容(`/chat/completions`),另有官方 `zai-sdk` |
| **端点** | `/v1/images/generations`、`/v1/videos`(异步)、`/v1/chat/completions` | OpenAI 兼容端点 + 原生 SDK 双轨(视频用原生 SDK 的 `retrieve_videos_result` 轮询更顺) |
| **国内合规** | 新加坡主体,有访问/合规不确定性 | **国产、模型备案,国内合规友好** |
| **MCP 接入难度** | **极低**(单一网关、统一 schema、文/图/视一致) | 中(异步轮询 + zai-sdk 或兼容层) |

---

## 三、图像质量详评:`agnes-image-2.1-flash` vs `CogView-3-Flash` / `CogView-4` / `GLM-Image`

### 3.1 定位差异(先看分工)

智谱的图像模型实际是**三条线**,不应混为一谈:

- `CogView-3-Flash`:**免费档主力**,通用图像生成,能力中等,胜在永久免费。
- `CogView-4`:**通用高质量**生成,定位"通用升级款"(模型概览已列)。
- `GLM-Image`:**中文与知识密集图旗舰**,2026-01 登顶 HuggingFace Trending,中文文字渲染 SOTA。

而 Agnes 侧 `agnes-image-2.0 / 2.1-flash` 是**单一主力线**,主打 cinematic realism 与 image-to-image 编辑。

### 3.2 逐项对比

| 项 | agnes-image-2.1-flash | CogView-3-Flash | CogView-4 | GLM-Image |
|---|---|---|---|---|
| 基准排名 | AA 图像编辑榜 Top 10(盲评,PR 自述) | — | — | HF Trending 第一(2026-01);AA 榜未见中文专项 |
| 写实/质感 | **强**(cinematic realism,质感优于 GLM-Image) | 一般 | 通用高质量 | **弱(已知短板:画面质感最大短板)** |
| 中文文字 | 弱(无专项数据) | 弱 | 一般 | **SOTA:中文渲染 ≈97.88%、Word Acc 0.9116、NED 0.9557** |
| 分辨率 | 示例 1024×768,flexible sizes,上限未披露 | 标准分辨率 | 通用 | 原生 1024²–2048² 任意比例 |
| 编辑能力 | **image-to-image 编辑** | 生成 | 生成 | 偏生成 |
| 免费 | 全模态永久免费 | 永久免费 | 付费 | 付费(部分场景有免费额度) |

### 3.3 图像小结

- 要**摄影级写实、商品图、电影感封面、二次编辑** → **Agnes** 更可靠(盲评上榜、质感是 GLM-Image 的已知短板)。
- 要**精确中文文字、海报、PPT 配图、科普/知识密集图** → **GLM-Image** 绝对领先,Agnes 无中文专项优势。
- 要**零成本通用生成** → Agnes 全模态免费 vs CogView-3-Flash 免费档,二者都行;Agnes 兼容性更好,CogView-3-Flash 中文略强。

---

## 四、视频质量详评:`agnes-video-v2.0` vs `CogVideoX-Flash` / `CogVideoX-3`

### 4.1 逐项对比

| 项 | agnes-video-v2.0 | CogVideoX-Flash | CogVideoX-3 |
|---|---|---|---|
| 基准排名 | AA image-to-video Top 10(PR 自述) | CogVideoX-5b 知名开源选手,低于顶级闭源 | 付费档,AA 榜低于顶级闭源 |
| 分辨率 | 示例 1152×768,**无 4K 披露** | 标准分辨率 | **最高 4K(3840×2160)** |
| 帧率 | 示例 24fps | 标准 | **30 / 60 fps 可选** |
| 时长 | 单片 ≈5s(`num_frames=121` / `frame_rate=24`) | **≤6s/片** | 付费可更长 |
| 音效 | **原生同步音画**(Pavo 核心卖点) | `with_audio=True`(CogSound) | `with_audio=True`(CogSound) |
| 控制 | T2V / I2V / **多图 / 关键帧动画** | 基础生成 | **首尾帧生成、quality/speed 模式** |
| 免费 | 免费层 20 RPM 提交 | **永久免费(6s)** | 付费 |
| 价格 | **$0.30/min** | 免费 | 清影 ¥0.5/次(6s);CogVideoX-3 按 token/次 |

### 4.2 视频小结

- **盲评质量与原生音画同步** → Agnes 占优(AA Top 10、原生同步音画、多图/关键帧动画)。
- **4K / 60fps / 首尾帧精确控制 / 技术文档规范度** → 智谱 CogVideoX-3 明确胜出,Agnes 参数披露偏弱。
- **免费短视频(≤6s)** → 智谱 CogVideoX-Flash 更稳:免费 + 4K/60fps + 有 SLA,胜过 Agnes(免费但分辨率披露弱、无 SLA)。
- **电影感长片** → Agnes 质量更优;但若需首尾帧精确控制 + 4K + 预算敏感 → CogVideoX-3(¥0.5/次)。

### 4.3 关于视频价格的一个客观提醒(计费口径存疑)

Agnes 是 **$0.30/min**(按生成时长计费),智谱清影是 **¥0.5/次**(固定 6s)。单看数字,谁更便宜取决于 Agnes 的 min 计费口径:

- 若按**实际时长精确计费**:6s 片段 = 0.1 min → $0.03 ≈ **¥0.21/片**,反而**低于**智谱的 ¥0.5/次。
- 若按**分钟取整/起步**(不足 1 min 按 1 min):6s 片段 = $0.30 ≈ **¥2.1/片**,则**远贵于**智谱。

官方文档未明确披露该口径,**建议接入前向 Agnes 方确认计费方式**,不要凭"按 min 计费 = 贵"的直觉下结论。图像侧同理:Agnes 按量价格未披露,订阅 Pro $50/4000 张/天在额度内极划算,超量后单价未知;智谱 CogView-3-Plus ≈¥0.1/张是明确的按张价。两者计费模型不同(订阅 vs 按张),直接比"单价"并不严谨。

---

## 五、场景推荐矩阵

| 场景 | 首选 | 理由(一句话) |
|---|---|---|
| 摄影级写实质感 / 商品图 / 电影感封面 | **Agnes agnes-image** | AA 编辑榜 Top 10,质感优于 GLM-Image(写实是 GLM-Image 短板) |
| 精确中文文字(海报/PPT/营销/科普) | **智谱 GLM-Image** | 中文渲染 SOTA(≈97.88%),Agnes 无中文专项优势 |
| 免费 4K 短视频(≤6s) | **智谱 CogVideoX-Flash** | 免费且 4K/60fps + 有 SLA,胜过 Agnes(分辨率披露弱、无 SLA) |
| 电影感长片 / 原生音画同步 / 多图关键帧 | **Agnes agnes-video-v2.0** | AA Top 10、原生同步音画、多图/关键帧,质量占优 |
| 首尾帧精确控制 + 4K + 预算敏感 | **智谱 CogVideoX-3** | 首尾帧 + 4K + ¥0.5/次,控制与成本明确 |
| 高并发批量生产 | **智谱** | 并发模型可线性扩(T1–T4);Agnes 为 RPM 硬上限,突发受限 |
| 零成本原型 / 个人 / 教学 | **Agnes** | 全模态永久免费;智谱 flash 仅 6s |
| 国内部署 / 合规备案 | **智谱** | 国产、模型备案、稳定;Agnes 新加坡主体有不确定性 |
| 海外产品 / 英文场景 / 最快集成 | **Agnes** | OpenAI 纯兼容,迁移成本最低 |

---

## 六、`media-gen-mcp` 用户怎么选:默认 Agnes + 可选智谱升级

调研数据给出过一个"智谱为主、Agnes 为备"的分工建议(基于生产 SLA 与中文/4K/合规)。但若你的 `media-gen-mcp` 偏好**默认 Agnes**(理由:零成本全模态、OpenAI schema 纯兼容、迁移最简、写实质感与原生音画同步更强),那么合理的架构是——**Agnes 做默认 provider,智谱做按场景升级的可选 provider**,在 provider 抽象层做路由。下面给出客观可落地的方案。

### 6.1 为什么"默认 Agnes"站得住(客观依据)

- **接入成本最低**:单一网关 `https://apihub.agnes-ai.com/v1`,文/图/视统一 OpenAI schema,只需改 BaseURL/Key/Model;智谱视频需异步轮询(`retrieve_videos_result`)或上 `zai-sdk`。
- **默认零成本**:全模态永久免费,无 waitlist,适合 MCP 这类工具默认跑通、即开即用。
- **默认档质量够用且更"好看"**:写实质感、电影感、原生音画同步在默认场景下体验更讨喜(盲评上榜)。

### 6.2 何时必须升级到智谱(触发条件 → 路由规则)

把以下条件做成 MCP 的路由开关,命中则切到智谱对应模型:

| 触发条件(用户请求或环境) | 升级到 | 原因 |
|---|---|---|
| 请求含精确中文文字渲染(海报/PPT/营销) | **GLM-Image** | 中文 SOTA,Agnes 无中文专项能力 |
| 视频要求 4K 或 60fps 或首尾帧控制 | **CogVideoX-3** | Agnes 无 4K 披露、控制参数弱 |
| 高并发批量/排队任务 | **智谱(并发模型)** | Agnes 为 RPM 硬上限,突发受限 |
| 生产级 SLA / 不能容忍无保障 | **智谱** | Agnes 明示无 SLA、非永久保证 |
| 国内部署 / 合规备案要求 | **智谱** | 国产、模型备案 |
| 免费短视频(≤6s)且要 SLA | **CogVideoX-Flash** | Agnes 无 SLA |

### 6.3 推荐实现形态(MCP provider 抽象)

1. **Provider 接口抽象**:统一 `generate_image / generate_video`,内部实现 `AgnesProvider` 与 `ZhipuProvider` 两个适配器。
2. **默认 provider = Agnes**:`config.default_provider = "agnes"`,所有未命中升级规则的请求走 Agnes。
3. **路由层**:按 6.2 表中的条件判断,命中则 `provider = "zhipu"`,并选定具体模型(GLM-Image / CogVideoX-Flash / CogVideoX-3)。
4. **降级链**:Agnes 调用失败/限流(RPM 触顶)→ 自动 fallback 到智谱(并发模型更扛量);反之,智谱平台过载(错误码 1305)→ fallback 到 Agnes。**双向互为兜底**是最稳的形态。
5. **计费口径提醒**:在接入 Agnes 视频前,务必向官方确认 `$0.30/min` 是"实际时长精确计费"还是"分钟取整起步",这直接决定成本估算(见 4.3)。

### 6.4 一句话选型

> **默认 Agnes(零成本 + 纯兼容 + 质感好),需要中文/4K/高并发/SLA/合规时再升级到智谱。** 二者不应二选一,而应做主备分工、双向兜底。

---

## 七、数据可信度与缺口(诚实标注)

1. **Agnes 基准排名主要来自 PR / 自述**(Instagram / LinkedIn / TechTimes)。Artificial Analysis 已确认 `agnes-video-v2.0` 与 `agnes-image-2.0-flash` **确在榜**,但**未取到精确 Elo 分值**(榜单为动态 JS,需直接访问 artificialanalysis.ai 核实)。智谱 CogVideoX 在 AA 榜为开源知名选手,但低于顶级闭源。
2. **"Agnes 1 req/min"前提存疑,已更正**:官方 GitHub(2026-06-22)记免费层视频为 **20 RPM**(任务提交速率)。"1/min"更可能是**任务完成吞吐的体感**(单任务异步生成 30–60s → 完成速率约 1 片/min),而非 API 限速。本报告统一采用 20 RPM。
3. **"CogView-4"确实存在**(智谱模型概览已列,通用高质量图像生成);中文旗舰实为 **GLM-Image**(中文渲染 SOTA)。二者定位不同,不可混用。
4. **付费定价有时效性**:智谱 ¥0.5/次(视频)、¥0.1/张(图)来自 2024–2025 公开报道,**2026 实时价以 bigmodel.cn/pricing 为准**;Agnes 视频按 min 计费的口径(精确 vs 取整)需向官方确认(见 4.3)。
5. **Agnes 无 SLA 是明确风险**:GitHub 明示"运营限制,非永久保证",生产场景务必有智谱或其它有 SLA 的供应商兜底。

---

## 附:模型速查表

| 厂商 | 图像(免费) | 图像(付费/旗舰) | 视频(免费) | 视频(付费/旗舰) |
|---|---|---|---|---|
| **Agnes** | `agnes-image-2.0` / `2.1-flash`(全模态永久免费) | 订阅 Starter $4 / Plus $10 / Pro $50 | `agnes-video-v2.0`(20 RPM 免费) | 视频 $0.30/min |
| **智谱** | `CogView-3-Flash`(永久免费) | `CogView-4`(通用)/ `GLM-Image`(中文 SOTA) | `CogVideoX-Flash`(≤6s,永久免费,有 SLA) | `CogVideoX-3`(4K / 首尾帧,清影 ¥0.5/次 6s) |
