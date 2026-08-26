# pares4:media-gen-mcp 图像识别集成实施方案

> **版本**:v1.1(采纳审查 2 条 🟡 + 定位确认后修正)· **日期**:2026-07-18 · **保存路径**:`Agnes AI接入/doc_v10/`
> **方案标题**:Vision-as-Third-Modality:Capability-Bag Provider + 4 Specialized Tools + Tiered Runtime
> **方法论**:3 理解现状 → 4 方案设计(不同哲学)→ 综合最佳实践 → 3 独立审 02 清单(对抗取交集)。**11 agent · 88 工具调用 · 834k tokens**。
> **简单性审查结论**:**通过**。0 🔴 Fail,三条硬不变量(R-FF-01 分层单向 / R-FF-02 依赖无环 / R-DEP-03 穿堂式=0)全绿。8 类 findings 全非阻断(详见 [pares4_架构简单性审查报告.md](pares4_架构简单性审查报告.md))。
> **v1.1 修正(已落地)**:✅ Finding 1(R-DEP-05 信息泄漏)+ Finding 2(R-INT-03 组合类型)+ Finding 4/5(visionConstraints 去 tasks / 删 languages 双口)已固化进 §三接口设计;✅ Finding 8(R-DRIFT-02 定位移动)用户已确认,§二加定位锚点。
> **前置依赖**:[图像识别开源方案调研.md](图像识别开源方案调研.md) · [02_简单检查清单.md](../../../架构想法/02_简单检查清单.md)

---

## 一、执行摘要

**目标**:为 media-gen-mcp(0.10.0,12 工具,全生成/渲染模态)补齐"识别/分析"空白象限,交付 4 个按图像类型专精的工具,兑现"所有图像相关操作归一个 MCP"的定位扩展(**用户已确认定位移动,R-DRIFT-02 判为演进迁移非退化**)。

**核心架构决策(三件)**:
1. **能力袋(capability-bag)重构 MediaProvider**——image/video/vision 三组方法全部可选(非破坏性 widening),Agnes/Zhipu 实现更多方法仍满足,纯识别 provider 零桩代码。否决"新增 Provider 基底 mixin"(R-DEP-02 空壳)。
2. **4 个专精工具**(extract_text / extract_table / analyze_chart / describe_image),而非 1 个通用工具 + task enum——因 4 种产出 shape 不同(text / HTML-table / JSON-data / NL),单工具必在 handler 内按 task 分流,正是 R-ABS-01 违例指纹。兑现用户"按图像类型专精"诉求。
3. **分层运行时**:M1 纯 JS tesseract.js 零配置兜底(对称 generate_diagram 内置 D2 WASM)→ M2 PaddleocrProvider HTTP(Apache 全栈 SOTA)→ M3 VLMProvider HTTP(OpenAI 兼容,自托管 vLLM/Qwen2.5-VL-7B)。三档按需上浮,核心零配置可用。

**预期收益**:复用现有 registry / resolveProvider / getFallbackProvider / withRetry / downloadAsset / config.buildProviders 全套横切(**横切变体 = 1**,R-CI-02 安全);Apache 全栈对齐"纯免费+可商用"立场;演进路径开放——加一个识别 backend = 1 文件 + 1 registry 行 + 1 config 段,生成侧零感知。

---

## 二、核心架构:为什么是"能力袋 + 第三模态"

### 决策:VisionProvider 作为与 ImageProvider/VideoProvider 同位的第三模态 peer

引入 VisionProvider 子接口,但**不**新增 artificial `Provider` 基底接口(否决 Provider mixin——它产生只服务 registry typing 的空壳基底,违 R-DEP-02)。同时**重构 MediaProvider 为能力袋**:image/video/vision 三组方法在 MediaProvider 上全部可选。

**为什么能力袋而非平行 VisionProvider 路径**:平行路径(`Record<string, MediaProvider | VisionProvider>`)需要 union 类型 + 散落 narrow;能力袋让 registry 保持单一类型 `Record<string, MediaProvider>`,所有 vision 访问通过 `isVisionProvider(p)` 类型守卫集中收窄——更少的类型分叉,更集中的窄化点。能力袋也顺带修了**既有矛盾**:现状 imageConstraints?/maxFramesFor?/supportsImageToImage? 已可选,却把 generateImage/videoConstraints 设必选——本次贯彻"能力组皆可选"。

