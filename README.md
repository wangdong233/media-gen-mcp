# media-gen-mcp

> Claude Code 的「图像全家桶」MCP —— 造图 · 画想法 · 看懂图,16 个能力一个装好,纯免费。

![Version](https://img.shields.io/badge/version-0.11.0-blue) ![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Free](https://img.shields.io/badge/pricing-free-success) ![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![MCP](https://img.shields.io/badge/MCP-compatible-purple)

**给 Claude Code 装一次,以后所有图像活儿都是一句话。** 设计师出图、程序员画架构图、运营做分享卡、分析师抠发票表格 —— 16 个工具塞进 1 个 MCP,**生图/视频 + 识别 + 画图/卡片/二维码**全覆盖,**全免费**(Agnes/智谱免费层 + 本地确定性引擎双驱动)。别再为每件事装一个 MCP、写一段 Python、调一家付费 API 了。

🌐 Languages: **简体中文** · English · 日本語 · Español · Français · Deutsch · Русский · Português

---

## 🎯 你说一句话,得到什么

| 你说 …… | 你得到 |
|---|---|
| "画只赛博朋克猫,霓虹辉光" | AI 写实图,落盘到 `output/` |
| "生成 5 秒海边日落视频" | AI 视频 MP4(异步,完成后通知) |
| "画个架构图:客户端 → API 网关 → 订单服务 + 支付服务" | 矢量 SVG 架构图 |
| "把这组销售数据画成柱状图" | Vega-Lite 高清图表 |
| "做个指向 github.com 的二维码" | 矢量二维码 SVG/PNG |
| "把 E=mc² 渲染成高清公式" | MathJax 矢量公式 |
| "做张深色渐变分享卡,标题 7 月新品 🚀" | Satori OG 卡(中文 + emoji 自动) |
| "识别这张发票截图里的表格" | HTML/Markdown 表格(0.11.0 新) |
| "把这张柱状图读成数据点" | 结构化数据(0.11.0 新) |
| "描述一下这张图里有什么" | VLM 自然语言描述(0.11.0 新) |

> 不用学工具名,不用装系统依赖,**Claude 自动选**。

---

## 🚀 60 秒上手(零 Key 也能跑)

核心思路:**结构化工具(画图 / 图表 / 卡片 / 二维码 / 公式)全是本地引擎,不调 AI,装上即用**。AI 生图/视频才需要免费 Key —— 这是把"第一张图"提前到注册之前的转化杀手锏。

### 0–20 秒｜一行接入

```bash
# ① 一行装上(不带 Key,30 秒)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# ② 重启 Claude Code → 输入 /mcp → 看到 media-gen-mcp ✓ Connected 即成功
```

### 20–40 秒｜免 Key 立刻出第一张图(关键爽点)

直接对 Claude 说一句:

```
> 画个架构图:客户端 → API 网关 → 订单服务 + 支付服务 → 数据库,深色科技风
```

→ 矢量 SVG 自动落盘到 `output/`,打开就能用。**你还没注册任何 Key,已经拿到结果。**

下面这些也都是零 Key 零联网即时出:

- 「做个指向 github.com 的二维码」
- 「把 E=mc² 渲染成高清公式图」
- 「做张深色科技风的分享卡,标题:Claude Code 图像全家桶」

### 40–60 秒｜想要 AI 写实图 / 视频,再加免费 Key(可选)

```bash
# ① 拿免费 Key(推荐 Agnes,默认 provider)
#    https://platform.agnes-ai.com/ → 注册 → API Keys → 复制 sk-xxx
#    (智谱 cogview-3-flash / cogvideox-flash 也永久免费,可二选一或都配)

# ② 写到 ~/.media-gen-mcp/config.json(只配一家也行)
{
  "providers": {
    "agnes": { "apiKey": "sk-你的agnes-key" }
  }
}

# ③ 回 Claude Code 说:"画只赛博朋克橙猫,写实风"
#    → AI 写实图落盘。视频同理:"生成 5 秒海边日落视频"
```

> 💡 不想用 npx?兜底全局装:`npm i -g media-gen-mcp-server` → `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`

---

## 🧰 能力全家桶(按你「想干什么」分,不按技术分)

> Claude 会根据你的意图自动路由,**你不用记哪个工具**。下面工具名只是给老用户的索引。

### 🎨 我要「造张图」(从无到有)

- **AI 写实图 / 插画 / 概念图 / Logo 草图** → `generate_image`(文生图 + 图生图)
- **AI 视频**(文生 / 图生 / 关键帧动画,3-18s) → `create_video`(智能异步,长视频后台生成)+ `get_video`(取片)
- **查可用模型 / 约束** → `list_models`
- **矢量图标**(20 万+ Iconify,mdi/lucide/fa/logos) → `generate_icon`

### 📖 我要「读懂一张图」(把图变数据 · 0.11.0 新增)

- **OCR 文字**(验证码 / 数字 / 中文文档) → `extract_text`(默认 tesseract 进程内,零配置)
- **表格 → HTML/Markdown**(发票 / 报表 / 扫描件) → `extract_table`(清晰报错,不静默降级)
- **图表 → 数据点**(截图里的柱/线/饼图) → `analyze_chart`
- **图像描述 / VQA / 手写 / 公式识别** → `describe_image`

### 📐 我要「画结构图」(把想法变清晰,确定性矢量,免 Key)

- **架构 / 流程 / 时序 / 类图 / ER / 思维导图** → `generate_diagram`(D2 + Graphviz 内置,免装 d2/dot)
- **数据图表**(柱/线/饼/面积/散点) → `generate_chart`(Vega-Lite 内置,Claude 从数据/CSV 自动生成 spec)

### 🎴 我要「做卡片 / 海报」(发出去好看)

- **OG 图 / 分享卡 / 引言卡 / 封面 / 海报** → `generate_card`(Satori;中文+渐变标题+辉光+emoji+logo 内嵌全自动,5 模板:`og`/`quote`/`minimal`/`hero`/`panel`)
- **二维码**(URL / 文本) → `generate_qrcode`
- **数学公式**(LaTeX → SVG) → `generate_formula`(MathJax 内置)

### ✨ 我要「酷炫 SVG / 动画视频」(确定性,代码驱动)

- **手写 SVG**(辉光 / 景深 / 科技感) → `render_svg`(有 `<filter>` 自动走 Chrome 100% 保真,否则 resvg 92% 轻量)
- **HTML/CSS/GSAP 动画 → MP4/GIF/WebM** → `render_video`(逐帧 seek,同输入同输出,适合产品片头 / 动效 / 品牌动画)

> **关键差异**:前 2 类(造图 / 读图)走联网或 AI;后 4 类是本地确定性引擎,**免 Key、矢量、可版本控制、可批量**。

---

## ⚔️ 为什么不用别的方案

| 维度 | 装 N 个 MCP | 各自调 API | Pillow + matplotlib | 手动用网站 | **media-gen-mcp** |
|---|---|---|---|---|---|
| 安装成本 | 5-10 个 server × N 次配 | SDK × N + 胶水代码 | Python + 浏览器 + 字体 + 图表库 | 切应用 | **1 行 npx,1 份 config** |
| 用法 | 各家参数各异 | 自己拼 SDK | 写脚本 | 手动点 | **说自然语言,Claude 自动选** |
| 免费程度 | 各家不一 | 部分免费 | 全免费但手动 | 多数免费 | **全免费**(Agnes+智谱免费层 + 本地 WASM + Apache 自托管) |
| 失败兜底 | 单点挂 = 任务挂 | ❌ | ❌ | ❌ | **provider 自动 fallback**(agnes↔zhipu↔tesseract↔paddle↔vlm + 60s 熔断) |
| 输出确定性 | 看各家 | API 抽奖 | ✅ | ❌ | **结构化工具同输入同输出** |
| 可版本控制 | 部分 | ❌ | ✅ | ❌ | **SVG 矢量直接 git** |
| 适合谁 | 只要单一能力 | 工程化深度定制 | 离线批处理脚本 | 一次性需求 | **Claude Code 图像全场景** |

一句话差异化:**别人给你一个工具,这个给你一整套图像工作流 —— 而且免费、本地优先、Claude 自动选**。

---

## 👥 这是给谁的

- **Claude Code 重度用户** —— 每周都要做几次图像任务,受够为每件事装一个 MCP、记一套参数。
- **写技术文档 / 博客的开发者** —— 反复需要架构图、时序图、ER、数据图、公式,不想学 graphviz/matplotlib/PS,也不想离开工作流。
- **个人开发者 / 独立产品** —— 关注成本(全免费)、关注可控(同输入同输出)、不想为图像任务单独搭后端或买 SaaS。
- **数据分析师 / 财务 / 法务** —— 双向场景:把数据快速画成图表,以及从截图/发票里反向抽数据点(OCR + 表格 + 图表识别)。
- **运营 / 内容创作者 / 公众号作者** —— 分享卡 / OG 图 / 海报 / 二维码 / 社交物料,中文+彩色 emoji+渐变开箱即用,想要写实配图再 `generate_image`。
- **OCR / 文档数字化工作流** —— 发票表格转 HTML、验证码识别、中文文档数字化。

> **不太适合**:不用 Claude Code 的用户;只要单一能力且已搭好 pipeline 的工程化团队;需要付费商用模型 / 训练微调 / 实时视频 OCR 的场景(本项目刻意不做,维持纯免费)。

---

## 🔌 Provider 与配置详解(进阶)

### AI 生成 Provider

| Provider | 生图 | 生视频 | 免费层 | 推荐场景 |
|---|---|---|---|---|
| **Agnes**(默认)| ✅ | ✅ | ✅ 永久免费 | 文生图 + 视频,默认首选 |
| **智谱 Zhipu** | ✅ cogview-3-flash / cogview-4 | ✅ cogvideox-flash | ✅ 永久免费 | 4K / 中文原生优化 |

**开通**:
- Agnes → https://platform.agnes-ai.com/ → 注册 → API Keys
- 智谱 → https://open.bigmodel.cn/ → 注册 → API Keys

### config.json 完整 schema

路径:`~/.media-gen-mcp/config.json`(缺这个文件**不会崩** —— 结构化工具与 tesseract 兜底照常工作)

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-你的agnes-key" },
    "zhipu": { "apiKey": "你的智谱-key" }
  },
  "defaultProvider": "agnes",
  "defaultVisionProvider": "tesseract",
  "outDir": "/absolute/path/to/output"
}
```

### 自动 Fallback 机制

任一 provider 失败时,handler 层按能力矩阵自动切换:

- **生成侧**:agnes ↔ zhipu
- **识别侧**:tesseract(进程内兜底)→ paddle → vlm
- **铁律**:`poll`(轮询取视频)不 fallback,避免 provider 错位
- **软熔断**:主家 60s 内连续失败 → 自动切备用家,你零感知、零账单
- **能力谈判 + spec 重吸附**:fallback 时按备用 provider 的能力重新对齐请求规格

---

## 🔍 图像识别部署(进阶 · 可选)

> 默认 `extract_text` 走进程内 **tesseract WASM,零配置直接用**。要中文 SOTA / 表格 / 图表再自托管以下任一。

### tesseract(默认,零配置)

无需任何操作,装上 MCP 即可用。适合英文 / 验证码 / 数字 / 简单文档。

### PaddleOCR / PaddleX(中文 SOTA,Apache 2.0)

```bash
pip install paddlex paddlepaddle
paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
```

然后在 `config.json` 的 `providers.paddle.baseUrl` 填 `http://127.0.0.1:8080`。

