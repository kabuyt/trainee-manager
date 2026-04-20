#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
学生アカウント一括作成スクリプト
auth_user_id が NULL の trainees に対して Supabase Auth ユーザーを作成し、
trainees.auth_user_id を紐付ける。

メール形式: {student_id}@student.trainee.local
パスワード: 生年月日 YYYYMMDD

実行方法:
  python create_student_accounts.py                    # ドライラン（作成しない、対象一覧のみ）
  python create_student_accounts.py --apply            # 実際に作成
  python create_student_accounts.py --apply --class 1期生  # クラス指定
  python create_student_accounts.py --apply --id VJC001   # 個別指定

service_role キーは環境変数 SUPABASE_SERVICE_KEY または初回実行時にプロンプトで入力。
"""

import json
import urllib.request
import urllib.error
import sys
import os
import getpass
import argparse

SUPABASE_URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'
EMAIL_DOMAIN = '@student.trainee.local'

# キャッシュファイル（service_roleキー保存。.gitignoreに追加すること）
KEY_CACHE = os.path.join(os.path.dirname(__file__), '.service_key.cache')


def get_service_key():
    """service_roleキー取得（環境変数→キャッシュ→プロンプトの優先順）"""
    key = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
    if key:
        return key
    if os.path.exists(KEY_CACHE):
        with open(KEY_CACHE) as f:
            cached = f.read().strip()
            if cached:
                return cached
    print('Supabase service_role キーを入力してください')
    print('  Dashboard > Settings > API > service_role secret')
    key = getpass.getpass('service_role key: ').strip()
    if not key:
        print('キーが空です。終了。')
        sys.exit(1)
    save = input('このキーをローカルにキャッシュしますか？ (y/N): ').strip().lower()
    if save == 'y':
        with open(KEY_CACHE, 'w') as f:
            f.write(key)
        os.chmod(KEY_CACHE, 0o600)
        print(f'  → {KEY_CACHE} に保存しました（.gitignoreで除外推奨）')
    return key


def http_request(url, method='GET', body=None, headers=None):
    """HTTPリクエスト共通"""
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode('utf-8')
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        txt = e.read().decode('utf-8')
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {'error': txt}


def fetch_trainees(service_key):
    """auth_user_id が NULL の trainees を取得"""
    url = f'{SUPABASE_URL}/rest/v1/trainees?select=id,student_id,name_katakana,birth_date,class_group,company,auth_user_id&auth_user_id=is.null&order=student_id'
    headers = {'apikey': service_key, 'Authorization': f'Bearer {service_key}'}
    status, data = http_request(url, headers=headers)
    if status != 200:
        print(f'trainees取得失敗: {status} {data}')
        sys.exit(1)
    return data or []


def create_auth_user(service_key, email, password, student_id, name):
    """Supabase Auth Admin API でユーザー作成"""
    url = f'{SUPABASE_URL}/auth/v1/admin/users'
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
    }
    body = {
        'email': email,
        'password': password,
        'email_confirm': True,
        'user_metadata': {'student_id': student_id, 'name': name, 'role': 'student'},
    }
    status, data = http_request(url, method='POST', body=body, headers=headers)
    if status in (200, 201):
        return data.get('id') or data.get('user', {}).get('id'), None
    # 既存メールエラー: 既存ユーザーのIDを取得
    if status == 422 or (data and 'already' in json.dumps(data).lower()):
        return _find_user_id_by_email(service_key, email), 'already_exists'
    return None, f'{status}: {data}'


def _find_user_id_by_email(service_key, email):
    """既存ユーザーのIDをメールから取得"""
    url = f'{SUPABASE_URL}/auth/v1/admin/users?email={urllib.parse.quote(email)}'
    headers = {'apikey': service_key, 'Authorization': f'Bearer {service_key}'}
    status, data = http_request(url, headers=headers)
    if status == 200 and data:
        users = data.get('users', [])
        for u in users:
            if (u.get('email') or '').lower() == email.lower():
                return u['id']
    return None


def update_trainee_link(service_key, trainee_id, auth_user_id):
    """trainees.auth_user_id を更新"""
    url = f'{SUPABASE_URL}/rest/v1/trainees?id=eq.{trainee_id}'
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    }
    status, data = http_request(url, method='PATCH', body={'auth_user_id': auth_user_id}, headers=headers)
    if status not in (200, 204):
        return f'PATCH失敗 {status}: {data}'
    return None


def main():
    parser = argparse.ArgumentParser(description='学生アカウント一括作成')
    parser.add_argument('--apply', action='store_true', help='実際に作成（指定なしはドライラン）')
    parser.add_argument('--class', dest='class_filter', help='クラスでフィルタ（例: 1期生）')
    parser.add_argument('--company', dest='company_filter', help='会社でフィルタ')
    parser.add_argument('--id', dest='id_filter', help='学生IDでフィルタ（カンマ区切りで複数可）')
    args = parser.parse_args()

    service_key = get_service_key()
    print('\n対象学生を取得中...')
    trainees = fetch_trainees(service_key)
    print(f'  auth_user_id NULL: {len(trainees)}名')

    # フィルタ
    if args.class_filter:
        trainees = [t for t in trainees if t.get('class_group') == args.class_filter]
    if args.company_filter:
        trainees = [t for t in trainees if t.get('company') == args.company_filter]
    if args.id_filter:
        ids = [s.strip().upper() for s in args.id_filter.split(',')]
        trainees = [t for t in trainees if (t.get('student_id') or '').upper() in ids]

    # birth_date 必須チェック
    valid = [t for t in trainees if t.get('birth_date') and t.get('student_id')]
    invalid = [t for t in trainees if not t.get('birth_date') or not t.get('student_id')]

    print(f'  フィルタ後: {len(trainees)}名')
    print(f'  作成可能（birth_date有り）: {len(valid)}名')
    if invalid:
        print(f'  ⚠ 作成不可（birth_date欠落）: {len(invalid)}名')
        for t in invalid[:5]:
            print(f'    - {t.get(\"student_id\",\"?\")} {t.get(\"name_katakana\",\"?\")}')

    if not valid:
        print('\n作成対象なし。終了。')
        return

    # ドライラン
    print('\n--- 作成予定 ---')
    for t in valid[:10]:
        bd = t['birth_date'].replace('-', '')
        print(f'  {t[\"student_id\"]} ({t[\"name_katakana\"]}) → {t[\"student_id\"]}{EMAIL_DOMAIN} / pw={bd}')
    if len(valid) > 10:
        print(f'  ... 他 {len(valid) - 10}名')

    if not args.apply:
        print('\n[ドライラン] 実行するには --apply を付けてください')
        return

    confirm = input(f'\n{len(valid)}名のアカウントを作成します。よろしいですか？ (yes/no): ').strip().lower()
    if confirm != 'yes':
        print('キャンセル')
        return

    # 実行
    print('\n作成中...')
    success, already, fail = 0, 0, 0
    fail_list = []
    for i, t in enumerate(valid, 1):
        sid = t['student_id']
        email = f'{sid}{EMAIL_DOMAIN}'.lower()
        password = t['birth_date'].replace('-', '')
        name = t.get('name_katakana', '')

        user_id, err = create_auth_user(service_key, email, password, sid, name)
        if user_id:
            link_err = update_trainee_link(service_key, t['id'], user_id)
            if link_err:
                fail += 1
                fail_list.append((sid, link_err))
                print(f'  [{i}/{len(valid)}] {sid}: 作成OKだが紐付け失敗 - {link_err}')
            else:
                if err == 'already_exists':
                    already += 1
                    print(f'  [{i}/{len(valid)}] {sid}: 既存ユーザーと紐付け')
                else:
                    success += 1
                    print(f'  [{i}/{len(valid)}] {sid}: ✓')
        else:
            fail += 1
            fail_list.append((sid, err))
            print(f'  [{i}/{len(valid)}] {sid}: ✗ {err}')

    print('\n=== 結果 ===')
    print(f'  新規作成: {success}名')
    print(f'  既存と紐付け: {already}名')
    print(f'  失敗: {fail}名')
    if fail_list:
        print('\n失敗詳細:')
        for sid, err in fail_list:
            print(f'  {sid}: {err}')


if __name__ == '__main__':
    main()
