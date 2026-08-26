# 嵌套 / drill-down 架构图开源工具调研(范式分类 + 借鉴清单 + NO-GO)

> **角色**:`inv:oss-nested-drill` 调查者(被 `drill-down-navigation-design.md` §0 + `输入manifest数据模型.md` 上游锚引用为"已锁定替换视图路线"的证据源)
> **生成日期**:2026-07-28
> **任务**:找"点某节点 → 展开其内部架构,面包屑回任意层"这类 OSS 工具,深度调研其 navigation / drill 范式,产出范式分类 + 各工具借鉴清单 + NO-GO。
> **方法**:WebSearch + curl GitHub raw + mcp__zread(智谱搜索耗尽不用);一手核实 license / bundle / 行为。
> **立场红线(继承 doc_v14 兄弟文档)**:① 单文件自包含 HTML(零外链 `<script src=`、零 node_modules、离线可看);② 纯免费(MIT/Apache 优先);③ 同输入同输出可入 git;④ 向后兼容不破坏 inputSchema;⑤ 守 S6 ≤256KB。
> **证据等级**(03 §0.3):L1 = producer 源码/官方文档原文;L2 = 一手 curl/unpkg 实测;L3 = 运行时复现。本文优先引 L1/L2。

---

## 0. 一句话结论

> **drill-down 三范式可分类为「替换视图 / 折叠原位 / 几何缩放」,本工具应选「替换视图(view stack)」——这是 C4/Structurizr 的原生范式,也是唯一与"D2 每层独立 auto-layout、父图把容器画成单个矩形"硬约束不冲突的范式。** 最值得借鉴的三件:① **Structurizr** 的 C4 心智模型 + double-click zoom-in drill(且 `structurizr-cli static-site` 导出**确认保留** drill-down,是概念最契合的现成解);② **markmap** 的 `--offline` fillTemplate 自包含 HTML 范式(MIT,最接近"单文件离线"目标);③ **Archify** 的 chevron affordance + viewer/geometry 分层(license 未明 → reimplement)。NO-GO:React Flow 的 expand-collapse 官方示例(Pro license + React runtime 破单文件)、D3 zoomable treemap 作主范式(几何模型冲突)、D2 浏览器侧重布局(21MB WASM)、Archify 10500 行 viewer 整体抄。

---

## 1. drill-down 三范式分类(本调查的核心切片)

"点节点 → 看内部 + 能回上层"在 OSS 世界里落到三种**正交**的交互范式。三范式不是口味,而是由"子层几何是否存在 / 父子是否同画布 / 面包屑语义是否清晰"三个客观约束决定的:

| 范式 | 机制 | 子层几何 | 父子同画布? | 面包屑语义 | 典型工具 |
|---|---|---|---|---|---|
| **A. 替换视图(view stack)** | 整层 SVG/图作为一个不可分割单元,drill = 当前层淡出 → 子层字符串替换淡入 → stack push | **每层独立 auto-layout,父图不持有子图坐标** | ❌ 不同画布(同时只显一层) | "我在哪一层"——清晰、可枚举 | **C4/Structurizr**(double-click zoom-in)、**draw.io** page-link、**D2** cross-board link |
| **B. 折叠原位(fold / expand-collapse)** | 父子同画布,点节点 toggle 子树 `display` / `hidden` | **父子几何共存于一张图**(auto-layout 必须一次算完整棵树) | ✅ 同画布 | "哪些分支展开了"——非层迹,无回溯概念 | **markmap**(click circle toggle)、**React Flow** expand-collapse、**D3 collapsible tree**、**Archify Story Trail** |
| **C. 几何缩放(zoom-into)** | 相机平移 + 放大到节点 X 的子图区域,父子图同坐标系 | **父图坐标系内嵌套子图坐标系** | ✅ 同画布(但需嵌套 viewBox/transform 矩阵) | 与 zoom 操作语义混淆(zoom in ≠ drill in) | **D3 zoomable treemap**、**BigPicture**、**Zoomable Sunburst** |

### 1.1 为什么本工具选 A(替换视图)——三条硬约束锁死

1. **D2 几何约束(L2 实测,doc_v14/drill-down-navigation-design.md §1.2)**:D2 父图把 nested container `order_service.pay` 画成单个矩形框,**子图内部几何不存在于父 SVG 里**。范式 B/C 都要求父子几何共存 → 要么自研 layout engine(违反收口决策 §2 第 2 条"不自研编辑器"),要么浏览器侧跑 D2 WASM 21MB(NO-GO,超 S6 80-125 倍)。范式 A 每层独立渲染一份 SVG → D2 后端并行 N 次渲染,几何天然解耦。

