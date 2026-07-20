(function() {
  'use strict';

  const state = {
    result: null,
    items: [],
    helpers: null,
    savedScores: {},
    savedTotals: { goii: 0, bunpo: 0, chokkai: 0 },
  };

  const STYLE_ID = 'detail-overrides-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .detail-override-panel{border-left:5px solid #f39c12}
      .detail-override-summary{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
      .detail-override-summary .pill{background:#fff7e6;color:#8a5a00;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:bold}
      .detail-override-row{display:grid;grid-template-columns:90px 1fr 220px;gap:10px;align-items:start;background:#fffdf5;border:1px solid #f6ddb0;border-radius:6px;padding:10px;margin:8px 0}
      .detail-override-row .fid{font-weight:bold;color:#8a5a00;font-size:12px}
      .detail-override-row .question{background:#fff8df;border:1px solid #f4deb0;border-radius:4px;padding:7px 8px;margin-bottom:6px;line-height:1.7}
      .detail-override-row .answer{background:#fff;border:1px solid #ddd;border-radius:4px;padding:6px 8px;min-height:32px;white-space:pre-wrap}
      .detail-override-buttons{display:flex;gap:6px;flex-wrap:wrap}
      .detail-override-buttons button{padding:7px 10px;border:1px solid #bbb;border-radius:999px;background:#fff;color:#555;font-size:12px;cursor:pointer}
      .detail-override-buttons button.active-ok{background:#27ae60;border-color:#27ae60;color:#fff}
      .detail-override-buttons button.active-ng{background:#e74c3c;border-color:#e74c3c;color:#fff}
      .detail-override-buttons button.active-auto{background:#95a5a6;border-color:#95a5a6;color:#fff}
      .detail-override-actions{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:12px}
      .detail-override-status{font-size:12px;color:#666;line-height:1.6}
      @media(max-width:640px){.detail-override-row{grid-template-columns:1fr}.detail-override-actions{justify-content:flex-start;flex-wrap:wrap}}
    `;
    document.head.appendChild(style);
  }

  function isTargetQuestion(sectionType, question, helpers) {
    if (sectionType !== 'goii' || !question) return false;
    const title = helpers.stripRuby(question.title_html || question.sub_title || '');
    return title.includes('漢字をひらがなで書いてください');
  }

  function buildItems(sections, answers, helpers) {
    const items = [];
    (sections || []).forEach((sec) => {
      const rules = sec.scoring_rules || {};
      (sec.questions || []).forEach((q) => {
        if (!isTargetQuestion(sec.section_type, q, helpers)) return;
        const rule = rules[q.id] || {};
        const pointsEach = Number(rule.points_each || rule.points_per_field || q.points_each || 0);
        helpers.collectFieldIds(q).forEach((fid) => {
          const context = helpers.buildManualQuestionContext(q, q, fid);
          items.push({
            fieldId: fid,
            blockId: q.id,
            max: pointsEach,
            title: helpers.stripRuby(q.title_html || q.id),
            questionHtml: context.questionHtml,
            answer: answers[fid] ?? '',
          });
        });
      });
    });
    return items;
  }

  function currentValue(fieldId, max) {
    const saved = state.savedScores[fieldId];
    if (!saved || saved.input_mode !== 'binary') return '';
    const points = Number(saved.points || 0);
    if (points >= max) return String(max);
    return '0';
  }

  function renderPanel() {
    const content = document.getElementById('content');
    if (!content || !state.items.length) return;

    const previousVocab = Number(state.result.manual_score_vocab ?? state.savedTotals.goii ?? 0);
    const vocabBase = Math.max(0, Number(state.result.score_vocab || 0) - previousVocab);
    const vocabMax = state.items.reduce((sum, item) => sum + item.max, 0);
    const currentManual = state.items.reduce((sum, item) => {
      const value = currentValue(item.fieldId, item.max);
      return sum + (value === '' ? 0 : Number(value));
    }, 0);

    const card = document.createElement('div');
    card.className = 'card detail-override-panel';
    card.id = 'detail-override-panel';
    card.innerHTML = `
      <h2>語彙 問題2 手動判定</h2>
      <div class="detail-override-status">
        この判定は既存の回答データを変えずに保存します。保存されるのは語彙の手動採点だけです。
      </div>
      <div class="detail-override-summary">
        <span class="pill">語彙 自動点: ${vocabBase}</span>
        <span class="pill">語彙 手動: <b id="detail-override-total">${currentManual}</b> / ${vocabMax}</span>
      </div>
      <div id="detail-override-list">
        ${state.items.map((item) => {
          const answer = item.answer === '' || item.answer === null || item.answer === undefined ? '(未回答)' : item.answer;
          const value = currentValue(item.fieldId, item.max);
          return `
            <div class="detail-override-row" data-field="${state.helpers.escapeHtml(item.fieldId)}" data-max="${item.max}" data-value="${value}">
              <div>
                <div class="fid">${state.helpers.escapeHtml(item.fieldId)}</div>
                <div style="font-size:11px;color:#777">語彙 / ${state.helpers.escapeHtml(item.blockId)}</div>
              </div>
              <div>
                <div style="font-size:12px;color:#555;margin-bottom:4px">${state.helpers.escapeHtml(item.title)}</div>
                <div class="question">${item.questionHtml || state.helpers.escapeHtml(item.fieldId)}</div>
                <div class="answer">${state.helpers.escapeHtml(String(answer))}</div>
              </div>
              <div>
                <div style="font-size:12px;color:#555;margin-bottom:6px">判定 / ${item.max}点</div>
                <div class="detail-override-buttons">
                  <button type="button" class="${value === String(item.max) ? 'active-ok' : ''}" data-choice="ok">正解</button>
                  <button type="button" class="${value === '0' ? 'active-ng' : ''}" data-choice="ng">不正解</button>
                  <button type="button" class="${value === '' ? 'active-auto' : ''}" data-choice="auto">自動</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="detail-override-actions">
        <span id="detail-override-status" class="detail-override-status"></span>
        <button class="btn" type="button" id="detail-override-save">語彙判定を保存</button>
      </div>
    `;

    const anchor = document.querySelector('.manual-panel') || content.firstElementChild;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
    else content.appendChild(card);

    wirePanel(card);
  }

  function wirePanel(card) {
    card.querySelectorAll('.detail-override-row').forEach((row) => {
      const max = Number(row.dataset.max || 0);
      row.querySelectorAll('button[data-choice]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const choice = btn.dataset.choice;
          row.dataset.value = choice === 'ok' ? String(max) : (choice === 'ng' ? '0' : '');
          row.querySelectorAll('button[data-choice]').forEach((b) => {
            b.classList.remove('active-ok', 'active-ng', 'active-auto');
          });
          if (choice === 'ok') btn.classList.add('active-ok');
          if (choice === 'ng') btn.classList.add('active-ng');
          if (choice === 'auto') btn.classList.add('active-auto');
          updateTotal(card);
        });
      });
    });

    card.querySelector('#detail-override-save').addEventListener('click', saveOverrides);
  }

  function updateTotal(card) {
    const total = Array.from(card.querySelectorAll('.detail-override-row')).reduce((sum, row) => {
      return sum + Number(row.dataset.value || 0);
    }, 0);
    const totalEl = card.querySelector('#detail-override-total');
    if (totalEl) totalEl.textContent = total;
    const status = card.querySelector('#detail-override-status');
    if (status) status.textContent = '';
  }

  async function saveOverrides() {
    const card = document.getElementById('detail-override-panel');
    if (!card || !state.result) return;

    const status = card.querySelector('#detail-override-status');
    try {
      const merged = { ...state.savedScores };
      card.querySelectorAll('.detail-override-row').forEach((row) => {
        const fieldId = row.dataset.field;
        const max = Number(row.dataset.max || 0);
        const raw = row.dataset.value || '';
        if (raw === '') {
          if (merged[fieldId] && merged[fieldId].input_mode === 'binary') delete merged[fieldId];
          return;
        }
        merged[fieldId] = {
          section_type: 'goii',
          points: Number(raw),
          max,
          input_mode: 'binary',
        };
      });

      const totals = state.helpers.manualTotals(merged);
      const savedVocab = Number(state.result.manual_score_vocab ?? state.savedTotals.goii ?? 0);
      const baseVocab = Math.max(0, Number(state.result.score_vocab || 0) - savedVocab);
      const nextVocab = baseVocab + (totals.goii || 0);

      if (status) status.textContent = '保存中...';
      const { error } = await supabase.from('test_results')
        .update({
          score_vocab: nextVocab,
          manual_score_vocab: totals.goii || 0,
          manual_scores_json: merged,
          manually_scored_at: new Date().toISOString(),
        })
        .eq('id', state.result.id);

      if (error) throw error;
      if (status) status.textContent = '保存しました';
      location.reload();
    } catch (error) {
      if (status) status.textContent = '保存失敗: ' + error.message;
      alert('語彙判定の保存に失敗しました: ' + error.message);
    }
  }

  window.DetailOverrides = {
    init(payload) {
      if (!payload || !payload.result || !payload.helpers) return;
      ensureStyles();
      state.result = payload.result;
      state.helpers = payload.helpers;
      state.savedScores = payload.helpers.manualScoresFromResult(payload.result);
      state.savedTotals = payload.helpers.manualTotals(state.savedScores);
      state.items = buildItems(payload.sections || [], payload.answers || {}, payload.helpers);
      if (!state.items.length) return;
      renderPanel();
    }
  };
})();
