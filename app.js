// ===== 実習生一覧 =====
let allTrainees = [];
let allOrgs = [];
let currentRenderedTrainees = [];
let selectedTraineeIds = new Set();

const TRAINEE_STATUS = {
  active: { label: '稼働中', badge: 'active' },
  graduated: { label: '卒業', badge: 'graduated' },
  withdrawn: { label: '辞退・退学', badge: 'withdrawn' },
  inactive: { label: '停止', badge: 'inactive' },
};

function getTraineeStatus(t) {
  return t?.status || 'active';
}

function getStatusFilter() {
  return localStorage.getItem('indexStatusFilter') || 'active';
}

function isArchivedStatus(status) {
  return status && status !== 'active';
}

function statusLabel(status) {
  return TRAINEE_STATUS[status]?.label || status || '稼働中';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateStatusTabs() {
  const current = getStatusFilter();
  document.querySelectorAll('[data-status-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.statusFilter === current);
  });
}

function setStatusFilter(value) {
  localStorage.setItem('indexStatusFilter', value || 'active');
  clearBulkSelection();
  updateStatusTabs();
  applyFilters();
}

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
    updateStatusTabs();
    setupKumiaiFilter();
    // ログインアカウント未作成チェック（admin のみ）
    if (typeof isAdmin === 'function' && isAdmin()) {
      const noAuth = allTrainees.filter(t => getTraineeStatus(t) === 'active' && !t.auth_user_id && t.student_id && t.birth_date);
      const banner = document.getElementById('noAuthBanner');
      if (banner) {
        if (noAuth.length > 0) {
          document.getElementById('noAuthCount').textContent = noAuth.length;
          document.getElementById('noAuthIds').textContent = noAuth.map(t => t.student_id).join(', ');
          banner.classList.remove('hidden');
        } else {
          banner.classList.add('hidden');
        }
      }
    }
    // 最後に必ず applyFilters() を呼ぶ。
    // org/kumiai/search の localStorage 復元結果をすべて反映させた最終状態をレンダ。
    applyFilters();
  } catch (err) {
    document.getElementById('loadingMsg').classList.add('hidden');
    const errEl = document.getElementById('errorMsg');
    errEl.textContent = 'データの読み込みに失敗しました: ' + err.message;
    errEl.classList.remove('hidden');
  }
}

// 組合フィルタを populate（実習生データから一意の supervising_org を抽出）
// 戻り値: フィルタを適用して render したかどうか (true なら呼び出し側は render 不要)
function setupKumiaiFilter() {
  const filterEl = document.getElementById('kumiaiFilter');
  if (!filterEl || filterEl.dataset.populated === '1') return false;

  const kumiais = [...new Set(allTrainees.map(t => t.supervising_org).filter(Boolean))].sort();
  // 1組合しか無い場合はフィルタ非表示
  if (kumiais.length <= 1) {
    filterEl.classList.add('hidden');
    return false;
  }
  kumiais.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    filterEl.appendChild(opt);
  });
  filterEl.dataset.populated = '1';

  filterEl.addEventListener('change', () => {
    localStorage.setItem('indexKumiaiFilter', filterEl.value);
    applyFilters();
  });

  // 既定値: 直前の選択を localStorage から復元 → なければグローバルウェイを優先選択
  const saved = localStorage.getItem('indexKumiaiFilter');
  let defaultKumiai = '';
  if (saved !== null) {
    // 空文字（全組合）も保存対象なのでそのまま使う
    if (saved === '' || kumiais.includes(saved)) defaultKumiai = saved;
  } else {
    const gw = kumiais.find(k => k.includes('グローバルウェイ'));
    if (gw) defaultKumiai = gw;
  }
  if (defaultKumiai) {
    filterEl.value = defaultKumiai;
  }
  // applyFilters は呼び出し側 (loadTrainees) で最後にまとめて呼ばれる
  return false;
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
    localStorage.setItem('indexOrgFilter', filterEl.value);
    applyFilters();
  });

  // 直前の選択を localStorage から復元（applyFilters は loadTrainees 側で最後にまとめて呼ぶ）
  const saved = localStorage.getItem('indexOrgFilter');
  if (saved !== null && (saved === '' || allOrgs.some(o => o.id === saved))) {
    filterEl.value = saved;
  }
}

function applyFilters() {
  const searchEl = document.getElementById('searchInput');
  const orgEl = document.getElementById('orgFilter');
  const kumiaiEl = document.getElementById('kumiaiFilter');
  const q = (searchEl ? searchEl.value : '').toLowerCase();
  const orgId = orgEl ? orgEl.value : '';
  const kumiai = kumiaiEl ? kumiaiEl.value : '';

  let filtered = allTrainees;
  const statusFilter = getStatusFilter();
  if (statusFilter === 'active') {
    filtered = filtered.filter(t => getTraineeStatus(t) === 'active');
  } else if (statusFilter === 'archive') {
    filtered = filtered.filter(t => isArchivedStatus(getTraineeStatus(t)));
  }
  if (q) {
    filtered = filtered.filter(t =>
      (t.name_romaji || '').toLowerCase().includes(q) ||
      (t.name_katakana || '').includes(q) ||
      (t.company || '').toLowerCase().includes(q) ||
      (t.class_group || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    );
  }
  if (orgId) {
    filtered = filtered.filter(t => t.organization_id === orgId);
  }
  if (kumiai) {
    filtered = filtered.filter(t => t.supervising_org === kumiai);
  }
  clearBulkSelection(false);
  renderTrainees(filtered);
}

function renderTrainees(data) {
  document.getElementById('loadingMsg').classList.add('hidden');

  const emptyEl = document.getElementById('emptyMsg');
  const tableEl = document.getElementById('traineeTable');
  currentRenderedTrainees = data;

  if (data.length === 0) {
    tableEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    updateBulkArchiveBar();
    return;
  }

  emptyEl.classList.add('hidden');
  const showOrg = isAdmin();
  const tbody = document.getElementById('traineeList');
  const fmtDate = s => {
    if (!s) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : s;
  };
  const escAttr = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const photoCell = t => {
    const label = t.student_id ? String(t.student_id).slice(-3) : 'No';
    return t.photo_url
      ? `<a href="trainee.html?id=${t.id}" class="list-photo-link"><img src="${escAttr(t.photo_url)}" alt="${escAttr(t.name_romaji || '写真')}" class="list-photo" loading="lazy" onerror="this.closest('.list-photo-link').outerHTML='<div class=&quot;list-photo list-photo-placeholder&quot;>${escAttr(label)}</div>'"></a>`
      : `<div class="list-photo list-photo-placeholder">${escAttr(label)}</div>`;
  };
  const statusCell = t => {
    const status = getTraineeStatus(t);
    if (status === 'active') return '';
    const meta = TRAINEE_STATUS[status] || { label: status, badge: 'inactive' };
    const note = t.archive_note ? ` title="${escAttr(t.archive_note)}"` : '';
    return `<span class="status-badge status-${meta.badge}"${note}>${escAttr(meta.label)}</span>`;
  };
  tbody.innerHTML = data.map(t => `
    <tr>
      ${showOrg ? `<td class="td-select"><input type="checkbox" class="trainee-select" value="${escAttr(t.id)}" aria-label="${escAttr(t.name_romaji || t.student_id || '実習生')}を選択" ${selectedTraineeIds.has(t.id) ? 'checked' : ''} onchange="toggleTraineeSelection('${escAttr(t.id)}', this.checked)"></td>` : ''}
      <td class="td-photo">${photoCell(t)}</td>
      <td><span class="student-id-badge">${t.student_id || '-'}</span></td>
      <td><a href="trainee.html?id=${t.id}">${t.name_romaji}</a>${statusCell(t)}</td>
      <td>${t.name_katakana || '-'}</td>
      <td style="font-family:'Inter',monospace;font-size:12px;color:var(--ink-soft)">${fmtDate(t.birth_date)}</td>
      <td>${t.company || '-'}</td>
      <td>${t.class_group || '-'}</td>
      <td>${t.supervising_org || '-'}</td>
      ${showOrg ? `<td>${t.organizations?.name || '-'}</td>` : ''}
      <td style="font-family:'Inter',monospace;font-size:12px;color:var(--ink-soft)">${fmtDate(t.training_start_date)}</td>
      <td>
        <textarea
          data-id="${t.id}"
          class="notes-input"
          rows="2"
          onblur="saveInlineNotes(this)"
          placeholder="メモ"
          style="width:200px;min-width:140px;max-width:280px;min-height:38px;font-size:12px;padding:5px 7px;border:1px solid #d0d6dd;border-radius:5px;resize:vertical;font-family:inherit;line-height:1.5;background:#fff;box-sizing:border-box"
        >${escAttr(t.notes || '')}</textarea>
      </td>
      <td>
        <a href="trainee.html?id=${t.id}" class="btn btn-sm btn-secondary">詳細</a>
        <a href="report.html?id=${t.id}" target="_blank" class="btn btn-sm btn-report" title="教育報告書を開く">📄 報告書</a>
        <button onclick="deleteTrainee('${t.id}')" class="btn btn-sm btn-danger">削除</button>
      </td>
    </tr>
  `).join('');

  tableEl.classList.remove('hidden');
  updateBulkArchiveBar();
}

function toggleTraineeSelection(id, checked) {
  if (!id) return;
  if (checked) {
    selectedTraineeIds.add(id);
  } else {
    selectedTraineeIds.delete(id);
  }
  updateBulkArchiveBar();
}

function toggleAllVisibleTrainees(checked) {
  currentRenderedTrainees.forEach(t => {
    if (checked) {
      selectedTraineeIds.add(t.id);
    } else {
      selectedTraineeIds.delete(t.id);
    }
  });
  document.querySelectorAll('.trainee-select').forEach(cb => {
    cb.checked = checked;
  });
  updateBulkArchiveBar();
}

function clearBulkSelection(update = true) {
  selectedTraineeIds.clear();
  if (!update) return;
  document.querySelectorAll('.trainee-select').forEach(cb => {
    cb.checked = false;
  });
  const selectAll = document.getElementById('selectAllTrainees');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
  updateBulkArchiveBar();
}

function updateBulkArchiveBar() {
  const bar = document.getElementById('bulkArchiveBar');
  const countEl = document.getElementById('bulkSelectedCount');
  const selectAll = document.getElementById('selectAllTrainees');
  if (!bar || !countEl) return;

  const visibleIds = currentRenderedTrainees.map(t => t.id);
  const visibleSelected = visibleIds.filter(id => selectedTraineeIds.has(id)).length;
  const count = selectedTraineeIds.size;
  countEl.textContent = count;
  bar.classList.toggle('hidden', count === 0);

  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleIds.length;
  }
}

