-- ============================================================
-- まるごとカリキュラムサポート migration
-- 2026-05-02
-- ============================================================
--
-- 実行手順:
--   Supabase Dashboard > SQL Editor で各ブロック順に実行
--
-- 変更点:
-- 1. trainees に curriculum カラム追加（minna_nihongo / marugoto）
-- 2. test_definitions に marugoto_1〜4 を追加
-- 3. ★まるごと組5名★への curriculum 設定 + test_access 付与（手動指定）
--
-- 背景:
-- - みん日: 全実習生が default、50課を8回テスト
-- - まるごと: VJCの一部（日本語力が著しく低い）、18課を4回テスト
-- - 第1回〜第8回の回数は両カリキュラム共通。範囲ラベルだけ違う:
--     みん日 第1回 = 第1-4課 / まるごと 第1回 = L1-L5
-- - まるごと組は4ヶ月でテスト終了（5ヶ月目以降空欄）
-- ============================================================

-- ============================================================
-- 1. trainees.curriculum カラム
-- ============================================================
ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS curriculum TEXT DEFAULT 'minna_nihongo'
  CHECK (curriculum IN ('minna_nihongo', 'marugoto'));

UPDATE trainees SET curriculum = 'minna_nihongo' WHERE curriculum IS NULL;

ALTER TABLE trainees
  ALTER COLUMN curriculum SET NOT NULL;

-- 確認
SELECT curriculum, COUNT(*) FROM trainees GROUP BY curriculum;

-- ============================================================
-- 2. test_definitions に marugoto_1〜4 を追加
-- ============================================================
INSERT INTO test_definitions (id, display_name, lesson_range, sections, max_scores, sort_order, is_active)
VALUES
  ('marugoto_1', '第1回 (まるごと L1-L5)',   'L1-L5',   '["goii","bunpo","chokkai"]'::jsonb, '{"goii":100,"bunpo":100,"chokkai":100}'::jsonb, 101, true),
  ('marugoto_2', '第2回 (まるごと L6-L10)',  'L6-L10',  '["goii","bunpo","chokkai"]'::jsonb, '{"goii":100,"bunpo":100,"chokkai":100}'::jsonb, 102, true),
  ('marugoto_3', '第3回 (まるごと L11-L14)', 'L11-L14', '["goii","bunpo","chokkai"]'::jsonb, '{"goii":100,"bunpo":100,"chokkai":100}'::jsonb, 103, true),
  ('marugoto_4', '第4回 (まるごと L15-L18)', 'L15-L18', '["goii","bunpo","chokkai"]'::jsonb, '{"goii":100,"bunpo":100,"chokkai":100}'::jsonb, 104, true)
ON CONFLICT (id) DO NOTHING;

-- 確認
SELECT id, display_name FROM test_definitions WHERE id LIKE 'marugoto%' ORDER BY id;

-- ============================================================
-- 3. ★まるごと組5名★の指定（学生IDが決まったら下記をアンコメントして実行）
-- ============================================================
-- 例: VJC012, VJC013, VJC015, VJC016, VJC017 をまるごと組にする場合
--
-- -- 3a. curriculum を marugoto に
-- UPDATE trainees SET curriculum = 'marugoto'
--   WHERE student_id IN ('VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX');
--
-- -- 3b. marugoto_1 の受験許可を付与（test_access）
-- INSERT INTO test_access (trainee_id, test_id, granted_at)
-- SELECT id, 'marugoto_1', now()
--   FROM trainees
--   WHERE student_id IN ('VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX', 'VJC0XX')
-- ON CONFLICT DO NOTHING;
--
-- -- 3c. 確認
-- SELECT t.student_id, t.name_katakana, t.curriculum, ta.test_id
--   FROM trainees t
--   LEFT JOIN test_access ta ON ta.trainee_id = t.id AND ta.test_id LIKE 'marugoto%'
--   WHERE t.curriculum = 'marugoto'
--   ORDER BY t.student_id;
--
-- 注: 第2-4回は別途進捗に応じて test_access を追加する
--   INSERT INTO test_access (...) ...test_id = 'marugoto_2' ... など
