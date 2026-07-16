<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-获取免费-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**给 Claude Code 装上"出图超能力"——一句话生成图片 / 视频 / 图表 / 卡片 / 二维码**

</div>

---

## 你能用它做什么?

装上后,在 Claude Code 里**说一句话**,就能:

| 你说 | 你得到 |
|---|---|
| "生成一张橙猫武侠写实图" | 🖼️ AI 生成的写实图片 |
| "生成 5 秒海边视频" | 🎬 AI 生成的短视频 |
| "画个架构图:客户端 → API 网关 → 两个微服务" | 📐 清晰的矢量架构图 |
| "把这组销量数据画成柱状图" | 📊 数据可视化图表 |
| "渲染这个公式 `E=mc^2`" | ➗ 高清数学公式图 |
| "做张带 🚀 emoji 的渐变分享卡片" | 🎴 OG / 社交分享图(中文自动) |
| "给我一个 GitHub logo" | 🏷️ 矢量图标 |
| "生成一个二维码" | ▪️ QR 码 |
| "画个酷炫暗黑科技感架构图,要辉光" | ✨ 高保真 Chrome 渲染图 |

**全部只需说一句话。** Claude 自动选方法、自动生成代码、自动出图。你不需要学任何工具名或参数。

---

## 为什么用它?

- 🆓 **全免费**——AI 生图生视频走免费模型,结构化绘图完全本地
- 🧠 **零学习**——不用记工具名,说人话就行
- 📐 **确定性出图**——架构图/图表/公式/卡片,同一输入永远同一输出,内容可控
- 🇨🇳 **中文友好**——卡片自动渲染中文(内置字体);智谱模型中文原生
- 🔌 **不用装别的**——所有渲染引擎(D2/Graphviz/Vega/MathJax)都打包在内,不需要系统装 d2/dot/matplotlib
- 🌐 8 语言文档

---

## 30 秒接入

**① 装上**(只需一行):
```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

**② 说一句话**——在 Claude Code 里说"画个架构图"或"做张卡片"就行。

**就这样。** 画架构图/图表/公式/卡片/二维码**不需要任何 Key**,装上就能用。

> **想用 AI 生图/视频?** 多配一步 Key(免费):
> 新建 `~/.media-gen-mcp/config.json`:
> ```json
> { "providers": { "agnes": { "apiKey": "sk-你的key" } } }
> ```
> 到 https://platform.agnes-ai.com/ 注册拿免费 Key。详见 [开通指引](doc/Agnes%20开通指引.md)。

---

## 能力详解

### 🤖 AI 生成(免费模型 · 在线)

用 Agnes AI 或智谱的免费模型:
- **文生图 / 图生图**——写实、插画、概念图
- **文生视频 / 图生视频 / 关键帧动画**——智能异步(长视频后台生成,完成通知)
- 指定厂商/模型:"用**智谱 cogview-4** 画一张" / "用 **agnes** 生成视频"

<details>
<summary>📖 Provider 对比</summary>

| | 默认 | 图像(免费) | 视频(免费) | 特点 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | 全免费、写实质感 |
| **zhipu** | | cogview-3-flash | cogvideox-flash | 4K/60fps、中文原生 |

切换:`defaultProvider: "zhipu"`,或按模态 `defaultImageProvider`/`defaultVideoProvider`。见 [横评](doc/Agnes_vs_Zhipu_横评.md)。
</details>

### 📐 结构化绘图(本地 · 确定性 · 免 Key)

以下能力**不调用 AI、不联网、确定性出图**(SVG 矢量高清):

| 能力 | 引擎(全部内置,不需要系统安装) | 说明 |
|---|---|---|
| **结构图** | D2 + Graphviz | 架构/流程/时序/类图/ER/脑图,自动布局 |
| **数据图表** | Vega-Lite | 柱/线/饼/面积/散点,Claude 自动从数据生成 |
| **数学公式** | MathJax | LaTeX → SVG,字形内嵌 |
| **分享卡片** | Satori | OG/海报/引言卡(中文+渐变+emoji+辉光自动) |
| **二维码** | qrcode | URL/文本 → SVG/PNG |
| **矢量图标** | Iconify | 20 万+ 图标(联网取,缓存) |
| **酷炫 SVG** | Chrome / resvg | 手写 SVG(辉光/滤镜/景深)→ Chrome 高保真渲染 |

<details>
<summary>📖 卡片能做什么?</summary>

- 5 种模板:og(左对齐层次)/ quote(引言,引号可左右夹)/ minimal(极简)/ hero(大字展示+光斑)/ panel(玻璃面板)
- 渐变标题文字 + 辉光 + 模糊光斑纵深
- 内嵌 logo / 圆形 avatar
- 自动中文(Noto Sans SC 离线)+ 自动彩色 emoji(落盘缓存,断网可用)
- 自定义尺寸(默认 1200×630 OG 标准)
</details>

<details>
<summary>📖 酷炫 SVG 渲染是什么?</summary>

D2 引擎不支持 SVG 滤镜(feGaussianBlur 辉光),所以当你想要"酷炫暗黑科技感、辉光、景深"这种效果时:
1. Claude 手写 SVG(带 feGaussianBlur 等滤镜)
2. 调 `render_svg` 工具
3. 工具自动选后端:有 `<filter>` + 系统 Chrome 可用 → Chrome(100% 滤镜保真);否则 → resvg(92%,轻量)
</details>

---

## ❓ 常见问题

**视频慢?** 3–18s,约 1–3 分钟。省略 `wait` 自动异步。
**撞 429?** 内置 62s 串行 + 自动学习真实限流。
**画图/图表要 Key?** 不要。装上就能画。
**卡片能做中文?** 能。内置中文字体,自动检测渲染,无需配置。
**Mermaid 支持吗?** 不支持(需浏览器)。用 D2 替代(覆盖流程/时序/类图/ER/脑图)。
**npx 连不上?** 全局安装兜底:`npm i -g media-gen-mcp-server` → `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`

---

## 📚 更多

- [架构要求清单](doc/架构要求清单.md)——项目架构规范(持续维护)
- [Agnes 开通指引](doc/Agnes%20开通指引.md) · [智谱开通指引](doc/Zhipu%20开通指引.md) · [Provider 横评](doc/Agnes_vs_Zhipu_横评.md)
- [npm 包](https://www.npmjs.com/package/media-gen-mcp-server) · [GitHub](https://github.com/wangdong233/media-gen-mcp)

---

## 💝 支持作者

<div align="center">

微信 | 支付宝
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="微信"> | <img src="doc/support-alipay.jpg" height="200" alt="支付宝">

</div>

⭐ Star / Issue / PR 都是对作者的支持。

## License

[MIT](LICENSE)
