-- マイページのテスト一覧を本人の課程だけに絞る（2026-08-10）
-- ------------------------------------------------------------
-- これまで get_student_test_list() は is_active な test_definitions を全部返していたため、
-- みんなの日本語課程の実習生にも「まるごと」のテストが並び、逆も同じだった。
-- 実データでも、まるごと課程の VJC005 がみん日の第1回も受験しており、点数推移グラフの
-- 横軸に「第1回」が2つ出て区別できない状態になっていた。
--
-- 対応: trainees.curriculum（minna_nihongo / marugoto）で出し分ける。
--   marugoto      → marugoto_1..4 のみ
--   それ以外・NULL → test1..8 のみ（既定はみんなの日本語）
-- 受験済みの判定・会話点・アドバイスの返却は 2026_08_10_mypage_conversation_score.sql のまま。
--
-- 注意: 課程外のテストを過去に受けている実習生（現状2名）は、その結果がマイページに
-- 出なくなる。管理側（kanri の成績ページ・実習生詳細）では従来どおり全部見えるので、
-- 記録が消えるわけではない。
--
-- 実行: Supabaseダッシュボード → SQL Editor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_student_test_list()
RETURNS JSONB AS $$
DECLARE
  v_trainee_id UUID;
  v_curriculum TEXT;
  result JSONB;
BEGIN
  SELECT t.id, t.curriculum INTO v_trainee_id, v_curriculum
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
      AND (
        CASE WHEN v_curriculum = 'marugoto'
          THEN td.id LIKE 'marugoto\_%'
          ELSE td.id NOT LIKE 'marugoto\_%'
        END
      )
  ) r;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
