# media-gen-mcp

> Das «All-in-One-Bild-Toolkit» für Claude Code – Bilder erzeugen, Ideen zeichnen, Bilder verstehen, in einem einzigen Satz. Komplett kostenlos.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.11.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Einmal in Claude Code installiert – danach wird jede Bild-Aufgabe zu einem einzigen Satz.** Designer, die Visuals erstellen, Entwickler, die Architekturdiagramme zeichnen, Marketing-Teams, die Share-Karten bauen, Finance-Teams, die Tabellen aus Rechnungen extrahieren – Bilderzeugung / Video + Erkennung + Zeichnen / Karten / QR-Codes, alles abgedeckt, **100 % kostenlos** (kostenlose Provider + lokale Engines – funktioniert sofort nach der Installation).

Satt, mehrmals pro Woche Bilder zu erstellen und N Tools mit N Parametersätzen zu jonglieren? Einmal installieren und jedes Bild-Szenario an Claude übergeben.

<div align="center">

[简体中文](README.md) | [English](README.en.md) | **Deutsch** | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

## Inhaltsverzeichnis

- [Sag es, bekomme es](#sag-es-bekomme-es)
- [Schnellstart in 60 Sekunden](#schnellstart-in-60-sekunden)
- [Das komplette Werkzeug-Set](#das-komplette-werkzeug-set)
- [Konfiguration im Detail](#konfiguration-im-detail)
- [FAQ](#faq)
- [Für wen ist das?](#für-wen-ist-das)
- [Den Autor unterstützen](#den-autor-unterstützen)
- [License](#license)

---

## Sag es, bekomme es

| Du sagst … | Du erhältst |
|---|---|
| «Zeichne eine Cyberpunk-Katze mit Neon-Glow» | Ein fotorealistisches KI-Bild, gespeichert unter `output/` |
| «Erzeuge ein 5-Sekunden-Video eines Sonnenuntergangs am Meer» | Ein KI-Video MP4 (wird im Hintergrund erzeugt, du wirst bei Fertigstellung benachrichtigt) |
| «Zeichne ein Architekturdiagramm: Client → API-Gateway → Bestelldienst + Zahlungsdienst» | Ein Vektor-Architekturdiagramm |
| «Stelle diese Verkaufsdaten als Balkendiagramm dar» | Ein hochauflösendes Datenchart |
| «Erstelle einen QR-Code auf github.com» | Ein Vektor-QR-Code |
| «Rendere E=mc² als hochauflösende Formel» | Eine Vektor-Formel |
| «Erstelle eine dunkle Share-Karte mit Verlauf, Titel: Juli-Neuheiten 🚀» | Eine sauber gesetzte Share-Karte (Chinesisch + Emoji automatisch) |
| «Erkenne die Tabelle in diesem Rechnungs-Screenshot» | Eine einfügbare HTML-/Markdown-Tabelle (neu in 0.11.0) |
| «Lies dieses Balkendiagramm in Datenpunkte ein» | Strukturierte CSV-/JSON-Daten (neu in 0.11.0) |
| «Beschreibe, was in diesem Bild zu sehen ist» | Eine Antwort in natürlicher Sprache (neu in 0.11.0) |

> Kein Werkzeugnamen-Lernen, keine Systemabhängigkeiten – **Claude wählt automatisch den besten Weg**.

---

## Schnellstart in 60 Sekunden

Die Kernidee: **Zeichnen / Karten / QR-Codes / Formeln sind lokale Engines, und auch OCR (Texterkennung) fällt standardmäßig auf eine prozessinterne Engine zurück – keiner davon ruft KI auf oder berührt das Netz, sie funktionieren sofort nach der Installation.** Nur fotorealistische KI-Bilder / -Videos brauchen einen kostenlosen API-Key – wir verlagern das «erste Bild» und das «erste Lesen» vor die Registrierung.

### 30 Sekunden | Einzeilige Installation (ohne Key)

```bash
# In einer Zeile installieren (ohne Key, 30 Sekunden)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Claude Code neu starten → /mcp eingeben → media-gen-mcp ✓ Connected sehen = Erfolg
```

### 30 Sekunden | Erstes Bild sofort, ohne Key

Sag einfach einen Satz zu Claude:

```
Erstelle eine Share-Karte im dunklen Tech-Stil, Titel: Claude Code Bild-All-in-One-Toolkit
```

→ Ein Vektor-Bild wird automatisch unter `output/` gespeichert, sofort öffnen und verwenden. **Du hast noch keinen API-Key registriert und hältst das Ergebnis bereits in Händen.**

Auch die folgenden sind ohne Key und ohne Netz sofort einsatzbereit:

- «Erstelle einen QR-Code auf github.com»
- «Rendere E=mc² als hochauflösende Formel»
- «Zeichne ein Architekturdiagramm: Client → Gateway → Bestelldienst + Zahlungsdienst → Datenbank, dunkler Tech-Stil»
- «Lies die Ziffern aus diesem Captcha-Bild» (OCR, standardmäßig prozessintern, nichts zu installieren)
- «Extrahiere den englischen Text aus diesem Screenshot»

### Willst du fotorealistische KI-Bilder / Videos? Füge einen kostenlosen API-Key hinzu (optional)

```bash
# ① Hol dir einen kostenlosen API-Key (Agnes empfohlen, Standard-Provider)
#    https://platform.agnes-ai.com/ → Registrieren → API Keys → sk-xxx kopieren
#    (Zhipu cogview-3-flash / cogvideox-flash sind ebenfalls dauerhaft kostenlos – wähle einen oder konfiguriere beide)

# ② Schreibe es nach ~/.media-gen-mcp/config.json (nur einen zu konfigurieren reicht ebenfalls)
{
  "providers": {
    "agnes": { "apiKey": "sk-dein-agnes-key" }
  }
}

# ③ Zurück in Claude Code: «Zeichne eine fotorealistische Cyberpunk-Orangekatze»
#    → Ein fotorealistisches KI-Bild wird gespeichert. Dasselbe gilt für Videos: «Erzeuge ein 5-Sekunden-Sonnenuntergang-am-Meer-Video»
```

> Möchtest du kein npx verwenden? Eine globale Installation klappt auch: zuerst `npm i -g media-gen-mcp-server`, dann `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

---

## Das komplette Werkzeug-Set

> Sag Claude einfach, was du tun willst – es wählt automatisch den besten Weg. Im Folgenden nach «Was du tun willst» gruppiert – du musst nicht wissen, was dahinter steckt.

### Ein Bild erzeugen (von Grund auf)

**Ein fotorealistisches Foto oder eine Illustration zeichnen**
> Du: «Zeichne eine fotorealistische Cyberpunk-Orangekatze mit Neon-Glow»
> Erhalten: ein fotorealistisches Bild, gespeichert unter `output/` (auch Illustrationen / Konzeptkunst / Logo-Entwürfe / Sci-Fi-Szenen)

**Aus einem Satz oder einem Bild ein kurzes Video machen**
> Du: «Erzeuge ein 5-Sekunden-Video eines Sonnenuntergangs am Meer»
> Erhalten: ein MP4-Video (3–18 Sekunden; lange Videos werden im Hintergrund erzeugt, du wirst bei Fertigstellung benachrichtigt)

**Ein Icon oder Marken-Logo holen**
> Du: «Hol ein GitHub-Logo, 128 Pixel»
> Erhalten: ein Vektor-Logo aus einer Bibliothek mit 200.000+ Icons, sofort verwendbar (GitHub / Twitter / Material / Lucide / Font Awesome usw.)

### Ein Bild verstehen (Bild → Daten · neu in 0.11.0)

**Text aus einem Screenshot extrahieren**
> Du: «Lies die Ziffern aus diesem Captcha»
> Erhalten: Klartext (Captchas / Rechnungsnummern / gescannte Dokumente / Chat-Protokolle – alles möglich)

**Ein Tabellen-Bild in HTML / Markdown umwandeln**
> Du: «Erkenne die Tabelle in diesem Rechnungs-Screenshot»
> Erhalten: eine einfügbare Markdown-Tabelle (Rechnungen / Berichte / gescannte Dokumente – kein Neu-Abtippen mehr)

**Aus einem Chart die Rohdaten zurückgewinnen**
> Du: «Lies dieses Balkendiagramm als Daten ein»
> Erhalten: strukturierte CSV-/JSON-Daten (Balken / Linie / Torte – alles unterstützt)

**Das Bild in klaren Worten erklären lassen**
> Du: «Wie viele Menschen sind auf diesem Bild? Was tun sie?»
> Erhalten: eine Antwort in natürlicher Sprache (visuelle Q&A / Handschrift / Formeln / komplexe Szenen)

### Ideen sauber zeichnen (ohne Key, funktioniert sofort nach der Installation)

**Ein Strukturdiagramm zeichnen**
> Du: «Zeichne ein Architekturdiagramm: Client → API-Gateway → Bestelldienst + Zahlungsdienst → Datenbank»
> Erhalten: ein Vektor-Architekturdiagramm (auch Fluss-/Sequenz-/Klassen-/ER-Diagramme / Mindmaps)

**Daten als Chart darstellen**
> Du: «Stelle diese Verkaufsdaten als Balkendiagramm dar»
> Erhalten: ein hochauflösendes Datenchart (Balken / Linie / Torte / Fläche / Streuung – gib eine Zahlenreihe oder eine CSV)

### Karten / Poster / QR-Codes erstellen (sieht geteilt gut aus)

**Share-Karte / OG-Bild / Zitat-Karte / Cover / Poster erstellen**
> Du: «Erstelle eine dunkle Share-Karte mit Verlauf, Titel: Juli-Neuheiten 🚀»
> Erhalten: eine schön gesetzte Karte (Titel, Untertitel, Verlaufsfarben, Glow, farbige Emojis, eingebettetes Logo – alles automatisch; Chinesisch und japanische Kanji ohne Zeichensalat)

**Einen QR-Code erzeugen**
> Du: «Erstelle einen QR-Code auf github.com»
> Erhalten: ein Vektor-QR-Code (URL oder Text – bleibt scharf, auch als Poster gedruckt)

**Mathematische Formeln als hochauflösendes Bild rendern**
> Du: «Rendere E=mc² als hochauflösende Formel»
> Erhalten: eine Vektor-Formel (LaTeX, komplexe Brüche, chemische Gleichungen – alles unterstützt)

### Coole Animationen / Tech-Grafiken erstellen (gleiche Eingabe → gleiche Ausgabe, immer)

**SVG als hochauflösendes PNG rendern**
> Du: «Zeichne einen Tech-Hintergrund mit Glow, Sternenfeld und Tiefe»
> Erhalten: eine coole PNG, mit der automatisch besten Render-Methode für maximale Treue ohne Artefakte

**HTML-/CSS-Animation in ein Video umwandeln**
> Du: «Mach eine 3-Sekunden-Produktintro-Animation, Verlaufsfarben + Partikel»
> Erhalten: ein MP4-/GIF-/WebM-Video (Produkt-Intros / Marken-Animationen / Motion-Demos – Frame für Frame gerendert, gleiche Eingabe liefert immer dasselbe Video)

> **Tipp**: Erzeugung / Erkennung läuft über Online-KI; Zeichnen / Karten / QR-Codes / Animationen sind lokale Engines – **funktionieren sofort nach der Installation, vektorscharf, gleiche Eingabe liefert immer dasselbe Bild**.

---

## Konfiguration im Detail

> In einem Satz: **Strukturierte Fähigkeiten (Zeichnen / Charts / Karten / QR-Codes / Formeln) funktionieren ohne Konfiguration sofort; KI-Erzeugung braucht eine Zeile API-Key; Erkennung ist standardmäßig ohne Konfiguration – du hostest nur selbst, wenn du chinesisches SOTA / Tabellen / Charts willst.** Was du tun willst, entscheidet, was du konfigurierst – nicht alles ist nötig.

### Konfiguration nach «Was will ich tun?»

| Was du tun willst | Was du konfigurierst | Funktioniert sofort nach Konfiguration |
|---|---|---|
| Architekturdiagramme / Datencharts / Karten / QR-Codes / Formeln zeichnen | **Nichts** | Lokale Engine, sofort nach Installation |
| Fotorealistische KI-Bilder / KI-Videos (Text-zu-Bild, Text-zu-Video) | Einen kostenlosen API-Key (Agnes oder Zhipu, wähle einen) | Online-Erzeugung, gespeichert unter `output/` |
| OCR-Texterkennung (Englisch / Captchas / Ziffern / einfache Dokumente) | **Nichts** | Fällt standardmäßig auf die prozessinterne, leichtgewichtige Engine zurück, sofort nach Installation |
| Chinesisches OCR / Rechnungstabellen / Chart-Ablesen / visuelle Q&A / Handschrift / Formeln | Selbst-gehostete Verstehen-Engine (PaddleX oder vLLM, siehe Ressourcenanforderungen unten) | Nach Start des selbst-gehosteten Diensts eine Zeile baseUrl eintragen |

---

### 1. Erzeugungs-Konfiguration (KI-Bild / -Video)

**Standard-Provider: Agnes** (kostenlose Stufe ist dauerhaft, Text-zu-Bild + Text-zu-Video vollständig freigeschaltet). Zhipu ist die Alternative (mit nativer Optimierung für chinesische Szenarien).

**Ein Provider reicht** (hier ist die vollständige `config.json`; nur einen auszufüllen reicht ebenfalls):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-dein-agnes-key" },
    "zhipu": { "apiKey": "dein-zhipu-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/absoluter/pfad/zu/output"
}
```

**Wie du einen kostenlosen API-Key bekommst**:

- **Agnes** (empfohlen, Standard): https://platform.agnes-ai.com/ → Registrieren → API Keys → `sk-xxx` kopieren
- **Zhipu**: https://open.bigmodel.cn/ → Registrieren → API Keys (kostenlose Modelle: `cogview-3-flash` / `cogvideox-flash`, dauerhaft kostenlos)

**Beide zu konfigurieren ist zuverlässiger**: Sollte ein Provider vorübergehend ausfallen (Rate-Limits / Dienstschwankungen), übernimmt der andere automatisch – für dich unsichtbar, ohne doppelte Abbuchungen.

**Speicherort der Konfigurationsdatei**: `~/.media-gen-mcp/config.json` (macOS / Linux) oder `%USERPROFILE%\.media-gen-mcp\config.json` (Windows).

> Wenn diese Datei **fehlt, bricht nichts** – strukturierte Fähigkeiten und das Standard-OCR funktionieren weiter; du kannst nur keine KI-Erzeugung aufrufen.

---

### 2. Erkennungs-Konfiguration (Bildverstehen / OCR / Tabellen / Charts / Vision)

Die Erkennungsfähigkeiten kommen in **drei Stufen** – bei Bedarf installieren; die erste Stufe funktioniert standardmäßig.

#### Stufe 1: Standard-Leichtgewicht-Engine (null Konfiguration, sofort nach Installation)

- **Was sie kann**: Englisch / Ziffern / Captcha / einfache Dokument-OCR
- **Dienst nötig?**: **Nein**, als WASM in den MCP-Prozess gepackt, das Sprachmodell wird beim ersten Aufruf automatisch geladen
- **Mindest-Ressourcenbedarf**:
  - CPU: beliebig (reine CPU, keine GPU-Abhängigkeit)
  - GPU: nicht erforderlich
  - Speicher: ca. 200–500 MB (schwankt mit der Bildgröße)
  - Festplatte: ca. 30–50 MB (WASM-Engine + Sprachpakete)
  - Modellgröße: in der oben genannten Festplattennutzung enthalten (englisches Sprachpaket, in der Größenordnung weniger MB)
- **Geschwindigkeit**: ca. 3–5 Sekunden pro Bild
- **Für wen**: 90 % der leichtgewichtigen OCR-Szenarien, ausländische Dokumente, Captcha-Erkennung

> Für die meisten Nutzer reicht diese Stufe; die nächsten zwei sind optionale Upgrades.

#### Stufe 2: PaddleX / PP-StructureV3 (chinesisches SOTA + Tabellenerkennung)

- **Was sie kann**: Chinesisches OCR (deutlich besser als die Standard-Engine), Layout-Analyse, **Rechnungen / Berichte / gescannte Dokumente → HTML-/Markdown-Tabellen**, Chart-Ablesen
- **Dienst nötig?**: **Ja**, selbst einen PaddleX-REST-Dienst hosten; der MCP ruft ihn via `baseUrl` auf
- **Mindest-Ressourcenbedarf** (gemessen):

  | Modus | Minimum | Empfohlen | Hinweise |
  |---|---|---|---|
  | GPU-Modus | RTX 3060 12 GB VRAM | RTX 3060 12 GB / Tesla T4 | Modellladung ca. 2,4 GB, Spitze bei komplexen PDFs ca. 6 GB |
  | CPU-Modus | 4-Kern-CPU + 8 GB RAM | 8 Kerne + 16 GB RAM | Läuft (leichte Dokumente ok); Batch-/komplexe PDFs sind 3–5× langsamer |
  | Festplatte | ca. 3 GB | ca. 5 GB | paddlepaddle + paddlex + Modellgewichte |
  | Modellgröße | ca. 100–300 MB (pro Pipeline) | — | Summiert sich über mehrere Pipelines |

- **CUDA-Voraussetzung**: Compute Capability ≥ 7.0 (V100 / T4 / RTX 20/30/40-Serie; 50-Serie noch nicht vollständig unterstützt); für GPU-Beschleunigung nötig: CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6
- **Installation**:

  ```bash
  pip install paddlex paddlepaddle          # GPU-Version: paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  Dann eine Zeile zu `config.json` hinzufügen:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### Stufe 3: vLLM + Qwen2.5-VL (allgemeines Vision-verstehendes VLM)

- **Was sie kann**: visuelle Q&A, Handschrifterkennung, Formelerkennung, natürlichsprachliche Beschreibung komplexer Szenen – die «Verstehen»-Aufgaben, die PaddleX nicht abdecken kann
- **Dienst nötig?**: **Ja**, selbst einen vLLM-Inferenzdienst aufbauen
- **Mindest-Ressourcenbedarf** (gemessen):

  | Modus | Minimum | Empfohlen | Hinweise |
  |---|---|---|---|
  | GPU-Vollpräzision 7B (FP16) | 16 GB VRAM | **24 GB VRAM** (RTX 3090 / 4090 / A5000) | Modellgewichte ca. 15–16 GB + KV-Cache; vLLM belegt standardmäßig 90 % des VRAM |
  | GPU quantisiert 7B (INT8/AWQ) | 10–12 GB VRAM | 16 GB VRAM | Quantisierte Version passt in RTX 4080 / 4060 Ti 16 GB |
  | GPU-Leichtgewicht 3B | 6–8 GB VRAM | GTX 1660 / 3060 6–8 GB | FP16 ca. 6–8 GB, INT4 ca. 3–4 GB – der Sweet-Spot für Einzelentwickler |
  | CPU-Modus | Nicht empfohlen | — | Läuft, aber 5–10× langsamer; für Produktion GPU verwenden |
  | Arbeitsspeicher | 16 GB | 16–32 GB | — |
  | Festplatte | ca. 14 GB (7B-Gewichte) | — | 3B ca. 6 GB |
  | CUDA-Voraussetzung | Compute Capability ≥ 7.0 | — | Tesla T4 (7.5) Minimum; V100 / A100 / RTX 30/40-Serie funktionieren alle |

- **Installation**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # Sobald «Uvicorn running on http://0.0.0.0:8000» erscheint, ist es bereit
  ```
  Weitere Optionen (GPU-Wahl / Quantisierung / Nebenläufigkeits-Limits) siehe [vLLM-Dokumentation](https://docs.vllm.ai). Dann zu `config.json` hinzufügen:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

#### Drei-Stufen-Spickzettel

| Stufe | Dienst starten? | Ressourcen-Schwelle | Chinesisch | Tabellen | Visuelle Q&A | License |
|---|---|---|---|---|---|---|
| **Standard** (tesseract) | Nein | Null (reine CPU-WASM) | Mittelmässig | ❌ | ❌ | Apache 2.0 |
| **PaddleX** | Ja | GPU 12 GB oder CPU 4-Kern 8 GB | ✅ SOTA | ✅ | ❌ | Apache 2.0 |
| **vLLM Qwen2.5-VL** | Ja | **GPU 16–24 GB** (CPU nicht realistisch) | ✅ | Mittelmässig | ✅ | Apache 2.0 |

> Die Erkennungsseite wählt absichtlich nur Apache-2.0-Engines (tesseract.js + PaddleOCR + Qwen2.5-VL) und umgeht AGPL-/GPL-/kommerzielle Anwendungs-Fallen – **Unternehmen können es kommerziell ohne Bedenken einsetzen**.

---

### 3. Automatischer Fallback-Mechanismus (einmal konfiguriert, musst du dich nicht kümmern)

- **Erzeugungsseite**: Agnes ↔ Zhipu – wenn einer fehlschlägt, wird automatisch auf den anderen gewechselt (zwei aufeinanderfolgende Fehlschläge innerhalb von 60 Sekunden lösen eine weiche Umschaltung aus; kein Neustart, keine Konfigurationsänderung deinerseits)
- **Erkennungsseite**: Standard-Leichtgewicht-Engine (prozessinterner Fallback) → PaddleX → vLLM, automatischer Abbau nach Fähigkeit
- **Die eine Ausnahme**: Beim Video-Polling für den Ergebnisabruf wird **nicht** der Provider gewechselt (um zu vermeiden, dass falsche Ergebnisse zurückkommen)
- Was du tun musst: zwei Erzeugungs-API-Keys konfigurieren + optional eine Erkennungsstufe installieren; den Rest Claude überlassen

> Dein Rechner kann PaddleX oder vLLM nicht bewältigen? **Behalte einfach die Standard-Leichtgewicht-Engine bei** – der MCP wirft keinen Fehler, nur weil kein lokaler Dienst installiert ist. Lediglich chinesisches SOTA / Tabellen / visuelle Q&A werden nicht verfügbar; alles andere funktioniert wie gehabt.

---

## FAQ

**F: Funktioniert es ohne irgendetwas zu installieren?**
A: Ja. Sobald der MCP installiert ist, hast du Zeichnen / Karten / QR-Codes / Formeln / Datencharts + Englisch-/Captcha-OCR, alles lokal, ohne Netz.

**F: Liefert chinesische Erkennung Zeichensalat?**
A: Die Standard-Leichtgewicht-Engine ist für Englisch / Ziffern / einfache Dokumente ausreichend, die chinesische Trefferquote ist jedoch mittelmässig. Für chinesisches SOTA selbst PaddleX hosten (GPU 12 GB oder CPU 4-Kern 8 GB). Siehe [Konfiguration im Detail](#konfiguration-im-detail) oben.

**F: Wie lange dauert ein KI-Video?**
A: Ein 5-Sekunden-Video ca. 1–3 Minuten; ein 18-Sekunden-Video kann 5–10 Minuten brauchen. Wird asynchron im Hintergrund erzeugt; bei Fertigstellung wirst du automatisch benachrichtigt. Videos mit Schätzung ≤60 Sekunden werden synchron abgewartet.

**F: Schafft meine RTX 3060 die Tabellenerkennung?**
A: Ja. PaddleX im GPU-Modus braucht minimal 12 GB VRAM (die RTX 3060 12 GB passt genau); CPU-Modus läuft mit 4 Kernen + 8 GB RAM (3–5× langsamer). Siehe [Konfiguration im Detail](#konfiguration-im-detail) für Details.

**F: Rendern Chinesisch / Emoji / Verläufe korrekt?**
A: Ja. Share-Karten unterstützen Chinesisch, japanische Kanji, farbige Emojis, Verlaufstitel und Glow-Effekte voll über eingebaute CJK-Schriften und eine Satz-Engine – keine zusätzliche Schriftkonfiguration nötig.

**F: Wird Mermaid unterstützt?**
A: Nein (bräuchte einen Browser). Verwende stattdessen D2 oder Graphviz – vergleichbare Fähigkeit, robuster, mit Vektorausgabe.

**F: Rate-Limit getroffen (429)?**
A: Die kostenlose Stufe hat ein Anfragen-Limit pro Minute. Sobald du beide Provider (Agnes + Zhipu) konfigurierst, greift das automatische Umschalten und bleibt praktisch unsichtbar.

**F: Grenzen für die Video-Frameanzahl?**
A: Sie sinken mit der Auflösung – 1080p ≤ 241 Frames (ca. 10 Sekunden), 720p bis zu 441 Frames (ca. 18 Sekunden). Frag Claude nach den Live-Bedingungen.

**F: npx verbindet nicht / startet langsam?**
A: Eine globale Installation klappt auch: zuerst `npm i -g media-gen-mcp-server`, dann `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

**F: Kann ich sensible Begriffe / Waffen / Kriegsmotive verwenden?**
A: Begriffe zu echten Waffen lösen den Inhaltsfilter aus. Tausche sie durch Begriffe aus einem Sci-Fi-Setting aus (z. B. «futuristische Kampfrüstung», «Mecha») – visuell gleichwertiges Ergebnis.

---

## Für wen ist das?

- **Intensive Claude-Code-Nutzer** – alle, die mehrmals pro Woche Bild-Aufgaben erledigen und nicht für jede Aufgabe einen separaten MCP installieren und einen neuen Parametersatz auswendig lernen wollen.
- **Entwickler, die technische Doku / Blogs schreiben** – die ständig Architektur-, Sequenz-, ER-Diagramme, Datencharts, Formeln brauchen und ihren Workflow nicht verlassen wollen.
- **Einzelentwickler / Indie-Produkte** – kostenbewusst (100 % kostenlos) und auf Reproduzierbarkeit aus (gleiche Eingabe → gleiche Ausgabe); die kein separates Backend nur für Bild-Aufgaben bauen wollen.
- **Data / Finance / Legal** – Zwei-Wege-Szenarien: Daten als Charts darstellen und Datenpunkte aus Screenshots / Rechnungen zurückextrahieren.
- **Operations / Content-Creator / Newsletter-Autoren** – Share-Karten / OG-Bilder / Poster / QR-Codes, mit Chinesisch + farbigen Emojis + Verläufen out-of-the-box.

> **Eher nicht für**: Nutzer, die Claude Code nicht verwenden; Engineering-Teams, die nur eine einzige Fähigkeit wollen und bereits eine Pipeline aufgesetzt haben; Szenarien, die kostenpflichtige kommerzielle Modelle / Training / Fine-Tuning / Echtzeit-Video-OCR brauchen (diese übersteigen den Rahmen eines kostenlosen MCP).

---

## 💝 Den Autor unterstützen

Wenn media-gen-mcp dir hilft, lade den Autor gerne auf einen Kaffee ein ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Oder ⭐ [Star](../../stargazers) / [Issue](../../issues) / [PR](../../pulls) — jede Form der Unterstützung willkommen.

---

## License

**MIT** – der Haupt-Code ist frei verwendbar.

Die vollständige Abhängigkeitskette der Erkennungsseite ist **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL) – null Lizenzrisiko für kommerzielle Nutzung im Unternehmen.

---

> Technische Hinweise: Provider und Engines sind beide steckbar; strukturierte Werkzeuge liefern für dieselbe Eingabe dieselbe Ausgabe und können in git eingecheckt werden; bei Fehlern wird der Provider automatisch gewechselt. Siehe `CONTRIBUTING.md` für Mitwirkende und das Verzeichnis `docs/` für die vollständige Dokumentation.

<p align="center">
  <sub>Gebaut für alle, die lieber <strong>sagen</strong> als <strong>skripten</strong>.</sub><br>
  <sub>Einmal installiert – danach wird jede Bild-Aufgabe zu einem einzigen Satz.</sub>
</p>
