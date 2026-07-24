-- ============================================================
-- 会話テストの点数が月間テスト提出で消えるバグの修正
-- 2026-07-24
--
-- 【症状】
--   教育報告書で会話スコアを入力すると、score_conversation だけを持つ
--   test_results 行（answers_json = NULL）が作られる。
--   その後その学生が月間テストを提出すると submit_test_result が
--     1) その行を「提出済み」とみなし（→ ロック / 要再受験フラグ）
--     2) is_retake で通した場合は excluded = true にして隠し
--     3) score_conversation を持たない新しい行を INSERT する
--   結果、手入力した会話点が成績表・グラフ・報告書から消える。
--
-- 【修正】
--   A) 「提出済み」判定を答案のある行（answers_json が非NULL・非空）だけに限定
--   B) 会話点だけの行があれば、それを実受験結果で UPDATE して再利用する
--      （score_conversation は列を触らないのでそのまま残る）
--   C) 再受験で旧結果を除外するときも、会話点は新しい行へ引き継ぐ
--
-- 対象: submit_test_result / get_student_test_list
-- 実行: Supabase SQL Editor に貼り付けて実行
-- ============================================================

-- ------------------------------------------------------------
-- 1. submit_test_result
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_test_result(
  p_test_id VARCHAR,
  p_test_date DATE,
  p_answers JSONB,
  p_score_vocab NUMERIC DEFAULT NULL,
  p_score_grammar NUMERIC DEFAULT NULL,
  p_score_listening NUMERIC DEFAULT NULL,
  p_auto_scored BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainee_id UUID;
  v_result_id UUID;
  v_is_retake BOOLEAN;
  v_used_retake BOOLEAN := false;
  v_scores JSONB;
  v_score_vocab NUMERIC := p_score_vocab;
  v_score_grammar NUMERIC := p_score_grammar;
  v_score_listening NUMERIC := p_score_listening;
  v_auto_scored BOOLEAN := p_auto_scored;
  v_conv_row_id UUID;
  v_score_conversation NUMERIC;
BEGIN
  SELECT t.id INTO v_trainee_id
  FROM trainees t WHERE t.auth_user_id = auth.uid();
  IF v_trainee_id IS NULL THEN RAISE EXCEPTION 'Not a student'; END IF;

  SELECT is_retake INTO v_is_retake FROM test_access
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access denied: test not unlocked'; END IF;

  -- marugoto_* はサーバー側採点
  IF p_test_id LIKE 'marugoto\_%' ESCAPE '\' THEN
    v_scores := calculate_marugoto_scores(p_test_id, COALESCE(p_answers, '{}'::jsonb));
    v_score_vocab := (v_scores->>'score_vocab')::NUMERIC;
    v_score_grammar := (v_scores->>'score_grammar')::NUMERIC;
    v_score_listening := (v_scores->>'score_listening')::NUMERIC;
    v_auto_scored := true;
  END IF;

  -- 会話点だけの行（答案なし）を探す。これは「受験済み」ではない
  SELECT id INTO v_conv_row_id
  FROM test_results
  WHERE trainee_id = v_trainee_id
    AND test_name = p_test_id
    AND COALESCE(answers_json, '{}'::jsonb) = '{}'::jsonb
    AND COALESCE(excluded, false) = false
  ORDER BY created_at DESC
  LIMIT 1;

  -- 「提出済み」判定は答案のある行だけで行う（会話点行では発火させない）
  IF EXISTS (
    SELECT 1 FROM test_results
    WHERE trainee_id = v_trainee_id
      AND test_name = p_test_id
      AND COALESCE(answers_json, '{}'::jsonb) <> '{}'::jsonb
  ) THEN
    IF COALESCE(v_is_retake, false) = false THEN
      RAISE EXCEPTION 'Already submitted: retake not permitted';
    END IF;
    v_used_retake := true;

    -- 再受験: 答案のある旧行だけを除外する（会話点行は触らない）
    UPDATE test_results
    SET excluded = true,
        excluded_reason = CASE
          WHEN COALESCE(excluded_reason, '') = '' THEN '再受験前の結果（自動除外）'
          ELSE excluded_reason
        END
    WHERE trainee_id = v_trainee_id
      AND test_name = p_test_id
      AND COALESCE(answers_json, '{}'::jsonb) <> '{}'::jsonb
      AND COALESCE(excluded, false) = false;
  END IF;

  IF v_conv_row_id IS NOT NULL THEN
    -- 会話点の行を実受験結果として上書きする。
    -- score_conversation は SET に含めないのでそのまま保持される。
    UPDATE test_results
    SET test_date       = p_test_date,
        answers_json    = p_answers,
        score_vocab     = v_score_vocab,
        score_grammar   = v_score_grammar,
        score_listening = v_score_listening,
        auto_scored     = v_auto_scored
    WHERE id = v_conv_row_id
    RETURNING id INTO v_result_id;
  ELSE
    -- 会話点行が無い場合でも、除外した旧行に会話点があれば引き継ぐ
    SELECT MAX(score_conversation) INTO v_score_conversation
    FROM test_results
    WHERE trainee_id = v_trainee_id AND test_name = p_test_id;

    INSERT INTO test_results (
      trainee_id, test_name, test_date, answers_json,
      score_vocab, score_grammar, score_listening, auto_scored,
      score_conversation
    ) VALUES (
      v_trainee_id, p_test_id, p_test_date, p_answers,
      v_score_vocab, v_score_grammar, v_score_listening, v_auto_scored,
      v_score_conversation
    ) RETURNING id INTO v_result_id;
  END IF;

  -- 再受験枠は実際に使ったときだけ消費する
  IF v_used_retake THEN
    UPDATE test_access SET is_retake = false
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id;
  END IF;

  RETURN v_result_id;
END;
$$;

-- ------------------------------------------------------------
-- 2. get_student_test_list
--    is_submitted / 表示スコアを「答案のある行」だけで判定する。
--    会話点だけの行で受験がロックされる問題も同時に解消される。
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
      tr.test_date AS submitted_at,
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
