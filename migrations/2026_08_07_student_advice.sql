-- 実習生マイページ用「学生向けアドバイス」（2026-08-07）
-- ------------------------------------------------------------
-- 目的:
--   test_results.ai_diagnosis は先生向けの文章（「指導方針：この1か月は…」）で、
--   日本語も実習生には難しい。これを噛み砕いた学生向けの文章（日本語＋ベトナム語）を
--   別カラムに持ち、マイページで本人に見せる。
--   生成はVPSのバッチ（DeepSeek）が service key で埋める。ここではDDLとRPCだけを定義する。
--
-- 実行方法: Supabaseダッシュボード → SQL Editor に貼り付けて実行（service keyではDDL不可のため）
-- ------------------------------------------------------------

-- 1. 学生向けアドバイスのカラム
ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS student_advice_ja TEXT,
  ADD COLUMN IF NOT EXISTS student_advice_vi TEXT,
  ADD COLUMN IF NOT EXISTS student_advice_model TEXT,
  ADD COLUMN IF NOT EXISTS student_advice_source_hash TEXT,
  ADD COLUMN IF NOT EXISTS student_advice_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.test_results.student_advice_ja IS
  '実習生本人に見せる、やさしい日本語のアドバイス（ai_diagnosisを噛み砕いたもの）';
COMMENT ON COLUMN public.test_results.student_advice_vi IS
  '実習生本人に見せるベトナム語のアドバイス';
COMMENT ON COLUMN public.test_results.student_advice_source_hash IS
  '生成元 ai_diagnosis のハッシュ。診断が作り直されたら再生成する判定に使う';

-- 2. 学生向けRPCにアドバイスを追加
--    元定義: 2026_07_24_preserve_conversation_score.sql
--    変更点は SELECT に student_advice_ja / student_advice_vi を足しただけ。
--    「答案のある行だけを受験扱いする」ロジックは元のまま維持している。
CREATE OR REPLACE FUNCTION get_student_test_list()
RETURNS JSONB AS $$
DECLARE
  v_trainee_id UUID;
  result JSONB;
BEGIN
  SELECT t.id INTO v_trainee_id
  FROM trainees t WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a registered student';
  END IF;

  SELECT jsonb_agg(row_to_json(r) ORDER BY r.sort_order) INTO result
  FROM (
    SELECT
      td.id AS test_id,
      td.display_name,
      td.lesson_range,
      td.sections,
      td.sort_order,
      CASE WHEN ta.id IS NOT NULL THEN true ELSE false END AS is_accessible,
      ta.is_retake,
      tr.score_vocab,
      tr.score_grammar,
      tr.score_listening,
      tr.test_date AS submitted_at,
      tr.student_advice_ja,
      tr.student_advice_vi,
      CASE WHEN tr.id IS NOT NULL THEN true ELSE false END AS is_submitted
    FROM test_definitions td
    LEFT JOIN test_access ta ON ta.test_id = td.id AND ta.trainee_id = v_trainee_id
    LEFT JOIN LATERAL (
      SELECT * FROM test_results
      WHERE trainee_id = v_trainee_id
        AND test_name = td.id
        AND COALESCE(answers_json, '{}'::jsonb) <> '{}'::jsonb   -- 会話点だけの行は受験扱いしない
      ORDER BY created_at DESC LIMIT 1
    ) tr ON true
    WHERE td.is_active = true
  ) r;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
