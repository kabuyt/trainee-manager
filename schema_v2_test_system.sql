-- ============================================================
-- テストシステム v2 マイグレーション
-- 学生認証 + テスト解放制御 + 問題データDB化
-- Supabase SQL Editor で実行すること
-- ============================================================

-- ===== 1. trainees に auth_user_id 追加 =====
ALTER TABLE trainees ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainees_auth_user_id ON trainees(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainees_student_id ON trainees(student_id) WHERE student_id IS NOT NULL;

-- ===== 2. test_definitions テーブル =====
CREATE TABLE IF NOT EXISTS test_definitions (
  id VARCHAR PRIMARY KEY,                          -- 'test1' ~ 'test8'
  display_name VARCHAR NOT NULL,                    -- '第1回 第1-4課'
  lesson_range VARCHAR NOT NULL,                    -- '1-4'
  sections JSONB NOT NULL DEFAULT '["goii","bunpo","chokkai"]',
  max_scores JSONB NOT NULL DEFAULT '{"goii":100,"bunpo":100,"chokkai":100}',
  sort_order INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 3. test_sections テーブル（問題データ格納） =====
CREATE TABLE IF NOT EXISTS test_sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id VARCHAR NOT NULL REFERENCES test_definitions(id),
  section_type VARCHAR NOT NULL,                    -- 'goii', 'bunpo', 'chokkai'
  questions JSONB NOT NULL DEFAULT '[]',            -- 生徒に見せる問題データ
  answer_key JSONB NOT NULL DEFAULT '{}',           -- 正解データ（生徒には非公開）
  scoring_rules JSONB NOT NULL DEFAULT '{}',        -- 採点ルール
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, section_type)
);

-- ===== 4. test_access テーブル（受験許可） =====
CREATE TABLE IF NOT EXISTS test_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  test_id VARCHAR NOT NULL REFERENCES test_definitions(id),
  is_retake BOOLEAN DEFAULT false,                  -- 再受験許可フラグ
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES auth.users(id),
  UNIQUE(trainee_id, test_id)
);

-- ===== 5. 自動アンロックトリガー =====
-- test_results INSERT 後に次のテストを自動解放
CREATE OR REPLACE FUNCTION auto_unlock_next_test()
RETURNS TRIGGER AS $$
DECLARE
  current_sort INTEGER;
  next_test_id VARCHAR;
BEGIN
  -- 提出テストの sort_order を取得
  SELECT sort_order INTO current_sort
  FROM test_definitions WHERE id = NEW.test_name;

  -- 次のテストを取得
  SELECT id INTO next_test_id
  FROM test_definitions
  WHERE sort_order = current_sort + 1 AND is_active = true;

  -- 次のテストが存在し、まだ未付与なら付与
  IF next_test_id IS NOT NULL THEN
    INSERT INTO test_access (trainee_id, test_id)
    VALUES (NEW.trainee_id, next_test_id)
    ON CONFLICT (trainee_id, test_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_unlock_next_test ON test_results;
CREATE TRIGGER trg_auto_unlock_next_test
AFTER INSERT ON test_results
FOR EACH ROW EXECUTE FUNCTION auto_unlock_next_test();

-- ===== 6. RLS ポリシー =====

-- -- test_definitions: 認証ユーザー全員が参照可
ALTER TABLE test_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "test_def_select" ON test_definitions FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "test_def_admin_all" ON test_definitions FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- -- test_sections: admin/org のみ直接アクセス（生徒はRPC経由）
ALTER TABLE test_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "test_sections_admin_org" ON test_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'org')));

-- -- test_access: 生徒は自分の行のみ、admin/org はフル
ALTER TABLE test_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "test_access_student_select" ON test_access FOR SELECT
  USING (trainee_id = (SELECT id FROM trainees WHERE auth_user_id = auth.uid()));
CREATE POLICY "test_access_admin_org_all" ON test_access FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'org')));

-- -- test_results: 生徒が自分の結果をSELECTできるよう拡張
-- （既存ポリシーは admin/org/customer 用。student 用を追加）
CREATE POLICY "test_results_student_select" ON test_results FOR SELECT
  USING (trainee_id = (SELECT id FROM trainees WHERE auth_user_id = auth.uid()));

