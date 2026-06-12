-- 実習生の在籍ステータス / アーカイブ対応
-- Supabase SQL Editor で一度だけ実行

ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS graduated_at DATE,
  ADD COLUMN IF NOT EXISTS archive_note TEXT;

ALTER TABLE trainees
  DROP CONSTRAINT IF EXISTS trainees_status_check;

ALTER TABLE trainees
  ADD CONSTRAINT trainees_status_check
  CHECK (status IN ('active', 'graduated', 'withdrawn', 'inactive'));

UPDATE trainees
SET status = 'active'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_trainees_status
  ON trainees(status);