### vLLM + Qwen2.5-VL(VLM 通用,Apache 2.0)

适合 VQA / 手写 / 公式 / 复杂场景理解。自行部署 vLLM 后填 `providers.vlm.baseUrl`。

> 🛡️ **License 干净**:识别侧刻意避开 AGPL / GPL / 阈值 / 署名 / 商用申请陷阱 —— tesseract.js + PaddleOCR + Qwen2.5-VL 全 Apache,企业能直接商用。

---

## 📦 16 工具速查表

| 工具 | 类别 | 引擎 | 需 Key? |
|---|---|---|---|
| `generate_image` | AI 生成 | Agnes / 智谱 cogview | ✅ |
| `create_video` | AI 生成 | Agnes / 智谱 cogvideox | ✅ |
| `get_video` | AI 生成 | (异步轮询) | ✅ |
| `list_models` | AI 生成 | (查询约束) | ✅ |
| `extract_text` | 识别 | tesseract / paddle / vlm | ❌(默认零配置) |
| `extract_table` | 识别 | paddle PP-StructureV3 | ❌ |
| `analyze_chart` | 识别 | paddle PP-Chart2Table / vlm ChartQA | ❌ |
| `describe_image` | 识别 | paddle PaddleOCR-VL / vlm Qwen2.5-VL | ❌ |
| `generate_diagram` | 结构化 | D2 + Graphviz(内置 WASM) | ❌ |
| `generate_chart` | 结构化 | Vega-Lite(内置) | ❌ |
| `generate_formula` | 结构化 | MathJax(内置) | ❌ |
| `generate_card` | 结构化 | Satori(内置) | ❌ |
| `generate_icon` | 结构化 | Iconify(CDN 缓存) | ❌ |
| `generate_qrcode` | 结构化 | 内置 | ❌ |
| `render_svg` | 结构化 | resvg / Chrome(自动选) | ❌ |
| `render_video` | 结构化 | headless Chrome + ffmpeg | ❌ |

