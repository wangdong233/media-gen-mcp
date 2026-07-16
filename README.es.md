<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtén-una-key-gratuita)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#licencia)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Dale a Claude Code "superpoderes de generación de imágenes": una sola frase para generar imágenes / videos / gráficos / tarjetas / códigos QR**

Generación de imágenes y videos con IA (gratis) + Dibujo estructurado (determinista, en local) + Renderizado SVG impresionante (alta fidelidad con Chrome)

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Características

- 🆓 **Totalmente gratis** — La generación de imágenes y videos con IA usa Agnes AI + los modelos gratuitos de Zhipu; el dibujo estructurado es completamente local, de costo cero
- 🧠 **Curva de aprendizaje cero** — Habla con naturalidad, Claude elige la herramienta automáticamente, genera el código y produce la imagen
- 📐 **Generación determinista** — Diagramas estructurales / gráficos / fórmulas / tarjetas: la misma entrada produce siempre la misma salida, con el contenido bajo control
- 🇨🇳 **Compatible con chino** — Las tarjetas renderizan chino automáticamente (fuente integrada); los modelos de Zhipu son nativos en chino
- 🔌 **Sin instalaciones adicionales** — D2 / Graphviz / Vega / MathJax vienen todos empaquetados, no hace falta instalar d2/dot/matplotlib en el sistema
- 🎨 **Renderizado impresionante** — Resplandor feGaussianBlur / degradados / profundidad de campo, con renderizado automático de alta fidelidad mediante Chrome
- 🌐 Documentación en 8 idiomas · MIT · Node ≥18

---

## 💬 ¿Qué puedes obtener?

Tras instalarlo, en Claude Code **di una sola frase** y podrás:

| Lo que dices | Lo que obtienes |
|---|---|
| "Genera una imagen realista de un gato naranja estilo wuxia" | 🖼️ Imagen realista generada por IA |
| "Genera un video de 5 segundos del mar" | 🎬 Video corto generado por IA |
| "Dibuja un diagrama de arquitectura: cliente → API gateway → dos microservicios" | 📐 Diagrama de arquitectura vectorial nítido |
| "Haz un gráfico de barras con este conjunto de datos de ventas" | 📊 Gráfico de visualización de datos |
| "Renderiza esta fórmula `E=mc^2`" | ➗ Imagen de fórmula matemática en alta resolución |
| "Crea una tarjeta para compartir con degradado y un emoji 🚀" | 🎴 Imagen OG / para redes sociales (chino automático) |
| "Dame un logo de GitHub" | 🏷️ Icono vectorial |
| "Genera un código QR" | ▪️ Código QR |
| "Dibuja un diagrama de arquitectura oscuro y tecnológico, con resplandor" | ✨ Imagen renderizada de alta fidelidad con Chrome |

> **Todo con decir una sola frase.** No necesitas aprender ningún nombre de herramienta ni parámetro.

---

## 🚀 Inicio rápido

### ① Obtén una Key gratuita

Regístrate en cualquiera de los siguientes proveedores (o en ambos) y consigue una API Key gratuita:

| Proveedor | Gratuito | Cómo solicitarla |
|---|---|---|
| **Agnes AI** (predeterminado) | Texto a imagen + texto a video, todo gratis | https://platform.agnes-ai.com/ → Regístrate → API Keys |
| **Zhipu BigModel** (opcional, 4K / chino) | Imagen con cogview-3-flash + video con cogvideox-flash, gratis para siempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → Verificación de identidad → Crear Key |

> Pasos detallados con imágenes: [Guía de activación de Agnes](doc/Agnes%20开通指引.md) · [Guía de activación de Zhipu](doc/Zhipu%20开通指引.md)

### ② Configuración

