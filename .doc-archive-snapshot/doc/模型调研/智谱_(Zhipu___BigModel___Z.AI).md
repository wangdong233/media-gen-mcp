

# 智谱(Zhipu / BigModel / Z.AI)文生图与文生视频模型深度调研

> 调研日期:2026-07-13 | 数据来源:智谱开放平台官方定价页、智谱AI开放文档、Z.AI 国际版文档
> 厂商主体:北京智谱华章科技股份有限公司(2513.HK),开放平台 bigmodel.cn(国内)/ z.ai(国际)

---

## 一、厂商概览

智谱是国内大模型头部厂商,开放平台 **BigModel(bigmodel.cn)** 提供全模态 API。文生图/文生视频是其"图像生成模型""视频生成模型"产品线。计费方式与文本模型不同:**文生图按"每次请求(每张图)"计费,文生视频按"每次请求(每条视频)"计费**,均非按 token 计费。

- 国内 API 平台:https://open.bigmodel.cn(端点 `https://open.bigmodel.cn/api/paas/v4/`)
- 国际 API 平台(Z.AI):https://docs.z.ai(USD 计价)
- 官方定价:https://bigmodel.cn/pricing

---

## 二、模型总览表

| 模型 | 模态 | 计费 | 国内价格 | 国际价格(USD) | 开源 |
|------|------|------|----------|----------------|------|
| **CogView-3-Flash** | 文生图 | **免费** | 免费 | — | 否(仅免费API) |
| **CogView-4**(cogView-4-250304) | 文生图 | 按次 | ¥0.06/次 | $0.01/图 | **是**(6B, Apache 2.0) |
| **GLM-Image** | 文生图 | 按次 | 未列(国际版) | $0.015/图 | 否 |
| **CogVideoX-Flash** | 文/图生视频 | **免费** | 免费 | — | 否(仅免费API) |
| **CogVideoX-2** | 文/图生视频 | 按次 | ¥0.5/次 | — | 否(闭源API) |
| **CogVideoX-3** | 文/图/首尾帧生视频 | 按次 | ¥1/次 | $0.20/视频 | 否(闭源API) |

> 注:开源权重 CogView4-6B、CogVideoX-2B/5B/v1.5-5B 可本地部署,与上表 API 闭源服务相对应(见第五节)。

---

## 三、文生图模型(图像生成)

### 3.1 CogView-3-Flash(免费)⭐ 推荐免费起步

- **定位**:智谱免费图像生成模型,主打艺术创作、设计参考、PPT 配图
- **能力**:
  - 多分辨率:1024×1024、768×1344、864×1152、1344×768、1152×864、1440×720、720×1440
  - 推理速度快,平均数秒生成一张
  - 中文语义理解强
- **免费**:永久免费(官方"免费模型"专区列出),无需付费即可调用 API
- **限速**:受账户并发限制约束(见第六节),未公布固定 RPM/RPD
- **协议**:OpenAI 兼容 `/images/generations`
- 官方文档:https://docs.bigmodel.cn/cn/guide/models/free/cogview-3-flash

### 3.2 CogView-4(cogView-4-250304)⭐ 旗舰文生图

- **定位**:智谱首个支持生成汉字的开源文生图模型,SOTA 级
- **能力**:
  - 支持任意长度中英双语输入
  - 首个能把中英文字符自然融入生成图像的开源模型
  - 分辨率:512px~2048px 任意范围,最高 2048×2048
  - DPG-Bench 基准表现优异,复杂语义对齐与指令跟随强
- **价格**(精确):

| 渠道 | 价格 | 备注 |
|------|------|------|
| 国内(人民币) | **¥0.06 / 次(每张图)** | 按请求次数计费 |
| 国内 Batch API | ¥0.03 / 次 | 批处理半价 |
| 国际(Z.AI, USD) | **$0.01 / 图** | docs.z.ai 官方 |

  - 汇率换算:¥0.06 ≈ $0.0084(国内实际比国际 $0.01 更便宜)
- **开源**:是。权重 CogView4-6B,Apache 2.0 协议
  - GitHub:https://github.com/THUDM/CogView4(或 zai-org/CogView4)
  - HuggingFace:https://huggingface.co/THUDM/CogView4-6B
  - ModelScope:https://www.modelscope.cn/models/ZhipuAI/CogView4-6B
  - 参数量 6B,已适配 diffusers(`pip install git+https://github.com/huggingface/diffusers.git`)
- **协议**:OpenAI 兼容 `/images/generations`,同步返回图片 URL
- 官方文档:https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4

### 3.3 GLM-Image(国际版)

- **价格**:$0.015/图(docs.z.ai)
- 国内价格页未单独列出,**需核实**是否国内可直接调用;疑为国际版专属或新模型
- 同样走 OpenAI 兼容端点

