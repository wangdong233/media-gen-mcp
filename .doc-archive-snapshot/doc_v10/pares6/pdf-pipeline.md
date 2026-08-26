# media-gen-mcp · pares6:PDF 异步识别管线功能分析

> 版本基线:media-gen-mcp v0.11.0(16 工具 = 12 生成 + 4 识别)。本档规划 pares6 = 第 5 个识别工具 `extract_pdf` + 异步轮询伴侣 `get_pdf`,工具数 16 → 18。
> 落盘:`doc_v10/pares6/pdf-pipeline.md`。分析日期:2026-07-20。

---

## 1. 问题(当前空白/痛点)

README 已把财务/发票/报表列为识别目标用户,但 `extract_text` 只接受单张图片 URI(`src/index.ts:181` schema:"Image URI: http(s):// or data: URI"),**完全不能处理 PDF** —— 而这恰恰是目标用户的核心输入格式。

痛点细化:

1. **CC 没有原生 PDF 工具**。CC 内置的 Read 工具仅支持图片/PDF 直读(按页码),但不能把 PDF 送给 OCR 引擎。用户必须先把 PDF 每页另存为 PNG,再逐页喂给 `extract_text` —— 一份 50 页财报 = 50 次手动切图 + 50 次工具调用,不可用。
2. **scanned/image-only PDF 无文本层**。财务扫描件、手机拍照发票、PDF 扫描报表均无文本层,pdf-parse / unpdf 这类纯文本提取库直接返空字符串。**必须 render-to-image + OCR** 才有出路。
3. **现有 extract_text 单图同步假设**。10 页 PDF × 3-5s tesseract = 30-50s,贴着 `ASYNC_THRESHOLD_SECONDS=60`(`src/index.ts:47`)边缘;50 页 = 150-250s 必须异步。但当前识别模态没有任何异步路径(只有 video 模态有 `create_video`/`get_video` 异步对)。
4. **paddleocr-mcp Issue #16755** 多页 PDF 仅首页 bug。即使用户配了 paddle provider,也不能依赖上游 serving 原生吃多页 PDF —— 必须在我们进程内把 PDF 拆成单页图片再喂。

代码锚点(已在本次审查中确认):
- `src/index.ts:47` `ASYNC_THRESHOLD_SECONDS = 60`
- `src/index.ts:58` `isImageUri` —— 仅 http/data,需新增 `isPdfUri`
- `src/index.ts:65-92` `runVisionTask`(单图,不可直接复用为多页编排 —— 它是 per-call fallback,跨页会换 provider 导致识别不一致)
- `src/index.ts:555-697` `create_video` handler + `src/index.ts:699-715` `get_video` —— **异步对模板**
- `src/index.ts:717-789` `extract_text` handler —— **per-page 后处理模板**(filterIgnoreAreas → applyTbpu)
- `src/index.ts:423-431` `emitProgress` —— per-page 进度推送入口
- `src/poll.ts:46-71` `waitVideo` —— 瞬时错误有界重试 + 超时返 timeout 模式
- `src/providers/types.ts:168-176` `VisionRequest.image: string`(URI-only)—— **provider 接口零改动即可复用**
- `src/providers/tesseract.ts:121-154` recognize —— 进程内兜底 OCR
- `src/providers/paddle.ts:121-147` recognize —— `/ocr` 端点,paddle 返回每图并行数组
- `src/vision/ignore-area.ts` —— 坐标空间是当前页像素(跨页一致仅当尺寸一致,常见但不保证)
- `src/vision/tbpu.ts` —— 排版重排(25KB,GapTree + ParagraphParse)

---

## 2. 技术方案选项(含调研)

### 2.1 PDF 处理库矩阵