Crea `~/.media-gen-mcp/config.json` e introduce tu Key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-tu-key-de-agnes" },
    "zhipu": { "apiKey": "tu-key-de-zhipu" }
  }
}
```

También puedes configurar únicamente agnes (elimina la línea de zhipu). Si no rellenas `models`, se usarán los modelos predeterminados integrados.

### ③ Conéctalo a Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

El comando de conexión **no incluye la Key** (la Key va en el config anterior). Cuando veas `media-gen-mcp ✓ Connected` en `/mcp`, estará listo.

### ④ Di una frase

En Claude Code di directamente "dibuja un diagrama de arquitectura" o "genera una imagen realista de un gato naranja" — listo.

> **¿Solo quieres dibujar diagramas / gráficos / tarjetas / códigos QR?** No necesitas ninguna Key: con instalarlo (③) ya funciona.

---

## 📡 Proveedores

| | Predeterminado | Imagen (gratis) | Video (gratis) | Características |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Todo gratis, textura fotorrealista, audio y vídeo nativos |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, chino nativo, cumplimiento normativo local |

Cómo cambiar: `defaultProvider: "zhipu"`, o por modalidad con `defaultImageProvider`/`defaultVideoProvider`, o pásalo en una sola llamada con `provider`. ¿No sabes cuál elegir? Consulta la [comparativa](doc/Agnes_vs_Zhipu_横评.md).

---

## 🛠️ Capacidades en detalle

### 🤖 Generación con IA (modelos gratuitos · en línea)

Usa los modelos gratuitos de Agnes AI o de Zhipu:
- **Texto a imagen / Imagen a imagen** — Realista, ilustración, arte conceptual
- **Texto a video / Imagen a video / Animación por fotogramas clave** — Asíncrono inteligente (los videos largos se generan en segundo plano y se notifican al terminar)
- Especifica proveedor/modelo: "Dibuja una con **Zhipu cogview-4**" / "Genera un video con **agnes**"

### 📐 Dibujo estructurado (local · determinista · sin Key)

Las siguientes capacidades **no invocan a la IA y generan imágenes de forma determinista** (SVG vectorial en alta resolución):

| Capacidad | Motor (todos integrados) | Descripción |
|---|---|---|
| **Diagramas estructurales** | D2 + Graphviz | Arquitectura / flujo / secuencia / clases / ER / mapas mentales, con disposición automática |
| **Gráficos de datos** | Vega-Lite | Barras / líneas / circular / área / dispersión, Claude los genera automáticamente a partir de los datos |
| **Fórmulas matemáticas** | MathJax | LaTeX → SVG, con glifos incrustados |
| **Tarjetas para compartir** | Satori | OG / pósters / tarjetas de citas (chino + degradado + emoji + resplandor automáticos) |
| **Códigos QR** | qrcode | URL / texto → SVG/PNG |
| **Iconos vectoriales** | Iconify | Más de 200.000 iconos (`icon: "mdi:home"`) |
| **SVG impresionante** | Chrome / resvg | SVG escrito a mano (resplandor / filtros / profundidad) → renderizado de alta fidelidad con Chrome |

<details>
<summary>📖 ¿Qué pueden hacer las tarjetas?</summary>

- 5 plantillas: og (jerarquía alineada a la izquierda) / quote (cita, las comillas pueden enmarcarla a izquierda y derecha) / minimal (minimalista) / hero (texto grande + destellos de luz) / panel (panel de cristal)
- Texto de título con degradado + resplandor + profundidad mediante manchas de luz difuminadas
- Logo incrustado / avatar circular
- Chino automático (Noto Sans SC sin conexión) + emoji en color automáticos (caché en disco, disponibles sin conexión)
- Tamaño personalizable (predeterminado 1200×630, estándar OG)
</details>

<details>
<summary>📖 ¿Qué es el renderizado SVG impresionante?</summary>

El motor D2 no admite filtros SVG (resplandor feGaussianBlur), así que cuando quieres efectos del tipo "oscuro, tecnológico e impresionante, con resplandor y profundidad":
1. Claude escribe el SVG a mano (con filtros como feGaussianBlur)
2. Llama a la herramienta `render_svg`
3. La herramienta elige el backend automáticamente: si hay `<filter>` y Chrome está disponible en el sistema → Chrome (100% de fidelidad de filtros); en caso contrario → resvg (92%, más ligero)
</details>

<details>
<summary>📖 Notas sobre el modo sin conexión (¿qué herramientas necesitan internet?)</summary>

- **Totalmente sin conexión**: generate_diagram / generate_chart / generate_formula / generate_qrcode
- **Caché sin conexión tras el primer uso online**: generate_card (la fuente Latin predeterminada Inter se obtiene del CDN en el primer uso y se cachea en `~/.media-gen-mcp/fonts/`; la fuente CJK Noto Sans SC ya está integrada sin conexión; los emoji twemoji se cachean en disco y funcionan sin conexión)
- **Necesita conexión**: generate_icon (obtiene los iconos de la API de Iconify); render_svg cuando hay filtros (necesita Chrome)
- **Siempre en línea**: herramientas de generación con IA (generate_image / create_video)
</details>

---

## ❓ Preguntas frecuentes

**¿El video tarda?** 3–18s, unos 1–3 minutos. Omite `wait` para un asíncrono automático (>60s devuelve un handle y avisa al terminar).
**¿Número de fotogramas?** Pasa `durationSeconds` y se selecciona solo (5/10/18s). Agnes solo permite 81/121/161/241/441.
**¿Te topas con un 429?** Incorpora 62s en serie + aprendizaje automático de los límites reales de frecuencia.
**¿Las herramientas estructuradas necesitan Key?** No. Con instalarlo ya puedes dibujar diagramas / gráficos / tarjetas / códigos QR.
**¿Chino / emoji / degradado en las tarjetas?** Todo automático: fuente CJK integrada + emoji twemoji (caché en disco) + fondo con degradado CSS.
**¿SVG impresionante?** Claude escribe el SVG a mano (con resplandor feGaussianBlur) → `render_svg` → Chrome con 100% de fidelidad de filtros.
**¿Admite Mermaid?** No (necesitaría un navegador). Usa D2 en su lugar (cubre flujo / secuencia / clases / ER / mapas mentales).
**¿No se lee el config?** Debe estar en `~/.media-gen-mcp/config.json`.
**¿`npx` no conecta?** Solución de respaldo con instalación global:
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ Arquitectura + Documentación

- **Proveedores enchufables** (agnes + Zhipu; añadir un nuevo proveedor no requiere tocar la capa de herramientas); **motores enchufables** (DiagramEngine y MediaProvider funcionan en paralelo, sin interferirse)
- [Lista de requisitos de arquitectura](doc/架构要求清单.md) — Especificaciones de arquitectura del proyecto (mantenidas de forma continua)
- Más en [doc/](doc/): [Guía de activación de Agnes](doc/Agnes%20开通指引.md) · [Guía de activación de Zhipu](doc/Zhipu%20开通指引.md) · [Comparativa de proveedores](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Apoya al autor

Si media-gen-mcp te resulta útil, invita al autor a un café ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

O pon un ⭐ Star, abre un Issue / PR — cualquier gesto cuenta como apoyo al autor.

## Licencia

[MIT](LICENSE)
