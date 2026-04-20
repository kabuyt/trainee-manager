#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test3 chokkai 一括修正"""
import json, sys
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

with open('test3_chokkai_questions.json', encoding='utf-8') as f:
    data = json.load(f)

for q in data:
    qid = q['id']

    if qid == 'c1':
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>１．どちらのスーパーで<ruby>買<rt>か</rt></ruby>いますか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×3問＝9<ruby>点<rt>てん</rt></ruby>＞'
        q['instruction'] = 'Nghe và chọn đáp án đúng.'
        q['image_src'] = 'images/chokkai/image1.png'
        q['audio_src'] = 'audio/問題１.mp3'
        q['type'] = 'audio_select'
        opts = [
            {'value': 'a', 'label': 'a. わかばスーパー'},
            {'value': 'b', 'label': 'b. まるやスーパー'},
        ]
        q['items'] = [
            {'field_id': 'c1_1', 'label': '① たまご', 'input_type': 'select', 'options': opts},
            {'field_id': 'c1_2', 'label': '② りんご', 'input_type': 'select', 'options': opts},
            {'field_id': 'c1_3', 'label': '③ にく', 'input_type': 'select', 'options': opts},
        ]

    elif qid == 'c2':
        q['type'] = 'audio_select'
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>２．<ruby>日本人<rt>にほんじん</rt></ruby>はあなたの<ruby>国<rt>くに</rt></ruby>へ<ruby>何<rt>なに</rt></ruby>をしに<ruby>来<rt>き</rt></ruby>ましたか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'
        q['image_src'] = 'images/chokkai/image2.jpeg'
        q['audio_src'] = 'audio/問題２.mp3'
        q['instruction'] = 'Nghe và chọn hình đúng.'
        opts = [{'value': v, 'label': v} for v in ['a', 'b', 'c', 'd', 'e']]
        q['items'] = [
            {'field_id': 'c2_1', 'label': '① 問1', 'input_type': 'select', 'options': opts},
            {'field_id': 'c2_2', 'label': '② 問2', 'input_type': 'select', 'options': opts},
        ]

    elif qid == 'c3':
        q['type'] = 'audio_image_radio'
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>３．<ruby>運転手<rt>うんてんしゅ</rt></ruby>は<ruby>何<rt>なに</rt></ruby>をしますか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'
        q['instruction'] = 'Nghe và chọn đáp án đúng (a/b/c).'
        q.pop('image_src', None)
        choices = [
            {'value': 'a', 'label': 'ａ', 'image_src': 'images/chokkai/image3.png'},
            {'value': 'b', 'label': 'ｂ', 'image_src': 'images/chokkai/image4.png'},
            {'value': 'c', 'label': 'ｃ', 'image_src': 'images/chokkai/image5.png'},
        ]
        q['items'] = [
            {'field_id': 'c3_1', 'label': '① 問1', 'audio_src': 'audio/問題3-1カリナさんはタクシーで空港まで.mp3', 'choices': choices},
            {'field_id': 'c3_2', 'label': '② 問2', 'audio_src': 'audio/問題3-2カリナさんはタクシーで空港まで-1.mp3', 'choices': choices},
        ]

    elif qid == 'c4':
        q['type'] = 'audio_select'
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>４．パーティをします。aとbのどちらですか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'
        q['instruction'] = 'Nghe và chọn a hoặc b.'
        q.pop('image_src', None)
        q.pop('audio_src', None)
        q['items'] = [
            {
                'field_id': 'c4_1', 'label': '① 問1',
                'audio_src': 'audio/問題４.mp3',
                'image_src': 'images/chokkai/image9.jpeg',
                'input_type': 'select',
                'options': [{'value': 'a', 'label': 'a'}, {'value': 'b', 'label': 'b'}],
            },
            {
                'field_id': 'c4_2', 'label': '② 問2',
                'image_src': 'images/chokkai/image10.jpeg',
                'input_type': 'select',
                'options': [{'value': 'a', 'label': 'a'}, {'value': 'b', 'label': 'b'}],
            },
        ]

    elif qid == 'c5':
        q['type'] = 'audio_multi_select'
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>５．サントスさんは<ruby>何<rt>なに</rt></ruby>をしなければなりませんか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'
        q['instruction'] = 'Nghe và chọn đáp án đúng.'
        q['intro_audio'] = 'audio/問題５.mp3'
        q['intro_label'] = 'しつもん（Câu hỏi）'
        q.pop('audio_src', None)
        q['items'] = [
            {
                'label': '① 問1',
                'sentence_html': '（{c5_1}）くすりは1<ruby>日<rt>にち</rt></ruby>3<ruby>回<rt>かい</rt></ruby><ruby>飲<rt>の</rt></ruby>みます。',
                'fields': [{
                    'field_id': 'c5_1', 'input_type': 'select',
                    'options': [
                        {'value': 'a', 'label': 'a. しろい'},
                        {'value': 'b', 'label': 'b. あかい'},
                    ]
                }]
            },
            {
                'label': '② 問2',
                'sentence_html': '（{c5_2}）<ruby>健康保険証<rt>けんこうほけんしょう</rt></ruby>を<ruby>持<rt>も</rt></ruby>って<ruby>来<rt>き</rt></ruby>ます。',
                'fields': [{
                    'field_id': 'c5_2', 'input_type': 'select',
                    'options': [
                        {'value': 'a', 'label': 'a. らいげつ'},
                        {'value': 'b', 'label': 'b. らいしゅう'},
                    ]
                }]
            },
        ]

    elif qid == 'c7':
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>７．できますか。できませんか。（できます…○、できません…×）　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'

    elif qid == 'c8':
        q['type'] = 'audio_select'
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>８．<ruby>鈴木<rt>すずき</rt></ruby>さんは<ruby>今<rt>いま</rt></ruby><ruby>何<rt>なに</rt></ruby>をしていますか　＜<ruby>各<rt>かく</rt></ruby>3<ruby>点<rt>てん</rt></ruby>×2問＝6<ruby>点<rt>てん</rt></ruby>＞'
        q['image_src'] = 'images/chokkai/image12.jpeg'
        q['audio_src'] = 'audio/問題８.mp3'
        opts = [{'value': v, 'label': v} for v in ['a', 'b', 'c', 'd', 'e']]
        q['items'] = [
            {'field_id': 'c8_1', 'label': '① 問1', 'input_type': 'select', 'options': opts},
            {'field_id': 'c8_2', 'label': '② 問2', 'input_type': 'select', 'options': opts},
        ]

    elif qid == 'c10':
        q['title_html'] = '<ruby>問題<rt>もんだい</rt></ruby>１０．○か×で<ruby>答<rt>こた</rt></ruby>えてください　＜<ruby>各<rt>かく</rt></ruby>2<ruby>点<rt>てん</rt></ruby>×5問＝10<ruby>点<rt>てん</rt></ruby>＞'
        q['image_src'] = 'images/chokkai/image11.png'

with open('test3_chokkai_questions.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print('test3 chokkai 修正完了')
for q in data:
    print(f"  {q['id']}: {q['type']} / image={q.get('image_src','-')}")
