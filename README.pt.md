<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-consiga-uma-key-grátis)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Dê ao Claude Code "superpoderes de geração de imagens" — gere imagens / vídeos / gráficos / cartões / QR codes com uma única frase**

Geração de imagens e vídeos por IA (grátis) + desenho estruturado (determinístico, local) + renderização SVG estilosa (alta fidelidade via Chrome)

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | **Português**

</div>

---

## ✨ Características

- 🆓 **Totalmente grátis** — geração de imagens/vídeos por IA usa Agnes AI + modelos grátis da Zhipu; desenho estruturado é 100% local, custo zero
- 🧠 **Curva de aprendizado zero** — basta falar em linguagem natural; o Claude escolhe a ferramenta, gera o código e produz a imagem automaticamente
- 📐 **Saída determinística** — diagramas/gráficos/fórmulas/cartões: mesma entrada gera sempre a mesma saída, conteúdo controlável
- 🇨🇳 **Amigável com chinês** — cartões renderizam chinês automaticamente (fonte embutida); modelos da Zhipu são nativos em chinês
- 🔌 **Sem dependências externas** — D2 / Graphviz / Vega / MathJax já vêm embutidos; não é preciso instalar d2/dot/matplotlib no sistema
- 🎨 **Renderização estilosa** — feGaussianBlur para brilho/gradientes/profundidade, com renderização automática em alta fidelidade via Chrome
- 🌐 Documentação em 8 idiomas · MIT · Node ≥18

---

## 💬 O que você ganha?

Depois de instalar, basta **dizer uma frase** no Claude Code e você pode:

| O que você diz | O que você obtém |
|---|---|
| "Gere uma imagem realista de um gato laranja estilo wuxia" | 🖼️ Imagem realista gerada por IA |
| "Gere um vídeo de 5 segundos na praia" | 🎬 Vídeo curto gerado por IA |
| "Desenhe um diagrama de arquitetura: cliente → API gateway → dois microsserviços" | 📐 Diagrama de arquitetura vetorial nítido |
| "Transforme estes dados de vendas num gráfico de barras" | 📊 Gráfico de visualização de dados |
| "Renderize esta fórmula `E=mc^2`" | ➗ Imagem de fórmula matemática em alta resolução |
| "Crie um cartão de compartilhamento com gradiente e emoji 🚀" | 🎴 Imagem OG / social (chinês automático) |
| "Me dá um logo do GitHub" | 🏷️ Ícone vetorial |
| "Gere um QR code" | ▪️ QR code |
| "Desenhe um diagrama de arquitetura estiloso, dark e tech, com brilho" | ✨ Imagem em alta fidelidade via Chrome |

> **Tudo com uma única frase.** Você não precisa decorar nenhum nome de ferramenta ou parâmetro.

---

## 🚀 Início rápido

### ① Consiga uma Key grátis

Cadastre-se em qualquer um dos provedores abaixo (ou em ambos) e pegue uma API Key gratuita:

| Provedor | Grátis | Como obter |
|---|---|---|
| **Agnes AI** (padrão) | Texto→imagem + Texto→vídeo, totalmente grátis | https://platform.agnes-ai.com/ → registre-se → API Keys |
| **Zhipu BigModel** (opcional, 4K / chinês) | cogview-3-flash para imagem + cogvideox-flash para vídeo, grátis para sempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verificação de identidade → criar Key |

> Passo a passo detalhado com imagens: [Guia de ativação da Agnes](doc/Agnes%20开通指引.md) · [Guia de ativação da Zhipu](doc/Zhipu%20开通指引.md)

### ② Configuração

