-- マイページに会話の点数を出す（2026-08-10）
-- ------------------------------------------------------------
-- get_student_test_list() は語彙・文法・聴解しか返しておらず、会話（score_conversation）が
-- 本人のマイページに出ていなかった。点数推移の折れ線グラフでも会話を1本の線として扱いたい。
--
-- 変更点は SELECT に tr.score_conversation を1行足しただけ。
-- 「答案のある行だけを受験扱いする」判定と student_advice の返却は
-- 2026_07_24 / 2026_08_07 の定義をそのまま引き継いでいる。
--
-- 注意: 会話点は答案(answers_json)を伴わず後から入力されることがあるが、ここでは
-- 受験判定を変えていないため、会話点だけの行が「受験済み」に化けることはない。
--
-- 実行: Supabaseダッシュボード → SQL Editor
-- ------------------------------------------------------------
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
      tr.score_conversation,
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
