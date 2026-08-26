# OSS 竞品与选型矩阵(PPT 生成 · 支撑文档)

> **角色**:支撑 `PPT生成工具-功能架构报告.md` 的选型决策。所有 license/能力/活跃度均**源码 + registry 实证**(非 AI 摘要谣传)。
> **生成日期**:2026-07-23
> **立场红线**:纯 MIT/Apache 优先;GPL/AGPL/SSPL/伪开源点名 + 给 MIT 替代。

---

## 一、PPTX 库选型矩阵(若 TIER 2b 落地)

### 1.1 能力矩阵

| 维度 | **pptxgenjs 4.0.1** | python-pptx 1.0.2 | officegen 0.6.5 | react-pptx 2.20.1 |
|---|---|---|---|---|
| 语言/生态 | **JS/TS(ESM+CJS)** | Python(>=3.8) | JS | JS(React 组件) |
| License | **MIT**(deps 全 MIT) | **MIT** | MIT | MIT |
| 维护活跃度 | 活跃(v4.0.1) | 活跃(v1.0.2) | **停滞**(最后 2022-06) | 活跃 |
| 真 PPTX(可编辑) | ✅ OOXML 原生 | ✅ OOXML 原生 | ✅ | ✅ |
| 文本/形状/表格/图片 | ✅ 全(70+ 形状) | ✅ 全 | 部分 | ✅ |
| **Chart = 原生 OfficeChart** | ✅(嵌 XLSX,可编辑) | ✅(原生) | 有限 | ✅ |
| 嵌入 PNG/JPG | ✅ path/data/URL | ✅ | ✅ | ✅ |
| **嵌入 SVG(Node)** | ❌ **IMG_BROKEN** | ⚠️ 间接(需转图) | ❌ | ❌ |
| 母版/版式 | ✅ defineSlideMaster(**创建**非读模板) | ✅(**可读已有模板**) | 弱 | ✅ |
| 备注页/Notes | ✅ | ✅ | ❌ | ✅ |
| 动画 | ❌(OOXML 动画不暴露 API) | ❌ | ❌ | ❌ |
| 音视频 | ✅ | 仅图片 | ❌ | ✅ |
| HTML table → slides | ✅ `tableToSlides` | ❌ | ❌ | ❌ |
| Node 进程内运行 | ✅ **同进程纯 JS** | ❌ 需 child_process / Python sidecar | ✅ | ✅ |
| npm 体积 | 2.6 MB(unpacked) | N/A(PyPI) | 小 | 小 |
| **与 media-gen-mcp 栈契合** | **完美**(Node>=18/ESM/MIT) | **差**(Python 运行时依赖) | 中 | 中(React 风格非命令式) |

### 1.2 关键技术事实(源码级核实,纠正 AI 摘要错误)

#### pptxgenjs(gitbrent/PptxGenJS)
- **License**:MIT(`LICENSE` 文件原文核实,Copyright 2015-2022 Brent Ely)。
- **版本/体积**:npm `pptxgenjs@4.0.1`,`dist.unpackedSize = 2,605,307` 字节 ≈ **2.6 MB**(含类型 + sourcemap);运行时仅 4 dep(@types/node/https/image-size/jszip,**全 MIT**,无 GPL/SSPL 污染)。
- **运行环境**:ESM(`dist/pptxgen.es.js`)+ CJS 双构建,`browser` 字段 stub 掉 fs/https/path——**Node 与浏览器双跑,纯 JS 无原生依赖,可在 MCP/Node 进程内跑**。
- **输出兼容**:OOXML 标准合规,PowerPoint / Keynote / LibreOffice Impress / Google Slides(导入)可打开编辑。

#### python-pptx(scanny/python-pptx)
- **License**:MIT(`LICENSE` 原文核实,Copyright 2013 Steve Canny)。PyPI `python-pptx 1.0.2`,`requires_python >=3.8`。
- **超能力**:`Presentation('template.pptx')` 能**读取/修改已存在的 .pptx**(含 slide_masters/slide_layouts/placeholders)——这是它相对 pptxgenjs 的独占优势(pptxgenjs 只能「创建」不能「读」)。
- **整合成本红线**:Node 进程要 `child_process.spawn('python', ...)` 或起 Python sidecar,带来 (a) Python 运行时部署依赖 (b) 跨进程序列化/错误传递 (c) MCP 单进程纯 Node 立场破裂 (d) 跨平台打包复杂度。与 media-gen-mcp 现有「同进程纯 JS 库」架构(d2/vega/mathjax/satori/resvg 全 WASM 或 JS)相悖。

### 1.3 三大能力点核实(读源码验证)

