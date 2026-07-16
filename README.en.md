<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Give Claude Code the "image-generation superpower" — generate images / videos / charts / cards / QR codes in a single sentence**

AI image & video generation (free) + structured drawing (local, deterministic) + cool SVG rendering (Chrome high-fidelity)

**English** | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Features

- 🆓 **Completely free** — AI image/video generation via Agnes AI + Zhipu free models; structured drawing fully local, zero cost
- 🧠 **Zero learning curve** — just speak naturally, Claude auto-selects tools, auto-generates code, auto-produces images
- 📐 **Deterministic output** — diagrams/charts/formulas/cards, the same input always yields the same output, content is controllable
- 🇨🇳 **Chinese-friendly** — cards auto-render Chinese (built-in fonts); Zhipu models are native Chinese
- 🔌 **Nothing else to install** — D2 / Graphviz / Vega / MathJax all bundled, no need to system-install d2/dot/matplotlib
- 🎨 **Cool rendering** — feGaussianBlur glow / gradients / depth-of-field, automatically via Chrome high-fidelity rendering
- 🌐 8-language docs · MIT · Node ≥18

---

## 💬 What can you get?

After installing, just **say one sentence** in Claude Code and you can:

| You say | You get |
|---|---|
| "Generate a realistic wuxia-style orange cat" | 🖼️ An AI-generated realistic image |
| "Generate a 5-second seaside video" | 🎬 An AI-generated short video |
| "Draw an architecture diagram: client → API gateway → two microservices" | 📐 A clean vector architecture diagram |
| "Chart this sales data as a bar chart" | 📊 A data visualization chart |
| "Render this formula `E=mc^2`" | ➗ A high-res math formula image |
| "Make a gradient share card with a 🚀 emoji" | 🎴 An OG / social share image (Chinese auto) |
| "Give me a GitHub logo" | 🏷️ A vector icon |
| "Generate a QR code" | ▪️ A QR code |
| "Draw a cool dark tech-style architecture diagram with glow" | ✨ A high-fidelity Chrome-rendered image |

> **All it takes is one sentence.** You don't need to learn any tool names or parameters.

---

## 🚀 Quick Start

### ① Get a free Key

Register at either (or both) of the providers below to get a free API Key:

| Provider | Free | How to apply |
|---|---|---|
| **Agnes AI** (default) | text-to-image + text-to-video all free | https://platform.agnes-ai.com/ → Register → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinese) | cogview-3-flash image + cogvideox-flash video free forever | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → Verify identity → Create Key |

> Detailed illustrated steps: [Agnes setup guide](doc/Agnes%20开通指引.md) · [Zhipu setup guide](doc/Zhipu%20开通指引.md)

### ② Configuration

Create `~/.media-gen-mcp/config.json` and fill in your Key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Configuring only agnes is fine too (delete the zhipu line). If you don't fill in `models`, the built-in defaults are used.

### ③ Connect to Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

The add command **does not include the Key** (the Key lives in the config above). Run `/mcp` — seeing `media-gen-mcp ✓ Connected` means success.

### ④ Say one sentence

In Claude Code, just say "draw an architecture diagram" or "generate a realistic orange cat image" — done.

> **Only drawing diagrams/charts/cards/QR codes?** No Key needed — just install (③) and start using.

---

## 📡 Providers

| | Default | Image (free) | Video (free) | Highlights |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Fully free, realistic texture, native audio & video |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, native Chinese, China-compliant |

Switch via: `defaultProvider: "zhipu"`, or per-modality `defaultImageProvider`/`defaultVideoProvider`, or pass `provider` for a single call. Not sure which to choose? See the [comparison](doc/Agnes_vs_Zhipu_横评.md).

---

## 🛠️ Capabilities

### 🤖 AI Generation (free models · online)

Use Agnes AI or Zhipu's free models:
- **Text-to-image / image-to-image** — realistic, illustration, concept art
- **Text-to-video / image-to-video / keyframe animation** — smart async (long videos generate in the background, notification on completion)
- Specify provider/model: "use **Zhipu cogview-4** to draw one" / "use **agnes** to generate video"

### 📐 Structured Drawing (local · deterministic · no Key needed)

