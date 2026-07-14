<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**O MCP completo de geração de imagens para o Claude Code — imagens com IA + desenho estruturado local, em um único servidor**

Texto-para-imagem / imagem-para-imagem / texto-para-vídeo / imagem-para-vídeo / animação por keyframes · diagramas / gráficos / fórmulas / cartões / ícones / códigos QR

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | **Português**

</div>

---

## ✨ Destaques

- 🎨 **Imagens com IA, totalmente grátis**: texto-para-imagem, imagem-para-imagem, texto-para-vídeo, imagem-para-vídeo, animação por keyframes — via modelos gratuitos da **Agnes AI + Zhipu**, sem custo.
- 📐 **Desenho estruturado local, determinístico**: diagramas, gráficos, fórmulas, cartões, ícones, códigos QR — **vetorial SVG em alta resolução**, sem chamadas de IA, zoom infinito, texto nítido, totalmente controlável.
- 🧠 **Um único modelo mental**: basta dizer "gere uma imagem" — o Claude roteia automaticamente para IA ou para um motor local e gera a DSL/JSON/LaTeX correspondente. **Zero etapas adicionais** para o usuário.
- 🌏 **Polido desde o início**: cartões **suportam CJK automaticamente** (Noto Sans SC embutido, offline), **fundos sólidos/gradientes** e **emojis coloridos**; diagramas suportam **D2 e Graphviz**.
- 🔌 **Plugável**: providers e motores de renderização são ambos extensíveis sem mudanças na camada de ferramentas; roteamento padrão por modalidade + autoaprendizado de rate-limit.
- 🆓 **Ferramentas estruturadas não precisam de chave**: após `claude mcp add`, as 6 ferramentas locais funcionam imediatamente — **desenhe diagramas/gráficos/cartões/códigos QR sem nenhuma chave de IA**.
- 🌐 README em 8 idiomas · MIT · Node ≥18

---

## 🛠️ As 10 ferramentas

### 🤖 Geração com IA (online · grátis)

| Ferramenta | Capacidade |
|---|---|
| `generate_image` | **texto-para-imagem** / **imagem-para-imagem** (referência → nova) |
| `create_video` | **texto-para-vídeo** / **imagem-para-vídeo** / **animação por keyframes** (síncrono/assíncrono inteligente) |
| `get_video` | verificar + baixar uma tarefa de vídeo |
| `list_models` | listar modelos por provider e restrições de vídeo |

### 📐 Renderização estruturada (local · determinística · geralmente sem chave)

| Ferramenta | Saída | Motor |
|---|---|---|
| `generate_diagram` | arquitetura / sequência / fluxograma / classes / ER / mapa mental | **D2** DSL · **Graphviz** (DOT) |
| `generate_chart` | barras / linhas / pizza / área / dispersão | Vega-Lite |
| `generate_formula` | fórmulas matemáticas em LaTeX (glifos incorporados, sem fonte necessária) | MathJax |
| `generate_card` | cartões OG / de compartilhamento / de citação (padrão 1200×630; templates og/quote/minimal/hero/panel; CJK/fundo gradiente/emoji colorido automáticos, título em gradiente + glow) | Satori + resvg |
| `generate_icon` | 200k+ ícones vetoriais (`prefix:name`) | Iconify |
| `generate_qrcode` | códigos QR | qrcode |

> Das 6 ferramentas estruturadas, **4 são totalmente offline** (diagram / chart / formula / qrcode). A fonte Latina padrão do `generate_card` é buscada uma vez no CDN e cacheada em `~/.media-gen-mcp/fonts/` (offline depois disso, ou passe `fontPath` para ser offline imediatamente); a fonte CJK (Noto Sans SC) é **embutida offline**. No entanto, **emojis** do cartão (twemoji) e `generate_icon` (Iconify) precisam de rede (apenas em cache, não embutidos). As ferramentas de geração com IA estão sempre online.

---

## 🚀 Início rápido

### ① Obtenha uma chave gratuita (apenas para geração com IA; pule se você só vai desenhar imagens estruturadas)

Cadastre-se em um (ou em ambos) abaixo para obter uma chave de API gratuita:

| Provider | Gratuito | Como obter |
|---|---|---|
| **Agnes AI** (padrão) | Todas as imagens + vídeos gratuitos | https://platform.agnes-ai.com/ → cadastre-se → API Keys |
| **Zhipu BigModel** (opcional, 4K / chinês) | imagem cogview-3-flash + vídeo cogvideox-flash gratuitos para sempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verificar → criar chave |

> Passos detalhados: [doc/Guia de adesão Agnes](doc/Agnes%20开通指引.md) · [doc/Guia de adesão Zhipu](doc/Zhipu%20开通指引.md)

### ② Configure (uma vez)

Crie `~/.media-gen-mcp/config.json` com a sua chave:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Apenas a Agnes já basta (remova a linha zhipu). Omita `models` para usar os padrões embutidos.

### ③ Adicione ao Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

O comando de instalação não carrega **nenhuma chave** (ela está no config acima). Execute `/mcp` — `media-gen-mcp ✓ Connected` indica sucesso.

---

## 💬 Como usar

Basta dizer no Claude Code — **roteamento automático**, não precisa memorizar nomes de ferramentas:

**Geração com IA:**

