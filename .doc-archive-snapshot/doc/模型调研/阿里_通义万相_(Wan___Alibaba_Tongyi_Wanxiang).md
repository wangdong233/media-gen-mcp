# 阿里 通义万相(Wan)深度调研报告(2026 最新)

> 数据来源:阿里云百炼官方「模型调用价格」「限流」「万相 API 参考」文档(2026-06 抓取),以及 Wan 开源仓库。所有价格、免费额度、限速数字均为**官方文档精确摘录**,非估算。

---

## 一、厂商概览

| 项目 | 说明 |
|------|------|
| 厂商 | 阿里巴巴 / 通义万相团队(Wan-AI) |
| 商业 API 平台 | 阿里云**百炼**(Model Studio,原 DashScope) |
| 开源仓库 | Wan-Video/Wan2.1、Wan-Video/Wan2.2(Apache 2.0) |
| 服务部署范围 | 中国内地(华北2-北京) / 国际(新加坡) / 美国(弗吉尼亚) / 德国(法兰克福) |
| 官方价格页 | https://help.aliyun.com/zh/model-studio/model-pricing |
| 官方限流页 | https://help.aliyun.com/zh/model-studio/rate-limit |

**关键结论(先读这段):**
1. **免费额度真实存在但很小**:文生图 50 张、文生视频 50 秒(开通百炼后 **90 天内**有效,仅中国内地节点有)。
2. **文生图 0.20 元/张起,文生视频 720P 0.6 元/秒、1080P 1 元/秒**(主力型号统一价)。
3. **协议非 OpenAI 兼容**:文生图/视频**走 DashScope 私有异步接口**(创建任务→轮询),`/v1/images/generations` 不支持。接入 media-gen-mcp 必须**自写 provider(custom)**。
4. **限速较低**:视频/新图像模型 5 RPS + 5 并发;老款 wan2.6-t2i 仅 1 RPS。
5. **开源版(Wan2.1/2.2)Apache 2.0 可商用**,权重在 HuggingFace / ModelScope,适合本地部署完全免费。

---

## 二、全部模型清单(文生图 / 图生图 / 文生视频 / 图生视频 / 关键帧 / 参考 / 编辑)

### 2.1 文生图 & 图像编辑(闭源 API 版)

| 模型 ID | 能力 | 中国内地单价 | 免费(90天内) | 备注 |
|---------|------|-------------|-------------|------|
| **wan2.7-image-pro** | 文生图/组图/编辑/多图参考 | **0.50 元/张** | 50 张 | 最新旗舰,高质量 |
| **wan2.7-image** | 文生图/组图/编辑 | **0.20 元/张** | 50 张 | 最新标准版(推荐) |
| **wan2.6-image** | 文生图/组图/编辑 | **0.20 元/张** | 50 张 | 2.6 版图像生成与编辑 |
| **wan2.6-t2i** | 纯文生图(V2 协议) | **0.20 元/张** | 50 张 | 分辨率自由选尺寸 [1280×1280, 4096×4096] |
| wan2.5-t2i-preview | 纯文生图 | 0.20 元/张 | 50 张 | 旧版 |
| wan2.2-t2i-plus | 纯文生图 | 0.20 元/张 | 100 张 | |
| wan2.2-t2i-flash | 纯文生图(极速) | **0.14 元/张** | 100 张 | 最便宜 |
| wan2.5-i2i-preview | 通用图像编辑 | 0.20 元/张 | 50 张 | |
| wanx2.1-imageedit | 图像编辑 | 0.14 元/张 | 500 张 | 老款,额度较多 |

### 2.2 文生视频(T2V)

| 模型 ID | 分辨率 | 中国内地单价 | 免费(90天内) | 备注 |
|---------|--------|-------------|-------------|------|
| **wan2.7-t2v** | 720P / 1080P | **0.6 / 1 元/秒** | 50 秒 | 最新版,2~15 秒,异步 |
| wan2.7-t2v-2026-06-12 | 720P / 1080P | 0.6 / 1 元/秒 | 50 秒 | 日期快照版 |
| wan2.7-t2v-2026-04-25 | 720P / 1080P | 0.6 / 1 元/秒 | 50 秒 | 日期快照版 |
| **wan2.6-t2v** | 720P / 1080P | **0.6 / 1 元/秒** | 50 秒 | 多镜头叙事 |
| wan2.5-t2v-preview | 480P/720P/1080P | 0.3 / 0.6 / 1 元/秒 | 50 秒 | |
| wan2.2-t2v-plus | 480P / 1080P | 0.14 / 0.70 元/秒 | 50 秒 | 性价比款 |
| wanx2.1-t2v-turbo | 480P/720P | 0.24 元/秒 | **200 秒** | 老款,免费额度最多 |
| wanx2.1-t2v-plus | 720P | 0.70 元/秒 | 200 秒 | 老款 |