2. **状态模型约束**:范式 A 的栈状态 = `stack=[root, X, Y]` 纯字符串数组(~80 行 vanilla JS,见 design §3.1);范式 B 需维护"哪些节点 expanded"的集合 + 重布局级联;范式 C 需 viewBox/transform 矩阵 + 父子坐标映射。**01 §2.3(simple = 不交织)**:A 把"显示哪一层"与"层内几何"钉死在不同单元(state vs SVG 字符串),B/C 把它们缠在一起。

3. **面包屑语义约束(NN/g 证据)**:面包屑是 supplement navigation(NN/g *Breadcrumbs: 11 Design Guidelines*),其语义是"我在层级树的哪条路径上"。范式 A 的 stack 自然就是面包屑;范式 B 的 expanded-set 是分支状态不是路径;范式 C 的 transform 是相机参数不是层迹。**只有 A 让面包屑与 drill 共享同一状态源**(design §3 INV-3:URL hash ↔ stack 一一对应)。

### 1.2 范式裁决的输出

> **本调查证实 `drill-down-navigation-design.md` §1 的"替换视图"路线选择是正确且被 OSS 证据充分支撑的。** 后续借鉴清单均围绕"如何在替换视图框架内吸收其他工具的好范式",而非"换范式"。

---

## 2. 七个工具族逐个深析(按范式归类)

### 2.1 【范式 A】C4 model + Structurizr —— 概念最契合的现成解 ⭐

**C4 模型**(Simon Brown)= Context / Container / Component / Code 四层抽象,本就是"分层抽象架构,逐级 drill"——**与 01 §2.1 的"航母分层"心智模型字面同构**(用户 task 描述原文即引 C4)。这不是巧合:C4 的设计动机就是"总工程师眼里航母是简单分层"。

**Structurizr** 是 C4 的参考实现(DSL + 渲染器 + viewer)。

#### drill-down 机制(L1 原文,docs.structurizr.com/ui/diagrams/navigation)

- **double-click zoom-in**(原生范式 A drill):
  - "Double-clicking a software system will either take you to the System Context or Container diagram for that software system, if one exists."
  - "Double-clicking a container will take you to the first Component diagram for that container, if one exists."
  - 当一个元素有多种 drill 目标(zoom-in / documentation / decisions / url)时,double-click 弹 modal 让用户选。
- **element.url property**:可给元素挂任意 URL(外部 https 或内部 `{workspace}/diagrams#key`),用 Alt+double-click 触发。
- **Quick navigation(Space 键)+ thumbnail strip + 键盘方向键**:虽然**没有显式面包屑**(本次 fetch 未提及),但 thumbnail strip 起到了"层迹快照"作用。
- **DSL 语法**:`perspectives { perspective "Health" { url "..." } }`;元素级 `url` 在 DSL language reference。

#### 静态 HTML 导出 —— 关键确认(L1 原文,docs.structurizr.com/export/static-site)

> **Structurizr CLI 的 `static-site` 导出保留交互式 drill-down 导航**(非静态图片)。
>
> 文档原文列出的导出 viewer 能力:`Double-click to navigate` / `Zooming and scrolling (+, -, mouse wheel)` / `Diagram key (i)` / `Tooltips (t)` / `Perspectives (p)` / `Animation (, and .)` / `Toggle element descriptions (d)` / `Toggle element metadata (m)` / `Quick navigation (Space)`。
>
> 嵌入:`js/structurizr-embed.js`(iframe embed)。
>
> 限制:`All documentation and decision records are removed from the workspace`——diagrams-only 子集(无 ADR / 文档)。

这是本次调查最重要的发现:**存在一个 OSS 概念完全契合、且能产出可交互静态 HTML 导出的现成解**。

#### License / 立场风险

- **Structurizr DSL**:Apache 2.0(structurizr/dsl,开源)
- **structurizr-java**:Apache 2.0
- **Structurizr Lite**:免费 Docker 容器,但**需 Docker 起服务**(违反 S2 单文件自包含)
- **static-site 导出产物**:HTML + JS + 资源是一组文件(非单 .html),且 `structurizr-embed.js` 用 iframe 嵌入(非 inline)
- **结论**:范式 100% 可借鉴 reimplement;**不直接搬** static-site 产物(多文件 + iframe + 非单文件 + 立场要求与 D2 集成而非 C4 DSL)

#### 可借鉴点(汇总进 §3)

