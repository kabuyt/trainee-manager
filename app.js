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
      .order('student_id', { ascending: true, nullsFirst: false });

    if (error) throw error;

    // VJC を先頭にして、その後は student_id 昇順
    const sortKey = (id) => {
      if (!id) return 'Z~' + '~~~';
      if (id.startsWith('VJC')) return 'A' + id;
      return 'B' + id;
    };
    data.sort((a, b) => sortKey(a.student_id).localeCompare(sortKey(b.student_id)));

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

  const qrUrl = (data) => `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=140x140&margin=4`;

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
    <div class="card-content">
      <table>
        <tr><th>名前 (Katakana)</th><td>${escape(t.name_katakana)}</td></tr>
        <tr><th>名前 (Romaji)</th><td>${escape(t.name_romaji)}</td></tr>
        <tr><th>クラス / 会社</th><td>${escape(t.class_group)} / ${escape(t.company)}</td></tr>
        <tr class="login-row"><th>サイト URL</th><td class="big">${LOGIN_URL}</td></tr>
        <tr class="login-row"><th>学生 ID</th><td class="big mono">${escape(sid)}</td></tr>
        <tr class="login-row"><th>パスワード</th><td class="big mono">${escape(pw)}</td></tr>
      </table>
      <div class="qr-box">
        <img src="${qrUrl(LOGIN_URL)}" alt="QR" class="qr-img">
        <div class="qr-label">📱 QRで開く</div>
      </div>
    </div>
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
.card-content { display: flex; gap: 10px; align-items: flex-start; }
.card-content table { flex: 1; }
.card table { width: 100%; border-collapse: collapse; font-size: 12px; }
.card th { text-align: left; padding: 3px 6px; color: #555; font-weight: normal; width: 35%; vertical-align: top; }
.card td { padding: 3px 6px; word-break: break-word; }
.login-row { background: #fffde7; }
.login-row th { font-weight: bold; color: #333; }
.big { font-size: 14px; font-weight: bold; }
.mono { font-family: monospace; }
.note { font-size: 10px; color: #777; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #ccc; }
.qr-box { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.qr-img { width: 80px; height: 80px; border: 1px solid #ddd; padding: 2px; background: #fff; }
.qr-label { font-size: 9px; color: #555; margin-top: 3px; letter-spacing: 0.05em; }
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

    // 写真アップロード（ファイル名にタイムスタンプを含めて確実に新しい URL にする）
    const photoFile = document.getElementById('photo').files[0];
    if (photoFile) {
      const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
      const ts = Date.now();
      const path = `${traineeId}_${ts}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('trainee-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: false });

      if (uploadError) {
        console.error('写真アップロード失敗:', uploadError);
        showMsg(msgEl, '写真のアップロードに失敗しました: ' + uploadError.message, 'error');
        btn.disabled = false;
        return;
      }
      const { data: urlData } = supabase.storage.from('trainee-photos').getPublicUrl(path);
      const newUrl = urlData.publicUrl + '?t=' + ts;
      const { error: updateErr } = await supabase.from('trainees')
        .update({ photo_url: newUrl }).eq('id', traineeId);
      if (updateErr) {
        console.error('photo_url 更新失敗:', updateErr);
        showMsg(msgEl, '写真URL保存に失敗: ' + updateErr.message, 'error');
        btn.disabled = false;
        return;
      }
      console.log('✓ 新しい写真URL:', newUrl);
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
              <th>離脱</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => {
              const total = [r.score_vocab, r.score_grammar, r.score_listening, r.score_conversation]
                .filter(s => s !== null)
                .reduce((a, b) => a + b, 0);
              const leaveCell = r.leave_count == null
                ? '-'
                : (r.leave_count > 0
                    ? `<span style="color:#c0392b;font-weight:bold">${r.leave_count}回</span>`
                    : '0');
              return `
                <tr>
                  <td>${r.test_name || '-'}</td>
                  <td>${r.test_date ? formatDate(r.test_date) : '-'}</td>
                  <td>${r.score_vocab ?? '-'}</td>
                  <td>${r.score_grammar ?? '-'}</td>
                  <td>${r.score_listening ?? '-'}</td>
                  <td>${r.score_conversation ?? '-'}</td>
                  <td><strong>${total}</strong></td>
                  <td>${leaveCell}</td>
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
  { month: 1, test: 'test1', testLabel: '第1-4課',   scope: '第4課迄' },
  { month: 2, test: 'test2', testLabel: '第5-11課',  scope: '第11課迄' },
  { month: 3, test: 'test3', testLabel: '第12-18課', scope: '第18課迄' },
  { month: 4, test: 'test4', testLabel: '第19-25課', scope: '第25課迄' },
  { month: 5, test: 'test5', testLabel: '第26-33課', scope: '第33課迄' },
  { month: 6, test: 'test6', testLabel: '第34-40課', scope: '第40課迄' },
  { month: 7, test: 'test7', testLabel: '第41-45課', scope: '第45課迄' },
  { month: 8, test: 'test8', testLabel: '第46-50課', scope: '第50課迄' },
];

// test_name を検索する（新旧両フォーマット対応）
function matchTest(row, map) {
  return row.test_name === map.test || row.test_name === map.testLabel;
}

// 会話スコアを DB に保存（報告書画面から呼ばれる）
async function saveConversationScore(value) {
  const map = MONTH_TEST_MAP.find(m => m.month === _currentMonth);
  if (!map || !_reportTrainee) return;
  const existing = _reportResults.find(r => matchTest(r, map));
  const convCell = document.getElementById('sConv');

  if (existing) {
    // UPDATE
    const { error } = await supabase.from('test_results')
      .update({ score_conversation: value })
      .eq('id', existing.id);
    if (error) {
      alert('保存失敗: ' + error.message);
      return;
    }
    existing.score_conversation = value;
  } else {
    // 会話スコアだけの行を作成（他のスコアはNULL）
    const { data, error } = await supabase.from('test_results').insert({
      trainee_id: _reportTrainee.id,
      test_name: map.test,
      test_date: new Date().toISOString().slice(0, 10),
      score_conversation: value,
    }).select().single();
    if (error) {
      alert('保存失敗: ' + error.message);
      return;
    }
    _reportResults.push(data);
  }

  // 表示再計算
  convCell.style.background = '#d4edda';
  setTimeout(() => { convCell.style.background = ''; }, 1000);
  // 合計を更新
  const row = _reportResults.find(r => matchTest(r, map));
  if (row) {
    const t = (row.score_vocab ?? 0) + (row.score_grammar ?? 0) + (row.score_listening ?? 0) + (row.score_conversation ?? 0);
    document.getElementById('sTotal').textContent = t;
  }
}

// 報告書のグローバル状態
let _reportTrainee = null;
let _reportResults = [];
let _reportSections = {};
let _reportClassResults = [];
let _reportAllTestResults = [];
let _reportMonthly = {};  // { month: row }
let _currentMonth = 1;

async function loadReport() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { window.location.href = 'index.html'; return; }

  // URL hash から ro=1 (readonly) / bulk=1 を取得
  const hash = (location.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(hash.replace(/&/g, '&'));
  const isBulk = hashParams.get('bulk') === '1';
  const isReadonly = hashParams.get('ro') === '1' || isBulk;
  if (isReadonly) {
    window._REPORT_READONLY = true;
  }
  // bulk PDF 生成時は @media print が効かないので print-mode クラスで圧縮レイアウトを画面適用
  if (isBulk) {
    document.body.classList.add('print-mode');
  }

  try {
    // 対象実習生 + テスト結果 + 月別報告書 + テストセクション情報を取得
    const [{ data: trainee, error: tErr }, { data: results, error: rErr }, { data: monthly }, { data: sections }] = await Promise.all([
      supabase.from('trainees').select('*, organizations(name)').eq('id', id).single(),
      supabase.from('test_results').select('*').eq('trainee_id', id).order('test_date', { ascending: true }),
      supabase.from('monthly_reports').select('*').eq('trainee_id', id),
      supabase.from('test_sections').select('test_id,section_type,answer_key,scoring_rules'),
    ]);
    if (tErr) throw tErr;

    // 同グループ（同じ company + class_group）のテスト結果 → 順位・受験者数 用
    let classResults = [];
    if (trainee.company || trainee.class_group) {
      let q = supabase.from('trainees').select('id');
      if (trainee.company) q = q.eq('company', trainee.company);
      if (trainee.class_group) q = q.eq('class_group', trainee.class_group);
      const { data: classTrainees } = await q;
      if (classTrainees && classTrainees.length > 0) {
        const ids = classTrainees.map(t => t.id);
        const { data: allResults } = await supabase
          .from('test_results').select('*').in('trainee_id', ids);
        classResults = allResults || [];
      }
    }

    // 全実習生のテスト結果 → 平均・偏差値 用
    const { data: globalAll } = await supabase.from('test_results').select('*');
    const allTestResults = globalAll || [];

    // グローバル状態に保存
    _reportTrainee = trainee;
    _reportResults = results || [];
    _reportClassResults = classResults;
    _reportAllTestResults = allTestResults;
    _reportMonthly = {};
    (monthly || []).forEach(r => { _reportMonthly[r.month] = r; });
    _reportSections = {};
    (sections || []).forEach(s => {
      if (!_reportSections[s.test_id]) _reportSections[s.test_id] = {};
      _reportSections[s.test_id][s.section_type] = { answer_key: s.answer_key, scoring_rules: s.scoring_rules };
    });

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
    // URL hash に指定されていればその月に切替
    const hashP = new URLSearchParams((location.hash||'').replace(/^#/, ''));
    const urlMonth = parseInt(hashP.get('m'), 10);
    if (urlMonth >= 1 && urlMonth <= 8) {
      document.getElementById('monthSelect').value = String(urlMonth);
      document.getElementById('monthPrint').textContent = String(urlMonth);
      switchMonth(urlMonth);
    } else {
      switchMonth(initMonth);
    }

    // 閲覧専用モード適用
    if (window._REPORT_READONLY) {
      document.body.classList.add('readonly-view');
      // 全ての contenteditable を無効化
      document.querySelectorAll('[contenteditable="true"]').forEach(el => el.setAttribute('contenteditable', 'false'));
      // select の現在値を *-print に反映
      const msel = document.getElementById('monthSelect');
      const mprint = document.getElementById('monthPrint');
      if (msel && mprint) mprint.textContent = msel.value;
      const asel = document.getElementById('evalAttitude');
      const aprint = document.getElementById('attitudePrint');
      if (asel && aprint) aprint.textContent = asel.value;
      const esel = document.getElementById('learnEnv');
      const eprint = document.getElementById('envPrint');
      if (esel && eprint) eprint.textContent = esel.value;
    }
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
  const result = _reportResults.find(r => matchTest(r, map));
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
    document.getElementById('sTotal').textContent = total;

    // 統計
    // 新旧両フォーマットの test_name を同一視（test2 <-> 第5-11課）
    const map = MONTH_TEST_MAP.find(m => matchTest(result, m));
    // 同一 trainee_id の重複（再受験など）は最新 test_date のみ採用
    const dedupeByTrainee = (arr) => {
      const m = new Map();
      arr.forEach(r => {
        const cur = m.get(r.trainee_id);
        if (!cur || (r.test_date || '') > (cur.test_date || '')) m.set(r.trainee_id, r);
      });
      return Array.from(m.values());
    };
    // 同グループ内（順位・受験者数 用）
    const sameTestRaw = map
      ? _reportClassResults.filter(r => matchTest(r, map))
      : _reportClassResults.filter(r => r.test_name === result.test_name);
    const sameTest = dedupeByTrainee(sameTestRaw);
    // 全実習生（平均・偏差値 用）
    const sameTestGlobalRaw = map
      ? _reportAllTestResults.filter(r => matchTest(r, map))
      : _reportAllTestResults.filter(r => r.test_name === result.test_name);
    const sameTestGlobal = dedupeByTrainee(sameTestGlobalRaw);
    const stats = calcStats(sameTest, result, sameTestGlobal);
    document.getElementById('avgVocab').textContent = stats.avg.vocab;
    document.getElementById('avgGrammar').textContent = stats.avg.grammar;
    document.getElementById('avgListen').textContent = stats.avg.listen;
    document.getElementById('avgConv').textContent = stats.avg.conv;
    document.getElementById('avgTotal').textContent = stats.avg.total;
    // 偏差値（classic版のみ存在 / modernでは削除済み）
    const devMap = { devVocab: stats.dev.vocab, devGrammar: stats.dev.grammar, devListen: stats.dev.listen, devConv: stats.dev.conv, devTotal: stats.dev.total };
    Object.entries(devMap).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
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
    // モダンデザイン用: ヒーロー欄
    const heroTotal = document.getElementById('heroTotal');
    if (heroTotal) heroTotal.textContent = total;
    const heroGrade = document.getElementById('heroGrade');
    if (heroGrade) heroGrade.textContent = grade.label;
    const heroGradeDesc = document.getElementById('heroGradeDesc');
    if (heroGradeDesc) heroGradeDesc.textContent = grade.desc;
    const scope2 = document.getElementById('scopeLabel2');
    if (scope2) scope2.textContent = document.getElementById('scopeLabel').textContent;
    // テスト成績あり → 未受験通知を消す
    const wrap = document.getElementById('scoreTableWrap');
    const notice = document.getElementById('noTestNotice');
    if (wrap) wrap.classList.remove('no-test');
    if (notice) notice.style.display = 'none';
  } else {
    // データなし → 未受験表示
    ['sVocab','sGrammar','sListen','sConv','sTotal',
     'avgVocab','avgGrammar','avgListen','avgConv','avgTotal',
     'devVocab','devGrammar','devListen','devConv','devTotal',
     'rankVocab','rankGrammar','rankListen','rankConv','rankTotal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
    document.getElementById('examCount').textContent = '-';
    document.getElementById('rExamDate').textContent = '-';
    document.getElementById('evalJapanese').textContent = '-';
    document.getElementById('evalJapaneseDesc').textContent = '-';
    // モダン: ヒーロー欄もリセット
    const heroTotal = document.getElementById('heroTotal');
    if (heroTotal) heroTotal.textContent = '—';
    const heroGrade = document.getElementById('heroGrade');
    if (heroGrade) heroGrade.textContent = '—';
    const heroGradeDesc = document.getElementById('heroGradeDesc');
    if (heroGradeDesc) heroGradeDesc.textContent = '—';
    const scope2 = document.getElementById('scopeLabel2');
    if (scope2) scope2.textContent = document.getElementById('scopeLabel').textContent;
    // 未受験通知を表示
    const wrap = document.getElementById('scoreTableWrap');
    const notice = document.getElementById('noTestNotice');
    if (wrap) wrap.classList.add('no-test');
    if (notice) notice.style.display = 'block';
  }
}

function renderMonthComments(report) {
  const fields = ['lifeGood','lifeBad','lifeMeasure','lifeImprove','lifePersonality',
                  'learnGood','learnBad','learnMeasure','learnImprove'];
  const dbFields = ['life_good','life_bad','life_measure','life_improve','life_personality',
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

  // 学習進捗: DB保存値があればそれを優先、なければ 第4週 から「第N課」を抽出
  const progEl = document.getElementById('learnProgress');
  if (progEl) {
    let progText = (report && report.learn_progress) || '';
    if (!progText && report && report.week4) {
      // 週4の内容から「第X課」「X課」「L.X」「Lesson X」「第X」等を抽出
      const w4 = String(report.week4).replace(/<[^>]+>/g, ' ');
      const m = w4.match(/第\s*(\d+)\s*課/) ||
                w4.match(/(\d+)\s*課/) ||
                w4.match(/L\.?\s*(\d+)/i) ||
                w4.match(/Lesson\s+(\d+)/i);
      if (m) progText = `第${m[1]}課`;
    }
    progEl.textContent = progText || '-';
  }

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
    life_personality: getHtml('lifePersonality'),
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
  // 基本情報（会社名から「株式会社」を除去）
  const cleanCompany = (t.company || '').replace(/株式会社/g, '').replace(/\s+/g, ' ').trim();
  const companyText = [cleanCompany, t.class_group].filter(Boolean).join(' ').trim() || '-';
  document.getElementById('rCompany').textContent = companyText;
  // カタカナ名の区切り（半角・全角スペース）を中黒「・」に統一
  const kataDisplay = (t.name_katakana || '').replace(/[\s\u3000]+/g, '・').trim() || '-';
  document.getElementById('rNameKata').textContent = kataDisplay;
  document.getElementById('rNameRomaji').textContent = t.name_romaji || '-';
  // 監理団体・送り出し機関（modern版のみ。classic版には存在しないので getElementById ガード）
  const supEl = document.getElementById('rSupervisor');
  if (supEl) supEl.textContent = t.supervising_org || '-';
  const sendEl = document.getElementById('rSender');
  if (sendEl) sendEl.textContent = (t.organizations && t.organizations.name) || '-';
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

  // 顔写真（html2canvas がCSS%を解決できない場合があるため明示px）
  const photoArea = document.getElementById('photoArea');
  if (photoArea && t.photo_url) {
    const isBulkMode = document.body.classList.contains('print-mode');
    const w = isBulkMode ? 84 : 96;
    const h = isBulkMode ? 112 : 128;
    photoArea.innerHTML = `<img src="${t.photo_url}" alt="写真" width="${w}" height="${h}" style="width:${w}px;height:${h}px;max-width:${w}px;max-height:${h}px;object-fit:cover;display:block;" crossorigin="anonymous">`;
  }

  // 成績推移テーブル + グラフ（全8回分表示）
  // 第1回（test1/第1-4課）未受験の場合はセクション全体を非表示
  const hasTest1 = (results || []).some(r => r.test_name === 'test1' || r.test_name === '第1-4課');
  const trendSection = document.getElementById('trendSection');
  if (trendSection) trendSection.style.display = hasTest1 ? '' : 'none';
  // 改ページ制御用のbodyクラス
  document.body.classList.toggle('no-trend', !hasTest1);
  if (hasTest1) {
    const tbody = document.getElementById('trendBody');
    tbody.innerHTML = MONTH_TEST_MAP.map(m => {
      const label = m.testLabel;
      const r = results.find(row => matchTest(row, m));
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

  // 全8回分のラベルを固定（MONTH_TEST_MAP の順序）
  const labels = MONTH_TEST_MAP.map(m => m.testLabel);
  const resolved = MONTH_TEST_MAP.map(m => results.find(r => matchTest(r, m)) || null);

  const vocabData = resolved.map(r => r ? (r.score_vocab ?? 0) : null);
  const grammarData = resolved.map(r => r ? (r.score_grammar ?? 0) : null);
  const listenData = resolved.map(r => r ? (r.score_listening ?? 0) : null);
  const convData = resolved.map(r => r ? (r.score_conversation ?? 0) : null);
  const chart = new Chart(ctx, {
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
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: Math.max(window.devicePixelRatio || 1, 2),
      layout: { padding: { top: 12, right: 10, bottom: 2, left: 2 } },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8, boxWidth: 14 } },
        title: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          min: 0,
          max: 110,
          ticks: {
            font: { size: 10 },
            stepSize: 10,
            callback: v => v > 100 ? '' : v
          },
          grid: {
            color: ctx => ctx.tick && ctx.tick.value > 100 ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.06)'
          }
        },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
  // レイアウト確定後の再リサイズ（テキストがにじむ問題の保険）
  requestAnimationFrame(() => { try { chart.resize(); } catch (e) {} });
}

// sameTestGroup: 同グループ内（順位用）/ sameTestGlobal: 全実習生（平均・偏差値用）
function calcStats(sameTestGroup, latest, sameTestGlobal) {
  const globalSet = sameTestGlobal || sameTestGroup;
  const getScoresGroup = (key) => sameTestGroup.map(r => r[key] ?? 0);
  const getScoresGlobal = (key) => globalSet.map(r => r[key] ?? 0);
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
    const groupScores = getScoresGroup(k.field);
    const globalScores = getScoresGlobal(k.field);
    const val = latest[k.field] ?? 0;
    result.avg[k.name] = avg(globalScores).toFixed(1);
    result.dev[k.name] = deviation(val, globalScores).toFixed(1);
    result.rank[k.name] = rank(val, groupScores);
  });

  const groupTotals = sameTestGroup.map(r =>
    (r.score_vocab ?? 0) + (r.score_grammar ?? 0) + (r.score_listening ?? 0) + (r.score_conversation ?? 0)
  );
  const globalTotals = globalSet.map(r =>
    (r.score_vocab ?? 0) + (r.score_grammar ?? 0) + (r.score_listening ?? 0) + (r.score_conversation ?? 0)
  );
  const myTotal = (latest.score_vocab ?? 0) + (latest.score_grammar ?? 0) +
                  (latest.score_listening ?? 0) + (latest.score_conversation ?? 0);
  result.avg.total = avg(globalTotals).toFixed(1);
  result.dev.total = deviation(myTotal, globalTotals).toFixed(1);
  result.rank.total = rank(myTotal, groupTotals);

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

// 各テストのセクション表示名（診断用）
const SECTION_LABELS = {
  test1: {
    g1:'基本語彙（食べ物・物）', g2:'基本語彙（カタカナ含む）', g3:'カテゴリー分類（国/部屋/仕事）', g4:'語彙選択', g5:'和訳（日→ベトナム語）',
    b1:'助詞の使い方', b2:'語彙選択', b3:'文並び替え', b4:'時間・金額の読み方', b5:'疑問文・否定文', b6:'会話の定型表現', b7:'正しい文の選択',
    c1:'職業の聞き取り', c2:'年齢の聞き取り', c3:'これ/それ/あれ', c4:'物の名前', c5:'所有（だれの）', c6:'ここ/そこ/あそこ',
    c7:'場所（どこ）', c8:'値段と国', c9:'時間・曜日', c10:'電話番号', c11:'会話の真偽判定', c12:'田中さんの一日'
  },
  test2: {
    g1:'基本語彙（食べ物・日用品）', g2:'カタカナ語', g3:'時間表現（月・日付）', g4:'語彙選択', g5:'反対語', g6:'和訳（日→ベトナム語）',
    b1:'助詞の使い方', b2:'語彙選択', b3:'文並び替え', b4:'会話文完成', b5:'位置表現', b6:'正誤判定', b7:'同意文の判定', b8:'正しい答えの選択',
    c1:'行動の聞き取り', c2:'A or B 判定', c3:'理由（どうして）', c4:'行動予定', c5:'買い物', c6:'形容詞', c7:'交通手段',
    c8:'女性の居場所', c9:'スケジュール', c10:'絵と音声のマッチ', c11:'○×判定', c12:'選択式応答'
  }
};

// 正規化（ベトナム語声調を除去）
function _diagNorm(s){ return String(s||'').trim().toLowerCase().replace(/\s+/g,'').replace(/\u3000/g,''); }
function _diagNormVi(s){
  let x = _diagNorm(s);
  try { x = x.normalize('NFD').replace(/[\u0300-\u036f]/g,''); } catch(e){}
  return x.replace(/đ/g,'d');
}

// ルール別・単一フィールドの正誤判定
function _diagIsCorrect(userVal, expected, method) {
  if (expected === null || expected === undefined) return null;
  if (userVal === null || userVal === undefined || String(userVal).trim()==='') return false;
  const exps = Array.isArray(expected) ? expected : [expected];
  if (method === 'ox_match') {
    const ox = s => { s=String(s).trim(); if('○Oo〇'.includes(s)) return '○'; if('✕×XxⅩ'.includes(s)) return '×'; return s; };
    return exps.some(e => ox(userVal)===ox(e));
  }
  if (method === 'phone_match') {
    const ph = s => String(s).replace(/\D/g,'');
    return exps.some(e => ph(userVal)===ph(e));
  }
  if (method === 'unordered_tokens') {
    const us = _diagNorm(userVal).split('').sort().join('');
    return exps.some(e => _diagNorm(e).split('').sort().join('')===us);
  }
  if (method === 'flex_match' || method === 'split_match' || method === 'vietnamese_fuzzy') {
    const split = s => String(s||'').split(/[／、,，/]/).map(x=>x.trim()).filter(Boolean);
    const uv = split(userVal).map(_diagNormVi).concat([_diagNormVi(userVal)]);
    const ev = [];
    exps.forEach(e => { if(e) split(e).forEach(v => ev.push(_diagNormVi(v))); });
    return ev.some(e => uv.some(u => u===e));
  }
  if (method === 'substring_match') {
    const u = _diagNorm(userVal);
    return exps.some(e => { const en=_diagNorm(e); return u.length>=3 && (u.includes(en)||en.includes(u)); });
  }
  return exps.some(e => _diagNorm(userVal) === _diagNorm(e));
}

function _diagGetExpected(ak, fid, idx) {
  if (Array.isArray(ak)) {
    if (typeof idx === 'number' && idx>=0 && idx<ak.length) return ak[idx];
    const m = /(\d+)[a-z]*$/.exec(fid||'');
    if (m) { const i=parseInt(m[1],10)-1; if (i>=0 && i<ak.length) {
      const v=ak[i]; if (v&&typeof v==='object'&&!Array.isArray(v)) { const last=fid[fid.length-1]; return v[last]; } return v; }}
    return undefined;
  }
  if (ak && typeof ak==='object') {
    if (fid in ak) return ak[fid];
    for (const k in ak) { if (ak[k]&&typeof ak[k]==='object'&&fid in ak[k]) return ak[k][fid]; }
  }
  return undefined;
}

// セクション別の正答率ベース診断（test1/test2用）
function generateSectionDiagnosis(answers, testName) {
  const sections = _reportSections[testName];
  if (!sections) return null;
  const labels = SECTION_LABELS[testName] || {};
  const bySecType = {};
  for (const stype in sections) {
    const { answer_key, scoring_rules } = sections[stype];
    if (!scoring_rules) continue;
    const secResults = [];
    for (const sid in scoring_rules) {
      const rule = scoring_rules[sid];
      if (!rule || rule.method === 'manual') continue;
      const method = rule.method;
      const sectionAk = (answer_key||{})[sid];
      let correct=0, total=0;
      // bucket_sort は特殊
      if (method === 'bucket_sort') {
        (rule.field_ids||[]).forEach((fid,i) => {
          total++;
          const exp = Array.isArray(sectionAk)&&i<sectionAk.length ? sectionAk[i] : [];
          let userKeys = answers[fid]||'[]';
          try { userKeys = typeof userKeys==='string' ? JSON.parse(userKeys) : userKeys; } catch(e){userKeys=[];}
          if (!Array.isArray(userKeys)) userKeys=[];
          const hasAll = exp.every(k => userKeys.includes(k));
          const trapCount = userKeys.filter(k => (rule.trap_keys||[]).includes(k)).length;
          if (hasAll && trapCount===0) correct++;
        });
      } else {
        // field_ids を列挙
        let fids = rule.field_ids || [];
        if (method==='multi_field_group') fids = (rule.groups||[]).flat();
        if (method==='pair_match') {
          (rule.items||[]).forEach(p => { if(p.a_field) fids.push(p.a_field); if(p.b_field) fids.push(p.b_field); });
        }
        if (method==='price_country') {
          (rule.items||[]).forEach(p => { if(p.price_field) fids.push(p.price_field); if(p.country_field) fids.push(p.country_field); });
        }
        fids.forEach((fid,i) => {
          const exp = _diagGetExpected(sectionAk, fid, i);
          if (exp === undefined) return;
          total++;
          if (_diagIsCorrect(answers[fid], exp, method)) correct++;
        });
      }
      if (total > 0) {
        secResults.push({ sid, label: labels[sid]||sid, correct, total, rate: correct/total });
      }
    }
    if (secResults.length) bySecType[stype] = secResults;
  }
  return bySecType;
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

  // test1/test2 は セクション別正答率ベースの診断（全体まとめ文章）
  if (withAnswers.test_name === 'test1' || withAnswers.test_name === 'test2') {
    const secDiag = generateSectionDiagnosis(answers, withAnswers.test_name);
    if (secDiag) {
      const stypeJp = { goii:'語彙', bunpo:'文法', chokkai:'聴解' };
      const byType = {goii:{correct:0,total:0,weak:[],strong:[]}, bunpo:{correct:0,total:0,weak:[],strong:[]}, chokkai:{correct:0,total:0,weak:[],strong:[]}};
      ['goii','bunpo','chokkai'].forEach(st => {
        (secDiag[st]||[]).forEach(x => {
          byType[st].correct += x.correct;
          byType[st].total += x.total;
          if (x.rate < 0.6) byType[st].weak.push(x.label);
          else if (x.rate >= 0.85) byType[st].strong.push(x.label);
        });
      });
      // 教科別の総合評価
      const getLevel = t => {
        if (t.total === 0) return null;
        const r = t.correct / t.total;
        if (r >= 0.9) return { word:'よく理解できている', color:'#27ae60' };
        if (r >= 0.75) return { word:'おおむね理解できている', color:'#16a085' };
        if (r >= 0.6) return { word:'一部に弱点が見られる', color:'#e67e22' };
        return { word:'基礎固めが必要', color:'#c0392b' };
      };
      const vLevel = getLevel(byType.goii);
      const gLevel = getLevel(byType.bunpo);
      const lLevel = getLevel(byType.chokkai);

      // 全体平均
      const totalCorrect = byType.goii.correct + byType.bunpo.correct + byType.chokkai.correct;
      const totalAll = byType.goii.total + byType.bunpo.total + byType.chokkai.total;
      const avgRate = totalAll > 0 ? totalCorrect/totalAll : 0;

      // 全体総評（1段落、常体）
      let overall = '';
      if (avgRate >= 0.9) overall = '全体的に非常に高い理解度を示しており、基礎が確実に定着している。';
      else if (avgRate >= 0.75) overall = '全体的には安定した理解度を保ち、学習進度は良好。';
      else if (avgRate >= 0.6) overall = '基礎は概ね身についているが、いくつかの分野に課題が残る。';
      else overall = '全体的に正答率が低く、広範囲にわたって基礎の定着が不十分な状況。';

      // 教科別の詳細（同じ評価レベルの教科はまとめる）
      const levelToSubjects = {};
      [['語彙', vLevel], ['文法', gLevel], ['聴解', lLevel]].forEach(([sub, lv]) => {
        if (!lv) return;
        if (!levelToSubjects[lv.word]) levelToSubjects[lv.word] = [];
        levelToSubjects[lv.word].push(sub);
      });
      const parts = Object.entries(levelToSubjects).map(([word, subs]) => {
        return `${subs.join('・')}は${word}`;
      });

      // 最終まとめ文（常体）
      let narrative = `${overall} 個別に見ると、${parts.join('、')}という状況。`;

      // 強み（教科ごとに独立、最大2件/教科）
      const strongFragments = [];
      ['goii','bunpo','chokkai'].forEach(st => {
        if (byType[st].strong.length > 0) {
          const items = byType[st].strong.slice(0,2).map(x => `「${x}」`).join('・');
          const more = byType[st].strong.length > 2 ? 'など' : '';
          strongFragments.push(`${stypeJp[st]}の${items}${more}`);
        }
      });
      if (strongFragments.length > 0) {
        narrative += ` 特に${strongFragments.join('、')}で高い正答率を示しており、しっかり理解できている。`;
      }

      // 弱み（教科ごとに独立、すべて列挙）
      const weakFragments = [];
      ['goii','bunpo','chokkai'].forEach(st => {
        if (byType[st].weak.length > 0) {
          // 全件列挙（ただし5件超は など で省略）
          const items = byType[st].weak.slice(0,5).map(x => `「${x}」`).join('・');
          const more = byType[st].weak.length > 5 ? 'など' : '';
          weakFragments.push(`${stypeJp[st]}の${items}${more}`);
        }
      });
      if (weakFragments.length > 0) {
        narrative += ` 一方で${weakFragments.join('、')}では理解不足が目立つ。`;
      }

      // 教科別の具体的アドバイス（弱点がある教科に対して）
      const adviceMap = {
        goii: '語彙は日常使う単語の反復学習（フラッシュカード・単語アプリ）が有効',
        bunpo: '文法は基本パターンを例文で繰り返し音読し、助詞の使い分けを意識する',
        chokkai: '聴解は音声を何度も聞き、ディクテーション（書き取り）や音読練習で耳を慣らす'
      };
      const adviceParts = [];
      ['goii','bunpo','chokkai'].forEach(st => {
        if (byType[st].weak.length > 0) adviceParts.push(adviceMap[st]);
      });
      if (adviceParts.length > 0) {
        narrative += ` 指導面では、${adviceParts.join('。また、')}。`;
      } else {
        narrative += ' 現状の学習ペースを維持し、新出項目の積み上げを継続する。';
      }

      let html = '<div>';
      html += `<p style="margin:0 0 6px">${narrative}</p>`;
      html += `<p style="font-size:10px;color:#94a3b8;margin:0">（${withAnswers.test_name} / ${withAnswers.test_date} の解答を基に分析・全体正答率 ${Math.round(avgRate*100)}%）</p>`;
      html += '</div>';
      diagArea.innerHTML = html;
      return;
    }
  }

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
