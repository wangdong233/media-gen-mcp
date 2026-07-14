<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Der All-in-One-Bildgenerierungs-MCP für Claude Code — KI-Bilderstellung + lokales strukturiertes Zeichnen, in einem Server**

Text-zu-Bild / Bild-zu-Bild / Text-zu-Video / Bild-zu-Video / Keyframe-Animation · Diagramme / Charts / Formeln / Karten / Icons / QR-Codes

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Highlights

- 🎨 **KI-Bilderstellung, komplett kostenlos**: Text-zu-Bild, Bild-zu-Bild, Text-zu-Video, Bild-zu-Video, Keyframe-Animation — über die kostenlosen Modelle von **Agnes AI + Zhipu**, ohne Kosten.
- 📐 **Lokales strukturiertes Zeichnen, deterministisch**: Diagramme, Charts, Formeln, Karten, Icons, QR-Codes — **SVG-Vektor in hoher Auflösung**, keine KI-Aufrufe, unendlich zoombar, knackscharfer Text, vollständig kontrollierbar.
- 🧠 **Ein mentales Modell**: Sagen Sie einfach „Erstelle ein Bild" — Claude leitet automatisch an die KI oder eine lokale Engine weiter und erzeugt die passende DSL/JSON/LaTeX. **Kein zusätzlicher Schritt** für die Nutzer.
- 🌏 **Poliert out of the box**: Karten **unterstützen automatisch CJK** (eingebautes Noto Sans SC, offline), **einfarbige/Verlauf-Hintergründe** und **Farb-Emoji**; Diagramme unterstützen **sowohl D2 als auch Graphviz**.
- 🔌 **Steckbar**: Provider und Render-Engines sind beide erweiterbar, ohne Änderungen auf der Tool-Ebene; Standard-Routing pro Modalität + Rate-Limit-Selbstlernen.
- 🆓 **Strukturierte Tools brauchen keinen Key**: Nach `claude mcp add` funktionieren die 6 lokalen Tools sofort — **Diagramme/Charts/Karten/QR-Codes zeichnen, ganz ohne KI-Key**.
- 🌐 8-sprachige README · MIT · Node ≥18

---

## 🛠️ Die 10 Tools

### 🤖 KI-Generierung (online · kostenlos)

| Tool | Fähigkeit |
|---|---|
| `generate_image` | **Text-zu-Bild** / **Bild-zu-Bild** (Referenz → neu) |
| `create_video` | **Text-zu-Video** / **Bild-zu-Video** / **Keyframe-Animation** (intelligente Sync/Async-Umschaltung) |
| `get_video` | Video-Task abfragen + herunterladen |
| `list_models` | Modelle & Video-Einschränkungen je Provider auflisten |

### 📐 Strukturiertes Rendering (lokal · deterministisch · meist ohne Key)

| Tool | Ausgabe | Engine |
|---|---|---|
| `generate_diagram` | Architektur / Sequenz / Flussdiagramm / Klasse / ER / Mindmap | **D2**-DSL · **Graphviz** (DOT) |
| `generate_chart` | Balken / Linie / Kreis / Fläche / Streuung | Vega-Lite |
| `generate_formula` | LaTeX-Matheformeln (Glyphen eingebettet, keine Schrift nötig) | MathJax |
| `generate_card` | OG-/Share-/Zitat-Karten (Standard 1200×630, **autom. CJK/Verlauf/Emoji**) | Satori + resvg |
| `generate_icon` | 200k+ Vektor-Icons (`prefix:name`) | Iconify |
| `generate_qrcode` | QR-Codes | qrcode |

> Von den 6 strukturierten Tools sind **5 vollständig offline**; nur `generate_icon` (lädt von Iconify) und die Standardschrift von `generate_card` (erster CDN-Abruf, danach gecacht) benötigen Netzwerk — übergeben Sie `fontPath`, um die Karte vollständig offline zu machen.

---

## 🚀 Schnellstart

### ① Kostenlosen Key holen (nur für KI-Generierung; überspringen, wenn Sie nur strukturierte Bilder zeichnen)

Registrieren Sie sich bei einem (oder beiden) der folgenden Anbieter, um einen kostenlosen API-Key zu erhalten:

| Provider | Kostenlos | Registrierung |
|---|---|---|
| **Agnes AI** (Standard) | Alle Bild- + Video-Funktionen kostenlos | https://platform.agnes-ai.com/ → Registrieren → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinesisch) | cogview-3-flash Bild + cogvideox-flash Video dauerhaft kostenlos | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verifizieren → Key erstellen |

> Ausführliche Schritte: [doc/Agnes-Onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu-Onboarding](doc/Zhipu%20开通指引.md)

### ② Konfigurieren (einmalig)

Erstellen Sie `~/.media-gen-mcp/config.json` mit Ihrem Key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Nur Agnes genügt (entfernen Sie die zhipu-Zeile). Lassen Sie `models` weg, um die integrierten Standardwerte zu verwenden.

### ③ Zu Claude Code hinzufügen

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

Der Installationsbefehl enthält **keinen Key** (er steht in der config oben). Führen Sie `/mcp` aus — `media-gen-mcp ✓ Connected` bedeutet Erfolg.

---

## 💬 Verwendung

Sagen Sie es einfach in Claude Code — **automatisches Routing**, Sie müssen sich keine Tool-Namen merken:

**KI-Generierung:**

