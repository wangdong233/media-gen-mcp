<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtén-una-key-gratis)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Un servidor MCP multimodal de generación de imágenes para Claude Code**

Imágenes IA + imágenes estructuradas, un solo servidor lo cubre todo: texto a imagen / imagen a imagen / texto a vídeo / imagen a vídeo / animación por keyframes (mediante Agnes AI + modelos gratuitos de Zhipu) **+ diagramas / gráficos de datos / códigos QR** (renderizado local determinista, sin necesidad de key)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① Obtén una Key gratis

Regístrate en una (o en ambas) de las siguientes opciones para obtener una API key gratuita:

| Provider | Gratis | Registro |
|---|---|---|
| **Agnes AI** (predeterminado) | Todas las imágenes y vídeos gratis | https://platform.agnes-ai.com/ → registrarse → API Keys |
| **Zhipu BigModel** (opcional, 4K / chino) | Imagen cogview-3-flash + vídeo cogvideox-flash gratis para siempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verificar → crear key |

> Pasos detallados: [doc/Guía de alta de Agnes](doc/Agnes%20开通指引.md) · [doc/Guía de alta de Zhipu](doc/Zhipu%20开通指引.md)

## ② Configurar (una sola vez)

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

## ③ Añadir a Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

El comando de instalación **no incluye ninguna key** (está en la configuración anterior). Ejecuta `/mcp` — `media-gen-mcp ✓ Connected` significa que se ha conectado correctamente.

## ④ Uso

Simplemente dilo en Claude Code (se enruta automáticamente al provider/modelo correcto):

| Escenario | Decir | Efecto |
|---|---|---|
| **Predeterminado** | "Genera una imagen fotorrealista de un gato" / "Genera un vídeo de 5s de una playa" | Usa defaultImageProvider / defaultVideoProvider |
| **Provider específico** | "Usa **Zhipu** para dibujar" / "Usa **agnes** para el vídeo" | Cambia el provider temporalmente, sin modificar la configuración |
| **Modelo específico** | "Usa **cogview-4** para dibujar" / "Usa **agnes-video-v2.0**" | Selecciona un modelo concreto (mayor calidad, etc.) |
| **Provider + modelo** | "Usa **Zhipu cogvideox-3** para un vídeo 4K" | Especificación exacta (4K / primer-último fotograma) |
| **Imagen a imagen** | "Convierte esta imagen en acuarela" | Imagen de referencia → nueva imagen |
| **Imagen a vídeo** | "Convierte esta imagen en un vídeo" | Una sola imagen → vídeo |
| **Keyframes** | "Crea una transición suave entre estas dos imágenes" | Varias imágenes → transición fluida |

> Omitir especificaciones → usa los valores predeterminados; indicar provider/modelo solo afecta a esta llamada, **no a tu configuración**.

## ④ Imágenes estructuradas locales (sin key, determinista)

Estas herramientas **no llaman a ninguna IA**¹ — Claude genera un DSL/JSON/LaTeX/fields → se renderiza localmente en SVG/PNG (vectorial, alta resolución):

| Herramienta | Decir | Salida |
|---|---|---|
| **Diagramas** `generate_diagram` | "Dibuja una arquitectura: cliente → API gateway → dos microservicios" | Arquitectura / secuencia / flowchart / clases / ER / mapa mental mediante **D2** (DSL) o **Graphviz** (DOT) → SVG |
| **Gráficos** `generate_chart` | "Haz un gráfico de barras con estos datos de ventas" | Barras / líneas / circular / área / dispersión (Vega-Lite → SVG) |
| **Fórmulas** `generate_formula` | "Renderiza esta fórmula: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" | LaTeX → SVG (MathJax, glifos incrustados, sin fuente necesaria) |
| **Tarjetas** `generate_card` | "Haz una tarjeta de compartir con un fondo de **degradado de púrpura a azul** y un 🚀 emoji" | Tarjetas OG / sociales / de citas (Satori → PNG, 1200×630 por defecto, **CJK con soporte automático**, **fondo sólido/degradado**, **emojis en color**) |
| **Iconos** `generate_icon` | "Dame un icono del logo de GitHub" | Más de 200 k iconos bajo demanda (Iconify, `prefix:name`) |
| **Códigos QR** `generate_qrcode` | "Genera un código QR para https://..." | SVG / PNG (puramente local, cero red) |

