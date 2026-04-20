#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test2全セクションを「漢字のみにルビ／送り仮名は本文のまま」方式で再生成。

方針:
1. 既存のrubyをすべて剥がす
2. 熟語（≥2字漢字連続）は全体をルビマップで処理
3. 単漢字動詞/形容詞は「漢字＋送り仮名」パターンで漢字部分のみルビ
4. 数字＋助数詞は特殊パターンで処理
5. 残った単漢字は単漢字辞書で処理
6. options/day_options等はルビなし
"""
import json, sys, re, os

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# ====== 熟語（2字以上連続漢字） ======
COMPOUND = {
    '交通手段': 'こうつうしゅだん',
    '新大阪': 'しんおおさか',
    '大阪駅': 'おおさかえき',
    '大阪': 'おおさか',
    '東京': 'とうきょう',
    '広島': 'ひろしま',
    '松山': 'まつやま',
    '横浜': 'よこはま',
    '日本語': 'にほんご',
    '日本': 'にほん',
    '飛行機': 'ひこうき',
    '新幹線': 'しんかんせん',
    '地下鉄': 'ちかてつ',
    '電車': 'でんしゃ',
    '電話': 'でんわ',
    '銀行': 'ぎんこう',
    '学校': 'がっこう',
    '会社': 'かいしゃ',
    '会話': 'かいわ',
    '図書館': 'としょかん',
    '美容院': 'びよういん',
    '病気': 'びょうき',
    '映画': 'えいが',
    '料理': 'りょうり',
    '旅行': 'りょこう',
    '新聞': 'しんぶん',
    '牛乳': 'ぎゅうにゅう',
    '野菜': 'やさい',
    '花見': 'はなみ',
    '公園': 'こうえん',
    '誕生日': 'たんじょうび',
    '音声': 'おんせい',
    '用事': 'ようじ',
    '約束': 'やくそく',
    '切手': 'きって',
    '手紙': 'てがみ',
    '財布': 'さいふ',
    '辞書': 'じしょ',
    '時計': 'とけい',
    '時間': 'じかん',
    '先生': 'せんせい',
    '加藤': 'かとう',
    '山口': 'やまぐち',
    '黄色': 'きいろ',
    '言葉': 'ことば',
    '問題': 'もんだい',
    '質問': 'しつもん',
    '生活': 'せいかつ',
    '人気': 'にんき',
    '位置': 'いち',
    '意味': 'いみ',
    '形容詞': 'けいようし',
    '反対': 'はんたい',
    '理由': 'りゆう',
    '授業': 'じゅぎょう',
    '勉強': 'べんきょう',
    '仕事': 'しごと',
    '完成': 'かんせい',
    '残念': 'ざんねん',
    '一緒': 'いっしょ',
    '上手': 'じょうず',
    '今日': 'きょう',
    '明日': 'あした',
    '一昨年': 'おととし',
    '再来年': 'さらいねん',
    '今年': 'ことし',
    '去年': 'きょねん',
    '来年': 'らいねん',
    '今週': 'こんしゅう',
    '毎日': 'まいにち',
    '午前': 'ごぜん',
    '午後': 'ごご',
    '一度': 'いちど',
    '読み方': 'よみかた',
    '全部': 'ぜんぶ',
    # 曜日
    '月曜日': 'げつようび',
    '火曜日': 'かようび',
    '水曜日': 'すいようび',
    '木曜日': 'もくようび',
    '金曜日': 'きんようび',
    '土曜日': 'どようび',
    '日曜日': 'にちようび',
}

# ====== 単漢字動詞/形容詞: 漢字 → (読み, 送り仮名パターン) ======
# パターンは正規表現（非キャプチャ）
VERBS = {
    '帰': ('かえ', r'(?:ります|りました|りません(?:か)?|りたい|る|った|って|らない|ろう|れ|れば|り)'),
    '食': ('た', r'(?:べます|べました|べません(?:か)?|べたい|べましょう|べて|べる|べた|べよう|べろ|べない|べ)'),
    '飲': ('の', r'(?:みます|みました|みません(?:か)?|みたい|みましょう|んで|む|んだ|もう|め|めば|まない|み)'),
    '行': ('い', r'(?:きます|きました|きません(?:か)?|きたい|きましょう|って|く|った|こう|け|けば|かない|き)'),
    '来': ('き', r'(?:ます|ました|ません(?:か)?|たい|ましょう|て)'),
    '買': ('か', r'(?:います|いました|いません(?:か)?|いたい|いましょう|って|う|った|おう|え|えば|わない|い)'),
    '売': ('う', r'(?:ります|りました|りません(?:か)?|る|った|って|らない|り)'),
    '貸': ('か', r'(?:します|しました|しません(?:か)?|して|す|した|そう|せ|せば|さない|し)'),
    '借': ('か', r'(?:ります|りました|りません(?:か)?|りて|りる|りた|りよう|りろ|りない|り)'),
    '働': ('はたら', r'(?:きます|きました|きません(?:か)?|いて|く|いた|こう|け|けば|かない|き)'),
    '休': ('やす', r'(?:みます|みました|みません(?:か)?|んで|む|んだ|もう|め|めば|まない|み|んだり)'),
    '会': ('あ', r'(?:います|いました|いません(?:か)?|って|う|った|おう|え|えば|わない|い)'),
    '書': ('か', r'(?:きます|きました|きません(?:か)?|きましょう|いて|く|いた|こう|け|けば|かない|き)'),
    '読': ('よ', r'(?:みます|みました|みません(?:か)?|みましょう|んで|む|んだ|もう|め|めば|まない|み)'),
    '聞': ('き', r'(?:きます|きました|きません(?:か)?|きましょう|いて|く|いた|こう|け|けば|かない|き)'),
    '見': ('み', r'(?:ます|ました|ません(?:か)?|ましょう|たい|て|る|た|よう|ろ|ない)'),
    '教': ('おし', r'(?:えます|えました|えません(?:か)?|えて|える|えた|えよう|えろ|えない|え)'),
    '習': ('なら', r'(?:います|いました|いません(?:か)?|って|う|った|おう|え|えば|わない|い)'),
    '選': ('えら', r'(?:びます|びました|びません(?:か)?|んで|ぶ|んだ|ぼう|べ|べば|ばない|び)'),
    '答': ('こた', r'(?:えます|えました|えません(?:か)?|えて|える|えた|えよう|えろ|えない|え)'),
    '合': ('あ', r'(?:います|いました|わせて|わせる|わせ|う|った)'),
    '言': ('い', r'(?:います|いました|いません(?:か)?|って|う|った|おう|え|えば|わない|い)'),
    '歩': ('ある', r'(?:きます|きました|きません(?:か)?|いて|く|いた|こう|け|けば|かない|き)'),
    '戻': ('もど', r'(?:ります|りました|りません(?:か)?|って|る|った|ろう|れ|れば|らない|り)'),
    '並': ('なら', r'(?:びます|びました|べて|べる|ぶ|んだ|ぼう|べ|べば|ばない|び)'),
    '終': ('お', r'(?:わります|わりました|わりません(?:か)?|わって|わる|わった|わろう|われ|われば|わらない|わり)'),
    '始': ('はじ', r'(?:まります|まりました|まりません(?:か)?|まって|まる|まった|める|めて|めた|めよう|めろ|めない|まり|め)'),
    '帰': ('かえ', r'(?:ります|りました|りません(?:か)?|る|った|って|らない|ろう|れ|れば|り)'),
    # 形容詞（い形/な形）
    '新': ('あたら', r'(?:しい|しく|しくない|しかった|しくて|しさ|しさは)'),
    '古': ('ふる', r'(?:い|く|くない|かった|くて|さ)'),
    '細': ('こま', r'(?:かい|かく|かくない|かかった|かくて)'),
    '近': ('ちか', r'(?:い|く|くない|かった|くて|さ)'),
    '安': ('やす', r'(?:い|く|くない|かった|くて|さ)'),
    '高': ('たか', r'(?:い|く|くない|かった|くて|さ)'),
    '大': ('おお', r'(?:きい|きく|きくない|きかった|きな|きさ)'),
    '小': ('ちい', r'(?:さい|さく|さくない|さかった|さな|さ)'),
    '好': ('す', r'(?:きな?|きで|きじゃ|きく?)'),
    '嫌': ('きら', r'(?:いな?|いで|いじゃ)'),
    '同': ('おな', r'(?:じ)'),
}

# ====== 単漢字辞書（送り仮名が無いor単独使用） ======
SINGLE = {
    '上': 'うえ',
    '下': 'した',
    '前': 'まえ',
    '中': 'なか',
    '後': 'あと',
    '今': 'いま',
    '何': 'なに',
    '誰': 'だれ',
    '私': 'わたし',
    '友': 'とも',
    '母': 'はは',
    '女': 'おんな',
    '男': 'おとこ',
    '町': 'まち',
    '寮': 'りょう',
    '駅': 'えき',
    '車': 'くるま',
    '花': 'はな',
    '絵': 'え',
    '机': 'つくえ',
    '船': 'ふね',
    '例': 'れい',
    '夜': 'よる',
    '朝': 'あさ',
    '昼': 'ひる',
    '晩': 'ばん',
    '肉': 'にく',
    '卵': 'たまご',
    '魚': 'さかな',
    '茶': 'ちゃ',
    '本': 'ほん',
    '点': 'てん',
    '表': 'ひょう',
    '順': 'じゅん',
    '各': 'かく',
    '正': 'せい',
    '方': 'ほう',
    '人': 'ひと',  # 単独で「人」ならひと（助数詞のときは数字パターンで先に処理）
}

# ====== 数字+助数詞 特殊パターン ======
# 正規表現で数字を捕捉し、ふりがなに変換
# 1人=ひとり、2人=ふたり、3-10人=X にん
NUM_PEOPLE = {
    '1': 'ひと', '2': 'ふた', '3': 'さん', '4': 'よ', '5': 'ご',
    '6': 'ろく', '7': 'しち', '8': 'はち', '9': 'きゅう', '10': 'じゅう',
    '１': 'ひと', '２': 'ふた', '３': 'さん', '４': 'よ', '５': 'ご',
    '６': 'ろく', '７': 'しち', '８': 'はち', '９': 'きゅう',
}

# 助数詞: 漢字→読み。数字のあとに付く場合の読み
COUNTER = {
    '人': 'にん',  # 3人以上はにん、1人=ひとり 2人=ふたり は特別
    '日': 'にち',  # 1日=ついたち, 2-10日=特別 だが単純化で「にち」
    '回': 'かい',
    '台': 'だい',
    '枚': 'まい',
    '本': 'ほん',
    '個': 'こ',
    '歳': 'さい',
    '才': 'さい',
    '円': 'えん',
    '時': 'じ',
    '分': 'ふん',
    '秒': 'びょう',
    '年': 'ねん',
    '月': 'がつ',
    '週': 'しゅう',
    '階': 'かい',
    '度': 'ど',
    '番': 'ばん',
    '点': 'てん',
    '箱': 'はこ',
    '杯': 'はい',
    '匹': 'ひき',
    '冊': 'さつ',
}


def strip_ruby(text):
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'<ruby>([^<]*?)<rt>[^<]*</rt></ruby>', r'\1', text)
    return text


def placeholder_protect(text, key, placeholder_map):
    """keyにマッチする箇所を\x00Nで置換してから返す"""
    idx = len(placeholder_map)
    ph = f'\x00R{idx}R\x00'
    placeholder_map[ph] = key
    return ph


def apply_ruby(text):
    """rubyを付与。optionsやhiragana-only文字列は無視"""
    if not re.search(r'[\u4e00-\u9fff]', text):
        return text
    # 一度全剥がし
    text = strip_ruby(text)

    # === 1) 数字+助数詞（特別読み優先） ===
    # 1人/2人 特別
    text = re.sub(r'([1１])人', r'1<ruby>人<rt>ひとり</rt></ruby>', text)
    text = re.sub(r'([2２])人', r'2<ruby>人<rt>ふたり</rt></ruby>', text)

    # その他数字+助数詞
    for cntr, reading in COUNTER.items():
        # 既にruby化された部分はスキップ
        # 半角数字/全角数字の後ろの助数詞
        pattern = re.compile(r'(?<!<)(\d+|[０-９]+)' + cntr + r'(?![^<]*</ruby>)')
        # 単純置換：数字の直後の助数詞のみ対象
        def replace_counter(m):
            num = m.group(1)
            return f'{num}<ruby>{cntr}<rt>{reading}</rt></ruby>'
        text = pattern.sub(replace_counter, text)

    # === 2) 熟語置換（長い順） ===
    # placeholder方式
    placeholders = {}
    keys = sorted(COMPOUND.keys(), key=lambda k: -len(k))
    for i, k in enumerate(keys):
        if k in text:
            ph = f'\x00C{i}\x00'
            text = text.replace(k, ph)
            placeholders[ph] = f'<ruby>{k}<rt>{COMPOUND[k]}</rt></ruby>'
    for ph, repl in placeholders.items():
        text = text.replace(ph, repl)

    # === 3) 動詞/形容詞の漢字+送り仮名 ===
    for kanji, (reading, pat) in VERBS.items():
        # ruby内は避ける（\x00で守るのが簡単）
        # まず既存ruby箇所をプレースホルダ化
        ruby_parts = []
        def save_ruby(m):
            ruby_parts.append(m.group(0))
            return f'\x00V{len(ruby_parts)-1}\x00'
        temp = re.sub(r'<ruby>.*?</ruby>', save_ruby, text)
        # 動詞置換
        regex = re.compile(kanji + pat)
        def replace_verb(m):
            matched = m.group(0)
            okurigana = matched[1:]
            return f'<ruby>{kanji}<rt>{reading}</rt></ruby>{okurigana}'
        temp = regex.sub(replace_verb, temp)
        # ruby戻し
        for i, r in enumerate(ruby_parts):
            temp = temp.replace(f'\x00V{i}\x00', r)
        text = temp

    # === 4) 単漢字（残っているもの） ===
    ruby_parts = []
    def save_ruby2(m):
        ruby_parts.append(m.group(0))
        return f'\x00S{len(ruby_parts)-1}\x00'
    temp = re.sub(r'<ruby>.*?</ruby>', save_ruby2, text)
    for kanji, reading in SINGLE.items():
        # 連続漢字に埋もれないよう、隣接漢字が無いものだけ
        # （熟語はすでに処理済みなので単独使用のみ）
        temp = re.sub(r'(?<![\u4e00-\u9fff])' + kanji + r'(?![\u4e00-\u9fff])',
                      f'<ruby>{kanji}<rt>{reading}</rt></ruby>', temp)
    for i, r in enumerate(ruby_parts):
        temp = temp.replace(f'\x00S{i}\x00', r)
    text = temp

    return text


def walk_and_apply(obj, skip_keys=None):
    """JSONツリーを再帰的に走査、skip_keys内のフィールド以下はルビ処理しない"""
    if skip_keys is None:
        skip_keys = set()
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if k in skip_keys:
                # rubyを剥がすだけ
                if isinstance(v, str):
                    obj[k] = strip_ruby(v)
                elif isinstance(v, list):
                    obj[k] = [strip_ruby(x) if isinstance(x, str) else x for x in v]
                    # さらに中のdictのlabel等からもruby除去
                    for item in obj[k]:
                        if isinstance(item, dict) and 'label' in item and isinstance(item['label'], str):
                            item['label'] = strip_ruby(item['label'])
                continue
            if isinstance(v, str):
                if re.search(r'[\u4e00-\u9fff]', v):
                    obj[k] = apply_ruby(v)
            elif isinstance(v, (dict, list)):
                walk_and_apply(v, skip_keys)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                if re.search(r'[\u4e00-\u9fff]', v):
                    obj[i] = apply_ruby(v)
            elif isinstance(v, (dict, list)):
                walk_and_apply(v, skip_keys)


def main():
    # skip対象: select要素のoptions等（HTML解釈しない）
    skip_keys = {
        'options', 'day_options', 'country_options',
        'pool_correct', 'pool_extra', 'correct_pool', 'extra_pool',
    }
    # word_puzzleのwordsは<ruby>使える（innerHTML描画のため）のでskipしない

    for sec in ['goii', 'bunpo', 'chokkai']:
        path = f'test2_{sec}_questions.json'
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        walk_and_apply(data, skip_keys=skip_keys)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'  {path}: done')

    # 未カバーチェック
    print('\n=== 未カバー漢字チェック ===')
    missing = set()
    for sec in ['goii', 'bunpo', 'chokkai']:
        with open(f'test2_{sec}_questions.json', encoding='utf-8') as f:
            raw = f.read()
        # ruby外の漢字を抽出
        cleaned = re.sub(r'<ruby>.*?</ruby>', '', raw)
        for m in re.finditer(r'[\u4e00-\u9fff]+', cleaned):
            missing.add(m.group(0))
    if missing:
        print(f'漏れ: {len(missing)}')
        for m in sorted(missing):
            print(f'  {m}')
    else:
        print('OK')


if __name__ == '__main__':
    main()