> ✅ **审查反馈(已采纳 v1.1)**:能力袋若 inline 重声明会让 MediaProvider 累计 ~20-22 方法,命中 R-INT-03 接口过胖(🟡)。三审中两审建议改用 **TS 组合类型**,本方案已采纳落地(见 §三接口设计):
> ```ts
> type MediaProvider = MediaProviderBase & Partial<ImageProvider> & Partial<VideoProvider> & Partial<VisionProvider>;
> ```
> 子接口为单一声明源、MediaProvider 自动派生,每个能力面保持窄(<7),一举消解接口过胖(R-INT-03)+ 双声明(R-CI-08)+ public API 过大(R-DEP-01)。详见审查报告 finding-2。

### 避免 4 个 anti-pattern 的具体机制

| anti-pattern | 规则 | 本方案如何避免 |
|---|---|---|
| 穿堂式方法 | R-DEP-03 / R-FF-04 🔴 | handler 4 case 各做 URI 校验 + 能力门禁 + fallback 编排 + 响应 shaping,无一处裸 `return p.recognize(req)`;provider.recognize() 做 HTTP/WASM + task 路由 + 响应归一化;asXxxProvider 守卫做能力断言 + 友好报错 |
| 参数蔓延 | R-ABS-01 | 4 个独立工具(非 1 工具+enum);resolveProvider 签名 3 参不变(modality 是主分派输入,union 加值非新 flag);getFallbackProvider req 对象加 task 字段(对称现有 mode/images/keyframes);零 boolean/flag ≥ 2 |
| 相邻层抽象重复 | R-DEP-04 | VisionRequest 字段集 vs ImageRequest/VideoRequest 重叠 ~33% < 60% |
| 浅模块 | R-DEP-02 | Tesseract ~150 行/5 API ≈ 30;Paddle ~200/5 ≈ 40;VLM ~150/5 ≈ 30,全 >> 5 浅壳线 |

### 定位锚点(R-DRIFT-02 落地 · 用户已确认)

定位移动已确认:media-gen-mcp 从「所有生图归一个 MCP」(生成专用)扩为「所有图像相关操作归一个 MCP」(生成 + 识别)。这是**演进迁移**(目标架构移动),非熵退化。落地动作(M4 收尾,亦可在 M1 起即锚定):

1. **README 顶部** tagline 改为「生成 + 识别 一体化图像 MCP」,并加「识别能力(0.11.0+)」说明
2. **CLAUDE.md**(若有)/ 项目定位文档写入新定位,作为 §6.2 目标架构 baseline,让后续 R-DRIFT diff 有锚点
3. **PR 模板**加 R-CI-07 准入字段:「VisionProvider 归属现有 Provider 抽象(MediaProvider 能力袋第三组),与 ImageProvider/VideoProvider 同位 peer,非平行新概念」

---

## 三、接口设计(types.ts)

