# MiniMax 海螺 (Hailuo) 文生图 / 文生视频 模型深度调研

> 调研时间:2026-07 | 数据来源:MiniMax 官方 API 文档 platform.minimax.io(权威)+ 第三方交叉验证
> 所有价格/限额均来自官方页面,未查清的已标注「需核实」

---

## 一、厂商概览

| 项目 | 内容 |
|---|---|
| 厂商 | MiniMax(稀宇科技,中国) |
| 产品品牌 | Hailuo 海螺(消费端 hailuoai.video)/ MiniMax 开放平台(API 端 platform.minimax.io) |
| API 基地址 | `https://api.minimax.io/v1/` |
| 文档门户 | https://platform.minimax.io/docs |
| 开源情况 | **视频/图像模型全部闭源**(仅文本模型 MiniMax-M2 系列开源;Hailuo 视频/image-01 不提供权重下载) |
| API 鉴权 | Bearer Token(标准 API Key,`Authorization: Bearer $MINIMAX_API_KEY`) |
| 协议性质 | **私有协议**(非 OpenAI `/v1/images/generations` 兼容;但可经第三方 AIMLAPI/OpenRouter 转 OpenAI 兼容) |

---

## 二、相关模型清单(文生图/图生图 + 文生视频/图生视频)

### 图像模型

| 模型 | 能力 | 说明 |
|---|---|---|
| **image-01** | 文生图 (T2I) + 图生图 (I2I,含 subject_reference 主体参考) | 唯一图像模型;支持任意画布尺寸/宽高比 |

### 视频模型

| 模型 | 系列 | 能力 | 状态 |
|---|---|---|---|
| **MiniMax-Hailuo-2.3** | 2.3(最新旗舰) | 文生视频 / 图生视频(首帧) | 当前主力 |
| **MiniMax-Hailuo-2.3-Fast** | 2.3(快速版) | 文生视频 / 图生视频 | 性价比优先 |
| **MiniMax-Hailuo-02** | 02(前代) | 文生视频 / 图生视频 / 首尾帧视频 | Legacy(仍可用,支持 512p 低价档) |
| **S2V-01** | 专项 | 主体参考视频(人脸照片→视频,保持面部一致) | 专用 |
| **I2V-01-Director** | 专项(前代) | 图生视频 + 镜头控制 | Legacy |

**视频能力总览:**
- 分辨率:512p / 768p / 1080p(原生 1080p,Hailuo-02 起)
- 时长:6 秒 或 10 秒
- 4 种生成模式:① 文生视频 ② 图生视频(首帧)③ 首尾帧视频(first_frame + last_frame)④ 主体参考视频(S2V-01,人脸)
- 镜头控制:prompt 中用 `[pan]`/`[zoom]`/`[static]` 等指令控制运镜

---

## 三、免费额度与限速(最高优先级,精确标注)

### 1. API 端(开放平台)— 免费额度

| 模型类型 | 官方免费额度 |
|---|---|
| 图像 image-01 | **无官方免费额度**(需充值账户余额按量扣费) |
| 视频 Hailuo 系列 | **无官方免费额度**(需充值余额或购买视频资源包) |
| 音乐 Music-2.6 | 标注「Limited Free」(有限免费,具体额度需核实) |

> **重要**:官方 platform.minimax.io 对视频/图像 API **未公开新用户赠送免费 credit 的政策**(2026-07 查证)。「新账户送 credit」相关结果均来自第三方(NVIDIA Build、AIMLAPI、OpenRouter),非官方政策。**标注:官方免费额度需核实。**

### 2. API 端(开放平台)— 限速 (RPM)

来源:官方限速文档 https://platform.minimax.io/docs/guides/rate-limits

| API | 模型 | RPM(按量付费 Pay-as-you-go) |
|---|---|---|
| 图像生成 | image-01 | **10 RPM** |
| 视频生成 | Hailuo-2.3 / 2.3-Fast / 02 全系列 | **5 RPM** |

> 注:视频为异步任务,5 RPM 指「每分钟最多提交 5 个生成请求」(轮询查询不计入)。并发数官方未单列(需核实)。

### 3. 视频资源包(订阅制)— 限速随套餐提升

