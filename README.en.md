# media-gen-mcp

> The all-in-one image toolkit for Claude Code — generate, draw, and understand images in a single sentence. Free.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.11.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Install it once into Claude Code, and every image task afterward becomes a single sentence.** Designers creating visuals, engineers drawing architecture diagrams, marketers making share cards, finance teams extracting tables from invoices — generation/recognition + drawing/cards/QRCodes all covered, **100% free** (free providers + local engines — works the moment you install it).

Tired of producing images a few times a week and juggling N tools with N sets of parameters? Install this once and hand every image scenario to Claude.

<div align="center">

[简体中文](README.md) | **English** | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

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
| "Recognize the table in this invoice screenshot" | A paste-able HTML/Markdown table (new in 0.11.0) |
| "Read this bar chart into data points" | Structured CSV/JSON data (new in 0.11.0) |
| "Describe what's in this image" | A natural-language answer (new in 0.11.0) |
| "Extract all the text from this 20-page PDF report" | Full text / Markdown / JSON (digital PDFs instant; scanned PDFs auto-OCR'd page by page) (new in pares6) |
| "Can I do table recognition right now? Is Chinese OCR configured?" | A live capability list + routing advice (what's ready / unconfigured / cooling down) (new in pares6) |

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

### Want AI Photorealistic Images / Video? Add a Free API Key (Optional)

```bash
# ① Grab a free API Key (Agnes recommended, the default provider)
#    https://platform.agnes-ai.com/ → Sign up → API Keys → copy sk-xxx
#    (Zhipu cogview-3-flash / cogvideox-flash are also permanently free — pick one or configure both)

# ② Write it to ~/.media-gen-mcp/config.json (configuring just one provider is fine)
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" }
  }
}

# ③ Back in Claude Code, say: "Draw a cyberpunk orange cat, photorealistic"
#    → A photorealistic AI image is saved. Same for video: "Generate a 5-second seaside sunset video"
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

### Understand an Image / a PDF (Image & Document → Data)

**Extract Text From a Screenshot**
> You: "Read the digits in this captcha"
> Get: plain text (captchas / invoice numbers / scanned documents / chat logs all work)

**Turn a Table Image Into HTML / Markdown**
> You: "Recognize the table in this invoice screenshot"
> Get: a paste-able Markdown table (invoices / reports / scanned documents — no more retyping by hand)

**Reverse-Engineer Raw Data Points From a Chart**
> You: "Read this bar chart into data"
> Get: structured CSV / JSON data (bar / line / pie all supported)

**Have It Explain the Image in Plain Language**
> You: "How many people are in this image? What are they doing?"
> Get: a natural-language answer (visual QA / handwriting / formulas / complex scene understanding)

**Extract Text From a Whole PDF** (new in pares6)
> You: "Extract all the text from this 20-page PDF report and export it as Markdown"
> Get: full text / Markdown / JSON — digital PDFs pull the embedded text layer instantly, scanned PDFs are rendered and OCR'd page by page; supports page ranges (`3` / `1-10` / `odd` / `last`), ignoring watermark / header-footer regions, and merged or per-page output; long documents run in the background and notify you when done (invoices / contracts / financial reports / papers / scanned books all work)

**Ask First: "What Can My Recognition Stack Do Right Now?"** (new in pares6)
> You: "Can I do table recognition right now? Is Chinese OCR configured? What about handwriting?"
> Get: a live capability list — which of the three recognition tiers is configured / unconfigured / cooling down or errored, plus routing advice on "use X for tables, Y for handwriting"; **ask before you act, so you don't hit a runtime error mid-call**

### Draw Your Ideas Clearly (No Key Needed, Works on Install)

**Draw a Structural Diagram**
> You: "Draw an architecture diagram: client → API gateway → order service + payment service → database"
> Get: a vector architecture diagram (flowcharts / sequence diagrams / class diagrams / ER diagrams / mind maps also supported)

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
| OCR text recognition (English / captchas / digits / simple documents) | **Nothing** | Falls back to the in-process lightweight engine by default, works on install |
| Chinese OCR / invoice tables / chart reading / visual QA / handwriting / formulas | Self-hosted understanding engine (PaddleX or vLLM, see resource requirements below) | After the self-hosted service is running, fill in one line of baseUrl |
| **PDF text extraction** (digital / scanned / multi-page) | Two deps: `npm i pdfjs-dist @napi-rs/canvas` (install on first PDF use) | Digital PDFs instant; scanned PDFs follow the OCR tiers above (default zero-config also works) |
| **Look up current recognition capabilities** (what's ready / unconfigured) | **Nothing** | Just ask; Claude returns a live capability list + routing advice |

---

### 1. Generation Config (AI Image / Video)

**Default provider: Agnes** (free tier is permanent, text-to-image + text-to-video fully open). Zhipu is the alternative (with native optimization for Chinese scenarios).

**One provider is enough** (here's the complete `config.json`; filling just one is fine):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/absolute/path/to/output"
}
```

**How to Get a Free API Key**:

- **Agnes** (recommended, default): https://platform.agnes-ai.com/ → Sign up → API Keys → copy `sk-xxx`
- **Zhipu**: https://open.bigmodel.cn/ → Sign up → API Keys (free models: `cogview-3-flash` / `cogvideox-flash`, permanently free)

**Configuring Both Is More Reliable**: if either provider temporarily goes down (rate limits / service fluctuations), the other automatically takes over — invisible to you, with no duplicate charges.

**Config File Location**: `~/.media-gen-mcp/config.json` (macOS / Linux) or `%USERPROFILE%\.media-gen-mcp\config.json` (Windows).

> If this file is **missing, nothing breaks** — structured capabilities and the default OCR still work; you just can't call AI generation.

---

### 2. Recognition Config (Image Understanding / OCR / Tables / Charts / Vision)

Recognition capabilities come in **three tiers** — install on demand; the first tier works by default.

#### Tier 1: Default Lightweight Engine (Zero Config, Works on Install)

- **What it can do**: English / digit / captcha / simple document OCR
- **Need to run a service?**: **No**, packaged into the MCP process as WASM, language model auto-loads on first call
- **Minimum Resource Requirements**:
  - CPU: any (pure CPU, no GPU dependency)
  - GPU: not required
  - Memory: ~200–500MB (fluctuates with image size)
  - Disk: ~30–50MB (WASM engine + language packs)
  - Model size: included in the disk footprint above (English language pack, on the order of a few MB)
- **Speed**: ~3–5 seconds per image
- **Who it's for**: 90% of lightweight OCR scenarios, overseas documents, captcha recognition

> For most users, this tier is enough; the next two are optional upgrades.

#### Tier 2: PaddleX / PP-StructureV3 (Chinese SOTA + Table Recognition)

- **What it can do**: Chinese OCR (significantly better than the default engine), layout analysis, **invoices / reports / scanned documents → HTML/Markdown tables**, chart reading
- **Need to run a service?**: **Yes**, self-host a PaddleX REST service; the MCP calls it via `baseUrl`
- **Minimum Resource Requirements** (measured):

  | Mode | Minimum | Recommended | Notes |
  |---|---|---|---|
  | GPU mode | RTX 3060 12GB VRAM | RTX 3060 12GB / Tesla T4 | Model loading ~2.4GB; peak ~6GB on complex PDFs |
  | CPU mode | 4-core CPU + 8GB RAM | 8-core + 16GB RAM | Runs (lightweight docs OK); batch / complex PDFs are 3–5× slower |
  | Disk | ~3GB | ~5GB | paddlepaddle + paddlex + model weights |
  | Model size | ~100–300MB (per pipeline) | — | Stacks up across multiple pipelines |

- **CUDA Requirement**: Compute Capability ≥ 7.0 (V100 / T4 / RTX 20/30/40 series; 50-series not yet fully supported); needs CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 for GPU acceleration
- **How to Install**:

  ```bash
  pip install paddlex paddlepaddle          # GPU version: paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  Then add one line to `config.json`:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### Tier 3: vLLM + Qwen2.5-VL (General Vision-Understanding VLM)

- **What it can do**: visual QA, handwriting recognition, formula recognition, natural-language description of complex scenes — the "understanding" tasks PaddleX can't handle
- **Need to run a service?**: **Yes**, self-host a vLLM inference service
- **Minimum Resource Requirements** (measured):

  | Mode | Minimum | Recommended | Notes |
  |---|---|---|---|
  | GPU Full-Precision 7B (FP16) | 16GB VRAM | **24GB VRAM** (RTX 3090 / 4090 / A5000) | Model weights ~15–16GB + KV cache; vLLM occupies 90% of VRAM by default |
  | GPU Quantized 7B (INT8/AWQ) | 10–12GB VRAM | 16GB VRAM | Quantized version fits RTX 4080 / 4060 Ti 16GB |
  | GPU Lightweight 3B | 6–8GB VRAM | GTX 1660 / 3060 6–8GB | FP16 ~6–8GB, INT4 ~3–4GB — the sweet spot for individual developers |
  | CPU mode | Not recommended | — | Runs but 5–10× slower; use a GPU for production |
  | Memory | 16GB | 16–32GB | — |
  | Disk | ~14GB (7B weights) | — | 3B is ~6GB |
  | CUDA Requirement | Compute Capability ≥ 7.0 | — | Tesla T4 (7.5) minimum; V100 / A100 / RTX 30/40 series all work |

- **How to Install**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # When you see "Uvicorn running on http://0.0.0.0:8000", it's ready
  ```
  For more options (GPU selection / quantization / concurrency limits) see the [vLLM official docs](https://docs.vllm.ai). Then add this to `config.json`:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

#### Three-Tier Cheat Sheet

| Tier | Run a Service? | Resource Threshold | Chinese | Tables | Visual QA | License |
|---|---|---|---|---|---|---|
| **Default** (tesseract) | No | Zero (pure CPU WASM) | Mediocre | ❌ | ❌ | Apache 2.0 |
| **PaddleX** | Yes | GPU 12GB or CPU 4-core 8GB | ✅ SOTA | ✅ | ❌ | Apache 2.0 |
| **vLLM Qwen2.5-VL** | Yes | **GPU 16–24GB** (CPU not viable) | ✅ | Mediocre | ✅ | Apache 2.0 |

> The recognition side deliberately picks only Apache 2.0 engines (tesseract.js + PaddleOCR + Qwen2.5-VL), avoiding AGPL / GPL / commercial-use application traps — **enterprises can use it commercially with no concerns**.

---

### 3. Automatic Fallback Mechanism (Once Configured, You Don't Need to Worry)

- **Generation Side**: Agnes ↔ Zhipu — if either fails, it auto-switches to the other (two consecutive failures within 60 seconds trigger a soft switchover; no restart or config change required on your end)
- **Recognition Side**: default lightweight engine (in-process fallback) → PaddleX → vLLM, auto-degrading by capability
- **The One Exception**: video polling does **not** switch providers when fetching the result (to avoid getting the wrong result back)
- What you need to do: configure two generation API Keys + optionally install one recognition tier; leave the rest to Claude

> Can't run PaddleX or vLLM on your machine? **Just keep using the default lightweight engine** — the MCP won't error out just because a local service isn't installed. Only Chinese SOTA / tables / visual QA become unavailable; everything else works as usual.

---

## FAQ

**Q: Does it work without installing anything?**
A: Yes. Once the MCP is installed, you have drawing / cards / QR codes / formulas / data charts + English / captcha OCR, all running locally with zero network access.

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

---

## Who Is This For

- **Heavy Claude Code users** — anyone producing image tasks a few times a week, who doesn't want to install a separate MCP and memorize a new parameter set for every task.
- **Developers writing technical docs / blogs** — who constantly need architecture diagrams, sequence diagrams, ER diagrams, data charts, formulas, and don't want to leave their workflow.
- **Individual developers / indie products** — cost-conscious (100% free) and reproducibility-minded (same input → same output); don't want to build a separate backend just for image tasks.
- **Data / Finance / Legal** — two-way scenarios: plot data as charts, and reverse-extract data points from screenshots / invoices / **PDF reports / contracts**.
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

> Technical notes: providers and engines are both pluggable; structured tools produce the same output for the same input and can be checked into git; failed providers auto-switch. See `CONTRIBUTING.md` for contributors, and the `docs/` directory for full documentation.

<p align="center">
  <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
  <sub>Install once, and every image task afterward becomes a single sentence.</sub>
</p>