### 3.4 历史模型(参考)

- **CogView-3**:级联扩散框架,现为历史模型,主要见于私有化部署
- **CogView-3-Plus**:基于 DiT,3B,有 diffusers 开源版本(GitHub: chenxwh/CogView3)

---

## 四、文生视频模型(视频生成)

> 重要:智谱视频生成 API 为**异步模式**——提交任务返回 task id,再轮询 `retrieve_videos_result` 获取结果,与 OpenAI images 端点的同步模式不同。

### 4.1 CogVideoX-Flash(免费)⭐ 推荐免费起步

- **定位**:智谱首个免费 AI 视频生成模型
- **能力**:
  - 支持文生视频、图生视频
  - 最高 **4K 分辨率**、**60fps 帧率**
  - 美学评分更高,主体清晰、画面稳定
- **免费**:永久免费(官方"免费模型"专区)
- **限速**:受账户并发限制约束,未公布固定数值
- **协议**:私有 `/videos/generations`(异步)
- 官方文档:https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash

### 4.2 CogVideoX-3 ⭐ 旗舰视频

- **定位**:最新一代视频生成模型,新增首尾帧生成
- **能力**(精确):

| 参数 | 取值 |
|------|------|
| 输入模态 | 文本 / 图像 / **首尾帧**(首帧+尾帧 URL 列表) |
| 输出 | 视频(可带音频 `with_audio=True`) |
| 分辨率 | 多分辨率,**最高 4K(3840×2160)** |
| 帧率 fps | 30 或 **60** |
| 时长 | 5 秒 / **10 秒** |
| 输出模式 | `quality`(质量优先)/ `speed`(速度优先) |
| 特色 | 主体大幅度运动流畅、物理真实模拟、3D 风格场景、高清现实 |

- **价格**(精确):

| 渠道 | 价格 | 备注 |
|------|------|------|
| 国内(人民币) | **¥1 / 次(每条视频)** | 不支持 Batch API |
| 国际(Z.AI, USD) | **$0.20 / 视频** | docs.z.ai 官方 |

  - 汇率换算:¥1 ≈ $0.14(国内比国际 $0.20 便宜约 30%)
  - 按 10 秒视频计:国内约 ¥0.1/秒,国际约 $0.02/秒
- **协议**:私有 `/videos/generations`(异步,需 retrieve)
- **SDK 调用示例**:
  ```python
  response = client.videos.generations(
      model="cogvideox-3",
      prompt="A cat is playing with a ball.",
      quality="quality", with_audio=True,
      size="1920x1080", fps=30,
  )
  result = client.videos.retrieve_videos_result(id=response.id)
  ```
- 官方文档:https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3

### 4.3 CogVideoX-2

- **定位**:上一代视频生成模型,性价比之选
- **价格**(精确):

| 渠道 | 价格 |
|------|------|
| 国内 | **¥0.5 / 次** |
| 国内 Batch API | ¥0.25 / 次 |
| 国际 | —(Z.AI 未列出,**需核实**) |

- **能力**:视频生成,多分辨率;具体时长/分辨率官方文档未明确列出,**需核实**(从开源同源版推断约 6 秒 720×480 级别)

### 4.4 商业产品"清影"(Qingying)

- 基于 CogVideoX 系列,网页端 **全民免费、不限次数、不用排队**
- 支持 4K、60帧、10秒、可变比例、多通道生成、自带音效(BGM)
- 网页体验:https://chatglm.cn(清影入口)
- **注意**:网页免费 ≠ API 免费;API 侧对应 CogVideoX-Flash(免费)/ CogVideoX-2、3(付费)

---

## 五、开源模型(本地部署)

智谱是国内开源图像/视频生成模型最积极的厂商之一。

### 5.1 CogView4-6B(文生图)

| 项 | 详情 |
|----|------|
| 参数量 | 6B |
| 协议 | **Apache 2.0**(可商用) |
| GitHub | https://github.com/THUDM/CogView4 |
| HuggingFace | https://huggingface.co/THUDM/CogView4-6B |
| ModelScope | https://www.modelscope.cn/models/ZhipuAI/CogView4-6B |
| 特色 | 首个支持生成汉字的开源文生图模型 |
| 适配 | diffusers 原生支持;CogKit 微调推理框架 |
| 部署 | 私有实例 ¥100/GPU单元/天(bigmodel 平台) |

### 5.2 CogVideoX 系列(文生视频)⭐ 首个可商用开源视频大模型

