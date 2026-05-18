-- Manual scoring support for test result detail pages.
-- Keeps teacher-entered points separate from the original automatic scores.

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS manual_score_vocab NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_score_grammar NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_score_listening NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_scores_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manually_scored_at TIMESTAMPTZ;

COMMENT ON COLUMN test_results.manual_score_vocab IS 'Teacher-entered additional vocab score.';
COMMENT ON COLUMN test_results.manual_score_grammar IS 'Teacher-entered additional grammar score.';
COMMENT ON COLUMN test_results.manual_score_listening IS 'Teacher-entered additional listening score.';
COMMENT ON COLUMN test_results.manual_scores_json IS 'Per-field manual scoring details keyed by field_id.';
COMMENT ON COLUMN test_results.manually_scored_at IS 'Last time manual scoring was saved.';
