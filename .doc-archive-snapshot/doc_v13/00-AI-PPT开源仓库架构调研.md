# AI-PPT 开源仓库架构调研(2025-2026 trending)

> 调查者任务:找当前 trending 的开源 AI-PPT 项目,深析其架构管线,产出对 media-gen-mcp 的借鉴点与差异化定位。
> 调查方法:GitHub Search API + zread(仓库结构/README/源码)。web-search-prime 已耗尽(1310),内置 WebSearch 路由到 prime 同样不可用,全程走 GitHub raw + zread。
> 调查日期:2026-07-23。
> 立场红线:media-gen-mcp 纯免费(MIT/Apache 优先)、MCP server 形态、Claude 一句话驱动。任何 GPL/商业/SSPL 依赖必须点名 + 给替代。

---

## 0. 执行摘要(TL;DR)

1. **2025-2026 AI-PPT 开源格局已从"模板填充"演进到"AI 原生设计"**,头部 3 个项目(hugohe3/ppt-master 40.5k★、Anionex/banana-slides 15.2k★、allweonedev/presentation-ai 2.9k★)都不再是"选模板填字",而是 LLM 直接规划版式 + 生成视觉。
2. **素材引擎是全行业的共同短板**:头部项目要么 LLM 手绘 SVG(ppt-master,token 贵且易错),要么付费图模型整页出图(banana-slides 的 nano banana pro、presentation-ai 的 Together AI/FAL),要么付费图库。**没有一个自带"免费 + 确定性 + 多模态"的素材引擎**。
3. **MCP 形态是空白**:所有头部 AI-PPT 项目都是 Claude skill / 桌面 app / Web app,**没有一个是 MCP server**。MCP-PPT 领域全是 <100★ 的 python-pptx 薄壳(slidev-mcp 91★、mcp-ppt 66★、ppt-mcp 47★),证明"MCP + 真素材引擎"是空白位。
4. **license 是雷区**:banana-slides=AGPL-3.0、ai-to-pptx=GPL-3.0、veasion/AiPPT=伪开源(开源 demo + 商业 SaaS),商用安全的只有 ppt-master(MIT)、presentation-ai(MIT)、oh-my-ppt(MIT)。
5. **media-gen-mcp 的差异化一句话**:它是 AI-PPT 项目缺的那个**免费素材引擎 + MCP 原生入口**——自带免费 AI 生图(Agnes/智谱)、确定性图表(Vega-Lite)、确定性图引擎(D2/Graphviz)、卡片(Satori),Claude 一句话直接调,纯 MIT。

---

## 1. 候选仓库清单(按 star 排序,2026-07-23 实测)

| # | 仓库 | ★ | 语言 | License | 形态 | 一句话定位 |
|---|---|---|---|---|---|---|
| 1 | **hugohe3/ppt-master** | 40,542 | Python | **MIT** ✓ | Claude skill | AI 文档→原生可编辑 PPTX,LLM 手写 SVG→DrawingML |
| 2 | **Anionex/banana-slides** | 15,216 | Python+React | **AGPL-3.0** ⚠️ | Web app(Docker) | 基于 nano banana pro 整页出图的"Vibe PPT" |
| 3 | **pipipi-pikachu/PPTist** | 9,191 | Vue | MIT(类) | Web editor | 在线 PPT 编辑器(非生成,被多个 AI-PPT 当底座) |
| 4 | **allweonedev/presentation-ai** | 2,898 | Next.js | **MIT** ✓ | Web app | Gamma.app 替代,38 主题 + PPTX 导入 |
| 5 | **arcsin1/oh-my-ppt** | 1,774 | Electron | **MIT** ✓ | 桌面 app | 本地优先,HTML 幻灯片 + 30 风格 skill |
| 6 | **veasion/AiPPT(文多多)** | 1,899 | JS | MIT(demo) | **伪开源** ⚠️ | GitHub 是 PPT↔JSON demo,真 AI 生成在 docmee.cn 付费 |
| 7 | **SmartSchoolAI/ai-to-pptx** | 1,459 | Vue+PHP | **GPL-3.0** ⚠️ | Web app | DeepSeek 大纲 + 模板填充,多功能锁商业版 |
| 8 | **YOOTeam/OpenPPT** | 1,089 | TS | — | Web app | 基于 ChatPPT 的 AIPPT 在线编辑器 |
| 9 | MCP-PPT 系列(slidev-mcp 91 / mcp-ppt 66 / ppt-mcp 47 / pptx-mcp 35) | <100 | Py/TS | MIT(类) | MCP server | python-pptx / slidev 薄壳,无素材引擎 |

