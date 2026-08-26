# OpenAI 文生图 / 文生视频模型深度调研(2026 年 7 月)

> 调研日期:2026-07-13。所有价格、限额、限速均来自 OpenAI 官方文档(developers.openai.com / openai.com/api/pricing),已交叉核实。社区/第三方数字会标注"约"。
>
> **一句话结论**:OpenAI 当前所有文生图/文生视频模型**均无 API 免费层**(Free tier 不支持,需充值到 Tier 1 才能用),采用**按 token(图)/按秒(视频)计费**。文生图生态稳定且 OpenAI 协议兼容(`easy`);文生视频 Sora 2 **整个 Videos API 将于 2026-09-24 关停、且无替代模型公布**,属于"临期高危",不建议长线接入。

---

## 一、模型总览(按生命周期分层)

### 当前可用的文生图模型

| 模型 | 状态 | 发布 | 计费方式 | OpenAI 兼容 |
|---|---|---|---|---|
| **gpt-image-2** | ✅ 旗舰 | 2026-04-21 | 按 token | ✅ `/v1/images/generations` |
| **gpt-image-1.5** | ⚠️ 已宣布弃用,2026-12-01 关停 | — | 按 token | ✅ |
| **gpt-image-1-mini** | ⚠️ 已宣布弃用,2026-12-01 关停(最便宜) | — | 按 token | ✅ |
| **gpt-image-1** | ⚠️ 已宣布弃用,2026-10-23 关停 | 2025-04 | 按 token | ✅ |
| **DALL·E 3** | ❌ **已于 2026-05-12 关停** | 2023-10 | 按张 | (历史) |
| **DALL·E 2** | ❌ **已于 2026-05-12 关停** | 2022 | 按张 | (历史) |

### 文生视频模型(全部临期)

| 模型 | 状态 | 关停日期 | 计费 |
|---|---|---|---|
| **sora-2** | ⚠️ 已弃用 | **2026-09-24** | 按秒 |
| **sora-2-pro** | ⚠️ 已弃用 | **2026-09-24** | 按秒 |
| **Videos API 整体** | ⚠️ 已弃用 | **2026-09-24** | — |

> OpenAI 在 2026-03-24 通知:Sora 2 全系模型(sora-2、sora-2-pro 及其所有快照)和整个 Videos API 将于 **2026 年 9 月 24 日**关停,**目前没有公布任何替代视频模型**。这是接入前必须权衡的最大风险。

---

## 二、开源 vs 闭源

**全部闭源。** OpenAI 的文生图(gpt-image 系列)与文生视频(Sora 2)模型均不提供权重下载,无任何开源版本。仅能通过官方 API、Azure OpenAI、或 Amazon Bedrock 调用。

---

## 三、免费额度与限速(最高优先级,精确核实)

### 3.1 API 层:**没有免费层**

这是核实最关键的一点:

- **所有 gpt-image 系列模型**在官方 rate-limits 页明确标注:**"Free: Not supported"(免费层不支持)**。
- `gpt-image-1` 及之后的图像模型**只对 Tier 1 及以上开发者开放**;要从 Free 升到 Tier 1,**必须添加付款方式并累计付费 $5**。
- 2025 年中之后注册的新账号**不再自动获得试用额度**(老的 $5 / $18 trial credit 已取消);部分区域有促销 credit,但不能依赖。
- 因此:**无免费图数、无免费 token、无需信用卡但需绑卡充值 $5 才能用**。

### 3.2 使用层级(Usage Tier)与每月消费上限

| Tier | 达成条件 | 每月消费上限 |
|---|---|---|
| Free | 仅地理可用即可 | $100/月(但图像/视频模型在此层被禁用) |
| Tier 1 | 累计付费 $5 | $100/月 |
| Tier 2 | 累计付费 $50 | $500/月 |
| Tier 3 | 累计付费 $100 | $1,000/月 |
| Tier 4 | 更高 | 进一步提升 |
| Tier 5 | 更高 | 最高 |

### 3.3 gpt-image-2 的精确限速(TPM = tokens/分钟,IPM = images/分钟)

| Tier | TPM | IPM(每分钟图数) |
|---|---|---|
| Free | **不支持** | — |
| Tier 1 | 100,000 | **5** |
| Tier 2 | 250,000 | **20** |
| Tier 3 | 800,000 | **50** |
| Tier 4 | 3,000,000 | **150** |
| Tier 5 | 8,000,000 | **250** |

> 换算:Tier 1 限速约"每 12 秒 1 张图"的持续速率。社区反映 gpt-image 系列**响应较慢(单张常需数十秒到数分钟)**,实际吞吐受限速和渲染双重制约。

### 3.4 Sora 视频 API 的限速

