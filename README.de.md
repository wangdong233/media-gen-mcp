<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-kostenlosen-key-besorgen)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#lizenz)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Gib Claude Code die „Superkraft der Bildgenerierung" – mit einem einzigen Satz Bilder / Videos / Diagramme / Karten / QR-Codes erzeugen**

KI-Bild- & Videogenerierung (kostenlos) + strukturiertes Zeichnen (lokal, deterministisch) + cooles SVG-Rendering (Chrome, hochpräzise)

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Merkmale

- 🆓 **Komplett kostenlos** – KI-Bild- & Videogenerierung läuft über Agnes AI + Zhipus kostenlose Modelle; strukturiertes Zeichnen vollständig lokal, null Kosten
- 🧠 **Null Lernaufwand** – einfach in normaler Sprache beschreiben, Claude wählt automatisch das Werkzeug, generiert den Code und erstellt das Bild
- 📐 **Deterministische Ausgabe** – Strukturdiagramme/Diagramme/Formeln/Karten: gleiche Eingabe liefert immer dieselbe Ausgabe, Inhalte voll kontrollierbar
- 🇨🇳 **Chinesisch-freundlich** – Karten rendern automatisch Chinesisch (eingebettete Schrift); Zhipu-Modelle nativ Chinesisch
- 🔌 **Keine weiteren Abhängigkeiten** – D2 / Graphviz / Vega / MathJax sind vollständig gebündelt, keine Systeminstallation von d2/dot/matplotlib nötig
- 🎨 **Cooles Rendering** – feGaussianBlur-Glow/Verläufe/Tiefenunschärfe, automatisch über Chrome hochpräzise gerendert
- 🌐 8-sprachige Dokumentation · MIT · Node ≥18

---

## 💬 Was bekommst du?

Nach der Installation genügt in Claude Code **ein einziger Satz**, um:

| Du sagst | Du erhältst |
|---|---|
| „Generiere ein realistisches Bild einer orangen Katze im Wuxia-Stil" | 🖼️ KI-generiertes realistisches Bild |
| „Erzeuge ein 5-Sekunden-Video am Meer" | 🎬 KI-generiertes Kurzvideo |
| „Zeichne ein Architekturdiagramm: Client → API-Gateway → zwei Microservices" | 📐 Sauberes Vektor-Architekturdiagramm |
| „Stelle diese Verkaufsdaten als Balkendiagramm dar" | 📊 Datenvisualisierung |
| „Rendere diese Formel `E=mc^2`" | ➗ Hochauflösendes Formel-Bild |
| „Erstelle eine Verlauf-Share-Karte mit 🚀 Emoji" | 🎴 OG-/Social-Share-Bild (Chinesisch automatisch) |
| „Gib mir ein GitHub-Logo" | 🏷️ Vektor-Icon |
| „Generiere einen QR-Code" | ▪️ QR-Code |
| „Zeichne ein cooles, düsteres Tech-Architekturdiagramm mit Glow" | ✨ Hochpräzises Chrome-Rendering |

> **All das mit nur einem einzigen Satz.** Du musst keinen Werkzeugnamen und keine Parameter lernen.

---

## 🚀 Schnellstart

### ① Kostenlosen Key besorgen

Registriere dich bei einem der folgenden Anbieter (oder beiden) und hole dir einen kostenlosen API-Key:

| Anbieter | Kostenlos | Anmeldung |
|---|---|---|
| **Agnes AI** (Standard) | Text-zu-Bild + Text-zu-Video komplett kostenlos | https://platform.agnes-ai.com/ → Registrieren → API Keys |
| **Zhipu BigModel** (optional, 4K / Chinesisch) | cogview-3-flash Bild + cogvideox-flash Video dauerhaft kostenlos | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → Identität verifizieren → Key erstellen |

> Ausführliche bebilderte Anleitungen: [Agnes-Einrichtungsanleitung](doc/Agnes%20开通指引.md) · [Zhipu-Einrichtungsanleitung](doc/Zhipu%20开通指引.md)

### ② Konfiguration

