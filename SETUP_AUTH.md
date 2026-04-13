# 認証セットアップ手順

## ステップ1: SQL Editor でクリーンアップ + RLS修正
URL: https://supabase.com/dashboard/project/ajmdpkwqyeyzemeoojwd/sql/new

```sql
DELETE FROM user_profiles;
DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@trainee.local');
DELETE FROM auth.users WHERE email LIKE '%@trainee.local';
DROP POLICY IF EXISTS "profiles_select" ON user_profiles;
CREATE POLICY "profiles_select" ON user_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
```

## ステップ2: Authentication > Users > Add User で4人作成
URL: https://supabase.com/dashboard/project/ajmdpkwqyeyzemeoojwd/auth/users

| Email                | Password   |
|----------------------|------------|
| admin@trainee.local  | Xk9mPv3nQ7 |
| vjc@trainee.local    | Rw4jLn8sY2 |
| baraen@trainee.local | Ht6wBp1mK5 |
| akane@trainee.local  | Qs3fNd7xW9 |

※「Auto Confirm User」にチェックを入れること

## ステップ3: SQL Editor でプロファイル登録
URL: https://supabase.com/dashboard/project/ajmdpkwqyeyzemeoojwd/sql/new

```sql
INSERT INTO user_profiles (id, organization_id, role, display_name)
SELECT u.id, NULL, 'admin', '管理者'
FROM auth.users u WHERE u.email = 'admin@trainee.local';

INSERT INTO user_profiles (id, organization_id, role, display_name)
SELECT u.id, (SELECT id FROM organizations WHERE slug='vjc'), 'org', 'VJC'
FROM auth.users u WHERE u.email = 'vjc@trainee.local';

INSERT INTO user_profiles (id, organization_id, role, display_name)
SELECT u.id, (SELECT id FROM organizations WHERE slug='baraen'), 'org', 'BARAEN'
FROM auth.users u WHERE u.email = 'baraen@trainee.local';

INSERT INTO user_profiles (id, organization_id, role, display_name)
SELECT u.id, (SELECT id FROM organizations WHERE slug='akane'), 'org', 'AKANE'
FROM auth.users u WHERE u.email = 'akane@trainee.local';
```

## ログイン情報

| ID      | パスワード    | 教育機関 |
|---------|------------|---------|
| admin   | Xk9mPv3nQ7 | 管理者   |
| vjc     | Rw4jLn8sY2 | VJC     |
| baraen  | Ht6wBp1mK5 | BARAEN  |
| akane   | Qs3fNd7xW9 | AKANE   |
