ALTER TABLE terminology_study_sessions
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_terminology_study_sessions_last_seen_at
  ON terminology_study_sessions(last_seen_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'terminology_study_sessions'
      AND policyname = 'terminology_study_sessions_student_update'
  ) THEN
    CREATE POLICY "terminology_study_sessions_student_update" ON terminology_study_sessions FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM trainees t
          WHERE t.id = terminology_study_sessions.trainee_id
          AND t.auth_user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM trainees t
          WHERE t.id = terminology_study_sessions.trainee_id
          AND t.auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;
