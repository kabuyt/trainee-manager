-- Durable per-section checkpoints for revisioned monthly tests.
-- The final score remains one test_results row; these columns only protect an
-- in-progress attempt from reloads/network loss between sections.

ALTER TABLE test_attempt_sessions
  ADD COLUMN IF NOT EXISTS draft_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_section VARCHAR,
  ADD COLUMN IF NOT EXISTS section_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS section_deadline TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION reset_monthly_checkpoint_on_new_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.consumed_at IS NOT NULL OR OLD.expires_at <= NOW())
     AND NEW.consumed_at IS NULL
     AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    NEW.draft_answers := '{}'::jsonb;
    NEW.completed_sections := '[]'::jsonb;
    NEW.active_section := NULL;
    NEW.section_started_at := NULL;
    NEW.section_deadline := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_monthly_checkpoint_on_new_attempt ON test_attempt_sessions;
CREATE TRIGGER trg_reset_monthly_checkpoint_on_new_attempt
BEFORE UPDATE ON test_attempt_sessions
FOR EACH ROW EXECUTE FUNCTION reset_monthly_checkpoint_on_new_attempt();

CREATE OR REPLACE FUNCTION get_monthly_attempt_progress(
  p_test_id VARCHAR,
  p_test_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainee_id UUID;
  v_first_section VARCHAR;
  v_row test_attempt_sessions%ROWTYPE;
BEGIN
  SELECT id INTO v_trainee_id FROM trainees WHERE auth_user_id = auth.uid();
  IF v_trainee_id IS NULL THEN RAISE EXCEPTION 'Not a student'; END IF;

  SELECT jsonb_array_elements_text(sections) INTO v_first_section
  FROM test_definitions WHERE id = p_test_id LIMIT 1;

  SELECT * INTO v_row FROM test_attempt_sessions
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id
    AND test_revision = p_test_revision AND consumed_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active attempt session for % r%', p_test_id, p_test_revision;
  END IF;

  IF v_row.active_section IS NULL AND jsonb_array_length(v_row.completed_sections) = 0 THEN
    UPDATE test_attempt_sessions
    SET active_section = v_first_section,
        section_started_at = NOW(),
        section_deadline = NOW() + INTERVAL '50 minutes',
        last_accessed_at = NOW()
    WHERE trainee_id = v_trainee_id AND test_id = p_test_id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'answers', v_row.draft_answers,
    'completed_sections', v_row.completed_sections,
    'active_section', v_row.active_section,
    'section_deadline', v_row.section_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION get_monthly_attempt_progress(VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_monthly_attempt_progress(VARCHAR, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION save_monthly_section_checkpoint(
  p_test_id VARCHAR,
  p_test_revision INTEGER,
  p_section VARCHAR,
  p_answers JSONB,
  p_complete BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trainee_id UUID;
  v_row test_attempt_sessions%ROWTYPE;
  v_sections JSONB;
  v_index INTEGER;
  v_next VARCHAR;
BEGIN
  SELECT id INTO v_trainee_id FROM trainees WHERE auth_user_id = auth.uid();
  IF v_trainee_id IS NULL THEN RAISE EXCEPTION 'Not a student'; END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION 'Section answers must be an object';
  END IF;

  SELECT sections INTO v_sections FROM test_definitions WHERE id = p_test_id;
  IF v_sections IS NULL OR NOT (v_sections ? p_section) THEN
    RAISE EXCEPTION 'Unknown section % for %', p_section, p_test_id;
  END IF;

  SELECT * INTO v_row FROM test_attempt_sessions
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id
    AND test_revision = p_test_revision AND consumed_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active attempt session for % r%', p_test_id, p_test_revision;
  END IF;
  IF p_complete AND v_row.active_section IS DISTINCT FROM p_section THEN
    RAISE EXCEPTION 'Section % is not active', p_section;
  END IF;

  IF p_complete THEN
    SELECT ordinality - 1 INTO v_index
    FROM jsonb_array_elements_text(v_sections) WITH ORDINALITY s(value, ordinality)
    WHERE value = p_section;
    IF v_index + 1 < jsonb_array_length(v_sections) THEN
      v_next := v_sections ->> (v_index + 1);
    END IF;
  ELSE
    v_next := v_row.active_section;
  END IF;

  UPDATE test_attempt_sessions
  SET draft_answers = draft_answers || p_answers,
      completed_sections = CASE
        WHEN p_complete AND NOT (completed_sections ? p_section)
          THEN completed_sections || jsonb_build_array(p_section)
        ELSE completed_sections END,
      active_section = CASE WHEN p_complete THEN v_next ELSE active_section END,
      section_started_at = CASE WHEN p_complete AND v_next IS NOT NULL THEN NOW() ELSE section_started_at END,
      section_deadline = CASE WHEN p_complete AND v_next IS NOT NULL THEN NOW() + INTERVAL '50 minutes'
                              WHEN p_complete THEN NULL ELSE section_deadline END,
      last_accessed_at = NOW()
  WHERE trainee_id = v_trainee_id AND test_id = p_test_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'answers', v_row.draft_answers,
    'completed_sections', v_row.completed_sections,
    'active_section', v_row.active_section,
    'section_deadline', v_row.section_deadline
  );
END;
$$;

REVOKE ALL ON FUNCTION save_monthly_section_checkpoint(VARCHAR, INTEGER, VARCHAR, JSONB, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_monthly_section_checkpoint(VARCHAR, INTEGER, VARCHAR, JSONB, BOOLEAN)
  TO authenticated;
