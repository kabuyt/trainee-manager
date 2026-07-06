let progressState = {
  trainees: [],
  progress: [],
  quizResults: [],
  imageResults: [],
  rows: [],
  totalTerms: 0,
  totalQuizSets: 0,
  totalImageSets: 6,
};

function escProgress(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fmtDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function isKinreiTrainee(row) {
  const company = String(row?.company || '').toLowerCase();
  const group = String(row?.class_group || '').toLowerCase();
  return company.includes('キンレイ') || company.includes('kinrei') || group.includes('キンレイ') || group.includes('kinrei');
}

function fillFilter(id, values) {
  const el = document.getElementById(id);
  const current = el.value;
  const first = el.querySelector('option')?.outerHTML || '<option value="">全て</option>';
  el.innerHTML = first;
  values.filter(Boolean).sort().forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
  });
  if ([...el.options].some(opt => opt.value === current)) el.value = current;
}

async function loadProgressData() {
  document.getElementById('loadingMsg').classList.remove('hidden');
  document.getElementById('tableWrap').classList.add('hidden');

  const [traineeRes, progressRes, quizRes] = await Promise.all([
    supabase.from('trainees').select('id,student_id,name_katakana,name_romaji,company,class_group,organizations(name),status').order('student_id', { ascending: true, nullsFirst: false }),
    supabase.from('terminology_progress').select('trainee_id,term_id,status,correct_count,wrong_count,last_studied_at'),
    supabase.from('terminology_quiz_results').select('trainee_id,score_rate,created_at,set_id').like('set_id', 'kinrei%'),
  ]);

  if (traineeRes.error) throw traineeRes.error;
  progressState.trainees = (traineeRes.data || [])
    .filter(t => (t.status || 'active') === 'active')
    .filter(isKinreiTrainee);
  progressState.progress = progressRes.error ? [] : (progressRes.data || []);
  const allQuizResults = quizRes.error ? [] : (quizRes.data || []);
  progressState.quizResults = allQuizResults.filter(item => String(item.set_id || '').startsWith('kinrei-2023'));
  progressState.imageResults = allQuizResults.filter(item => String(item.set_id || '').startsWith('kinrei-image-2023'));
  progressState.totalTerms = window.KINREI_VOCAB?.terms?.length || 297;
  progressState.totalQuizSets = Math.ceil(progressState.totalTerms / 10);

  buildRows();
  fillFilter('filterCompany', [...new Set(progressState.rows.map(row => row.company))]);
  fillFilter('filterClass', [...new Set(progressState.rows.map(row => row.class_group))]);
  fillFilter('filterOrg', [...new Set(progressState.rows.map(row => row.org))]);
  renderRows();
}

function buildRows() {
  const progressByTrainee = {};
  progressState.progress.forEach(item => {
    if (!progressByTrainee[item.trainee_id]) progressByTrainee[item.trainee_id] = [];
    progressByTrainee[item.trainee_id].push(item);
  });
  const quizByTrainee = {};
  progressState.quizResults.forEach(item => {
    if (!quizByTrainee[item.trainee_id]) quizByTrainee[item.trainee_id] = [];
    quizByTrainee[item.trainee_id].push(item);
  });
  const imageByTrainee = {};
  progressState.imageResults.forEach(item => {
    if (!imageByTrainee[item.trainee_id]) imageByTrainee[item.trainee_id] = [];
    imageByTrainee[item.trainee_id].push(item);
  });

  progressState.rows = progressState.trainees.map(t => {
    const prog = progressByTrainee[t.id] || [];
    const learned = prog.filter(p => p.status === 'learned').length;
    const review = prog.filter(p => p.status === 'review').length;
    const lastStudy = prog.map(p => p.last_studied_at).filter(Boolean).sort().pop() || '';
    const quizzes = quizByTrainee[t.id] || [];
    const quizAvg = quizzes.length
      ? Math.round(quizzes.reduce((sum, q) => sum + Number(q.score_rate || 0), 0) / quizzes.length)
      : null;
    const completedSets = new Set(quizzes.map(q => q.set_id).filter(Boolean));
    const imageQuizzes = imageByTrainee[t.id] || [];
    const completedImageSets = new Set(imageQuizzes.map(q => q.set_id).filter(Boolean));
    return {
      id: t.id,
      student_id: t.student_id || '',
      name: t.name_katakana || t.name_romaji || '',
      company: t.company || '',
      class_group: t.class_group || '',
      org: t.organizations?.name || '',
      learned,
      review,
      learnedRate: progressState.totalTerms ? Math.round((learned / progressState.totalTerms) * 100) : 0,
      quizAvg,
      quizCount: quizzes.length,
      quizSetCount: completedSets.size,
      imageQuizCount: imageQuizzes.length,
      imageSetCount: completedImageSets.size,
      lastStudy,
    };
  });
}