官方定价/限速页**未单独公布 Sora 的 RPM/并发数**;视频生成本身是异步任务(`POST /v1/videos` 返回 job id,轮询 `GET /v1/videos/{id}`),并发受账号 tier 与"在途任务数"约束。**精确并发/RPM 数字官方未公开,需核实**(社区有报告高负载时排队明显)。

### 3.5 非 API(消费端 ChatGPT / Sora App)免费额度

这部分不涉及 API,但供参考(限额随时间反复收紧,**以下为 2026 年中前后社区报告,非官方承诺**):

- **ChatGPT Free**:文生图约 **3 张/天**;Sora 视频在 2026-01 前后对免费用户**关闭/极受限**(有报告仅 6 prompts/天,且仅图像变体)。
- **ChatGPT Plus($20/月)**:Sora 图像/视频访问;视频曾为 ~30 条/天。
- **ChatGPT Pro($200/月)**:更高额度,视频 ~100 条/天。

> 消费端限额变动频繁,以上数字**需核实**,不可作为生产依据。

---

## 四、付费价格(精确,来自官方定价页)

### 4.1 文生图:按 token 计费(USD / 1M tokens)

**Standard(标准)**

| 模型 | 模态 | 输入 | 缓存输入 | 输出 |
|---|---|---|---|---|
| **gpt-image-2** | Image | $8.00 | $2.00 | **$30.00** |
| | Text | $5.00 | $1.25 | — |
| **gpt-image-1.5** | Image | $8.00 | $2.00 | **$32.00** |
| | Text | $5.00 | $1.25 | $10.00 |
| **gpt-image-1-mini** | Image | $2.50 | $0.25 | **$8.00** |
| | Text | $2.00 | $0.20 | — |

**Batch(批处理,约 5 折,适合离线)**

| 模型 | 模态 | 输入 | 缓存输入 | 输出 |
|---|---|---|---|---|
| gpt-image-2 | Image | $4.00 | $1.00 | $15.00 |
| gpt-image-1.5 | Image | $4.00 | $1.00 | $16.00 |
| gpt-image-1-mini | Image | $1.25 | $0.13 | $4.00 |

**折算每张图(社区/第三方估算,官方仅给 token 价):**

| 模型 | 1024×1024 低质量约 | 1024×1024 高质量约 | 2K 约 | 4K 约 |
|---|---|---|---|---|
| gpt-image-2 | ~$0.03 | ~$0.11–0.17 | ~$0.05 | ~$0.06+ |
| gpt-image-1-mini | ~$0.005(约半分) | ~$0.036 | — | — |

> 每张实际成本 = 输出图像 token 数 × $30/1M(以 gpt-image-2 为例),与分辨率/复杂度强相关。官方提供了"image generation calculator"在线估算器,生产前**建议用官方计算器核实**。

### 4.2 文生视频:按秒计费(USD / 秒)

**Standard(标准)**

| 模型 | 分辨率 | 竖屏 | 横屏 | 每秒价格 | 10 秒视频约 |
|---|---|---|---|---|---|
| **sora-2** | 720p | 720×1280 | 1280×720 | **$0.10** | ~$1.00 |
| **sora-2-pro** | 720p | 720×1280 | 1280×720 | **$0.30** | ~$3.00 |
| sora-2-pro | 1024p | 1024×1792 | 1792×1024 | **$0.50** | ~$5.00 |
| sora-2-pro | 1080p | 1080×1920 | 1920×1080 | **$0.70** | ~$7.00 |

**Batch(批处理,5 折)**

| 模型 | 分辨率 | 每秒价格 |
|---|---|---|
| sora-2 | 720p | $0.05 |
| sora-2-pro | 720p | $0.15 |
| sora-2-pro | 1024p | $0.25 |
| sora-2-pro | 1080p | $0.35 |

> 时长支持 4 / 8 / 12 / 16 / 20 秒;sora-2 仅 720p,sora-2-pro 可达 1080p。视频可"扩展"(extensions),单段最多 +20 秒,单条最多扩 6 次达 120 秒。注意:**API 生成即计费,质量不佳也照收**。

### 4.3 历史价格(已关停模型,仅供对比)

- **DALL·E 3**(已关停):1024² Standard $0.04/张;1024×1536 HD $0.08/张。
- **gpt-image-1**(legacy,将关停):输入 $10/1M、输出 $40/1M(早期价)。

---

## 五、协议与端点(对 MCP 接入最关键)

### 5.1 文生图 —— OpenAI 兼容,属 `easy`

- **生成**:`POST https://api.openai.com/v1/images/generations`
- **编辑/图生图**:`POST https://api.openai.com/v1/images/edits`
- 也可经 `POST /v1/responses`(Responses API)调用
- 鉴权:`Authorization: Bearer $OPENAI_API_KEY`
- **结论**:标准 OpenAI 图像协议,绝大多数 OpenAI SDK / 兼容客户端开箱即用,**media-gen-mcp 归类 `easy`**。

