# 智谱视觉 Provider 整合调研(GLM-4V + 多 key 轮换)

> 对象:把智谱 GLM-4V 系列视觉模型接入 `media-gen-mcp` 0.11.0 的 vision 模态(与 tesseract / paddle / vlm 并列第 4 个 vision provider),并裁决是否引入跨 provider 的多 key 轮换(KeyPool)。
> 数据时点:2026-07-20。证据来源:A=API 协议调研、B=计费/合规调研、C=架构挂载点调研,三份调研的关键 finding 在各节以【A·k】/【B·k】/【C·k】溯源。
> 代码引用均为仓库 `src/`(0.11.0 已发布版)。

---

## 摘要 / 裁决建议

**一句话结论:智谱视觉模型走纯 OpenAI 兼容路径,且 `GLM-4.6V-Flash` 经官方 `/cn/guide/models/free/` 目录一手证实为永久免费,满足 media-gen-mcp「纯免费」硬约束 —— 智谱作为免费层成立。但「免费 key 池化突破并发」在智谱 User Agreement §2 / §3 + Service Agreement §3.4 三条独立禁止条款下属明确违约,因此本项目不提供、不支持该用法。**

**裁决倾向:GO-WITH-CONDITIONS** —— 三条条件:

1. **接入姿势**:`新建 ZhipuVisionProvider(tier=9) + 抽 ZhipuClient 共享`(选项 A),不复用 VlmProvider(端点 path 前缀不同 `/paas/v4` vs `/v1`)、不扩展 ZhipuProvider(`tier()` 无 modality 参数,见【C·3】)。
2. **KeyPool 通用模块落地,但对智谱免费层降级为单 key + 并发信号量**:横切新建 `src/providers/key-pool.ts`(R-CI-02 强制,vlm/paddle/zhipu 共用),但智谱免费 key 默认单元素数组(退化为 no-op)+ in-flight semaphore + 1302 指数退避;KeyPool 仅对「用户自带的多个**付费** key」生效。
3. **显式合规声明**:README + 源码注释必须写明「智谱多账号/多免费 key 池化违反智谱 User Agreement §2/§3 + Service Agreement §3.4,本项目不提供也不支持」,规避教唆违约与潜在下架/封禁风险。

---

## 1. 智谱视觉 API 协议(A 调研整理)

### 1.1 端点 = OpenAI 兼容 v4 路径(双证)

- 官方 OpenAPI spec(`docs.bigmodel.cn/api-reference/模型-api/对话补全.md`)`servers.url='https://open.bigmodel.cn/api/'`,`paths['/paas/v4/chat/completions']`,`security` 段单一 `bearerAuth: []`(无单独 JWT 方案)。【A·1】
- 实探:`curl -H "Authorization: Bearer INVALID_KEY_FOR_PROBE"` 打该端点,服务器返 HTTP 401 + `{"error":{"code":"401","message":"令牌已过期或验证不正确"}}` —— 服务器**接受了 Bearer scheme 并校验 token**,而非拒绝「缺 JWT」。响应头含 `x-log-id`,**无任何 `X-RateLimit-*` 头**。【A·1】

**对 VlmProvider/ZhipuProvider 的影响**:端点、认证方案与 OpenAI Vision API 完全对齐,只需把 baseUrl 指到 `https://open.bigmodel.cn/api/paas/v4`、走标准 `Authorization: Bearer {apiKey}`、model 填 glm 系列,无需改请求构造。

### 1.2 认证:`{id}.{secret}` 直接作 Bearer 即可,JWT 是 SDK 可选优化

SDK 源码 `zhipuai/_client.py:76-82` 的 auth_headers 有两条路径【A·2】:

- `if self._disable_token_cache: return {'Authorization': f'Bearer {api_key}'}`(api_key 原样作 Bearer)
- else 走 `_jwt_token.generate_token(api_key)`(按 `.` split 成 id+secret,签 HS256 JWT,缓存 3 分钟)

推论:① 现代 api_key 格式就是 `{id}.{secret}`;② 该串可直接作 Bearer(官方 OpenAPI 仅声明 bearerAuth);③ JWT 生成只是 SDK 端「兼容旧 v3 / 减少 401」的优化,**非服务端硬性要求**。v3(旧)无 plain-key 支持、必须 JWT;**v4 两者都接受**。

**实现取向**:把 `{id}.{secret}` 整串作为 Bearer apiKey 传入即可,无需在 provider 里实现 JWT 签名/HS256/cachetools。**开放问题**:未用真实有效 key 实发一次请求 100% 坐实,接入时建议先跑一次 curl 验证,若偶发 401 再加轻量 JWT fallback(按 `.` split 签 HS256)。

### 1.3 视觉模型清单(纠偏:glm-4v-plus / glm-4.5v 已退役)

任务原设的 `glm-4v-plus` / `glm-4.5v` 在 model-overview 与 llms.txt 中均已不存在。当前可用视觉模型(均走同一 v4 chat/completions 端点)【A·4】:

| 模型 | 免费/付费 | 上下文 | 能力要点 |
|---|---|---|---|
| **GLM-4.6V-Flash** | **免费** | 128K / 32K 输出 | 视觉推理+OCR+复杂表格+图表+视频+文件,Function Call 原生,可关思考 —— **最强免费,首选** |
| GLM-4.1V-Thinking-Flash | 免费 | 64K | 深度思考,复杂场景/多步分析 |
| GLM-4V-Flash | 免费 | 16K / 1K 输出 | 基础图像理解,弱 legacy |
| GLM-5V-Turbo | 付费 | 200K | 多模态 Coding 基座 |
| GLM-4.6V | 付费 | 128K | 视觉推理旗舰 |
| GLM-OCR | 付费 | 单图≤10MB / PDF≤50MB≤100页 | 专用高精文档解析 |
| GLM-4.1V-Thinking-FlashX | 付费 | — | 轻量推理 |

GLM-4.6V-Flash 文档明确列出「通用 OCR 识别(印刷/手写/楷体/艺术字)、复杂表格(多层表头/合并单元格/跨页)、图表分析、图像内容分析」。

**media-gen-mcp 4 工具映射**:

- `extract_text` → `glm-4.6v-flash`(免费)或 `glm-ocr`(付费最精)
- `extract_table` → `glm-4.6v-flash`
- `analyze_chart` → `glm-4.6v-flash` / `glm-4v-flash`
- `describe_image` → `glm-4.6v-flash`

**推荐默认 model=`glm-4.6v-flash`**(免费 + 能力全覆盖 + 128K),`glm-4v-flash` 仅作极轻量兜底。**配置勿填 `glm-4v-plus` / `glm-4.5v`**(会触发 1211 模型不存在)。

### 1.4 请求体 = 纯标准 OpenAI chat/completions 多模态

OpenAPI 的 `ChatCompletionVisionRequest` 示例(model: glm-5v-turbo)的 content 即【A·3】:

```json
[
  {"type": "image_url", "image_url": {"url": "https://..."}},
  {"type": "text", "text": "What are the pics talk about"}
]
```

与 OpenAI Vision 一字不差。另支持 `video_url` / `file_url` / `input_audio` 同类 content block。图片 url 接受 https 直链和 `data:image/jpeg;base64,...`(SDK README 多模态示例证实)。响应 `ChatCompletionResponse` / 流式 `ChatCompletionChunk`(SSE)、错误 `Error` schema 均标准。Zhipu 仅多一个非破坏性 `thinking:{type:enabled}` 字段(推理开关,放 extra_body)。

**结论**:`extract_text/extract_table/analyze_chart/describe_image` 4 工具的 prompt 构造、image_url 拼装、base64 data URI、`response.choices[0].message.content` 解析全部可原样复用 VlmProvider 现有 `chat()` 逻辑,**零格式适配**。

### 1.5 限额信号:HTTP 429 + body.error.code 业务码细分(不是标准 Retry-After 头)

官方错误码表(`cn/api/api-code.md`),限额类全部返回 HTTP 429,body.error.code 为业务码【A·5】:

| 业务码 | HTTP | 语义 | 性质 | 应对 |
|---|---|---|---|---|
| **1302** | 429 | 账户速率限制/并发超限 | **瞬态** | 指数退避重试同 key |
| **1305** | 429 | 模型平台服务过载 | **瞬态** | 稍后重试(全局,换 key 无意义) |
| **1113** | 429/402 | 账户欠费 | **粘性** | 切下一把 key(充值) |
| **1308** | 429 | 已达到 N 单位使用上限 | **粘性** | 切 key(额度在 next_flush_time 重置) |
| **1310** | 429 | 每周/每月上限 | **粘性** | 切 key(本次调研工具自身被 1310 挡过) |
| **1316/1317/1318** | 429 | 5小时/7天/子账号上限 | **粘性** | 切 key |
| **1311** | 429 | 订阅套餐不含该模型 | **粘性** | 切 key 或降级模型 |
| **1313** | 429 | 公平使用策略被限 | **账号级惩罚** | 长时间规避 |
| **1000/1001/1003** | 401 | key 失效 | **死** | 标死该 key |
| 1301 | 400 | 内容审核 | 不可重试 | — |
| 1213/1214/1261 | 400 | 参数错/超长 | 不可重试 | — |

**关键差异**:「免费额度耗尽」(1308/1310/1316/1317,粘性,带 reset 时间)与「RPM/TPM 瞬态超限」(1302,可重试)是**不同业务码、同处 HTTP 429**。

**无标准 Retry-After / X-RateLimit-Reset 响应头**(三连证据)【A·6】:① 官方 rate-limit.md 通篇只讲并发数/套餐等级/错误码应对,完全没提 `Retry-After`;② SDK `_http_client.py:319-321` 把 `_parse_retry_after_header` 整段注释掉,改为只认 `x-should-retry` 头 + 状态码;③ 重置时间只出现在 body.error.message 本地化文本里(如「...将在 2026-07-24 00:30:40 重置」),需正则提取。

**KeyPool 必须按 body.error.code 分流而非仅看 HTTP 429**。

### 1.6 流式 SSE + Function Call(完整性,均 OpenAI 兼容)

OpenAPI 端点 responses 段同时声明 `application/json`(非流式)与 `text/event-stream`(SSE 流式)【A·7】;Function Call:`tools:[{type:'function',function:{name,description,parameters}}]` + `tool_choice:'auto'`,与 OpenAI 工具调用结构一致,GLM-4.6V-Flash 是首批原生支持 Function Call 的视觉模型。

**结论**:media-gen-mcp 当前 4 工具用非流式 + 自然语言 prompt 即可,流式/function call 非必需。若未来想让视觉模型直接产出结构化 JSON 表格,可借助 function call / response_format,协议层已备好,VlmProvider 同样免改。

---

## 2. 计费与「纯免费」立场(B 调研整理)

### 2.1 GLM-4V-Flash 系确认完全免费(对标 GLM-4-Flash 文本策略)

智谱官方文档 `docs.bigmodel.cn/cn/guide/models/free/glm-4v-flash` 明确写「GLM-4V-Flash 是智谱推出的首个完全免费的图像理解模型」,目录直接归在 `/cn/guide/models/free/` 下【B·1】。其升级版 **GLM-4.6V-Flash**(128K / 32K 输出 / 原生 Function Call)、GLM-4.1V-Thinking-Flash 同样归在 free 类目,**均为持续免费(非限时)**。对标 GLM-4-Flash 文本免费策略,flash 系视觉也持续免费。

**对「纯免费」立场的影响**:**GLM-4V-Flash / GLM-4.6V-Flash 满足 media-gen-mcp 的纯免费硬约束**,可作为 tesseract(WASM)与 paddle 之外第三个「vision 第三模态」的零成本候选 provider,与 paddle/vlm 复用同一 fallback 链路。**智谱作免费层成立**。

### 2.2 付费视觉矩阵(仅作用户自备付费 provider)

付费视觉模型矩阵(2026.07)【B·2】:GLM-5V-Turbo(多模态 Coding 基座,200K)、GLM-4.6V(106B 视觉推理旗舰)、GLM-4.6V-FlashX(9B 轻量)、GLM-4.1V-Thinking-FlashX、GLM-OCR、AutoGLM-Phone。定价页 `open.bigmodel.cn/pricing` 为纯 JS 渲染 SPA,curl 拿不到 JSON;WebSearch 训练数据快照显示 GLM-4V-Plus 历史价 ≈ ¥0.05/千 token(=¥50/百万,input/output 同价),GLM-4.5V ≈ ¥14/百万 token,均非一手来源。

**对项目的影响**:付费视觉(GLM-4V-Plus / 4.5V / 4.6V / 5V-Turbo)在 media-gen-mcp 里只能作为「用户自备付费 key」provider,与现有 vlm(vLLM-OpenAI 兼容)同级;**不能进免费 fallback 链**。GLM-4.5V 在最新 model-overview 中已被 GLM-4.6V 替代,新接入应优先考虑 GLM-4V-Flash(免费) + GLM-4.6V(付费旗舰)组合,不再针对已淘汰的 4.5V 做适配。

### 2.3 免费额度与新用户礼包规则(V0 锁死 = 真实瓶颈)

- **新用户**:服务协议 §2.3 定义「平台体验金」,默认有效期「自发放之日起 30 天」,不可提现/转让/开票;活动页显示通过邀请链接注册的被邀请人获 2500 万 Tokens 新用户礼包;每月每用户最多邀 10 人。【B·3】
- **持续免费**:flash 全系(GLM-4V-Flash / 4.6V-Flash / 4.1V-Thinking-Flash / GLM-4-Flash / 4.5-Flash / 4.7-Flash)非限时免费。
- **V 等级**:用户权益页(equity-explain)明确「赠金账户的余额消耗不会换算到积分内」—— 免费 user 永远卡在 **V0(最低并发)**。

**对项目的影响**:纯免费用户 = 体验金 30 天有效 + flash 系永久免费;30 天后只有 flash 系还能用。**V0 锁死意味着免费用户并发极低(通常个位数)**,这是免费层在 media-gen-mcp 实战中的真实瓶颈,**必须用排队/退避而非多 key 来缓解**。

### 2.4 限额维度 = 并发数(非 RPM/TPM),按账号×模型×权益等级,数值不公开

官方 rate-limit.md 明确【B·4】:「智谱对不同模型设置了不同的并发数上限」「并发数指的是:同一时刻正在处理中的请求数量」。权益 V0[0,2000 积分) / V1 / V2 / V3 四档;积分仅来自现金消耗(1:1),不含赠金。高峰时段(工作日 15:00-18:00)动态限流。**具体并发数值平台不公开**,只在控制台 `bigmodel.cn/usercenter/proj-mgmt/rate-limits` 展示。

**对项目的影响**:media-gen-mcp **不能像 OpenAI 那样按 RPM 写固定阈值切 key**;智谱 KeyPool 设计应基于**并发计数(in-flight request semaphore)**而非时间窗口 RPM。冷却触发:

- 1302 → 该 key 短期冷却(秒级,退避后重试同 key)
- 1305 → 全局冷却(对所有 key 同样命中,轮换无意义,直接跨 provider fallback)
- 1310 → 长期冷却(30 天或永久,该 key 失效)
- **对免费 GLM-4V-Flash,只有 1302 风险(无余额),没有 1310**(额度无限)。

### 2.5 多 key 池化的合规风险(三条独立禁止条款)—— 核心结论

**(A) 注册门槛**【B·5】:用户协议 §2「账户注册是指用户利用享有权利的移动电话号码…注册账号」+ 服务协议 §3.1「您应该具有完全的民事行为能力,并拥有经实名认证成功后的大模型开放平台账户」—— 即 **1 手机号 + 实名认证(中国 ID 卡体系) = 1 账号 = 1 API key**。

**(B) 多账号禁止(核心)**:用户协议 §2 原文「如有证据证明或大模型开放平台根据相关规则判断您存在**不当注册或不当使用多个大模型开放平台账户**的情形,大模型开放平台可采取冻结或关闭账户、拒绝提供服务等措施」。

**(C) 账号共享禁止**:用户协议 §3「您的大模型开放平台账户仅限您本人使用。**未经大模型开放平台同意,您直接或间接授权第三方使用您大模型开放平台账户…的行为无效**」;服务协议 §3.4「未经智谱…书面同意,您不得复制、转让、出售、出租、**出借**、许可、**提供他人使用**」;§11.6 禁止转让协议权利。

