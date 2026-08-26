# P0-5 深度调研与实施规划 · 交互式自包含 HTML 图产物(借鉴 Archify)

> **P0-ID**: P0-5
> **范围**: media-gen-mcp 新增"交互式自包含 HTML 图"产物档(与现有 generate_diagram 静态档、render_video 视频档三层分工)
> **定性**: **实现借鉴 + reimplement**(不抄 Archify 代码,license 全绿,严守纯免费/同输入同输出立场)
> **预估工时**: MVP 8-12 人日;含可选 Tier 2 共 14-18 人日(详见 §4.6)
> **生成日期**: 2026-07-21
> **依据**:
> - `Archify深度分析与借鉴报告.md` §三 P0-5 + §四 P0-5 详解 + §五 不建议照搬清单
> - `inv:p05-archify-renderer`(Archify IR→SVG 渲染器深度拆解,带行号证据)
> - `inv:p05-archify-viewer`(Archify template.html 11228 行 viewer/主题/动画/导出深度拆解)
> - `inv:p05-comparable-mermaid-d2`(Mermaid + D2 theming 对比 + PlantUML license 复核)
> - `inv:p05-comparable-others`(markmap/diagrams.net/Excalidraw/tldraw/kroki/xyflow 同品类全景 + license 矩阵 + 实现路径裁决)
> - **实地核实**: media-gen-mcp 根目录 37 个 `src/**/*.ts`(以 `find src -name "*.ts" -type f | wc -l` 为准)、`src/index.ts` 1373 行、`src/diagram/{d2,graphviz,render,types}.ts`、`scripts/check-schema.mjs` 62 行、`package.json` test 脚本。**注**:行数/文件数以 `wc -l` / `find -type f | wc -l` 为准(此前版本误用 JS `split("\n").length`,致三处 +1,详见 §9 open_point #16)。
>
> **勘误提示(2026-07-21 修补)**:本文档 §4.5.5 / §5 Step 1.7 / §6.1-6.2 / §7.2 中"扩展 DiagramRequest + 修改 `d2.ts` 透传 `darkThemeId`(驼峰)"的方案,**已被下游 `P0-5-交互式HTML图实施规划.md` §0 修正表(C1/C2/C3)推翻**。**实施细节以实施规划 §0 为准**:不扩展 DiagramRequest、不改 `d2.ts`,改在 `src/interactive-html/render-d2.ts` 内部传 `darkThemeID`(全大写 ID)/ `noXMLTag` / `salt` 三杠杆。本文档保留原 §4.5.5/§6.1-6.2 表述作为决策历史(就地加 [勘误] 标注),但落地实施请读实施规划 §0。详见 §9 open_point #1(已 RESOLVED)与 #17。

---

## 1. 背景与目标

### 1.1 P0-5 解决什么盲区

media-gen-mcp 当前只有**两档图产物**,缺少中间档:

| 档位 | 工具 | 产物形态 | 缺什么 |
|---|---|---|---|
| 静态档 | `generate_diagram` (D2/Graphviz DSL → SVG/PNG) | 矢量图,固定深/浅色 | 无主题切换 / 无动画 / 无可探索性 / GitHub README 嵌入后**只跟随一种主题** |
| 视频档 | `render_video` (HTML/CSS/GSAP → MP4/GIF/WebM) | 非交互视频 | 非图、不可探索 |
| **缺失:交互档** | (无) | 自包含 HTML(可主题切换/可动画/可点击探索) | **用户想在 GitHub README 嵌一张随系统主题切换的架构图,当前完全无解** |

**调查核实的硬证据**:
- `src/diagram/d2.ts:53-62` — D2 仅暴露 `default(0)/neutral(1)` 两个命名主题 + 数字 themeID,**未透传 D2 原生 `--dark-theme` 参数**,即便 D2 引擎本身支持 SVG 内嵌 `@media (prefers-color-scheme: dark)` 自动双主题切换(见 `inv:p05-comparable-mermaid-d2` §二 curl `d2lang.com/tour/themes/` 铁证:`.d2-xxx .fill-N1` 同时烤进 light+dark 双调色板 + `@media screen and (prefers-color-scheme:dark)` 规则)。
- `src/diagram/render.ts:18-20` `MERMAID_UNSUPPORTED_MSG` — Mermaid 在进程内不可用(需 DOM/jsdom/playwright),但**没人尝试客户端渲染路径**(把 `mermaid.min.js` + DSL inline 进 HTML,在用户浏览器里渲染,这是 markmap 范式)。
- 19 工具里无任何"HTML 产物"工具。`generate_card` 产 PNG/SVG,`render_video` 产 MP4,中间档空缺。

### 1.2 成功标准(可验证)

| # | 标准 | 验证方法 |
|---|---|---|
| S1 | 新增 1 个 MCP 工具 `generate_interactive_diagram`(或 `generate_diagram_html`,见 §4.1 命名决策),19 工具 → 20 工具 | `scripts/check-schema.mjs` 更新断言到 20 工具全绿 |
| S2 | 产物是**单文件自包含 HTML**(所有 CSS/JS inline,无外链脚本,允许 Google Fonts CDN 异步 link 作字体兜底) | 新增 `test/interactive-html-self-contained.test.mjs`,grep `\<script src=` 严格禁外链(允许 `\<link rel=\"stylesheet\"` 指字体 CDN) |
| S3 | 产物 HTML 用纯 CSS 变量 + `html[data-theme]` attribute flip 切换深浅主题,**切主题不改 SVG 几何坐标** | golden byte-compare:dark 模式产物 与 light 模式产物,正则提取 `\<svg[^>]*\>...<!--GeometryEnd--\>` 几何段必须 byte-identical |
| S4 | 产物 HTML 内嵌 SVG 在 GitHub README 嵌入时**自动跟随系统主题** | 产物里必须含 `@media (prefers-color-scheme: dark)` 规则(grep 命中)+ 同一 SVG 内同时存在 dark+light 两套 CSS 变量 |
| S5 | 同输入(同 DSL + 同 theme + 同 seed)两次渲染产物 byte-identical(允许 `\r\n?→\n` 归一化) | golden.test.mjs 加 `interactive-html` 子目录 + 加 `fresh === checked` 字符串全等断言 |
| S6 | MVP 产物 HTML 体积 ≤ 250KB(不含 inlined DSL 数据,含 CSS+JS+模板) | `test/interactive-html-size.test.mjs` 断言 `< 256*1024` 字节 |
| S7 | 向后兼容:19 原工具签名零变化,`generate_diagram` 调用方零感知 | diff `src/index.ts` 中 generate_diagram inputSchema 必须 byte-identical;check-schema.mjs 原 G1/G2(改名)/G3 全绿 |
| S8 | License 全绿(MIT/Apache 2.0 优先,MPL-2.0 文件级 copyleft 接受) | 所有新增依赖 license grep 表见 §7.1;Archify 代码 **0 拷贝** |
| S9 | `prefers-reduced-motion: reduce` 用户打开产物时,动画自动停(`animation:none !important`) | `test/interactive-html-motion.test.mjs` grep CSS 必含 `@media (prefers-reduced-motion: reduce)` 规则 |
| S10 | MVP 支持至少 1 种图类型(架构图)端到端跑通:DSL → HTML → 浏览器打开正常渲染 → 切主题不破几何 → 导出 PNG 正常 | 手工 + puppeteer 截图脚本(可选,见 §5.4) |

---

## 2. 现状(带文件:行号证据)

### 2.1 仓库结构(实地核实)

```
media-gen-mcp/
├── src/
│   ├── index.ts          (1373 行,19 工具 name/description/inputSchema + handler 全集中,L114-491 工具定义、L539-1320 switch case)
│   ├── diagram/
│   │   ├── types.ts      (DiagramEngine 接口,DiagramEngineName = "d2" | "mermaid" | "graphviz")
│   │   ├── d2.ts         (169 行,D2Engine,L53-62 仅 default/neutral 主题映射)
│   │   ├── graphviz.ts
│   │   └── render.ts     (31 行,引擎注册表,L18-20 MERMAID_UNSUPPORTED_MSG)
│   ├── card.ts / chart.ts / formula.ts / icon.ts / qr.ts  (本地确定性工具)
│   ├── render-svg.ts     (resvg/chrome)
│   ├── render-video.ts   (HTML/CSS/GSAP → MP4/GIF/WebM,headless Chrome seek-based)
│   ├── providers/*       (agnes/glm-vision/vlm/paddle/tesseract + key-pool/zhipu-errors/http/registry/types/vision-prompt/zhipu-client/zhipu)
│   ├── pdf/*             (PDF 异步管线)
│   └── vision/*          (ignore-area/tbpu)
├── scripts/
│   └── check-schema.mjs  (62 行,L20 npm test 唯一入口;G1 create_video enum 单一真源锁 / G2 19 工具齐全 / G3 mode+resolution enum)
├── package.json          (test: "node scripts/check-schema.mjs",L20)
├── doc/                  (OCR_测试集/ 是 ad-hoc node 脚本,非单测)
└── (无 test/ 目录、无 *.test.ts、无 src/handlers/ 目录、无 src/checks/ 目录、无 examples/ 目录)
```

**关键事实**:
- **无任何自动化测试套件**。`package.json` L20 `"test": "node scripts/check-schema.mjs"` 只 spawn `dist/index.js` 跑 `tools/list` 校验 enum。MEMORY 里的"97/97"指 `doc/OCR_测试集/` 下 ad-hoc node 脚本(非单测)。
- **错误处理 inline 在 src/index.ts**,模式为 `throw new Error("中文消息")` + `isFallbackWorthy(e)` 兜底(L100/570/585/606/695/723/821)。
- **D2 WASM 已在用**(`@terrastruct/d2 ^0.1.33`,`src/diagram/d2.ts`),进程内、无 spawn、无浏览器,**是 MVP 后端首选**(见 §4.3 路线裁决)。
- **本地已有 Archify 工艺骨架**:`/Users/wangdong/Documents/Project/Agnes AI接入/doc_v11/archify-investigation/` 13 个文件(6 renderer + 4 schema + SKILL.md + 2 stub),由 P0-5 调查者整理,**非抄源码,是工艺干净重写**(已落地 `c-backend`/`a-emphasis`/`t-muted` 等语义类名,见 inv:p05-comparable-others §六 A 路线草案)。**但这只是参考素材,不在 media-gen-mcp 仓库内,P0-5 落地仍需从 doc_v11 拷贝/重写**。

### 2.2 关键代码位置(供 §4 改动定位参考)

- `src/index.ts:287-303` — `generate_diagram` 工具定义(name + description + inputSchema)。
- `src/index.ts:938-958` — `generate_diagram` handler `case` 块。
- `src/index.ts:1325` 附近 — `requireNonEmptyString(name)` 等参数校验 helper。
- `src/diagram/types.ts:1-46` — `DiagramEngine` 接口 + `DiagramRequest` / `DiagramRenderOutput` 类型。
- `src/diagram/d2.ts:53-62` — `D2_THEME_NAME_TO_ID` + `resolveD2Theme()`,**未透传 darkTheme**(P0-5 需补)。
- `src/diagram/render.ts:23-27` — `getDiagramEngine(name)` 返回 `d2 | graphviz | undefined`,mermaid 落 undefined。
- `scripts/check-schema.mjs:48-49` — G2 断言 19 工具齐全,P0-5 落地后须改 20。

---

## 3. Archify 是怎么做的(带证据)+ 借鉴边界

### 3.1 Archify 渲染器架构(一句话)

**"LLM-写死坐标 + 纯几何 renderer + 严格 validator"** 三件套,主动拒绝 auto-layout,把"放在哪里"当成图要传达的信息(spatial narrative)。renderer 只做 5 件机械活(包络 / viewBox / anchor / 折线圆角 / legend),不算全局布局。

### 3.2 Archify 关键工艺(可借鉴 vs 不借鉴)

| 工艺 | 证据(inv 引用) | P0-5 是否借鉴 | 理由 |
|---|---|---|---|
| **手写 SVG 字符串 + 语义类名(`c-backend`/`a-emphasis`)+ CSS 变量换肤** | inv:p05-archify-renderer §2.5 `renderSvg()` L405-428 字符串拼装,z-order 由文档顺序硬定 | ✅ **借鉴**(reimplement) | 让主题切换 = 改 `html[data-theme]` 一个属性,不重渲染、不重算几何。是"viewer 特性绝不污染几何"不变量的实现基础 |
| **`@media (prefers-color-scheme: dark)` + 双变量同烤进单 SVG** | inv:p05-archify-viewer §4 SVG 导出 autoTheme=true;inv:p05-comparable-mermaid-d2 §二 D2 也走此范式(curl 铁证) | ✅ **借鉴**(D2 已自带,直接透传) | 单文件 HTML/SVG 在 GitHub README 自动跟随系统主题 |
| **三层校验闸门(schema → ajv → loader 跨集合事实)** | inv:p05-archify-renderer §2.3 `validateArchitecture()` L127-260,注释 L126 `// Validation: mechanical correctness, never layout taste` | ⚠️ **降级借鉴** | media-gen-mcp 不走 IR 路线(见 §3.3),只搬"错误消息含 path + 阈值 + 修复动词"契约(已属 P0-2 范畴) |
| **actionable error hints(`suggestLabelObstacleFix` 给具体坐标)** | inv:p05-archify-renderer §3.1 geometry.mjs L642-670 | ❌ **不借鉴** | 仅在走 IR + 手写 SVG 路线时需要;P0-5 走 DSL 路线,引擎自己管几何 |
| **template.html sentinel 替换(`ARCHIFY:SVG_SLOT_START/END` + `applyTemplate`)** | inv:p05-archify-renderer §3.3 utils.mjs L62-89;inv:p05-archify-viewer §3 utils.mjs L116-141 用函数式 `.replace()` 避免 `$&` 解释 | ✅ **借鉴范式**(markmap 同款) | 极简、零依赖、确定性;比 SSR/JSX 简单一个数量级 |
| **Motion Governor(5 触发条件强制 `animation:none !important`)** | inv:p05-archify-viewer §3 line 5132-5397(~265 行 JS);触发条件:`[data-motion=still]/[data-embed]/[data-document-hidden]/prefers-reduced-motion/无 [data-motion-capable]` | ✅ **借鉴极简版**(~50 行 CSS+JS) | 无障碍硬需求;只留 `prefers-reduced-motion` + 1 个暂停按钮,删互斥所有者逻辑(单面板不需要) |
| **导出时清理 viewer-state 属性黑名单** | inv:p05-archify-viewer §4 line 4322-4441(~120 行 `removeAttribute` 清洗) | ✅ **借鉴骨架**(列黑名单即可,不做大清洗) | 保证"导出 = authored 静态几何";P0-5 MVP 只用 SVG 双主题注入 + PNG canvas.toBlob,viewer-state 属性少 |
| **serializeSvg off-DOM probe 实测解析 CSS 变量** | inv:p05-archify-viewer §4 line 4487-4520 `resolveVars(themeAttr)` | ✅ **借鉴**(PNG 导出必走) | 保证光栅化色彩跟 viewer 一致,新加 CSS 变量不漏。inv 原话"`--lane-fill/--lane-stroke once were`"是踩过的坑 |
| **SVG clone 放大 4× 让浏览器原生光栅化** | inv:p05-archify-viewer §4 line 4591-4660;`MAX_CANVAS_PIXELS = 16M`(iOS Safari 上限),`pickSafeScale` 自动 4→3→2→1 降级 | ✅ **借鉴**(PNG 导出必走) | 避免 canvas upscaling 模糊;`pickSafeScale` 防 iOS 空白画布 |
| **10500 行 viewer(Story Trail / Route Probe / Semantic Lens / Overview Radar / Intent Trace / Node Finder / Presentation Stage / Diagram Guide)** | inv:p05-archify-viewer §5 七交互面板占 71% JS;Intent Trace 2336 行最大 | ❌ **不借鉴**(过度工程) | media-gen-mcp 是横向 MCP server,非高保真架构图深耕 skill;Archify 自身 v3 盲测 FAIL 也证明"布局才是产品,不是 CSS/viewer 特性堆叠"。**MVP 只保留 pan/zoom + theme toggle** |
| **拒绝 auto-layout(grid 模式 + LLM 写死坐标)** | inv:p05-archify-renderer §6.1 + grid.mjs L1 注释 `Not auto-layout — fixed cell math only`;architecture.schema.json L30-37 `layout.mode` enum 只有 `["grid"]` | ❌ **不借鉴**(立场相反但不对立) | media-gen-mcp 的 `generate_diagram` 故意走 auto-layout(D2 dagre)为了"DSL 直传快速出图",**面对不同问题**(见 §五 §5.5)。P0-5 复用 D2 auto-layout,不改立场 |
| **5 类架构图 IR + 双层 validator + ajv standalone codegen** | inv:p05-archify-renderer §3.2 validator.mjs + generated-validators.mjs(256KB) | ❌ **不借鉴** | media-gen-mcp 是 MCP server 不是 skill 分发,运行时依赖 ajv 不是负担(`Archify深度分析与借鉴报告.md` §五 §5.2);且 P0-5 不引入 IR |
| **11 bounded recipe + guide 子命令** | inv:p05-archify-renderer §1 SKILL.md L31-33 | ❌ **不借鉴**(本 P0 范围外) | 属 P1-9 SKILL.md 覆盖层 + P2-3 Bounded Recipes 画廊,不在 P0-5 |
| **WebM 导出(canvas.captureStream + MediaRecorder 自绘帧)** | inv:p05-archify-viewer §4 line 4676-4853(~177 行最复杂模块) | ❌ **不借鉴** | media-gen-mcp 已有 `render_video`(headless Chrome seek-based + ffmpeg)更好,无需重复造轮子 |

### 3.3 为什么 P0-5 不走 Archify IR 路线(立场红线)

**立场冲突**:Archify 路线 = LLM 在 JSON IR 里写死坐标 + 拒绝 auto-layout + 双层 schema 校验。这会让 media-gen-mcp:
1. **推翻"engine 管布局"的核心价值**——`Archify深度分析与借鉴报告.md` §五 §5.1 立场红线:在 D2/Graphviz 之上架 IR 编译回 DSL 会推翻 engine 价值。
2. **Archify 自己的 v3-mermaid-validation 盲测 FAIL**(`Archify深度分析与借鉴报告.md` §2.5)证明 **auto-layout 才是杠杆、CSS/IR 重绘不是**,Mermaid 输入 + Claude 布局 + Archify CSS 的 C 档好看,A/B 档都难看。
3. **LLM 负担过高**:要求 LLM 为每个节点写 `pos:[x,y]` 或 `row/col`,与 media-gen-mcp"DSL 直传快速出图"哲学对立。
4. **维护成本爆炸**:5 类图各需独立 renderer + schema + validator,Archify 单 HTML 3500 CSS + 7000 JS 内联,集成会让 media-gen-mcp 臃肿。

**结论**:P0-5 走 **DSL→SVG(D2 自带 auto-layout)→ HTML 包装层** 路线,而非 Archify IR→手写 SVG 路线。

### 3.4 同品类调研结论(inv:p05-comparable-* 三份合成)

| 维度 | Mermaid | D2 | Archify | markmap | diagrams.net | Excalidraw | tldraw | kroki | xyflow |
|---|---|---|---|---|---|---|---|---|---|
| License | MIT | **MPL-2.0** | **MIT**(三证) | MIT | Apache-2.0 | MIT | **🔴 专有** | MIT | MIT |
| 自包含 HTML | ❌ 需自写 viewer | ⚠️ WASM/CLI 出 SVG | ✅ 3500+7000 内联 | ✅(offline 模式) | ✅(webapp) | ⚠️ 大 runtime | ✅ | ❌ server 返 bytes | ⚠️ 需 React |
| 自动深浅切换 | ❌ 需重渲染 | ✅ **SVG 内置 @media** | ✅ autoTheme 双变量 | ✅ `.markmap-dark` + @media | ✅ | ⚠️ | ✅ | ❌ | ⚠️ |
| 进程内可用 | ❌ 需 DOM | ✅(已在用) | ✅ | ✅ | ❌ webapp | ❌ webapp | ❌ webapp | ❌ server | ⚠️ |
| 集成代价 | 中 | **零**(已用) | 大 | 小(80 行) | 极大 | 极大 | 🔴 红线 | 中 | 大(React) |

**裁决(三条,严守纯免费立场)**:
1. **D2 是 MVP 后端首选**:已在进程内、license MPL-2.0 文件级 copyleft 接受(修改 .go 源文件须回馈,链 npm 包无需)、SVG 自带 `@media prefers-color-scheme` 双调色板。**P0-5 第一阶段只暴露 D2 现有 darkTheme 参数 + HTML 包装层,零自研渲染代码**。
2. **markmap 范式是 HTML 包装的最佳模板**(template + fillTemplate + offline inlineAssets + prefers-color-scheme 四件套,80 行 TS 零依赖可复刻),**不整包集成 markmap-cli**(避免拖入 hono/chokidar/commander 等领域无关依赖)。
3. **不集成 Archify 整套 renderer/viewer、不集成 tldraw(license 红线)、不集成 xyflow(React 重 runtime)、不集成 diagrams.net/Excalidraw(webapp 过度工程)、不集成 kroki(server-side 与多 provider 架构正交)**。

### 3.5 License 终态矩阵(全表,严守纯免费立场)

| 依赖 | license | 用途 | 商用安全 | P0-5 是否引入 |
|---|---|---|---|---|
| `@terrastruct/d2` | **MPL-2.0** | 已用,D2 WASM 进程内渲染 | ✅(npm 链接不传染) | 已用,无新增 |
| `@viz-js/viz` | **MIT**(三证核实,见 §9.13) | 已用,Graphviz WASM | ✅ | 已用,无新增 |
| Mermaid(可选 Tier 2) | MIT | 客户端渲染,inline mermaid.min.js | ✅ | 可选,不阻塞 MVP |
| markmap(范式不整包) | MIT | 借鉴 template 范式 reimplement | ✅ | 不引入包,只抄 80 行范式 |
| Archify | **MIT**(五证:root LICENSE + `archify/LICENSE` + `package.json` + `archify/SKILL.md` frontmatter + README 徽章;前两条均 1146 字节 HTTP 200 真实 MIT 文本,非 9 字节 404 fallback;**fork of Cocoon-AI/architecture-diagram-generator,both MIT**) | 借鉴工艺 reimplement,不抄代码 | ✅ | 不引入代码,只抄 CSS 变量分层不变量 |
| puppeteer-core | Apache-2.0 | 已用,headless Chrome | ✅ | 已用,导出 PNG 复用 |
| ajv(可选 Tier 2 校验) | MIT | Vega-Lite/Mermaid DSL schema 校验 | ✅ | 可选 |
| **tldraw** | **🔴 专有**(production 需 license key + 强制 watermark + 遥测) | — | ❌ **绝不可碰** | **NO-GO** |

**深度合规注记(`@viz-js/viz`)**:wrapper 代码是 MIT,但内嵌 Graphviz WASM 二进制源自 Graphviz 上游(EPL-1.0)。本矩阵以 npm package.json 声明为准列 MIT(与 npm 依赖矩阵行业惯例一致);若做深度合规审计(如发行商业产品),需另评估 EPL-1.0 二进制链接条款。详见 §9.13 已解决条目。

**重要修正**:`Archify深度分析与借鉴报告.md` §一 §16 写"bundle 中未明确写出 LICENSE 文件,本报告默认 license 未明处理" —— **此判断过保守,经实地复核已是五证确认 MIT**(2026-07-21 复核,详见 §9 open_point #15):(1) root LICENSE `https://github.com/tt-a1i/archify/raw/main/LICENSE` HTTP **200 / 1146 字节**真实 MIT 文本;(2) 子目录 `archify/LICENSE` HTTP **200 / 1146 字节**,与根 LICENSE 逐字节相同;(3) `archify/package.json` `"license": "MIT"` 字段;(4) `archify/SKILL.md` frontmatter `license: MIT`(注:文件在 `archify/SKILL.md` 子目录,根 SKILL.md 返回 9 字节 "404: Not Found" —— 任务提示"SKILL.md 偶发空"的真实原因是路径错,非网络抖动);(5) README shields.io 徽章 + 明文 "Both projects use the MIT license"。**404 baseline 对照**:同源 raw 根 SKILL.md curl 返回 9 字节 404,与 LICENSE 的 1146 字节形成对比,证明 LICENSE 的 200 不可能是 404 fallback 误判。**重要发现**:Archify 是 `Cocoon-AI/architecture-diagram-generator` v1.0 的 fork 和 rewrite(LICENSE 第 3 行 `Copyright (c) 2025 Cocoon AI (original "architecture-diagram-generator")` + README "Archify is a fork and rewrite of ..." + SKILL.md frontmatter `metadata.based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)` 三处互证),整条上游链 Cocoon AI v1.0 → tt-a1i Archify 2.x 均 MIT-clean,license 风险为零。本规划所有"reimplement 不抄代码"结论仍对,**理由从"license 风险"改为"工程适配度"**(避免 10500 行 viewer 臃肿 + 5 类图专精错位 + 长期上游跟踪负担);在新证据下 reimplement 立场更稳。

**再一修正(2026-07-21,gap-fill 核实)**:本矩阵原把 `@viz-js/viz` 标为 EPL-1.0 属**过度保守误标**,实际 npm 包 license 是 MIT(三证一致,详见 §9.13)。结论"✅ 商用安全"仍正确且更稳(MIT 比 EPL-1.0 宽松)。

---

## 4. 详细实施方案

### 4.1 命名决策(必读)

**首选工具名:`generate_interactive_diagram`**(不是 `generate_diagram_html`)

理由:
1. 与现有 `generate_diagram`(静态)/ `render_video`(视频)形成清晰三档命名对仗。
2. `interactive` 是产物差异化的核心(可主题切换/可动画/可点击探索),`html` 只是产物格式。
3. LLM 路由更清晰:"交互式"比"html"更能触发"我要可探索产物"场景。
4. **与 §1.2 S1 对齐**(工具数 19 → 20)。

**Description 末尾加 cross-reference**(`Archify深度分析与借鉴报告.md` §三 P0-1 同款):generate_diagram 新描述里加 `NEXT: for interactive HTML with theme switch + animation, use generate_interactive_diagram`;反之 generate_interactive_diagram 描述里加 `AVOID: for static SVG/PNG in docs, use generate_diagram (lighter)`。

### 4.2 三层分工(必须先在 README/CHANGELOG 写清楚边界)

| 档位 | 工具 | 输入 | 产物 | 适用场景 |
|---|---|---|---|---|
| 静态档 | `generate_diagram`(不动) | D2/Graphviz DSL | SVG/PNG | 文档内嵌、快速出图、agent 友好 |
| **交互档** | **`generate_interactive_diagram`(新)** | **D2 DSL(MVP)/ 可选 Mermaid DSL(Tier 2)** | **单文件自包含 HTML** | **GitHub README 嵌入、可主题切换、可动画、可点击探索** |
| 视频档 | `render_video`(不动) | HTML/CSS/GSAP | MP4/GIF/WebM | 非交互视频产物 |

### 4.3 路线裁决:为什么选 D2 + markmap 范式 reimplement

**基于 inv 三份调查的最终裁决**(详见 §3.4):

| 选项 | 裁决 | 理由 |
|---|---|---|
| **A. D2 后端 + markmap 范式 HTML 包装(自研轻量 viewer)** | **✅ GO(MVP 首选)** | D2 已在进程内零新增依赖、SVG 自带 @media prefers-color-scheme、MPL-2.0 接受、同输入同输出可控。markmap template+fillTemplate 范式 80 行 TS 零依赖可复刻 |
| B. Mermaid 客户端渲染 + JS viewer | ⚠️ **BACKUP(Tier 2 可选)** | mermaid.min.js ~2.8MB 体积大;Archify v3 盲测 FAIL 证明 mermaid 视觉档次低;foreignObject 浏览器外破。**只在用户需要 Mermaid 专有图类型(state/gantt/gitgraph)时启用** |
| C. Reimplement Archify 范式(手写 SVG + IR + Reading Depth/Story 等) | ❌ **NO-GO(立场冲突)** | 推翻 engine 管布局价值;Archify 10500 行 viewer 过度工程;LLM 写坐标负担高;Archify 自身盲测 FAIL |
| D. 集成 markmap(createMarkmap 整包) | ❌ **NO-GO** | markmap 只做 mindmap 一种图;markmap-cli 拖入 hono/chokidar/commander/open/portfinder 等无关依赖 |
| E. 包 xyflow | ❌ **NO-GO** | 形态错位(画布非渲染器)+ React 重 runtime + 不带 layout/DSL |
| F. 集成 tldraw | ❌ **NO-GO(license 红线)** | 伪开源:production 需 key + 强制 watermark + 遥测 |
| G. 集成 Excalidraw/diagrams.net/flowchart.fun | ❌ **NO-GO** | 全是完整 webapp 非 library,过度工程 |

**核心策略**:MVP 走 A(Tier 1,8-12 人日),Tier 2 可选加 B(Mermaid 客户端渲染扩展图类型覆盖,4-6 人日)。**永不走 C/D/E/F/G**。

### 4.4 新增/修改文件清单(给具体路径)

#### 4.4.1 新增文件(media-gen-mcp 仓库内)

```
media-gen-mcp/
├── src/
│   ├── interactive-html/
│   │   ├── template.ts          # HTML 模板字符串 + sentinel 占位符(markmap 范式,~80 行)
│   │   ├── fill-template.ts     # fillTemplate() 字符串 replace + offline inlineAssets(~120 行)
│   │   ├── theme.ts             # CSS 变量层(dark+light 各 ~45 vars)+ preset 极简(~250 行 CSS+TS)
│   │   ├── motion-governor.ts   # 5 触发条件 → animation:none !important(纯 CSS + ~50 行 JS,~120 行)
│   │   ├── export-png.ts        # SVG→Image→canvas.toBlob + pickSafeScale + resolveVars(~200 行,供 handler 调用)
│   │   ├── viewer-min.ts        # 基础 pan/zoom + theme toggle 按钮(~200 行,只核心交互)
│   │   └── index.ts             # 对外接口 renderInteractiveHtml(req) → { html, png? }(~80 行)
│   └── (无其他新增)
├── test/
│   ├── interactive-html.test.mjs        # node:test 主测试套件(契约 + golden + 自包含 + motion + size)
│   ├── golden/
│   │   └── interactive-html/
│   │       ├── architecture-d2.golden.html   # checked-in golden 产物
│   │       └── architecture-d2.input.json    # 输入 fixture(DSL + theme)
│   └── helpers/
│       └── mock-d2.ts                   # 注入 stub D2 输出 deterministic SVG(避免 golden flaky)
├── examples/
│   └── interactive-html/
│       ├── system-architecture.d2       # 示例 D2 DSL
│       └── README.md                    # 示例使用说明
└── scripts/
    └── render-interactive-examples.mjs  # 刷新 golden 脚本(类似 Archify render-examples.mjs)
```

#### 4.4.2 修改文件(media-gen-mcp 仓库内,只点不改)

| 文件 | 行号 | 改动 | 说明 |
|---|---|---|---|
| `src/index.ts` | L114-491 之间(在 generate_diagram 后、generate_qrcode 前) | 新增 `generate_interactive_diagram` 工具定义块(name + description + inputSchema) | 不动其他 19 工具定义 |
| `src/index.ts` | L938-958 后(generate_diagram case 块后) | 新增 `case "generate_interactive_diagram": { ... }` handler | 调用 `renderInteractiveHtml(req)` |
| `src/index.ts` | L287-303 generate_diagram description 末尾 | 加一行 `NEXT: for interactive HTML with theme switch + animation, use generate_interactive_diagram` | cross-reference,与 P0-1 一致 |
| `src/diagram/d2.ts` | L53-62 `D2_THEME_NAME_TO_ID` + `resolveD2Theme` | 加 `darkTheme?: string` 透传到 D2 `--dark-theme` flag(透传 dark themeID,让 D2 把双调色板烤进 SVG)| **这是 MVP 最关键的零成本杠杆**:D2 会自动在 SVG 注入 `@media (prefers-color-scheme: dark)` |
| `scripts/check-schema.mjs` | L48-49 G2 19 工具齐全 | 改为 20 工具齐全,新增 `generate_interactive_diagram` 进 sorted 数组 | 单一真源锁覆盖新工具 |
| `package.json` | L20 test 脚本 | 加 `"test": "node scripts/check-schema.mjs && node --test test/",` 引入 node:test runner | **media-gen-mcp 首次引入自动化单测**(P0-3/P0-4/P0-5 共用) |
| `package.json` | scripts 块 | 加 `"render:golden": "node scripts/render-interactive-examples.mjs"` | golden 刷新脚本 |

**重要立场红线**:**不改 generate_diagram 的 inputSchema / handler 行为**(只加 description 一行 cross-ref + d2.ts 加 darkTheme 可选参数),保证旧调用方零感知(见 §6)。

### 4.5 关键代码骨架/接口签名

#### 4.5.1 `src/interactive-html/index.ts`(对外接口)

```ts
// 完全自包含、确定性、零运行时 DOM 依赖(生成方进程)
import { renderD2ToSvg } from "../diagram/d2.js";  // 复用 D2Engine
import { fillTemplate } from "./fill-template.js";
import { exportPngFromSvg } from "./export-png.js";

export interface InteractiveDiagramRequest {
  /** D2 DSL 源码(MVP 必填,Tier 2 加 mermaid 支持) */
  code: string;
  /** 后端引擎;MVP 只支持 'd2',Tier 2 加 'mermaid'(客户端渲染) */
  engine?: "d2";                    // | "mermaid"(Tier 2)
  /** 浅色主题(D2 themeID 或命名 default/neutral) */
  theme?: string;
  /** 深色主题(D2 themeID 或命名,透传 --dark-theme) */
  darkTheme?: string;
  /** 产物 HTML 标题 */
  title?: string;
  /** 是否内联 mermaid.min.js(Tier 2 only,默认 false → CDN link) */
  offline?: boolean;
  /** 落盘目录 */
  outDir?: string;
  /** 文件名(不含扩展名) */
  name?: string;
  /** 同时导出 PNG 预览(scale=2,用 pickSafeScale 防 iOS 16Mpx 上限) */
  previewPng?: boolean;
}

export interface InteractiveDiagramResult {
  /** 本地 HTML 绝对路径 */
  localPath: string;
  /** 可选 PNG 预览绝对路径 */
  previewPngPath?: string;
  /** 产物 byte 大小(S6 ≤ 250KB 校验用) */
  bytes: number;
  /** 是否双主题烤进(S4 校验用) */
  hasDarkLightDualPalette: boolean;
}

export async function renderInteractiveHtml(
  req: InteractiveDiagramRequest
): Promise<InteractiveDiagramResult> {
  // 1. D2 渲染出带 @media prefers-color-scheme 的 SVG(透传 darkTheme)
  const { svg } = await renderD2ToSvg({
    code: req.code,
    theme: req.theme,
    darkTheme: req.darkTheme,    // d2.ts 需扩展支持
  });
  // 2. 套 HTML 模板(markmap 范式 sentinel replace)
  const html = fillTemplate({
    svg,
    title: req.title ?? "Interactive Diagram",
    css: THEME_CSS + MOTION_GOVERNOR_CSS,
    js: VIEWER_MIN_JS,
    offline: req.offline,
  });
  // 3. 断言自包含 + 双主题 + 体积
  assertSelfContained(html);
  assertDualPalette(html);
  assertSizeUnder(html, 256 * 1024);
  // 4. 落盘
  const localPath = await writeOutput(html, req);
  // 5. 可选 PNG 预览
  let previewPngPath: string | undefined;
  if (req.previewPng) {
    previewPngPath = await exportPngFromSvg(svg, { scale: 2 });
  }
  return { localPath, previewPngPath, bytes: Buffer.byteLength(html), hasDarkLightDualPalette: true };
}
```

#### 4.5.2 `src/interactive-html/fill-template.ts`(markmap 范式)

```ts
// 借鉴 markmap packages/markmap-render/src/index.ts fillTemplate()
// 关键:用函数式 .replace(callback) 避免 $& / $' 被解释为替换模式(inv:p05-archify-viewer §3 utils.mjs L128-134 踩过)
const TEMPLATE = `<!doctype html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__TITLE__</title>
  <style>__CSS__</style>
</head>
<body>
  <div class="toolbar">
    <button data-theme-toggle>🌙</button>
    <button data-export-png>PNG</button>
    <button data-export-svg>SVG</button>
  </div>
  <main class="diagram-container">__SVG_SLOT__</main>
  <script>__JS__</script>
</body>
</html>`;

const SENTINELS = {
  SVG_SLOT: /<!--SVG_SLOT_START-->[\s\S]*?<!--SVG_SLOT_END-->/,
} as const;

export function fillTemplate(opts: {
  svg: string; title: string; css: string; js: string; offline?: boolean;
}): string {
  // 1. SVG 注入:用函数 replace 防 $& 解释
  let html = TEMPLATE.replace("__TITLE__", escapeHtml(opts.title));
  html = html.replace("__CSS__", opts.css);
  html = html.replace("__JS__", opts.js);
  // 2. SVG 内联(不用 sentinel,直接替换 __SVG_SLOT__ 占位符)
  html = html.replace("__SVG_SLOT__", opts.svg);
  // 3. 确定性保证:同输入 → 同输出(无 Math.random/Date.now,无字典乱序遍历)
  return html;
}
```

#### 4.5.3 `src/interactive-html/theme.ts`(CSS 变量分层 + Archify 不变量)

```ts
// 借鉴 Archify template.html L47-128 (~165 行 43 变量)+ L11-28 pre-paint theme resolver
// 不变量(viewer feature 绝不污染几何):CSS 变量只改颜色,SVG 几何坐标永不重算
export const THEME_CSS = `
:root {
  /* dark 默认(可被 [data-theme="light"] 覆盖)*/
  --bg: #0f172a;
  --text: #f8fafc;
  --panel: #1e293b;
  --border: #334155;
  --accent: #6366f1;
  /* 工具栏 */
  --toolbar-bg: #1e293b;
  --toolbar-text: #f8fafc;
}
[data-theme="light"] {
  --bg: #ffffff;
  --text: #0f172a;
  --panel: #f1f5f9;
  --border: #cbd5e1;
  --accent: #4f46e5;
  --toolbar-bg: #f1f5f9;
  --toolbar-text: #0f172a;
}
/* auto 跟随系统 */
@media (prefers-color-scheme: light) {
  [data-theme="auto"] { --bg: #ffffff; --text: #0f172a; /* ... */ }
}
/* Pre-paint 防 FOUC(inv:p05-archify-viewer §1) */
</style>
<script>
  (function() {
    var t = new URLSearchParams(location.search).get('theme')
      || localStorage.getItem('interactive-diagram-theme')
      || 'auto';
    if (t === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.setAttribute('data-theme', 'light');
    } else if (t !== 'auto') {
      document.documentElement.setAttribute('data-theme', t);
    }
  })();
</script>
<style>
/* 继续后续 CSS */
`;

// 关键不变量测试(S3): 提取 <svg>...</svg> 几何段,light/dark 产物必须 byte-identical
export function extractGeometry(html: string): string {
  const m = html.match(/<svg[\s\S]*?<\/svg>/);
  return m ? m[0] : "";
}
```

#### 4.5.4 `src/interactive-html/motion-governor.ts`(Archify 5 触发条件极简版)

```ts
// 借鉴 Archify template.html L5132-5397 (~265 行 JS) 的极简版
// 删:多面板互斥所有者逻辑(media-gen-mcp MVP 只有 1 个面板)
// 留:prefers-reduced-motion + 1 个暂停按钮
export const MOTION_GOVERNOR_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
html[data-motion="still"] *, html[data-embed="true"] * {
  animation: none !important;
}
`;
// JS:暂停按钮 → document.documentElement.setAttribute('data-motion', 'still')
// visibilitychange → 暂停动画(可选,~20 行)
```

#### 4.5.5 `src/diagram/d2.ts` 改动骨架(透传 darkTheme)

```ts
// 现有 L52-62:
const D2_THEME_NAME_TO_ID: Record<string, number> = { default: 0, neutral: 1 };
function resolveD2Theme(theme?: string): number | null { ... }

// 新增 darkTheme 透传(D2 RenderOptions 接受 `darkThemeID`,全大写 ID;已核实 index.d.ts L14 + README L127)
export interface DiagramRequest {
  // ... 现有字段
  darkTheme?: string;  // 新增,可选
}

// 在 D2Engine.render() 内:
const themeID = resolveD2Theme(req.theme);
const darkThemeID = req.darkTheme ? resolveD2Theme(req.darkTheme) : null;
const renderOpts = {
  ...compiled.renderOptions,
  ...(themeID != null ? { themeID } : {}),
  ...(darkThemeID != null ? { darkThemeID } : {}),  // shorthand key=darkThemeID(全大写),D2 会自动烤进 @media prefers-color-scheme: dark
};
```

**注**:`@terrastruct/d2` WASM 的 `RenderOptions.darkThemeID` 字段**已实地核实存在**(`node_modules/@terrastruct/d2/index.d.ts` L12 `themeID?: number;` + L14 `darkThemeID?: number;`,同 RenderOptions interface,light/dark 同 casing 全大写 ID;README "RenderOptions" 章节 L125-127 同述)。原"需实地核实... 若不存在则降级"的 open_point 已关闭(见 §9 open_point #1 与 #14)。**注意 casing**:必须写成 `darkThemeID`(全大写 ID),若误写驼峰 `darkThemeId` 会**静默失败** —— TS 不报错(spread + 变量传参不走 excess property check,只做结构兼容,纠正"TS 当多余属性拒"的早期表述)、运行时无异常,但 D2 WASM(Go)按 JSON key `darkThemeID` 反序列化时找不到驼峰 key → 取零值 → SVG 不注入 `@media (prefers-color-scheme: dark)` 规则 → GitHub README 深色模式主题不切换(MVP 最关键的零成本杠杆悄无声息失效,无编译错误/无运行时异常/无 warning,最难排查的那类 bug)。

#### 4.5.6 MCP 工具定义骨架(`src/index.ts` 新增块)

```ts
// 在 generate_diagram 工具定义后(L303 后)插入:
{
  name: "generate_interactive_diagram",
  description:
    "Generate a SELF-CONTAINED INTERACTIVE HTML diagram (交互式自包含HTML图) that follows system theme (dark/light auto-switch via @media prefers-color-scheme), supports basic animation and pan/zoom. Single .html file with all CSS/JS inlined — embeddable in GitHub README, blogs, design docs. Backend: D2 (built-in WASM, same DSL as generate_diagram). Multilingual triggers: 交互式图 · interactive diagram · diagrama interactivo · diagramme interactif · interaktives Diagramm · интерактивная диаграмма (en/zh/es/fr/de/ru). " +
    "WHEN TO CHOOSE: GitHub README architecture diagram that must follow system theme; blog/wiki embeddable diagram with hover/click exploration; product demo with subtle animation. " +
    "AVOID: static SVG/PNG in docs (use generate_diagram, lighter); video output (use render_video); hand-coding SVG (use render_svg). " +
    "NEXT: preview the HTML in a browser; PNG preview is optionally exported alongside (previewPng=true).",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "D2 DSL source (same syntax as generate_diagram). See generate_diagram description for full D2 syntax guide." },
      engine: { type: "string", enum: ["d2"], default: "d2", description: "Backend engine (MVP: d2 only; Tier 2 may add 'mermaid' for client-side rendering)" },
      theme: { type: "string", description: "Light theme (D2 themeID or 'default'/'neutral'). Default 'default'." },
      darkTheme: { type: "string", description: "Dark theme (D2 themeID or 'default'/'neutral'). When set, D2 inks both palettes + @media (prefers-color-scheme: dark) into the SVG so GitHub README auto-switches. If omitted, theme applies to both modes." },
      title: { type: "string", description: "HTML <title> and visible heading" },
      offline: { type: "boolean", default: false, description: "(Tier 2 mermaid only) Inline mermaid.min.js (~2.8MB) for fully offline HTML. Default false uses CDN." },
      previewPng: { type: "boolean", default: false, description: "Also export a PNG preview (scale=2, pickSafeScale-aware)" },
      name: { type: "string", description: "Output filename (without extension)" },
      outDir: { type: "string", description: "Output directory, default session-dir/output" },
    },
    required: ["code"],
  },
},
```

#### 4.5.7 MCP handler 骨架(`src/index.ts` case 块)

```ts
// 在 case "generate_diagram" 块后(L958 后)插入:
case "generate_interactive_diagram": {
  const code = requireNonEmptyString(args.code, "code");
  const engine = (args.engine as "d2") ?? "d2";
  if (engine !== "d2") {
    return { isError: true, content: [{ type: "text", text: `MVP 只支持 engine="d2"(Mermaid 客户端渲染将在 Tier 2 引入)。` }] };
  }
  const title = optionalString(args.title) ?? "Interactive Diagram";
  try {
    const result = await renderInteractiveHtml({
      code,
      engine,
      theme: optionalString(args.theme),
      darkTheme: optionalString(args.darkTheme),
      title,
      offline: args.offline === true,
      previewPng: args.previewPng === true,
      name: optionalString(args.name),
      outDir: optionalString(args.outDir),
    });
    return {
      content: [
        { type: "text", text: `Self-contained interactive HTML written to: ${result.localPath} (${result.bytes} bytes${result.previewPngPath ? `, PNG preview: ${result.previewPngPath}` : ""}). Open in browser to interact; embed in GitHub README to auto-follow system theme.` },
      ],
    };
  } catch (e: any) {
    return { isError: true, content: [{ type: "text", text: `渲染失败:${e?.message ?? String(e)}` }] };
  }
}
```

### 4.6 步骤分解(可勾选 TODO,每步预估工时)

> 工时单位:**人日**(1 人日 = 8 小时)。总工时 MVP 8-12 人日;含 Tier 2 共 14-18 人日。

#### Tier 1:MVP(必做,8-12 人日)

- [ ] **Step 1.1**(0.5 人日)README/CHANGELOG 写三层分工边界(§4.2)+ 命名决策(§4.1)
- [ ] **Step 1.2**(1 人日)新建 `src/interactive-html/template.ts` + `fill-template.ts`(§4.5.1/4.5.2),不接 D2,先用 stub SVG 测试 sentinel replace 字节确定性
- [ ] **Step 1.3**(1.5 人日)新建 `src/interactive-html/theme.ts`(§4.5.3),43 个 CSS 变量 + `prefers-color-scheme` auto 模式 + pre-paint resolver script
- [ ] **Step 1.4**(0.5 人日)新建 `src/interactive-html/motion-governor.ts`(§4.5.4),极简版 5 触发条件
- [ ] **Step 1.5**(1.5 人日)新建 `src/interactive-html/viewer-min.ts`,pan/zoom(SVG transform)+ theme toggle 按钮 + export PNG/SVG 按钮
- [ ] **Step 1.6**(1 人日)新建 `src/interactive-html/export-png.ts`,`serializeSvg()` + off-DOM probe `resolveVars()`(inv:p05-archify-viewer §4 line 4487-4520)+ `pickSafeScale` 4→3→2→1 降级
- [ ] **Step 1.7**(**关键 0.5 人日**)~~改 `src/diagram/d2.ts` 透传 `darkThemeId`(驼峰)~~ **[勘误:已被实施规划 §0 C1/C2/C3 推翻]** —— 字段名实为 `darkThemeID`(全大写);**最终方案不改 `d2.ts`/`types.ts`,改在 `src/interactive-html/render-d2.ts` 内部传 `darkThemeID`/`noXMLTag`/`salt` 三杠杆**,保持 `generate_diagram` 行为零变化(向后兼容立场)。详见实施规划 §0/§3.2/§6.2 与本文档 §9 open_point #1/#17。
- [ ] **Step 1.8**(1 人日)新建 `src/interactive-html/index.ts`(§4.5.1),组装 + 4 个 assert + 落盘
- [ ] **Step 1.9**(0.5 人日)改 `src/index.ts`:加工具定义(§4.5.6)+ handler case(§4.5.7)+ generate_diagram description cross-ref
- [ ] **Step 1.10**(1 人日)新建 `test/interactive-html.test.mjs`(§5.1 node:test 契约 + golden + 自包含 + motion + size)
- [ ] **Step 1.11**(0.5 人日)改 `package.json` test 脚本引入 `node --test test/`,改 `scripts/check-schema.mjs` G2 到 20 工具
- [ ] **Step 1.12**(1 人日)新建 `examples/interactive-html/system-architecture.d2` + 跑通端到端 + commit golden 产物
- [ ] **Step 1.13**(0.5 人日)手工浏览器验证(S10)+ 截图入 `examples/`(可选用 puppeteer 截图脚本)

#### Tier 2:可选扩展(4-6 人日,优先级 P1)

- [ ] **Step 2.1**(2 人日)Mermaid 客户端渲染支持(`engine: "mermaid"`),inline `mermaid.min.js` 或 CDN link
- [ ] **Step 2.2**(1 人日)Mermaid 11 主题(dark/default/base)配置 + themeVariables brand 化
- [ ] **Step 2.3**(1-2 人日)更多 viewer 交互:minimap(可选)/ 键盘快捷键(?/T/E/F)/ Story Trail(章节回放)
- [ ] **Step 2.4**(1 人日)独立 `examples/` 子目录扩展覆盖 sequence/state/gantt(Mermaid 专长)

#### 永不做(立场红线)

- [x] ~~Reimplement Archify 10500 行 viewer(Story Trail/Route Probe/Semantic Lens/Intent Trace 等)~~(过度工程 + 立场冲突)
- [x] ~~引入 IR + 手写 SVG 路线~~(推翻 engine 管布局价值)
- [x] ~~集成 tldraw~~(license 红线)
- [x] ~~包 xyflow~~(React 重 runtime)
- [x] ~~集成 Excalidraw/diagrams.net/flowchart.fun~~(webapp 过度工程)
- [x] ~~直接抄 Archify 代码~~(虽 MIT 但工程适配度差,选 reimplement)

---

## 5. 测试方案

### 5.1 node:test 套件(从零引入,P0-3/P0-4/P0-5 共用)

**关键事实**:media-gen-mcp 当前**无任何自动化测试套件**(仅 `check-schema.mjs` enum 校验)。P0-5 落地同时引入 `node:test` runner,作为 P0-3/P0-4/P0-5 的共用基础设施。

`test/interactive-html.test.mjs` 骨架:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInteractiveHtml } from "../dist/interactive-html/index.js";
import { readFileSync, readFileSync as read } from "node:fs";

test("S2: 产物自包含(无外链 <script src=>)", () => {
  const html = renderExampleHtml();
  assert.doesNotMatch(html, /<script\s+src=/, "no external script src allowed");
});

test("S3: light/dark 产物 SVG 几何段 byte-identical", () => {
  const light = renderExampleHtml({ theme: "default", darkTheme: undefined });
  const dark = renderExampleHtml({ theme: "neutral", darkTheme: "default" });
  const extractSvg = (h) => /<svg[\s\S]*?<\/svg>/.exec(h)?.[0] ?? "";
  assert.equal(extractSvg(light), extractSvg(dark), "geometry must not change with theme");
});

test("S4: 含 @media (prefers-color-scheme: dark) 规则", () => {
  const html = renderExampleHtml({ darkTheme: "default" });
  assert.match(html, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
});

test("S5: 同输入两次渲染 byte-identical(normalizeNewlines 后)", () => {
  const a = renderExampleHtml({ code: FIXTURE_D2 });
  const b = renderExampleHtml({ code: FIXTURE_D2 });
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  assert.equal(norm(a), norm(b));
});

test("S6: 产物 HTML ≤ 250KB", () => {
  const html = renderExampleHtml();
  assert.ok(Buffer.byteLength(html) <= 256 * 1024, `size = ${Buffer.byteLength(html)}`);
});

test("S9: prefers-reduced-motion 规则存在", () => {
  const html = renderExampleHtml();
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
});

test("golden: fresh render === checked-in golden", () => {
  const fresh = renderExampleHtml({ code: readFixture("architecture-d2.input.json").code });
  const golden = read("test/golden/interactive-html/architecture-d2.golden.html", "utf8");
  const norm = (s) => s.replace(/\r\n?/g, "\n");
  assert.equal(norm(fresh), norm(golden));
});

// 单点 mutation 错误契约(对应 P0-2)
test("error contract: empty code → isError + message 含 'code' + remediation verb", async () => {
  const r = await renderInteractiveHtml({ code: "" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /code/i);
  assert.match(r.content[0].text, /provide|必须|non-empty/i);
});
```