-- -- trainees: 生徒が自分の情報を参照できるよう拡張
CREATE POLICY "trainees_student_select" ON trainees FOR SELECT
  USING (auth_user_id = auth.uid());

-- -- user_profiles: student ロールも自身のプロファイルを参照可能
-- （既存ポリシーで id = auth.uid() があるので追加不要）

-- ===== 7. RPC関数: 問題取得（生徒用） =====
CREATE OR REPLACE FUNCTION get_test_questions(p_test_id VARCHAR, p_section VARCHAR)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  v_trainee_id UUID;
BEGIN
  -- 認証ユーザーの trainee_id を取得
  SELECT t.id INTO v_trainee_id
  FROM trainees t WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a registered student';
  END IF;

  -- 受験許可チェック
  IF NOT EXISTS (
    SELECT 1 FROM test_access
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id
  ) THEN
    RAISE EXCEPTION 'Access denied: test not unlocked';
  END IF;

  -- 既に受験済みかつ再受験不可の場合はブロック
  IF EXISTS (
    SELECT 1 FROM test_results
    WHERE trainee_id = v_trainee_id AND test_name = p_test_id
  ) AND NOT EXISTS (
    SELECT 1 FROM test_access
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id AND is_retake = true
  ) THEN
    RAISE EXCEPTION 'Already submitted: retake not permitted';
  END IF;

  -- questions のみ返す（answer_key は返さない）
  SELECT ts.questions INTO result
  FROM test_sections ts
  WHERE ts.test_id = p_test_id AND ts.section_type = p_section;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 8. RPC関数: 生徒のテスト一覧取得 =====
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
      WHERE trainee_id = v_trainee_id AND test_name = td.id
      ORDER BY created_at DESC LIMIT 1
    ) tr ON true
    WHERE td.is_active = true
  ) r;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 9. テスト定義の初期データ =====
INSERT INTO test_definitions (id, display_name, lesson_range, sections, max_scores, sort_order) VALUES
  ('test1', '第1回 第1-4課',   '1-4',   '["goii","bunpo","chokkai"]', '{"goii":100,"bunpo":100,"chokkai":100}', 1),
  ('test2', '第2回 第5-11課',  '5-11',  '["goii","bunpo","chokkai"]', '{"goii":100,"bunpo":100,"chokkai":100}', 2),
  ('test3', '第3回 第12-18課', '12-18', '["goii","bunpo","chokkai"]', '{"goii":100,"bunpo":100,"chokkai":100}', 3),
  ('test4', '第4回 第19-25課', '19-25', '["goii","bunpo","chokkai"]', '{"goii":100,"bunpo":100,"chokkai":100}', 4),
  ('test5', '第5回 第26-33課', '26-33', '["bunpo","chokkai"]',        '{"bunpo":100,"chokkai":100}',            5),
  ('test6', '第6回 第34-40課', '34-40', '["bunpo","chokkai"]',        '{"bunpo":100,"chokkai":100}',            6),
  ('test7', '第7回 第41-45課', '41-45', '["bunpo","chokkai"]',        '{"bunpo":100,"chokkai":100}',            7),
  ('test8', '第8回 第46-50課', '46-50', '["bunpo","chokkai"]',        '{"bunpo":100,"chokkai":100}',            8)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  lesson_range = EXCLUDED.lesson_range,
  sections = EXCLUDED.sections,
  max_scores = EXCLUDED.max_scores,
  sort_order = EXCLUDED.sort_order;

-- ============================================================
-- ★ 実行後の手動作業 ★
-- ============================================================
--
-- 【Edge Function】grade_and_submit は Supabase Edge Function で実装
-- （採点ロジックがJSで複雑なため、PL/pgSQLでは対応困難）
-- → Phase 4 で別途デプロイ
--
-- 【学生アカウント作成】
-- trainee-manager の app.js から Edge Function 経由で作成
-- → Phase 3 で実装
-- ============================================================
