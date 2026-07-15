-- Accept both the production browser payload ({ selected, correct, points })
-- and legacy scalar answers while keeping scoring authoritative in Supabase.

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

        IF jsonb_typeof(p_answers->v_field_id) = 'object' THEN
          v_actual := p_answers->v_field_id->>'selected';
        ELSE
          v_actual := p_answers->>v_field_id;
        END IF;

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
