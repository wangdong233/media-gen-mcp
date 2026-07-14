<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**The all-in-one image-generation MCP for Claude Code — AI imagery + local structured drawing, in one server**

Text-to-image / image-to-image / text-to-video / image-to-video / keyframe animation · diagrams / charts / formulas / cards / icons / QR codes

**English** | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Highlights

- 🎨 **AI imagery, fully free**: text-to-image, image-to-image, text-to-video, image-to-video, keyframe animation — via **Agnes AI + Zhipu** free models, at no cost.
- 📐 **Local structured drawing, deterministic**: diagrams, charts, formulas, cards, icons, QR codes — **SVG vector high-res**, no AI calls, infinitely zoomable, crisp text, fully controllable.
- 🧠 **One mental model**: just say "generate an image" — Claude auto-routes to AI or a local engine and generates the matching DSL/JSON/LaTeX. **Zero added steps** for the user.
- 🌏 **Polished out of the box**: cards **auto-support CJK** (built-in Noto Sans SC, offline), **solid/gradient backgrounds**, and **color emoji**; diagrams support **both D2 and Graphviz**.
- 🔌 **Pluggable**: providers and render engines are both extensible with zero tool-layer changes; per-modality default routing + rate-limit self-learning.
- 🆓 **Structured tools need no key**: after `claude mcp add`, the 6 local tools work immediately — **draw diagrams/charts/cards/QR codes with no AI key at all**.
- 🌐 8-language README · MIT · Node ≥18

---

## 🛠️ The 10 tools

### 🤖 AI generation (online · free)

| Tool | Capability |
|---|---|
| `generate_image` | **text-to-image** / **image-to-image** (reference → new) |
| `create_video` | **text-to-video** / **image-to-video** / **keyframe animation** (smart sync/async) |
| `get_video` | poll + download a video task |
| `list_models` | list per-provider models & video constraints |

### 📐 Structured rendering (local · deterministic · mostly key-free)

| Tool | Output | Engine |
|---|---|---|
| `generate_diagram` | architecture / sequence / flowchart / class / ER / mindmap | **D2** DSL · **Graphviz** (DOT) |
| `generate_chart` | bar / line / pie / area / scatter | Vega-Lite |
| `generate_formula` | LaTeX math formulas (glyphs embedded, no font needed) | MathJax |
| `generate_card` | OG / share / quote cards (default 1200×630; templates og/quote/minimal/**hero**/**panel**; **auto CJK/gradient bg/color emoji**, **gradient title + glow**) | Satori + resvg |
| `generate_icon` | 200k+ vector icons (`prefix:name`) | Iconify |
| `generate_qrcode` | QR codes | qrcode |

> Of the 6 structured tools, **4 are fully offline** (diagram / chart / formula / qrcode). `generate_card`'s default Latin font is fetched from CDN once and cached to `~/.media-gen-mcp/fonts/` (offline thereafter, or pass `fontPath` to be offline immediately); the CJK font (Noto Sans SC) is **bundled offline**. However, card **emoji** (twemoji) and `generate_icon` (Iconify) need network (cached only, not bundled). AI-generation tools are always online.

---

## 🚀 Quick start

### ① Get a free key (only for AI generation; skip if you only draw structured images)

Register at one (or both) below to get a free API key:

| Provider | Free | Apply |
|---|---|---|
| **Agnes AI** (default) | All image + video free | https://platform.agnes-ai.com/ → sign up → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinese) | cogview-3-flash image + cogvideox-flash video free forever | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verify → create key |

> Detailed steps: [doc/Agnes onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu onboarding](doc/Zhipu%20开通指引.md)

### ② Configure (once)

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

### ③ Add to Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

