// ===== 認証ヘルパー =====

// 現在のユーザー情報をキャッシュ
let _currentProfile = null;

/**
 * セッション確認。未認証ならlogin.htmlへリダイレクト。
 * @returns {{ session, profile }} session と user_profiles の行
 */
async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }

  // プロファイルをキャッシュから取得 or DB取得
  if (!_currentProfile || _currentProfile.id !== session.user.id) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*, organizations(name, slug)')
      .eq('id', session.user.id)
      .single();

    if (error || !data) {
      console.error('プロファイル取得エラー:', error);
      await supabase.auth.signOut();
      window.location.href = 'login.html';
      return null;
    }
    _currentProfile = data;
  }

  return { session, profile: _currentProfile };
}

/**
 * 現在のプロファイルを返す（checkAuth()後に使用）
 */
function getCurrentProfile() {
  return _currentProfile;
}

/**
 * 管理者かどうか
 */
function isAdmin() {
  return _currentProfile && _currentProfile.role === 'admin';
}

/**
 * ログアウト
 */
async function logout() {
  _currentProfile = null;
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

/**
 * ヘッダーにユーザー情報とログアウトボタンを追加
 */
function setupAuthUI() {
  const nav = document.querySelector('header nav');
  if (!nav || !_currentProfile) return;

  // 既存のauth UIがあれば何もしない
  if (document.getElementById('authInfo')) return;

  const authDiv = document.createElement('div');
  authDiv.id = 'authInfo';
  authDiv.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:12px;';

  const orgName = isAdmin()
    ? '管理者'
    : (_currentProfile.organizations?.name || _currentProfile.display_name || '');

  authDiv.innerHTML = `
    <span class="auth-user-label">${orgName}</span>
    <button onclick="logout()" class="btn btn-sm btn-logout">ログアウト</button>
  `;

  nav.appendChild(authDiv);

  // ヘッダーの下にサブバー「〇〇用管理画面」を表示（送り出し機関のみ）
  if (!isAdmin() && !document.getElementById('orgSubBar')) {
    const subBar = document.createElement('div');
    subBar.id = 'orgSubBar';
    subBar.className = 'org-sub-bar';
    subBar.textContent = orgName + ' 用管理画面';
    document.querySelector('header').after(subBar);
  }
}
