<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtenir-une-clé-gratuite)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#licence)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Un serveur MCP multimodal de génération d'images pour Claude Code**

Imagerie IA + imagerie structurée, un seul serveur couvre tout : texte-vers-image / image-vers-image / texte-vers-vidéo / image-vers-vidéo / animation par images-clés (via Agnes AI + modèles gratuits Zhipu) **+ diagrammes / graphiques de données / codes QR** (rendu local déterministe, sans clé nécessaire)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① Obtenir une clé gratuite

Inscrivez-vous sur l'une (ou les deux) plateformes ci-dessous pour obtenir une clé API gratuite :

| Provider | Gratuit | Inscription |
|---|---|---|
| **Agnes AI** (par défaut) | Toutes les images et vidéos gratuites | https://platform.agnes-ai.com/ → s'inscrire → API Keys |
| **Zhipu BigModel** (facultatif, 4K / chinois) | Images cogview-3-flash + vidéos cogvideox-flash gratuites à vie | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → vérifier → créer une clé |

> Étapes détaillées : [doc/Agnes onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu onboarding](doc/Zhipu%20开通指引.md)

## ② Configurer (une seule fois)

Créez `~/.media-gen-mcp/config.json` avec votre clé :

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Agnes seul suffit (supprimez la ligne zhipu). Omettez `models` pour utiliser les valeurs par défaut intégrées.

## ③ Ajouter à Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

La commande d'installation ne contient **aucune clé** (elle se trouve dans la config ci-dessus). Lancez `/mcp` — `media-gen-mcp ✓ Connected` indique que tout fonctionne.

## ④ Utilisation

Exprimez-vous simplement dans Claude Code (routage automatique vers le bon provider/modèle) :

| Scénario | Dites | Résultat |
|---|---|---|
| **Par défaut** | « Génère une image photoréaliste de chat » / « Génère une vidéo de plage de 5 s » | Utilise defaultImageProvider / defaultVideoProvider |
| **Provider spécifique** | « Utilise **Zhipu** pour dessiner » / « Utilise **agnes** pour la vidéo » | Bascule le provider temporairement, sans modifier la config |
| **Modèle spécifique** | « Utilise **cogview-4** pour dessiner » / « Utilise **agnes-video-v2.0** » | Sélectionne un modèle spécifique (meilleure qualité, etc.) |
| **Provider + modèle** | « Utilise **Zhipu cogvideox-3** pour une vidéo 4K » | Spécification exacte (4K / première-dernière image) |
| **Image-vers-image** | « Transforme cette image en aquarelle » | Image de référence → nouvelle image |
| **Image-vers-vidéo** | « Transforme cette image en vidéo » | Image unique → vidéo |
| **Images-clés** | « Fais une transition fluide entre ces deux images » | Plusieurs images → transition fluide |

> Omettre les spécifications → utilise les valeurs par défaut ; indiquer un provider/modèle n'affecte que cet appel, **et non votre config**.

## ④ Imagerie structurée locale (sans clé, déterministe)

Ces outils **n'appellent aucune IA**¹ — Claude génère un DSL/JSON/LaTeX/fields → rendu localement en SVG/PNG (vectoriel, haute résolution) :

| Outil | Dire | Sortie |
|---|---|---|
| **Diagrammes** `generate_diagram` | « Dessine une architecture : client → API gateway → deux microservices » | Architecture / séquence / organigramme / classes / ER / carte mentale (D2 DSL → SVG) |
| **Graphiques** `generate_chart` | « Fais un graphique en barres de ces données de ventes » | Barres / lignes / camembert / aire / dispersion (Vega-Lite → SVG) |
| **Formules** `generate_formula` | « Rends cette formule : `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}` » | LaTeX → SVG (MathJax, glyphes intégrés, aucune police requise) |
| **Cartes** `generate_card` | « Fais une carte de partage OG pour cet article » | Cartes OG / sociales / de citation (Satori → PNG, 1200×630 par défaut, **CJK pris en charge automatiquement**) |
| **Icônes** `generate_icon` | « Donne-moi une icône du logo GitHub » | Plus de 200 k icônes à la demande (Iconify, `prefix:name`) |
| **Codes QR** `generate_qrcode` | « Génère un code QR pour https://... » | SVG / PNG (purement local, zéro réseau) |