**(D) 以他人名义再注册**:协议终止条款「再一次直接或间接以他人名义注册为大模型开放平台用户的,大模型开放平台有权再次单方面终止」。

**(E) 免费层平台保留限制权**:用户协议「大模型开放平台保留对免费服务的接入方式、使用范围、功能特性、**使用频率**、数据容量等方面施加合理限制的权利」。

**结论:多 key 池化在智谱 ToS 下属明确违约行为,不是灰色地带**。User Agreement §2 + Service Agreement §3.4 是双 locked-in 条款,平台有单方面冻结/封号/拒绝服务权利。即使技术检测对低频用户稀疏,contractual exposure 清晰;media-gen-mcp 作为公开 npm 包若内置 key pool 文档化,等于**教唆违约**,可能被智谱要求下架或封禁其官方测试 key。

**因此 media-gen-mcp 不应实现 Zhipu 免费层 key pool。**

---

## 3. 整合决策:新 provider vs 扩展现有

基于 C 调研,对三个候选逐一裁决:

### 选项 A:新建 `src/providers/zhipu-vision.ts`(ZhipuVisionProvider)+ 抽 ZhipuClient 共享 —— **采纳**

**理由【C·3】**:

- 现有 `ZhipuProvider.zhipu.ts:193` 的 `tier(): number { return 5; }` 是**无 modality 参数**的单值(types.ts:285 `tier?(): number`),无法同时返 image/video=5 和 vision=9。若扩展现有 ZhipuProvider 持三能力组,`tier()` 单值约束被破坏。
- `capabilities()` / `health()` 字段语义会按模态分裂 —— 是 R-ABS-01「按 caller 分流」的信号。
- 但若各 provider 完全独立各写一份 `request()` + 认证 + 限流学习,违反 R-CI-02「同一类操作多种实现方式 = >1 种即 🟡 违例」。

**混合方案**:抽出约 30 行的 `ZhipuClient`(私有 class,持 apiKey/baseUrl/learnRateLimit/request),`ZhipuProvider` 和新建 `ZhipuVisionProvider` 各自注入此 client。R-CI-02(认证/HTTP/限流一处)与 R-ABS-01(无 tier 分流)双满足。**ZhipuClient 不必独立文件,作 zhipu.ts 内部 class 即可**。

### 选项 B:扩展 VlmProvider 支持智谱(baseUrl 预设)—— **否决**

**理由【C·2】**:

- `VlmProvider.vlm.ts:114` 走 `${baseUrl}/v1/chat/completions`(vLLM 默认 OpenAI 路径),Bearer 可空(自托管)。
- 智谱走 `/paas/v4/chat/completions`(智谱 paas v4 自有路径),Bearer 必填。
- 请求 body 几乎一致(messages[].content 数组格式相同),但 **path 前缀不同 → 智谱不能直接走 vlm 路径配 baseUrl**。
- 若在 VlmProvider 内加 if(provider==='zhipu') 改 path,触发 R-ABS-01 🔵「按 provider 名分流」违例。

两 provider 都该存在,不是二选一。chat() 内的 messages 构造、JSON 解析、content 抽取逻辑可抽 shared helper(进一步 R-CI-08 DRY-as-decisions),但 provider 边界分开。

### 选项 C:扩展现有 ZhipuProvider(图像)加视觉能力 —— **否决**

**理由【C·3】**:tier 单值约束下,同一 class 既持图像(tier=5)又持视觉(目标 tier=9)无法表达;且 `capabilities()` 的 image/video 字段会与 vision 能力组语义冲突(VisionProvider 的能力单一真值源是 `visionTasks()`,不进 ProviderCapabilities)。强行扩展会让一个 class 持三能力组、tier/capabilities/health 字段语义分裂,R-ABS-01 + R-CI-08 双红灯。

### 取舍小结(R-CI-02 / R-ABS-01 视角)

| 方案 | R-CI-02(复用) | R-ABS-01(无分流) | 裁决 |
|---|---|---|---|
| A 新建 + 抽 ZhipuClient | ✅ Client 单一真源 | ✅ tier 各自独立 | **采纳** |
| B 扩展 VlmProvider | ✅ 复用 chat() | ❌ path 前缀 if 分流 | 否决 |
| C 扩展 ZhipuProvider | ✅ 复用 request() | ❌ tier 单值约束破 | 否决 |

---

## 4. 多 key 轮换 KeyPool 设计(核心)

### 4.1 横切复用裁决:新建 `src/providers/key-pool.ts` 通用模块(R-CI-02 强制)

**裁决:KeyPool 必须横切复用 —— 新建 `src/providers/key-pool.ts` 让 zhipu/vlm/paddle 共用,不是 zhipu 私有。**

**理由【C·4】**:R-CI-02 定义「同一类操作多种实现方式 = >1 种 即 🟡 违例」。若 zhipu/vlm/paddle 各自写一套 key 轮换,就是 3 种做法。KeyPool 是有实际逻辑的真实抽象(acquire 选 key + cooling/exhausted 状态机 + LRU),**非穿堂(pass-through),不违 R-DEP-03**。KeyPool **不进 VisionProvider 接口**(是 provider 私有依赖),VisionProvider 接口保持 `recognize/visionTasks/listVisionModels` 不变,**R-INT-03 不破**。

**与 §2.5 合规结论的调和**:

- KeyPool 通用模块本身**合规中性**(它只是一个状态机工具,可服务于用户自带的多个付费 key,与 paddle/vlm 现有模式同形)。
- **不合规的是「智谱免费层多 key 池化」这一具体用法**。所以模块照建,但在智谱侧:
  - 默认 config 单 key(`apiKeys: [process.env.ZHIPU_API_KEY]` 单元素数组 → KeyPool 退化为 no-op)
  - README + 源码注释显式声明「智谱多账号/多免费 key 池化违反智谱 User Agreement §2/§3 + Service Agreement §3.4,本项目不提供也不支持」
  - KeyPool 仅对「用户主动提供的多个**自有付费** key」生效(如 paddle/vlm 已有模式)

### 4.2 KeyPool 状态机与接口

**KeyState**【C·5】:

```ts
interface KeyState {
  key: string;
  status: "live" | "cooling" | "exhausted";
  cooldownUntil: number; // ms timestamp,0 = 无冷却
  lastUsedAt: number;
}
```

**接口**:

| 方法 | 行为 |
|---|---|
| `acquire(): string \| undefined` | round-robin + 跳过 cooling/exhausted;**全部 cooling 时取最早进入 cooling 的(LRU)**;全部 exhausted 返 undefined |
| `markLimited(key, cooldownMs=60_000)` | **纯同步无 await**;429/1302 → 立即设 `cooldownUntil=Date.now()+cooldownMs`(默认 60s,与 zhipu.ts:195 notifyUnavailable 对齐) |
| `markExhausted(key)` | 402/额度耗尽 1113/1308/1310/1316/1317/1318 / 403 / 401 key 失效 → 永久禁用 |
| `health()` | `{ total, live, cooling, exhausted }` 诊断 —— **只输出计数,不输出 key 字面值**(防 config.json 回写泄露,见【C·openQ】) |

**KeyPool 接收 `string[]`(来自 config.apiKeys);空数组或单元素 → 退化为 no-op**(直接返唯一 key 或 undefined),保证旧配置零回归。provider 构造时:

```ts
this.pool = new KeyPool({
  keys: c.apiKeys?.length ? c.apiKeys : (c.apiKey ? [c.apiKey] : []),
});
```

### 4.3 轮换策略(round-robin + 跳过受限)

- 维护 `cursor` 指针,lastUsedAt 排序兜底
- acquire 顺序:`live` 候选中按 round-robin → 若无 live,取 `cooling` 中 cooldownUntil 最小者(最早解冻,LRU)→ 若无 cooling,返 undefined
- 不实现随机/加权(避免引入非确定性,与 02 清单可观测性一致)

### 4.4 并发安全对策(竞态对策:同步 markLimited + 乐观策略)

**风险【C·6】**:Node 单线程但 async gap 间 `acquire()` 会被多个并发请求交叉调用。关键防线:`markLimited` 必须**纯同步无 await**,收到 429 立即标 `cooldownUntil`,下一个 `acquire()` 的同步代码立即跳过该 key(Node 单线程内的同步块天然原子)。

