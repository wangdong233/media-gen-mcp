<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-获取免费-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**面向 Claude Code 的多模态生图 MCP Server**

AI 生图 + 结构化生图,一个 server 全覆盖:文生图 / 图生图 / 文生视频 / 图生视频 / 关键帧动画(借 Agnes AI + 智谱 免费模型)**+ 结构图 / 数据图表 / 二维码**(本地确定性渲染,免 Key)

[English](README.en.md) | **简体中文** | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① 获取免费 Key

到下面任一家(或都)注册,拿一个免费 API Key:

| Provider | 免费 | 申请 |
|---|---|---|
| **Agnes AI**(默认) | 文生图 + 文生视频 全免费 | https://platform.agnes-ai.com/ → 注册 → API Keys |
| **智谱 BigModel**(可选,4K / 中文) | cogview-3-flash 图 + cogvideox-flash 视频 永久免费 | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → 实名 → 创建 Key |

> 详细图文步骤:[doc/Agnes 开通指引](doc/Agnes%20开通指引.md) · [doc/Zhipu 开通指引](doc/Zhipu%20开通指引.md)

## ② 配置(一次性)

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

## ③ 接入 Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

接入命令**不带 Key**(Key 在上面的 config 里)。`/mcp` 看到 `media-gen-mcp ✓ Connected` 即成功。

## ④ 用

在 Claude Code 里直接说(自动路由到对应 provider/模型):

| 场景 | 怎么说 | 说明 |
|---|---|---|
| **默认** | "生成一张橙猫写实图" / "生成 5 秒海边视频" | 走配置的 defaultImageProvider / defaultVideoProvider |
| **指定厂商** | "用**智谱**画张图" / "用 **agnes** 生成视频" | 临时切 provider,不改配置 |
| **指定模型** | "用 **cogview-4** 画一张" / "用 **agnes-video-v2.0** 生成" | 用某具体模型(更高质量等) |
| **厂商 + 模型** | "用**智谱 cogvideox-3** 生成 4K 视频" | 精确指定(4K / 首尾帧) |
| **图生图** | "把这张图转水彩" | 参考图 → 新图 |
| **图生视频** | "把这张图变成视频" | 单图 → 视频 |
| **关键帧** | "这两张图做个过渡动画" | 多图 → 平滑过渡 |

> 不指定就走默认;指定厂商/模型只影响本次调用,**不改 config**。

## ④ 本地结构化生图(免 Key,确定性)

以下几类**不调用 AI**¹,Claude 生成 DSL/JSON/LaTeX/字段 → 本地渲染成 SVG/PNG(矢量高清):

| 工具 | 怎么说 | 产出 |
|---|---|---|
| **结构图** `generate_diagram` | "画一个架构图:客户端 → API 网关 → 两个微服务" | 架构 / 时序 / 流程 / 类图 / ER / 脑图(**D2** DSL)或 **Graphviz**(DOT)→ SVG |
| **数据图表** `generate_chart` | "把这组销量数据画成柱状图" | 柱 / 线 / 饼 / 面积 / 散点(Vega-Lite → SVG) |
| **数学公式** `generate_formula` | "渲染这个公式:`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" | LaTeX → SVG(MathJax,字形内嵌,无需字体) |
| **分享卡片** `generate_card` | "生成一张**紫蓝渐变**背景、带 🚀 emoji 的分享卡片" | OG/social/引言卡片(Satori → PNG,默认 1200×630,**中文自动支持**,**纯色/渐变背景**,**彩色 emoji**) |
| **矢量图标** `generate_icon` | "给我一个 GitHub 的 logo 图标" | 20 万+ 图标任选(Iconify,`prefix:name`) |
| **二维码** `generate_qrcode` | "生成一个指向 https://... 的 QR 码" | SVG / PNG(纯本地,零联网) |

> ¹ 除**图标**(Iconify API 取图)与**卡片默认字体**(首次从 CDN 取并缓存到 `~/.media-gen-mcp/fonts/`)需联网外,其余全本地确定性;卡片传 `fontPath` 即可完全离线。**卡片中文**:内置 Noto Sans SC(随包离线,自动检测中文并回退),无需 fontPath。结构图用 [D2 语法](https://d2lang.com)、图表用 [Vega-Lite](https://vega.github.io/vega-lite)、公式用 [LaTeX](https://www.latex-project.org)、图标浏览 [icon-sets.iconify.design](https://icon-sets.iconify.design) —— Claude 会自动生成对应源码。

## Providers

| | 默认 | 图像(免费) | 视频(免费) | 特点 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | 全免费、写实质感、原生音画 |
| **zhipu**(可选) | | cogview-3-flash | cogvideox-flash | 4K/60fps、中文原生、国内合规 |

切换:`defaultProvider: "zhipu"`,或按模态 `defaultImageProvider`/`defaultVideoProvider`,或单次工具传 `provider`。不知道选谁?见 [横评](doc/Agnes_vs_Zhipu_横评.md)。

## 📌 配置项(进阶,一般用不到)

**默认 provider 三级回退**(工具参数 > 按模态 > 全局):

| 字段 | 默认 | 说明 |
|---|---|---|
| `defaultProvider` | `agnes` | 全局默认(最终回退,两个模态都没指定时用它) |
| `defaultImageProvider` | 同 `defaultProvider` | 图像模态默认(`generate_image` 走它) |
| `defaultVideoProvider` | 同 `defaultProvider` | 视频模态默认(`create_video` / `get_video` 走它) |

例如 `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → 图走 agnes、视频走智谱。不写后两个字段则全部回退到 `defaultProvider`。

各 provider 连接配置:

| 字段 | 默认 | 说明 |
|---|---|---|
| `providers.<name>.apiKey` | — | **必填**,每个 provider 一个 |
| `providers.<name>.models.image.default` | provider 内置 | 默认图像模型 |
| `providers.<name>.models.video.default` | provider 内置 | 默认视频模型 |
| `outDir` | 会话目录/output | 输出目录(可被工具参数覆盖) |

> 限流自适应(rateLimits / rateLimitTtlMs)等高级字段详见 [doc/](doc/)。

## FAQ

**视频慢?** 3–18s,生成约 1–3 分钟。省略 `wait` 自动异步,完成通知。
**帧数?** 传 `durationSeconds` 自动选(5/10/18s)。Agnes 仅允许 81/121/161/241/441。
**撞 429?** 内置 62s 串行 + 自动学习真实限流。
**没读到 config?** 必须在 `~/.media-gen-mcp/config.json`(npx 装包到缓存,项目内不可用)。

## 架构 + 文档

Provider 可插拔(agnes + zhipu,新增 provider 零改工具层)。更多见 [doc/](doc/):

- [doc/Agnes 开通指引](doc/Agnes%20开通指引.md) · [doc/Zhipu 开通指引](doc/Zhipu%20开通指引.md) · [doc/Agnes vs 智谱 横评](doc/Agnes_vs_Zhipu_横评.md)

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
