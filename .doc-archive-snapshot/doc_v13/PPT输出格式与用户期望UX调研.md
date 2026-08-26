# PPT 输出格式与用户期望 UX 调研

> 范围:用户说"做一份 PPT"时,到底想要什么产物?四类输出格式(真 .pptx / HTML 幻灯片 / PDF / 图片集)的用户价值、实现成本、与 media-gen-mcp 的契合度。
> 边界:只读 media-gen-mcp 源码;不动其源码,产物只写 doc_v13/。web-search-prime 限流(1310 → 2026-07-24 重置),外部证据用内置 WebSearch + curl GitHub raw/PyPI/npm + mcp__zread__。
> 关联:`doc_v12/收口决策.md`(AI 对话微调 > 原生编辑器)、`doc_v12/快速生成-快速微调工作流范式调研.md`(范式 C 杀手锏)。

---

## 0. TL;DR + 裁决

1. **"做份 PPT"是歧义请求,4 种用户场景对应 4 种产物,没有单一正确答案** → media-gen-mcp 若做 PPT,**必须多格式**(format 参数),不能赌单一格式。
2. **默认格式应为"可编辑 .pptx"(原生文本框),不是图片版式**。理由:用户可编辑是 PPT 品类最高频且最高风险的隐性期望("老板用 PowerPoint 打开改两个字"场景输不起),而图片版式在此场景直接失效。
3. **AI-PPT 的核心矛盾不是"库做不到",而是"设计选择"**:
   - Slidev / Marp / Gamma 的 .pptx 导出**全是图片底**(每页截图当背景,文字不可选),因为它们的页面是复杂设计画布,牺牲了可编辑性换像素完美;
   - `pptxgenjs`(Slidev 同款依赖,MIT)的 `addText()`/`addShape()` **本来就能产出原生可编辑文本框** —— Slidev 是**选择**用 `addImage()` 而非 `addText()`。
   - 即:**同一条 Node 技术栈,既能出可编辑(文本框),也能出像素完美(图片底)**,取舍在产品而非库。media-gen-mcp 用 `pptxgenjs` 可鱼与熊掌兼得(参数切换)。
4. **media-gen-mcp 的 Node 原生可编辑 PPTX 路径 = `pptxgenjs`**(MIT,v4.0.1),**不是** python-pptx(Python 栈,media-gen-mcp 是 TS/Node)。环境里已有的 `mcp__ppt__`(PowerPoint MCP Server v2.1.0,32 工具)才是 python-pptx 系,但那是**另一个 MCP**,与 media-gen-mcp 无关。
5. **立场警示(沿用 doc_v12 §2)**:media-gen-mcp 定位是"所有图像操作归一个 MCP"。PPTX 是**文档**不是图像;真·可编辑 PPTX 生成属于"文档生成",已越过 media-gen-mcp 版图边缘。**是否跨界做 PPT,本身是需用户拍板的定位决策,不是技术决策**。若只做"图像版 turf 内 MVP",最低成本是 N× `generate_card` 拼成图片集(或图片底 PPTX)。

---

## 1. 现状盘点(media-gen-mcp 有什么、缺什么)

读源码确认(`src/index.ts` 工具注册):

| 既有工具(20) | 与 PPT 的关系 |
|---|---|
| `generate_card`(Satori → PNG/SVG) | **单页**最接近"一张幻灯片":标题+副标题+正文+footer,确定性出图。但只 1 页,不是 deck。 |
| `generate_interactive_diagram`(D2 → 单文件 HTML) | **单页 HTML**:有 viewer/主题切换/动画。形态像 1 张交互幻灯片,但不是多页 deck。 |
| `generate_chart` / `generate_diagram` / `generate_formula` / `generate_qrcode` / `generate_icon` | 单元素渲染器,可作 slide 内嵌素材。 |
| `render_svg` / `render_video` | SVG/PNG/视频落盘。 |
| `generate_image` / `create_video` / `get_video` | AI 图像/视频(Agnes/Zhipu)。 |
| `extract_pdf` / `get_pdf` / `extract_text` / `extract_table` / `describe_image` / `analyze_chart` / `list_models` / `list_vision_capabilities` | 识别/解析。 |

**结论:media-gen-mcp 没有 PPT 工具,也没有"多页 deck"概念。** 最接近的是 `generate_card`(1 页)和 `generate_interactive_diagram`(1 页 HTML)。要做 PPT = 新增"多页 + 装订成册 + 选格式落盘"的全新能力,不是现有工具的小改。

