#!/usr/bin/env python3
"""
教育報告書 一括 PDF 生成（Playwright + Chrome印刷）

reports-bulk.html の html2canvas ベースが崩れる問題を解決するため、
Playwright で Chrome の印刷PDFを直接生成する。
出力結果はブラウザの「PDFに保存」と完全に同一。

使い方:
  # まず初回だけ Playwright インストール
  pip install playwright
  python -m playwright install chromium

  # 一括生成
  python bulk_pdf.py --kumiai globalway --month 1
  python bulk_pdf.py --kumiai cic --month 2 --company ブラステック
  python bulk_pdf.py --month 1                 # 全組合・全社

  # オプション
  --kumiai SLUG     globalway / cic / worldbusiness / tombow / sanyotech (省略=全組合)
  --month N         教育月 1-8 (省略=1)
  --company NAME    会社名フィルタ（部分一致）
  --output DIR      出力先（既定: ./reports_pdf/）
  --no-zip          ZIP化しない（フォルダ生成のみ）

出力構造:
  reports_pdf/
    教育報告書_<kumiai>_<YYYYMM>_<月>ヶ月目.zip
    <kumiai-slug>/                   ZIP化前の作業フォルダ
      <company>/
        <student_id>_<name_romaji>.pdf
"""
import sys, os, re, argparse, json, time, http.server, socketserver, threading
import urllib.request, urllib.parse, zipfile
from pathlib import Path
from collections import defaultdict

# Windows cp932 でも emoji print できるように UTF-8 化
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# ==== 設定 ====
SUPABASE_URL = 'https://ajmdpkwqyeyzemeoojwd.supabase.co'
SUPABASE_PROJECT_REF = 'ajmdpkwqyeyzemeoojwd'

def _read_env(key):
    v = os.environ.get(key, '')
    if v: return v
    env_file = Path(__file__).parent / '.env.local'
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            if line.startswith(key + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return ''

SERVICE_KEY = _read_env('SUPABASE_SERVICE_KEY')
ANON_KEY = _read_env('SUPABASE_ANON_KEY') or 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbWRwa3dxeWV5emVtZW9vandkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwMzAsImV4cCI6MjA5MDY5ODAzMH0.AfpGFcYvVrS25qTr9RTGWqsvWMKykU2QcXZPtiNxAqY'

if not SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_KEY を環境変数または .env.local に設定してください")
    print("例: SUPABASE_SERVICE_KEY=sb_secret_xxx python bulk_pdf.py ...")
    sys.exit(1)

ADMIN_EMAIL = 'admin@trainee.local'
ADMIN_PASS = os.environ.get('TRAINEE_ADMIN_PASS', '123456')

def get_admin_session():
    """admin としてログインしてセッションオブジェクトを取得"""
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    body = json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PASS}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
    })
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except Exception as e:
        print(f"管理者ログイン失敗: {e}")
        sys.exit(1)

BASE_DIR = Path(__file__).parent
DEFAULT_OUTPUT = BASE_DIR / 'reports_pdf'

KUMIAI_NAME_FROM_SLUG = {
    'globalway': 'グローバルウェイ協同組合',
    'cic': 'CIC協同組合',
    'worldbusiness': 'ワールドビジネス協同組合',
    'akane': 'AKANE',
    'tombow': 'トンボ国際交流事業協同組合',
    'tombo': 'トンボ国際交流事業協同組合',
    'sanyotech': '山陽テクノ協同組合',
}

def safe_filename(s):
    return re.sub(r'[\\/:*?"<>|]', '_', (s or '').strip()) or 'unknown'

def company_with_class(t):
    """会社名 + 期生 を結合した表示名（例: ロイヤルデリカ 11期生）
    会社名から「株式会社」を除去、空白を整理。"""
    company = (t.get('company') or '(未設定)').replace('株式会社', '').strip()
    company = re.sub(r'\s+', ' ', company)
    cg = (t.get('class_group') or '').strip()
    return f'{company} {cg}'.strip() if cg else company