### 5.2 golden 基线管理

- 新建 `test/golden/interactive-html/architecture-d2.golden.html`(checked-in)+ `.input.json`(输入 fixture)。
- 新建 `scripts/render-interactive-examples.mjs`(类似 Archify `render-examples.mjs`),`npm run render:golden` 刷新。
- **确定性审计**:落地前用同输入连跑两次 diff,确认无时间戳/构建路径泄漏。D2 dagre 同 seed 输出可能微变 → 若发现非确定性,**降级**为 SVG 几何结构断言(extractGeometry 比对)而非全文 byte-compare(列入 open_points)。

### 5.3 不破坏现有行为(`scripts/check-schema.mjs` G1/G2/G3 必须全绿)

- G1(create_video enum 单一真源锁)不动。
- G2(19 → 20 工具齐全)更新断言。
- G3(mode/resolution enum)不动。
- **现有 19 工具的 inputSchema 必须 byte-identical**(diff 确认只新增 generate_diagram description 末尾一行 + 新增工具块)。

### 5.4 端到端验证(可选,手工 + puppeteer)

```bash
# 生成示例
node dist/index.js  # 启 MCP server,由 Claude 或 inspector 调 generate_interactive_diagram

# 或直接调渲染函数
node -e "import('./dist/interactive-html/index.js').then(m => m.renderInteractiveHtml({ code: 'a -> b', darkTheme: 'default', name: 'e2e', outDir: '/tmp' }))"

# 手工浏览器打开 /tmp/e2e.html 验证(S10):
# - 正常渲染
# - 切主题不破几何
# - prefers-reduced-motion 强制停动画(用 devtools emulate)
# - 导出 PNG 正常
```

