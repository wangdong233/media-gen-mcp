<h1 align="center">media-gen-mcp</h1>

> Le « couteau suisse de l'image » pour Claude Code — créer des images, donner vie à vos idées, comprendre l'image, en une seule phrase, totalement gratuit.

<p align="center">
  <img src="https://img.shields.io/badge/version-0.13.0-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Installez-le une fois dans Claude Code, et toutes vos tâches image se font en une phrase.** Designers qui produisent des visuels, développeurs qui dessinent des schémas d'architecture, équipes marketing qui créent des cartes de partage, financiers qui extraient les tableaux de factures — génération d'images / vidéos + reconnaissance + dessin / cartes / QR codes, tout est couvert, **100 % gratuit** (provider gratuit + moteur local, prêt à l'emploi dès l'installation).

Fatigué de produire des images plusieurs fois par semaine et d'installer N outils avec N jeux de paramètres ? Ici, un seul install, et vous confiez tous vos scénarios image à Claude.

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Español](README.es.md) | **Français** | [日本語](README.ja.md) | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

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
| « Reconnais le tableau dans cette capture de facture » | Tableau HTML/Markdown collable |
| « Lis cet histogramme en points de données » | Données structurées CSV/JSON |
| « Décris ce qu'il y a sur cette image » | Réponse en langage naturel |
| « Extrais tout le texte de ce rapport PDF de 20 pages » | Texte intégral / Markdown / JSON (PDF numérique en secondes, PDF scanné OCR page par page automatique) |
| « Extrais le texte de ce contrat scanné en ignorant filigrane et tampons rouges » | Texte propre (suppression automatique des zones filigrane / tampons / en-tête et pied de page) |
| « Fusionne cet article sur deux colonnes en un seul bloc selon l'ordre de lecture » | Texte continu sur une colonne (ordre de lecture multi-colonnes restauré, fini l'entrelacement) |
| « Suis-je capable de reconnaître les tableaux ? Mon OCR chinois est-il configuré ? » | Liste des capacités actuelles + recommandation de routage (qui fonctionne / qui manque / que faire) |

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

### Vous voulez OCR chinois SOTA / Q&R visuelle ? Configurez une clé GLM de Zhipu (zéro déploiement, optionnel)

Le moteur léger par défaut suffit pour l'anglais / les chiffres, mais sa précision en chinois reste moyenne. **Vous ne voulez pas auto-héberger PaddleX / vLLM, mais vous voulez le SOTA chinois + tableaux complexes + Q&R visuelle ?** Configurez une seule clé GLM de Zhipu — **GLM-4.6V-Flash est gratuit à vie dans le cloud**, zéro déploiement, zéro ressource locale :

```bash
# ① Inscrivez-vous sur https://open.bigmodel.cn/console/apikey pour un compte gratuit + demandez api_key (format {id}.{secret})
#    Attention : seules les clés standard open.bigmodel.cn sont acceptées ; la clé Code Plan (ZAI_API_KEY) n'est PAS utilisable —
#    elle est liée à un point de terminaison Z.ai + une liste blanche de 9 outils (Claude Code / Cline / Cursor, etc., media-gen-mcp non inclus),
#    tout appel abusif entraîne la fermeture du compte et l'abonnement non remboursé

# ② Écrivez-la dans ~/.media-gen-mcp/config.json
{
  "providers": {
    "glm-vision": { "apiKey": "votre-{id}.{secret}" }
  }
}

# ③ De retour dans Claude Code : « Reconnais le tableau de cette facture chinoise » / « Combien de personnes sur cette image ? Que font-elles ? »
#    → OCR chinois SOTA + Q&R visuelle, enregistré / réponse directe
```

> Une fois configurée, le MCP l'intègre automatiquement à la chaîne de repli : **paddle → glm-vision → vlm → tesseract** ; si un niveau tombe temporairement, dégradation automatique imperceptible. Voir [Configuration détaillée · Niveau 2](#configuration-détaillée).

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

### Comprendre une image / un PDF (transformer l'image et les documents en données)

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

**Extraire tout le texte d'un PDF**
> Vous : « Extrais tout le texte de ce rapport PDF de 20 pages, exporte en Markdown »
> Obtenu : texte intégral / Markdown / JSON — un PDF numérique sort en secondes via la couche de texte, un PDF scanné passe automatiquement par OCR page par page ; plage de pages au choix (`3` / `1-10` / `odd` / `last`), zones filigrane / en-tête et pied de page ignorées, sortie multi-pages fusionnée ou paginée ; les documents longs tournent en arrière-plan, notification à la fin pour récupérer le résultat (factures / contrats / rapports financiers / articles / livres scannés, tout passe)