```ts
// === 新增类型(纯 additive)===
export type Modality = "image" | "video" | "vision";
export type VisionTask = "extract-text" | "extract-table" | "analyze-chart" | "describe-image";

// 各 task 的 hints —— 语义级 what,不泄漏引擎 how(v1.1 修正 Finding 1 / R-DEP-05)
export interface ExtractTextHints {
  languages?: string[];        // BCP-47(如 zh-Hans/zh-Hant/en/ja);provider 内部映射为引擎 lang(tesseract→chi_sim / paddle→自带多语)
  digitOnly?: boolean;         // 语义契约「仅输出数字」;各引擎各自实现(tesseract→char_whitelist / paddle→rec 字典约束),不绑死引擎参数名
  segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";  // 语义级版面假设;provider 翻译为自家 PSM(tesseract 0-13)/版面策略
}
export interface ExtractTableHints { format?: "html" | "markdown" | "json" | "latex"; }
export interface AnalyzeChartHints { chartType?: "bar" | "line" | "pie" | "scatter" | "auto"; }
export interface DescribeImageHints { question?: string; }

export interface VisionRequest {
  image: string;            // http(s): / data: URI(与 ImageRequest.images 同约定)
  task: VisionTask;
  hints?: ExtractTextHints | ExtractTableHints | AnalyzeChartHints | DescribeImageHints;
  model?: string;
  extra?: Record<string, unknown>;
}   // ✅ v1.1:无顶层 languages 双口(Finding 5);OCR 语种只在 ExtractTextHints.languages 单点承载

// 各 task 产出形态
export interface TextBlock { text: string; bbox?: [number, number, number, number]; confidence?: number; level: "word" | "line" | "paragraph"; }
export interface TableOut { format: string; content: string; }
export interface ChartOut { type: string; axes: Record<string, string>; series: { name?: string; points: { x: string | number; y: number }[] }[]; }

export interface VisionResult {
  task: VisionTask;
  text?: string;            // extract-text 全文
  blocks?: TextBlock[];     // extract-text 带坐标块
  table?: TableOut;         // extract-table
  chart?: ChartOut;         // analyze-chart
  description?: string;     // describe-image 自然语言答案
  raw?: unknown;
  warnings?: string[];
}

// ✅ v1.1 修正 Finding 4(R-CI-08):visionConstraints 去 tasks;visionTasks() 是「支持哪些 task」单一真值源
export interface VisionConstraints {
  languages?: string[];
  maxImageBytes?: number;
}

// VisionProvider — 文档性子接口(对称 ImageProvider/VideoProvider);asVisionProvider 守卫契约源 + 单一声明源
export interface VisionProvider {
  listVisionModels(): string[];
  visionTasks(): readonly VisionTask[];   // 单一真值源:provider 支持哪些 task
  recognize(req: VisionRequest): Promise<VisionResult>;
  visionConstraints?(): VisionConstraints | undefined;  // 不含 tasks,免与 visionTasks() 双声明
}

// ProviderCapabilities 加 vision 维度(可由 visionTasks() 派生,对齐既有 capabilities 模式)
export interface ProviderCapabilities {
  image: { textToImage: boolean; imageToImage: boolean };
  video: { textToVideo: boolean; imageToVideo: boolean; keyframes: boolean };
  vision: Record<VisionTask, boolean>;
}

// === MediaProvider:v1.1 修正 Finding 2(R-INT-03 接口过胖 + R-CI-08 双声明),改 TS 组合类型 ===
// 子接口(ImageProvider/VideoProvider/VisionProvider)是单一声明源,每个保持窄(<7 方法);
// MediaProvider 自动派生,无需手动同步 20+ 签名 —— 一举消解接口过胖 + 双声明 + public API 过大。
// ImageProvider/VideoProvider 既有签名不变(必选性由 Partial 承载为可选,非破坏性拓宽);
// 子接口同时是 asImageProvider/asVideoProvider/asVisionProvider 守卫契约源(真实用途,R-DEP-02 非空壳)。
export interface MediaProviderBase {
  readonly name: string;
  listModels(): string[];
  capabilities?(): ProviderCapabilities;
  health?(): ProviderHealth;
  tier?(): number;
  notifyUnavailable?(e: any): void;
}
export type MediaProvider =
  & MediaProviderBase
  & Partial<ImageProvider>
  & Partial<VideoProvider>
  & Partial<VisionProvider>;
```

> 接口设计已采纳审查 2 条 🟡(Finding 1 去引擎词 / Finding 2 组合类型)+ Finding 4(visionConstraints 去 tasks)。Finding 5(顶层 languages 双口)在 v1.0 即已满足(顶层本无 languages)。详见审查报告。

---

## 四、4 个专精工具

| 工具 | 职责 | 实现栈 | 返回 |
|---|---|---|---|
| **extract_text** | OCR 文字:验证码/数字/车牌/拉丁印刷/中文文档 | M1 TesseractProvider(纯 JS,tesseract.js WASM);M2+ PaddleProvider PP-OCRv6(中英 SOTA);fallback paddle→tesseract | `{text, blocks?, provider_used, warnings?}` |
| **extract_table** | 表格→HTML/Markdown/JSON/LaTeX:票据/发票/财报/论文表格 | M2 PaddleProvider PP-StructureV3 PP-TableMagic(TEDS 88.22);**无纯 JS 兜底**(tesseract 不声明此 task,报清晰错误 + docker 指引,不静默降级到 OCR 假装表格识别) | `{table:{format, content}, provider_used, warnings?}` |
| **analyze_chart** | 图表→数据点:柱/折线/饼/散点反向工程 | M2 PaddleProvider PP-Chart2Table(Apache);M3 VLMProvider Qwen2.5-VL-7B(ChartQA 89.5)fallback;两 provider 按 task+tier 自动切换 | `{chart:{type, axes, series}, provider_used, warnings?}` |
| **describe_image** | VLM 理解:自然语言描述/VQA/手写/复杂版面/公式→LaTeX | M2 PaddleProvider→PaddleOCR-VL-1.6(OmniDocBench SOTA 96.33%);M3 VLMProvider(vLLM Qwen2.5-VL-7B 或 DashScope);question 留空=描述,存在=VQA | `{description, provider_used, warnings?}` |