可选 puppeteer 截图脚本入 `scripts/screenshot-interactive-examples.mjs`,但**不阻塞 MVP**(手工已够)。

---

## 6. 向后兼容策略(旧调用方零感知)

### 6.1 inputSchema 不破

- 19 原工具 inputSchema **byte-identical**(diff 验证)。
- `generate_diagram` description 末尾加一行 cross-ref(P0-1 风格),不影响参数 schema。
- ~~`src/diagram/d2.ts` 新增 `darkTheme?` **可选**字段,旧调用不传则行为完全不变。~~ **[勘误:已被实施规划 §0/§6.2 推翻]** `src/diagram/d2.ts` **不改**,三杠杆(`darkThemeID`/`noXMLTag`/`salt`)在新 wrapper `src/interactive-html/render-d2.ts` 内部直传给 D2 RenderOptions,D2Engine.render() 路径 byte-identical,旧调用方零感知(比原"加性"主张更强的兼容保证)。

### 6.2 handler 不破

- 19 原 case 块逻辑零变化。
- 新增 `case "generate_interactive_diagram":` 独立块,不影响其他 case。
- ~~D2 `darkThemeId` 透传是**加性**的:不传 darkTheme 时 D2 输出与现有一致。~~ **[勘误:已在实施规划 §6.2 重写]** 三杠杆(`darkThemeID`/`noXMLTag`/`salt`)在 `src/interactive-html/render-d2.ts` 内部直传,完全不碰 `src/diagram/d2.ts`,`generate_diagram` 路径 byte-identical(比原"加性"更强的兼容保证)。

