#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLをMonaco editor用のJS文字列に変換"""
import json

with open('test1_insert.sql', 'r', encoding='utf-8') as f:
    sql = f.read()

# JS template literal用にエスケープ
sql_escaped = sql.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

# JS snippetを生成
js = f"""const editors = window.monaco?.editor?.getEditors?.();
if (editors && editors.length > 0) {{
  editors[editors.length - 1].setValue(`{sql_escaped}`);
  'done';
}} else {{
  'no editor';
}}"""

with open('set_editor.js', 'w', encoding='utf-8') as f:
    f.write(js)

print(f'Generated set_editor.js ({len(js)} chars)')
