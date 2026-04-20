#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
学生ログイン情報カードを HTML で生成（A4印刷用、6名/ページ）。
ブラウザで開いて Ctrl+P → PDF保存。

実行: python generate_login_cards.py
出力: login_cards.html
"""

import json
import urllib.request
import os
import sys

URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'
EMAIL_DOMAIN = '@student.trainee.local'
LOGIN_URL = 'https://kabuyt.github.io/nihongo-test-1-4ka/login.html'
OUT = os.path.join(os.path.dirname(__file__), 'login_cards.html')


def get_token():
    body = json.dumps({'email':'admin@trainee.local','password':'Xk9mPv3nQ7'}).encode('utf-8')
    req = urllib.request.Request(f'{URL}/auth/v1/token?grant_type=password', data=body, headers={'Content-Type':'application/json','apikey':ANON})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['access_token']


def fetch_trainees(token, only_with_auth=True):
    flt = '&auth_user_id=not.is.null' if only_with_auth else ''
    url = f'{URL}/rest/v1/trainees?select=student_id,name_katakana,name_romaji,birth_date,class_group,company{flt}&order=class_group,company,student_id'
    req = urllib.request.Request(url, headers={'apikey':ANON,'Authorization':f'Bearer {token}'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def html_for_cards(trainees):
    cards = []
    for t in trainees:
        sid = t.get('student_id', '')
        name_kata = t.get('name_katakana', '')
        name_rom = t.get('name_romaji', '')
        cls = t.get('class_group', '')
        cmp = t.get('company', '')
        bd = t.get('birth_date', '')
        pw = bd.replace('-', '') if bd else ''
        email = f'{sid.lower()}{EMAIL_DOMAIN}'

        cards.append(f'''
<div class="card">
  <div class="card-header">
    <span class="card-title">日本語月間テスト ログイン情報</span>
    <span class="card-id">{sid}</span>
  </div>
  <div class="card-body">
    <table>
      <tr><th>名前 (Katakana)</th><td>{name_kata}</td></tr>
      <tr><th>名前 (Romaji)</th><td>{name_rom}</td></tr>
      <tr><th>クラス / 会社</th><td>{cls} / {cmp}</td></tr>
      <tr class="login-row"><th>サイト URL</th><td class="big">{LOGIN_URL}</td></tr>
      <tr class="login-row"><th>学生 ID</th><td class="big mono">{sid}</td></tr>
      <tr class="login-row"><th>パスワード</th><td class="big mono">{pw}</td></tr>
    </table>
    <div class="note">
      ※ パスワードは生年月日 (YYYYMMDD) です。<br>
      ※ Mật khẩu là ngày sinh (YYYYMMDD).
    </div>
  </div>
</div>''')

    cards_html = '\n'.join(cards)

    return f'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>学生ログイン情報カード（{len(trainees)}名）</title>
<style>
@page {{ size: A4 portrait; margin: 8mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: "Yu Gothic", "Meiryo", sans-serif; margin: 0; padding: 8px; background: #f0f0f0; }}
.toolbar {{
  position: sticky; top: 0; background: #2c3e50; color: #fff; padding: 10px 16px;
  margin: -8px -8px 12px; display: flex; gap: 12px; align-items: center; z-index: 100;
}}
.toolbar button {{
  padding: 6px 16px; background: #27ae60; color: #fff; border: none; border-radius: 4px;
  cursor: pointer; font-size: 14px;
}}
.toolbar .info {{ margin-left: auto; font-size: 13px; }}
.cards-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-width: 210mm; margin: 0 auto; }}
.card {{
  background: #fff; border: 1.5px solid #2c3e50; border-radius: 6px; padding: 10px 12px;
  page-break-inside: avoid; min-height: 80mm; display: flex; flex-direction: column;
}}
.card-header {{
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 2px solid #2c3e50; padding-bottom: 6px; margin-bottom: 8px;
}}
.card-title {{ font-size: 13px; font-weight: bold; color: #2c3e50; }}
.card-id {{ font-size: 16px; font-weight: bold; color: #c0392b; font-family: monospace; }}
.card-body {{ flex: 1; }}
.card table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
.card th {{ text-align: left; padding: 3px 6px; color: #555; font-weight: normal; width: 35%; vertical-align: top; }}
.card td {{ padding: 3px 6px; word-break: break-word; }}
.login-row {{ background: #fffde7; }}
.login-row th {{ font-weight: bold; color: #333; }}
.big {{ font-size: 14px; font-weight: bold; }}
.mono {{ font-family: monospace; }}
.note {{ font-size: 10px; color: #777; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #ccc; }}
@media print {{
  body {{ background: #fff; padding: 0; }}
  .toolbar {{ display: none; }}
  .cards-grid {{ gap: 4mm; }}
  .card {{ box-shadow: none; }}
}}
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">🖨 印刷 / PDF保存 (Ctrl+P)</button>
  <span class="info">対象: {len(trainees)}名 ・ A4 / 2列レイアウト</span>
</div>
<div class="cards-grid">
{cards_html}
</div>
</body>
</html>'''


def main():
    print('Fetching trainees...')
    token = get_token()
    trainees = fetch_trainees(token, only_with_auth=True)
    print(f'  {len(trainees)} 名取得')

    html = html_for_cards(trainees)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'\\nGenerated: {OUT}')
    print(f'  → ブラウザで開いて Ctrl+P → PDFに保存')


if __name__ == '__main__':
    main()
