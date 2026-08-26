# OSS 竞品与交互能力矩阵(支撑文档)

> **生成日期**:2026-07-22
> **主报告**:[`交互图增强调研报告.md`](./交互图增强调研报告.md)
> **本文目的**:把 15 个候选 OSS(节点图库 / 画板编辑器 / text→diagram 工具)的能力 / license / bundle / 单文件可行性 / 契合度交叉打分,给集成路径裁决一个可追溯的真相源。
> **数据来源**:全部 license / bundle / externals 数据均为 `curl GitHub raw + unpkg CDN` 一手核实(2026-07-22,node v24,US region)。
> **立场前置**:① 单文件自包含 HTML(零外链 / 零 node_modules / 离线 / 守 S6 ≤256KB);② 纯免费(MIT/Apache 优先);③ 同输入同输出可入 git;④ 向后兼容(inputSchema 零 diff);⑤ GitHub README 嵌入(JS 受限)。

---

## 0. 立场前置校准(三条易被忽略的硬事实)

### 0.1 "可嵌 GitHub README"对任何 JS 库都不可能 inline 运行

GitHub README 用 `sanitize` gem(rgrove/sanitize)+ `html-pipeline` SanitizationFilter,默认 strip `<script>` / `<iframe>` / event handler / `javascript:` URL / inline `<style>` 块。任何交互库产物要"嵌 README" 只能:

- (a) **静态 SVG/PNG 预览**(已由 `generate_diagram` 覆盖);
- (b) **raw HTML 链接外开 / GitHub Pages 托管**。

"单文件自包含"的真正价值是 (b) 路径的"一份 .html 文件 + 浏览器直开"体验,**不是 README 内运行**。本文所有"单文件可行性"判定都按此口径。

### 0.2 P0-5 §2 line 81 已列 xyflow/tldraw/Excalidraw/diagrams.net/kroki 为 NO-GO —— 那是针对"渲染档"

P0-5 §2 表格 line 81 "E. xyflow / tldraw / Excalidraw / diagrams.net / kroki ❌ NO-GO" 的结论基于"**静态 SVG 产物档**(渲染/主题切换)"上下文,正确不翻案。**本文在"高交互编辑档"做切片化的部分翻案**:

- **xyflow 在编辑档是合理候选**(仍被 Cytoscape 的 vanilla+zero-deps 优势压过,不是被"React 重 runtime"一票否决);
- **tldraw 仍因 license 红线排除**;
- **draw.io 仍因体积 + 远程 script 排除**;
- **Excalidraw 仍因坐标幻觉红线排除**。

读者按"**渲染档守 P0-5 §3.4 矩阵,编辑档参考本文 §4**"双层阅读。

### 0.3 media-gen-mcp 当前零 React 依赖

grep `node_modules/react` 无命中(P0-5 §3.2 D2Engine 范式为纯 TS class + worker + chain)。引入 React Flow = 把 React runtime 首次拉进项目,是**哲学层断裂**,非"再加个依赖"那么轻。

---

## 1. 交互谱系六档(体积 / JS 依赖 / README 兼容性三层证据)

| 档 | 代表 | JS? | 体积 | README 嵌入? | media-gen-mcp 当前位置 |
|---|---|---|---|---|---|
| **T1 static** | 静态 SVG/PNG | 无 | 小 | ✅(`<img>`) | `generate_diagram` 在此 |
| **T2 animated** | SVG + CSS `@keyframes` / SMIL | 无 | 小 | ⚠️(`<img>` 经 camo 透传时部分跑) | `animations.ts` 0.12.1 已交付 |
| **T3 viewer** | pan/zoom/theme/motion/export | inline vanilla ~150 行 ~30KB | ~30KB | ❌(剥 `<script>`) | **viewer-min.ts 当前核心** |
| **T4 light-interact** | hover/click 高亮/详情面板/键盘导航 | inline ~10-30KB | <64KB | ❌ | **未实现,契约内可加** |
| **T5 mid-interact** | 拖节点/contenteditable 标签/视觉改后导出 SVG | inline ~50-150KB | 64-256KB(贴 S6 上限) | ❌ | **未实现,拖节点边断裂是硬弱点** |
| **T6 full-editor** | 增删节点 + 自动重布局 + DSL 持久化 | React Flow/Cytoscape/draw.io/D2 WASM | 500KB-多 MB | ❌ | **不可达**(破 S6 80-125 倍) |

### 1.1 README 嵌入天花板 = T2 animated(且仅限 `<img src=*.svg>` 路径)

GitHub README 是 markdown,不能嵌整段 HTML 文档。内联 `<svg>` 在 README markdown 经 sanitize 剥 `<script>` / `<style>` 块 / SMIL / `on*` 事件 / inline style。**唯一可靠暗色切换路径** = 把独立 `.svg` 文件 commit 到 repo + README 用 `<img src="*.svg">`(SVG 经 camo 代理透传不 sanitize,内部 `<style>` + `@media prefers-color-scheme` 保留并被 img-browsing-context honor,D2 `darkThemeID` 字段就是为此设计)或 `<picture>` + `<source media>` + 双 PNG(GitHub 官方推荐)。**T3 viewer 及以上档全部不可达 README**。

### 1.2 本地打开单文件 HTML 天花板 = T5(有诚实弱点)/ T6 BLOCKED

