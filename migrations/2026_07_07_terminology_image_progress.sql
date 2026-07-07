CREATE TABLE IF NOT EXISTS terminology_image_progress (
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  image_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  last_studied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trainee_id, image_id),
  CHECK (status IN ('new', 'learning', 'learned', 'review'))
);

CREATE INDEX IF NOT EXISTS idx_terminology_image_progress_trainee_id
  ON terminology_image_progress(trainee_id);

ALTER TABLE terminology_image_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terminology_image_progress_select" ON terminology_image_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = terminology_image_progress.trainee_id
      AND (up.role = 'admin' OR up.organization_id = t.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_image_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_image_progress_student_insert" ON terminology_image_progress FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_image_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_image_progress_student_update" ON terminology_image_progress FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_image_progress.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_image_progress_admin_all" ON terminology_image_progress FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