---

## 2. 四类输出格式谱:用户价值 × 实现成本

### 2.1 价值矩阵(用户视角)

| 维度 | ① 真 .pptx(原生文本框) | ② HTML 幻灯片 | ③ PDF | ④ 图片集(PNG/页) |
|---|---|---|---|---|
| **可编辑(改字/调版式)** | ✅✅ 原生文本框,PowerPoint/Keynote 直接改 | ❌ 只能改源重生(或非技术人员无法改) | ❌ 不可编辑 | ❌ 不可编辑 |
| **放映体验** | ✅ PowerPoint 全功能放映 | ✅✅ 浏览器,代码高亮/动画/交互最强 | ⚠️ 全屏 PDF 勉强能放 | ⚠️ 图片查看器最弱 |
| **分享(发给别人)** | ✅ 通用,但接收方要装 Office | ⚠️ 发链接(要部署)或单文件 HTML | ✅✅ 最通用,手机直开 | ✅ 通用,但一堆文件 |
| **可交互(代码/动画/图表)** | ❌ 无动画/无交互(pptxgenjs/python-pptx 都不支持动画) | ✅✅ 最强(Vue 组件/片段/CSS 动画) | ❌ | ❌ |
| **视觉美观上限** | 🟡 中等(文本框+简单形状,无渐变滤镜/SmartArt/动画) | 🟢 高(全 CSS,像素完美) | 🟢 高(矢量,像素完美) | 🟢 高(任意渲染) |
| **接收方零门槛** | ✅(企业标配 Office) | ❌(要懂浏览器放映) | ✅✅ | ✅ |

### 2.2 实现成本(对 media-gen-mcp,TS/Node 栈)

| 格式 | 技术路径 | 关键依赖(license) | 成本 | 说明 |
|---|---|---|---|---|
| **① 可编辑 .pptx** | `pptxgenjs` 的 `addText`/`addShape`/`addTable`/`addImage` | `pptxgenjs`(**MIT**,v4.0.1,npm) | **中** | 新增 handler + 一个工具;版式靠代码摆位(无设计画布),美观靠"模板 + 约束布局"补。**不引 Python**。 |
| ①' 图片底 .pptx | `pptxgenjs` 的 `addImage`(每页一张全页 PNG 当背景) | `pptxgenjs` + 现有 Satori/puppeteer | **低** | 复用 `generate_card` 出每页 PNG → `addImage` 装订。**这就是 Slidev/Marp/Gamma 的做法**。美但不可编辑。 |
| **② HTML 幻灯片** | (a) 自研单文件 HTML deck(复用 `interactive-html/` DNA,加分页);(b) 生成 Slidev Markdown 让用户跑 `slidev` | (a) 零新依赖;(b) 零依赖(只出 .md) | (a) 中;(b) 极低 | (a) 把 `generate_interactive_diagram` 的单 HTML 扩成多 `<section>`/键盘翻页;(b) 出 Markdown 文件,用户 `npx slidev` 自己放映。 |
| **③ PDF** | puppeteer `page.pdf()`(已用于 `render_video`/`render_svg` 的 Chrome 后端) | 已有 `puppeteer-core` | **低** | HTML deck → PDF,复用现有 Chrome 渲染基建。 |
| **④ 图片集** | N× `generate_card` 或 N× Chrome 截图 → 落盘一个目录/zip | 已有 Satori + puppeteer | **极低** | 最简产物,但"一堆 PNG"不像"PPT"。 |

**关键技术发现(本次调研最大杠杆)**:

> **`pptxgenjs`(MIT,Node 原生,Slidev 同款)既能出可编辑文本框(`addText`),也能出图片底(`addImage`)**。Slidev/Marp 的 .pptx 不可编辑**不是库的限制,是它们的页面是复杂设计画布、选择截图当背景的副作用**。media-gen-mcp 若用 `pptxgenjs`,**同一条栈、一个 format 参数**就能在"可编辑文本版"与"像素完美图片版"间切换 —— 鱼与熊掌兼得,无需两条技术线。

---

## 3. 用户场景 × 格式 矩阵(谁要什么)