The install command carries **no key** (it's in the config above). Run `/mcp` — `media-gen-mcp ✓ Connected` means success.

---

## 💬 How to use

Just say it in Claude Code — **auto-routed**, no need to remember tool names:

**AI generation:**

| Scenario | Say |
|---|---|
| Default | "Generate a photorealistic orange cat" / "Generate a 5s beach video" |
| Specific provider | "Use **Zhipu** to draw" / "Use **agnes** for video" |
| Specific model | "Use **cogview-4** to draw" / "Use **agnes-video-v2.0**" |
| Image-to-image / -to-video | "Turn this image into watercolor" / "Turn this image into a video" |
| Keyframe animation | "Make a smooth transition between these two images" |

**Structured drawing:**

| Scenario | Say |
|---|---|
| Diagram | "Draw an architecture: client → API gateway → two microservices" (D2) or "Draw a dependency graph in DOT" (Graphviz) |
| Chart | "Make a bar chart of this sales data" |
| Formula | "Render this formula: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" |
| Share card | "Make a **purple-to-blue gradient** OG card with a 🚀 emoji for this article" |
| Icon | "Give me a GitHub logo icon" |
| QR code | "Generate a QR code for https://..." |

> Specifying provider/model affects only this call, **not your config**. Diagrams use [D2 syntax](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/), charts [Vega-Lite](https://vega.github.io/vega-lite), formulas [LaTeX](https://www.latex-project.org), icons at [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude generates the source automatically.

> **Mermaid**: `generate_diagram` supports **D2 and Graphviz**; Mermaid's in-process rendering needs a browser/Chromium (unsuited to a deterministic MCP), so it's not supported — use D2 (covers flowchart/sequence/class/ER/mindmap) or Graphviz instead.

---

## 📡 Providers

| | Default | Image (free) | Video (free) | Strength |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | All free, photoreal, native audio |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, native Chinese, China-compliant |

Switch: `defaultProvider: "zhipu"`, or per modality via `defaultImageProvider`/`defaultVideoProvider`, or pass `provider` per call. Not sure which? See [benchmark](doc/Agnes_vs_Zhipu_横评.md).

---

## ⚙️ Config (advanced, usually unnecessary)

**Three-level provider fallback** (per-call arg > per-modality > global):

| Field | Default | Description |
|---|---|---|
| `defaultProvider` | `agnes` | Global default (final fallback) |
| `defaultImageProvider` | same | Image-modality default (`generate_image`) |
| `defaultVideoProvider` | same | Video-modality default (`create_video`/`get_video`) |

E.g. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → images via agnes, video via Zhipu.

Per-provider connection config: `providers.<name>.apiKey` (required), `providers.<name>.models.{image,video}.default`, `outDir` (output dir, default `session-dir/output`).

> Rate-limit self-learning (rateLimits / rateLimitTtlMs — 429 auto-learns the real limit + TTL expiry fallback) and other advanced fields — see [doc/](doc/).

---

## ❓ FAQ

**Videos slow?** 3–18s, takes ~1–3 min. Omitting `wait` makes it async (est. >60s returns a handle, with completion notice).
**Frame count?** Pass `durationSeconds` to auto-pick (5/10/18s). Agnes allows only 81/121/161/241/441.
**Hit 429?** 62s serializer built in; auto-learns the real rate limit.
**Do structured tools need a key?** No. The 6 local tools work out of the box; only AI generation needs a key.
**Card CJK/emoji/gradient?** Built-in CJK font (auto), twemoji color emoji (auto, **disk-cached — works offline once fetched**); pass a CSS `linear-gradient(...)` to `bg` for a gradient.
**Card fancy effects?** `titleGradient` (gradient title text), `glow` (title glow), `hero` template (blurred depth blob), `panel` template (glass panel: border/radius/shadow), `quoteStyle:"flank"` (big quotes wrapping text inline), `logo`/`logoRound` (embedded logo / circular avatar). All deterministic, in-process via Satori — no browser needed.
**Config not read?** Must be at `~/.media-gen-mcp/config.json` (npx installs to cache; in-project config is unavailable).
**`npx` won't connect / slow start?** Usually a corrupted npx cache or restricted network. Fallback: install globally and point at the local binary (zero network at startup, most robust):
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```
(Trade-off: global install needs a manual `npm i -g media-gen-mcp-server` to update; npx auto-updates. On a healthy network, npx is fine.)

---

## 🏗️ Architecture + docs

- **Provider-pluggable** (agnes + zhipu; adding a provider needs zero tool-layer changes); **engine-pluggable** (DiagramEngine runs parallel to MediaProvider, no cross-pollution).
- More in [doc/](doc/): [Agnes onboarding](doc/Agnes%20开通指引.md) · [Zhipu onboarding](doc/Zhipu%20开通指引.md) · [Agnes vs Zhipu benchmark](doc/Agnes_vs_Zhipu_横评.md)

---

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