async function applyBulkStatus() {
  const ids = [...selectedTraineeIds];
  if (!ids.length) return;

  const statusEl = document.getElementById('bulkStatusSelect');
  const dateEl = document.getElementById('bulkStatusDate');
  const noteEl = document.getElementById('bulkArchiveNote');
  const status = statusEl?.value || 'graduated';
  const label = statusLabel(status);
  const note = noteEl?.value?.trim() || null;
  const targetNames = ids
    .map(id => allTrainees.find(t => t.id === id))
    .filter(Boolean)
    .map(t => `${t.student_id || ''} ${t.name_romaji || ''}`.trim())
    .slice(0, 5)
    .join('\n');
  const more = ids.length > 5 ? `\nほか ${ids.length - 5} 名` : '';

  if (!confirm(`${ids.length}名を「${label}」に変更します。\n\n${targetNames}${more}`)) return;

  const payload = {
    status,
    graduated_at: status === 'active' ? null : (dateEl?.value || new Date().toISOString().slice(0, 10)),
    archive_note: status === 'active' ? null : note,
  };

  const { error } = await supabase
    .from('trainees')
    .update(payload)
    .in('id', ids);

  if (error) {
    alert('一括変更に失敗しました: ' + error.message);
    return;
  }

  allTrainees = allTrainees.map(t => ids.includes(t.id) ? { ...t, ...payload } : t);
  clearBulkSelection(false);
  applyFilters();
  alert(`${ids.length}名を「${label}」に変更しました。`);
}

function filterTrainees(query) {
  applyFilters();
}

// ===== ログインカード出力 =====
function getFilteredTrainees() {
  const searchEl = document.getElementById('searchInput');
  const orgEl = document.getElementById('orgFilter');
  const kumiaiEl = document.getElementById('kumiaiFilter');
  const q = (searchEl ? searchEl.value : '').toLowerCase();
  const orgId = orgEl ? orgEl.value : '';
  const kumiai = kumiaiEl ? kumiaiEl.value : '';

  let filtered = allTrainees;
  const statusFilter = getStatusFilter();
  if (statusFilter === 'active') {
    filtered = filtered.filter(t => getTraineeStatus(t) === 'active');
  } else if (statusFilter === 'archive') {
    filtered = filtered.filter(t => isArchivedStatus(getTraineeStatus(t)));
  }
  if (q) {
    filtered = filtered.filter(t =>
      (t.name_romaji || '').toLowerCase().includes(q) ||
      (t.name_katakana || '').includes(q) ||
      (t.company || '').toLowerCase().includes(q) ||
      (t.class_group || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q)
    );
  }
  if (orgId) {
    filtered = filtered.filter(t => t.organization_id === orgId);
  }
  if (kumiai) {
    filtered = filtered.filter(t => t.supervising_org === kumiai);
  }
  return filtered;
}