| Szenario | Sagen Sie |
|---|---|
| Standard | „Erstelle eine fotorealistische orange Katze" / „Erstelle ein 5s Strand-Video" |
| Bestimmter Provider | „Zeichne mit **Zhipu**" / „Verwende **agnes** für das Video" |
| Bestimmtes Modell | „Zeichne mit **cogview-4**" / „Verwende **agnes-video-v2.0**" |
| Bild-zu-Bild / -zu-Video | „Wandle dieses Bild in Aquarell um" / „Mach aus diesem Bild ein Video" |
| Keyframe-Animation | „Erzeuge einen fließenden Übergang zwischen diesen beiden Bildern" |

**Strukturiertes Zeichnen:**

| Szenario | Sagen Sie |
|---|---|
| Diagramm | „Zeichne eine Architektur: Client → API-Gateway → zwei Microservices" (D2) oder „Zeichne einen Abhängigkeitsgraphen in DOT" (Graphviz) |
| Chart | „Erstelle ein Balkendiagramm aus diesen Verkaufsdaten" |
| Formel | „Rendere diese Formel: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" |
| Share-Karte | „Erstelle eine OG-Karte mit **violett-blauem Verlauf** und einem 🚀-Emoji für diesen Artikel" |
| Icon | „Gib mir ein GitHub-Logo-Icon" |
| QR-Code | „Erstelle einen QR-Code für https://..." |

> Das Angeben von Provider/Modell betrifft nur diesen Aufruf, **nicht Ihre config**. Diagramme verwenden die [D2-Syntax](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/), Charts [Vega-Lite](https://vega.github.io/vega-lite), Formeln [LaTeX](https://www.latex-project.org), Icons auf [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude generiert die Quelle automatisch.

> **Mermaid**: `generate_diagram` unterstützt **D2 und Graphviz**; das In-Process-Rendering von Mermaid benötigt einen Browser/Chromium (ungeeignet für ein deterministisches MCP), daher wird es nicht unterstützt — verwenden Sie stattdessen D2 (deckt Flussdiagramm/Sequenz/Klasse/ER/Mindmap ab) oder Graphviz.

---

## 📡 Provider

| | Standard | Bild (kostenlos) | Video (kostenlos) | Stärke |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Alles kostenlos, fotorealistisch, nativer Ton |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, natives Chinesisch, China-konform |

Wechseln: `defaultProvider: "zhipu"`, oder pro Modalität über `defaultImageProvider`/`defaultVideoProvider`, oder `provider` pro Aufruf übergeben. Unsicher, welcher? Siehe [Benchmark](doc/Agnes_vs_Zhipu_横评.md).

---

## ⚙️ Config (erweitert, meist unnötig)

**Dreistufiger Provider-Fallback** (Argument pro Aufruf > pro Modalität > global):

| Feld | Standard | Beschreibung |
|---|---|---|
| `defaultProvider` | `agnes` | Globaler Standard (letzter Fallback) |
| `defaultImageProvider` | wie oben | Standard für Bild-Modalität (`generate_image`) |
| `defaultVideoProvider` | wie oben | Standard für Video-Modalität (`create_video`/`get_video`) |

Z. B. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → Bilder über agnes, Video über Zhipu.

Verbindungs-Config pro Provider: `providers.<name>.apiKey` (erforderlich), `providers.<name>.models.{image,video}.default`, `outDir` (Ausgabeverzeichnis, Standard `session-dir/output`).

> Rate-Limit-Selbstlernen (`rateLimits` / `rateLimitTtlMs` — bei 429 lernt das System automatisch das echte Limit + TTL-Ablauf-Fallback) und weitere fortgeschrittene Felder — siehe [doc/](doc/).

---

## ❓ FAQ

**Videos langsam?** 3–18 s, dauert ~1–3 Min. Wenn Sie `wait` weglassen, läuft es asynchron (bei geschätzten >60 s wird ein Handle zurückgegeben, mit Abschlussbenachrichtigung).
**Anzahl Frames?** Geben Sie `durationSeconds` an, um automatisch zu wählen (5/10/18 s). Agnes erlaubt nur 81/121/161/241/441.
**429 bekommen?** 62-Sekunden-Serializer eingebaut; lernt das echte Rate-Limit automatisch.
**Brauchen strukturierte Tools einen Key?** Nein. Die 6 lokalen Tools funktionieren out of the box; nur die KI-Generierung benötigt einen Key.
**Karten-CJK/Emoji/Verlauf?** Eingebaute CJK-Schrift (automatisch), twemoji-Farb-Emoji (automatisch); übergeben Sie einen CSS-`linear-gradient(...)` an `bg` für einen Verlauf.
**Config wird nicht gelesen?** Muss unter `~/.media-gen-mcp/config.json` liegen (npx installiert in den Cache; eine Config im Projekt ist nicht verfügbar).

---

## 🏗️ Architektur + Doku

- **Provider-steckbar** (agnes + zhipu; einen Provider hinzuzufügen erfordert null Änderungen auf der Tool-Ebene); **Engine-steckbar** (DiagramEngine läuft parallel zu MediaProvider, ohne Cross-Pollution).
- Mehr in [doc/](doc/): [Agnes-Onboarding](doc/Agnes%20开通指引.md) · [Zhipu-Onboarding](doc/Zhipu%20开通指引.md) · [Agnes-vs-Zhipu-Benchmark](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Unterstützen

Wenn Ihnen media-gen-mcp hilft, laden Sie den Autor doch auf einen Kaffee ein ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Oder ⭐ Star vergeben, ein Issue / einen PR öffnen — über alles freuen wir uns.

## License

[MIT](LICENSE)
