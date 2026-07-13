<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-获取免费-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**面向 Claude Code 的免费文生图 + 文生视频 MCP Server**

文生图 / 图生图 / 文生视频 / 图生视频 / 关键帧动画 —— **全免费**(借 Agnes AI + 智谱 免费模型)

[English](README.en.md) | **中文**

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
claude mcp add media-gen-mcp npx media-gen-mcp
```

接入命令**不带 Key**(Key 在上面的 config 里)。`/mcp` 看到 `media-gen-mcp ✓ Connected` 即成功。

## ④ 用

在 Claude Code 里直接说:

> "生成一张橙猫趴木桌的写实图"
> "把这张图转水彩"
> "生成 5 秒海边视频"

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