1. **C4 心智模型本身**:Context → Container → Component 的"分层抽象"是 LLM 友好的输入结构(对齐 `输入manifest数据模型.md` 的 ManifestNode 树)
2. **double-click + modal 选 drill 目标**:本工具用 single-click drill,但"modal 选目标"留给将来(多 diagramType 子图)
3. **element.url drill 语义**:`<a href="#path=root/X">` 的 hash 路由本质同构
4. **thumbnail strip / Space quick-nav**:比纯面包屑更视觉化,但增加体积,Tier 2 可选
5. **"diagrams-only 子集"策略**:Structurizr 主动砍 docs/ADRs 保 viewer 轻——本工具也应守"viewer 只显图,不进 notes 长文"(notes 走 tooltip / 侧栏)

### 2.2 【范式 A】draw.io / diagrams.net —— 页面跳转 link navigation

#### drill-down 机制(L1,drawio-app.com/blog/linking-content + official docs)

- **right-click shape → Edit Link(Alt+Shift+L)→ Diagram Content → 选目标 page**:在 editor 里点 shape 跳到另一 page。
- **embed/viewer 模式保留 click-through**:导出为 HTML viewer 时,link 可点。
- **静态图片导出 = 无交互**:`<img src=*.svg>` 丢失 link。
- GitHub Issue #522("draw.io should provide intuitive tools for navigating diagrams")证实社区认为当前 link 回溯(back)体验不足。

#### 范式判定

draw.io 的 drill 是**页面级跳转**(page-based replace-view),不是"节点 drill 进子图"。父子关系靠 page 命名约定维护,无中心化 stack / hash。

#### License / 体积

- **Apache 2.0**(jgraph/drawio,立场 OK)
- 但 viewer-static bundle ~3.8MB(doc_v12/OSS竞品与交互能力矩阵.md §1.4 实测),超 S6 15 倍 → NO-GO 直接集成
- editor 是另一产品类(收口决策 §2 第 2 条已锁"不自研编辑器")

#### 可借鉴点

1. **"shape.link = 目标 page id"的数据模型**:与 manifest 的 `children` 数组同构(page id ↔ child node id)
2. **viewer 与 editor 分层**:viewer-static 是 editor 的只读子集——本工具 viewer-min.ts 同范式

#### NO-GO

- 直接嵌 draw.io viewer-static(体积超 cap 15 倍)
- draw.io editor(立场冲突,不是本工具产品类)

### 2.3 【范式 A】D2 nested composition + boards + links —— 后端契约的天然出处

#### drill-down 机制(L1,zread.ai/terrastruct/d2 + 官网)

- **nested composition**(`a.b.c` dot-notation):DSL 层支持,`order_service.pay.gateway` 嵌套语法。**但 D2 把 nested container 渲染成父图里的一个矩形框,子图不展开**——几何是父图的。
- **boards / layers / scenarios / steps**:多 board 语法,board 间用 `link` 关键字串联(LSP "Validates cross-board references",d2compiler/compile.go:1296)。官网首页:"click through to another linked diagram"——但**这是 board-to-board 的 SVG 间 `<a href>` 链接**,不是 in-place drill。
- **D2 SVG 输出本身无交互 JS**:D2 渲染出静态 SVG,点击行为靠 viewer 外挂(media-gen-mcp 的 viewer-min.ts 正是此外挂)。
- **import system**:支持 `@library.components.button` 跨文件 dot-notation 引用,可组合多文件 board。

#### 范式判定

D2 原生提供 **范式 A 的后端契约(nested DSL + boards + links)**,但**不提供前端交互**——前端 viewer 是 media-gen-mcp 的职责。这正是 `drill-down-navigation-design.md` §1.3 的方案 A/B/C(后端渲染策略)的天然出处。

#### License

- **D2 WASM**:MPL-2.0(已集成进 media-gen-mcp)
- 但 D2 browser bundle 7.8MB / d2.wasm 21MB → 浏览器侧重布局 NO-GO(已锁)

#### 可借鉴点

1. **nested composition dot-path**:manifest 的 `id` 用 dot-path(`order_service.pay`)—— 与 D2 native 同构,便于从单 DSL 自动提取分层
2. **boards cross-reference**:多 board 的 link 语义,design §1.3 方案 A(一次 DSL 渲 N 次,scope 到某层)的基础

#### NO-GO

- 浏览器侧跑 D2 WASM 按需渲染子层(21MB 超 cap)
- 把 D2 的 `link` 当作前端 drill 的实现(D2 link 是 SVG 间 `<a href>`,需要把 N 份 SVG 一起部署 → 破单文件)

### 2.4 【范式 B】React Flow / xyflow —— fold-in-place,React runtime + Pro license 双拦