vanilla JS 本地全跑,零网络。T3 当前已扎实,T4 ~10KB 契约内可加。**T5 拖节点技术可做但 D2 边 `path.connection` 的 `d` 属性是 auto-layout 算的固定坐标,拖节点后边端点不跟随**(视觉断裂)。解法:

- ① 仅拖框边留原处(看起来错);
- ② 重算边端点 ~50-200 行 JS + 简单正交路由(加 ~5KB,接受路由简化);
- ③ 嵌 `dagre.js` ~150KB 重布局(挤占 S6 上限,NO-GO);
- ④ 嵌 D2 WASM 21MB(NO-GO)。

标签编辑 `contenteditable` 持久化有损:SVG 不携带 DSL,改后只能导出 SVG 丢 DSL 源,或 JSON diff 回流 MCP 保 DSL 但需会话连续性。

### 1.3 T6 BLOCKED 三层硬叠加

- **D2 WASM 21MB**(`elk.js` 3.5MB + browser bundle 7.8MB = 总 ~32MB,破 S6 80-125 倍,已实测 `dist/node-esm/d2.wasm` = 22,072,784 字节);
- **React/tldraw 破单文件零依赖**;
- **浏览器沙箱禁 JS 写磁盘 / `localStorage` 不入 git**(破立场 ③)。

### 1.4 全编辑器必然是独立产物,不可挤进单文件 HTML

三层硬叠加:(a) 体积——React Flow 全栈 107KB gz 但 4 文件 + jsx-runtime shim 破单文件 / Cytoscape 137KB gz 单文件但贴上限 / JointJS Core 143KB gz 单文件但缺 Stencil/Inspector / draw.io viewer-static 3.8MB 超 cap 15 倍 / tldraw 商业 license + watermark NO-GO;(b) D2 WASM 是浏览器内"改 DSL → 重布局"的唯一路径,21MB 破契约 80-125 倍;(c) 持久化——浏览器沙箱禁文件写,`localStorage` 不入 git。**全编辑器属于另一个产品类**(Excalidraw/tldraw/draw.io 免费方案已存在)。media-gen-mcp 应明确文档化 T6 出局 + README FAQ 显式记拒因 + 推荐用户外部工具后 paste DSL 回流。

---

## 2. 节点图库 5 候选(实地核实硬数据)

### 2.1 React Flow / xyflow(`@xyflow/react` v12.11.2)

- **License**:MIT(verified `raw.githubusercontent.com/xyflow/xyflow/main/LICENSE` 首行 "MIT License",Copyright 2019-2025 webkid GmbH)。商业用明确允许,Pro 计划是**赞助/可选 SaaS**,非 license 要求。
- **peerDependencies**:`react >=17`, `react-dom >=17`(package.json L60-65)。runtime deps:`@xyflow/system` + `classcat ^5` + `zustand ^4`。
- **Bundle 实测**(`unpkg.com/@xyflow/react@12.11.2/dist/umd/index.js`):UMD raw **187,408 bytes** / gz **59,340 bytes**。
- **UMD factory 签名**(头 1 行实测):`t(exports,require("react/jsx-runtime"),require("react"),require("react-dom"))` —— **3 个外部依赖**,classcat/zustand 已 bundle 内置。
- **jsx-runtime 痛点**:浏览器 global 模式下 React Flow UMD 期望 `window.jsxRuntime`,但 `react.production.min.js` 只暴露 `window.React`。需手写 shim `window.jsxRuntime = React`(React 18 自动 runtime 经 `React.jsx` 暴露)或退回 v11 classic runtime(用 `React.createElement`)。
- **全栈总**:`react(11KB raw/4.3KB gz) + react-dom(132KB/43KB) + @xyflow/react(187KB/59KB) + style.css(18.6KB raw/3KB gz 必传)` = **330KB raw / ~107KB gz**(4 文件按序加载 + jsx-runtime shim)。
- **能力**:拖拽 ✅ 原生 / 连线 ✅ `onConnect` / 增删 ✅ 受控(`useNodesState`/`useEdgesState`)/ 标签编辑 ⚠️ 需自定义节点 / 导出 ⚠️ 第三方;插件 `<MiniMap/>` `<Controls/>` `<Background/>` `<Panel/>` `<NodeResizer/>` `<NodeToolbar/>` 全内置;主题 CSS 变量(`--xy-*`)。
- **适合架构图**:✅ 业界事实标准(n8n / Stripe Workflow Builder / Zapier / Typebot)。

### 2.2 Cytoscape.js(`cytoscape` v3.34.0)