> ¹ Tout local et déterministe, sauf les **icônes** (API Iconify) et la **police par défaut de la carte** (récupérée depuis le CDN à la première utilisation, mise en cache dans `~/.media-gen-mcp/fonts/`) ; passez `fontPath` pour rendre la carte totalement hors-ligne. **CJK des cartes** : Noto Sans SC intégré (hors-ligne, détection automatique du chinois/japonais/coréen comme repli) — fontPath inutile. Les diagrammes utilisent la [syntaxe D2](https://d2lang.com), les graphiques [Vega-Lite](https://vega.github.io/vega-lite), les formules [LaTeX](https://www.latex-project.org), les icônes sur [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude génère la source automatiquement.

## Providers

| | Par défaut | Image (gratuit) | Vidéo (gratuit) | Point fort |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Tout gratuit, photoréaliste, audio natif |
| **zhipu** (facultatif) | | cogview-3-flash | cogvideox-flash | 4K/60 i/s, chinois natif, conforme Chine |

Changement : `defaultProvider: "zhipu"`, ou par modalité via `defaultImageProvider`/`defaultVideoProvider`, ou passez `provider` à chaque appel. Vous hésitez ? Voir le [benchmark](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (avancé, généralement inutile)

**Repli du provider sur trois niveaux** (argument par appel > par modalité > global) :

| Champ | Valeur par défaut | Description |
|---|---|---|
| `defaultProvider` | `agnes` | Valeur par défaut globale (repli final quand aucune modalité n'est définie) |
| `defaultImageProvider` | identique à `defaultProvider` | Valeur par défaut pour les images (utilisé par `generate_image`) |
| `defaultVideoProvider` | identique à `defaultProvider` | Valeur par défaut pour les vidéos (utilisé par `create_video` / `get_video`) |

Par ex. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → images via agnes, vidéos via Zhipu. Omettez les deux derniers champs pour revenir à `defaultProvider` pour tout.

Configuration de connexion par provider :

| Champ | Valeur par défaut | Description |
|---|---|---|
| `providers.<name>.apiKey` | — | **obligatoire**, une par provider |
| `providers.<name>.models.image.default` | intégré au provider | modèle d'image par défaut |
| `providers.<name>.models.video.default` | intégré au provider | modèle de vidéo par défaut |
| `outDir` | session-dir/output | dossier de sortie (modifiable par appel) |

> Auto-apprentissage des limites de débit (rateLimits / rateLimitTtlMs) et autres champs avancés — voir [doc/](doc/).

## FAQ

**Vidéos lentes ?** 3 à 18 s, environ 1 à 3 min. Omettre `wait` la rend asynchrone avec notification de fin.
**Nombre d'images ?** Passez `durationSeconds` pour choisir automatiquement (5/10/18 s). Agnes n'autorise que 81/121/161/241/441.
**Erreur 429 ?** Sérialiseur de 62 s intégré ; apprend automatiquement la vraie limite de débit.
**Config non prise en compte ?** Elle doit se trouver à `~/.media-gen-mcp/config.json` (npx s'installe dans le cache ; une config placée dans le projet n'est pas accessible).

## Architecture + Docs

Architecture à providers enfichables (agnes + zhipu ; ajouter un provider ne nécessite aucune modification de la couche d'outils). Plus de détails dans [doc/](doc/) :

- [doc/Agnes onboarding](doc/Agnes%20开通指引.md) · [doc/Zhipu onboarding](doc/Zhipu%20开通指引.md) · [doc/Agnes vs Zhipu benchmark](doc/Agnes_vs_Zhipu_横评.md)

## 💝 Soutenir l'auteur

Si media-gen-mcp vous est utile, offrez un café à l'auteur ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Ou ⭐ Star, ouvrez une Issue / PR — toute contribution est appréciée.

## Licence

[MIT](LICENSE)