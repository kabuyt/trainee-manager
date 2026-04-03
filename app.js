// ===== 実習生一覧 =====
let allTrainees = [];

async function loadTrainees() {
  try {
    const { data, error } = await supabase
      .from('trainees')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allTrainees = data;
    renderTrainees(data);
  } catch (err) {
    document.getElementById('loadingMsg').classList.add('hidden');
    const errEl = document.getElementById('errorMsg');
    errEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
    errEl.classList.remove('hidden');
  }
}

function renderTrainees(data) {
  document.getElementById('loadingMsg').classList.add('hidden');

  if (data.length === 0) {
    document.getElementById('emptyMsg').classList.remove('hidden');
    return;
  }

  const tbody = document.getElementById('traineeList');
  tbody.innerHTML = data.map(t => `
    <tr>
      <td><span class="student-id-badge">${t.student_id || '-'}</span></td>
      <td><a href="trainee.html?id=${t.id}">${t.name_romaji}</a></td>
      <td>${t.name_katakana || '-'}</td>
      <td>${t.company || '-'}</td>
      <td>${t.class_group || '-'}</td>
      <td>
        <a href="trainee.html?id=${t.id}" class="btn btn-sm btn-secondary">詳細</a>
        <button onclick="deleteTrainee('${t.id}')" class="btn btn-sm btn-danger">削除</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('traineeTable').classList.remove('hidden');
}

function filterTrainees(query) {
  const q = query.toLowerCase();
  const filtered = allTrainees.filter(t =>
    (t.name_romaji || '').toLowerCase().includes(q) ||
    (t.name_katakana || '').includes(q) ||
    (t.company || '').toLowerCase().includes(q)
  );
  renderTrainees(filtered);
}

async function deleteTrainee(id) {
  if (!confirm('この実習生を削除しますか？')) return;

  const { error } = await supabase
    .from('trainees')
    .delete()
    .eq('id', id);

  if (error) {
    alert('削除に失敗しました: ' + error.message);
  } else {
    loadTrainees();
  }
}

// ===== 新規登録 =====
async function registerTrainee() {
  const btn = document.getElementById('submitBtn');
  const msgEl = document.getElementById('formMsg');
  btn.disabled = true;
  btn.textContent = '登録中...';

  const traineeData = {
    name_romaji: document.getElementById('nameRomaji').value.trim().toUpperCase(),
    name_katakana: document.getElementById('nameKatakana').value.trim(),
    company: document.getElementById('company').value.trim(),
    class_group: document.getElementById('classGroup').value.trim(),
    arrival_date: document.getElementById('arrivalDate').value || null,
    stay_period: document.getElementById('stayPeriod').value.trim(),
  };

  try {
    // 実習生を登録
    const { data: trainee, error: traineeError } = await supabase
      .from('trainees')
      .insert([traineeData])
      .select()
      .single();

    if (traineeError) throw traineeError;

    // テスト結果があれば登録
    const testName = document.getElementById('testName').value.trim();
    const testDate = document.getElementById('testDate').value;
    const scoreVocab = document.getElementById('scoreVocab').value;
    const scoreGrammar = document.getElementById('scoreGrammar').value;
    const scoreListening = document.getElementById('scoreListening').value;
    const scoreConversation = document.getElementById('scoreConversation').value;

    const hasScore = scoreVocab || scoreGrammar || scoreListening || scoreConversation;

    if (hasScore && testDate) {
      const { error: scoreError } = await supabase
        .from('test_results')
        .insert([{
          trainee_id: trainee.id,
          test_name: testName,
          test_date: testDate,
          score_vocab: scoreVocab ? Number(scoreVocab) : null,
          score_grammar: scoreGrammar ? Number(scoreGrammar) : null,
          score_listening: scoreListening ? Number(scoreListening) : null,
          score_conversation: scoreConversation ? Number(scoreConversation) : null,
        }]);

      if (scoreError) throw scoreError;
    }

    showMsg(msgEl, '登録しました！', 'success');
    setTimeout(() => {
      window.location.href = 'trainee.html?id=' + trainee.id;
    }, 1000);

  } catch (err) {
    showMsg(msgEl, '登録に失敗しました: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '登録する';
  }
}

// ===== 実習生詳細 =====
async function loadTraineeDetail() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const [{ data: trainee, error: tErr }, { data: results, error: rErr }] = await Promise.all([
      supabase.from('trainees').select('*').eq('id', id).single(),
      supabase.from('test_results').select('*').eq('trainee_id', id).order('test_date', { ascending: false }),
    ]);

    if (tErr) throw tErr;

    renderTraineeDetail(trainee, results || []);
  } catch (err) {
    document.getElementById('loadingMsg').textContent = '読み込みに失敗しました: ' + err.message;
  }
}

function renderTraineeDetail(t, results) {
  const el = document.getElementById('traineeDetail');
  el.innerHTML = `
    <div class="detail-header">
      <div>
        ${t.student_id ? `<span class="student-id-large">${t.student_id}</span>` : ''}
        <h2>${t.name_romaji}</h2>
        <p class="katakana">${t.name_katakana || ''}</p>
      </div>
      <div class="detail-actions">
        <a href="report.html?id=${t.id}" class="btn btn-primary">報告書を作成</a>
        <a href="register.html?edit=${t.id}" class="btn btn-secondary">編集</a>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">会社名</span>
        <span class="info-value">${t.company || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">クラス</span>
        <span class="info-value">${t.class_group || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">入国日</span>
        <span class="info-value">${t.arrival_date ? formatDate(t.arrival_date) : '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">在留期間</span>
        <span class="info-value">${t.stay_period || '-'}</span>
      </div>
    </div>

    <div class="section-title">テスト結果</div>
    ${results.length === 0
      ? '<p class="no-data">テスト結果がありません</p>'
      : `<table class="score-table">
          <thead>
            <tr>
              <th>テスト名</th>
              <th>実施日</th>
              <th>文字・語彙</th>
              <th>文法</th>
              <th>聴解</th>
              <th>会話</th>
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => {
              const total = [r.score_vocab, r.score_grammar, r.score_listening, r.score_conversation]
                .filter(s => s !== null)
                .reduce((a, b) => a + b, 0);
              return `
                <tr>
                  <td>${r.test_name || '-'}</td>
                  <td>${r.test_date ? formatDate(r.test_date) : '-'}</td>
                  <td>${r.score_vocab ?? '-'}</td>
                  <td>${r.score_grammar ?? '-'}</td>
                  <td>${r.score_listening ?? '-'}</td>
                  <td>${r.score_conversation ?? '-'}</td>
                  <td><strong>${total}</strong></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>`
    }
  `;
}

// ===== 教育報告書 =====
async function loadReport() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { window.location.href = 'index.html'; return; }

  try {
    // 対象実習生 + テスト結果を取得
    const [{ data: trainee, error: tErr }, { data: results, error: rErr }] = await Promise.all([
      supabase.from('trainees').select('*').eq('id', id).single(),
      supabase.from('test_results').select('*').eq('trainee_id', id).order('test_date', { ascending: true }),
    ]);
    if (tErr) throw tErr;

    // 同クラスの全員のテスト結果を取得（偏差値・順位計算用）
    let classResults = [];
    if (trainee.class_group) {
      const { data: classTrainees } = await supabase
        .from('trainees').select('id').eq('class_group', trainee.class_group);
      if (classTrainees && classTrainees.length > 0) {
        const ids = classTrainees.map(t => t.id);
        const { data: allResults } = await supabase
          .from('test_results').select('*').in('trainee_id', ids);
        classResults = allResults || [];
      }
    }

    renderReport(trainee, results || [], classResults);
  } catch (err) {
    document.getElementById('reportPage').innerHTML =
      '<p style="color:red;padding:20px">読み込みに失敗しました: ' + err.message + '</p>';
  }
}

function renderReport(t, results, classResults) {
  // 基本情報
  document.getElementById('rCompany').textContent = t.company || '-';
  document.getElementById('rNameKata').textContent = t.name_katakana || '-';
  document.getElementById('rNameRomaji').textContent = t.name_romaji || '-';
  document.getElementById('rStudentId').textContent = t.student_id || '-';
  document.getElementById('rClass').textContent = t.class_group || '-';
  document.getElementById('rArrival').textContent = t.arrival_date ? formatDate(t.arrival_date) : '-';

  // 最新テスト結果
  const latest = results.length > 0 ? results[results.length - 1] : null;
  if (latest) {
    const v = latest.score_vocab ?? 0;
    const g = latest.score_grammar ?? 0;
    const l = latest.score_listening ?? 0;
    const c = latest.score_conversation ?? 0;
    const total = v + g + l + c;

    document.getElementById('sVocab').textContent = v;
    document.getElementById('sGrammar').textContent = g;
    document.getElementById('sListen').textContent = l;
    document.getElementById('sConv').textContent = c;
    document.getElementById('sTotal').textContent = total + '/400';

    // 同テスト名の全結果で統計計算
    const sameTest = classResults.filter(r => r.test_name === latest.test_name);
    const stats = calcStats(sameTest, latest);
    document.getElementById('avgVocab').textContent = stats.avg.vocab;
    document.getElementById('avgGrammar').textContent = stats.avg.grammar;
    document.getElementById('avgListen').textContent = stats.avg.listen;
    document.getElementById('avgConv').textContent = stats.avg.conv;
    document.getElementById('avgTotal').textContent = stats.avg.total;

    document.getElementById('devVocab').textContent = stats.dev.vocab;
    document.getElementById('devGrammar').textContent = stats.dev.grammar;
    document.getElementById('devListen').textContent = stats.dev.listen;
    document.getElementById('devConv').textContent = stats.dev.conv;
    document.getElementById('devTotal').textContent = stats.dev.total;

    document.getElementById('rankVocab').textContent = stats.rank.vocab;
    document.getElementById('rankGrammar').textContent = stats.rank.grammar;
    document.getElementById('rankListen').textContent = stats.rank.listen;
    document.getElementById('rankConv').textContent = stats.rank.conv;
    document.getElementById('rankTotal').textContent = stats.rank.total;

    document.getElementById('examCount').textContent = sameTest.length + '名';

    // 評価
    const grade = getGrade(total);
    document.getElementById('evalJapanese').textContent = grade.label;
    document.getElementById('evalJapaneseDesc').textContent = grade.desc;
  }

  // 態度評価の説明を初期設定
  document.getElementById('evalAttitudeDesc').textContent =
    getAttitudeDesc(document.getElementById('evalAttitude').value);

  // 成績推移テーブル + グラフ
  if (results.length > 0) {
    const tbody = document.getElementById('trendBody');
    tbody.innerHTML = results.map(r => {
      const tot = (r.score_vocab ?? 0) + (r.score_grammar ?? 0) +
                  (r.score_listening ?? 0) + (r.score_conversation ?? 0);
      return `<tr>
        <td>${r.test_name || '-'}</td>
        <td>${r.score_vocab ?? '-'}</td>
        <td>${r.score_grammar ?? '-'}</td>
        <td>${r.score_listening ?? '-'}</td>
        <td>${r.score_conversation ?? '-'}</td>
        <td><strong>${tot}</strong></td>
      </tr>`;
    }).join('');

    // 折れ線グラフ
    renderTrendChart(results);
  }
}

function renderTrendChart(results) {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  const labels = results.map(r => r.test_name || r.test_date || '-');
  const vocabData = results.map(r => r.score_vocab ?? 0);
  const grammarData = results.map(r => r.score_grammar ?? 0);
  const listenData = results.map(r => r.score_listening ?? 0);
  const convData = results.map(r => r.score_conversation ?? 0);
  const totalData = results.map(r =>
    (r.score_vocab ?? 0) + (r.score_grammar ?? 0) +
    (r.score_listening ?? 0) + (r.score_conversation ?? 0)
  );

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '語彙', data: vocabData, borderColor: '#e67e22', backgroundColor: '#e67e2233', tension: 0.3 },
        { label: '文法', data: grammarData, borderColor: '#2980b9', backgroundColor: '#2980b933', tension: 0.3 },
        { label: '聴解', data: listenData, borderColor: '#27ae60', backgroundColor: '#27ae6033', tension: 0.3 },
        { label: '会話', data: convData, borderColor: '#8e44ad', backgroundColor: '#8e44ad33', tension: 0.3 },
        { label: '合計', data: totalData, borderColor: '#c0392b', backgroundColor: '#c0392b33', borderWidth: 3, tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        title: { display: false },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '点数' } },
      },
    },
  });
}