- **License**:MIT(verified `raw.githubusercontent.com/cytoscape/cytoscape.js/master/LICENSE`,标准 MIT 全文)。学术级维护(University of Toronto + Oxford Bioinformatics 2016/2023 双 paper)。
- **包结构**:vanilla 单包,**zero runtime dependencies**(package.json 所有 deps 在 devDependencies)。`unpkg`/`jsdelivr` 字段均指向 `dist/cytoscape.min.js`。
- **Bundle 实测**(`unpkg.com/cytoscape@3.34.0/dist/cytoscape.min.js`):raw **435,328 bytes** / gz **136,821 bytes** —— **真·单文件零外部依赖**(UMD 头是 `(e="undefined"!=typeof globalThis?globalThis:e||self).cytoscape`,factory 仅一个 export 参数)。
- **能力**:拖拽 ✅ `grabbable` / 连线 ✅ `cy.add({group:'edges'})` / 增删 ✅ `cy.add()`/`cy.remove()` / 标签编辑 ⚠️ 自定义 / 导出 ✅ `cy.png()` 内置 + `cy.svg()` 扩展;布局内置 `breadthfirst`/`circle`/`concentric`/`cose`/`grid`/`preset`/`null`,扩展 `cytoscape-dagre`(MIT,与 D2 同 dagre);Canvas+WebGL 多层;70+ extensions。
- **同输入同输出**:`layout: {name:'preset', positions:...}` 直读坐标 = byte-deterministic;`cose` 需 `randomize:false` + `animate:false` + 固定 `seed`。
- **适合架构图**:✅ 强(配 `cytoscape-dagre` 接近 D2 风格),但默认审美偏网络图。

### 2.3 vis-network(`vis-network` 9.1.9 standalone)

- **License**:**`(Apache-2.0 OR MIT)` 双许可**(package.json L7 实测)—— 纯免费最宽松档。
- **包结构**:`peer`(318KB raw/96KB gz,需 6 个 peer deps)+ `standalone`(全打包,**689KB raw/163KB gz**,单文件零依赖)+ `esnext` 三套构建。
- **Bundle 实测**(`unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js`):raw **688,911 bytes** / gz **162,597 bytes** —— 四候选中**最重**。
- **能力**:拖拽 ✅ / 连线 ✅ **`manipulation` 模块开箱即用 add/edit/delete 节点+边 UI** / 增删 ✅ / 标签编辑 ✅ manipulation 内置 / 导出 `getCanvas()`;物理仿真(barnes-hut/directed)强;维护活跃度低于 Cytoscape(9.1.9 是 2023-11-03 发布,近 3 年无 minor)。
- **适合架构图**:⚠️ 物理布局导向(节点会"漂浮"),架构图需关 `physics:false` 改 `layout: {hierarchical: {enabled:true}}`。

### 2.4 JointJS(`@joint/core` v4.3.0)

- **License**:**MPL-2.0**(verified `raw.githubusercontent.com/clientIO/joint/master/LICENSE`)。**与 `@terrastruct/d2` 同档**:文件级 copyleft,链 npm 包不传染。media-gen-mcp 已采 D2(MPL-2.0),MPL 立场可接受。
- **包结构**:mono repo(`@joint/core` 核心 / `@joint/layout-directed-graph` dagre 包装 / `@joint/layout-msagl` MSAGL)。
- **Bundle 实测**(`unpkg.com/@joint/core@4.3.0/dist/joint.min.js`):raw **473,329 bytes** / gz **143,439 bytes** —— 单文件零依赖(UMD 头 `Vectorizor`/`g` 内部命名空间,无 require 外部)。
- **能力**:拖拽 ✅ `interactive:{linkMove:true,elementMove:true}` / 连线 ✅ link vertices/tools / 增删 ✅ `graph.add()`/`remove()` / 标签编辑 ⚠️ / 导出 ✅ `graph.toJSON()`/`fromJSON`;**专为图表设计**(BPMN/ER/arch/org chart/UML 形状库),Paper+Graph MVC 分层清晰。
- **License 陷阱**:`@joint/core` 是免费开源核心(standard Rectangle/Circle/Link),但 **Scroller(平移)/ Stencil(形状面板)/ Inspector(属性编辑)/ Halo(上下文菜单)/ 完整 BPMN/UML 形状库**全在商业 JointJS+(原 Rappid)。Core 能画架构图基础节点+连线,但缺 stencil 后"从面板拖节点进画布"的编辑体验需自研。

### 2.5 GoJS(排除项,记录排除理由)

- **License**:package.json `"license": "SEE LICENSE IN license.html"` —— **商业**。任务硬范围排除 ✅。

### 2.6 节点图库 5 候选能力 + 单文件可行性矩阵

| 库 | 拖拽 | 连线 | 增删 | 标签编辑 | 持久化/导出 | 框架 | bundle (raw/gz) | 单文件离线可行 | license | 适合架构图 |
|---|---|---|---|---|---|---|---|---|---|---|
| **React Flow** | ✅ 原生 | ✅ onConnect | ✅ 受控 hooks | ⚠️ 自定义 | toObject / 第三方 | React + zustand + d3 | **330KB / 107KB**(4 文件) | ⚠️ jsx-runtime shim + 4 文件 | **MIT** ✅ | ✅ 行业标准 |
| **Cytoscape.js** | ✅ grabbable | ✅ cy.add edges | ✅ cy.add/remove | ⚠️ 自定义 | cy.png() 内置 | **vanilla 零依赖** | **435KB / 137KB**(1 文件) | ✅ **真·drop-in 单文件** | **MIT** ✅ | ✅ 配 dagre ext 强 |
| **vis-network** | ✅ 内置 | ✅ **manipulation UI** | ✅ manipulation | ✅ manipulation 内置 | getCanvas | vanilla + 6 deps 打包 | **689KB / 163KB**(1 文件) | ✅ standalone 单文件 | **Apache-2.0 OR MIT** ✅ | ⚠️ 物理导向 |
| **JointJS Core** | ✅ interactive | ✅ link tools | ✅ graph.add/remove | ⚠️ 自定义 | graph.toJSON/fromJSON | vanilla + 内部 g/Vectorizor | **473KB / 143KB**(1 文件) | ✅ 单文件 | **MPL-2.0** ⚠️ | ✅ 专为图表设计 |
| **GoJS** | — | — | — | — | — | — | — | — | 🔴 **商业**(排除) | EXCLUDED |

