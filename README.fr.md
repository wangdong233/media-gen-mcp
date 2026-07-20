# media-gen-mcp

> Le « couteau suisse de l'image » pour Claude Code — créer des images, donner vie à vos idées, comprendre l'image, en une seule phrase, totalement gratuit.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.11.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Installez-le une fois dans Claude Code, et toutes vos tâches image se font en une phrase.** Designers qui produisent des visuels, développeurs qui dessinent des schémas d'architecture, équipes marketing qui créent des cartes de partage, financiers qui extraient les tableaux de factures — génération d'images / vidéos + reconnaissance + dessin / cartes / QR codes, tout est couvert, **100 % gratuit** (provider gratuit + moteur local, prêt à l'emploi dès l'installation).

Fatigué de produire des images plusieurs fois par semaine et d'installer N outils avec N jeux de paramètres ? Ici, un seul install, et vous confiez tous vos scénarios image à Claude.

简体中文 | English | Deutsch | Español | **Français** | 日本語 | Português | Русский

## Sommaire

- [Vous dites... vous obtenez](#vous-dites-vous-obtenez)
- [Démarrage en 60 secondes](#démarrage-en-60-secondes)
- [La boîte complète de capacités](#la-boîte-complète-de-capacités)
- [Configuration détaillée](#configuration-détaillée)
- [FAQ](#faq)
- [Pour qui c'est](#pour-qui-cest)
- [Soutenir l'auteur](#soutenir-lauteur)
- [License](#license)

---

## Vous dites... vous obtenez

| Vous dites... | Vous obtenez |
|---|---|
| « Dessine un chat cyberpunk avec une lueur néon » | Une image réaliste IA, enregistrée dans `output/` |
| « Génère une vidéo de 5 s d'un coucher de soleil sur la mer » | Une vidéo IA MP4 (génération en arrière-plan, notification à la fin) |
| « Dessine un schéma d'architecture : client → passerelle API → service commande + service paiement » | Schéma d'architecture vectoriel |
| « Mets ces données de vente en histogramme » | Graphique de données haute définition |
| « Fais un QR code pointant vers github.com » | QR code vectoriel |
| « Génère la formule E=mc² en haute définition » | Formule vectorielle |
| « Fais une carte de partage sombre à dégradé, titre : Nouveautés de juillet 🚀 » | Carte de partage composée (chinois + emoji automatique) |
| « Reconnais le tableau dans cette capture de facture » | Tableau HTML/Markdown collable (nouveau en 0.11.0) |
| « Lis cet histogramme en points de données » | Données structurées CSV/JSON (nouveau en 0.11.0) |
| « Décris ce qu'il y a sur cette image » | Réponse en langage naturel (nouveau en 0.11.0) |

> Pas besoin d'apprendre les noms d'outils ni d'installer des dépendances système — **Claude choisit automatiquement la meilleure façon de faire**.

---

## Démarrage en 60 secondes

Idée clé : **dessin / cartes / QR codes / formules sont des moteurs locaux, la reconnaissance d'image (OCR) a aussi un repli in-process par défaut — aucun appel IA, aucune connexion réseau, prêt à l'emploi dès l'installation**. Seules les images réalistes IA / vidéos nécessitent une clé API gratuite — et on vous fait faire « la première image » et « la première lecture d'image » avant même toute inscription.

### 30 s | Intégration en une ligne (zéro clé)

```bash
# Une ligne pour installer (sans clé, 30 s)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Redémarrez Claude Code → tapez /mcp → voyez media-gen-mcp ✓ Connected = succès
```

### 30 s | Première image immédiate sans clé

Dites simplement une phrase à Claude :

```
Fais une carte de partage style tech sombre, titre : Le couteau suisse de l'image pour Claude Code
```

→ Image vectorielle automatiquement enregistrée dans `output/`, prête à l'emploi. **Vous n'avez encore inscrit aucune clé API, et vous avez déjà un résultat.**

Tout ce qui suit est aussi instantané, sans clé et hors ligne :

- « Fais un QR code pointant vers github.com »
- « Génère la formule E=mc² en haute définition »
- « Dessine un schéma d'architecture : client → passerelle → service commande + service paiement → base de données, style tech sombre »
- « Reconnais les chiffres dans cette image de captcha » (OCR, in-process par défaut, rien à installer)
- « Extrais le texte anglais de cette capture »

### Vous voulez des images réalistes / vidéos IA ? Ajoutez une clé API gratuite (optionnel)

```bash
# ① Obtenez une clé API gratuite (Agnes recommandé, provider par défaut)
#    https://platform.agnes-ai.com/ → inscription → API Keys → copiez sk-xxx
#    (cogview-3-flash / cogvideox-flash de Zhipu sont aussi gratuits à vie, au choix ou les deux)

# ② Écrivez-la dans ~/.media-gen-mcp/config.json (un seul provider suffit)
{
  "providers": {
    "agnes": { "apiKey": "sk-votre-clé-agnes" }
  }
}

# ③ De retour dans Claude Code, dites : « Dessine un chat orange cyberpunk, style réaliste »
#    → Image réaliste IA enregistrée. Pareil pour la vidéo : « Génère une vidéo de 5 s d'un coucher de soleil sur la mer »
```

> Vous ne voulez pas utiliser npx ? L'installation globale fonctionne aussi : commencez par `npm i -g media-gen-mcp-server`, puis `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

---

## La boîte complète de capacités

> Dites simplement à Claude ce que vous voulez faire, il choisit automatiquement la meilleure approche. Ci-dessous, groupé par « ce que vous voulez faire » — vous n'avez pas besoin de connaître le nom de l'outil derrière.

### Créer une image (à partir de rien)

**Dessinez une photo réaliste ou une illustration**
> Vous : « Dessine un chat orange cyberpunk avec une lueur néon, style réaliste »
> Obtenu : image réaliste enregistrée dans `output/` (prend aussi en charge illustrations / concepts produit / brouillons de logo / scènes sci-fi)

**Transformez une phrase ou une image en vidéo courte**
> Vous : « Génère une vidéo de 5 s d'un coucher de soleil sur la mer »
> Obtenu : vidéo MP4 (3–18 s ; les vidéos longues sont générées en arrière-plan, vous êtes notifié à la fin pour récupérer le clip)

**Récupérez une icône ou un logo de marque**
> Vous : « Récupère un logo GitHub, 128 pixels »
> Obtenu : logo vectoriel à partir d'une bibliothèque de plus de 200 000 icônes, téléchargé et prêt à l'emploi (GitHub / Twitter / Material / Lucide / Font Awesome, etc.)

### Comprendre une image (transformer l'image en données · nouveauté 0.11.0)

**Extraire le texte d'une capture**
> Vous : « Lis les chiffres de ce captcha »
> Obtenu : texte brut (captcha / numéro de facture / document scanné / historique de chat, tout passe)

**Transformer une image de tableau en HTML / Markdown**
> Vous : « Reconnais le tableau dans cette capture de facture »
> Obtenu : tableau Markdown directement collable (factures / rapports / documents scannés, plus besoin de tout retaper)

**Retrouver les données d'origine à partir d'un graphique**
> Vous : « Lis cet histogramme en données »
> Obtenu : données structurées CSV / JSON (histogrammes / courbes / camemberts, tout fonctionne)

**Laissez-le expliquer l'image en mots simples**
> Vous : « Combien de personnes sur cette image ? Que font-elles ? »
> Obtenu : réponse en langage naturel (Q&R visuelle / manuscrit / formules / compréhension de scènes complexes)

### Dessiner clairement vos idées (sans clé, prêt à l'emploi)

**Dessiner des schémas structurels**
> Vous : « Dessine un schéma d'architecture : client → passerelle API → service commande + service paiement → base de données »
> Obtenu : schéma d'architecture vectoriel (prend aussi en charge organigrammes / diagrammes de séquence / diagrammes de classes / schémas ER / cartes mentales)

**Transformer les données en graphiques**
> Vous : « Mets ces données de vente en histogramme »
> Obtenu : graphique de données haute définition (barres / courbes / camemberts / aires / nuages de points, donnez une série de nombres ou un CSV, ça marche)

### Faire des cartes / posters / QR codes (qui rendent bien une fois partagés)

**Carte de partage / image OG / carte de citation / couverture / poster**
> Vous : « Fais une carte de partage sombre à dégradé, titre : Nouveautés de juillet 🚀 »
> Obtenu : carte soigneusement composée (titre, sous-titre, dégradés, lueur, emoji colorés, logo intégré, tout automatique ; les caractères chinois et les kanji japonais ne s'affichent pas en caractères corrompus)

**Générer un QR code**
> Vous : « Fais un QR code pointant vers github.com »
> Obtenu : QR code vectoriel (URL ou texte, net même imprimé en poster)

**Rendre une formule mathématique en haute définition**
> Vous : « Génère la formule E=mc² en haute définition »
> Obtenu : formule vectorielle (LaTeX, fractions complexes, équations chimiques, tout est pris en charge)

### Faire des effets cool / graphismes tech (même entrée = toujours même sortie)

**Rendre un SVG en PNG haute définition**
> Vous : « Dessine un fond tech avec lueur, champ d'étoiles, profondeur »
> Obtenu : PNG saisissant, choisit automatiquement le meilleur mode de rendu pour préserver la fidélité sans perte

**Transformer une animation HTML / CSS en vidéo**
> Vous : « Fais une animation d'intro produit de 3 s, dégradé + particules »
> Obtenu : vidéo MP4 / GIF / WebM (intros produit / animations de marque / démos d'effet, rendu frame par frame, même entrée = toujours même sortie)

> **Petit conseil** : création d'image / lecture d'image utilisent l'IA en ligne ; dessin / cartes / QR codes / animations sont des moteurs locaux — **prêts à l'emploi dès l'installation, vectoriels haute définition, une même entrée produit toujours la même sortie**.

---

## Configuration détaillée

> En une phrase : **les capacités structurelles (dessin / graphiques / cartes / QR codes / formules) fonctionnent sans configuration ; la génération IA nécessite une seule ligne de clé API ; la reconnaissance d'image est zéro configuration par défaut, et seulement le SOTA chinois / les tableaux / les graphiques nécessitent un auto-hébergement.** Ce que vous voulez utiliser détermine ce qu'il faut configurer — pas besoin de tout mettre en place.

### Rechercher la configuration par « ce que je veux faire »

| Ce que vous voulez faire | Ce qu'il faut configurer | Utilisable immédiatement après configuration |
|---|---|---|
| Dessiner des schémas d'architecture / graphiques de données / cartes / QR codes / formules | **Rien à configurer** | Moteur local, prêt après installation |
| Images réalistes IA / vidéos IA (texte-vers-image, texte-vers-vidéo) | Configurer une clé API gratuite (Agnes ou Zhipu, au choix) | Génération en ligne, enregistrée dans `output/` |
| OCR (anglais / captcha / chiffres / documents simples) | **Rien à configurer** | Moteur léger in-process par défaut, prêt après installation |
| OCR chinois / factures et tableaux / lecture de graphiques / Q&R visuelle / manuscrit / formules | Auto-héberger un moteur de compréhension (PaddleX ou vLLM, voir les besoins en ressources ci-dessous) | Après avoir lancé le service auto-hébergé, renseignez une ligne de baseUrl |

---

### 1. Configuration de génération (images / vidéos IA)

**Provider par défaut : Agnes** (niveau gratuit permanent, texte-vers-image + texte-vers-vidéo entièrement ouverts). Zhipu est l'alternative (optimisée nativement pour les scénarios chinois).

**Un seul suffit** (ci-dessous le `config.json` complet, vous pouvez ne remplir qu'un seul provider) :

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-votre-clé-agnes" },
    "zhipu": { "apiKey": "votre-clé-zhipu" }
  },
  "defaultProvider": "agnes",
  "outDir": "/chemin/absolu/vers/output"
}
```

**Comment obtenir une clé API gratuite** :

- **Agnes** (recommandé, par défaut) : https://platform.agnes-ai.com/ → inscription → API Keys → copiez `sk-xxx`
- **Zhipu** : https://open.bigmodel.cn/ → inscription → API Keys (modèles gratuits : `cogview-3-flash` / `cogvideox-flash`, gratuits à vie)

**Plus stable avec les deux** : si l'un tombe temporairement (limite de débit / fluctuation de service), l'autre prend automatiquement le relais, imperceptiblement pour vous, sans double facturation.

**Emplacement du fichier de configuration** : `~/.media-gen-mcp/config.json` (macOS / Linux) ou `%USERPROFILE%\.media-gen-mcp\config.json` (Windows).

> Ce fichier **ne provoque pas de crash s'il est absent** — les capacités structurelles et l'OCR par défaut fonctionnent, mais vous ne pouvez pas appeler la génération IA.

---

### 2. Configuration de reconnaissance (image / OCR / tableaux / graphiques / vision)

La reconnaissance est **organisée en trois niveaux**, à choisir selon vos besoins ; le premier niveau fonctionne par défaut.

#### Niveau 1 : moteur léger par défaut (zéro configuration, prêt à l'emploi)

- **Ce qu'il sait faire** : OCR anglais / chiffres / captcha / documents simples
- **Faut-il installer un service ?** : **Non**, empaqueté en WASM dans le processus MCP, charge le modèle de langue automatiquement au premier appel
- **Besoins minimum en ressources** :
  - CPU : au choix (CPU pur, aucune dépendance GPU)
  - GPU : non requis
  - Mémoire : environ 200–500 Mo (varie avec la taille de l'image)
  - Disque : environ 30–50 Mo (moteur WASM + paquet de langue)
  - Taille du modèle : incluse dans l'empreinte disque ci-dessus (paquet de langue anglais, de l'ordre de quelques Mo)
- **Vitesse** : environ 3–5 secondes par image
- **Pour qui** : 90 % des scénarios OCR légers, documents internationaux, reconnaissance de captcha

> La plupart des utilisateurs s'arrêtent à ce niveau ; les deux suivants sont des renforcements optionnels.

#### Niveau 2 : PaddleX / PP-StructureV3 (SOTA chinois + reconnaissance de tableaux)

- **Ce qu'il sait faire** : OCR chinois (nettement meilleur que le moteur par défaut), analyse de mise en page, **factures / rapports / documents scannés → tableaux HTML/Markdown**, lecture de graphiques
- **Faut-il installer un service ?** : **Oui**, auto-héberger le service REST PaddleX, le MCP l'appelle via `baseUrl`
- **Besoins minimum en ressources** (testés) :

  | Mode | Seuil minimum | Recommandé | Remarques |
  |---|---|---|---|
  | Mode GPU | RTX 3060 12 Go VRAM | RTX 3060 12 Go / Tesla T4 | Chargement du modèle environ 2,4 Go, pic à environ 6 Go sur PDF complexe |
  | Mode CPU | CPU 4 cœurs + 8 Go RAM | 8 cœurs + 16 Go RAM | Fonctionne (documents légers OK), mais 3–5× plus lent en batch / PDF complexe |
  | Disque | environ 3 Go | environ 5 Go | paddlepaddle + paddlex + poids des modèles |
  | Taille du modèle | environ 100–300 Mo (un seul pipeline) | — | S'additionne pour plusieurs pipelines |

- **Exigences CUDA** : Compute Capability ≥ 7.0 (V100 / T4 / RTX série 20/30/40 ; série 50 pas encore pleinement prise en charge), nécessite CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 pour l'accélération GPU
- **Comment installer** :

  ```bash
  pip install paddlex paddlepaddle          # Version GPU : paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  Puis ajoutez une ligne dans `config.json` :

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### Niveau 3 : vLLM + Qwen2.5-VL (VLM de compréhension visuelle générale)

- **Ce qu'il sait faire** : Q&R visuelle, reconnaissance de manuscrit, reconnaissance de formules, description en langage naturel de scènes complexes — les tâches de « compréhension » que PaddleX ne gère pas
- **Faut-il installer un service ?** : **Oui**, monter votre propre service d'inférence vLLM
- **Besoins minimum en ressources** (testés) :

  | Mode | Seuil minimum | Recommandé | Remarques |
  |---|---|---|---|
  | GPU pleine précision 7B (FP16) | 16 Go VRAM | **24 Go VRAM** (RTX 3090 / 4090 / A5000) | Poids du modèle environ 15–16 Go + cache KV, vLLM occupe 90 % de la VRAM par défaut |
  | GPU quantifié 7B (INT8/AWQ) | 10–12 Go VRAM | 16 Go VRAM | La version quantifiée tient dans une RTX 4080 / 4060 Ti 16 Go |
  | GPU version légère 3B | 6–8 Go VRAM | GTX 1660 / 3060 6–8 Go | FP16 environ 6–8 Go, INT4 environ 3–4 Go, le sweet spot des développeurs individuels |
  | Mode CPU | Non recommandé | — | Fonctionne mais 5–10× plus lent, utilisez du GPU en production |
  | Mémoire | 16 Go | 16–32 Go | — |
  | Disque | environ 14 Go (poids 7B) | — | 3B environ 6 Go |
  | Exigence CUDA | Compute Capability ≥ 7.0 | — | À partir de Tesla T4 (7.5), V100 / A100 / RTX série 30/40 OK |

- **Comment installer** :
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # Voyez « Uvicorn running on http://0.0.0.0:8000 » = prêt
  ```
  Plus de paramètres (choix du GPU / version quantifiée / limite de concurrence) dans la [documentation officielle vLLM](https://docs.vllm.ai). Puis ajoutez dans `config.json` :

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

#### Comparaison rapide des trois niveaux

| Niveau | Service à installer ? | Seuil de ressources | Chinois | Tableaux | Q&R visuelle | License |
|---|---|---|---|---|---|---|
| **Par défaut** (tesseract) | Non | Zéro (WASM CPU pur) | Moyen | ❌ | ❌ | Apache 2.0 |
| **PaddleX** | Oui | GPU 12 Go ou CPU 4 cœurs 8 Go | ✅ SOTA | ✅ | ❌ | Apache 2.0 |
| **vLLM Qwen2.5-VL** | Oui | **GPU 16–24 Go** (CPU inutilisable) | ✅ | Moyen | ✅ | Apache 2.0 |

> Côté reconnaissance, seuls des moteurs Apache 2.0 sont délibérément choisis (tesseract.js + PaddleOCR + Qwen2.5-VL), afin d'éviter les pièges AGPL / GPL / demandes d'utilisation commerciale — **les entreprises peuvent l'utiliser commercialement sans hésitation**.

---

### 3. Mécanisme de repli automatique (configurez, puis oubliez)

- **Côté génération** : Agnes ↔ Zhipu, si l'un échoue, bascule automatique vers l'autre (en cas d'échecs consécutifs sous 60 secondes, bascule en douceur ; pas besoin de redémarrer ni de modifier la config)
- **Côté reconnaissance** : moteur léger par défaut (repli in-process) → PaddleX → vLLM, dégradation automatique selon la capacité
- **La seule exception** : lors du polling vidéo pour récupérer le clip, **pas de bascule** (pour éviter de récupérer un mauvais résultat)
- Ce que vous avez à faire : configurez deux clés API de génération + installez optionnellement un niveau de service de reconnaissance, et laissez Claude gérer le reste

> Votre machine ne peut pas faire tourner PaddleX ou vLLM ? **Continuez avec le moteur léger par défaut**, le MCP ne plantera pas faute de service local — seules les capacités SOTA chinois / tableaux / Q&R visuelle seront indisponibles, tout le reste fonctionne normalement.

---

## FAQ

**Q : Ça fonctionne sans rien installer ?**
R : Oui. Installez le MCP et vous avez dessin / cartes / QR codes / formules / graphiques de données + OCR anglais / captcha, le tout en local, hors ligne.

**Q : L'OCR chinois affiche-t-il des caractères corrompus ?**
R : Le moteur léger par défaut convient pour l'anglais / chiffres / documents simples, mais sa précision en chinois est moyenne. Pour le SOTA chinois, auto-hébergez PaddleX (GPU 12 Go ou CPU 4 cœurs 8 Go), voir la [configuration détaillée](#configuration-détaillée) ci-dessus.

**Q : Combien de temps pour une vidéo IA ?**
R : Environ 1–3 minutes pour une vidéo de 5 s, jusqu'à 5–10 minutes pour 18 s. Génération asynchrone en arrière-plan, notification automatique à la fin pour récupérer le clip ; les vidéos estimées ≤ 60 s sont attendues en mode synchrone.

**Q : Ma RTX 3060 peut-elle faire la reconnaissance de tableaux ?**
R : Oui. Le mode GPU PaddleX demande au minimum 12 Go de VRAM (la RTX 3060 12 Go tombe juste), le mode CPU fonctionne aussi avec 4 cœurs + 8 Go de RAM (3–5× plus lent). Voir la [configuration détaillée](#configuration-détaillée).

**Q : Chinois / emoji / dégradés s'affichent correctement ?**
R : Oui. Les cartes de partage prennent en charge automatiquement le chinois, les kanji japonais, les emoji colorés, les titres en dégradé et les effets de lueur via des polices chinoises intégrées et un moteur de mise en page, sans configuration de police supplémentaire.

**Q : Mermaid est-il pris en charge ?**
R : Non (nécessite un navigateur). Utilisez D2 ou Graphviz à la place, capacité équivalente et plus stable, sortie vectorielle.

**Q : Limité par le débit (429) ?**
R : Le niveau gratuit a une limite de requêtes par minute. Après avoir configuré deux providers (Agnes + Zhipu), la bascule est automatique, quasiment imperceptible.

**Q : Limite du nombre de frames vidéo ?**
R : Décroît avec la résolution — 1080p ≤ 241 frames (environ 10 s), 720p jusqu'à 441 frames (environ 18 s). Demandez à Claude pour les contraintes en temps réel.

**Q : npx ne se connecte pas / démarre lentement ?**
R : L'installation globale fonctionne aussi : commencez par `npm i -g media-gen-mcp-server`, puis `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`.

**Q : Puis-je utiliser des mots sensibles / armes / thèmes de guerre ?**
R : Les mots d'armes réelles déclenchent le filtre de contenu. Utilisez des termes de réglage sci-fi (comme « armure future », « mecha ») pour contourner, à effet équivalent.

---

## Pour qui c'est

- **Utilisateurs intensifs de Claude Code** — qui font des tâches image plusieurs fois par semaine et ne veulent pas installer un MCP par tâche ni mémoriser un jeu de paramètres différent à chaque fois.
- **Développeurs qui écrivent de la doc technique / des blogs** — qui ont régulièrement besoin de schémas d'architecture, diagrammes de séquence, schémas ER, graphiques de données, formules, sans vouloir quitter leur workflow.
- **Indépendants / produits solo** — attentifs aux coûts (100 % gratuit) et à la maîtrise (même entrée = même sortie), sans vouloir monter un backend séparé pour les tâches image.
- **Data / Finance / Juridique** — scénarios bidirectionnels : transformer les données en graphiques, et extraire les points de données à partir de captures / factures.
- **Marketing / créateurs de contenu / auteurs de blogs** — cartes de partage / images OG / posters / QR codes, chinois + emoji colorés + dégradés prêts à l'emploi.

> **Pas vraiment adapté** : aux utilisateurs qui ne se servent pas de Claude Code ; aux équipes d'ingénierie qui n'ont besoin que d'une seule capacité et ont déjà leur pipeline en place ; aux scénarios nécessitant des modèles commerciaux payants / entraînement de fine-tuning / OCR vidéo en temps réel (au-delà du périmètre d'un MCP gratuit).

---

## 💝 Soutenir l'auteur

Si media-gen-mcp vous aide, offrez un café à l'auteur ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

Ou ⭐ [Star](../../stargazers) / [Issue](../../issues) / [PR](../../pulls) — toute forme de soutien est appréciée.

---

## License

**MIT** — le code principal, libre d'utilisation.

La pile de dépendances de reconnaissance est intégralement **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL), aucun risque de license pour l'usage commercial en entreprise.

---

> Détails techniques : providers et moteurs sont tous plug-and-play, les outils structurels ont une sortie déterministe (même entrée = même sortie) et peuvent être versionnés dans git, bascule automatique de provider en cas d'échec. Contributeurs détaillés dans `CONTRIBUTING.md`, documentation complète dans le répertoire `docs/`.

<p align="center">
  <sub>Conçu pour tous ceux qui préfèrent <strong>le dire</strong> plutôt que <strong>le coder</strong>.</sub><br>
  <sub>Un seul install, et toutes vos tâches image se font en une phrase.</sub>
</p>
