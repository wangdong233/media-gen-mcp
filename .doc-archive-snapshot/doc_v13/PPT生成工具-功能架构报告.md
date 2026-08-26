# PPT 生成工具 · 功能架构决策报告

> **一句话结论**:media-gen-mcp **不自建 PPTX 文档组装层**。走「**media-gen-mcp 素材引擎 + Claude 编排 + 既有 ppt MCP 组装**」互补三明治,零新代码起步(TIER 1 = PPT skill 引导层),覆盖 ~80% 场景、0% 越界风险;仅当实战证明 skill 不够时才回退 TIER 2b(pptxgenjs **仅限 addImage 图片底装订**)。全格式 `generate_ppt` 大工具明确否决。
>
> **生成日期**:2026-07-23
> **角色**:总撰稿人(综合 6 份调查 + 4 维度分析)
> **用户诉求复述**:把 media-gen-mcp 已有的生图/生卡/生图/生图表能力,整合成一个「PPT 生成工具」;须回答——做不做、做哪档、怎么编排、与同环境已有的 `ppt` MCP 是什么关系。
> **立场红线**:纯免费(MIT/Apache 优先,可商用)、MCP server 形态、Claude 一句话驱动。任何 GPL/AGPL/SSPL/商业依赖必须点名 + 给替代。

---

## 0. 阅读导航(三份报告分工)

| 文件 | 角色 | 何时读 |
|---|---|---|
| **本文件**(PPT生成工具-功能架构报告.md) | **决策导向主报告** | 先读,读完能判断「做不做、做哪档」 |
| `OSS竞品与选型矩阵.md` | 支撑:license/能力/契合实证 | 选型决策时查证 |
| `架构选项与编排工作流.md` | 支撑:可执行方案 + 5 阶段工作流 | 决定开做后照此执行 |
| `00-AI-PPT开源仓库架构调研.md`(已存在) | 支撑:AI-PPT 行业全景 | 评估差异化护城河时查 |
| `PPT输出格式与用户期望UX调研.md`(已存在) | 支撑:四格式 × 用户价值矩阵 | 评估输出格式路由时查 |

---

## 1. 一句话裁决(决策者速读)

**做,但只做 TIER 1(零新代码 PPT skill),不做 PPTX 组装。**

- **编排**:Claude 编排(每 slide 显式 tool call)+ PPT skill 引导(纯 markdown 操作手册)。否决 `generate_ppt` 大工具。
- **与 ppt MCP 关系**:**(c) 互补分工**——media-gen-mcp = 素材叶子引擎(产 PNG/SVG/MP4/HTML),ppt MCP = PPTX 容器 + 原生可编辑元素 + 模板/主题,Claude 是唯一跨 MCP 编排者。否决 (a) 内部整合、(b) 差异化自建 PPTX。
- **输出格式**:不在 media-gen-mcp 引擎层硬编码默认;格式路由下沉到 skill 按意图判定(改字→ppt MCP save_presentation / 分享→PDF 或图集 / 技术放映→HTML)。
- **工时**:TIER 1 = **0.5–1 人日**(零新代码,立即可用);TIER 2b(可选回退)= 2–3 人日;TIER 3(全格式大工具,否决)= 6–10 人日。

**为何这是正解(三力合力,非单一论证)**:
1. **§4 精神(防再漂移)**:doc_v12/收口决策.md §4 原文「新增能力须通过『是否仍是图像/产物生成(而非交互应用开发)』的检验」。PPT 多页 deck 组装(版式/母版/坐标定位/deck 级主题)已偏离「图像/产物生成」核心身份——详见 §7 的 spirit-vs-literal 诚实核。
2. **重造轮子(独立于 §4)**:同环境已有可用 `ppt` MCP(python-pptx 系,32 工具,本会话实测),media-gen-mcp 当前零 PPTX 代码(`grep -rci "pptx\|python-pptx\|powerpoint\|slidev\|marp\|reveal" src/` 全 0 命中,已核实)。自建 = 从零重造一个 working MCP 的核心轮子。
3. **互补零成本(机会成本)**:两者能力集几近不相交(生产者 vs 消费者、烤制美图 vs 原生可编辑图表),互补三明治 captured ~90% 价值、0% 风险。自建只有「单 MCP 全包」的体验优势,代价是 6+ 人日 + 范围蔓延。

---

## 2. 现状:media-gen-mcp 已能生成的全部 PPT 素材 + 缺的层

### 2.1 已有能力:幻灯片视觉素材全覆盖(20 工具,v0.12.1,MIT)

media-gen-mcp 能生成幻灯片所需的**全部视觉素材**,但**一个 PPTX 都不产**——产物全是 PNG/SVG/MP4/HTML 单品(叶子素材,非容器文档)。

