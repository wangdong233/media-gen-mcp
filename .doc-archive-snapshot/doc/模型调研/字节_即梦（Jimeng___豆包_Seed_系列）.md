# 字节 即梦（Jimeng）/ 豆包 Seed 系列 — 文生图 / 文生视频 深度调研

> 调研日期：2026-07-13 ｜ 数据来源：火山引擎官方文档、火山方舟定价页、GitHub ArcReel 费用参考（转录自官方）、新浪财经/每日经济新闻官方报道
> 注意：即梦（Jimeng）是字节面向 C 端的 AI 创作平台（Web/App）；面向开发者的 API 能力由「火山方舟 / 火山引擎」承载，模型为豆包 Seed 系列。本报告以 API（火山方舟）为主线，C 端订阅作补充。

---

## 一、厂商与产品全景

| 维度 | 说明 |
|---|---|
| 厂商 | 字节跳动（ByteDance），通过「火山引擎 Volcano Engine」对外提供 API |
| C 端产品 | 即梦 AI（jimeng.jianying.com）—— 文生图/图生图/文生视频/图生视频/数字人，订阅制 |
| B 端 API | 火山方舟（Ark）大模型服务平台 —— OpenAI 兼容协议，按量计费 |
| 模型家族 | 文生图 = **Seedream**（豆包图像创作）；文生视频 = **Seedance**（豆包视频生成） |
| 开源状态 | **全部闭源**（仅 API 调用，无公开权重/下载）。ByteDance Seed 团队另有部分开源模型（如 SD3 衍生实验），但商用即梦/豆包主力 Seedream/Seedance 均闭源 |

---

## 二、文生图 / 图生图模型（Seedream 系列）

### 模型清单与价格（按张计费，元/张）

| 模型（model id） | 单价（元/张） | 约合 USD/张 | 关键能力 | 状态 |
|---|---|---|---|---|
| **doubao-seedream-5.0-pro** | **0.30**（输出图）｜输入参考图首张免费，后续 0.02 元/张 | ≈$0.042 | 复杂信息可视化、局部精准编辑（画箭头/圈选交互编辑）、真实影像质感、多语种；最多 10 张参考图 | 最新（2026-07-08 API 上线）|
| **doubao-seedream-5.0-lite** | **0.22** | ≈$0.031 | 联网搜索（web_search 工具）、深度多步视觉推理、组图（最多 15 张）、多图融合（最多 14 参考图）、4K、流式输出 | 当前主力 |
| **doubao-seedream-4.5** | **0.22**（官方价格页，ArcReel 参考 0.25，需以控制台为准）| ≈$0.031 | 多图融合、组图、角色连贯 | 在售 |
| **doubao-seedream-4.0** | **0.20** | ≈$0.028 | 文生图/图生图/组图 | 在售 |
| **doubao-seedream-3.0-t2i** | **0.259** | ≈$0.036 | 文生图（旧版）| 在售 |

> **计费规则**：按成功输出的图片张数计费，审核失败不收费；组图按实际生成张数累计。
> **Seedream 5.0 Pro 分档**：输出图 ≤ 236 万像素（约 2K）时输出 0.3 元/张、输入图首张免费后续 0.02 元/张；更高像素分档「需核实」官方价格页。

### 能力参数（Seedream 5.0 lite / 4.5 / 4.0）

- **分辨率**：2K / 3K / 4K；或自定义像素，总像素范围 [3686400, 16777216]（即最低约 2560×1440，最高 4096×4096），宽高比 [1/16, 16]
- **输入参考图**：最多 14 张（格式 jpeg/png/webp/bmp/tiff/gif/heic/heif，单图 ≤30MB，总像素 ≤6000×6000）
- **输出格式**：5.0 lite 支持 png/jpeg；4.5/4.0 默认 jpeg
- **组图**：`sequential_image_generation=auto`，最多 15 张
- **联网搜索**：仅 5.0 lite 支持 `tools=[{type:web_search}]`，按 `usage.tool_usage.web_search` 计次数

---

## 三、文生视频 / 图生视频 / 视频编辑模型（Seedance 系列）

### 模型清单与 token 单价（元/百万 token）

