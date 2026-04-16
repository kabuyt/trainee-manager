#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test1の問題データをSupabase SQL RPCで投入"""

import json
import urllib.request

SUPABASE_URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'

# まずadminとしてログインしてaccess tokenを取得
ADMIN_EMAIL = 'admin@trainee.local'
ADMIN_PASS = 'Xk9mPv3nQ7'

def login():
    """Supabase Authでログインしてaccess tokenを取得"""
    url = f'{SUPABASE_URL}/auth/v1/token?grant_type=password'
    body = json.dumps({'email': ADMIN_EMAIL, 'password': ADMIN_PASS}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
    })
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data['access_token']

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
            print(f'  {section_type}: {resp.status} OK')
            return True
    except urllib.error.HTTPError as e:
        print(f'  {section_type}: {e.code} ERROR - {e.read().decode("utf-8")}')
        return False

def main():
    print('Logging in as admin...')
    token = login()
    print('Login successful')

    answer_keys = json.load(open('test1_answer_keys.json', encoding='utf-8'))

    sections = {
        'goii': {
            'questions': json.load(open('test1_goii_questions.json', encoding='utf-8')),
            'answer_key': answer_keys['goii']['answer_key'],
            'scoring_rules': answer_keys['goii']['scoring_rules'],
        },
        'bunpo': {
            'questions': json.load(open('test1_bunpo_questions.json', encoding='utf-8')),
            'answer_key': answer_keys['bunpo']['answer_key'],
            'scoring_rules': answer_keys['bunpo']['scoring_rules'],
        },
        'chokkai': {
            'questions': json.load(open('test1_chokkai_questions.json', encoding='utf-8')),
            'answer_key': answer_keys['chokkai']['answer_key'],
            'scoring_rules': answer_keys['chokkai']['scoring_rules'],
        },
    }

    print('\nUpdating test_sections...')
    for sec_type, data in sections.items():
        update_section(token, 'test1', sec_type,
                      data['questions'], data['answer_key'], data['scoring_rules'])

    # 確認
    print('\nVerifying...')
    url = f'{SUPABASE_URL}/rest/v1/test_sections?test_id=eq.test1&select=test_id,section_type,version'
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