| 版本 | 参数 | 时长 | 分辨率 | 帧率 | 备注 |
|------|------|------|--------|------|------|
| **CogVideoX-2B** | 2B | 6 秒 | 720×480 | 8 fps | 首批开源,英文提示词 |
| **CogVideoX-5B** | 5B | 6 秒 | 720×480 | 8 fps | 质量更高,RTX 3060 可跑 |
| **CogVideoX v1.5-5B** | 5B | **5~10 秒** | 更高 | 更高 | 最新开源版 |

- **协议**:开源可商用(首个可商用开源视频生成大模型)
- **GitHub**:https://github.com/THUDM/CogVideo(或 zai-org/CogVideo,含 CogKit)
- **HuggingFace**:https://huggingface.co/THUDM(CogVideoX-5b)、zai-org/CogVideoX-5b
- **ModelScope**:https://modelscope.cn/models/ZhipuAI/CogVideoX1.5-5B
- **部署**:支持 diffusers、PytorchAO/Optimum-quanto 量化(免费 T4 Colab 可跑)

---

## 六、限速 / 限次(重点)

### 6.1 官方机制(关键结论)

智谱**不公布固定的 RPM(每分钟请求数)/ RPD(每日上限)数值**,而是采用以下机制:

1. **按"并发请求数"(在途请求任务数量)限制**,非按分钟/日请求次数
2. **按用户权益等级 + 模型维度**动态分配并发上限
3. 不同套餐(免费/付费/企业)、不同模型(GLM/CogView/CogVideoX)并发上限不同
4. 高峰期(工作日白天、每天 15:00-18:00)有动态限流

> ⚠️ **具体并发数需登录控制台** →「速率限制」页面查看个人账户各模型配额,官方文档页仅描述机制不列数字。

### 6.2 错误码

| 错误码 | 含义 | 处理 |
|--------|------|------|
| **1302** | 触发用户速率限制(并发达上限) | 降低并发、加队列、提升权益等级 |
| **1305** | 平台服务过载 | 稍后重试、增加退避间隔 |

### 6.3 参考基准(非官方精确值)

- 同平台文本模型 **GLM-4-Flash 免费版约 30 并发**(可作为智谱免费模型并发量级参考,**视频/图像模型具体值需核实**)
- GLM Coding Plan 套餐:Lite 单项目 / Pro 1-2 项目 / Max 2+ 项目并发
- 申请提额:控制台提交「速率限制调整申请」,10 个工作日内审核

### 6.4 Batch API(降并发省钱)

- 单 Batch 文件最多 **50,000 个请求**,不超过 100M
- Batch 并发限制与常规 API 独立计算
- CogView-4 Batch:¥0.03/次(半价);CogVideoX-2 Batch:¥0.25/次(半价);CogVideoX-3 不支持 Batch

---

## 七、免费额度与注册福利

| 项 | 详情 |
|----|------|
| 新用户注册 | 得 **2000 万 Tokens**(文本模型用,邀好友实名最高 2 亿 Tokens) |
| **CogView-3-Flash** | **永久免费**(文生图,无需消耗 token) |
| **CogVideoX-Flash** | **永久免费**(文生/图生视频,最高 4K/60fps) |
| 信用卡 | 国内平台需实名认证(手机号+实名),**无需绑定信用卡**即可调用免费模型 |
| 国际版(Z.AI) | 注册即用,免费模型同上 |

> 注:新用户 2000 万 Tokens 主要供 GLM 文本模型消耗;文生图/视频按"次"计费,与 token 无关。免费模型 CogView-3-Flash / CogVideoX-Flash 不消耗任何额度。

---

## 八、协议与端点(适合 media-gen-mcp)

### 8.1 文生图:OpenAI 兼容 ⭐ easy

- **Base URL**:`https://open.bigmodel.cn/api/paas/v4/`
- **端点**:`POST /images/generations`(与 OpenAI 完全兼容)
- **同步返回**:直接返回图片 URL
- **可用 OpenAI SDK 直接调用**:
  ```python
  from openai import OpenAI
  client = OpenAI(api_key="YOUR_ZAI_KEY",
                  base_url="https://open.bigmodel.cn/api/paas/v4/")
  resp = client.images.generate(model="cogview-3-flash", prompt="...", size="1024x1024")
  ```
- **模型名**:`cogview-3-flash`(免费)、`cogView-4-250304`(付费)、`glm-image`
- **MCP 适配**:**easy** — 标准 OpenAI 兼容 images 端点,改 base_url + api_key 即可

### 8.2 文生视频:私有端点 ⚠️ custom

- **端点**:`POST /videos/generations`(智谱私有扩展,非 OpenAI 标准)
- **异步模式**:提交任务 → 返回 task id → 轮询 `GET /videos/results/{id}` 或 SDK `retrieve_videos_result`
- **官方 SDK**:`zai-sdk`(Python/Java,新版)或 `zhipuai`(旧版)
  ```python
  from zai import ZhipuAiClient
  client = ZhipuAiClient(api_key="...")
  resp = client.videos.generations(model="cogvideox-3", prompt="...", size="1920x1080")
  result = client.videos.retrieve_videos_result(id=resp.id)
  ```