**仍存在的窗口**:N 个并发请求在 `markLimited` 前都已 acquire 到同一 key,会同时打到限额 key。

**对策(乐观)**【C·6】:允许短暂并发同 key,失败后 `markLimited`,后续请求自动切;**无需 Promise 队列串行化**(仿 zhipu.ts:315-324 submitChain 的串行方案对 vision 不必要,因 vision 无视频那种 per-account 并发在途上限)。实现:

```ts
async request(path, init) {
  const key = this.pool.acquire();
  if (!key) throw Object.assign(new Error("all keys exhausted"), { status: 429 });
  try {
    return await this.doFetch(key, path, init);
  } catch (e) {
    if (this.classifyAndMaybeMark(key, e)) {
      // 瞬态 → 已 markLimited,递归重试下一 key(上限 = keys.length)
      return this.request(path, init);
    }
    throw e; // 粘性/死错 → 抛给上层
  }
}
```

重试上限 = `keys.length`,全部 cooling/exhausted 后 throw 带 `.status=429` 的错误给 `isFallbackWorthy`。

### 4.5 触发信号区分(智谱业务码分流表)

| 信号(http.ts 判定) | KeyPool 动作 | 上层动作 |
|---|---|---|
| HTTP 429 + code 1302(账户并发) | `markLimited(key, 30_000)`(短冷却) | 重试下一 key |
| HTTP 429 + code 1305(平台过载) | 不 markKey(全局性,换 key 无意义) | throw → 跨 provider fallback |
| HTTP 429 + code 1113/1308/1310/1316/1317/1318(额度耗尽) | `markExhausted(key)` | 切下一 key;全耗尽 → 跨 provider fallback |
| HTTP 429 + code 1311(套餐不含模型) | `markExhausted(key)` 或降级模型 | 切 key 或 model 降级 |
| HTTP 429 + code 1313(公平使用惩罚) | `markExhausted(key)`(账号级,长规避) | 跨 provider fallback + 日志告警 |
| HTTP 401 + code 1000/1001/1003 | `markExhausted(key)`(key 失效) | 跨 provider fallback |
| HTTP 400(1301/1213/1214/1261) | 不动 key(非额度/限流) | 抛业务错,不 fallback |

**注**:智谱无标准 Retry-After 头(§1.5),故 KeyPool 不读头,按 body.error.code 查表。简单版按业务码查退避档;精细版可正则解析 message 里的 reset 时间换算绝对 sleep(本次不实现,留 openQ)。

### 4.6 config 配置形态(向后兼容单 key)

**【C·8】** `config.ts:42-56` 的 `buildProviders()` 现在产出 `apiKey: p.apiKey ?? process.env[...]`。扩展为:

```ts
out[name] = {
  apiKey: p.apiKey ?? process.env[`${upper}_API_KEY`] ?? "", // 向后兼容
  apiKeys: p.apiKeys ?? (p.apiKey ? [p.apiKey] : (process.env[`${upper}_API_KEY`] ? [process.env[`${upper}_API_KEY`]] : [])),
  baseUrl: p.baseUrl ?? process.env[`${upper}_BASE_URL`] ?? "",
  // ... 其余不变
};
```

**无破坏性变更**:旧 config.json 不动也能跑;新 config.json 可写 `providers.zhipu.apiKeys: ["{id1}.{secret1}","{id2}.{secret2}"]` 启用轮换(仅限用户自有付费 key)。`ZHIPU_API_KEY` 环境变量仍工作(转单元素数组)。文档补一条:**多 key 用 apiKeys 数组;智谱免费层请保持单 key**。

---

## 5. 与 provider 级 fallback 的分层协作

### 5.1 两层职责划分

**现状两层已通,无需改**【C·7】:

- **key 级(KeyPool,在 provider 内)**:provider 私事。所有 key 耗尽时 throw 带 `.status=429` 的错误 → `notifyUnavailable` 设 cooldownUntil=60s(已存在,zhipu.ts:195)。
- **provider 级(上层路由)**:`http.isFallbackWorthy`(429/401/403/5xx/TypeError → true,http.ts:25-31)判定单 provider 错误是否值得切;`registry.getFallbackProvider`(registry.ts:318-328)按 `health(configured & !cooldown)` + `capableOf` + `tier` 降序选下一家。

**两层之间唯一契约 = 带 `.status` 的错误**(isFallbackWorthy 既有契约)。KeyPool **不感知** provider 级 fallback。

### 5.2 时序(vision task 跨 provider fallback,含 KeyPool)

```
extract_text(image)
 └─ runVisionTask("extract-text", image, hints)  [index.ts:83 helper]
     └─ resolveProvider(task="extract-text") → paddle (tier 10, 主力)
         └─ paddle.recognize() → 1302 (本地无 key 池,直接 throw)
             │ isFallbackWorthy(429) → true
             ├─ getFallbackProvider("paddle","vision",{task:"extract-text"})
             │   filters: configured & !cooldown & capableOf(extract-text)
             │   → zhipu-vision (tier 9) ← 新增 provider
             │
             └─ zhipu-vision.recognize()
                 └─ pool.acquire() → key1
                     └─ fetch /paas/v4/chat/completions
                         ├─ 200 → 解析 content → 返回 ✅
                         ├─ 429 code 1302 → pool.markLimited(key1,30s) → 重试
                         │   └─ pool.acquire() → key2 (仅付费多 key 场景)
                         │       └─ fetch → 429 code 1113(额度耗尽)
                         │           └─ pool.markExhausted(key2)
                         └─ pool.acquire() → undefined (全耗尽)
                             └─ throw { status: 429 } → notifyUnavailable(60s 熔断)
                                 │ isFallbackWorthy(429) → true
                                 ├─ getFallbackProvider("zhipu-vision",...)
                                 │   → vlm (tier 8)
                                 │       └─ vlm.recognize() → ✅ 或失败
                                 │           └─ getFallbackProvider → tesseract (tier 1) 兜底
```

**关键点**:

- KeyPool 在 provider 内自我消化 key 轮换(瞬态 1302、粘性 1113);
- KeyPool 全耗尽 = 该 provider 「不可用」→ 通过既有的 `isFallbackWorthy` + `getFallbackProvider` 切下一 provider;
- 1305(平台过载)是全局性,对所有智谱 key 同时命中 → 不走 KeyPool,直接跨 provider fallback(paddle/tesseract 接管);
- 1310(免费层不存在,见 §2.4)/1313(账号惩罚)→ 长/永久熔断该 key,日志提示「额度耗尽或体验金过期,请充值或换 key」但**不自动换**(避免教唆)。

---

## 6. tier 定位

**【C·9】 tier 定位建议:智谱视觉 = 9**(高于 vlm=8,低于 paddle=10)。

| provider | tier | latency | accuracy | role |
|---|---|---|---|---|
| tesseract | **1** | instant(进程内 WASM) | low | 零配置兜底 |
| vlm | **8** | moderate(本地 vLLM GPU) | high | describe/chart 增强 + fallback(完整 VQA),需用户自部署 |
| **zhipu-vision** | **9**(新增) | slow(云 API) | high | **云 API 视觉主力(VQA + 中文 SOTA),vlm 的免部署替代** |
| paddle | **10** | fast(本地 serving) | high | 全能主力(中文 SOTA + 表格 + 图表 + 描述全 task) |

**tier=9 的理由**:

1. 云 API latencyTier=slow 但中文 accuracyTier=high(GLM-4V 中文优化强于 Qwen2.5-VL);
2. **0 部署成本**(vlm 需用户自部署 vLLM GPU server,实际配置率极低,见 vlm.ts:8-12 部署手册);
3. 低于 paddle(10)因 paddle 本地无网络且支持表格/图表/描述全 task,智谱视觉主要强项是 VQA + 多语。

**vision task 路由优先级**:

- `extract-text` / `extract-table` → paddle(10)主力,**智谱视觉不实现这两个 task**(`visionTasks()` 只返 `['describe-image','analyze-chart']`,与 vlm 同形)
- `analyze-chart` → paddle(10)→ zhipu-vision(9)→ vlm(8)
- `describe-image` → **智谱视觉接管 VQA 主力**(云 API 中文 SOTA + 免部署),与 vlm 形成「云 vs 本地」双主力;按 configured 状态 + tier 自动选

