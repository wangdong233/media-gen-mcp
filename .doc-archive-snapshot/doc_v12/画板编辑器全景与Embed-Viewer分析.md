# 画板编辑器全景 + Embed/Viewer 模式分析 + 集成可行性

**调查者**:画板/全功能编辑器调查者(draw.io / Excalidraw / tldraw / flowchart.fun / Penpot / xyflow)
**日期**:2026-07-22
**硬范围**:仅写入 `/Users/wangdong/Documents/Project/Agnes AI接入/doc_v12/`;只读 `media-gen-mcp` 与 `doc_v11/`。
**立场红线**:纯免费(MIT/Apache 优先)、单文件自包含、可嵌 GitHub README、同输入同输出、向后兼容。

---

## 0. TL;DR(三句话结论)

1. **画板编辑器品类整体 NO-GO**:7 个候选无一可作 media-gen-mcp 的依赖或 viewer 输出格式,理由各异(license 红线 / React 重 runtime / webapp 过度工程 / 体积爆炸 / 无 auto-layout)。
2. **tldraw 五证确认 NO-GO**:`LICENSE.md` 明文禁止 production use + 强制 watermark + 遥测 + License Key enforcement;免费 100 天 trial 后商用 ~$6000/yr。
3. **既有 P0-5 路线不变**:`D2 WASM + markmap 范式 reimplement + 极简 viewer` 仍是唯一路径;本调研为其提供独立证据闭环 + 画板品类完整排除论证。

---

## 1. NO-GO 红线清单(先看这个)

| 候选 | License | 红线 | 证据 |
|---|---|---|---|
| **tldraw** | **🔴 专有**(tldraw License) | 禁 production use + 强制 watermark + 遥测 + License Key 技术强制 | `LICENSE.md` §Conditions / §Technical enforcement;`packages/tldraw/package.json` `license: "SEE LICENSE IN LICENSE.md"`;`assets/watermarks/` 目录存在;架构图含 `<Watermark>` 顶层组件;watermark 显式说明 "removes watermark" 是 `licenseKey` 的用途 |
| **@excalidraw/excalidraw** | MIT | React 17/18/19 peerDeps + **44.63 MB** unpacked + 30+ 依赖 | `packages/excalidraw/package.json` peerDependencies;`npm view` unpackedSize=46,802,783 字节 |
| **@excalidraw/utils**(无 React 替代) | MIT | **91.5 MB** unpacked + 无 auto-layout(LLM 必须写坐标,同 Archify IR 红线) | npm view unpackedSize=91.5 MB;`exportToSvg(elementData)` 入参需 x/y/width/height/seed |
| **draw.io `viewer-static.min.js` 内联** | Apache-2.0 | **3.8 MB**(4,003,489 字节)远超 256KB cap | `curl https://viewer.diagrams.net/js/viewer-static.min.js` 实测 |
| **draw.io embed 远程 script 模式** | Apache-2.0 | 官方明文 "requires a remote script to be loaded" —— 非 self-contained,破 GitHub README 离线立场 | drawio.com/doc/faq/embed-html 原文 |
| **flowchart.fun** | MIT | React + cytoscape.js 商业 SaaS webapp(premium features 需 Vercel/Supabase/Stripe/Sendgrid) | `app/package.json` deps 列表 + README "premium features" 段 |
| **@xyflow/react** | MIT | React ≥17 peerDep + zustand 重 runtime;无 auto-layout/DSL | npm view peerDependencies |
| **Penpot** | MPL-2.0 | ClojureScript 全栈 Figma 替代品,过度工程(设计工具非图表工具) | README + 设计目标对比 |

**裁决**:画板编辑器品类全部 NO-GO。唯一安全集成路径是「范式借鉴」(见 §6)。

---

## 2. License 终态矩阵(全表,实地核实)

