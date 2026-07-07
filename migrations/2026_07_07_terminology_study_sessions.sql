CREATE TABLE IF NOT EXISTS terminology_study_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL DEFAULT 'open',
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (session_type IN ('open'))
);

CREATE INDEX IF NOT EXISTS idx_terminology_study_sessions_trainee_id
  ON terminology_study_sessions(trainee_id);

CREATE INDEX IF NOT EXISTS idx_terminology_study_sessions_created_at
  ON terminology_study_sessions(created_at);

ALTER TABLE terminology_study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terminology_study_sessions_select" ON terminology_study_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = terminology_study_sessions.trainee_id
      AND (up.role = 'admin' OR up.organization_id = t.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_study_sessions.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_study_sessions_student_insert" ON terminology_study_sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_study_sessions.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_study_sessions_admin_all" ON terminology_study_sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