| # | 幻灯片场景 | 首选工具 | 产物 | 可编辑性 | 关键源码/事实 |
|---|---|---|---|---|---|
| 1 | 封面/hero | `generate_card`(template=hero) | SVG/PNG | **烤制不可编辑** | width/height 完全可配,传 1920×1080 即 16:9 slide 尺寸 |
| 2 | 章节分隔 | `generate_card`(template=minimal) | SVG/PNG | 烤制 | 5 模板之一 |
| 3 | 金句/引言 | `generate_card`(template=quote) | SVG/PNG | 烤制 | quoteStyle=top/flank |
| 4 | 数据幻灯片(终稿展示) | `generate_chart`(Vega-Lite) | SVG/PNG | 烤制美图 | 确定性无 AI,柱/折线/饼/面积/散点全 |
| 5 | 架构/流程/时序/ER/类/思维导图 | `generate_diagram`(D2/Graphviz WASM) | SVG/PNG | 烤制(图本性) | darkTheme 双调色板 |
| 6 | 全屏写实配图/背景 | `generate_image`(Agnes/智谱免费 key) | PNG | 烤制 | AI 写实/插画 |
| 7 | 公式 | `generate_formula`(MathJax) | SVG/PNG | 烤制 | LaTeX→SVG 字形路径 |
| 8 | 小图标/logo | `generate_icon`(Iconify 20 万+) | SVG/PNG | 矢量 | 仅取现成集,不画原创 |
| 9 | QR 码(扫码) | `generate_qrcode` | SVG/PNG | 烤制 | 纯本地 |
| 10 | 酷炫/霓虹/辉光自定义形 | `render_svg`(手写 SVG→resvg/chrome) | SVG/PNG | 烤制 | **唯一能做 feGaussianBlur 辉光/模糊** |
| 11 | 动态片头/动效 | `render_video`(HTML/CSS/GSAP→MP4) | MP4/GIF | 视频嵌入 | 逐帧捕获 |
| 12 | 可交互幻灯片(浏览器 pan/zoom/切主题) | `generate_interactive_diagram`(D2→HTML) | 自包含 HTML | 交互 | 三杠杆条件展开 |

> 全部 11 个生成工具经 `assertOutputClean` 守门(index.ts 11 处钩子,P0-4 fatal/error/warning 三档 + standard/strict 双 profile)。PPT 层接入零新增守门代码。

### 2.2 缺的层(四件净缺口)

| 缺口 | 说明 | 谁来补 |
|---|---|---|
| **幻灯片版式/母版系统** | 没有 cover/two-col/compare/quote/section 布局模板,无母版继承。card 只有 5 个死模板 | ppt MCP 已有(部分) |
| **富文本/多元素布局/坐标定位** | 无项目符号、多段落、per-run 字体、z-order、网格、自动换行缩放。card 仅 4 扁平字段 | ppt MCP(add_text/add_shape/add_table 有英寸坐标) |
| **deck 级主题一致性** | 无 deck-level theme 对象(bg/accent/font/页脚跨 slide 共享) | 编排层(skill + Claude 保证参数一致) |
| **PPTX 装配/导出** | 不产 .pptx,无 slide 顺序/转场/notes 概念 | **ppt MCP 独占**(save_presentation) |

**净结论**:media-gen-mcp 是「素材叶子引擎」,缺的恰好是 ppt MCP 主攻的「容器 + 可编辑元素 + 装配」。两者能力集几近不相交——这是「互补 > 整合」的硬证据,不是拼凑借口。

---

## 3. OSS 全景与选型(精简版,详见 `OSS竞品与选型矩阵.md`)

### 3.1 PPTX 库选型(若 TIER 2b 落地)

| 库 | license | 语言 | 维护 | 真 PPTX | Node 进程内 | SVG(Node) | 契合 media-gen-mcp |
|---|---|---|---|---|---|---|---|
| **pptxgenjs 4.0.1** | **MIT**(deps jszip/https/image-size 全 MIT) | JS/TS(ESM+CJS) | 活跃 | ✅ OOXML 原生 | ✅ 同进程纯 JS,无 child_process | ❌ Node 返回 IMG_BROKEN(源码核实) | **唯一完美契合**(Node>=18/ESM/MIT) |
| python-pptx 1.0.2 | MIT | Python>=3.8 | 活跃 | ✅ | ❌ 需 child_process spawn sidecar | ⚠️ 间接 | 差(Python 运行时破纯 Node 立场) |
| officegen 0.6.5 | MIT | JS | **停滞**(2022) | 部分 | ✅ | ❌ | 不选 |
| react-pptx 2.20.1 | MIT | JS(声明式 JSX) | 活跃 | ✅ | ✅ | ❌ | 备用(命令式 MCP 用 pptxgenjs 更直接) |

