-- ============================================================
-- カリキュラム種別サポート migration
-- 2026-05-02
-- ============================================================
--
-- 実行手順:
--   Supabase Dashboard > SQL Editor で以下を実行
--
-- 変更点:
-- 1. trainees テーブルに curriculum カラム追加（みん日 / まるごと の選択）
-- 2. 既存実習生は全員 'minna_nihongo' で初期化（default）
-- 3. VJC の対象5名を 'marugoto' に更新（指定が必要、下記参照）
--
-- 背景:
-- - みん日: 既存全員。50課を8回（test1-test8）でカバー
-- - まるごと: VJCの一部（日本語力が著しく低い実習生）。18課を4回でカバー
-- - 第1回〜第8回の回数は両方共通。範囲ラベルが異なる:
--     みん日 第1回 = 第1-4課 / まるごと 第1回 = L1-L5
-- ============================================================

-- 1. curriculum カラム追加
ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS curriculum TEXT DEFAULT 'minna_nihongo'
  CHECK (curriculum IN ('minna_nihongo', 'marugoto'));

-- 2. 既存実習生のNULL対策（既にDEFAULTで埋まっているはずだが念のため）
UPDATE trainees SET curriculum = 'minna_nihongo' WHERE curriculum IS NULL;

-- 3. NOT NULL 制約を追加
ALTER TABLE trainees
  ALTER COLUMN curriculum SET NOT NULL;

-- 4. 確認用: 現在のカリキュラム分布
-- SELECT curriculum, COUNT(*) FROM trainees GROUP BY curriculum;

-- 5. ★まるごと組の指定★
-- VJCの該当5名の student_id を以下に列挙して実行:
-- UPDATE trainees SET curriculum = 'marugoto'
--   WHERE student_id IN ('VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX');

-- 6. 確認用: VJCの全員と現在のカリキュラム
-- SELECT student_id, name_katakana, curriculum
--   FROM trainees
--   JOIN organizations ON trainees.organization_id = organizations.id
--   WHERE organizations.slug = 'vjc'
--   ORDER BY student_id;