> 基线参考(非 AI-first):**slidev**(~40k★,MIT,Markdown→Vue 幻灯片)、**marp**(MIT,Markdown→HTML/PDF/PPTX)——这俩是"确定性 Markdown 转幻灯片"的祖师爷,但不做 AI 生成,可作为 PPT-PPT 输出层的对比基线。

本次深析聚焦前 7 个真实 AI-PPT 生成项目(剔除纯编辑器 PPTist 与基线 slidev/marp)。

---

## 2. 逐个架构深析

### 2.1 hugohe3/ppt-master(40.5k★,MIT)—— 当前王者,LLM 手绘 SVG 路线

**形态**:不是独立 app,是一个 **Claude skill**(workflow 包),跑在任何 agent-capable 工具里(Claude Code / Cursor / Codex / Kimi Code)。用户只需装 Python + 一个 AI 工具,在 chat 里说"把这个 PDF 做成 PPT"。

**完整管线**(读 `skills/ppt-master/SKILL.md` + `workflows/generate-pptx.md` 实证):

```
源文档(PDF/DOCX/URL/MD/文本)
  │  source_to_md.py 统一转 Markdown(+ image_manifest.json,EMF/WMF 保矢量)
  ▼
Step1 源处理 → Step2 项目初始化(project_manager.py init,canvas 如 ppt169=1280×720)
  │
  ▼ 🚧 BLOCKING GATE(用户确认设计 spec:模板/格式/页数)
Step3 [可选模板] → Step4 Strategist 结构化规划(design_spec.md + spec_lock.md 防漂移)
  │
  ▼
Step5 [Image_Generator]  素材就位:
  │   • image_gen.py   → gpt-image-2 / gemini-3.1-flash-image(均付费)
  │   • image_search.py → Pexels / Pixabay / Openverse(零配置兜底,CC license 自动处理)
  ▼
Step6 Executor 逐页手绘 SVG  ← 关键:LLM 当前主 agent "hand-writes every SVG page"
  │   • 主 agent 自己写 svg_output/P0X.svg(每一页的完整设计源)
  │   • preset_shape_svg.py 仅提供 stdout 片段(形状零件),不能替 LLM 排版
  │   • 图表/表格:LLM 手绘 SVG,可选 --native-charts-and-tables 映射原生 Chart/Table
  ▼
Step7 质量检查 → 后处理 → 导出
  │   • finalize_svg.py    → svg_final/(自包含预览,非 PPTX 源)
  │   • svg_to_pptx.py     → svg_output/ 映射 DrawingML → exports/<name>.pptx(原生可编辑)
  │   • backup/ 自动快照 svg_output 供重导出
  ▼
原生 PPTX(slide masters / native shapes / 图表 / 表格 / 动画 / 演讲备注 / 音频旁白 / 视频)
```

**关键技术决策**:
- **SVG 是项目专属中间语言**(非通用 SVG):`svg_output/` 用一套受限的 canonical SVG——固定元素/属性/单位/元数据/结构契约,编译器只认这套。方向是"SVG 适配 PPT Master",不是"PPT Master 兼容全部 SVG 标准"。**这是它和 media-gen-mcp 的根本差异:ppt-master 让 LLM 当"人肉 SVG 渲染器"**。
- **原生深度是卖点**:不是填模板,是 `p:sldMaster`/`p:sldLayout` 继承的真 PowerPoint 对象模型,有 SmartArt 刻意不做(诚实标注边界,见 `powerpoint-svg-mapping.md`)。
- **三承诺**:免费开源(只付模型费)、数据本地(除模型调用)、无平台锁定(任何 agent IDE 都能驱动)。
- **模型要求高**:推荐 Kimi K3 / Claude + 1M 上下文 + gpt-image-2。作者明说"便宜模型质量塌方,先升级模型再说"。**这暴露了"LLM 手绘 SVG"路线的内在成本**。