| 依赖 | license | 实地核实来源 | 商用安全 | media-gen-mcp 是否引入 |
|---|---|---|---|---|
| **tldraw** | 🔴 **专有**(tldraw License) | GitHub `LICENSE.md` 全文 + `packages/tldraw/package.json` 字段 `"license": "SEE LICENSE IN LICENSE.md"` + npm registry 同 | ❌ 绝不可碰 | **NO-GO** |
| **@excalidraw/excalidraw** | MIT | GitHub `LICENSE` + `packages/excalidraw/package.json` + npm registry 三证 | ✅ | NO-GO(React + 44MB) |
| **@excalidraw/utils** | MIT | npm registry 同 | ✅ | NO-GO(91MB + 无 auto-layout) |
| **draw.io / diagrams.net (jgraph/drawio)** | **Apache-2.0** | GitHub `LICENSE` 全文(Apache 2.0 完整 9 节) | ✅ | NO-GO(viewer 3.8MB;editor 是 webapp) |
| **flowchart.fun (tone-row/flowchart-fun)** | MIT | GitHub `LICENSE` (Copyright 2021 Robert Gordon) + `app/package.json` `license: MIT` | ✅ | NO-GO(SaaS webapp) |
| **@xyflow/react** | MIT | GitHub `LICENSE` (Copyright 2019-2025 webkid GmbH) + npm registry | ✅ | NO-GO(React runtime) |
| **Penpot** | MPL-2.0 | GitHub `LICENSE` (Mozilla Public License 2.0) | ✅(文件级 copyleft) | NO-GO(Figma 替代品,正交需求) |
| **roughjs**(Excalidraw 的渲染内核) | MIT | npm registry | ✅ | 不需要(D2 已在用;roughjs 是手绘风,与"技术架构图"调性冲突) |
| **cytoscape**(flowchart.fun 的图库) | MIT | npm registry | ✅ | 不需要(D2 已有 auto-layout,更专业) |

**深度合规注记**:
- **draw.io 商标条款**:`README.md` 明文 "draw.io is a registered EU trademark (#018062448). Use of draw.io trademarks requires prior written permission." 即使 Apache 2.0 代码可用,名称/Logo 不可随意使用 —— 集成时若需提及"powered by draw.io"要小心。
- **draw.io 贡献条款**:"We do not accept pull requests. The project is developed entirely by the core team." —— 影响 fork 自定义可行性,但不影响 npm/CDN 消费。
- **draw.io 图标/stencil 库特殊条款**:icon sets 与 stencil libraries **禁止用于 Atlassian 产品/市场**(除非获书面许可);普通 end-user 输出图不受限。若 media-gen-mcp 未来分发二进制含 stencils,需注意此条款。
- **tldraw 的" trial 100 天"陷阱**:zread 索引的官方文档明确给出 `Trial | No watermark | 100 days | Free` + `Commercial | No watermark | Annual | ~$6,000/yr (startup)`。**100 天 trial 不是永久免费**,到期即触发 License Key enforcement + watermark 回归。

---

## 3. 编辑器 vs 单文件 Viewer 根本差异(本品类最核心洞察)

| 维度 | 全功能编辑器(draw.io / Excalidraw / tldraw) | 单文件交互 Viewer(media-gen-mcp 既定目标) |
|---|---|---|
| **核心抽象** | 状态机 + 工具栏 + 多页 + 历史 + 协作 | 纯渲染几何 + 极简交互层 |
| **状态** | 全状态(undo/redo/history/collab/localStorage/IndexedDB/cloud sync) | 无状态(每次渲染从 DSL 重算) |
| **工具栏** | 拖拽 + 形状库 + 属性面板 + 右键菜单 + 快捷键 + 模板 | 仅 pan/zoom/theme toggle/export |
| **后端** | 必须(collab/Firebase/Drive/Dropbox/GitHub/OneDrive/Trello) | 不需 |
| **输入** | 用户交互(鼠标拖/键盘/触屏/手写笔) | DSL(LLM 程序化生成) |
| **输出体积** | 几 MB 到几十 MB(44MB Excalidraw / 13.7MB tldraw / 9.4MB drawio app.min) | <256KB(P0-5 立场红线) |
| **嵌入模式** | iframe + remote script(draw.io)或 React component(Excalidraw/tldraw) | 单 HTML inline CSS/JS |
| **License** | 各异(含专有 tldraw) | 全 MIT/Apache/MPL |
| **同输入同输出** | 难(用户交互天然随机;协作更甚) | 必须(立场红线) |

### 3.1 能把编辑器"只读 embed 模式"当 viewer 用吗?

**结论**:理论可以,工程上 NO-GO。

