# 月間テスト Web化 変換方針（test5で確定・test6〜8で使い回す）

2026-07-24 test5 作り直し時にユーザー承認済みの方針。test6・test7・test8 を作り直すときはこのルールに従う。

## 大原則

1. **問題は必ず原文Word（問題＋解答）と照合する。AIが問題・選択肢を創作しない。**
2. **聴解は音声ファイル（第2版）を Whisper で文字起こしし、問題・解答との整合をチェックしてから公開する。**
   - 文字起こし: `faster-whisper`（medium, CPU int8）。スクリプト例は scratchpad の transcribe_test5.py 参照。
3. 解答Wordの丸付け（図形○）はテキスト抽出に出ない。**解答docxをPDF化（Word COM, FileFormat=17）→ PyMuPDF でPNG化 → 目視確認**で確定する。
4. Wordのルビは python-docx の text に漢字が落ちる。**w:ruby を処理するXML抽出**（scratchpad の extract_test5_v2.py 方式）を使う。

## 問題形式ごとの扱い

| 形式 | 扱い | method |
|---|---|---|
| 選択式（radio/select/○×/記号マッチ） | そのまま自動採点 | exact_match / radio_exact / ox_match |
| 短答固定型の記述（読み・活用形・短い定型句。答えが語句レベルで一意） | **記述のまま自動採点**。表記ゆれ（漢字/かな、数字全半角、複数読み）を answer_key の配列で許容 | flex_match / normalized_match |
| ベトナム語訳の記述 | 記述のまま自動採点（アクセント無視） | vietnamese_fuzzy |
| 自由作文（〜ながら、続きを書く等。答えが文レベルで無限） | **原文のまま出題し、手動採点**（差し替えない） | manual |
| ○×＋自由記述の複合問題（聴解「どうしますか」等） | **○×は自動、記述は手動採点**。ブロックを `cN_ox` / `cN_text` に分割して既存methodだけで組む（mixed_* 系の新メソッドは作らない） | ox_match + manual |
| 教具・対面依存（カード等） | 選択式化 or 出題除外（test5では該当なし） | - |

## 採点キーの原則

- **METHOD_MAP にあるメソッドだけ使う**。複合問題は1問をブロック分割して対応（例: test5 c1_ox/c1_text、c3_text/c3_sel、c7_num/c7_noun/c7_verb）。
- 数字だけの短答は `exact_only: true`（部分一致すると「10」が「1」に誤爆するため）。
- 命令形など句点が付きやすい短答は `strip_punctuation: true`。
- 記述自動採点の取りこぼしは「不正解レビュー（加点のみ）」運用で回収する。
- 点数内訳が原文で不明瞭な複合問題（例: 各4点の2要素）は均等分割し、このメモに記録する。

## test5 で原文から変えた点（記録）

- 聴解 大問2「各4点×2問」→ 絵2点＋対処2点 に分割（内訳は原文未記載のため）。
- 聴解 大問7「各(2+3)点」→ 数字2点＋名詞1点＋動詞2点 に分割。
- 語彙 大問1の8)は問題版「どちらを選びますか」（答え えらび）を採用。解答版は旧版の文（人口→じんこう）で問題版と不一致だった。
- 上記以外の問題文・選択肢・解答はすべて原文Word（＋解答PDFの丸付け）どおり。オリジナル問題（原文非由来）は**ゼロ**。

## 公開手順（test5 実績）

1. `test_data/testN_{goii,bunpo,chokkai}_questions.json` + `testN_answer_keys.json` を作成
2. 画像は原文docxから抽出し `Webテスト_公開用/static/testN/images/` へ（対応付けを目視確認）
3. 音声（第2版）を `static/testN/audio/` へ。パスはJSONの `audio_src`（`audio/問題X.mp3`）と一致させる
4. `node common/grading.test.js` （testN のカバレッジを追加してから）
5. `python upload_test2_8.py testN` で Supabase test_sections へ投入
6. `test_definitions` の sections / max_scores を更新
7. CLAUDE.md のテスト範囲表を更新