- **参数**:`model`、`prompt`、`image_url`(图生/首尾帧)、`quality`、`with_audio`、`size`、`fps`
- **MCP 适配**:**custom** — 需写私有 provider:封装提交 + 轮询逻辑,处理异步状态机

### 8.3 国际版(Z.AI)

- 端点:`https://api.z.ai/api/paas/v4/`(USD 计价)
- 同样 OpenAI 兼容(images)+ 私有(videos)
- 文档:https://docs.z.ai

---

## 九、价格速查表(精确)

### 文生图

| 模型 | 国内(¥/次) | 国际($/图) | Batch(¥/次) | 备注 |
|------|-----------|-----------|------------|------|
| CogView-3-Flash | **免费** | — | — | 永久免费 |
| CogView-4 | **¥0.06** | **$0.01** | ¥0.03 | 开源 6B |
| GLM-Image | 需核实 | $0.015 | — | 国际版 |

### 文生视频

| 模型 | 国内(¥/次) | 国际($/视频) | Batch(¥/次) | 备注 |
|------|-----------|-------------|------------|------|
| CogVideoX-Flash | **免费** | — | — | 永久免费,4K/60fps |
| CogVideoX-2 | **¥0.5** | 需核实 | ¥0.25 | 性价比 |
| CogVideoX-3 | **¥1** | **$0.20** | 不支持 | 旗舰,4K/60fps/首尾帧/音频 |

> 汇率参考:¥1 ≈ $0.14(2026-07)。国内人民币价通常比国际 USD 换算价更优惠。

---

## 十、适合 media-gen-mcp 的结论

| 模型 | 模态 | 适配难度 | 理由 |
|------|------|---------|------|
| **CogView-3-Flash** | 文生图 | **easy** | OpenAI 兼容 + 免费,首选起步 |
| **CogView-4** | 文生图 | **easy** | OpenAI 兼容 + 开源 + ¥0.06/图极便宜 |
| **CogVideoX-Flash** | 文生视频 | **custom** | 免费但私有异步端点,需写 provider |
| **CogVideoX-3** | 文生视频 | **custom** | 私有异步端点,¥1/次,需提交+轮询 |

**推荐方案**:
- 文生图:直接走 OpenAI 兼容 `/images/generations`,CogView-3-Flash 免费起步,CogView-4 追求质量(¥0.06/图,市场最低梯队)
- 文生视频:写 custom provider 封装 `/videos/generations` 异步流程,CogVideoX-Flash 免费起步,CogVideoX-3 做旗舰(4K+音频+首尾帧)

---

## 十一、待核实项(明确标注)

1. **具体并发数 / RPM / RPD**:官方按用户等级动态分配,不公开固定值,需登录控制台「速率限制」查看;CogView/CogVideoX 的免费版具体并发上限**需核实**
2. **CogVideoX-2 时长/分辨率**:官方文档未明确列出具体参数,**需核实**(从开源同源推断约 6 秒/720×480 级)
3. **GLM-Image 国内可用性**:国内价格页未列出,国际版 $0.015/图,**需核实**是否国内可直调
4. **CogVideoX-2 国际版价格**:Z.AI 仅列 CogVideoX-3,**需核实** CogVideoX-2 国际价
5. **新用户免费 Token 能否抵扣文生图/视频**:文生图/视频按"次"计费,token 额度大概率不通用,**需核实**

---

## 数据来源

- [智谱开放平台 - 产品定价](https://bigmodel.cn/pricing)(官方,最权威)
- [智谱AI开放文档 - CogView-4](https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4)
- [智谱AI开放文档 - CogView-3-Flash](https://docs.bigmodel.cn/cn/guide/models/free/cogview-3-flash)
- [智谱AI开放文档 - CogVideoX-3](https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3)
- [智谱AI开放文档 - CogVideoX-Flash](https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash)
- [智谱AI开放文档 - 速率限制](https://docs.bigmodel.cn/cn/api/rate-limit)
- [智谱AI开放文档 - OpenAI API 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
- [Z.AI 国际版定价](https://docs.z.ai/guides/overview/pricing)
- [Z.AI 国际版 CogVideoX-3](https://docs.z.ai/guides/video/cogvideox-3)
- [CogView4 GitHub](https://github.com/THUDM/CogView4)
- [CogVideo GitHub](https://github.com/THUDM/CogVideo)
- [HuggingFace CogView4-6B](https://huggingface.co/THUDM/CogView4-6B)
- [财联社 - 清影4K升级](https://www.cls.cn/detail/1853105)