Crie `~/.media-gen-mcp/config.json` e preencha sua Key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-sua-agnes-key" },
    "zhipu": { "apiKey": "sua-zhipu-key" }
  }
}
```

Você pode configurar apenas o agnes (basta remover a linha do zhipu). Se não preencher `models`, os modelos padrão embutidos são usados.

### ③ Conecte ao Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

O comando de conexão **não inclui a Key** (ela fica no config acima). Quando `/mcp` mostrar `media-gen-mcp ✓ Connected`, está pronto.

### ④ Diga uma frase

No Claude Code, basta dizer "desenhe um diagrama de arquitetura" ou "gere uma imagem realista de um gato laranja" — pronto.

> **Quer apenas desenhar diagramas/gráficos/cartões/QR codes?** Não precisa de Key; basta instalar (③) e usar.

---

## 📡 Provedores

| | Padrão | Imagem (grátis) | Vídeo (grátis) | Destaques |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Totalmente grátis, textura realista, áudio/vídeo nativos |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, nativo em chinês, em conformidade com regulamentações locais |

Para alternar: `defaultProvider: "zhipu"`, ou por modalidade via `defaultImageProvider`/`defaultVideoProvider`, ou passe `provider` para uso único. Em dúvida sobre qual escolher? Veja a [comparação](doc/Agnes_vs_Zhipu_横评.md).

---

## 🛠️ Detalhes das capacidades

### 🤖 Geração por IA (modelos grátis · online)

Use os modelos grátis da Agnes AI ou da Zhipu:
- **Texto→imagem / Imagem→imagem** — realista, ilustração, arte conceitual
- **Texto→vídeo / Imagem→vídeo / Animação por keyframes** — assíncrono inteligente (vídeos longos rodam em segundo plano, com aviso ao concluir)
- Especifique provedor/modelo: "use **cogview-4 da Zhipu** para desenhar" / "use **agnes** para gerar o vídeo"

### 📐 Desenho estruturado (local · determinístico · sem Key)

As capacidades abaixo **não chamam IA e produzem saída determinística** (SVG vetorial em alta resolução):

| Capacidade | Engine (tudo embutido) | Descrição |
|---|---|---|
| **Diagramas estruturais** | D2 + Graphviz | Arquitetura/fluxo/sequência/classes/ER/mapas mentais, layout automático |
| **Gráficos de dados** | Vega-Lite | Barras/linhas/pizza/área/dispersão, o Claude gera a partir dos dados |
| **Fórmulas matemáticas** | MathJax | LaTeX → SVG, glifos embutidos |
| **Cartões de compartilhamento** | Satori | OG/posters/cartões de citação (chinês + gradiente + emoji + brilho automáticos) |
| **QR codes** | qrcode | URL/texto → SVG/PNG |
| **Ícones vetoriais** | Iconify | Mais de 200 mil ícones (`icon: "mdi:home"`) |
| **SVG estiloso** | Chrome / resvg | SVG escrito à mão (brilho/filtros/profundidade) → renderização em alta fidelidade via Chrome |

<details>
<summary>📖 O que os cartões fazem?</summary>

- 5 modelos: og (hierarquia alinhada à esquerda) / quote (citação, aspas podem envolver dos dois lados) / minimal (minimalista) / hero (texto grande em destaque + pontos de luz) / panel (painel de vidro)
- Texto do título em gradiente + brilho + profundidade com manchas de luz desfocadas
- Logo embutido / avatar circular
- Chinês automático (Noto Sans SC offline) + emoji colorido automático (em cache no disco, funciona sem internet)
- Tamanhos customizáveis (padrão 1200×630, formato OG)
</details>

<details>
<summary>📖 O que é a renderização SVG estilosa?</summary>

A engine D2 não suporta filtros SVG (feGaussianBlur para brilho), então quando você quer efeitos do tipo "visual dark e tech, brilho, profundidade":
1. O Claude escreve o SVG à mão (com filtros como feGaussianBlur)
2. Chama a ferramenta `render_svg`
3. A ferramenta escolhe o backend automaticamente: se há `<filter>` e o Chrome está disponível no sistema → Chrome (100% de fidelidade dos filtros); caso contrário → resvg (92%, mais leve)
</details>

<details>
<summary>📖 Sobre o modo offline (quais ferramentas precisam de internet?)</summary>

- **Totalmente offline**: generate_diagram / generate_chart / generate_formula / generate_qrcode
- **Online apenas na primeira vez, depois em cache offline**: generate_card (a fonte Latina padrão Inter é baixada da CDN na primeira vez e armazenada em `~/.media-gen-mcp/fonts/`; a fonte CJK Noto Sans SC já vem embutida offline; os emojis twemoji ficam em cache no disco e funcionam sem internet)
- **Precisa de internet**: generate_icon (baixa via API do Iconify); render_svg quando há filtros (precisa do Chrome)
- **Sempre online**: ferramentas de geração por IA (generate_image / create_video)
</details>

---

## ❓ FAQ

**Vídeo demora?** 3–18s, cerca de 1–3 minutos. Omita `wait` para modo assíncrono automático (>60s retorna um handle e avisa ao concluir).
**Quantidade de frames?** Passe `durationSeconds` e a escolha é automática (5/10/18s). O Agnes só permite 81/121/161/241/441.
**Erro 429?** Há espera serial de 62s embutida + aprendizado automático do rate limit real.
**Ferramentas estruturadas precisam de Key?** Não. Basta instalar para desenhar diagramas/gráficos/cartões/QR codes.
**Chinês/emoji/gradiente nos cartões?** Tudo automático: fonte CJK embutida + emojis twemoji (cache em disco) + fundo em gradiente via CSS.
**SVG estiloso?** O Claude escreve o SVG à mão (com brilho feGaussianBlur) → `render_svg` → 100% de fidelidade dos filtros no Chrome.
**Mermaid é suportado?** Não (precisa de navegador). Use D2 no lugar (cobre fluxo/sequência/classes/ER/mapas mentais).
**Config não foi lido?** Tem que estar em `~/.media-gen-mcp/config.json`.
**`npx` não conecta?** Plano B — instalação global:
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ Arquitetura + documentação

- **Providers plugáveis** (agnes + Zhipu; adicionar um novo provider exige zero mudanças na camada de ferramentas); **engines plugáveis** (DiagramEngine e MediaProvider rodam em paralelo, sem se contaminar)
- [Lista de requisitos de arquitetura](doc/架构要求清单.md) — especificação da arquitetura do projeto (mantida continuamente)
- Mais em [doc/](doc/): [Guia de ativação da Agnes](doc/Agnes%20开通指引.md) · [Guia de ativação da Zhipu](doc/Zhipu%20开通指引.md) · [Comparação de providers](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Apoie o autor

Se o media-gen-mcp te ajudou, considere pagar um café para o autor ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Ou ⭐ Star, abrir uma Issue / PR — também são formas de apoiar o autor.

## License

[MIT](LICENSE)