**素材怎么来**:
- 文字/图标:LLM 生成 + SVG Repo / Tabler / Simple Icons / Phosphor(致谢里点名)。
- AI 生图:`image_gen.py` 调 gpt-image-2 / gemini-3.1-flash-image(**均付费**)。
- 配图:`image_search.py` 调 Pexels / Pixabay / Openverse,**license-aware**(CC0/PD/Pexels 无署名/CC BY/CC BY-SA 综合处理,需署名时自动加 inline credit,`--strict-no-attribution` 关闭)。
- 图表:LLM 手绘 SVG(数据驱动型可映射原生 Chart,但默认导出为 SVG 派生的 DrawingML 形状,保跨应用视觉一致)。

**输出**:真 PPTX(原生 DrawingML)。有模板系统(可从用户参考 .pptx 蒸馏品牌/版式/母版;4 条路由:Generate / Create Template / Fill Native PPTX / Enhance Native PPTX)。

**license + 商用**:**MIT,真开源,商用安全**。无 key 锁(用谁家模型都行),无后端依赖(纯本地 Python 脚本 + 模型 API)。唯一的"软锁"是模型本身(Kimi/Claude/GPT)。

---

### 2.2 Anionex/banana-slides(15.2k★,AGPL-3.0)—— nano banana pro 整页出图路线

**形态**:Python(Flask 3.0)+ React 18(Vite 5)+ SQLite 的 Web app,Docker Compose 一键起,前后端分离。

**完整管线**(读 `backend/services/` + `utils/pptx_builder.py` 实证):

```
想法 / 大纲 / 页面描述(SSE 流式)
  │  ai_service.py + ai_service_manager.py(多 provider 路由)
  ▼
outline 生成(可自然语言改:"把第三页改成案例分析")
  │  prompts.py  page-by-page description
  ▼
逐页:Google nano banana pro 🍌  ← 关键:整页当一张图生成(文字+图+版式一起出)
  │   • ai_providers/ (gemini / openai / vertex / lazyllm 四格式)
  │   • 图文不割裂,模型直接渲染"这一页长什么样"
  ▼
素材工具箱(2026-04 新):
  │   • image_editability/  整图编辑
  │   • inpainting_service.py  框选编辑(overlay/replace)+ 智能擦除(mask_utils.py)
  │   • file_parser_service.py  PDF/Docx/MD/Txt 解析,提取关键点/图片链接/图表
  ▼
导出:
  │   • export_service.py + pptx_builder.py → PPTX(图片版 / 可编辑版 Beta)
  │   • pdf_service.py → PDF
  │   • tts_video_service.py → MP4 讲解视频(AI 语音旁白 + 字幕 + Ken Burns,FFmpeg+libass)
  ▼
PPTX / PDF / 讲解视频
```

**关键技术决策**:
- **"整页一张图"是核心赌注**:不同于 ppt-master 让 LLM 手绘矢量 SVG,banana-slides 把整页交给 nano banana pro 渲染成位图(质量高、图文统一、风格一致),再导出。代价是**可编辑性是 Beta + 难题**(`utils/pptx_builder.py` + 百度智能云 API 做背景干净化才能拆出可编辑文字/图)。
- **可编辑 PPTX 导出仍 Beta**,路线图明确"多层次精确抠图的可编辑 pptx"在进行中——这是整页位图路线的内在债。
- **多 provider 适配**:支持 Gemini / OpenAI / Vertex / Lazyllm(deepseek/doubao/qwen/glm/siliconflow/sensenova/minimax),走 AIHubMix 格式标准。

**素材怎么来**:几乎全靠 nano banana pro 整页生成 + 用户上传参考图/模板。**没有独立的图表引擎/图引擎**——图表也是模型画进图里。

**输出**:PPTX(图片版稳定 / 可编辑版 Beta)+ PDF + 讲解视频(MP4)。

**license + 商用**:**AGPL-3.0**。README 明确:"可自由用于个人学习/研究/教育/非营利科研等**非商业用途**"。**AGPL 网络条款**:你通过网络提供服务给第三方用,也必须开源全部代码(含你的业务代码)。**商用需联系作者取商业授权**。对 media-gen-mcp 立场而言——**这是 GPL 类,不能直接借鉴代码,只能借鉴范式**。

---

### 2.3 allweonedev/presentation-ai(2.9k★,MIT)—— Gamma 替代,Web app 全家桶

**形态**:Next.js + React + TypeScript + PostgreSQL(Prisma)+ NextAuth + Plate Editor。完整 SaaS 架构。

**完整管线**(读 `src/ai/` + `src/components/presentation/` + `constants/antv-templates.ts` 实证):

