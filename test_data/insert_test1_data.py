#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test1の問題データをSupabase test_sectionsテーブルに投入するスクリプト"""

import json
import urllib.request
import sys

SUPABASE_URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def update_section(test_id, section_type, questions, answer_key, scoring_rules):
    """test_sectionsの行をRPC経由でUPDATEする（RLSをバイパス）"""
    # postgresロールでSQLを直接実行はできないので、REST API PATCHを使う
    # ただしanon keyではRLS制限がある。代わりにSQL Editorで実行用のSQLを生成する
    pass

def generate_sql():
    """SQL文を生成してファイルに出力"""
    answer_keys = load_json('test1_answer_keys.json')

    sections = {
        'goii': {
            'questions': load_json('test1_goii_questions.json'),
            'answer_key': answer_keys['goii']['answer_key'],
            'scoring_rules': answer_keys['goii']['scoring_rules'],
        },
        'bunpo': {
            'questions': load_json('test1_bunpo_questions.json'),
            'answer_key': answer_keys['bunpo']['answer_key'],
            'scoring_rules': answer_keys['bunpo']['scoring_rules'],
        },
        'chokkai': {
            'questions': load_json('test1_chokkai_questions.json'),
            'answer_key': answer_keys['chokkai']['answer_key'],
            'scoring_rules': answer_keys['chokkai']['scoring_rules'],
        },
    }

    sql_parts = ['-- test1 問題データ投入（自動生成）\n']

    for sec_type, data in sections.items():
        q_json = json.dumps(data['questions'], ensure_ascii=False, separators=(',', ':'))
        a_json = json.dumps(data['answer_key'], ensure_ascii=False, separators=(',', ':'))
        s_json = json.dumps(data['scoring_rules'], ensure_ascii=False, separators=(',', ':'))

        # SQLのシングルクォートをエスケープ
        q_json = q_json.replace("'", "''")
        a_json = a_json.replace("'", "''")
        s_json = s_json.replace("'", "''")

        sql = f"""UPDATE test_sections SET
  questions = '{q_json}'::jsonb,
  answer_key = '{a_json}'::jsonb,
  scoring_rules = '{s_json}'::jsonb,
  updated_at = NOW()
WHERE test_id = 'test1' AND section_type = '{sec_type}';
"""
        sql_parts.append(sql)

    sql_parts.append("\nSELECT test_id, section_type, jsonb_array_length(questions) as q_count FROM test_sections WHERE test_id = 'test1';")

    output = '\n'.join(sql_parts)
    out_path = 'test1_insert.sql'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(output)

    print(f'Generated: {out_path}')
    print(f'Total SQL size: {len(output)} chars')
    for sec_type, data in sections.items():
        print(f'  {sec_type}: {len(data["questions"])} questions')

if __name__ == '__main__':
    generate_sql()
