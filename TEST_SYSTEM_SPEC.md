# テスト・成績システム 仕様メモ

最終更新: 2026-07-24

当初は「オンラインで受けたら全問自動採点」というシンプルな月間テストアプリだったが、
実運用の中で **自動採点＋手動採点の混在 / 会話テスト / 解放制御 / まるごと対応** などが
積み重なった。この文書は「今どういう仕様で動いているか」を1枚にまとめたもの。
大きく手を入れる前・別の人（または別セッションのAI）が触る前に、ここを読めば迷わないことを目的とする。

---

## 1. 全体構成

| リポジトリ | 役割 | 公開URL |
|---|---|---|
| `Webテスト_公開用`（nihongo-test-1-4ka） | 学生が受験する側。静的HTML+JS | https://kabuyt.github.io/nihongo-test-1-4ka/ |
| `trainee-manager` | 先生・管理側。登録/成績管理/報告書 | https://kabuyt.github.io/trainee-manager/ |

バックエンドは共通の **Supabase**（PostgreSQL）: `https://ajmdpkwqyeyzemeoojwd.supabase.co`

採点ロジックの本体は **`Webテスト_公開用/common/grading.js`**（クライアント採点）。
管理側の詳細表示（`test-result-detail.html`）も同じ判定ロジックを一部再実装している。

---

## 2. 主要テーブル

### `test_definitions` — テストの定義
`id`（test1〜test8, marugoto_1〜4）, `display_name`, `lesson_range`, `sections`（`["goii","bunpo","chokkai"]`）,
`max_scores`, `sort_order`, `is_active`

### `test_sections` — テストの中身＋答え＋採点ルール
`test_id`, `section_type`（goii/bunpo/chokkai）, `questions`(JSONB), `answer_key`(JSONB), `scoring_rules`(JSONB)
- `scoring_rules` = `{ブロックID: {method, points_each, field_ids, ...}}`
- `method` が採点方式（後述）。`method: 'manual'` は自動0点＝先生が後で加点する部分。

### `test_results` — 受験結果（1行 = ある学生のあるテスト1回分）
- 点数: `score_vocab` / `score_grammar` / `score_listening`（各 /100）, `score_conversation`（会話・手入力）
- `answers_json` — 学生の回答。**これがある＝実受験、空＝会話点だけの行**（重要な区別）
- `auto_scored` — 自動採点で入ったか
- 手動採点: `manual_scores_json`（field単位の付与点）, `manual_score_vocab/grammar/listening`（手動加算の合計）, `manually_scored_at`（採点した日時。**nullなら手動採点まだ**）
- `excluded` / `excluded_reason` — 誤受験除外（データは残す）
- `ai_diagnosis_*` — AI診断コメント

### `test_access` — 誰がどのテストを受けられるか
`trainee_id`, `test_id`, `is_retake`（trueなら再受験1回許可）

### その他
`trainees`（実習生）, `monthly_reports`（月次報告書・会話点の入力元）, `user_profiles`（role: admin/org/student）

---

## 3. 採点の仕組み（3層ある）

1つのテストは **3つの採点層** が重なっている。「自動 or 手動」の二択ではない。

### (A) 自動採点
`grading.js` の `gradeSection()` が `scoring_rules` を回して集計。
点数は `score_vocab/grammar/listening` に入り、`auto_scored=true`。

### (B) 手動採点（`method: 'manual'` のブロック）
記述・読解など機械採点できない部分。自動では **0点** 固定で入り、
先生が `test-result-detail.html` の「手動採点」パネルで加点する。
保存すると `manual_score_*` と `manually_scored_at` が入り、`score_*` に上乗せされる。

対象テスト（2026-07現在）:
- **test3〜test8 に手動採点ブロックあり**
- **test1・test2・まるごとは自動採点のみ**（手動採点不要）

### (C) 手動上書きパネル（override / g2・b2）
`test-result-detail-overrides.js`。自動採点済みの記述問題（漢字読み・活用形）を
先生が○×で上書きするUI。**自動点を控除してから手動点を入れる**（でないと二重計上する）。
※ 2026-07-24 にこの二重計上バグを修正済み（下記）。

### 採点方式（method）一覧
`exact_match` / `normalized_match` / `radio_exact` / `flex_match` / `vietnamese_fuzzy` /
`ox_match` / `array_exact` / `unordered_tokens` / `pair_match` / `bucket_sort` /
`price_country` / `phone_match` / `substring_match` / `split_match` /
`multi_field_group` / `multi_field_match` / `multi_field_exact` / `multi_field_flex` /
`mixed_select_manual` / `manual`（＝0点・先生採点）

---

## 4. 提出フロー（`submit_test_result` RPC）

学生が受験→提出すると、この関数が動く（`SECURITY DEFINER`）。