**关键纠偏(源码级)**:pptxgenjs 的 `addChart` 走 `createExcelWorksheet` 生成真实 .xlsx 嵌 `ppt/embeddings/` + c:chart OOXML = **PowerPoint 双击可编辑的原生 OfficeChart**(非贴图);但 Node 下 SVG 一律返回 `IMG_BROKEN`(gen-media.ts STEP 5 硬证据,README「Supports SVGs」仅浏览器生效)。**这条 SVG-in-Node 缺口已被 media-gen-mcp 的 `render_svg` 预光栅化闭环**——是 media-gen-mcp 独占工艺(别的 pptxgenjs 用户没有)。

### 3.2 Markdown 幻灯片框架(Slidev / Marp / reveal.js)

**结论:不引作依赖。** Slidev=Vite+Vue3+Playwright+Shiki+mermaid+katex+UnoCSS 全家桶(Node>=20.12,最重);Marp-cli=8 runtime dep 含 puppeteer-core(中);reveal.js=零 runtime deps(最轻但无 PPTX 导出)。三者都违 P0「0 新增 runtime dep」立场。

**关键纠偏**:三者的 PPTX 默认都是「浏览器渲染→截图→addImage 背景」=**纯图不可编辑**(Slidev 官方 exporting.md 原文核实:「all the slides in the PPTX file will be exported as images, so the text will not be selectable」)。**「PPTX 默认是图」是 Slidev/Marp 的设计选择(Vue 画布无法逐元素拆成原生文本框),非 pptxgenjs 限制**——pptxgenjs 同条栈 `addText()` 出可编辑文本框,一个 format 参数即可切换。

### 3.3 AI-PPT 仓库借鉴

- **学设计范式,不抄代码**:ppt-master(40.5k★ MIT)三段式分层(outline→素材→组装)+ 受限中间表示 deterministic 编译 + BLOCKING 质量门(对应 P0-4 assertOutputClean)。
- **NO-GO 名单(license/活跃度雷区,源码+registry 实证)**:
  - **banana-slides = AGPL-3.0**(GNU AFFERO 原文核实,网络传染性,**绝不 import 代码**)
  - **ai-to-pptx = GPL-3.0**(商用须授权,**绝不 import**)
  - **veasion/AiPPT(文多多)= 伪开源**(GitHub 是 demo,真核心在 docmee.cn 商业 SaaS 闭源)
  - **officegen = 停滞**(最后 2022,比 AI 摘要宣称的更老)
  - **Browserless = SSPL 陷阱**(v2 商业须购 license,任何「浏览器渲染」路线若依赖须点名)
- **oh-my-ppt license 纠偏**:是 **Apache-2.0**(源码 LICENSE 核实),**非 inv 所说的 MIT**——商用安全结论不变(均可用),但事实须钉死。

### 3.4 差异化护城河(市场实证)

头部 AI-PPT 项目全是 skill/app/web 形态(ppt-master=Claude skill / banana-slides=Flask+React web / presentation-ai=Next.js web),**无一个是 MCP server**;MCP-PPT 系列(slidev-mcp 91★/mcp-ppt 66★/ppt-mcp 47★/pptx-mcp 35★,均 <100★)全是 python-pptx/slidev 薄壳,**无一个自带素材引擎**。media-gen-mcp 自带 Agnes/智谱免费生图 + Vega-Lite + D2/Graphviz + Satori + MathJax,纯 MIT,Claude 一句话直调 20 工具——这正是 AI-PPT 行业全缺的「免费素材引擎 + MCP 入口」组合。**但这份护城河属于「素材引擎」定位,不属于「PPTX 组装」——守住前者即守住差异化**。

---

## 4. 架构方案(三档,详见 `架构选项与编排工作流.md`)

### TIER 1 —— 推荐主架构,可立即落地:Skill 驱动 + Claude 编排,零新代码

| 维度 | 内容 |
|---|---|
| 形态 | 新建 PPT skill 文件(`.claude/skills/ppt-builder/SKILL.md` 或 doc_v13/ recipe),纯 markdown 零代码。可选增量:给现有 20 工具 description 加 PPT 场景 NEXT cross-ref hint(守 P0-1 工具描述工作流化范式,不动 inputSchema) |
| 新依赖 | **零** |
| 工时 | **0.5–1 人日** |
| ROI | 高(立即可用,覆盖 ~80% PPT 场景) |
| 立场契合 | **满分**(完全不碰 §4 边界) |
| 向后兼容 | **100%**(inputSchema 零 diff,守 P0 红线) |