```
登录 → 输入主题
  │  src/ai/agents/ + src/ai/tools/(AI agent + tool calling)
  ▼
Generate Outline(可编辑,prose-mirror 编辑器)→ 选主题(38 内置 antv-templates)
  │  + 可从 .pptx 导入主题灵感
  ▼
Generate Presentation(实时流式生成,infographic-streaming-state.ts)
  │   • 文本模型:OpenAI / Ollama / LM Studio(本地可)
  │   • 图片:Together AI / FAL(AI 生图)+ Unsplash(图库)+ Tavily(web search)
  │   • 图表/信息图:antv 模板(AI 生成 + 可编辑)
  ▼
编辑器(Plate Editor 富文本 + DND Kit 拖拽 + 自定义主题)
  │  presentation-state.ts / presentation-history-state.ts(历史)
  ▼
导出:.pptx(PptxGenJS,partial:"images and components do not translate one to one")
      + 演示模式(含 webcam/mic 录制)+ 公开分享链接
```

**关键技术决策**:
- **outline-first 工作流**:先生成大纲、人工 review、再生成 slides(主流商业 AI-PPT 如 Gamma 的范式)。
- **主题系统最成熟**:38 内置主题 + 自定义主题 + **从 PPTX 文件导入主题灵感**(差异化能力)。
- **本地模型支持**:Ollama / LM Studio 走 OpenAI 兼容协议,文本生成可零成本。
- **PPTX 导出是弱项**:作者自己在 roadmap 标 "Partially Done — images and components do not translate one to one"。用 PptxGenJS,不是原生 DrawingML 映射。

**素材怎么来**:AI 生图(Together AI/FAL,**付费**)+ Unsplash 图库 + Tavily 搜索。图表走 antv 模板(有限且"coverage still improving")。

**输出**:PPTX(partial,保真度低)+ 在线演示 + 分享 + 录屏。

**license + 商用**:**MIT,真开源**。但**部署重**:需 PostgreSQL + Google OAuth + 多个付费 API key(OpenAI/Together AI/FAL/Unsplash/Tavily/UploadThing)。商用安全,但"免费"是假象——跑起来要一串付费 key。

---

### 2.4 arcsin1/oh-my-ppt(1.7k★,MIT)—— 本地优先 HTML 幻灯片

**形态**:Electron + React + TypeScript 桌面 app,纯本地,不用注册。

**完整管线**:

```
主题 / 文档(txt/md/csv/docx)/ 导入 PPTX
  │  AI 规划大纲 + 配色 + 排版(OpenAI 兼容,支持 Ollama 本地)
  ▼
逐页渲染为 HTML 幻灯片(固定 16:9 画布 + 内容高度预算防溢出)
  │   • 内置 30+ 风格 Skill(极简白/赛博霓虹/包豪斯/日式简约/小红书白…)
  │   • Anime.js v4 整元素动画(淡入/位移/缩放/错峰)
  │   • LaTeX 公式渲染
  ▼
对话式修改("标题换个颜色""加个数据图表")+ 可视化拖拽编辑
  ▼
导出:PDF / 批量 PNG / PPTX(持续优化,保真度有限)
```

**关键技术决策**:
- **HTML-first 而非 PPTX-first**:输出是 HTML 幻灯片(浏览器打开即预览),PPTX 是导出副产物("尽量保留文字/图片/颜色/公式/基础布局")。这和 ppt-master 的"PPTX 是原生一等公民"正相反。
- **参考 html-ppt-skill(lewislulu)**——是"HTML 转 PPT skill"路线的代表。
- **对话式 + 可视化双编辑**:可拖拽,也可对某一页说自然语言指令。

**素材怎么来**:LLM 生成 HTML(含内联样式)+ 用户本地素材复制进创意目录。**无独立图表/图引擎**,图表靠 LLM 在 HTML 里手写。

**输出**:HTML(一等)+ PDF / PNG / PPTX(导出)。

**license + 商用**:**MIT,真开源,商用安全**。本地优先,无后端。未签名 app(非技术债,是发布流程)。

---

### 2.5 veasion/AiPPT(1.9k★)—— 伪开源(开源 demo + 商业 SaaS)

**形态**:GitHub 仓库 `veasion/AiPPT` 实际是 **PPTist 衍生的 PPT↔JSON 解析/反渲染 demo**(aippt-react,MIT)。真正的"AI 生成 PPT"在 **docmee.cn**(商业 SaaS,支持代理 + 私有化部署,付费)。