**关键观察**:
- **gzipped 角度**:React Flow 全栈 107KB gz 反而**最轻**(Cytoscape 137KB / JointJS 143KB / vis-network 163KB),代价是 4 文件 + jsx-runtime shim。
- **drop-in 单文件角度**:Cytoscape / vis-network / JointJS 都是真单文件;React Flow 是"多文件拼装"。
- **vanilla 纯度**:Cytoscape 最纯(package.json 零 runtime deps);React Flow 唯一带框架 peer deps。
- **编辑 UX 开箱度**:vis-network manipulation 模块 > React Flow 受控 hooks > Cytoscape 事件 API > JointJS 工具 API。
- **架构图匹配度**:JointJS 专为图表设计 > React Flow ≈ Cytoscape > vis-network。

---

## 3. 画板编辑器品类(7 候选,整体 NO-GO)

### 3.1 tldraw 🔴 五证确认 NO-GO(license 红线)

`https://raw.githubusercontent.com/tldraw/tldraw/master/LICENSE.md` 全文:

- **§Conditions**:"Not to use the Software in **Production Environments**." + "Not to disable, change, or interfere with the Software's License Key enforcement."
- **§Technical enforcement**:"The Software includes technical measures to verify License Key validity, detect deployment environments, enforce usage restrictions based on license type, and **ensure proper watermark display**. The Software **may collect and transmit usage data to tldraw** for license compliance purposes."
- **§Production Environment 定义**:"any production deployment of the Software that operates on servers, cloud platforms, web applications, or where the software is used to provide functionality to end users, customers, or the public."(任何给最终用户的部署都算 production)
- `packages/tldraw/package.json`:`"license": "SEE LICENSE IN LICENSE.md"`
- npm `tldraw@5.2.5`:`license: "SEE LICENSE IN LICENSE.md"`,unpacked 13.69 MB
- `assets/watermarks/` 目录存在;架构图顶层有 `<Watermark>` 组件;`licenseKey` prop 描述为 "License key for commercial use (**removes watermark**)"
- 官方 License 矩阵:**Trial 无 watermark 仅 100 天 free,Commercial ~$6,000/yr**(startup 价)

### 3.2 draw.io / diagrams.net(Apache 2.0,但工程不可行)

- License:Apache 2.0 完整 9 节核实(`https://raw.githubusercontent.com/jgraph/drawio/master/LICENSE`)
- **`viewer-static.min.js` 实测 3.8 MB**(4,003,489 字节,`curl https://viewer.diagrams.net/js/viewer-static.min.js` 直拉)—— 远超 P0-5 §10.2 立的 256KB cap 15 倍
- 官方 embed HTML 文档 `https://www.drawio.com/doc/faq/embed-html` 原文:"The HTML markup requires a **remote script to be loaded** to render the diagram in the page" —— 非 self-contained,破 GitHub README 离线立场
- 商标条款:"draw.io is a registered EU trademark (#018062448). Use of draw.io trademarks requires prior written permission."
- 仓库结构含 60+ Sidebar 形状库 + DriveClient/DropboxClient/GitHubClient/GitLabClient/OneDriveClient/TrelloClient + P2PCollab + vsdx + mermaid —— 完整 webapp,非 library
- `app.min.js` 9.4MB,`stencils.min.js` 7.2MB

### 3.3 Excalidraw(MIT,但 React 重 runtime + 无 auto-layout)

- `@excalidraw/excalidraw@0.18.1`:**44.63 MB unpacked**(npm 实测),peerDeps `react ^17 || ^18 || ^19` + react-dom 同,30+ 依赖(roughjs/jotai/radix-ui/codemirror/perfect-freehand/pica 等)
- `@excalidraw/utils@0.1.3-test32`(无 React peerDeps 替代):**91.5 MB unpacked** 更大
- Element data 格式要求 **LLM 写死 x/y/width/height/seed**(来自 `packages/utils/README.md` 原文示例)—— 与 Archify IR 同款"LLM 写坐标负担过高"红线
- `seed` 字段需确定性审计(roughness 渲染依赖)
- 手绘风调性与"技术架构图/序列图"核心场景冲突

### 3.4 其他候选(均 NO-GO)

- **flowchart.fun** (MIT):React + cytoscape 商业 SaaS webapp,README 明文 "premium features 需 Vercel/Supabase/Stripe/Sendgrid 账号";30+ 依赖含 15 个 @radix-ui + @monaco-editor + @sendgrid/mail + @sentry + @notionhq/client
- **@xyflow/react** (MIT v12.11.2):见 §2.1
- **Penpot** (MPL-2.0):ClojureScript 全栈 Figma 替代品,设计与图表需求正交,过度工程

### 3.5 编辑器 vs 单文件 Viewer 根本差异(核心洞察)