skill 内化 **6 条协议**:(1) outline schema 规范;(2) 素材→工具映射矩阵(§6);(3) 可编辑 vs 烤制决策树(§5 两问);(4) 主题一致性协议(单一 accent/font/bg 贯穿);(5) assets 落盘约定(项目级 `./ppt-proj/{assets/,slides/,deck.pptx}`);(6) 失败恢复协议。

### TIER 2 —— 可选回退(仅当 TIER 1 实战证明不够)

分两档:
- **2a = 纯文档化「批量 generate_card」模式**(0.5 人日,零代码):skill 文档化「N×generate_card(1920×1080)→ 收集 PNG → ppt MCP 全屏图 slide」烤制视觉 deck 路径。
- **2b = 新增薄包装工具 `generate_slides` 批量出图 + pptxgenjs.addImage 装订**(2–3 人日):改文件=新建 src/slides.ts handler + index.ts 注册 + 扩展 output-checker.ts 加 PPTX 专属契约(zip 完整性/[Content_Types].xml/media 关系链)。新依赖=pptxgenjs@4.0.1(MIT,2.6MB,dist/pptxgen.es.js ESM)。

> **立场红线(TIER 2b 必须卡死)**:pptxgenjs 在 media-gen-mcp 内**仅限 addImage 图片底装订**(每页仍是生成的图,文字已栅格化,属「图像产物生成」);**若滑向 addText 原生可编辑文本框则越界**(变成文档组装),addText/editable 路径归 ppt MCP。

### TIER 3 —— 明确否决:全格式 `generate_ppt` 大工具

形态:topic/outline → 内部循环 → editable-pptx/image-pptx/html/pdf/images 五格式。**致命问题**:(1) 违 §4 边界(端到端文档应用组装);(2) 重复 ppt MCP;(3) 若走 Marp `--pptx-editable` 需 LibreOffice(重系统依赖,违「npx 一行装」轻量立场);(4) 反 MCP LLM-first(长循环藏进黑盒,LLM 失去逐步审视/纠偏能力)。ROI 相对 TIER 1/2 增量极低。

---

## 5. Claude 编排工作流设计(5 阶段,详见 `架构选项与编排工作流.md`)

```
用户:「做一份 10 页的 XX 主题 PPT」
  ↓
[Phase 0 意图捕获] Claude 解析出 {topic, slide_count(默认 8-10), audience, editability_need, format_pref}
  ↓ editability_need 是决定 Path A/B 的根参数,无法探测时显式问用户而非猜
[Phase 1 outline 生成] Claude 产出结构化大纲数组
  ↓ 每 slide spec = {index, type, title, content_hint, asset_needs[], editability_flag}
  ↓ outline 先行(对应 ppt-master spec_lock 防 LLM 漂移)
[Phase 2 素材并行生成] Claude 按 asset_needs 并行调 media-gen-mcp(同 deck 多张图可并发)
  ↓ 每张素材落盘到约定工作目录 ./ppt-proj/assets/
[Phase 3 组装]
  · Path A(可编辑):ppt MCP create_presentation → 逐 slide add_slide → manage_image 放烤制资产 → add_text/add_chart/add_table 放可编辑元素 → apply_professional_design 统一主题 → save_presentation
  · Path B(烤制图集):N×generate_card → 收集 PNG → ppt MCP 全屏图 slide,或 puppeteer page.pdf() 直接出 PDF
  ↓
[Phase 4 审视与微调] 某张图不满意单独重调 generate_image 不重建整 deck;布局挪改 ppt MCP 坐标
```

### 5.1 核心决策框架:何时 card 整图、何时 pptxgenjs/python-pptx 可编辑(本报告最关键交付)

**决策树两问定路径,避免 LLM 自由发挥质量漂移**:

- **第一问:用户/受众是否需要在 PowerPoint 里改文字?**
  - **YES**(发给老板改/协作编辑/客户二次编辑)→ **Path A 可编辑**:文本走 ppt MCP `add_text`;图表若客户要改数走 ppt MCP `add_chart`(原生 OfficeChart);配图走 generate_image→manage_image;架构图走 generate_diagram→render_svg→manage_image(图本身烤制但周围文字可编辑)。
  - **NO**(一次性定稿/线上放映/PDF 分享/视觉 pitch deck)→ **Path B 烤制图集**:N×generate_card(同 accent/font/bg 保一致性)→ 收集 PNG → ppt MCP 全屏图 slide 或直接 PDF。
  - **UNKNOWN**(最常见歧义,「做份汇报不知改不改」)→ **默认 Path A**。
  - **关键原则**:不可编辑是**单向不可逆损失**(老板双击改不了字,产物废),可编辑在所有场景都不致命(就算不改也不影响)——**故歧义时保守选可编辑**。