**`describeVisionOptions()` 应标** `latencyTier:'slow'` / `accuracyTier:'high'` / `role:'云 API 视觉主力(VQA + 中文 SOTA),vlm 的免部署替代'`(对称 vlm.ts:72-84)。

**开放风险**:glm-4v 真实响应延迟未量化,若实测 >10s/请求,可能需降到 tier=7 让 vlm 本地优先 —— 接入后用真实 key 跑延迟基准再定档。

---

## 7. 实施步骤 + 改动文件清单

### 有序步骤

1. **落 KeyPool(0 消费者)**:新建 `src/providers/key-pool.ts`,单元测试覆盖 acquire 轮换 / LRU / 全耗尽 / 同步 markLimited 竞态。
2. **抽 ZhipuClient**:重构 `src/providers/zhipu.ts`,把 apiKey/baseUrl/request/learnRateLimit 抽到内部 `ZhipuClient` class;ZhipuProvider 注入此 client(单 provider 验证 R-CI-02)。
3. **新建 ZhipuVisionProvider**:`src/providers/zhipu-vision.ts` implements `VisionProvider`,注入 ZhipuClient + KeyPool;`visionTasks()` 返 `['describe-image','analyze-chart']`;复用 VlmProvider 的 `promptFor()` 逻辑(抽 shared helper)。
4. **注册 + 路由**:`registry.ts` 加 `zhipu-vision` 实例,注入 KeyPool(config.apiKeys 单 key 默认);`buildVisionRoutingGuidance` 自动跟随(无需硬编码)。
5. **config 多 key**:`config.ts` 加 `apiKeys: string[]` 字段,向后兼容单 key。
6. **http 业务码分流**:`http.ts` 加智谱业务码分类器(`classifyZhipuError(body) → 'transient'|'sticky'|'dead'|'global'`),KeyPool 按分类决策。
7. **handler 透传**:`index.ts` 的 `runVisionTask` 已是单一 helper,vision 4 工具零改动透传新 provider;`list_vision_capabilities` 自动聚合。
8. **README + 注释合规声明**:README「Provider 配置」+ zhipu-vision.ts 顶部注释,显式声明「智谱多账号/多免费 key 池化违反智谱 User Agreement §2/§3 + Service Agreement §3.4,本项目仅支持用户自带的多个自有付费 key」。
9. **真 key 验证** + 延迟基准:用真实 `{id}.{secret}` 跑一次 curl 坐实 plain Bearer(§1.2 openQ),跑延迟基准坐实 tier=9(§6 openQ)。

### 改动文件清单

| 文件 | 改动 |
|---|---|
| **`src/providers/key-pool.ts`**(新建) | KeyPool class:acquire/markLimited/markExhausted/health;KeyState 状态机;同步 markLimited;LRU 兜底;health 只输出计数 |
| **`src/providers/zhipu.ts`**(重构) | 抽内部 `ZhipuClient`(apiKey/baseUrl/request/learnRateLimit);ZhipuProvider 注入 client;认证/HTTP/限流学习单一真源 |
| **`src/providers/zhipu-vision.ts`**(新建) | ZhipuVisionProvider implements VisionProvider;注入 ZhipuClient + KeyPool;visionTasks=['describe-image','analyze-chart'];复用 promptFor shared helper;describeVisionOptions 标 latency=slow/accuracy=high/tier=9;ToS 合规注释 |
| **`src/providers/vlm.ts`**(小改) | 抽 `promptFor(req)` 到 `src/providers/vision-prompt.ts` shared helper,zhipu-vision 复用(R-CI-08 DRY-as-decisions) |
| **`src/providers/vision-prompt.ts`**(新建) | shared `promptFor(req: VisionRequest): string`(从 vlm.ts:35-44 抽出) |
| **`src/providers/registry.ts`**(扩展) | import + 注册 zhipu-vision 实例,注入 KeyPool;buildVisionCapabilitiesDetail/buildVisionRoutingGuidance 自动跟随(零硬编码) |
| **`src/config.ts`**(扩展) | buildProviders() 加 apiKeys: string[] 字段(向后兼容单 key:apiKey 单字符串 → 单元素数组) |
| **`src/providers/http.ts`**(扩展) | 加 `classifyZhipuError(body) → 'transient'|'sticky'|'dead'|'global'` 业务码分流器(1302 transient / 1305 global / 1113/1308/1310/1316/1317/1318 sticky / 1000-1003 dead) |
| **`src/index.ts`**(零改) | runVisionTask helper 已单一;vision 4 工具 + list_vision_capabilities 自动透传新 provider |
| **`README.md`**(扩展) | Provider 配置节加 zhipu-vision 段;**显式合规声明**;apiKeys 数组用法 |
| **测试**(新建) | key-pool.test.ts(状态机+竞态)、zhipu-vision.test.ts(mock fetch 验证 OpenAI 兼容请求体、1302/1113/1310 分流) |

---

## 8. 风险 + 缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **合规风险(多账号 ToS)**:智谱 User Agreement §2 + §3 + Service Agreement §3.4 三条独立禁止条款,平台有单方面冻结/封号权。media-gen-mcp 作为公开 npm 包若文档化免费 key pool,等于教唆违约,可能被下架/封官方测试 key。 | (1) **不实现智谱免费层 key pool**,默认单 key + in-flight semaphore + 1302 退避;(2) README + 源码注释显式声明违约风险;(3) KeyPool 仅对用户自带付费 key 生效;(4) 不在文档/示例里展示「注册多个免费账号」话术 |
| R2 | **限额信号误判**:智釉 429 + 业务码组合复杂,若 KeyPool 把粘性(1113/1310)误判为瞬态,会反复打已耗尽 key 浪费配额;若把瞬态(1302)误判为粘性,会过早标死可用 key。 | `http.ts` 加 `classifyZhipuError` 业务码查表(§4.5),单元测试覆盖全部 11 个业务码;灰度期间日志记录每次分类决策便于回溯 |
| R3 | **key 泄露(config.json 权限)**:`persistProviderField` 会回写 config.json(zhipu.ts:248),若 KeyPool.health() 不慎回显 key 字面值,会被持久化到磁盘;config.json 默认 0644 其他用户可读。 | (1) KeyPool.health() **只输出计数**(total/live/cooling/exhausted),不输出 key 值;(2) 文档建议用户 `chmod 600 ~/.media-gen-mcp/config.json`;(3) 日志里 key 一律脱敏(只显前 8 位 + ...) |
| R4 | **全 key 耗尽的降级路径**:智谱所有 key 耗尽(免费 V0 并发打满 / 付费额度耗尽)时,若上层 fallback 链断裂,用户看到不透明 429。 | KeyPool 全耗尽 throw 带 `.status=429` 错误 → `isFallbackWorthy` true → `getFallbackProvider` 切 paddle(10)→vlm(8)→tesseract(1);最终 tesseract 兜底(进程内 WASM,永不为零)。错误信息含「智谱全 key 不可用,已 fallback 到 {provider}」 |
| R5 | **glm-4v-plus / glm-4.5v 已退役**:任务原设的两个模型名会触发 1211 模型不存在。 | 默认 model=`glm-4.6v-flash`(免费首选);config schema 校验拒绝退役模型名并给清晰提示;文档更新 |
| R6 | **V0 并发锁死(免费用户真实瓶颈)**:免费 user 永远 V0,并发数极低(个位数),高并发场景频繁 1302。 | in-flight request semaphore(provider 内置,限并发 ≤ 配置阈值,默认 2);1302 指数退避(30s→60s→120s);**不靠多 key 突破**(违 ToS,见 R1);文档建议生产场景配 paddle(本地无并发上限)或付费 vlm |
| R7 | **1305 平台过载误判**:1305 是全局性,若 KeyPool 把它当 per-key 限流 markLimited,会逐个标死所有 key(实际换 key 无意义)。 | `classifyZhipuError` 把 1305 标 'global',**不动 key 池**,直接 throw → 跨 provider fallback(§5.2) |
| R8 | **JWT fallback 未实证**:plain `{id}.{secret}` 作 Bearer 在 v4 是否 100% 通过,仅有 OpenAPI 声明 + SDK disable_token_cache 分支 + 实探 401 三证,未用真 key 实发。 | 接入 step 9 用真 key 跑 curl 坐实;若偶发 401,加轻量 JWT fallback(按 `.` split + HS256 签名,3 分钟缓存),作 provider 内部可选路径 |

