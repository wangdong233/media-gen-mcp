<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Ein multimodaler Bildgenerierungs-MCP-Server für Claude Code**

KI-Bilder + strukturierte Bilder, ein Server deckt alles ab: Text-zu-Bild / Bild-zu-Bild / Text-zu-Video / Bild-zu-Video / Keyframe-Animation (über die kostenlosen Modelle von Agnes AI + Zhipu) **+ Diagramme / Datendiagramme / QR-Codes** (lokales deterministisches Rendering, kein Key nötig)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① Kostenlosen Key erhalten

Registrieren Sie sich bei einem (oder beiden) der folgenden Anbieter, um einen kostenlosen API-Key zu erhalten:

| Provider | Kostenlos | Registrierung |
|---|---|---|
| **Agnes AI** (Standard) | Alle Bild- + Video-Funktionen kostenlos | https://platform.agnes-ai.com/ → Registrieren → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinesisch) | cogview-3-flash Bild + cogvideox-flash Video dauerhaft kostenlos | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verifizieren → Key erstellen |

> Ausführliche Schritte: [doc/Agnes Onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu Onboarding](doc/Zhipu%20开通指引.md)

## ② Konfigurieren (einmalig)

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

## ③ Zu Claude Code hinzufügen

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

Der Installationsbefehl enthält **keinen Key** (er steht in der config oben). Führen Sie `/mcp` aus — `media-gen-mcp ✓ Connected` bedeutet Erfolg.

## ④ Verwendung

Sagen Sie es einfach in Claude Code (automatisch an den richtigen provider / das richtige Modell geleitet):

| Szenario | Sagen Sie | Ergebnis |
|---|---|---|
| **Standard** | „Erstelle ein fotorealistisches Katzenbild" / „Erstelle ein 5s Strand-Video" | Verwendet defaultImageProvider / defaultVideoProvider |
| **Bestimmter provider** | „Zeichne mit **Zhipu**" / „Verwende **agnes** für das Video" | Wechselt den provider vorübergehend, ohne die config zu ändern |
| **Bestimmtes Modell** | „Zeichne mit **cogview-4**" / „Verwende **agnes-video-v2.0**" | Wählt ein bestimmtes Modell (höhere Qualität usw.) |
| **provider + Modell** | „Erstelle mit **Zhipu cogvideox-3** ein 4K-Video" | Genaue Spezifikation (4K / Erstes-Letztes-Frame) |
| **Bild-zu-Bild** | „Wandle dieses Bild in Aquarell um" | Referenzbild → neues Bild |
| **Bild-zu-Video** | „Mach aus diesem Bild ein Video" | Einzelbild → Video |
| **Keyframes** | „Erzeuge einen fließenden Übergang zwischen diesen beiden Bildern" | Mehrere Bilder → fließender Übergang |

> Keine Spezifikation → verwendet Standardwerte; das Angeben von provider / Modell betrifft nur diesen Aufruf, **nicht Ihre config**.

## ④ Lokale strukturierte Bilder (ohne Key, deterministisch)

Diese Tools **rufen keine KI auf**¹ — Claude erzeugt eine DSL/JSON/LaTeX/fields → lokal zu SVG/PNG (Vektor, hochauflösend) gerendert:

| Werkzeug | Sagen Sie | Ausgabe |
|---|---|---|
| **Diagramme** `generate_diagram` | „Zeichne eine Architektur: Client → API-Gateway → zwei Microservices" | Architektur / Sequenz / Flussdiagramm / Klasse / ER / Mindmap (D2 DSL → SVG) |
| **Datendiagramme** `generate_chart` | „Erstelle ein Balkendiagramm aus diesen Verkaufsdaten" | Balken / Linie / Kreis / Fläche / Streuung (Vega-Lite → SVG) |
| **Formeln** `generate_formula` | „Rendere diese Formel: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" | LaTeX → SVG (MathJax, Glyphen eingebettet, keine Schrift nötig) |
| **Karten** `generate_card` | „Erstelle eine OG-Share-Karte für diesen Artikel" | OG-/Social-/Zitat-Karten (Satori → PNG, Standard 1200×630) |
| **Icons** `generate_icon` | „Gib mir ein GitHub-Logo-Icon" | 200k+ Icons auf Abruf (Iconify, `prefix:name`) |
| **QR-Codes** `generate_qrcode` | „Erstelle einen QR-Code für https://..." | SVG / PNG (rein lokal, null Netzwerk) |