| 方案 | 实测结果 | 否决理由 |
|---|---|---|
| draw.io `viewer-static.min.js` 内联到单 HTML | 3.8MB 单文件 | 超 P0-5 §10.2 立的 256KB 硬上限 15 倍;GitHub README 嵌入体验差;违反"单文件自包含 + 轻量"双立场 |
| draw.io `<div class="mxgraph" data-mxgraph="...">` + 远程 `<script src="viewer.diagrams.net/js/viewer-static.min.js">` | 官方推荐路径 | **官方原文**:"The HTML markup requires a remote script to be loaded to render the diagram" —— 非 self-contained;离线/内网/GitHub raw HTML 全失败 |
| Excalidraw `<Excalidraw readonly>` React component | 需 React 17/18/19 + react-dom + 44MB 包 | 重 runtime;React 不是 media-gen-mcp 当前依赖栈(纯 Node ESM + WASM) |
| tldraw `<Tldraw readOnly>` | 同上 + license 红线 | 专有 license 一票否决 |

**根本矛盾**:全功能编辑器的「embed mode」是为「我的网站嵌入一个可查看/可轻微编辑的画板」设计,前提是 **runtime 在用户浏览器持续运行**。media-gen-mcp 的目标是「LLM 在 build time 生成一个静态单 HTML,之后任何 viewer 离线打开都看到一致结果」。前者是 SPA,后者是静态产物 —— **正交需求**。

### 3.2 media-gen-mcp 想要哪个?

基于 `doc_v11/P0-5-交互式HTML图实施规划.md` §1 + §3.1 既定路线:
- **目标产物**:单文件自包含 HTML(DSL → SVG + 极简 viewer JS/CSS inline)
- **核心场景**:GitHub README 嵌入、可主题切换、可 pan/zoom、可点击探索
- **后端**:D2 WASM(已在进程内,零新增依赖)
- **HTML 包装**:markmap `template + fillTemplate` 范式 reimplement(80 行 TS)
- **viewer 交互层**:vanilla JS,~200 行(pan/zoom + theme toggle + export PNG/SVG)

→ **明确是单文件交互 viewer,不是全功能编辑器**。画板编辑器品类整体与之正交,NO-GO。

---

## 4. 各方案深度分析

### 4.1 draw.io / diagrams.net(Apache 2.0)

**能力清单(实地核实)**:
- ✅ 拖拽 / 连线 / 增删 / 编辑 / 模板 / 多页 / 图层 / 标签 / 工具栏 / 属性面板 / 快捷键
- ✅ 60+ 内置形状库:`src/main/webapp/js/diagramly/sidebar/` 实测含 AWS/Azure/Cisco/Kubernetes/UML/BPMN/C4/ArchiMate/ER/Flowchart/Network/Floorplan/PID/SysML/ThreatModeling/Veeam 等共 60 个 `Sidebar-*.js` 文件
- ✅ 多云同步客户端:DriveClient/DropboxClient/GitHubClient/GitLabClient/OneDriveClient/TrelloClient
- ✅ P2P 协作:`P2PCollab.js` + `simplepeer9.10.0.min.js`
- ✅ Visio 互操作:`vsdx/` 导入导出
- ✅ Mermaid 支持:`mermaid/mermaid.min.js`
- ✅ OrgChart、Freehand、Ruler、DistanceGuides
- ✅ 嵌入模式:`embed=1` URL 参数 + `postMessage`(JSON proto);`Embed.js` + `GraphViewer.js`
- ✅ 导出格式:SVG / PNG / PDF / JPEG / HTML / VSDX / XML

**embed / viewer 模式(实地核实)**:
- 编辑器 embed:`https://embed.diagrams.net/?embed=1` + iframe + postMessage(支持 proto=json)
- 只读 viewer:`https://viewer.diagrams.net/` + 远程 `<script src="js/viewer-static.min.js">` + `<div class="mxgraph" data-mxgraph="{xml/url, toolbar, layers, zoom, ...}">`
- 内联选项:`File > Embed > HTML` 生成 embed 代码,**默认包含 XML 副本** + **远程 script 引用**

**单文件自包含可行性**:
- ❌ 内联 `viewer-static.min.js` = **3,8 MB**(实测 `curl` 4,003,489 字节)
- ❌ `app.min.js` = 9.4 MB(完整编辑器)
- ❌ `stencils.min.js` = 7.2 MB(形状库)
- ❌ 官方 embed HTML 文档原文:"requires a remote script to be loaded" —— 非自包含
- ⚠️ 如果接受远程 script,embed 工作良好 —— 但破 GitHub README 离线立场