---

## 9. 02 清单合规预判

依据 `架构想法/02_简单检查清单.md`,四条规则逐条核验【C·10】:

| 规则 | 含义 | 本方案核验 | 结论 |
|---|---|---|---|
| **R-CI-02** | 同一类操作多种实现方式 = >1 种即 🟡 违例 | (1) KeyPool 横切,`key-pool.ts` 单一真源,所有 provider 注入同一类型;(2) 抽 ZhipuClient 后,ZhipuProvider 与 ZhipuVisionProvider **必须真的共用此 client**(不能各自复制一份 request()),否则仍属「同一决策两处实现」(R-CI-08 🔵 DRY-as-decisions) | ✅ PASS(实施时唯一需审视:ZhipuClient 真实共享,非复制) |
| **R-DEP-03** | 无穿堂(pass-through)中间层 | KeyPool 是**真实状态机**(acquire 选 key + cooling/exhausted 状态转移 + LRU),非 pass-through;放 `src/providers/` 是 provider 同层依赖,不跨层 | ✅ PASS |
| **R-INT-03** | 接口可选,避 god interface | VisionProvider 接口方法数仍为 **3 必选**(recognize/visionTasks/listVisionModels)+ **2 可选**(visionConstraints/describeVisionOptions);KeyPool **不进接口**(是 provider 私有依赖) | ✅ PASS |
| **R-ABS-01** | 无 `if(provider/modality)` 分流 | (1) KeyPool **无 provider 类型参数**,统一 acquire/markLimited 协议;(2) ZhipuClient **无 modality 参数**;(3) 无 `if(provider===$name)` 分流 | ✅ PASS |

**额外核查 R-CI-08(DRY-as-decisions)**:抽 `vision-prompt.ts` shared helper(从 vlm.ts 抽 promptFor)后,zhipu-vision 与 vlm 共用同一 prompt 构造决策,不两处实现。

**四条规则全部 PASS,方案合规。**

---

## 附录:OpenAI 兼容性快速验证

### A.1 curl 示例(证明 glm-4.6v-flash 可直接走 OpenAI chat/completions)

```bash
# 环境变量:ZHIPU_API_KEY="{id}.{secret}"(从 https://open.bigmodel.cn/console/apikey 获取)
curl -X POST https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Authorization: Bearer ${ZHIPU_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4.6v-flash",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "https://example.com/invoice.png"}},
        {"type": "text", "text": "Extract all text from this image. Return plain text only."}
      ]
    }]
  }'
```

预期 200 响应(标准 OpenAI 信封):

```json
{
  "id": "chatcmpl-xxx",
  "model": "glm-4.6v-flash",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." }
  }],
  "usage": { "prompt_tokens": 123, "completion_tokens": 456, "total_tokens": 579 }
}
```

### A.2 Node fetch 示例(等价于 VlmProvider.chat() 的智谱版)

```ts
// ZhipuVisionProvider.chat() 核心实现(与 vlm.ts:106-144 几乎一致,仅 url + Bearer 必填差异)
private async chat(image: string, prompt: string): Promise<string> {
  if (!this.apiKey) throw Object.assign(new Error("ZHIPU_API_KEY is not set"), { status: 503 });
  const url = `${this.baseUrl}/paas/v4/chat/completions`; // 注意:/paas/v4 非 /v1
  const key = this.pool.acquire();
  if (!key) throw Object.assign(new Error("all zhipu keys exhausted"), { status: 429 });
  return withRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`, // 智谱 Bearer 必填(对比 vlm 可空)
      },
      body: JSON.stringify({
        model: this.model, // 默认 "glm-4.6v-flash"
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image } }, // 接受 https 直链 / data URI
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      // 关键:按 body.error.code 分流(见 §4.5),而非仅看 HTTP 429
      const code = json?.error?.code;
      if (res.status === 429 && (code === "1302")) {
        this.pool.markLimited(key, 30_000); // 瞬态,短冷却
      } else if (res.status === 429 && ["1113","1308","1310","1316","1317","1318","1311"].includes(code)) {
        this.pool.markExhausted(key); // 粘性,永久禁用该 key
      } else if (res.status === 401) {
        this.pool.markExhausted(key); // key 失效
      } // 1305 不动 key 池(全局性)
      const e = new Error(`ZhipuVision ${res.status} (${code}): ${json?.error?.message ?? text.slice(0,200)}`);
      (e as any).status = res.status; (e as any).body = json;
      throw e;
    }
    return json?.choices?.[0]?.message?.content ?? "";
  }, { tag: "ZhipuVision" });
}
```

**与 vlm.ts:106-144 的 diff**(仅 3 处):

1. url path 前缀:`/paas/v4` vs `/v1`
2. Authorization:`Bearer ${key}` 必填 vs vlm 可空
3. 错误处理:加 body.error.code 业务码分流 vs vlm 仅按 HTTP status

**这 3 处差异正是 ZhipuVisionProvider 独立存在(选项 A 而非选项 B)的根本原因**(§3)。promptFor / messages 构造 / JSON.parse / choices[0].message.content 抽取逻辑 100% 复用(R-CI-08)。

---

## 附:开放问题(需接入时实证)

| # | 问题 | 验证方法 |
|---|---|---|
| OQ-1 | plain `{id}.{secret}` 作 Bearer 在 v4 是否 100% 通过 | 用真 key 跑 §A.1 curl,若偶发 401 加 JWT fallback |
| OQ-2 | 1308/1310 额度类 429 响应头是否真无 X-RateLimit-Reset | 用一把即将耗尽额度的免费 key 实触发 1310,抓 `-i` 全响应头 |
| OQ-3 | GLM-OCR 调用端点是否同为 `/paas/v4/chat/completions`(还是另有 PDF 大文件端点) | 查模型 detail 文档 / 实测 |
| OQ-4 | GLM-4.6V-Flash 关闭 thinking 的确切参数(`thinking:{type:enabled}` 已知,disabled 字面值未确认) | 查模型 detail / 实测 |
| OQ-5 | V0 等级在 GLM-4V-Flash 上的具体并发数上限 | 登录控制台 rate-limits 页实测 |
| OQ-6 | 智谱同账户多 key 是否共享额度池(若共享,KeyPool 对智谱无意义,应强制单 key) | 查官方文档或实测 |
| OQ-7 | glm-4v 真实延迟(影响 tier=9 是否合理,若 >10s/请求降到 tier=7) | 接入后跑延迟基准 |
| OQ-8 | 付费视觉(GLM-4V-Plus / 4.6V / 5V-Turbo)精确元每百万 token 单价 | 登录控制台或 SDK `GET /paas/v4/models` 拉刊例表 |

---

**文档版本**:v1.1(2026-07-20)— 附录 2 补 zai-mcp-server / Code Plan 路径纠偏
**证据链**:A(API 协议)+ B(计费/合规)+ C(架构挂载点)三份调研,9 + 6 + 10 条 finding,已逐条对照 `src/` 源码核实。
**下一步**:按 §7 有序步骤实施,优先 step 1-3(KeyPool + ZhipuClient + ZhipuVisionProvider),step 9 真 key 验证为发布前 gate。

---

## 附录 2:zai-mcp-server / code plan 路径纠偏(补调研)

> 触发:用户在 Claude Code 内可用 `mcp__zai-mcp-server__*` 8 个视觉工具(analyze_image / analyze_data_visualization / analyze_video / extract_text_from_screenshot / diagnose_error_screenshot / ui_to_artifact / ui_diff_check / understand_technical_diagram),希望把这些能力整合进 media-gen-mcp。本附录基于补调研对该诉求做精确路径裁决。
> 数据时点:2026-07-20(与正文同日,补调研)。
> 证据来源:D1 = zai-mcp-server 本体 + 底层 API 探测(8 条 finding),D2 = GLM Coding Plan key 机制(8 条 finding)。每条以【D1·k】/【D2·k】溯源。

### 2.1 用户原始诉求澄清

用户的整合对象**精确**是:Claude Code 内 `mcp__zai-mcp-server__*` 命名空间暴露的 8 个视觉工具,不是泛指智谱开放平台视觉能力。补调研首先澄清三层同名/近义混淆:

| 概念 | 真实所指 |
|---|---|
| `zai-mcp-server`(Claude Code 命名空间)| **Z.ai 官方托管的远程 MCP**,端点 `https://api.z.ai/api/mcp/server`(Streamable HTTP)【D1·2】 |
| `zai-mcp-server`(npm 包 latest 8.4.0)| **完全无关的另一个项目**(Zrald AI Systems 的 AI-to-AI 编排,GitHub Zrald1/zai-mcp-server),绝不能 `npx` 安装【D1·1】 |
| Z.ai Coding Plan | Z.ai 国际品牌的订阅包($18 Lite / $72 Pro / $160 Max 月费),**非开放平台 token 额度**【D2·1】 |
| Code Plan key(ZAI_API_KEY)| Z.ai 颁发的订阅专用凭证,与 open.bigmodel.cn 标准 `{id}.{secret}` api_key **不互通**【D2·2】 |