> 📋 **审查观察(清单外,R-CI-01)**:现有 `generate_chart`(数据→图)与新 `analyze_chart`(图→数据)是**语义逆操作,verb 不同 noun 相同**,CC 调度可能选错。建议两工具描述交叉引用("逆操作是 generate_chart/analyze_chart")。

### 工具共性参数
所有工具:`image`(必填,http(s)/data URI) + `model?` + `provider?`(默认 `config.defaultVisionProvider`) + `name?`/`outDir?`(落盘)。与 create_video 同源约束:**本地文件路径不接受**,由调用方(CC)先 read 为 data URI(避新增输入解析路径,R-CI-02)。

---

## 五、分层运行时(三档,默认零配置可用)

### 档位 0:零配置兜底(Node 进程内,M1 默认)
**TesseractProvider** 用 tesseract.js(Apache,WASM)。装包即用,无 apiKey、无 Python、无 Docker。覆盖 extract_text 的拉丁/数字/验证码甜区(4-6 位验证码毫秒级,PSM 7 单行 / 10 单字符 / 3 整页)。对称现有 generate_qrcode/generate_formula 的"纯本地零配置" + generate_diagram 内置 D2 WASM 的"核心能力开箱即用"。首次调用 WASM worker 冷启动(~1-3s 解压 ~30MB),后续跨调用单例复用进入毫秒级(**参考 0.7.0 教训:worker 单例 unref + active refcount,进程退出 terminate 避免挂**)。