#### chart 是真 OfficeChart 还是图片?→ **真原生可编辑 Office Chart**
读 `src/gen-charts.ts`:`createExcelWorksheet(chartObject, zip)` 用 JSZip 生成真实 `.xlsx`(含 `xl/worksheets`、`xl/theme`、`xl/tables`),嵌入 `ppt/embeddings/`,并产出 `c:chart` OOXML。**PowerPoint 双击可编辑数据/类型/样式的原生图表,非贴图**。
- 支持类型(core-enums 实测):`area / bar / bubble / doughnut / line / pie / radar / scatter` + **多类型 combo**(多 series 不同类型同图),带 axis/legend/dataLabels/gridlines 全套样式。

#### SVG 能否直接嵌入?→ **Node 环境 = 不支持(源码硬证据,与 AI 摘要矛盾)**
读 `src/gen-media.ts` STEP 5 / `createSvgPngPreview`:
- **浏览器路径**:SVG 经 `Image() + canvas.drawImage + toDataURL` 光栅化成 PNG 预览后嵌入(仍非矢量 SVG)。
- **Node 路径**:`if (isNode && fs) { rel.data = IMG_BROKEN }`——**直接返回坏图占位**。源码注释还留着 `// console.log('Sorry, SVG is not supported in Node ...')`。
- **AI 摘要谎称「Issue #963 已于 2025-10 关闭,Node SVG 取得重大进展」—— master 源码仍返回 IMG_BROKEN,该说法不可信**(可能指未合入的 PR 或 issue 状态变更,非代码事实)。
- README 宣称的「Supports SVGs」**仅对浏览器生效**。

#### 对 media-gen-mcp 的 SVG 闭环 → **已被现有工具覆盖,不构成阻塞**
media-gen-mcp 已有 `render_svg`(`@resvg/resvg-js` 92% 滤镜保真 + `puppeteer-core` Chrome 100% 保真)可**预光栅化 SVG→PNG**,再以 `addImage({ data: 'base64...' })` 嵌入。即 generate_chart/generate_diagram/generate_card/generate_formula/generate_icon/generate_qrcode 产出的 SVG,先经 render_svg 转 PNG 再进 PPT——**闭环成立且零新依赖**。这条「先光栅化再嵌图」工艺是 **media-gen-mcp 独占优势**(别的 pptxgenjs 用户没有,因其浏览器光栅化在 Node 用不了)。

### 1.4 选型推荐

**media-gen-mcp(Node/TS)首选 pptxgenjs**(若 TIER 2b 落地):
1. **同生态零摩擦**:Node>=18 + ESM 栈下 ESM 构建直接可用,纯 JS 在 MCP 进程内跑,无 child_process、无 Python 运行时依赖——守「纯 Node MCP server」立场。
2. **License 干净**:MIT + 依赖全 MIT。
3. **真 PPTX 可编辑**:OOXML 原生文本/形状/表格 + 原生 Office Chart。
4. **SVG 缺口已被 media-gen-mcp 现有能力闭环**。
5. **MCP 形态友好**:`writeFile({ fileName })` 直出 .pptx 到 outDir,与现有工具的 outDir/name/download 契约一致。

**python-pptx 不做主引擎**(尽管模板能力更强):仅当未来出现「必须套用客户预设计企业 .pptx 模板」强需求时,挂能力自省标志(Python 缺失=feature off,复用 pares6 范式)。**注意:同环境 sibling `mcp__ppt__` 已是 python-pptx 系,走 Python PPTX 路径直接 Claude 编排调它,不在 media-gen-mcp 进程内重复引入**。

**react-pptx 备用**:声明式 JSX→pptx 适合「幻灯片树描述→PPT」声明式 API,仅当未来升级到声明式幻灯片树时参考,不阻塞当前选型。**officegen 事实停滞不选**。

---

## 二、Markdown 幻灯片框架矩阵(Slidev / Marp / reveal.js)

### 2.1 三工具能力矩阵(MIT 全绿,源码级核实)