### 2.2 zai-mcp-server 本体 + 底层 API 发现

**本体性质**【D1·2】:zai-mcp-server 是部署在 `https://api.z.ai/api/mcp/server` 的远程 MCP(transport=http,SSE 备选 `/api/mcp/sse`,均实测 200),认证走 `Authorization: Bearer <Z_AI_API_KEY>`。不是 npm 可装、不是 stdio,客户端只需配一条 StreamableHTTP/SSE URL。

**底层 API**【D1·3】:Z.ai 官方文档(docs.z.ai/api-reference)明确该 MCP 内部调用 `POST https://api.z.ai/api/paas/v4/chat/completions`,标准 OpenAI 形态(model + messages + temperature + stream),文档原文 "supports multimodal inputs (text, images, audio, video, file)"。视觉模型 `glm-4.6v`。这条 v4 端点与用户 `src/providers/zhipu.ts:126,150` 已对接的 `https://open.bigmodel.cn/api/paas/v4` 是**同一 API 的国际/国内双镜像**,同一把 ZHIPU_API_KEY 可用(zhipu.ts:126 注释原文已标「base = https://open.bigmodel.cn/api,国际版 https://api.z.ai/api」)【D1·4】。

**8 个工具的本质**【D1·7】:后 5 个场景化工具(diagnose_error_screenshot / ui_to_artifact / understand_technical_diagram / ui_diff_check / analyze_data_visualization)是同一 GLM-4.6V + 不同 system/user prompt 模板的产物。MCP server 在内部做 prompt 工程,非协议能力。media-gen-mcp 侧若想 100% 复刻需逆向 prompt(不是协议问题,是 prompt engineering 问题);通用 4 task(extract-text / extract-table / analyze-chart / describe-image)直接走 v4 **无损**。

**代码骨架**【D1·5】:用户 `src/providers/vlm.ts` 的 `chat()` 方法已经是 Z.ai v4 的标准请求形态(fetch `${baseUrl}/v1/chat/completions`,Bearer,messages.content 数组塞 `{type:'image_url',image_url:{url}}` + `{type:'text',text}`)。把 baseUrl 换成 `https://api.z.ai/api/paas/v4`、model 换成 `glm-4.6v`,就是合法的 Z.ai 视觉请求——**vlm.ts 是整合的精确蓝图**。

### 2.3 Code Plan key 机制 + 能否直接调 API

**四层独立致命问题,每一层都让 Code Plan key 无法直接调视觉 API**【D2·1~D2·7】:

1. **平台不通**【D2·2】【D2·8】:Code Plan key 由 z.ai 颁发,绑定 `api.z.ai/api/coding/paas/v4` 专用端点(注意路径里多了 `/coding/` 段,与标准 `api.z.ai/api/paas/v4` 不同)。与 open.bigmodel.cn 账户/Key/计费完全分离,把它当 Bearer 打 `open.bigmodel.cn/api/paas/v4` 鉴权直接失败;即便改打 Z.ai 标准端点也不行——必须走 `/coding/paas/v4`。

2. **模型不开**【D2·1】【D2·6】:Code Plan 仅直接开放 GLM-5.2 / GLM-5-Turbo / GLM-4.7 三个对话模型。视觉 GLM-4.6V **不开放直接 `/v4/chat/completions` 调用**,只能通过 Code Plan 独占的官方 Vision MCP Server(即 zai-mcp-server 的 Vision 工具)间接访问。FAQ 原文:"Other than the resource package, we currently do not provide any other access solution for calling these three MCP tools."

3. **工具限定**【D2·4】:Usage Policy 明文 "Use limited to supported tools: GLM Coding Plan may only be used within officially supported tools and products. Use in unsupported tools may trigger risk control measures, including rate limiting, account freezing, or other restrictions. Accounts with more than three violations may be banned." 支持工具白名单仅 9 个(Claude Code / Cline / Cursor / Roo Code / Kilo Code / OpenCode / OpenClaw / Crush / Goose),**media-gen-mcp 不在白名单**。违规 3 次封号且订阅费 non-refundable。

4. **多 key 轮换违规**【D2·7】:"Subscription benefits are exclusive to the subscriber: Account sharing or multi-user access is prohibited." 叠加智谱 User Agreement §2/§3 禁多账号条款。把 Code Plan key 放进 media-gen-mcp 供多端调用等同于账号共享。**media-gen-mcp 0.10.0 的多 key fallback 池设计在 Code Plan 场景完全不可移植**。

**反向佐证**【D2·6】:本次补调研过程中 WebSearch / web_search_prime / webReader / mcp__web-reader 全部返回 `1310 'Weekly/Monthly Limit Exhausted'`(重置时间精确到秒),正是触发了本人 Code Plan 的 MCP 周/月配额(Lite 100 / Pro 1000 / Max 4000 次,WebSearch + WebReader + Zread 共享)。从反面坐实这些 MCP 工具就是 Code Plan 独占 MCP,且 1310 信号与正文 §1.5 表中"每周/每月上限"业务码同源。

**裁决**:Code Plan key **不能**直接调视觉 API——既不能调 `open.bigmodel.cn/api/paas/v4`,也不能调 `api.z.ai/api/paas/v4`;只能走 `api.z.ai/api/coding/paas/v4` + 9 个白名单工具,且白名单工具内也不开放 GLM-4.6V 的直接 chat/completions(只能通过官方 Vision MCP 间接调)。

### 2.4 三路径裁决表

| 路径 | 描述 | Code Plan key 适用? | 普通 ZHIPU_API_KEY 适用? | 额外协议依赖 | 推荐度 |
|---|---|---|---|---|---|
| **A: 直接调智谱开放平台** | POST `https://open.bigmodel.cn/api/paas/v4/chat/completions`,Bearer `{id}.{secret}`,model=`glm-4.6v-flash` | ❌ 平台不通 + 模型不开 | ✅ 完全可用,GLM-4.6V-Flash 永久免费(§2.1) | 零(纯 OpenAI 兼容 HTTP) | **★★★ 首选** |
| **B: 直接调 Z.ai 端点** | POST `https://api.z.ai/api/paas/v4/chat/completions`,Bearer `Z_AI_API_KEY`,model=`glm-4.6v` | ❌ Code Plan key 必须走 `/coding/paas/v4` 且不开视觉 chat/completions | ✅ Z.ai 标准 pay-as-you-go key 可用 | 零(纯 OpenAI 兼容 HTTP) | ★★ 备选(国际用户) |
| **C: MCP 套 MCP** | media-gen-mcp 内部 spawn zai-mcp-server 远程 MCP,通过 JSON-RPC + 会话 + 工具发现调用 | ⚠️ 唯一能用 Code Plan key 的路径,但 media-gen-mcp 非白名单工具,3 次违规封号 | ✅ 技术可行但对普通 key 无意义 | 完整 JSON-RPC client + session + tool discovery 一层封装 | ☆ 否决 |

**推荐:路径 A(直接调智谱开放平台 `open.bigmodel.cn/api/paas/v4`)**。

**理由**:

1. **零新协议依赖**:与原方案(ZhipuVisionProvider + KeyPool,§3 选项 A + §7)完全同构,baseUrl / 认证 / 端点路径 / 请求体 100% 复用,**零修订成立**。
2. **复用现有 zhipu.ts 配置面**:`src/providers/zhipu.ts:150` `this.baseUrl = c.baseUrl || 'https://open.bigmodel.cn/api'` 已是默认值,ZhipuVisionProvider 直接注入同一 ZhipuClient 即可。
3. **免费层成立**:GLM-4.6V-Flash 在 open.bigmodel.cn 永久免费(§2.1 已证),满足 media-gen-mcp 纯免费硬约束。
4. **国内访问快**:open.bigmodel.cn 是国内镜像,api.z.ai 是国际路由,对主要用户群(中文)更友好。
5. **Code Plan 路径全堵死**:B 路径对 Code Plan key 不可用(平台不通 + 模型不开);C 路径不仅违反"MCP server 不应依赖另一 MCP server"的架构原则(zai-mcp-server 是远程 MCP,需在 media-gen-mcp 内实现完整 JSON-RPC client + 会话 + 工具发现,违 R-DEP-03 + R-CI-02),还会因工具白名单触发 Code Plan 风控、3 次封号。
6. **8 个场景化工具不损失**:用户对 zai-mcp-server 8 工具的需求,通用 4 task(extract-text / extract-table / analyze-chart / describe-image)走 v4 直接无损;5 个场景化工具(diagnose_error / ui_to_artifact / understand_technical_diagram / ui_diff / analyze_data_viz)按 §7 step 已规划在 `vision-prompt.ts` shared helper 中复刻 system prompt 即可还原(是 prompt engineering 问题,非协议问题)。

### 2.5 与原方案(ZhipuVisionProvider + KeyPool)的对接点

原方案(§3 选项 A + §7 实施步骤)零修订成立,仅增加三条增量约束:

| 维度 | 原方案 | 补调研增量 | 备注 |
|---|---|---|---|
| **baseUrl** | `https://open.bigmodel.cn/api` | 保持不变 | 与 zhipu.ts:150 默认一致 |
| **认证 header** | `Authorization: Bearer {id}.{secret}` | 保持不变 | v4 接受 plain key(§1.2) |
| **端点路径** | `/paas/v4/chat/completions` | 保持不变 | OpenAI 兼容 v4 |
| **key 来源** | `ZHIPU_API_KEY`(open.bigmodel.cn 注册) | **明确拒绝 Code Plan key(ZAI_API_KEY)** | 必须是 `open.bigmodel.cn/console/apikey` 申请的 `{id}.{secret}` 格式 key,不是 `z.ai/manage-apikey/apikey-list` 颁发的 Code Plan key |
| **model** | `glm-4.6v-flash`(免费首选) | 保持不变 | Code Plan 不开此模型直接调用,但 open.bigmodel.cn 标准 key 可调 |
| **KeyPool 配置** | `apiKeys` 数组,默认单 key | 保持不变,README 增加警示 | 明确写「Code Plan key 不可用,必须用 open.bigmodel.cn 标准 api_key」 |
| **新 provider 命名** | `ZhipuVisionProvider`(`zhipu-vision.ts`) | 保持不变 | 不改用 `glm-vision` / `zai-vision` 命名,与现有 `zhipu.ts` 品牌一致(R-CI-02),避免与 cogview/cogvideox 已占的 zhipu.ts 内部混淆 |

**建议新增 key 格式轻量校验**:ZhipuVisionProvider 构造时,检测 ZHIPU_API_KEY 是否为 open.bigmodel.cn 标准 `{id}.{secret}` 格式(以 `.` split 后两段均非空);若不符合,启动时 warn:「检测到非标准智谱 api_key 格式。Code Plan key(ZAI_API_KEY)不可用于此 provider——请使用 open.bigmodel.cn/console/apikey 申请的 {id}.{secret} 格式 key」。该校验为**提示性**,非硬拦截(避免误伤未来格式变更)。

### 2.6 多 Code Plan key 轮换的合规口径更新

**原方案 §2.5 + §4.1 + R1 已确认**:智谱开放平台多账号/账号共享违反 User Agreement §2 + §3 + Service Agreement §3.4 三条独立禁止条款。

**补调研增量**:Code Plan key 在原 ToS 之上**叠加两层独立限制**【D2·4】【D2·7】:

1. **Code Plan Usage Policy — Account Sharing prohibition**:"Subscription benefits are exclusive to the subscriber: Account sharing or multi-user access is prohibited. Violations may result in restrictions on subscription benefits and, in serious cases, may affect normal account usage."
2. **Code Plan Usage Policy — Supported Tools lock-in**:"Use limited to supported tools... Use in unsupported tools may trigger risk control measures, including rate limiting, account freezing, or other restrictions. Accounts with more than three violations may be banned."

**叠加后果矩阵**:

| 违规场景 | 开放平台 ToS | Code Plan Usage Policy | 综合后果 |
|---|---|---|---|
| 注册多个 open.bigmodel.cn 账号 | 违反 User Agreement §2 多账号禁止 | 不适用(开放平台非订阅制) | 单重违规,冻结/关闭账户 |
| 注册多个 z.ai Code Plan 账号 | 违反 User Agreement §2(同源条款) | 违反 Subscription benefits exclusive | **双重违规** |
| 把 Code Plan key 放进 media-gen-mcp 供多端调用 | 违反 Service Agreement §3.4(出借/提供他人使用) | 违反 Account sharing + Supported tools 双条款 | **三重违规 + 3 次封号 + 订阅费 non-refundable** |
| 多把 Code Plan key 在 KeyPool 里轮换 | 上述全部 | 上述全部 + 风控批量识别同指纹跨多 key | **最严重,批量封号且不退款** |

**更新后的合规口径**:

1. **KeyPool 通用模块照建**(横切复用 R-CI-02),但对 Code Plan key **完全禁用**——不仅是降级为单 key,而是文档 + 源码注释双重明确拒绝:「GLM Coding Plan key(ZAI_API_KEY)不可用于 media-gen-mcp,因其受 Usage Policy 工具白名单 + 禁账号共享双条约束,且不开放 GLM-4.6V 直接 chat/completions 调用。请使用 open.bigmodel.cn 标准 `{id}.{secret}` api_key。」
2. **配置校验**:若 ZHIPU_API_KEY 检测到 Code Plan key 特征(Z.ai 颁发格式 vs open.bigmodel.cn `{id}.{secret}` 格式),启动时 warn 并提示用户更换。
3. **README 合规声明**(在 §7 step 8 基础上强化):「**Code Plan key 与标准 api_key 不互通**——前者仅可在 9 个官方编码工具内用订阅配额,视觉 GLM-4.6V 只能通过 Code Plan 独占的官方 Vision MCP 间接调;后者可在任意 OpenAI 兼容客户端直接调视觉。media-gen-mcp 仅支持后者。」
4. **新增开放问题 OQ-9**:Code Plan 风控的具体识别维度(User-Agent / 调用间隔 / 端点指纹 / 是否要求带编码工具特征头)未在公开文档列出——但官方明确 "3 次违规封号",说明风控确实在跑、且能区分编码工具 vs 其他客户端。media-gen-mcp 不冒险试探。

### 2.7 附录 2 小结

**一句话**:用户对 zai-mcp-server 的整合诉求,**走路径 A(直接调 `open.bigmodel.cn/api/paas/v4` + 标准 `{id}.{secret}` api_key + `glm-4.6v-flash`)成立且为最优**;Code Plan key 路径(B/C)被四层独立技术问题(平台不通 / 模型不开 / 工具限定 / 多 key 违规)完全堵死,不仅不可直接调,即便走 MCP 套 MCP 也会触发 Code Plan 工具白名单风控。原方案(ZhipuVisionProvider + KeyPool,§3 选项 A + §7)零修订成立,只增加三条增量:(1) 明确拒绝 Code Plan key 作为 ZHIPU_API_KEY 来源;(2) README + 源码注释强化合规声明;(3) key 格式轻量校验提示。

---

**附录 2 证据链**:D1(zai-mcp-server 本体 + 底层 API,8 条 finding)+ D2(GLM Coding Plan key 机制,8 条 finding),逐条对照 Z.ai 官方文档(docs.z.ai/devpack/*、docs.z.ai/api-reference)+ `src/providers/zhipu.ts:126,150` / `vlm.ts` 源码 + 本次调研触发的 MCP 错误码 1310 反向佐证。