function exportLoginCards() {
  const trainees = getFilteredTrainees().filter(t => t.auth_user_id && getTraineeStatus(t) === 'active');
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
  const curEl = document.getElementById('curriculum');
  if (curEl) curEl.value = t.curriculum || 'minna_nihongo';
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
    curriculum: document.getElementById('curriculum')?.value || 'minna_nihongo',
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
const TERMINOLOGY_TOTAL_QUIZ_SETS = 18;
const TERMINOLOGY_FINAL_SET_ID = 'kinrei-final-2023';

function safePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function latestByCreatedAt(items) {
  return [...(items || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

function cutoffDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function formatStudyDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  if (totalMinutes < 60) return totalMinutes + '分';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours + '時間' + minutes + '分';
}

function isKinreiTerminologyTarget(t) {
  const company = String(t?.company || '').toLowerCase();
  const group = String(t?.class_group || '').toLowerCase();
  return company.includes('キンレイ') || company.includes('kinrei') || group.includes('キンレイ') || group.includes('kinrei');
}

function buildTerminologySummary(progressRows, quizRows, imageProgressRows, sessionRows, finalUnlockRows = []) {
  const totalTerms = window.KINREI_VOCAB?.terms?.length || window.KINREI_VOCAB?.set?.termCount || 297;
  const totalImages = window.KINREI_IMAGE_QUIZ?.items?.length || 60;
  const progress = progressRows || [];
  const imageProgress = imageProgressRows || [];
  const quizItems = quizRows || [];
  const sessions = sessionRows || [];
  const learned = progress.filter(p => p.status === 'learned').length;
  const review = progress.filter(p => p.status === 'review').length;
  const imageLearned = imageProgress.filter(p => p.status === 'learned').length;
  const imageReview = imageProgress.filter(p => p.status === 'review').length;
  const touched = new Set(progress.map(p => p.term_id).filter(Boolean)).size;
  const imageTouched = new Set(imageProgress.map(p => p.image_id).filter(Boolean)).size;
  const lastProgressAt = progress.map(p => p.last_studied_at).filter(Boolean).sort().pop() || '';
  const lastImageAt = imageProgress.map(p => p.last_studied_at).filter(Boolean).sort().pop() || '';
  const standardQuiz = quizItems.filter(q => String(q.set_id || '').startsWith('kinrei-test-2023'));
  const latestStandardBySet = new Map();
  standardQuiz.forEach(item => {
    const current = latestStandardBySet.get(item.set_id);
    if (!current || String(item.created_at || '') > String(current.created_at || '')) {
      latestStandardBySet.set(item.set_id, item);
    }
  });
  const latestStandard = [...latestStandardBySet.values()];
  const quizAvg = latestStandard.length
    ? safePercent(latestStandard.reduce((sum, q) => sum + Number(q.score_rate || 0), 0) / latestStandard.length)
    : null;
  const perfectStandardSetCount = new Set(
    standardQuiz
      .filter(q => Number(q.score_rate || 0) >= 100)
      .map(q => q.set_id)
      .filter(Boolean)
  ).size;
  const finalResults = quizItems.filter(q => String(q.set_id || '') === TERMINOLOGY_FINAL_SET_ID);
  const finalLatest = latestByCreatedAt(finalResults);
  const finalUnlock = (finalUnlockRows || []).find(row => String(row.test_set_id || '') === TERMINOLOGY_FINAL_SET_ID);
  const lastQuizAt = quizItems.map(q => q.created_at).filter(Boolean).sort().pop() || '';
  const totalStudySeconds = sessions.reduce((sum, s) => sum + Number(s.duration_seconds || 0), 0);
  const lastAccess = sessions.map(s => s.last_seen_at || s.created_at).filter(Boolean).sort().pop() || '';
  const sessions7 = sessions.filter(s => new Date(s.created_at).getTime() >= cutoffDate(7).getTime()).length;
  const sessions30 = sessions.filter(s => new Date(s.created_at).getTime() >= cutoffDate(30).getTime()).length;
  const lastStudy = [lastProgressAt, lastImageAt, lastQuizAt, lastAccess].filter(Boolean).sort().pop() || '';

  return {
    totalTerms,
    totalImages,
    learned,
    review,
    imageLearned,
    imageReview,
    touched,
    imageTouched,
    learnedRate: totalTerms ? safePercent((learned / totalTerms) * 100) : 0,
    imageLearnedRate: totalImages ? safePercent((imageLearned / totalImages) * 100) : 0,
    quizSetCount: perfectStandardSetCount,
    quizAttemptCount: standardQuiz.length,
    quizAvg,
    finalUnlocked: Boolean(finalUnlock?.is_unlocked),
    finalUnlockedAt: finalUnlock?.unlocked_at || '',
    finalRate: finalLatest ? safePercent(finalLatest.score_rate) : null,
    finalAttemptCount: finalResults.length,
    finalLatest,
    totalStudySeconds,
    sessions7,
    sessions30,
    lastAccess,
    lastStudy,
    hasAnyData: progress.length > 0 || imageProgress.length > 0 || quizItems.length > 0,
  };
}

function renderTerminologyDetailCard(summary, trainee) {
  const isTarget = isKinreiTerminologyTarget(trainee);
  if (!isTarget && !summary.hasAnyData) {
    return `
      <div class="terminology-detail terminology-detail-muted">
        <div class="terminology-detail-head">
          <div>
            <div class="section-title terminology-title">キンレイ専門用語</div>
            <p class="terminology-detail-lead">この実習生は現在、キンレイ専門用語学習の対象外です。</p>
          </div>
          <a href="terminology-progress.html" class="btn btn-secondary btn-sm">全体一覧</a>
        </div>
      </div>
    `;
  }

  const quizRate = safePercent((summary.quizSetCount / TERMINOLOGY_TOTAL_QUIZ_SETS) * 100);
  const finalText = summary.finalRate === null ? '未受験' : `${summary.finalRate}%`;
  const finalSub = summary.finalAttemptCount
    ? `総合修了テスト ${summary.finalAttemptCount}回受験`
    : summary.finalUnlocked
      ? '管理者が開放済みです'
      : `${TERMINOLOGY_TOTAL_QUIZ_SETS}回完了後、管理者が立会い時に開放します`;

  return `
    <div class="terminology-detail">
      <div class="terminology-detail-head">
        <div>
          <div class="section-title terminology-title">キンレイ専門用語</div>
          <p class="terminology-detail-lead">専門用語暗記・20問ずつの小テスト・総合修了テストの進捗です。</p>
        </div>
        <div class="terminology-detail-actions">
          <a href="terminology-progress.html" class="btn btn-secondary btn-sm">全体一覧</a>
          <a href="https://kabuyt.github.io/nihongo-test-1-4ka/terminology-login.html" class="btn btn-secondary btn-sm" target="_blank" rel="noopener">学習ページ</a>
        </div>
      </div>

      <div class="term-detail-grid">
        <div class="term-detail-card">
          <span>暗記率</span>
          <strong>${summary.learnedRate}%</strong>
          <div class="term-progress-bar"><i style="width:${summary.learnedRate}%"></i></div>
          <small>覚えた ${summary.learned} / ${summary.totalTerms}語</small>
        </div>
        <div class="term-detail-card">
          <span>画像暗記</span>
          <strong>${summary.imageLearnedRate}%</strong>
          <div class="term-progress-bar"><i style="width:${summary.imageLearnedRate}%"></i></div>
          <small>覚えた ${summary.imageLearned} / ${summary.totalImages}枚・要復習 ${summary.imageReview}</small>
        </div>
        <div class="term-detail-card">
          <span>テスト進捗</span>
          <strong>${summary.quizSetCount} / ${TERMINOLOGY_TOTAL_QUIZ_SETS}</strong>
          <div class="term-progress-bar"><i style="width:${quizRate}%"></i></div>
          <small>100%完了・${summary.quizAvg === null ? '平均 -' : `平均 ${summary.quizAvg}%`}・受験 ${summary.quizAttemptCount}回</small>
        </div>
        <div class="term-detail-card">
          <span>総合修了テスト</span>
          <strong>${finalText}</strong>
          <div class="term-progress-bar final"><i style="width:${summary.finalRate === null ? 0 : summary.finalRate}%"></i></div>
          <small>${finalSub}</small>
        </div>
        <div class="term-detail-card ${summary.review > 0 ? 'warn' : ''}">
          <span>要復習</span>
          <strong>${summary.review + summary.imageReview}</strong>
          <small>ことば ${summary.review}・画像 ${summary.imageReview}・最終学習 ${summary.lastStudy ? formatDate(summary.lastStudy) : '-'}</small>
        </div>
        <div class="term-detail-card">
          <span>学習頻度</span>
          <strong>${formatStudyDuration(summary.totalStudySeconds)}</strong>
          <small>総学習時間。直近7日 ${summary.sessions7}回・直近30日 ${summary.sessions30}回・最終アクセス ${summary.lastAccess ? formatDate(summary.lastAccess) : '-'}</small>
        </div>
      </div>

      ${summary.hasAnyData ? '' : '<p class="terminology-empty">まだ専門用語の学習データがありません。</p>'}
    </div>
  `;
}

async function loadTraineeDetail() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const [{ data: trainee, error: tErr }, { data: results }, progressRes, imageProgressRes, quizRes, sessionRes, finalUnlockRes] = await Promise.all([
      supabase.from('trainees').select('*').eq('id', id).single(),
      supabase.from('test_results').select('*').eq('trainee_id', id).order('test_date', { ascending: false }),
      supabase.from('terminology_progress').select('term_id,status,correct_count,wrong_count,last_studied_at').eq('trainee_id', id),
      supabase.from('terminology_image_progress').select('image_id,status,last_studied_at').eq('trainee_id', id),
      supabase.from('terminology_quiz_results').select('set_id,score_rate,correct_count,total_questions,created_at').eq('trainee_id', id).like('set_id', 'kinrei%'),
      supabase.from('terminology_study_sessions').select('created_at,duration_seconds,last_seen_at').eq('trainee_id', id),
      supabase.from('terminology_final_unlocks').select('test_set_id,is_unlocked,unlocked_at').eq('trainee_id', id).eq('test_set_id', TERMINOLOGY_FINAL_SET_ID),
    ]);

    if (tErr) throw tErr;

    const terminologySummary = buildTerminologySummary(
      progressRes.error ? [] : (progressRes.data || []),
      quizRes.error ? [] : (quizRes.data || []),
      imageProgressRes.error ? [] : (imageProgressRes.data || []),
      sessionRes.error ? [] : (sessionRes.data || []),
      finalUnlockRes.error ? [] : (finalUnlockRes.data || [])
    );

    renderTraineeDetail(trainee, results || [], terminologySummary);
  } catch (err) {
    document.getElementById('loadingMsg').textContent = '読み込みに失敗しました: ' + err.message;
  }
}

function renderTraineeDetail(t, results, terminologySummary) {
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
          <h2>${t.name_romaji}${getTraineeStatus(t) !== 'active' ? ` <span class="status-badge status-${TRAINEE_STATUS[getTraineeStatus(t)]?.badge || 'inactive'}">${statusLabel(getTraineeStatus(t))}</span>` : ''}</h2>
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

    ${isAdmin() ? `
      <div class="status-panel">
        <div class="status-panel-main">
          <div>
            <div class="section-title status-title">在籍ステータス</div>
            <div class="status-controls">
              <select id="traineeStatus" class="status-select">
                <option value="active" ${getTraineeStatus(t) === 'active' ? 'selected' : ''}>稼働中</option>
                <option value="graduated" ${getTraineeStatus(t) === 'graduated' ? 'selected' : ''}>卒業</option>
                <option value="withdrawn" ${getTraineeStatus(t) === 'withdrawn' ? 'selected' : ''}>辞退・退学</option>
                <option value="inactive" ${getTraineeStatus(t) === 'inactive' ? 'selected' : ''}>停止</option>
              </select>
              <input id="statusDate" type="date" class="status-date" value="${escapeHtml(t.graduated_at || '')}">
              <input id="archiveNote" type="text" class="status-note" placeholder="メモ 例: 2026年6月修了" value="${escapeHtml(t.archive_note || '')}">
              <button type="button" class="btn btn-secondary btn-sm" onclick="saveTraineeStatus('${t.id}')">保存</button>
            </div>
            <div class="status-help">通常の一覧・ログインカード出力は「稼働中」のみを対象にします。卒業・辞退・停止はアーカイブで確認できます。</div>
          </div>
          <span id="statusSaveMsg" class="status-save-msg"></span>
        </div>
      </div>
    ` : ''}

    ${renderTerminologyDetailCard(terminologySummary || buildTerminologySummary([], [], [], [], []), t)}

    <div class="section-title" style="margin-top:24px;display:flex;align-items:center;gap:8px">
      📝 備考・メモ
      <span id="notesStatus" style="font-size:12px;font-weight:400;color:#888"></span>
    </div>
    <div style="margin-bottom:20px">
      <textarea id="traineeNotes"
        placeholder="この実習生に関するメモ・備考を入力できます（フォーカスを外すと自動保存）"
        style="width:100%;min-height:120px;padding:10px 12px;border:1px solid #d0d6dd;border-radius:8px;font-family:inherit;font-size:14px;line-height:1.7;resize:vertical;background:#fff;box-sizing:border-box"></textarea>
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

  // 備考欄のセットアップ（XSS回避のため innerHTML ではなく value で値投入）
  const notesEl = document.getElementById('traineeNotes');
  if (notesEl) {
    notesEl.value = t.notes || '';
    let lastSaved = notesEl.value;
    notesEl.addEventListener('blur', async () => {
      if (notesEl.value === lastSaved) return; // 変更なしならスキップ
      await saveTraineeNotes(t.id, notesEl, lastSaved);
      lastSaved = notesEl.value;
    });
  }
}

async function saveTraineeStatus(traineeId) {
  const statusEl = document.getElementById('traineeStatus');
  const dateEl = document.getElementById('statusDate');
  const noteEl = document.getElementById('archiveNote');
  const msgEl = document.getElementById('statusSaveMsg');
  if (!statusEl) return;

  const status = statusEl.value || 'active';
  const payload = {
    status,
    graduated_at: status === 'active' ? null : (dateEl?.value || new Date().toISOString().slice(0, 10)),
    archive_note: status === 'active' ? null : (noteEl?.value?.trim() || null),
  };

  if (msgEl) {
    msgEl.textContent = '保存中...';
    msgEl.style.color = '#888';
  }

  const { error } = await supabase
    .from('trainees')
    .update(payload)
    .eq('id', traineeId);

  if (error) {
    if (msgEl) {
      msgEl.textContent = '保存失敗: DB列の追加が必要です';
      msgEl.style.color = '#c0392b';
    }
    console.error('status update failed:', error);
    return;
  }

  if (msgEl) {
    msgEl.textContent = '保存しました';
    msgEl.style.color = '#27ae60';
  }
  setTimeout(() => location.reload(), 600);
}

// 一覧画面のインライン備考保存
const _inlineNotesLastSaved = new WeakMap();
async function saveInlineNotes(textarea) {
  const traineeId = textarea.dataset.id;
  if (!traineeId) return;
  const value = textarea.value;
  const last = _inlineNotesLastSaved.get(textarea);
  // 初回（last 未設定）は元の値と比較
  const baseline = (last !== undefined) ? last : textarea.defaultValue;
  if (value === baseline) return; // 変更なし
  // 保存中: 黄色枠
  const origBorder = textarea.style.borderColor;
  textarea.style.borderColor = '#f1c40f';
  const { error } = await supabase
    .from('trainees')
    .update({ notes: value || null })
    .eq('id', traineeId);
  if (error) {
    textarea.style.borderColor = '#c0392b';
    textarea.title = '保存失敗: ' + error.message;
    return;
  }
  // 成功: 緑枠 → 一定時間後に元に戻す
  textarea.style.borderColor = '#27ae60';
  textarea.title = '✓ 保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
  _inlineNotesLastSaved.set(textarea, value);
  // allTrainees にも反映（再描画時に消えないように）
  const t = (typeof allTrainees !== 'undefined') ? allTrainees.find(x => x.id === traineeId) : null;
  if (t) t.notes = value || null;
  setTimeout(() => {
    textarea.style.borderColor = origBorder || '#d0d6dd';
  }, 1500);
}

async function saveTraineeNotes(traineeId, textarea, prevValue) {
  const status = document.getElementById('notesStatus');
  const value = textarea.value;
  if (status) {
    status.textContent = '保存中...';
    status.style.color = '#888';
  }
  const { error } = await supabase
    .from('trainees')
    .update({ notes: value || null })
    .eq('id', traineeId);
  if (!status) return;
  if (error) {
    status.textContent = '✗ 保存失敗: ' + error.message;
    status.style.color = '#c0392b';
    // 失敗したら前の値に戻すか問い合わせる選択肢もあるが、まずは表示のみ
  } else {
    status.textContent = '✓ 保存しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
    status.style.color = '#27ae60';
  }
}

// ===== 教育報告書 =====
// みん日カリキュラム: 全50課を8回テストでカバー
const MONTH_TEST_MAP_MINNA = [
  { month: 1, test: 'test1', testLabel: '第1-4課',   scope: 'みんなの日本語4課まで' },
  { month: 2, test: 'test2', testLabel: '第5-11課',  scope: 'みんなの日本語11課まで' },
  { month: 3, test: 'test3', testLabel: '第12-18課', scope: 'みんなの日本語18課まで' },
  { month: 4, test: 'test4', testLabel: '第19-25課', scope: 'みんなの日本語25課まで' },
  { month: 5, test: 'test5', testLabel: '第26-33課', scope: 'みんなの日本語33課まで' },
  { month: 6, test: 'test6', testLabel: '第34-40課', scope: 'みんなの日本語40課まで' },
  { month: 7, test: 'test7', testLabel: '第41-45課', scope: 'みんなの日本語45課まで' },
  { month: 8, test: 'test8', testLabel: '第46-50課', scope: 'みんなの日本語50課まで' },
];

// まるごとカリキュラム: 全18課を4回テストでカバー（5-8ヶ月目はテストなし）
const MONTH_TEST_MAP_MARUGOTO = [
  { month: 1, test: 'marugoto_1', testLabel: 'L1-L5',   scope: 'まるごと5課まで' },
  { month: 2, test: 'marugoto_2', testLabel: 'L6-L10',  scope: 'まるごと10課まで' },
  { month: 3, test: 'marugoto_3', testLabel: 'L11-L14', scope: 'まるごと14課まで' },
  { month: 4, test: 'marugoto_4', testLabel: 'L15-L18', scope: 'まるごと18課まで' },
];

const oneMonthDelayedTests = Object.fromEntries(
  MONTH_TEST_MAP_MINNA.map(m => [m.test, m.month + 1])
);

const TRAINEE_TEST_MONTH_OVERRIDES = {
  BRN014: oneMonthDelayedTests,
  BRN015: oneMonthDelayedTests,
  BRN021: { test2: 1 },
};

function getTestMonthOverrides() {
  const sid = _reportTrainee?.student_id;
  return sid ? (TRAINEE_TEST_MONTH_OVERRIDES[sid] || null) : null;
}

function applyTestMonthOverrides(map) {
  const overrides = getTestMonthOverrides();
  if (!overrides || !map) return map;

  const overrideTest = Object.keys(overrides).find(test => overrides[test] === map.month);
  if (overrideTest) {
    const source = MONTH_TEST_MAP_MINNA.find(m => m.test === overrideTest);
    return source ? { ...source, month: map.month, shiftedFromMonth: source.month } : map;
  }

  if (map.test && overrides[map.test] && overrides[map.test] !== map.month) {
    return { month: map.month, test: null, testLabel: '-', scope: '未受験' };
  }

  return map;
}

function getMonthTestMap(curriculum) {
  return curriculum === 'marugoto' ? MONTH_TEST_MAP_MARUGOTO : MONTH_TEST_MAP_MINNA;
}

// まるごと受講者かどうか:
// - test_results に marugoto_N の結果がある、または
// - trainee.curriculum === 'marugoto'
function isMarugotoTrainee() {
  if (_reportTrainee && _reportTrainee.curriculum === 'marugoto') return true;
  if (Array.isArray(_reportResults)) {
    return MONTH_TEST_MAP_MARUGOTO.some(m =>
      _reportResults.some(r => matchTest(r, m))
    );
  }
  return false;
}

// まるごとオフセット:
// - 純粋まるごと（minna 結果なし）: 0
// - 既に minna でN月分受験済 → まるごとに切替: N（marugoto_1 = 月N+1）
function getMarugotoOffset() {
  if (!isMarugotoTrainee()) return 0;
  if (!Array.isArray(_reportResults)) return 0;
  let maxMinnaMonth = 0;
  for (const m of MONTH_TEST_MAP_MINNA) {
    if (_reportResults.some(r => matchTest(r, m))) {
      maxMinnaMonth = Math.max(maxMinnaMonth, m.month);
    }
  }
  return maxMinnaMonth;
}

// 各月のカリキュラム情報を返す
// - まるごと生 + 月 ≤ offset: minna（既送付の月1レポートを保護）
// - まるごと生 + offset < 月 ≤ offset+4: marugoto_(月-offset)
// - まるごと生 + offset+4 < 月: 卒業（テストなし）
// - みんな生: 月N の minna
function getMonthInfo(monthNum) {
  if (isMarugotoTrainee()) {
    const offset = getMarugotoOffset();
    if (monthNum <= offset) {
      // 切替前のminna月（過去ログ用）
      return applyTestMonthOverrides(MONTH_TEST_MAP_MINNA.find(m => m.month === monthNum));
    }
    const marugotoIdx = monthNum - offset;
    const m = MONTH_TEST_MAP_MARUGOTO.find(x => x.month === marugotoIdx);
    if (m) return { ...m, month: monthNum };
    return { month: monthNum, test: null, testLabel: '-', scope: '（卒業）' };
  }
  return applyTestMonthOverrides(MONTH_TEST_MAP_MINNA.find(m => m.month === monthNum));
}

// 現在の表示用マップを返す（1-8ヶ月分、各月でカリキュラム自動判定）
function currentMonthMap() {
  return MONTH_TEST_MAP_MINNA.map(m => getMonthInfo(m.month));
}

// 成績推移テーブル・グラフ用マップ:
// - まるごと生: marugoto_1〜4 の4回分のみ（minna月や卒業月は除外）
// - みんな生: minna 8回分
function getTrendMap() {
  if (isMarugotoTrainee()) {
    const offset = getMarugotoOffset();
    return MONTH_TEST_MAP_MARUGOTO.map(m => ({
      ...m,
      month: m.month + offset, // 絶対月番号に変換
    }));
  }
  const overrides = getTestMonthOverrides();
  if (overrides) return currentMonthMap().filter(m => m && m.test);
  return MONTH_TEST_MAP_MINNA.slice();
}

// レガシー名（後方互換、curriculum 切替前提のないコードからの直接参照用）
const MONTH_TEST_MAP = MONTH_TEST_MAP_MINNA;

// test_name を検索する（新旧両フォーマット対応）
function matchTest(row, map) {
  if (!row || !map || !map.test) return false;
  return row.test_name === map.test || row.test_name === map.testLabel;
}

function isTomboTrainee(t) {
  return !!(t && String(t.supervising_org || '').includes('トンボ国際交流事業協同組合'));
}

// 会話スコアを DB に保存（報告書画面から呼ばれる）
async function saveConversationScore(value) {
  const map = currentMonthMap().find(m => m.month === _currentMonth);
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
let _reportStatsResults = [];
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
      supabase.from('test_sections').select('test_id,section_type,questions,answer_key,scoring_rules'),
    ]);
    if (tErr) throw tErr;

    // 同グループのテスト結果 → 順位・受験者数 用
    // トンボ国際交流事業協同組合はグループ会社として扱い、組合全体を母集団にする。
    let classResults = [];
    if (isTomboTrainee(trainee)) {
      const { data: orgTrainees } = await supabase
        .from('trainees')
        .select('id')
        .eq('supervising_org', trainee.supervising_org);
      if (orgTrainees && orgTrainees.length > 0) {
        const ids = orgTrainees.map(t => t.id);
        const { data: allResults } = await supabase
          .from('test_results').select('*').in('trainee_id', ids);
        classResults = allResults || [];
      }
    } else if (trainee.company || trainee.class_group) {
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
    // excluded=true（誤受験等）は全レポート計算から除外
    _reportTrainee = trainee;
    _reportResults = (results || []).filter(r => !r.excluded);
    _reportClassResults = (classResults || []).filter(r => !r.excluded);
    _reportAllTestResults = (allTestResults || []).filter(r => !r.excluded);
    _reportStatsResults = isTomboTrainee(trainee) ? _reportClassResults : _reportAllTestResults;
    _reportMonthly = {};
    (monthly || []).forEach(r => { _reportMonthly[r.month] = r; });
    _reportSections = {};
    (sections || []).forEach(s => {
      if (!_reportSections[s.test_id]) _reportSections[s.test_id] = {};
      _reportSections[s.test_id][s.section_type] = { questions: s.questions, answer_key: s.answer_key, scoring_rules: s.scoring_rules };
    });

    // curriculum に応じて月セレクタの選択肢を構築（marugoto は1-4、minna は1-8）
    const monthSelEl = document.getElementById('monthSelect');
    if (monthSelEl) {
      const months = currentMonthMap().map(m => m.month);
      monthSelEl.innerHTML = months.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    // 最新月の自動選択（テスト結果 + レポート記入のどちらか高い方）
    let initMonth = 1;

    // 1. テスト結果から最大月（新旧フォーマット対応、curriculum 別）
    if (_reportResults.length > 0) {
      for (const map of currentMonthMap()) {
        if (_reportResults.some(r => matchTest(r, map))) {
          initMonth = Math.max(initMonth, map.month);
        }
      }
    }

    // 2. 月次レポートから最大月（記入されたフィールドがある月）
    const reportFields = ['week1','week2','week3','week4',
      'learn_good','learn_bad','learn_measure','learn_improve',
      'life_good','life_bad','life_measure','life_improve'];
    Object.values(_reportMonthly || {}).forEach(r => {
      if (!r || !r.month) return;
      const hasContent = reportFields.some(f => {
        const v = (r[f] || '').replace(/<[^>]+>/g, '').trim();
        return v && v !== '※特記事項なし' && v !== '-';
      });
      if (hasContent) initMonth = Math.max(initMonth, r.month);
    });

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
      const jsel = document.getElementById('evalJapanese');
      const jprint = document.getElementById('japanesePrint');
      if (jsel && jprint) jprint.textContent = jsel.value || '-';
      const asel = document.getElementById('evalAttitude');
      const aprint = document.getElementById('attitudePrint');
      if (asel && aprint) aprint.textContent = asel.value;
      const esel = document.getElementById('learnEnv');
      const eprint = document.getElementById('envPrint');
      if (esel && eprint) eprint.textContent = esel.value;
    }
    // 全画像 + フォント + チャートのレンダリング完了を待ってからシグナル
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const allImages = Array.from(document.images || []);
    await Promise.all(allImages.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 3000);
      });
    }));
    // 日本語フォント（Noto Sans JP / Inter）の読込完了を待機
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) {}
    }
    // さらに 1 フレーム待ってレイアウト確定
    await new Promise(r => requestAnimationFrame(r));
    window._reportReady = true;
  } catch (err) {
    document.getElementById('reportPage').innerHTML =
      '<p style="color:red;padding:20px">読み込みに失敗しました: ' + err.message + '</p>';
    window._reportReady = true; // エラー時もシグナル（タイムアウト回避）
  }
}