- **第二问(仅在 Path A 内部分流):图表客户会改数吗?**
  - **会改** → ppt MCP 原生 `add_chart`(数据数组进 python-pptx,PowerPoint 双击改数改型)。
  - **不会改/终稿展示** → media-gen-mcp `generate_chart`(Vega-Lite 烤制美图,视觉更精致但死图)。

### 5.2 generate_card 当「整张幻灯片」的可行性裁决

**物理可行,编辑性不可行——故必须按 slide 类型分流,不能一刀切全卡路线。**

- **物理前提成立**:card width/height 完全自由,传 1920×1080 即标准 16:9 slide;Satori 渲染确定性(同输入永远同输出);CJK 内置 Noto Sans SC 子集;WCAG 对比度自动 warning 防白底白字。
- **编辑性硬边界**:文字经 Satori→resvg 栅化成字形路径/像素,导出后不可选不可改(本性非 bug);仅 4 文本槽 + 1 logo 位,无项目符号/多段落/per-run 字体/表格;5 固定模板各会丢字段并发 warning;无多元素同框。
- **裁决**:card 当 slide **仅适合 4 类固定视觉页**(封面 hero / 章节 minimal / 金句 quote / 收尾 panel)——这 4 类本来就不需要用户改字;**不适合内容页/数据页/对比页**(用户高频改字)。全卡路线只对「一次性定稿 pitch deck/线上分享/PDF 图集」是优势,对「协作编辑 PPTX」是硬伤——两类必须分流。

---

## 6. 复用映射矩阵 + 需新增的层

### 6.1 复用映射 v2(按 slide 类型组织,直接喂 Claude 选材)

| slide 类型 | 首选工具 | 产物 | 可编辑性 | 适用路径 |
|---|---|---|---|---|
| 封面/hero | generate_card(hero, 1920×1080) | PNG/SVG | 烤制 | Path B 图集 |
| 章节分隔 | generate_card(minimal) | PNG/SVG | 烤制 | Path B |
| 金句/引言 | generate_card(quote) | PNG/SVG | 烤制 | Path B |
| 数据(终稿展示) | generate_chart(Vega-Lite) | SVG/PNG | 烤制美图 | Path B 或嵌 Path A |
| 数据(客户改数) | **ppt MCP add_chart** | 原生 OfficeChart | **可编辑** | **Path A 专享** |
| 架构/流程/时序/ER | generate_diagram(D2/Graphviz) | SVG/PNG | 烤制(图本性) | 嵌入任一路径 |
| 公式 | generate_formula(MathJax) | SVG/PNG | 烤制 | 任一路径 |
| 小图标/logo | generate_icon(Iconify) | SVG/PNG | 矢量 | 任一路径 |
| QR 码 | generate_qrcode | SVG/PNG | 烤制 | 任一路径 |
| 全屏写实配图 | generate_image(Agnes/智谱) | PNG | 烤制 | 任一路径 |
| 酷炫/辉光自定义形 | render_svg(手写 SVG) | PNG | 烤制 | 任一路径 |
| 动态片头 | render_video(GSAP) | MP4 | 视频嵌入 | 任一路径 |
| 可交互幻灯片 | generate_interactive_diagram | HTML | 交互 | 独立路径 |

### 6.2 需新增的层(若 TIER 2b 落地)

仅 TIER 2b 需新增,且**严格限定 addImage 图片底路径**:
1. `src/slides.ts` handler——批量出图 + pptxgenjs.addImage 装订。
2. `index.ts` 注册第 21 个工具 `generate_slides`。
3. `output-checker.ts` 扩展 PPTX 专属契约(zip 完整性 / [Content_Types].xml 存在 / slide 非空 / 图片非 0 字节 / OOXML schema / media 关系链,复用 P0-4 fatal/error/warning 三档)。
4. 同步落 `slides.json` 大纲作 source-of-truth,.pptx 当 derived(同 doc_v12「DSL 是源 HTML 是 derived」范式,解决「PPTX 是 zip 不可 git diff」问题)。

**TIER 1 不需要新增任何层**——纯 skill 引导 Claude 用既有 20(media-gen-mcp)+ 32(ppt MCP)工具。

---

## 7. 范围/立场诚实核:PPT 是否在 media-gen-mcp 版图内?

### 7.1 §4 边界检测的 spirit-vs-literal 诚实核(本节最关键,不回避)

doc_v12/收口决策.md §4 原文(我已读核实):

> 「media-gen-mcp 是**『所有图像操作归一个 MCP』(生成 + 识别 + 渲染)**。`generate_interactive_diagram` 产出 HTML 应用已是版图边缘,不应再向『前端画图编辑器』扩张。新增能力须通过『是否仍是图像/产物生成(而非交互应用开发)』的检验。」

