# テストデータ整合性チェックの使い方

`check_test_data.py` は、テストJSONと正解キーの機械的なズレを確認するための読み取り専用ツールです。データは変更しません。

## 基本チェック

```powershell
cd C:\Users\kabuyamat\Desktop\trainee-manager\test_data
python check_test_data.py test4
```

複数テストを見る場合:

```powershell
python check_test_data.py test3 test4
```

全部を見る場合:

```powershell
python check_test_data.py
```

## 実回答からズレ疑いを見る

今回の test3 語彙 問題1 のように、「画像や問題番号と正解キーがズレて、正解のはずが別番号の正解扱いになる」ケースを探すときは `--shift-check` を付けます。

```powershell
python check_test_data.py test3 --shift-check
```

同じズレ疑いが何件以上あれば警告するかは変更できます。

```powershell
python check_test_data.py test3 --shift-check --shift-min-count 3
```

## 出力の見方

- `FAIL`: JSONが読めないなど、先に直すべき大きな問題です。
- `WARN`: 要確認です。問題データと正解キーのズレ、画像不足、点数差、短すぎるflex正解、実回答ベースのズレ疑いなどです。
- `OK`: その範囲のチェックが完了しています。
- `SUMMARY`: 最後の集計です。

例:

```text
SUMMARY: 0 fail, 2 warn, 3 ok
```

## test3 の既知警告

```text
WARN goii/g7: short flex answer 'để' for g7_14 may overmatch
WARN goii/g7: short flex answer 'bỏ' for g7_17 may overmatch
```

`để` と `bỏ` は短いベトナム語なので、flex採点の部分一致で甘く採点される可能性があります。ただし test3 語彙 問題7 では解答ファイル由来の短い訳を許容する判断なので、現時点では残してOKです。

`--shift-check` で test3 語彙 問題1 が出る場合は、今回の既知修正に関係する過去回答を拾っています。修正後の正解キーで再採点済みなら、新しい未確認箇所とは分けて見てください。

## test4以降の精査時

まず以下を実行します。

```powershell
python check_test_data.py test4 --shift-check
```

出てきた `WARN` を上から確認し、原本と照合して「本当に修正が必要なもの」と「意図的変更・許容範囲」を分けます。
