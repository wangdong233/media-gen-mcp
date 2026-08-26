# Midjourney 深度调研报告(2026)

> 数据来源:Midjourney 官方文档(docs.midjourney.com)、官方更新页(updates.midjourney.com)及 2026 年第三方评测。所有"限额/限速/收费"均以官方文档为准,已精确标注;无法核实的标"需核实"。

---

## 一、厂商总览

| 项目 | 结论 |
|---|---|
| 厂商 | Midjourney(独立公司,总部美国旧金山) |
| 访问方式 | **仅 Web(midjourney.com)+ Discord**,无独立客户端 |
| **官方 API** | **无。截至 2026 年 7 月,Midjourney 仍未提供任何官方 API、REST 端点、SDK 或 API Key 体系**;仅有一个"API 兴趣登记表"候补(typeform) |
| 开源情况 | **全闭源**,无任何模型权重/下载地址 |
| 免费 | **无永久免费层**(2023 年 3 月已取消免费试用);最低 $10/月起 |
| 计费模型 | **订阅制 + GPU 时间**(不是按图/按秒明码标价) |
| 适合 media-gen-mcp | **no-api**(无官方 API);若用第三方非官方代理则为 custom(有封号风险) |

---

## 二、模型清单(文生图 / 图生图 / 视频生成)

### 1. Midjourney V8.1(文生图 / 图生图)— 当前默认模型

- **发布**:2026 年 4 月 30 日上线 midjourney.com,2026 年 6 月 10 日成为默认版本
- **能力亮点**:
  - 史上最快模型,标准任务比早期版本快 **4–5 倍**(标准任务约 13 秒)
  - 原生 **2K HD(2048px)** 高清出图,无需放大
  - 文字渲染大幅改善,短字符串文字可稳定呈现
  - 提示词遵循度显著提升(可开 Raw 关闭默认美化)
  - 最大宽高比 14:1(HD 模式为 4:1)
- **GPU 成本(官方)**:
  - SD 一组(4 图)= **0.8 GPU 分钟**
  - HD 一组(4 图)= **1.3 GPU 分钟**
- **兼容**:支持 Variations、Upscalers、Pan、Zoom Out、Remix、Personalization、Moodboards、Style Reference、Image Prompts、Seed、Raw、Stylize 等;**不支持 Turbo 模式**、不支持 Omni Reference(改用 V7)、不支持 Niji、不支持 Quality 参数

### 2. Midjourney V7(文生图 / 图生图)

- **发布**:2025 年 4 月 3 日发布,2025 年 6 月 17 日成为默认
- **能力亮点**:文字/图像提示精度高,纹理与连贯性提升(身体、手、物体),引入 **Draft Mode(草稿模式)** 与 **Omni Reference(全能参考)**;Omni Reference 提示词成本 2 GPU 分钟
- 支持 Niji 7

### 3. Midjourney V8.0 Alpha(文生图,限量测试)

- 2026 年 3 月 17 日上线 alpha.midjourney.com,**限时开放**;仅兼容 Fast 模式;`--hd` 与 `--q 4` 各消耗 4 倍 GPU 时间,合用 16 倍

### 4. Niji 7(文生图 — 动漫/二次元专用)

- **发布**:2026 年 1 月 9 日
- 与 Spellbrush 合作,专注东方/动漫美学;有独立网站与 Discord 服务器
- 连贯性大幅提升(眼睛、反光、背景细节),更"literal",线条更干净扁平

### 5. Midjourney 视频模型 V1(图生视频 + 首尾帧)— 首个视频模型