### 6.3 npm 包发布不破

- `package.json` 版本号 bump:0.11.0 → 0.12.0(MINOR,新功能向后兼容)。
- `files` 字段加 `"dist/interactive-html"`(若独立子目录),或继续 `"dist"` 全量。
- 用户 `npm install media-gen-mcp-server@latest` 自动获得新工具,旧调用代码无需改。

### 6.4 测试不破

- `scripts/check-schema.mjs` 只更新 G2 工具数断言,G1/G3 不动。
- 引入 `node:test` 是**加性**的(新增 test/ 目录,不改 check-schema.mjs 现有逻辑)。

### 6.5 用户 memory 不破

- MEMORY 已有的 `media-gen-mcp-agnes-constraints.md` / `media-gen-mcp-project.md` 不动。
- 新增一条 memory `media-gen-mcp-interactive-html.md` 记录 P0-5 产物档(由后续 memory-update agent 执行,不在本 P0 范围)。

---

## 7. 风险与缓解

### 7.1 License 风险

| 风险 | 缓解 |
|---|---|
| Archify 代码误抄(虽 MIT) | **0 拷贝**:所有 CSS/TS 全部 reimplement,只抄"工艺思路"(CSS 变量分层 / sentinel replace / Motion Governor 触发条件清单)。`git log` 可审,无 Archify 源码文本 |
| 误集成 tldraw(license 红线) | 本规划已明列 NO-GO;review checklist 加一条"grep node_modules 无 tldraw" |
| Mermaid(Tier 2)inline 进 HTML | MIT,零风险;但需锁定版本号避免 mermaid 升级破坏 golden(列 open_points) |
| markmap 范式 reimplement | 只抄 80 行 template+fillTemplate 思路,不 import markmap 包;`package.json` 不增 markmap 依赖 |