**字面二元检验的诚实拆解**:
- PPTX .pptx 文件**字面上是一个「产物」**(一个落盘的文件)——严格读 §4,「产物生成」这一极 PPTX 似乎能沾边。
- PPTX 多页 deck **不是「交互应用开发」**(它是静态文档,无运行时交互)——所以 §4 的「而非交互应用开发」排除项**字面并不直接命中 PPT**。
- 但 deck 组装(版式系统/母版继承/坐标定位/多元素组合/deck 级主题)**既不是纯粹的「图像生成」,也不是「交互应用」——它是「文档应用组装」**,落在 §4 二元检验的**中间灰区**。

**诚实结论**:§4 字面**并未直接禁止** PPTX 组装(它针对的是「前端画图编辑器/交互应用」)。4 维度分析把 PPT 组装判为「通不过 §4 检验」是**精神阅读(防再漂移)而非字面阅读**——这是可辩护的解读,但不是唯一的字面解读。

**为何仍推荐「不做」(三力合力,任一独立成立)**:
1. **§4 精神(防再漂移)**:§4 的立法意图明确是「防止版图从核心身份(图像生成)往外漂」。PPT 是通往「文档/应用」的门户毒品——做了 PPT,下一波诉求是「编辑现有 PPT/PPT 动画/转场/SmartArt/母版设计器」,每步重演 v12 已否决的漂移。一旦 .pptx 进产物清单,版图边界永久模糊。
2. **重造轮子(独立于 §4,硬证据)**:同环境已有可用 ppt MCP(32 工具),media-gen-mcp 当前零 PPTX 代码。自建 = 重造轮子 + 两 MCP 争抢「谁产 .pptx」的内耗,违 doc_v12 §2「拖拽/全编辑器明确不碰...不重造」同款哲学。
3. **互补零成本(机会成本)**:两者能力几近不相交(生产者 vs 消费者、原生图表 vs 烤制美图),互补三明治 captured ~90% 价值、0% 风险。自建只有「单 MCP 全包」体验优势。

→ **即使 §4 字面不禁,PPTX 组装在 media-gen-mcp 内仍 fail 三力中至少两力**。这是比「§4 一票否决」更稳健、更诚实的裁决基础。

### 7.2 风险清单(不理想化)

| 风险 | 等级 | 说明 |
|---|---|---|
| **范围蔓延/身份漂移** | **高** | PPT 是门户毒品,一旦 .pptx 进产物清单,后续每个新能力都要重打「图像还是文档」官司 |
| **模板/版式长期维护债** | 中-高 | 认真的 PPT 工具需 opinionated 版式模板(cover/two-col/compare...),会随设计趋势 rot,引入主观判断 + 长期维护,与「确定性优先」哲学冲突 |
| **美观天花板陷阱** | 中 | pptxgenjs addText/addShape 产功能但视觉平庸的 slide(无原生动画/无 SmartArt)。要追平 Gamma/ppt-master 要么走 image-PPTX(丢可编辑)要么自建真版式引擎(巨大工程)——Gamma 都没解决「既要又要」 |
| **PPTX zip 破坏单产物守门** | 中 | P0-4 assertOutputClean 为单 raster/vector 设计;PPTX 是 zip 包,需全新守门契约(zip 完整性/[Content_Types].xml/media 关系链/OOXML schema),是实打实新工程 |
| **两套渲染引擎冲突** | 中 | 若内嵌 Slidev/Marp,其 chart/diagram/code-highlight 渲染器与 media-gen-mcp 现有 Vega-Lite/D2/MathJax 正面冲突(两套图表引擎、两套图引擎) |
| **license 干净 ≠ 应该做** | 低-中 | pptxgenjs/python-pptx 都 MIT 确实可过免费立场,但「license 可过」只是门槛不是「应该做」的依据——决定因素是重叠度/范围/维护/身份一致性,这些项 PPT 组装全部 fail |

### 7.3 与 interactive-diagram 边界讨论的类比(纠偏)

**generate_interactive_diagram 先例不能用来给 PPT 背书**。P0-5A 产单文件自包含 HTML viewer(DSL 编译、零状态、零后端),结构上等同 D2→SVG 的「编译产物」,是叶子产物的延伸。PPTX 多页 deck 含版式/母版/坐标/多元素 = 结构上全新的文档应用层。更关键:doc_v12 收口决策**正是用来「勒住」interactive_diagram 不再往编辑器漂的文件**(§1「够用就停,不自研拖拽编辑器」),它的精神是「限制扩张」而非「为更重的 PPT 开闸」。把它当扩张先例是**反向误读**。

### 7.4 唯一可接受增量(守界内的合法玩法)