**MCP 集成路径分析**:
| 路径 | 可行性 | 裁决 |
|---|---|---|
| 作为依赖(npm import) | ❌ draw.io 是 webapp 非 library;无 npm package 暴露渲染 API | NO-GO |
| 作为后端(headless 渲染) | ⚠️ 可用 puppeteer + 远程 `viewer.diagrams.net`,但破"零新增依赖 + 同输入同输出" | NO-GO |
| 作为输出格式(生成 .drawio XML) | ⚠️ XML 格式可程序化生成,但 LLM 写 mxGraph XML 负担高(远高于 D2 DSL);且 viewer 体积问题不变 | NO-GO |
| 仅范式借鉴 `mxgraph` div + `data-mxgraph` JSON 配置 | ✅ 可作为 viewer 配置接口设计参考(不抄代码) | 借鉴 |

### 4.2 Excalidraw(MIT)

**双包结构(实地核实)**:

#### 4.2.1 `@excalidraw/excalidraw`(主包,React 组件)
- **npm**:v0.18.1,**44.63 MB unpacked**
- **peerDependencies**:`react: ^17.0.2 || ^18.2.0 || ^19.0.0`,`react-dom: 同`
- **dependencies**(30+):roughjs(手绘渲染)、jotai+jotai-scope(状态)、browser-fs-access、@radix-ui(UI)、@codemirror(mermaid 代码编辑器)、perfect-freehand、pica、image-blob-reduce、png-chunks-*(PNG 元数据)、pwacompat、tunnel-rat 等
- **description 原文**:"Excalidraw as a React component"
- **官方示例** `examples/with-script-in-browser/index.html`:`<script type="module">import * as ExcalidrawLib from "@excalidraw/excalidraw"</script>` + `window.EXCALIDRAW_ASSET_PATH` —— 即使"script-in-browser"也要 React + react-dom + 资产路径
- **AI 集成**:`excalidraw-app/components/AI.tsx` 存在(有 AI 能力但封闭)

#### 4.2.2 `@excalidraw/utils`(I/O 包,无 React peerDeps)
- **npm**:v0.1.3-test32,**91.5 MB unpacked**(更大!因含完整 roughjs + 字体 + wasm 子集)
- **peerDependencies**:无
- **dependencies**(9):pako、roughjs、open-color、perfect-freehand、browser-fs-access、png-chunk-*、@braintree/sanitize-url、@excalidraw/laser-pointer
- **API**:`serializeAsJSON(elements, appState)`、`exportToBlob(opts)` (async)、`exportToSvg(elementData)` 返回 `SVGElement`
- **UMD 可用**:`<script src="https://unpkg.com/@excalidraw/utils/dist/excalidraw-utils.min.js">` + `window.ExcalidrawUtils`

**Element data 格式(实地核实,来自 packages/utils/README.md 原文)**:
```js
{
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "vWrqOAfkind2qcm7LDAGZ",
      type: "ellipse",
      x: 414, y: 237, width: 214, height: 214,  // ← LLM 必须写坐标
      angle: 0,
      strokeColor: "#000000",
      backgroundColor: "#15aabf",
      fillStyle: "hachure",
      strokeWidth: 1, strokeStyle: "solid",
      roughness: 1,  // ← 手绘粗糙度
      opacity: 100,
      groupIds: [], roundness: null,
      seed: 1041657908,  // ← roughness 随机种子(确定性审计点!)
      version: 120, versionNonce: 1188004276,
      isDeleted: false,
      boundElementIds: null,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
}
```

**关键缺陷(与 media-gen-mcp 立场冲突)**:
1. **无 auto-layout**:每个 element 的 `x/y/width/height` 必须由调用方写死 —— 与 Archify IR 同款"LLM 写坐标负担过高"红线(`doc_v11/P0-5-Archify源码与同品类深度调研.md` §3.3 已定)。Excalidraw 的 auto-layout 是**用户用鼠标拖**完成的,不是 API 算出来的。
2. **`seed` 字段需确定性审计**:roughness 渲染依赖 seed;不同 seed 出不同笔画 —— 与"同输入同输出"立场潜在冲突(若调用方传不同 seed,即使其他字段相同,SVG 也不同)。需硬编码固定 seed 才安全(借鉴 P0-5 §0 C3 处理 D2 salt 的范式)。
3. **91.5 MB unpacked** = 远超 P0-5 §10.2 立的 256KB HTML 上限 ~360 倍;即使 minified single-file 也要几 MB。
4. **手绘风调性**与"技术架构图/序列图/ER 图"需求冲突:Excalidraw 的 USP 是"像草稿",而 media-gen-mcp 的核心场景是 GitHub README 里的架构图(需专业清晰)。