#### drill-down 机制(L1,reactflow.dev/examples/layout/expand-collapse)

- "Nodes with children can be expanded or collapsed by clicking on them, revealing or hiding their descendants."
- 实现:节点的 `data.expanded` flag + 子节点 `hidden` property toggle。**所有节点在同一 canvas,只是显隐**。
- 子节点 lazy-load on click:GitHub Discussion #2606(`onChildClick → setNodes/setEdges` 注入新节点)。

#### 范式判定

**范式 B(fold-in-place)**。父子同画布,需一次算完整棵树几何(用 dagre)。无面包屑。

#### License / 体积 硬拦(L2 实测,doc_v12/OSS竞品与交互能力矩阵.md §2.1)

- **核心 MIT**,但 **expand-collapse 官方示例是 Pro example,under xyflow Pro License**——访问需 Pro 订阅。本工具要借鉴需 reimplement 范式(允许,因为范式不受 license 约束)。
- **React runtime**:peerDeps `react>=17` + `react-dom>=17`,全栈 `react + react-dom + @xyflow/react + style.css` = **330KB raw / 107KB gz**(4 文件 + jsx-runtime shim)。media-gen-mcp 当前**零 React 依赖**——引入 = 哲学层断裂。
- jsx-runtime shim 痛点:浏览器 global 模式下 UMD 期望 `window.jsxRuntime`,需手写 shim。

#### 可借鉴点(只范式,不代码)

1. **lazy-load children on click** 范式:可 vanilla 重实现——drill 触发时才把子层 SVG 字符串拼进 stage(design §3 的 `attachDrillHandlers` 已采此精神)
2. **`data.expanded` flag + hidden toggle**:可用于 Tier 2 的"同层多 container 展开"——但与替换视图冲突,不采纳

#### NO-GO

- 直接集成 React Flow(React runtime 破单文件 + Pro license 示例 + 4 文件加载链)
- 用 fold-in-place 作主范式(与 D2 几何不兼容,见 §1.1)

### 2.5 【范式 B】markmap —— fold + 自包含 HTML 最接近目标 ⭐

#### drill-down 机制(L1,zread.ai/markmap/markmap)

- **markdown + mindmap**:Markdown headings → d3.hierarchy → 交互 SVG 思维导图
- **Toggle Expansion**:"Click on node circles to expand/collapse branches"——范式 B fold
- **Pan and Zoom**:大型思维导图导航
- **mm.svg.selectAll('g.markmap-node').on('click', ...)**:D3-based,可挂自定义 click handler
- **无面包屑**(本次 fetch 未提及)

#### 自包含 HTML(L1 关键,zread.ai/markmap/markmap + markmap-cli/cli.ts:21-35)

> `markmap document.md --offline` 命令:
> "Fetch all necessary JavaScript and CSS assets / Inline them directly into the HTML file / Create a self-contained document that works without any external resources."
>
> **`markmap-render.fillTemplate(root, {styles, scripts}, {jsonOptions})`** 是核心 API:"Assembling everything into a complete HTML string / The resulting HTML is completely self-contained and can be saved as a file or embedded in a webpage."

这是与 media-gen-mcp "单文件自包含 HTML" 立场最接近的现成范式——`fillTemplate(root, opts)` 与 generate_interactive_diagram 的 template-filling 同构。

#### License

- **MIT**(markmap 全包)
- markmap-render / markmap-view / markmap-cli / markmap-lib / markmap-common 全 MIT

#### 可借鉴点 ⭐(高价值)

1. **`fillTemplate(data, {jsonOptions})` 范式**:把数据 inline 为 JSON-options 注入 HTML 模板——design §2 的 `<script type="application/json" id="mgm-layers-data">` 与此同构(markmap 是 `window.jsonOptions = ...` inline)。可对比 markmap 的 fillTemplate 实现来确定"数据 vs 代码"的注入边界。
2. **`--offline` flag 的资源 inline 策略**:把 JS/CSS 字体全部 inline → 单文件。本工具 viewer-min.ts 已是 inline 字符串,范式一致。
3. **D3-hierarchy 思维导图几何**:不适用于架构图(架构图非树形 layout),但"父子关系显式序列化"思路一致。
4. **不要照搬 fold 交互**:markmap 的 fold 需要父子同 SVG,与 D2 几何冲突(§1.1);本工具的 manifest 树虽然概念上像 mindmap,但每层是独立 D2 渲染 → 必须用替换视图。

#### NO-GO

- 用 markmap 作 viewer(范式 B 与 D2 几何冲突)
- 把 markmap-render 整个包进 HTML(markmap-view bundle ~100KB+,且交互模型不对)

