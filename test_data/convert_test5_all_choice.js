#!/usr/bin/env node
// Convert test5's typed/manual fields to fixed selections without changing
// field IDs or point allocation. Distractors reuse answers from the same task.
const fs = require('fs');
const path = require('path');
const base = __dirname;
const read = name => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(base, name), JSON.stringify(value, null, 2) + '\n');
const questions = Object.fromEntries(['goii','bunpo','chokkai'].map(s => [s, read(`test5_${s}_questions.json`)]));
const keys = read('test5_answer_keys.json');
const first = value => Array.isArray(value) ? value[0] : value;
const unique = values => [...new Set(values.filter(Boolean))];
const rotateOptions = (correct, pool, index, size = 4) => {
  const rest = unique(pool).filter(v => v !== correct);
  const picks = [];
  for (let n = 0; n < rest.length && picks.length < size - 1; n++) picks.push(rest[(index + n) % rest.length]);
  const values = [correct, ...picks];
  const shift = index % values.length;
  return values.slice(shift).concat(values.slice(0, shift));
};
const findBlock = (section, id) => questions[section].find(b => b.id === id);

function convertTable(block, answerBlock) {
  const pool = Object.values(answerBlock).map(first);
  block.type = 'table_fill';
  block.items.forEach((item, i) => {
    const answer = first(answerBlock[item.field_id]);
    item.input_type = 'select';
    item.options = rotateOptions(answer, pool, i);
  });
  block.instruction = (block.instruction || '').replace(/Hãy viết[^.]*\./, 'Hãy chọn đáp án đúng.').replace(/Hãy dịch[^.]*\./, 'Hãy chọn nghĩa tiếng Việt đúng.');
}
convertTable(findBlock('goii','g1'), keys.goii.answer_key.g1);
convertTable(findBlock('goii','g2'), keys.goii.answer_key.g2);
for (const id of ['g1','g2']) {
  for (const field of Object.keys(keys.goii.answer_key[id])) keys.goii.answer_key[id][field] = first(keys.goii.answer_key[id][field]);
  keys.goii.scoring_rules[id].method = 'exact_match';
}
for (const field of Object.keys(keys.bunpo.answer_key.b1)) keys.bunpo.answer_key.b1[field] = first(keys.bunpo.answer_key.b1[field]);
keys.bunpo.answer_key.b1.b1_5 = ['に', 'へ'];
keys.bunpo.scoring_rules.b1.method = 'exact_match';

const b2Answers = {
  b2_1: '日本語を勉強しています',
  b2_2: '人も多いです',
  b2_3: '日本語のニュースを見ます',
  b2_4: '歯を磨きます'
};
const b2Options = {
  b2_1: ['日本語を勉強しています','仕事をしました','寝る前です','広いです'],
  b2_2: ['人も多いです','人が多かったですか','人を多いです','人に多いです'],
  b2_3: ['日本語のニュースを見ます','日本語のニュースでした','日本語のニュースに','日本語のニュースだし'],
  b2_4: ['歯を磨きます','歯を磨きながら','歯を磨くし','歯を磨いたらです']
};
const b2 = findBlock('bunpo','b2');
b2.type = 'radio_choice';
b2.grading = 'auto';
b2.instruction = 'Câu nào hoàn thành câu đúng nhất? Hãy chọn một đáp án.';
b2.items = b2.items.map((item, i) => ({
  field_id: item.field_id,
  question: item.prompt_html || item.question,
  choices: b2Options[item.field_id].map((label, n) => ({ value: label, label: `${n + 1}　${label}` }))
}));
keys.bunpo.answer_key.b2 = b2Answers;
keys.bunpo.scoring_rules.b2 = { method: 'radio_exact', points_each: 5, field_ids: Object.keys(b2Answers) };

function convertFields(section, blockId, answerGroups) {
  const block = findBlock(section, blockId);
  const answerMap = Object.assign({}, ...answerGroups.map(id => keys[section].answer_key[id] || {}));
  const pool = Object.values(answerMap).map(first);
  let index = 0;
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.field_id && value.input_type === 'text') {
      const answer = first(answerMap[value.field_id]);
      value.input_type = 'select';
      value.options = rotateOptions(answer, pool, index++);
      delete value.grading;
    }
    Object.values(value).forEach(walk);
  };
  walk(block.items);
  if (block.type === 'free_text') {
    block.type = 'table_fill';
    block.items.forEach((item, i) => {
      const answer = first(answerMap[item.field_id]);
      item.label = item.prompt_html;
      item.input_type = 'select';
      item.options = rotateOptions(answer, pool, i);
      delete item.prompt_html;
    });
  }
  block.instruction = (block.instruction || '')
    .replace(/viết|điền/gi, 'chọn')
    .replace(/この問題は先生が採点します。[^）]*）/, '');
  for (const groupId of answerGroups) {
    const answerBlock = keys[section].answer_key[groupId];
    if (!answerBlock) continue;
    for (const field of Object.keys(answerBlock)) answerBlock[field] = first(answerBlock[field]);
    const rule = keys[section].scoring_rules[groupId];
    rule.method = 'exact_match';
    delete rule.exact_only;
    delete rule.strip_punctuation;
    delete rule.teacher_reference;
  }
}
convertFields('bunpo','b3',['b3']);
convertFields('bunpo','b4',['b4']);
convertFields('bunpo','b5',['b5']);
convertFields('chokkai','c1',['c1_text']);
convertFields('chokkai','c3',['c3_text']);
convertFields('chokkai','c7',['c7_num','c7_noun','c7_verb']);

// c1 manual answers are authoritative teacher references already in the key.
const c1Answers = {
  c1_1b: '食堂のとなりの小さいキッチンを使う',
  c1_2b: '食堂でする',
  c1_3b: '他の部屋に泊まる'
};
keys.chokkai.answer_key.c1_text = c1Answers;
keys.chokkai.scoring_rules.c1_text = { method: 'exact_match', points_each: 3, field_ids: Object.keys(c1Answers) };
// Re-run c1 options now that the formerly manual answers exist.
const c1 = findBlock('chokkai','c1');
const c1Pool = Object.values(c1Answers);
c1.items.forEach((item, i) => {
  const field = item.fields.find(f => f.field_id.endsWith('b'));
  field.input_type = 'select';
  field.options = rotateOptions(c1Answers[field.field_id], c1Pool, i, 3);
  delete field.grading;
});
c1.instruction = 'Nghe, chọn ○/× và chọn cách xử lý đúng.';

keys.chokkai.manual_fields = [];
delete keys.chokkai.sample_answers;
write('test5_goii_questions.json', questions.goii);
write('test5_bunpo_questions.json', questions.bunpo);
write('test5_chokkai_questions.json', questions.chokkai);
write('test5_answer_keys.json', keys);
console.log('Converted test5 to all-choice.');