| Cenário | Diga |
|---|---|
| Padrão | "Gere um gato laranja fotorrealista" / "Gere um vídeo de praia de 5s" |
| Provider específico | "Use a **Zhipu** para desenhar" / "Use a **agnes** para vídeo" |
| Modelo específico | "Use o **cogview-4** para desenhar" / "Use o **agnes-video-v2.0**" |
| Imagem-para-imagem / -para-vídeo | "Transforme esta imagem em aquarela" / "Transforme esta imagem em um vídeo" |
| Animação por keyframes | "Faça uma transição suave entre estas duas imagens" |

**Desenho estruturado:**

| Cenário | Diga |
|---|---|
| Diagrama | "Desenhe uma arquitetura: cliente → API gateway → dois microsserviços" (D2) ou "Desenhe um grafo de dependências em DOT" (Graphviz) |
| Gráfico | "Faça um gráfico de barras com estes dados de vendas" |
| Fórmula | "Renderize esta fórmula: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`" |
| Cartão de compartilhamento | "Faça um cartão OG com **gradiente de roxo a azul** e um emoji 🚀 para este artigo" |
| Ícone | "Me dê um ícone do logo do GitHub" |
| Código QR | "Gere um código QR para https://..." |

> Especificar provider/modelo afeta apenas esta chamada, **não o seu config**. Diagramas usam a [sintaxe D2](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/), gráficos [Vega-Lite](https://vega.github.io/vega-lite), fórmulas [LaTeX](https://www.latex-project.org), ícones em [icon-sets.iconify.design](https://icon-sets.iconify.design) — o Claude gera o código-fonte automaticamente.

> **Mermaid**: `generate_diagram` suporta **D2 e Graphviz**; a renderização in-process do Mermaid precisa de um navegador/Chromium (inadequada para um MCP determinístico), então não é suportado — use D2 (cobre fluxograma/sequência/classes/ER/mapa mental) ou Graphviz no lugar.

---

## 📡 Providers

| | Padrão | Imagem (grátis) | Vídeo (grátis) | Destaque |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Tudo grátis, fotorrealista, áudio nativo |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, chinês nativo, em conformidade com a China |

Para trocar: `defaultProvider: "zhipu"`, ou por modalidade via `defaultImageProvider`/`defaultVideoProvider`, ou passe `provider` por chamada. Em dúvida sobre qual escolher? Veja o [comparativo](doc/Agnes_vs_Zhipu_横评.md).

---

## ⚙️ Config (avançado, normalmente desnecessário)

**Fallback de provider em três níveis** (argumento por chamada > por modalidade > global):

| Campo | Padrão | Descrição |
|---|---|---|
| `defaultProvider` | `agnes` | Padrão global (fallback final) |
| `defaultImageProvider` | igual | Padrão da modalidade de imagem (`generate_image`) |
| `defaultVideoProvider` | igual | Padrão da modalidade de vídeo (`create_video`/`get_video`) |

Ex.: `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → imagens via agnes, vídeos via Zhipu.

Config de conexão por provider: `providers.<name>.apiKey` (obrigatório), `providers.<name>.models.{image,video}.default`, `outDir` (diretório de saída, padrão `session-dir/output`).

> Autoaprendizado de rate-limit (rateLimits / rateLimitTtlMs — em 429, aprende automaticamente o limite real + fallback de expiração de TTL) e outros campos avançados — veja em [doc/](doc/).

---

## ❓ FAQ

**Vídeos lentos?** De 3–18s, levam ~1–3 min. Omitir `wait` torna a chamada assíncrona (est. >60s retorna um identificador, com notificação ao concluir).
**Número de quadros?** Passe `durationSeconds` para a escolha automática (5/10/18s). A Agnes permite apenas 81/121/161/241/441.
**Recebeu 429?** Serializador de 62s embutido; aprende automaticamente o rate limit real.
**As ferramentas estruturadas precisam de chave?** Não. As 6 ferramentas locais funcionam imediatamente; apenas a geração com IA precisa de chave.
**CJK/emoji/gradiente no cartão?** Fonte CJK embutida (automática), emojis coloridos twemoji (automáticos); passe um `linear-gradient(...)` CSS para `bg` para obter um gradiente.
**Efeitos sofisticados no cartão?** `titleGradient` (título em gradiente), `glow` (brilho do título), template `hero` (blob de profundidade desfocado), template `panel` (painel de vidro: border/radius/shadow). Tudo determinístico, in-process via Satori — sem navegador.
**Config não é lido?** Precisa estar em `~/.media-gen-mcp/config.json` (o npx instala no cache; um config dentro do projeto não fica disponível).

---

## 🏗️ Arquitetura + docs

- **Plugável por provider** (agnes + zhipu; adicionar um provider não exige mudanças na camada de ferramentas); **plugável por motor** (DiagramEngine roda em paralelo ao MediaProvider, sem interferência).
- Mais em [doc/](doc/): [Guia de adesão Agnes](doc/Agnes%20开通指引.md) · [Guia de adesão Zhipu](doc/Zhipu%20开通指引.md) · [Comparativo Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Apoie

Se o media-gen-mcp te ajuda, considere pagar um café para o autor ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Ou ⭐ Star, abra uma Issue / PR — tudo é bem-vindo.

## Licença

[MIT](LICENSE)