### 2.6 【范式 B】Archify —— Story Trail / chevron / 多面板(重析 doc_v11)

(完整深析见 `doc_v11/Archify深度分析与借鉴报告.md`,此处只切 drill-down 维度)

#### drill-down / 导航机制

- **Story Trail / Story Carrier**:`data-story-step` 属性驱动的"叙事步骤",可前进/后退——但这是**时间维度叙事**,不是**空间维度 drill**。范式上更接近"幻灯片"而非"层级钻取"。
- **Semantic Lens / Overview Radar / Route Probe**:多面板的"同图多视角"——同图内高亮/过滤,不切层。
- **chevron affordance + viewer/geometry 分层不变量**:每条 viewer 特性都附 "no schema/IR/renderer layout/dependency changed" 声明——**viewer 探索态绝不污染 IR/几何**。导出时 strip `data-view-scale`/`data-focus-active`/`[data-story-step]` 等几十个属性。

#### License

- **未明**(bundle 中无 LICENSE 文件)→ 默认 reimplement

#### 可借鉴点(design §4 已大量吸收)

1. **chevron-down 角标作 drillable signifier**(design §4.2 已采纳)——NN/g 证据表明 chevron 是最强"in-place 展开"signifier
2. **viewer/geometry 分层不变量**:design §10 已列(viewStack 只 `stage.innerHTML =` 替换 SVG,从不 mutate SVG DOM 属性)
3. **导出时 strip viewer-state**:若未来 generate_interactive_diagram 加 PNG 导出,需类似 Archify 的属性黑名单
4. **Motion Governor**(5 触发条件):design §7.4 已纳入

#### NO-GO

- Archify 10500 行 viewer 整体抄(doc_v11 §5.4 已锁)
- Archify Story Trail 范式(叙事 ≠ drill,本工具不做幻灯片)

### 2.7 【范式 C】D3 zoomable / collapsible tree / BigPicture —— 几何缩放或 fold

#### drill-down 机制(L1,observablehq.com/@d3/collapsible-tree + d3-graph-gallery/treemap)

- **collapsible tree**:fold-in-place + zoom/pan(范式 B + 缩放辅助)
- **zoomable treemap**:相机放大到子矩形区域(范式 C)
- **zoomable sunburst**:径向缩放(范式 C)
- **D3 不自带 breadcrumb 组件**——需自建

#### 范式判定

D3 是"自己拼范式"的工具箱,不是成品。collapsible tree = 范式 B;zoomable treemap = 范式 C。两者都需父子几何共存。

#### License

- **ISC**(D3,等同 MIT 兼容)

#### 可借鉴点

1. **d3.hierarchy 数据结构**:manifest 树可映射到 d3-hierarchy,但本工具用 vanilla,不引 D3
2. **breadcrumb 自建范式**:D3 社区有 gaudiamus /breadcrumb-js 等小片段,但都需自带 CSS——design §5 的面包屑已是 vanilla 自建

#### NO-GO

- 范式 C 作主范式(design §1.2 已锁:zoom-into 与 D2 几何不兼容)
- 引入 D3 全包(~/75KB gz,且 D3-hierarchy 对架构图非必需)

---

## 3. 借鉴清单总表(按"是否可直搬"分级)

> 标记:**[范式]** = 纯思路借鉴零代码;**[片段]** = 可 reimplement 小片段(<50 行);**[NO-GO]** = 不搬