---

## ❓ FAQ

**Q:视频生成为什么这么慢?**
A:AI 视频走异步,5s 视频约 1-3 分钟,18s 视频可能 5-10 分钟。`create_video` 智能判断:预估 ≤60s 同步等、>60s 异步返回 handle,完成后自动通知。可用 `get_video` 主动轮询取片。

**Q:识别要不要 Key?**
A:**不要**。`extract_text` 默认走进程内 tesseract WASM,零配置。要中文 SOTA 才自托管 paddle(也是 Apache 免费)。

**Q:和 paddleocr-mcp 啥区别?**
A:本 MCP 直连 PaddleX 原生 REST(走 `baseUrl`),不走 MCP-over-HTTP 转发;且 fallback 链 tesseract↔paddle↔vlm,任一挂自动切,你零感知。

**Q:支持 Mermaid 吗?**
A:`generate_diagram` 不支持 mermaid(需要浏览器)。用 D2 或 Graphviz 代替,能力等价且更稳,矢量输出。

**Q:中文 / emoji / 渐变能正常出吗?**
A:`generate_card` 通过内置 Noto Sans SC + Satori 全自动支持中文、日文汉字、彩色 emoji、渐变标题、辉光效果。无需额外字体配置。

**Q:酷炫 SVG(辉光 / 景深)怎么保证保真?**
A:`render_svg` 自动检测 SVG 是否含 `<filter>` / `<feGaussianBlur>`,有则走 Chrome 100% 保真,无则 resvg 92% 轻量。

