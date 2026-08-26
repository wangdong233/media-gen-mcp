# Kuaishou 可灵(Kling AI)深度调研报告

> 调研日期:2026-07-13 | 数据来源:可灵 AI 开放平台官方文档 + 第三方交叉核实
> 官方域名:`klingai.com`(中国)/ `kling.ai`(国际)

---

## 一、厂商概览

可灵 AI(Kling AI)是**快手(Kuaishou)**推出的 AI 视频/图像生成平台,2024 年发布,是目前全球头部文生视频模型之一(与 Sora、Runway、Veo 同列第一梯队)。其 **API 开放平台**已全面开放,支持文生视频、图生视频、文生图、图生图、虚拟试穿、数字人、动作控制等能力。

| 项目 | 内容 |
|------|------|
| 开发商 | 快手科技(Kuaishou Technology) |
| 最新视频模型 | **Kling 3.0 Turbo**(2026.06.17 上线) |
| 最新图片模型 | **Kling Image 3.0 & 3.0 Omni** |
| 开源状态 | **闭源**(无公开权重,未在 HuggingFace 发布) |
| API 协议 | **私有 RESTful API**(非 OpenAI 兼容) |
| 调用域名(中国) | `https://api-beijing.klingai.com` |
| 旧域名(已变更) | `https://api.klingai.com` → 已迁移至 api-beijing |

---

## 二、所有相关模型清单

### 2.1 视频模型(文生视频 / 图生视频 / 视频编辑)

| 模型名(API ID) | 版本说明 | 能力 | 状态 |
|---|---|---|---|
| **kling-3.0-turbo** | Kling 3.0 Turbo(2026.06 新) | 文生视频、图生视频,有声,更快更稳 | 最新 |
| **kling-v3** | Kling 3.0 | 文/图生视频,音画同出,智能分镜,主体参考 | 主力 |
| **kling-v3-omni** | Kling 3.0 Omni | 视频编辑,参考视频最长 15s,原生 4K,多镜头 | 主力 |
| **kling-video-o1** | Kling O1 | 文/图生视频(推理增强) | 在售 |
| **kling-v2-6** | Kling 2.6 | 文/图生视频,有声,动作控制 | 在售 |
| **kling-v2-5-turbo** | Kling 2.5 Turbo | 文/图生视频 | 在售 |
| **kling-v2-1** | Kling 2.1 | 文/图生视频 | 在售 |
| **kling-v2-1-master** | Kling 2.1 Master | 高品质 | 在售 |
| **kling-v2** | Kling 2.0 | 文/图生视频 | 在售 |
| **kling-v1-6** | Kling 1.6 | 文/图生视频,多图参考,多模态编辑 | 在售 |
| **kling-v1-5** | Kling 1.5 | 文/图生视频 | 在售 |
| **kling-v1** | Kling 1.0 | 文/图生视频(入门级) | 在售 |

### 2.2 图片模型(文生图 / 图生图)

| 模型名(API ID) | 版本说明 | 能力 | 状态 |
|---|---|---|---|
| **kling-image-v3** | Kling Image 3.0 | 文生图、图生图(1K/2K) | 最新 |
| **kling-image-v3-omni** | Kling Image 3.0 Omni | 文生图、图生图(1K/2K/4K 超清) | 最新 |
| **kling-image-o1** | Kling Image O1 | 文生图、图生图(推理增强) | 在售 |
| **kling-image-v2-1** | Kling Image 2.1 | 文生图、图生图、多图参考 | 在售 |
| **kling-image-v2-new** | Kling Image 2 New | 图生图 | 在售 |
| **kling-image-v2** | Kling Image 2.0 | 文生图、图生图、多图参考 | 在售 |
| **kling-image-v1-5** | Kling Image 1.5 | 文生图、图生图 | 在售 |
| **kling-image-v1** | Kling Image 1.0 | 文生图、图生图(入门级) | 在售 |

### 2.3 其他能力模型

| 能力 | 计费方式 | 说明 |
|---|---|---|
| 数字人 | 按秒 | 数字人视频生成 |
| 语音合成 | 按次 | TTS |
| 对口型(Lip Sync) | 按 5 秒 | 唇形同步 |
| 文生音效 / 视频生音效 | 按次 | 音频生成 |
| 音色定制 | 按次 | 声音克隆 |
| 动作控制 | 按秒 | 动作捕捉复刻 |
| 虚拟试穿 | 按张 | 服装试穿 |
| 智能补全主体图 | 按次 | 图像补全 |
| 扩图 | 按张 | Outpainting |

---

## 三、开源 vs 闭源

**结论:全系列闭源。**

- 可灵所有模型(视频 + 图片)**均未开源**,无公开权重下载
- HuggingFace 上无官方 `Kling` 模型发布
- 仅通过官方 API(或第三方代理网关)接入
- 社区有非官方 API Wrapper(如 GitHub `aself101/kling-api`),但仅为 API 封装,非模型权重

