<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtenir-une-clé-gratuite)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#licence)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Le MCP tout-en-un de génération d'images pour Claude Code — imagerie IA + dessin structuré local, en un seul serveur**

Texte-vers-image / image-vers-image / texte-vers-vidéo / image-vers-vidéo / animation par images-clés · diagrammes / graphiques / formules / cartes / icônes / codes QR

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Points forts

- 🎨 **Imagerie IA, entièrement gratuite** : texte-vers-image, image-vers-image, texte-vers-vidéo, image-vers-vidéo, animation par images-clés — via les modèles gratuits d'**Agnes AI + Zhipu**, sans frais.
- 📐 **Dessin structuré local, déterministe** : diagrammes, graphiques, formules, cartes, icônes, codes QR — **SVG vectoriel haute résolution**, sans appel IA, zoom infini, texte net, entièrement contrôlable.
- 🧠 **Un seul modèle mental** : dites simplement « génère une image » — Claude route automatiquement vers l'IA ou un moteur local et génère le DSL/JSON/LaTeX correspondant. **Zéro étape supplémentaire** pour l'utilisateur.
- 🌏 **Soigné dès la sortie** : les cartes **prennent en charge automatiquement le CJK** (Noto Sans SC intégré, hors ligne), les **fonds unis/dégradés** et les **emojis en couleur** ; les diagrammes prennent en charge **à la fois D2 et Graphviz**.
- 🔌 **Branchable** : les fournisseurs et les moteurs de rendu sont tous deux extensibles sans aucune modification de la couche d'outils ; routage par défaut par modalité + auto-apprentissage des limites de débit.
- 🆓 **Les outils structurés ne nécessitent aucune clé** : après `claude mcp add`, les 6 outils locaux fonctionnent immédiatement — **dessinez des diagrammes/graphiques/cartes/codes QR sans aucune clé IA**.
- 🌐 README en 8 langues · MIT · Node ≥18

---

## 🛠️ Les 10 outils

### 🤖 Génération IA (en ligne · gratuit)

| Outil | Capacité |
|---|---|
| `generate_image` | **texte-vers-image** / **image-vers-image** (référence → nouveau) |
| `create_video` | **texte-vers-vidéo** / **image-vers-vidéo** / **animation par images-clés** (sync/async intelligent) |
| `get_video` | surveiller + télécharger une tâche vidéo |
| `list_models` | lister les modèles par fournisseur et les contraintes vidéo |

### 📐 Rendu structuré (local · déterministe · généralement sans clé)

| Outil | Sortie | Moteur |
|---|---|---|
| `generate_diagram` | architecture / séquence / organigramme / classe / ER / carte heuristique | DSL **D2** · **Graphviz** (DOT) |
| `generate_chart` | barres / lignes / camembert / aires / nuage de points | Vega-Lite |
| `generate_formula` | formules mathématiques LaTeX (glyphes intégrés, aucune police requise) | MathJax |
| `generate_card` | cartes OG / de partage / de citation (défaut 1200×630 ; modèles og/quote/minimal/hero/panel ; CJK/fond dégradé/emoji couleur auto, titre en dégradé + glow) | Satori + resvg |
| `generate_icon` | plus de 200k icônes vectorielles (`prefix:name`) | Iconify |
| `generate_qrcode` | codes QR | qrcode |

> Parmi les 6 outils structurés, **4 sont entièrement hors ligne** (diagram / chart / formula / qrcode). La police Latine par défaut de `generate_card` est récupérée une fois depuis le CDN et mise en cache dans `~/.media-gen-mcp/fonts/` (hors ligne ensuite, ou passez `fontPath` pour être hors ligne immédiatement) ; la police CJK (Noto Sans SC) est **intégrée hors ligne**. Cependant, les **emojis** de la carte (twemoji) et `generate_icon` (Iconify) nécessitent le réseau (mis en cache seulement, non intégrés). Les outils de génération IA sont toujours en ligne.

---

## 🚀 Démarrage rapide

### ① Obtenir une clé gratuite (uniquement pour la génération IA ; à ignorer si vous dessinez uniquement des images structurées)

Inscrivez-vous sur l'un (ou les deux) des sites ci-dessous pour obtenir une clé API gratuite :

| Fournisseur | Gratuit | Demande |
|---|---|---|
| **Agnes AI** (défaut) | Toutes les images + vidéos gratuites | https://platform.agnes-ai.com/ → s'inscrire → API Keys |
| **Zhipu BigModel** (optionnel, 4K / chinois) | image cogview-3-flash + vidéo cogvideox-flash gratuites à vie | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → vérifier → créer une clé |

> Étapes détaillées : [inscription Agnes](doc/Agnes%20开通指引.md) · [inscription Zhipu](doc/Zhipu%20开通指引.md)

### ② Configurer (une fois)

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

### ③ Ajouter à Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

La commande d'installation **ne porte aucune clé** (elle figure dans la configuration ci-dessus). Lancez `/mcp` — `media-gen-mcp ✓ Connected` signifie que la connexion a réussi.

---

## 💬 Mode d'emploi

Exprimez-vous simplement dans Claude Code — **routage automatique**, nul besoin de mémoriser les noms d'outils :

**Génération IA :**