The following capabilities **do not call AI and produce deterministic output** (SVG vector, high-res):

| Capability | Engine (all bundled) | Notes |
|---|---|---|
| **Diagrams** | D2 + Graphviz | architecture/flow/sequence/class/ER/mind maps, auto-layout |
| **Data charts** | Vega-Lite | bar/line/pie/area/scatter, Claude auto-generates from data |
| **Math formulas** | MathJax | LaTeX → SVG, glyphs embedded |
| **Share cards** | Satori | OG/poster/quote cards (Chinese + gradient + emoji + glow, all automatic) |
| **QR codes** | qrcode | URL/text → SVG/PNG |
| **Vector icons** | Iconify | 200k+ icons (`icon: "mdi:home"`) |
| **Cool SVG** | Chrome / resvg | hand-written SVG (glow/filters/depth-of-field) → Chrome high-fidelity rendering |

<details>
<summary>📖 What can cards do?</summary>

- 5 templates: og (left-aligned hierarchy) / quote (quote, quotation marks can flank left & right) / minimal (minimalist) / hero (large display text + light spots) / panel (glass panel)
- Gradient title text + glow + blurred light-spot depth
- Embedded logo / circular avatar
- Auto Chinese (Noto Sans SC offline) + auto color emoji (cached to disk, works offline)
- Custom size (default 1200×630 OG standard)
</details>

<details>
<summary>📖 What is cool SVG rendering?</summary>

The D2 engine does not support SVG filters (feGaussianBlur glow), so when you want effects like "cool dark tech vibe, glow, depth-of-field":
1. Claude hand-writes SVG (with filters like feGaussianBlur)
2. Calls the `render_svg` tool
3. The tool auto-selects a backend: if `<filter>` is present + system Chrome is available → Chrome (100% filter fidelity); otherwise → resvg (92%, lightweight)
</details>

<details>
<summary>📖 Offline notes (which tools need internet?)</summary>

- **Fully offline**: generate_diagram / generate_chart / generate_formula / generate_qrcode
- **Online first time, then cached offline**: generate_card (the default Latin font Inter is fetched from CDN on first use and cached to `~/.media-gen-mcp/fonts/`; the CJK font Noto Sans SC is already bundled offline; twemoji emoji is cached to disk and works offline)
- **Requires internet**: generate_icon (Iconify API fetch), render_svg when filters are used (needs Chrome)
- **Always online**: AI generation tools (generate_image / create_video)
</details>

---

## ❓ FAQ

**Video slow?** 3–18s, about 1–3 minutes. Omit `wait` for auto-async (>60s returns a handle, notifies on completion).
**Frame count?** Pass `durationSeconds` to auto-select (5/10/18s). Agnes only allows 81/121/161/241/441.
**Hitting 429?** Built-in 62s serial throttling + auto-learning of real rate limits.
**Structured tools need a Key?** No. Install and you can draw diagrams/charts/cards/QR codes right away.
**Card Chinese/emoji/gradient?** All automatic: built-in CJK font + twemoji emoji (cached to disk) + CSS gradient background.
**Cool SVG?** Claude hand-writes SVG (with feGaussianBlur glow) → `render_svg` → Chrome 100% filter fidelity.
**Mermaid supported?** No (needs a browser). Use D2 instead (covers flow/sequence/class/ER/mind maps).
**Config not read?** It must be at `~/.media-gen-mcp/config.json`.
**`npx` won't connect?** Fallback to global install:
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ Architecture + Docs

- **Pluggable providers** (agnes + Zhipu, adding a new provider requires zero changes to the tool layer); **pluggable engines** (DiagramEngine and MediaProvider run in parallel without polluting each other)
- [Architecture requirements checklist](doc/架构要求清单.md) — project architecture spec (continuously maintained)
- More in [doc/](doc/): [Agnes setup guide](doc/Agnes%20开通指引.md) · [Zhipu setup guide](doc/Zhipu%20开通指引.md) · [Provider comparison](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Support the author

If media-gen-mcp helps you, consider buying the author a coffee ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Or ⭐ Star, open an Issue / PR — all are ways to support the author.

## License

[MIT](LICENSE)
