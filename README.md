<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-获取免费-key)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Claude Code 的全能生图 MCP —— AI 出图 + 本地结构化绘图,一个 server 全包**

文生图 / 图生图 / 文生视频 / 图生视频 / 关键帧动画 · 结构图 / 图表 / 公式 / 卡片 / 图标 / 二维码

[English](README.en.md) | **简体中文** | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ 特点

- 🎨 **AI 出图全免费**:文生图、图生图、文生视频、图生视频、关键帧动画——借 **Agnes AI + 智谱** 的免费模型,零成本。
- 📐 **结构化本地绘图,确定性**:结构图、数据图表、数学公式、分享卡片、矢量图标、二维码——**SVG 矢量高清**,不调用 AI、可无限放大、文字清晰、内容可控。
- 🧠 **一个心智模型**:用户只说"生成一张图",Claude 自动判别走 AI 还是本地引擎、自动生成对应 DSL/JSON/LaTeX,**步骤零增多**。
- 🌏 **开箱即用的细节**:卡片**自动支持中文**(内置 Noto Sans SC 离线)、**纯色/渐变背景**、**彩色 emoji**;结构图支持 **D2 + Graphviz** 双引擎。
- 🔌 **可插拔**:provider 与渲染引擎皆可扩展,新增零改工具层;按模态默认路由 + 限流自学习。
- 🆓 **结构化工具免 Key**:`claude mcp add` 装上即可用 6 个本地工具,**不配 AI Key 也能画图/图表/卡片/二维码**。
- 🌐 8 语言 README · MIT · Node ≥18

---

## 🛠️ 10 个工具一览

### 🤖 AI 生成(在线 · 免费)

| 工具 | 能力 |
|---|---|
| `generate_image` | **文生图** / **图生图**(参考图 → 新图) |
| `create_video` | **文生视频** / **图生视频** / **关键帧动画**(智能同步/异步) |
| `get_video` | 轮询 + 下载视频任务 |
| `list_models` | 列各 provider 模型与视频约束 |

### 📐 结构化渲染(本地 · 确定性 · 大多免 Key)

| 工具 | 产出 | 引擎 |
|---|---|---|
| `generate_diagram` | 架构 / 时序 / 流程 / 类图 / ER / 脑图 | **D2** DSL · **Graphviz**(DOT) |
| `generate_chart` | 柱 / 线 / 饼 / 面积 / 散点 | Vega-Lite |
| `generate_formula` | LaTeX 数学公式(字形内嵌,无需字体) | MathJax |
| `generate_card` | OG / 分享 / 引言卡片(默认 1200×630;模板 og/quote/minimal/**hero**/**panel**;**中文/渐变背景/彩色 emoji 自动**、**渐变标题+辉光**) | Satori + resvg |
| `generate_icon` | 20 万+ 矢量图标(`prefix:name`) | Iconify |
| `generate_qrcode` | 二维码 | qrcode |

> 6 个结构化工具:**4 个完全离线**(diagram / chart / formula / qrcode)。`generate_card` 的默认 Latin 字体(Inter)首次从 CDN 取并缓存到 `~/.media-gen-mcp/fonts/`(之后离线,或传 `fontPath` 立即离线),CJK 字体(Noto Sans SC)已**内置离线**;但卡片 **emoji**(twemoji)与 `generate_icon`(Iconify)**需联网**(仅缓存,未内置)。AI 生成工具始终在线。

---

## 🚀 快速开始

### ① 获取免费 Key(用 AI 生成才需要;只画结构图可跳过)

到下面任一家(或都)注册,拿一个免费 API Key:

| Provider | 免费 | 申请 |
|---|---|---|
| **Agnes AI**(默认) | 文生图 + 文生视频 全免费 | https://platform.agnes-ai.com/ → 注册 → API Keys |
| **智谱 BigModel**(可选,4K / 中文) | cogview-3-flash 图 + cogvideox-flash 视频 永久免费 | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → 实名 → 创建 Key |

> 详细图文步骤:[doc/Agnes 开通指引](doc/Agnes%20开通指引.md) · [doc/Zhipu 开通指引](doc/Zhipu%20开通指引.md)

### ② 配置(一次性)

