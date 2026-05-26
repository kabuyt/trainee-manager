-- 日本語評価（秀・優・良・可・不可）の手動上書き
-- 未入力(NULL)の場合は、画面側で得点から自動判定した評価を使う。

ALTER TABLE monthly_reports
  ADD COLUMN IF NOT EXISTS japanese_eval TEXT;

COMMENT ON COLUMN monthly_reports.japanese_eval IS
  'Teacher override for Japanese evaluation grade. NULL means use auto grade from score.';

