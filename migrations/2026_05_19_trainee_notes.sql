-- 実習生個別の備考・メモ欄
-- 教師・admin が自由記述メモを残せるようにする

ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN trainees.notes IS 'Free-text memo / notes about the trainee (internal admin use).';