| 维度 | 全功能编辑器 | media-gen-mcp 目标 |
|---|---|---|
| 状态 | 全状态(undo/collab/multi-page/cloud sync) | 无状态(从 DSL 重算) |
| 工具栏 | 拖拽 + 60+ 形状库 + 属性面板 | 仅 pan/zoom/theme/export |
| 后端 | 必须(Firebase/Drive/...) | 不需 |
| 输入 | 用户交互(鼠标/键盘) | DSL(LLM 程序化生成) |
| 体积 | 几 MB ~ 几十 MB | <256KB |
| 嵌入 | iframe + remote script 或 React component | 单 HTML inline |

**结论**:画板编辑器的 embed mode 是为"runtime 在用户浏览器持续运行的 SPA"设计;media-gen-mcp 要的是"LLM 在 build time 生成静态单 HTML,之后任何 viewer 离线打开看到一致结果" —— **正交需求不可混**。

---

## 4. text→diagram 工具(5 候选,零编辑或编程式 round-trip)

### 4.1 Mermaid(MIT)— Live Editor 是 text-only,无 round-trip

- **官方 OSS 明确拒绝 drag-and-drop**:Mermaid issue **#7713 "feat: add drag-and-drop functionality for flowchart nodes" = CLOSED**。Quick Start 文档明言:"Mermaid lets you create diagrams using plain text — no drawing tools, no drag-and-drop canvases, just code that renders into SVG"。
- **Live Editor**(mermaid.live,Svelte/Svelte Kit):text + 实时 preview 三面板。**没有图→text 回写**——你只能改 text,不能拖图。
- **Mermaid Chart**(mermaid.ai,商业)是另一回事:有 web visual editor + "Mermaid AI" embedded chat(NL→图生成),但这是商业产品。
- **结论**:Mermaid OSS 是纯单向 text→SVG。LLM 改图只能"改 text 整段重渲染",易丢上下文/引入回归。

### 4.2 D2(MPL-2.0,我们已用)— 开源做 AST 编辑底座,商业做视觉画布

- **d2oracle/edit.go 提供 5 个导出操作**:`Create / Set / Move / Delete / Rename`(package `d2oracle`,源 `oss.terrastruct.com/d2/d2oracle`)。关键 API 签名:
  ```go
  func Move(g *d2graph.Graph, boardPath []string, key, newKey string, includeDescendants bool) (_ *d2graph.Graph, err error)
  ```
  Move 处理 **cross-scope 移动 + edge references + 重命名冲突**——这就是"拖节点到新父容器后回写 DSL"所需的全部机制。
- **d2lsp 模块**:暴露 `GetRefRanges`(rename refactor)/ completion——VSCode 扩展靠它做 IDE 级 rename/create/delete。
- **D2 docs 原话**:"The d2oracle package provides a high-level API for programmatic D2 code manipulation, enabling advanced tooling features"——团队明示欢迎第三方基于 d2oracle 做编辑器。
- **D2 团队态度**:视觉拖拽 + 双向同步是 **Terrastruct 商业产品(D2 Studio)**,不开源。开源策略明确:**"可编程编辑底座"做 OSS,"视觉画布"做商业**——典型 open-core。
- **结论**:D2 是 OSS 唯一提供成熟 AST 编辑层的工具。"round-trip" 在 D2 生态的真实形态是 **编程式 round-trip**(程序调 d2oracle 改 DSL → recompile → re-render),**不是鼠标拖拽**。

### 4.3 PlantUML(GPL-3.0)— License 陷阱,纯 text→image

- **License 确认**:`curl raw.githubusercontent.com/plantuml/plantuml/master/LICENSE` 返回 `GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007`;`plantuml/plantuml-server` README badge 显式 `GNU GENERAL PUBLIC LICENSE, Version 3`。
- **License 陷阱**:GPL 强 copyleft——若 distribute PlantUML 二进制或改造版,需开源整链路。MCP 仅作"外部渲染服务调用"(Kroki 模式 spawn 子进程或调远程 HTTP)是常见 loophole,但**用户立场是 Apache 2.0/MIT 优先,media-gen-mcp 不内嵌 PlantUML 二进制**。
- **编辑能力**:PlantUML server 自我定位 "generate UML diagrams on-the-fly"——**text→image,无任何编辑、无 drag、无 round-trip**。
- **结论**:对 media-gen-mcp 是 NO-GO(license + 无编辑双红线)。

### 4.4 Structurizr(C4 模型)— DSL→图,text-only,Lite 即将 sunset

- **Structurizr Lite 顶部 README 警告**:"Structurizr Lite will not receive any further updates — please migrate to the new consolidated tooling."
- **能力面**:仅 "Visualise, document and explore"——明确**渲染 + 探索,无编辑**。改图路径 = 改 `workspace.dsl` 文本再 re-render。
- **结论**:Structurizr 不是 media-gen-mcp 的候选(被 sunset + 无编辑)。

### 4.5 Kroki(MIT)— 纯渲染聚合 API,零编辑

- **License 确认**:`curl raw.githubusercontent.com/yuzutech/kroki/master/LICENSE` 返回 **MIT License**。
- **架构**:`yuzutech/kroki` 顶层 server/ + 每引擎一个独立微服务目录(mermaid/、plantuml/、diagrams.net/、excalidraw/、vega/、wavedrom/、bpmn/、dbml/、nomnoml/、bytefield/、tikz/、blockdiag 等),每个微服务只有 `convert.js` / `index.js` + browser-instance(headless Chrome)。
- **能力**:server README.adoc 列出每个引擎的渲染端点——**纯 dispatcher,无 edit 端点,无 round-trip,无 drag**。
- **结论**:Kroki 是"text→diagram 引擎统一 API"的 MCP 友好渲染代理,**编辑能力 = 0**。可借鉴其 dispatcher 模式。

