-- 専門用語暗記・確認テスト
-- Supabase SQL Editor で実行すると、実習生ごとの専門用語進捗を保存できます。

CREATE TABLE IF NOT EXISTS terminology_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  occupation TEXT,
  organization_id UUID REFERENCES organizations(id),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS terminology_terms (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES terminology_sets(id) ON DELETE CASCADE,
  category TEXT,
  term TEXT NOT NULL,
  kana TEXT,
  meaning_vi TEXT NOT NULL,
  image_url TEXT,
  audio_url TEXT,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS terminology_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES terminology_sets(id) ON DELETE CASCADE,
  trainee_id UUID REFERENCES trainees(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  company TEXT,
  class_group TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  CHECK (
    trainee_id IS NOT NULL
    OR organization_id IS NOT NULL
    OR company IS NOT NULL
    OR class_group IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS terminology_progress (
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES terminology_terms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new',
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_studied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trainee_id, term_id),
  CHECK (status IN ('new', 'learning', 'learned', 'review'))
);

CREATE TABLE IF NOT EXISTS terminology_quiz_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES terminology_sets(id) ON DELETE CASCADE,
  total_questions INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  score_rate NUMERIC NOT NULL,
  answers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO terminology_sets (id, name, company, occupation, description)
VALUES (
  'kinrei-2023',
  'キンレイ専門用語 2023',
  'キンレイ',
  '食品製造',
  '物の名前、原材料、動詞、作業位置の専門用語'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  company = EXCLUDED.company,
  occupation = EXCLUDED.occupation,
  description = EXCLUDED.description,
  is_active = true;

CREATE INDEX IF NOT EXISTS idx_terminology_terms_set_id ON terminology_terms(set_id);
CREATE INDEX IF NOT EXISTS idx_terminology_progress_trainee_id ON terminology_progress(trainee_id);
CREATE INDEX IF NOT EXISTS idx_terminology_quiz_results_trainee_id ON terminology_quiz_results(trainee_id);

ALTER TABLE terminology_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminology_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminology_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminology_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminology_quiz_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terminology_sets_select" ON terminology_sets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "terminology_sets_admin_all" ON terminology_sets FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "terminology_terms_select" ON terminology_terms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "terminology_terms_admin_all" ON terminology_terms FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "terminology_assignments_select" ON terminology_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND (up.role = 'admin' OR up.organization_id = terminology_assignments.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.auth_user_id = auth.uid()
      AND (
        terminology_assignments.trainee_id = t.id
        OR terminology_assignments.organization_id = t.organization_id
        OR terminology_assignments.company = t.company
        OR terminology_assignments.class_group = t.class_group
      )
    )
  );

CREATE POLICY "terminology_assignments_admin_all" ON terminology_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "terminology_progress_select" ON terminology_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = terminology_progress.trainee_id
      AND (up.role = 'admin' OR up.organization_id = t.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_progress_student_insert" ON terminology_progress FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_progress_student_update" ON terminology_progress FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_progress_admin_all" ON terminology_progress FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "terminology_quiz_results_select" ON terminology_quiz_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = terminology_quiz_results.trainee_id
      AND (up.role = 'admin' OR up.organization_id = t.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_quiz_results.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_quiz_results_student_insert" ON terminology_quiz_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_quiz_results.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_quiz_results_admin_all" ON terminology_quiz_results FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
