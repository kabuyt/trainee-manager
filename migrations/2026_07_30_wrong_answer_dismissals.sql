-- 不正解レビュー: 「このまま不正解」で非表示にしたパターンの保存先
-- wrong-answers-review.html が使用。実行するとページの保存先が
-- localStorage（ブラウザ単位）→ このテーブル（全PC共有）に切り替わる。

CREATE TABLE IF NOT EXISTS wrong_answer_dismissals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id VARCHAR NOT NULL,
  section_type VARCHAR NOT NULL,          -- goii / bunpo / chokkai
  block_id VARCHAR NOT NULL,              -- 例: g1, b3, c3_text
  field_id VARCHAR NOT NULL,              -- 例: g1_2
  answer_norm TEXT NOT NULL,              -- 学生回答の正規化形 (trim + lowercase)
  dismissed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (test_id, section_type, block_id, field_id, answer_norm)
);

ALTER TABLE wrong_answer_dismissals ENABLE ROW LEVEL SECURITY;

-- admin / org のみフルアクセス（レビューページ自体が admin/org 限定）
CREATE POLICY "wrong_answer_dismissals_admin_org" ON wrong_answer_dismissals FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'org')))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'org')));