**管线**:开源部分 = PPT 解析成 JSON + JSON 反渲染 PPT(在线编辑后下载 ppt)。AI 生成部分 = **闭源商业**(docmee.cn 开放平台 API/UI 接入)。

**素材**:商业版支持原生图表/动画/3D 特效解析渲染、用户自定义模板、智能添加动画——**这些都在闭源后端**。

**license**:**开源 demo 是 MIT,但有价值的能力是商业付费**。README 通篇是"商用级""商业合作""私有化部署""价格行业最低"。**典型的伪开源:用开源 demo 引流,核心闭源收费**。

**结论**:**不可借鉴代码(核心闭源),只能当"商业 AI-PPT 能做什么"的参照**。

---

### 2.6 SmartSchoolAI/ai-to-pptx(1.5k★,GPL-3.0)—— DeepSeek + 模板填充

**形态**:Vue/MUI 前端 + PHP 后端(`ai-to-pptx-backend`,Docker)。

**管线**:DeepSeek 生成大纲 → 用户选模板 → 填充 → 导出 PPTX/PDF/PNG。

**关键技术决策**:
- **模板驱动**(传统路线):自带 4 套免费模板,更多模板需购买授权。有详细的"如何制作 PPTX 模板"文档。
- **多功能锁商业版**:在线修改文字/样式/图片、用户 LOGO/背景、模板共享平台——全是"商业版功能"。开源版限制:无会员系统、只支持 3 小节布局、无移动端。
- 前端基于 veasion/aippt-react(MIT),但项目整体 **re-license 为 GPL-3.0**。

**license**:**GPL-3.0**。README 自己写明:"闭源商用需商业授权""修改代码必须开源""不能改版权信息""禁止二次销售"。**GPL 类 + 双授权(dual licensing)**,立场红线触发——**不能借鉴代码**。

---

### 2.7 MCP-PPT 系列(<100★,空白市场)

| 仓库 | ★ | 实质 |
|---|---|---|
| LSTM-Kirigaya/slidev-mcp | 91 | slidev 的 MCP server,本质还是 Markdown→Vue 幻灯片 |
| ltc6539/mcp-ppt | 66 | python-pptx 薄壳,LLM 自然语言→PPTX |
| ykuwai/ppt-mcp | 47 | 实时 PowerPoint 控制(走 Windows COM),非生成 |
| samos123/pptx-mcp | 35 | python-pptx 的 MCP 封装 |
| 2slides/mcp-2slides | 31 | 2slides 商业产品的 MCP 入口 |

**共性**:**全是 python-pptx 或 slidev 的薄封装,没有一个自带素材引擎(生图/图表/图引擎/卡片)**。这恰恰证明:**"MCP server + 真素材引擎"是当前空白位**——media-gen-mcp 已经在这个位上(20 工具的素材全家桶),只差"组装成 PPT"的最后一层。

---

## 3. 横向对比矩阵

### 3.1 架构管线对比

| 项目 | 规划层 | 素材层 | 组装层 | 输出层 |
|---|---|---|---|---|
| **ppt-master** | LLM Strategist 规划 | image_gen/image_search(**付费**图模型 + 图库) | **LLM 手绘 SVG**(token 重) | svg_to_pptx.py → 原生 DrawingML PPTX |
| **banana-slides** | LLM outline/page desc | **nano banana pro 整页出图**(付费) | 模型直接渲染整页位图 | pptx_builder → PPTX/PDF/视频 |
| **presentation-ai** | AI agent outline-first | Together AI/FAL/Unsplash(**付费**) | antv 模板 + Plate 编辑器 | PptxGenJS → PPTX(partial) |
| **oh-my-ppt** | LLM 大纲+风格 | LLM 手写 HTML | 30+ 风格 skill | HTML / PDF / PNG / PPTX |
| **veasion/AiPPT** | (闭源商业) | (闭源) | (闭源) | docmee.cn 付费 |
| **ai-to-pptx** | DeepSeek 大纲 | 模板内置 | 模板填充 | PptxGenJS 类 → PPTX |
| **MCP-PPT 系列** | LLM | 无 | python-pptx 直填 | PPTX(基础) |

### 3.2 关键维度对比