- **本质**:**图生视频(image-to-video)**,需提供一张"首帧图"+ 可选文字提示 → 生成 **5 秒动态视频**。(无纯文生视频;可先文生图再动画化以实现等价"文生视频")
- **关键帧**:支持 **首帧 + 尾帧**(`--end` 参数),可 `--loop` 生成首尾相接循环视频
- **时长**:初始 5 秒,可 **Extend 延长 4 次,每次 +4 秒,最长 21 秒**
- **分辨率**:**SD(480p)** 与 **HD(720p)**;视频尺寸由首帧图宽高比决定(16:9 HD = 1280×720)
- **运动**:Low Motion(默认,静止/缓动)/ High Motion(大运镜)
- **参数**:`--motion low/high`、`--raw`、`--loop`、`--end`、`--bs #`(批量 1/2/4)
- **GPU 成本(官方,精确)**:

  | 批量 | SD 成本 | HD 成本 |
  |---|---|---|
  | Batch 4(默认) | 8 GPU 分钟 | 26 GPU 分钟 |
  | Batch 2 | 4 GPU 分钟 | 13 GPU 分钟 |
  | Batch 1(单条 5 秒) | **2 GPU 分钟** | **7 GPU 分钟** |

---

## 三、订阅价格表(精确,来自官方"Comparing Midjourney Plans")

| 档位 | 月付 | 年付(20% 折扣) | Fast GPU 时间/月 | Relax 模式 | 视频分辨率 | Stealth 私密模式 |
|---|---|---|---|---|---|---|
| **Basic** | $10 | $96($8/月) | **3.3 小时(200 分钟)** | 无 | SD | 无 |
| **Standard** | $30 | $288($24/月) | **15 小时** | 无限图片 | SD & HD | 无 |
| **Pro** | $60 | $576($48/月) | **30 小时** | 无限图片 + 无限 SD 视频 | SD & HD | 有 |
| **Mega** | $120 | $1152($96/月) | **60 小时** | 无限图片 + 无限 SD 视频 | SD & HD | 有 |

**附加购买**:
- **额外 GPU 时间:$4/小时**(所有档位)
- 年付需一次性预付全年

---

## 四、免费额度与限速(精确,最高优先级)

### 免费
- **无永久免费层,无免费试用**(2023 年 3 月已取消);**需订阅才能使用**,最低 $10/月
- **不需信用卡**?需核实——订阅需绑定支付方式(信用卡/借记卡/PayPal 等)
- 订阅用户可"给图片评分 / 完成网站任务"赚取少量额外 Fast GPU 时间(非免费白嫖,前提是已付费)

### 限速 / 限次(GPU 时间制,非每日图数上限)

**并发任务上限(官方)**:

| 档位 | 图片并发 | 视频并发 |
|---|---|---|
| Basic | 3 Fast | 1 Fast |
| Standard | 3 Fast 或 Relax | 3 Fast |
| Pro | 12 Fast 或 3 Relax | 6 Fast 或 3 Relax |
| Mega | 12 Fast 或 3 Relax | 12 Fast 或 3 Relax |

- **最大排队任务**:10 个(Pro/Mega Relax 视频限 3 个)
- **最大 Repeat/Permutation**:Basic 4 / Standard 10 / Pro & Mega 40

**三种 GPU 速度模式**:
| 模式 | 行为 |
|---|---|
| **Fast** | 默认,消耗每月 Fast 配额(图约 1 分钟/任务,视频约 8 分钟/任务) |
| **Relax** | 排队等空闲 GPU,**不消耗 Fast 时间**,等待 0–30 分钟;图片(Standard+)/SD 视频(Pro+);不支持 Permutation、Repeat、HD 视频 |
| **Turbo** | 最高 4 倍速,但**消耗 2 倍 Fast 时间**;**V8.1 不支持 Turbo** |

**折算每月可生成量(Fast 模式,SD 图)**:
- Basic:200 分钟 ÷ 0.8 ≈ 250 组 ≈ **1000 张 SD 图/月**
- Standard:900 分钟 ≈ 4500 张 + 无限 Relax 图
- Pro:1800 分钟 ≈ 9000 张 + 无限 Relax 图
- Mega:3600 分钟 ≈ 18000 张 + 无限 Relax 图

---

## 五、每图 / 每秒 USD 折算(官方无明码标价,以下为按边际成本 $4/小时 GPU 推算)

> ⚠️ Midjourney **不按张/按秒直接收费**,而是订阅 + GPU 时间。以下 USD 为"边际成本"参考(购买额外 GPU 时 $4/小时 = $0.0667/分钟)。