| 模型（model id） | 在线推理单价 | 约合 USD（元→$ 按 7.1）| 能力 | 状态 |
|---|---|---|---|---|
| **doubao-seedance-2.0** | 输入不含视频 **46 元/百万 token**；输入含视频 **28 元/百万 token** | — | 文/图/音频/视频四模态输入，音视频联合生成，多模态参考与编辑，视频延长 | SOTA（2026-04 全面开放）|
| **doubao-seedance-2.0-fast** | 输入不含视频 **37 元/百万 token**；输入含视频 **22 元/百万 token** | — | 2.0 的快速版，便宜约 20% | 在售 |
| **doubao-seedance-2.0-mini** | 图生视频 **0.023 元/千 token**（=23 元/百万）；视频生视频 **0.014 元/千 token**（=14 元/百万）| — | 480P/720P，4-15 秒，24fps，成本较 2.0 降约 50% | 最新（2026-06-16）|
| **doubao-seedance-1.5-pro** | 有声 **16 元/百万 token**；无声 **8 元/百万 token** | — | 有声视频，480p/720p/1080p | 在售 |
| **doubao-seedance-1.0-pro** | **15 元/百万 token** | — | 1080P，5 秒约 3.67 元 | 在售 |
| **doubao-seedance-1.0-pro-fast** | **4.2 元/百万 token** | — | 快速版 | 在售 |
| **doubao-seedance-1.0-lite** | **10 元/百万 token** | — | 轻量版 | 在售 |

### 视频价格换算示例（官方价格页口径）

**Seedance 2.0 / 2.0-fast（输入不含视频，16:9，输出 5 秒）**

| 分辨率 | 2.0（元/条） | 2.0-fast（元/条） | 约合每秒（2.0） |
|---|---|---|---|
| 480p | 2.31 | 1.86 | ≈0.46 元/s |
| 720p | 4.97 | 4.00 | ≈0.99 元/s |

**Seedance 2.0（输入含视频，720p，输出 5 秒）**：5.44～12.10 元/条（随输入 2～15 秒递增）

**Seedance 2.0 mini**：按 720P 折算，单秒生成成本约 **0.5 元/秒**

**Seedance 1.5-pro（5 秒，16:9）**

| 分辨率 | 有声（元/条）| 无声（元/条）|
|---|---|---|
| 480p | 0.80 | 0.40 |
| 720p | 1.73 | 0.86 |
| 1080p | 3.89 | 1.94 |

### Token 估算公式

- Seedance 2.0 / 2.0-fast：`(输入视频时长 + 输出视频时长) × 宽 × 高 × 帧率 / 1024`
- Seedance 1.x：`宽 × 高 × 帧率 × 时长 / 1024`
- 精确用量以 API 返回 `usage` 字段为准；仅对成功生成的视频计费。

---

## 四、免费额度 / 限速（最高优先级，精确标注）

### 免费额度

| 项 | 说明 |
|---|---|
| **新用户免费 tokens** | 火山方舟为**每个模型**赠送 **50 万 tokens** 免费推理额度（需注册火山引擎账号）。豆包通用模型 pro/lite 的部分版本另有 1 万 RPM 额度体验 |
| **领取方式** | 注册 → 控制台开通对应模型 → 自动到账；或体验中心「免费领取 50 万 Tokens」入口 |
| **有效期** | 官方未统一公示固定到期日，通常随账号/活动有效；**安心体验模式**关闭后不可重新开启 |
| **是否需信用卡** | 国内实名认证（个人/企业实名）即可，**无需信用卡**（国内云常规做法）|
| **适用模型** | 含 Seedream 系列、Seedance 系列在内的豆包全家桶 |

> ⚠️ **需核实**：50 万 tokens 具体是否对所有 Seedance/Seedream 版本均单独发放、以及是否区分"在线推理专用"，官方文档表述为"每个模型 50 万 tokens"，但建议在控制台确认到账明细。

### 限速（RPM / 并发）