| 维度 | ppt-master | banana-slides | presentation-ai | oh-my-ppt | veasion | ai-to-pptx |
|---|---|---|---|---|---|---|
| **输出保真度** | ★★★★★ 原生 DrawingML | ★★★ 图片版稳/可编辑 Beta | ★★ PPTX partial | ★★★ HTML 一等/PPTX 弱 | ★★★★(商业版) | ★★★ 模板填充 |
| **AI 生图来源** | gpt-image-2/gemini(**付费**) | nano banana pro(**付费**) | Together AI/FAL(**付费**) | 无独立(HTML 内联) | 闭源 | 模板内置 |
| **图表引擎** | LLM 手绘 SVG(可选原生映射) | 模型画进图里 | antv 模板(有限) | LLM 手写 HTML | 闭源(原生图表) | 模板占位 |
| **图/架构图引擎** | LLM 手绘 SVG | 模型画进图里 | 无 | LLM 手写 HTML | 闭源 | 无 |
| **是否 MCP** | ✗(skill) | ✗(Web app) | ✗(Web app) | ✗(Electron) | ✗(SaaS) | ✗(Web app) |
| **license** | **MIT** ✓ | **AGPL-3.0** ⚠️ | **MIT** ✓ | **MIT** ✓ | 伪开源 ⚠️ | **GPL-3.0** ⚠️ |
| **商用安全** | ✓ | ✗ 需授权 | ✓(但需多付费 key) | ✓ | ✗ | ✗ 需授权 |
| **部署成本** | 低(Python+模型) | 中(Docker 全栈) | 高(PG+多 key) | 低(Electron) | N/A | 中(PHP+Docker) |
| **数据本地** | ✓ | ✓(自托管) | ✗(云架构) | ✓ | ✗ | ✓ |

---

## 4. 对 media-gen-mcp 的启发

### 4.1 可借鉴的范式(只学设计,不抄 GPL 代码)

| # | 借鉴点 | 来源 | 对 media-gen-mcp 的启示 |
|---|---|---|---|
| 1 | **outline → 素材 → 组装 三段式** | ppt-master(Strategist→Executor→Export)、banana-slides(idea→outline→page)、presentation-ai(outline-first) | 若 media-gen-mcp 未来加"生成 PPT"工具,应分三层:LLM 规划结构 → 媒体工具产素材(图/图表/图/卡)→ 组装层拼装。**不要让一个工具干完所有事**。 |
| 2 | **中间表示 → 目标格式** | ppt-master 的 canonical SVG → DrawingML | media-gen-mcp 当前各工具独立产 SVG/PNG/MP4。若做 PPT,可借鉴"定义一套受限中间表示(如 slide JSON),再 deterministic 编译到 PPTX/HTML"——**避免每页都让 LLM 现场手绘**(ppt-master 的 token 成本就是教训)。 |
| 3 | **license-aware 素材路由** | ppt-master 的 image_search(CC0/PD/CC BY/CC BY-SA + 自动署名 + `--strict-no-attribution`) | media-gen-mcp 生图无 license 问题(AI 生成),但**这个"按 license/质量/可用性 路由 + fallback"的范式**已在 P0 实现(agnes/zhipu fallback),可继续深化。 |
| 4 | **质量门 + spec_lock 防漂移** | ppt-master 的 BLOCKING GATE + `spec_lock.md`(锁投影防 LLM 中途跑偏) | media-gen-mcp 的 P0-4 产物守门(assertOutputClean)是同类思想。若做多页 PPT,需要"设计 spec 一次锁定,后续页只校验不跑偏"的机制。 |
| 5 | **主题/模板系统** | presentation-ai(38 主题 + PPTX 主题导入)、oh-my-ppt(30+ 风格 skill)、ppt-master(从参考 .pptx 蒸馏品牌) | media-gen-mcp 的 `generate_card` 已有 template 概念(og/quote/minimal/hero/panel)。若扩到 PPT,可复用"template + content_mapping"范式,**不要硬编码版式**。 |
| 6 | **可编辑性契约(明确边界)** | ppt-master 明确:`svg_output` 是 page-design 源(可编辑),`svg_final` 只是 preview(不可编辑);`--native-charts-and-tables` 切原生 vs 视觉一致 | media-gen-mcp 若出 PPT,必须诚实标注"哪些原生可编辑 / 哪些是图"——**不要模糊承诺"完全可编辑"**(banana-slides 的可编辑 Beta 就是债)。 |
| 7 | **多输出形态(不止 PPTX)** | banana-slides(PPTX+PDF+讲解视频)、oh-my-ppt(HTML+PDF+PNG+PPTX) | media-gen-mcp 已有 render_video(HTML→MP4)、generate_card、render_svg——**天然适合"一套素材,多形态输出"**。 |