| 任务 | GPU 成本 | 折算 USD(边际) |
|---|---|---|
| 单张 SD 图 | 0.2 GPU 分钟(0.8÷4) | ≈ **$0.013/张** |
| 单张 HD 图 | 0.325 GPU 分钟(1.3÷4) | ≈ **$0.022/张** |
| 单条 SD 视频(5 秒) | 2 GPU 分钟 | ≈ **$0.13/条**($0.027/秒) |
| 单条 HD 视频(5 秒) | 7 GPU 分钟 | ≈ **$0.47/条**($0.093/秒) |

**订阅内有效单价(以 Basic 全部用满 SD 图计)**:$10/月 ÷ 1000 张 ≈ **$0.01/张**(理论最低)。

---

## 六、协议与 API(关键)

| 问题 | 结论 |
|---|---|
| 官方 API | **无** |
| OpenAI 兼容端点(`/v1/images/generations`) | **无** |
| REST/SDK/API Key | **无** |
| 端点 URL | 不存在(无官方端点) |
| 第三方"Midjourney API" | 全部为**非官方**(APIFrame、302ai、代理服务等),靠模拟 Web/Discord 调用,**有封号风险**,且非 Midjourney 官方授权 |
| 未来官方 API | 仅有一个"API 兴趣登记表"候补,无明确时间表 |

---

## 七、能力总结

| 维度 | 详情 |
|---|---|
| 图像分辨率 | SD 标准 + 原生 **2K HD(2048px)**(V8.1) |
| 宽高比 | 最长边比 14:1(HD 为 4:1) |
| 视频时长 | 单段 5 秒,可延至 **21 秒** |
| 视频分辨率 | 480p(SD)/ 720p(HD) |
| 特色 | 文字渲染、Omni/Style Reference、Personalization、Moodboards、首尾帧视频、循环视频、Draft/Conversational 模式 |
| 商用 | General Commercial Terms;年毛利 > $1,000,000 的公司须购 Pro/Mega |

---

## 八、适合 media-gen-mcp 的判定

- **官方路径 = no-api**:无任何 API,只能通过浏览器/Discord 交互,无法直接接入 MCP 的 OpenAI 兼容 provider
- **非官方代理 = custom**(可写私有 provider):通过 APIFrame 等第三方可拿到类 REST 接口,但 (a) 额外加价、(b) 违反 Midjourney ToS、(c) 账号封禁风险,**不推荐用于生产**
- **结论**:Midjourney **不适合**作为 media-gen-mcp 的标准 API 模型源;若必须接入,应标注为"高风险非官方代理",并优先评估官方 API 候补进展

---

## 九、需核实项

1. **是否需信用卡**:订阅需绑定支付方式,具体是否接受借记卡/PayPal 全档位通用——需核实(Midjourney 接受主要信用卡,部分地区支持其他方式)
2. **每秒 USD 明码**:Midjourney 官方从未公布"每秒/每图"美元价,本文 USD 均为按 $4/小时 GPU 边际成本推算,非官方报价
3. **官方 API 时间表**:无明确公开时间表,需核实最新进展

---

## 来源

- [Midjourney 官方:Comparing Midjourney Plans](https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans)
- [Midjourney 官方:Video](https://docs.midjourney.com/hc/en-us/articles/37460773864589-Video)
- [Midjourney 官方:GPU Speed (Fast, Relax, Turbo)](https://docs.midjourney.com/hc/en-us/articles/32016412137741-GPU-Speed-Fast-Relax-Turbo)
- [Midjourney 官方:Version](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)
- [Midjourney 官方更新:V8.1 is now the default model](https://updates.midjourney.com/v8-1-is-now-the-default-model/)
- [UniFuncs:2026 Guide to Midjourney API(无官方 API)](https://unifuncs.com/s/kVTOKgFf)
- [APIFrame:Best Midjourney APIs 2026(非官方)](https://apiframe.ai/blog/best-midjourney-apis)
- [TechCrunch:Midjourney V1 视频发布](https://techcrunch.com/2025/06/18/midjourney-launches-its-first-ai-video-generation-model-v1/)