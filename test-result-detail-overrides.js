(function() {
  'use strict';

  const state = {
    result: null,
    panels: [],
    helpers: null,
    savedScores: {},
    savedTotals: { goii: 0, bunpo: 0, chokkai: 0 },
  };

  const STYLE_ID = 'detail-overrides-style';
  const TARGETS = [
    {
      key: 'goii-q2',
      sectionType: 'goii',
      titleNeedle: '漢字をひらがなで書いてください',
      panelTitle: '語彙 問題2 手動判定',
      sectionLabel: '語彙',
    },
    {
      key: 'bunpo-q2',
      sectionType: 'bunpo',
      titleNeedle: '正しい形を書いてください',
      panelTitle: '文法 問題2 手動判定',
      sectionLabel: '文法',
    }
  ];

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

  function findTarget(sectionType, question, helpers) {
    if (!question) return null;
    const title = helpers.stripRuby(question.title_html || question.sub_title || '');
    return TARGETS.find((target) => target.sectionType === sectionType && title.includes(target.titleNeedle)) || null;
  }

  // この問題は自動採点も走っている（g2 / b2 とも normalized_match）。
  // 手動判定を「加算」してしまうと自動点と二重計上になるので、
  // 手動判定した field の自動点を控除できるように保持しておく。
  function autoPointsFor(fid, index, answerKey, blockId, rule, pointsEach, answers, helpers) {
    if (typeof helpers.matchAnswer !== 'function' || typeof helpers.resolveExpectedAnswer !== 'function') return 0;
    const ak = (answerKey && answerKey[blockId] !== undefined) ? answerKey[blockId] : answerKey;
    const expected = helpers.resolveExpectedAnswer(ak, fid, index);
    if (expected === undefined) return 0;
    const userVal = answers[fid];
    if (userVal === undefined || userVal === null || userVal === '') return 0;
    return helpers.matchAnswer(userVal, expected, rule.method, rule) ? pointsEach : 0;
  }

  function buildPanels(sections, answers, helpers) {
    const grouped = new Map(TARGETS.map((target) => [target.key, { ...target, items: [] }]));
    (sections || []).forEach((sec) => {
      const rules = sec.scoring_rules || {};
      (sec.questions || []).forEach((q) => {
        const target = findTarget(sec.section_type, q, helpers);
        if (!target) return;
        const rule = rules[q.id] || {};
        const pointsEach = Number(rule.points_each || rule.points_per_field || q.points_each || 0);
        helpers.collectFieldIds(q).forEach((fid, index) => {
          const context = helpers.buildManualQuestionContext(q, q, fid);
          grouped.get(target.key).items.push({
            fieldId: fid,
            blockId: q.id,
            max: pointsEach,
            autoPoints: autoPointsFor(fid, index, sec.answer_key, q.id, rule, pointsEach, answers, helpers),
            title: helpers.stripRuby(q.title_html || q.id),
            questionHtml: context.questionHtml,
            answer: answers[fid] ?? '',
            sectionType: target.sectionType,
            sectionLabel: target.sectionLabel,
          });
        });
      });
    });
    return Array.from(grouped.values()).filter((panel) => panel.items.length);
  }

  // 手動判定済み field の自動点合計（＝スコアから控除すべき分）をセクション別に集計
  function autoDeductions(scores) {
    const totals = { goii: 0, bunpo: 0, chokkai: 0 };
    Object.values(scores || {}).forEach((row) => {
      if (!row || row.input_mode !== 'binary' || !row.section_type) return;
      totals[row.section_type] = (totals[row.section_type] || 0) + (Number(row.auto_points) || 0);
    });
    return totals;
  }

  function currentValue(fieldId, max) {
    const saved = state.savedScores[fieldId];
    if (!saved || saved.input_mode !== 'binary') return '';
    const points = Number(saved.points || 0);
    return points >= max ? String(max) : '0';
  }

  function updatePanelTotal(card) {
    const total = Array.from(card.querySelectorAll('.detail-override-row')).reduce((sum, row) => {
      return sum + Number(row.dataset.value || 0);
    }, 0);
    const totalEl = card.querySelector('.detail-override-total');
    if (totalEl) totalEl.textContent = total;
    const status = card.querySelector('.detail-override-status-msg');
    if (status) status.textContent = '';
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
          updatePanelTotal(card);
        });
      });
    });

    const saveBtn = card.querySelector('.detail-override-save');
    if (saveBtn) saveBtn.addEventListener('click', () => saveOverrides(card));
  }

  function renderPanels() {
    const content = document.getElementById('content');
    if (!content || !state.panels.length) return;
    const anchor = document.querySelector('.manual-panel') || content.firstElementChild;

    state.panels.forEach((panel) => {
      const previousManual = Number(state.savedTotals[panel.sectionType] || 0);
      const prevDeduct = autoDeductions(state.savedScores)[panel.sectionType] || 0;
      const scoreField = panel.sectionType === 'goii' ? 'score_vocab' : 'score_grammar';
      // 手動判定に切り替えた field の自動点は控除して表示する
      const panelAuto = panel.items.reduce((sum, item) => {
        const overridden = currentValue(item.fieldId, item.max) !== '';
        return sum + (overridden ? (Number(item.autoPoints) || 0) : 0);
      }, 0);
      const baseScore = Math.max(0, Number(state.result[scoreField] || 0) - previousManual + prevDeduct - panelAuto);
      const maxScore = panel.items.reduce((sum, item) => sum + item.max, 0);
      const currentManual = panel.items.reduce((sum, item) => {
        const value = currentValue(item.fieldId, item.max);
        return sum + (value === '' ? 0 : Number(value));
      }, 0);

      const card = document.createElement('div');
      card.className = 'card detail-override-panel';
      card.id = `detail-override-panel-${panel.key}`;
      card.dataset.targetKey = panel.key;
      card.innerHTML = `
        <h2>${panel.panelTitle}</h2>
        <div class="detail-override-status">
          この採点は既存の回答データを変えずに保存します。保存されるのは${panel.sectionLabel}の手動採点だけです。
        </div>
        <div class="detail-override-summary">
          <span class="pill">${panel.sectionLabel} 自動点: ${baseScore}</span>
          <span class="pill">${panel.sectionLabel} 手動: <b class="detail-override-total">${currentManual}</b> / ${maxScore}</span>
        </div>
        <div class="detail-override-list">
          ${panel.items.map((item) => {
            const answer = item.answer === '' || item.answer === null || item.answer === undefined ? '(未回答)' : item.answer;
            const value = currentValue(item.fieldId, item.max);
            return `
              <div class="detail-override-row" data-field="${state.helpers.escapeHtml(item.fieldId)}" data-max="${item.max}" data-value="${value}">
                <div>
                  <div class="fid">${state.helpers.escapeHtml(item.fieldId)}</div>
                  <div style="font-size:11px;color:#777">${state.helpers.escapeHtml(item.sectionLabel)} / ${state.helpers.escapeHtml(item.blockId)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:#555;margin-bottom:4px">${state.helpers.escapeHtml(item.title)}</div>
                  <div class="question">${item.questionHtml || state.helpers.escapeHtml(item.fieldId)}</div>
                  <div class="answer">${state.helpers.escapeHtml(String(answer))}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:#555;margin-bottom:6px">配点 / ${item.max}点</div>
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
          <span class="detail-override-status-msg detail-override-status"></span>
          <button class="btn detail-override-save" type="button">手動採点を保存</button>
        </div>
      `;

      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
      else content.appendChild(card);

      wirePanel(card);
    });
  }

  function mergeScoresForPanel(card) {
    const targetKey = card.dataset.targetKey;
    const panel = state.panels.find((entry) => entry.key === targetKey);
    const merged = { ...state.savedScores };
    if (!panel) return merged;

    card.querySelectorAll('.detail-override-row').forEach((row) => {
      const fieldId = row.dataset.field;
      const max = Number(row.dataset.max || 0);
      const raw = row.dataset.value || '';
      if (raw === '') {
        if (merged[fieldId] && merged[fieldId].input_mode === 'binary') delete merged[fieldId];
        return;
      }
      const item = panel.items.find((entry) => entry.fieldId === fieldId);
      merged[fieldId] = {
        section_type: panel.sectionType,
        points: Number(raw),
        max,
        auto_points: Number(item && item.autoPoints) || 0,
        input_mode: 'binary',
      };
    });

    return merged;
  }

  async function saveOverrides(card) {
    if (!card || !state.result) return;
    const status = card.querySelector('.detail-override-status-msg');

    try {
      const merged = mergeScoresForPanel(card);
      const totals = state.helpers.manualTotals(merged);
      const previousVocab = Number(state.result.manual_score_vocab ?? state.savedTotals.goii ?? 0);
      const previousGrammar = Number(state.result.manual_score_grammar ?? state.savedTotals.bunpo ?? 0);
      const previousListening = Number(state.result.manual_score_listening ?? state.savedTotals.chokkai ?? 0);

      // 前回控除した自動点を戻して「純粋な自動点」を復元 → 今回の控除を引く
      // （auto_points を持たない旧データは控除0とみなす＝再保存で自動的に正常化される）
      const prevDeduct = autoDeductions(state.savedScores);
      const nextDeduct = autoDeductions(merged);

      const baseVocab = Math.max(0, Number(state.result.score_vocab || 0) - previousVocab + (prevDeduct.goii || 0));
      const baseGrammar = Math.max(0, Number(state.result.score_grammar || 0) - previousGrammar + (prevDeduct.bunpo || 0));
      const baseListening = Math.max(0, Number(state.result.score_listening || 0) - previousListening + (prevDeduct.chokkai || 0));

      if (status) status.textContent = '保存中...';
      const { error } = await supabase.from('test_results')
        .update({
          score_vocab: Math.max(0, baseVocab - (nextDeduct.goii || 0) + (totals.goii || 0)),
          score_grammar: Math.max(0, baseGrammar - (nextDeduct.bunpo || 0) + (totals.bunpo || 0)),
          score_listening: Math.max(0, baseListening - (nextDeduct.chokkai || 0) + (totals.chokkai || 0)),
          manual_score_vocab: totals.goii || 0,
          manual_score_grammar: totals.bunpo || 0,
          manual_score_listening: totals.chokkai || 0,
          manual_scores_json: merged,
          manually_scored_at: new Date().toISOString(),
        })
        .eq('id', state.result.id);

      if (error) throw error;
      if (status) status.textContent = '保存しました';
      location.reload();
    } catch (error) {
      if (status) status.textContent = '保存失敗: ' + error.message;
      alert('手動採点の保存に失敗しました: ' + error.message);
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
      state.panels = buildPanels(payload.sections || [], payload.answers || {}, payload.helpers);
      if (!state.panels.length) return;
      renderPanels();
    }
  };
})();