| 库 | License | Bundle | render→image | text 提取 | 维护 | 选型结论 |
|---|---|---|---|---|---|---|
| **pdfjs-dist** | **Apache-2.0** | ~1.5-2MB(+cmap ~1MB) | ✅ page→canvas | ✅ getTextContent | Mozilla 活跃 | **采用** |
| unpdf | MIT | 小(包 pdfjs) | ❌ | ✅ | 活跃 | 仅 text-layer 快路径可考虑,但本进程已用 pdfjs,不另引 |
| pdf-parse | MIT | ~100KB | ❌ | ✅(内置老 pdfjs) | 半停滞 | 不用(功能被 pdfjs 覆盖,且依赖陈旧) |
| mupdf-js | **AGPL-3.0** | ~1-2MB WASM | ✅ 高性能 | ✅ | Artifex 活跃 | **否决**:AGPL 与项目 MIT + "纯免费可商用" 立场冲突(vlm.ts:11 注释明确该立场) |
| pdf-lib | MIT | 小 | ❌(只能生成/编辑) | ❌ | 活跃 | 不用(方向相反) |

**Canvas 渲染后端**(pdfjs 在 Node 需 NodeCanvasFactory):

| 库 | License | 二进制 | 选型 |
|---|---|---|---|
| canvas (npm) | LGPL-2.1(+MIT 部件) | 需 Cairo/Pango 系统库,native rebuild | 否决:npx 用户在 macOS/Win 编译 Cairo 是灾难 |
| **@napi-rs/canvas** | **MIT** | **预编译** darwin/linux/win × x64/arm64 全覆盖 | **采用**:零系统依赖,`npm install` 即用 |

### 2.2 工具命名三选项

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. 新增 `extract_pdf` + `get_pdf`**(对齐 create_video/get_video) | schema 清晰;PDF 专属参数(pageRange/textStrategy/mergePages)独立;符合项目"4 工具避 R-ABS-01 分流"立场;异步对模式成熟 | 工具数 +2(16→18);用户需知晓两工具 | **采用** |
| B. 扩展 `extract_text` 加 `pdf` 参数 | 单工具入口 | image OR pdf 二选一;输出形状分叉(pages[] vs 单 text);破坏"单图 URI" 契约;违反 R-ABS-01 既定决策 | 否决 |
| C. `extract_text` 按 URI 后缀自动多态 | 用户零认知 | 静默多态(项目明确反对,如 4 工具而非 1+enum) | 否决 |

### 2.3 异步状态存放

| 选项 | 描述 | 结论 |
|---|---|---|
| **进程内 Map** | `Map<pdfId, PdfJob>`,TTL 30min,后台 sweeper | **采用**(MCP server 单租户每 CC 会话,无跨进程需求) |
| 文件持久化(~/.media-gen-mcp/jobs/) | 重启可续 | YAGNI v1,后期再加 |
| Redis/DB | 多进程共享 | 完全不需要 |

---

## 3. 推荐方案

**方案 A**:新增 `extract_pdf` + `get_pdf` 异步工具对,栈 = pdfjs-dist(Apache-2.0)+ @napi-rs/canvas(MIT),进程内 job-store,per-page 复用现有 `recognize` + `filterIgnoreAreas` + `applyTbpu`,provider 接口零改动。

核心决策:
- **统一 render→image 路径**:无论 paddle/tesseract/vlm,都在本进程把 PDF 拆成单页 PNG data URI → 走 `recognize({image, task:"extract-text", hints})`。这把 paddleocr-mcp #16755(多页 PDF 仅首页)从根上旁路 —— provider 永远收到的是单张图片。
- **text-layer 快路径**:数字 PDF 先探 `getTextContent()`,有文本层直接返,免 OCR(50 页财报从 200s → 2s)。策略 `textStrategy: "auto"(默认) | "ocr-only" | "text-layer-only"`。
- **跨页 provider 钉定**:第 1 页解析 + fallback 一次,选定 providerUsed 后续页全部用同一家,避免识别结果风格不一致(字体/置信度口径漂移)。这也尊重 video 模态"poll 路径不 fallback"铁律的同构对应。
- **per-page 后处理**:每页独立 filterIgnoreAreas + applyTbpu,块不跨页拼接(GapTree 不被邻页干扰)。
- **进 optionalDependencies**:pdfjs-dist + @napi-rs/canvas 进可选依赖,handler 顶层 try dynamic-import,缺失时返清晰安装提示,不破坏现有 16 工具的"零配置即用"承诺。

