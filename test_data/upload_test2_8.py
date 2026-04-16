#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test2〜test8の問題データをSupabaseに投入"""

import json
import urllib.request
import urllib.error
import sys

SUPABASE_URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'

ADMIN_EMAIL = 'admin@trainee.local'
ADMIN_PASS = 'Xk9mPv3nQ7'


def login():
    url = f'{SUPABASE_URL}/auth/v1/token?grant_type=password'
    body = json.dumps({'email': ADMIN_EMAIL, 'password': ADMIN_PASS}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
    })
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data['access_token']


def ensure_section_exists(token, test_id, section_type):
    """test_sectionsの行が存在しなければINSERT"""
    url = f'{SUPABASE_URL}/rest/v1/test_sections?test_id=eq.{test_id}&section_type=eq.{section_type}&select=id'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {token}',
    })
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode('utf-8'))
        if rows:
            return  # already exists

    # INSERT
    url = f'{SUPABASE_URL}/rest/v1/test_sections'
    body = json.dumps({
        'test_id': test_id,
        'section_type': section_type,
        'questions': [],
        'answer_key': {},
        'scoring_rules': {},
    }).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {token}',
        'Prefer': 'return=minimal',
    })
    try:
        with urllib.request.urlopen(req) as resp:
            print(f'  Created {test_id}/{section_type}')
    except urllib.error.HTTPError as e:
        print(f'  Insert {test_id}/{section_type}: {e.code} - {e.read().decode("utf-8")}')


def update_section(token, test_id, section_type, questions, answer_key, scoring_rules):
    """test_sectionsの行をREST API PATCHで更新"""
    url = f'{SUPABASE_URL}/rest/v1/test_sections?test_id=eq.{test_id}&section_type=eq.{section_type}'
    body = json.dumps({
        'questions': questions,
        'answer_key': answer_key,
        'scoring_rules': scoring_rules,
    }, ensure_ascii=False).encode('utf-8')

    req = urllib.request.Request(url, data=body, method='PATCH', headers={
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {token}',
        'Prefer': 'return=minimal',
    })

    try:
        with urllib.request.urlopen(req) as resp:
            print(f'  {test_id}/{section_type}: {resp.status} OK')
            return True
    except urllib.error.HTTPError as e:
        print(f'  {test_id}/{section_type}: {e.code} ERROR - {e.read().decode("utf-8")}')
        return False


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def process_test(token, test_id, sections):
    """1つのテストの全セクションを投入"""
    print(f'\n=== {test_id} ===')

    # answer_keys.json を読み込む
    answer_keys = load_json(f'{test_id}_answer_keys.json')

    for sec_type in sections:
        # セクション行を確保
        ensure_section_exists(token, test_id, sec_type)

        # questionsファイル
        questions = load_json(f'{test_id}_{sec_type}_questions.json')

        # answer_keyとscoring_rulesを取得
        ak = answer_keys.get(sec_type, {})
        if isinstance(ak, dict):
            answer_key = ak.get('answer_key', ak)
            scoring_rules = ak.get('scoring_rules', {})
        else:
            answer_key = ak
            scoring_rules = {}

        update_section(token, test_id, sec_type, questions, answer_key, scoring_rules)


def main():
    # 対象テストの定義
    tests = {
        'test2': ['goii', 'bunpo', 'chokkai'],
        'test3': ['goii', 'bunpo', 'chokkai'],
        'test4': ['goii', 'bunpo', 'chokkai'],
        'test5': ['bunpo', 'chokkai'],
        'test6': ['bunpo', 'chokkai'],
        'test7': ['bunpo', 'chokkai'],
        'test8': ['bunpo', 'chokkai'],
    }

    # 特定のテストだけ処理する場合: python upload_test2_8.py test2 test3
    if len(sys.argv) > 1:
        selected = sys.argv[1:]
        tests = {k: v for k, v in tests.items() if k in selected}

    print('Logging in as admin...')
    token = login()
    print('Login successful')

    for test_id, sections in tests.items():
        process_test(token, test_id, sections)

    # 確認
    print('\n=== Verification ===')
    url = f'{SUPABASE_URL}/rest/v1/test_sections?select=test_id,section_type,version&order=test_id,section_type'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {token}',
    })
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        for r in result:
            print(f"  {r['test_id']} / {r['section_type']} (v{r['version']})")

    print('\nDone!')


if __name__ == '__main__':
    main()
