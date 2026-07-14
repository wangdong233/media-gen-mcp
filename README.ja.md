<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#①-無料-key-を取得)
[![Version](https://img.shields.io/badge/version-0.3.0-6f42c1?style=flat-square)](https://www.npmjs.com/package/media-gen-mcp-server)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Claude Code 向けのオールインワン画像生成 MCP — AI 画像生成とローカル構造化描画を、1つのサーバーで**

テキスト to 画像 / 画像 to 画像 / テキスト to 動画 / 画像 to 動画 / キーフレームアニメーション · ダイアグラム / チャート / 数式 / カード / アイコン / QR コード

[English](README.en.md) | [简体中文](README.md) | **日本語** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ ハイライト

- 🎨 **AI 画像生成、完全無料**：テキスト to 画像、画像 to 画像、テキスト to 動画、画像 to 動画、キーフレームアニメーション —— **Agnes AI + Zhipu** の無料モデル経由で、コストゼロ。
- 📐 **ローカル構造化描画、確定的**：ダイアグラム、チャート、数式、カード、アイコン、QR コード —— **SVG ベクターで高解像度**、AI 呼び出しなし、無限にズームしても鮮明、テキストはくっきり、完全に制御可能。
- 🧠 **ワンメンタルモデル**：「画像を生成して」と伝えるだけで、Claude が AI とローカルエンジンを自動で振り分け、対応する DSL/JSON/LaTeX を生成します。ユーザーの追加手順は**ゼロ**。
- 🌏 **初期状態で洗練された仕上がり**：カードは **CJK を自動サポート**（内蔵 Noto Sans SC、オフライン）、**単色/グラデーション背景**、**カラー絵文字**に対応。ダイアグラムは **D2 と Graphviz の両方**をサポート。
- 🔌 **プラグイン可能**：provider もレンダーエンジンも、ツールレイヤーを一切変えずに拡張可能。モダリティ別のデフォルトルーティング＋レートリミットの自己学習。
- 🆓 **構造化ツールは key 不要**：`claude mcp add` 後、6つのローカルツールがすぐ動きます —— **AI key なしでダイアグラム/チャート/カード/QR コードを描画**できます。
- 🌐 8言語 README · MIT · Node ≥18

---

## 🛠️ 10のツール

### 🤖 AI 生成（オンライン・無料）

| ツール | 機能 |
|---|---|
| `generate_image` | **テキスト to 画像** / **画像 to 画像**（参照画像 → 新画像） |
| `create_video` | **テキスト to 動画** / **画像 to 動画** / **キーフレームアニメーション**（同期/非同期を自動判定） |
| `get_video` | 動画タスクのポーリング＋ダウンロード |
| `list_models` | provider 別のモデルと動画制約を一覧表示 |

### 📐 構造化レンダリング（ローカル・確定的・ほぼ key 不要）

| ツール | 出力 | エンジン |
|---|---|---|
| `generate_diagram` | アーキテクチャ / シーケンス / フローチャート / クラス / ER / マインドマップ | **D2** DSL · **Graphviz** (DOT) |
| `generate_chart` | 棒 / 折れ線 / 円 / 面積 / 散布 | Vega-Lite |
| `generate_formula` | LaTeX 数式（グリフ埋め込み、フォント不要） | MathJax |
| `generate_card` | OG / シェア / 引用カード（デフォルト 1200×630、テンプレート og/quote/minimal/hero/panel、CJK/グラデーション背景/カラー絵文字を自動対応、グラデーションタイトル＋グロー） | Satori + resvg |
| `generate_icon` | 20万種以上のベクターアイコン（`prefix:name`） | Iconify |
| `generate_qrcode` | QR コード | qrcode |

> 6つの構造化ツールのうち **4つは完全オフライン** です（diagram / chart / formula / qrcode）。`generate_card` のデフォルトの Latin フォントは初回のみ CDN から取得され `~/.media-gen-mcp/fonts/` にキャッシュされます（以降はオフライン、または `fontPath` を渡せば即座にオフライン）。CJK フォント（Noto Sans SC）は **バンドル済みでオフライン** です。ただし、カードの **絵文字**（twemoji）と `generate_icon`（Iconify）はネットワークが必要です（キャッシュのみ、バンドルなし）。AI 生成ツールは常にオンラインです。

---

## 🚀 クイックスタート

### ① 無料 key を取得（AI 生成のみ。構造化画像だけならスキップ）

以下のいずれか（または両方）に登録して、無料の API key を取得します。

| Provider | 無料範囲 | 申請 |
|---|---|---|
| **Agnes AI**（デフォルト） | 画像 + 動画すべて無料 | https://platform.agnes-ai.com/ → 新規登録 → API Keys |
| **Zhipu BigModel**（オプション、4K / 中国語対応） | cogview-3-flash 画像 + cogvideox-flash 動画が永久無料 | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → 本人確認 → key 作成 |

> 詳しい手順：[doc/Agnes 登録ガイド](doc/Agnes%20开通指引.md) · [doc/Zhipu 登録ガイド](doc/Zhipu%20开通指引.md)

### ② 設定（初回のみ）

key を記述した `~/.media-gen-mcp/config.json` を作成します。

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Agnes だけでも構いません（zhipu の行は削除してください）。`models` は省略すると組み込みのデフォルトが使われます。

### ③ Claude Code に追加

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

インストールコマンドには **key を含めません**（上記 config に記述済みのため）。`/mcp` を実行し、`media-gen-mcp ✓ Connected` と表示されれば成功です。

---

## 💬 使い方

Claude Code に話しかけるだけ —— **自動でルーティング**されるので、ツール名を覚える必要はありません。

**AI 生成：**

| シナリオ | 話しかける例 |
|---|---|
| デフォルト | 「フォトリアルなオレンジ色の猫を生成して」/「5秒のビーチ動画を生成して」 |
| provider 指定 | 「**Zhipu** で描いて」/「動画は **agnes** で」 |
| model 指定 | 「**cogview-4** で描いて」/「**agnes-video-v2.0** を使って」 |
| 画像 to 画像 / to 動画 | 「この画像を水彩画風にして」/「この画像を動画にして」 |
| キーフレームアニメーション | 「この2枚の画像を滑らかにつないで」 |

**構造化描画：**

| シナリオ | 話しかける例 |
|---|---|
| ダイアグラム | 「アーキテクチャを描いて：client → API gateway → 2つのマイクロサービス」（D2）または「DOT で依存グラフを描いて」（Graphviz） |
| チャート | 「この売上データで棒グラフを作って」 |
| 数式 | 「この数式を描画して：`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`」 |
| シェアカード | 「この記事の **紫から青へのグラデーション** OG カードに 🚀 絵文字を入れて」 |
| アイコン | 「GitHub のロゴアイコンをちょうだい」 |
| QR コード | 「https://... の QR コードを生成して」 |

> provider/model を指定しても、その呼び出しにしか影響せず、**config は変更されません**。ダイアグラムは [D2 記法](https://d2lang.com)/[Graphviz DOT](https://graphviz.org/docs/dot/)、チャートは [Vega-Lite](https://vega.github.io/vega-lite)、数式は [LaTeX](https://www.latex-project.org)、アイコンは [icon-sets.iconify.design](https://icon-sets.iconify.design) —— Claude がソースを自動生成します。

> **Mermaid について**：`generate_diagram` は **D2 と Graphviz** をサポートします。Mermaid のインプロセスレンダリングにはブラウザ/Chromium が必要で（確定的な MCP には不向き）、サポートしていません —— D2（フローチャート/シーケンス/クラス/ER/マインドマップをカバー）または Graphviz を使ってください。

---

## 📡 Providers

| | デフォルト | Image（無料） | Video（無料） | 特徴 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | すべて無料、フォトリアル、ネイティブ音声 |
| **zhipu**（オプション） | | cogview-3-flash | cogvideox-flash | 4K/60fps、ネイティブ中国語、中国コンプライアンス対応 |

切り替え方法：`defaultProvider: "zhipu"`、または `defaultImageProvider`/`defaultVideoProvider` でモダリティ別に指定、もしくは呼び出しごとに `provider` を渡します。どちらを選ぶべきか迷ったら [benchmark](doc/Agnes_vs_Zhipu_横评.md) を参照してください。

---

## ⚙️ Config（高度な設定、通常は不要）

**3段階の provider フォールバック**（呼び出し引数 > モダリティ別 > グローバル）：

| フィールド | デフォルト | 説明 |
|---|---|---|
| `defaultProvider` | `agnes` | グローバルデフォルト（最終フォールバック） |
| `defaultImageProvider` | 同上 | 画像モダリティのデフォルト（`generate_image`） |
| `defaultVideoProvider` | 同上 | 動画モダリティのデフォルト（`create_video`/`get_video`） |

例：`defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → 画像は agnes、動画は Zhipu 経由。

provider 別の接続 config：`providers.<name>.apiKey`（必須）、`providers.<name>.models.{image,video}.default`、`outDir`（出力ディレクトリ、デフォルト `session-dir/output`）。

> レートリミットの自己学習（`rateLimits`/`rateLimitTtlMs` —— 429 で実際のリミットを自動学習＋TTL 期限切れフォールバック）など、その他の高度なフィールドについては [doc/](doc/) を参照してください。

---

## ❓ FAQ

**動画が遅い？** 3〜18秒の動画で約1〜3分かかります。`wait` を省略すると非同期になり（推定60秒超でハンドルを返し、完了時に通知）。
**フレーム数？** `durationSeconds` を渡すと自動選択されます（5/10/18s）。Agnes は 81/121/161/241/441 のみ許可。
**429 が出る？** 62秒のシリアライザを内蔵、実際のレートリミットを自動学習します。
**構造化ツールに key は必要？** いいえ。6つのローカルツールはインストール後すぐ動きます。key が必要なのは AI 生成だけです。
**カードの CJK/絵文字/グラデーションは？** 内蔵 CJK フォント（自動）、twemoji カラー絵文字（自動）。`bg` に CSS の `linear-gradient(...)` を渡せばグラデーションになります。
**カードの派手なエフェクトは？** `titleGradient`（グラデーションタイトル）、`glow`（タイトルのグロー）、`hero` テンプレート（ぼかした奥行きブロブ）、`panel` テンプレート（ガラスパネル：border/radius/shadow）。すべて確定的、Satori によりインプロセスで動作 —— ブラウザ不要。
**config が読み込まれない？** `~/.media-gen-mcp/config.json` に配置する必要があります（npx はキャッシュにインストールされるため、プロジェクト内の config は利用できません）。

---

## 🏗️ アーキテクチャ + ドキュメント

- **provider プラグイン可能**（agnes + zhipu。provider 追加でツールレイヤーの変更は不要）；**エンジンプラグイン可能**（DiagramEngine は MediaProvider と並行稼働、相互汚染なし）。
- 詳しくは [doc/](doc/) を参照：[Agnes 登録ガイド](doc/Agnes%20开通指引.md) · [Zhipu 登録ガイド](doc/Zhipu%20开通指引.md) · [Agnes vs Zhipu benchmark](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 サポート

media-gen-mcp がお役に立ちましたら、作者にコーヒーをおごっていただけると嬉しいです ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

または ⭐ Star、Issue / PR の作成 —— どれでも大歓迎です。

## License

[MIT](LICENSE)
