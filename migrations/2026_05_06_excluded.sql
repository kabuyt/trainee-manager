-- 誤受験テスト結果の除外フラグ
-- 物理削除せず excluded = TRUE でレポート/グラフ/curriculum 判定から外す

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

-- インデックス（除外フィルタが頻繁に走るため）
CREATE INDEX IF NOT EXISTS idx_test_results_excluded
  ON test_results(excluded)
  WHERE excluded = FALSE;

-- VJC004 のチャン・ティ・ホン・ニュンの marugoto_1 は誤受験のため即除外
-- (実 minna 受講生だが marugoto を間違えて受けた)
UPDATE test_results
SET excluded = TRUE, excluded_reason = '誤受験（minna受講生がmarugotoを受けてしまった）'
WHERE id = '4ea24c6f-0a83-43ff-a0c3-4ab499e36394';
