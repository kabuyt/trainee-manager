# 教育報告書 月次運用ワークフロー

## 概要

毎月の教育報告書を組合・企業へ配布するためのフロー。
brastech-reports と同方式の **静的サイト生成** を採用。

## 配布URL一覧

| 組合 | URL | パスワード |
|---|---|---|
| グローバルウェイ協同組合 | https://kabuyt.github.io/trainee-manager/reports/globalway/ | `globalway2026` |
| CIC協同組合 | https://kabuyt.github.io/trainee-manager/reports/cic/ | `cic2026` |
| 広島ワールド協同組合 | https://kabuyt.github.io/trainee-manager/reports/hiroshimaworld/ | `hiroshima2026` |

## 月次運用の3ステップ

### ステップ1: データ準備（admin）
`https://kabuyt.github.io/trainee-manager/index.html` で以下を完了:
- 各実習生の月次レポート編集（学習状況、生活状況、コメント等）
- テスト結果の入力（自動採点済 + 会話スコア手動入力）
- 写真の更新（必要なら）

### ステップ2: 静的サイト生成（ローカル）

`bulk_pdf.py` を実行。Playwright + Chrome 印刷で高品質PDFを生成:

```powershell
cd C:\Users\kabuyamat\Desktop\trainee-manager

# 全組合分を一気に生成（推奨）
python bulk_pdf.py --kumiai globalway --auto-month --site --password globalway2026
python bulk_pdf.py --kumiai cic --auto-month --site --password cic2026
python bulk_pdf.py --kumiai hiroshimaworld --auto-month --site --password hiroshima2026
```

**重要オプション**:
- `--auto-month`: 各企業の最新受験月を自動判定（例: ロイヤルデリカは2ヶ月目、他は1ヶ月目）
- `--site`: 静的サイト用 index.html を生成（PDFだけが欲しい時は省略）
- `--password`: 認証パスワード
- `--all`: その月のテスト未受験者も含める（既定は受験者のみ）

### ステップ3: デプロイ（git push）

```powershell
# 既存のサイトを置き換え
rm -rf reports/globalway reports/cic reports/hiroshimaworld
cp -r reports_pdf/globalway reports/
cp -r reports_pdf/cic reports/
cp -r reports_pdf/hiroshimaworld reports/

git add reports/
git commit -m "reports: 月次更新"
git push
```

GitHub Pages デプロイには1-2分かかる。

## 環境セットアップ（初回のみ）

```powershell
# Playwright インストール
pip install playwright
python -m playwright install chromium
```

`.env.local` を作成:
```
SUPABASE_SERVICE_KEY=sb_secret_VRc_...
```

## bulk_pdf.py の主要機能

### 出力構造
```
reports_pdf/
└── globalway/
    ├── index.html          ← brastech-reports 風 UI（パスワード認証 + ZIP DL）
    ├── logo.png            ← GROP VIETNAM ロゴ
    ├── ロイヤルデリカ 11期生/      ← 会社+期生 でグルーピング
    │   └── 教育報告書 2ヶ月目 グエン・レー・キェウ・ヴィ.pdf
    └── キンレイ亀山 2期生/
        └── ...
```

### 特徴
- **会社+期生** で自動グルーピング（例: ロイヤルデリカ 11期生）
- 「株式会社」プレフィックスは表示時に自動除去
- 各企業ごとに個別ZIPダウンロードボタン + 全社一括ZIPボタン
- パスワード認証（SHA-256ハッシュ照合）
- 教育報告書の見方ガイド同梱

### コマンド例

```powershell
# 単一月モード（全員同じ月）
python bulk_pdf.py --kumiai globalway --month 1

# 自動月モード（推奨）
python bulk_pdf.py --kumiai globalway --auto-month --site --password globalway2026

# 特定企業のみ
python bulk_pdf.py --kumiai globalway --company キンレイ --month 1

# 未受験者も含める
python bulk_pdf.py --kumiai globalway --month 1 --all
```

## トラブルシューティング

### PDF が崩れる
- 単体PDF（report.html → 印刷ボタン）は OK だが bulk_pdf.py で崩れる場合
  - bulk_pdf.py は Playwright + Chrome 印刷を使うので、ブラウザの印刷と同等の品質
  - 崩れる = report.html / report.css 自体の問題。両方確認
  - `body.print-mode` クラス CSS が機能しているか確認

### `_reportReady` タイムアウト
- iframe の認証セッション失敗の可能性
- `.env.local` の SUPABASE_SERVICE_KEY が正しいか確認
- admin@trainee.local のパスワードが '123456' か確認

### Playwright が無いと言われる
```powershell
pip install playwright
python -m playwright install chromium
```

### キャッシュが残って最新が反映されない
- 配布先には Ctrl+F5 で強制再読み込みを依頼
- もしくは URL に `?v=YYYYMMDD` などの クエリ追加

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `bulk_pdf.py` | 静的サイト生成スクリプト（gitignore） |
| `report.html` / `report.css` | 教育報告書テンプレート（モダン版） |
| `report-classic.html` / `report-classic.css` | クラシック版（一覧から切替可能） |
| `app.js` | フロントエンドロジック（loadReport, switchMonth, renderTrendChart 等） |
| `kumiai.html` | リアルタイム閲覧用（ログイン必須、html2pdfベース・崩れあり） |
| `reports/` | 静的サイト本体（GitHub Pages 配信） |

## 関連URL

| | URL |
|---|---|
| GitHub | https://github.com/kabuyt/trainee-manager |
| Public Pages | https://kabuyt.github.io/trainee-manager/ |
| Supabase | https://ajmdpkwqyeyzemeoojwd.supabase.co |
| Supabase SQL Editor | https://supabase.com/dashboard/project/ajmdpkwqyeyzemeoojwd/sql |

## 将来の改善候補

- [ ] GitHub Actions で月次自動生成（cron）
- [ ] 管理画面に「最終更新日」表示でリマインド
- [ ] 入力時のスペルチェック（Gemini API）
- [ ] kumiai.html の置き換え or リダイレクト

## Claude にお願いするときの呼び出し方

新しいセッションで以下を言えば、このドキュメントを読んで作業してくれる:

```
trainee-manager の月次レポート生成お願い
```

または:

```
@C:\Users\kabuyamat\Desktop\trainee-manager\WORKFLOW.md を見て月次運用やって
```