function switchMonth(month) {
  _currentMonth = month;
  const map = currentMonthMap().find(m => m.month === month);
  if (!map) return;

  // 試験範囲ラベル更新
  document.getElementById('scopeLabel').textContent = map.scope;

  // 該当月のテスト結果を表示
  const result = _reportResults.find(r => matchTest(r, map));
  renderMonthScores(result);
  renderDiagnosis(document.getElementById('diagnosisArea'), _reportResults);

  // 該当月のコメントを表示
  renderMonthComments(_reportMonthly[month]);

  // PDF/印刷ファイル名用 document.title を月変更に追従
  const kata = (document.getElementById('rNameKata') || {}).textContent || '';
  if (kata && kata !== '-') {
    document.title = `教育報告書 ${month}ヶ月目 ${kata}`;
  }
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
    // 新旧両フォーマットの test_name を同一視（test2 <-> 第5-11課、marugoto も同様）
    const map = currentMonthMap().find(m => matchTest(result, m));
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
    // 平均・偏差値 用（通常は全実習生、トンボは組合全体）
    const sameTestGlobalRaw = map
      ? _reportStatsResults.filter(r => matchTest(r, map))
      : _reportStatsResults.filter(r => r.test_name === result.test_name);
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
    window._autoJapaneseGrade = grade;
    setJapaneseEval(grade.label);
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
    window._autoJapaneseGrade = null;
    setJapaneseEval('');
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

function escapeCommentText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeCommentHtml(html) {
  if (!html) return '';
  const raw = String(html);
  if (!/(<table|<colgroup|class=["']?xl\d|mso-|&nbsp;)/i.test(raw)) {
    return raw.trim();
  }

  const tmp = document.createElement('div');
  tmp.innerHTML = raw;
  tmp.querySelectorAll('style,script,colgroup').forEach(el => el.remove());
  tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  tmp.querySelectorAll('p,div,tr,td,li').forEach(el => el.appendChild(document.createTextNode('\n')));

  const lines = tmp.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.map(escapeCommentText).join('<br>');
}

function renderMonthComments(report) {
  const fields = ['lifeGood','lifeBad','lifeMeasure','lifeImprove','lifePersonality',
                  'learnGood','learnBad','learnMeasure','learnImprove'];
  const dbFields = ['life_good','life_bad','life_measure','life_improve','life_personality',
                    'learn_good','learn_bad','learn_measure','learn_improve'];

  fields.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = normalizeCommentHtml((report && report[dbFields[i]]) || '');
  });

  // 人物像・交友関係は前月の内容を引き継ぐ（追記前提のフィールド）
  // 当月が空の場合、直近の過去月の内容で初期化
  const personalityEl = document.getElementById('lifePersonality');
  if (personalityEl) {
    const currentValue = (report && report.life_personality) || '';
    const stripped = currentValue.replace(/<[^>]+>/g, '').trim();
    if (!stripped && _currentMonth > 1) {
      for (let m = _currentMonth - 1; m >= 1; m--) {
        const prev = _reportMonthly[m];
        const prevValue = (prev && prev.life_personality) || '';
        const prevStripped = prevValue.replace(/<[^>]+>/g, '').trim();
        if (prevStripped) {
          personalityEl.innerHTML = normalizeCommentHtml(prevValue);
          // 引き継ぎマーカー（保存時には消える、表示時の目印）
          personalityEl.dataset.inheritedFrom = m;
          break;
        }
      }
    } else {
      delete personalityEl.dataset.inheritedFrom;
    }
  }

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

  // 日本語評価（未保存なら得点からの自動判定を使う）
  const autoJapanese = (window._autoJapaneseGrade && window._autoJapaneseGrade.label) || '';
  const savedJapanese = normalizeJapaneseEval((report && report.japanese_eval) || '');
  setJapaneseEval(savedJapanese || autoJapanese);

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

function normalizeSpreadsheetPasteText(text) {
  let value = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!value) return '';

  const rows = value.split('\n');
  const parsedRows = rows.map(row => {
    const cells = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      const next = row[i + 1];
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === '\t' && !inQuotes) {
        cells.push(cell);
        cell = '';
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    return cells;
  });

  return parsedRows
    .map(cells => cells.map(cell => {
      let c = cell.trim();
      if (c.length >= 2 && c.startsWith('"') && c.endsWith('"')) {
        c = c.slice(1, -1).replace(/""/g, '"');
      }
      return c;
    }).filter(Boolean).join('\n'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function insertPlainTextIntoEditable(target, text) {
  const normalized = normalizeSpreadsheetPasteText(text);
  if (!normalized) return;
  const html = normalized.split('\n').map(line => escapeHtml(line)).join('<br>');
  if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
    document.execCommand('insertHTML', false, html);
  } else if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
    document.execCommand('insertText', false, normalized);
  } else {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(normalized));
      range.collapse(false);
    } else {
      target.textContent += normalized;
    }
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function normalizeEditableHtml(html) {
  return String(html || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/(?:\s|<br\s*\/?>|<div>\s*(?:<br\s*\/?>)?\s*<\/div>|<p>\s*(?:<br\s*\/?>)?\s*<\/p>)+$/gi, '')
    .trim();
}

function isSessionExpiredError(error) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''} ${error?.code || ''}`.toLowerCase();
  return text.includes('session_expired')
    || text.includes('row-level security')
    || text.includes('violates row-level security')
    || text.includes('policy')
    || text.includes('jwt')
    || text.includes('auth')
    || text.includes('42501')
    || text.includes('401')
    || text.includes('403');
}

function getSaveErrorMessage(error) {
  if (isSessionExpiredError(error)) {
    return 'ログインの有効期限が切れている可能性があります。再ログインしてから保存してください。';
  }
  return error?.message || '保存に失敗しました。';
}

async function copyWeeklyActivitiesFromStudent() {
  if (!_reportTrainee) return;

  const sourceStudentId = prompt('コピー元の学生IDを入力してください（例: BRN008）');
  if (!sourceStudentId) return;

  const defaultMonth = String(_currentMonth || 1);
  const monthText = prompt('コピー元の月を入力してください（例: 2）', defaultMonth);
  if (!monthText) return;
  const month = parseInt(String(monthText).replace(/[^\d]/g, ''), 10);
  if (!month || month < 1 || month > 8) {
    alert('月は1〜8の数字で入力してください。');
    return;
  }

  const currentWeeks = [1, 2, 3, 4].map(n => {
    const row = document.getElementById('week' + n);
    const el = row ? row.querySelector('.comment-text') : null;
    return el ? el.textContent.trim() : '';
  }).filter(Boolean);
  if (currentWeeks.length > 0 && !confirm('現在の週別活動を上書きします。よろしいですか？')) {
    return;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('SESSION_EXPIRED');

    const { data: trainee, error: traineeError } = await supabase
      .from('trainees')
      .select('id,student_id,name_katakana')
      .eq('student_id', sourceStudentId.trim().toUpperCase())
      .maybeSingle();
    if (traineeError) throw traineeError;
    if (!trainee) {
      alert('コピー元の学生IDが見つかりません。');
      return;
    }

    const { data: report, error: reportError } = await supabase
      .from('monthly_reports')
      .select('week1,week2,week3,week4')
      .eq('trainee_id', trainee.id)
      .eq('month', month)
      .maybeSingle();
    if (reportError) throw reportError;
    if (!report || ![report.week1, report.week2, report.week3, report.week4].some(Boolean)) {
      alert('コピー元の週別活動が見つかりません。');
      return;
    }

    [1, 2, 3, 4].forEach(n => {
      const row = document.getElementById('week' + n);
      const el = row ? row.querySelector('.comment-text') : null;
      if (el) el.innerHTML = normalizeEditableHtml(report['week' + n] || '');
    });
    alert(`${trainee.student_id} ${month}ヶ月目の週別活動をコピーしました。保存ボタンで確定してください。`);
  } catch (err) {
    alert('週別活動のコピーに失敗しました: ' + getSaveErrorMessage(err));
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
    return text ? normalizeEditableHtml(normalizeCommentHtml(el.innerHTML)) : '※特記事項なし';
  };
  const getWeek = (n) => {
    const row = document.getElementById('week' + n);
    if (!row) return '';
    const t = row.querySelector('.comment-text');
    return t ? normalizeEditableHtml(t.innerHTML) : '';
  };

  const data = {
    trainee_id: _reportTrainee.id,
    month: _currentMonth,
    japanese_eval: getJapaneseOverrideValue(),
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('SESSION_EXPIRED');
    }

    let japaneseEvalSkipped = false;
    const { error } = await supabase.from('monthly_reports').upsert(data, {
      onConflict: 'trainee_id,month',
    });
    if (error) {
      // DB migration 未適用でも他の保存を止めない。
      // monthly_reports.japanese_eval 追加後は通常の保存で自動的に保持される。
      if (error.code === 'PGRST204' || String(error.message || '').includes('japanese_eval')) {
        const fallbackData = { ...data };
        delete fallbackData.japanese_eval;
        const { error: fallbackError } = await supabase.from('monthly_reports').upsert(fallbackData, {
          onConflict: 'trainee_id,month',
        });
        if (fallbackError) throw fallbackError;
        japaneseEvalSkipped = data.japanese_eval !== null;
      } else {
        throw error;
      }
    }

    // ローカルキャッシュ更新
    _reportMonthly[_currentMonth] = { ..._reportMonthly[_currentMonth], ...data };

    status.textContent = japaneseEvalSkipped
      ? '✓ 保存しました（日本語評価の上書きはDB列追加後に保存できます）'
      : '✓ 保存しました';
    status.style.color = japaneseEvalSkipped ? '#d97706' : '#16a34a';
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (err) {
    status.textContent = '✗ 保存失敗: ' + getSaveErrorMessage(err);
    status.style.color = '#dc2626';
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

function renderReport(t, results, classResults) {
  // 基本情報（会社名から「株式会社」を除去）
  const reportLogo = document.getElementById('reportLogo');
  if (reportLogo) {
    const isWorldBusiness = (t.supervising_org || '').includes('ワールドビジネス');
    reportLogo.src = isWorldBusiness ? 'world_business_logo.png' : 'logo.png';
    reportLogo.alt = isWorldBusiness ? 'WORLD BUSINESS COOPERATIVE' : 'GROP VIETNAM';
    reportLogo.classList.toggle('report-logo-worldbusiness', isWorldBusiness);
  }
  const reportMastMeta = document.getElementById('reportMastMeta');
  if (reportMastMeta) {
    reportMastMeta.hidden = (t.supervising_org || '').includes('ワールドビジネス');
  }

  const cleanCompany = (t.company || '').replace(/株式会社/g, '').replace(/\s+/g, ' ').trim();
  const companyText = [cleanCompany, t.class_group].filter(Boolean).join(' ').trim() || '-';
  document.getElementById('rCompany').textContent = companyText;
  // カタカナ名の区切り（半角・全角スペース）を中黒「・」に統一
  const kataDisplay = (t.name_katakana || '').replace(/[\s\u3000]+/g, '・').trim() || '-';
  document.getElementById('rNameKata').textContent = kataDisplay;
  document.getElementById('rNameRomaji').textContent = t.name_romaji || '-';
  // PDF/印刷時のデフォルトファイル名は document.title から取られる
  // 「教育報告書 〇ヶ月目 名前カタカナ」形式に
  if (kataDisplay && kataDisplay !== '-') {
    document.title = `教育報告書 ${_currentMonth}ヶ月目 ${kataDisplay}`;
  }
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

  // 成績推移テーブル + グラフ（curriculum 別の全回分表示）
  // 第1回未受験の場合はセクション全体を非表示
  // まるごと生は marugoto_1〜4 のみ（minna月・卒業月を含めない）
  const _trendMap = getTrendMap();
  const _firstMap = _trendMap[0];
  const hasTest1 = (results || []).some(r => matchTest(r, _firstMap));
  const trendSection = document.getElementById('trendSection');
  if (trendSection) trendSection.style.display = hasTest1 ? '' : 'none';
  // 改ページ制御用のbodyクラス
  document.body.classList.toggle('no-trend', !hasTest1);
  if (hasTest1) {
    const tbody = document.getElementById('trendBody');
    tbody.innerHTML = _trendMap.map(m => {
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

  // 各カリキュラムの全回分のラベルを固定（まるごと生は4回分のみ）
  const _map = getTrendMap();
  const labels = _map.map(m => m.testLabel);
  const resolved = _map.map(m => results.find(r => matchTest(r, m)) || null);

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

function getJapaneseDesc(grade) {
  const map = {
    '秀': '最高ランクの成績です',
    '優': '優秀な成績です',
    '良': '良好な成績です',
    '可': '合格水準の成績です',
    '不可': '更なる努力が必要です',
  };
  return map[grade] || '-';
}

function setJapaneseEval(value) {
  const val = value || '';
  const sel = document.getElementById('evalJapanese');
  const print = document.getElementById('japanesePrint');
  const desc = document.getElementById('evalJapaneseDesc');
  if (sel) {
    if ('value' in sel) sel.value = val;
    else sel.textContent = val || '-';
  }
  if (print) print.textContent = val || '-';
  if (desc) desc.textContent = val ? getJapaneseDesc(val) : '-';
}

function normalizeJapaneseEval(value) {
  const val = String(value || '').trim();
  return ['秀', '優', '良', '可', '不可'].includes(val) ? val : '';
}

function getJapaneseOverrideValue() {
  const sel = document.getElementById('evalJapanese');
  const selected = normalizeJapaneseEval(sel ? (('value' in sel) ? sel.value : sel.textContent) : '');
  const auto = (window._autoJapaneseGrade && window._autoJapaneseGrade.label) || '';
  return selected && selected !== auto ? selected : null;
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
  },
  test3: {
    g1:'絵と言葉のマッチ', g2:'絵に合う語彙', g3:'絵の言葉を書く', g4:'反対語', g5:'語彙選択', g6:'カテゴリー分類', g7:'和訳（日→ベトナム語）',
    b1:'空欄補充', b2:'正しい語句の選択', b3:'文並び替え', b4:'空欄補充（文作成）', b5_ox:'読解の正誤判定', b5_written:'読解の記述回答', b6:'過去形', b7:'質問への回答',
    c1:'買い物場面の聞き取り', c2:'目的の聞き取り', c3:'行動の聞き取り', c4:'パーティ場面の聞き取り', c5:'必要事項の聞き取り', c6:'選択式聞き取り',
    c7:'可能表現の聞き取り', c8:'現在の動作の聞き取り', c9:'応答選択', c10:'○×判定', c11:'質問応答'
  }
};

function _diagStripHtml(s) {
  return String(s || '')
    .replace(/<ruby>(.*?)<rt>.*?<\/rt><\/ruby>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _diagSectionLabel(testName, sid, sectionData) {
  const fixed = SECTION_LABELS[testName]?.[sid];
  if (fixed) return fixed;
  const baseSid = sid.replace(/_(ox|written)$/, '');
  const q = (sectionData?.questions || []).find(x => x?.id === sid || x?.id === baseSid);
  const title = _diagStripHtml(q?.title_html || q?.title);
  if (!title) return sid;
  return title.replace(/^問題\s*\d+[．.、]?\s*/, '').replace(/＜.*$/, '').trim() || sid;
}

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

function buildStableDiagnosisSummary(strongestSubject, weakestSubject, avgRate, seedHint = '') {
  if (!strongestSubject || !weakestSubject) {
    return '全体的には安定した理解度を保ち、学習進度は良好。';
  }

  const strong = strongestSubject.name;
  const weak = weakestSubject.name;
  const gap = Math.max(0, strongestSubject.rate - weakestSubject.rate);
  const seedText = `${seedHint}:${strong}:${weak}:${Math.round(avgRate * 100)}`;
  const seed = Array.from(seedText).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const highVariants = [
    `全体的に正答率が高く、学習内容はよく定着している。今後は${weak}の細かな取りこぼしを減らしたい。`,
    `${strong}をはじめ、各分野で高い理解が見られる。${weak}を確認しておくと、さらに安定した結果につながる。`,
    `基礎は十分に身についており、解答も安定している。次回は${weak}の精度をさらに高めたい。`,
    `大きな弱点は見られず、学習は順調に進んでいる。${weak}は確認問題で定着を維持したい。`,
  ];
  const variants = avgRate >= 0.9
    ? highVariants
    : gap < 0.12
    ? [
        `各分野で大きな偏りはなく、全体として落ち着いた結果である。${weak}は短い復習を重ねたい。`,
        `理解のばらつきは小さく、学習内容は概ね整理できている。${weak}を確認すると得点がさらに安定する。`,
        `${strong}だけに偏らず、全体的に基礎は身についている。今後は${weak}の小さなミスを減らしたい。`,
        `大きく苦手な分野は見られない。次回に向けて、${weak}の問題形式に慣れておくとよい。`,
        `正答の傾向は安定している。${weak}をもう一度確認し、解答の確実さを高めたい。`,
      ]
    : [
        `${strong}は得点につながっている。${weak}は復習の優先度を上げ、苦手な形式を確認したい。`,
        `${strong}で取れている分、${weak}の取りこぼしが全体の課題として残っている。`,
        `理解できている部分は多いが、${weak}ではまだ正答に結びつかない問題がある。`,
        `${strong}の定着は良好である。今後は${weak}を重点的に確認し、分野間の差を小さくしたい。`,
        `${weak}に課題はあるものの、${strong}では学習の成果が出ている。復習の焦点を絞れば改善が見込める。`,
        `全体としては良好な結果である。さらに伸ばすには、${weak}で迷いやすい問題を整理する必要がある。`,
        `${strong}は比較的安定している。${weak}は例題を使って確認し、解答の精度を上げたい。`,
      ];

  return variants[seed % variants.length];
}

// まるごとテスト用のセクションラベル（block prefix → 表示名）
const MARUGOTO_LABELS = {
  marugoto_1: {
    v1: 'ひらがな単語の意味', v2: 'カタカナ単語の意味',
    v3a: '漢字の読み方', v3b: '漢字の意味',
    v4: 'ベトナム語→日本語訳', v5: '絵と言葉のマッチ',
    g1: '助詞の使い方', g2: 'です/ます活用',
    g3: '文の並び替え', g4: '文型・対話の理解',
    l1: 'あいさつ・場面', l2: '教室の会話',
    l3: '自己紹介・国・仕事', l4: '家族', l5: '好きなもの・食事',
  },
  // marugoto_2/3/4 は今後追加
};

// まるごとテストのセクション別正答率診断
// answers_json は {qid: {selected, correct, points}} 形式（クライアント側で採点済み）
function generateMarugotoSectionDiagnosis(answers, testName) {
  if (!answers) return null;
  const labels = MARUGOTO_LABELS[testName];
  if (!labels) return null;

  // qid prefix（v1, v3a, g1, l2 等）でグループ化
  const groups = {};
  for (const qid in answers) {
    const a = answers[qid];
    if (!a || typeof a !== 'object') continue;
    const m = /^([vgl]\d+[a-z]?)/i.exec(qid);
    if (!m) continue;
    const prefix = m[1];
    if (!groups[prefix]) groups[prefix] = { correct: 0, total: 0 };
    groups[prefix].total++;
    if (a.correct === true) groups[prefix].correct++;
  }

  // セクションタイプ別（v→goii, g→bunpo, l→chokkai）にまとめ
  const bySecType = { goii: [], bunpo: [], chokkai: [] };
  // 並び順を固定（labels の順番）
  const orderedKeys = Object.keys(labels);
  for (const prefix of orderedKeys) {
    if (!groups[prefix]) continue;
    const stype = prefix.startsWith('v') ? 'goii'
                : prefix.startsWith('g') ? 'bunpo'
                : prefix.startsWith('l') ? 'chokkai'
                : null;
    if (!stype) continue;
    const { correct, total } = groups[prefix];
    if (total === 0) continue;
    bySecType[stype].push({
      sid: prefix,
      label: labels[prefix] || prefix,
      correct, total,
      rate: correct / total,
    });
  }
  // 空のセクションは削除
  for (const k in bySecType) {
    if (bySecType[k].length === 0) delete bySecType[k];
  }
  return Object.keys(bySecType).length ? bySecType : null;
}

// セクション別の正答率ベース診断
function generateSectionDiagnosis(answers, testName) {
  const sections = _reportSections[testName];
  if (!sections) return null;
  const bySecType = {};
  for (const stype in sections) {
    const sectionData = sections[stype];
    const { answer_key, scoring_rules } = sectionData;
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
        let fids = (rule.field_ids || []).slice();
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
        secResults.push({ sid, label: _diagSectionLabel(testName, sid, sectionData), correct, total, rate: correct/total });
      }
    }
    if (secResults.length) bySecType[stype] = secResults;
  }
  return bySecType;
}

function renderDiagnosis(diagArea, results) {
  if (!diagArea) return;

  // 表示中の月に対応する answers_json があるテスト結果を探す
  const currentMap = currentMonthMap().find(m => m.month === _currentMonth);
  const withAnswers = [...results].reverse().find(r =>
    r.answers_json && (!currentMap || matchTest(r, currentMap))
  );
  if (!withAnswers) {
    diagArea.innerHTML = '<span style="color:#aaa">回答データがまだありません。テスト受験後に診断が表示されます。</span>';
    return;
  }

  const answers = typeof withAnswers.answers_json === 'string'
    ? JSON.parse(withAnswers.answers_json)
    : withAnswers.answers_json;

  // test_sections に採点ルールがあるテスト + marugoto_N は セクション別正答率ベースの診断（全体まとめ文章）
  const isMarugoto = /^marugoto_\d+$/.test(withAnswers.test_name);
  const hasSectionRules = !!_reportSections[withAnswers.test_name];
  if (hasSectionRules || isMarugoto) {
    const secDiag = isMarugoto
      ? generateMarugotoSectionDiagnosis(answers, withAnswers.test_name)
      : generateSectionDiagnosis(answers, withAnswers.test_name);
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
      const subjectRates = [
        { key:'goii', name:'語彙', rate: byType.goii.total ? byType.goii.correct / byType.goii.total : null },
        { key:'bunpo', name:'文法', rate: byType.bunpo.total ? byType.bunpo.correct / byType.bunpo.total : null },
        { key:'chokkai', name:'聴解', rate: byType.chokkai.total ? byType.chokkai.correct / byType.chokkai.total : null },
      ].filter(x => x.rate !== null);
      const sortedSubjects = [...subjectRates].sort((a, b) => a.rate - b.rate);
      const weakestSubject = sortedSubjects[0];
      const strongestSubject = sortedSubjects[sortedSubjects.length - 1];
      const weakSubjects = subjectRates.filter(x => x.rate < 0.6);

      // 全体総評（1段落、常体）
      let overall = '';
      if (avgRate >= 0.9) {
        overall = buildStableDiagnosisSummary(
          strongestSubject,
          weakestSubject,
          avgRate,
          withAnswers.trainee_id || withAnswers.id || new URLSearchParams(window.location.search).get('id') || withAnswers.test_date || withAnswers.test_name
        );
      } else if (avgRate >= 0.75) {
        overall = strongestSubject && weakestSubject
          ? buildStableDiagnosisSummary(
              strongestSubject,
              weakestSubject,
              avgRate,
              withAnswers.trainee_id || withAnswers.id || new URLSearchParams(window.location.search).get('id') || withAnswers.test_date || withAnswers.test_name
            )
          : '全体的には安定した理解度を保ち、学習進度は良好。';
      } else if (avgRate >= 0.7) {
        if (weakSubjects.length === 1 && strongestSubject) {
          overall = `${strongestSubject.name}面は比較的安定している一方、${weakSubjects[0].name}の定着にはまだ課題が残る。`;
        } else if (weakSubjects.length >= 2) {
          overall = `${strongestSubject?.name || '得意分野'}では理解が見られるものの、${weakSubjects.map(x => x.name).join('・')}で取りこぼしが目立つ。`;
        } else {
          overall = `全体として合格水準に達しており、${weakestSubject?.name || '苦手分野'}を中心に復習するとさらに安定する。`;
        }
      } else if (avgRate >= 0.6) {
        if (weakSubjects.length === 1 && strongestSubject) {
          overall = avgRate < 0.65
            ? `${weakSubjects[0].name}の取りこぼしが目立ち、${strongestSubject.name}で見られる理解を他分野にも広げる必要がある。`
            : `${strongestSubject.name}には一定の理解が見られる一方、${weakSubjects[0].name}は重点的な復習が必要。`;
        } else if (weakSubjects.length >= 2) {
          overall = `${strongestSubject?.name || '一部分野'}には理解できている項目もあるが、${weakSubjects.map(x => x.name).join('・')}は基礎確認が必要な状況。`;
        } else {
          overall = `全体では大きく崩れていないが、${weakestSubject?.name || '一部分野'}を中心に理解のむらが見られる。`;
        }
      } else {
        overall = weakSubjects.length >= 2
          ? `${weakSubjects.map(x => x.name).join('・')}で正答率が低く、基礎の再確認が必要。`
          : '全体的に正答率が低く、広範囲にわたって基礎の定着が不十分な状況。';
      }

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
      // 全体の出来に応じて表現の強さを段階化（高得点者には辛口にしない）
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
        let weakPhrase;
        if (avgRate >= 0.85) {
          // 高得点者: 軽く・前向きに
          weakPhrase = `で得点が伸び悩んだ部分があり、ここを補強すればさらに伸びる`;
        } else if (avgRate >= 0.6) {
          // 中位: やや課題ありと指摘
          weakPhrase = `ではやや課題が残る`;
        } else {
          // 低位: 明確に弱点指摘
          weakPhrase = `では理解不足が目立つ`;
        }
        narrative += ` 一方で${weakFragments.join('、')}${weakPhrase}。`;
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

// ===========================================================
// 文体チェック (style validator)
// ===========================================================

const STYLE_FIELDS = [
  { id: 'lifeGood',         label: '生活: Good' },
  { id: 'lifeBad',          label: '生活: Bad' },
  { id: 'lifeMeasure',      label: '生活: 対策' },
  { id: 'lifeImprove',      label: '生活: 改善' },
  { id: 'lifePersonality',  label: '人物像・交友関係' },
  { id: 'learnGood',        label: '学習: Good' },
  { id: 'learnBad',         label: '学習: Bad' },
  { id: 'learnMeasure',     label: '学習: 対策' },
  { id: 'learnImprove',     label: '学習: 改善' },
];

function getWeekIds() {
  return [1,2,3,4].map(n => ({ id: 'week' + n, label: '第' + n + '週', isWeek: true }));
}

const FW_DIGITS = '０１２３４５６７８９';
const HW_DIGITS = '0123456789';
const DIGIT_TRANS = (s) => s.split('').map(c => {
  const i = FW_DIGITS.indexOf(c);
  return i >= 0 ? HW_DIGITS[i] : c;
}).join('');

const STYLE_RULES = [
  {
    name: '全角数字',
    detect: text => /[０-９]/.test(text),
    fix: text => DIGIT_TRANS(text),
    desc: '数字は半角に統一',
  },
  {
    name: '課間ハイフン',
    detect: text => /\d+\s*[-－]\s*\d+(?=課)/.test(text),
    fix: text => text.replace(/(\d+)\s*[-－]\s*(\d+)(?=課)/g, '$1～$2'),
    desc: '課番号間は波線「～」に',
  },
  {
    name: 'ですます',
    detect: text => /(です|ます|でした|ました|ません)[。、，,]/.test(text)
                 || /(です|ます)$/.test(text.replace(/<[^>]+>/g, '')),
    fix: null, // 文体は機械修正困難（手動推奨）
    desc: '常体（〜だ／〜である）に',
  },
  {
    name: 'コメント行頭中黒',
    detect: (text, target) => isReportCommentTarget(target) && hasMissingLeadingBullet(text),
    fix: (text, target) => isReportCommentTarget(target) ? addLeadingBulletsToHtml(text) : text,
    desc: '学習状況詳細・生活状況詳細の各行頭に「・」を付ける',
  },
  {
    name: 'コメント文末句点',
    detect: (text, target) => isReportCommentTarget(target) && hasMissingTerminalPeriod(text),
    fix: (text, target) => isReportCommentTarget(target) ? addTerminalPeriodsToHtml(text) : text,
    desc: '学習状況詳細・生活状況詳細の文末に句点「。」を付ける',
  },
];

function isReportCommentTarget(target) {
  return !!target && [
    'learnGood', 'learnBad', 'learnMeasure', 'learnImprove',
    'lifeGood', 'lifeBad', 'lifeMeasure', 'lifeImprove',
  ].includes(target.id);
}

function htmlToStyleLines(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function needsTerminalPeriod(line) {
  const s = String(line || '').trim();
  if (!s || s === '※特記事項なし') return false;
  if (/^[・\s]*$/.test(s)) return false;
  return !/[。！？!?）)]$/.test(s);
}

function needsLeadingBullet(line) {
  const s = String(line || '').trim();
  if (!s || s === '※特記事項なし') return false;
  return !s.startsWith('・');
}

function hasMissingTerminalPeriod(html) {
  return htmlToStyleLines(html).some(needsTerminalPeriod);
}

function hasMissingLeadingBullet(html) {
  return htmlToStyleLines(html).some(needsLeadingBullet);
}

function escapeHtmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function addTerminalPeriodsToHtml(html) {
  const lines = htmlToStyleLines(html);
  if (!lines.length) return html;
  return lines.map(line => {
    const fixed = needsTerminalPeriod(line) ? line + '。' : line;
    return escapeHtmlText(fixed);
  }).join('<br>');
}

function addLeadingBulletsToHtml(html) {
  const lines = htmlToStyleLines(html);
  if (!lines.length) return html;
  return lines.map(line => {
    const fixed = needsLeadingBullet(line) ? '・' + line : line;
    return escapeHtmlText(fixed);
  }).join('<br>');
}

function checkFieldStyle(elId) {
  const el = document.getElementById(elId);
  if (!el) return null;
  // contenteditable の中の HTML
  let html = '';
  if (el.classList.contains('week-row') || el.classList.contains('comment-block')) {
    const t = el.querySelector('.comment-text');
    html = t ? t.innerHTML : '';
  } else {
    html = el.innerHTML;
  }
  // テキストだけのチェック対象
  const text = html;
  const issues = [];
  STYLE_RULES.forEach(rule => {
    if (rule.detect(text, { id: elId })) {
      issues.push({ rule: rule.name, desc: rule.desc, autoFixable: !!rule.fix });
    }
  });
  return { el, html, issues };
}

function getAllStyleTargets() {
  // 通常コメント + 週活動
  const targets = STYLE_FIELDS.map(f => ({ ...f, isWeek: false }));
  for (let n = 1; n <= 4; n++) {
    targets.push({ id: 'week' + n, label: '第' + n + '週', isWeek: true });
  }
  return targets;
}

function getFieldHTML(target) {
  if (target.isWeek) {
    const row = document.getElementById(target.id);
    const t = row ? row.querySelector('.comment-text') : null;
    return t ? t.innerHTML : '';
  }
  const el = document.getElementById(target.id);
  return el ? el.innerHTML : '';
}

function setFieldHTML(target, html) {
  if (target.isWeek) {
    const row = document.getElementById(target.id);
    const t = row ? row.querySelector('.comment-text') : null;
    if (t) t.innerHTML = html;
  } else {
    const el = document.getElementById(target.id);
    if (el) el.innerHTML = html;
  }
}

function runStyleCheck() {
  const targets = getAllStyleTargets();
  const results = [];
  targets.forEach(target => {
    const html = getFieldHTML(target);
    if (!html) return;
    STYLE_RULES.forEach(rule => {
      if (rule.detect(html, target)) {
        results.push({
          target,
          rule: rule.name,
          desc: rule.desc,
          autoFixable: !!rule.fix,
        });
      }
    });
  });

  const summary = document.getElementById('styleCheckSummary');
  const list = document.getElementById('styleCheckList');
  const autoBtn = document.getElementById('styleCheckAutoFix');

  if (results.length === 0) {
    summary.innerHTML = '<span style="color:#3DAE2B;font-weight:600">✅ 規則違反なし</span>';
    list.innerHTML = '';
    autoBtn.style.display = 'none';
  } else {
    const fixable = results.filter(r => r.autoFixable).length;
    summary.innerHTML = `<strong>${results.length}件</strong>の違反が見つかりました。
      ${fixable > 0 ? `<span style="color:#3DAE2B">${fixable}件は自動修正可能</span>。` : ''}`;
    // ルール別グループ化
    const byRule = {};
    results.forEach(r => {
      if (!byRule[r.rule]) byRule[r.rule] = { desc: r.desc, autoFixable: r.autoFixable, fields: [] };
      byRule[r.rule].fields.push(r.target.label);
    });
    list.innerHTML = Object.entries(byRule).map(([rule, info]) => `
      <div style="background:#fff8e1;border:1px solid #fbbf24;border-radius:6px;padding:10px 12px">
        <div style="font-weight:700;color:#92400e;margin-bottom:4px">⚠️ ${rule} <span style="font-weight:400;color:#6b5223;font-size:11px">— ${info.desc}</span></div>
        <div style="color:#6b5223;font-size:12px">該当: ${info.fields.join(' / ')}</div>
        ${info.autoFixable ? '<div style="color:#3DAE2B;font-size:11px;margin-top:4px">⚡ 自動修正可</div>' : '<div style="color:#92400e;font-size:11px;margin-top:4px">手動修正が必要</div>'}
      </div>
    `).join('');
    autoBtn.style.display = fixable > 0 ? '' : 'none';
  }

  // ボタンの色を更新（違反ありなら強調）
  const btn = document.querySelector('.btn-style-check');
  if (btn) {
    btn.classList.toggle('has-issues', results.length > 0);
    btn.textContent = results.length > 0 ? `📐 文体チェック (${results.length})` : '📐 文体チェック';
  }

  document.getElementById('styleCheckModal').style.display = 'flex';
}

function closeStyleCheck() {
  document.getElementById('styleCheckModal').style.display = 'none';
}

function autoFixAllStyle() {
  const targets = getAllStyleTargets();
  let fixCount = 0;
  targets.forEach(target => {
    let html = getFieldHTML(target);
    if (!html) return;
    let changed = false;
    STYLE_RULES.forEach(rule => {
      if (rule.fix && rule.detect(html, target)) {
        const newHtml = rule.fix(html, target);
        if (newHtml !== html) {
          html = newHtml;
          changed = true;
          fixCount++;
        }
      }
    });
    if (changed) setFieldHTML(target, html);
  });
  alert(`${fixCount}箇所を自動修正しました。\n保存ボタンで確定してください。`);
  closeStyleCheck();
  // 残りの違反を再チェック
  setTimeout(() => runStyleCheck(), 100);
}

// ページ読込時に1回チェック（バッジ表示のため）
window.addEventListener('load', () => {
  setTimeout(() => {
    const targets = getAllStyleTargets();
    let count = 0;
    targets.forEach(target => {
      const html = getFieldHTML(target);
      STYLE_RULES.forEach(rule => {
        if (html && rule.detect(html, target)) count++;
      });
    });
    const btn = document.querySelector('.btn-style-check');
    if (btn) {
      btn.classList.toggle('has-issues', count > 0);
      btn.textContent = count > 0 ? `📐 文体チェック (${count})` : '📐 文体チェック';
    }
  }, 1500);
});