**Rendre les résultats de reconnaissance / de lecture PDF plus propres et plus fluides**
> Vous : « Extrais le texte de ce contrat scanné, **ignore le filigrane et les tampons rouges** » / « Fusionne cet article sur deux colonnes **selon l'ordre de lecture** en un seul bloc »
> Obtenu : texte propre et continu — deux commutateurs disponibles dans tous les outils de reconnaissance / d'extraction PDF :
> - **Zones à ignorer** : délimitez le filigrane / les tampons rouges / l'en-tête et le pied de page / la zone de titre du tableau, automatiquement supprimées du résultat — contrats / certificats / documents scannés ne sont plus masqués par le filigrane
> - **Ordre de lecture multi-colonnes** : articles / presse / CV / mises en page à deux ou trois colonnes, automatiquement fusionnées en un texte continu sur une colonne selon l'ordre de lecture humain, fini l'entrelacement erroné

**Demander d'abord « que peut faire mon service de reconnaissance ? »**
> Vous : « Suis-je actuellement capable de reconnaître les tableaux ? Mon OCR chinois est-il configuré ? La reconnaissance de manuscrit fonctionne-t-elle ? »
> Obtenu : la liste des capacités actuelles — quel niveau sur les quatre est configuré / lequel manque / lequel est en refroidissement ou en erreur, ainsi que la recommandation de routage « pour les tableaux passez par X, pour le manuscrit par Y » ; **demandez d'abord avant de lancer l'appel, pour éviter de tomber sur une erreur**

### Dessiner clairement vos idées (sans clé, prêt à l'emploi)

**Dessiner des schémas structurels**
> Vous : « Dessine un schéma d'architecture : client → passerelle API → service commande + service paiement → base de données »
> Obtenu : schéma d'architecture vectoriel (prend aussi en charge organigrammes / diagrammes de séquence / diagrammes de classes / schémas ER / cartes mentales)

**Dessiner un schéma HTML interactif** (ouvrez-le dans le navigateur pour interagir ; flux sur les arêtes + animation des nœuds ; le thème suit le clair/sombre du système)
> Vous : « Dessine un schéma d'architecture pour un README qui suit automatiquement les lecteurs clair/sombre »
> Obtenu : un fichier HTML unique (palette double D2 + visionneuse ; pan / zoom / bascule de thème / export SVG)

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
| OCR chinois / factures et tableaux / lecture de graphiques / Q&R visuelle / manuscrit / formules | **Configurer une clé GLM de Zhipu** (zéro déploiement, gratuit à vie dans le cloud) **ou** auto-héberger PaddleX / vLLM | Avec la clé GLM, prêt à l'emploi dès la configuration ; pour l'auto-hébergement, lancez le service puis renseignez une ligne baseUrl |
| **Extraction de texte PDF** (numérique / scanné / multi-pages) | Installer deux dépendances `npm i pdfjs-dist @napi-rs/canvas` (à la première utilisation PDF) | PDF numérique en secondes ; PDF scanné suit les niveaux OCR ci-dessus (fonctionne aussi en zéro configuration par défaut) |
| **Suppression filigrane / tampons / en-tête et pied de page, restauration de l'ordre de lecture multi-colonnes** | **Rien à configurer** | Dites simplement « Claude, ignore le filigrane » ou « fusionne selon l'ordre de lecture » lors de l'appel, appliqué automatiquement |
| **Vérifier les capacités de reconnaissance actuelles** (qui fonctionne / qui manque) | **Rien à configurer** | Posez directement la question, Claude renvoie une liste des capacités + la recommandation de routage |

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

La reconnaissance est **organisée en quatre niveaux**, à choisir selon vos besoins ; le premier niveau fonctionne par défaut.

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

> La plupart des utilisateurs s'arrêtent à ce niveau ; les trois suivants sont des renforcements optionnels.

#### Niveau 2 : GLM-4.6V-Flash de Zhipu (cloud gratuit, zéro déploiement, SOTA chinois + VQA)