### 2.3 图生视频(I2V,基于首帧)

| 模型 ID | 类型 | 分辨率 | 中国内地单价 | 免费(90天内) |
|---------|------|--------|-------------|-------------|
| **wan2.7-i2v** | 有声视频 | 720P/1080P | **0.6 / 1 元/秒** | 50 秒 |
| wan2.7-i2v-2026-04-25 | 有声视频 | 720P/1080P | 0.6 / 1 元/秒 | 50 秒 |
| **wan2.6-i2v** | 有声视频 | 720P/1080P | 0.6 / 1 元/秒 | 50 秒 |
| **wan2.6-i2v-flash** | 有声(audio=true) | 720P | **0.3 元/秒** | 50 秒 |
| wan2.5-i2v-preview | 有声 | 480P | 0.3 元/秒 | 50 秒 |
| wan2.2-i2v-flash | 无声 | 480P | 0.10 元/秒 | 50 秒 |
| wan2.2-i2v-plus | 无声 | 480P | 0.14 元/秒 | 50 秒 |

### 2.4 首尾帧生视频(Keyframe-to-Video)

| 模型 ID | 分辨率 | 中国内地单价 | 免费 |
|---------|--------|-------------|------|
| wan2.2-kf2v-flash | 480P/720P/1080P | 0.10 / 0.20 / 0.48 元/秒 | 50 秒 |
| wanx2.1-kf2v-plus | 720P | 0.70 元/秒 | 200 秒 |

### 2.5 参考生视频(R2V,保持角色/音色一致)

| 模型 ID | 类型 | 分辨率 | 中国内地单价 | 免费 |
|---------|------|--------|-------------|------|
| **wan2.7-r2v** | 有声 | 720P/1080P | 0.6 / 1 元/秒 | 50 秒 |
| **wan2.6-r2v** | 有声 | 720P/1080P | 0.6 / 1 元/秒 | 50 秒 |
| wan2.6-r2v-flash | 有声(audio=true) | 720P/1080P | 0.3 / 0.5 元/秒 | 50 秒 |
| wan2.6-r2v-flash | 无声(audio=false) | 720P/1080P | 0.15 / 0.25 元/秒 | 50 秒 |

### 2.6 视频编辑 & 数字人 & 动作

| 模型 ID | 能力 | 单价 | 免费 |
|---------|------|------|------|
| wan2.7-videoedit | 视频编辑 | 720P 0.6 / 1080P 1 元/秒 | 50 秒 |
| wan2.2-s2v-detect | 数字人检测(输入计费) | 0.004 元/张 | 200 张 |
| wan2.2-s2v | 数字人生成(输出计费) | 480P 0.5 / 720P 0.9 元/秒 | 100 秒 |
| wan2.2-animate-move | 图生动作 | 0.4 元/秒 | 50 秒 |
| wan2.2-animate-mix | 视频换人 | 0.6 元/秒 | 50 秒 |

---

## 三、开源版(本地部署完全免费)

### Wan2.1(2025-02-25 开源)
- **协议**:Apache License 2.0(可商用)
- **GitHub**:https://github.com/Wan-Video/Wan2.1
- **规格**:14B(高质量) + 1.3B(极速版)
- **能力**:文生视频、图生视频
- **ModelScope 介绍**:https://www.modelscope.cn/learn/992

### Wan2.2(升级版)
- **协议**:Apache License 2.0(可商用)
- **GitHub**:https://github.com/Wan-Video/Wan2.2
- **架构**:业界首个视频生成 MoE(混合专家),总参 27B,推理激活 14B
- **训练数据**:较 Wan2.1 图像 +65.6%、视频 +83.2%
- **TI2V-5B**:一个模型同时支持文生视频+图生视频,720P/24fps,**可在 RTX 4090 消费级显卡运行**
- **VAE**:Wan2.2-VAE 实现 16×16×4 时空压缩比
- **下载**:
  - ModelScope:https://modelscope.cn/models/Wan-AI/Wan2.2-TI2V-5B
  - HuggingFace:https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-InP

> **注意**:开源版(Wan2.1/2.2)是**模型权重**,与百炼 API 版(wan2.7-t2v 等)**版本号不完全对应**。API 版 wan2.7 含有声视频/多模态等云端增强能力,尚未完全开源。

---

## 四、免费额度(精确)

