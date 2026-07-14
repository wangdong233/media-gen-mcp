<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#①-無料-key-を取得)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Claude Code 向けのマルチモーダル画像生成 MCP server**

AI 画像 + 構造化画像、1つのサーバーで完結：text-to-image / image-to-image / text-to-video / image-to-video / キーフレームアニメーション（Agnes AI + Zhipu の無料モデル経由）**+ ダイアグラム / データチャート / QR コード**（ローカル確定描画、key 不要）

[简体中文](README.md) | [English](README.en.md) | **日本語** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português](README.pt.md)

</div>

## ① 無料 Key を取得

以下のいずれか（または両方）に登録して、無料の API key を入手してください。

| Provider | 無料範囲 | 申請 |
|---|---|---|
| **Agnes AI**（デフォルト） | 画像 + 動画 すべて無料 | https://platform.agnes-ai.com/ → 新規登録 → API Keys |
| **Zhipu BigModel**（オプション、4K / 中国語対応） | cogview-3-flash 画像 + cogvideox-flash 動画が永久無料 | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → 本人確認 → key 作成 |

> 詳しい手順：[doc/Agnes 登録ガイド](doc/Agnes%20开通指引.md) ・ [doc/Zhipu 登録ガイド](doc/Zhipu%20开通指引.md)

## ② 設定（初回のみ）

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

## ③ Claude Code に追加

```bash
claude mcp add media-gen-mcp npx media-gen-mcp-server
```

インストールコマンドには **key を含めません**（上記 config に記述済みのため）。`/mcp` を実行し、`media-gen-mcp ✓ Connected` と表示されれば成功です。

## ④ 使い方

Claude Code に話しかけるだけです（適切な provider/model に自動でルーティングされます）。

| シナリオ | 話しかける例 | 結果 |
|---|---|---|
| **デフォルト** | 「リアルな猫の画像を生成して」/「5秒のビーチ動画を生成して」 | defaultImageProvider / defaultVideoProvider を使用 |
| **provider 指定** | 「**Zhipu** で描いて」/「動画は **agnes** で」 | 一時的に provider を切り替え（config は変更されません） |
| **model 指定** | 「**cogview-4** で描いて」/「**agnes-video-v2.0** を使って」 | 特定の model を選択（より高画質など） |
| **provider + model 指定** | 「**Zhipu cogvideox-3** で 4K 動画を」 | 正確な指定（4K / 先頭-最終フレームなど） |
| **image-to-image** | 「この画像を水彩画風にして」 | 参照画像 → 新しい画像 |
| **image-to-video** | 「この画像を動画にして」 | 1枚の画像 → 動画 |
| **キーフレーム** | 「この2枚の画像を滑らかにつないで」 | 複数画像 → 滑らかな変化 |

> 指定を省略すると → デフォルトが使われます。provider/model を指定しても、その呼び出しにのみ影響し、**config は変更されません**。

## ④ ローカル構造化画像（key 不要、確定的）

これらのツールは **AI を一切呼びません**¹ — Claude が DSL/JSON/LaTeX/fields を生成 → ローカルで SVG/PNG（ベクタ・高解像度）に描画：

| ツール | 話しかける例 | 出力 |
|---|---|---|
| **ダイアグラム** `generate_diagram` | 「アーキテクチャを描いて：client → API gateway → 2つのマイクロサービス」 | アーキテクチャ / シーケンス / フローチャート / クラス / ER / マインドマップ（D2 DSL → SVG） |
| **チャート** `generate_chart` | 「この売上データで棒グラフを作って」 | 棒 / 折れ線 / 円 / 面積 / 散布（Vega-Lite → SVG） |
| **数式** `generate_formula` | 「この数式を描画して：`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`」 | LaTeX → SVG（MathJax、グリフ埋め込み、フォント不要） |
| **カード** `generate_card` | 「**紫から青へのグラデーション**背景のシェアカードを作って」 | OG / ソーシャル / 引用カード（Satori → PNG、デフォルト 1200×630、**CJK 自動対応**、**純色/グラデーション背景**） |
| **アイコン** `generate_icon` | 「GitHub のロゴアイコンをちょうだい」 | 20万種以上のアイコンをオンデマンドで（Iconify、`prefix:name`） |
| **QR コード** `generate_qrcode` | 「https://... の QR コードを生成して」 | SVG / PNG（完全ローカル、ネットワークゼロ） |