---

## 四、免费额度 + 限速(精确数字)

### 4.1 免费额度

| 渠道 | 免费额度 | 限制 | 是否需信用卡 |
|------|---------|------|-------------|
| **Web 应用 Free Plan** | **66 积分/天**(每 24 小时重置,不滚存) | 720p、5 秒、有水印、不可商用、排队生成 | 否 |
| **API 开放平台** | **无公开的免费额度** | KlingQuota 余额系统,目前**仅支持线下充值**(联系客服) | 需核实 |

> ⚠️ **需核实**:API 端新用户是否有赠送测试额度。官方曾提及"下单页面提供测试额度",但具体积分数未公开标注,需注册后在控制台查看。历史上部分新用户免费积分活动曾被暂停。

### 4.2 限速(限次)— 并发模型,非 RPM

可灵 API 的限流机制是**基于并发任务数**,而非 RPM/QPS:

| 项目 | 说明 |
|------|------|
| 限流维度 | **并发任务数**(同时进行的生成任务数) |
| QPS 限制 | **官方明确声明:不设 QPS 限制** |
| RPM 限制 | **未公布 RPM 上限** |
| 并发上限依据 | 账号等级 + 模型版本 + 资源包 |
| Free/默认 | 实践中很低(约 1-2 并发) |
| **Standard 档** | **20 个并发任务**(首个有意义的并发档位) |
| Pro/Premier/企业 | 更高并发,需谈判/充值 |
| 超限错误 | HTTP **429**("Trigger strategy, Concurrency or QPS exceeds the prepaid...") |

> 注意:**只有任务创建端点**计入并发,查询/状态端点不受限。

---

## 五、付费价格(精确,官方定价)

> **重要:可灵的积分体系按功能类型不同,积分单价不同!**
> - 视频资源包:**1 积分 = ¥1**
> - 图片资源包:**1 积分 = ¥0.025**(kling-image-v1 基准)
> - 虚拟试穿资源包:**1 积分 = ¥0.5**
>
> 汇率参考:¥1 ≈ $0.14(1 USD ≈ 7.2 CNY)

### 5.1 视频生成定价(按秒计费)

| 模型 | 功能 | 720P | 1080P | 4K |
|---|---|---|---|---|
| **kling-3.0-turbo** | 有声 | ¥0.8/秒 ($0.11) | ¥1.0/秒 ($0.14) | - |
| **kling-v3** | 无声 | ¥0.6/秒 ($0.08) | ¥0.8/秒 ($0.11) | ¥3.0/秒 ($0.42) |
| kling-v3 | 有声(未指定音色) | ¥0.9/秒 | ¥1.2/秒 | ¥3.0/秒 |
| kling-v3 | 动作控制 | ¥0.9/秒 | ¥1.2/秒 | - |
| **kling-v3-omni** | 无参考视频×无声 | ¥0.6/秒 | ¥0.8/秒 | ¥3.0/秒 |
| kling-v3-omni | 无参考视频×有声 | ¥0.8/秒 | ¥1.0/秒 | ¥3.0/秒 |
| kling-v3-omni | 有参考视频×无声 | ¥0.9/秒 | ¥1.2/秒 | ¥3.0/秒 |
| **kling-video-o1** | 无参考视频 | ¥0.6/秒 | ¥0.8/秒 | - |
| kling-video-o1 | 有参考视频 | ¥0.9/秒 | ¥1.2/秒 | - |
| **kling-v2-6** | 无声 | ¥0.3/秒 ($0.04) | ¥0.5/秒 ($0.07) | - |
| kling-v2-6 | 有声(未指定音色) | - | ¥1.0/秒 | - |
| kling-v2-6 | 有声(指定音色) | - | ¥1.2/秒 | - |
| kling-v2-6 | 动作控制 | ¥0.5/秒 | ¥0.8/秒 | - |
| **kling-v2-5-turbo** | 无声 | ¥0.3/秒 | ¥0.5/秒 | - |
| **kling-v2-1** | 无声 | ¥0.4/秒 | ¥0.7/秒 | - |
| **kling-v2-1-master** | 无声 | - | ¥2.0/秒 | - |
| **kling-v2** | 无声 | - | ¥2.0/秒 | - |
| **kling-v1-6** | 无声 | ¥0.4/秒 | ¥0.7/秒 | - |
| kling-v1-6 | 多图参考生视频 | ¥0.4/秒 | ¥0.7/秒 | - |
| kling-v1-6 | 多模态视频编辑 | ¥0.6/秒 | ¥1.0/秒 | - |
| **kling-v1-5** | 无声 | ¥0.4/秒 | ¥0.7/秒 | - |
| **kling-v1** | 无声 | **¥0.2/秒** ($0.028,最低价) | ¥0.7/秒 | - |