Erstelle `~/.media-gen-mcp/config.json` und trage deinen Key ein:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-dein-agnes-key" },
    "zhipu": { "apiKey": "dein-zhipu-key" }
  }
}
```

Nur agnes zu konfigurieren reicht ebenfalls aus (lösche die zhipu-Zeile). Wenn du `models` nicht angibst, werden die integrierten Standardmodelle verwendet.

### ③ In Claude Code einbinden

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

Der Einbindungsbefehl enthält **keinen Key** (der Key steht in der obigen config). Wenn du unter `/mcp` `media-gen-mcp ✓ Connected` siehst, war es erfolgreich.

### ④ Sag einen Satz

Sag in Claude Code einfach „Zeichne ein Architekturdiagramm" oder „Generiere ein realistisches Bild einer orangen Katze" – fertig.

> **Nur Strukturdiagramme/Diagramme/Karten/QR-Codes zeichnen?** Dafür brauchst du keinen Key – nach der Installation (③) sofort einsatzbereit.

---

## 📡 Anbieter

| | Standard | Bild (kostenlos) | Video (kostenlos) | Besonderheiten |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Komplett kostenlos, realistische Qualität, natives Audio & Bild |
| **zhipu** (optional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, natives Chinesisch, China-konform |

Wechseln via `defaultProvider: "zhipu"`, nach Modalität über `defaultImageProvider`/`defaultVideoProvider`, oder pro Aufruf über `provider`. Weißt du nicht, welchen du wählen sollst? Siehe [Vergleichstest](doc/Agnes_vs_Zhipu_横评.md).

---

## 🛠️ Fähigkeiten im Detail

### 🤖 KI-Generierung (kostenlose Modelle · online)

Nutze die kostenlosen Modelle von Agnes AI oder Zhipu:
- **Text-zu-Bild / Bild-zu-Bild** – realistisch, Illustration, Konzeptkunst
- **Text-zu-Video / Bild-zu-Video / Keyframe-Animation** – intelligentes asynchrones Verhalten (lange Videos werden im Hintergrund generiert, Benachrichtigung bei Fertigstellung)
- Anbieter/Modell angeben: „Zeichne mit **Zhipu cogview-4** ein Bild" / „Generiere mit **agnes** ein Video"

### 📐 Strukturiertes Zeichnen (lokal · deterministisch · ohne Key)

Die folgenden Fähigkeiten **rufen keine KI auf und liefern deterministische Ausgaben** (SVG-Vektor, hochauflösend):

| Fähigkeit | Engine (alle eingebettet) | Beschreibung |
|---|---|---|
| **Strukturdiagramme** | D2 + Graphviz | Architektur/Fluss/Sequenz/Klassendiagramm/ER/Mindmap, automatisches Layout |
| **Datendiagramme** | Vega-Lite | Balken/Linie/Kuchen/Fläche/Streuung, Claude generiert automatisch aus den Daten |
| **Mathematische Formeln** | MathJax | LaTeX → SVG, Glyphen eingebettet |
| **Share-Karten** | Satori | OG/Poster/Zitat-Karten (Chinesisch + Verlauf + Emoji + Glow automatisch) |
| **QR-Codes** | qrcode | URL/Text → SVG/PNG |
| **Vektor-Icons** | Iconify | 200.000+ Icons (`icon: "mdi:home"`) |
| **Cooles SVG** | Chrome / resvg | Handgeschriebenes SVG (Glow/Filter/Tiefenunschärfe) → hochpräzises Chrome-Rendering |

<details>
<summary>📖 Was können Karten?</summary>

- 5 Vorlagen: og (linksbündige Hierarchie) / quote (Zitat, Anführungszeichen links/rechts positionierbar) / minimal (minimalistisch) / hero (große Schautypografie + Lichtflecken) / panel (Glas-Panel)
- Verlaufs-Titeltext + Glow + verschwommene Lichtflecken für Tiefe
- Eingebettetes Logo / runder Avatar
- Automatisches Chinesisch (Noto Sans SC offline) + automatische farbige Emojis (auf Festplatte gecacht, ohne Netz nutzbar)
- Benutzerdefinierte Größe (Standard 1200×630, OG-Norm)
</details>

<details>
<summary>📖 Was ist das coole SVG-Rendering?</summary>

Die D2-Engine unterstützt keine SVG-Filter (feGaussianBlur-Glow). Wenn du also Effekte wie „cooles düsteres Tech-Feeling, Glow, Tiefenunschärfe" möchtest:
1. Claude schreibt das SVG von Hand (mit Filtern wie feGaussianBlur)
2. Aufruf des Werkzeugs `render_svg`
3. Das Werkzeug wählt automatisch das Backend: wenn `<filter>` vorhanden + System-Chrome verfügbar → Chrome (100 % Filter-Treue); sonst → resvg (92 %, leichtgewichtig)
</details>

<details>
<summary>📖 Offline-Hinweise (welche Werkzeuge brauchen Internet?)</summary>

- **Vollständig offline**: generate_diagram / generate_chart / generate_formula / generate_qrcode
- **Nach erstem Online-Abruf gecacht & offline**: generate_card (Standard-Lateinschrift Inter wird beim ersten Mal aus dem CDN geholt und unter `~/.media-gen-mcp/fonts/` gecacht; CJK-Schrift Noto Sans SC ist bereits offline eingebettet; twemoji-Emojis werden auf Festplatte gecacht und sind ohne Netz nutzbar)
- **Internet erforderlich**: generate_icon (holt Icons über die Iconify-API), render_svg bei Filtern (benötigt Chrome)
- **Immer online**: KI-Generierungswerkzeuge (generate_image / create_video)
</details>

---

## ❓ FAQ

**Video langsam?** 3–18s, ca. 1–3 Minuten. Lass `wait` weg für asynchrones Verhalten (>60s liefert ein Handle zurück, Benachrichtigung bei Fertigstellung).
**Anzahl Frames?** Übergib `durationSeconds`, es wird automatisch gewählt (5/10/18s). Agnes erlaubt nur 81/121/161/241/441.
**429er-Fehler?** Eingebaut: 62s seriell + automatisches Lernen der echten Rate-Limits.
**Brauchen strukturierte Werkzeuge einen Key?** Nein. Nach der Installation kannst du sofort Diagramme/Charts/Karten/QR-Codes zeichnen.
**Karten mit Chinesisch/Emoji/Verlauf?** Alles automatisch: eingebettete CJK-Schrift + twemoji-Emojis (auf Festplatte gecacht) + CSS-Verlaufshintergrund.
**Cooles SVG?** Claude schreibt das SVG von Hand (mit feGaussianBlur-Glow) → `render_svg` → Chrome mit 100 % Filter-Treue.
**Wird Mermaid unterstützt?** Nein (bräuchte einen Browser). Nutze stattdessen D2 (deckt Fluss/Sequenz/Klassendiagramm/ER/Mindmap ab).
**Config wird nicht gelesen?** Sie muss unter `~/.media-gen-mcp/config.json` liegen.
**`npx` funktioniert nicht?** Fallback: globale Installation:
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ Architektur + Dokumentation

- **Provider steckbar** (agnes + Zhipu, einen neuen Provider hinzufügen, ohne die Werkzeugschicht zu ändern); **Engine steckbar** (DiagramEngine und MediaProvider laufen parallel, ohne sich gegenseitig zu beeinflussen)
- [Architektur-Anforderungsliste](doc/架构要求清单.md) – Architekturnormen des Projekts (fortlaufend gepflegt)
- Mehr unter [doc/](doc/): [Agnes-Einrichtungsanleitung](doc/Agnes%20开通指引.md) · [Zhipu-Einrichtungsanleitung](doc/Zhipu%20开通指引.md) · [Provider-Vergleichstest](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Autor unterstützen

Wenn media-gen-mcp dir hilft, lade den Autor gern auf einen Kaffee ein ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Oder ⭐ Star vergeben, ein Issue / PR einreichen – all das unterstützt den Autor.

## Lizenz

[MIT](LICENSE)
