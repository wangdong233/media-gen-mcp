# media-gen-mcp

> O «canivete suíço de imagens» do Claude Code — crie, desenhe e entenda imagens numa única frase. Tudo de graça.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.11.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Instale uma vez no Claude Code e, a partir daí, qualquer tarefa de imagem vira uma única frase.** Designers a gerar arte, engenheiros a desenhar arquiteturas, marketing a montar cards de partilha, finanças a extrair tabelas de faturas — geração/reconhecimento + desenho/cards/QR codes, tudo coberto, **100% gratuito** (provedores gratuitos + motores locais — funciona assim que instala).

Cansado de produzir imagens algumas vezes por semana e lidar com N ferramentas e N conjuntos de parâmetros? Instale uma vez e entregue todos os cenários de imagem ao Claude.

简体中文 | English | Deutsch | Español | Français | 日本語 | **Português** | Русский

## Índice

- [Diga, e recebe](#diga-e-recebe)
- [Comece em 60 segundos](#comece-em-60-segundos)
- [O canivete suíço de capacidades](#o-canivete-suíço-de-capacidades)
- [Mergulho na configuração](#mergulho-na-configuração)
- [FAQ](#faq)
- [Para quem é isto](#para-quem-é-isto)
- [Apoie o Autor](#apoie-o-autor)
- [License](#license)

---

## Diga, e recebe

| Você diz... | Você recebe |
|---|---|
| «Desenhe um gato cyberpunk com brilho neon» | Uma imagem fotorrealista por IA, guardada em `output/` |
| «Gere um vídeo de 5 segundos de um pôr do sol na praia» | Um vídeo MP4 por IA (gerado em background, é notificado ao terminar) |
| «Desenhe um diagrama de arquitetura: cliente → API gateway → serviço de pedidos + serviço de pagamentos» | Um diagrama de arquitetura vetorial |
| «Transforme estes dados de vendas num gráfico de barras» | Um gráfico de dados em alta resolução |
| «Faça um QR code a apontar para github.com» | Um QR code vetorial |
| «Renderize E=mc² como fórmula em alta resolução» | Uma fórmula vetorial |
| «Crie um card de partilha com gradiente escuro, título: Novidades de Julho 🚀» | Um card de partilha impecável (chinês + emoji automáticos) |
| «Reconheça a tabela nesta captura de fatura» | Uma tabela HTML/Markdown colável (novo em 0.11.0) |
| «Leia este gráfico de barras como pontos de dados» | Dados estruturados em CSV/JSON (novo em 0.11.0) |
| «Descreva o que está nesta imagem» | Uma resposta em linguagem natural (novo em 0.11.0) |

> Não é preciso aprender nomes de ferramentas nem instalar dependências de sistema — **o Claude escolhe automaticamente a melhor forma de fazer.**

---

## Comece em 60 segundos

Ideia central: **desenho / cards / QR codes / fórmulas são motores locais, e o reconhecimento de imagem (OCR) também tem fallback dentro do processo por padrão — tudo sem chamar IA, sem internet, funciona assim que instala.** Só imagens/vídeos fotorrealistas por IA precisam de uma API Key gratuita — antecipamos «a primeira imagem» e «a primeira leitura» para antes do registo.

### 30 segundos | Integrar numa linha (sem Key)

```bash
# Instalar numa linha (sem Key, 30 segundos)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Reinicie o Claude Code → digite /mcp → veja media-gen-mcp ✓ Connected = sucesso
```

### 30 segundos | Primeira imagem sem Key, já

Basta dizer ao Claude:

```
Crie um card de partilha tech com fundo escuro, título: Canivete suíço de imagens do Claude Code
```

→ A imagem vetorial é guardada automaticamente em `output/`, pronta a usar. **Ainda não registou nenhuma API Key e já tem o resultado na mão.**

Estes também saem num instante, sem Key e sem internet:

- «Faça um QR code a apontar para github.com»
- «Renderize E=mc² como fórmula em alta resolução»
- «Desenhe um diagrama de arquitetura: cliente → gateway → serviço de pedidos + serviço de pagamentos → base de dados, estilo tech escuro»
- «Reconheça os números nesta imagem de captcha» (OCR, dentro do processo por padrão, sem instalar nada)
- «Extraia o texto inglês desta captura de ecrã»

### Quer imagens/vídeos fotorrealistas por IA? Adicione uma API Key gratuita (opcional)

```bash
# ① Obtenha uma API Key gratuita (recomendado: Agnes, provedor padrão)
#    https://platform.agnes-ai.com/ → registar → API Keys → copiar sk-xxx
#    (Zhipu cogview-3-flash / cogvideox-flash também é gratuito para sempre — pode usar um ou ambos)

# ② Escreva em ~/.media-gen-mcp/config.json (funciona com apenas um provedor)
{
  "providers": {
    "agnes": { "apiKey": "sk-seu-agnes-key" }
  }
}

# ③ Volte ao Claude Code e diga: "Desenhe um gato laranja cyberpunk, estilo realista"
#    → A imagem fotorrealista por IA é guardada. Vídeos igual: "Gere um vídeo de 5 segundos de pôr do sol na praia"
```

> Não quer usar npx? Instale globalmente: primeiro `npm i -g media-gen-mcp-server`, depois `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

---

## O canivete suíço de capacidades

> Diga simplesmente ao Claude o que quer fazer — ele escolhe automaticamente o melhor caminho. Abaixo está agrupado por «o que quer fazer»; não precisa de saber os nomes por trás.

### Criar uma imagem (do zero)

**Desenhar uma foto fotorrealista ou ilustração**
> Você: «Desenhe um gato laranja cyberpunk com brilho neon, estilo fotorrealista»
> Recebe: imagem fotorrealista guardada em `output/` (também suporta ilustrações / conceitos de produto / rascunhos de Logo / cenários sci-fi)

**Transformar uma frase ou imagem num vídeo curto**
> Você: «Gere um vídeo de 5 segundos de pôr do sol na praia»
> Recebe: vídeo MP4 (3–18 segundos; vídeos longos são gerados em background e é notificado quando pode levá-los)

**Capturar um ícone ou Logo de marca**
> Você: «Capture o Logo do GitHub, 128 píxeis»
> Recebe: Logo vetorial de uma biblioteca com mais de 200 mil ícones, pronto a usar (GitHub / Twitter / Material / Lucide / Font Awesome, etc.)

### Entender uma imagem (transformar imagem em dados · novo em 0.11.0)

**Extrair texto de uma captura de ecrã**
> Você: «Leia os números deste captcha»
> Recebe: texto puro (captchas / números de fatura / documentos digitalizados / históricos de chat — tudo se extrai)

**Transformar imagem de tabela em HTML / Markdown**
> Você: «Reconheça a tabela nesta captura de fatura»
> Recebe: tabela Markdown diretamente colável (faturas / relatórios / digitalizações sem reescrever à mão)

**Reconstruir dados originais a partir de um gráfico**
> Você: «Leia este gráfico de barras como dados»
> Recebe: dados estruturados em CSV / JSON (barras / linhas / pizza, todos funcionam)

**Pedir para explicar a imagem em linguagem simples**
> Você: «Quantas pessoas há nesta imagem? O que estão a fazer?»
> Recebe: resposta em linguagem natural (QA visual / manuscrito / fórmula / compreensão de cenários complexos)

### Desenhar ideias com clareza (sem Key, funciona ao instalar)

**Desenhar diagramas estruturados**
> Você: «Desenhe um diagrama de arquitetura: cliente → API gateway → serviço de pedidos + serviço de pagamentos → base de dados»
> Recebe: diagrama de arquitetura vetorial (também suporta fluxogramas / diagramas de sequência / diagramas de classes / diagramas ER / mapas mentais)

**Transformar dados em gráficos**
> Você: «Transforme estes dados de vendas num gráfico de barras»
> Recebe: gráfico de dados em alta resolução (barras / linhas / pizza / área / dispersão — dê números soltos ou um CSV)

### Criar cards / cartazes / QR codes (bonitos para partilhar)

**Fazer cards de partilha / OG / cards de citação / capas / cartazes**
> Você: «Crie um card de partilha com gradiente escuro, título: Novidades de Julho 🚀»
> Recebe: card lindamente composto (título, subtítulo, gradientes, brilho, emoji colorido, Logo embutido — tudo automático; chinês e kanji japonês sem caracteres partidos)

**Gerar QR code**
> Você: «Faça um QR code a apontar para github.com»
> Recebe: QR code vetorial (URL ou texto, nítido mesmo em impressão de cartaz)

**Renderizar fórmulas matemáticas em alta resolução**
> Você: «Renderize E=mc² como fórmula em alta resolução»
> Recebe: fórmula vetorial (LaTeX, frações complexas, equações químicas — tudo suportado)

### Criar efeitos visuais radicais / gráficos tech (mesma entrada, sempre mesma saída)

**Renderizar SVG em PNG em alta resolução**
> Você: «Desenhe um fundo tech com brilho, campo de estrelas e profundidade»
> Recebe: PNG radical, com o melhor método de renderização escolhido automaticamente para preservar fidelidade

**Transformar animação HTML / CSS num vídeo**
> Você: «Crie uma animação de abertura de 3 segundos para o produto, gradiente + partículas»
> Recebe: vídeo MP4 / GIF / WebM (aberturas de produto / animações de marca / demos de efeitos — renderização frame a frame, mesma entrada produz sempre a mesma saída)

> **Dica rápida**: geração / leitura de imagem usa IA online; desenho / cards / QR codes / animações são motores locais — **funcionam ao instalar, vetoriais em alta resolução, mesma entrada produz sempre a mesma imagem**.

---

## Mergulho na configuração

> Numa frase: **capacidades estruturadas (desenho / gráficos / cards / QR codes / fórmulas) são zero config e prontas a usar; geração por IA precisa de uma linha com API Key; reconhecimento é zero config por padrão, e só auto-hospeda para OCR chinês SOTA / tabelas / gráficos.** O que vai usar determina o que configura — não precisa de configurar tudo.

### Procure a configuração por «o que quero fazer»

| O que quer fazer | O que configurar | Pronto a usar depois de |
|---|---|---|
| Desenhar arquiteturas / gráficos de dados / cards / QR codes / fórmulas | **Nada** | Motor local, instala e usa |
| Imagens / vídeos fotorrealistas por IA (texto-para-imagem, texto-para-vídeo) | Uma API Key gratuita (Agnes ou Zhipu, uma das duas) | Geração online, guardada em `output/` |
| OCR de texto (inglês / captcha / números / documentos simples) | **Nada** | Motor leve dentro do processo por padrão, instala e usa |
| OCR chinês / tabelas de faturas / leitura de gráficos / QA visual / manuscrito / fórmulas | Auto-hospedar motor de compreensão (PaddleX ou vLLM, ver recursos abaixo) | Preencher uma linha de baseUrl depois de o serviço auto-hospedado estar a correr |

---

### 1. Configuração de geração (IA imagens / vídeos)

**Provedor padrão: Agnes** (nível gratuito permanente, texto-para-imagem + texto-para-vídeo totalmente abertos). Zhipu como alternativa (otimização nativa para cenários em chinês).

**Um já chega** (abaixo está o `config.json` completo, funciona com apenas um provedor):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-seu-agnes-key" },
    "zhipu": { "apiKey": "seu-zhipu-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/caminho/absoluto/para/output"
}
```

**Como obter API Key gratuita**:

- **Agnes** (recomendado, padrão): https://platform.agnes-ai.com/ → registar → API Keys → copiar `sk-xxx`
- **Zhipu**: https://open.bigmodel.cn/ → registar → API Keys (modelos gratuitos: `cogview-3-flash` / `cogvideox-flash`, gratuitos para sempre)

**Configurar os dois é mais robusto**: se um cair temporariamente (rate limit / instabilidade), o outro assume automaticamente — sem que você dê por isso, sem cobrança duplicada.

**Localização do ficheiro de configuração**: `~/.media-gen-mcp/config.json` (macOS / Linux) ou `%USERPROFILE%\.media-gen-mcp\config.json` (Windows).

> Este ficheiro **pode não existir, nada rebenta** — as capacidades estruturadas e o OCR padrão continuam a funcionar, apenas não dá para chamar a geração por IA.

---

### 2. Configuração de reconhecimento (imagem / OCR / tabela / gráfico / compreensão visual)

As capacidades de reconhecimento vêm em **três níveis** — escolha conforme a necessidade, o primeiro já funciona por padrão.

#### Nível 1: Motor leve padrão (zero config, funciona ao instalar)

- **O que faz**: OCR em inglês / números / captchas / documentos simples
- **Precisa de serviço**: **Não**, é empacotado no processo MCP como WASM e carrega o modelo de linguagem na primeira invocação
- **Recursos mínimos**:
  - CPU: qualquer um (pura CPU, sem dependência de GPU)
  - GPU: não é precisa
  - Memória: ~200–500 MB (varia com o tamanho da imagem)
  - Disco: ~30–50 MB (motor WASM + pacote de idioma)
  - Tamanho do modelo: incluído no disco acima (pacote de inglês, na casa dos MB)
- **Velocidade**: ~3–5 segundos por imagem
- **Para quem**: 90% dos cenários leves de OCR, documentos internacionais, reconhecimento de captchas

> A maioria dos utilizadores fica por aqui. Os dois níveis seguintes são melhorias opcionais.

#### Nível 2: PaddleX / PP-StructureV3 (chinês SOTA + reconhecimento de tabelas)

- **O que faz**: OCR em chinês (qualidade significativamente superior ao motor padrão), análise de layout, **faturas / relatórios / digitalizações → tabelas HTML/Markdown**, leitura de gráficos
- **Precisa de serviço**: **Sim**, auto-hospedar um serviço REST PaddleX; o MCP chama-o via `baseUrl`
- **Recursos mínimos** (testados na prática):

  | Modo | Requisito mínimo | Recomendado | Notas |
  |---|---|---|---|
  | Modo GPU | RTX 3060 12GB VRAM | RTX 3060 12GB / Tesla T4 | Modelo carrega ~2,4GB, pico em PDFs complexos chega a ~6GB |
  | Modo CPU | 4 núcleos CPU + 8GB RAM | 8 núcleos + 16GB RAM | Funciona (ok para documentos leves); em lote / PDFs complexos fica 3–5× mais lento |
  | Disco | ~3GB | ~5GB | paddlepaddle + paddlex + pesos do modelo |
  | Tamanho do modelo | ~100–300MB (por pipeline) | — | Acumula por pipeline |

- **Requisito CUDA**: Compute Capability ≥ 7.0 (V100 / T4 / RTX série 20/30/40; a série 50 ainda não é totalmente suportada), exige CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 para aceleração GPU
- **Como instalar**:

  ```bash
  pip install paddlex paddlepaddle          # versão GPU: paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  Depois adicione uma linha ao `config.json`:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### Nível 3: vLLM + Qwen2.5-VL (VLM de compreensão visual geral)

- **O que faz**: QA visual, reconhecimento de manuscrito, reconhecimento de fórmulas, descrição em linguagem natural de cenários complexos — as tarefas de «compreensão» que o PaddleX não cobre
- **Precisa de serviço**: **Sim**, auto-hospede um serviço de inferência vLLM
- **Recursos mínimos** (testados na prática):

  | Modo | Requisito mínimo | Recomendado | Notas |
  |---|---|---|---|
  | GPU 7B precisão total (FP16) | 16GB VRAM | **24GB VRAM** (RTX 3090 / 4090 / A5000) | Pesos do modelo ~15–16GB + KV cache; vLLM ocupa 90% da VRAM por padrão |
  | GPU 7B quantizado (INT8/AWQ) | 10–12GB VRAM | 16GB VRAM | Versão quantizada cabe numa RTX 4080 / 4060 Ti 16GB |
  | GPU versão leve 3B | 6–8GB VRAM | GTX 1660 / 3060 6–8GB | FP16 ~6–8GB, INT4 ~3–4GB — ponto sweet para devs independentes |
  | Modo CPU | Não recomendado | — | Corre mas 5–10× mais lento; em produção, use GPU |
  | Memória | 16GB | 16–32GB | — |
  | Disco | ~14GB (pesos 7B) | — | 3B ~6GB |
  | Requisito CUDA | Compute Capability ≥ 7.0 | — | A partir do Tesla T4 (7.5); V100 / A100 / RTX série 30/40 funcionam |

- **Como instalar**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # Quando vir "Uvicorn running on http://0.0.0.0:8000", está pronto
  ```
  Mais parâmetros (seleção de GPU / versão quantizada / limites de concorrência) na [documentação oficial do vLLM](https://docs.vllm.ai). Depois adicione ao `config.json`:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

#### Comparação rápida dos três níveis

| Nível | Instala serviço? | Barreira de recursos | Chinês | Tabela | QA visual | License |
|---|---|---|---|---|---|---|
| **Padrão** (tesseract) | Não | Zero (WASM em CPU) | Razoável | ❌ | ❌ | Apache 2.0 |
| **PaddleX** | Sim | GPU 12GB ou CPU 4 núcleos 8GB | ✅ SOTA | ✅ | ❌ | Apache 2.0 |
| **vLLM Qwen2.5-VL** | Sim | **GPU 16–24GB** (CPU indisponível) | ✅ | Razoável | ✅ | Apache 2.0 |

> O lado do reconhecimento escolhe deliberadamente só motores Apache 2.0 (tesseract.js + PaddleOCR + Qwen2.5-VL), evitando armadilhas AGPL / GPL / de aprovação comercial — **as empresas podem usar comercialmente sem preocupações**.

---

### 3. Mecanismo de fallback automático (configure e esqueça)

- **Lado da geração**: Agnes ↔ Zhipu; se um falha, o outro assume automaticamente (falhas consecutivas durante 60 segundos acionam a troca suave — sem reiniciar, sem mexer na configuração)
- **Lado do reconhecimento**: motor leve padrão (fallback dentro do processo) → PaddleX → vLLM, com degradação automática por capacidade
- **Única exceção**: ao fazer polling de vídeo para recolher o clipe **não há troca** (evita receber resultados errados)
- O que você faz: configurar duas API Keys de geração + opcionalmente um serviço de reconhecimento, e o resto deixar ao Claude

> A sua máquina não aguenta PaddleX ou vLLM? **Continue a usar o motor leve padrão** — o MCP não se queixa por falta de serviço local; apenas chinês SOTA / tabelas / QA visual ficam indisponíveis, tudo o resto funciona normalmente.

---

## FAQ

**P: Funciona sem instalar nada?**
R: Sim. Ao instalar o MCP já tem desenho / cards / QR codes / fórmulas / gráficos de dados + OCR inglês / captcha, tudo a correr localmente, sem internet.

**P: OCR tem caracteres partidos em chinês?**
R: O motor leve padrão dá conta de inglês / números / documentos simples, mas a precisão em chinês é apenas razoável. Para chinês SOTA, auto-hospede PaddleX (GPU 12GB ou CPU 4 núcleos + 8GB); veja o [Mergulho na configuração](#mergulho-na-configuração) acima.

**P: Quanto tempo demora um vídeo por IA?**
R: Um vídeo de 5 segundos demora ~1–3 minutos; um de 18 segundos pode demorar 5–10 minutos. Geração assíncrona em background, com notificação automática quando termina; previsões ≤60 segundos ficam síncronas à espera.

**P: A minha RTX 3060 aguenta o reconhecimento de tabelas?**
R: Aguenta. PaddleX em modo GPU exige no mínimo 12GB VRAM (RTX 3060 12GB encaixa); em modo CPU, 4 núcleos + 8GB RAM também corre (3–5× mais lento). Veja [Mergulho na configuração](#mergulho-na-configuração).

**P: Chinês / emoji / gradientes saem bem?**
R: Sim. Os cards de partilha usam fonte chinesa embutida + motor de composição, com suporte automático para chinês, kanji japonês, emoji colorido, títulos em gradiente e efeitos de brilho — sem configurar fontes extra.

**P: Suporta Mermaid?**
R: Não (precisaria de navegador). Use D2 ou Graphviz no lugar, capacidade equivalente e mais estável, com saída vetorial.

**P: Atingi o rate limit (429)?**
R: O nível gratuito tem limite de pedidos por minuto. Depois de configurar dois provedores (Agnes + Zhipu), a troca é automática e praticamente imperceptível.

**P: Limite de frames de vídeo?**
R: Diminui com a resolução — 1080p ≤ 241 frames (~10 segundos), 720p pode chegar a 441 frames (~18 segundos). Pode pedir ao Claude para verificar as restrições em tempo real.

**P: npx não liga / arranca devagar?**
R: Instale globalmente: primeiro `npm i -g media-gen-mcp-server`, depois `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

**P: Posso usar temas com palavras sensíveis / armas / guerra?**
R: Palavras reais de armas disparam o filtro de conteúdo. Use termos de configuração sci-fi (como «armadura futurista», «mecha») para contornar, com efeito equivalente.

---

## Para quem é isto

- **Utilizadores intensivos do Claude Code** — fazem tarefas de imagem várias vezes por semana e não querem instalar um MCP diferente para cada uma, com conjuntos de parâmetros próprios.
- **Devs que escrevem documentação técnica / blogs** — precisam repetidamente de diagramas de arquitetura, sequência, ER, gráficos de dados e fórmulas sem sair do fluxo de trabalho.
- **Devs independentes / produtos solo** — atentos ao custo (tudo gratuito) e à previsibilidade (mesma entrada, mesma saída), sem querer montar backend só para tarefas de imagem.
- **Dados / finanças / jurídico** — cenários nos dois sentidos: transformar dados em gráficos e, a partir de capturas / faturas, extrair pontos de dados de volta.
- **Marketing / criadores de conteúdo / autores de blogues** — cards de partilha / OG / cartazes / QR codes, com chinês + emoji colorido + gradiente prontos a usar.

> **Não é tão adequado para**: quem não usa Claude Code; equipas de engenharia que precisam de uma só capacidade e já têm pipeline montado; cenários que exigem modelos comerciais pagos / fine-tuning / OCR de vídeo em tempo real (estes ultrapassam o âmbito de um MCP gratuito).

---

## 💝 Apoie o Autor

Se o media-gen-mcp te ajuda, oferece um café ao autor ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Ou ⭐ [Star](../../stargazers) / [Issue](../../issues) / [PR](../../pulls) — qualquer forma de apoio é bem-vinda.

---

## License

**MIT** — o código principal pode ser usado livremente.

O lado do reconhecimento apoia-se numa stack inteira **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL), sem risco de licença para uso comercial empresarial.

---

> Detalhes técnicos: provedores e motores são plugáveis, as ferramentas estruturadas produzem a mesma saída para a mesma entrada (podem ir para o git), e em caso de falha o provedor é trocado automaticamente. Contribuidores: ver `CONTRIBUTING.md`; documentação completa: diretório `docs/`.

<p align="center">
  <sub>Feito para todos que preferem <strong>dizer</strong> a <strong>programar</strong>.</sub><br>
  <sub>Instale uma vez, e a partir daí qualquer tarefa de imagem é uma única frase.</sub>
</p>