**Q:踩 429 / 限流?**
A:免费层有 RPM 限制。配两家 provider(agnes + zhipu)后自动 fallback,基本无感。

**Q:视频帧数限制?**
A:随分辨率递减 —— 1080p ≤ 241 帧(约 10s),720p 可达 441 帧(约 18s)。`list_models` 可查实时约束。

**Q:npx 连不上 / 启动慢?**
A:兜底全局装 `npm i -g media-gen-mcp-server`,再用 `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`。

**Q:能用敏感词 / 武器 / 战争题材吗?**
A:真实武器词会触发内容过滤。改用科幻设定词(如"未来战甲"、"机甲")可绕过,效果等同。

---

## 🏗️ 架构

- **Provider 可插拔**:agnes / zhipu 实现 `capabilities` + `health` + `tier` + `notifyUnavailable` 接口,handler 按能力矩阵路由
- **Engine 可插拔**:D2 / Graphviz / Vega-Lite / MathJax / Satori / resvg / Chrome 全打包进 npm 包,首次取 CDN 后本地缓存
- **Fallback 双层**:provider 层(生成)+ provider 层(识别),60s 软熔断 + 能力谈判 + spec 重吸附
- **本地优先**:结构化工具不联网、不调 AI、同输入同输出(逐字节一致,可 git)
- **核心认知**:keep-alive 句柄在 server 进程内无害;独立脚本场景必须 `unref` + active refcount

📄 完整文档见 `doc/` 目录(Agnes/智谱开通指引、provider 横评、交付分析)。

---

## 💝 支持作者

如果这个 MCP 帮到你,欢迎:

- ⭐ Star 这个仓库(让更多人看到)
- 🐛 [提 Issue](../../issues) 报 bug / 提需求
- 🔀 [发 PR](../../pulls) 贡献代码

<p align="center"><em>微信 / 支付宝赞赏码见 <code>docs/support</code></em></p>

---

## 📄 License

**MIT** —— 主体代码随便用。

识别侧依赖全栈 **Apache 2.0**(tesseract.js + PaddleOCR + Qwen2.5-VL),企业商用无 license 风险。

---

<p align="center">
  <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
  <sub>装一次,以后所有图像活儿都是一句话。</sub>
</p>
