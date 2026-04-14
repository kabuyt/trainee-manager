-- 顧客ロール対応マイグレーション
-- Supabase SQL Editor で実行すること

-- 1. user_profiles に company カラム追加
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company VARCHAR;

-- 2. trainees テーブルの RLS ポリシーを拡張（customer ロール対応）
-- 既存の SELECT ポリシーを削除して再作成
DROP POLICY IF EXISTS "trainees_select" ON trainees;
CREATE POLICY "trainees_select" ON trainees FOR SELECT USING (
  -- admin: 全データ閲覧可
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  OR
  -- org: 自組織のデータのみ
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'org' AND organization_id = trainees.organization_id)
  OR
  -- customer: 自社のデータのみ（company一致）
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'customer' AND company = trainees.company)
);

-- 3. test_results テーブルの RLS ポリシーを拡張
DROP POLICY IF EXISTS "test_results_select" ON test_results;
CREATE POLICY "test_results_select" ON test_results FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  OR
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles p ON p.id = auth.uid()
    WHERE t.id = test_results.trainee_id
    AND (
      (p.role = 'org' AND p.organization_id = t.organization_id)
      OR
      (p.role = 'customer' AND p.company = t.company)
    )
  )
);

-- 4. monthly_reports テーブルの RLS ポリシーを拡張
DROP POLICY IF EXISTS "monthly_reports_select" ON monthly_reports;
CREATE POLICY "monthly_reports_select" ON monthly_reports FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  OR
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles p ON p.id = auth.uid()
    WHERE t.id = monthly_reports.trainee_id
    AND (
      (p.role = 'org' AND p.organization_id = t.organization_id)
      OR
      (p.role = 'customer' AND p.company = t.company)
    )
  )
);

-- 5. 顧客ユーザーの作成例（手動で実行）
-- ※ まず Supabase Dashboard > Authentication > Users で新規ユーザーを作成
--   Email: blastech@trainee.local, Password: (任意)
-- その後、以下を実行:
--
-- INSERT INTO user_profiles (id, role, company, display_name)
-- VALUES (
--   (SELECT id FROM auth.users WHERE email = 'blastech@trainee.local'),
--   'customer',
--   '株式会社ブラステック',
--   'ブラステック'
-- );