**单文件自包含可行性**:
- ❌ 内联完整 utils = 91MB → 不可行
- ❌ UMD 单文件 script 也要 几 MB(roughjs + 字体 + wasm)
- ⚠️ 远程 unpkg CDN 可用,但破 self-contained 立场

**MCP 集成路径分析**:
| 路径 | 可行性 | 裁决 |
|---|---|---|
| `@excalidraw/excalidraw` 作为依赖 | ❌ React runtime + 44MB | NO-GO |
| `@excalidraw/utils` 作为依赖(server-side SVG 导出) | ⚠️ 技术可行 | NO-GO(91MB + 无 auto-layout + 手绘调性 + seed 确定性) |
| 作为输出格式(生成 `.excalidraw` JSON) | ⚠️ LLM 可生成 element JSON | NO-GO(LLM 写坐标 + seed 确定性 + 无 layout) |
| 仅范式借鉴 exportToSvg(elementData) 接口 | ✅ 作为"LLM 写坐标路径反例"参考(警示用) | 借鉴(反向警示) |

### 4.3 tldraw(🔴 专有 — 五证确认 NO-GO)

**License 实地核实(五证)**:
1. **GitHub `LICENSE.md` 全文**(`curl https://raw.githubusercontent.com/tldraw/tldraw/master/LICENSE.md`):
   - **§Conditions 原文**:"Not to use the Software in **Production Environments**."
   - "Not to disable, change, or interfere with the Software's License Key enforcement."
   - "Not to remove any copyright or other notices from the Software."
   - **§Technical enforcement 原文**:"The Software includes technical measures to verify License Key validity, detect deployment environments, enforce usage restrictions based on license type, and **ensure proper watermark display**. The Software **may collect and transmit usage data to tldraw for license compliance purposes**."
   - **§Production Environment 定义**:"any production deployment of the Software that operates on servers, cloud platforms, web applications, or where the software is used to provide functionality to end users, customers, or the public." —— 任何给最终用户的部署都算 production
2. **`packages/tldraw/package.json`**:`"license": "SEE LICENSE IN LICENSE.md"`
3. **npm registry tldraw@5.2.5**:`license: "SEE LICENSE IN LICENSE.md"`,unpackedSize 13.69 MB
4. **`assets/watermarks/` 目录存在**(zread 仓库结构显示)
5. **架构层 Watermark 组件**:zread 索引的官方架构图明确列出 `└── Watermark`(顶层组件之一);`licenseKey` prop 描述为 "License key for commercial use (**removes watermark**)"

**License Type 矩阵(来自 zread 索引的官方文档)**:
| License Type | Watermark | Duration | Cost |
|---|---|---|---|
| Trial(默认,无 key) | **No**(100 天宽限) | **100 days** | Free |
| Commercial | No | Annual | **~$6,000/yr**(startup 价) |
| (无 key 100 天后) | **强制显示** | 永久 | $0 但破产品 |

**关键陷阱**:
- 100 天 trial 是**临时宽限**,**非永久免费**;到期后自动回归 watermark
- "License required" watermark 在 production 显示(zread 索引的 Troubleshooting 原文:"Missing license key on a deployed app → Pass licenseKey prop or set TLDRAW_LICENSE_KEY env var")
- 即使**仅作 build-time 工具**(从不部署 tldraw runtime),输出 HTML 含 tldraw 代码 = 分发 tldraw → 触发 license;watermark 要求仍生效

**替代品寻找结果**:
- **无 truly-free tldraw fork**:社区无 clean-room 重实现
- tldraw 自身的 `create-tldraw` 脚手架也是同款 license
- **结论**:**永远 NO-GO**,无论 build-time 还是 runtime

**review checklist 加一条**(沿用 P0-5 §10.1 既有规定):
```bash
grep -r tldraw node_modules/  # 必须无命中
grep -r "@tldraw" package.json package-lock.json  # 必须无命中
```

### 4.4 flowchart.fun(MIT 但商业 SaaS webapp)

**实地核实**:
- **License**:MIT(`LICENSE` Copyright 2021 Robert Gordon + `app/package.json` `license: MIT`)
- **栈**:React + cytoscape.js(README 原文)
- **deps 列表**(节选,共 30+):`@radix-ui/react-{alert-dialog, checkbox, collapsible, dialog, dropdown-menu, hover-card, navigation-menu, popover, progress, radio-group, select, slider, tabs, toast, toggle, tooltip}`(15 个 radix 包)、`@monaco-editor/react`(代码编辑器)、`@sendgrid/mail`(邮件)、`@sentry/{react, tracing}`(监控)、`@notionhq/client`(Notion 集成)、`@formkit/auto-animate`、`@lingui/{core, react}`(i18n)
- **README 原文**:"If you plan on developing the **premium features**, you will need accounts on Vercel, Supabase, Stripe and Sendgrid." —— 明确是商业 SaaS webapp
- **zread 索引失败**(`target not found`)—— 该仓库未被 zread 收录

