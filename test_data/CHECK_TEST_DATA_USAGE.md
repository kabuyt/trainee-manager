# テストデータ整合性チェックの使い方

このフォルダの `check_test_data.py` は、テストデータの機械的なズレを見つけるための確認ツールです。
データは変更しません。読み取り専用です。

## 使うタイミング

- test4 以降を精査するとき
- 問題JSONや正解キーを直したあと
- Supabaseへアップロードする前
- GitHubへpushする前

## 実行方法

PowerShellで以下を実行します。

```powershell
cd C:\Users\kabuyamat\Desktop\trainee-manager\test_data
python check_test_data.py test4
```

test5を見るとき:

```powershell
python check_test_data.py test5
```

test3を見るとき:

```powershell
python check_test_data.py test3
```

全部まとめて見るとき:

```powershell
python check_test_data.py
```

## 結果の見方

- `FAIL`: JSONが読めないなど、大きい問題です。先に直します。
- `WARN`: 要確認です。問題データと正解キーのズレ、画像不足、点数差、危ない採点設定などです。
- `OK`: そのセクションの基本チェックが終わっています。
- `SUMMARY`: 最後の集計です。

例:

```text
SUMMARY: 0 fail, 2 warn, 3 ok
```

これは「壊れてはいないが、確認ポイントが2つある」という意味です。

## test3で残っている既知の警告

```text
WARN goii/g7: short flex answer 'để' for g7_14 may overmatch
WARN goii/g7: short flex answer 'bỏ' for g7_17 may overmatch
```

意味:
`để` と `bỏ` は短いベトナム語なので、`flex_match` の部分一致で少し甘く採点される可能性があります。
ただし、test3 語彙 問7では単語や短い訳を書く形式なので、現時点では残してOKという判断です。

## 将来の作業メモ

test4以降を精査するときは、まず次を実行します。

```powershell
python check_test_data.py test4
```

出てきた `WARN` を上から確認し、原本と照合して「本当に修正が必要なもの」と「意図的変更・仕様」を分けます。