| 用户原话 | 真实诉求 | 唯一正确格式 | 错配后果 |
|---|---|---|---|
| "我要在 PPT 里继续改文字" / "发给老板他会改" | **可编辑** | **① 真 .pptx(原生文本框)** | 出图片底 → 老板双击改不了字 → 产物废 |
| "我做技术分享,浏览器放映 + 代码高亮/动画" | **放映+交互** | **② HTML(Slidev/reveal/自研)** | 出 .pptx → 无代码高亮/动画 → 退化为死板文档 |
| "我发给别人看,不改" / "投屏只读" | **分享只读** | **③ PDF**(或 ④ 图片集) | 出 .pptx → 别人没装 Office / 字体漂移 |
| "我要一张美观封面/单页" | **单页美观** | **`generate_card` 已够**(无需新工具) | 出 deck → 杀鸡用牛刀 |
| "做份汇报,我不知道后续改不改" | **模糊(默认可编辑更安全)** | **① 真 .pptx(默认)+ 附 PDF** | 赌错图片底 → 改字场景失效 |

**核心洞察**:前 4 个场景每个都有**唯一**正确格式;但用户张口"做份 PPT"通常落在第 5 行(模糊)。"模糊"场景的**默认必须选可编辑 .pptx**,因为"不可编辑"是单向不可逆损失(出成图片就没法改字),而"可编辑 .pptx"在所有场景都不致命(技术分享也能用 .pptx 放,虽不如 HTML 酷;只读分享也能导 PDF)。

---

## 4. AI-PPT 核心矛盾:"美观(固定) vs 可编辑" 深挖

### 4.1 矛盾的两极(有硬证据)

| 极 | 代表 | .pptx 里是什么 | 用户能改字吗 | 视觉上限 |
|---|---|---|---|---|
| **图像派(美观固定)** | Slidev / Marp / Gamma 导出 / reveal.js 转 pptx | 每页一张全页 PNG 当 slide 背景 | ❌ **不可选不可改** | 🟢 像素完美 |
| **原生派(可编辑)** | python-pptx / `pptxgenjs` 的 `addText` | 真文本框 + 真形状 + 真图表 | ✅✅ **PowerPoint 里直接改** | 🟡 受限于代码摆位,无动画/渐变/SmartArt |

**硬证据(可核实)**:

- **Slidev**(zread 硬引 `slidevjs/slidev` doc "24-pdf-png-and-pptx-export"):"PPTX export uses `PptxGenJS`" + "Each slide's PNG becomes the **background image** of a PPTX slide (**text is not selectable**)" —— 用的是 `pptxgenjs`,但走 `addImage` 路线。同一篇 doc 明确对比表:"Slidev export quality = **Image-based, not editable**"。
- **Marp**(WebSearch 证实):PPTX 导出是 headless 浏览器逐页截图当图片,非原生元素,不可编辑。
- **Gamma**(WebSearch 证实):PPTX 导出"partially editable" —— 文本框+图片混排,但图表扁平化为图、动画丢失、交互卡扁平。商业产品也没解决这个矛盾。
- **python-pptx**(PyPI curl 证实):MIT,v1.0.2,"Create, read, and update PowerPoint 2007+ (.pptx) files" —— 原生文本框/形状/表格/图表全可编辑,但**无动画/无过渡/无 SmartArt 创建**。
- **pptxgenjs**(npm curl 证实):MIT,v4.0.1,`addText()`=原生可编辑文本框,`addShape()`=原生可编辑形状,`addImage()`=图片(不可编辑)。**三种 API 共存,取舍在调用方**。

### 4.2 矛盾是"设计选择"不是"技术铁律"

这是本次调研最重要的纠偏:

- 表面看:"HTML 渲染派"(Slidev/Marp)出 .pptx 不可编辑,"文档生成派"(python-pptx)可编辑 → 像是两条技术路线的天然属性。
- **实际**:Slidev 用的 `pptxgenjs` **本可以** `addText` 出可编辑文本框,它**选择** `addImage` 是因为 Slidev 的每页是 Vue 运行时渲染的复杂画布(代码高亮/动画/组件),没法逐元素拆解成原生文本框,只能整页截图。**这是 Slidev 的页面复杂度逼出来的选择,不是 pptxgenjs 的限制**。
- 推论:media-gen-mcp 若做 PPT,**页面简单**(标题+要点+配图,不是 Vue 画布),完全可以用 `pptxgenjs` 的 `addText`/`addShape` 出**可编辑** .pptx,视觉也够用(企业 PPT 本就以文本为主,不需要 Slidev 那种代码演示页)。

