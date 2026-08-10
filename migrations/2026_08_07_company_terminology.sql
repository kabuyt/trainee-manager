-- 企業マスタと「企業 × 専門用語セット」の紐づけ（2026-08-07）
-- ------------------------------------------------------------
-- 背景:
--   専門用語アプリは今まで trainees.company の文字列を部分一致（'キンレイ'/'オオタ'）で
--   判定してリンクを出し分けていた。会社名は自由入力で表記ゆれがあり（'株式会社  キンレイ亀山'）、
--   似た社名が増えると誤判定する。また1人が複数セット（例: 縫製の汎用セット＋自社セット）を
--   持てない。
-- 方針:
--   企業をマスタ化し、「企業 → セット」を多対多で持つ。実習生は所属企業から自動でセットを得る。
--   個別の例外は既存の terminology_assignments（実習生×セット）で足す。
-- 実行: Supabaseダッシュボード → SQL Editor（service keyではDDL不可）
-- ------------------------------------------------------------

-- 1. 企業マスタ ------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,               -- 表示用の正式名
  occupation TEXT,                          -- 縫製 / 食品製造 / 塗装 など。汎用セットの割当判断に使う
  match_keywords TEXT[] NOT NULL DEFAULT '{}',  -- trainees.company の表記ゆれを吸収する検索語
  organization_id UUID REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN companies.match_keywords IS
  '既存の trainees.company 文字列を名寄せするための語。小文字化して部分一致で照合する';

-- 2. 企業 × 専門用語セット --------------------------------------
CREATE TABLE IF NOT EXISTS company_terminology_sets (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES terminology_sets(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  PRIMARY KEY (company_id, set_id)
);

-- 3. 実習生 → 企業 ----------------------------------------------
--    既存の trainees.company（自由入力）は表示用に残し、紐づけは company_id を正とする。
ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- 4. セット側のメタ ---------------------------------------------
--    app_path: 学生が開くページ。NULL の行（確認テストの回など）はマイページに出さない。
--    kind: company=その企業専用 / occupation=職種の汎用セット
ALTER TABLE terminology_sets
  ADD COLUMN IF NOT EXISTS app_path TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT;

UPDATE terminology_sets SET app_path = 'terminology-login.html', kind = 'company'
  WHERE id = 'kinrei-2023';
UPDATE terminology_sets SET app_path = 'oota-terminology-login.html', kind = 'company'
  WHERE id = 'oota-2026';

-- 5. 企業マスタの初期データ --------------------------------------
--    match_keywords は現在の trainees.company（13種）を拾える最小の語にしている。
--    occupation は判明しているものだけ入れ、不明な会社は NULL のままにする。
INSERT INTO companies (name, occupation, match_keywords) VALUES
  ('株式会社キンレイ亀山',       '食品製造', ARRAY['キンレイ']),
  ('株式会社オオタ',             '塗装',     ARRAY['オオタ']),
  ('株式会社トンボ 美咲工場',    '縫製',     ARRAY['トンボ 美咲', 'トンボ　美咲']),
  ('株式会社トンボ 岡山工場',    '縫製',     ARRAY['トンボ 岡山', 'トンボ　岡山']),
  ('株式会社スカイコーポレーション', '縫製',  ARRAY['スカイコーポレーション']),
  ('株式会社ブラステック',       NULL,       ARRAY['ブラステック']),
  ('クラウン商事株式会社',       NULL,       ARRAY['クラウン商事']),
  ('ロイヤルデリカ',             NULL,       ARRAY['ロイヤルデリカ']),
  ('株式会社藤三',               NULL,       ARRAY['藤三']),
  ('株式会社ハートヒルズ',       NULL,       ARRAY['ハートヒルズ']),
  ('グロップジョイ YKK',         NULL,       ARRAY['グロップジョイ', 'ykk']),
  ('株式会社藤澤組',             NULL,       ARRAY['藤澤組']),
  ('GRVN',                       NULL,       ARRAY['grvn'])
ON CONFLICT (name) DO NOTHING;

-- 6. 既存の実習生を企業に名寄せ ----------------------------------
--    company の空白（半角・全角）を除いてからキーワードを照合する。
UPDATE trainees t
SET company_id = c.id
FROM companies c
WHERE t.company_id IS NULL
  AND t.company IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(c.match_keywords) AS kw
    WHERE replace(replace(lower(t.company), ' ', ''), '　', '')
          LIKE '%' || replace(replace(lower(kw), ' ', ''), '　', '') || '%'
  );

-- 7. 現行の紐づけを再現（キンレイ・オオタ）------------------------
--    縫製セットはまだコンテンツが無いので、ここでは紐づけない。
INSERT INTO company_terminology_sets (company_id, set_id)
SELECT c.id, 'kinrei-2023' FROM companies c WHERE c.name = '株式会社キンレイ亀山'
ON CONFLICT DO NOTHING;

INSERT INTO company_terminology_sets (company_id, set_id)
SELECT c.id, 'oota-2026' FROM companies c WHERE c.name = '株式会社オオタ'
ON CONFLICT DO NOTHING;

-- 8. RLS ---------------------------------------------------------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_terminology_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "companies_admin_all" ON companies;
CREATE POLICY "companies_admin_all" ON companies FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "company_terminology_sets_select" ON company_terminology_sets;
CREATE POLICY "company_terminology_sets_select" ON company_terminology_sets FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "company_terminology_sets_admin_all" ON company_terminology_sets;
CREATE POLICY "company_terminology_sets_admin_all" ON company_terminology_sets FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- 9. 学生用RPC: 自分が使える専門用語セットを返す --------------------
--    企業経由の割当と、個別割当（terminology_assignments）を合わせて返す。
--    app_path が NULL のセット（確認テストの回など）は返さない。
CREATE OR REPLACE FUNCTION get_my_terminology_sets()
RETURNS JSONB AS $$
DECLARE
  v_trainee_id UUID;
  v_company_id UUID;
  result JSONB;
BEGIN
  SELECT t.id, t.company_id INTO v_trainee_id, v_company_id
  FROM trainees t WHERE t.auth_user_id = auth.uid();

  IF v_trainee_id IS NULL THEN
    RAISE EXCEPTION 'Not a registered student';
  END IF;

  SELECT jsonb_agg(row_to_json(s) ORDER BY s.name) INTO result
  FROM (
    SELECT DISTINCT ts.id AS set_id, ts.name, ts.occupation, ts.kind, ts.app_path
    FROM terminology_sets ts
    WHERE ts.is_active = true
      AND ts.app_path IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM company_terminology_sets cts
          WHERE cts.set_id = ts.id AND cts.company_id = v_company_id
        )
        OR EXISTS (
          SELECT 1 FROM terminology_assignments ta
          WHERE ta.set_id = ts.id AND ta.trainee_id = v_trainee_id
        )
      )
  ) s;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
