-- Supabaseの「SQL Editor」に貼り付けて実行してください

-- 実習生テーブル
CREATE TABLE trainees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name_romaji VARCHAR NOT NULL,
  name_katakana VARCHAR,
  company VARCHAR,
  class_group VARCHAR,
  arrival_date DATE,
  stay_period VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- テスト結果テーブル
CREATE TABLE test_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trainee_id UUID REFERENCES trainees(id) ON DELETE CASCADE,
  test_name VARCHAR,
  test_date DATE,
  score_vocab NUMERIC,
  score_grammar NUMERIC,
  score_listening NUMERIC,
  score_conversation NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 誰でも読み書きできるようにする（開発用）
ALTER TABLE trainees ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow all" ON trainees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow all" ON test_results FOR ALL USING (true) WITH CHECK (true);
