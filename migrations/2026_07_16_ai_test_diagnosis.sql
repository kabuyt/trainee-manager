-- Persist one stable AI diagnosis per test result so reports and PDFs agree.

ALTER TABLE public.test_results
  ADD COLUMN IF NOT EXISTS ai_diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS ai_diagnosis_json JSONB,
  ADD COLUMN IF NOT EXISTS ai_diagnosis_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_diagnosis_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS ai_diagnosis_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.test_results.ai_diagnosis IS
  'Japanese report narrative generated from anonymized aggregate test performance.';
COMMENT ON COLUMN public.test_results.ai_diagnosis_json IS
  'Structured AI diagnosis fields used to compose ai_diagnosis.';
COMMENT ON COLUMN public.test_results.ai_diagnosis_input_hash IS
  'SHA-256 of the anonymized aggregate input used for generation.';

NOTIFY pgrst, 'reload schema';