1. **generate_card 的「一卡 ≈ 一张视觉幻灯片」桥**已天然存在(width/height 可配 1920×1080,无需新工具)——它出图/HTML,不做 PPTX 组装。这是 media-gen-mcp 对 ppt MCP「可编辑 PPTX」的**合法差异化**(产「烤制视觉幻灯片」,定位类似 Gamma 的 AI 单页)。**但不建议单独产品化为「幻灯片产品」——那是定位漂移的开端**,保持「它是卡/OG/分享图,恰好可当幻灯片用」的措辞。
2. **P0-1 NEXT hint**:给 generate_card/generate_chart/generate_diagram/generate_image 描述加 NEXT 句指向 ppt MCP 组装(「要做成可编辑 PPTX?→ 调 mcp__ppt__ 的 create_presentation + add_picture/add_text」),守工具描述工作流化范式,不动 inputSchema。

---

## 8. 最终推荐 + 路线图(可执行:明天能动手的第一步)

### 8.1 裁决

**GO-WITH-TIER-1**。做,但只做 TIER 1(零新代码 PPT skill);TIER 2b 列为「仅当实战证明 skill 不够」的可选回退;TIER 3 否决。

### 8.2 路线图

| 阶段 | 动作 | 工时 | 依赖 | 产出 | 触发下一阶段条件 |
|---|---|---|---|---|---|
| **第 1 步(明天动手)** | 写 `ppt-builder` skill 文件(6 条协议)+ 可选给 4 个工具 description 加 NEXT hint | **0.5–1 人日** | 零(纯 markdown) | 可用的 PPT skill,媒体既有 20 工具 + ppt MCP 32 工具三明治 | 端到端实测 10-slide deck |
| **第 2 步(第 1 周末)** | 端到端实测:跑一次 10-slide deck(混合封面 hero + 内容可编辑 + 数据图表),验证 generate_card 批量一致性 + 主题一致性 + 决策树命中率 | 0.5 人日 | 第 1 步 | 实测报告(skill 是否够用) | skill 够 → 停在此(终态);不够 → 进第 3 步 |
| **第 3 步(仅当 skill 不够)** | TIER 2a:skill 文档化「批量 generate_card 烤制图集」模式 | 0.5 人日 | 第 2 步证明图集是高频痛点 | 烤制视觉 deck 路径文档化 | 仍不够 → 进第 4 步 |
| **第 4 步(仅当 2a 不够)** | TIER 2b:新增 `generate_slides` 薄包装(pptxgenjs.addImage 装订,**严格卡死 addImage 不碰 addText**)+ output-checker PPTX 契约 | 2–3 人日 | 第 3 步证明批量出图+装订是高频痛点且 Claude 手编易错 | 第 21 工具,PPTX 图片底装订 | —— |
| **否决** | TIER 3 全格式 `generate_ppt` 大工具 | 6–10 人日 | —— | —— | 永不触发 |

### 8.3 第一步具体清单(明天即可执行)

1. 新建 `/Users/wangdong/Documents/Project/Agnes AI接入/doc_v13/ppt-builder-SKILL.md`(或移入 `.claude/skills/ppt-builder/SKILL.md`),内化 6 条协议(outline schema / 素材映射矩阵 / 可编辑决策树两问 / 主题一致性 / assets 落盘 `./ppt-proj/` / 失败恢复 fallback 链)。
2. (可选,P0-1 范式)给 media-gen-mcp 的 generate_card/generate_chart/generate_diagram/generate_image 工具 description 各加 1 句 NEXT:「PPT 场景:width=1920 height=1080 出单页幻灯片,组装成可编辑 PPTX 走 mcp__ppt__」——**不动 inputSchema,守 byte-identical 红线**。
3. 跑一次端到端:用户说「做份 10 页的 media-gen-mcp 介绍 PPT」,Claude 按 skill 出 outline → 生素材 → ppt MCP 组装 → save .pptx,验证产物可编辑性 + 视觉质量 + 主题一致性。

---

## 9. 开放问题(诚实列,不掩饰未决项)