**视频延长(按次):** ¥2.0/次(720P)、¥3.5/次(1080P)

### 5.2 图片生成定价(按张计费)

| 模型 | 功能 | 画质 | 价格 |
|---|---|---|---|
| **kling-image-v3** | 文生图、图生图 | 1K、2K | **¥0.2/张** ($0.028,8 积分) |
| **kling-image-v3-omni** | 文生图、图生图 | 1K、2K | ¥0.2/张 (8 积分) |
| kling-image-v3-omni | 文生图、图生图 | **4K** | **¥0.4/张** ($0.056,16 积分) |
| **kling-image-o1** | 文生图、图生图 | 1K、2K | ¥0.2/张 (8 积分) |
| **kling-image-v2-1** | 文生图 | 1K、2K | ¥0.1/张 (4 积分) |
| kling-image-v2-1 | 图生图 | 1K、2K | ¥0.2/张 (8 积分) |
| kling-image-v2-1 | 多图参考生图 | 1K、2K | ¥0.4/张 (16 积分) |
| **kling-image-v2-new** | 图生图 | 1K | ¥0.2/张 (8 积分) |
| **kling-image-v2** | 文生图 | 1K、2K | ¥0.1/张 (4 积分) |
| kling-image-v2 | 图生图 | 1K | ¥0.2/张 (8 积分) |
| kling-image-v2 | 多图参考生图 | 1K | ¥0.4/张 (16 积分) |
| **kling-image-v1-5** | 文生图 | 1K | ¥0.1/张 (4 积分) |
| kling-image-v1-5 | 图生图 | 1K | ¥0.2/张 (8 积分) |
| **kling-image-v1** | 文生图、图生图 | 1K | **¥0.025/张** ($0.0035,最低价,1 积分) |
| 通用 | 智能补全主体图 | 1K | ¥0.5/次 (20 积分) |
| 通用 | 扩图 | 1K | ¥0.2/张 (8 积分) |
| 通用 | 虚拟试穿 | - | ¥0.5/张 (1 积分,试穿资源包单价 ¥0.5/积分) |

### 5.3 其他能力定价

| 能力 | 计费 | 价格 |
|---|---|---|
| 数字人 | 按秒 | ¥0.4/秒(720P)、¥0.8/秒(1080P) |
| 语音合成 | 按次 | ¥0.05/次 |
| 对口型 | 每 5 秒 | ¥0.5/5 秒 |
| 人脸识别 | 按次 | ¥0.05/次 |
| 文生音效 | 按次 | ¥0.25/次 |
| 视频生音效 | 按次 | ¥0.25/次 |
| 音色定制 | 按次 | ¥0.05/次 |
| 图像识别 | 按次 | ¥0.1/次 |

### 5.4 C 端订阅套餐(国际版 Web,参考)

| 套餐 | 月费 | 积分/月 | 备注 |
|------|------|---------|------|
| Free | $0 | 66 积分/天 | 有水印,720p,5 秒 |
| Standard | ~$10/月 | 660 积分 | 无水印,1080p,10 秒 |
| Pro | ~$37/月 | 3,000 积分 | 专业品质,批量 |
| Premier | ~$92/月 | 8,000 积分 | 更高并发 |
| Ultra | ~$180/月 | 更高 | 最高优先级 |

> 注意:Reddit 用户吐槽官方 API 档位在 $8 到 $4,200 之间跨度极大,中小批量用户难选。

---

## 六、协议与接入

### 6.1 协议类型:**私有 RESTful API(非 OpenAI 兼容)**

可灵 API **不提供** OpenAI 兼容的 `/v1/images/generations` 或 `/v1/videos/generations` 端点。它使用自定义端点结构。

| 项目 | 内容 |
|------|------|
| 协议 | 私有 RESTful(自定义端点) |
| OpenAI 兼容 | **否** |
| 调用域名(中国) | `https://api-beijing.klingai.com` |
| 旧域名 | `https://api.klingai.com`(已迁移) |
| 国际域名 | `kling.ai/dev/`(国际版门户) |

### 6.2 认证方式(双轨制)

**方式一:API Key(推荐,适用于所有模型,含新模型)**
```
Authorization: Bearer <API_KEY>
```
- 在控制台「+ 新建 API Key」生成
- 直接作为 Bearer token 使用,最简单

**方式二:Access Key / Secret Key + JWT(仅适用于 3.0 及更早模型)**
```python
# JWT 生成(HS256)
import jwt, time
payload = {"iss": ak, "exp": int(time.time())+1800, "nbf": int(time.time())-5}
token = jwt.encode(payload, sk, headers={"alg":"HS256","typ":"JWT"})
# Authorization: Bearer <JWT_TOKEN>
```
- ⚠️ 官方提示:**AK/SK 不再支持新模型**,建议尽快切换至 API Key

