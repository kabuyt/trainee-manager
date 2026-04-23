#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全 test_results を answers_json と最新の answer_key / scoring_rules で再採点。
grading.js の採点ロジックを Python にポート。

実行: SUPABASE_SERVICE_KEY=xxx python regrade_all.py [--dry-run]
"""
import os, sys, json, re, unicodedata, urllib.request, urllib.error
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
KEY_CACHE = os.path.join(os.path.dirname(__file__), '.service_key.cache')
if not KEY and os.path.exists(KEY_CACHE):
    with open(KEY_CACHE) as f:
        KEY = f.read().strip()
if not KEY:
    print('SUPABASE_SERVICE_KEY 未設定。cache ファイルも無し。')
    sys.exit(1)

HDR = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

DRY_RUN = '--dry-run' in sys.argv


# ========== 採点 helper (grading.js 相当) ==========

def normalize(s, opts=None):
    opts = opts or {}
    if s is None: return ''
    s = str(s)
    if opts.get('trim') is not False:
        s = s.strip()
    if opts.get('normalize_spaces'):
        s = re.sub(r'\s+', ' ', s)
    if opts.get('case_insensitive'):
        s = s.lower()
    if opts.get('strip_accents'):
        # ベトナム語等のアクセント除去
        s = unicodedata.normalize('NFD', s)
        s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
        s = s.replace('đ', 'd').replace('Đ', 'D')
    if opts.get('strip_punctuation'):
        s = re.sub(r'[、。，．・,\.\s]+', '', s)
    if opts.get('strip_suffix'):
        s = re.sub(opts['strip_suffix'] + '$', '', s)
    if opts.get('strip_hyphens'):
        s = re.sub(r'[-ー－]', '', s)
    return s


def g_exact_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    score = 0
    for fid in rule.get('field_ids', []):
        if isinstance(ak, dict):
            expected = ak.get(fid)
        elif isinstance(ak, list):
            try:
                idx = int(fid.rsplit('_', 1)[-1]) - 1
                expected = ak[idx] if 0 <= idx < len(ak) else None
            except:
                expected = None
        else:
            expected = None
        if expected is None: continue
        if normalize(answers.get(fid)) == normalize(expected):
            score += pts
    return score


def g_flex_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    opts = {
        'case_insensitive': rule.get('case_insensitive', True),
        'normalize_spaces': rule.get('normalize_spaces', True),
        'strip_accents': rule.get('strip_accents', True),  # デフォルトON
        'strip_suffix': rule.get('strip_suffix'),
    }
    sep = rule.get('separator', '／')
    # separatorは複数文字対応（指定文字 + 全角読点+半角スラッシュ）
    sep_pattern = '[' + re.escape(sep) + '、/]'
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if expected is None: continue
        exp_variants = [normalize(v, opts) for v in re.split(sep_pattern, str(expected))]
        exp_variants = [v for v in exp_variants if v]
        actual = answers.get(fid) or ''
        act_variants = [normalize(v, opts) for v in re.split(sep_pattern, str(actual))]
        act_variants = [v for v in act_variants if v]
        if not act_variants: continue
        matched = any(e == a or a in e or e in a for e in exp_variants for a in act_variants)
        if matched:
            score += pts
    return score


def g_normalized_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    opts = {'strip_punctuation': True, 'case_insensitive': True}
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if expected is None: continue
        exps = [normalize(e, opts) for e in (expected if isinstance(expected, list) else [expected])]
        actN = normalize(answers.get(fid), opts)
        if not actN: continue
        if any(e == actN for e in exps):
            score += pts
    return score


def g_split_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    sep = rule.get('separator', '／')
    opts = {'case_insensitive': rule.get('case_insensitive', True)}
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if expected is None: continue
        variants = [normalize(v, opts) for v in str(expected).split(sep)]
        actN = normalize(answers.get(fid), opts)
        if not actN: continue
        if any(v == actN for v in variants):
            score += pts
    return score


def g_radio_exact(rule, ak, answers):
    pts = rule.get('points_each', 1)
    field_ids = rule.get('field_ids', [])
    arr = ak if isinstance(ak, list) else [ak.get(fid) for fid in field_ids]
    score = 0
    for i, fid in enumerate(field_ids):
        expected = arr[i] if i < len(arr) else None
        if not expected: continue
        if normalize(answers.get(fid)) == normalize(expected):
            score += pts
    return score


def g_ox_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if not expected: continue
        if str(answers.get(fid) or '').replace('✕', '×') == str(expected).replace('✕', '×'):
            score += pts
    return score


def g_phone_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    opts = {'strip_hyphens': True}
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if not expected: continue
        if normalize(answers.get(fid), opts) == normalize(expected, opts):
            score += pts
    return score


def g_substring_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    min_len = rule.get('min_length', 3)
    score = 0
    field_ids = rule.get('field_ids', [])
    for i, fid in enumerate(field_ids):
        if isinstance(ak, list):
            expected = ak[i] if i < len(ak) else None
        else:
            expected = ak.get(fid)
        actual = answers.get(fid)
        if not expected or not actual: continue
        expN = normalize(expected)
        actN = normalize(actual)
        if len(actN) < min_len: continue
        if expN in actN or actN in expN:
            score += pts
    return score


def g_multi_field_group(rule, ak, answers):
    ppf = rule.get('points_per_field', rule.get('points_each', 1))
    score = 0
    for group in rule.get('groups', []):
        all_ok = True
        for fid in group:
            expected = ak.get(fid) if isinstance(ak, dict) else None
            if expected is None:
                all_ok = False; break
            user = answers.get(fid)
            if isinstance(expected, list):
                if not any(normalize(user) == normalize(e) for e in expected):
                    all_ok = False; break
            else:
                if normalize(user) != normalize(expected):
                    all_ok = False; break
        if all_ok:
            score += ppf * len(group)
    return score


def g_multi_field_match(rule, ak, answers):
    ppf = rule.get('points_per_field', rule.get('points_each', 1))
    score = 0
    for fid in rule.get('field_ids', []):
        expected = ak.get(fid) if isinstance(ak, dict) else None
        if expected is None: continue
        user = answers.get(fid)
        if isinstance(expected, list):
            if any(normalize(user) == normalize(e) for e in expected):
                score += ppf
        else:
            if normalize(user) == normalize(expected):
                score += ppf
    return score


def g_pair_match(rule, ak, answers):
    pts = rule.get('points_each', 1)
    score = 0
    for i, pair in enumerate(rule.get('items', [])):
        a_field = pair['a_field']
        b_field = pair['b_field']
        if isinstance(ak, list):
            a_exp = (ak[i] or {}).get('a') if i < len(ak) else None
            b_exp = (ak[i] or {}).get('b') if i < len(ak) else None
        else:
            a_exp = ak.get(a_field)
            b_exp = ak.get(b_field)
        if not a_exp or not b_exp: continue
        if (normalize(answers.get(a_field)) == normalize(a_exp) and
            normalize(answers.get(b_field)) == normalize(b_exp)):
            score += pts
    return score


def g_bucket_sort(rule, ak, answers):
    pts = rule.get('points_each', 2)
    penalty = rule.get('penalty_per_trap', 1)
    traps = set(rule.get('trap_keys', []))
    score = 0
    field_ids = rule.get('field_ids', [])
    for i, fid in enumerate(field_ids):
        if isinstance(ak, list):
            expected = ak[i] if i < len(ak) else None
        else:
            expected = ak.get(fid)
        if not expected: continue
        exp_set = set(expected if isinstance(expected, list) else [expected])
        actual = answers.get(fid)
        act_arr = []
        if isinstance(actual, list):
            act_arr = actual
        elif isinstance(actual, str):
            try:
                act_arr = json.loads(actual)
            except:
                act_arr = [s.strip() for s in actual.split(',') if s.strip()]
        act_set = set(act_arr)
        has_all = all(k in act_set for k in exp_set)
        trap_count = sum(1 for k in act_arr if k in traps)
        if has_all and trap_count == 0:
            score += pts
        score -= penalty * trap_count
    return max(0, score)


def g_price_country(rule, ak, answers):
    p_price = rule.get('price_points', 2)
    p_country = rule.get('country_points', 1)
    score = 0
    for item in rule.get('items', []):
        exp_p = ak.get(item['price_field']) if isinstance(ak, dict) else None
        exp_c = ak.get(item['country_field']) if isinstance(ak, dict) else None
        if exp_p and normalize(answers.get(item['price_field'])) == normalize(exp_p):
            score += p_price
        if exp_c and normalize(answers.get(item['country_field'])) == normalize(exp_c):
            score += p_country
    return score


METHOD_MAP = {
    'exact_match': g_exact_match,
    'flex_match': g_flex_match,
    'vietnamese_fuzzy': g_flex_match,
    'normalized_match': g_normalized_match,
    'split_match': g_split_match,
    'array_flex': g_flex_match,
    'radio_exact': g_radio_exact,
    'ox_match': g_ox_match,
    'phone_match': g_phone_match,
    'substring_match': g_substring_match,
    'multi_field_group': g_multi_field_group,
    'multi_field_match': g_multi_field_match,
    'pair_match': g_pair_match,
    'bucket_sort': g_bucket_sort,
    'price_country': g_price_country,
    'manual': lambda r, a, u: 0,
}


def grade_section(ak_section, rules_section, answers):
    total = 0
    for block_id, rule in (rules_section or {}).items():
        if not rule or not rule.get('method'): continue
        fn = METHOD_MAP.get(rule['method'])
        if not fn:
            print(f'  [warn] unknown method: {rule["method"]} block={block_id}')
            continue
        ak_block = (ak_section or {}).get(block_id, {})
        try:
            sc = fn(rule, ak_block, answers)
            total += sc
        except Exception as e:
            print(f'  [err] {block_id}/{rule["method"]}: {e}')
    return min(100, max(0, round(total)))


# ========== DB 操作 ==========

def http_get(path):
    req = urllib.request.Request(f'{URL}{path}', headers=HDR)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def http_patch(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f'{URL}{path}', data=data, method='PATCH',
                                  headers={**HDR, 'Prefer': 'return=minimal'})
    with urllib.request.urlopen(req) as r:
        return r.status


SECTION_SCORE_FIELD = {
    'goii': 'score_vocab',
    'bunpo': 'score_grammar',
    'chokkai': 'score_listening',
}


def main():
    # test_sections 一括取得 (test_id → section_type → {answer_key, scoring_rules})
    sections = http_get('/rest/v1/test_sections?select=test_id,section_type,answer_key,scoring_rules')
    sec_map = {}
    for s in sections:
        sec_map.setdefault(s['test_id'], {})[s['section_type']] = s

    # test_results 取得（answers_jsonあり）
    results = http_get('/rest/v1/test_results?answers_json=not.is.null&select=id,test_name,answers_json,score_vocab,score_grammar,score_listening,auto_scored,trainee_id')
    print(f'対象 test_results: {len(results)}件')

    updated = 0
    skipped = 0
    errors = 0
    for r in results:
        test_id = r['test_name']
        if test_id not in sec_map:
            # 旧形式('第5-11課'等) → testN に変換試行
            alt_map = {'第1-4課':'test1','第5-11課':'test2','第12-18課':'test3','第19-25課':'test4',
                       '第26-33課':'test5','第34-40課':'test6','第41-45課':'test7','第46-50課':'test8'}
            test_id = alt_map.get(test_id, test_id)
            if test_id not in sec_map:
                skipped += 1
                continue

        answers = r.get('answers_json') or {}
        sec_data = sec_map[test_id]

        new_scores = {'score_vocab': None, 'score_grammar': None, 'score_listening': None}
        for sec_type, col in SECTION_SCORE_FIELD.items():
            if sec_type not in sec_data: continue
            s = sec_data[sec_type]
            score = grade_section(s.get('answer_key'), s.get('scoring_rules'), answers)
            new_scores[col] = score

        # 旧スコアと比較
        changes = []
        for k, v in new_scores.items():
            old = r.get(k)
            if old != v:
                changes.append(f'{k}: {old}→{v}')

        if not changes and r.get('auto_scored'):
            # 変化なし
            continue

        if changes:
            print(f'  {r["id"][:8]}... {r["test_name"]}: ' + ' | '.join(changes))

        if DRY_RUN:
            continue

        try:
            http_patch(f'/rest/v1/test_results?id=eq.{r["id"]}', {
                **new_scores,
                'auto_scored': True,
            })
            updated += 1
        except urllib.error.HTTPError as e:
            errors += 1
            print(f'  [err] id={r["id"][:8]}: {e.code} {e.read().decode()[:100]}')

    print(f'\n結果: 更新 {updated} / スキップ {skipped} / エラー {errors}')
    if DRY_RUN:
        print('※ DRY RUN モードのため実際の更新はなし')


if __name__ == '__main__':
    main()
