<div align="center">

# media-gen-mcp

[![npm](https://img.shields.io/npm/v/media-gen-mcp-server?style=flat-square&color=6f42c1)](https://www.npmjs.com/package/media-gen-mcp-server)
[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-無料-key-を取得)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Claude Code に"画像生成スーパー能力"を搭載——ひと言で画像 / 動画 / チャート / カード / QRコードを生成**

AI 画像・動画生成(無料) + 構造化描画(ローカルで決定論的) + リッチ SVG レンダリング(Chrome で高忠実度)

[English](README.en.md) | [简体中文](README.md) | **日本語** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

---

## ✨ 特徴

- 🆓 **完全無料**——AI 画像・動画生成は Agnes AI + 智譜の無料モデルを利用、構造化描画は完全ローカルでコストゼロ
- 🧠 **学習コストゼロ**——自然な言葉で話すだけ、Claude がツール選択、コード生成、画像出力を自動化
- 📐 **決定論的出力**——構造図/チャート/数式/カードは、同じ入力なら常に同じ出力、内容をコントロール可能
- 🇨🇳 **中国語フレンドリー**——カードは中国語を自動レンダリング(内蔵フォント)、智譜モデルは中国語ネイティブ
- 🔌 **他に何もインストール不要**——D2 / Graphviz / Vega / MathJax はすべて同梱、システムに d2/dot/matplotlib のインストール不要
- 🎨 **リッチレンダリング**——feGaussianBlur グロー/グラデーション/被写界深度、自動で Chrome の高忠実度レンダリングを使用
- 🌐 8言語ドキュメント · MIT · Node ≥18

---

## 💬 何ができるようになる?

インストール後、Claude Code で**ひと言**言うだけで:

| 言うこと | 得られるもの |
|---|---|
| "オレンジ猫の武侠リアル画を生成" | 🖼️ AI 生成のリアル画像 |
| "5秒の海辺の動画を生成" | 🎬 AI 生成の短い動画 |
| "アーキテクチャ図を描いて:クライアント → API ゲートウェイ → 2つのマイクロサービス" | 📐 くっきりしたベクターアーキテクチャ図 |
| "この売上データを棒グラフにして" | 📊 データ可視化チャート |
| "この数式をレンダリング `E=mc^2`" | ➗ 高解像度の数式画像 |
| "🚀 emoji 入りグラデーション共有カードを作って" | 🎴 OG / ソーシャル共有画像(中国語対応自動) |
| "GitHub のロゴをちょうだい" | 🏷️ ベクターアイコン |
| "QRコードを生成して" | ▪️ QR コード |
| "カッコいいダークでハイテク感あるアーキテクチャ図を、グロー付きで" | ✨ 高忠実度 Chrome レンダリング画像 |

> **全部ひと言言うだけ。** ツール名もパラメータも覚える必要はありません。

---

## 🚀 クイックスタート

### ① 無料 Key を取得

以下のいずれか(または両方)に登録して、無料 API Key を取得:

| プロバイダー | 無料 | 申請 |
|---|---|---|
| **Agnes AI**(デフォルト) | テキストから画像 + テキストから動画 すべて無料 | https://platform.agnes-ai.com/ → 登録 → API Keys |
| **智譜 BigModel**(オプション、4K / 中国語) | cogview-3-flash 画像 + cogvideox-flash 動画 永久無料 | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → 実名認証 → Key 作成 |

> 詳しい画面手順:[Agnes 登録ガイド](doc/Agnes%20开通指引.md) · [智譜登録ガイド](doc/Zhipu%20开通指引.md)

### ② 設定

新規に `~/.media-gen-mcp/config.json` を作成し、Key を記入:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-あなたのagnes-key" },
    "zhipu": { "apiKey": "あなたの智譜-key" }
  }
}
```

agnes だけの設定でも構いません(zhipu の行を削除)。`models` を記入しなければ内蔵のデフォルトモデルが使われます。

### ③ Claude Code に接続

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

接続コマンドには **Key を含めない**(Key は上記 config に入っています)。`/mcp` で `media-gen-mcp ✓ Connected` と表示されれば成功です。

### ④ ひと言言う

Claude Code で直接「アーキテクチャ図を描いて」や「オレンジ猫のリアル画を生成」と言う——これだけ。

> **構造図/チャート/カード/QRコードだけ描きたい?** Key は不要、インストール(③)するだけで使えます。

---

## 📡 プロバイダー

| | デフォルト | 画像(無料) | 動画(無料) | 特徴 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | 完全無料、リアル質感、ネイティブ音声・映像 |
| **zhipu**(オプション) | | cogview-3-flash | cogvideox-flash | 4K/60fps、中国語ネイティブ、国内コンプライアンス |

切替:`defaultProvider: "zhipu"`、またはモダリティ別に `defaultImageProvider`/`defaultVideoProvider`、または単発で `provider` を渡す。どちらを選ぶか迷う?[横並び比較](doc/Agnes_vs_Zhipu_横评.md) を参照。

---

## 🛠️ 機能詳細

### 🤖 AI 生成(無料モデル · オンライン)

Agnes AI または智譜の無料モデルを使用:
- **テキストから画像 / 画像から画像**——リアル、イラスト、コンセプトアート
- **テキストから動画 / 画像から動画 / キーフレームアニメーション**——スマート非同期(長尺動画はバックグラウンド生成、完了通知)
- ベンダー/モデルを指定:「**智譜 cogview-4** で描いて」/「**agnes** で動画を生成」

### 📐 構造化描画(ローカル · 決定論的 · Key 不要)

以下の機能は **AI を呼び出さず、決定論的に出力**(SVG ベクター高解像度):

| 機能 | エンジン(すべて同梱) | 説明 |
|---|---|---|
| **構造図** | D2 + Graphviz | アーキテクチャ/フロー/シーケンス/クラス図/ER/マインドマップ、自動レイアウト |
| **データチャート** | Vega-Lite | 棒/折れ線/円/面/散布、Claude がデータから自動生成 |
| **数学式** | MathJax | LaTeX → SVG、字形を内包 |
| **共有カード** | Satori | OG/ポスター/引用カード(中国語+グラデーション+emoji+グロー自動) |
| **QRコード** | qrcode | URL/テキスト → SVG/PNG |
| **ベクターアイコン** | Iconify | 20万以上のアイコン(`icon: "mdi:home"`) |
| **リッチ SVG** | Chrome / resvg | 手書き SVG(グロー/フィルター/被写界深度)→ Chrome 高忠実度レンダリング |

<details>
<summary>📖 カードで何ができる?</summary>

- 5種のテンプレート:og(左寄せ階層)/ quote(引用、引用符で左右を挟める)/ minimal(ミニマル)/ hero(大文字展示+光斑)/ panel(ガラスパネル)
- グラデーションタイトル文字 + グロー + ぼかし光斑の奥行き
- ロゴ / 円形 avatar を埋め込み
- 中国語を自動レンダリング(Noto Sans SC オフライン)+ カラー emoji 自動(ディスクキャッシュ、オフラインで使用可)
- カスタムサイズ(デフォルト 1200×630 OG 標準)
</details>

<details>
<summary>📖 リッチ SVG レンダリングとは?</summary>

D2 エンジンは SVG フィルター(feGaussianBlur グロー)をサポートしていないため、「カッコいいダークでハイテク感、グロー、被写界深度」といった効果が欲しい場合は:
1. Claude が手書きで SVG を作成(feGaussianBlur 等のフィルター付き)
2. `render_svg` ツールを呼び出す
3. ツールが自動でバックエンドを選択:`<filter>` が存在 + システム Chrome が利用可能 → Chrome(100% フィルター忠実度)、それ以外 → resvg(92%、軽量)
</details>

<details>
<summary>📖 オフラインについて(どのツールがネット接続が必要?)</summary>

- **完全オフライン**:generate_diagram / generate_chart / generate_formula / generate_qrcode
- **初回オンライン後にキャッシュでオフライン**:generate_card(デフォルトの Latin フォント Inter を初回に CDN から取得し `~/.media-gen-mcp/fonts/` にキャッシュ、CJK フォント Noto Sans SC はすでにオフラインで内蔵、emoji twemoji はディスクキャッシュでオフライン使用可)
- **ネット接続が必要**:generate_icon(Iconify API から取得)、フィルター付き render_svg(Chrome が必要)
- **常にオンライン**:AI 生成ツール(generate_image / create_video)
</details>

---

## ❓ FAQ

**動画が遅い?** 3–18秒で約1〜3分。`wait` を省略すると自動で非同期に(>60秒で handle を返し、完了時に通知)。
**フレーム数?** `durationSeconds` を渡すと自動で選択(5/10/18秒)。Agnes は 81/121/161/241/441 のみ許可。
**429 エラーが出る?** 内蔵の62秒シリアル実行 + 実レート制限を自動で学習。
**構造化ツールに Key は必要?** 不要。インストールするだけで図/チャート/カード/QRコードを描けます。
**カードの中国語/emoji/グラデーションは?** すべて自動:内蔵 CJK フォント + twemoji emoji(ディスクキャッシュ)+ CSS グラデーション背景。
**リッチ SVG?** Claude が手書き SVG(feGaussianBlur グロー付き)→ `render_svg` → Chrome で100%フィルター忠実度。
**Mermaid はサポート?** 非サポート(ブラウザが必要)。D2 で代替(フロー/シーケンス/クラス図/ER/マインドマップをカバー)。
**config が読み込まれない?** `~/.media-gen-mcp/config.json` に配置する必要があります。
**`npx` で接続できない?** フォールバックとしてグローバルインストール:
```bash
npm i -g media-gen-mcp-server
claude mcp remove media-gen-mcp
claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"
```

---

## 🏗️ アーキテクチャ + ドキュメント

- **プロバイダーはプラグイン可能**(agnes + 智譜、プロバイダー追加でもツール層はゼロ改修)、**エンジンもプラグイン可能**(DiagramEngine と MediaProvider は並行、互いに汚染しない)
- [アーキテクチャ要件チェックリスト](doc/架构要求清单.md)——プロジェクトのアーキテクチャ規約(継続保守)
- 詳細は [doc/](doc/) を参照:[Agnes 登録ガイド](doc/Agnes%20开通指引.md) · [智譜登録ガイド](doc/Zhipu%20开通指引.md) · [プロバイダー横並び比較](doc/Agnes_vs_Zhipu_横评.md)

---

## 💝 作者を支援する

media-gen-mcp がお役に立てば、作者にコーヒーをおごっていただけると嬉しいです ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

または ⭐ Star、Issue / PR の提出 —— どれも作者へのサポートです。

## License

[MIT](LICENSE)
