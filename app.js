// ===== 実習生一覧 =====
let allTrainees = [];
let allOrgs = [];

async function loadTrainees() {
  try {
    // 管理者なら組織一覧も取得してフィルタを構築
    if (isAdmin()) {
      const { data: orgs } = await supabase.from('organizations').select('*').order('name');
      allOrgs = orgs || [];
      setupOrgFilter();
    }

    const { data, error } = await supabase
      .from('trainees')
      .select('*, organizations(name)')
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

function setupOrgFilter() {
  const filterEl = document.getElementById('orgFilter');
  if (!filterEl) return;
  filterEl.classList.remove('hidden');

  // 管理者なら組織列も表示
  const thOrg = document.getElementById('thOrg');
  if (thOrg) thOrg.classList.remove('hidden');

  allOrgs.forEach(org => {
    const opt = document.createElement('option');
    opt.value = org.id;
    opt.textContent = org.name;
    filterEl.appendChild(opt);
  });

  filterEl.addEventListener('change', function() {
    applyFilters();
  });
}

function applyFilters() {
  const searchEl = document.getElementById('searchInput');
  const orgEl = document.getElementById('orgFilter');
  const q = (searchEl ? searchEl.value : '').toLowerCase();
  const orgId = orgEl ? orgEl.value : '';

  let filtered = allTrainees;
  if (q) {
    filtered = filtered.filter(t =>
      (t.name_romaji || '').toLowerCase().includes(q) ||
      (t.name_katakana || '').includes(q) ||
      (t.company || '').toLowerCase().includes(q)
    );
  }
  if (orgId) {
    filtered = filtered.filter(t => t.organization_id === orgId);
  }
  renderTrainees(filtered);
}

function renderTrainees(data) {
  document.getElementById('loadingMsg').classList.add('hidden');

  const emptyEl = document.getElementById('emptyMsg');
  const tableEl = document.getElementById('traineeTable');

  if (data.length === 0) {
    tableEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  const showOrg = isAdmin();
  const tbody = document.getElementById('traineeList');
  tbody.innerHTML = data.map(t => `
    <tr>
      <td><span class="student-id-badge">${t.student_id || '-'}</span></td>
      <td><a href="trainee.html?id=${t.id}">${t.name_romaji}</a></td>
      <td>${t.name_katakana || '-'}</td>
      <td>${t.company || '-'}</td>
      <td>${t.class_group || '-'}</td>
      ${showOrg ? `<td>${t.organizations?.name || '-'}</td>` : ''}
      <td>
        <a href="trainee.html?id=${t.id}" class="btn btn-sm btn-secondary">詳細</a>
        <button onclick="deleteTrainee('${t.id}')" class="btn btn-sm btn-danger">削除</button>
      </td>
    </tr>
  `).join('');

  tableEl.classList.remove('hidden');
}

function filterTrainees(query) {
  applyFilters();
}

// ===== ログインカード出力 =====
function getFilteredTrainees() {
  const searchEl = document.getElementById('searchInput');
  const orgEl = document.getElementById('orgFilter');
  const q = (searchEl ? searchEl.value : '').toLowerCase();
  const orgId = orgEl ? orgEl.value : '';

  let filtered = allTrainees;
  if (q) {
    filtered = filtered.filter(t =>
      (t.name_romaji || '').toLowerCase().includes(q) ||
      (t.name_katakana || '').includes(q) ||
      (t.company || '').toLowerCase().includes(q)
    );
  }
  if (orgId) {
    filtered = filtered.filter(t => t.organization_id === orgId);
  }
  return filtered;
}

function exportLoginCards() {
  const trainees = getFilteredTrainees().filter(t => t.auth_user_id);
  if (trainees.length === 0) {
    alert('ログインアカウントのある実習生がいません。');
    return;
  }

  const LOGIN_URL = 'https://kabuyt.github.io/nihongo-test-1-4ka/login.html';
  const EMAIL_DOMAIN = '@student.trainee.local';

  // 送り出し機関名（フィルタ中ならその名前、なければ「全送り出し」）
  const orgEl = document.getElementById('orgFilter');
  const orgId = orgEl ? orgEl.value : '';
  let orgName = '全送り出し機関';
  if (orgId) {
    const org = allOrgs.find(o => o.id === orgId);
    if (org) orgName = org.name;
  } else if (trainees.length && trainees[0].organizations?.name) {
    // 管理者以外（機関ユーザー）の場合、実習生は全員同じ機関
    const uniqueOrgs = [...new Set(trainees.map(t => t.organizations?.name).filter(Boolean))];
    if (uniqueOrgs.length === 1) orgName = uniqueOrgs[0];
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日`;

  const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const cards = trainees.map(t => {
    const sid = t.student_id || '';
    const pw = (t.birth_date || '').replace(/-/g, '');
    return `
<div class="card">
  <div class="card-header">
    <span class="card-title">日本語月間テスト ログイン情報</span>
    <span class="card-id">${escape(sid)}</span>
  </div>
  <div class="card-body">
    <table>
      <tr><th>名前 (Katakana)</th><td>${escape(t.name_katakana)}</td></tr>
      <tr><th>名前 (Romaji)</th><td>${escape(t.name_romaji)}</td></tr>
      <tr><th>クラス / 会社</th><td>${escape(t.class_group)} / ${escape(t.company)}</td></tr>
      <tr class="login-row"><th>サイト URL</th><td class="big">${LOGIN_URL}</td></tr>
      <tr class="login-row"><th>学生 ID</th><td class="big mono">${escape(sid)}</td></tr>
      <tr class="login-row"><th>パスワード</th><td class="big mono">${escape(pw)}</td></tr>
    </table>
    <div class="note">
      ※ パスワードは生年月日 (YYYYMMDD) です。<br>
      ※ Mật khẩu là ngày sinh (YYYYMMDD).
    </div>
  </div>
</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>ログインカード - ${escape(orgName)} (${trainees.length}名)</title>
<style>
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { font-family: "Yu Gothic", "Meiryo", sans-serif; margin: 0; padding: 8px; background: #f0f0f0; }
.toolbar {
  position: sticky; top: 0; background: #2c3e50; color: #fff; padding: 10px 16px;
  margin: -8px -8px 12px; display: flex; gap: 12px; align-items: center; z-index: 100;
}
.toolbar button {
  padding: 6px 16px; background: #27ae60; color: #fff; border: none; border-radius: 4px;
  cursor: pointer; font-size: 14px;
}
.toolbar .info { margin-left: auto; font-size: 13px; }
.page-header { max-width: 210mm; margin: 0 auto 10px; padding: 0 4mm; font-size: 13px; color: #555; }
.cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-width: 210mm; margin: 0 auto; }
.card {
  background: #fff; border: 1.5px solid #2c3e50; border-radius: 6px; padding: 10px 12px;
  page-break-inside: avoid; min-height: 80mm; display: flex; flex-direction: column;
}
.card-header {
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 2px solid #2c3e50; padding-bottom: 6px; margin-bottom: 8px;
}
.card-title { font-size: 13px; font-weight: bold; color: #2c3e50; }
.card-id { font-size: 16px; font-weight: bold; color: #c0392b; font-family: monospace; }
.card-body { flex: 1; }
.card table { width: 100%; border-collapse: collapse; font-size: 12px; }
.card th { text-align: left; padding: 3px 6px; color: #555; font-weight: normal; width: 35%; vertical-align: top; }
.card td { padding: 3px 6px; word-break: break-word; }
.login-row { background: #fffde7; }
.login-row th { font-weight: bold; color: #333; }
.big { font-size: 14px; font-weight: bold; }
.mono { font-family: monospace; }
.note { font-size: 10px; color: #777; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #ccc; }
@media print {
  body { background: #fff; padding: 0; }
  .toolbar { display: none; }
  .cards-grid { gap: 4mm; }
  .card { box-shadow: none; }
}
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">🖨 印刷 / PDF保存 (Ctrl+P)</button>
  <span class="info">${escape(orgName)} ・ ${trainees.length}名 ・ ${dateStr}</span>
</div>
<div class="page-header"><strong>${escape(orgName)}</strong> ログインカード ー ${trainees.length}名 ー 出力日: ${dateStr}</div>
<div class="cards-grid">
${cards}
</div>
</body>
</html>`;

  // 新しいタブで開く
  const win = window.open('', '_blank');
  if (!win) {
    alert('ポップアップがブロックされました。ブラウザ設定で許可してください。');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
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

// ===== 編集モード: 既存データ読み込み =====
let _editTraineeId = null;

async function loadEditData() {
  const editId = new URLSearchParams(location.search).get('edit');
  if (!editId) return;
  _editTraineeId = editId;

  // タイトル・ボタン変更
  document.querySelector('.card h2').textContent = '実習生 編集';
  document.getElementById('submitBtn').textContent = '更新する';
  document.title = '編集 | 実習生管理システム';

  const { data: t, error } = await supabase
    .from('trainees')
    .select('*')
    .eq('id', editId)
    .single();

  if (error || !t) {
    alert('データの読み込みに失敗しました');
    window.location.href = 'index.html';
    return;
  }

  // 管理者なら学生IDフィールドを表示
  if (isAdmin()) {
    document.getElementById('studentIdGroup').classList.remove('hidden');
    document.getElementById('studentId').value = t.student_id || '';
  }

  // フォームに値をセット
  document.getElementById('nameRomaji').value = t.name_romaji || '';
  document.getElementById('nameKatakana').value = t.name_katakana || '';
  document.getElementById('company').value = t.company || '';
  document.getElementById('supervisingOrg').value = t.supervising_org || '';
  document.getElementById('classGroup').value = t.class_group || '';
  document.getElementById('birthDate').value = t.birth_date || '';
  document.getElementById('gender').value = t.gender || '';
  document.getElementById('trainingStartDate').value = t.training_start_date || '';
  document.getElementById('arrivalDate').value = t.arrival_date || '';

  // 既存写真プレビュー
  if (t.photo_url) {
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${t.photo_url}" alt="現在の写真">`;
  }

  // 管理者の場合、組織セレクトを設定
  if (isAdmin() && t.organization_id) {
    const orgSelect = document.getElementById('orgSelect');
    if (orgSelect) orgSelect.value = t.organization_id;
  }
}

// ===== 新規登録 / 更新 =====
async function registerTrainee() {
  const btn = document.getElementById('submitBtn');
  const msgEl = document.getElementById('formMsg');
  btn.disabled = true;
  btn.textContent = '登録中...';

  const profile = getCurrentProfile();
  const traineeData = {
    organization_id: profile.organization_id,
    name_romaji: document.getElementById('nameRomaji').value.trim().toUpperCase(),
    name_katakana: document.getElementById('nameKatakana').value.trim().replace(/ /g, '\u3000'),
    company: document.getElementById('company').value.trim(),
    class_group: document.getElementById('classGroup').value.trim(),
    birth_date: document.getElementById('birthDate').value || null,
    gender: document.getElementById('gender').value || null,
    supervising_org: document.getElementById('supervisingOrg').value || null,
    training_start_date: document.getElementById('trainingStartDate').value || null,
    arrival_date: document.getElementById('arrivalDate').value || null,
    stay_period: document.getElementById('stayPeriod')?.value?.trim() || null,
  };

  // 管理者の場合は組織選択が必要
  if (isAdmin()) {
    const orgSelect = document.getElementById('orgSelect');
    if (orgSelect && orgSelect.value) {
      traineeData.organization_id = orgSelect.value;
    } else {
      showMsg(msgEl, '教育機関を選択してください', 'error');
      btn.disabled = false;
      btn.textContent = '登録する';
      return;
    }
  }

  try {
    let traineeId;

    if (_editTraineeId) {
      // 管理者がIDを変更した場合
      if (isAdmin()) {
        const newStudentId = document.getElementById('studentId').value.trim();
        if (newStudentId) traineeData.student_id = newStudentId;
      }
      // 更新モード
      const { error: updateError } = await supabase
        .from('trainees')
        .update(traineeData)
        .eq('id', _editTraineeId);
      if (updateError) throw updateError;
      traineeId = _editTraineeId;
    } else {
      // 新規登録
      const { data: trainee, error: traineeError } = await supabase
        .from('trainees')
        .insert([traineeData])
        .select()
        .single();
      if (traineeError) throw traineeError;
      traineeId = trainee.id;
    }

    // 写真アップロード
    const photoFile = document.getElementById('photo').files[0];
    if (photoFile) {
      const ext = photoFile.name.split('.').pop();
      const path = `${traineeId}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('trainee-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: true });

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('trainee-photos').getPublicUrl(path);
        await supabase.from('trainees').update({ photo_url: urlData.publicUrl }).eq('id', traineeId);
      }
    }

    showMsg(msgEl, _editTraineeId ? '更新しました！' : '登録しました！', 'success');
    setTimeout(() => {
      window.location.href = 'trainee.html?id=' + traineeId;
    }, 1000);

  } catch (err) {
    showMsg(msgEl, (_editTraineeId ? '更新' : '登録') + 'に失敗しました: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = _editTraineeId ? '更新する' : '登録する';
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

  // 年齢計算
  let ageStr = '-';
  if (t.birth_date) {
    const bd = new Date(t.birth_date);
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
    ageStr = age + '歳';
  }

  el.innerHTML = `
    <div class="detail-header">
      <div class="detail-header-left">
        ${t.photo_url
          ? `<img src="${t.photo_url}" alt="写真" class="detail-photo">`
          : `<div class="detail-photo detail-photo-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`}
        <div>
          ${t.student_id ? `<span class="student-id-large">${t.student_id}</span>` : ''}
          <h2>${t.name_romaji}</h2>
          <p class="katakana">${t.name_katakana || ''}</p>
        </div>
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
        <span class="info-label">監理団体</span>
        <span class="info-value">${t.supervising_org || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">期</span>
        <span class="info-value">${t.class_group || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">生年月日</span>
        <span class="info-value">${t.birth_date ? formatDate(t.birth_date) : '-'}${t.birth_date ? '（' + ageStr + '）' : ''}</span>
      </div>
      <div class="info-item">
        <span class="info-label">性別</span>
        <span class="info-value">${t.gender || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">事前教育開始日</span>
        <span class="info-value">${t.training_start_date ? formatDate(t.training_start_date) : '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">入国予定日</span>
        <span class="info-value">${t.arrival_date ? formatDate(t.arrival_date) : '-'}</span>
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
const MONTH_TEST_MAP = [
  { month: 1, test: '第1-4課',   scope: '第4課迄' },
  { month: 2, test: '第5-11課',  scope: '第11課迄' },
  { month: 3, test: '第12-18課', scope: '第18課迄' },
  { month: 4, test: '第19-25課', scope: '第25課迄' },
  { month: 5, test: '第26-33課', scope: '第33課迄' },
  { month: 6, test: '第34-40課', scope: '第40課迄' },
  { month: 7, test: '第41-45課', scope: '第45課迄' },
  { month: 8, test: '第46-50課', scope: '第50課迄' },
];

// 報告書のグローバル状態
let _reportTrainee = null;
let _reportResults = [];
let _reportClassResults = [];
let _reportMonthly = {};  // { month: row }
let _currentMonth = 1;

async function loadReport() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { window.location.href = 'index.html'; return; }

  try {
    // 対象実習生 + テスト結果 + 月別報告書を取得
    const [{ data: trainee, error: tErr }, { data: results, error: rErr }, { data: monthly }] = await Promise.all([
      supabase.from('trainees').select('*').eq('id', id).single(),
      supabase.from('test_results').select('*').eq('trainee_id', id).order('test_date', { ascending: true }),
      supabase.from('monthly_reports').select('*').eq('trainee_id', id),
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

    // グローバル状態に保存
    _reportTrainee = trainee;
    _reportResults = results || [];
    _reportClassResults = classResults;
    _reportMonthly = {};
    (monthly || []).forEach(r => { _reportMonthly[r.month] = r; });

    // 最新テスト結果の月を自動選択
    let initMonth = 1;
    if (_reportResults.length > 0) {
      const latestTest = _reportResults[_reportResults.length - 1].test_name;
      const found = MONTH_TEST_MAP.find(m => m.test === latestTest);
      if (found) initMonth = found.month;
    }

    renderReport(trainee, _reportResults, classResults);
    // 月を設定して切替
    document.getElementById('monthSelect').value = String(initMonth);
    document.getElementById('monthPrint').textContent = String(initMonth);
    switchMonth(initMonth);
  } catch (err) {
    document.getElementById('reportPage').innerHTML =
      '<p style="color:red;padding:20px">読み込みに失敗しました: ' + err.message + '</p>';
  }
}

function switchMonth(month) {
  _currentMonth = month;
  const map = MONTH_TEST_MAP.find(m => m.month === month);
  if (!map) return;

  // 試験範囲ラベル更新
  document.getElementById('scopeLabel').textContent = map.scope;

  // 該当月のテスト結果を表示
  const result = _reportResults.find(r => r.test_name === map.test);
  renderMonthScores(result);

  // 該当月のコメントを表示
  renderMonthComments(_reportMonthly[month]);
}

function renderMonthScores(result) {
  if (result) {
    const v = result.score_vocab ?? 0;
    const g = result.score_grammar ?? 0;
    const l = result.score_listening ?? 0;
    const c = result.score_conversation ?? 0;
    const total = v + g + l + c;

    document.getElementById('sVocab').textContent = v;
    document.getElementById('sGrammar').textContent = g;
    document.getElementById('sListen').textContent = l;
    document.getElementById('sConv').textContent = c;
    document.getElementById('sTotal').textContent = total + '/400';

    // 統計
    const sameTest = _reportClassResults.filter(r => r.test_name === result.test_name);
    const stats = calcStats(sameTest, result);
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

    // 受験日
    document.getElementById('rExamDate').textContent = result.test_date ? formatDate(result.test_date) : '-';

    // 評価
    const grade = getGrade(total);
    document.getElementById('evalJapanese').textContent = grade.label;
    document.getElementById('evalJapaneseDesc').textContent = grade.desc;
  } else {
    // データなし
    ['sVocab','sGrammar','sListen','sConv','sTotal',
     'avgVocab','avgGrammar','avgListen','avgConv','avgTotal',
     'devVocab','devGrammar','devListen','devConv','devTotal',
     'rankVocab','rankGrammar','rankListen','rankConv','rankTotal'].forEach(id => {
      document.getElementById(id).textContent = '-';
    });
    document.getElementById('examCount').textContent = '-';
    document.getElementById('rExamDate').textContent = '-';
    document.getElementById('evalJapanese').textContent = '-';
    document.getElementById('evalJapaneseDesc').textContent = '-';
  }
}

function renderMonthComments(report) {
  const fields = ['lifeGood','lifeBad','lifeMeasure','lifeImprove',
                  'learnGood','learnBad','learnMeasure','learnImprove'];
  const dbFields = ['life_good','life_bad','life_measure','life_improve',
                    'learn_good','learn_bad','learn_measure','learn_improve'];

  fields.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = (report && report[dbFields[i]]) || '';
  });

  // 週別活動
  for (let w = 1; w <= 4; w++) {
    const weekEl = document.getElementById('week' + w);
    if (weekEl) {
      const textEl = weekEl.querySelector('.comment-text');
      if (textEl) textEl.innerHTML = (report && report['week' + w]) || '';
    }
  }

  // 学習進捗
  const progEl = document.getElementById('learnProgress');
  if (progEl) progEl.textContent = (report && report.learn_progress) || '-';

  // 態度評価
  const attEl = document.getElementById('evalAttitude');
  if (report && report.attitude_eval) {
    attEl.value = report.attitude_eval;
    document.getElementById('attitudePrint').textContent = report.attitude_eval;
    document.getElementById('evalAttitudeDesc').textContent = getAttitudeDesc(report.attitude_eval);
  } else {
    attEl.value = '秀';
    document.getElementById('attitudePrint').textContent = '秀';
    document.getElementById('evalAttitudeDesc').textContent = getAttitudeDesc('秀');
  }

  // 生活環境
  const envEl = document.getElementById('learnEnv');
  if (report && report.living_env) {
    envEl.value = report.living_env;
    document.getElementById('envPrint').textContent = report.living_env;
  }
}

async function saveReport() {
  if (!_reportTrainee) return;
  const btn = document.querySelector('.btn-save');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  btn.textContent = '保存中...';

  // コメント収集（空欄は「※特記事項なし」を自動入力）
  const getHtml = (id) => {
    const el = document.getElementById(id);
    if (!el) return '※特記事項なし';
    const text = el.textContent.trim();
    return text ? el.innerHTML.trim() : '※特記事項なし';
  };
  const getWeek = (n) => {
    const row = document.getElementById('week' + n);
    if (!row) return '';
    const t = row.querySelector('.comment-text');
    return t ? t.innerHTML.trim() : '';
  };

  const data = {
    trainee_id: _reportTrainee.id,
    month: _currentMonth,
    attitude_eval: document.getElementById('evalAttitude').value,
    living_env: document.getElementById('learnEnv').value,
    learn_progress: document.getElementById('learnProgress').textContent.trim(),
    life_good: getHtml('lifeGood'),
    life_bad: getHtml('lifeBad'),
    life_measure: getHtml('lifeMeasure'),
    life_improve: getHtml('lifeImprove'),
    learn_good: getHtml('learnGood'),
    learn_bad: getHtml('learnBad'),
    learn_measure: getHtml('learnMeasure'),
    learn_improve: getHtml('learnImprove'),
    week1: getWeek(1),
    week2: getWeek(2),
    week3: getWeek(3),
    week4: getWeek(4),
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('monthly_reports').upsert(data, {
      onConflict: 'trainee_id,month',
    });
    if (error) throw error;

    // ローカルキャッシュ更新
    _reportMonthly[_currentMonth] = { ..._reportMonthly[_currentMonth], ...data };

    status.textContent = '✓ 保存しました';
    status.style.color = '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (err) {
    status.textContent = '✗ 保存失敗: ' + err.message;
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

function renderReport(t, results, classResults) {
  // 基本情報
  document.getElementById('rCompany').textContent = t.company || '-';
  document.getElementById('rNameKata').textContent = t.name_katakana || '-';
  document.getElementById('rNameRomaji').textContent = t.name_romaji || '-';
  document.getElementById('rBirthDate').textContent = t.birth_date ? formatDate(t.birth_date) : '-';
  const ageEl = document.getElementById('rAge');
  if (t.birth_date) {
    const bd = new Date(t.birth_date);
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    if (today.getMonth() < bd.getMonth() || (today.getMonth() === bd.getMonth() && today.getDate() < bd.getDate())) age--;
    ageEl.textContent = age + '歳';
  } else {
    ageEl.textContent = '-';
  }

  // 顔写真
  const photoArea = document.getElementById('photoArea');
  if (photoArea && t.photo_url) {
    photoArea.innerHTML = `<img src="${t.photo_url}" alt="写真" style="width:100%;height:100%;object-fit:cover;">`;
  }

  // 成績推移テーブル + グラフ（全8回分表示）
  {
    const allLabels = ['第1-4課','第5-11課','第12-18課','第19-25課','第26-33課','第34-40課','第41-45課','第46-50課'];
    const resultMap = {};
    results.forEach(r => { resultMap[r.test_name] = r; });
    const tbody = document.getElementById('trendBody');
    tbody.innerHTML = allLabels.map(label => {
      const r = resultMap[label];
      if (r) {
        const tot = (r.score_vocab ?? 0) + (r.score_grammar ?? 0) +
                    (r.score_listening ?? 0) + (r.score_conversation ?? 0);
        return `<tr>
          <td class="row-label">${label}</td>
          <td>${r.score_vocab ?? '-'}</td>
          <td>${r.score_grammar ?? '-'}</td>
          <td>${r.score_listening ?? '-'}</td>
          <td>${r.score_conversation ?? '-'}</td>
          <td class="total-cell">${tot}</td>
        </tr>`;
      }
      return `<tr class="row-empty">
        <td class="row-label">${label}</td>
        <td></td><td></td><td></td><td></td><td class="total-cell"></td>
      </tr>`;
    }).join('');
    if (results.length > 0) renderTrendChart(results);
  }

  // 学習状況セクション（固定情報）
  const learnStartEl = document.getElementById('learnStart');
  if (learnStartEl) learnStartEl.textContent = t.training_start_date ? formatDate(t.training_start_date) : '-';
  const learnDepartEl = document.getElementById('learnDepart');
  if (learnDepartEl) learnDepartEl.textContent = t.arrival_date ? formatDate(t.arrival_date) : '-';

  // 診断コメント
  renderDiagnosis(document.getElementById('diagnosisArea'), results);
}

function renderTrendChart(results) {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  // 全8回分のラベルを固定
  const allLabels = ['第1-4課','第5-11課','第12-18課','第19-25課','第26-33課','第34-40課','第41-45課','第46-50課'];
  const resultMap = {};
  results.forEach(r => { resultMap[r.test_name] = r; });

  const labels = allLabels;
  const vocabData = allLabels.map(l => resultMap[l] ? (resultMap[l].score_vocab ?? 0) : null);
  const grammarData = allLabels.map(l => resultMap[l] ? (resultMap[l].score_grammar ?? 0) : null);
  const listenData = allLabels.map(l => resultMap[l] ? (resultMap[l].score_listening ?? 0) : null);
  const convData = allLabels.map(l => resultMap[l] ? (resultMap[l].score_conversation ?? 0) : null);
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '語彙', data: vocabData, borderColor: '#e67e22', backgroundColor: '#e67e2233', tension: 0.3, spanGaps: true, borderWidth: 2, pointRadius: 4 },
        { label: '文法', data: grammarData, borderColor: '#2563eb', backgroundColor: '#2563eb33', tension: 0.3, spanGaps: true, borderWidth: 2, pointRadius: 4 },
        { label: '聴解', data: listenData, borderColor: '#16a34a', backgroundColor: '#16a34a33', tension: 0.3, spanGaps: true, borderWidth: 2, pointRadius: 4 },
        { label: '会話', data: convData, borderColor: '#9333ea', backgroundColor: '#9333ea33', tension: 0.3, spanGaps: true, borderWidth: 2, pointRadius: 4 },
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
        y: { beginAtZero: true, max: 100, ticks: { font: { size: 9 } } },
        x: { ticks: { font: { size: 9 } } },
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

// ===== 診断コメント =====
// 各テストの誤答→弱点タグのマッピング
const DIAG_MAPS = {
  // test3: 第12-18課
  '第12-18課': {
    // 正解キー
    correct: {
      b4_1:'a', b4_2:'a', b4_3:'a', b4_4:'a', b4_5:'a',
      b5_6:'a', b5_7:'a', b5_8:'a',
      b7_1:'a', b7_2:'a', b7_3:'a', b7_4:'a',
      c11_1:'1', c11_2:'1', c11_3:'1', c11_4:'1', c11_5:'1',
    },
    // 誤答 → 弱点タグ
    tags: {
      // 文法Q4: 会話完成
      b4_1: { b:'ito_rikai', c:'teiru', d:'tai' },
      b4_2: { b:'kako', c:'koto_ga_dekiru', d:'ito_rikai' },
      b4_3: { b:'teiru', c:'tai', d:'temo_ii' },
      b4_4: { b:'ito_rikai', c:'kako', d:'tai' },
      b4_5: { b:'teiru', c:'tai', d:'temo_ii' },
      // 文法Q5(2): 読解
      b5_6: { b:'tewa_ikenai', c:'tai', d:'kako' },
      b5_7: { b:'dokkai', c:'dokkai', d:'dokkai' },
      b5_8: { b:'kako', c:'koto_ga_aru', d:'koto_ga_dekiru' },
      // 文法Q7: 文法パターン
      b7_1: { b:'teiru', c:'kako', d:'koto_ga_dekiru' },
      b7_2: { b:'i_adj_te', c:'i_adj_te', d:'i_adj_te' },
      b7_3: { b:'teiru', c:'kako', d:'tai' },
      b7_4: { b:'i_adj_past', c:'hikaku', d:'kako' },
      // 聴解Q11: 応答選択
      c11_1: { '2':'tai', '3':'temo_ii', '4':'koto_ga_dekiru' },
      c11_2: { '2':'nakereba', '3':'teiru', '4':'tai' },
      c11_3: { '2':'hitei', '3':'tai', '4':'teiru' },
      c11_4: { '2':'nakereba', '3':'temo_ii', '4':'koto_ga_aru' },
      c11_5: { '2':'hikaku', '3':'hikaku', '4':'tai' },
    },
  },
};

// タグ → 日本語の説明（企業担当者向け）
const DIAG_LABELS = {
  tai:            { jp: '希望・願望の表現', advice: '「～したいです」という希望の言い方と、「～しなければなりません」（義務）や「～できます」（能力）といった表現を混同する傾向があります。業務指示を正しく理解するために重要な項目です。' },
  teiru:          { jp: '現在の状態・動作の表現', advice: '「今～しています」のように、現在進行中の動作や状態を伝える表現が不安定です。業務中の報告（「作業しています」「確認しています」等）に影響する可能性があります。' },
  i_adj_te:       { jp: '形容詞のつなぎ方', advice: '「楽しくて、にぎやかです」のように、形容詞を使って複数の特徴を説明する表現に誤りがあります。状況説明や報告の際に不自然な日本語になることがあります。' },
  i_adj_past:     { jp: '形容詞の過去表現', advice: '「暑かったです」「よくなかったです」のように、過去の状態を伝える表現に誤りがあります。業務日報や状況報告に影響する可能性があります。' },
  nakereba:       { jp: '義務・ルールの表現', advice: '「～しなければなりません」という義務やルールを伝える表現の理解が不十分です。安全規則や業務手順の理解に関わる重要な項目です。' },
  koto_ga_dekiru: { jp: '能力・可能の表現', advice: '「～することができます」という、自分の能力や可能なことを伝える表現の使い方に課題があります。自己紹介や業務能力の説明に影響します。' },
  temo_ii:        { jp: '許可の表現', advice: '「～してもいいですか」という許可を求める表現の理解が不十分です。職場での確認や相談の際に必要な表現です。' },
  tewa_ikenai:    { jp: '禁止事項の表現', advice: '「～してはいけません」という禁止の表現と、許可の表現を混同しています。安全管理上の指示理解に関わる重要な項目です。' },
  hikaku:         { jp: '比較の表現', advice: '「AはBより～です」「Aがいちばん～です」のように、ものを比べて説明する表現に課題があります。' },
  kako:           { jp: '過去の出来事の表現', advice: '過去のことと現在のことを区別して話す力に課題があります。業務報告（「昨日～しました」「今～しています」）の正確さに影響します。' },
  dokkai:         { jp: '文章の読み取り', advice: '書かれた文章から必要な情報を正しく読み取る力に課題があります。掲示物や業務マニュアルの理解に影響する可能性があります。' },
  ito_rikai:      { jp: '質問・指示の理解', advice: '質問や指示の意図を正しく理解する力に課題があります。上司や同僚からの指示を受ける際に、的確に対応できない場合があります。' },
  koto_ga_aru:    { jp: '経験の表現', advice: '「～したことがあります」という過去の経験を伝える表現の使い方に課題があります。' },
  hitei:          { jp: '否定の表現', advice: '「～ません」「～ではありません」のように否定を伝える表現に課題があります。報告や確認の場面で誤解を招く可能性があります。' },
};

function generateDiagnosis(answers, testName) {
  // テスト名からマッピングを探す
  let diagMap = null;
  for (const key of Object.keys(DIAG_MAPS)) {
    if (testName && testName.includes(key)) {
      diagMap = DIAG_MAPS[key];
      break;
    }
  }
  if (!diagMap || !answers) return null;

  // 誤答からタグを集計
  const tagCounts = {};
  const tagQuestions = {};

  for (const [field, correctVal] of Object.entries(diagMap.correct)) {
    const studentVal = answers[field];
    if (!studentVal || studentVal === '' || studentVal === correctVal) continue;

    const fieldTags = diagMap.tags[field];
    if (!fieldTags) continue;

    const tag = fieldTags[studentVal];
    if (!tag) continue;

    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    if (!tagQuestions[tag]) tagQuestions[tag] = [];
    tagQuestions[tag].push(field);
  }

  if (Object.keys(tagCounts).length === 0) return null;

  // タグを出現回数の多い順にソート
  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  return sorted.map(([tag, count]) => ({
    tag,
    count,
    questions: tagQuestions[tag],
    label: DIAG_LABELS[tag]?.jp || tag,
    advice: DIAG_LABELS[tag]?.advice || '',
  }));
}

function renderDiagnosis(diagArea, results) {
  if (!diagArea) return;

  // answers_jsonがあるテスト結果を探す（最新から）
  const withAnswers = [...results].reverse().find(r => r.answers_json);
  if (!withAnswers) {
    diagArea.innerHTML = '<span style="color:#aaa">回答データがまだありません。テスト受験後に診断が表示されます。</span>';
    return;
  }

  const answers = typeof withAnswers.answers_json === 'string'
    ? JSON.parse(withAnswers.answers_json)
    : withAnswers.answers_json;

  const diagnosis = generateDiagnosis(answers, withAnswers.test_name);
  if (!diagnosis || diagnosis.length === 0) {
    diagArea.innerHTML = '<div style="color:#27ae60;font-weight:bold">特に問題のある文法項目はありませんでした。</div>';
    return;
  }

  // 総合コメントを生成
  const totalErrors = diagnosis.reduce((s, d) => s + d.count, 0);
  const major = diagnosis.filter(d => d.count >= 2);
  const minor = diagnosis.filter(d => d.count < 2);

  let html = '';

  // 総評
  html += '<div style="margin-bottom:10px;line-height:1.8">';
  if (totalErrors <= 2) {
    html += '全体的に良好な理解度です。以下の点を補強することで、さらに日本語力が向上します。';
  } else if (totalErrors <= 5) {
    html += 'おおむね理解できていますが、いくつかの表現に課題が見られます。業務に支障が出ないよう、以下の項目を重点的に指導しています。';
  } else {
    html += '複数の文法項目に課題が見られます。特に以下の点について、重点的に指導を行っています。';
  }
  html += '</div>';

  // 重点課題（2回以上出現）
  if (major.length > 0) {
    html += '<div style="margin-bottom:6px;font-weight:bold;color:#c0392b">【重点課題】</div>';
    html += '<ul style="margin:0 0 10px;padding-left:20px;line-height:1.8">';
    major.forEach(d => {
      html += `<li style="margin-bottom:4px"><b>${d.label}</b>：${d.advice}</li>`;
    });
    html += '</ul>';
  }

  // その他の課題（1回）
  if (minor.length > 0) {
    html += '<div style="margin-bottom:6px;font-weight:bold;color:#e67e22">【注意項目】</div>';
    html += '<ul style="margin:0;padding-left:20px;line-height:1.8">';
    minor.forEach(d => {
      html += `<li style="margin-bottom:4px"><b>${d.label}</b>：${d.advice}</li>`;
    });
    html += '</ul>';
  }

  diagArea.innerHTML = html;
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
