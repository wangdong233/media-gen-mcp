<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtén-una-key-gratis)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**El MCP todo-en-uno de generación de imágenes para Claude Code — imágenes IA + dibujo estructurado local, en un solo servidor**

Texto-a-imagen / imagen-a-imagen / texto-a-vídeo / imagen-a-vídeo / animación por keyframes · diagramas / gráficos / fórmulas / tarjetas / iconos / códigos QR

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Características destacadas

- 🎨 **Imágenes IA, totalmente gratis**: texto-a-imagen, imagen-a-imagen, texto-a-vídeo, imagen-a-vídeo, animación por keyframes — con los modelos gratuitos de **Agnes AI + Zhipu**, sin coste alguno.
- 📐 **Dibujo estructurado local, determinista**: diagramas, gráficos, fórmulas, tarjetas, iconos, códigos QR — **SVG vectorial de alta resolución**, sin llamadas a IA, con zoom infinito, texto nítido y control total.
- 🧠 **Un único modelo mental**: simplemente di "genera una imagen" — Claude enruta automáticamente a la IA o a un motor local y genera el DSL/JSON/LaTeX correspondiente. **Cero pasos adicionales** para el usuario.
- 🌏 **Pulido desde el primer uso**: las tarjetas **soportan CJK automáticamente** (Noto Sans SC integrado, sin conexión), **fondos sólidos/degradados** y **emojis en color**; los diagramas soportan **tanto D2 como Graphviz**.
- 🔌 **Conectable**: tanto los providers como los motores de renderizado son extensibles sin cambios en la capa de herramientas; enrutado por defecto por modalidad + autoaprendizaje de rate-limit.
- 🆓 **Las herramientas estructuradas no necesitan key**: tras `claude mcp add`, las 6 herramientas locales funcionan de inmediato — **dibuja diagramas/gráficos/tarjetas/códigos QR sin ninguna key de IA**.
- 🌐 README en 8 idiomas · MIT · Node ≥18

---

## 🛠️ Las 10 herramientas

### 🤖 Generación con IA (online · gratis)

| Herramienta | Capacidad |
|---|---|
| `generate_image` | **texto-a-imagen** / **imagen-a-imagen** (referencia → nueva) |
| `create_video` | **texto-a-vídeo** / **imagen-a-vídeo** / **animación por keyframes** (sync/async inteligente) |
| `get_video` | sondea + descarga una tarea de vídeo |
| `list_models` | lista los modelos por provider y las restricciones de vídeo |

### 📐 Renderizado estructurado (local · determinista · mayormente sin key)

| Herramienta | Salida | Motor |
|---|---|---|
| `generate_diagram` | arquitectura / secuencia / flowchart / clases / ER / mapa mental | DSL **D2** · **Graphviz** (DOT) |
| `generate_chart` | barras / líneas / circular / área / dispersión | Vega-Lite |
| `generate_formula` | fórmulas matemáticas LaTeX (glifos incrustados, sin fuente necesaria) | MathJax |
| `generate_card` | tarjetas OG / compartir / citas (1200×630 por defecto, **CJK/degradado/emoji automáticos**) | Satori + resvg |
| `generate_icon` | más de 200k iconos vectoriales (`prefix:name`) | Iconify |
| `generate_qrcode` | códigos QR | qrcode |

> De las 6 herramientas estructuradas, **4 son totalmente offline** (diagram / chart / formula / qrcode). La fuente Latina por defecto de `generate_card` se obtiene una vez del CDN y se cachea en `~/.media-gen-mcp/fonts/` (offline a partir de entonces, o pasa `fontPath` para ser offline de inmediato); la fuente CJK (Noto Sans SC) está **incluida offline**. Sin embargo, los **emojis** de la tarjeta (twemoji) y `generate_icon` (Iconify) necesitan red (solo cacheados, no incluidos). Las herramientas de generación con IA siempre están online.

---

## 🚀 Inicio rápido

### ① Obtén una key gratis (solo para generación con IA; omítelo si solo dibujas imágenes estructuradas)

Regístrate en una (o ambas) opciones siguientes para obtener una API key gratuita:

| Provider | Gratis | Registro |
|---|---|---|
| **Agnes AI** (predeterminado) | Todas las imágenes + vídeo gratis | https://platform.agnes-ai.com/ → registrarse → API Keys |
| **Zhipu BigModel** (opcional, 4K / chino) | cogview-3-flash para imagen + cogvideox-flash para vídeo gratis para siempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verificar → crear key |

> Pasos detallados: [doc/Guía de alta de Agnes](doc/Agnes%20开通指引.md) · [doc/Guía de alta de Zhipu](doc/Zhipu%20开通指引.md)

### ② Configurar (una sola vez)

Crea `~/.media-gen-mcp/config.json` con tu key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Con solo Agnes también funciona (elimina la línea de zhipu). Omitir `models` para usar los valores predeterminados integrados.

### ③ Añadir a Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

El comando de instalación **no incluye ninguna key** (está en la configuración anterior). Ejecuta `/mcp` — `media-gen-mcp ✓ Connected` significa que se ha conectado correctamente.

---

## 💬 Cómo usarlo

