-- ============================================================
-- 自動採点サポート migration
-- 2026-04-20
-- ============================================================
--
-- 実行手順:
--   Supabase Dashboard > SQL Editor で以下を実行
--
-- 変更点:
-- 1. submit_test_result にスコア引数を追加（クライアント側採点の結果を保存）
-- 2. test_results に auto_scored, submitted_at カラム追加（存在しなければ）
-- 3. 再受験時は古い結果を削除してから挿入
-- ============================================================

-- 1. test_results 追加カラム
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS auto_scored BOOLEAN DEFAULT false;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS answers_json JSONB;

-- 2. submit_test_result を拡張版に置き換え
CREATE OR REPLACE FUNCTION submit_test_result(
  p_test_id VARCHAR,
  p_test_date DATE,
  p_answers JSONB,
  p_score_vocab NUMERIC DEFAULT NULL,
  p_score_grammar NUMERIC DEFAULT NULL,
  p_score_listening NUMERIC DEFAULT NULL,
  p_auto_scored BOOLEAN DEFAULT false
)
RETURNS UUID AS $$
DECLARE
  v_trainee_id UUID;
  v_result_id UUID;
  v_is_retake BOOLEAN;
BEGIN
  -- 認証ユーザーから trainee_id 取得
  SELECT t.id INTO v_trainee_id
  FROM trainees t
  WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a student';
  END IF;

  -- 受験許可チェック
  SELECT is_retake INTO v_is_retake
  FROM test_access
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access denied: test not unlocked';
  END IF;

  -- 既に提出済みで、再受験許可なしならブロック
  IF EXISTS (
    SELECT 1 FROM test_results
    WHERE trainee_id = v_trainee_id AND test_name = p_test_id
  ) THEN
    IF COALESCE(v_is_retake, false) = false THEN
      RAISE EXCEPTION 'Already submitted: retake not permitted';
    END IF;
    -- 再受験許可あり → 古い結果を削除
    DELETE FROM test_results
    WHERE trainee_id = v_trainee_id AND test_name = p_test_id;
  END IF;

  -- INSERT
  INSERT INTO test_results (
    trainee_id, test_name, test_date, answers_json,
    score_vocab, score_grammar, score_listening, auto_scored
  )
  VALUES (
    v_trainee_id, p_test_id, p_test_date, p_answers,
    p_score_vocab, p_score_grammar, p_score_listening, p_auto_scored
  )
  RETURNING id INTO v_result_id;

  RETURN v_result_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. get_grading_data RPC: 採点用データ（answer_key + scoring_rules）を返す
-- 学生提出時にクライアント採点する用。提出前には呼べないようにすることは
-- この関数では無理なので（呼べば取得できる）、UI側で工夫する。
CREATE OR REPLACE FUNCTION get_grading_data(p_test_id VARCHAR)
RETURNS JSONB AS $$
DECLARE
  v_trainee_id UUID;
  result JSONB;
BEGIN
  SELECT t.id INTO v_trainee_id FROM trainees t WHERE t.auth_user_id = auth.uid();
  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a student';
  END IF;

  -- 受験許可チェック
  IF NOT EXISTS (
    SELECT 1 FROM test_access
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- 全セクションのanswer_keyとscoring_rulesをまとめて返す
  SELECT jsonb_object_agg(
    section_type,
    jsonb_build_object(
      'answer_key', answer_key,
      'scoring_rules', scoring_rules
    )
  ) INTO result
  FROM test_sections
  WHERE test_id = p_test_id;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PostgRESTスキーマキャッシュ更新
NOTIFY pgrst, 'reload schema';

-- 確認用クエリ
-- SELECT test_name, score_vocab, score_grammar, score_listening, auto_scored
-- FROM test_results ORDER BY created_at DESC LIMIT 10;