| 维度 | **Slidev**(slidevjs/slidev) | **Marp**(marp-team/marp-cli) | **reveal.js**(hakimel/reveal.js) |
|---|---|---|---|
| 输入 | Markdown(`---` 分页 + frontmatter) | Markdown(Marpit 指令) | HTML 为主,MD 经 plugin |
| 输出格式 | PDF / **PPTX** / PNG / SPA(HTML) / MD | HTML / PDF / **PPTX** / PNG / JPEG | HTML / **PDF**(print CSS 或 decktape)/ **无原生 PPTX** |
| **PPTX 真假(核实)** | **纯图片** | **默认纯图片** + 实验性 editable | **无 PPTX 导出** |
| 图/表/diagram 嵌入 | 最强:Mermaid/PlantUML/LaTeX/Vue 组件 | `![](url)` + MathJax/KaTeX,无原生图表渲染器 | `<img>`/`<iframe>` + MathJax/KaTeX/highlight.js |
| 版式 | 14+ 内置 layout + 主题市场 | 主题=纯 CSS(Marpit) | SCSS 主题(11 内置) |
| headless/CLI 可程序化 | `slidev export`,需 playwright-chromium(programmatic 但重) | **最 CLI-first**:`marp in.md --pdf/--pptx`,standalone binary,parallel,server,watch | 无官方 CLI;PDF 靠 decktape(3rd,Puppeteer) |
| license | MIT(v52.16.0) | MIT(v4.5.0) | MIT(v6.0.1) |
| 依赖体重 | **最重**:Vite+Vue3+Playwright+Shiki+mermaid+katex+UnoCSS,Node>=20.12 | **中**:marpit+puppeteer-core+ws+tmp+chokidar+cosmiconfig+serve-index(8 runtime dep) | **最轻**:零 runtime deps |
| AI 友好度 | 官方 AI skill(`npx skills add slidevjs/slidev`) | 无官方 skill,纯 MD 对 LLM 最省 token | HTML 输入,token 高 |

### 2.2 PPTX 导出真假核实(可复现证据)

- **Slidev**:`docs/guide/exporting.md` 原文 →「all the slides in the PPTX file will be exported as images, so the text will not be selectable. Presenter notes will be conveyed into the PPTX file on a per-slide basis.」(走 `slidev export --format pptx`,底层 Playwright 截图)。**= 图**
- **Marp 默认**:`src/converter.ts` `convertFileToPPTX` → `imageFiles.forEach`: `slide.background = { data: 'data:image/png;base64,'+... }`(Puppeteer 截 PNG → pptxgenjs 背景)。**= 图**
- **Marp editable**:`convertFileToEditablePPTX` → 先 `convertFileToPDF` 再 `soffice --headless --convert-to pptx:Impress Office Open XML`,代码 `warn('[EXPERIMENTAL] ... output depends on LibreOffice and slide reproducibility is not fully guaranteed.')`。**= 真文本(实验性,需外部 LibreOffice)**
- **reveal.js**:`package.json` exports 无 pptxgenjs;`css/print/pdf.scss` 仅打印样式。**= 无 PPTX**

### 2.3 结论:不引作依赖

**三者都违 P0「0 新增 runtime dep」立场**。Slidev/Marp 的 PPTX 默认都是「浏览器渲染→截图→pptxgenjs addImage 背景」= 纯图。

**关键纠偏**:「PPTX 默认是图」是 **Slidev/Marp 的设计选择**(Vue/HTML 画布无法逐元素拆成原生文本框),**非 pptxgenjs 限制**——pptxgenjs 本可以 `addText` 出可编辑文本框。media-gen-mcp slide 结构简单(标题+要点+配图),完全可走 addText 出可编辑 .pptx(若走 TIER 2b 越界路径,但本报告推荐不越界,此能力归 ppt MCP)。

### 2.4 可借鉴(只学范式不引依赖)

