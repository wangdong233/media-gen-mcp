<h1 align="center">media-gen-mcp</h1>

> Claude Code の「画像スイスアーミーナイフ」—— 作画、アイデアの図解、画像の読み取りまで、一言で完了。全部無料。

<p align="center">
  <img src="https://img.shields.io/badge/version-0.13.1-blue">
  <img src="https://img.shields.io/badge/license-MIT-green">
  <img src="https://img.shields.io/badge/MCP-compatible-purple">
</p>

**Claude Code に一度インストールすれば、以降のあらゆる画像作業が一言で終わります。** デザイナーの出図、プログラマーのアーキテクチャ図、運営のシェアカード、経理の請求書テーブル抽出 —— 画像 / 動画生成 + 認識 + 作画 / カード / QRコードまでフルカバー、**完全無料**(無料プロバイダ + ローカルエンジン、入れればすぐ使える)。

毎週何度も画像を作るたびに N 個のツールを入れて N 通りのパラメータを覚えるのは面倒?ここなら一度インストールするだけで、すべての画像シーンを Claude に任せられます。

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | **日本語** | [Português](README.pt.md) | [Русский](README.ru.md)

</div>

## 目次

- [一言言えば、これが手に入る](#一言言えばこれが手に入る)
- [60 秒ではじめる](#60-秒ではじめる)
- [全能力ラインナップ](#全能力ラインナップ)
- [設定ガイド](#設定ガイド)
- [よくある質問](#よくある質問)
- [こんな人に](#こんな人に)
- [作者を応援する](#作者を応援する)
- [License](#license)

---

## 一言言えば、これが手に入る

| 言葉 | 手に入るもの |
|---|---|
| 「サイバーパンクの猫を描いて、ネオンのグロー付き」 | AI 写実画像、`output/` に保存 |
| 「5 秒の海辺の夕日動画を生成して」 | AI 動画 MP4(バックグラウンド生成、完了通知付き) |
| 「アーキテクチャ図を描いて:クライアント → API ゲートウェイ → 注文サービス + 決済サービス」 | ベクタのアーキテクチャ図 |
| 「この売上データを棒グラフにして」 | 高解像度データチャート |
| 「github.com への QR コードを作って」 | ベクタ QR コード |
| 「E=mc² を高解像度の数式にレンダリングして」 | ベクタ数式 |
| 「ダークなグラデーションのシェアカードを作って、タイトルは 7 月の新商品 🚀」 | レイアウト済みのシェアカード(日本語漢字 + 絵文字も自動) |
| 「この請求書スクショのテーブルを認識して」 | そのまま貼れる HTML / Markdown テーブル |
| 「この棒グラフをデータポイントに読み取って」 | 構造化 CSV / JSON |
| 「この画像に何が写っているか描写して」 | 自然言語の回答 |
| 「この 20 ページの PDF 報告書のテキストを全部抽出して」 | 全体テキスト / Markdown / JSON(デジタル版は瞬時、スキャン版は自動でページごとに OCR) |
| 「この契約書スキャンのテキストを抽出して、透かしと赤印章は無視して」 | クリーンなテキスト(透かし / 赤印章 / ヘッダー・フッター領域を自動除外) |
| 「この 2 段組の論文を読む順に 1 つにまとめて」 | 1 段組の連続テキスト(多段読み順を自動復元、行の誤接続を解消) |
| 「今テーブル認識できる?中文 OCR は設定済み?」 | 現在の能力一覧 + ルーティング提案(どれが使える / どれが未設定 / 何を使うべきか) |

> ツール名を覚える必要も、システム依存を入れる必要もありません。**Claude が最適な方法を自動で選んで完了します。**

---

## 60 秒ではじめる

核心の考え方:**作画 / カード / QR コード / 数式はローカルエンジン、画像認識(OCR)もデフォルトでプロセス内フォールバック —— すべて AI を呼ばず、ネットにも繋がず、入れればすぐ使える**。AI 写実画像 / 動画だけが無料 API Key を必要とします —— 「最初の 1 枚」と「最初の 1 回の読み取り」を API 登録より前に済ませられます。

### 30 秒｜一行で接続(Key 不要)

```bash
# 一行でインストール(Key なし、30 秒)
claude mcp add media-gen-mcp npx media-gen-mcp-server

# Claude Code を再起動 → /mcp と入力 → media-gen-mcp ✓ Connected と表示されれば成功
```

### 30 秒｜Key なしで最初の 1 枚を即出品

Claude に一言だけ伝えます:

```
ダークなテック風のシェアカードを作って、タイトル:Claude Code 画像スイスアーミーナイフ
```

→ ベクタ画像が自動で `output/` に保存され、すぐに使えます。**API Key を一つも登録していない時点で、もう結果が手に入ります。**

以下もすべて Key 不要・ネット接続不要で即座に出品できます:

- 「github.com への QR コードを作って」
- 「E=mc² を高解像度の数式にレンダリングして」
- 「アーキテクチャ図を描いて:クライアント → ゲートウェイ → 注文サービス + 決済サービス → データベース、ダークなテック風」
- 「この CAPTCHA 画像の数字を認識して」(OCR、デフォルトはプロセス内、何も追加インストール不要)
- 「このスクショの英語テキストを抽出して」

### 中文 SOTA 画像認識 / 画像 QA が欲しい?智谱 GLM Key を 1 行設定(ゼロデプロイ、任意)

デフォルト軽量エンジンは英語 / 数字には十分ですが、中文の精度は一般です。**PaddleX / vLLM をセルフホストせずに、中文 SOTA + 複雑テーブル + 画像 QA が欲しい?** 智谱 GLM Key を 1 行設定するだけ —— クラウドの **GLM-4.6V-Flash は永久無料**、ゼロデプロイ、ローカルリソース消費なし:

```bash
# ① https://open.bigmodel.cn/console/apikey で無料アカウント登録 + api_key 申請(形式 {id}.{secret})
#    注意:open.bigmodel.cn の標準 key のみ受け付けます。Code Plan key(ZAI_API_KEY)は使用不可 ——
#          Z.ai エンドポイント + ホワイトリストツール(Claude Code / Cline / Cursor など計 9 種、media-gen-mcp は含まず)に紐付けられており、
#          違反呼び出し 3 回でアカウント停止、サブスク費用も返金されません

# ② ~/.media-gen-mcp/config.json に記述
{
  "providers": {
    "glm-vision": { "apiKey": "あなたの{id}.{secret}" }
  }
}

# ③ Claude Code に戻って:「この中文の請求書スクショのテーブルを認識して」/「この画像に何人いる?何をしている?」
#    → 中文 SOTA 認識 + 画像 QA、保存 / 直接回答
```

> 設定後、MCP は自動的にフォールバックチェーンに組み込みます:**paddle → glm-vision → vlm → tesseract**。いずれかの段階が一時的にダウンすると自動的にダウングレード、あなたは何も感じません。詳しくは[設定ガイド · 段階 2](#段階-2智谱-glm-46v-flashクラウド無料ゼロデプロイ中文-sota--vqa)を参照。

### AI 写実画像 / 動画が欲しい?無料 API Key を追加(任意)

```bash
# ① 無料 API Key を取得(推奨は Agnes、デフォルトプロバイダ)
#    https://platform.agnes-ai.com/ → 登録 → API Keys → sk-xxx をコピー
#    (智谱 cogview-3-flash / cogvideox-flash も永久無料、どちらか一方でも両方でも可)

# ② ~/.media-gen-mcp/config.json に記述(1 社だけでも OK)
{
  "providers": {
    "agnes": { "apiKey": "sk-あなたのagnes-key" }
  }
}

# ③ Claude Code に戻って:「サイバーパンクのオレンジ猫を描いて、写実風」
#    → AI 写実画像が保存されます。動画も同様:「5 秒の海辺の夕日動画を生成して」
```

> npx を使いたくない?グローバルインストールでも OK:まず `npm i -g media-gen-mcp-server`、その後 `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`。

---

## 全能力ラインナップ

> やりたいことを Claude に伝えるだけで、最適な方法を自動で選んで完了します。以下は「やりたいこと」別のグループ分けです —— 裏側のツール名を知る必要はありません。

### 1 枚の画像を作る(ゼロから)

**写実写真やイラストを描く**
> あなた:「サイバーパンクのオレンジ猫を描いて、ネオングロー、写実風」
> 手に入るもの:`output/` に保存された写実画像(イラスト / プロダクト概念図 / ラフ Logo / SF シーンも対応)

**一言や 1 枚の画像をショート動画に**
> あなた:「5 秒の海辺の夕日動画を生成して」
> 手に入るもの:MP4 動画(3–18 秒、長尺はバックグラウンド生成、完了後に取得通知)

**アイコンやブランド Logo を取得**
> あなた:「GitHub の Logo を取得して、128 ピクセルで」
> 手に入るもの:20 万件以上のアイコンライブラリからベクタ Logo、即ダウンロード(GitHub / Twitter / Material / Lucide / Font Awesome など)

**AI 生成画像のプロンプトとパラメータを逆引き**
> あなた:「この画像、どんなプロンプトとパラメータで生成された? 再現できる?」
> 手に入るもの:構造化パラメータ —— ポジティブ/ネガティブ prompt・モデル・サンプリングステップ・CFG・シード・サイズ(PNG に埋め込まれた ComfyUI/A1111 メタデータをローカル解析;Agnes 生成画像は完全な生成パラメータを保持 —— prompt を取り出して generate_image でワンクリック再現)

### Google Flow プロバイダ(Veo 3.1 / Nano Banana —— API Key 不要、画像生成 0 クレジット)

**ローカル Chrome の Google Flow ログイン状態を借りてそのまま画像 / 動画を生成**(Google Labs の [labs.google/fx/tools/flow](https://labs.google/fx/tools/flow))—— API Key は一切不要で、Agnes / 智谱の無料枠も消費しません。成果物は自動で保存され、後から管理できる `mediaId` が付きます。

**前提条件(一度だけ)**:ローカル Chrome で Flow にログイン済みであること。

```bash
lasso launch-chrome --port 9223 --mode visible
# lasso 未導入なら:npm i -g lasso-mcp
# 開いた Chrome で https://labs.google/fx/tools/flow を開いてログイン。以降は Chrome を起動したままにするだけ
```

Chrome が動いていない / 未ログインの場合、ツールは**構造化エラーコード + ガイド**を返します(S100 = Chrome に接続できない、S101 = Flow のページが開いていない)。指示に従って一度起動すれば完了。黙って失敗したり、勝手に別プロバイダへ切り替わったりしません。

**以下はすべて 0 クレジット(安心して利用可)**:

- **画像生成**:Nano Banana Pro / Nano Banana 2(デフォルト)/ Nano Banana 2 Lite。比率は 16:9 / 9:16 / 1:1 / 3:4 / 4:3、seed 再現可、ベース画像による編集 + 参考画像最大 10 枚に対応
- **アップスケール**:画像の 2K アップスケール(model=`GEM_PIX_2_UPSAMPLE_2K`)、動画の 1080p アップスケール(model=`veo_3_1_upsampler_1080p`)
- **アセット管理**:画像アップロード、一括削除、公開シェアリンク作成(`labs.google/fx/tools/flow/shared/…`)、生成中の動画のキャンセル、クレジット / メディア状態の照会(`flow_status`)。30 種のプリセット音声は `flow_status` スナップショットの `preset_voices` で参照可能

**動画はクレジット課金(1 本ごと、送信前に確認を)**:

| モデル | key 例 | クレジット/本 |
|---|---|---|
| Omni Flash(abra)テキスト/画像/参考画像 | `abra_t2v_4s` / `abra_i2v_8s` / `abra_r2v_10s` … | 7 / 10 / 12 / 15(長さ 4/6/8/10 秒) |
| Omni Flash 動画編集(V2V) | `abra_edit` | 20 |
| Veo 3.1 Lite(延長・最初と最後のフレームを含む) | `veo_3_1_t2v_lite` / `veo_3_1_extension_lite` … | 10 |
| Veo 3.1 Fast | `veo_3_1_t2v_fast` … | 20 |
| Veo 3.1 Quality | `veo_3_1_t2v` … | 100 |
| 動画 1080p アップスケール | `veo_3_1_upsampler_1080p` | **0** |

1 回の呼び出しで 1 本。長さは 4 / 6 / 8 / 10 秒、比率は 16:9 / 9:16 のみ。モード:テキストから動画(t2v)、画像から動画(`image`、アップロードは 0 クレジット)、参考画像から動画(`images`、1〜10 枚)、最初と最後のフレーム(`keyframes`、ちょうど 2 枚)、延長(`videoMediaId`)、編集(`videoMediaId` + 編集指示。wire は確定済みだが実際の送信は未検証 —— レスポンスに警告が付きます)、アップスケール(`videoMediaId`)。

**使い方(明示的に `provider="flow"`)**:

```
「Flow でサイバーパンクの猫を 3:4・seed 42 で描いて」          → generate_image(provider="flow", aspect="3:4", seed=42)
「Flow で 8 秒の近未来都市フライオーバー動画を生成」            → create_video(provider="flow", model="abra_t2v_8s")   ← 初回はポイント見積り + 確認トークンを返すだけ;同じ引数 + confirmToken で再呼び出しすると実際に送信
「Flow のクレジット残高 / この mediaId はできた?」            → flow_status() / flow_status(mediaId=…)
```

**`flow_status` 内省ツール(終始 0 クレジット)**:引数なしで全体スナップショット —— ログインアカウント、クレジット残高、動的なモデルカタログ(key ごとの参考所要時間付き)、30 種のプリセット音声、プロジェクトのメディア一覧。`mediaId` 指定なら 1 件の状態を追跡し、完成した素材をダウンロード(`thumbnail=true` で動画サムネイル)。`deleteMediaIds` で一括削除、`shareMediaIds` で公開シェアリンク作成、`cancelMediaIds` で生成中の動画をキャンセル(画像はキャンセル不可)。

> **クレジットのレッドライン**:Flow の動画はクレジットを消費するため、**デフォルトでは絶対に自動ルートしません** —— `videoProviderPriority` に明示的に書く(クレジットは自己負担、起動時に強い警告が出ます)か、毎回明示的に `provider="flow"` を渡すか、どちらかです。画像を無料で全自動にしたい場合は `imageProviderPriority` の先頭に `flow` を置くだけで OK(下の「設定ガイド」参照)。

### 1 枚の画像 / 1 部の PDF を理解する(画像とドキュメントをデータに)

**スクショからテキストを抽出**
> あなた:「この CAPTCHA の数字を読み取って」
> 手に入るもの:プレーンテキスト(CAPTCHA / 請求書番号 / スキャン書類 / チャット履歴なども抽出可能)

**テーブル画像を HTML / Markdown に**
> あなた:「この請求書スクショのテーブルを認識して」
> 手に入るもの:そのまま貼れる Markdown テーブル(請求書 / 帳票 / スキャン書類の手動打ち直しが不要に)

**チャートから元のデータポイントを逆算**
> あなた:「この棒グラフをデータに読み取って」
> 手に入るもの:CSV / JSON 構造化データ(棒 / 折れ線 / 円グラフすべて対応)

**画像を平易な言葉で解説**
> あなた:「この画像に人は何人いる?何をしている?」
> 手に入るもの:自然言語の回答(画像 QA / 手書き / 数式 / 複雑シーン理解)

**PDF 全体のテキストを抽出**
> あなた:「この 20 ページの PDF 報告書のテキストを全部抽出して、Markdown で出力」
> 手に入るもの:全体テキスト / Markdown / JSON —— デジタル版 PDF はテキスト層を直接抽出して瞬時に完了、スキャン版は自動でページごとにレンダリング + OCR。ページ範囲指定(`3` / `1-10` / `odd` / `last`)、透かし / ヘッダー・フッター領域の除外、複数ページの結合 / ページ分割出力に対応。長いドキュメントはバックグラウンドで処理し、完了時に通知します(請求書 / 契約書 / 財務諸表 / 論文 / スキャン書籍すべて対応)

**画像認識 / PDF 読み取りの結果をよりクリーンで自然に**
> あなた:「この契約書スキャンのテキストを抽出して、**透かしと赤印章は無視して**」「この 2 段組の論文を**読む順にまとめて**」
> 手に入るもの:クリーンで連続的なテキスト —— 2 つのスイッチがすべての画像認識 / PDF 抽出で利用可能:
> - **除外領域**:透かし / 赤印章 / ヘッダー・フッター / 表ヘッダー領域を囲んで指定すると、認識結果から自動的に除外。契約書 / 証明書 / スキャン書類がもう透かしで潰されることはありません
> - **多段読み順**:論文 / 新聞 / 履歴書 / 2 段組 / 3 段組のレイアウトを自動的に人間の読む順序で 1 段組の連続テキストに結合、もう行が交錯して崩れることはありません

**「私が入れた認識サービスで何ができるか」を事前に確認**
> あなた:「今テーブル認識できる?中文 OCR は設定済み?手書き認識は使える?」
> 手に入るもの:現在の能力一覧 —— 3 段階の認識サービスのうちどれが設定済み / どれが未設定 / どれがクールダウン中やエラー発生中か、そして「テーブル認識にはどれを使うべき、手書き認識にはどれを使うべき」というルーティング提案。**事前に一言確認するだけで、呼び出してからエラーに直面するのを回避**

### アイデアを図で表現する(Key 不要、入れればすぐ使える)

**構造化ダイアグラムを描く**
> あなた:「アーキテクチャ図を描いて:クライアント → API ゲートウェイ → 注文サービス + 決済サービス → データベース」
> 手に入るもの:ベクタのアーキテクチャ図(フローチャート / シーケンス図 / クラス図 / ER 図 / マインドマップも対応)

**インタラクティブ HTML 図を描く**(ブラウザで開いて操作;辺のデータフロー + ノードアニメーション、テーマはシステムのライト/ダークに追従)
> あなた:「README に埋め込んで、ダーク/ライト閲覧者それぞれに自動対応するアーキテクチャ図を描いて」
> 手に入るもの:単一 HTML ファイル(D2 デュアルパレット + ビューア、パン / ズーム / テーマ切替 / SVG 書き出し)

**ネスト(ドリルダウン)アーキテクチャ図を描く**(ブラウザで開き、レイヤーをクリックしてサブアーキテクチャへ、パンくずで任意の先祖へ戻る)
> あなた:「このシステムをネストアーキテクチャ図で:最上位 5 モジュール、『注文サービス』をクリックして内部へ、さらに作成注文のシーケンス図へ」
> 手に入るもの:単一 HTML ファイル(レイヤーをクリック → そのレイヤーの内部アーキテクチャへ切替、レイヤーは何層でもネスト可能、各層はアーキテクチャ/シーケンス/クラス/ER/フローチャート、パンくずか Esc で任意の先祖へ戻る、URL ハッシュで特定層へ直接リンク、テーマはシステムのライト/ダークに追従)

**データをチャートに可視化**
> あなた:「この売上データを棒グラフにして」
> 手に入るもの:高解像度データチャート(棒 / 折れ線 / 円 / 面積 / 散布図、数値の羅列でも CSV でも OK)

### カード / ポスター / QR コード作成(見栄え良く公開)

**シェアカード / OG 画像 / 引用カード / カバー / ポスターを作る**
> あなた:「ダークなグラデーションのシェアカードを作って、タイトルは 7 月の新商品 🚀」
> 手に入るもの:美しくレイアウトされたカード(タイトル、サブタイトル、グラデーション、グロー、カラー絵文字、Logo 埋め込みすべて自動、日本語漢字も文字化けなし)

**QR コードを生成**
> あなた:「github.com への QR コードを作って」
> 手に入るもの:ベクタ QR コード(URL / テキストどちらでも、ポスター印刷でも鮮明)

**数式を高解像度画像にレンダリング**
> あなた:「E=mc² を高解像度の数式にレンダリングして」
> 手に入るもの:ベクタ数式(LaTeX、複雑な分数、化学方程式も対応)

### クールなモーション / テック感のあるグラフィックス(同入力なら常に同出力)

**SVG を高解像度 PNG にレンダリング**
> あなた:「グロー、星空、奥行き感のあるテック風背景を描いて」
> 手に入るもの:クールな PNG、最適なレンダリング方式を自動選択して高品質を保持

**HTML / CSS アニメーションを動画に**
> あなた:「3 秒のプロダクトイントロアニメーションを作って、グラデーション + パーティクル」
> 手に入るもの:MP4 / GIF / WebM 動画(プロダクトイントロ / ブランドアニメ / モーションデモ、フレーム単位でレンダリング、同入力なら常に同出力)

> **ワンポイント**:画像生成 / 読み取りはネット接続の AI を利用、作画 / カード / QR コード / アニメーションはローカルエンジンです —— **入れればすぐ使える、ベクタで高解像度、同じ入力なら必ず同じ結果**。

---

## 設定ガイド

> 一言で言うと:**構造化能力(作画 / チャート / カード / QR コード / 数式)はゼロ設定ですぐ使え、AI 生成は API Key を 1 行、画像認識はデフォルトでゼロ設定、中文 SOTA / テーブル / チャート読み取りが必要な場合だけセルフホストします。** 使いたい能力が何を設定すべきかを決めます —— すべてを設定する必要はありません。

### 「やりたいこと」別の設定一覧

| やりたいこと | 必要な設定 | 設定後すぐに使える |
|---|---|---|
| アーキテクチャ図 / データチャート / カード / QR コード / 数式を描く | **何も設定不要** | ローカルエンジン、入れれば即利用 |
| AI 写実画像 / AI 動画(文生図、文生動画) | 無料 API Key を 1 社設定(Agnes または智谱、どちらか一方) | ネット接続で生成、`output/` に保存 |
| Google Flow で画像生成(0 クレジット)/ Flow 資産の管理 | **Key 不要**:ローカル Chrome で Flow にログインするだけ(`lasso launch-chrome` で起動) | 画像 / アップスケール / アップロード / 削除 / シェア / キャンセル / 照会はすべて 0 クレジット。動画はクレジット制(1 本 7〜100) |
| OCR テキスト認識(英語 / CAPTCHA / 数字 / 簡単な書類) | **何も設定不要** | デフォルトはプロセス内の軽量エンジン、入れれば即利用 |
| 中文 OCR / 請求書テーブル / チャート読み取り / 画像 QA / 手書き / 数式 | **智谱 GLM Key を 1 行**(ゼロデプロイ、クラウド永久無料)**または** PaddleX / vLLM をセルフホスト | GLM Key を設定すればすぐ利用可、セルフホストはサービス起動後に baseUrl を 1 行記述 |
| **PDF テキスト抽出**(デジタル版 / スキャン / 複数ページ) | 依存パッケージを 2 つインストール `npm i pdfjs-dist @napi-rs/canvas`(初回 PDF 利用時にインストール) | デジタル版 PDF は瞬時、スキャン版は上記 OCR 段階に従います(デフォルトゼロ設定でも駆動可) |
| **透かし / 赤印章 / ヘッダー・フッター除去、多段読み順を復元** | **何も設定不要** | 画像認識 / PDF ツール呼び出し時に「透かしは無視して」「読む順にまとめて」と伝えるだけで自動適用 |
| **現在の認識能力を確認**(どれが使える / どれが未設定) | **何も設定不要** | 直接質問すれば、Claude が現在の能力一覧 + ルーティング提案を返します |

---

### 一、生成系設定(AI 画像生成 / 動画)

**デフォルトプロバイダ:Agnes**(無料枠は永久有効、文生図 + 文生動画すべて開放)。智谱は代替(中文シーンでネイティブ最適化)。

**1 社設定すれば十分**(以下は完全な `config.json`、1 社だけでも OK):

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-あなたのagnes-key" },
    "zhipu": { "apiKey": "あなたの智谱-key" }
  },
  "defaultProvider": "agnes",
  "outDir": "/absolute/path/to/output"
}
```

**無料 API Key の取得方法**:

- **Agnes**(推奨、デフォルト):https://platform.agnes-ai.com/ → 登録 → API Keys → `sk-xxx` をコピー
- **智谱**:https://open.bigmodel.cn/ → 登録 → API Keys(無料モデル:`cogview-3-flash` / `cogvideox-flash`、永久無料)

**2 社設定でさらに安定**:どちらかが一時的にダウン(レート制限 / サービス変動)しても、もう一方が自動でカバー。あなたは何も感じず、二重課金も発生しません。

**プロバイダ優先チェーン(任意、1 行で画像生成を Google Flow の無料枠へ)**:`config.json` に `imageProviderPriority` / `videoProviderPriority` を追加 —— 順序付きの `[先頭, ...フォールバック]` リストです。先頭が失敗(レート制限 / 5xx)するか、環境が整っていない(例:Flow にはローカル Chrome の CDP セッションが必要)場合、チェーンは**順番に自動フォールバック**します。利用者は意識しません:

```json
{
  "imageProviderPriority": ["flow", "agnes", "zhipu"],
  "videoProviderPriority": ["agnes", "zhipu"]
}
```

- **画像は flow 優先**:Flow の画像生成は 0 クレジット。Chrome が未起動 / 未ログインなら agnes → zhipu へ自動フォールバック(プローブには 60 秒のサーキットブレーカーがあり、リトライ嵐は起きません)。`provider=flow` を明示指定するとそのプロバイダに固定 —— エラーを直接返しフォールバックなし(固定は opt-in プロバイダのみ有効。無料プロバイダ(agnes/zhipu)を明示指定した場合は失敗しても警告付きでチェーン回落します)。
- **動画はデフォルトで agnes 優先**(無料)。Flow の動画はクレジットを消費するため、**意図的にデフォルトルーティングから外しています** —— `videoProviderPriority` に明示的に書く(クレジットは自己負担)か、毎回 `provider="flow"` を渡すか、どちらかです。
- 両方未設定なら現行挙動のまま(デフォルトプロバイダ + agnes/zhipu 無料枠の相互フォールバック)。影響ゼロ。環境変数でも同等:`MEDIA_IMAGE_PROVIDER_PRIORITY="flow,agnes,zhipu"` / `MEDIA_VIDEO_PROVIDER_PRIORITY="agnes,zhipu"`。
- **チャネルのオン/オフ = 優先チェーン(チェーンこそがスイッチ)**:有効かどうかは 2 本の優先チェーンに含まれるかだけで決まります —— **未設定 = 無効**(自動ルーティングもフォールバックもしない)、**記載 = 有効**(チェーン先頭 = デフォルトプロバイダ)。単独の `flow.enabled` スイッチは不要(サポートも終了)。明示的な `provider="flow"` 呼び出しは常に合法で、環境が使えない場合は構造化された `[flow] S1xx` 事前チェックエラー(起動ガイド付き)を返します —— プロバイダの無言切り替えは決してしません。関連ノブ `"flow": { "toolDeadlineMs": 110000 }` は、Flow の長時間操作(画像ポーリング / 動画サブミット / ダウンロード)の上限で、スタール防止ルール(1 回 ≤120s)を遵守;タイムアウト時は `[flow] S410` を返します —— 底側の操作はキャンセルされず、後で `flow_status(mediaId)` で確認・保存できます。
- **課金確認ゲート(二段階、デフォルト ON)**:動画が Flow にルーティング/明示指定された場合、最初の `create_video` は送信せず `{needConfirm:true, estimatedCost(ポイント見積り:動的 creditMapping 優先 / 静的テーブルで代替), confirmToken, expiresInSeconds}` を返します。同じ引数 + `confirmToken` で再呼び出しすると実際に送信。トークンは短命(デフォルト 10 分、`flow.confirmTtlMs` / env `FLOW_CONFIRM_TTL_MS` で調整可能)で「モデル+尺+見積り+プロンプト+入力参照(image/keyframes/images/videoMediaId)」にバインド —— 確認後にこれらを変えると新しいトークンが必要です。誤トークンは `[flow] S320`、期限切れは `[flow] S321`。無料操作(`veo_3_1_upsampler_1080p` など)と Flow 以外のプロバイダは本ゲートをトリガーしません。オフにするには `"flow": { "videoConfirm": false }`(デフォルト `true` —— 誤発火は往復 1 回の損、見逃しは実クレジット消費)。

**Flow 資産管理(すべて 0 クレジット)**:`flow_status` はクレジット / メディア状態 / ダウンロードに加え、3 つの無料操作に対応 —— `shareMediaIds=[…]` は公開シェアリンクを作成(`labs.google/fx/tools/flow/shared/image/<id>` 形式、プロンプト付き)、`cancelMediaIds=[…]` は生成中の動画をキャンセル(注意:画像ジョブはキャンセル不可)、`deleteMediaIds=[…]` はメディアを一括削除。また、30 種のプリセット音声は `flow_status` スナップショットの `preset_voices` フィールドで参照できます。

**設定ファイルの場所**:`~/.media-gen-mcp/config.json`(macOS / Linux)、または `%USERPROFILE%\.media-gen-mcp\config.json`(Windows)。

> このファイルが**なくてもクラッシュしません** —— 構造化能力とデフォルト OCR は正常に動作、AI 生成だけが呼べなくなります。

---

### 二、認識系設定(画像認識 / OCR / テーブル / チャート / ビジュアル理解)

認識能力は**4 段階**で、必要に応じて選択、デフォルトで第 1 段階が使えます。

#### 段階 1:デフォルト軽量エンジン(ゼロ設定、入れればすぐ使える)

- **対応内容**:英語 / 数字 / CAPTCHA / 簡単な書類の OCR
- **サービス設置の要否**:**不要**、WASM 形式で MCP プロセスに同梱、初回呼び出し時に自動で言語モデルをロード
- **最小リソース要件**:
  - CPU:任意(純 CPU 駆動、GPU 依存なし)
  - GPU:不要
  - メモリ:約 200–500MB(画像サイズに応じて変動)
  - ディスク:約 30–50MB(WASM エンジン + 言語パック)
  - モデルサイズ:上記ディスク使用量に含む(英語言語パック、数 MB 級)
- **速度**:1 枚あたり約 3–5 秒
- **想定ユーザー**:軽量 OCR シーンの 90%、海外書類、CAPTCHA 認識

> ほとんどのユーザーはこの段階で十分、以下の 3 段階は任意の強化です。

#### 段階 2:智谱 GLM-4.6V-Flash(クラウド無料、ゼロデプロイ、中文 SOTA + VQA)

- **対応内容**:中文 OCR(SOTA 級)、複雑テーブル(多段ヘッダー / セル結合)、チャート分析、画像 QA(VQA)—— 全 4 タスク、クラウドの GLM-4.6V-Flash で提供
- **サービス設置の要否**:**不要**、智谱オープンプラットフォームのクラウド API。アカウント登録して api_key を取得するだけ
- **最小リソース要件**:**ゼロ**(純 HTTP 呼び出し、CPU / GPU / ディスクへの負荷なし)
- **速度**:1 枚あたり約 1–3 秒(クラウド、ネットワーク往復含む)
- **費用**:**GLM-4.6V-Flash は永久無料**(128K コンテキスト + 32K 出力)、GLM-4-Flash テキストの無料戦略と同等
- **想定ユーザー**:中文 SOTA + VQA が欲しいが **PaddleX / vLLM をセルフホストしたくない**ユーザー。段階 3/4 のセルフホストサービスのデプロイハードルを完璧に補完
- **設定方法**:[open.bigmodel.cn](https://open.bigmodel.cn/console/apikey) で無料アカウント登録 + api_key 申請(形式 `{id}.{secret}`)、`config.json` に追加:

  ```json
  {
    "providers": {
      "glm-vision": { "apiKey": "あなたの{id}.{secret}" }
    }
  }
  ```

  デフォルトモデルは `glm-4.6v-flash`。`providers["glm-vision"].model` で `glm-4v-flash`(無料軽量)や有料ビジュアルモデル(`glm-4.6v` / `glm-ocr` など)に変更可能。設定後、MCP は自動的にフォールバックチェーンに組み込みます:**paddle(10)→ glm-vision(9)→ vlm(8)→ tesseract(1)**。

- ⚠️ **コンプライアンス注意事項**(重要):
  - **open.bigmodel.cn の標準 api_key** のみ受け付けます。**Code Plan key(ZAI_API_KEY)は使用不可** —— Z.ai 専用エンドポイント + 9 種のホワイトリストツール(Claude Code / Cline / Cursor など、media-gen-mcp は含まず)に紐付けられており、違反呼び出し 3 回でアカウント停止、サブスク費用も返金されません
  - 複数 key のローテーション(`apiKeys: ["k1", "k2", ...]`)は技術的にサポートされますが、**智谱 User Agreement §2/§3 は複数アカウント / アカウント共有を禁止**しています —— 複数 key のローテーションは契約違反の可能性があり、プラットフォームはアカウント停止の権利を有します。すべての key がコンプライアンス遵守の自前アカウントであることを確認してください

#### 段階 3:PaddleX / PP-StructureV3(中文 SOTA + テーブル認識)

- **対応内容**:中文 OCR(デフォルトエンジンより大幅に高精度)、レイアウト分析、**請求書 / 帳票 / スキャン書類 → HTML/Markdown テーブル**、チャート読み取り
- **サービス設置の要否**:**必要**、PaddleX REST サービスをセルフホスト、MCP が `baseUrl` 経由で呼び出し
- **最小リソース要件**(実測):

  | モード | 最低要件 | 推奨 | 備考 |
  |---|---|---|---|
  | GPU モード | RTX 3060 12GB VRAM | RTX 3060 12GB / Tesla T4 | モデルロード約 2.4GB、複雑 PDF 処理のピークは約 6GB |
  | CPU モード | 4 コア CPU + 8GB メモリ | 8 コア + 16GB メモリ | 駆動可能(軽量書類なら利用可)、バッチ / 複雑 PDF は 3–5 倍明らかに遅い |
  | ディスク | 約 3GB | 約 5GB | paddlepaddle + paddlex + モデル重み |
  | モデルサイズ | 約 100–300MB(単 pipeline) | — | 複数 pipeline は加算 |

- **CUDA 要件**:Compute Capability ≥ 7.0(V100 / T4 / RTX 20/30/40 系、50 系は現時点で完全未対応)、GPU 加速には CUDA 11.8 + cuDNN 8.9 + TensorRT 8.6 が必要
- **インストール方法**:

  ```bash
  pip install paddlex paddlepaddle          # GPU 版:paddlepaddle-gpu
  paddlex --serve --pipeline PP-StructureV3.yaml --port 8080
  ```

  その後 `config.json` に 1 行追加:

  ```json
  {
    "providers": {
      "paddle": { "baseUrl": "http://127.0.0.1:8080" }
    }
  }
  ```

#### 段階 4:vLLM + Qwen2.5-VL(汎用ビジュアル理解 VLM)

- **対応内容**:画像 QA、手書き認識、数式認識、複雑シーンの自然言語描写 —— PaddleX が対応できない「理解系」タスク
- **サービス設置の要否**:**必要**、vLLM 推論サービスをセルフ構築
- **最小リソース要件**(実測):

  | モード | 最低要件 | 推奨 | 備考 |
  |---|---|---|---|
  | GPU フル精度 7B(FP16) | 16GB VRAM | **24GB VRAM**(RTX 3090 / 4090 / A5000) | モデル重み約 15–16GB + KV cache、vLLM はデフォルトで VRAM の 90% を占有 |
  | GPU 量子化 7B(INT8/AWQ) | 10–12GB VRAM | 16GB VRAM | 量子化版なら RTX 4080 / 4060 Ti 16GB にも収まる |
  | GPU 軽量版 3B | 6–8GB VRAM | GTX 1660 / 3060 6–8GB | FP16 で約 6–8GB、INT4 で約 3–4GB、個人開発者のスイートスポット |
  | CPU モード | 非推奨 | — | 駆動するが 5–10 倍遅い、本番環境では GPU を推奨 |
  | メモリ | 16GB | 16–32GB | — |
  | ディスク | 約 14GB(7B 重み) | — | 3B は約 6GB |
  | CUDA 要件 | Compute Capability ≥ 7.0 | — | Tesla T4(7.5)以上、V100 / A100 / RTX 30/40 系いずれも可 |

- **インストール方法**:
  ```bash
  pip install vllm
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct --port 8000
  # "Uvicorn running on http://0.0.0.0:8000" と表示されれば準備完了
  ```
  その他のパラメータ(GPU 選択 / 量子化バージョン / 同時接続上限)は [vLLM 公式ドキュメント](https://docs.vllm.ai)を参照。その後 `config.json` に追加:

  ```json
  {
    "providers": {
      "vlm": { "baseUrl": "http://127.0.0.1:8000" }
    }
  }
  ```

##### 応用:Unlimited-OCR 長文書解析(SGLang/vLLM セルフホスト)

段階 4 のデフォルト Qwen2.5-VL は汎用 VLM(画像 QA / シーン描写に強い)。欲しいのが**長文書 OCR / 複雑テーブル / 複数ページ PDF の一括解析**(単図で数千〜数万文字)なら、[baidu/Unlimited-OCR](https://github.com/baidu/Unlimited-OCR)(MIT、Deepseek-OCR ラインを一歩前進)に切り替え。**訓練分布は 2 単語プロンプトのみ** `document parsing.` で、長出力は `custom_logit_processor`(DeepseekOCRNoRepeatNGram)により退化を防止 —— Qwen2.5-VL とは異なるクラスのツールです。

**Unlimited-OCR を設定すると、`vlm` プロバイダは全 4 タスクを自動的に開放**(extract-text / extract-table / describe-image / analyze-chart)。`extract-text` / `extract-table` は README の単図契約ショートプロンプトを使用し、`describe-image`(VQA)と `analyze-chart`(JSON 抽出)は元の長いプロンプトのまま —— プロンプト override を手書きする必要はなく、MCP がモデルに応じて自動選択します。

**デプロイ(SGLang を推奨 —— `custom_logit_processor` の全機能をサポート)**:

```bash
# イメージをプル(詳細は Unlimited-OCR README を参照)
docker pull vllm/vllm-openai:unlimited-ocr          # デフォルト CUDA 13.0
# Hopper GPU の場合は cu129 を使用:
# docker pull vllm/vllm-openai:unlimited-ocr-cu129

# SGLang サーバーを起動(主要パラメータの説明は Unlimited-OCR README「SGLang」節を参照)
python -m sglang.launch_server \
  --model baidu/Unlimited-OCR \
  --served-model-name Unlimited-OCR \
  --attention-backend fa3 --page-size 1 \
  --mem-fraction-static 0.8 --context-length 32768 \
  --enable-custom-logit-processor \
  --host 0.0.0.0 --port 10000
```

`custom_logit_processor` は Python 側の `DeepseekOCRNoRepeatNGramLogitProcessor.to_str()` の文字列化出力(SGLang プライベートの直列化フォーマット、TS 側では合成不可)。**デプロイ時に一度だけ実行**して文字列を取得し、`config.json` に貼り付け:

```bash
# sglang をインストール済みの Python 環境で以下の 1 行を実行:
python -c "from sglang.srt.sampling.custom_logit_processor import DeepseekOCRNoRepeatNGramLogitProcessor as P; print(P.to_str())"
# 1 行の長い文字列が出力されるので、下記 config.json の custom_logit_processor フィールドにコピー
```

**config.json の例**(`vlm` を Unlimited-OCR に切り替え + `extra_body` 拡張フィールドを設定):

```json
{
  "providers": {
    "vlm": {
      "baseUrl": "http://127.0.0.1:10000",
      "models": { "default": "Unlimited-OCR" },
      "extra_body": {
        "images_config": { "image_mode": "gundam" },
        "custom_params": { "ngram_size": 35, "window_size": 128 },
        "custom_logit_processor": "<上記の python -c が出力した文字列>",
        "skip_special_tokens": false
      }
    }
  }
}
```

フィールドの意味(すべてトップレベル、SGLang の OpenAI 互換 API が受け付けます;MCP は `Object.assign` でフラット化して fetch body に展開):

| フィールド | 値 | 説明 |
|---|---|---|
| `images_config.image_mode` | `gundam` / `base` | 単図・高精度なら `gundam`(base_size=1024, image_size=640, crop_mode=true);複数ページ PDF なら `base`(image_size=1024, crop_mode=false)。media-gen-mcp は**単図契約**なので、デフォルト `gundam` が最適 |
| `custom_params.ngram_size` | `35`(推奨) | NoRepeatNGram の長さ、35 は README 推奨値 |
| `custom_params.window_size` | `128`(単図) / `1024`(複数ページ) | 単図は 128;media-gen-mcp の単図契約では 128 を推奨 |
| `custom_logit_processor` | Python 側 `.to_str()` の出力 | 必須(省略すると長出力が繰り返し退化);TS では合成不可、Python で一度実行して文字列を取得 |
| `skip_special_tokens` | `false` | OCR タスクでは特殊 token を保持する必要あり、skip しないでください |

> ⚠️ **タスクゲーティング(重要)**:`extra_body`(`custom_logit_processor` / `skip_special_tokens:false` / `images_config.image_mode:gundam` を含む)は `extract-text` / `extract-table`(OCR パス)の fetch body にのみ展開されます —— `describe-image`(VQA)と `analyze-chart`(JSON 抽出)には**これらのフィールドは付与されません**。理由:NoRepeatNGram(ngram_size=35)は VQA 記述における正当な繰り返し語も抑制してしまう、`skip_special_tokens:false` は OCR 構造 token を description に漏洩し `analyze-chart` の `JSON.parse` を汚染する、`image_mode:gundam`(crop_mode=true)は画像全体をスライスしシーンレベルの VQA 全体理解を破壊するため。これは model-aware なショートプロンプトゲーティング(`promptForUnlimited`)の対称設計 —— `describe-image` / `analyze-chart` は元の長いプロンプトを維持し、クリーンな body のまま処理されます。`describe-image` / `analyze-chart` に拡張フィールドを強制伝達したい場合は per-call の `extra`(`extract_text` / `extract_table` / `describe_image` / `analyze_chart` ツールの `extra` パラメータで渡す)を使用してください —— こちらはタスクゲーティングの制約を受けません。

**呼び出し**:`extract_text` ツールに `provider=vlm` を明示的に渡してください(省略時は defaultVisionProvider=tesseract にフォールバック):

```
extract_text(image="data:image/png;base64,...", provider="vlm")
```

**重要な制限事項**:

- **非ストリームモード**:media-gen-mcp は vLLM/SGLang の**非ストリーム** `/v1/chat/completions`(JSON を一括返却)を使用、単ページ / 中短文書に適しています。Unlimited-OCR の `infer.py` はデフォルトで `stream:true` ですが、**`stream:true` を `extra_body` に書き写さないでください** —— MCP が検出すると reject し「extra.stream を削除してください」のヒントを表示します。超長 PDF は事前に [PyMuPDF でページ分割](https://github.com/baidu/Unlimited-OCR#transformers)(README に `pdf_to_images` スニペットあり)を行い、ページごとに `extract_text` を呼び出すことを推奨 —— ページ独立のリクエストで超長出力を自然に回避できます。
- **サーバータイムアウト**:長文書の生成は時間を要するため、vLLM のデフォルト 60 秒では足りない場合は SGLang の `REQUEST_TIMEOUT` または vLLM の `--timeout-keepalive` を調整してください。
- **GPU 要件**:16–24GB VRAM(段階 4 と同等);満たせない場合は引き続き paddle(10)/glm-vision(9) チェーンを使用してください。

**License**:[MIT](https://github.com/baidu/Unlimited-OCR/blob/main/LICENSE)(純無料スタンスに合致、Qwen Apache-2.0 と同段階、企業の商用利用も可能)。

#### 4 段階クイック比較

| 段階 | サービス設置 | リソース要件 | 中文 | テーブル | 画像 QA | License / 出典 |
|---|---|---|---|---|---|---|
| **1 デフォルト**(tesseract) | 不要 | ゼロ(純 CPU WASM) | 一般 | ❌ | ❌ | Apache 2.0(セルフホスト) |
| **2 智谱 GLM-4.6V-Flash** | 不要(クラウド API) | ゼロ(純 HTTP) | ✅ SOTA | ✅ | ✅ | ユーザー自前の智谱 key(永久無料) |
| **3 PaddleX** | 必要 | GPU 12GB または CPU 4 コア 8GB | ✅ SOTA | ✅ | ❌ | Apache 2.0(セルフホスト) |
| **4 vLLM Qwen2.5-VL** | 必要 | **GPU 16–24GB**(CPU 不可) | ✅ | 一般 | ✅ | Apache 2.0(セルフホスト) |

> セルフホストの 3 段階(1/3/4)は意図的に **Apache 2.0** エンジンのみを採用(tesseract.js + PaddleOCR + Qwen2.5-VL)、AGPL / GPL / 商用申請の落とし穴を回避、**企業でも直接商用利用可能**。段階 2 の智谱はクラウド API(GLM-4.6V-Flash は永久無料、ユーザー自前の key)、セルフホストではありません —— サーバーをデプロイしたくないユーザーが中文 SOTA + VQA 能力を補完するのに適しています。

---

### 三、自動フォールバック機構(設定すれば放置 OK)

- **生成側**:Agnes ↔ 智谱、どちらかが失敗すると自動でもう一方に切り替え(60 秒以内の連続失敗でソフト切り替え、再起動も設定変更も不要)
- **認識側**:デフォルト軽量エンジン(プロセス内フォールバック)→ PaddleX → vLLM、能力に応じて自動ダウングレード(GLM-vision を設定済みの場合は間に自動挿入)
- **唯一の例外**:動画ポーリングでの取得時は**切り替えなし**(誤った結果を受け取るのを防止)
- あなたがやること:生成 API Key を 2 社設定 + 認識サービスを任意で 1 段階インストール(GLM Key を 1 行設定するだけでも OK)、残りは Claude に任せる

> 手元のマシンで PaddleX や vLLM が動かない?**デフォルト軽量エンジンを使い続ければ OK**、MCP はローカルサービスが未設置でもエラーになりません —— 中文 SOTA / テーブル / 画像 QA だけが利用不可になり、他はすべて通常通り動作します。

---

## よくある質問

**Q:何もインストールしなくても使えますか?**
A:使えます。MCP を入れれば作画 / カード / QR コード / 数式 / データチャート + 英語 / CAPTCHA OCR が利用可能、すべてローカル駆動、ネット接続不要です。

**Q:中文認識で文字化けしますか?**
A:デフォルト軽量エンジンは英語 / 数字 / 簡単な書類には十分ですが、中文の精度は一般です。中文 SOTA が必要な場合は PaddleX をセルフホストしてください(GPU 12GB または CPU 4 コア 8GB)、詳しくは上記の[設定ガイド](#設定ガイド)を参照。

**Q:AI 動画はどのくらい待ちますか?**
A:5 秒動画で約 1–3 分、18 秒動画で 5–10 分かかる場合があります。バックグラウンドで非同期生成、完了後に自動通知します。推定 60 秒以下のものは同期待ちします。

**Q:私の RTX 3060 でテーブル認識を動かせますか?**
A:動かせます。PaddleX GPU モードの最低要件は 12GB VRAM(RTX 3060 12GB がちょうど適合)、CPU モードは 4 コア + 8GB メモリでも駆動可能(3–5 倍遅い)。詳しくは[設定ガイド](#設定ガイド)を参照。

**Q:日本語 / 絵文字 / グラデーションは正常に出力されますか?**
A:出ます。シェアカードは内蔵の CJK フォント + レイアウトエンジンで日本語漢字、カラー絵文字、グラデーションタイトル、グロー効果をすべて自動サポート、追加フォント設定は不要です。

**Q:Mermaid に対応していますか?**
A:非対応(ブラウザが必要なため)。D2 または Graphviz で代用ください、能力は同等でより安定、ベクタ出力です。

**Q:レート制限(429)に引っかかりますか?**
A:無料枠には毎分リクエスト数の制限があります。2 社のプロバイダ(Agnes + 智谱)を設定すれば自動切り替えで、ほぼ違和感ありません。

**Q:動画のフレーム数制限は?**
A:解像度に応じて減少 —— 1080p では 241 フレームまで(約 10 秒)、720p では 441 フレームまで(約 18 秒)。Claude にリアルタイム制約を問い合わせることも可能です。

**Q:npx が繋がらない / 起動が遅い?**
A:グローバルインストールでも OK:まず `npm i -g media-gen-mcp-server`、その後 `claude mcp add media-gen-mcp -s user "$(which media-gen-mcp-server)"`。

**Q:センシティブな語 / 武器 / 戦争テーマは使えますか?**
A:リアルな武器の語はコンテンツフィルタをトリガーします。SF 設定の語(「未来の戦闘服」「機甲」など)に置き換えれば回避可能、効果は同等です。

**Q: Claude が間違ったツールを選ぶことはありますか?(例:「カードを作って」なのに画像生成を呼ぶ等)**
A: こうした曖昧なリクエストのルーティングは調整済みです — 「カード / ポスター / OG 画像を作って」「この図表のデータを読み取って」「製品イントロのアニメを作って」「アーキテクチャ図 / フローチャートを描いて」「このデータをグラフ化して」などは、自動的に適切な専用ツールに振り分けられ、手動で訂正する必要はありません。もちろんリクエスト内でツール名を直接指定することもできます。

---

## こんな人に

- **Claude Code ヘビーユーザー** —— 毎週何度も画像タスクを行い、タスクごとに MCP を入れてパラメータを覚えるのを避けたい方。
- **技術ドキュメント / ブログを書く開発者** —— アーキテクチャ図、シーケンス図、ER 図、データチャート、数式を繰り返し必要とし、ワークフローから離れたくない方。
- **個人開発者 / インディープロダクト** —— コスト(完全無料)と制御性(同入力・同出力)を重視し、画像タスクのために別バックエンドを構築したくない方。
- **データ / 財務 / 法務** —— 双方向のシーン:データをチャートに、スクショ / 請求書 / **PDF 報告書 / 契約書**からデータポイントを逆抽出(透かし / 赤印章は無視可能、2 段組論文を読む順に結合)。
- **教育 / 学術** —— 学生が授業資料のスクショ / スキャン講義 / 論文 PDF からテキストを抽出、2 段組論文を連続テキストに結合、チャートから読み取ったデータを質問;教師が紙の試験のスキャンを編集可能なテキストに変換。
- **運営 / コンテンツクリエイター / 公式アカウント執筆者** —— シェアカード / OG 画像 / ポスター / QR コード、日本語 + カラー絵文字 + グラデーションがすぐ使える。

> **あまり向かない対象**:Claude Code を使わないユーザー、単一能力だけ必要でパイプライン構築済みのエンジニアリングチーム、有料商用モデル / 学習ファインチューニング / リアルタイム動画 OCR が必要なシーン(これらは無料 MCP の範囲を超えます)。

---

## 💝 作者を応援する

media-gen-mcp がお役に立ったら、作者にコーヒーを一杯おごってください ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="200" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="200" alt="Alipay">

</div>

または ⭐ [Star](../../stargazers) / [Issue](../../issues) / [PR](../../pulls) —— どんな形式のサポートも歓迎します。

---

## License

**MIT** —— メインコードはご自由に。

認識側の依存スタックはすべて **Apache 2.0**(tesseract.js + PaddleOCR + Qwen2.5-VL)、企業の商用利用でもライセンスリスクなし。

---

> 技術詳細:プロバイダとエンジンはすべて交換可能、構造化ツールは同入力・同出力で Git 管理可能、失敗時にプロバイダを自動切り替え。完全なドキュメントは `doc/` ディレクトリを参照してください。

<p align="center">
  <sub>Built for everyone who'd rather <strong>say it</strong> than <strong>script it</strong>.</sub><br>
  <sub>一度インストールすれば、以降のあらゆる画像作業は一言で。</sub>
</p>