| # | 工具 | 借鉴点 | 标记 | 已落地位置 |
|---|---|---|---|---|
| B1 | **C4/Structurizr** | C4 分层抽象心智模型(Context → Container → Component) | [范式] | `输入manifest数据模型.md` 的 ManifestNode 树已映射 |
| B2 | **C4/Structurizr** | double-click zoom-in drill 语义(本工具用 single-click) | [范式] | design §3 `drillInto(nodeId)` |
| B3 | **C4/Structurizr** | element.url 的 hash 路由(`#path=root/X/Y`) | [范式] | design §6 URL 协议 |
| B4 | **C4/Structurizr** | thumbnail strip / Space quick-nav(diagrams-only 子集策略) | [范式] | Tier 2 可选(design §11 open) |
| B5 | **C4/Structurizr** | `static-site` 导出保留 drill 的 iframe embed 范式 | [范式] | 本工具走 inline 不走 iframe(守 S2) |
| B6 | **markmap** | `fillTemplate(data, {jsonOptions})` inline JSON 注入 HTML | [片段] | design §2 `<script type="application/json">` 已同构 |
| B7 | **markmap** | `--offline` flag 资源全 inline 策略 | [范式] | media-gen-mcp viewer-min.ts 已是 inline 字符串 |
| B8 | **draw.io** | shape.link = 目标 page id 的数据模型 | [范式] | manifest `children: string[]`(page id ↔ child id) |
| B9 | **D2 native** | nested composition dot-path(`a.b.c`) | [范式] | manifest `id` 字段 dot-path |
| B10 | **D2 native** | boards cross-reference 语法 | [范式] | design §1.3 方案 A(一次 DSL 渲 N 次) |
| B11 | **Archify** | chevron-down drillable 角标(NN/g 证据) | [片段] | design §4.2 `attachDrillHandlers` 已落地 |
| B12 | **Archify** | viewer/geometry 分层不变量 | [范式] | design §10 INV(viewStack 只 innerHTML 替换) |
| B13 | **Archify** | 导出时 strip viewer-state 属性黑名单 | [范式] | Tier 2(若加 PNG 导出) |
| B14 | **Archify** | Motion Governor 5 触发条件 | [片段] | design §7.4 已落地 |
| B15 | **React Flow** | lazy-load children on click 范式(vanilla 重实现) | [范式] | design §3 `attachDrillHandlers`(切层才挂 handler) |

**注**:B6/B11/B12/B14 已被 design 文档吸收;B1/B2/B3/B8/B9/B10 已被 manifest 数据模型吸收。本调研的增量价值是**证实这些借鉴的范式分类归属性**(均属范式 A 替换视图框架内的合理吸收,而非范式混乱)。

---

## 4. NO-GO 清单(显式记录拒因,防后续漂移)

| # | 拒绝项 | 拒因(对齐 01 §3 + 立场红线) | 证据等级 |
|---|---|---|---|
| N1 | **React Flow 整体集成** | React runtime(330KB raw / 107KB gz + 4 文件)+ Pro license 的 expand-collapse 示例 + media-gen-mcp 零 React 当前态 | L2(doc_v12 §2.1 实测)+ L1(reactflow.dev) |
| N2 | **React Flow fold-in-place 作主范式** | 父子几何共存与 D2 auto-layout 冲突(§1.1) | L1 D2 几何 |
| N3 | **D2 浏览器侧重布局** | d2.wasm 21MB 超 S6 80-125 倍 | L2(doc_v14 design §8.1 实测) |
| N4 | **D3 zoomable treemap 作主范式** | 几何缩放需父子坐标系嵌套,D2 不输出嵌套坐标系;面包屑与 zoom 语义混淆 | L1 D3 + design §1.2 |
| N5 | **D3 全包引入** | ~75KB gz,且架构图非树形 layout,D3-hierarchy 非必需 | L2 |
| N6 | **draw.io viewer-static 集成** | ~3.8MB 超 S6 15 倍 + 远程 script | L2(doc_v12 §1.4) |
| N7 | **draw.io editor** | 立场冲突(收口决策 §2 第 2 条"不自研编辑器") | 已锁 |
| N8 | **markmap 作 viewer** | 范式 B fold 与 D2 几何冲突;markmap-view bundle ~100KB+ | L1+zread |
| N9 | **markmap-render 整包进 HTML** | 交互模型不对 + 体积 | L1 |
| N10 | **Archify 10500 行 viewer 整体抄** | 过度工程 + license 未明 | doc_v11 §5.4 已锁 |
| N11 | **Archify 代码直接抄** | license 未明 → 全部 reimplement | doc_v11 §5.6 已锁 |
| N12 | **Archify Story Trail 范式(叙事)** | 叙事 ≠ drill,本工具不做幻灯片 | 范式判定 |
| N13 | **Structurizr static-site 产物直接搬** | 多文件 + iframe embed(`js/structurizr-embed.js`)+ 非 D2 集成 | L1(docs.structurizr.com/export/static-site) |
| N14 | **Structurizr Lite Docker 服务化** | 违反 S2 单文件自包含 | L1 |
| N15 | **把 D2 `link` 关键字当前端 drill 实现** | D2 link 是 SVG 间 `<a href>`,需 N 份 SVG 部署 → 破单文件 | L1 D2 |

---

## 5. 对比矩阵(任务要求的最终交叉打分)

> 列:**范式**(A 替换视图 / B 折叠原位 / C 几何缩放) | **面包屑回溯** | **自包含 HTML 离线** | **嵌套深度** | **license** | **可借鉴点**