### 4.3 各开源/商业工具怎么平衡矛盾

| 工具 | 平衡策略 | 可编辑? | 启示 |
|---|---|---|---|
| **Slidev** | 选"美观+交互"极端,.pptx 导出是图片底(明确不追求可编辑) | ❌ | 定位"开发者放映工具",不抢 PowerPoint 编辑场景 |
| **Marp** | 同上,Markdown→图片底 .pptx | ❌ | 同 Slidev |
| **Gamma** | 商业折中:.pptx 半可编辑(文本框在,但图表/动画扁平) | ⚠️ 半 | 反映"既要又要"的妥协,两头不完美 |
| **python-pptx 生态(ChatPPT/AIPPT 类)** | LLM 生成 JSON 大纲 → python-pptx `add_textbox` 注入 | ✅ | **AI-PPT 的可编辑正解**:AI 出结构,python-pptx 出原生元素 |
| **doc_v12 范式 C(media-gen-mcp 已定的哲学)** | "AI 对话微调 + 重生成",不做原生编辑器 | N/A(可编辑靠 AI 改源重生) | **media-gen-mcp 原生哲学**:编辑诉求交给 Claude,不交给文件格式 |

**关键启示**:media-gen-mcp 已在 `generate_interactive_diagram` 上定了"AI 对话微调 > 原生编辑器"的哲学(doc_v12 §2)。这条哲学**对 PPT 同样适用且更强** —— 因为:
- 交互图用户可能接受"重生成",但 PPT 用户**强烈期望在 PowerPoint 里手改字**(品类心智)。
- 所以 PPT 的"可编辑"必须**双轨**:① 文件本身原生可编辑(兜底线,满足品类心智);② AI 对话微调(增效线,doc_v12 范式 C)。两者不互斥,叠加最稳。

---

## 5. 对 media-gen-mcp 的推荐

### 5.1 一句话回答

> 用户说"做份 PPT",media-gen-mcp **该出可编辑 .pptx(默认),并提供 HTML/PDF/图片集可选**。即:**多格式,默认可编辑 .pptx**。

### 5.2 推荐的 format 参数设计

```
generate_presentation({
  slides: [{title, bullets, image?, layout?}, ...],
  format: "editable-pptx" | "image-pptx" | "html" | "pdf" | "images",  // 默认 "editable-pptx"
  theme: "modern_blue" | ...,
})
```

| format 值 | 实现 | 适用场景(回扣 §3) |
|---|---|---|
| **`editable-pptx`(默认)** | `pptxgenjs` `addText`/`addShape`/`addTable` + 简单版式模板 | "我要改字" / "发给老板" / "模糊场景" |
| `image-pptx` | N× Satori 出 PNG → `pptxgenjs` `addImage` 装订 | "要美观,不改" + 仍要 .pptx 外壳(可嵌 PPT) |
| `html` | 复用 `interactive-html/` DNA 扩成多页单文件(或出 Slidev Markdown) | "技术分享,浏览器放映+代码高亮" |
| `pdf` | HTML deck → puppeteer `page.pdf()` | "发给别人只读" |
| `images` | N× `generate_card` 落盘一个目录 | "每页一张图,最简分享" |

**为什么不默认图片底**:图片底在"我要改字"场景**单向不可逆失效**,而可编辑 .pptx 在所有场景都不致命。默认必须选"失败成本最低"的格式。

### 5.3 立场红线检查(沿用 doc_v12 / MEMORY 的 media-gen-mcp 定力)

| 红线 | editable-pptx 路径 | image-pptx 路径 | 评估 |
|---|---|---|---|
| "所有图像操作归一个 MCP" | ⚠️ **越界**:这是文档生成,不是图像生成 | ✅ turf 内(N× 图像装订) | editable-pptx 是定位扩张,需用户拍板 |
| 单文件自包含 / 可入 git | ⚠️ .pptx 是二进制 zip,不易 diff(但可入 git) | ⚠️ 同 | 可接受(比 .docx 好) |
| 纯免费(MIT/Apache) | ✅ `pptxgenjs` MIT | ✅ 全复用已有 | 守 |
| 同输入同输出 | ✅(布局确定) | ✅(Satori 确定) | 守 |
| 向后兼容 / inputSchema 不破坏 | 新增工具,不碰旧 20 工具 | 同 | 守 |