| 维度 | 数值 |
|------|------|
| **文生图(主力)** | wan2.6/wan2.7-image 系列 **50 张**(90 天内) |
| **文生图(老款 flash)** | wan2.2-t2i-flash/plus **100 张** |
| **文生图(imageedit)** | wanx2.1-imageedit **500 张** |
| **文生/图生视频(主力)** | wan2.6/wan2.7 系列 **50 秒**(90 天内) |
| **文生视频(老款 2.1)** | wanx2.1-t2v-turbo/plus **200 秒** |
| **数字人** | wan2.2-s2v **100 秒**;detect **200 张** |
| **有效期** | **阿里云百炼开通后 90 天内** |
| **地域限制** | **仅中国内地(华北2-北京)有免费额度**;国际/美国/德国节点均无 |
| **是否需信用卡** | 需阿里云账号实名认证;绑定信用卡**通常非强制**(开通百炼免费额度以控制台为准)。**[需核实:具体是否强制绑卡,以注册流程为准]** |
| **领取方式** | 开通百炼 → 控制台模型广场领取新用户免费额度 |

---

## 五、付费价格表(精确,中国内地)

### 5.1 文生图(按成功生成张数计费,失败不计费)
| 模型 | 单价(元/张) | 折合 USD/张(约) |
|------|------------|----------------|
| wan2.7-image-pro | 0.50 | ~$0.069 |
| wan2.7-image | 0.20 | ~$0.028 |
| wan2.6-image | 0.20 | ~$0.028 |
| wan2.6-t2i | 0.20 | ~$0.028 |
| wan2.2-t2i-flash | 0.14 | ~$0.019 |

### 5.2 文生/图生视频(按输出视频秒数计费,失败不计费)
| 模型 | 720P(元/秒) | 1080P(元/秒) | 480P(元/秒) |
|------|-----------|------------|-----------|
| wan2.7-t2v / wan2.6-t2v | **0.6**(~$0.083/秒) | **1.0**(~$0.14/秒) | — |
| wan2.6-i2v / wan2.7-i2v | 0.6 | 1.0 | — |
| wan2.6-i2v-flash | 0.3 | — | — |
| wan2.7-r2v / wan2.6-r2v | 0.6 | 1.0 | — |
| wan2.6-r2v-flash(无声) | 0.15 | 0.25 | — |
| wan2.2-t2v-plus | — | 0.70 | 0.14 |
| wan2.2-i2v-flash(无声) | — | — | 0.10 |

> 无订阅制/包月,全部**按量计费**。部分模型支持 **Batch 批处理**(输入输出按实时价 50% 计费)。

---

## 六、限速 / 限次(精确,官方限流表)

限流维度:**按主账号**(账号下所有 RAM 子账号、业务空间、API Key 合并计算)。

### 6.1 图像模型限流(中国内地)
| 模型 | 每秒任务下发 RPS | 同时处理中任务(并发数) |
|------|----------------|---------------------|
| wan2.7-image-pro / wan2.7-image | **5** | **5** |
| wan2.6-image | 5 | 5 |
| **wan2.6-t2i** | **1**(较低,需注意) | 5 |
| wan2.5-t2i-preview | 5 | 5 |
| wan2.2-t2i-plus / flash | 2 | 2 |

### 6.2 视频模型限流(中国内地)
| 模型 | 每秒任务下发 RPS | 同时处理中任务(并发数) |
|------|----------------|---------------------|
| **wan2.7-t2v / wan2.7-i2v / wan2.7-r2v** | **5** | **5** |
| wan2.6-t2v / wan2.6-i2v / wan2.6-r2v | 5 | 5 |
| wan2.6-i2v-flash / r2v-flash | 5 | 5 |
| wan2.5-t2v-preview / i2v-preview | 5 | 5 |
| wan2.2-t2v-plus / i2v-flash/plus | 2 | 2 |
| wan2.7-videoedit | 5 | 5 |

> - **视频任务查询接口**默认 RPS=20(轮询获取结果时)。
> - 触发限流返回 HTTP 429,**通常 1 分钟内自动恢复**。
> - 无明确每日/每月总量上限,主要受 RPS+并发双重限制。

---

## 七、协议与端点(非 OpenAI 兼容)

### 重要:DashScope 的 OpenAI 兼容接口**仅覆盖文本**(Chat/Completions/Vision 输入/Batch),**不含 `/v1/images/generations`**。万相文生图/视频必须用 **DashScope 私有异步接口**。