1. **auto_generate_presentation 是否 LLM 增强?**——工具签名 include_images 默认 false + 无 provider/key 参数,强推断是 python-pptx 本地启发式模板填充零 AI 生图,但「文本内容是否调 LLM」需实测一次确认(本环境只读到工具描述,未读 ppt MCP 源码)。**影响**:若它已调 LLM 出文本,则 media-gen-mcp 的互补价值在「视觉素材」更纯粹;若不调,则 Claude 编排空间更大。
2. **generate_card 批量一致性未实测**——同 deck 连跑 10× generate_card 同参数,titleGradient+glow 互斥等约束是否跨调用稳定,字体缓存/emoji CDN 是否抖动?需第 2 步端到端确认。Satori 确定性本质预示应该稳,但未验证。
3. **pptxgenjs Node SVG 返回 IMG_BROKEN**——gen-media.ts 源码硬证据已核实,对 media-gen-mcp 不阻塞(已有 render_svg 预光栅化闭环),但 AI 摘要谎称 Issue #963 已修不可信(master 源码仍返回坏图)。**若未来 pptxgenjs 真修了 SVG-in-Node,TIER 2b 可省预光栅化**——需用户本机 npm install pptxgenjs@latest 实测。
4. **MCP 间 Claude 编排要求两 MCP 同会话加载**——若用户只装了 media-gen-mcp 没装 ppt MCP,则 Path A(可编辑)不可用。skill 应探测能力自省(复用 list_vision_capabilities 范式)缺 ppt MCP 时降级 Path B 并诚实告知。
5. **可编辑原生图表 vs 烤制美图的阈值**——当前靠 Claude 现判,质量不稳定。skill 第二问规则化(「客户要改数→原生;终稿展示→烤制」),但阈值边界(如「内部 review 用,可能改数」算哪边?)需实战校准。
6. **跨 MCP 编排级容错**——media-gen-mcp 有 provider fallback(Agnes→智谱),但跨 MCP 的编排级容错(如 generate_image 全 fallback 失败后是否改走 ppt MCP 占位文本框)目前靠 Claude 判断。skill 协议 6 给明确 fallback 链规则化,不靠 LLM 现场发挥。
7. **CJK 字体在 .pptx 的嵌入**(仅 TIER 2b 相关)——.pptx 不嵌字体会跨机器漂移,是否预置 CJK 字体回退(类似 generate_card 的 Noto Sans SC)需 spike。
8. **「一句话出 PPT」单 MCP 体验**(若用户未来强烈要)——应优先评估「升级 ppt MCP 的 auto_generate 接 media-gen-mcp 当素材后端」而非反向把组装塞进 media-gen-mcp。组装归组装 MCP,素材归素材 MCP,边界干净才能各自演化。

---

## 附录 A:立场红线核查表

| 项 | 核查结果 |
|---|---|
| media-gen-mcp 纯免费/MIT | ✅ 守住(TIER 1 零新依赖;TIER 2b 仅加 pptxgenjs MIT) |
| MCP server 形态 | ✅ 守住(TIER 1 不改 media-gen-mcp;TIER 2b 加薄 handler) |
| Claude 一句话驱动 | ✅ 守住(Claude 编排主引擎) |
| GPL/AGPL/SSPL/商业依赖 | ✅ 零引入(banana-slides AGPL / ai-to-pptx GPL / veasion 伪开源 / Browserless SSPL 全点名 + 仅学设计不抄代码) |
| P0 inputSchema 零 diff | ✅ 守住(TIER 1 零改;TIER 2b 加新工具不触既有 20 工具) |
| doc_v12 §4 边界 | ✅ 守住(TIER 1 完全不碰;TIER 2b 卡死 addImage 图片底,addText 归 ppt MCP) |
| 「不重造轮子」哲学 | ✅ 守住(PPTX 组装归 ppt MCP) |

## 附录 B:证据索引(可核实)

- `doc_v12/收口决策.md` §4——media-gen-mcp 核心身份 + 边界检测原文(已 Read 核实)。
- `media-gen-mcp/src/index.ts`——20 工具注册;`grep -rci "pptx\|python-pptx\|powerpoint\|slidev\|marp\|reveal" src/` 全 0 命中(已核实零 PPTX 代码)。
- `media-gen-mcp/package.json`——v0.12.1 MIT(已核实)。
- `media-gen-mcp/src/card.ts:543-544, 657-665, 683-714`——generate_card 尺寸可配/字段丢弃 warning/Satori 栅格化不可编辑(3 份独立调查交叉核实)。
- pptxgenjs `src/gen-media.ts` STEP 5 / `createSvgPngPreview`——Node SVG 返回 IMG_BROKEN(源码级核实);`src/gen-charts.ts` `createExcelWorkspace`——原生 OfficeChart(源码级核实)。
- Slidev `docs/guide/exporting.md` 原文——「all the slides in the PPTX file will be exported as images, so the text will not be selectable」(zread 核实)。
- 本会话 `mcp__ppt__*` 工具定义(create_presentation/add_slide/add_chart/add_table/manage_image/apply_professional_design/auto_generate_presentation/save_presentation 等 32 工具)——ppt MCP 能力权威来源。
- 外部 AI-PPT 仓库 star/license:ppt-master 40.5k★ MIT / banana-slides 15.2k★ AGPL-3.0 / ai-to-pptx GPL-3.0 / oh-my-ppt Apache-2.0(均 2026-07-23 GitHub 实测)。