### 5.4 三档落地路径(按越界程度排,供用户选)

**Path A — 不做(最保守,推荐先确认定位)**
- media-gen-mcp 不碰 PPT。"做份 PPT" 路由到环境里已有的 `mcp__ppt__`(python-pptx,32 工具,原生可编辑)或外部 Slidev/Gamma。
- 理由:doc_v12 §2 已定"不自研编辑器,版图边缘不扩张";PPTX 文档生成比"交互 HTML 图"更远离"图像操作"核心。
- 代价:用户要在两个 MCP 间切换;`generate_card` 只能出单页。

**Path B — 图像版 MVP(turf 内,低成本)**
- 只做 `image-pptx` + `images` 两个 format:N× `generate_card`/Satori 出每页 PNG → `pptxgenjs.addImage` 装订成 .pptx(或直接出图片目录)。
- 成本:**~1.5 人日**(复用 `generate_card` 全套基建 + `pptxgenjs` 一个装订 handler)。
- 满足场景:美观分享 / 只读汇报。**不满足**"我要改字"(明确写在 README FAQ,导流到 `mcp__ppt__` 或 PowerPoint)。
- 契合 doc_v12 哲学:美观固定 + AI 对话微调(改大纲重生),不碰原生编辑。

**Path C — 全格式(跨界,完整体验)**
- 五个 format 全做,默认 `editable-pptx`。
- 成本:**~4-6 人日**(`pptxgenjs` 版式模板系统 + HTML deck 多页 + PDF + 图片 + 测试)。`pptxgenjs` 原生文本框版式要做 3-5 套模板(标题页/要点页/图文页/图表页/结尾页)才够看。
- 风险:① 越界进文档生成(定位漂移,需用户确认);② 原生文本框美观上限低,可能被拿来和 Gamma 比"不够好看" —— 需 README 诚实声明"可编辑 .pptx 牺牲极致美观换可编辑"。
- 收益:一句话"做份 PPT"全场景闭环,是 media-gen-mcp 从"图像 MCP"升级"内容产物 MCP"的关键一步。

### 5.5 我的倾向(供主控参考,非裁决)

**推荐 Path B(图像版 MVP)先行,把"是否做 Path C"作为定位决策抛给用户**,理由:

1. Path B 守住 media-gen-mcp "图像 MCP" 定位(doc_v12 红线),不漂移。
2. Path B 复用 `generate_card` 全套 Satori 基建(已 200+ 场景测过),增量极小。
3. "可编辑 .pptx"已有 `mcp__ppt__`(同环境的 python-pptx MCP)覆盖,media-gen-mcp 不必重复造轮子 —— 这正是 doc_v12 "drawio 能做的不重造"的同款逻辑(此处换成"python-pptx MCP 能做的不重造")。
4. 若用户实测 Path B 后,"改字"诉求强烈且 `mcp__ppt__` 体验不够,再升级 Path C,有数据支撑。

**但若用户明确"media-gen-mcp 就要一句话出可编辑 PPT,不依赖外部 MCP"**,则直接 Path C,默认 `editable-pptx`,技术路径已验证(`pptxgenjs` MIT 可编辑),无阻塞。

---

## 6. 证据索引(可核实)

### 6.1 media-gen-mcp 现状(本地源码)
- 工具注册:`media-gen-mcp/src/index.ts`(grep `name: "..."` 得 20 工具,无 ppt/slide/presentation)。
- 单页近邻:`src/card.ts`(Satori 出卡)、`src/interactive-html/`(8 文件,D2→单文件 HTML)。
- Chrome 渲染基建:`src/render-svg.ts` / `src/render-video.ts`(puppeteer-core 已在)。

