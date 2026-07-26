/**
 * あつ杯 データ管理バックエンド (Google Apps Script)
 *
 * 役割: スプレッドシートを正本として保持し、data/*.json と同じ形のJSONへ相互変換する。
 *
 * === Phase 1 (このファイルの現状) ===
 * 読み取り(doGet)と初期セットアップのみ。**書き込みAPI(doPost)はまだ無い** =
 * デプロイしても外部から書き換えられる口は存在しない。
 *
 * === Phase 2 で追加予定 ===
 * doPost(GoogleログインのIDトークン検証 → adminsシート照合 → シート更新 → GitHubへpush)
 *
 * --- Script Properties に設定が必要なキー ---
 *   SPREADSHEET_ID : このスクリプトが読み書きするスプレッドシートのID
 *   (Phase 2 で GITHUB_PAT / GITHUB_OWNER / GITHUB_REPO / OAUTH_CLIENT_ID を追加)
 */

/* ============================================================
 * スキーマ定義
 * data/SCHEMA.md と1対1で対応させること。列の順序＝シートの列順。
 * t: 'str'      文字列(空欄は "")
 *    'str?'     文字列 または null(空欄は null)
 *    'bool'     真偽値
 *    'num'      数値
 *    'num?'     数値 または null(空欄は null)
 * ============================================================ */
var SCHEMA = {
  users: [
    { k: 'id',         t: 'str'  },
    { k: 'name',       t: 'str'  },
    { k: 'recDefault', t: 'bool' },
    { k: 'archived',   t: 'bool' },
    { k: 'createdAt',  t: 'str'  },
    { k: 'note',       t: 'str'  }
  ],
  tournaments: [
    { k: 'id',          t: 'str'  },
    { k: 'title',       t: 'str'  },
    { k: 'detail',      t: 'str'  },
    { k: 'posterImage', t: 'str?' },
    { k: 'heldAt',      t: 'str'  },
    { k: 'status',      t: 'str'  }
  ],
  entries: [
    { k: 'id',           t: 'str'  },
    { k: 'tournamentId', t: 'str'  },
    { k: 'userId',       t: 'str'  },
    { k: 'placement',    t: 'num?' },
    { k: 'wins',         t: 'num'  },
    { k: 'recAtEntry',   t: 'bool' }
  ],
  matches: [
    { k: 'id',              t: 'str'  },
    { k: 'tournamentId',    t: 'str'  },
    { k: 'round',           t: 'num'  },
    { k: 'stage',           t: 'str'  },
    { k: 'matchIndex',      t: 'num'  },
    { k: 'player1Id',       t: 'str?' },
    { k: 'player2Id',       t: 'str?' },
    { k: 'winnerId',        t: 'str?' },
    { k: 'isBye',           t: 'bool' },
    { k: 'player1SrcIndex', t: 'num?' },
    { k: 'player2SrcIndex', t: 'num?' },
    { k: 'videoUrl',        t: 'str'  },
    { k: 'playedAt',        t: 'str?' }
  ]
};

// アプリのデータではないが運用に必要なシート
var ADMINS_HEADER = ['email', 'role', 'note'];
var AUDIT_HEADER  = ['timestamp', 'email', 'action', 'target'];

var DATA_SHEETS = ['users', 'tournaments', 'entries', 'matches'];

/* ============================================================
 * 型変換
 * スプレッドシートのセルはJSONと型が一致しないため、SCHEMAに従って両方向で正規化する。
 * ここがズレると往復でデータが壊れるので、変更時は必ず verifyAgainstJson() で確認すること。
 * ============================================================ */

// セル値 → JSONの値
function cellToValue_(v, type) {
  var empty = (v === '' || v === null || v === undefined);
  switch (type) {
    case 'str':
      if (empty) return '';
      // 日付として自動解釈されてしまったセルを ISO文字列へ戻す
      if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
      return String(v);
    case 'str?':
      if (empty) return null;
      if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
      return String(v);
    case 'bool':
      if (typeof v === 'boolean') return v;
      return String(v).toUpperCase() === 'TRUE';
    case 'num':
      return empty ? 0 : Number(v);
    case 'num?':
      return empty ? null : Number(v);
  }
  return empty ? null : v;
}

// JSONの値 → セル値
function valueToCell_(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'bool') return v === true;
  return v;
}

/* ============================================================
 * シートの読み書き
 * ============================================================ */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Script Properties に SPREADSHEET_ID が設定されていません。');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」が見つかりません。initSheets() を実行してください。');
  return sh;
}

/**
 * シート1枚を、SCHEMAに従って行オブジェクトの配列として読み出す。
 * ヘッダ行の並びは信用せず、SCHEMAで定義した列名でヘッダを引き当てる
 * (列を手で並べ替えられても壊れないようにするため)。
 */
function readSheet_(name) {
  var cols = SCHEMA[name];
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];

  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  cols.forEach(function (c) {
    var i = header.indexOf(c.k);
    if (i === -1) throw new Error('シート「' + name + '」に列「' + c.k + '」がありません。');
    idx[c.k] = i;
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    // id が空の行は未入力行とみなして読み飛ばす
    if (String(raw[idx[cols[0].k]]).trim() === '') continue;
    var obj = {};
    cols.forEach(function (c) { obj[c.k] = cellToValue_(raw[idx[c.k]], c.t); });
    rows.push(obj);
  }
  return rows;
}