| 工具 | 范式 | 面包屑回溯 | 自包含 HTML 离线 | 嵌套深度 | license | 可借鉴点(摘要) |
|---|---|---|---|---|---|---|
| **C4/Structurizr** | A(double-click zoom-in) | ❌(用 thumbnail+Space 替代) | ✅(`static-site` 导出保留 drill,但多文件+iframe) | 4 层(Context/Container/Component/Code) | DSL Apache 2.0;Lite 免费 Docker | C4 心智 + url drill + diagrams-only 子集(B1-B5) |
| **draw.io** | A(page-link jump) | ❌(page 命名约定) | ⚠️(viewer-static 可嵌但 3.8MB) | 无限(page 自由) | Apache 2.0 | shape.link 模型(B8) |
| **D2(native)** | A(cross-board `<a href>`) | ❌ | ❌(SVG 静态,需 viewer 外挂) | dot-path 嵌套无限 | MPL-2.0(已集成) | nested dot-path + boards(B9-B10) |
| **React Flow** | B(expand-collapse fold) | ❌ | ❌(需 React runtime 330KB/4 文件) | 无限(受控) | 核心 MIT;expand-collapse 示例 Pro | lazy-load 范式(B15,不代码) |
| **markmap** | B(click circle toggle) | ❌ | ✅(`--offline` 全 inline,MIT,fillTemplate) | Markdown heading 无限 | MIT | fillTemplate + offline inline(B6-B7) |
| **Archify** | B(Story Trail)+ 同图多面板 | ❌(Story 是时间轴非路径) | ✅(3500 CSS + 7000 JS 内联,但 license 未明) | 5 图类型 × 各自深度 | 未明 → reimplement | chevron + viewer/geom 分层(B11-B14) |
| **D3 collapsible tree** | B(fold + zoom) | ❌(自建) | ⚠️(需自带 D3 ~75KB gz) | 无限 | ISC | d3-hierarchy 数据结构(不引) |
| **D3 zoomable treemap** | C(几何缩放) | ❌(语义混淆) | ⚠️(同上) | 无限 | ISC | NO-GO(范式冲突) |
| **BigPicture** | C(几何缩放) | ❌ | ⚠️ | 无限 | 待核 | NO-GO(范式冲突) |

### 5.1 矩阵读法

- **范式列**:本工具选 A → 可借鉴工具天然落在 A 行(C4/draw.io/D2);B 行工具(markmap/React Flow/Archify/D3 tree)只能借鉴**与范式无关的横向工艺**(数据序列化、affordance、Motion Governor),不能借鉴其 drill 交互本身;C 行全部 NO-GO。
- **面包屑列**:**所有调研工具均无原生 breadcrumb 回溯**——这是本工具相对所有 OSS 的差异化价值点。design §5 的面包屑(头2+尾2折叠 + `aria-current`)在 OSS 里没有直接先例,是基于 NN/g + IXDF 证据自建。
- **自包含 HTML 列**:只有 markmap(`--offline`)和 Archify 内联 viewer 真正达成单文件离线;Structurizr static-site 是多文件 + iframe。本工具的单文件 inline 字符串立场比 markmap 更严格(零外链 `<script src=`)。
- **license 列**:MIT 系列(markmap/D3)最宽松;Apache 2.0(C4 DSL/draw.io)立场 OK;MPL-2.0(D2)已集成;Archify 未明 → reimplement。

---

## 6. 对 design 文档的验证结果(裁决)

本调查证实 `drill-down-navigation-design.md` 的关键决策与 OSS 证据一致:

| design 决策 | 本调查验证 | 一致性 |
|---|---|---|
| §1 选替换视图(view stack) | §1 三范式分类 + D2 几何硬约束 | ✅ 充分支撑 |
| §1 拒 zoom-into | 范式 C 全部 NO-GO(D2 不输出嵌套坐标系) | ✅ |
| §2 数据契约 layers payload | 对齐 C4 Container 层 + draw.io page 模型 | ✅ |
| §3 视图栈 vanilla JS IIFE | 优于 React Flow(React runtime 拦)/ markmap(fold 范式冲突) | ✅ |
| §4 chevron drillable 角标 | Archify 已验证 + NN/g 证据 | ✅ |
| §5 面包屑(头2+尾2折叠) | **OSS 真空区**(无工具原生提供),自建合理 | ✅ 差异化 |
| §6 URL hash 深链 | 对齐 Structurizr element.url + D2 link 语义 | ✅ |
| §8 全预嵌(拒懒载) | D2 WASM 21MB 是懒载物理硬壁 | ✅ |
| §9 条件展开守 byte-identical | markmap fillTemplate 同构但更松(允许外链) | ✅ 本工具更严 |

