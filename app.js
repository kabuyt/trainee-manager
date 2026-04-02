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