---

## 4. 架构(接口/文件/集成点)

```
┌──────────────────────────────────────────────────────────────┐
│  index.ts (MCP 工具层)                                        │
│    extract_pdf ──┐                                            │
│    get_pdf ──────┼──→ src/pdf/pipeline.ts                     │
│                  │      │                                     │
│                  │      ├─→ src/pdf/render.ts (pdfjs + napi)  │
│                  │      │      └─ AsyncGenerator<page PNG>    │
│                  │      ├─→ src/pdf/text-layer.ts (快路径)    │
│                  │      ├─→ src/pdf/job-store.ts (Map+TTL)    │
│                  │      └─→ providers/registry.ts             │
│                  │             └─ recognize(image, task,...)  │
│                  │                  (零改动,per-page 调用)    │
│                  │                                            │
│                  └─→ emitProgress (复用 index.ts:425)         │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 接口(对外工具 schema)

**`extract_pdf`**:
```ts
{
  source: string;            // 必填。http(s):// / data:application/pdf / data:base64,... / 本地 .pdf(由 CC 先读为 data URI)
  pageRange?: string;        // "1-10" / "1,3,5-7" / "odd" / "even" / "last";默认全部
  textStrategy?: "auto" | "ocr-only" | "text-layer-only";  // 默认 auto
  languages?: string[];      // 透传 ExtractTextHints.languages
  digitOnly?: boolean;       // 透传
  segmentation?: "auto" | "single-line" | "single-char" | "sparse-text";
  layout?: "none" | "natural" | "plain" | "code";           // per-page applyTbpu
  ignoreAreas?: Array<{x,y,w,h}>;                           // per-page,坐标空间=当前页像素
  mergePages?: boolean;      // 默认 true;text=所有页 join("\n\f\n");false 时只返 pages[]
  outputFormat?: "text" | "markdown" | "json";              // text/markdown 落 .txt/.md;json 落 .json 含 pages[]+blocks
  scale?: number;            // PDF render scale,默认 2.0(高 DPI)
  concurrency?: number;      // 默认 1(串行);最大 4
  wait?: boolean;            // 省=智能(预估≤60s 同步/>60s 异步);true=阻塞(发 progress);false=立即返 handle
  provider?: string;         // 透传;默认 config.defaultVisionProvider
  download?: boolean;        // 默认 true
  name?: string;             // 输出文件名(无扩展名)
  outDir?: string;
}
```

**`get_pdf`**:
```ts
{
  pdfId: string;       // 必填(extract_pdf 异步返回的 handle)
  download?: boolean;  // 默认 true
  name?: string;
  outDir?: string;
}
```

### 4.2 新文件清单

| 文件 | 职责 | 行数预估 |
|---|---|---|
| `src/pdf/render.ts` | PDF→PNG 渲染层(pdfjs + @napi-rs/canvas + NodeCanvasFactory) | ~150 |
| `src/pdf/text-layer.ts` | getTextContent 快路径 | ~50 |
| `src/pdf/job-store.ts` | in-process Map + TTL sweeper + 进度回调注册 | ~80 |
| `src/pdf/pipeline.ts` | 管线编排(textStrategy 分流 + per-page recognize + 后处理 + 同步/异步决策) | ~200 |
| `src/pdf/page-range.ts` | pageRange 字符串 parser | ~40 |
| `src/pdf/__tests__/` | 单测(render/text-layer/page-range/pipeline) | — |

### 4.3 集成点

- **registry.ts**:零改动(provider 已支持 recognize 单图 URI)。
- **types.ts**:零改动(VisionRequest 不变)。新增 `src/pdf/` 内部类型不进 types.ts。
- **config.ts**:加 `pdf: { maxPages: 200, jobTtlMs: 1800000, scale: 2.0, concurrency: 1 }` 块。
- **package.json**:`optionalDependencies` 加 `pdfjs-dist@^4.x` + `@napi-rs/canvas@^0.1.x`。
- **README**:新增 "档位 4:PDF 识别(extract_pdf)" 章节 + 安装说明(`npm i pdfjs-dist @napi-rs/canvas` 可选)。

### 4.4 异步时序

```
CC ──extract_pdf(src, wait=undef)──→ handler
   handler 估 est = N_pages × estPerPage(provider)
   ├─ est≤60s: 同步走完 → {pages, text, local_path}
   └─ est>60s:
       1. job-store.register(id, {total:N, status:"in_progress",...})
       2. 返回 {async:true, pdfId, status, hint:"get_pdf(pdfId=\"...\")"}
       3. setImmediate(() => pipeline.run(id))  ← fire-and-forget
       4. pipeline 每页 emitProgress(done/total*100)
       5. 完成 → job.status="completed", pages[] 填充