### 4.6 Round-trip editing 范式全景(OSS 几乎不存在真双向)

| 工具/产品 | 视觉拖拽 | DSL→图 | 图→DSL 回写 | 真 round-trip | License |
|---|---|---|---|---|---|
| Mermaid Live Editor | ❌ | ✅ | ❌ | ❌ | MIT |
| Mermaid Chart(商业) | ✅ partial | ✅ | partial | 半 | 商业 |
| D2 playground | ❌ | ✅ | ❌ | ❌ | MPL-2.0 |
| Terrastruct/D2 Studio(商业) | ✅ | ✅ | ✅(基于 d2oracle) | ✅ | 商业 |
| PlantUML server | ❌ | ✅ | ❌ | ❌ | GPL-3.0 |
| Structurizr Lite/Cloud | ❌(仅 explore) | ✅ | ❌ | ❌ | Apache-2.0 |
| Kroki | ❌ | ✅ | ❌ | ❌ | MIT |
| draw.io/diagrams.net | ✅(自有 mxgraph) | import only | ❌ | ❌(Mermaid/PlantUML import 单向) | Apache-2.0 |
| Eraser.io(商业) | ✅ | ✅(.dx DSL) | partial | 半 | 商业 |
| IcePanel(商业 C4) | ✅ | export only | ❌ | ❌ | 商业 |
| Excalidraw Architect MCP | ❌(NL only) | ✅(Sugiyama layout) | ✅(architecture.md 是 source) | ✅(NL 路径) | MIT |