- **Ce qu'il sait faire** : OCR chinois (niveau SOTA), tableaux complexes (en-têtes multi-niveaux / cellules fusionnées), analyse de graphiques, Q&R visuelle (VQA) — les 4 tâches, dans le cloud via GLM-4.6V-Flash
- **Faut-il installer un service ?** : **Non**, API cloud de la plateforme ouverte Zhipu, inscrivez-vous pour obtenir une api_key
- **Besoins minimum en ressources** : **Zéro** (pur appel HTTP, pas de CPU / GPU / disque)
- **Vitesse** : environ 1–3 secondes par image (cloud, aller-retour réseau inclus)
- **Coût** : **GLM-4.6V-Flash gratuit à vie** (contexte 128K + sortie 32K), aligné sur la stratégie gratuite de GLM-4-Flash
- **Pour qui** : utilisateurs voulant le SOTA chinois + VQA mais **ne voulant pas auto-héberger PaddleX / vLLM** ; complète parfaitement le seuil de déploiement des niveaux 3 / 4 auto-hébergés
- **Comment configurer** : inscrivez-vous sur [open.bigmodel.cn](https://open.bigmodel.cn/console/apikey) pour un compte gratuit + demandez api_key (format `{id}.{secret}`), puis ajoutez dans `config.json` :

  ```json
  {
    "providers": {
      "glm-vision": { "apiKey": "votre-{id}.{secret}" }
    }
  }
  ```

  Le modèle par défaut est `glm-4.6v-flash`, modifiable via `providers["glm-vision"].model` vers `glm-4v-flash` (léger gratuit) ou des modèles visuels payants (`glm-4.6v` / `glm-ocr`, etc.). Une fois configuré, le MCP l'intègre automatiquement à la chaîne de repli : **paddle(10) → glm-vision(9) → vlm(8) → tesseract(1)**.

- ⚠️ **Conformité** (important) :
  - Seules les **api_key standard open.bigmodel.cn** sont acceptées ; **la clé Code Plan (ZAI_API_KEY) n'est PAS utilisable** — elle est liée à un point de terminaison Z.ai dédié + limitée à 9 outils en liste blanche (Claude Code / Cline / Cursor, etc., media-gen-mcp non inclus), tout appel abusif entraîne la fermeture du compte après 3 fois et l'abonnement non remboursé
  - La rotation multi-clés (`apiKeys: ["k1", "k2", ...]`) est techniquement prise en charge, mais **l'Accord Utilisateur Zhipu §2/§3 interdit les multi-comptes / le partage de compte** — la rotation multi-clés peut violer le contrat, la plateforme se réserve le droit de fermer le compte. Veuillez vous assurer que toutes les clés proviennent de vos propres comptes conformes

#### Niveau 3 : PaddleX / PP-StructureV3 (SOTA chinois + reconnaissance de tableaux)

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

#### Niveau 4 : vLLM + Qwen2.5-VL (VLM de compréhension visuelle générale)

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

##### Avancé : parsing de documents longs Unlimited-OCR (SGLang/vLLM auto-hébergé)

Le Qwen2.5-VL par défaut du niveau 4 est un VLM généraliste (fort en Q&R visuelle / description de scène). Si votre besoin est **l'OCR de documents longs / les tableaux complexes / le parsing d'un PDF multipages en une seule passe** (plusieurs milliers à plusieurs dizaines de milliers de caractères par image), passez à [baidu/Unlimited-OCR](https://github.com/baidu/Unlimited-OCR) (MIT, pousse la lignée Deepseek-OCR d'un cran plus loin). Il est **entraîné avec uniquement un prompt de 2 mots** `document parsing.` ; la sortie longue s'appuie sur `custom_logit_processor` (DeepseekOCRNoRepeatNGram) pour empêcher la dégénérescence — c'est un outil d'une catégorie différente de Qwen2.5-VL.

**Quand Unlimited-OCR est configuré, le provider `vlm` active automatiquement les 4 tâches** (extract-text / extract-table / describe-image / analyze-chart), et `extract-text` / `extract-table` empruntent le prompt court du contrat image-unique du README ; `describe-image` (VQA) et `analyze-chart` (extraction JSON) conservent leur prompt long d'origine — vous n'avez pas à écrire de surcharge de prompt, le MCP choisit automatiquement selon le modèle.

**Déploiement (SGLang, recommandé — prend en charge l'ensemble des fonctionnalités `custom_logit_processor`)** :

```bash
# Récupérer l'image (voir le README Unlimited-OCR pour les détails)
docker pull vllm/vllm-openai:unlimited-ocr          # CUDA 13.0 par défaut
# Pour les GPU Hopper, utilisez cu129 :
# docker pull vllm/vllm-openai:unlimited-ocr-cu129

# Démarrer le serveur SGLang (paramètres clés expliqués dans la section « SGLang » du README Unlimited-OCR)
python -m sglang.launch_server \
  --model baidu/Unlimited-OCR \
  --served-model-name Unlimited-OCR \
  --attention-backend fa3 --page-size 1 \
  --mem-fraction-static 0.8 --context-length 32768 \
  --enable-custom-logit-processor \
  --host 0.0.0.0 --port 10000
```

`custom_logit_processor` est le résultat stringifyé de `DeepseekOCRNoRepeatNGramLogitProcessor.to_str()` côté Python (un format de sérialisation privé SGLang, non synthétisable côté TS). **Exécutez-le une fois au moment du déploiement** et collez la chaîne dans `config.json` :

```bash
# Dans un environnement Python où sglang est installé, lancez cette commande unique :
python -c "from sglang.srt.sampling.custom_logit_processor import DeepseekOCRNoRepeatNGramLogitProcessor as P; print(P.to_str())"
# Affiche une longue chaîne — copiez-la dans le champ custom_logit_processor ci-dessous
```

**Exemple de config.json** (bascule `vlm` vers Unlimited-OCR + configuration des champs d'extension `extra_body`) :

```json
{
  "providers": {
    "vlm": {
      "baseUrl": "http://127.0.0.1:10000",
      "models": { "default": "Unlimited-OCR" },
      "extra_body": {
        "images_config": { "image_mode": "gundam" },
        "custom_params": { "ngram_size": 35, "window_size": 128 },
        "custom_logit_processor": "<la chaîne affichée par python -c ci-dessus>",
        "skip_special_tokens": false
      }
    }
  }
}
```

Signification des champs (tous au niveau racine, acceptés par l'API compatible OpenAI de SGLang ; le MCP les « aplatit » via `Object.assign` dans le corps du fetch) :

| Champ | Valeur | Remarques |
|---|---|---|
| `images_config.image_mode` | `gundam` / `base` | Haute précision image unique : `gundam` (base_size=1024, image_size=640, crop_mode=true) ; PDF multi-pages : `base` (image_size=1024, crop_mode=false). media-gen-mcp utilise un **contrat image unique**, `gundam` par défaut est optimal |
| `custom_params.ngram_size` | `35` (recommandé) | Longueur NoRepeatNGram ; 35 est la valeur recommandée par le README |
| `custom_params.window_size` | `128` (image unique) / `1024` (multi-pages) | Image unique : 128 ; le contrat image unique de media-gen-mcp recommande 128 |
| `custom_logit_processor` | Sortie Python de `.to_str()` | Obligatoire (sans cela la sortie longue dégénère par répétition) ; non synthétisable côté TS — exécutez Python une fois pour obtenir la chaîne |
| `skip_special_tokens` | `false` | Les tâches OCR doivent conserver les tokens spéciaux ; ne pas skip |

> ⚠️ **Gating par tâche (important)** : `extra_body` (incluant `custom_logit_processor` / `skip_special_tokens:false` / `images_config.image_mode:gundam`) n'est appliqué au corps du fetch que sur `extract-text` / `extract-table` (le chemin OCR) — `describe-image` (VQA) et `analyze-chart` (extraction JSON) **ne portent pas ces champs**. Raison : NoRepeatNGram (ngram_size=35) supprime les répétitions légitimes de mots dans les descriptions VQA ; `skip_special_tokens:false` fait fuiter les tokens structurels OCR dans la description / corrompt le `JSON.parse` de `analyze-chart` ; `image_mode:gundam` (crop_mode=true) morcèle l'image entière et casse la compréhension holistique de la scène pour la VQA. C'est la contrepartie symétrique du gating à prompt court conscient du modèle (`promptForUnlimited`) — `describe-image` / `analyze-chart` conservent le prompt long d'origine ET un corps propre. Si vous devez forcer les champs d'extension sur `describe-image` / `analyze-chart`, utilisez le paramètre `extra` par appel (à passer via le paramètre `extra` des outils `extract_text` / `extract_table` / `describe_image` / `analyze_chart`) — il n'est pas soumis au gating par tâche.

**Invocation** : passez `provider=vlm` explicitement à `extract_text` (sinon il ira vers defaultVisionProvider=tesseract) :

```
extract_text(image="data:image/png;base64,...", provider="vlm")
```

**Limites importantes** :

- **Mode non-stream** : media-gen-mcp utilise le `/v1/chat/completions` **non-stream** de vLLM/SGLang (JSON renvoyé en une fois), adapté aux documents court-moyens ou à page unique. Le `infer.py` d'Unlimited-OCR utilise `stream:true` par défaut — **ne copiez pas `stream:true` dans `extra_body`** — le MCP le détecte et rejette avec l'avertissement « remove extra.stream ». Pour les PDF très longs, commencez par [découper les pages avec PyMuPDF](https://github.com/baidu/Unlimited-OCR#transformers) (le README fournit un snippet `pdf_to_images`), puis appelez `extract_text` page par page — des requêtes indépendantes par page évitent naturellement les sorties trop longues.
- **Timeout serveur** : les documents longs sont longs à générer ; si les 60 s par défaut de vLLM ne suffisent pas, augmentez `REQUEST_TIMEOUT` côté SGLang ou `--timeout-keepalive` côté vLLM.
- **Seuil GPU** : 16–24 Go de VRAM (identique au niveau 4) ; si vous ne pouvez pas tenir ce seuil, continuez à utiliser la chaîne paddle(10)/glm-vision(9).

**Licence** : [MIT](https://github.com/baidu/Unlimited-OCR/blob/main/LICENSE) (aligné avec la position purement gratuite ; même catégorie que Qwen Apache-2.0 ; usage commercial OK).

#### Comparaison rapide des quatre niveaux

| Niveau | Service à installer ? | Seuil de ressources | Chinois | Tableaux | Q&R visuelle | License |
|---|---|---|---|---|---|---|
| **1 Par défaut** (tesseract) | Non | Zéro (WASM CPU pur) | Moyen | ❌ | ❌ | Apache 2.0 (auto-empaqueté) |
| **2 GLM-4.6V-Flash de Zhipu** | Non (API cloud) | Zéro (pur HTTP) | ✅ SOTA | ✅ | ✅ | Clé Zhipu fournie par l'utilisateur (gratuit à vie) |
| **3 PaddleX** | Oui | GPU 12 Go ou CPU 4 cœurs 8 Go | ✅ SOTA | ✅ | ❌ | Apache 2.0 (auto-hébergé) |
| **4 vLLM Qwen2.5-VL** | Oui | **GPU 16–24 Go** (CPU inutilisable) | ✅ | Moyen | ✅ | Apache 2.0 (auto-hébergé) |

> Côté reconnaissance, les trois niveaux auto-hébergés (1/3/4) n'utilisent délibérément que des moteurs **Apache 2.0** (tesseract.js + PaddleOCR + Qwen2.5-VL), afin d'éviter les pièges AGPL / GPL / demandes d'utilisation commerciale — **les entreprises peuvent l'utiliser commercialement sans hésitation**. Le niveau 2 Zhipu est une API cloud (GLM-4.6V-Flash gratuit à vie, clé fournie par l'utilisateur), non auto-hébergée — adaptée aux utilisateurs ne voulant pas déployer de serveur pour compléter le SOTA chinois + VQA.

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

**Q : Claude va-t-il choisir le mauvais outil ? (p. ex. générer une image quand vous demandez une carte de partage)**
R : Le routage de ces requêtes ambiguës a été affiné — « faire une carte / poster / image OG », « lire les données de ce graphique », « faire une animation d'intro produit », « dessiner un schéma d'architecture / organigramme », « visualiser ces données » et similaires vont désormais automatiquement au bon outil spécialisé, sans correction manuelle. Vous pouvez aussi nommer un outil explicitement dans votre requête.

---

## Pour qui c'est

- **Utilisateurs intensifs de Claude Code** — qui font des tâches image plusieurs fois par semaine et ne veulent pas installer un MCP par tâche ni mémoriser un jeu de paramètres différent à chaque fois.
- **Développeurs qui écrivent de la doc technique / des blogs** — qui ont régulièrement besoin de schémas d'architecture, diagrammes de séquence, schémas ER, graphiques de données, formules, sans vouloir quitter leur workflow.
- **Indépendants / produits solo** — attentifs aux coûts (100 % gratuit) et à la maîtrise (même entrée = même sortie), sans vouloir monter un backend séparé pour les tâches image.
- **Data / Finance / Juridique** — scénarios bidirectionnels : transformer les données en graphiques, et extraire les points de données à partir de captures / factures / **rapports PDF / contrats** (filigrane / tampons rouges ignorés, articles sur deux colonnes fusionnés selon l'ordre de lecture).
- **Éducation / Académique** — étudiants : extraire le texte de captures de cours / polycopiés scannés / PDF d'articles, fusionner un article sur deux colonnes en texte continu, interroger les données lues dans un graphique ; enseignants : transformer des examens papier scannés en texte modifiable.
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
