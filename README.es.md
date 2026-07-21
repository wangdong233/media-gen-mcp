# media-gen-mcp

> El «todo-en-uno de imágenes» para Claude Code — crea imágenes, dibuja ideas, entiende imágenes: una frase y listo. Todo gratis.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.12.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Instala una vez en Claude Code y, a partir de ahora, cualquier tarea de imágenes se resuelve con una frase.** Diseñadores generando ilustraciones, programadores dibujando arquitecturas, equipos de operaciones creando tarjetas para compartir, finanzas extrayendo tablas de facturas — generación de imágenes / video + reconocimiento + dibujo / tarjetas / códigos QR, **todo cubierto y todo gratis** (proveedores gratuitos + motores locales; funciona al instalar).

¿Te cansa hacer imágenes varias veces por semana y tener que instalar N herramientas y recordar N configuraciones? Aquí instalas una sola vez y le tiras todo a Claude.

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | **Español** | [Français](README.fr.md) | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

## Tabla de contenidos

- [Dices una frase, obtienes esto](#dices-una-frase-obtienes-esto)
- [Empieza en 60 segundos](#empieza-en-60-segundos)
- [Kit completo de capacidades](#kit-completo-de-capacidades)
- [Configuración detallada](#configuración-detallada)
- [Preguntas frecuentes](#preguntas-frecuentes)
- [Para quién es esto](#para-quién-es-esto)
- [Apoya al Autor](#apoya-al-autor)
- [License](#license)

---

## Dices una frase, obtienes esto

| Dices… | Obtienes |
|---|---|
| «Dibuja un gato cyberpunk con resplandor neón» | Imagen fotorrealista de IA, guardada en `output/` |
| «Genera un video de 5 s de una puesta de sol en la playa» | Video MP4 de IA (generación en segundo plano, te avisa al terminar) |
| «Dibuja un diagrama de arquitectura: cliente → API gateway → servicio de pedidos + servicio de pago» | Diagrama de arquitectura vectorial |
| «Convierte estos datos de ventas en un gráfico de barras» | Gráfico de datos en alta resolución |
| «Haz un código QR que apunte a github.com» | Código QR vectorial |
| «Renderiza E=mc² como una fórmula en alta resolución» | Fórmula vectorial |
| «Haz una tarjeta para compartir con gradiente oscuro, título "Novedades de julio 🚀"» | Tarjeta maquetada con esmero (chino + emoji automáticos) |
| «Reconoce la tabla en esta captura de factura» | Tabla HTML/Markdown pegable |
| «Lee este gráfico de barras como puntos de datos» | Datos estructurados CSV/JSON |
| «Describe qué hay en esta imagen» | Respuesta en lenguaje natural |
| «Extrae todo el texto de este PDF de 20 páginas» | Texto completo / Markdown / JSON (PDF digital en segundos, escaneado se procesa página a página con OCR) |
| «Extrae el texto de este contrato escaneado, ignora la marca de agua y el sello rojo» | Texto limpio (elimina automáticamente marca de agua / sello rojo / encabezado / pie de página) |
| «Combina este artículo a doble columna por orden de lectura» | Texto continuo de una sola columna (reconstruye el orden de lectura multicolumna, sin saltos de línea erróneos) |
| «¿Puedo reconocer tablas ahora? ¿Tengo OCR en chino configurado?» | Lista de capacidades actuales + recomendación de enrutamiento (qué sirve / qué falta / qué usar) |

> Sin aprender nombres de herramientas, sin instalar dependencias del sistema: **Claude elige automáticamente la mejor manera de hacerlo.**

---

## Empieza en 60 segundos

Idea clave: **dibujos / tarjetas / códigos QR / fórmulas son motores locales, y el reconocimiento de imágenes (OCR) también usa por defecto un respaldo en proceso — todo sin llamar a la IA, sin conexión; funciona al instalar.** Solo las imágenes fotorrealistas / videos de IA necesitan una API Key gratuita — así adelantamos «la primera imagen» y «la primera lectura» a antes del registro.

### 30 s | Conéctalo en una línea (sin Key)

```bash
# Instala en una línea (sin Key, 30 s)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Reinicia Claude Code → escribe /mcp → cuando veas media-gen-mcp ✓ Connected, listo
```

### 30 s | Tu primera imagen al instante, sin Key

Dile directamente a Claude:

```
Haz una tarjeta para compartir con estilo tecnológico oscuro, título: Claude Code todo-en-uno de imágenes
```

→ La imagen vectorial se guarda automáticamente en `output/`; ábrela y úsala. **Todavía no has registrado ninguna API Key y ya tienes el resultado.**

Estos también salen al instante, sin Key y sin red:

- «Haz un código QR que apunte a github.com»
- «Renderiza E=mc² como una fórmula en alta resolución»
- «Dibuja una arquitectura: cliente → gateway → servicio de pedidos + servicio de pago → base de datos, estilo tecnológico oscuro»
- «Reconoce los dígitos de esta imagen de captcha» (OCR, por defecto en proceso, sin instalar nada)
- «Extrae el texto en inglés de esta captura»

### ¿Quieres OCR chino SOTA / preguntas sobre imagen? Agrega una línea con la Key de GLM de Zhipu (cero despliegue, opcional)

El motor ligero por defecto es suficiente para inglés / números / captcha; la precisión en chino es normal. **¿No quieres autohospedar PaddleX / vLLM pero sí quieres chino SOTA + tablas complejas + preguntas sobre imagen?** Agrega una línea con la Key de GLM de Zhipu — **GLM-4.6V-Flash en la nube es gratis para siempre**, cero despliegue, cero recursos locales:

```bash
# ① Ve a https://open.bigmodel.cn/console/apikey, regístrate gratis y solicita api_key (formato {id}.{secret})
#    Nota: solo acepta la api_key estándar de open.bigmodel.cn; la Code Plan key (ZAI_API_KEY) NO sirve —
#    está vinculada al endpoint de Z.ai + lista blanca de herramientas, llamarla infringe las normas y se bloquea la cuenta

# ② Escríbela en ~/.media-gen-mcp/config.json
{
  "providers": {
    "glm-vision": { "apiKey": "tu-{id}.{secret}" }
  }
}

# ③ Vuelve a Claude Code y dile: «Reconoce la tabla de esta factura china» / «¿Cuántas personas hay en esta imagen? ¿Qué hacen?»
#    → OCR chino SOTA + preguntas sobre imagen, guarda en output/ o responde directo
```

> Tras configurarlo, el MCP lo incorpora automáticamente a la cadena de respaldo: **paddle → glm-vision → vlm → tesseract**; si un nivel cae temporalmente, degrada sin que te enteres. Ver [Configuración detallada · Nivel 2](#nivel-2-zhipu-glm-46v-flash-nube-gratis-cero-despliegue-chino-sota--vqa).

### ¿Quieres imágenes fotorrealistas / video de IA? Agrega una API Key gratuita (opcional)

```bash
# ① Consigue una API Key gratuita (recomendado Agnes, proveedor por defecto)
#    https://platform.agnes-ai.com/ → Regístrate → API Keys → Copia sk-xxx
#    (cogview-3-flash / cogvideox-flash de Zhipu también son gratis para siempre;
#     puedes configurar uno solo, o ambos)

# ② Escríbela en ~/.media-gen-mcp/config.json (también vale con un solo proveedor)
{
  "providers": {
    "agnes": { "apiKey": "sk-tu-agnes-key" }
  }
}

# ③ Vuelve a Claude Code y dile: «Dibuja un gato naranja cyberpunk, estilo fotorrealista»
#    → Imagen fotorrealista de IA guardada. Igual para video: «Genera un video de 5 s de una puesta de sol en la playa»
```

> ¿Prefieres no usar npx? También puedes instalar global: primero `npm i -g media-gen-mcp-server`, luego `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

---

## Kit completo de capacidades

> Simplemente dile a Claude qué quieres hacer; escoge automáticamente la mejor manera de hacerlo. Abajo está agrupado por «qué quieres hacer» — no necesitas saber cómo se llama la herramienta por debajo.

### Crear una imagen (de cero)

**Dibuja una foto fotorrealista o ilustración**
> Tú: «Dibuja un gato naranja cyberpunk con resplandor neón, estilo fotorrealista»
> Obtienes: imagen fotorrealista guardada en `output/` (también soporta ilustraciones / conceptos de producto / bocetos de logo / escenas de ciencia ficción)

**Convierte una frase o imagen en un video corto**
> Tú: «Genera un video de 5 s de una puesta de sol en la playa»
> Obtienes: video MP4 (3–18 s; los videos largos se generan en segundo plano y te avisan cuando están listos)

**Captura un icono o logo de marca**
> Tú: «Captura el logo de GitHub, 128 píxeles»
> Obtienes: logo vectorial de una librería de más de 200 000 iconos, listo para usar (GitHub / Twitter / Material / Lucide / Font Awesome, entre otros)

### Entender una imagen / un PDF (imagen y documento → datos)

**Extrae texto de una captura**
> Tú: «Lee los dígitos de este captcha»
> Obtienes: texto plano (captchas / números de factura / documentos escaneados / historiales de chat: todo se puede extraer)

**Convierte una tabla en HTML / Markdown**
> Tú: «Reconoce la tabla en esta captura de factura»
> Obtienes: tabla Markdown lista para pegar (facturas / reportes / documentos escaneados sin volver a teclearlos a mano)

**Reconstruye los datos originales desde un gráfico**
> Tú: «Lee este gráfico de barras como datos»
> Obtienes: datos estructurados CSV / JSON (barras / líneas / circulares, todos valen)

**Pídele que te explique la imagen en lenguaje sencillo**
> Tú: «¿Cuántas personas hay en esta imagen? ¿Qué están haciendo?»
> Obtienes: respuesta en lenguaje natural (preguntas sobre imágenes / escritura a mano / fórmulas / comprensión de escenas complejas)

**Extrae el texto completo de un PDF**
> Tú: «Extrae todo el texto de este PDF de 20 páginas, exporta a Markdown»
> Obtienes: texto completo / Markdown / JSON — los PDF digitales extraen la capa de texto en segundos, los escaneados se renderizan y procesan con OCR página a página; soporta rangos de páginas (`3` / `1-10` / `odd` / `last`), ignorar marca de agua / encabezado / pie de página, y salida combinada o por páginas; los documentos largos corren en segundo plano y te avisan al terminar (facturas / contratos / informes financieros / artículos / libros escaneados, todo vale)

**Haz que el resultado del OCR / PDF sea más limpio y fluido de leer**
> Tú: «Extrae el texto de este contrato escaneado, **ignora la marca de agua y el sello rojo**» / «Combina este artículo a doble columna **por orden de lectura** en un solo bloque»
> Obtienes: texto limpio y continuo — dos interruptores disponibles en todas las herramientas de OCR / PDF:
> - **Ignorar áreas**: delimita marca de agua / sello rojo / encabezado / pie de página / título de tabla y se eliminan automáticamente del resultado; contratos / certificados / documentos escaneados ya no salen manchados
> - **Orden de lectura multicolumna**: artículos / prensa / currículums / doble o triple columna se combinan automáticamente en el orden de lectura humano como texto continuo de una sola columna, sin saltos de línea erróneos

**Pregunta primero «qué puedo hacer con los servicios que tengo»**
> Tú: «¿Puedo reconocer tablas ahora? ¿Tengo OCR en chino configurado? ¿Funciona la escritura a mano?»
> Obtienes: lista de capacidades actuales — cuál de los cuatro niveles está configurado / cuál falta / cuál está en cooldown o con errores, junto con recomendaciones de enrutamiento «para tablas usa X, para escritura a mano usa Y»; **pregunta antes de actuar para evitar errores en la llamada directa**

### Dibuja tus ideas con claridad (sin Key, funciona al instalar)

**Dibuja diagramas estructurados**
> Tú: «Dibuja una arquitectura: cliente → API gateway → servicio de pedidos + servicio de pago → base de datos»
> Obtienes: diagrama de arquitectura vectorial (también flujos / secuencia / clases / ER / mapas mentales)

**Dibuja un diagrama HTML interactivo** (incrustado en GitHub README, sigue el tema del sistema automáticamente, sin JS)
> Tú: «Dibuja una arquitectura para un README que siga automáticamente a los lectores en claro/oscuro»
> Obtienes: un archivo HTML único (paleta dual D2 + visor; pan / zoom / cambio de tema / exportar SVG)

**Convierte datos en gráficos**
> Tú: «Convierte estos datos de ventas en un gráfico de barras»
> Obtienes: gráfico de datos en alta resolución (barras / líneas / circulares / área / dispersión; pásale números sueltos o un CSV)

### Haz tarjetas / pósters / códigos QR (para compartir con estilo)

**Crea tarjetas para compartir / OG / citas / portadas / pósters**
> Tú: «Haz una tarjeta para compartir con gradiente oscuro, título "Novedades de julio 🚀"»
> Obtienes: tarjeta maquetada con esmero (título, subtítulo, color en gradiente, resplandor, emoji en color y logo incrustado, todo automático; chino y kanji japonés sin caracteres rotos)

**Genera un código QR**
> Tú: «Haz un código QR que apunte a github.com»
> Obtienes: código QR vectorial (URL / texto, todo vale; nítido incluso en póster impreso)

**Renderiza fórmulas matemáticas en alta resolución**
> Tú: «Renderiza E=mc² como una fórmula en alta resolución»
> Obtienes: fórmula vectorial (LaTeX, fracciones complejas, ecuaciones químicas: todo soportado)

### Crea efectos geniales / gráficos con estilo tecnológico (misma entrada, siempre misma salida)

**Renderiza SVG a PNG en alta resolución**
> Tú: «Dibuja un fondo con estilo tecnológico con resplandor, campo de estrellas y profundidad»
> Obtienes: PNG llamativo, escogiendo automáticamente el mejor modo de render para máxima fidelidad sin pérdidas

**Convierte animaciones HTML / CSS en video**
> Tú: «Haz una animación de intro de producto de 3 s, con gradiente + partículas»
> Obtienes: video MP4 / GIF / WebM (intros de producto / animaciones de marca / demos de motion, render cuadro a cuadro; misma entrada, siempre misma salida)

> **Pequeño aviso**: la generación de imágenes / la lectura de imágenes usan IA en la nube; los dibujos / tarjetas / códigos QR / animaciones son motores locales — **funcionan al instalar, son vectoriales y de alta resolución, y con la misma entrada siempre producen la misma salida**.

---

## Configuración detallada

> En una frase: **las capacidades estructuradas (dibujos / gráficos / tarjetas / códigos QR / fórmulas) funcionan sin configuración; la generación de IA se activa con una línea de API Key; el reconocimiento por defecto es cero configuración, y solo necesitas autohospedarlo si quieres chino SOTA / tablas / gráficos.** Lo que quieras hacer determina lo que debes configurar — no tienes que configurarlo todo.

### Consulta la configuración según «qué quieres hacer»

| Qué quieres hacer | Qué configurar | Qué obtienes al configurar |
|---|---|---|
| Dibujar arquitecturas / gráficos de datos / tarjetas / códigos QR / fórmulas | **No necesitas configurar nada** | Motor local, funciona al instalar |
| Imágenes fotorrealistas / video de IA (texto→imagen, texto→video) | Configura un proveedor gratuito (Agnes o Zhipu, cualquiera de los dos) | Generación en la nube, guarda en `output/` |
| OCR de texto (inglés / captcha / números / documentos simples) | **No necesitas configurar nada** | Por defecto usa motor ligero en proceso, funciona al instalar |
| OCR en chino / tablas de facturas / lectura de gráficos / preguntas sobre imagen / escritura a mano / fórmulas | **Agrega una línea con la Key de GLM de Zhipu** (cero despliegue, nube gratis para siempre) **o** autohospeda PaddleX / vLLM | Con la Key de GLM funciona de inmediato; autohospedado requiere levantar el servicio y agregar una línea baseUrl |
| **Extracción de texto de PDF** (digital / escaneado / multipágina) | Instala dos dependencias `npm i pdfjs-dist @napi-rs/canvas` (al primer uso de PDF) | PDF digital en segundos; PDF escaneado sigue el nivel de OCR de arriba (por defecto, cero configuración también corre) |
| **Quitar marca de agua / sello rojo / encabezado, restaurar orden multicolumna** | **No necesitas configurar nada** | Al llamar a las herramientas de OCR / PDF dile directamente «Claude, ignora la marca de agua» o «combina por orden de lectura», se aplica automáticamente |
| **Consultar capacidades de reconocimiento actuales** (qué sirve / qué falta) | **No necesitas configurar nada** | Pregunta directamente, Claude responde con la lista de capacidades + recomendación de enrutamiento |

---

### I. Configuración de generación (imágenes / video de IA)

**Proveedor por defecto: Agnes** (capa gratuita permanente, texto→imagen + texto→video totalmente abiertos). Zhipu como alternativa (optimización nativa para chino).

**Basta con configurar uno** (este es el `config.json` completo; también puedes llenar solo uno):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-tu-agnes-key" },
    "zhipu": { "apiKey": "tu-zhipu-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/absolute/path/to/output"
}
```

**Cómo obtener API Key gratuitas**:

- **Agnes** (recomendado, por defecto): https://platform.agnes-ai.com/ → Regístrate → API Keys → Copia `sk-xxx`
- **Zhipu**: https://open.bigmodel.cn/ → Regístrate → API Keys (modelos gratuitos: `cogview-3-flash` / `cogvideox-flash`, gratis para siempre)

**Configura ambos para mayor robustez**: si uno falla temporalmente (rate limiting / inestabilidad del servicio), el otro entra automáticamente; tú no te enteras y sin cobros duplicados.

**Ubicación del archivo de configuración**: `~/.media-gen-mcp/config.json` (macOS / Linux) o `%USERPROFILE%\.media-gen-mcp\config.json` (Windows).

> Este archivo **puede no existir y nada se rompe** — las capacidades estructuradas y el OCR por defecto siguen funcionando; solo no se podrá invocar la generación de IA.

---

### II. Configuración de reconocimiento (imágenes / OCR / tablas / gráficos / comprensión visual)

Las capacidades de reconocimiento se dividen en **cuatro niveles**: instala según necesidad; por defecto el nivel 1 ya está listo.

#### Nivel 1: motor ligero por defecto (cero configuración, funciona al instalar)

- **Qué hace**: OCR en inglés / números / captcha / documentos simples
- **¿Hay que instalar un servicio?**: **No**, viene empaquetado como WASM dentro del proceso MCP; carga el modelo de lenguaje automáticamente en la primera llamada
- **Requisitos mínimos de recursos**:
  - CPU: cualquiera (puramente en CPU, sin dependencia de GPU)
  - GPU: no requerida
  - Memoria: ~200–500MB (varía según el tamaño de la imagen)
  - Disco: ~30–50MB (motor WASM + paquete de idioma)
  - Tamaño del modelo: incluido en el disco de arriba (paquete de inglés, unos pocos MB)
- **Velocidad**: ~3–5 s por imagen
- **Para quién**: el 90% de los escenarios ligeros de OCR, documentos en latín, reconocimiento de captcha

> La mayoría de usuarios tiene suficiente con este nivel; los tres siguientes son mejoras opcionales.

#### Nivel 2: Zhipu GLM-4.6V-Flash (nube gratis, cero despliegue, chino SOTA + VQA)

- **Qué hace**: OCR en chino (calidad SOTA), tablas complejas (encabezados multinivel / celdas combinadas), análisis de gráficos, preguntas sobre imagen (VQA) — los 4 tasks completos, en la nube con GLM-4.6V-Flash
- **¿Hay que instalar un servicio?**: **No**, API en la nube de la plataforma abierta de Zhipu; registra una cuenta y pide api_key
- **Requisitos mínimos de recursos**: **Cero** (llamada HTTP pura, sin CPU / GPU / disco)
- **Velocidad**: ~1–3 s por imagen (en la nube, incluye red de ida y vuelta)
- **Coste**: **GLM-4.6V-Flash es gratis para siempre** (128K de contexto + 32K de salida), alineado con la estrategia gratuita de GLM-4-Flash para texto
- **Para quién**: usuarios que quieren chino SOTA + VQA pero **no quieren autohospedar PaddleX / vLLM**; cubre perfectamente la barrera de despliegue de los niveles 3/4 autohospedados
- **Cómo configurar**: ve a [open.bigmodel.cn](https://open.bigmodel.cn/console/apikey), registra una cuenta gratuita y solicita api_key (formato `{id}.{secret}`); en `config.json` agrega:

  ```json
  {
    "providers": {
      "glm-vision": { "apiKey": "tu-{id}.{secret}" }
    }
  }
  ```

  Modelo por defecto `glm-4.6v-flash`; se puede cambiar a `glm-4v-flash` (gratis, ligero) o a modelos de visión de pago (`glm-4.6v` / `glm-ocr`, etc.) vía `providers["glm-vision"].model`. Tras configurarlo, el MCP lo incorpora automáticamente a la cadena de respaldo: **paddle(10) → glm-vision(9) → vlm(8) → tesseract(1)**.

- ⚠️ **Aviso de cumplimiento** (importante):
  - Solo se acepta la **api_key estándar de open.bigmodel.cn**; **la Code Plan key (ZAI_API_KEY) NO sirve** — está vinculada a un endpoint dedicado de Z.ai + limitada a 9 herramientas en lista blanca (Claude Code / Cline / Cursor, etc.; media-gen-mcp no está dentro); 3 llamadas infractoras bloquean la cuenta y no se reembolsa la suscripción
  - La rotación de múltiples keys (`apiKeys: ["k1", "k2", ...]`) está soportada técnicamente, pero **el User Agreement de Zhipu §2/§3 prohíbe multi-cuenta / compartir cuenta** — la rotación de varias keys puede infringir el contrato y la plataforma se reserva el derecho de bloquear la cuenta. Asegúrate de que todas las keys provengan de cuentas propias y legítimas

#### Nivel 3: PaddleX / PP-StructureV3 (chino SOTA + reconocimiento de tablas)

- **Qué hace**: OCR en chino (calidad claramente superior al motor por defecto), análisis de layout, **facturas / reportes / documentos escaneados → tabla HTML/Markdown**, lectura de datos desde gráficos
- **¿Hay que instalar un servicio?**: **Sí**, autohospeda un servicio REST PaddleX; MCP lo invoca vía `baseUrl`
- **Requisitos mínimos de recursos** (medidos en real):

  | Modo | Umbral mínimo | Recomendado | Notas |
  |---|---|---|---|
  | GPU | RTX 3060 12GB VRAM | RTX 3060 12GB / Tesla T4 | El modelo carga ~2.4GB; picos en PDF complejo ~6GB |
  | CPU | 4 núcleos + 8GB memoria | 8 núcleos + 16GB memoria | Funciona (documentos ligeros), pero lotes / PDF complejo es 3–5× más lento |
  | Disco | ~3GB | ~5GB | paddlepaddle + paddlex + pesos |
  | Tamaño del modelo | ~100–300MB (una pipeline) | — | Acumula por cada pipeline |

- **Requisitos CUDA**: Compute Capability ≥ 7.0 (V100 / T4 / RTX serie 20/30/40; la serie 50 no está totalmente adaptada); requiere CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 para aceleración en GPU
- **Cómo instalar**:

  ```bash
  pip install paddlex paddlepaddle          # versión GPU: paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  Luego, en `config.json`, agrega una línea:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### Nivel 4: vLLM + Qwen2.5-VL (VLM de comprensión visual general)

- **Qué hace**: preguntas sobre imágenes, reconocimiento de escritura a mano, reconocimiento de fórmulas, descripción en lenguaje natural de escenas complejas — las tareas de «comprensión» que PaddleX no cubre
- **¿Hay que instalar un servicio?**: **Sí**, autohospeda un servicio de inferencia vLLM
- **Requisitos mínimos de recursos** (medidos en real):

  | Modo | Umbral mínimo | Recomendado | Notas |
  |---|---|---|---|
  | GPU 7B full precision (FP16) | 16GB VRAM | **24GB VRAM** (RTX 3090 / 4090 / A5000) | Pesos ~15–16GB + KV cache; vLLM ocupa 90% de VRAM por defecto |
  | GPU 7B cuantizado (INT8/AWQ) | 10–12GB VRAM | 16GB VRAM | La versión cuantizada cabe en RTX 4080 / 4060 Ti 16GB |
  | GPU versión ligera 3B | 6–8GB VRAM | GTX 1660 / 3060 6–8GB | FP16 ~6–8GB, INT4 ~3–4GB; el punto dulce del desarrollador individual |
  | CPU | No recomendado | — | Funciona, pero 5–10× más lento; en producción usa GPU |
  | Memoria | 16GB | 16–32GB | — |
  | Disco | ~14GB (pesos 7B) | — | 3B ~6GB |
  | Requisitos CUDA | Compute Capability ≥ 7.0 | — | Mínimo Tesla T4 (7.5); V100 / A100 / RTX serie 30/40 también sirven |

- **Cómo instalar**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # Cuando veas "Uvicorn running on http://0.0.0.0:8000", está listo
  ```
  Más parámetros (selección de GPU / versión cuantizada / límite de concurrencia) en la [documentación oficial de vLLM](https://docs.vllm.ai). Luego, en `config.json`, agrega:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

##### Avanzado: Unlimited-OCR para análisis de documentos largos (autohospedado con SGLang/vLLM)

El Qwen2.5-VL por defecto del nivel 4 es un VLM de propósito general (fuerte en VQA / descripción de escena). Si lo que necesitas es **OCR de documentos largos / tablas complejas / análisis de PDF multipágina en una sola pasada** (miles~decenas de miles de caracteres por imagen), cambia a [baidu/Unlimited-OCR](https://github.com/baidu/Unlimited-OCR) (MIT, un paso más allá de la línea Deepseek-OCR). Se **entrena con un prompt de solo 2 palabras** `document parsing.`; la salida larga se protege contra la degeneración mediante `custom_logit_processor` (DeepseekOCRNoRepeatNGram) — una clase distinta de herramienta frente a Qwen2.5-VL.

**Cuando configuras Unlimited-OCR, el provider `vlm` activa automáticamente los 4 task** (extract-text / extract-table / describe-image / analyze-chart); además, `extract-text` / `extract-table` usan el contrato de prompt corto para imagen única del README, mientras que `describe-image` (VQA) y `analyze-chart` (extracción JSON) siguen usando el prompt largo original — no necesitas escribir un prompt override a mano, el MCP escoge automáticamente según el modelo.

**Despliegue (SGLang, recomendado — soporta el conjunto completo de `custom_logit_processor`)**:

```bash
# Pull de la imagen (detalles en el README de Unlimited-OCR)
docker pull vllm/vllm-openai:unlimited-ocr          # CUDA 13.0 por defecto
# Para GPUs Hopper usa cu129:
# docker pull vllm/vllm-openai:unlimited-ocr-cu129

# Arranca el servidor SGLang (los parámetros clave se explican en la sección «SGLang» del README de Unlimited-OCR)
python -m sglang.launch_server \
  --model baidu/Unlimited-OCR \
  --served-model-name Unlimited-OCR \
  --attention-backend fa3 --page-size 1 \
  --mem-fraction-static 0.8 --context-length 32768 \
  --enable-custom-logit-processor \
  --host 0.0.0.0 --port 10000
```

`custom_logit_processor` es la salida convertida a cadena del método Python `DeepseekOCRNoRepeatNGramLogitProcessor.to_str()` (un formato de serialización privado de SGLang que TS no puede sintetizar). **Ejecútalo una vez durante el despliegue** y pega la cadena en `config.json`:

```bash
# En un entorno Python con sglang instalado, ejecuta esta línea:
python -c "from sglang.srt.sampling.custom_logit_processor import DeepseekOCRNoRepeatNGramLogitProcessor as P; print(P.to_str())"
# Imprime una cadena larga; cópiala en el campo custom_logit_processor de abajo
```

**Ejemplo de config.json** (cambia `vlm` a Unlimited-OCR + configura los campos de extensión `extra_body`):

```json
{
  "providers": {
    "vlm": {
      "baseUrl": "http://127.0.0.1:10000",
      "models": { "default": "Unlimited-OCR" },
      "extra_body": {
        "images_config": { "image_mode": "gundam" },
        "custom_params": { "ngram_size": 35, "window_size": 128 },
        "custom_logit_processor": "<la cadena impresa por python -c arriba>",
        "skip_special_tokens": false
      }
    }
  }
}
```

Significado de los campos (todos top-level, aceptados por la API OpenAI-compatible de SGLang; el MCP simplemente los aplana con `Object.assign` dentro del body del fetch):

| Campo | Valor | Notas |
|---|---|---|
| `images_config.image_mode` | `gundam` / `base` | Imagen única de alta precisión: `gundam` (base_size=1024, image_size=640, crop_mode=true); PDF multipágina: `base` (image_size=1024, crop_mode=false). media-gen-mcp usa un **contrato de imagen única**, por lo que `gundam` es el óptimo por defecto |
| `custom_params.ngram_size` | `35` (recomendado) | Longitud de NoRepeatNGram; 35 es el valor recomendado por el README |
| `custom_params.window_size` | `128` (imagen única) / `1024` (multipágina) | Imagen única: 128; el contrato de imagen única de media-gen-mcp recomienda 128 |
| `custom_logit_processor` | Salida de `.to_str()` en Python | Obligatorio (sin él, la salida larga degenera por repetición); TS no puede sintetizarlo — hay que ejecutar Python una vez para obtener la cadena |
| `skip_special_tokens` | `false` | Las tareas de OCR deben conservar los tokens especiales; no skip |

> ⚠️ **Gating por task (importante)**: `extra_body` (incl. `custom_logit_processor` / `skip_special_tokens:false` / `images_config.image_mode:gundam`) solo se aplana al body del fetch en `extract-text` / `extract-table` (la ruta OCR) — `describe-image` (VQA) y `analyze-chart` (extracción JSON) **NO llevan estos campos**. Motivo: NoRepeatNGram (ngram_size=35) suprime palabras legítimamente repetidas en las descripciones VQA; `skip_special_tokens:false` filtraría tokens estructurales de OCR a la descripción / corrompería el `JSON.parse` de `analyze-chart`; `image_mode:gundam` (crop_mode=true) trocea la imagen entera y rompe la comprensión holística de la escena en VQA. Este es el contrapunto simétrico del gating de prompt corto model-aware (`promptForUnlimited`) — `describe-image` / `analyze-chart` siguen usando el prompt largo original Y un body limpio. Si necesitas forzar campos de extensión en `describe-image` / `analyze-chart`, usa el `extra` por llamada (pásalo en el parámetro `extra` de las herramientas `extract_text` / `extract_table` / `describe_image` / `analyze_chart`); no está sujeto al gating por task.

**Invocación**: pasa explícitamente `provider=vlm` a `extract_text` (si no, irá a defaultVisionProvider=tesseract):

```
extract_text(image="data:image/png;base64,...", provider="vlm")
```

**Limitaciones importantes**:

- **Modo no streaming**: media-gen-mcp usa `/v1/chat/completions` en modo **no stream** de vLLM/SGLang (JSON devuelto de golpe), adecuado para documentos de una sola página o medianos/cortos. El `infer.py` de Unlimited-OCR usa `stream:true` por defecto — **NO copies `stream:true` al `extra_body`**; el MCP lo detecta y rechaza con el aviso «elimina extra.stream». Para PDFs muy largos, primero [parte las páginas con PyMuPDF](https://github.com/baidu/Unlimited-OCR#transformers) (el README trae un snippet `pdf_to_images`) y luego llama a `extract_text` por cada página — las peticiones independientes por página evitan de forma natural salidas demasiado largas.
- **Timeout del servidor**: los documentos largos tardan bastante en generarse; cuando los 60 s por defecto de vLLM no basten, sube el `REQUEST_TIMEOUT` de SGLang o el `--timeout-keepalive` de vLLM.
- **Umbral de GPU**: 16–24GB VRAM (igual que el nivel 4); si no llegas, sigue usando la cadena paddle(10)/glm-vision(9).

**License**: [MIT](https://github.com/baidu/Unlimited-OCR/blob/main/LICENSE) (alineado con la postura puramente gratuita; mismo nivel que Apache-2.0 de Qwen; uso comercial OK).

#### Comparación rápida de los cuatro niveles

| Nivel | ¿Instala servicio? | Umbral de recursos | Chino | Tabla | Pregunta sobre imagen | License / origen |
|---|---|---|---|---|---|---|
| **1 Por defecto** (tesseract) | No | Cero (CPU WASM puro) | Normal | ❌ | ❌ | Apache 2.0 (autohospedado) |
| **2 GLM-4.6V-Flash de Zhipu** | No (API en la nube) | Cero (HTTP puro) | ✅ SOTA | ✅ | ✅ | El usuario aporta su propia key de Zhipu (gratis para siempre) |
| **3 PaddleX** | Sí | GPU 12GB o CPU 4 núcleos 8GB | ✅ SOTA | ✅ | ❌ | Apache 2.0 (autohospedado) |
| **4 vLLM Qwen2.5-VL** | Sí | **GPU 16–24GB** (CPU no válido) | ✅ | Normal | ✅ | Apache 2.0 (autohospedado) |

> Los tres niveles autohospedados (1/3/4) eligen deliberadamente solo motores **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL), evitando las trampas de AGPL / GPL / licencias comerciales, **listo para uso empresarial directo**. El nivel 2, Zhipu, es un API en la nube (GLM-4.6V-Flash gratis para siempre, el usuario aporta su propia key), no autohospedado — adecuado para usuarios que no quieren desplegar un servidor y necesitan completar chino SOTA + VQA.

---

### III. Mecanismo de respaldo automático (configúralo y olvídate)

- **Lado de generación**: Agnes ↔ Zhipu; si uno falla, conmuta automáticamente al otro (fallos consecutivos en 60 s activan conmutación suave; no necesitas reiniciar ni cambiar configuración)
- **Lado de reconocimiento**: motor ligero por defecto (respaldo en proceso) → GLM-vision (nube) → PaddleX → vLLM; degradación automática según capacidad
- **Única excepción**: durante el polling para obtener el clip de video **no se conmuta** (para evitar recibir un resultado equivocado)
- Lo que tú haces: configura dos API Key de generación + opcionalmente instala un nivel de reconocimiento; del resto se encarga Claude

> ¿Tu máquina no corre PaddleX o vLLM? **Sigue usando el motor ligero por defecto**; el MCP no falla por no tener servicios locales — solo quedan sin efecto chino SOTA / tablas / preguntas sobre imagen; todo lo demás sigue funcionando con normalidad.

---

## Preguntas frecuentes

**P: ¿Funciona sin instalar nada?**
R: Sí. Instalando el MCP ya tienes dibujos / tarjetas / códigos QR / fórmulas / gráficos de datos + OCR inglés / captcha, todo local, sin conexión.

**P: ¿El OCR de chino sale con caracteres raros?**
R: El motor ligero por defecto es suficiente para inglés / números / documentos simples; la precisión en chino es normal. Para chino SOTA hay dos rutas: (1) **cero despliegue** — agrega una línea con la Key de GLM de Zhipu (GLM-4.6V-Flash en la nube, gratis para siempre); (2) autohospeda PaddleX (GPU 12GB o CPU 4 núcleos 8GB). Ver [Configuración detallada](#configuración-detallada) arriba.

**P: ¿Cuánto tarda un video de IA?**
R: Un video de 5 s, ~1–3 min; uno de 18 s, ~5–10 min. Generación asíncrona en segundo plano; te avisa al terminar; los que se estiman en ≤60 s se esperan de forma síncrona.

**P: ¿Mi RTX 3060 corre el reconocimiento de tablas?**
R: Sí. PaddleX en modo GPU requiere mínimo 12GB VRAM (la RTX 3060 12GB justa); en modo CPU, 4 núcleos + 8GB memoria también corre (3–5× más lento). Ver [Configuración detallada](#configuración-detallada).

**P: ¿Chino / emoji / gradientes salen bien?**
R: Sí. Las tarjetas para compartir soportan automáticamente chino, kanji japonés, emoji en color, títulos en gradiente y efectos de resplandor mediante una fuente china integrada + motor de maquetación; sin configuración adicional de fuentes.

**P: ¿Soporta Mermaid?**
R: No (requiere navegador). Usa D2 o Graphviz en su lugar; capacidad equivalente y más estable, con salida vectorial.

**P: ¿Rate limiting (429)?**
R: La capa gratuita tiene límite de peticiones por minuto. Configurando dos proveedores (Agnes + Zhipu) se conmuta automáticamente, prácticamente imperceptible.

**P: ¿Límite de fotogramas de video?**
R: Disminuye con la resolución — 1080p ≤ 241 fotogramas (~10 s), 720p hasta 441 fotogramas (~18 s). Puedes preguntar a Claude por las restricciones en tiempo real.

**P: ¿npx no conecta / arranca lento?**
R: También puedes instalar global: primero `npm i -g media-gen-mcp-server`, luego `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

**P: ¿Puedo usar palabras sensibles / armas / temas de guerra?**
R: Las palabras de armas reales activan el filtro de contenido. Usa términos de ciencia ficción (p. ej. «armadura futurista», «mecha») para evitarlo; el efecto es equivalente.

**P: ¿Claude elegirá la herramienta equivocada? (p. ej., generar una imagen cuando pides una tarjeta)**
R: El enrutamiento de estas solicitudes ambiguas ya está calibrado — «haz una tarjeta / póster / imagen OG», «lee los datos de este gráfico», «haz una animación de intro de producto», «dibuja un diagrama de arquitectura / flujo», «visualiza estos datos» y similares van ahora automáticamente a la herramienta especializada correcta, sin necesidad de corregir manualmente. También puedes nombrar una herramienta explícitamente en tu solicitud.

---

## Para quién es esto

- **Usuarios intensivos de Claude Code** — hacen tareas de imagen varias veces por semana y no quieren instalar un MCP distinto ni recordar parámetros nuevos para cada una.
- **Desarrolladores que escriben docs / blogs técnicos** — necesitan una y otra vez diagramas de arquitectura, de secuencia, ER, de datos y fórmulas, sin salir de su flujo.
- **Desarrolladores individuales / producto independiente** — cuidadosos con el coste (todo gratis) y la reproducibilidad (misma entrada, misma salida), sin querer montar un backend solo para imágenes.
- **Datos / finanzas / legal** — escenario bidireccional: dibujar datos como gráficos y, a la inversa, extraer puntos de datos desde capturas / facturas / **informes PDF / contratos** (marca de agua / sello rojo ignorables; artículos a doble columna se combinan por orden de lectura).
- **Educación / académico** — estudiantes que extraen texto de capturas de material docente / apuntes escaneados / PDFs de artículos, combinan artículos a doble columna en texto continuo y preguntan por los datos leídos en los gráficos; profesores que convierten exámenes en papel escaneados en texto editable.
- **Operaciones / creadores de contenido / autores de blogs** — tarjetas para compartir / OG / pósters / códigos QR con chino + emoji en color + gradiente listos para usar.

> **No tan adecuado para**: usuarios que no usan Claude Code; equipos de ingeniería que solo necesitan una capacidad y ya tienen su pipeline montado; escenarios que requieren modelos comerciales de pago / entrenamiento de fine-tuning / OCR de video en tiempo real (estos exceden el alcance de un MCP gratuito).

---

## 💝 Apoya al Autor

Si media-gen-mcp te ayuda, invita al autor a un café ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

O ⭐ [Star](../../stargazers) / [Issue](../../issues) / [PR](../../pulls) — toda forma de apoyo se agradece.

---

## License

**MIT** — el código principal, úsalo como quieras.

El lado de reconocimiento es pila totalmente **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL), sin riesgo de licencia para uso empresarial.

---

> Detalles técnicos: proveedores y motores son enchufables; las herramientas estructuradas producen la misma salida para la misma entrada (apto para git); conmutación automática de proveedor ante fallos. Contribuidores en `CONTRIBUTING.md`; documentación completa en el directorio `docs/`.

<p align="center">
  <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
  <sub>Instala una vez: a partir de ahora, cada tarea de imagen es solo una frase.</sub>
</p>