**能力**:
- 文本 → 流程图(text-based DSL,通过 cytoscape auto-layout)
- 例:`Node A\n  goes to: Node B\n  and: Node C`

**评估**:
- 单一功能(只流程图,不支持序列图/ER/架构图)
- 商业 webapp 形态,非 library
- React 重 runtime + 30+ deps
- 即使借鉴"text → auto-layout graph"范式,**D2 DSL 已经覆盖且更专业**(D2 支持序列/ER/类图/C4/架构图等远超流程图)
- **NO-GO**

### 4.5 @xyflow/react(MIT 但 React runtime)

**实地核实**:
- **License**:MIT(GitHub `LICENSE` Copyright 2019-2025 webkid GmbH)
- **npm v12.11.2**:unpacked 1.15 MB(包体本身不算大)
- **peerDependencies**:`react: >=17`,`react-dom: >=17`,`@types/react: >=17`,`@types/react-dom: >=17`
- **deps**:classcat、zustand、@xyflow/system
- 前身 React Flow,2024 改名 xyflow,加 Svelte/Vue 支持但 React 仍是主推

**能力**:
- 节点/边画布,自定义节点类型
- 内置 minimap、controls、background
- **无 auto-layout**(需另接 dagre/elk 等)—— 这是关键缺陷
- **无 DSL**(纯 component 库,需手写节点/边数据)

**评估**:
- React runtime(违背 media-gen-mcp "纯 Node ESM + WASM" 栈)
- 无 auto-layout(同 Excalidraw 问题,LLM 必须写坐标)
- 无 DSL(与"LLM 写 DSL 直出图"哲学正交)
- **NO-GO**

### 4.6 Penpot(MPL-2.0 但 Figma 全栈)

**实地核实**:
- **License**:Mozilla Public License 2.0(GitHub `LICENSE`)
- **栈**:Clojure + ClojureScript(非 JS/TS 生态)
- **定位**:开源 Figma 替代品(design tool,非 diagram tool)
- **Digital Public Goods 认证**(README 显示)
- 自托管完整 SaaS(前端 + 后端 + 数据库)

**能力**:
- 矢量设计工具(类似 Figma/Sketch)
- 组件系统、设计 tokens、原型交互、协作
- Flex layout、Grid layout、auto-layout

**评估**:
- **形态完全错位**:Penpot 是设计师工具(Figma 替代),不是开发者图表工具
- ClojureScript 栈与 JS/TS 生态正交,集成代价巨大
- 自托管完整 SaaS(需 backend + DB),远超"生成单 HTML"目标
- **过度工程**的教科书案例
- **NO-GO**(排除评估完成)

---

## 5. 集成路径裁决汇总

| 候选 | 作为依赖 | 作为后端 | 作为输出格式 | 仅范式借鉴 |
|---|---|---|---|---|
| draw.io | ❌ webapp | ❌ 远程 script 依赖 | ⚠️ XML LLM 负担高 | ✅ mxgraph div + data-mxgraph 配置 |
| @excalidraw/excalidraw | ❌ React + 44MB | ❌ | ⚠️ React 必需 | ✅ 编辑器→utils 分层思路 |
| @excalidraw/utils | ❌ 91MB + 无 layout | ⚠️ 技术可行但代价大 | ⚠️ LLM 写坐标 | ✅ exportToSvg(elementData) 反例警示 |
| tldraw | 🔴 红线 | 🔴 红线 | 🔴 红线 | 🔴 红线(连借鉴都避免污染思路) |
| flowchart.fun | ❌ SaaS webapp | ❌ | ⚠️ 单一图类型 | ✅ text→graph 范式(已被 D2 覆盖) |
| @xyflow/react | ❌ React runtime | ❌ | ⚠️ 无 DSL | ✅ 节点/边抽象(已被 D2 抽象覆盖) |
| Penpot | ❌ ClojureScript SaaS | ❌ | ❌ 设计文件非图表 | ❌ 形态正交 |

**结论**:画板编辑器品类**作为依赖/后端/输出格式**全部 NO-GO;**仅范式借鉴**可借鉴 4 项(见 §6)。

