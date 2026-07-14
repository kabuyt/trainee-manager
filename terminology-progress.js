let progressState = {
  trainees: [],
  progress: [],
  imageProgress: [],
  quizResults: [],
  finalResults: [],
  finalUnlocks: [],
  studySessions: [],
  rows: [],
  totalTerms: 0,
  totalImages: 0,
  totalQuizSets: 18,
  finalUnlocksReady: true,
};

const FINAL_TEST_SET_ID = 'kinrei-final-2023';

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

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function fmtStudyDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}時間${minutes}分`;
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

  const [traineeRes, progressRes, imageProgressRes, quizRes, sessionRes, finalUnlockRes] = await Promise.all([
    supabase.from('trainees').select('id,student_id,name_katakana,name_romaji,company,class_group,organizations(name),status').order('student_id', { ascending: true, nullsFirst: false }),
    supabase.from('terminology_progress').select('trainee_id,term_id,status,correct_count,wrong_count,last_studied_at'),
    supabase.from('terminology_image_progress').select('trainee_id,image_id,status,last_studied_at'),
    supabase.from('terminology_quiz_results').select('trainee_id,score_rate,created_at,set_id').like('set_id', 'kinrei%'),
    supabase.from('terminology_study_sessions').select('trainee_id,created_at,duration_seconds,last_seen_at'),
    supabase.from('terminology_final_unlocks').select('trainee_id,is_unlocked,unlocked_at,test_set_id').eq('test_set_id', FINAL_TEST_SET_ID),
  ]);

  if (traineeRes.error) throw traineeRes.error;
  progressState.trainees = (traineeRes.data || [])
    .filter(t => (t.status || 'active') === 'active')
    .filter(isKinreiTrainee);
  progressState.progress = progressRes.error ? [] : (progressRes.data || []);
  progressState.imageProgress = imageProgressRes.error ? [] : (imageProgressRes.data || []);
  progressState.studySessions = sessionRes.error ? [] : (sessionRes.data || []);
  progressState.finalUnlocksReady = !finalUnlockRes.error;
  progressState.finalUnlocks = finalUnlockRes.error ? [] : (finalUnlockRes.data || []);
  const allQuizResults = quizRes.error ? [] : (quizRes.data || []);
  progressState.quizResults = allQuizResults.filter(item => String(item.set_id || '').startsWith('kinrei-test-2023'));
  progressState.finalResults = allQuizResults.filter(item => String(item.set_id || '') === FINAL_TEST_SET_ID);
  progressState.totalTerms = window.KINREI_VOCAB?.terms?.length || 297;
  progressState.totalImages = window.KINREI_IMAGE_QUIZ?.items?.length || 60;

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
  const imageProgressByTrainee = {};
  progressState.imageProgress.forEach(item => {
    if (!imageProgressByTrainee[item.trainee_id]) imageProgressByTrainee[item.trainee_id] = [];
    imageProgressByTrainee[item.trainee_id].push(item);
  });
  const quizByTrainee = {};
  progressState.quizResults.forEach(item => {
    if (!quizByTrainee[item.trainee_id]) quizByTrainee[item.trainee_id] = [];
    quizByTrainee[item.trainee_id].push(item);
  });
  const finalByTrainee = {};
  progressState.finalResults.forEach(item => {
    if (!finalByTrainee[item.trainee_id]) finalByTrainee[item.trainee_id] = [];
    finalByTrainee[item.trainee_id].push(item);
  });
  const finalUnlockByTrainee = {};
  progressState.finalUnlocks.forEach(item => {
    finalUnlockByTrainee[item.trainee_id] = item;
  });
  const sessionsByTrainee = {};
  progressState.studySessions.forEach(item => {
    if (!sessionsByTrainee[item.trainee_id]) sessionsByTrainee[item.trainee_id] = [];
    sessionsByTrainee[item.trainee_id].push(item);
  });
  const cutoff7 = daysAgo(7).getTime();
  progressState.rows = progressState.trainees.map(t => {
    const prog = progressByTrainee[t.id] || [];
    const imgProg = imageProgressByTrainee[t.id] || [];
    const learned = prog.filter(p => p.status === 'learned').length;
    const review = prog.filter(p => p.status === 'review').length;
    const imageLearned = imgProg.filter(p => p.status === 'learned').length;
    const imageReview = imgProg.filter(p => p.status === 'review').length;
    const lastStudy = [...prog, ...imgProg].map(p => p.last_studied_at).filter(Boolean).sort().pop() || '';
    const quizzes = quizByTrainee[t.id] || [];
    const quizAvg = quizzes.length
      ? Math.round(quizzes.reduce((sum, q) => sum + Number(q.score_rate || 0), 0) / quizzes.length)
      : null;
    const completedSets = new Set(
      quizzes
        .filter(q => Number(q.score_rate || 0) >= 100)
        .map(q => q.set_id)
        .filter(Boolean)
    );
    const finalResults = (finalByTrainee[t.id] || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const finalLatest = finalResults[0] || null;
    const finalUnlock = finalUnlockByTrainee[t.id] || null;
    const sessions = sessionsByTrainee[t.id] || [];
    const sessions7 = sessions.filter(s => new Date(s.created_at).getTime() >= cutoff7).length;
    const cutoff30 = daysAgo(30).getTime();
    const sessions30 = sessions.filter(s => new Date(s.created_at).getTime() >= cutoff30).length;
    const totalStudySeconds = sessions.reduce((sum, s) => sum + Number(s.duration_seconds || 0), 0);
    const studySeconds30 = sessions
      .filter(s => new Date(s.created_at).getTime() >= cutoff30)
      .reduce((sum, s) => sum + Number(s.duration_seconds || 0), 0);
    const lastAccess = sessions.map(s => s.last_seen_at || s.created_at).filter(Boolean).sort().pop() || '';
    return {
      id: t.id,
      student_id: t.student_id || '',
      name: t.name_katakana || t.name_romaji || '',
      company: t.company || '',
      class_group: t.class_group || '',
      org: t.organizations?.name || '',
      learned,
      review,
      imageLearned,
      imageReview,
      learnedRate: progressState.totalTerms ? Math.round((learned / progressState.totalTerms) * 100) : 0,
      imageLearnedRate: progressState.totalImages ? Math.round((imageLearned / progressState.totalImages) * 100) : 0,
      quizAvg,
      quizCount: quizzes.length,
      quizSetCount: completedSets.size,
      finalUnlocked: Boolean(finalUnlock?.is_unlocked),
      finalUnlockedAt: finalUnlock?.unlocked_at || '',
      finalRate: finalLatest ? Number(finalLatest.score_rate || 0) : null,
      finalCount: finalResults.length,
      totalStudySeconds,
      studySeconds30,
      sessions7,
      sessions30,
      lastAccess,
      lastStudy: [lastStudy, lastAccess].filter(Boolean).sort().pop() || '',
    };
  });
}

function finalUnlockButton(row) {
  if (!progressState.finalUnlocksReady) {
    return '<span class="mini-muted">SQL未設定</span>';
  }
  if (row.finalCount) {
    return `<span class="mini-muted">受験済み</span>`;
  }
  const label = row.finalUnlocked ? '開放中' : '開放する';
  const cls = row.finalUnlocked ? 'unlock-btn unlocked' : 'unlock-btn';
  const next = row.finalUnlocked ? 'false' : 'true';
  const note = row.quizSetCount < progressState.totalQuizSets ? `<span class="mini-muted">小テスト ${row.quizSetCount}/${progressState.totalQuizSets}</span>` : '';
  return `<button type="button" class="${cls}" data-trainee-id="${escProgress(row.id)}" data-unlocked="${next}">${label}</button>${note}`;
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
  const imageAvg = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.imageLearnedRate, 0) / rows.length) : 0;
  const reviewTotal = rows.reduce((sum, row) => sum + row.review + row.imageReview, 0);
  const quizRows = rows.filter(row => row.quizAvg !== null);
  const quizAvg = quizRows.length ? Math.round(quizRows.reduce((sum, row) => sum + row.quizAvg, 0) / quizRows.length) : 0;
  const active7 = rows.filter(row => row.sessions7 > 0).length;
  const totalStudySeconds = rows.reduce((sum, row) => sum + row.totalStudySeconds, 0);
  document.getElementById('statStudents').textContent = rows.length;
  document.getElementById('statAvgLearned').textContent = `${learnedAvg}%`;
  document.getElementById('statAvgImage').textContent = `${imageAvg}%`;
  document.getElementById('statReviewTerms').textContent = reviewTotal;
  document.getElementById('statQuizAvg').textContent = `${quizAvg}%`;
  document.getElementById('statActive7').textContent = active7;
  document.getElementById('statStudyTime').textContent = fmtStudyDuration(totalStudySeconds);
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
      <td>${row.imageLearned} / ${progressState.totalImages} <span class="mini-muted">${row.imageLearnedRate}%</span></td>
      <td>${row.review + row.imageReview} <span class="mini-muted">ことば${row.review} / 画像${row.imageReview}</span></td>
      <td>${row.quizSetCount} / ${progressState.totalQuizSets} <span class="mini-muted">${row.quizCount ? `100%完了・受験${row.quizCount}回` : ''}</span></td>
      <td>${row.quizAvg === null ? '-' : `${row.quizAvg}%`}</td>
      <td>${finalUnlockButton(row)}</td>
      <td>${row.finalRate === null ? '-' : `${row.finalRate}%`} <span class="mini-muted">${row.finalCount ? `受験${row.finalCount}回` : ''}</span></td>
      <td>${fmtStudyDuration(row.totalStudySeconds)} <span class="mini-muted">30日 ${fmtStudyDuration(row.studySeconds30)}</span></td>
      <td>7日 ${row.sessions7}回 <span class="mini-muted">30日 ${row.sessions30}回</span></td>
      <td>${fmtDate(row.lastStudy)}</td>
    </tr>
  `).join('');
  document.getElementById('loadingMsg').classList.add('hidden');
  document.getElementById('tableWrap').classList.remove('hidden');
  document.querySelectorAll('.unlock-btn').forEach(button => {
    button.addEventListener('click', () => setFinalUnlock(button.dataset.traineeId, button.dataset.unlocked === 'true'));
  });
}

async function setFinalUnlock(traineeId, isUnlocked) {
  if (!isAdmin()) {
    alert('総合修了テストの開放は管理者のみ操作できます。');
    return;
  }
  const profile = getCurrentProfile();
  const now = new Date().toISOString();
  const { error } = await supabase.from('terminology_final_unlocks').upsert({
    trainee_id: traineeId,
    test_set_id: FINAL_TEST_SET_ID,
    is_unlocked: isUnlocked,
    unlocked_by: profile?.id || null,
    unlocked_at: isUnlocked ? now : null,
    updated_at: now,
  }, { onConflict: 'trainee_id,test_set_id' });
  if (error) {
    alert(`開放状態の更新に失敗しました: ${error.message}`);
    return;
  }
  await loadProgressData();
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