### 5.2 文生视频 —— 私有异步 REST,属 `custom`

Videos API **不是** OpenAI 图像接口,而是一套**异步任务式私有 REST**,需专门编写 provider:

| 操作 | 方法 + 端点 |
|---|---|
| 创建渲染任务 | `POST /v1/videos`(返回 job id + status) |
| 查询状态 | `GET /v1/videos/{video_id}`(轮询,建议 10–20s 间隔) |
| 下载 MP4 | `GET /v1/videos/{video_id}/content`(下载链接 1 小时有效) |
| 下载缩略图/精灵图 | `GET /v1/videos/{video_id}/content?variant=thumbnail\|spritesheet` |
| 图生视频(首帧参考) | `POST /v1/videos` 带 `input_reference`(multipart 或 JSON 的 file_id/image_url) |
| 上传可复用角色 | `POST /v1/videos/characters` |
| 视频扩展续拍 | `POST /v1/videos/extensions` |
| 视频编辑 | `POST /v1/videos/edits` |
| 列出/删除 | `GET /v1/videos`、`DELETE /v1/videos/{video_id}` |

- 支持 webhook(`video.completed` / `video.failed` 事件)替代轮询。
- Batch API 支持 `/v1/videos`(仅 JSON,需预先上传资源)。
- **结论**:必须为 media-gen-mcp **自定义 provider**(`custom`),实现"提交→轮询/回调→下载"的异步流;且**整个 API 2026-09-24 下线**,投入产出比低。

---

## 六、能力规格

### 文生图(gpt-image-2)
- 原生 **2K 分辨率**(支持任意 2K/4K 输出尺寸)
- 宽高比 **3:1 超宽 ~ 1:3 超高**
- 单次可生成最多 **8 张**一致图像
- 最多 **16 张**参考图输入(高保真 image-to-image)
- 强项:**文字渲染、多语言文字(50+ 语言)、推理式构图**
- 模态:文本+图像输入 → 图像输出

### 文生视频(Sora 2)
- 文生视频 / 图生视频(首帧)/ 角色复用 / 续拍扩展 / 编辑
- 分辨率:sora-2 仅 720p;sora-2-pro 支持 720p/1024p/1080p
- 时长:4/8/12/16/20 秒;扩展后最长 120 秒
- 带同步音频
- 内容护栏:仅限 18 岁以下适宜内容;禁止版权角色/音乐;禁止真人(含公众人物);含人脸的输入图默认被拒

---

## 七、media-gen-mcp 适配建议

| 模型 | 适配难度 | 理由 |
|---|---|---|
| **gpt-image-2** | **easy** | 标准 OpenAI `/v1/images/generations`,SDK 直连,推荐作为图像主力 |
| gpt-image-1-mini | easy(但 2026-12 关停) | 最便宜,过渡用 |
| **sora-2 / sora-2-pro** | **custom** + **高风险** | 私有异步 REST 需自写 provider;且 2026-09-24 整体下线、无继任者,不建议长线 |
| DALL·E 3 | no-api(已死) | 2026-05 已关停,勿接入 |

**关键提醒**:OpenAI 文生图是"无免费、需绑卡、Tier1 起 $5"的纯付费体系,与某些提供免费额度的厂商不同;若 media-gen-mcp 需要免费可用层,OpenAI 不满足,应作为"付费高质量"provider 定位。

---

## 八、待核实 / 不确定项(诚实标注)

1. **Sora API 的精确 RPM / 并发上限**:官方未在 rate-limits 页公开,需核实。
2. **gpt-image-2 每张精确成本**:官方只给 token 价,实际每张取决于 token 数,生产前用官方 image calculator 核实;社区"每张 $0.03–$0.17"为估算。
3. **ChatGPT/Sora App 消费端免费额度**:随时间反复收紧,官方无固定承诺数字,文中数字需核实。
4. **Sora 关停后的继任模型**:截至 2026-07 官方未公布替代视频模型,后续动向需持续关注。

---

## 参考来源(官方为主)

- OpenAI API 定价页:https://developers.openai.com/api/docs/pricing
- gpt-image-2 模型页(含限速表):https://developers.openai.com/api/docs/models/gpt-image-2
- 视频生成指南(端点/参数):https://developers.openai.com/api/docs/guides/video-generation
- 弃用清单(关停时间表):https://developers.openai.com/api/docs/deprecations
- Rate limits(层级):https://developers.openai.com/api/docs/guides/rate-limits
- Sora 2 定价计算器:https://costgoat.com/pricing/sora