| 套餐 | 价格(USD/月) | video points | RPM |
|---|---|---|---|
| Standard(省 5%) | $1,000 | 3,760 | 20 |
| Pro(省 10%) | $2,500 | 9,920 | 30 |
| Scale(省 15%) | $4,500 | 18,900 | 40 |
| Business(省 20%) | $6,000 | 26,780 | 50 |
| Custom(定制) | 议价 | 按需 | **无限 RPM/TPM** |

> 资源包有效期 1 个月,过期清零不继承。需联系 api@minimax.io 提升限速。

### 4. 消费端(海螺 Web/App)— 免费与订阅

来源:AtlasCloud 第三方指南(非官方,需以 hailuoai.video 实时为准)

| 套餐 | 价格 | credits |
|---|---|---|
| Free Trial | $0(一次性) | 200 credits |
| Standard | $7.99/月 | 1,000 credits |
| Pro | $27.99/月 | 约 4,500 credits |
| Master | $63.99/月 | 约 10,500 credits |

> 历史上新用户曾送 1,000 credits + 每日登录 100 credits,现已缩减为 200(第三方说法,**需核实**)。此为 Web 端额度,非 API。

---

## 四、付费价格(精确,来自官方按量付费页)

来源:https://platform.minimax.io/docs/guides/pricing-paygo

### 图像(image-01)

| 模型 | 价格 |
|---|---|
| **image-01** | **$0.0035 / 张** |

> 换算:约 **$3.5 / 千张**。第三方(pricepertoken 等)曾报 $0.03/张,与官方 $0.0035 差异大,以官方 $0.0035 为准。

### 视频(按量付费,每条视频一口价)

| 模型 | 规格 | 价格(USD/条) |
|---|---|---|
| MiniMax-Hailuo-2.3-Fast | 768P, 6s | **$0.19** |
| MiniMax-Hailuo-2.3-Fast | 768P, 10s | **$0.32** |
| MiniMax-Hailuo-2.3-Fast | 1080P, 6s | **$0.33** |
| MiniMax-Hailuo-2.3 | 768P, 6s | **$0.28** |
| MiniMax-Hailuo-2.3 | 768P, 10s | **$0.56** |
| MiniMax-Hailuo-2.3 | 1080P, 6s | **$0.49** |
| MiniMax-Hailuo-02(legacy) | 768P, 6s | $0.28 |
| MiniMax-Hailuo-02(legacy) | 768P, 10s | $0.56 |
| MiniMax-Hailuo-02(legacy) | 1080P, 6s | $0.49 |
| MiniMax-Hailuo-02(legacy) | 512P, 6s | **$0.10** |
| MiniMax-Hailuo-02(legacy) | 512P, 10s | **$0.15** |

**每秒单价换算(参考):**
- 最便宜:Hailuo-02 512p 6s = $0.10 → **约 $0.0167/秒**
- 性价比最优:Hailuo-2.3-Fast 768p 6s = $0.19 → **约 $0.0317/秒**
- 高画质:Hailuo-2.3 1080p 6s = $0.49 → **约 $0.0817/秒**

### 视频(资源包 points 折算)

每条视频消耗的 video points(用于订阅套餐内扣减):

| 模型 | 规格 | 消耗 points |
|---|---|---|
| Hailuo-2.3-Fast | 768p 6s | 0.7 |
| Hailuo-2.3-Fast | 768p 10s | 1.1 |
| Hailuo-2.3-Fast | 1080p 6s | 1.3 |
| Hailuo-2.3 / 02 | 768p 6s | 1.0 |
| Hailuo-2.3 / 02 | 768p 10s | 2.0 |
| Hailuo-2.3 / 02 | 1080p 6s | 2.0 |
| Hailuo-02 | 512p 6s | 0.3 |
| Hailuo-02 | 512p 10s | 0.5 |

> 生成失败或触发安全审核不扣费。

---

## 五、协议与端点(关键,影响 MCP 集成难度)

### 协议性质:**私有协议(非 OpenAI 兼容)**

MiniMax 自有 REST API,字段命名、端点路径、返回结构均与 OpenAI `/v1/images/generations`、`/v1/videos` 不同。需自定义 provider。

### 端点 URL 与调用流程

**图像(同步,直接返回 base64):**
```
POST https://api.minimax.io/v1/image_generation
Headers: Authorization: Bearer $MINIMAX_API_KEY
Body: { "model": "image-01", "prompt": "...", "aspect_ratio": "16:9",
        "subject_reference": [{"type":"character","image_file":"URL"}],  # 可选,图生图
        "response_format": "base64" }
返回: response.json()["data"]["image_base64"]  # list[str]
```
- 同步返回,无需轮询;支持宽高比 `aspect_ratio`;支持 `subject_reference` 主体参考(图生图)。