**唯一可优化点**:design §1.2 提到"zoom-into 需保留祖先层渲染上下文"——本调查补充:**zoom-into 还需 D2 输出嵌套坐标系**,这是 D2 后端能力问题(不止前端几何变换),进一步坐实 NO-GO。

---

## 7. 未决问题(open_questions,转后续)

| # | 问题 | 当前倾向 | 触发解决条件 |
|---|---|---|---|
| **Q1** | 是否提供"从单 DSL 的 nested container 自动提取分层"(design §1.3 方案 A)vs 仅支持 `layers` 显式参数(方案 B)? | **倾向方案 B 显式优先**(可控、确定),方案 A 作为 Tier 2 自动模式 | 实施时核实 D2 WASM 是否支持按 scope 渲染子图(`RenderOptions` / sketch board 字段) |
| **Q2** | Structurizr static-site 产物的 iframe embed 范式是否有可借鉴的"diagrams-only 子集"裁剪策略? | **倾向研究其 embed.js 体积构成**,但只借鉴"裁剪策略"不搬代码 | 若未来 generate_interactive_diagram 体积逼近 S6 上限时 |
| **Q3** | markmap 的 `fillTemplate(root, {jsonOptions})` 与本工具 `<script type="application/json">` 注入,哪个对 GitHub README sanitize 更友好? | **倾向 application/json script**(design §2 已论证 sanitize 保留),但未实测 markmap 的 jsonOptions 路径 | 若用户反馈 README 嵌入需求再实测 |
| **Q4** | C4 的 4 层(Context/Container/Component/Code)是否应作为 manifest diagramType 的预设分层? | **倾向不锁死 4 层**(manifest 已有 5 值 diagramType 枚举,自由组合;C4 是 C4-DSL 的事不是本工具的事) | 若大量用户场景确实是 C4 四层,可加 `preset: "c4"` 可选字段 |
| **Q5** | BigPicture 工具的 license 与具体范式实现待核实(本调查未深入) | 倾向 NO-GO(范式 C 几何缩放已锁) | 若有用户明确要求 zoom-into drill 再核 |
| **Q6** | 是否补调研 Kroki(多引擎聚合,doc_v12 §0.2 已列 NO-GO for render tier)? | **倾向不补**(Kroki 是 server-side aggregation,与单文件自包含立场物理冲突) | 出现"用户要 server-side 渲多引擎"再核 |

---

## 8. 与 01/03 的对齐自查

| 01/03 条款 | 本调查如何对齐 |
|---|---|
| **01 §2.1**(航母分层 = 节点递归细分) | C4 的 Context/Container/Component 是该思想的字面落地;manifest 树映射之 |
| **01 §2.3**(simple = 不交织) | 范式 A 把"显示哪层"(state)与"层内几何"(SVG 字符串)分到不同单元;范式 B/C 把它们缠在一起 → A 胜 |
| **01 §2.4**(深模块) | C4/Structurizr 的"接口小(4 层 enum)+ 实现厚(任意 DSL)"是深模块;manifest 同构(6 字段接口 + viewer 厚实现) |
| **01 §3.2**(错误抽象比重复贵) | 拒 React Flow fold 范式(与 D2 几何冲突的强行抽象)、拒 $ref 跨节点引用(manifest §3.4 已锁) |
| **01 §4.4**(两类信号) | 范式裁决基于 D2 几何硬约束(适应度函数式不变量)+ OSS 工具实证(目标差距式参考) |
| **03 §0.3**(证据阶梯) | 全部结论标 L1(官方文档原文)/ L2(curl/unpkg 实测);无 L0 注释断言 |
| **03 §1.2 项 1**(producer 契约) | C4/Structurizr 的 element.url / DSL 语义均引官方文档为 L1 证据 |
| **03 §1.6.3**(过工程化拒绝) | NO-GO 清单 15 条,每条标拒因对齐 01 §3 + 立场红线 |
| **doc_v12 §2 收口决策** | 不自研编辑器(N7 draw.io editor / N3 D2 WASM 重布局 全锁) |
| **doc_v14 兄弟文档** | 本调查是 design.md §0 + manifest.md 上游锚的"已锁定替换视图"证据源;验证全部关键决策 |

---

**文档结束**。读者读完应能:(1) 判断 drill-down 范式选择(替换视图)是否被 OSS 证据支撑(✅);(2) 知道哪些工具的哪些范式可借鉴(B1-B15);(3) 知道哪些工具 / 范式明确 NO-GO(N1-N15);(4) 守住全部 5 条立场红线 + byte-identical 兼容。