function getFilteredRows() {
  const company = document.getElementById('filterCompany').value;
  const cls = document.getElementById('filterClass').value;
  const org = document.getElementById('filterOrg').value;
  const q = document.getElementById('filterSearch').value.trim().toLowerCase();
  return progressState.rows.filter(row => {
    if (company && row.company !== company) return false;
    if (cls && row.class_group !== cls) return false;
    if (org && row.org !== org) return false;
    if (!q) return true;
    return [row.student_id, row.name, row.company, row.class_group].some(v => String(v || '').toLowerCase().includes(q));
  });
}

function renderStats(rows) {
  const learnedAvg = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.learnedRate, 0) / rows.length) : 0;
  const reviewTotal = rows.reduce((sum, row) => sum + row.review, 0);
  const quizRows = rows.filter(row => row.quizAvg !== null);
  const quizAvg = quizRows.length ? Math.round(quizRows.reduce((sum, row) => sum + row.quizAvg, 0) / quizRows.length) : 0;
  document.getElementById('statStudents').textContent = rows.length;
  document.getElementById('statAvgLearned').textContent = `${learnedAvg}%`;
  document.getElementById('statReviewTerms').textContent = reviewTotal;
  document.getElementById('statQuizAvg').textContent = `${quizAvg}%`;
}

function renderRows() {
  const rows = getFilteredRows();
  renderStats(rows);
  document.getElementById('progressRows').innerHTML = rows.map(row => `
    <tr>
      <td><span class="student-id-badge">${escProgress(row.student_id || '-')}</span></td>
      <td>${escProgress(row.name || '-')}</td>
      <td>${escProgress(row.company || '-')}</td>
      <td>${escProgress(row.class_group || '-')}</td>
      <td>
        <div class="meter" title="${row.learnedRate}%"><span style="width:${row.learnedRate}%"></span></div>
        <div class="mini-muted">${row.learnedRate}%</div>
      </td>
      <td>${row.learned} / ${progressState.totalTerms}</td>
      <td>${row.review}</td>
      <td>${row.quizSetCount} / ${progressState.totalQuizSets} <span class="mini-muted">${row.quizCount ? `受験${row.quizCount}回` : ''}</span></td>
      <td>${row.imageSetCount} / ${progressState.totalImageSets} <span class="mini-muted">${row.imageQuizCount ? `受験${row.imageQuizCount}回` : ''}</span></td>
      <td>${row.quizAvg === null ? '-' : `${row.quizAvg}%`}</td>
      <td>${fmtDate(row.lastStudy)}</td>
    </tr>
  `).join('');
  document.getElementById('loadingMsg').classList.add('hidden');
  document.getElementById('tableWrap').classList.remove('hidden');
}

function setupProgressEvents() {
  ['filterCompany', 'filterClass', 'filterOrg'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderRows);
  });
  document.getElementById('filterSearch').addEventListener('input', renderRows);
  document.getElementById('reloadBtn').addEventListener('click', () => {
    loadProgressData().catch(err => {
      document.getElementById('loadingMsg').textContent = `読み込みに失敗しました: ${err.message}`;
    });
  });
}

(async function initProgressPage() {
  const auth = await checkAuth();
  if (!auth) return;
  setupAuthUI();
  setupProgressEvents();
  await loadProgressData();
})();