### 4.2 它们的短板,正是 media-gen-mcp 能补的差异化

| 行业短板 | 现状(谁都没解决) | media-gen-mcp 怎么补 |
|---|---|---|
| **A. 付费 AI 生图依赖** | ppt-master 要 gpt-image-2/gemini、banana 要 nano banana pro、presentation-ai 要 Together AI/FAL——**全是付费图模型/图库** | 自带 **Agnes + 智谱 cogview/cogvideox 永久免费层**,`generate_image` / `create_video` 零成本出图出视频 |
| **B. 无确定性图表引擎** | ppt-master 靠 LLM 手绘 SVG 图表(token 贵 + 易画错)、presentation-ai 靠 antv 有限模板、banana 把图表画进位图(不可编辑) | 自带 **Vega-Lite v5(内置 WASM)**,`generate_chart` 丢数据出矢量图,柱/折/饼/面积/散点全覆盖 |
| **C. 无确定性图引擎** | 架构图/流程图/时序图全靠 LLM 手绘 SVG 或 HTML | 自带 **D2 + Graphviz(内置 WASM)**,`generate_diagram` 出矢量架构图,还有 `generate_interactive_diagram` 出交互 HTML |
| **D. 非 MCP 形态** | 头部项目全是 skill / app / web,Claude 不能一句话直接调;MCP-PPT 全是 python-pptx 薄壳无素材 | **media-gen-mcp 本身就是 MCP server**,Claude 一句话直接驱动 20 个工具,无需"开个 app / 装个 skill" |
| **E. license 不干净** | banana=AGPL、ai-to-pptx=GPL、veasion=伪开源 | **纯 MIT**,20 工具无 GPL/SSPL 依赖(已核:@terrastruct/d2 MPL-2.0、puppeteer-core Apache-2.0、@resvg/resvg-js MPL-2.0 都是商用友好) |
| **F. 部署重** | presentation-ai 要 PostgreSQL + 6 个 key + Google OAuth;banana 要 Docker 全栈 + FFmpeg | `npx media-gen-mcp-server` 一行装,零 Key 出第一张图(本地引擎),Key 可选 |

**一句话差异化定位**:

> **media-gen-mcp 是 AI-PPT 项目缺的那个"免费素材引擎 + MCP 入口"。** 头部 AI-PPT 项目把精力花在"LLM 怎么规划版式"和"怎么导出原生 PPTX"上,但**素材生产(图/图表/图/卡)要么付费要么手绘**——media-gen-mcp 用免费 AI 生图 + 确定性矢量引擎(Vega-Lite/D2/Satori/MathJax)把这层补齐,且是 MCP 原生,Claude 一句话直调。

---

## 5. media-gen-mcp 的可能演进路径(不实施,只分析)

基于本次调研,如果 media-gen-mcp 要从"素材全家桶"往"AI-PPT"延伸,有两条路(仅供参考,非本次任务范围):

**路线 A:做"素材层 MCP",让现有 AI-PPT 项目调它**(轻,推荐)
- 定位不变:继续做最强"图像/图表/图/卡 MCP"。
- 价值:任何 AI-PPT 项目(ppt-master 这种 skill,或未来的 MCP-PPT)都能把"生图/图表/图"外包给 media-gen-mcp,省 token + 省付费 key。
- 不碰 PPTX 组装(那是 ppt-master/presentation-ai 的主场,且 DrawingML 极复杂)。

**路线 B:加一个 `generate_slides` 工具,自己做 AI-PPT**(重,谨慎)
- 借鉴 ppt-master 的"中间表示"思想:定义一套受限 slide JSON,LLM 产结构 → media-gen-mcp 现有工具产素材 → deterministic 组装。
- 风险:DrawingML/PPTX 原生映射极复杂(ppt-master 用了整个 `svg_to_pptx.py` + canonical SVG 契约),不是加一个工具能搞定的。若做,建议先做 HTML 幻灯片(oh-my-ppt 路线,用 render_video 现有能力),PPTX 留后期。
- license 雷区:组装层若借鉴 banana/ai-to-pptx 代码会沾 GPL/AGPL——**必须 reimplement,不能 import**。