**视频(异步,需轮询):三步流程**
```
# 1. 创建任务
POST https://api.minimax.io/v1/video_generation
Body: { "model": "MiniMax-Hailuo-2.3", "prompt": "...",
        "first_frame_image": "URL",  # 图生视频可选
        "duration": 6, "resolution": "1080P" }
返回: { "task_id": "..." }

# 2. 轮询状态(建议每 10 秒)
GET  https://api.minimax.io/v1/query/video_generation?task_id=...
返回: status=Success 时含 file_id

# 3. 取下载链接
GET  https://api.minimax.io/v1/files/retrieve?file_id=...
返回: file.download_url
```

**第三方 OpenAI 兼容入口(可选,简化集成):**
- AIMLAPI:`api.aimlapi.com/v1`,模型名 `minimax/hailuo-02`
- OpenRouter:`openrouter.ai`,模型 `minimax/hailuo-2.3`(含 `:free` 限量免费层)

---

## 六、能力规格汇总

| 维度 | image-01 | Hailuo 视频 |
|---|---|---|
| 输入 | 文本 prompt(+ 可选参考图) | 文本 / 首帧图 / 首尾帧图 / 人脸图 |
| 输出分辨率 | 任意画布尺寸,宽高比可调 | 512p / 768p / 原生 1080p |
| 时长 | — | 6s 或 10s |
| 特色 | 主体参考(角色一致性)、电影级光影、写实人像 | 运镜指令、首尾帧控制、主体参考(S2V-01 保持面部)、强物理/指令遵循 |
| 生成速度 | 秒级同步 | 异步,1080p 约 30–90 秒/条 |

---

## 七、适合 media-gen-mcp 的接入评级

| 模型 | 评级 | 理由 |
|---|---|---|
| **image-01** | **custom** | 私有端点 `/v1/image_generation`,字段名与 OpenAI 不同(aspect_ratio / subject_reference / 返回 image_base64);但**同步返回**,封装较简单,写一个自定义 provider 即可 |
| **Hailuo-2.3 / 2.3-Fast / 02** | **custom** | 私有端点 + **异步三步流程**(创建→轮询→取文件),必须实现轮询与文件下载逻辑,封装成本高于图像;不能直接用 OpenAI SDK |
| **S2V-01** | **custom** | 同视频,主体参考专用于人脸→视频 |

**结论:全部为 `custom`(私有协议)。** 若想快速试水,可经 **OpenRouter / AIMLAPI** 转 OpenAI 兼容(评级升至 easy),但需承担第三方加价与稳定性风险。官方 API 无免费额度,生产用需充值。

---

## 八、需核实项汇总(明确标注,绝不编造)

1. **官方新账户免费 credit**:platform.minimax.io 是否对新用户赠送视频/图像 credit — 未在官方页查到明确政策,**需核实**(第三方提及的免费均为 NVIDIA Build / OpenRouter / AIMLAPI,非官方)。
2. **视频并发数**:官方只给 RPM(5),未单列并发任务数上限 — **需核实**。
3. **海螺 Web 端免费额度**:200 credits 为第三方(AtlasCloud)数据,官方 hailuoai.video 实时额度**需核实**。
4. **Music-2.6「Limited Free」具体额度**:官方仅标注有限免费,未给数字 — **需核实**。

---

## 数据来源(权威优先)

- 官方按量付费:https://platform.minimax.io/docs/guides/pricing-paygo
- 官方视频资源包:https://platform.minimax.io/docs/guides/pricing-video
- 官方限速:https://platform.minimax.io/docs/guides/rate-limits
- 官方视频生成指南:https://platform.minimax.io/docs/guides/video-generation
- 官方图像生成指南:https://platform.minimax.io/docs/guides/image-generation
- 官方 I2V 任务:https://platform.minimax.io/docs/api-reference/video-generation-i2v
- 海螺消费端价格(第三方):https://www.atlascloud.ai/blog/guides/hailuo-ai-pricing-cost
- OpenRouter Hailuo 2.3:https://openrouter.ai/minimax/hailuo-2.3:free
- AIMLAPI OpenAI 兼容入口:https://aimlapi.com/models/hailuo-02