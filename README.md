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

## 新規実習生登録後のログインアカウント作成

`register.html` で新規実習生を登録した直後は、`trainees` テーブルには追加されますが、学生用の Supabase Auth アカウントはまだ作成されません。この状態では管理画面と報告書には表示されますが、学生ログインとログインカード出力の対象外です。

admin の管理画面 `index.html` では、`auth_user_id` が未作成の実習生がいる場合だけリマインドバナーを表示します。バナーには未作成人数、対象の `student_id`、実行すべきコマンドが表示されます。

新規登録後、バナーが出たら以下を実行してください。

```powershell
cd C:\Users\kabuyamat\Desktop\trainee-manager\test_data
python create_student_accounts.py --apply
```

実行後に `index.html` をリロードすると、`auth_user_id` が紐付いた実習生はバナー対象から外れます。ログインカードをHTMLで再生成する場合は、続けて以下を実行します。

```powershell
python generate_login_cards.py
```
