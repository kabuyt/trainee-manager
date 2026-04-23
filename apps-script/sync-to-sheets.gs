/**
 * Google Sheets 受信用 Apps Script Web App
 *
 * 【使い方】
 * 1. Google Sheetsを開く
 * 2. 拡張機能 → Apps Script
 * 3. このコードをコピペ
 * 4. SECRET を好きな文字列に変更（例: "myGrvTest123"）
 *    → trainee-manager 側の設定にも同じ文字列を入れる
 * 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 6. 「デプロイ」→ URL をコピー
 * 7. test-results.html の「⚙ Sheets設定」に URL と SECRET を貼り付け
 *
 * 【機能】
 * POST で受信したデータを test_results シート（無ければ自動作成）に書き込む
 * data.replace = true なら既存データをクリアして上書き
 */

const SECRET = 'CHANGE_ME_TO_YOUR_SECRET';  // ← 必ず変更してください
const SHEET_NAME = 'test_results';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return jsonOut({ error: 'unauthorized' });
    }

    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAME);
    }

    if (data.replace) {
      sh.clear();
    }

    const rows = data.rows || [];
    if (rows.length > 0) {
      const startRow = data.replace ? 1 : sh.getLastRow() + 1;
      const cols = Math.max(...rows.map(r => r.length));
      // 長さ揃え
      const normalized = rows.map(r => {
        const out = r.slice();
        while (out.length < cols) out.push('');
        return out;
      });
      sh.getRange(startRow, 1, normalized.length, cols)
        .setValues(normalized);

      // ヘッダー書式（1行目）
      if (data.replace && startRow === 1) {
        sh.getRange(1, 1, 1, cols)
          .setFontWeight('bold')
          .setBackground('#2c3e50')
          .setFontColor('#ffffff');
        sh.setFrozenRows(1);
      }
    }

    return jsonOut({
      ok: true,
      inserted: rows.length,
      sheet: sh.getName(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return jsonOut({ error: err.toString() });
  }
}

// 接続テスト用（ブラウザで GETすると動作確認可能）
function doGet(e) {
  return jsonOut({
    ok: true,
    message: 'Apps Script Web App is running. Use POST to send data.',
    hint: 'POST JSON: { secret, replace, rows }'
  });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