> ¹ Todo local y determinista, excepto los **iconos** (API de Iconify) y la **fuente por defecto de la tarjeta** (se obtiene del CDN en el primer uso y se cachea en `~/.media-gen-mcp/fonts/`); pasa `fontPath` para que la tarjeta sea totalmente offline. **CJK en tarjetas**: Noto Sans SC integrado (sin conexión, detección automática de chino/japonés/coreano como respaldo) — sin necesidad de fontPath. Los diagramas usan la [sintaxis D2](https://d2lang.com), los gráficos [Vega-Lite](https://vega.github.io/vega-lite), las fórmulas [LaTeX](https://www.latex-project.org), los iconos en [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude genera el código fuente automáticamente.

## Providers

| | Predeterminado | Imagen (gratis) | Vídeo (gratis) | Fortaleza |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Todo gratis, fotorrealista, audio nativo |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, chino nativo, conforme a la normativa china |

Cambia con: `defaultProvider: "zhipu"`, o por modalidad mediante `defaultImageProvider`/`defaultVideoProvider`, o pasa `provider` en cada llamada. ¿No sabes cuál elegir? Consulta el [comparativo](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (avanzado, normalmente innecesario)

**Reserva de provider en tres niveles** (argumento por llamada > por modalidad > global):

| Campo | Predeterminado | Descripción |
|---|---|---|
| `defaultProvider` | `agnes` | Predeterminado global (reserva final cuando no se establece ninguna modalidad) |
| `defaultImageProvider` | igual que `defaultProvider` | Predeterminado de la modalidad de imagen (usado por `generate_image`) |
| `defaultVideoProvider` | igual que `defaultProvider` | Predeterminado de la modalidad de vídeo (usado por `create_video` / `get_video`) |

Por ejemplo, `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → imágenes vía agnes, vídeo vía Zhipu. Omite los dos últimos campos para que todo recaiga en `defaultProvider`.

Configuración de conexión por provider:

| Campo | Predeterminado | Descripción |
|---|---|---|
| `providers.<name>.apiKey` | — | **obligatorio**, uno por provider |
| `providers.<name>.models.image.default` | integrado del provider | modelo de imagen predeterminado |
| `providers.<name>.models.video.default` | integrado del provider | modelo de vídeo predeterminado |
| `outDir` | session-dir/output | directorio de salida (modificable por llamada) |

> Autoaprendizaje del rate-limit (rateLimits / rateLimitTtlMs) y otros campos avanzados — consulta [doc/](doc/).

## FAQ

**¿Los vídeos van lentos?** Duran entre 3 y 18s y tardan ~1–3 min en generarse. Omitir `wait` lo hace asíncrono, con notificación al completarse.
**¿Número de fotogramas?** Pasa `durationSeconds` para que se elija automáticamente (5/10/18s). Agnes solo permite 81/121/161/241/441.
**¿Te devuelve un 429?** Lleva integrado un serializador de 62s; aprende automáticamente el rate limit real.
**¿No lee la configuración?** Debe estar en `~/.media-gen-mcp/config.json` (npx instala en la caché; la configuración dentro del proyecto no está disponible).

## Arquitectura + Docs

Arquitectura de providers conectable (agnes + zhipu; añadir un provider no requiere ningún cambio en la capa de herramientas). Más información en [doc/](doc/):

- [doc/Guía de alta de Agnes](doc/Agnes%20开通指引.md) · [doc/Guía de alta de Zhipu](doc/Zhipu%20开通指引.md) · [doc/Comparativo Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

## 💝 Apoya al autor

Si media-gen-mcp te resulta útil, considera invitar al autor a un café ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

O ⭐ dale una Star, abre un Issue / PR — se agradece todo.

## License

[MIT](LICENSE)