### 6.2 格式技术栈(外部,license 实证)
- **python-pptx**:MIT,v1.0.2,`curl https://pypi.org/pypi/python-pptx/json` → `license: MIT`,`summary: Create, read, and update PowerPoint 2007+ (.pptx) files`。原生文本框/形状/表格/图表可编辑;**无动画/无过渡/无 SmartArt 创建**。
- **pptxgenjs**:MIT,v4.0.1,`curl https://registry.npmjs.org/pptxgenjs/latest` → `license: MIT`。`addText()`=原生可编辑文本框,`addShape()`=原生可编辑形状,`addImage()`=图片底。**Node 原生,media-gen-mcp 可直接引**。
- **Slidev**:MIT(`@slidev/parser` license 实证)。PPTX 导出用 `PptxGenJS` 但走 `addImage`(图片底,文字不可选)—— zread `slidevjs/slidev` doc "24-pdf-png-and-pptx-export" 原文。
- **Marp**:MIT(`@marp-team/marp`)。PPTX 导出 = headless 截图当图片,不可编辑。
- **reveal.js**:MIT。**无原生 PPTX 导出**(需 decktape 等第三方,且也是图)。
- **officegen**:MIT,Node 备选 pptx 库(较老,pptxgenjs 更主流)。

### 6.3 AI-PPT 产品(外部)
- **Gamma**:`gamma.app/help`。.pptx 导出"半可编辑":文本框在,但图表扁平化为图、动画丢失、交互卡扁平(WebSearch 证实)。
- **ChatPPT/AIPPT 类**:LLM 生成 JSON 大纲 → python-pptx `add_textbox` 注入原生文本(可编辑正解),GitHub 多个社区实现。

### 6.4 doc_v12 已定哲学(本地,直接继承)
- `doc_v12/收口决策.md` §2 四条:generate_interactive_diagram = 轻量查看器;拖拽编辑器不碰;"快速改"的唯一增强线 = AI 自然语言微调;README 嵌入非功能目标。
- `doc_v12/快速生成-快速微调工作流范式调研.md` §0:范式 C(AI 对话微调)是 MCP 原生杀手锏,范式 B(视觉拖拽编辑器)ROI 极差不做。**对 PPT 同构适用**。

### 6.5 已有 MCP(同环境,非 media-gen-mcp)
- `mcp__ppt__`:`get_server_info` → "PowerPoint MCP Server - Enhanced Edition v2.1.0",32 工具,python-pptx 系,原生可编辑 PPTX,无动画(transition 仅 placeholder)。**若 media-gen-mcp 不做 PPT,用户可走此 MCP**。

---

## 7. 开放问题

1. **定位决策(最高优先)**:media-gen-mcp 是否从"图像 MCP"扩张到"文档/内容产物 MCP"?Path B(图像版)守界,Path C(可编辑 .pptx)越界。**这是用户拍板项,不是技术项** —— 需抛给用户,本报告不替其裁决。
2. **`pptxgenjs` 原生文本框的美观上限够不够**:企业 PPT 常见"大图+少字+渐变背景"设计风,`addText`+`addShape` 能做到几成?需做 3-5 套版式模板 spike 验证(若做完发现"丑到被吐槽",Path C 的默认就要重新考虑)。
3. **HTML deck 多页形态选择**:Path C 的 `html` format 是(a)自研单文件多页 HTML(复用 `interactive-html/`,加键盘翻页/分页 `<section>`),还是(b)出 Slidev Markdown 让用户 `npx slidev`?(a)零依赖但要写 deck viewer;(b)零代码但要用户装 Node + slidev。倾向 (a)(守单文件自包含立场)。
4. **`.pptx` 二进制 vs git 友好**:.pptx 是 zip,入 git 不可读 diff。是否额外落盘一份"源"(slides JSON 大纲)入 git,把 .pptx 当 derived?与 doc_v12 "DSL 是 source of truth,HTML 是 derived"同构。
5. **与 `mcp__ppt__` 的关系**:若 media-gen-mcp 做 Path C 的 editable-pptx,是否与同环境的 python-pptx MCP 功能重叠?是否该让 media-gen-mcp 的 PPT 工具在 description 里 NEXT 句导流到 `mcp__ppt__` 做"精细编辑",自己只做"一句话快速生成"?(分工:media-gen-mcp 出初稿,`mcp__ppt__` 改细节。)
6. **中文/CJK 字体在 .pptx 的嵌入**:`pptxgenjs` 出 .pptx 时中文若不嵌字体会依赖接收方系统字体,跨机器字体漂移。是否预置 CJK 字体回退(类似 `generate_card` 的 Noto Sans SC)?需 spike。
7. **"做份 PPT" 的意图探测**:能否从 prompt 探测场景(出现"代码高亮/动画"→ 默认 html;出现"发给客户/不改"→ 默认 pdf;否则默认 editable-pptx)?还是老老实实让用户/Claude 选 format?倾向后者(探测易误判,format 参数显式更稳)。
