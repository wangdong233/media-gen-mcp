<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-get-a-free-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Um servidor MCP gratuito de texto-para-imagem + texto-para-vídeo para o Claude Code**

Texto-para-imagem / imagem-para-imagem / texto-para-vídeo / imagem-para-vídeo / animação por keyframes — **tudo gratuito** (via Agnes AI + modelos gratuitos da Zhipu)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | **Português**

</div>

## ① Obtenha uma chave gratuita

Cadastre-se em um (ou em ambos) abaixo para obter uma chave de API gratuita:

| Provider | Gratuito | Como obter |
|---|---|---|
| **Agnes AI** (padrão) | Todas as imagens + vídeos gratuitos | https://platform.agnes-ai.com/ → cadastre-se → API Keys |
| **Zhipu BigModel** (opcional, 4K / chinês) | imagem cogview-3-flash + vídeo cogvideox-flash gratuitos para sempre | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → verificar → criar chave |

> Passos detalhados: [doc/Guia de adesão Agnes](doc/Agnes%20开通指引.md) · [doc/Guia de adesão Zhipu](doc/Zhipu%20开通指引.md)

## ② Configurar (uma vez)

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

## ③ Adicionar ao Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp
```

O comando de instalação não carrega nenhuma chave (ela está no config acima). Execute `/mcp` — `media-gen-mcp ✓ Connected` indica sucesso.

## ④ Usar

Basta dizer no Claude Code (roteamento automático para o provider/modelo certo):

| Cenário | Diga | Resultado |
|---|---|---|
| **Padrão** | "Gere uma imagem fotorrealista de um gato" / "Gere um vídeo de praia de 5s" | Usa defaultImageProvider / defaultVideoProvider |
| **Provider específico** | "Use a **Zhipu** para desenhar" / "Use a **agnes** para vídeo" | Troca o provider temporariamente, sem alterar o config |
| **Modelo específico** | "Use o **cogview-4** para desenhar" / "Use o **agnes-video-v2.0**" | Escolhe um modelo específico (qualidade superior etc.) |
| **Provider + modelo** | "Use a **Zhipu cogvideox-3** para um vídeo 4K" | Especificação exata (4K / primeiro-último quadro) |
| **Imagem-para-imagem** | "Transforme esta imagem em aquarela" | Imagem de referência → nova imagem |
| **Imagem-para-vídeo** | "Transforme esta imagem em um vídeo" | Imagem única → vídeo |
| **Keyframes** | "Faça uma transição suave entre estas duas imagens" | Várias imagens → transição suave |

> Omitir especificações → usa os padrões; especificar provider/modelo afeta apenas esta chamada, **não o seu config**.

## Providers

| | Padrão | Imagem (gratuito) | Vídeo (gratuito) | Destaque |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Tudo gratuito, fotorrealista, áudio nativo |
| **zhipu** (opcional) | | cogview-3-flash | cogvideox-flash | 4K/60fps, chinês nativo, em conformidade com a China |

Para trocar: `defaultProvider: "zhipu"`, ou por modalidade via `defaultImageProvider`/`defaultVideoProvider`, ou passe `provider` por chamada. Em dúvida sobre qual escolher? Veja o [comparativo](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (avançado, normalmente desnecessário)

**Fallback de provider em três níveis** (argumento por chamada > por modalidade > global):

| Campo | Padrão | Descrição |
|---|---|---|
| `defaultProvider` | `agnes` | Padrão global (fallback final quando nenhuma modalidade está definida) |
| `defaultImageProvider` | igual ao `defaultProvider` | Padrão da modalidade de imagem (usado por `generate_image`) |
| `defaultVideoProvider` | igual ao `defaultProvider` | Padrão da modalidade de vídeo (usado por `create_video` / `get_video`) |

Ex.: `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → imagens via agnes, vídeos via Zhipu. Omita os dois últimos campos para voltar ao `defaultProvider` em tudo.

Config de conexão por provider:

| Campo | Padrão | Descrição |
|---|---|---|
| `providers.<name>.apiKey` | — | **obrigatório**, um por provider |
| `providers.<name>.models.image.default` | embutido no provider | modelo de imagem padrão |
| `providers.<name>.models.video.default` | embutido no provider | modelo de vídeo padrão |
| `outDir` | session-dir/output | diretório de saída (sobrescrevível por chamada) |

> Autoaprendizado de rate-limit (rateLimits / rateLimitTtlMs) e outros campos avançados — veja em [doc/](doc/).

## FAQ

**Vídeos lentos?** De 3–18s, levam ~1–3 min. Omitir `wait` torna a chamada assíncrona, com notificação ao concluir.
**Número de quadros?** Passe `durationSeconds` para a escolha automática (5/10/18s). A Agnes permite apenas 81/121/161/241/441.
**Recebeu 429?** Serializador de 62s embutido; aprende automaticamente o rate limit real.
**Config não é lido?** Precisa estar em `~/.media-gen-mcp/config.json` (o npx instala no cache; um config dentro do projeto não fica disponível).

## Arquitetura + Docs

Arquitetura plugável por provider (agnes + zhipu; adicionar um provider não exige mudanças na camada de ferramentas). Mais em [doc/](doc/):

- [doc/Guia de adesão Agnes](doc/Agnes%20开通指引.md) · [doc/Guia de adesão Zhipu](doc/Zhipu%20开通指引.md) · [doc/Comparativo Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

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