> 本次调研不推荐立即走路线 B,除非有明确的"PPTX 原生输出"需求。路线 A 与 media-gen-mcp 当前定位(图像全家桶)一致,且能立刻被 AI-PPT 生态复用。

---

## 6. 开放问题(给主控决策)

1. **media-gen-mcp 是否要补"PPT 组装"能力?** 还是坚守"素材层",让 ppt-master 这类 skill 调它?(路线 A vs B)
2. **若做 PPT,输出选 HTML(轻,oh-my-ppt 路线,复用 render_video)还是原生 PPTX(重,ppt-master 路线,DrawingML 复杂)?** 中间表示用受限 SVG 还是 slide JSON?
3. **ppt-master 的 canonical-SVG 中间语言是否值得借鉴其"受限子集 + deterministic 编译"思想**(不抄代码,学设计)?media-gen-mcp 的 `generate_interactive_diagram`(D2→HTML)已是类似范式(DSL→单文件 HTML),可否扩展到 slide DSL→HTML?
4. **"免费 AI 生图"是否真是可持续差异化?** Agnes/智谱免费层若调整,ppt-master 的"多 provider fallback"范式(已 P0 实现)是否足够对冲?要不要加本地 SD/ComfyUI 兜底?
5. **MCP-PPT 生态会不会有头部玩家入场?**(如 Anthropic 官方 / 智谱官方出 PPT MCP)media-gen-mcp 是先占位"素材 + MCP"还是直接做端到端?

---

## 7. 可核实证据索引

### 已读源码/文档(zread 实证)

| 仓库 | 已读文件 | 关键证据 |
|---|---|---|
| hugohe3/ppt-master | `README.md` / `skills/ppt-master/SKILL.md` / `workflows/generate-pptx.md` / `docs/technical-design.md` | 管线 Core Pipeline 原文、SVG 中间语言契约、image_gen/image_search 双路径、MIT license badge |
| Anionex/banana-slides | `README.md` + 仓库结构(`backend/services/*`、`utils/pptx_builder.py`) | nano banana pro 整页出图、AGPL-3.0 声明、Flask+React+SQLite 栈、tts_video_service |
| allweonedev/presentation-ai | `README.md` + 仓库结构(`src/ai/`、`constants/antv-templates.ts`、`types/pptxgenjs-bundle.d.ts`) | 38 主题、Together AI/FAL/Unsplash/Tavily、PptxGenJS partial、MIT badge |
| arcsin1/oh-my-ppt | `README.md` | Electron+React+TS、HTML-first、Anime.js、Ollama、30 风格 skill、MIT |
| veasion/AiPPT | `README.md` | "商用级"+docmee.cn 商业 SaaS、aippt-react MIT demo、伪开源定性 |
| SmartSchoolAI/ai-to-pptx | `README.md` | DeepSeek+PHP、GPL-3.0 全文条款、商业版功能清单、模板驱动 |

### GitHub Search API 实测(2026-07-23)

- `q=ai+ppt+generator` → top: Anionex/banana-slides(15.2k)、allweonedev/presentation-ai(2.9k)
- `q=aippt` → top: hugohe3/ppt-master(40.5k)、PPTist(9.2k)、veasion/AiPPT(1.9k)、oh-my-ppt(1.7k)、ai-to-pptx(1.5k)、OpenPPT(1.1k)
- `q=ppt+mcp` → slidev-mcp(91)、mcp-ppt(66)、ppt-mcp(47)、pptx-mcp(35)、mcp-2slides(31)

### media-gen-mcp 对照(本地只读)

- `/Users/wangdong/Documents/Project/Agnes AI接入/media-gen-mcp/README.md`:20 工具清单(12 生成 + 识别 + PDF + 交互图)、Agnes/智谱免费层、MIT、MCP server 形态
- 与本调研的对照点见 §4.2 差异化矩阵

### License 核查结论

- ✓ 商用安全(MIT):**ppt-master**、**presentation-ai**、**oh-my-ppt**、**slidev**、**marp**
- ⚠️ GPL 类(沾代码须开源,商用需授权):**banana-slides(AGPL-3.0)**、**ai-to-pptx(GPL-3.0)**
- ⚠️ 伪开源(开源 demo + 闭源商业):**veasion/AiPPT**
- media-gen-mcp 立场:**只借鉴设计范式,不 import GPL/AGPL 代码**;若组装 PPTX 必须 reimplement。