/** 行オブジェクトの配列でシートを丸ごと置き換える(ヘッダは維持) */
function writeSheet_(name, rows) {
  var cols = SCHEMA[name];
  var sh = sheet_(name);

  // ヘッダ以外を消してから書き直す
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  if (!rows.length) return 0;

  var body = rows.map(function (row) {
    return cols.map(function (c) { return valueToCell_(row[c.k], c.t); });
  });
  sh.getRange(2, 1, body.length, cols.length).setValues(body);
  return body.length;
}

/** 4テーブルすべてを data/*.json と同じ形で取り出す */
function readAll_() {
  var out = {};
  DATA_SHEETS.forEach(function (n) { out[n] = readSheet_(n); });
  return out;
}

/* ============================================================
 * Web API (Phase 1: 読み取りのみ)
 * ============================================================ */

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET ?table=users  … 単一テーブル
 * GET (パラメータなし) … 4テーブルすべて
 *
 * 注意: これは検証・デバッグ用。アプリの読み込み経路は GitHub Pages の静的 data/*.json であり、
 * ここを本番の読み込みに使うとGASの実行クォータを消費し、毎回1〜3秒のコールドスタートが入る。
 */
function doGet(e) {
  try {
    var table = (e && e.parameter && e.parameter.table) || '';
    if (table) {
      if (DATA_SHEETS.indexOf(table) === -1) throw new Error('不明なテーブル: ' + table);
      return jsonResponse_(readSheet_(table));
    }
    return jsonResponse_(readAll_());
  } catch (err) {
    return jsonResponse_({ error: String(err && err.message || err) });
  }
}

/* ============================================================
 * セットアップ用(GASエディタから手動で1回だけ実行する)
 * ============================================================ */

/** 6つのシートを作成し、ヘッダと書式を整える。既にあるシートには触らない。 */
function initSheets() {
  var ss = ss_();
  var made = [];

  DATA_SHEETS.forEach(function (name) {
    if (ss.getSheetByName(name)) return;
    var sh = ss.insertSheet(name);
    var cols = SCHEMA[name];
    sh.getRange(1, 1, 1, cols.length)
      .setValues([cols.map(function (c) { return c.k; })])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    // 文字列列は「書式なしテキスト」にする。
    // ISO日時("2026-07-25T13:30:06.668Z")や "t2026-07" が日付として自動変換されるのを防ぐため。
    cols.forEach(function (c, i) {
      if (c.t === 'str' || c.t === 'str?') {
        sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      }
    });
    made.push(name);
  });

  [['admins', ADMINS_HEADER], ['audit', AUDIT_HEADER]].forEach(function (pair) {
    if (ss.getSheetByName(pair[0])) return;
    var sh = ss.insertSheet(pair[0]);
    sh.getRange(1, 1, 1, pair[1].length).setValues([pair[1]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), pair[1].length).setNumberFormat('@');
    made.push(pair[0]);
  });

  Logger.log(made.length ? '作成したシート: ' + made.join(', ') : 'すべてのシートは既に存在します。');
  return made;
}

/**
 * 既存の data/users.json の内容をusersシートへ投入する(初回のみ)。
 * 既にusersシートに行がある場合は何もしない(誤って上書きしないため)。
 */
function seedUsers() {
  if (readSheet_('users').length) {
    Logger.log('usersシートに既にデータがあるため、何もしませんでした。');
    return 0;
  }
  var n = writeSheet_('users', SEED_USERS_);
  Logger.log(n + '人を投入しました。');
  return n;
}

var SEED_USERS_ = [
  { id: 'u0001', name: 'ソラシド', recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.668Z', note: '' },
  { id: 'u0002', name: 'ココア',   recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0003', name: 'リクト',   recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0004', name: 'あつ',     recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0005', name: 'ドラ',     recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0006', name: 'てこん',   recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0007', name: 'みゅあ',   recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0008', name: 'いさ',     recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0009', name: 'A',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0010', name: 'B',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0011', name: 'C',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0012', name: 'D',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0013', name: 'E',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0014', name: 'F',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' },
  { id: 'u0015', name: 'G',        recDefault: true, archived: false, createdAt: '2026-07-25T13:30:06.669Z', note: '' }
];

/**
 * 動作確認用: シートから読んだJSONをログに出す。
 * これをコピーして、リポジトリの data/users.json と一致するか比較する。
 */
function dumpUsersJson() {
  var json = JSON.stringify(readSheet_('users'), null, 2);
  Logger.log(json);
  return json;
}

/** 往復テスト: シート→JSON→シート→JSON で内容が変わらないことを確認する */
function selfTestRoundTrip() {
  var results = [];
  DATA_SHEETS.forEach(function (name) {
    var before = readSheet_(name);
    if (!before.length) { results.push(name + ': 行が無いためスキップ'); return; }
    writeSheet_(name, before);
    var after = readSheet_(name);
    var ok = JSON.stringify(before) === JSON.stringify(after);
    results.push(name + ': ' + (ok ? '✅ 一致' : '❌ 不一致'));
    if (!ok) {
      Logger.log('--- ' + name + ' before ---\n' + JSON.stringify(before, null, 2));
      Logger.log('--- ' + name + ' after ---\n' + JSON.stringify(after, null, 2));
    }
  });
  Logger.log(results.join('\n'));
  return results;
}
