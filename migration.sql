-- ============================================================
-- 差分マイグレーション（既存DBに対して実行）
-- Supabase SQL Editor に貼り付けて実行してください
-- ============================================================

-- ===== STEP 1: 新テーブル作成 =====

-- 教育機関マスタ
CREATE TABLE IF NOT EXISTS organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  slug VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ユーザープロファイル
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  role VARCHAR NOT NULL DEFAULT 'org',
  display_name VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== STEP 2: traineesテーブルにカラム追加 =====
-- （既にあるカラムはエラーになるので、DO ブロックで安全に実行）

DO $$
BEGIN
  -- organization_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainees' AND column_name='organization_id') THEN
    ALTER TABLE trainees ADD COLUMN organization_id UUID REFERENCES organizations(id);
  END IF;
  -- birth_date（既にある可能性あり）
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainees' AND column_name='birth_date') THEN
    ALTER TABLE trainees ADD COLUMN birth_date DATE;
  END IF;
  -- gender
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainees' AND column_name='gender') THEN
    ALTER TABLE trainees ADD COLUMN gender VARCHAR;
  END IF;
  -- photo_url
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainees' AND column_name='photo_url') THEN
    ALTER TABLE trainees ADD COLUMN photo_url VARCHAR;
  END IF;
END $$;

-- ===== STEP 3: 教育機関を登録 =====

INSERT INTO organizations (name, slug) VALUES
  ('教育機関A', 'org-a'),
  ('教育機関B', 'org-b'),
  ('教育機関C', 'org-c')
ON CONFLICT (slug) DO NOTHING;

-- ===== STEP 4: 既存の実習生にデフォルト教育機関を紐付け =====
-- （organization_id が NULL の行を「教育機関A」に紐付け）

UPDATE trainees
SET organization_id = (SELECT id FROM organizations WHERE slug = 'org-a')
WHERE organization_id IS NULL;

-- ※ 全件紐付け後、NOT NULLにしたい場合は以下を実行:
-- ALTER TABLE trainees ALTER COLUMN organization_id SET NOT NULL;

-- ===== STEP 5: 旧RLSポリシーを削除 =====

DROP POLICY IF EXISTS "allow all" ON trainees;
DROP POLICY IF EXISTS "allow all" ON test_results;

-- ===== STEP 6: 新RLSポリシー =====

-- -- trainees
ALTER TABLE trainees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainees_select" ON trainees FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (user_profiles.role = 'admin' OR user_profiles.organization_id = trainees.organization_id)
  )
);

CREATE POLICY "trainees_insert" ON trainees FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (user_profiles.role = 'admin' OR user_profiles.organization_id = trainees.organization_id)
  )
);

CREATE POLICY "trainees_update" ON trainees FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (user_profiles.role = 'admin' OR user_profiles.organization_id = trainees.organization_id)
  )
);

CREATE POLICY "trainees_delete" ON trainees FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid()
    AND (user_profiles.role = 'admin' OR user_profiles.organization_id = trainees.organization_id)
  )
);

-- -- test_results
ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_results_select" ON test_results FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE t.id = test_results.trainee_id
    AND (up.role = 'admin' OR up.organization_id = t.organization_id)
  )
);

CREATE POLICY "test_results_insert" ON test_results FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE t.id = test_results.trainee_id
    AND (up.role = 'admin' OR up.organization_id = t.organization_id)
  )
);

CREATE POLICY "test_results_update" ON test_results FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE t.id = test_results.trainee_id
    AND (up.role = 'admin' OR up.organization_id = t.organization_id)
  )
);

CREATE POLICY "test_results_delete" ON test_results FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM trainees t
    JOIN user_profiles up ON up.id = auth.uid()
    WHERE t.id = test_results.trainee_id
    AND (up.role = 'admin' OR up.organization_id = t.organization_id)
  )
);

-- -- user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON user_profiles FOR SELECT USING (
  id = auth.uid() OR EXISTS (
    SELECT 1 FROM user_profiles admin_check
    WHERE admin_check.id = auth.uid() AND admin_check.role = 'admin'
  )
);

-- -- organizations（認証済みなら全件読み取り可）
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs_select" ON organizations FOR SELECT USING (
  auth.uid() IS NOT NULL
);

-- ===== STEP 7: Storageバケット（写真用） =====

INSERT INTO storage.buckets (id, name, public)
VALUES ('trainee-photos', 'trainee-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "trainee_photos_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'trainee-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "trainee_photos_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'trainee-photos');

CREATE POLICY "trainee_photos_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'trainee-photos' AND auth.uid() IS NOT NULL);


-- ============================================================
-- ★ ここまでがSQL。以下はSQL実行後の手動作業 ★
-- ============================================================
--
-- 【手動作業1】Supabase Dashboard > Authentication > Users で4アカウント作成:
--   - admin@example.com     （管理者）
--   - org-a@example.com     （教育機関A）
--   - org-b@example.com     （教育機関B）
--   - org-c@example.com     （教育機関C）
--   ※メールアドレス・パスワードは自由に変更してOK
--
-- 【手動作業2】作成した各ユーザーのUUIDをコピーし、以下を実行:
--
--   INSERT INTO user_profiles (id, organization_id, role, display_name) VALUES
--     ('<admin-uuid>', NULL, 'admin', '管理者'),
--     ('<org-a-uuid>', (SELECT id FROM organizations WHERE slug='org-a'), 'org', '教育機関A'),
--     ('<org-b-uuid>', (SELECT id FROM organizations WHERE slug='org-b'), 'org', '教育機関B'),
--     ('<org-c-uuid>', (SELECT id FROM organizations WHERE slug='org-c'), 'org', '教育機関C');
--
-- ============================================================
