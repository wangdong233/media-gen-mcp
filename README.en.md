<h1 align="center">media-gen-mcp</h1>

> The all-in-one image toolkit for Claude Code — generate, draw, and understand images in a single sentence. Free.

<p align="center">
 <img src="https://img.shields.io/badge/version-0.16.0-blue">
 <img src="https://img.shields.io/badge/license-MIT-green">
 <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Install it once into Claude Code, and every image task afterward becomes a single sentence.** Designers creating visuals, engineers drawing architecture diagrams, marketers making share cards, finance teams extracting tables from invoices — generation/recognition + drawing/cards/QRCodes all covered, **completely free** (free providers + local engines — works the moment you install it).

Tired of producing images a few times a week and juggling N tools with N sets of parameters? Install this once and hand every image scenario to Claude.

<div align="center">

[简体中文](README.md) | **English**

</div>

## Table of Contents

- [Say It, Get It](#say-it-get-it)
- [60-Second Quick Start](#60-second-quick-start)
- [The Full Toolkit](#the-full-toolkit)
- [Configuration Deep Dive](#configuration-deep-dive)
- [FAQ](#faq)
- [Who Is This For](#who-is-this-for)
- [Support the Author](#support-the-author)
- [License](#license)

---

## Say It, Get It

| You say... | You get |
|---|---|
| "Draw a cyberpunk cat with neon glow" | A photorealistic AI image, saved to `output/` |
| "Generate a 5-second video of a seaside sunset" | An AI video MP4 (generated in the background, you're notified when done) |
| "Draw an architecture diagram: client → API gateway → order service + payment service" | A vector architecture diagram |
| "Plot this sales data as a bar chart" | A high-resolution data chart |
| "Make a QR code pointing to github.com" | A vector QR code |
| "Render E=mc² as a high-res formula" | A vector formula |
| "Make a dark-gradient share card with the title 'July New Releases 🚀'" | A polished share card (CJK + emoji auto-supported) |
| "Recognize the table in this invoice screenshot" | A paste-able HTML/Markdown table |
| "Read this bar chart into data points" | Structured JSON data |
| "Describe what's in this image" | A natural-language answer |
| "Extract all the text from this 20-page PDF report" | Full text / Markdown / JSON (digital PDFs instant; scanned PDFs auto-OCR'd page by page) |
| "Extract text from this scanned contract, ignoring the watermark and red stamps" | Clean text (auto-strips watermark / red-stamp / header-footer regions) |
| "Merge this two-column paper into a single paragraph in reading order" | Single-column continuous text (multi-column reading order auto-restored, no more scrambled serialization) |
| "Can I do table recognition right now? Is Chinese OCR configured?" | A live capability list + routing advice (what's ready / unconfigured / cooling down) |

> No need to learn tool names or install system dependencies — **Claude automatically picks the best way to get it done**.

---

## 60-Second Quick Start

The core idea: **drawing/cards/QR codes/formulas are local engines, and OCR (text recognition) also falls back to an in-process engine by default — none of these call AI or touch the network, so they work the moment you install them.** Only photorealistic AI image/video needs a free API Key — bringing "the first image" and "the first read" forward to before you even sign up.

### 30 Seconds | One-Line Install (Zero Key)

```bash
# Install in one line (no Key needed, 30 seconds)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Restart Claude Code → type /mcp → seeing media-gen-mcp ✓ Connected means success
```

### 30 Seconds | First Image Immediately, No Key Needed

Just say one sentence to Claude:

```
Make a dark tech-style share card with the title: Claude Code Image All-in-One Toolkit
```

→ A vector image is auto-saved to `output/`, ready to open and use. **You haven't registered any API Key yet, and you already have the result.**

The following also produce output instantly, with zero Key and zero network:

- "Make a QR code pointing to github.com"
- "Render E=mc² as a high-res formula"
- "Draw an architecture diagram: client → gateway → order service + payment service → database, dark tech style"
- "Read the digits in this captcha image" (OCR, in-process by default, nothing to install)
- "Extract the English text from this screenshot"

### Want Chinese SOTA Recognition / Visual QA? Configure One Line of Zhipu GLM Key (Zero Deployment, Optional)

The default lightweight engine is fine for English and digits, but Chinese accuracy is mediocre. **Don't want to self-host PaddleX / vLLM, but still want Chinese SOTA + complex tables + visual QA?** Configure one line of Zhipu GLM Key — **GLM-4.6V-Flash is permanently free on the cloud**, with zero deployment and zero local resources:

```bash
# ① Sign up for a free account at https://open.bigmodel.cn/console/apikey and apply for an api_key (format: {id}.{secret})
# Note: only standard open.bigmodel.cn keys are accepted; Code Plan keys (ZAI_API_KEY) do NOT work —
# they are bound to the Z.ai endpoint + a whitelisted tool set, and using them here will get your account banned

# ② Write it to ~/.media-gen-mcp/config.json
{
 "providers": {
 "glm-vision": { "apiKey": "your-{id}.{secret}" }
 }
}

# ③ Back in Claude Code, say: "Recognize the table in this Chinese invoice screenshot" / "How many people are in this image? What are they doing?"
# → Chinese SOTA recognition + visual QA, saved to disk / answered directly
```

> Once configured, the MCP auto-includes it in the fallback chain: **paddle → glm-vision → vlm → tesseract**; if any tier temporarily goes down, it auto-degrades without you noticing. See [Configuration Deep Dive · Tier 2](#tier-2-zhipu-glm-46v-flash-cloud-free-zero-deployment--chinese-sota--vqa).

### Want AI Photorealistic Images / Video? Add a Free API Key (Optional)

```bash
# ① Grab a free API Key (Agnes recommended, the default provider)
# https://platform.agnes-ai.com/ → Sign up → API Keys → copy sk-xxx
# (Zhipu cogview-3-flash / cogvideox-flash are also permanently free — pick one or configure both)

# ② Write it to ~/.media-gen-mcp/config.json (configuring just one provider is fine)
{
 "providers": {
 "agnes": { "apiKey": "sk-your-agnes-key" }
 }
}

# ③ Back in Claude Code, say: "Draw a cyberpunk orange cat, photorealistic"
# → A photorealistic AI image is saved. Same for video: "Generate a 5-second seaside sunset video"
```

> Don't want to use npx? A global install works too: run `npm i -g media-gen-mcp-server` first, then `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

---

## The Full Toolkit

> Just tell Claude what you want to do, and it automatically picks the best way to get it done. Grouped below by "what you want to do" — you don't need to know what's behind it.

### Create an Image (From Scratch)

**Draw a Photorealistic Photo or Illustration**
> You: "Draw a cyberpunk orange cat with neon glow, photorealistic"
> Get: a photorealistic image saved to `output/` (also supports illustrations / concept art / logo drafts / sci-fi scenes)

**Turn a Sentence or an Image Into a Short Video**
> You: "Generate a 5-second seaside sunset video"
> Get: an MP4 video (3–18 seconds; long videos are generated in the background, and you're notified when ready to retrieve them)

**Grab an Icon or Brand Logo**
> You: "Grab a GitHub logo, 128 pixels"
> Get: a vector logo from a library of 200k+ icons, ready to use (GitHub / Twitter / Material / Lucide / Font Awesome, etc.)

**Reverse-engineer the prompt & params of an AI-generated image**
> You: "What prompt and params was this image generated with? Can I reproduce it?"
> Get: structured params — positive/negative prompt, model, sampling steps, CFG, seed, size (parsed locally from PNG-embedded ComfyUI/A1111 metadata; Agnes-generated images carry the full generation params — recover the prompt and reproduce with generate_image in one click)

### Google Flow Provider (Veo 3.1 / Nano Banana — No API Key)

**What it is**: wires your locally-logged-in Google Flow Chrome into tools — no API key; images are **0-credit**, videos bill credits (7-100/clip) behind a **billing confirm gate**: the first call only returns a cost estimate + confirm token; nothing submits until you confirm.

**Prerequisite** (once): log into labs.google/fx in local Chrome — `lasso launch-chrome --port 9223 --idle-ms 0`, then log in; the MCP talks over CDP automatically.

**What you can say**:

| You say … | You get |
|---|---|
| "Use Flow to draw a …" (or configure the chain so images auto-route to Flow) | 0-credit AI images (Nano Banana 2/Pro/Lite, incl. 2K upscale) |
| "Use Flow to animate this image / make an 8s video" | Veo 3.1 / Omni Flash video (text-to-video, image-to-video, reference-image consistency, first+last frame, extend, edit, 1080p upscale — upscale 0-credit) |
| "How many Flow credits are left? / download that clip / delete these junk images / make a share link" | full `flow_status` asset management, all 0-credit |

> Live per-tier video pricing is queryable via `flow_status`; priority-chain config (auto-routing to Flow) in [Configuration](#configuration-deep-dive).

### Understand an Image / a PDF (Image & Document → Data)

**Extract Text From a Screenshot**
> You: "Read the digits in this captcha"
> Get: plain text (captchas / invoice numbers / scanned documents / chat logs all work)

**Turn a Table Image Into HTML / Markdown**
> You: "Recognize the table in this invoice screenshot"
> Get: a paste-able Markdown table (invoices / reports / scanned documents — no more retyping by hand)

**Reverse-Engineer Raw Data Points From a Chart**
> You: "Read this bar chart into data"
> Get: structured JSON data (bar / line / pie all supported; glm-vision/vlm via prompt extraction — with paddle the chart field is a placeholder and the real data lives in the markdown description)

**Have It Explain the Image in Plain Language**
> You: "How many people are in this image? What are they doing?"
> Get: a natural-language answer (visual QA / handwriting / formulas / complex scene understanding)

**Extract Text From a Whole PDF**
> You: "Extract all the text from this 20-page PDF report and export it as Markdown"
> Get: full text / Markdown / JSON — digital PDFs pull the embedded text layer instantly, scanned PDFs are rendered and OCR'd page by page; supports page ranges (`3` / `1-10` / `odd` / `last`), ignoring watermark / header-footer regions, and merged or per-page output; long documents run in the background and notify you when done (invoices / contracts / financial reports / papers / scanned books all work)

**Make Recognition / PDF Results Cleaner and More Sequential**
> You: "Extract text from this scanned contract, **ignoring the watermark and red stamps**" / "Merge this **two-column paper into reading order** as one paragraph"
> Get: clean, continuous text — two switches available in recognition / PDF extraction (**fully supported by tesseract; glm-vision/vlm return no blocks so both switches are skipped with a warning; paddle blocks lack coordinates, so ignore-areas is advisory only**):
> - **Ignore regions**: circle watermark / red-stamp / header-footer / table-header regions and they're auto-stripped from the result — contracts / certificates / scanned documents are no longer corrupted by overlapping marks
> - **Multi-column reading order**: papers / newspapers / resumes / two- or three-column layouts are auto-merged into single-column continuous text following human reading order, with no more scrambled serialization

**Ask First: "What Can My Recognition Stack Do Right Now?"**
> You: "Can I do table recognition right now? Is Chinese OCR configured? What about handwriting?"
> Get: a live capability list — which of the four recognition tiers is configured / unconfigured / cooling down or errored, plus routing advice on "use X for tables, Y for handwriting"; **ask before you act, so you don't hit a runtime error mid-call**

### Draw Your Ideas Clearly (No Key Needed, Works on Install)

**Draw a Structural Diagram**
> You: "Draw an architecture diagram: client → API gateway → order service + payment service → database"
> Get: a vector architecture diagram (flowcharts / sequence diagrams / class diagrams / ER diagrams / mind maps also supported)

**Draw an Interactive HTML Diagram** (open in browser to interact; edge-flow + node animation; theme follows system light/dark)
> You: "Draw an architecture diagram for a README that follows dark/light readers automatically"
> Get: a single-file HTML (D2 dual palette + viewer; pan / zoom / theme toggle / export SVG)

**Draw a Nested / Drill-down Architecture Diagram** (open in browser; click a layer to enter its sub-architecture; breadcrumb back to any ancestor)
> You: "Draw this system as a nested architecture: top-level 5 modules, click 'Order Service' into its internals, then into the create-order sequence diagram"
> Get: a single-file HTML (click a layer → that layer's internal architecture; layers nest arbitrarily — each can be architecture / sequence / class / ER / flowchart; breadcrumb or Esc back to any ancestor; URL hash deep-links a layer; theme follows system light/dark)

**Plot Data as a Chart**
> You: "Plot this sales data as a bar chart"
> Get: a high-resolution data chart (bar / line / pie / area / scatter — feed it a string of numbers or a CSV)

### Make Cards / Posters / QR Codes (Looks Great When Shared)

**Make a Share Card / OG Image / Quote Card / Cover / Poster**
> You: "Make a dark-gradient share card with the title 'July New Releases 🚀'"
> Get: a beautifully typeset card (title, subtitle, gradient colors, glow, color emoji, embedded logo — all automatic; CJK and Japanese kanji render without garbled characters)

**Generate a QR Code**
> You: "Make a QR code pointing to github.com"
> Get: a vector QR code (URL or text — stays crisp even when printed on posters)

**Render Math Formulas as High-Resolution Images**
> You: "Render E=mc² as a high-res formula"
> Get: a vector formula (LaTeX, complex fractions, chemical equations all supported)

### Make Cool Animations / Tech-Style Graphics (Same Input → Same Output, Always)

**Render SVG Into a High-Res PNG**
> You: "Draw a tech-style background with glow, starfield, and depth"
> Get: a cool PNG, with the best rendering method auto-selected for fidelity without artifacts

**Turn HTML / CSS Animation Into Video**
> You: "Make a 3-second product intro animation, gradient colors + particles"
> Get: an MP4 / GIF / WebM video (product intros / brand animations / motion demos — frame-by-frame rendering, same input always produces the same output)

> **Tip**: Generation / recognition goes through online AI; drawing / cards / QR codes / animations are local engines — **they work on install, are vector-sharp, and the same input always produces the same image**.

---

## Configuration Deep Dive

> In one sentence: **structured capabilities (drawing / charts / cards / QR codes / formulas) work zero-config out of the box; AI generation takes one line of API Key; recognition is zero-config by default, and you only self-host if you want Chinese SOTA / tables / charts.** What you want to do determines what you configure — no need to configure everything.

### Look Up Config by "What Do I Want to Do"

| What you want to do | What to configure | Works the moment you configure it |
|---|---|---|
| Draw architecture diagrams / data charts / cards / QR codes / formulas | **Nothing** | Local engine, works on install |
| AI photorealistic images / AI video (text-to-image, text-to-video) | One free API Key (Agnes or Zhipu, pick one) | Online generation, saved to `output/` |
| Generate images via Google Flow (0 credits) / manage Flow assets | **No key needed**: just log into Flow in local Chrome (launch via `lasso launch-chrome`) | Images / upscaling / upload / delete / share / cancel / queries all 0-credit; video bills credits (7–100 per clip) |
| OCR text recognition (English / captchas / digits / simple documents) | **Nothing** | Falls back to the in-process lightweight engine by default, works on install |
| Chinese OCR / invoice tables / chart reading / visual QA / handwriting / formulas | **Configure one line of Zhipu GLM Key** (zero deployment, permanently free on the cloud) **OR** self-host PaddleX / vLLM | GLM Key works immediately; for self-hosting, fill in one line of baseUrl once the service is running |
| **PDF text extraction** (digital / scanned / multi-page) | Two deps: `npm i pdfjs-dist @napi-rs/canvas` (install on first PDF use) | Digital PDFs instant; scanned PDFs follow the OCR tiers above (default zero-config also works) |
| **Strip watermarks / red stamps / header-footers, restore multi-column reading order** | **Nothing** | Just say "ignore the watermark" or "merge in reading order" when calling a recognition / PDF tool — it's applied automatically |
| **Look up current recognition capabilities** (what's ready / unconfigured) | **Nothing** | Just ask; Claude returns a live capability list + routing advice |

---

### 1. Generation Config (AI Image / Video)

**One free key is enough** (Agnes recommended, the default; Zhipu as backup, natively optimized for Chinese):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

- **Agnes** (recommended): https://platform.agnes-ai.com/ → sign up → API Keys → `sk-xxx`
- **Zhipu**: [open.bigmodel.cn](https://open.bigmodel.cn/) → API Keys (free models `cogview-3-flash` / `cogvideox-flash`, free forever)
- Two providers = resilience: if one rate-limits or wobbles, the other takes over automatically — zero perception, zero double-billing
- Config file: `~/.media-gen-mcp/config.json` (Windows: `%USERPROFILE%\.media-gen-mcp\config.json`); **missing file never crashes** — structured capabilities and default OCR keep working

**Provider priority chains (optional)** — one line to make "generate an image" automatically go through Flow's free tier:

```json
{
  "imageProviderPriority": ["flow", "agnes", "zhipu"],
  "videoProviderPriority": ["agnes", "zhipu"]
}
```

- **The chain IS the switch**: listed = enabled (chain head = default), unlisted = disabled; on head failure it falls through in order (60s circuit breaker); explicit `provider="flow"` is always legal and throws on failure (structured `[flow] S1xx` with setup guidance — never silently switches providers)
- **Video does NOT go through Flow by default** (bills credits, deliberately excluded): either add it to `videoProviderPriority` at your own cost, or pass `provider="flow"` explicitly each call
- **Billing confirm gate (two-phase, on by default)**: the first Flow video call does NOT submit — it returns `{needConfirm, estimatedCost, confirmToken}`; re-call with the **same params + confirmToken** to actually submit. Tokens live 10 minutes and bind to all billing params (any change invalidates); tier-unavailable keys get no token and are rejected with the per-tier price matrix; 0-credit ops and non-Flow providers never trigger it. Disable: `"flow": { "videoConfirm": false }`

**Flow asset management (all 0-credit)**: `flow_status` covers credits/status/download plus share (`shareMediaIds`) / cancel (`cancelMediaIds`) / batch delete (`deleteMediaIds`). Companion `"flow": { "toolDeadlineMs": 110000 }` caps long Flow ops (anti-stall; timeout → `[flow] S410`, underlying op not canceled — re-check later via `flow_status`).

---

### 2. Recognition Config (Image Understanding / OCR / Tables / Charts / Vision)

Recognition comes in 4 tiers — **installed on demand; tier 1 works with zero config**:

| Tier | What it does | What to configure | Cost |
|---|---|---|---|
| **1 Default** (in-process) | English/digits/captcha/simple-doc OCR | **zero config** | free |
| **2 Zhipu GLM-4.6V-Flash** | Chinese SOTA + complex tables + chart reading + visual QA (all 4 tasks) | **one key** (recommended, zero deployment) | **free forever** |
| **3 PaddleX** | Chinese SOTA + invoice tables + layout analysis | self-hosted (GPU 12GB or CPU 8GB+) | free open-source |
| **4 vLLM Qwen2.5-VL** | VQA / handwriting / formulas / complex scenes | self-hosted (GPU 16-24GB) | free open-source |

> For most users: **tier 1 + one line of tier-2 GLM key covers everything**; tiers 3/4 are for users with GPUs wanting full offline (deployment details / CUDA requirements / Unlimited-OCR long-document advanced setup: [doc/自托管部署指南](doc/自托管部署指南.md)).

**Tier 2 config (most common)**:

```json
{
  "providers": {
    "glm-vision": { "apiKey": "your-{id}.{secret}" }
  }
}
```

- Key: [open.bigmodel.cn](https://open.bigmodel.cn/console/apikey) (free signup, format `{id}.{secret}`)
- ⚠️ Standard api_key only; **Code Plan keys (ZAI_API_KEY) do NOT work** (bound to Z.ai endpoint + tool allowlist — violations get accounts banned); multi-key rotation is technically supported but Zhipu's agreement forbids multi-account use — compliance is on you
- Default model `glm-4.6v-flash` (switch via `providers["glm-vision"].model` to `glm-4v-flash` or paid vision models)

**Tier 3/4 self-hosted** (one baseUrl line each once the service is up; details in the deployment guide):

```json
{
  "providers": {
    "paddle": { "baseUrl": "http://127.0.0.1:8080" },
    "vlm":    { "baseUrl": "http://127.0.0.1:8000" }
  }
}
```

---

### 3. Automatic Fallback Mechanism (Once Configured, You Don't Need to Worry)

- **Generation Side**: Agnes ↔ Zhipu — if either fails, it auto-switches to the other (two consecutive failures within 60 seconds trigger a soft switchover; no restart or config change required on your end)
- **Recognition Side**: default lightweight engine (in-process fallback) → auto-degrades by capability (fallback order: paddle(10) → glm-vision(9) → vlm(8); tesseract is the default head and the last-resort fallback)
- **The One Exception**: video polling does **not** switch providers when fetching the result (to avoid getting the wrong result back)
- What you need to do: configure two generation API Keys + optionally install one recognition tier; leave the rest to Claude

> Can't run PaddleX or vLLM on your machine? **Just keep using the default lightweight engine** — the MCP won't error out just because a local service isn't installed. Only Chinese SOTA / tables / visual QA become unavailable; everything else works as usual.

---

## FAQ

**Q: Does it work without installing anything?**
A: Yes. Once the MCP is installed, you have drawing / cards / QR codes / formulas / data charts + English / captcha OCR, all running locally with zero network access by default (exception: card non-default fonts / color emoji and diagram `icon:` icons fetch from a CDN on first use; offline they degrade gracefully — emoji falls back to plain text, icons are omitted, fonts can be localized via fontPath).

**Q: Does Chinese recognition produce garbled text?**
A: The default lightweight engine is fine for English / digits / simple documents, but Chinese accuracy is mediocre. For Chinese SOTA, self-host PaddleX (GPU 12GB or CPU 4-core 8GB). See [Configuration Deep Dive](#configuration-deep-dive) above.

**Q: How long does AI video take?**
A: A 5-second video ~1–3 minutes; an 18-second video may take 5–10 minutes. Generated asynchronously in the background; you're auto-notified when ready. Videos estimated at ≤60 seconds are awaited synchronously.

**Q: Can my RTX 3060 handle table recognition?**
A: Yes. PaddleX GPU mode needs a minimum of 12GB VRAM (the RTX 3060 12GB is exactly that); CPU mode runs on 4 cores + 8GB RAM (3–5× slower). See [Configuration Deep Dive](#configuration-deep-dive) for details.

**Q: Do Chinese / emoji / gradients render correctly?**
A: Yes. Share cards fully support Chinese, Japanese kanji, color emoji, gradient titles, and glow effects through built-in CJK fonts and a typesetting engine — no extra font configuration needed.

**Q: Is Mermaid supported?**
A: No (it requires a browser). Use D2 or Graphviz instead — equivalent capability, more robust, with vector output.

**Q: Hitting rate limits (429)?**
A: The free tier has a per-minute request cap. Once you configure both providers (Agnes + Zhipu), auto-switching kicks in and is essentially invisible.

**Q: Video frame-count limits?**
A: They decrease with resolution — 1080p ≤ 241 frames (~10 seconds), 720p can reach 441 frames (~18 seconds). Ask Claude to check the live constraints.

**Q: npx won't connect / is slow to start?**
A: A global install works too: run `npm i -g media-gen-mcp-server` first, then `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

**Q: Can I use sensitive words / weapons / war themes?**
A: Real-weapon terms trigger content filters. Swap in sci-fi setting words (e.g. "future battle armor", "mecha") to bypass — equivalent visual result.

**Q: Will Claude pick the wrong tool? (e.g. call image generation when you ask for a share card)**
A: Routing for these ambiguous requests has been tuned — "make a card / poster / OG image", "read the data out of this chart", "make a product-intro animation", "draw an architecture / flowchart diagram", "chart this data" and the like now go to the right specialized tool automatically, no manual correction needed. You can also name a tool explicitly in your request.

---

## Who Is This For

- **Heavy Claude Code users** — anyone producing image tasks a few times a week, who doesn't want to install a separate MCP and memorize a new parameter set for every task.
- **Developers writing technical docs / blogs** — who constantly need architecture diagrams, sequence diagrams, ER diagrams, data charts, formulas, and don't want to leave their workflow.
- **Individual developers / indie products** — cost-conscious (completely free) and reproducibility-minded (same input → same output); don't want to build a separate backend just for image tasks.
- **Data / Finance / Legal** — two-way scenarios: plot data as charts, and reverse-extract data points from screenshots / invoices / **PDF reports / contracts** (watermarks / red stamps can be ignored; two-column papers merge in reading order).
- **Education / Academic** — students extract text from lecture screenshots / scanned handouts / paper PDFs, merge two-column papers into continuous text, and ask questions about data read out of charts; teachers turn scanned paper exams into editable text.
- **Operations / content creators / newsletter authors** — share cards / OG images / posters / QR codes, with Chinese + color emoji + gradients working out of the box.

> **Probably not for**: users who don't use Claude Code; engineering teams that want only a single capability and already have a pipeline set up; scenarios that require paid commercial models / training/fine-tuning / real-time video OCR (these exceed the scope of a free MCP).

---

## 💝 Support the Author

If media-gen-mcp helps you, consider buying the author a coffee ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Or ⭐ [Star this repo](../../stargazers), [open an Issue](../../issues) / [send a PR](../../pulls) — all forms of support are appreciated.

---

## License

**MIT** — the main codebase is free to use as you like.

The recognition side's full dependency stack is **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL) — zero license risk for enterprise commercial use.

---

> Technical notes: providers and engines are both pluggable; structured tools produce the same output for the same input and can be checked into git; failed providers auto-switch. See the `doc/` directory for full documentation.

<p align="center">
 <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
 <sub>Install once, and every image task afterward becomes a single sentence.</sub>
</p>
