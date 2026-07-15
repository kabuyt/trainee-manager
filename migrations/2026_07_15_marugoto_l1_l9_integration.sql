-- Keep the L1-L9 definition and scoring authoritative in Supabase.

UPDATE test_definitions
SET display_name = '第1回 (まるごと L1-L9 総合)',
    lesson_range = 'L1-L9'
WHERE id = 'marugoto_1';

CREATE OR REPLACE FUNCTION calculate_marugoto_1_scores(p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section RECORD;
  v_rule RECORD;
  v_field_id TEXT;
  v_method TEXT;
  v_expected TEXT;
  v_actual TEXT;
  v_points NUMERIC;
  v_section_score NUMERIC;
  v_scores JSONB := jsonb_build_object(
    'score_vocab', NULL,
    'score_grammar', NULL,
    'score_listening', NULL
  );
BEGIN
  FOR v_section IN
    SELECT section_type, answer_key, scoring_rules
    FROM test_sections
    WHERE test_id = 'marugoto_1'
  LOOP
    v_section_score := 0;

    FOR v_rule IN
      SELECT key AS block_id, value AS rule
      FROM jsonb_each(COALESCE(v_section.scoring_rules, '{}'::jsonb))
    LOOP
      v_method := v_rule.rule->>'method';
      IF v_method NOT IN ('radio_exact', 'exact_match', 'ox_match') THEN
        RAISE EXCEPTION 'Unsupported marugoto_1 scoring method: %', v_method;
      END IF;

      v_points := COALESCE((v_rule.rule->>'points_each')::NUMERIC, 1);

      FOR v_field_id IN
        SELECT jsonb_array_elements_text(COALESCE(v_rule.rule->'field_ids', '[]'::jsonb))
      LOOP
        v_expected := COALESCE(
          v_section.answer_key->v_rule.block_id->>v_field_id,
          v_section.answer_key->>v_field_id
        );
        v_actual := p_answers->>v_field_id;

        IF v_expected IS NULL THEN
          CONTINUE;
        END IF;

        IF v_method = 'ox_match' THEN
          v_expected := replace(v_expected, '✕', '×');
          v_actual := replace(COALESCE(v_actual, ''), '✕', '×');
        END IF;

        IF btrim(COALESCE(v_actual, '')) = btrim(v_expected) THEN
          v_section_score := v_section_score + v_points;
        END IF;
      END LOOP;
    END LOOP;

    v_section_score := round(v_section_score);
    v_scores := CASE v_section.section_type
      WHEN 'goii' THEN jsonb_set(v_scores, '{score_vocab}', to_jsonb(v_section_score))
      WHEN 'bunpo' THEN jsonb_set(v_scores, '{score_grammar}', to_jsonb(v_section_score))
      WHEN 'chokkai' THEN jsonb_set(v_scores, '{score_listening}', to_jsonb(v_section_score))
      ELSE v_scores
    END;
  END LOOP;

  RETURN v_scores;
END;
$$;

REVOKE ALL ON FUNCTION calculate_marugoto_1_scores(JSONB) FROM PUBLIC, anon, authenticated;

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
  v_scores JSONB;
  v_score_vocab NUMERIC := p_score_vocab;
  v_score_grammar NUMERIC := p_score_grammar;
  v_score_listening NUMERIC := p_score_listening;
  v_auto_scored BOOLEAN := p_auto_scored;
BEGIN
  SELECT t.id INTO v_trainee_id
  FROM trainees t
  WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a student';
  END IF;

  SELECT is_retake INTO v_is_retake
  FROM test_access
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: test not unlocked';
  END IF;

  IF p_test_id = 'marugoto_1' THEN
    v_scores := calculate_marugoto_1_scores(COALESCE(p_answers, '{}'::jsonb));
    v_score_vocab := (v_scores->>'score_vocab')::NUMERIC;
    v_score_grammar := (v_scores->>'score_grammar')::NUMERIC;
    v_score_listening := (v_scores->>'score_listening')::NUMERIC;
    v_auto_scored := true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM test_results
    WHERE trainee_id = v_trainee_id AND test_name = p_test_id
  ) THEN
    IF COALESCE(v_is_retake, false) = false THEN
      RAISE EXCEPTION 'Already submitted: retake not permitted';
    END IF;

    UPDATE test_results
    SET excluded = true,
        excluded_reason = CASE
          WHEN COALESCE(excluded_reason, '') = '' THEN '再受験前の結果（自動除外）'
          ELSE excluded_reason
        END
    WHERE trainee_id = v_trainee_id
      AND test_name = p_test_id
      AND COALESCE(excluded, false) = false;
  END IF;

  INSERT INTO test_results (
    trainee_id, test_name, test_date, answers_json,
    score_vocab, score_grammar, score_listening, auto_scored
  )
  VALUES (
    v_trainee_id, p_test_id, p_test_date, p_answers,
    v_score_vocab, v_score_grammar, v_score_listening, v_auto_scored
  )
  RETURNING id INTO v_result_id;

  IF COALESCE(v_is_retake, false) THEN
    UPDATE test_access
    SET is_retake = false
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id;
  END IF;

  RETURN v_result_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_grading_data(p_test_id VARCHAR)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainee_id UUID;
  v_result JSONB;
BEGIN
  SELECT t.id INTO v_trainee_id
  FROM trainees t
  WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a student';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM test_access
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_test_id = 'marugoto_1' THEN
    RAISE EXCEPTION 'This test is graded on the server';
  END IF;

  SELECT jsonb_object_agg(
    section_type,
    jsonb_build_object(
      'answer_key', answer_key,
      'scoring_rules', scoring_rules
    )
  ) INTO v_result
  FROM test_sections
  WHERE test_id = p_test_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

NOTIFY pgrst, 'reload schema';