1. `test_access` に行が無ければ拒否（未解放）
2. `marugoto_*` はサーバー側で採点（`calculate_marugoto_scores`）
3. **会話点だけの行（答案なし）を探して再利用する** ← 会話点を消さないための肝
4. 「提出済み」判定は **答案のある行だけ** で行う（会話点行では発火しない）
5. 再受験(`is_retake`)なら、答案のある旧行だけ `excluded=true` にして新結果を入れる
6. 会話点(`score_conversation`)は常に引き継ぐ

`get_student_test_list`（学生のテスト一覧）も **答案のある行だけを「受験済み」** と判定する。
→ 会話点を入れただけの学生がロックされない。

---

## 5. 会話テストの扱い（要注意ポイント）

- 会話点は **月間テストとは別タイミング** で先生が手入力する（`report.html`→`saveConversationScore`）。
- **月間テストより先に入れることがある**（運用上そういう順番がある）。
- 会話点だけを先に入れると、`score_conversation` だけの `test_results` 行ができる。
- この「先に会話点だけの行を作る」設計が、過去のバグ（ロック・点数消失・test_name=null のゴミ行）の
  **共通の原因** だった。2026-07-24 に上記フローで対処済み。
- **入力機構は止めない**（先に入れる運用を守るため）。

---

## 6. 手動採点の運用

- 管理画面 `test-results.html` の **「手動採点」列** で状態が分かる:
  - 🔴 要採点（手動部分あり・未採点）/ 🟢 済 / — 自動のみ
- 「手動採点が必要のみ」フィルタ＋未完了件数バッジで、採点待ちの学生を一覧できる。
- 判定は `manually_scored_at` の有無＋そのテストに `method:'manual'` ブロックがあるか。

---

## 7. 採点ロジックの回帰テスト【必須運用】

- `Webテスト_公開用/common/grading.test.js`（node で実行、現在129テスト）
- **grading.js / framework.js / answer_keys / test_sections を変えたら push 前に必ず実行**
- 実行: `cd Webテスト_公開用 && node common/grading.test.js`

---

## 8. 既知の弱点・要注意（今後の改善候補）

### ⚠ (1) 会話点と月間テスト点が同じ行に同居している
今日のバグ群の根本原因。会話点を別テーブル（例 `conversation_scores`）に分離すれば、
この種の同居バグは原理的に起きなくなる。**大きめのリファクタ候補。**

### ⚠ (2) test5〜test7 に grading.js 未実装の採点メソッドがある【公開前に要修正】
DB の `scoring_rules` にあるが `grading.js` の `METHOD_MAP` に無いメソッド:
| テスト | 場所 | メソッド |
|---|---|---|
| test5 | chokkai c1 | `mixed_ox_manual` |
| test5 | chokkai c3 | `mixed_text_select` |
| test6 | bunpo b4 | `exact_match_mixed` |
| test6 | chokkai c3 | `mixed_select_text` |
| test7 | bunpo b2 | `multi_accept` |

現状これらは採点時に「Unknown scoring method」で **スキップ（0点）** される。
**幸い test5〜8 はまだ実受験ゼロ** なので実害は出ていないが、
**公開する前に METHOD_MAP へ実装を追加する必要がある**（追加後 grading.test.js にカバレッジも足す）。

### ⚠ (3) DB採点キー（answer_key）の未完成部分
test2〜8 は「DB再採点すると点が下がりうる」状態のものがある → **加点のみ運用**。
（別メモ: 採点DBキー未完成の落とし穴）

### ⚠ (4) ドキュメントが仕様に追いつかない
`submit_test_result` に古い3引数版が残っていた（2026-07-24 に削除）ように、
変遷が記録されないと残骸が溜まる。仕様を変えたらこの文書も更新する。

---

## 9. 2026-07-24 に実施した修正

1. **語彙100点超えバグ** — override(g2/b2)が自動点に手動点を二重加算していた。
   自動点を控除してから手動点を足すよう修正（`test-result-detail-overrides.js`）。
   既存レコード（BRN017 等）も再計算。
2. **会話点が月間テスト提出で消えるバグ** — `submit_test_result` / `get_student_test_list` を
   「答案のある行だけ提出扱い」「会話点行を再利用」に修正（migration 2026_07_24）。
   37名の消失リスクを解消。
3. **データ掃除** — BRN021 の会話点をtest3へ移設＋ゴミ空行削除。
   鉄則: **語彙/文法/聴解に点数がある行は絶対に削除・除外しない。**
4. **`submit_test_result` の古い3引数オーバーロードを削除**（PGRST203 曖昧エラー解消）。
5. **`test-results.html`** — 無意味だった「自動/手動」列を「手動採点(要採点/済/—)」列に差し替え。