Simplemente dilo en Claude Code — **enrutado automático**, no necesitas recordar los nombres de las herramientas:

**Generación con IA:**

| Escenario | Decir |
|---|---|
| Predeterminado | "Genera un gato naranja fotorrealista" / "Genera un vídeo de playa de 5s" |
| Provider específico | "Usa **Zhipu** para dibujar" / "Usa **agnes** para el vídeo" |
| Modelo específico | "Usa **cogview-4** para dibujar" / "Usa **agnes-video-v2.0**" |
| Imagen-a-imagen / -a-vídeo | "Convierte esta imagen en acuarela" / "Convierte esta imagen en un vídeo" |
| Animación por keyframes | "Crea una transición fluida entre estas dos imágenes" |

**Dibujo estructurado:**

| Escenario | Decir |
|---|---|
| Diagrama | "Dibuja una arquitectura: cliente → API gateway → dos microservicios" (D2) o "Dibuja un grafo de dependencias en DOT" (Graphviz) |
| Gráfico | "Haz un gráfico de barras con estos datos de ventas" |
| Fórmula | "Renderiza esta fórmula: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" |
| Tarjeta compartir | "Haz una tarjeta OG con **degradado de púrpura a azul** y un emoji 🚀 para este artículo" |
| Icono | "Dame un icono del logo de GitHub" |
| Código QR | "Genera un código QR para https://..." |

> Indicar provider/modelo solo afecta a esta llamada, **no a tu configuración**. Los diagramas usan la [sintaxis D2](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/), los gráficos [Vega-Lite](https://vega.github.io/vega-lite), las fórmulas [LaTeX](https://www.latex-project.org), los iconos en [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude genera el código fuente automáticamente.

> **Mermaid**: `generate_diagram` soporta **D2 y Graphviz**; el renderizado in-process de Mermaid necesita un navegador/Chromium (inadecuado para un MCP determinista), por lo que no es compatible — usa D2 (cubre flowchart/secuencia/clases/ER/mapa mental) o Graphviz en su lugar.

---

## 📡 Providers

| | Predeterminado | Imagen (gratis) | Vídeo (gratis) | Fortaleza |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Todo gratis, fotorrealista, audio nativo |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, chino nativo, conforme a la normativa china |

Cambia con: `defaultProvider: "zhipu"`, o por modalidad mediante `defaultImageProvider`/`defaultVideoProvider`, o pasa `provider` en cada llamada. ¿No sabes cuál elegir? Consulta el [comparativo](doc/Agnes_vs_Zhipu_横评.md).

---

## ⚙️ Config (avanzado, normalmente innecesario)

**Reserva de provider en tres niveles** (argumento por llamada > por modalidad > global):

| Campo | Predeterminado | Descripción |
|---|---|---|
| `defaultProvider` | `agnes` | Predeterminado global (reserva final) |
| `defaultImageProvider` | igual | Predeterminado de la modalidad de imagen (`generate_image`) |
| `defaultVideoProvider` | igual | Predeterminado de la modalidad de vídeo (`create_video`/`get_video`) |

Por ejemplo, `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → imágenes vía agnes, vídeo vía Zhipu.

Configuración de conexión por provider: `providers.<name>.apiKey` (obligatorio), `providers.<name>.models.{image,video}.default`, `outDir` (directorio de salida, por defecto `session-dir/output`).

> Autoaprendizaje del rate-limit (rateLimits / rateLimitTtlMs — ante un 429 aprende automáticamente el límite real + alternativa de expiración TTL) y otros campos avanzados — consulta [doc/](doc/).

---

## ❓ FAQ

**¿Los vídeos van lentos?** Duran entre 3 y 18s y tardan ~1–3 min en generarse. Omitir `wait` lo hace asíncrono (estimado >60s devuelve un handle, con aviso al completarse).
**¿Número de fotogramas?** Pasa `durationSeconds` para que se elija automáticamente (5/10/18s). Agnes solo permite 81/121/161/241/441.
**¿Te devuelve un 429?** Lleva integrado un serializador de 62s; aprende automáticamente el rate limit real.
**¿Las herramientas estructuradas necesitan key?** No. Las 6 herramientas locales funcionan desde el principio; solo la generación con IA necesita una key.
**¿CJK/emoji/degradado en tarjetas?** Fuente CJK integrada (automática), emojis en color con twemoji (automáticos); pasa un `linear-gradient(...)` CSS a `bg` para un degradado.
**¿No lee la configuración?** Debe estar en `~/.media-gen-mcp/config.json` (npx instala en la caché; la configuración dentro del proyecto no está disponible).

---

## 🏗️ Arquitectura + docs

- **Provider conectable** (agnes + zhipu; añadir un provider no requiere cambios en la capa de herramientas); **motor conectable** (DiagramEngine funciona en paralelo a MediaProvider, sin interferencias).
- Más información en [doc/](doc/): [Guía de alta de Agnes](doc/Agnes%20开通指引.md) · [Guía de alta de Zhipu](doc/Zhipu%20开通指引.md) · [Comparativo Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Apóyalo

Si media-gen-mcp te resulta útil, considera invitar al autor a un café ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

O ⭐ dale una Star, abre un Issue / PR — se agradece todo.

## License

[MIT](LICENSE)