### 7.2 工程风险

| 风险 | 缓解 |
|---|---|
| **过度工程**(Archify 10500 行 viewer 的诱惑) | MVP 严守 1 种图类型(架构图)+ 最小 viewer(pan/zoom/theme toggle/export),Tier 2/3 须单独立项再决策 |
| **产物体积膨胀**(mermaid.min.js ~2.8MB inline) | S6 ≤ 250KB 硬断言;Mermaid 默认走 CDN,仅 `offline=true` 才 inline |
| **D2 dagre 几何非确定性**(同输入两次微变) | golden 降级为 extractGeometry 结构断言而非全文 byte-compare;dagre 锁定版本 |
| ~~**D2 WASM RenderOptions 字段名不确定**(darkThemeId 可能不存在)~~ **[已关闭 2026-07-21]** | 字段名**已核实为 `darkThemeID`(全大写 ID)**(`index.d.ts` L14 + README L127,见 §9 open_point #1/#14);实施规划 §0 C1 已将方案从"改 d2.ts 透传"改为"在 `render-d2.ts` 内直传",无需降级 CSS 变量方案 |
| **维护负担**(用户要求更多图类型/交互特性) | 三层分工文档明确,generate_diagram 静态档 + generate_interactive_diagram 交互档 + render_video 视频档;新需求按档路由不堆叠 |
| **`@napi-rs/canvas` 在某些环境装不上**(PNG 导出依赖) | 已是 optionalDep,降级到 puppeteer-core screenshot 或纯 SVG 输出 |
| **node:test 首次引入**(全队不熟) | Tier 1 Step 1.10/1.11 先跑通最简契约测试;P0-3/P0-4 复用 |

### 7.3 立场风险

| 风险 | 缓解 |
|---|---|
| **同输入同输出可入 git 立场被破**(D2 dagre 微变) | golden 用 extractGeometry 结构断言,仍可入 git(structure-level deterministic);MEMORY 的"同输入同输出"承诺降级为"同输入同结构" |
| **纯免费立场被破**(误引入 GPL/专有) | §3.5 license 矩阵全表审查;新增依赖必须 license grep + 列表 |
| **不破坏现有 19 工具签名立场被破** | §6.1 diff 验证 byte-identical;CI 加 schema diff stale gate |

### 7.4 可用性风险

| 风险 | 缓解 |
|---|---|
| **LLM 路由混淆 generate_diagram vs generate_interactive_diagram** | description 强 cross-reference(双向)+ P0-1 工作流式 description 改造(独立 P0,不依赖本 P0)|
| **GitHub README 嵌入失败**(某些平台拒绝 `<script>`)| 提供"SVG only"导出(SVG 自带 @media prefers-color-scheme,无需 JS);README 说明各平台嵌入限制 |

---

## 8. 验收清单(Definition of Done)

### 8.1 功能验收

- [ ] S1 20 工具齐全(`scripts/check-schema.mjs` G2 绿)
- [ ] S2 产物自包含(grep 无 `<script src=`)
- [ ] S3 light/dark 几何 byte-identical
- [ ] S4 含 `@media (prefers-color-scheme: dark)`
- [ ] S5 同输入两次 byte-identical(normalizeNewlines 后)
- [ ] S6 产物 ≤ 250KB
- [ ] S9 含 `prefers-reduced-motion: reduce` 规则
- [ ] S10 端到端:浏览器正常渲染 + 切主题 + 导出 PNG

### 8.2 兼容验收

- [ ] 19 原工具 inputSchema byte-identical(diff 验证)
- [ ] `scripts/check-schema.mjs` G1/G2/G3 全绿
- [ ] `npm test` 全绿(check-schema + node:test)
- [ ] `generate_diagram` 旧调用方零感知(手工跑同 DSL 输出不变)

### 8.3 立场验收

- [ ] License 全绿(§3.5 矩阵审查,Archify 0 拷贝、tldraw 0 引入)
- [ ] 同输入同输出 golden 入 git
- [ ] 不破坏现有 19 工具签名

### 8.4 文档验收

- [ ] README 加三层分工段落(§4.2)
- [ ] CHANGELOG 记 0.12.0 新工具
- [ ] `examples/interactive-html/` 至少 1 份示例 DSL + 渲染产物 + 截图
- [ ] generate_diagram / generate_interactive_diagram / render_video description 双向 cross-reference

### 8.5 测试验收

- [ ] `test/interactive-html.test.mjs` 8+ 用例全绿(契约 + golden + 自包含 + motion + size + 单点 mutation)
- [ ] golden 基线 checked-in
- [ ] `npm run render:golden` 可刷新

---

## 9. 未决问题(open_points,诚实列)

1. **[RESOLVED 2026-07-21]** D2 WASM `RenderOptions.darkThemeID` 字段**已实地核实存在**,正确字段名为 `darkThemeID`(全大写 ID,非驼峰 `darkThemeId`)。三源一致铁证:(1) `node_modules/@terrastruct/d2/index.d.ts` L12 `themeID?: number;` + L14 `darkThemeID?: number;`(同 RenderOptions interface,light/dark 同 casing);(2) 同包 README "RenderOptions" 章节 L125-127 同述;(3) 实施规划 §0 C1 独立核实一致。**附带结论**:实施路线也已被实施规划 §0 修正 —— 不改 `d2.ts`/`types.ts`,改在 `src/interactive-html/render-d2.ts` 内部传 `darkThemeID`/`noXMLTag`/`salt` 三杠杆(详见 §9 open_point #17)。原"自研 CSS 变量双主题方案"的降级路径**不需要**。

   **原 open_point 内容(保留作历史)**:D2 WASM `RenderOptions.darkThemeId` 字段是否存在 — Step 1.7 实地核实优先;若不存在,P0-5 降级为自研 CSS 变量双主题方案(~80 行,在 theme.ts 内注入 `[data-theme="dark"] .d2-xxx .fill-N1 { fill: ... }` 覆盖规则),不阻塞 MVP 但多 1-2 人日。

2. **D2 dagre 同输入两次渲染的几何稳定性** — D2 用 dagre auto-layout,同 seed 理论稳定但未实测。若 golden byte-compare 全文比对 flaky,降级为 extractGeometry 结构断言(SVG 子树结构相同即过,允许像素级微差)。**此决策影响"同输入同输出可入 git"立场口径**(byte 级 vs structure 级),建议落地前先做确定性审计。

3. **Mermaid Tier 2 客户端渲染的同输入同输出** — mermaid.min.js 内部用 d3 + dagre,inline 进 HTML 后跨浏览器稳定性未实测。mermaid 升版可能破坏 golden。**建议 Tier 2 落地时锁定 mermaid 版本号 + 同样 byte-compare 守护**(同 P0-3 范式)。

4. **是否在 MVP 就引入 node:test runner** — 本规划建议 P0-3/P0-4/P0-5 共同引入,但若 media-gen-mcp 维护者倾向分阶段,P0-5 可先用 ad-hoc node 脚本(doc/OCR_测试集/ 范式),后续 P0-3 再统一接入 `npm test`。**此决策影响 §5.1 落地节奏**。

5. **是否提供"SVG only"导出路径(无 JS view)作为 README 嵌入兜底** — 某些平台(GitHub 嵌入式 SVG)support `<svg>`,拒绝 `<script>`。MVP 是否同时输出 `.html` + `.svg`(SVG 自带 @media prefers-color-scheme)?**默认建议输出 .html 主 + 可选 previewPng,.svg 暂不单列**(避免产物分裂),若用户强需求再加 `format: "svg"` 参数。

6. **preset 系统(classic/signal-flow/blueprint)是否值得在 Tier 2 加** — Archify 有 3 preset 覆盖 CSS 变量,`Archify深度分析与借鉴报告.md` §五 §5.3 建议不照搬(与 D2 theme 概念冲突)。但若用户需要"signal-flow 动效灵魂"(radial-gradient 背景 + edge-flow 动画),需 ~80 行 CSS + 20 行 @keyframes,**当前建议不引入**,需求驱动再加。

7. **PNG 导出是否依赖 `@napi-rs/canvas`** — `@napi-rs/canvas` 是 optionalDep,某些 Linux 环境装不上。替代方案:用 puppeteer-core screenshot(已用,headless Chrome)或纯 SVG 输出。**Step 1.6 实现时优先 puppeteer-core 截图**(项目已有依赖),`@napi-rs/canvas` 仅作离线兜底。

8. **Mermaid Tier 2 的 DSL 校验** — Mermaid 语法复杂,Jison/Langium 双 parser。若引入 Tier 2,是否需要 ajv schema 校验 Mermaid IR?**当前建议不做**,Mermaid 错误直接透传给用户(P0-2 错误格式化范式),复杂度交给上游。

9. **Story Trail / Guided Views(章节回放)是否值得** — Archify 用 `meta.views` 驱动(~600 行 CSS + 散落 JS)。media-gen-mcp 用户场景若是"README 嵌入式架构图"则不需要;若是"产品 demo 引导式探索"则值得。**当前建议 Tier 3 不做**,需求驱动再加。

10. **CI 集成节奏** — 本规划假设 media-gen-mcp 有 GitHub Actions(README 提交记录支持)。若 CI 未就绪,golden + node:test 只能本地跑,长期 stale 风险。**建议同步推进 CI 接入**(独立工作,不属本 P0 范围)。

11. **generate_interactive_diagram vs generate_diagram_html 命名最终决策** — 本规划首选 `generate_interactive_diagram`(§4.1),理由充分,但需 media-gen-mcp 维护者确认。**若倾向 `generate_diagram_html`**(更直白指向产物格式),description 与 cross-reference 同步调整。

12. **Mermaid 客户端渲染的 securityLevel 默认值** — Mermaid 默认 `strict`(禁所有 click),需配 `loose` 才激活交互。Tier 2 落地时需决定默认值(loose 增强 viewer 交互 vs strict 优先安全)。**当前建议 Tier 2 默认 loose**(README 嵌入场景需可点 link),文档点明风险。

13. **[已解决 2026-07-21] `@viz-js/viz` license 标注错误(原 §3.5 矩阵第 151 行)** —— gap-fill 核实阶段发现并已就地修正。

    - **原文档标注**:`| @viz-js/viz | EPL-1.0 | 已用,Graphviz WASM | ✅(弱 copyleft 二进制链接不传染) | 已用,无新增 |`
    - **答案**:实际 license 是 **MIT**(版本 3.28.0),不是 EPL-1.0。已就地修正 §3.5 矩阵(改 MIT + 删除"弱 copyleft 二进制链接不传染"括号——既然是 MIT 就没有 copyleft 传染问题,该理由段无意义)。根因:viz-js 是 Graphviz 的 WASM 编译产物,Graphviz 上游本体是 EPL-1.0,调查者把"上游 Graphviz license"误当作"`@viz-js/viz` npm 包 license"。npm 包 package.json 只声明 wrapper 代码(MIT)的 license;深度合规视角下内嵌 Graphviz WASM 二进制仍属 EPL-1.0,但本矩阵语境是 npm 依赖矩阵(以 package.json 为准),应列 MIT。错误方向是**过度保守**,不是过度乐观;结论"✅ 接受/商用安全"仍正确且更稳(MIT 比 EPL-1.0 宽松)。
    - **证据(三证一致)**:
      1. 本地 `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/node_modules/@viz-js/viz/package.json` 第 14 行 `"license": "MIT"`,`version: "3.28.0"`(已 Read 全文核实)。
      2. 上游 `github.com/mdaines/viz-js/packages/viz/package.json` 第 14 行 `"license": "MIT"`(通过 mcp__zread__read_file 读取;master 包 version 3.25.0,本地安装 3.28.0 是更新发布,license 不变)。
      3. 上游 `github.com/mdaines/viz-js/blob/master/LICENSE` 首行 "MIT License",第二行 "Copyright (c) Michael Daines",全文为标准 MIT 文本,非 EPL-1.0。
    - **复核范围(§3.5 矩阵其他条目本地 + npm registry 核实,node v24.12.0)**:`@terrastruct/d2@0.1.33`=MPL-2.0 ✅、Mermaid@11.16.0=MIT ✅、markmap@0.6.1=MIT ✅、Archify=MIT(五证,详见 #15)✅、puppeteer-core@25.3.0=Apache-2.0 ✅、ajv@8.20.0=MIT ✅、tldraw(GitHub LICENSE.md)=ELv2-style 专有 ✅。**仅 `@viz-js/viz` 一项错,其余 7 项全对。** §3.4(第 135 行)同品类对比表不含 `@viz-js/viz`,无需改。

14. **[已解决 2026-07-21] gap-fill #1 [P1]:§4.5.5 `darkThemeId`(驼峰)vs `darkThemeID`(全大写)字段名自相矛盾**

    - **原问题**:§4.5.5 代码骨架 L457 shorthand `{ themeID }` 自然得大写 key(对),紧邻 L458 却抛弃 shorthand、硬编码驼峰 key `{ darkThemeId: darkThemeID }`(错),且与 4 行之上刚声明的变量 `darkThemeID`(大写)casing 不一致。全文 7 处驼峰错误(L450/L462/L466/L543/L678/L716/L781);散文(L240 等)对 light `themeID` 大写却心里有数,dark 变体系统性写岔。
    - **答案**:**调查文档 §4.5.5 错**。D2 RenderOptions 正确字段名为 `darkThemeID`(全大写 ID),非驼峰 `darkThemeId`。三源一致铁证(已实地核实)。
    - **证据**:
      1. `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/node_modules/@terrastruct/d2/index.d.ts` L8-14(权威 TS 声明,RenderOptions interface):L12 `themeID?: number;` 注释 "Theme ID to use [default: 0]";L14 `darkThemeID?: number;` 注释 "Theme ID to use when client is in dark mode"。两字段同 casing 全大写 ID。
      2. 同包 `README.md` "RenderOptions" 章节 L125-127:`- \`themeID\`: Theme ID to use [default: 0]` / `- \`darkThemeID\`: Theme ID to use when client is in dark mode`,与 d.ts 一致。
      3. 包元数据:`@terrastruct/d2` version 0.1.33,types 指向 `./index.d.ts`(package.json 核实)。
      4. 实施规划 P0-5-交互式HTML图 §0 C1 独立核实一致(任务上下文互证)。
    - **照抄驼峰的后果(关键,纠正任务表述"TS 当多余属性拒")**:TS **不会**报错 —— excess property check 仅对新鲜对象字面量生效,spread + 变量传参只做结构兼容,`{ darkThemeId?: number }` 结构上可赋值给 RenderOptions,tsc 静默通过。运行时 D2 WASM(Go)按 JSON key `darkThemeID` 反序列化 options,对象上只有 `darkThemeId` 找不到 → 取零值 → SVG 不注入 `@media (prefers-color-scheme: dark)` 规则 → GitHub README 深色模式主题不切换。**净效果:静默失败**(无编译错误、无运行时异常、无 warning),MVP 最关键的零成本杠杆悄无声息失效,是最难排查的那类 bug。
    - **任务表述的一处精确化**:任务描述说"正文说字段名是 darkThemeID" —— 需澄清:调查文档正文其实从未做过"字段名是 darkThemeID"的肯定断言;恰恰相反,正文多处把 darkThemeID 写成 darkThemeId(L450/L462/L466/L543/L678/L716/L781 共 7 处),并在 L466/L543/L716/L781 把字段名列为"需实地核实"的 open_point。所谓"darkThemeID 正确"的断言来自外部真相源(index.d.ts + README),由实施规划 §0 C1 确认。真正的矛盾是:§4.5.5 代码骨架(darkThemeId)vs D2 权威类型(darkThemeID)—— 调查文档本身是"错的一方",且错法是文档级系统性的(7 处驼峰),而非局部笔误。
    - **落地修补**:§4.5.5 L450 注释 casing 修正;L462 改为 shorthand `{ darkThemeID }`(对齐 L457);L466 注重写(原"需实地核实"删除,改为已核实 + casing 警告);§5 Step 1.7(L543)、§6.1(L672)、§6.2(L678)、§7.2(L716)就地加 [勘误] 标注。§9 open_point #1(原 darkThemeId 是否存在)同步关闭。

15. **[已解决 2026-07-21] gap-fill #2 [P1]:§3.5 Archify MIT "三证" 实地复核 + fork 血统发现**

    - **原问题**:§3.5 称 Archify 是 MIT "三证确认"(curl GitHub LICENSE 200 + Copyright 字符串 + SKILL.md frontmatter),但这三证依赖 inv:p05-comparable-others §五 的网络抓取,doc_v11 目录内无原始证据可复核;担心 (a) 200 是 GitHub 的 404 fallback 页;(b) Copyright 字符串是 SKILL.md 自我声明而非 LICENSE 文件本身。
    - **答案**:三证完全坐实,且实际为**五证**。Archify 确为 MIT,reimplement 立场无需重新论证,反而被 fork 血统**加强**。
    - **证据(全部 HTTP 200,非 9 字节 404 fallback)**:
      1. 根 LICENSE `https://github.com/tt-a1i/archify/raw/main/LICENSE`:HTTP **200 / 1146 字节**,完整 MIT License 文本(404 fallback 通常仅 ~9 字节 "404: Not Found")。
      2. 子目录 LICENSE `https://raw.githubusercontent.com/tt-a1i/archify/main/archify/LICENSE`:HTTP **200 / 1146 字节**,与根 LICENSE **逐字节相同**。
      3. `archify/package.json`:`"license": "MIT"` 字段(机器可读声明),HTTP 200 / 943 字节。
      4. `archify/SKILL.md` frontmatter(via mcp__zread__read_file 取得):`license: MIT` 一行,且 `metadata.based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)`。注:文件在 `archify/SKILL.md` 子目录,根 SKILL.md 返回 9 字节 "404: Not Found" —— 这是任务提示"SKILL.md 偶发空"的真实原因,路径错非网络抖动。
      5. `README.md`:shields.io 徽章 `![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)` + 明文 "Both projects use the MIT license" + 有 `## License` 节。
    - **任务两点担心均被证伪**:
      - ❌ "200 是 GitHub 的 404 fallback 页" → 不成立。两条独立 URL(root LICENSE + archify/LICENSE)都返回 1146 字节真实 MIT 文本,内容一致,且包含完整 Permission/No Warranty 条款。GitHub raw 的 404 体只有 9 字节。
      - ❌ "Copyright 字符串是 SKILL.md frontmatter 自我声明非 LICENSE 文件" → 不成立。`Copyright (c) 2026 tt-a1i (Archify)` 是 LICENSE 文件本身的第 2 行(MIT License 头之后),写在 LICENSE 文本里,不是 SKILL.md 自我声明。SKILL.md frontmatter 的 `license: MIT` 是另一个独立来源(第四证),二者不重叠。
    - **重要发现**:Archify 是 `Cocoon-AI/architecture-diagram-generator` v1.0 的 fork 和 rewrite。LICENSE 文件第 3 行明确写:`Copyright (c) 2025 Cocoon AI (original "architecture-diagram-generator")`。README 亦明文:"Archify is a fork and rewrite of Cocoon-AI/architecture-diagram-generator v1.0 by Cocoon AI ... Both projects use the MIT license." SKILL.md frontmatter 的 `based_on` 字段进一步印证。这对 reimplement 立场是**加强而非削弱**:整条上游链(Cocoon AI v1.0 → tt-a1i Archify 2.x)都 MIT-clean,无任何 license 风险。
    - **落地修补**:§3.5 表格 Archify 行(L154)从"三证"补为"五证" + fork 血统;L161 "重要修正"段补五证细节 + fork 发现;§9 #13 复核清单中"Archify=MIT(三证)"同步改为"Archify=MIT(五证)"。doc §3.5 footnote 已正确把 reimplement 理由从"license 风险"改为"工程适配度"(10500 行 viewer 臃肿 + 5 类图专精错位 + 长期上游跟踪负担),这一裁决在新证据下站得更稳,无需修订。

16. **[已解决 2026-07-21] gap-fill #3 [P2]:§2.1 行号统计全部 off-by-one**

    - **原问题**:§2.1 四处装饰性元信息 off-by-one:`src/diagram/d2.ts` 写 170 行(实际 169)、`scripts/check-schema.mjs` 写 63 行(实际 62)、`src/diagram/render.ts` 写 32 行(实际 31)、`src/**/*.ts` 写 38 个(实际 37)。
    - **答案**:全部 4 处偏差确认,根因已查明。**行数 3 处** = JavaScript `String.split("\n").length` 的经典 off-by-one。POSIX 合规文本文件每行(含最后一行)都以 `\n` 结尾,N 个 `\n` 用 `wc -l` 数得 N,但 `"a\nb\n".split("\n")` 得 3 元素(`["a","b",""]`),即恒等于 `wc -l + 1`。三文件 `node fs.readFileSync(f,"utf8").split("\n").length` 得 170/63/32,与文档错误数字**逐位精确吻合**。**文件数 38 vs 37** = 与 split 范式无关的单独 +1 错误(可能手数 / glob 当时多匹配了已不存在的临时文件 / 心算习惯性 +1),六法一致(find / zsh extendedglob / bash globstar / ripgrep / node walk / git ls-files)都得 37,38 不可复现。
    - **任务上下文 vs 未决点的矛盾裁决**:任务上下文"38 已实地核实直接采信"本身错误 —— 该数字继承自文档 §1 L14 未独立核实,是同一个 off-by-one 错误的二次传播。实测 37,未决点正确。
    - **关键旁证**:文档内对具体行的引用 sed 抽样核对全部命中,说明作者读行号的能力没问题(`d2.ts:53-62` 精确命中 `D2_THEME_NAME_TO_ID` + `resolveD2Theme`;`render.ts:18-20` 精确命中 `MERMAID_UNSUPPORTED_MSG`;`check-schema.mjs:48-49` 精确命中 G2 19 工具齐全断言)。错误只出在"总行数/总文件数"装饰性元信息上,不影响任何代码定位结论。
    - **证据**:
      1. 三文件 `wc -l` / `awk END{print NR}` / `sed -n '$='` 三法一致:169 / 62 / 31;末字节 0x0a(`tail -c 1 | xxd` 确认)。
      2. `node fs.readFileSync(f,"utf8").split("\n").length`(node v24.12.0):170 / 63 / 32 —— 与文档错误数字逐位吻合,且三文件 `endsWith("\n")` 均为 true。
      3. 六法 `src/**/*.ts` 文件数 = 37:`find src -name "*.ts" -type f | wc -l` / zsh extendedglob / bash globstar / `rg --files src -g "*.ts"` / node 递归 walk / `git ls-files ":/src/**/*.ts"` 一致;`git log --diff-filter=D --name-only -- "src/*.ts"` 无任何 .ts 删除记录,排除历史文件遗留。
    - **落地修补**:§1 L14 "38 个 src/**/*.ts"→37、"63 行 check-schema.mjs"→62;§2.1 L62 d2.ts "170 行"→169;L64 render.ts "32 行"→31;L72 check-schema.mjs "63 行"→62。§1 实地核实清单加脚注"行数以 `wc -l` / `find -type f | wc -l` 为准(此前版本误用 JS `split("\n").length`,致三处 +1)"。**严重度维持 P2**:不阻塞实施,文档用作实施定位的"行号引用"全部正确,只有总数装饰数字错;但确实削弱"实地核实"承诺,暴露作者用不可靠 JS split 速记而非 wc -l。

17. **[已解决 2026-07-21] gap-fill #4 [P2]:§4.5.5 d2.ts 改动骨架 vs 实施规划 §6.2 "不改 d2.ts" 立场冲突**

    - **原问题**:调研文档 §4.5.5/§5 Step 1.7/§6.1-6.2 主张"扩展 DiagramRequest + 改 d2.ts 透传 darkTheme";实施规划 P0-5-交互式HTML图 §0/§3.2/§6.2 主张"不改 d2.ts/types.ts,改在 `src/interactive-html/render-d2.ts` 内传 darkThemeID/noXMLTag/salt 三杠杆"。两文档立场冲突,且调研文档未追加勘误链接。
    - **答案**:**以实施规划 §0 修正表(C1/C2/C3)为最终决策**——不扩展 DiagramRequest、不改 `d2.ts`/`types.ts`,改在新 wrapper `src/interactive-html/render-d2.ts` 内部传 `darkThemeID`/`noXMLTag`/`salt` 三杠杆。
    - **理由(三重证据)**:
      1. **时序与依赖**:实施规划 L9 明确把调研文档列为"上游依据"(原文:"本规划与其推荐路线一致,但对实施细节做了实地核实修正,见 §0"),是同一日 2026-07-21 落盘的下游文档。
      2. **显式覆盖语义**:实施规划 §0 是一张"相对调研文档的关键修正(实地核实结果)"表,C1-C5 逐条标出调研文档偏差并说明影响;§14 Q6 明文"调研文档方向正确但实施细节按 §0 修正表校准,否则 MVP 必翻车"。
      3. **实地核实优先级**:实施规划 C1 的字段名 `darkThemeID` 经 Read 实际 `node_modules/@terrastruct/d2/index.d.ts` L14 验证为真(`darkThemeID?: number;`;L12 `themeID?: number;`;L28 `salt?: string;`;L30 `noXMLTag?: boolean;`)。调研文档的驼峰 `darkThemeId` 在 TS 下静默通过但运行时被 D2 WASM 忽略,主题不切换(详见 #14)。调研文档 §4.5.5 注 L466 自己也标注"需在实现时实地核实,若不存在则降级 CSS 变量方案" —— 这条 open_point 已被实施规划 §0 C1 关闭。
    - **最终方案(立场红线)**:
      - DiagramRequest **不扩展**;`darkTheme` 字段只出现在新工具 `generate_interactive_diagram` 自己的 `InteractiveDiagramRequest`(实施规划 L239-242)和 MCP inputSchema(实施规划 L187)上,不污染 `src/diagram/types.ts` 的 DiagramRequest。
      - `src/diagram/d2.ts` **不改**;三杠杆在新 wrapper 内直接构造 D2 RenderOptions 时传入,D2Engine.render() 路径零变化,`generate_diagram` 旧调用方零感知。
      - 调研文档 §4.5.5/§5 Step 1.7/§6.1-6.2 是被否决的草稿方案,需勘误兜底避免 reviewer/实施者照抄。
    - **勘误链接缺口的核实**:grep 调研文档全文,无任何指向 `P0-5-交互式HTML图实施规划.md` 的反向链接,也无任何关于 d2.ts 方案被推翻的勘误块。L161 的"重要修正"改的是 Archify license 判断,与本议题无关。调研文档标题就叫"P0-5 深度调研**与实施规划**"(L1),名字本身就让 reviewer 误以为它就是最终实施规划,反而把真正的实施规划挤到次级位置。
    - **落地修补**:头部 metadata 区(§1 L14 后)加"勘误提示"反向引用实施规划 §0;§4.5.5 注(L466)、§5 Step 1.7(L543)、§6.1(L672)、§6.2(L678)、§7.2(L716)就地加 [勘误] 标注。**标题歧义建议**(本 gap-fill 不擅自改):把调研文档标题从"P0-5 深度调研与实施规划"改为"P0-5 源码与同品类深度调研",消除"调研即实施规划"的歧义,留 parent 裁量。
    - **为什么严重度判为 P2 合理**:两文档方向一致(都走 D2 + markmap + reimplement),仅实施细节有 3 处偏差(C1 字段名、C2 noXMLTag、C3 salt),其中 C1 已被实地类型定义证实。真正风险不是技术对错,而是 reviewer/实施者只读到调研文档时,会按"扩展 DiagramRequest + 改 d2.ts + 驼峰 darkThemeId"去实施,结果:(a) 违反最终"不改 d2.ts"立场红线;(b) darkThemeId 驼峰字段被 TS 静默接受但运行时失效,主题切换功能静默失效;(c) 漏 noXMLTag 导致 HTML 解析错乱;(d) 漏 salt 导致 golden byte-compare flaky。这些都是 MVP 必踩坑,但不会立刻让 build 崩,所以 P2(需修正但不阻塞决策)分级恰当。

---

**规划结束**。读者读完此规划应能直接判断:
1. **做不做?** —— **做**(MVP 8-12 人日,堵 GitHub README 主题切换盲区,license 全绿,不破现有)
2. **先做哪个 Tier?** —— Tier 1 MVP(D2 + markmap 范式 + 极简 viewer)→ 验证采用度 → 决定是否做 Tier 2 Mermaid
3. **哪些不做?** —— 永不做 C/D/E/F/G 五条路线(§4.3);不抄 Archify 代码(reimplement);不引入 IR(立场红线)
4. **能不能抄代码?** —— **不能**(Archify 虽 MIT 但工程适配度差,选 reimplement;CSS/TS 全自研只抄工艺思路)
5. **同输入同输出立场守住没?** —— 守住(byte 级 golden;若 D2 dagre flaky 降级为 structure 级,诚实列入 open_points)