### 档位 1:自托管 Python HTTP(生产推荐,M2 起)
**PaddleocrProvider** HTTP 调 `paddleocr-mcp --http`(Apache,中文 SOTA + 表格 + 图表),默认 :8770;可选 vLLM 跑 Qwen2.5-VL-7B(Apache,:8000)。Node MCP server 作 HTTP 客户端编排,通过 `providers.paddle.baseUrl` / `providers.vlm.baseUrl` 指向。**识别秒级返回,全部同步**(不撞 ASYNC_THRESHOLD_SECONDS=60,无需 video 那套 async/poll 拆分——识别场景没有"提交→轮询"形状,强行套 poll.ts 触发 R-CI-02「第二套生命周期」)。docker-compose.yml 一键起。**避坑**:stdio 模式多页 PDF 仅首页(Issue #16755),必须 `--http`。

### 档位 2:免本地 GPU,按 token 付费(M3 可选)
**VLMProvider** 指向 DashScope compatible-mode API(OpenAI 兼容)或用户已有的免费后端。仅 describe_image / analyze_chart 走此路径时图片出域(与现有 Agnes/Zhipu 在线生成的同类隐私边界,不更糟)。两种姿势:自托管 vLLM 完全本地(推荐生产)vs DashScope 免本地 GPU 按量付费(轻量场景)。

### Provider 路由与 fallback 链
按 task + tier + health 自动谈判。例:extract_text 默认 tesseract(M1)/paddle(M2)→ paddle 挂(isFallbackWorthy)→ getFallbackProvider 按 visionTasks() 过滤 → 回落 tesseract(仅 extract-text 有纯 JS 兜底)。extract_table / analyze_chart / describe_image 在所有 vision provider 都挂时无兜底,返回清晰错误 + 配置指引(**诚实,不静默降级到 OCR 假装表格识别**)。

**全部 HTTP 路径复用 src/providers/http.ts 的 withRetry + isTransient + isFallbackWorthy——零新重试逻辑(R-CI-02 安全)**。限流学习复用 persistProviderField。错误形状(throw 带 .status/.body)复用 agnes.ts request() 模式。Node 进程内零模型加载(对称 Agnes/Zhipu 远端 API 调用),保持"Node 只编排不推理"纯粹。

### License 守门(对齐 README「纯免费」+「无门槛可商用」)
默认链路 **Apache 全栈**(tesseract.js + PaddleOCR + Qwen2.5-VL 7B/32B)。显式避开:🔴 DocLayout-YOLO(AGPL 网络传染整 Node MCP server)、Marker(GPL-3.0 + 商用授权)、Surya(>$5M 营收 OR 融资任一触发)、Qwen2.5-VL 72B(>100M MAU 须申请)、Qwen2.5-VL 3B(Research License 商用须申请);🟡 MinerU(署名 + MAU 阈值)/ Docling(老版面 docling-layout-old 是 CC-BY-NC-4.0 陷阱)列为「可选但需法律确认」不进默认推荐。

---

## 六、registry.ts 变更(全是"enum 加值",非新函数)

- registry 字典类型保持 `Record<string, MediaProvider>`(能力袋已允许 vision-only provider,无需 union),字典加 `tesseract`/`paddle`/`vlm` 三 key
- 新增导出 `isVisionProvider(p)` / `asVideoProvider(p)` / `asImageProvider(p)` / `asVisionProvider(p)` 类型守卫(做能力存在性断言 + 友好报错,非原样转发,R-DEP-03 安全)
- `resolveProvider(name, model, modality)`:modality 联合扩含 vision;targetName 加 vision 分支(`config.defaultVisionProvider`);owns() 加 `p.listVisionModels?.()`。**第 4 参 task 不加**——task 过滤交 handler 用 `visionTasks().includes(task)`(避免共享函数加只在某分支用的参数,R-ABS-01 安全)
- `getFallbackProvider(currentName, modality, req)`:modality 扩;**req 类型加 `task?: VisionTask` 字段**(对称现有 mode/images/keyframes,是 req 对象字段扩展,非新 flag)
- `capableOf(p, modality, req)`:加 vision 分支(`isVisionProvider(p) && p.visionTasks().includes(req?.task)`)
- `buildListModelsDetail`:每 provider 块加 `visionTasks / visionModels / visionConstraints`(条件输出)

> 📋 **审查观察(清单外)**:config.ts `buildProviders()` 为每 provider 硬编码 `videoMinIntervalMs`,vision provider 会得到语义无意义的非零默认值(轻微 noise,不影响正确性)。建议 modality-aware 字段过滤或文档说明。

---

## 七、实施路线(M1-M4,可验证里程碑)

| 阶段 | 周期 | 交付 | 验证标准(节选) |
|---|---|---|---|
| **M1 纯 JS 兜底** | 1 周 | types.ts 组合类型重构 + vision 类型 + 去引擎词 hints;tesseract.ts;tesseract.js 依赖;extract_text 工具;isImageUri 抽取 | build 零错(含全部 video/image callsite 加 asXxxProvider 守卫,TS 编译自纠正);**R-FF-04 AST 扫描:extract_text case 转发率=0**(非裸 `return p.recognize`);extract_text 验证码返回数字带 bbox+confidence;中文文档(精度弱但可用);list_models 含 tesseract 块标 visionTasks;12 工具回归零变化;WASM worker 不挂进程 |
| **M2 PaddleocrProvider** | 1-2 周 | paddle.ts HTTP 客户端;docker-compose;extract_table/analyze_chart/describe_image 三工具;README 识别章节 | 4 工具全跑通(extract_table TEDS≥85);fallback 链:停 paddle→extract_text 回落 tesseract,另 3 task 清晰报错;paddle 5xx withRetry + 429 限速学习;provider_used 返回 activeProvider |
| **M3 VLMProvider** | 1 周 | vlm.ts OpenAI 兼容;vllm Qwen2.5-VL-7B;analyze_chart/describe_image fallback 链打通 | describe_image 自由 VQA;analyze_chart 双路切换;手写/化学式由 vlm 兜底;DashScope 模式跑通 + 数据出域边界说明 |
| **M4 收尾发布** | 3 天 | rejected-by-design 进 README + PR 模板;R-CI-07/R-CHG-01 声明;0.11.0 发版;check-schema 加 4 工具 | 三档部署矩阵清晰;Apache 全栈声明 + 4 大 license 坑规避;现有用户零迁移成本 |

> 📋 **审查观察(清单外)**:方案 M1 验证标准称"video 3 callsite 加守卫",实际 grep 有 5-6 处 video 调用点。但 TypeScript 编译会捕获所有遗漏(videoConstraints 变可选后裸调编译失败),M1 build 零错是自纠正机制——建议把计数修正为"全部 video/image callsite"。

---

## 八、文件变更清单

| 动作 | 文件 | 用途 |
|---|---|---|
| 改 | src/providers/types.ts | 新增 vision 类型 + MediaProvider 改 TS 组合类型(v1.1 已采纳,消解 R-INT-03 接口过胖 / R-CI-08 双声明 / R-DEP-01) |
| 改 | src/providers/registry.ts | isVisionProvider/asXxxProvider 守卫;resolveProvider/capableOf/getFallbackProvider/buildListModelsDetail 各加 vision 分支;字典加 3 key |
| 改 | src/config.ts | 加 defaultVisionProvider(buildProviders 零改动) |
| 新 | src/providers/tesseract.ts | TesseractProvider:WASM worker 单例 + BCP-47→lang 翻译 + segmentation→PSM 翻译 + digitOnly→whitelist(语义级 hints,引擎词零泄漏);tier=1;configured 恒 true |
| 新 | src/providers/paddle.ts | PaddleocrProvider:HTTP 到 paddleocr-mcp;recognize 按 task 分派 PP-OCRv6/PP-StructureV3/PP-Chart2Table;响应归一化;缺 baseUrl 时 configured=false |
| 新 | src/providers/vlm.ts | VLMProvider:HTTP 到 OpenAI 兼容 /v1/chat/completions;recognize 按 task 选 system prompt;默认自托管 vLLM/Qwen2.5-VL-7B |
| 改 | src/index.ts | isImageUri 抽取(R-CI-01);buildTools 加 4 schema;switch 加 4 case;3+ video callsite 加 asVideoProvider 守卫 |
| 改 | package.json | M1 加 tesseract.js ^5.x(Apache);M2/M3 零新依赖(fetch) |
| 新 | config.example.json | tesseract/paddle/vlm 三段示例 |
| 新 | docker-compose.yml | paddleocr-mcp --http :8770 + vllm :8000(M2 起,可选) |
| 改 | README.md / README.en.md | 「识别能力」章节 + License 声明 + rejected-by-design + 三档部署矩阵 |

---

## 九、关键重构决策(9 个,均回应 4 方案分歧 + 审查采纳)

1. **能力袋重构 MediaProvider,而非新增 Provider 基底**(否决方案 A mixin):Provider 基底只服务 registry typing,是 R-DEP-02 空壳;能力袋保持单一 `Record<string, MediaProvider>`,顺带修"imageConstraints? 可选却 generateImage 必选"的既有矛盾。
2. **4 个专精工具,而非 1 个 recognize_image + task enum**(否决方案 D 单工具):R-ABS-01 核心指纹是"handler 内按 caller/mode 分流";vision 4 task 有 4 种产出 shape,单工具必出现按 task 的 4 分支。create_video 的 mode enum 不违例是因为输出 shape 统一(video handle),vision 不可类比。
3. **TesseractProvider 作为 Provider 接入,而非"本地渲染 utility"**(否决方案 B 归 (B)):qr/chart 永远能用、零 fallback 语义;tesseract 中文弱**需要 fallback 到 PaddleOCR**。fallback 是 Provider 横切,塞进 local-render 会丢失或被迫造第二套 fallback(违 R-CI-02)。
4. **不引入 paddleocr-js 进程内推理,走 HTTP**(否决方案 B 纯 JS 双引擎):调研明示 paddleocr-js 仅 PP-OCRv5 不含版面/表格/图表,纯 Node WebGPU 未实测。HTTP 让 Node 保持"零模型加载"纯粹。
5. **M1 只交付 extract_text,另 3 工具 M2 交付**(部分采纳方案 B"先跑通再演进"):M1 加 4 工具但 3 个报错"未配置 paddle",UX 不如只暴露能真跑的 extract_text。把"开箱即用"承诺做实。
6. **resolveProvider 不加 task 第 4 参**(否决方案 A/C):task 只在 vision 分支用,加第 4 参让 image/video 调用看到无关参数,逼近 R-ABS-01。handler 在 resolve 之后用 `visionTasks().includes(task)` 做门禁,语义集中。
7. **License 守门严格化**(综合所有方案):对齐「纯免费 + 无门槛可商用」。默认 Apache 全栈;显式拒绝 AGPL/GPL/阈值/署名/商用申请受限模型;MinerU/Docling 列「可选但需法律确认」不进默认。
8. **MediaProvider 改 TS 组合类型,而非 inline 重声明**(v1.1 采纳审查 Finding 2):inline 能力袋会让 MediaProvider 累计 ~20-22 方法,命中 R-INT-03 接口过胖 + R-CI-08 双声明。改 `type MediaProvider = MediaProviderBase & Partial<ImageProvider> & Partial<VideoProvider> & Partial<VisionProvider>`,子接口单一声明源、自动派生,一举消解接口过胖 + 双声明 + public API 过大(R-DEP-01)。这是「Provider mixin 空壳」与「inline 一切」false dichotomy 之外的第三选项——既无运行时基底(不违 R-DEP-02),又让每个能力面窄(不违 R-INT-03)。
9. **ExtractTextHints 语义级,剥离引擎词**(v1.1 采纳审查 Finding 1):psm(Tesseract 页面分割编号 0-13)→ 语义级 `segmentation: 'auto'|'single-line'|'single-char'|'sparse-text'`,由 provider 翻译为自家 PSM/版面策略;languages → BCP-47(zh-Hans/zh-Hant/en/ja),provider 内部映射引擎 lang 文件名;digitOnly 保留为语义契约但剥离 tessedit_char_whitelist 注释绑定。M2 paddle 接入时 psm 不再语义空洞、languages 代码通用。visionConstraints 同步去 tasks(visionTasks() 单一真值源,Finding 4)。

---

## 十、rejectedByDesign(故意不做,13 项 · R-CI-06)

1. **不做实时视频 OCR**:仅静帧。视频帧序列识别引入第二套异步/批处理生命周期(违 R-CI-02);本批开源无视频 OCR SOTA
2. **不做训练/微调**:media-gen-mcp 是推理/编排层,非训练框架
3. **不做流式渐进识别(同步即可)**:识别秒级返回,不撞 ASYNC_THRESHOLD_SECONDS=60,无需 async/poll 拆分(强行套 poll.ts 触发 R-CI-02)
4. **不造第二套 registry/resolveProvider/fallback**:强制复用现有三函数 + 能力袋守卫。新加 vision 维度是 enum 加值
5. **不做「识别→重写 prompt→再生成」内置闭环**:用户手动链工具即可(如 extract_table → generate_chart)
6. **不做手写体专用模型**:本批开源无 SOTA(TrOCR/PaliGemma-HTR 待成熟),由 describe_image 的 VLM 兜底返回 LaTeX/NL
7. **不引入 LangChain/RAG 向量库**:超出「单一 MCP」定位
8. **不内置付费/商用受限模型**:DocLayout-YOLO(AGPL)/Marker(GPL)/Surya(>$5M)/MinerU(署名+阈值)/Qwen2.5-VL 3B(Research)/72B(>100M MAU)/Docling docling-layout-old(CC-BY-NC)——全不进默认,用户自配自担 license
9. **不做 PDF 多页识别(M1)**:paddleocr-mcp stdio 模式多页仅首页(Issue #16755),必须 --http(M2 起)
10. **不做本地文件路径输入**:image 字段 URI-only,与 create_video 同源约束
11. **不做批量多图(本版单图)**:避参数蔓延;批量由 CC 多次调用或未来加 n 参数走 runPool
12. **不引入 paddleocr-js 进程内推理**:仅 PP-OCRv5 不含版面/表格/图表,纯 Node WebGPU 未实测(决策 4)
13. **不做引擎可插拔注册**:三 provider 通过能力袋 + registry 字典接入,不造「plugin」同义词(R-CI-01)
14. **VisionTask 集合预期稳定**(审查建议补):={extract-text, extract-table, analyze-chart, describe-image};新增 task 是演进事件,会触 ≥3 处,属 4 专精工具决策的已知代价,非意外 OCP 违例

---

## 十一、风险与缓解(10 个)

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 运维复杂度上浮(Paddle/VLM 是 Python HTTP,打破"npx 一个进程"纯粹) | 中 | M1 纯 tesseract 零依赖兜底;M2/M3 docker-compose 一键起 + 未配置时 configured=false 报清晰错误。与 generate_card 需 Chrome、render_video 需 ffmpeg 同性质 |
| 2 | R-CHG-01 单需求触文件略超 5(M1 6 文件/完整 10 文件) | 低 | feature 聚合(周期级,非 per-PR);反向证据:加新生成/识别 provider 仍只触 3 文件,变更放大未恶化(演进迁移 §E #11) |
| 3 | tesseract.js 首调 WASM 冷启动(1-3s) | 低 | worker 单例跨调用复用(参考 0.7.0);tool description 标注;进程退出 terminate |
| 4 | 中文 OCR 精度天花板(纯 JS tesseract 中文弱) | 中 | M2 PaddleocrProvider PP-OCRv6/PaddleOCR-VL-1.6 接管;fallback 按 tier+task 谈判 |
| 5 | @paddleocr/paddleocr-js 诱惑(已规避) | — | rejected-by-design 决策 4,走 HTTP |
| 6 | 类型 widening 下游影响 | 低 | MediaProvider 类型保留(widening 非删除);Agnes/Zhipu 字节级不变;3+ callsite 加守卫语义不变 |
| 7 | VLM 路径数据出域 | 低 | 文档明确自托管 vs DashScope 边界;与现有 Agnes/Zhipu 同类风险一致 |
| 8 | AGPL 传染法律风险(已规避) | — | DocLayout-YOLO rejected-by-design;PaddleOCR 全栈 Apache 是默认主栈 |
| 9 | task='auto' 质量依赖 provider(本方案不触发) | — | 4 工具各自硬编码 task,无 auto 路径 |
| 10 | 单 vision provider 在 M2 前 fallback 短板 | 中 | M1 诚实声明基线;M2 补全;provider_used 字段透明 |

---

## 十二、简单性自证(对照 02 清单)

| 刻度 / 规则 | 级别 | 结论 | 证据 |
|---|---|---|---|
| R-FF-01 分层方向 | 🔴 | ✅ 通过 | handler→registry→provider→backend 单向,vision 与 image/video 同构,无回访 |
| R-FF-02 循环依赖 | 🔴 | ✅ 通过 | types←providers←registry←index 单向,vision provider 不反向 import index |
| R-FF-04=R-DEP-03 穿堂式=0 | 🔴 | ✅ 通过 | handler 4 case 各做 URI 校验+门禁+fallback+shaping,无裸 `return p.recognize(req)` |
| R-CHG-01 变更放大 | 🟡 | ⚠️ 触阈但豁免 | M1 6/M1-M3 10 文件;feature 聚合 + 反向证据(加新 backend 仅 3 文件)→ 演进迁移 §E #11 |
| R-INT-03 接口过胖 | 🟡 | ✅ v1.1 已修正 | 改 TS 组合类型(决策 8):子接口单一声明源,MediaProvider 自动派生,每能力面 <7 |
| R-DEP-02 模块深度 | 🟡 | ✅ 通过 | provider depth 30-40 >> 5 浅壳线 |
| R-DEP-04 相邻层重复 | 🟡 | ✅ 通过 | 签名重叠 ~33% < 60% |
| R-ABS-01 参数蔓延 | 🔵 | ✅ 不触发 | 4 工具拆分;resolveProvider 签名不变;零 flag ≥2 |
| R-ABS-02 错误抽象 | 🔵 | ✅ 通过 | handler 内联差异率 ~60% > 50% |
| R-CI-01 术语一致 | 🔵 | ✅ 通过 | 严格对称命名表(listVisionModels/visionConstraints/defaultVisionProvider)+ isImageUri 抽取 |
| R-CI-02 横切变体 | 🟡 | ✅ 通过 | 横切变体=1,复用 withRetry/isFallbackWorthy/buildProviders/registry 全套 |
| R-CI-06 rejected-by-design | 🔵 | ✅ 满足 | 13+1 项明确不做 |
| R-CI-07 新概念准入 | 🔵 | ✅ 满足 | PR 模板声明 VisionProvider 归属现有 Provider 抽象 |
| R-CI-08 知识重复 | 🔵 | ✅ v1.1 已修正 | visionConstraints 去 tasks(visionTasks() 单一源)+ 删顶层 languages 双口(组合类型消解双声明) |
| R-DEP-05 信息泄漏 | 🟡 | ✅ v1.1 已修正 | ExtractTextHints 语义级:psm→segmentation、languages→BCP-47、digitOnly 剥离引擎参数名(决策 9) |
| §6.3 review 三问 | 🔵 | ✅ 全否 | 无第二套横切/暴露 what 非 how(v1.1 已去 psm 引擎词)/共享函数零 flag 蔓延 |

**§E 防偏差 11 条红线**:全无命中。尤其 #1(无 easy-当-simple,证据全结构性)、#2(阈值命中声明 Warn 非 Fail,仅三硬不变量是 Fail)、#11(vision 是新模态接入,偏航是演进迁移非熵退化)。

---

## 十三、一句话总结

本方案简单,因为它把识别模态放进了系统里早就为它准备好的那个抽屉(Provider 抽象的第三能力组,对称 image/video 已有的开闭结构),用能力袋避开了 stub 桩代码,用 4 工具避开了 task enum 分流,用混合运行时避开了"全有或全无"的运维负担——三档按需上浮,核心零配置可用。

> ✅ **审查 2 条 🟡 + 定位移动已全部采纳(v1.1)**:Finding 1(R-DEP-05 去引擎词,决策 9)+ Finding 2(R-INT-03 组合类型,决策 8)+ Finding 4/5(visionConstraints 去 tasks / 删 languages 双口)+ Finding 8(R-DRIFT-02 定位移动用户已确认,§二定位锚点)均已固化。**方案可进入 M1 实施**(目标 0.11.0)。剩余 Finding 3(R-CHG-01 feature 聚合豁免)/6(task OCP 已记入 rejectedByDesign)/7(handler 缠绕沿用现状)无需改设计。