def generate_site_index(work_dir, kumiai_name, kumiai_slug, ymd, company_groups, password=None):
    """brastech-reports と同形式の静的サイト index.html を生成
    company_groups: list of dicts {name, month, files: [{name_kata, name_romaji, pdf_filename}], slug}
    """
    # 全ファイルパス（ZIP一括DL用）
    all_files = []
    total_count = 0
    for cg in company_groups:
        for f in cg['files']:
            all_files.append(f"{cg['slug']}/{f['pdf_filename']}")
            total_count += 1
    files_json = json.dumps(all_files, ensure_ascii=False)
    zip_name = f"教育報告書_{kumiai_slug}_{ymd}.zip"

    pw_hash_block = ''
    if password:
        import hashlib
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        pw_hash_block = f"const PASS_HASH = '{pw_hash}';"

    # 会社別セクション
    sections_html = ''
    for cg in company_groups:
        sec = f'<div class="section"><div class="section-title">{cg["name"]} <span class="section-month">{cg["month"]}ヶ月目</span></div>'
        sec += f'<div class="company-actions"><button class="btn-company-dl" data-slug="{cg["slug"]}">📥 {cg["name"]} を一括DL (ZIP)</button></div>'
        sec += '<div class="student-list">'
        for i, f in enumerate(cg['files']):
            href = f'{cg["slug"]}/{urllib.parse.quote(f["pdf_filename"])}'
            sec += (
                f'<a href="{href}" class="student-item" target="_blank">'
                f'<span class="student-num">{i+1}</span>'
                f'<span class="student-name">{f["name_kata"]}</span>'
                f'<span class="student-name-en">{f["name_romaji"]}</span>'
                f'<span class="student-dl">開く</span></a>'
            )
        sec += '</div></div>'
        sections_html += sec

    # 会社別ファイルリスト（per company ZIP用）
    company_files_json = {cg['slug']: [f"{cg['slug']}/{f['pdf_filename']}" for f in cg['files']] for cg in company_groups}
    company_files_js = json.dumps(company_files_json, ensure_ascii=False)
    company_zip_names = {cg['slug']: f"教育報告書_{cg['name']}_{cg['month']}ヶ月目.zip" for cg in company_groups}
    company_zip_names_js = json.dumps(company_zip_names, ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>教育報告書ダウンロード - {kumiai_name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js"></script>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Noto Sans JP', sans-serif; background: #edf1f7; color: #1e293b; }}

/* === Password gate === */
.auth-overlay {{
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: #edf1f7; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
}}
.auth-card {{
  background: #fff; border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,.12);
  padding: 48px 40px; text-align: center; max-width: 420px; width: 90%;
}}
.auth-card .auth-logo {{ height: 40px; margin-bottom: 20px; }}
.auth-card h2 {{ font-size: 18px; color: #102547; margin-bottom: 6px; }}
.auth-card .auth-sub {{ font-size: 12px; color: #94a3b8; margin-bottom: 28px; }}
.auth-input-wrap {{ display: flex; gap: 8px; margin-bottom: 12px; }}
.auth-input {{
  flex: 1; padding: 12px 16px;
  border: 2px solid #e2e8f0; border-radius: 8px;
  font-size: 14px; font-family: inherit; outline: none; transition: border-color .2s;
}}
.auth-input:focus {{ border-color: #3DAE2B; }}
.auth-input.error {{ border-color: #ef4444; animation: shake .4s; }}
.auth-submit {{
  padding: 12px 24px; background: #102547; color: white;
  border: none; border-radius: 8px; font-size: 14px;
  font-weight: 600; cursor: pointer; font-family: inherit; transition: background .2s;
}}
.auth-submit:hover {{ background: #1b3460; }}
.auth-error {{ font-size: 12px; color: #ef4444; height: 18px; }}
@keyframes shake {{
  0%, 100% {{ transform: translateX(0); }}
  25% {{ transform: translateX(-6px); }}
  75% {{ transform: translateX(6px); }}
}}
.main-content {{ display: none; }}

.header {{
  background: #102547; padding: 20px 32px;
  display: flex; align-items: center; gap: 16px;
}}
.header img {{ height: 36px; background: #fff; padding: 4px 8px; border-radius: 4px; }}
.header-text {{ color: white; }}
.header-text h1 {{ font-size: 18px; font-weight: 600; }}
.header-text p {{ font-size: 12px; color: #94a3b8; margin-top: 2px; }}

.container {{ max-width: 880px; margin: 0 auto; padding: 32px 20px 60px; }}

/* Hero card */
.hero {{
  background: white; border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,.08);
  padding: 36px 32px; text-align: center; margin-bottom: 28px;
}}
.hero h2 {{ font-size: 20px; color: #102547; margin-bottom: 6px; }}
.hero .sub {{ font-size: 13px; color: #64748b; margin-bottom: 24px; }}
.hero .info {{ display: flex; justify-content: center; gap: 32px; margin-bottom: 24px; }}
.hero .info-item {{ text-align: center; }}
.hero .info-item .num {{ font-size: 28px; font-weight: 700; color: #102547; }}
.hero .info-item .label {{ font-size: 11px; color: #64748b; margin-top: 2px; }}

.btn-dl {{
  display: inline-flex; align-items: center; gap: 8px;
  background: #3DAE2B; color: white; padding: 14px 36px; border-radius: 8px;
  font-size: 16px; font-weight: 600; text-decoration: none;
  border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(61,174,43,.3);
  transition: background .2s; font-family: inherit;
}}
.btn-dl:hover {{ background: #2f8a22; }}
.btn-dl:disabled {{ background: #94a3b8; box-shadow: none; cursor: wait; }}
.btn-dl svg {{ width: 20px; height: 20px; }}
.progress-bar {{ display: none; margin-top: 16px; background: #e2e8f0; border-radius: 6px; height: 6px; overflow: hidden; }}
.progress-bar .fill {{ height: 100%; background: #3DAE2B; border-radius: 6px; transition: width .3s; width: 0%; }}
.progress-text {{ display: none; font-size: 12px; color: #64748b; margin-top: 8px; }}

/* Section per company */
.section {{
  background: white; border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,.08);
  margin-bottom: 28px; overflow: hidden;
}}
.section-title {{
  background: #102547; color: white; padding: 14px 20px;
  font-size: 14px; font-weight: 600; letter-spacing: 1px;
  display: flex; justify-content: space-between; align-items: center;
}}
.section-month {{
  background: #3DAE2B; color: white; padding: 3px 10px;
  border-radius: 12px; font-size: 11px; font-weight: 600; letter-spacing: 0;
}}
.company-actions {{ padding: 12px 20px; background: #f8fafc; border-bottom: 1px solid #e8edf5; }}
.btn-company-dl {{
  background: white; color: #102547; padding: 8px 16px;
  border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px;
  font-weight: 600; cursor: pointer; font-family: inherit;
}}
.btn-company-dl:hover {{ background: #f1f5f9; border-color: #102547; }}

.student-list {{ padding: 0; }}
.student-item {{
  display: flex; align-items: center; padding: 12px 20px;
  border-bottom: 1px solid #e8edf5; text-decoration: none;
  color: inherit; transition: background .15s;
}}
.student-item:last-child {{ border-bottom: none; }}
.student-item:hover {{ background: #f1f5f9; }}
.student-num {{ color: #94a3b8; font-size: 11px; width: 28px; flex-shrink: 0; }}
.student-name {{ font-weight: 600; font-size: 13px; color: #102547; min-width: 200px; margin-right: 12px; }}
.student-name-en {{ color: #94a3b8; font-size: 11px; flex: 1; white-space: nowrap; }}
.student-dl {{
  font-size: 11px; color: #3DAE2B; padding: 4px 10px;
  border: 1px solid #3DAE2B; border-radius: 4px; flex-shrink: 0;
}}
.student-item:hover .student-dl {{ background: #3DAE2B; color: white; }}

/* Guide */
.guide {{ padding: 24px 28px; }}
.guide h3 {{
  font-size: 14px; font-weight: 700; color: #102547;
  margin: 18px 0 8px; padding-left: 10px; border-left: 3px solid #3DAE2B;
}}
.guide h3:first-child {{ margin-top: 0; }}
.guide p {{ font-size: 12px; line-height: 1.8; margin-bottom: 6px; padding-left: 14px; }}
.guide ul {{ list-style: none; padding-left: 14px; margin-bottom: 6px; }}
.guide ul li {{ font-size: 12px; line-height: 1.8; padding-left: 12px; position: relative; }}
.guide ul li::before {{ content: "・"; position: absolute; left: 0; }}
.eval-table {{ width: 100%; border-collapse: collapse; margin: 8px 0 12px 14px; font-size: 12px; }}
.eval-table th, .eval-table td {{ border: 1px solid #cbd5e1; padding: 5px 12px; text-align: left; }}
.eval-table th {{ background: #e8edf5; font-weight: 600; color: #334155; }}
.eval-table td:first-child {{ font-weight: 600; text-align: center; }}
.eval-table td:nth-child(2), .eval-table td:nth-child(3) {{ text-align: center; }}

.footer {{ text-align: center; padding: 20px; font-size: 11px; color: #94a3b8; }}
</style>
</head>
<body>

<!-- Password Gate -->
<div class="auth-overlay" id="authOverlay">
  <div class="auth-card">
    <img src="logo.png" alt="GROP VIETNAM" class="auth-logo">
    <h2>教育報告書ダウンロード</h2>
    <p class="auth-sub">閲覧にはパスワードが必要です</p>
    <form id="authForm">
      <div class="auth-input-wrap">
        <input type="password" class="auth-input" id="authPass" placeholder="パスワードを入力" autocomplete="off">
        <button type="submit" class="auth-submit">認証</button>
      </div>
      <div class="auth-error" id="authError"></div>
    </form>
  </div>
</div>

<div class="main-content" id="mainContent">

<div class="header">
  <img src="logo.png" alt="GROP VIETNAM">
  <div class="header-text">
    <h1>教育報告書</h1>
    <p>Education Report - {kumiai_name}</p>
  </div>
</div>

<div class="container">

  <div class="hero">
    <h2>{kumiai_name}</h2>
    <p class="sub">{ymd[:4]}年{int(ymd[4:])}月度 · 各社最新版</p>
    <div class="info">
      <div class="info-item">
        <div class="num">{total_count}</div>
        <div class="label">名</div>
      </div>
      <div class="info-item">
        <div class="num">{len(company_groups)}</div>
        <div class="label">社</div>
      </div>
    </div>
    <button class="btn-dl" id="bulkZipBtn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      全{total_count}名 PDF一括ダウンロード（ZIP）
    </button>
  </div>

  {sections_html}

  <div class="section">
    <div class="section-title">「教育課程　個人成績書」の見方</div>
    <div class="guide">
      <h3>基本情報</h3>
      <p>受入企業名、実習生の氏名（日本語・ローマ字）、生年月日、年齢、受験日、顔写真を記載しています。</p>

      <h3>テスト成績</h3>
      <p>使用教材「みんなの日本語」の進度に応じた月間テストの結果です。</p>
      <ul>
        <li><b>語彙</b>（100点満点）：単語の読み書きに関する問題</li>
        <li><b>文法</b>（100点満点）：文の組み立て・助詞の使い方など</li>
        <li><b>聴解</b>（100点満点）：日本語音声の聞き取り問題</li>
        <li><b>会話</b>（100点満点）：講師との面談による口頭評価</li>
        <li><b>合計</b>（400点満点）：上記4科目の合計点</li>
      </ul>
      <p>同期受験者全体の<b>平均点</b>、学力の相対的位置を示す<b>偏差値</b>（50が平均、60以上が優秀）、同期中の<b>順位</b>も併記しています。</p>

      <h3>総合評価</h3>
      <p>日本語能力と学習態度をそれぞれ5段階で評価し、補足コメントを付しています。</p>
      <table class="eval-table">
        <tr><th>評価</th><th>得点</th><th>得点率</th><th>テストコメント</th><th>態度コメント</th></tr>
        <tr><td>秀</td><td>340〜400</td><td>85%以上</td><td>最高ランクの成績</td><td>模範的な態度で生活している</td></tr>
        <tr><td>優</td><td>320〜339</td><td>80〜84%</td><td>優秀な成績</td><td>良好な態度で生活している</td></tr>
        <tr><td>良</td><td>300〜319</td><td>75〜79%</td><td>良好な成績</td><td>概ね良好な態度</td></tr>
        <tr><td>可</td><td>280〜299</td><td>70〜74%</td><td>合格水準の成績</td><td>改善の余地がある</td></tr>
        <tr><td>不可</td><td>〜279</td><td>70%未満</td><td>更なる努力が必要</td><td>態度の改善が必要</td></tr>
        <tr><td>−</td><td>—</td><td>未受験</td><td>未受験</td><td>—</td></tr>
      </table>

      <h3>診断コメント</h3>
      <p>テスト結果の詳細な分析に基づき、学習上の強みや課題を記載しています。苦手分野の特定や今後の学習方針の参考としてご活用ください。</p>

      <h3>成績推移（グラフ）</h3>
      <p>月ごとの科目別得点の変化を折れ線グラフで表示しています。学習の伸びや課題のある科目が一目で確認できます。</p>

      <h3>生活状況・学習状況</h3>
      <p>実習生の生活面・学習面について、以下の4つの観点から記載しています。</p>
      <ul>
        <li><b>Good</b>：良い点・評価できる行動</li>
        <li><b>Bad</b>：改善が必要な点・注意事項</li>
        <li><b>問題点に対し実施した対策</b>：講師が現在行っている指導内容</li>
        <li><b>対策を行い改善した点</b>：今後の課題と改善の方向性</li>
      </ul>
    </div>
  </div>

  <div class="footer">
    ご不明な点がございましたら担当者までお問い合わせください。<br>
    GROP VIETNAM Co., Ltd.
  </div>

</div>

</div><!-- /main-content -->

<script>
{pw_hash_block}
async function sha256(text) {{
  const encoded = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}}

document.getElementById('authForm').addEventListener('submit', async (e) => {{
  e.preventDefault();
  const inp = document.getElementById('authPass');
  const err = document.getElementById('authError');
  const hash = await sha256(inp.value);
  if (hash === PASS_HASH) {{
    sessionStorage.setItem('auth_{kumiai_slug}', '1');
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
  }} else {{
    inp.classList.add('error'); err.textContent = 'パスワードが違います';
    setTimeout(() => inp.classList.remove('error'), 400);
    inp.value = ''; inp.focus();
  }}
}});
if (sessionStorage.getItem('auth_{kumiai_slug}') === '1') {{
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('mainContent').style.display = 'block';
}} else {{
  document.getElementById('authPass').focus();
}}

const ALL_FILES = {files_json};
const COMPANY_FILES = {company_files_js};
const COMPANY_ZIP = {company_zip_names_js};

async function downloadZip(files, zipName, btn) {{
  const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ ZIP生成中...';
  try {{
    const zip = new JSZip();
    for (const f of files) {{
      const resp = await fetch(f);
      if (resp.ok) {{ zip.file(f, await resp.blob()); }}
    }}
    const content = await zip.generateAsync({{type:'blob'}});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content); a.download = zipName; a.click();
    URL.revokeObjectURL(a.href);
  }} catch(e) {{ alert('ダウンロード失敗: '+e.message); }}
  btn.disabled = false; btn.innerHTML = orig;
}}

document.getElementById('bulkZipBtn').addEventListener('click', () => {{
  downloadZip(ALL_FILES, '{zip_name}', document.getElementById('bulkZipBtn'));
}});
document.querySelectorAll('.btn-company-dl').forEach(btn => {{
  btn.addEventListener('click', () => {{
    const slug = btn.dataset.slug;
    downloadZip(COMPANY_FILES[slug], COMPANY_ZIP[slug], btn);
  }});
}});
</script>

</body>
</html>"""
    (work_dir / 'index.html').write_text(html, encoding='utf-8')

    # logo.png をサイトディレクトリにコピー
    import shutil
    src_logo = BASE_DIR / 'logo.png'
    if src_logo.exists():
        shutil.copy(src_logo, work_dir / 'logo.png')

def sb_get(path):
    url = f'{SUPABASE_URL}/rest/v1/' + urllib.parse.quote(path, safe='=&?*./%,_')
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
    })
    return json.loads(urllib.request.urlopen(req).read())

def start_local_server(port=8799):
    os.chdir(BASE_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    # ログ出力を抑制
    handler.log_message = lambda *args, **kwargs: None
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port

def render_pdf(context, base_url, trainee_id, month, out_pdf):
    """report.html を開いて PDF 出力（Chrome 印刷エンジン使用）"""
    page = context.new_page()
    page.set_viewport_size({"width": 1100, "height": 1600})
    url = f"{base_url}/report.html?id={trainee_id}&design=modern#m={month}"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    # 月切替の保険
    page.evaluate(f"""
        () => {{
            const sel = document.getElementById('monthSelect');
            if (sel) {{
                sel.value = '{month}';
                if (typeof switchMonth === 'function') switchMonth({month});
            }}
        }}
    """)

    # _reportReady シグナル待ち（最大15秒）
    try:
        page.wait_for_function("window._reportReady === true", timeout=15000)
    except Exception:
        print(f"  ⚠️  _reportReady タイムアウト、続行します")

    # フォント読込待ち
    page.evaluate("() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()")
    page.wait_for_timeout(500)

    # PDF 出力（@page CSS が効くので margin は @page 側に任せる）
    page.pdf(
        path=str(out_pdf),
        format="A4",
        print_background=True,
        prefer_css_page_size=True,
        margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
    )
    page.close()

def main():
    ap = argparse.ArgumentParser(description="教育報告書 一括PDF生成（Playwright版）")
    ap.add_argument('--kumiai', help='組合スラッグ: globalway / cic / worldbusiness / tombow / sanyotech', default=None)
    ap.add_argument('--month', type=int, default=1, help='教育月 1-8')
    ap.add_argument('--company', help='会社名フィルタ（部分一致）', default=None)
    ap.add_argument('--exclude-company', action='append', default=[], help='除外する会社名（部分一致、複数指定可）')
    ap.add_argument('--output', help='出力先', default=str(DEFAULT_OUTPUT))
    ap.add_argument('--no-zip', action='store_true', help='ZIP 化しない')
    ap.add_argument('--all', action='store_true', help='その月のテスト未受験者も含める（既定は受験者のみ）')
    ap.add_argument('--site', action='store_true', help='静的サイト用 index.html を生成（brastech-reports と同形式）')
    ap.add_argument('--password', help='静的サイトのパスワード（--site 指定時、省略時は無し）', default=None)
    ap.add_argument('--auto-month', action='store_true', help='各企業の最新受験月を自動判定して生成（--month は無視）')
    ap.add_argument('--ymd', help='配布ページの年月（YYYYMM、省略時は当月）', default=None)
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright がインストールされていません")
        print("  pip install playwright")
        print("  python -m playwright install chromium")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    target_kumiai = KUMIAI_NAME_FROM_SLUG.get(args.kumiai) if args.kumiai else None

    # 月→test_name マッピング
    MONTH_TEST_NAMES = ["1-4","5-11","12-18","19-25","26-33","34-40","41-45","46-50"]
    def test_names_for_month(m): return (f'test{m}', f'第{MONTH_TEST_NAMES[m-1]}課')
    one_month_delayed_tests = {}
    for m_idx, suffix in enumerate(MONTH_TEST_NAMES, start=1):
        one_month_delayed_tests[f'test{m_idx}'] = m_idx + 1
        one_month_delayed_tests[f'第{suffix}課'] = m_idx + 1
    # BRN001/BRN002 は 3ヶ月目報告書に test4 を表示する特例（app.js の MONTH3_TEST4_REPORT_STUDENTS と対応）
    # → test4 以降は報告月が 1 つ前にずれる
    month3_test4_tests = {}
    for m_idx, suffix in enumerate(MONTH_TEST_NAMES, start=1):
        if m_idx >= 4:
            month3_test4_tests[f'test{m_idx}'] = m_idx - 1
            month3_test4_tests[f'第{suffix}課'] = m_idx - 1
    TEST_MONTH_OVERRIDES = {
        'BRN001': month3_test4_tests,
        'BRN002': month3_test4_tests,
        'BRN014': one_month_delayed_tests,
        'BRN015': one_month_delayed_tests,
        'BRN021': {'test2': 1, '第5-11課': 1, 'test3': 2, '第12-18課': 2},
    }

    print("📥 Supabase から実習生データ取得中...")
    trainees = sb_get("trainees?select=*&order=student_id")

    # 全テスト結果を取得（最新月判定 + 受験者判定で使う）
    print("📥 test_results を取得中...")
    all_results = sb_get("test_results?select=trainee_id,test_name")

    # trainee_id -> 受験した月のセット
    # minna: testN / 第x-y課 はそのまま N ヶ月目。
    # marugoto: marugoto_N は、既に受けた minna の最大月を offset として
    #            offset + N ヶ月目に割り当てる（app.js の report 表示と同じ考え方）。
    minna_months_by_trainee = defaultdict(set)
    marugoto_indices_by_trainee = defaultdict(set)
    for r in all_results:
        tn = r['test_name'] or ''
        trainee = next((t for t in trainees if t['id'] == r['trainee_id']), None)
        override_month = TEST_MONTH_OVERRIDES.get((trainee or {}).get('student_id'), {}).get(tn)
        if override_month:
            minna_months_by_trainee[r['trainee_id']].add(override_month)
            continue
        for m_idx, suffix in enumerate(MONTH_TEST_NAMES, start=1):
            if tn == f'test{m_idx}' or tn == f'第{suffix}課':
                minna_months_by_trainee[r['trainee_id']].add(m_idx)
                break
        m = re.match(r'^marugoto_(\d+)$', tn)
        if m:
            marugoto_indices_by_trainee[r['trainee_id']].add(int(m.group(1)))

    tested_months_by_trainee = defaultdict(set)
    for t in trainees:
        tid = t['id']
        months = set(minna_months_by_trainee.get(tid, set()))
        if marugoto_indices_by_trainee.get(tid):
            offset = max(minna_months_by_trainee.get(tid, set()) or [0])
            for idx in marugoto_indices_by_trainee[tid]:
                months.add(offset + idx)
        tested_months_by_trainee[tid] = months

    # まず kumiai/company フィルタを適用
    pre_filtered = []
    for t in trainees:
        if (t.get('status') or 'active') != 'active': continue
        if target_kumiai and t.get('supervising_org') != target_kumiai: continue
        if args.company and args.company not in (t.get('company') or ''): continue
        if any(ex in (t.get('company') or '') for ex in args.exclude_company): continue
        pre_filtered.append(t)

    if not pre_filtered:
        print("該当する実習生がいません")
        sys.exit(0)

    # auto-month: グループ（会社+期生）ごとに最新月を判定
    if args.auto_month:
        # group_key (会社+期生) → 最新月（受験履歴があるグループのみ対象）
        company_to_month = {}
        for t in pre_filtered:
            c = company_with_class(t)
            months = tested_months_by_trainee.get(t['id'], set())
            if months:
                cur = company_to_month.get(c, 0)
                company_to_month[c] = max(cur, max(months))
        # テスト履歴が誰一人ない（=新規グループ）は除外
        # → ロイヤルデリカ:2, キンレイ:1, など実績ある所のみ残る

        filtered_per_month = defaultdict(list)
        skipped_groups = []
        for t in pre_filtered:
            c = company_with_class(t)
            months = tested_months_by_trainee.get(t['id'], set())
            if months:
                m = max(months)
            elif args.all and c in company_to_month:
                m = company_to_month[c]
            else:
                skipped_groups.append(c)
                continue
            t['_assigned_month'] = m
            # --all 時はそのグループ全員を含める（未受験者も「未受験」表記で出力）
            if not args.all and m not in tested_months_by_trainee.get(t['id'], set()):
                continue
            filtered_per_month[m].append(t)

        if not any(filtered_per_month.values()):
            print("該当する実習生がいません")
            sys.exit(0)

        total_filtered = sum(len(v) for v in filtered_per_month.values())
        print(f"対象: {total_filtered}名（auto-month: {len(company_to_month)}グループの最新月を判定）")
        for c, m in sorted(company_to_month.items()):
            print(f"  - {c}: {m}ヶ月目")
        if skipped_groups:
            unique_skipped = sorted(set(skipped_groups))
            print(f"（テスト履歴なしのため除外: {len(unique_skipped)}グループ - {', '.join(unique_skipped)}）")

        # 月別フィルタ済みリストを統合（後段の処理用）
        filtered = [t for ts in filtered_per_month.values() for t in ts]
        skipped_untested = len(pre_filtered) - total_filtered
    else:
        # 単一月モード
        filtered = []
        skipped_untested = 0
        for t in pre_filtered:
            if not args.all and args.month not in tested_months_by_trainee.get(t['id'], set()):
                skipped_untested += 1
                continue
            t['_assigned_month'] = args.month
            filtered.append(t)

        if not filtered:
            print(f"該当する実習生がいません（未受験で除外: {skipped_untested}名）")
            print("→ テスト未受験者も含めたい場合は --all を追加してください")
            sys.exit(0)

        print(f"対象: {len(filtered)}名" + (f"（未受験で除外: {skipped_untested}名）" if skipped_untested else ""))

    # ローカルサーバー起動
    print("🌐 ローカル HTTP サーバー起動中...")
    httpd, port = start_local_server()
    base_url = f"http://127.0.0.1:{port}"

    try:
        # 1. admin としてセッションを REST API で取得
        print("🔑 管理者セッション取得中...")
        session = get_admin_session()

        # 2. Supabase の localStorage 形式に整形
        sb_token_key = f'sb-{SUPABASE_PROJECT_REF}-auth-token'
        sb_token_value = json.dumps({
            'access_token': session['access_token'],
            'refresh_token': session.get('refresh_token', ''),
            'expires_in': session.get('expires_in', 3600),
            'expires_at': session.get('expires_at', int(time.time()) + 3600),
            'token_type': session.get('token_type', 'bearer'),
            'user': session.get('user', {}),
        })

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1100, "height": 1600})

            # 3. add_init_script で全ページの読込前に session を localStorage 注入
            init_script = f"""
                try {{
                    localStorage.setItem({json.dumps(sb_token_key)}, {json.dumps(sb_token_value)});
                }} catch(e) {{}}
            """
            context.add_init_script(init_script)

            # PDF 生成ループ
            ymd = args.ymd or time.strftime('%Y%m')
            kumiai_slug_for_zip = args.kumiai or 'all'

            # 会社+期生 でグループ化
            by_company = defaultdict(list)
            for t in filtered:
                by_company[company_with_class(t)].append(t)

            work_dir = output_dir / kumiai_slug_for_zip
            if work_dir.exists():
                import shutil
                shutil.rmtree(work_dir)
            work_dir.mkdir(parents=True, exist_ok=True)

            generated = []
            # 静的サイト用: company -> {month, files: [{name_kata, name_romaji, pdf_filename}]}
            site_company_data = {}
            total = len(filtered)
            done = 0
            for company, arr in by_company.items():
                c_safe = safe_filename(company)
                comp_dir = work_dir / c_safe
                comp_dir.mkdir(parents=True, exist_ok=True)
                site_files = []
                company_months = sorted(set(t.get('_assigned_month', args.month) for t in arr))
                company_month = company_months[0] if len(company_months) == 1 else '・'.join(str(m) for m in company_months)
                for t in arr:
                    done += 1
                    sid = t.get('student_id', '?')
                    # カタカナ名（中黒区切り正規化）→ ファイル名安全化
                    kata = (t.get('name_katakana') or '').strip()
                    kata_norm = re.sub(r'[\s　]+', '・', kata)
                    kata_safe = safe_filename(kata_norm) or 'unknown'
                    m = t.get('_assigned_month', args.month)
                    pdf_name = f"教育報告書 {m}ヶ月目 {kata_safe}.pdf"
                    out_pdf = comp_dir / pdf_name
                    print(f"  [{done}/{total}] {sid} {kata} → {c_safe}/{pdf_name} ({m}ヶ月目)")
                    try:
                        render_pdf(context, base_url, t['id'], m, out_pdf)
                        generated.append(out_pdf)
                        site_files.append({
                            'name_kata': kata_norm or '?',
                            'name_romaji': t.get('name_romaji') or '',
                            'pdf_filename': pdf_name,
                        })
                    except Exception as e:
                        print(f"    ✗ ERROR: {e}")
                if site_files:
                    site_company_data[company] = {
                        'name': company, 'month': company_month,
                        'slug': c_safe, 'files': site_files,
                    }

            browser.close()

        # --site: 静的サイト用 index.html を生成
        if args.site and generated:
            kumiai_name = target_kumiai or '全組合'
            print(f"\n🌐 静的サイト index.html 生成中...")
            company_groups = list(site_company_data.values())
            generate_site_index(
                work_dir, kumiai_name, kumiai_slug_for_zip,
                ymd, company_groups, password=args.password
            )
            print(f"✓ 静的サイト準備完了: {work_dir}/index.html")
            print(f"  → このフォルダ全体を GitHub Pages にデプロイすればブラウザで閲覧可能")

        # ZIP 化
        if not args.no_zip and generated:
            zip_name = f"教育報告書_{kumiai_slug_for_zip}_{ymd}_{args.month}ヶ月目.zip"
            zip_path = output_dir / zip_name
            print(f"\n📦 ZIP 生成: {zip_path}")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for pdf in generated:
                    arcname = pdf.relative_to(work_dir)
                    zf.write(pdf, arcname)
            print(f"✓ 完了: {zip_path} ({zip_path.stat().st_size // 1024} KB)")
        else:
            print(f"\n✓ 生成完了: {work_dir}/")

    finally:
        httpd.shutdown()

if __name__ == '__main__':
    main()