---

## 6. 借鉴点(范式/工艺,不抄代码)

| # | 来源 | 借鉴点 | 如何用到 media-gen-mcp |
|---|---|---|---|
| 1 | draw.io | **`<div class="mxgraph" data-mxgraph="...JSON...">` 配置接口范式** | viewer-min.ts 可参考此模式:一个 div + 一个 data-* JSON 配置(toolbar/layers/zoom/theme),JS 启动时读配置初始化。**只抄接口形态,不抄 3.8MB 实现** |
| 2 | draw.io embed mode | **`proto=json` + `postMessage` 双向通信范式** | 未来若需 viewer ↔ host 通信(如点击节点触发外部动作),可参考此事件契约。当前 MVP 不需要 |
| 3 | Excalidraw utils | **`exportToSvg(elementData)` 接口形态 + `serializeAsJSON` 命名** | 反向警示:此接口要求调用方写坐标,正是 media-gen-mcp 立场反对的;在 README/docs 引用为"我们不做这种"的反例 |
| 4 | Excalidraw 双包分层 | **主包(React editor) + utils 包(无 React I/O)** 的分层思路 | 启发 media-gen-mcp 工具分层:`generate_diagram`(静态) / `generate_interactive_diagram`(交互) / `render_video`(动画)三档,而不是把所有功能塞一个工具 |

**Penpot 的 Flex/Grid layout、组件系统**完全不借鉴(设计工具需求,非图表需求)。**tldraw 不借鉴**(避免思路污染)。**flowchart.fun/xyflow 的范式已被 D2 完全覆盖**。

---

## 7. 与既有 doc_v11 P0-5 路线的对齐确认

本调研独立验证 `doc_v11/P0-5-Archify源码与同品类深度调研.md` §3.4 同品类对比表 + §3.5 License 终态矩阵,结论**完全一致**:

| doc_v11 既有结论 | 本次独立核实 | 一致性 |
|---|---|---|
| tldraw NO-GO(license 红线) | ✅ 五证确认 + 100 天 trial 陷阱 + ~$6000/yr 商用价 | ✅ 强化 |
| Excalidraw/diagrams.net/flowchart.fun NO-GO(webapp 过度工程) | ✅ 实测 viewer-static.min.js 3.8MB + Excalidraw 44MB + flowchart.fun 商业 SaaS | ✅ 强化 |
| xyflow NO-GO(React 重 runtime) | ✅ peerDeps react>=17 + 无 auto-layout/DSL | ✅ 一致 |
| draw.io viewer 单文件不可行 | ✅ 官方明文 remote script 必需 + 内联 3.8MB | ✅ 新增证据 |
| D2 WASM + markmap 范式 + 极简 viewer 路线 | ✅ 与画板编辑器品类正交,无需变更 | ✅ 不动 |

**对 P0-5 实施的零影响**:本调研是 exclusion 论证,不引入任何新依赖、不改任何工具签名、不动任何文件结构。`doc_v11/P0-5-交互式HTML图实施规划.md` §4.4 新增文件清单、§10 License 矩阵、§10 风险表全部仍正确。

---

## 8. 开放问题(留给主决策者)

1. **draw.io XML 作为 export 选项的可行性评估**:虽然 LLM 写 mxGraph XML 负担高,但若用户明确需要"在 draw.io 中继续编辑"的产物,可作 Tier 3 可选 export 格式(非 MVP)。需独立调研 LLM 生成 mxGraph XML 的正确率(预计 < 60%,因 XML 嵌套 + cell ID + style 字符串复杂)。
2. **Excalidraw `.excalidraw` JSON 作为 export 选项**:同上,Tier 3 评估;需确定性审计 `seed` 字段对 SVG 输出的影响。
3. **手绘风需求是否真实**:media-gen-mcp 用户场景里,有无"我要一张像草稿的架构图"的需求?若没有,Excalidraw 调性 permanently NO-GO;若有,可考虑 Tier 3 用 roughjs(0.16MB,纯渲染库)直接渲染 D2 输出的几何到手绘风 SVG(零引入 Excalidraw 本体)。
4. **draw.io 商标条款影响**:Apache 2.0 代码可用,但"draw.io"名称/Logo 是 EU 商标。若 media-gen-mcp 未来在 README/文档里提及"powered by draw.io"或类似表述,需先获书面许可。**当前方案不涉及**(不集成 draw.io),但若 Tier 3 加 draw.io XML export,需重新评估。
5. **flowchart.fun 的 cytoscape auto-layout 范式**:D2 已有更专业的 auto-layout,但 cytoscape 的 force-directed layout 在"非层级关系图"(如知识图谱、社交网络)上比 D2 的 dagre 更合适。若未来 media-gen-mcp 需扩"知识图谱"图类型,可评估直接用 cytoscape(5.43MB)替代 —— 但这破坏"零新增依赖"立场,需独立决策。