CC ──get_pdf(pdfId)──→ handler 读 job-store
   ├─ status=in_progress: {retry_after_seconds: 5, hint:"..."}
   ├─ status=completed: {pages, text, local_path}
   └─ status=failed: {error}
```

---

## 5. 实施步骤

1. **依赖与开闭**:package.json `optionalDependencies` 加 `pdfjs-dist` + `@napi-rs/canvas`;`src/pdf/render.ts` 顶层 `await import("pdfjs-dist/legacy/build/pdf.mjs")`,缺失即 throw 含 install 命令的友好错误。
2. **page-range.ts**:实现 parser + 单测(边界:"1-3,5,odd,last" / 空串 / 超界 / 倒序)。
3. **render.ts**:`iterPdfPages` AsyncGenerator + NodeCanvasFactory(@napi-rs/canvas)+ CMap 配置(`cMapUrl: new URL("./cmaps/", import.meta.url)`,cMapPacked:true)+ scale + 单页错误隔离。
4. **text-layer.ts**:`extractTextLayer(data) → {hasLayer, pages[]}`;空层判定(pages 全空串 → hasLayer=false)。
5. **job-store.ts**:Map + TTL 30min + 后台 sweeper(setInterval 5min)+ register/get/update/evict。
6. **pipeline.ts**:
   - 同步/异步决策(estPerPage 按 provider:tesseract=4s,paddle=2s,vlm=6s)
   - textStrategy=auto:先 text-layer,有则用
   - ocr 路径:page 1 选 provider(含 fallback 钉定),page 2..N 用同家
   - per-page:filterIgnoreAreas → applyTbpu → push 到 job.pages
   - emitProgress 每页一次
   - mergePages 决定是否合并全文
7. **index.ts schema + handler**:`extract_pdf` + `get_pdf` 工具定义;`isPdfUri` helper;两个 case 分支;落盘扩展名(.txt/.md/.json)。
8. **README** + **_test_pares6_pdf.mjs**:数字 PDF fixture + scanned PDF fixture;schema-check 脚本(scripts/check-schema.mjs)加两条新工具。
9. **5 维审查**(对齐 pares3/pares5 流程):M0 mock 审查 + M1 集成 + M2 边界 + M3 安全(本地路径泄漏)+ 验证报告。

---

## 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **node-canvas native build 痛点** | 用 @napi-rs/canvas(MIT 预编译),否决 `canvas` npm(LGPL 需 Cairo) |
| R2 | **pdfjs-dist worker in Node** | 用 legacy/build/pdf.mjs + 显式 GlobalWorkerOptions.workerSrc 或 disableWorker |
| R3 | **中文 PDF CMap 缺失** | 配 cMapUrl+cMapPacked;bundle pdfjs-dist/cmaps(~1MB)进 files 字段 |
| R4 | **bundle 体积** | pdfjs 1.5MB+cmap 1MB+napi-canvas 3MB ≈ 5MB。进 optionalDependencies,base install 不增;调 extract_pdf 才提示装 |
| R5 | **大 PDF OOM** | 默认 concurrency=1;scale 上限 3.0;maxPages 默认 200(config 可调);render 后立即 canvas.cleanup() |
| R6 | **PaddleX serving PDF 多页** | 不依赖;一律本进程 render→image 再喂 `/ocr`,从结构上旁路 upstream bug |
| R7 | **job-store 不持久** | MCP server 单租户单会话,重启用户重提即可;v2 可加文件持久化(YAGNI) |
| R8 | **跨页 provider 切换风险** | page 1 钉定,后续页禁 fallback(对称 get_video 铁律);paddle 全挂 → tesseract 兜底,warning 透传 |
| R9 | **ignoreAreas 跨页尺寸不一** | 坐标空间是"当前页像素",文档明示;v2 加 ignoreAreasPerPage(数组按页索引)escape hatch;v1 单 ignoreAreas 一致施加(常见发票页尺寸一致) |
| R10 | **per-page TBPU vs 全文合并** | 选 per-page(避免跨页 GapTree 混乱);mergePages=true 时仅做文本拼接,不重排 |
| R11 | **async handle 误用 fallback** | get_pdf 路径绝不 fallback(同 get_video);失败 task 返 status=failed + 错误详情 + handleHint 让用户复查 |
| R12 | **scanned PDF text-layer 假阳性**(OCR 出来的 PDF 嵌入文本层但质量差) | textStrategy=auto 默认;提供 textStrategy=ocr-only 强制 OCR;Warning:若 text-layer 平均每页字数 < 阈值(如 10 字)提示用户切 ocr-only |

---

## 7. 验证标准(DoD)

| # | 场景 | 期望 |
|---|---|---|
| V1 | 1 页数字 PDF(中文,有 text-layer) | textStrategy=auto → 走 text-layer,<2s,字符级精确匹配 |
| V2 | 1 页 scanned PDF(无 text-layer) | 自动转 tesseract OCR,3-5s,有结果 |
| V3 | 10 页 mixed PDF | est>60s → 异步返 handle;get_pdf 轮询到 completed;pages.length=10 |
| V4 | pageRange="1,3,5-7" | 仅处理 5 页,pages 顺序 = [1,3,5,6,7] |
| V5 | ignoreAreas(右上红章) | warning "剔除 N 块",dropped>0 |
| V6 | paddle 配置但 down | page 1 fallback tesseract,warning 透传,所有页用 tesseract |
| V7 | 50 页 PDF 内存 | 2GB heap 下完成无 OOM;peak RSS < 1GB |
| V8 | npm install(darwin-arm64/linux-x64/win32-x64) | 零系统依赖,纯预编译 |
| V9 | extract_pdf 不安装 pdfjs-dist | 友好错误:"请 npm i pdfjs-dist @napi-rs/canvas",不崩 |
| V10 | get_pdf 非终态 | 返 retry_after_seconds:5 + hint |
| V11 | schema 校验(scripts/check-schema.mjs) | extract_pdf + get_pdf 通过 |
| V12 | 117 现有测试 + 新增 PDF 单测全绿 | tsc + node scripts/check-schema.mjs + 新 _test_pares6_pdf.mjs |

---

## 8. 决策快照(给评审)

- **库**:pdfjs-dist(Apache-2.0)+ @napi-rs/canvas(MIT)。mupdf-js 因 AGPL 否决。
- **工具**:新增 `extract_pdf` + `get_pdf`(对齐 create_video/get_video)。扩展 extract_text 方案否决(R-ABS-01)。
- **provider 接口**:零改动。
- **异步**:进程内 Map<TTL=30min>,fire-and-forget + get_pdf 轮询,emitProgress per-page。
- **OCR 路径**:统一 render→image→recognize;旁路 paddleocr-mcp #16755。
- **快路径**:textStrategy=auto 数字 PDF 走 getTextContent(秒级)。
- **provider 钉定**:page 1 选定(含 fallback),page 2..N 用同家;poll 路径不 fallback。
- **包**:pdfjs+napi-canvas 进 optionalDependencies,不破坏零配置承诺。