# 実習生管理システム

## セットアップ手順

### 1. Supabaseプロジェクト作成
1. https://supabase.com にアクセス
2. GitHubアカウントでサインアップ
3. 「New project」を作成（名前: trainee-manager）
4. データベースパスワードを設定して待機（約2分）

### 2. データベース作成
1. Supabaseダッシュボード → 「SQL Editor」
2. `schema.sql` の内容をコピー＆貼り付け
3. 「Run」ボタンをクリック

### 3. config.jsを更新
1. Supabaseダッシュボード → 「Settings」→「API」
2. 以下をコピーして `config.js` に貼り付け：
   - `Project URL` → `YOUR_SUPABASE_URL`
   - `anon public` key → `YOUR_SUPABASE_ANON_KEY`

### 4. GitHub Pagesで公開
1. GitHubに新しいリポジトリ作成
2. このフォルダのファイルをすべてプッシュ
3. Settings → Pages → Source: main branch
4. 公開URLが発行される

## ファイル構成
- `index.html` - 実習生一覧
- `register.html` - 新規登録・テスト結果入力
- `trainee.html` - 実習生詳細・スコア履歴
- `config.js` - Supabase接続設定（要編集）
- `app.js` - メインロジック
- `style.css` - スタイル
- `schema.sql` - データベース定義
