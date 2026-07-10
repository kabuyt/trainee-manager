CREATE TABLE IF NOT EXISTS terminology_final_unlocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trainee_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  test_set_id TEXT NOT NULL DEFAULT 'kinrei-final-2023',
  is_unlocked BOOLEAN NOT NULL DEFAULT false,
  unlocked_by UUID,
  unlocked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainee_id, test_set_id)
);

CREATE INDEX IF NOT EXISTS idx_terminology_final_unlocks_trainee_id
  ON terminology_final_unlocks(trainee_id);

CREATE INDEX IF NOT EXISTS idx_terminology_final_unlocks_test_set_id
  ON terminology_final_unlocks(test_set_id);

ALTER TABLE terminology_final_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "terminology_final_unlocks_select" ON terminology_final_unlocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainees t
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE t.id = terminology_final_unlocks.trainee_id
      AND (up.role = 'admin' OR up.organization_id = t.organization_id)
    )
    OR EXISTS (
      SELECT 1 FROM trainees t
      WHERE t.id = terminology_final_unlocks.trainee_id
      AND t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "terminology_final_unlocks_admin_all" ON terminology_final_unlocks FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));