- **Marpit 确定性渲染思想**:marpit = markdown-it 插件,MD→HTML 纯确定性零 AI,与 media-gen-mcp「确定性优先/golden byte-compare/产物守门」哲学同构。但 media-gen-mcp 前端是 Claude(LLM),让 Claude 出结构化 JSON outline 比出 MD 再解析**省 token ~10x**——MD 框架对 MCP 是多余的中间表示。Marpit 的 **themes-as-CSS 换主题范式**可借鉴到 slide 主题系统。
- **Marp 双 PPTX 策略**(image-default 保真 + LibreOffice-editable 可编辑,后者条件展开打 [EXPERIMENTAL] 警告)——直接映射 media-gen-mcp 条件展开哲学(P0-2/P0-5A 三杠杆)。
- **Slidev 官方 AI skill 范式**(skills/SKILL.md + references/*.md)——把「工具怎么用」做成 agent 可加载的 skill 文档,正是 media-gen-mcp P0-1 的升级形态;**TIER 1 的 PPT skill 正是此范式**。

---

## 三、AI-PPT 仓库全景(2026-07-23 GitHub 实测)

### 3.1 候选清单(7 个真实 AI-PPT 项目 + MCP-PPT 空白佐证)

| 项目 | star | license | 形态 | 核心管线 | 素材引擎 |
|---|---|---|---|---|---|
| **hugohe3/ppt-master** | **40,542★** | **MIT** ✓ | Claude skill(Python) | 源文档→MD→Strategist 规划→LLM 手绘 svg_output→svg_to_pptx.py 映射 DrawingML→原生可编辑 PPTX | image_gen.py(gpt-image-2/gemini,**付费**)+ image_search.py(Pexels/Pixabay/Openverse,license-aware) |
| Anionex/banana-slides | 15,216★ | **AGPL-3.0** ⚠️ | Flask+React+SQLite web | idea/outline→nano banana pro 整页出图→pptx_builder→PPTX(图稳/可编辑 Beta)/PDF/视频 | 几乎全靠付费 nano banana pro |
| allweonedev/presentation-ai | 2,898★ | **MIT** ✓ | Next.js+PostgreSQL | topic→outline-first(可编辑)→38 主题→AI 生成 | Together AI/FAL/Unsplash(**付费**)+ Tavily |
| arcsin1/oh-my-ppt | 1,774★ | **Apache-2.0** ✓(纠偏:非 inv 所说 MIT) | Electron 桌面 | HTML-first(浏览器即预览),PPTX 是导出副产物 | Anime.js,Ollama 本地 |
| veasion/AiPPT(文多多) | 1,899★ | **伪开源** ⚠️ | demo+SaaS | GitHub 是 PPT↔JSON demo,真 AI 生成在 docmee.cn 商业 SaaS 闭源 | 闭源 |
| SmartSchoolAI/ai-to-pptx | 1,459★ | **GPL-3.0** ⚠️ | Vue+PHP | DeepSeek 大纲→模板填充 | 多功能锁「商业版」,4 套免费模板 |
| **MCP-PPT 系列**(<100★) | 91/66/47/35 | MIT | MCP 薄壳 | slidev-mcp/mcp-ppt/ppt-mcp/pptx-mcp 全是 python-pptx/slidev 薄壳 | **无一个自带素材引擎** |

### 3.2 三条核心结论

1. **素材引擎是全行业短板**:头部项目要么 LLM 手绘 SVG(ppt-master,token 贵易错),要么付费图模型整页出图(banana/presentation-ai),要么模板填充。**没有一个自带「免费 + 确定性 + 多模态」素材引擎**。
2. **MCP 形态是空白**:头部项目全是 skill/app/web,**没一个是 MCP server**;MCP-PPT 全是 <100★ python-pptx 薄壳。
3. **license 是雷区**:商用安全仅 ppt-master/presentation-ai/oh-my-ppt(均 MIT/Apache);banana=AGPL、ai-to-pptx=GPL、veasion=伪开源。

### 3.3 media-gen-mcp 差异化(自带素材引擎)

| 行业短板 | media-gen-mcp 补法 |
|---|---|
| 付费 AI 生图依赖 | 自带 Agnes+智谱 cogview/cogvideox **永久免费层** |
| 无确定性图表引擎 | 自带 **Vega-Lite v5(内置 WASM)** generate_chart |
| 无确定性图引擎 | 自带 **D2+Graphviz(内置 WASM)** generate_diagram + generate_interactive_diagram |
| 非 MCP 形态 | **本身就是 MCP server**,Claude 一句话直调 20 工具 |
| license 不干净 | **纯 MIT**(D2=MPL-2.0/puppeteer-core=Apache/resvg=MPL-2.0 均商用友好) |
| 部署重 | `npx` 一行装,零 Key 出第一张图 |

**但护城河属「素材引擎」定位,不属「PPTX 组装」**——守住前者即守住差异化;重组装会陷入 ppt-master/banana 同质化红海 + license 雷区。

### 3.4 可借鉴范式(只学设计,不抄 GPL/AGPL 代码)

1. **outline→素材→组装 三段式**(所有头部项目共性)。
2. **中间表示→目标格式**(ppt-master canonical SVG→DrawingML):避免每页 LLM 现场手绘,media-gen-mcp 的 `generate_interactive_diagram`(D2→HTML)已是同类范式。
3. **license-aware 素材路由 + fallback**(ppt-master image_search 的 CC 路由;media-gen-mcp P0 已实现 agnes/zhipu fallback)。
4. **BLOCKING 质量门 + spec_lock 防 LLM 漂移**(ppt-master)→ 对应 media-gen-mcp P0-4 assertOutputClean。
5. **template + content_mapping 范式**(presentation-ai 38 主题/oh-my-ppt 30 风格)→ generate_card 的 5 template 可扩展。
6. **诚实标注可编辑性边界**(ppt-master svg_output 可编辑源 vs svg_final 预览)。

### 3.5 NO-GO 名单(license/活跃度雷区,源码+registry 实证)

| 项目 | 问题 | 处置 |
|---|---|---|
| banana-slides | **AGPL-3.0**(GNU AFFERO 原文核实,网络传染性) | **绝不 import 代码**;只学设计范式 |
| ai-to-pptx | **GPL-3.0**(商用须授权) | **绝不 import**;只学设计范式 |
| veasion/AiPPT(文多多) | **伪开源**(GitHub demo + docmee.cn 商业 SaaS 闭源核心) | 避免 |
| officegen | npm **事实停滞**(最后 2021-03-06,比 AI 摘要宣称的 2022 更老) | 不选 |
| Browserless | **SSPL 陷阱**(v2 商业须购 license) | 任何「浏览器渲染」路线若依赖须点名 |

**组装层若做(TIER 2b),license 雷区必须 reimplement**——pptxgenjs(MIT)是干净选型,无须 reimplement;但任何借鉴 banana/ai-to-pptx 的设计必须重新实现不能 import。

---

## 四、原生 chart vs 烤制 chart 双轨(非冗余)

| 维度 | ppt MCP `add_chart`(原生) | media-gen-mcp `generate_chart`(烤制) |
|---|---|---|
| 引擎 | python-pptx 原生 chart / pptxgenjs createExcelWorksheet 嵌 XLSX + c:chart OOXML | Vega-Lite v5(内置 WASM) |
| 可编辑性 | **PowerPoint 双击改数/改型/改样式** | 死图,不可改 |
| 视觉精致度 | 中(样式偏素) | **高**(Vega-Lite 美学) |
| 图类 | area/bar/bubble/doughnut/line/pie/radar/scatter + combo | 柱/折线/面积/散点/饼/环 |
| 适用场景 | 客户要改数 → **走这条** | 终稿展示视觉极致 → **走这条** |

**Claude 按场景选**:同概念两种价值,**无法互替**。skill 第二问规则化(「客户要改数→原生;终稿展示→烤制」)。

---

## 五、立场红线总核查

| 依赖/项目 | license | 是否引入 | 理由 |
|---|---|---|---|
| pptxgenjs(仅 TIER 2b 可选) | MIT | 可选(addImage 装订) | 唯一契合 Node/ESM 栈的真 PPTX 引擎 |
| python-pptx | MIT | 不进 media-gen-mcp 进程 | 走 sibling ppt MCP,Claude 编排 |
| Slidev/Marp/reveal.js | MIT | **不引** | 违 0 新增 runtime dep 立场;PPTX 默认是图 |
| ppt-master | MIT | 只学范式 | 设计借鉴(三段式/质量门) |
| banana-slides | **AGPL-3.0** | **NO-GO** | 网络传染性,绝不 import |
| ai-to-pptx | **GPL-3.0** | **NO-GO** | 商用须授权,绝不 import |
| veasion/AiPPT | 伪开源 | 避免 | demo 引流 + 核心闭源 |
| officegen | MIT 但停滞 | 不选 | 2021 后无更新 |
| Browserless | **SSPL** | 点名 | v2 商业须购 license |

---

## 六、证据索引(可核实)

- npm:`curl https://registry.npmjs.org/pptxgenjs/latest` → MIT v4.0.1,unpackedSize 2.6MB;`npm view officegen` → 最后修改 2022-06-22(停滞)。
- PyPI:`curl https://pypi.org/pypi/python-pptx/json` → MIT v1.0.2,requires_python>=3.8。
- GitHub(zread 源码核实):
  - gitbrent/PptxGenJS `src/gen-media.ts` STEP 5(createSvgPngPreview,Node SVG→IMG_BROKEN)、`src/gen-charts.ts`(createExcelWorksheet,原生 OfficeChart)。
  - slidevjs/slidev `docs/guide/exporting.md`(PPTX 纯图原文)。
  - marp-team/marp-cli `src/converter.ts`(convertFileToPPTX/convertFileToEditablePPTX)。
  - hugohe3/ppt-master `skills/ppt-master/SKILL.md`、`workflows/generate-pptx.md`(40.5k★ MIT,Core Pipeline)。
  - Anionex/banana-slides LICENSE(AGPL-3.0 原文)、`backend/services/`、`utils/pptx_builder.py`。
  - arcsin1/oh-my-ppt LICENSE(**Apache-2.0**,纠偏 inv 所说 MIT)。
  - SmartSchoolAI/ai-to-pptx LICENSE(GPL-3.0 原文)。
- 本地:`/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/src/card.ts:543-544,657-665,683-714`、`src/index.ts`(20 工具,grep pptx 全 0)。