| 模型 | RPM（每分钟最大创建任务数）| 并发数（最大同时处理任务数）| 来源 |
|---|---|---|---|
| **Seedance 2.0 mini** | **60** | **1** | 新浪财经/每日经济新闻官方报道（明确数字）|
| Seedance 2.0 / 2.0-fast | 默认值「需核实」（官方支持按 QPS/并发自定义配置）| 同左 | — |
| Seedream 系列 | 默认值「需核实」（按账号/模型配额分配）| — | — |

> 火山方舟限流采用**预扣机制**（按输入+输出长度预扣额度，保障完成率），并支持：按 QPS 阈值、按并发数、按用户/应用维度自定义限流。具体默认 RPM 随账号等级、模型、是否开通 TPM 保障包而变，**确切默认值需在控制台「推理接入点」查看**（官方未在公开文档给统一数字，标记「需核实」）。

---

## 五、付费价格总表（精确）

### 图片（每张，元）

| 模型 | 输出图单价 | 输入参考图（Pro）|
|---|---|---|
| Seedream 5.0 Pro | **0.30 元/张**（≤236 万像素）| 首张免费，后续 0.02 元/张 |
| Seedream 5.0 lite | **0.22 元/张** | — |
| Seedream 4.5 | **0.22 元/张**（部分参考 0.25，需核实）| — |
| Seedream 4.0 | **0.20 元/张** | — |
| Seedream 3.0-t2i | **0.259 元/张** | — |

### 视频（元/百万 token）

| 模型 | 不含视频输入 | 含视频输入 |
|---|---|---|
| Seedance 2.0 | 46 | 28 |
| Seedance 2.0-fast | 37 | 22 |
| Seedance 2.0 mini | 23 | 14 |
| Seedance 1.5-pro（有声/无声）| 16 / 8 | — |
| Seedance 1.0-pro | 15 | — |
| Seedance 1.0-pro-fast | 4.2 | — |
| Seedance 1.0-lite | 10 | — |

### 国际渠道（USD/秒，第三方路由 EvoLink 公开价，仅供参考）

| 路由 | 480p | 720p |
|---|---|---|
| Seedance 2.0 Standard | $0.092/s | $0.199/s |
| Seedance 2.0 Fast | $0.074/s | $0.161/s |

### 资源包（预付费，Seedance 2.0 系列）

- 示例：Seedance 2.0 mini **1400 万 tokens = 196 元**（折扣价）
- 另有 1080P 含视频输入 0.051 元/千 token、4K 0.016 元/千 token 等资源包档位（完整档位表见官方资源包规则页）
- 高级创作权益包：¥10 万/档，含 100 素材、最大 QPM=120

### C 端订阅（即梦 / 豆包 App，非 API）

- 即梦会员：**79 元/月**（解锁 Seedream 5.0 Pro 生图 + Seedance 2.0 视频生成，按积分消耗）
- 豆包会员：**69 元/月**（解锁 Seedream 5.0 Pro）
- 即梦积分示例：Seedance 2.0 mini 生成 5 秒视频消耗 45 积分；Seedance 2.0 为 40 积分；Seedance 2.0 VIP 为 70 积分
- 年付会员折算单条视频约 4.58 元（即梦 Seedance 2.0）

---

## 六、协议与端点（适合 media-gen-mcp 判定）

| 项 | 详情 |
|---|---|
| **协议兼容** | **OpenAI API 兼容**（修改 base_url + api_key + model 即可）；同时兼容 Anthropic 协议（适配 Claude Code 等）|
| **图片端点** | `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`（与 OpenAI `/v1/images/generations` 同形：model/prompt/image/size/response_format/watermark 等字段）|
| **Base URL（OpenAI 兼容）** | `https://ark.cn-beijing.volces.com/api/v3` |
| **视频端点** | 异步任务接口（`POST .../contents/generations/tasks` 创建任务 → 轮询任务状态取结果），**非 OpenAI 标准同步 images 接口**，需自定义异步逻辑 |
| **鉴权** | Bearer API Key（控制台「API Key 管理」创建）；推理接入点（Endpoint ID）可绑定独立限流/计费/监控 |
| **SDK** | 官方 Python/Go SDK；可直接用 OpenAI SDK（改 base_url）|
| **国内/国际** | 国内走火山方舟（ark.cn-beijing.volces.com）；国际可走 BytePlus / 第三方路由（EvoLink、ofox、API易等）|