**核心事实**:OSS 中**真正可用的视觉拖拽 ↔ DSL 自动回写 = 几乎为零**。draw.io 的 Mermaid/PlantUML import 是单向——用户报"After importing I can not edit the text anymore"(jgraph/drawio issue #1653)。

**OSS 真实 round-trip 路径 = AST 编辑 API + LSP**:
- 唯一成熟实现 = D2 d2oracle(Create/Set/Move/Delete/Rename)
- 配合 d2lsp(IDE rename refactor)
- 这条路径的 round-trip 不是"鼠标拖拽 → 看 DSL 变",而是"程序结构化操作 DSL → re-render"——**对 MCP/LLM 场景反而更合适**。

---

## 5. 单文件自包含可行性(按 media-gen-mcp 立场深度评估)

### 5.1 第一档(真·1 个 .js + inline glue,兼容现有 fillTemplate 范式)

- **Cytoscape.js**:`<script src="cytoscape.min.js"></script>`(137KB gz 一文件)+ ~50 行 glue。零外部依赖,1 文件 drop-in,与 P0-5 §3.6 markmap `fillTemplate()` 范式天然兼容。byte-deterministic:`layout:'preset'` + 用户给的坐标 = 同输入同输出。
- **vis-network standalone**:`<script src="vis-network.standalone.min.js"></script>`(163KB gz)。真·单文件,但最重。
- **JointJS Core**:`<script src="joint.min.js"></script>`(143KB gz)。真·单文件,MPL-2.0 与 D2 同档可接受;专为图表设计。

### 5.2 第二档(4+ 文件按序 + 手写 shim,破 fillTemplate)

- **React Flow**:`react.production.min.js` + `react-dom.production.min.js` + `window.jsxRuntime = window.React;` shim + `@xyflow/react/dist/umd/index.js` + `style.css` 必传(4 文件按序 + jsx-runtime shim)。**jsx-runtime shim 跨 React 17/18/19 稳定性未实测**。
- 引入 React = 首次把 React runtime 拉进 media-gen-mcp(项目当前零 React),哲学层断裂非"再加个依赖"。

### 5.3 第三档(不可行)

- **draw.io**:3.8MB + 远程 script 非 self-contained,破 GitHub README 离线。
- **Excalidraw**:44MB + React peerDeps。
- **tldraw**:license + watermark。
- **Penpot**:ClojureScript 全栈 Figma 替代品,形态正交。

media-gen-mcp 当前 `fill-template.ts` sentinel 填充工艺**只兼容第一档**。

---

## 6. 集成路径裁决(三条)

### 6.1 依赖路径(把 lib inline 进 HTML)= 不推荐

仅 Cytoscape / JointJS Core / vis-network 体积合规,但都**抛弃 D2 渲染层重画**(工程断裂,不推荐)。

### 6.2 输出格式路径(产物支持 .d2 源文件落盘 + base64 class 已嵌)= 推荐

已有/零新增依赖,handler L1026-1049 落盘 `.html` + `.png`,增量加 `.d2` 原样写 `req.code` ~10 行 + description 加 NEXT 句,符合 generate-then-edit 范式 C。

### 6.3 范式借鉴路径(借 Archify 工艺 + D2 base64 + d2oracle edit 协议 + Excalidraw Architect MCP 结构/位置分离)= 最推荐

零 license 风险,守全立场。**三条中范式借鉴 + 输出格式增强是 media-gen-mcp 立场下唯一不破红线的选择**。draw.io 的 `<div class="mxgraph" data-mxgraph="...JSON...">` 配置接口范式可借接口形态但不抄 3.8MB 实现。

---

## 7. Archify 工艺层四件套(必抄)+ 7 面板(永不抄)

### 7.1 Archify 是纯只读 viewer(零编辑/零增删/零节点拖拽)

grep `contenteditable|draggable=|dragstart|dragend|dragover|drop` 全文件 **0 命中**(唯一 `contenteditable` 出现在键盘 handler 注释里)。2 处 drag 全是视口导航(canvas pan 在 `.diagram-container` 且 `closest('[data-node-id]')` 早 return 排除节点;minimap 拖动调 `Archify.view.centerAt`)。`localStorage` 只存 2 个偏好(theme + motion)。`history.replaceState` 只写 URL hash(`#relation=` / `#focus=` / `#route=` / `#lens=`)做深链分享,**无任何几何/拓扑持久化**。

### 7.2 工艺层四件套必抄

- **工艺 A · state-on-container + match-on-element + 声明式 CSS**(template.html L3016-3034 + L3175-3178):svg 加 `data-X-active`,匹配节点加 `data-X-match`,CSS 用属性选择器把 `opacity`/`filter`/`pointer-events` 全干完。**JS 零 imperative 改样式**。这是 Archify 整套交互的 DNA,media-gen-mcp reimplement 必抄的范式(不抄代码)。
- **工艺 B · data-detail 三级 LOD + hover/focus 显隐**(L2998-3011 + L3030-3031):节点内嵌 `<g data-detail="context|fine">` 子元素;hover/`:focus-visible` 触发 `opacity:1`;容器 `data-detail-level=map|read|full` 全局控级;`detailLevel()` 按缩放自动切档。hover 信息不用 JS 取,直接渲染时埋进 SVG。
- **工艺 C · data-just-panned 80ms 抑制 click-after-drag**(L8694-8697 + L6271):pointerup 若 moved 设 `data-just-panned=true` 80ms 后清;click 处理器首行检查此 flag 跳过。极便宜地解了拖拽误触发的老大难。
- **工艺 D · 导出前从 clone 剥离所有交互态属性**(L4389-4400):clone 后 `[data-focus-match]`/`[data-lens-match]`/`[data-story-step]`/`[data-relationship-hit-overlay]` 全 `removeAttribute` 或 `remove`。**几何永不可变**。

辅助工艺:`transform` 做 pan/zoom(不 mutate viewBox,L8704-8715)/ coarse-pointer fallback(`@media (hover: none),(pointer: coarse){ .relationship-hit-rail{stroke-width:24} }`,L3227)/ URL hash 深链 + clipboard(L5888/L6223/L6255)/ 主题 = CSS 变量 + `html[data-theme]` + localStorage + 系统偏好(L15-25 + L4200-4206)/ roving tabindex + `aria-pressed`/`aria-expanded`/`aria-current`/`aria-live`(L5918/L6905/L6921)/ 纯 vanilla IIFE 模块命名空间(全文件 `Archify.view/radar/finder/...` 各为 `(function(){...}())`)。

### 7.3 7 面板永不抄(doc_v11 P0-5 L326-332 红线已立)

| 面板 | 一句话交互 | 为何不抄 |
|---|---|---|
| **Story Trail** | guided chapter 的有序 focus stops 用虚线 overlay 串起 | 我们有 `render_video` / `create_video` 做动画,不该在 viewer 另起时间轴 |
| **Route Probe** | 选两个节点 BFS 跑最短有向路径 | 需要图运行时,产物是生成而非查询工具 |
| **Semantic Lens** | 节点按 `data-node-kind` 编译成带计数 legend | 需要节点 kind 元数据 + 两两对比交互 |
| **Overview Radar** | runtime 构建的 mini-SVG minimap | 只有图 >30 节点才有价值 |
| **Node Finder** | stable-ID 搜索 | 小图直接看即可 |
| **Presentation Stage** | `html[data-present="true"]` 让 live 图占满 viewport | 我们有 PNG 预览 + 主题切换足够 |
| **Diagram Guide** | 命令面板/快捷键 cheatsheet | 只有交互档已有 8+ 功能才值得做 |

**核心立场**:Archify 是 viewer 产品(11k 行 JS),media-gen-mcp 是生成器产物(目标 P0-5 Tier 1 MVP 7-10 人日)。**reimplement 范式(state-attr + 声明式 CSS + 分层剥离),不抄范围(7 面板)**。

---

## 8. 已存在 MCP 案例借鉴(直接范式)

### 8.1 `excalidraw-architect-mcp`(BV-Venky,MIT,135★,PyPI/Cursor Directory)

README 直言问题与解法(原文引述):
> "Mermaid diagrams are quick to generate but have limited capabilities - **you can't drag a node to reposition it**, group components visually. Excalidraw solves these problems, but when LLMs try to generate Excalidraw directly, **they hallucinate coordinates** - boxes overlap, arrows tangle"
>
> "**separates the what from the where** - the AI focuses on structure, the engine handles the pixel math"
>
> "you can **iteratively edit diagrams with natural language** ('add a cache in front of the DB')"
>
> "**Living architecture knowledge graph** - persist your system as a version-controlled model your AI can query, lint, and re-render — **diagrams become views, not the source of truth**"

**范式提炼**:① 结构/位置分离(LLM 产结构,Sugiyama layout 算位置);② **diagram 是 view,`architecture.md` 知识图谱是 source of truth**——edit 改的是 source,然后 re-render;③ NL edit 直接累积到 markdown 文件;④ 50+ 技术词(Kafka/PostgreSQL/Redis)自动 styling;⑤ MIT license + 完全 offline。

### 8.2 `buck-0x/eraser-io-mcp-server`(21★,Python)

调 Eraser API 渲染,**返回 `create_eraser_file_url`**:Returns link to edit diagram in Eraser。范式:**MCP 做 text→image,视觉编辑 handoff 给商业 SaaS**——非真 round-trip,但用户体验"生成→点链接→在 Eraser 网页里改"是连贯的。对 media-gen-mcp 是 NO-GO(纯免费立场)。

### 8.3 Mermaid Chart GPT / Eraser DiagramGPT(商业 SaaS)

NL→图生成侧强;迭代 edit 靠他们自己的 web editor。对 media-gen-mcp 不适用(商业、需账号)。

---

## 9. 集成路径最终裁决

### 9.1 当前 P0-5 MVP(主题切换 + pan/zoom 只读 viewer)—— 不变

继续走 P0-5 §2 已裁决的 **A 路线(D2 WASM + markmap 范式 fillTemplate + ~200 行 vanilla viewer)**。理由:只用 pan/zoom/theme toggle 的 viewer 自研 ~200 行 vs 引 137KB 库,过度工程。

### 9.2 契约内升级(T4 light-interact)—— 自研最优 + Archify 工艺层

- hover tooltip(D2 SVG 自带 `<title>` 原生 tooltip,~2KB)/ click 选中(`g.shape` 加 class + CSS 兄弟 dim,~1KB)/ 详情侧栏(~3KB)/ 键盘 Tab 导航(~1KB)。
- 借 Archify 工艺四件套(state-on-container + match-on-element + 声明式 CSS、`data-detail` 三级 LOD、`data-just-panned`、导出剥离态)。

### 9.3 编辑档(T5/T6)若未来真要做 · 首选 Cytoscape.js(条件:独立产物,不破单文件 HTML)

裁决依据排序:
1. **vanilla 零依赖**(package.json 实测)→ 不破项目零 React 哲学,与 D2Engine 范式同源;
2. **MIT + 真·单文件 137KB gz** → 满足"纯免费 + 单文件自包含",drop-in `<script src=cytoscape.min.js>`;
3. **byte-deterministic 路径清晰** → `layout:'preset'` 直读坐标或 `cytoscape-dagre`(MIT,与 D2 同 dagre);
4. **cy.png() 内置光栅化零依赖**;
5. **学术维护稳定**(Oxford Bioinformatics 2016/2023 双 paper)。

**关键 caveat**:Cytoscape 引入意味着抛弃 D2 渲染层重画全部节点/边,产物形态从"单文件 HTML viewer"变"独立编辑器 app"——**这是另一个产品,不是 generate_interactive_diagram 的工具档**。建议:若用户确认编辑需求,开 P1 独立立项 + 30 天需求观察期(同 P0-5 §11.1 范式),不破 P0-5 已落地 MVP scope。

### 9.4 React Flow 双层阅读规则 · 留作"未来上 React 系编辑器"反转备选

被 Cytoscape 压过的理由不是"React 重 runtime"一票否决,而是 vanilla+zero-deps 优势 + 4 文件拼装破单文件立场 + jsx-runtime shim 摩擦。**适用反转条件**:若 media-gen-mcp 未来新增 React 系管理后台/web 编辑器,同一 React runtime 复用边际成本骤降,React Flow 立即转首选。备选:退回 `reactflow` v11 classic runtime UMD 绕过 jsx-runtime(v11 用 `React.createElement`),但 v11 进维护模式。

### 9.5 D2 d2oracle 是 OSS 唯一成熟 AST edit 层 · 编程式 round-trip

`d2oracle/edit.go` 导出 Create/Set/Move/Delete/Rename 5 函数。`d2lsp` 暴露 GetRefRanges(IDE rename refactor)。D2 docs 原话"enables advanced tooling features"——团队默许第三方做编辑器。**这是 NL→结构化 edit op→DSL→recompile→re-render 路径的引擎,比让 LLM 重写整段 DSL 更可控/可测/错误可定位**。d2.wasm 可在 Node 直接调用(已存于 `d2/js/d2.wasm`)无需 Go→Node bridge。但 21MB 不能嵌单文件 HTML,**只在 MCP 服务端调用**。包装为 MCP 工具 `edit_diagram(dsl, ops[])` 是干净路径。

---

## 10. 立场红线最终点名

- **不嵌任何 canvas 编辑器 lib 进单文件 HTML**:体积贴 cap + 抛弃 D2 渲染层断裂。
- **不做视觉拖拽节点(B2 路线)**:与 D2 auto-layout 物理冲突,持久化无解。
- **不引入 tldraw/PlantUML/GoJS**:license 红线五证/双证/商业。
- **不做 full-editor 档**:是另一个产品,推荐用户外部 Excalidraw/draw.io 后 paste DSL 回流。
- **不抄 Archify 7 面板**:viewer 产品级工程。
- **inputSchema 零 diff**(守立场 ④ 向后兼容)。
