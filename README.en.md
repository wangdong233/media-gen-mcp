<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**A free text-to-image + text-to-video MCP server for Claude Code**

Text-to-image / image-to-image / text-to-video / image-to-video / keyframe animation — **all free** (via Agnes AI + Zhipu free models)

**English** | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① Get a Free Key

Register at one (or both) below to get a free API key:

| Provider | Free | Apply |
|---|---|---|
| **Agnes AI** (default) | All image + video free | https://platform.agnes-ai.com/ → sign up → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinese) | cogview-3-flash image + cogvideox-flash video free forever | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verify → create key |

> Detailed steps: [doc/Agnes onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu onboarding](doc/Zhipu%20开通指引.md)

## ② Configure (once)

Create `~/.media-gen-mcp/config.json` with your key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Agnes only is fine (remove the zhipu line). Skip `models` to use built-in defaults.

## ③ Add to Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

The install command carries **no key** (it's in the config above). Run `/mcp` — `media-gen-mcp ✓ Connected` means success.

## ④ Use

Just say it in Claude Code (auto-routed to the right provider/model):

| Scenario | Say | Effect |
|---|---|---|
| **Default** | "Generate a photorealistic cat image" / "Generate a 5s beach video" | Uses defaultImageProvider / defaultVideoProvider |
| **Specific provider** | "Use **Zhipu** to draw" / "Use **agnes** for video" | Temporarily switches provider, no config change |
| **Specific model** | "Use **cogview-4** to draw" / "Use **agnes-video-v2.0**" | Picks a specific model (higher quality etc.) |
| **Provider + model** | "Use **Zhipu cogvideox-3** for a 4K video" | Exact spec (4K / first-last frame) |
| **Image-to-image** | "Turn this image into watercolor" | Reference image → new image |
| **Image-to-video** | "Turn this image into a video" | Single image → video |
| **Keyframes** | "Make a smooth transition between these two images" | Multiple images → smooth transition |

> Omit specs → uses defaults; specifying provider/model affects only this call, **not your config**.

## Providers

| | Default | Image (free) | Video (free) | Strength |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | All free, photoreal, native audio |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, native Chinese, China-compliant |

Switch: `defaultProvider: "zhipu"`, or per modality via `defaultImageProvider`/`defaultVideoProvider`, or pass `provider` per call. Not sure which? See [benchmark](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (advanced, usually unnecessary)

**Three-level provider fallback** (per-call arg > per-modality > global):

| Field | Default | Description |
|---|---|---|
| `defaultProvider` | `agnes` | Global default (final fallback when neither modality is set) |
| `defaultImageProvider` | same as `defaultProvider` | Image-modality default (used by `generate_image`) |
| `defaultVideoProvider` | same as `defaultProvider` | Video-modality default (used by `create_video` / `get_video`) |

E.g. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → images via agnes, video via Zhipu. Omit the last two fields to fall back to `defaultProvider` for everything.

Per-provider connection config:

| Field | Default | Description |
|---|---|---|
| `providers.<name>.apiKey` | — | **required**, one per provider |
| `providers.<name>.models.image.default` | provider built-in | default image model |
| `providers.<name>.models.video.default` | provider built-in | default video model |
| `outDir` | session-dir/output | output dir (overridable per call) |

> Rate-limit self-learning (rateLimits / rateLimitTtlMs) and other advanced fields — see [doc/](doc/).

## FAQ

**Videos slow?** 3–18s, takes ~1–3 min. Omitting `wait` makes it async with completion notification.
**Frame count?** Pass `durationSeconds` to auto-pick (5/10/18s). Agnes allows only 81/121/161/241/441.
**Hit 429?** 62s serializer built in; auto-learns the real rate limit.
**Config not read?** Must be at `~/.media-gen-mcp/config.json` (npx installs to cache; in-project config is unavailable).

## Architecture + Docs

Provider-pluggable (agnes + zhipu; adding a provider needs zero tool-layer changes). More in [doc/](doc/):

- [doc/Agnes onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu onboarding](doc/Zhipu%20开通指引.md) · [doc/Agnes vs Zhipu benchmark](doc/Agnes_vs_Zhipu_横评.md)

## 💝 Support

If media-gen-mcp helps you, consider buying the author a coffee ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Or ⭐ Star, open an Issue / PR — all appreciated.

## License

[MIT](LICENSE)