### 端点 URL(华北2-北京)
| 能力 | 创建任务端点 |
|------|------------|
| 文生图 | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis` |
| 文生/图生/参考生视频 | `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis` |
| 查询任务结果 | `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}` |

### 调用流程(异步)
1. **创建任务**:Header 必须含 `X-DashScope-Async: enable` + `Authorization: Bearer sk-xxx`,返回 `task_id`(有效期 24h)。
2. **轮询获取**:建议间隔 15 秒,状态 PENDING→RUNNING→SUCCEEDED/FAILED。结果 URL 有效期 **24 小时**,需及时转存 OSS。
3. 视频/图片任务**耗时 1~5 分钟**。

### 新加坡节点(国际)
- 创建:`POST https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`
- 旧域名 `https://dashscope-intl.aliyuncs.com` **即将下线**,需迁移到新版域名。

### SDK
- **DashScope Python SDK**(≥1.25.16)/ **Java SDK**(≥2.22.14),封装异步流程,支持同步/异步两种调用方式。
- **不能用** OpenAI SDK 的 `images.generate` / `videos.generate`。

---

## 八、能力规格(分辨率/时长/特色)

### 文生图
- **wan2.6-t2i**:总像素面积约束 [1280×1280, 4096×4096],自由选宽高比;`n` 参数 1~4 张/请求,默认 4 张。
- **wan2.7-image**:支持文生图、文生组图、图生组图、图像编辑、**多图参考生成**。

### 文生视频(wan2.7-t2v)
- **分辨率**:720P / 1080P(默认 1080P)
- **宽高比**:16:9 / 9:16 / 1:1 / 4:3 / 3:4
- **时长**:2~15 秒(默认 5 秒)
- **特色**:
  - **多镜头叙事**:prompt 用时间戳描述分镜(如「第1个镜头[0-3秒] 全景…」)
  - **传入音频**(`input.audio_url`):wav/mp3,2~30 秒,≤15MB
  - **自动配音**:不提供音频时自动生成背景音乐/音效
  - **反向提示词**(`negative_prompt`)、智能 prompt 改写(`prompt_extend`)、水印(`watermark`)

### 图生视频(wan2.7-i2v)
- 多模态输入(文本/图像/音频/视频);支持首帧生视频、首尾帧生视频、视频续写。

---

## 九、适合 media-gen-mcp 的接入评估

| 接入难度 | 判定 | 说明 |
|---------|------|------|
| **easy(OpenAI 兼容)** | ❌ 不适用 | 万相文生图/视频**不在 OpenAI 兼容接口内**,无 `/v1/images/generations`。 |
| **custom(私有 provider)** | ✅ **必须** | 需自写 DashScope provider:① POST 创建异步任务 ② GET 轮询 task_id ③ 下载结果(24h 有效)。鉴权用 `Authorization: Bearer sk-xxx`。 |
| **no-api(仅 Web)** | 可选 | 通义万相 Web 端 https://tongyi.aliyun.com/wanxiang/ 提供界面化生成,但与 API 计费体系独立,无编程接入价值。 |

### MCP 接入建议
1. **自写 provider**(custom),实现「提交任务→轮询→取回 URL」三步异步逻辑。
2. **成本最优组合**:
   - 文生图默认 `wan2.7-image`(0.20 元/张)或 `wan2.2-t2i-flash`(0.14 元/张);
   - 文生视频默认 `wan2.7-t2v` 720P(0.6 元/秒),1080P 翻倍至 1 元/秒。
3. **注意限速**:视频 5 并发,单任务 1~5 分钟,并发吞吐受限;`wan2.6-t2i` 仅 1 RPS,慎选。
4. **免费额度仅 90 天**:适合初期验证;长期需充值按量付费(中国内地节点)。

---

## 十、来源(均经直接抓取官方页面核实)

- [阿里云百炼模型价格(官方)](https://help.aliyun.com/zh/model-studio/model-pricing) — 全部价格、免费额度精确摘录
- [限流(官方)](https://help.aliyun.com/zh/model-studio/rate-limit) — RPS / 并发数精确摘录
- [万相2.7文生视频 API 参考](https://help.aliyun.com/zh/model-studio/text-to-video-api-reference) — 端点、参数、异步流程
- [万相图像生成与编辑2.7 API 参考](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)
- [万相2.7图生视频 API 参考](https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference)
- [万相-文生图V2 API 参考](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)
- [OpenAI 兼容接口说明](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) — 确认不含图像生成
- [Wan2.1 GitHub](https://github.com/Wan-Video/Wan2.1) / [Wan2.2 GitHub](https://github.com/Wan-Video/Wan2.2) — Apache 2.0 开源
- [Wan2.2-TI2V-5B ModelScope](https://modelscope.cn/models/Wan-AI/Wan2.2-TI2V-5B)