function calcStats(sameTest, latest) {
  const n = sameTest.length;
  const getScores = (key) => sameTest.map(r => r[key] ?? 0);
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const stddev = (arr) => {
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length || 1));
  };
  const deviation = (val, arr) => {
    const sd = stddev(arr);
    return sd === 0 ? 50 : ((val - avg(arr)) / sd * 10 + 50);
  };
  const rank = (val, arr) => {
    const sorted = [...arr].sort((a, b) => b - a);
    return sorted.indexOf(val) + 1 || '-';
  };

  const keys = [
    { field: 'score_vocab', name: 'vocab' },
    { field: 'score_grammar', name: 'grammar' },
    { field: 'score_listening', name: 'listen' },
    { field: 'score_conversation', name: 'conv' },
  ];

  const result = { avg: {}, dev: {}, rank: {} };
  keys.forEach(k => {
    const scores = getScores(k.field);
    const val = latest[k.field] ?? 0;
    result.avg[k.name] = avg(scores).toFixed(1);
    result.dev[k.name] = deviation(val, scores).toFixed(1);
    result.rank[k.name] = rank(val, scores);
  });

  const totals = sameTest.map(r =>
    (r.score_vocab ?? 0) + (r.score_grammar ?? 0) + (r.score_listening ?? 0) + (r.score_conversation ?? 0)
  );
  const myTotal = (latest.score_vocab ?? 0) + (latest.score_grammar ?? 0) +
                  (latest.score_listening ?? 0) + (latest.score_conversation ?? 0);
  result.avg.total = avg(totals).toFixed(1);
  result.dev.total = deviation(myTotal, totals).toFixed(1);
  result.rank.total = rank(myTotal, totals);

  return result;
}

function getGrade(total) {
  if (total >= 340) return { label: '秀', desc: '最高ランクの成績です' };
  if (total >= 320) return { label: '優', desc: '優秀な成績です' };
  if (total >= 300) return { label: '良', desc: '良好な成績です' };
  if (total >= 280) return { label: '可', desc: '合格水準の成績です' };
  return { label: '不可', desc: '更なる努力が必要です' };
}

function getAttitudeDesc(grade) {
  const map = {
    '秀': '模範的な態度で生活しています',
    '優': '良好な態度で生活しています',
    '良': '概ね良好な態度です',
    '可': '改善の余地があります',
    '不可': '態度の改善が必要です',
  };
  return map[grade] || '';
}

// ===== ユーティリティ =====
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = type === 'success' ? 'msg-success' : 'msg-error';
  el.classList.remove('hidden');
}