> ¹ Alles lokal & deterministisch, außer **Icons** (Iconify-API) und der **Standard-Schrift der Karte** (wird bei erster Nutzung vom CDN geladen und in `~/.media-gen-mcp/fonts/` gecacht); übergib `fontPath`, um die Karte vollständig offline zu machen. **Chinesische/CJK-Karten**: die Standard-Schrift Inter ist nur für Latin — übergib `fontPath` mit einer CJK-Schrift (.ttf/.otf/.woff). Diagramme verwenden die [D2-Syntax](https://d2lang.com), Datendiagramme [Vega-Lite](https://vega.github.io/vega-lite), Formeln [LaTeX](https://www.latex-project.org), Icons auf [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude generiert die Quelle automatisch.

## Providers

| | Standard | Bild (kostenlos) | Video (kostenlos) | Stärke |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Alles kostenlos, fotorealistisch, nativer Ton |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, natives Chinesisch, China-konform |

Wechseln: `defaultProvider: "zhipu"`, oder je Modalität über `defaultImageProvider` / `defaultVideoProvider`, oder `provider` pro Aufruf übergeben. Unsicher, welcher? Siehe [Benchmark](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (erweitert, meist unnötig)

**Dreistufiger provider-Fallback** (Argument pro Aufruf > je Modalität > global):

| Feld | Standard | Beschreibung |
|---|---|---|
| `defaultProvider` | `agnes` | Globaler Standard (letzter Fallback, wenn keine Modalität gesetzt ist) |
| `defaultImageProvider` | wie `defaultProvider` | Standard für Bild-Modalität (verwendet von `generate_image`) |
| `defaultVideoProvider` | wie `defaultProvider` | Standard für Video-Modalität (verwendet von `create_video` / `get_video`) |

Z. B. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → Bilder über agnes, Video über Zhipu. Lassen Sie die letzten beiden Felder weg, um für alles auf `defaultProvider` zurückzufallen.

Verbindungs-config pro provider:

| Feld | Standard | Beschreibung |
|---|---|---|
| `providers.<name>.apiKey` | — | **erforderlich**, einer pro provider |
| `providers.<name>.models.image.default` | provider-integriert | Standard-Bildmodell |
| `providers.<name>.models.video.default` | provider-integriert | Standard-Videomodell |
| `outDir` | session-dir/output | Ausgabeverzeichnis (pro Aufruf überschreibbar) |

> Rate-Limit-Selbstlernen (`rateLimits` / `rateLimitTtlMs`) und weitere fortgeschrittene Felder — siehe [doc/](doc/).

## FAQ

**Videos langsam?** 3–18 s, dauert ~1–3 Min. Wenn Sie `wait` weglassen, läuft es asynchron mit Abschlussbenachrichtigung.
**Anzahl Frames?** Geben Sie `durationSeconds` an, um automatisch zu wählen (5/10/18 s). Agnes erlaubt nur 81/121/161/241/441.
**429 bekommen?** 62-Sekunden-Serializer eingebaut; lernt das echte Rate-Limit automatisch.
**config wird nicht gelesen?** Muss unter `~/.media-gen-mcp/config.json` liegen (npx installiert in den Cache; eine config im Projekt ist nicht verfügbar).

## Architektur + Doku

provider-erweiterbar (agnes + zhipu; einen provider hinzuzufügen erfordert null Änderungen auf der Tool-Ebene). Mehr in [doc/](doc/):

- [doc/Agnes Onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu Onboarding](doc/Zhipu%20开通指引.md) · [doc/Agnes vs Zhipu Benchmark](doc/Agnes_vs_Zhipu_横评.md)

## 💝 Unterstützen

Wenn Ihnen media-gen-mcp hilft, laden Sie den Autor doch auf einen Kaffee ein ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Oder ⭐ Star vergeben, ein Issue / einen PR öffnen — wir freuen uns über alles.

## Lizenz

[MIT](LICENSE)