---

## 9. 调查方法学(可追溯)

| 数据点 | 来源 | URL/路径 |
|---|---|---|
| tldraw LICENSE 全文 | curl GitHub raw | `https://raw.githubusercontent.com/tldraw/tldraw/master/LICENSE.md` |
| tldraw package.json license 字段 | curl GitHub raw | `https://raw.githubusercontent.com/tldraw/tldraw/master/packages/tldraw/package.json` |
| tldraw watermark + 100 天 trial + 商用价 | zread 索引官方文档 | `https://zread.ai/tldraw/tldraw/5-issues-and-feedbacks` |
| Excalidraw LICENSE | curl GitHub raw | `https://raw.githubusercontent.com/excalidraw/excalidraw/master/LICENSE` |
| Excalidraw package.json(peerDeps + 30 deps) | zread read_file | `packages/excalidraw/package.json` |
| Excalidraw npm unpackedSize 44.63 MB | curl npm registry | `https://registry.npmjs.org/@excalidraw/excalidraw/latest` |
| @excalidraw/utils 91.5 MB + exportToSvg API | curl npm + zread README | `https://registry.npmjs.org/@excalidraw/utils/latest` + `packages/utils/README.md` |
| draw.io LICENSE Apache 2.0 | curl GitHub raw | `https://raw.githubusercontent.com/jgraph/drawio/master/LICENSE` |
| draw.io README(商标 + 无 PR + Apache 2.0 scope) | curl GitHub raw | `https://raw.githubusercontent.com/jgraph/drawio/master/README.md` |
| draw.io embed-html doc(remote script 必需) | curl 官方 docs | `https://www.drawio.com/doc/faq/embed-html` |
| draw.io viewer-static.min.js 3.8MB | curl 直拉 | `https://viewer.diagrams.net/js/viewer-static.min.js` + GitHub raw `src/main/webapp/js/viewer-static.min.js` |
| draw.io 60+ Sidebar 形状库 | zread get_repo_structure | `src/main/webapp/js/diagramly/sidebar/` |
| flowchart.fun LICENSE MIT | curl GitHub raw | `https://raw.githubusercontent.com/tone-row/flowchart-fun/main/LICENSE` |
| flowchart.fun 商业 SaaS + React + cytoscape | curl README + app/package.json | 同上 |
| @xyflow/react MIT + React peerDep | curl GitHub + npm | `https://raw.githubusercontent.com/xyflow/xyflow/main/LICENSE` + npm registry |
| Penpot MPL-2.0 | curl GitHub raw | `https://raw.githubusercontent.com/penpot/penpot/main/LICENSE` |
| roughjs 0.16MB / cytoscape 5.43MB / mermaid 79.66MB | curl npm registry | npm view |

**调研工具使用**:
- `mcp__zread__get_repo_structure` / `read_file` / `search_doc`:仓库结构、LICENSE、官方文档索引
- `curl` + GitHub raw + npm registry:License 全文、package.json、unpackedSize 实测
- 内置 `WebSearch`:耗尽(路由至已耗尽的 search-prime backend,1310 错误,2026-07-24 重置)—— 全程未使用
- `mcp__web-search-prime`:任务约束明令不用(配额耗尽)
- 未读/未改任何 media-gen-mcp 源码;未读 doc_v11 全文(仅 grep + 关键段读)

---

## 10. 最终裁决(一句话)

**画板编辑器品类(draw.io / Excalidraw / tldraw / flowchart.fun / xyflow / Penpot)整体 NO-GO**,理由涵盖 license 红线(tldraw 专有五证确认)、React 重 runtime(Excalidraw/xyflow)、webapp 过度工程(draw.io/flowchart.fun/Penpot)、体积爆炸(viewer-static 3.8MB / excalidraw 44MB / excalidraw-utils 91MB)、无 auto-layout(Excalidraw/xyflow)。**既有 P0-5 路线(D2 WASM + markmap 范式 + 极简 viewer)不变**,本调研为其提供独立证据闭环与画板品类的完整排除论证。