> ¹ **アイコン**（Iconify API）と**カードのデフォルトフォント**（初回使用時に CDN から取得し、`~/.media-gen-mcp/fonts/` にキャッシュ）以外はすべてローカル & 確定的です。カードを完全にオフラインにするには `fontPath` を渡してください。**カード CJK**：内蔵の Noto Sans SC（オフライン、中国語/日本語/韓国語の自動検出フォールバック）— fontPath 不要。ダイアグラムは [D2 記法](https://d2lang.com)、チャートは [Vega-Lite](https://vega.github.io/vega-lite)、数式は [LaTeX](https://www.latex-project.org)、アイコンは [icon-sets.iconify.design](https://icon-sets.iconify.design) — Claude がソースを自動生成します。

## Providers

| | デフォルト | Image（無料） | Video（無料） | 特徴 |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | すべて無料、フォトリアル、ネイティブ音声 |
| **zhipu**（オプション） | | cogview-3-flash | cogvideox-flash | 4K/60fps、ネイティブ中国語、中国コンプライアンス対応 |

切り替え方法：`defaultProvider: "zhipu"`、または `defaultImageProvider` / `defaultVideoProvider` でモダリティ別に指定、もしくは呼び出しごとに `provider` を渡します。どちらを選ぶべきか迷ったら [benchmark](doc/Agnes_vs_Zhipu_横评.md) を参照してください。

## 📌 Config（高度な設定、通常は不要）

**3段階の provider フォールバック**（呼び出し引数 > モダリティ別 > グローバル）。

| フィールド | デフォルト | 説明 |
|---|---|---|
| `defaultProvider` | `agnes` | グローバルデフォルト（いずれのモダリティも未設定時の最終フォールバック） |
| `defaultImageProvider` | `defaultProvider` と同じ | 画像モダリティのデフォルト（`generate_image` で使用） |
| `defaultVideoProvider` | `defaultProvider` と同じ | 動画モダリティのデフォルト（`create_video` / `get_video` で使用） |

例：`defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → 画像は agnes、動画は Zhipu 経由。後ろ2つのフィールドを省略すると、すべて `defaultProvider` にフォールバックします。

provider 別の接続 config：

| フィールド | デフォルト | 説明 |
|---|---|---|
| `providers.<name>.apiKey` | — | **必須**、provider ごとに1つ |
| `providers.<name>.models.image.default` | provider 組み込み | デフォルトの画像 model |
| `providers.<name>.models.video.default` | provider 組み込み | デフォルトの動画 model |
| `outDir` | session-dir/output | 出力ディレクトリ（呼び出しで上書き可能） |

> レートリミットの自己学習（`rateLimits` / `rateLimitTtlMs`）など、その他の高度なフィールドについては [doc/](doc/) を参照してください。

## FAQ

**動画が遅い？** 3〜18秒、約1〜3分かかります。`wait` を省略すると非同期になり、完了時に通知されます。
**フレーム数？** `durationSeconds` を渡すと自動で選択されます（5/10/18s）。Agnes は 81/121/161/241/441 のみ許可しています。
**429 が出る？** 62秒のシリアライザを内蔵しており、実際のレートリミットを自動で学習します。
**config が読み込まれない？** `~/.media-gen-mcp/config.json` に配置する必要があります（npx はキャッシュにインストールされるため、プロジェクト内の config は利用できません）。

## アーキテクチャ + ドキュメント

provider はプラグイン可能（agnes + zhipu。provider の追加に tool レイヤーの変更は不要）。詳しくは [doc/](doc/) を参照：

- [doc/Agnes 登録ガイド](doc/Agnes%20开通指引.md) ・ [doc/Zhipu 登録ガイド](doc/Zhipu%20开通指引.md) ・ [doc/Agnes vs Zhipu benchmark](doc/Agnes_vs_Zhipu_横评.md)

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