### 6.3 主要 API 端点(参考结构)

| 功能 | 端点路径(示例) |
|------|----------------|
| 视频生成 | `/document-api/api/video/...`(具体路径见官方文档各模型页) |
| 图片生成 | `/document-api/api/image/3-0-omni` 等 |
| 账号信息查询 | 资产管理 API |
| 抵扣明细查询 | 资源包/额度抵扣明细 API |

> 端点为异步模式:创建任务 → 轮询查询任务状态 → 获取结果。仅任务创建计入并发限制。

---

## 七、能力规格

### 7.1 视频能力

| 规格 | 详情 |
|------|------|
| 单次生成时长 | 3-15 秒(Kling 3.0 原生);API 可扩展至最长 60 秒 |
| 链式延长上限 | 最长 **3 分钟** |
| 分辨率 | 720P / 1080P / 4K(4K 需 v3/v3-omni) |
| 画幅比例 | 8 种(1:1, 16:9, 9:16, 4:3 等) |
| 原生音频 | 支持(3.0 系列音画同出) |
| 多镜头分镜 | 支持(单片段最多 6 镜头) |
| 参考视频(Omni) | 最长 15 秒 |
| 主体参考 | 支持(一致性更强) |

### 7.2 图片能力

| 规格 | 详情 |
|------|------|
| 分辨率 | 1K / 2K / 4K(4K 仅 v3-omni) |
| 能力 | 文生图、图生图、多图参考、扩图、智能补全 |
| 特色 | 影视级叙事,组图生成与批量优化,2K/4K 超清直出 |

---

## 八、适合 media-gen-mcp 评估

| 评估项 | 结论 |
|--------|------|
| **协议兼容性** | **custom**(私有 API,非 OpenAI 兼容,需写专属 provider) |
| 接入难度 | 中等(异步任务模式 + API Key Bearer 认证较简单;JWT 旧方式较复杂) |
| 免费可用性 | **差**(API 无公开免费额度,需线下充值;Web Free 仅 66 积分/天且有水印) |
| 价格水平 | 视频:¥0.2-3.0/秒($0.028-0.42/秒);图片:¥0.025-0.4/张($0.0035-0.056/张),**图片极具性价比** |
| 并发 | Standard 档 20 并发,需付费 |

### MCP 接入建议

**fit = custom**(必须写私有 provider):
1. **认证**:实现 API Key Bearer 认证(新方式,推荐)或 JWT 生成(AK/SK,仅旧模型)
2. **端点**:对接 `https://api-beijing.klingai.com` 的异步任务接口(创建→轮询→取结果)
3. **积分体系**:注意视频积分(¥1/积分)与图片积分(¥0.025/积分)单价不同,需分开计费
4. **限流**:实现并发控制(非 RPM),监控 HTTP 429
5. **备选**:若需 OpenAI 兼容格式,可通过第三方网关(Crazyrouter、EvoLink、PiAPI、Novita 等)接入,但会加价

---

## 九、信息来源

- [可灵 AI 官方 API 定价 - 视频](https://klingai.com/document-api/pricing/base/video)
- [可灵 AI 官方 API 定价 - 图片](https://www.klingai.com/document-api/pricing/base/image)
- [可灵 AI 接口鉴权文档](https://klingai.com/document-api/api/get-started/authentication)
- [可灵 AI 并发规则](https://kling.ai/document-api/apiReference/rateLimits)
- [可灵 AI API 更新公告](https://klingai.com/document-api/updates/api)
- [可灵 AI 国际版 API 定价](https://kling.ai/dev/pricing)
- [Crazyrouter - Kling AI Pricing 2026](https://crazyrouter.com/en/blog/kling-ai-pricing-complete-guide-2026)
- [Atlas Cloud - Kling Video Length Limit](https://www.atlascloud.ai/blog/guides/kling-ai-video-length-limit)
- [FelloAI - Kling Pricing](https://felloai.com/kling-ai-pricing/)
- [Evolink - Kling 3.0 API 指南](https://evolink.ai/zh/blog/kling-3-o3-api-official-discount-pricing-developers)

---

## 十、待核实事项

| 项目 | 说明 |
|------|------|
| API 新用户免费额度 | 官方未公开具体积分数,需注册控制台后核实 |
| 国际版 API 域名 | 中国版为 `api-beijing.klingai.com`,国际版端点需在 kling.ai/dev 确认 |
| kling-image-v3 各分辨率是否同价 | 官方表显示 1K/2K 同为 8 积分,4K 为 16 积分,需核实 2K 是否确为 8 积分 |
| 企业级并发上限 | Pro/Premier/企业档的具体并发数未公开,需联系销售 |
| 信用卡要求 | 中国版通过资源包/余额充值,国际版订阅可能需信用卡,需核实 |