新建 `~/.media-gen-mcp/config.json`,填 Key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-你的agnes-key" },
    "zhipu": { "apiKey": "你的智谱-key" }
  }
}
```

只配 agnes 也行(删掉 zhipu 那行)。不填 `models` 用内置默认模型即可。

### ③ 接入 Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

接入命令**不带 Key**(Key 在上面的 config 里)。`/mcp` 看到 `media-gen-mcp ✓ Connected` 即成功。

---

## 💬 怎么用

在 Claude Code 里直接说,**自动路由**,无需记工具名:

**AI 生成:**

| 场景 | 怎么说 |
|---|---|
| 默认 | "生成一张橙猫写实图" / "生成 5 秒海边视频" |
| 指定厂商 | "用**智谱**画张图" / "用 **agnes** 生成视频" |
| 指定模型 | "用 **cogview-4** 画一张" / "用 **agnes-video-v2.0** 生成" |
| 图生图 / 图生视频 | "把这张图转水彩" / "把这张图变成视频" |
| 关键帧动画 | "这两张图做个过渡动画" |

**结构化绘图:**

| 场景 | 怎么说 |
|---|---|
| 结构图 | "画一个架构图:客户端 → API 网关 → 两个微服务"(D2)或 "用 DOT 画个依赖图"(Graphviz) |
| 数据图表 | "把这组销量数据画成柱状图" |
| 公式 | "渲染这个公式:`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" |
| 分享卡片 | "给这篇文章生成一张**紫蓝渐变**、带 🚀 emoji 的 OG 卡片" |
| 图标 | "给我一个 GitHub 的 logo 图标" |
| 二维码 | "生成一个指向 https://... 的 QR 码" |

> 指定厂商/模型只影响本次调用,**不改 config**。结构图用 [D2 语法](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/)、图表用 [Vega-Lite](https://vega.github.io/vega-lite)、公式用 [LaTeX](https://www.latex-project.org)、图标浏览 [icon-sets.iconify.design](https://icon-sets.iconify.design)——Claude 自动生成源码。

> **Mermaid**:本 server 的 `generate_diagram` 支持 **D2 与 Graphviz**;Mermaid 进程内渲染需浏览器/Chromium(不适合确定性 MCP),故未支持——用 D2(覆盖 flowchart/sequence/class/er/mindmap)或 Graphviz 替代。

---

## 📡 Providers

| | 默认 | 图像(免费) | 视频(免费) | 特点 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | 全免费、写实质感、原生音画 |
| **zhipu**(可选) | | cogview-3-flash | cogvideox-flash | 4K/60fps、中文原生、国内合规 |

切换:`defaultProvider: "zhipu"`,或按模态 `defaultImageProvider`/`defaultVideoProvider`,或单次工具传 `provider`。不知道选谁?见 [横评](doc/Agnes_vs_Zhipu_横评.md)。

---

## ⚙️ 配置项(进阶,一般用不到)

**默认 provider 三级回退**(工具参数 > 按模态 > 全局):

| 字段 | 默认 | 说明 |
|---|---|---|
| `defaultProvider` | `agnes` | 全局默认(最终回退) |
| `defaultImageProvider` | 同上 | 图像模态默认(`generate_image`) |
| `defaultVideoProvider` | 同上 | 视频模态默认(`create_video`/`get_video`) |

例如 `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → 图走 agnes、视频走智谱。

各 provider 连接配置:`providers.<name>.apiKey`(必填)、`providers.<name>.models.{image,video}.default`、`outDir`(输出目录,默认 `会话目录/output`)。

> 限流自适应(rateLimits / rateLimitTtlMs,429 自动学习真实限流 + TTL 过期降级)等高级字段详见 [doc/](doc/)。

---

## ❓ FAQ

**视频慢?** 3–18s,生成约 1–3 分钟。省略 `wait` 自动异步(预估 >60s 返回 handle,完成通知)。
**帧数?** 传 `durationSeconds` 自动选(5/10/18s)。Agnes 仅允许 81/121/161/241/441。
**撞 429?** 内置 62s 串行 + 自动学习真实限流。
**结构化工具要 Key 吗?** 不要。6 个本地工具装上即用;只 AI 生成需要 Key。
**卡片中文/emoji/渐变?** 内置 CJK 字体(自动)、twemoji 彩色 emoji(自动,**落盘缓存,断网也能用**)、`bg` 传 CSS `linear-gradient(...)` 即渐变背景。
**卡片酷炫特效?** `titleGradient`(标题渐变文字)、`glow`(标题辉光)、`hero` 模板(模糊光斑纵深)、`panel` 模板(玻璃面板:边框/圆角/阴影)。均 Satori 进程内确定性渲染,无需浏览器。
**没读到 config?** 必须在 `~/.media-gen-mcp/config.json`(npx 装包到缓存,项目内不可用)。

---

## 🏗️ 架构 + 文档

- **Provider 可插拔**(agnes + zhipu,新增 provider 零改工具层);**引擎可插拔**(DiagramEngine 与 MediaProvider 并行,互不污染)。
- 更多见 [doc/](doc/):[Agnes 开通指引](doc/Agnes%20开通指引.md) · [Zhipu 开通指引](doc/Zhipu%20开通指引.md) · [Agnes vs 智谱 横评](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 支持作者

如果 media-gen-mcp 帮到你,欢迎请作者喝杯咖啡 ☕

<div align="center">

微信 | 支付宝
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="微信"> | <img src="doc/support-alipay.jpg" height="220" alt="支付宝">

</div>

或 ⭐ Star、提 Issue / PR —— 都是对作者的支持。

## License

[MIT](LICENSE)
