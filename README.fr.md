<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-obtenir-une-clé-gratuite)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#licence)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Donnez à Claude Code un « super-pouvoir de génération visuelle » — générez images / vidéos / graphiques / cartes / QR codes en une seule phrase**

Génération d'images et vidéos par IA (gratuit) + dessin structuré (local, déterministe) + rendu SVG spectaculaire (haute fidélité via Chrome)

[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ Caractéristiques

- 🆓 **Entièrement gratuit** — la génération d'images et vidéos par IA utilise Agnes AI + les modèles gratuits de Zhipu ; le dessin structuré est 100 % local, sans aucun coût
- 🧠 **Zéro apprentissage** — parlez simplement, Claude choisit l'outil, génère le code et produit le visuel automatiquement
- 📐 **Rendu déterministe** — schémas / graphiques / formules / cartes, une même entrée produit toujours la même sortie, le contenu est maîtrisé
- 🇨🇳 **Compatible chinois** — les cartes affichent automatiquement le chinois (polices intégrées) ; les modèles Zhipu sont natifs en chinois
- 🔌 **Rien à installer en plus** — D2 / Graphviz / Vega / MathJax sont tous inclus, pas besoin d'installer d2/dot/matplotlib sur le système
- 🎨 **Rendu spectaculaire** — luminescence feGaussianBlur / dégradés / profondeur de champ, rendu haute fidélité via Chrome automatiquement
- 🌐 Documentation en 8 langues · MIT · Node ≥18

---

## 💬 Que pouvez-vous obtenir ?

Une fois installé, il suffit de **dire une phrase** dans Claude Code pour :

| Vous dites | Vous obtenez |
|---|---|
| « Génère une image réaliste d'un chat orange en style wuxia » | 🖼️ Image réaliste générée par IA |
| « Génère une vidéo de 5 secondes au bord de mer » | 🎬 Courte vidéo générée par IA |
| « Dessine un schéma d'architecture : client → passerelle API → deux microservices » | 📐 Schéma d'architecture vectoriel clair |
| « Trace ces données de ventes en histogramme » | 📊 Graphique de visualisation de données |
| « Affiche cette formule `E=mc^2` » | ➗ Image de formule mathématique en haute résolution |
| « Crée une carte de partage avec dégradé et l'emoji 🚀 » | 🎴 Image OG / partage social (chinois automatique) |
| « Donne-moi un logo GitHub » | 🏷️ Icône vectorielle |
| « Génère un QR code » | ▪️ QR code |
| « Dessine un schéma d'architecture au style tech sombre et spectaculaire, avec luminescence » | ✨ Rendu haute fidélité via Chrome |

> **Tout cela en une seule phrase.** Vous n'avez besoin d'apprendre aucun nom d'outil ni aucun paramètre.

---

## 🚀 Démarrage rapide

### ① Obtenir une clé gratuite

Inscrivez-vous chez l'un (ou les deux) des fournisseurs ci-dessous pour obtenir une clé API gratuite :

| Fournisseur | Gratuit | Inscription |
|---|---|---|
| **Agnes AI** (par défaut) | Texte-vers-image + texte-vers-vidéo entièrement gratuits | https://platform.agnes-ai.com/ → Inscription → API Keys |
| **Zhipu BigModel** (optionnel, 4K / chinois) | cogview-3-flash image + cogvideox-flash vidéo, gratuits à vie | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → Vérification d'identité → Créer une clé |

> Étapes détaillées illustrées : [Guide d'activation Agnes](doc/Agnes%20开通指引.md) · [Guide d'activation Zhipu](doc/Zhipu%20开通指引.md)

### ② Configuration

Créez `~/.media-gen-mcp/config.json` et insérez votre clé :

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-votre-clé-agnes" },
    "zhipu": { "apiKey": "votre-clé-zhipu" }
  }
}
```

Configurer uniquement agnes suffit (supprimez la ligne zhipu). Sans champ `models`, les modèles par défaut intégrés sont utilisés.

### ③ Connecter à Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

La commande de connexion **ne contient pas de clé** (la clé est dans le fichier config ci-dessus). Tapez `/mcp` — si vous voyez `media-gen-mcp ✓ Connected`, c'est réussi.

### ④ Dites une phrase

Dans Claude Code, dites simplement « dessine un schéma d'architecture » ou « génère une image réaliste d'un chat orange » — et voilà.

> **Vous ne dessinez que des schémas / graphiques / cartes / QR codes ?** Aucune clé nécessaire — installez (③) et ça fonctionne.

---

## 📡 Fournisseurs

| | Par défaut | Image (gratuit) | Vidéo (gratuit) | Particularités |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Entièrement gratuit, rendu réaliste, son et image natifs |
| **zhipu** (optionnel) | | cogview-3-flash | cogvideox-flash | 4K/60 fps, natif en chinois, conforme en Chine |

Commutation : `defaultProvider: "zhipu"`, ou par modalité `defaultImageProvider` / `defaultVideoProvider`, ou pour un seul appel via `provider`. Vous ne savez pas lequel choisir ? Voir la [comparaison](doc/Agnes_vs_Zhipu_横评.md).

---

## 🛠️ Détail des capacités

### 🤖 Génération IA (modèles gratuits · en ligne)

Utilisez les modèles gratuits d'Agnes AI ou de Zhipu :
- **Texte-vers-image / Image-vers-image** — réaliste, illustration, concept art
- **Texte-vers-vidéo / Image-vers-vidéo / animation par images-clés** — asynchrone intelligent (génération des longues vidéos en arrière-plan, notification à la fin)
- Spécifier le fournisseur / modèle : « utilise **Zhipu cogview-4** pour dessiner » / « utilise **agnes** pour générer la vidéo »

### 📐 Dessin structuré (local · déterministe · sans clé)

Les capacités suivantes **n'appellent pas l'IA, le rendu est déterministe** (SVG vectoriel en haute résolution) :

| Capacité | Moteur (tous intégrés) | Description |
|---|---|---|
| **Schémas** | D2 + Graphviz | Architecture / flux / séquence / classes / ER / cartes mentales, mise en page automatique |
| **Graphiques de données** | Vega-Lite | Barres / lignes / camembert / aires / nuages de points, généré automatiquement par Claude à partir des données |
| **Formules mathématiques** | MathJax | LaTeX → SVG, glyphes intégrés |
| **Cartes de partage** | Satori | OG / affiches / cartes de citation (chinois + dégradés + emoji + luminescence automatiques) |
| **QR codes** | qrcode | URL / texte → SVG / PNG |
| **Icônes vectorielles** | Iconify | Plus de 200 000 icônes (`icon: "mdi:home"`) |
| **SVG spectaculaire** | Chrome / resvg | SVG écrit à la main (luminescence / filtres / profondeur de champ) → rendu haute fidélité via Chrome |

<details>
<summary>📖 Que peuvent faire les cartes ?</summary>

- 5 modèles : og (hiérarchie alignée à gauche) / quote (citation, guillemets pouvant encadrer à gauche ou à droite) / minimal (épuré) / hero (titre XXL + taches lumineuses) / panel (panneau vitré)
- Texte de titre en dégradé + luminescence + taches lumineuses floues pour la profondeur
- Logo / avatar circulaire intégrés
- Chinois automatique (Noto Sans SC hors ligne) + emoji colorés automatiques (mis en cache sur disque, utilisables hors connexion)
- Dimensions personnalisables (par défaut 1200×630, standard OG)
</details>

<details>
<summary>📖 Qu'est-ce que le rendu SVG spectaculaire ?</summary>

Le moteur D2 ne prend pas en charge les filtres SVG (luminescence feGaussianBlur). Donc quand vous voulez un effet « style tech sombre et spectaculaire, luminescence, profondeur de champ » :
1. Claude écrit le SVG à la main (avec des filtres tels que feGaussianBlur)
2. Appelez l'outil `render_svg`
3. L'outil choisit automatiquement le backend : présence de `<filter>` + Chrome disponible sur le système → Chrome (fidélité des filtres à 100 %) ; sinon → resvg (92 %, léger)
</details>

<details>
<summary>📖 Notes hors ligne (quels outils nécessitent Internet ?)</summary>

- **Totalement hors ligne** : generate_diagram / generate_chart / generate_formula / generate_qrcode
- **Hors ligne après première connexion (mise en cache)** : generate_card (la police Latin par défaut Inter est récupérée depuis un CDN au premier usage puis mise en cache dans `~/.media-gen-mcp/fonts/` ; la police CJK Noto Sans SC est déjà intégrée hors ligne ; les emoji twemoji sont mis en cache sur disque et utilisables hors connexion)
- **Connexion requise** : generate_icon (API Iconify pour récupérer l'icône) ; render_svg lorsqu'il y a des filtres (Chrome nécessaire)
- **Toujours en ligne** : outils de génération IA (generate_image / create_video)
</details>

---

## ❓ FAQ

**Les vidéos sont lentes ?** 3 à 18 s, environ 1 à 3 minutes. Omettez `wait` pour un mode asynchrone automatique (> 60 s renvoie un identifiant, notification à la fin).
**Nombre d'images ?** Passez `durationSeconds` et la sélection est automatique (5/10/18 s). Agnes n'autorise que 81/121/161/241/441.
**Erreur 429 ?** 62 s de sérialisation intégrées + apprentissage automatique du taux limite réel.
**Les outils structurés nécessitent-ils une clé ?** Non. Installez et vous pouvez dessiner schémas / graphiques / cartes / QR codes.
**Chinois / emoji / dégradés sur les cartes ?** Tout est automatique : police CJK intégrée + emoji twemoji (mis en cache sur disque) + fond en dégradé CSS.
**SVG spectaculaire ?** Claude écrit le SVG à la main (avec luminescence feGaussianBlur) → `render_svg` → Chrome, fidélité des filtres à 100 %.
**Mermaid est-il pris en charge ?** Non (nécessite un navigateur). Utilisez D2 à la place (couvre les flux / séquences / classes / ER / cartes mentales).
**Le config n'est pas lu ?** Il doit se trouver dans `~/.media-gen-mcp/config.json`.
**`npx` ne se connecte pas ?** Solution de repli — installation globale :
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ Architecture + Documentation

- **Fournisseurs plug-and-play** (agnes + Zhipu, l'ajout d'un fournisseur ne nécessite aucune modification de la couche d'outils) ; **moteurs plug-and-play** (DiagramEngine et MediaProvider fonctionnent en parallèle, sans interférence)
- [Liste des exigences d'architecture](doc/架构要求清单.md) — spécifications d'architecture du projet (maintenance continue)
- Pour en savoir plus, voir [doc/](doc/) : [Guide d'activation Agnes](doc/Agnes%20开通指引.md) · [Guide d'activation Zhipu](doc/Zhipu%20开通指引.md) · [Comparatif des fournisseurs](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 Soutenir l'auteur

Si media-gen-mcp vous est utile, offrez un café à l'auteur ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Ou ⭐ Star, ouvrez une Issue / PR — ce sont toutes des façons de soutenir l'auteur.

## Licence

[MIT](LICENSE)