---

## 七、能力概览

### Seedream（图）
- 分辨率：2K/3K/4K（最高 4096×4096）
- 特色：多图融合（最多 14 参考图）、组图序列（角色/风格连贯，适合分镜漫画）、联网搜索增强（5.0 lite）、交互式精准局部编辑（5.0 Pro）、中文理解强

### Seedance（视频）
- 分辨率：480P / 720P（mini）；最高 1080P / 4K（2.0 / 1.5-pro）
- 时长：4～15 秒（可延长）
- 帧率：24fps（mini）；支持可变帧率
- 特色：文/图/音频/视频四模态输入、音视频联合生成（音频已包含无需额外付费）、视频编辑与延长、真人视频生成无额外费用

---

## 八、media-gen-mcp 适配判定

| 模型类别 | 适配等级 | 说明 |
|---|---|---|
| **Seedream（文生图/图生图）** | **easy** | OpenAI 兼容 `/v3/images/generations`，改 base_url + model 即可用 OpenAI SDK 直调，参数同形（prompt/size/image/response_format）|
| **Seedance（文生视频/图生视频）** | **custom** | 异步任务接口（创建→轮询），非 OpenAI 同步 images 标准，需在 MCP 中写私有 provider（任务创建 + 轮询 + 取结果 + token→费用换算）|
| **即梦 Web（无 API）** | **no-api** | C 端 Web/App 走积分订阅，无开放 API（若仅用即梦 Web 创作则 no-api）|

> **结论**：图片用 Seedream 接火山方舟 = easy；视频用 Seedance 接火山方舟 = custom（异步 provider）。

---

## 九、数据可信度与「需核实」项

| 项 | 状态 |
|---|---|
| Seedream 4.5 单价（0.22 vs 0.25）| **需核实**：官方价格页与 ArcReel 参考有出入，以控制台为准 |
| Seedream 5.0 Pro 高像素分档价（>236 万像素）| **需核实**：公开报道仅给 ≤236 万像素档 |
| Seedance 2.0 / 2.0-fast / Seedream 系列默认 RPM | **需核实**：官方仅明确 mini 的 RPM=60/并发=1，其余随账号等级变动，需控制台查 |
| 50 万 tokens 是否对所有版本独立发放 | **需核实**：表述为"每模型 50 万"，建议控制台确认 |
| Seedance 资源包完整档位（1080P/4K 单价）| 部分「需核实」：仅确认 mini 1400 万=196 元、个别单价，完整档位见官方资源包规则页 |

---

## 数据来源

- 火山方舟模型价格（官方）：https://www.volcengine.com/docs/82379/1544106
- Seedream 5.0 lite API 参考（官方）：https://www.volcengine.com/docs/82379/1541523
- Seedance 2.0 API 参考（官方）：https://www.volcengine.com/docs/82379/1520757
- 火山方舟费用参考（GitHub ArcReel，转录官方）：https://github.com/ArcReel/ArcReel/blob/main/docs/ark-docs/
- 兼容 OpenAI SDK（官方）：https://www.volcengine.com/docs/82379/1330626
- 免费推理额度（官方）：https://www.volcengine.com/docs/82379/1399514
- 安心体验模式（官方）：https://www.volcengine.com/docs/82379/1465347
- Seedance 2.0 系列资源包（官方）：https://www.volcengine.com/docs/82379/2191775
- Seedance 2.0 mini 上线（新浪财经/每日经济新闻）：https://finance.sina.com.cn/stock/t/2026-06-16/doc-inicqnrs9548007.shtml
- Seedream 5.0 Pro 发布（东方财富）：https://wap.eastmoney.com/a/202607083798731061.html
- Seedream 5.0 Pro 价格（科技新知）：https://m.zhidx.com/p/574086.html
- EvoLink Seedance 2.0 定价（第三方路由）：https://evolink.ai/zh/blog/seedance-2-0-pricing-api-cost-guide
- Seedance 2.0 全面开放（中国科技网）：https://www.stdaily.com/web/gdxw/2026-04/14/content_502009.html
- 即梦 AI 全面开放 API（2025-09）：https://www.stdaily.com/web/gdxw/2025-09/02/content_394033.html