| Scénario | Dites |
|---|---|
| Par défaut | « Génère un chat orange photoréaliste » / « Génère une vidéo de plage de 5 s » |
| Fournisseur spécifique | « Utilise **Zhipu** pour dessiner » / « Utilise **agnes** pour la vidéo » |
| Modèle spécifique | « Utilise **cogview-4** pour dessiner » / « Utilise **agnes-video-v2.0** » |
| Image-vers-image / -vidéo | « Transforme cette image en aquarelle » / « Transforme cette image en vidéo » |
| Animation par images-clés | « Fais une transition fluide entre ces deux images » |

**Dessin structuré :**

| Scénario | Dites |
|---|---|
| Diagramme | « Dessine une architecture : client → passerelle API → deux microservices » (D2) ou « Dessine un graphe de dépendances en DOT » (Graphviz) |
| Graphique | « Fais un graphique en barres de ces données de ventes » |
| Formule | « Rends cette formule : `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}` » |
| Carte de partage | « Fais une carte OG **à dégradé violet-bleu** avec un emoji 🚀 pour cet article » |
| Icône | « Donne-moi une icône de logo GitHub » |
| Code QR | « Génère un code QR pour https://... » |

> Spécifier un fournisseur/modèle n'affecte que cet appel, **pas votre configuration**. Les diagrammes utilisent la [syntaxe D2](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/), les graphiques [Vega-Lite](https://vega.github.io/vega-lite), les formules [LaTeX](https://www.latex-project.org), les icônes sur [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude génère le code source automatiquement.

> **Mermaid** : `generate_diagram` prend en charge **D2 et Graphviz** ; le rendu in-process de Mermaid nécessite un navigateur/Chromium (inadapté à un MCP déterministe), il n'est donc pas pris en charge — utilisez D2 (couvre organigramme/séquence/classe/ER/carte heuristique) ou Graphviz à la place.

---

## 📡 Fournisseurs

| | Défaut | Image (gratuit) | Vidéo (gratuit) | Atout |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Tout gratuit, photoréaliste, audio natif |
| **zhipu** (optionnel) | | cogview-3-flash | cogvideox-flash | 4K/60 fps, chinois natif, conforme Chine |

Basculez : `defaultProvider: "zhipu"`, ou par modalité via `defaultImageProvider`/`defaultVideoProvider`, ou passez `provider` à chaque appel. Vous hésitez ? Consultez le [comparatif](doc/Agnes_vs_Zhipu_横评.md).

---

## ⚙️ Config (avancé, généralement inutile)

**Secours fournisseur à trois niveaux** (argument par appel > par modalité > global) :

| Champ | Défaut | Description |
|---|---|---|
| `defaultProvider` | `agnes` | Défaut global (secours final) |
| `defaultImageProvider` | idem | Défaut modalité image (`generate_image`) |
| `defaultVideoProvider` | idem | Défaut modalité vidéo (`create_video`/`get_video`) |

Ex. `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → images via agnes, vidéo via Zhipu.

Configuration de connexion par fournisseur : `providers.<name>.apiKey` (requis), `providers.<name>.models.{image,video}.default`, `outDir` (répertoire de sortie, défaut `session-dir/output`).

> Auto-apprentissage des limites de débit (rateLimits / rateLimitTtlMs — le 429 apprend automatiquement la limite réelle + secours par expiration TTL) et autres champs avancés — voir [doc/](doc/).

---

## ❓ FAQ

**Vidéos lentes ?** 3–18 s, environ 1–3 min. Omettre `wait` la rend asynchrone (est. >60 s renvoie un identifiant, avec notification à l'achèvement).
**Nombre d'images ?** Passez `durationSeconds` pour choisir automatiquement (5/10/18 s). Agnes n'autorise que 81/121/161/241/441.
**Erreur 429 ?** Sérialiseur de 62 s intégré ; apprend automatiquement la vraie limite de débit.
**Les outils structurés nécessitent-ils une clé ?** Non. Les 6 outils locaux fonctionnent immédiatement ; seule la génération IA nécessite une clé.
**CJK/emoji/dégradé sur les cartes ?** Police CJK intégrée (auto), emojis couleur twemoji (auto) ; passez un `linear-gradient(...)` CSS à `bg` pour un dégradé.
**Effets sophistiqués sur les cartes ?** `titleGradient` (titre en dégradé), `glow` (lueur du titre), modèle `hero` (blob de profondeur flouté), modèle `panel` (panneau en verre : border/radius/shadow). Tout déterministe, in-process via Satori — sans navigateur.
**Configuration non lue ?** Doit se trouver à `~/.media-gen-mcp/config.json` (npx s'installe dans le cache ; la configuration dans le projet est indisponible).

---

## 🏗️ Architecture + docs

- **Fournisseurs branchables** (agnes + zhipu ; ajouter un fournisseur ne nécessite aucune modification de la couche d'outils) ; **moteurs branchables** (DiagramEngine fonctionne en parallèle à MediaProvider, sans contamination croisée).
- Plus dans [doc/](doc/) : [inscription Agnes](doc/Agnes%20开通指引.md) · [inscription Zhipu](doc/Zhipu%20开通指引.md) · [comparatif Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Soutien

Si media-gen-mcp vous est utile, envisagez d'offrir un café à l'auteur ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Ou ⭐ Star, ouvrez une Issue / PR — toute contribution est appréciée.

## Licence

[MIT](LICENSE)
