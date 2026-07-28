/**
 * あつ杯 データ管理バックエンド (Google Apps Script)
 *
 * 役割: スプレッドシートを正本として保持し、data/*.json と同じ形のJSONへ相互変換する。
 *
 * 書き込み(doPost)は必ず以下を通す:
 *   GoogleログインのIDトークン検証 → adminsシートの許可リスト照合 → シート更新 → GitHubへpush
 *
 * ⚠️ このWebアプリは「実行するユーザー: 自分」でデプロイするため、呼び出した人が誰でも
 *    オーナー権限でシートを触れてしまう。スプレッドシートの共有設定は防御にならない。
 *    防御しているのは下の verifyIdToken_() と assertAdmin_() だけなので、絶対に外さないこと。
 *
 * --- Script Properties に設定が必要なキー ---
 *   SPREADSHEET_ID   : 読み書きするスプレッドシートのID
 *   OAUTH_CLIENT_ID  : GCPで作ったOAuth 2.0 クライアントID(IDトークンのaud検証に使う・必須)
 *   GITHUB_PAT       : GitHubへJSONを書き出すためのトークン(Contents: Read and write)
 *   GITHUB_OWNER     : 例 sorasido-lmf
 *   GITHUB_REPO      : 例 atsu-cup
 *   GITHUB_BRANCH    : 省略時 main
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
    { k: 'id',            t: 'str'  },
    { k: 'title',         t: 'str'  },
    { k: 'detail',        t: 'str'  },
    { k: 'posterImage',   t: 'str?' },
    { k: 'heldAt',        t: 'str'  },
    { k: 'status',        t: 'str'  },
    // 2026-07-27追加。既存データがある列の途中に挿入すると値がズレるため、必ず末尾に追加すること。
    // シート側にも同名の列(archived/isOfficial/isRestricted)を末尾に追加してからデプロイすること
    // (readSheet_は列名をヘッダから引き当てるため、シート側に列が無いと例外になる)。
    { k: 'archived',      t: 'bool' },
    { k: 'isOfficial',    t: 'bool' },
    { k: 'isRestricted',  t: 'bool' },
    // 2026-07-28追加。書き込みのたびにサーバー(GAS)側で new Date().toISOString() を打つ。
    // ⚠️ クライアントから送られてきた値は使わない(端末の時計がずれていると比較が壊れるため)。
    // 端末間同期で「サーバー側が更新されたか」を、内容比較ではなく時刻の大小で判定するのに使う。
    // 列追加より前に保存された既存行は空欄('')になるが、その場合クライアントは内容比較へ
    // フォールバックするだけなのでデータ破損にはならない。
    { k: 'updatedAt',     t: 'str'  }
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
  // bool型は「値が無い(null/undefined)」も含めて必ずtrue/falseに確定させる。
  // 従来はnull/undefinedを先に空文字へ倒していたため、送信payloadに該当キーが
  // 無いだけでbool列が空欄(見た目上null)になり、archived/isOfficial/isRestrictedが
  // 空欄になる不具合の一因になっていた(2026-07-27発覚)。
  if (type === 'bool') return v === true;
  if (v === null || v === undefined) return '';
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
 * 認証 (ここがこのシステムの唯一の防御線)
 * ============================================================ */

function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Script Properties に ' + key + ' が設定されていません。');
  }
  return v;
}

/** 認証・認可の失敗を、サーバ内部エラーと区別するための印 */
function authError_(msg) {
  var e = new Error(msg);
  e.isAuth = true;
  return e;
}

/**
 * GoogleのIDトークンを検証してメールアドレスを返す。
 *
 * aud(このトークンが誰向けに発行されたか)の検証が最重要。
 * これを省くと、他のサイト向けに発行されたトークンを持ってくるだけで通ってしまう。
 */
function verifyIdToken_(idToken) {
  if (!idToken) throw authError_('ログインが必要です。');

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) {
    throw authError_('ログイン情報を確認できませんでした。もう一度ログインしてください。');
  }

  var info = JSON.parse(res.getContentText());
  if (info.aud !== prop_('OAUTH_CLIENT_ID')) throw authError_('このアプリ向けのログインではありません。');
  if (String(info.email_verified) !== 'true')  throw authError_('メールアドレスが確認できていないアカウントです。');
  if (Number(info.exp) * 1000 < Date.now())    throw authError_('ログインの有効期限が切れました。もう一度ログインしてください。');
  if (!info.email)                             throw authError_('メールアドレスを取得できませんでした。');

  return String(info.email).trim().toLowerCase();
}

/** adminsシートに載っているか確認し、役割を返す。載っていなければ拒否。 */
function assertAdmin_(email) {
  var values = sheet_('admins').getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === email) {
      return String(values[i][1] || 'admin').trim();
    }
  }
  throw authError_('このアカウント(' + email + ')には編集権限がありません。管理者に追加を依頼してください。');
}

function writeAudit_(email, action, target) {
  try {
    sheet_('audit').appendRow([new Date().toISOString(), email, action, target || '']);
  } catch (e) {
    // 監査ログの失敗で本処理を巻き添えにしない
    Logger.log('audit記録に失敗: ' + e);
  }
}

/* ============================================================
 * GitHubへの書き出し
 * PATはScript Properties(サーバ側)にあり、ブラウザからは到達できない。
 * ============================================================ */

function githubApiUrl_(path) {
  return 'https://api.github.com/repos/' + prop_('GITHUB_OWNER') + '/' + prop_('GITHUB_REPO') + '/contents/' + path;
}

// GitHub Contents APIへ、base64済みのコンテンツをそのままPUTする共通処理
// (JSON書き出し・バイナリ画像アップロードの両方から使う)
function putGithubContent_(path, base64Content, message) {
  var pat    = prop_('GITHUB_PAT');
  var branch = prop_('GITHUB_BRANCH', 'main');
  var url    = githubApiUrl_(path);
  var headers = { Authorization: 'token ' + pat, Accept: 'application/vnd.github+json' };

  // 既存ファイルの sha を取る(無ければ新規作成)
  var get = UrlFetchApp.fetch(url + '?ref=' + branch, { headers: headers, muteHttpExceptions: true });
  var sha = null;
  if (get.getResponseCode() === 200) {
    sha = JSON.parse(get.getContentText()).sha;
  } else if (get.getResponseCode() !== 404) {
    throw new Error('GitHubの取得に失敗しました(' + get.getResponseCode() + '): ' + path);
  }

  var body = { message: message, content: base64Content, branch: branch };
  if (sha) body.sha = sha;

  var put = UrlFetchApp.fetch(url, {
    method: 'put', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (put.getResponseCode() >= 300) {
    throw new Error('GitHubへの保存に失敗しました(' + put.getResponseCode() + '): ' + put.getContentText().slice(0, 200));
  }
}

function pushToGitHub_(path, rows, message) {
  // 日本語を含むのでUTF-8を明示する
  var base64Content = Utilities.base64Encode(JSON.stringify(rows, null, 2) + '\n', Utilities.Charset.UTF_8);
  putGithubContent_(path, base64Content, message);
}

// ポスター画像など、既にbase64化済みのバイナリファイルをGitHubへ保存する
function pushBinaryToGitHub_(path, base64Content, message) {
  putGithubContent_(path, base64Content, message);
}

/**
 * 指定テーブルをシートから読み直してGitHubへ書き出す。
 *
 * 事故防止: シートが空なのにGitHub側にデータがある場合は書き出しを中断する。
 * (移行前や、旧方式でGitHubを直接更新した後に書き込むと、空のシートで上書きして
 *  GitHub側のデータを失うため。先に importFromGitHub() を実行させる)
 *
 * force=true にすると、このチェックを完全にスキップして常に上書きする。
 * ゴミデータの一括削除など、シートを意図的に空にしてGitHub側も空にしたい場合の
 * 破壊的操作専用(通常は使わない。forcePushSheetChangesToGitHub()からのみ呼ぶ想定)。
 */
function exportTables_(tables, message, force) {
  tables.forEach(function (name) {
    var rows = readSheet_(name);
    if (!rows.length && !force) {
      var existing = readJsonFromGitHub_('data/' + name + '.json');
      if (existing.length) {
        throw new Error(
          '安全のため中断しました: シートの「' + name + '」は空ですが、GitHubには' + existing.length + '行あります。' +
          'このまま書き出すとGitHub側のデータが消えます。先に importFromGitHub() を実行するか、' +
          '本当に空にしたい場合は forcePushSheetChangesToGitHub() を使ってください。'
        );
      }
    }
    pushToGitHub_('data/' + name + '.json', rows, message);
  });
}

/* ============================================================
 * 書き込み処理
 * ============================================================ */

/**
 * 名前の一覧を受け取り、usersシートに未登録のものへIDを採番して追加する。
 * IDの一意性はサーバ側で担保する(複数端末から同時に登録されても衝突しないように)。
 * 戻り値: { idByName, added }
 */
function ensureUsers_(names) {
  var rows = readSheet_('users');
  var idByName = {};
  var used = {};
  rows.forEach(function (u) { idByName[u.name] = u.id; used[u.id] = true; });

  var added = [];
  (names || []).forEach(function (name) {
    if (!name || idByName[name]) return;
    var n = 1, id;
    do { id = 'u' + ('000' + n).slice(-4); n++; } while (used[id]);
    used[id] = true;
    var nu = { id: id, name: name, recDefault: true, archived: false, createdAt: new Date().toISOString(), note: '' };
    rows.push(nu);
    idByName[name] = id;
    added.push(nu);
  });

  if (added.length) writeSheet_('users', rows);
  return { idByName: idByName, added: added, rows: rows };
}

/**
 * action: saveUsers
 * payload.users = [{ name, recDefault, archived }] (アプリ側の名前キーのマスタ)
 * 名前で突き合わせ、既存行のidは保ったまま値を更新する。未登録の名前は採番して追加。
 */
function actionSaveUsers_(payload) {
  var incoming = (payload && payload.users) || [];
  var rows = readSheet_('users');
  var byName = {};
  var used = {};
  rows.forEach(function (u) { byName[u.name] = u; used[u.id] = true; });

  var added = 0, updated = 0;
  incoming.forEach(function (u) {
    if (!u || !u.name) return;
    var recDefault = u.recDefault !== false;
    var archived = u.archived === true;
    var ex = byName[u.name];
    if (ex) {
      if (ex.recDefault !== recDefault || ex.archived !== archived) {
        ex.recDefault = recDefault; ex.archived = archived; updated++;
      }
    } else {
      var n = 1, id;
      do { id = 'u' + ('000' + n).slice(-4); n++; } while (used[id]);
      used[id] = true;
      var nu = { id: id, name: u.name, recDefault: recDefault, archived: archived,
                 createdAt: new Date().toISOString(), note: '' };
      rows.push(nu); byName[u.name] = nu; added++;
    }
  });

  writeSheet_('users', rows);
  exportTables_(['users'], 'ユーザー情報を更新(' + rows.length + '人)');
  return { total: rows.length, added: added, updated: updated };
}

/**
 * action: saveTournament
 * payload = { tournamentRow, entryRows, matchRows, participantNames }
 *
 * entryRows.userId / matchRows.player*Id には **ID ではなく名前** が入っている前提。
 * (順位や勝敗の導出はクライアント側の検証済みロジックに任せ、
 *  ID採番だけをサーバ側で行うための設計。keyedBy='name' で明示する)
 */
function actionSaveTournament_(payload) {
  if (!payload || !payload.tournamentRow) throw new Error('保存する大会データがありません。');
  if (payload.keyedBy !== 'name') throw new Error('payload.keyedBy が name ではありません。');

  var tid = payload.tournamentRow.id;
  if (!tid) throw new Error('大会IDがありません。');

  // 1) 参加者のIDを確定させる
  var names = payload.participantNames || [];
  var ensured = ensureUsers_(names);
  var idOf = function (name) {
    if (name === null || name === undefined || name === '') return null;
    return ensured.idByName[name] || null;
  };

  // 2) 名前 → ID へ置き換える
  var entryRows = (payload.entryRows || []).map(function (r) {
    var uid = idOf(r.userId);
    return {
      id: tid + '_' + uid, tournamentId: tid, userId: uid,
      placement: (r.placement === undefined ? null : r.placement),
      wins: r.wins || 0,
      recAtEntry: r.recAtEntry !== false
    };
  });
  var matchRows = (payload.matchRows || []).map(function (r) {
    return {
      id: r.id, tournamentId: tid, round: r.round, stage: r.stage, matchIndex: r.matchIndex,
      player1Id: idOf(r.player1Id), player2Id: idOf(r.player2Id), winnerId: idOf(r.winnerId),
      isBye: r.isBye === true,
      player1SrcIndex: (r.player1SrcIndex === undefined ? null : r.player1SrcIndex),
      player2SrcIndex: (r.player2SrcIndex === undefined ? null : r.player2SrcIndex),
      videoUrl: r.videoUrl || '',
      playedAt: (r.playedAt === undefined ? null : r.playedAt)
    };
  });

  // 3) この大会の既存行を落として差し替える。
  //    ⚠️ archivedはクライアントの通常保存では送られてこないフィールド(archiveTournamentアクション専用)。
  //    素朴に行を丸ごと置き換えると保存のたびにarchivedがfalseへ戻り、削除(アーカイブ)済みの大会が
  //    誤って復元されてしまうため、既存行のarchived値をここで引き継ぐ。
  var existingTournaments = readSheet_('tournaments');
  var oldRow = existingTournaments.filter(function (t) { return t.id === tid; })[0];
  var newRow = payload.tournamentRow;
  newRow.archived = oldRow ? oldRow.archived : false;
  var updatedAt = stampUpdatedAt_(newRow);

  var poster = resolvePosterImage_(newRow, oldRow, payload.posterImageUpload, tid);

  var tournaments = existingTournaments.filter(function (t) { return t.id !== tid; });
  tournaments.push(newRow);
  writeSheet_('tournaments', tournaments);

  var entries = readSheet_('entries').filter(function (r) { return r.tournamentId !== tid; });
  writeSheet_('entries', entries.concat(entryRows));

  var matches = readSheet_('matches').filter(function (r) { return r.tournamentId !== tid; });
  writeSheet_('matches', matches.concat(matchRows));

  // 4) GitHubへ書き出す(usersも増えている可能性があるため含める)
  var tables = ['tournaments', 'entries', 'matches'];
  if (ensured.added.length) tables.unshift('users');
  exportTables_(tables, '大会を保存: ' + (payload.tournamentRow.title || tid));

  var result = {
    tournamentId: tid,
    entries: entryRows.length,
    matches: matchRows.length,
    addedUsers: ensured.added.length,
    // クライアントが「サーバーはこの時刻の内容になった」と記録するために返す。
    // これが無いと、GitHub Pagesへの反映が遅れている間に古い行を読んで
    // 「サーバーが変わった」と誤検出し、保存内容が巻き戻る
    updatedAt: updatedAt
  };
  if (poster.url) result.posterUrl = poster.url;
  if (poster.error) result.posterUploadError = poster.error;
  return result;
}

/**
 * ポスター画像の解決処理(actionSaveTournament_ / actionUpdateTournamentMeta_ 共通)。
 *
 * ⚠️ スプレッドシートは1セル50,000文字が上限。ポスター画像をdata URL(base64)のまま
 * セルへ直接保存すると、大きめの写真だとこの上限を超え、tournaments行の書き込みそのものが
 * 失敗して大会情報(heldAt/status/archived等)ごと空欄化してしまう不具合になっていた
 * (2026-07-27発覚)。まだアップロードされていない(data URLのままの)画像は、GitHubへ
 * 別ファイルとしてpushし、そのURLだけをシートに書く(URLなら十分短い)。
 *
 * newRow.posterImage を直接書き換える(呼び出し側はそのまま使う)。戻り値は
 * { url: <アップロードしたURL|null>, error: <失敗理由|null> }。
 */
function resolvePosterImage_(newRow, oldRow, posterImageUpload, tid) {
  var posterUploadedUrl = null, posterUploadError = null;
  if (posterImageUpload) {
    try {
      var m = String(posterImageUpload).match(/^data:[^;]+;base64,(.+)$/);
      if (!m) throw new Error('画像データの形式が不正です。');
      var base64Content = m[1];
      // resizeImageToDataUrl(900px/quality0.75)の出力なら通常十分収まる余裕を持った上限
      if (base64Content.length > 4000000) throw new Error('画像が大きすぎます。');
      var posterPath = 'posters/' + tid + '.jpg';
      pushBinaryToGitHub_(posterPath, base64Content, 'ポスター画像を更新: ' + (newRow.title || tid));
      posterUploadedUrl = 'https://raw.githubusercontent.com/' + prop_('GITHUB_OWNER') + '/' + prop_('GITHUB_REPO') + '/' + prop_('GITHUB_BRANCH', 'main') + '/' + posterPath;
      newRow.posterImage = posterUploadedUrl;
    } catch (e) {
      // 画像アップロードだけ失敗しても、大会情報の保存は止めない(直前の値を維持する)
      posterUploadError = String((e && e.message) || e);
      newRow.posterImage = oldRow ? oldRow.posterImage : null;
    }
  }
  // 古いキャッシュ済みクライアントが直接data URLを送ってきた場合の最後の安全策
  // (通常のクライアントはposterImageUploadを使うため、ここに来るのは想定外ケースのみ)
  if (newRow.posterImage && String(newRow.posterImage).length > 45000) {
    newRow.posterImage = oldRow ? oldRow.posterImage : null;
  }
  return { url: posterUploadedUrl, error: posterUploadError };
}

/**
 * tournaments行に updatedAt(サーバー時刻)を打つ。端末間同期の基準時刻。
 *
 * ⚠️ クライアントから送られてきた updatedAt は使わず、必ずここで上書きする。
 * 端末の時計がずれていると、クライアント側の「サーバーが自分の把握より新しいか」という
 * 大小比較が壊れるため。doPostはLockServiceで直列化されているので、ここで打つ限り
 * 「単一の書き手が単調増加の時刻を打つ」形になり、比較がサーバー時刻同士で閉じる。
 *
 * 戻り値: 打った時刻(呼び出し側がレスポンスへ含めてクライアントへ返すため)
 */
function stampUpdatedAt_(row) {
  row.updatedAt = new Date().toISOString();
  return row.updatedAt;
}

/**
 * action: updateTournamentMeta
 * payload = { tournamentRow, posterImageUpload }
 *
 * 大会の基本情報(タイトル・詳細・開催日・ポスター・公式/制限フラグ)だけを更新する。
 * entries/matchesシートには一切触れない(actionSaveTournament_と違い、参加者・対戦結果は
 * 保持したまま大会情報だけ更新したい場合に使う。呼び出し側はtournament-create.html(作成時)と
 * detail-view.jsの大会情報編集フォームのみ。entries/matchesを反映したい場合は
 * 必ずactionSaveTournament_を使うこと)。
 */
function actionUpdateTournamentMeta_(payload) {
  if (!payload || !payload.tournamentRow) throw new Error('保存する大会データがありません。');
  var tid = payload.tournamentRow.id;
  if (!tid) throw new Error('大会IDがありません。');

  var tournaments = readSheet_('tournaments');
  var oldRow = tournaments.filter(function (t) { return t.id === tid; })[0];
  var newRow = payload.tournamentRow;
  newRow.archived = oldRow ? oldRow.archived : false;
  var updatedAt = stampUpdatedAt_(newRow);

  var poster = resolvePosterImage_(newRow, oldRow, payload.posterImageUpload, tid);

  var rest = tournaments.filter(function (t) { return t.id !== tid; });
  rest.push(newRow);
  writeSheet_('tournaments', rest);
  exportTables_(['tournaments'], '大会情報を更新: ' + (newRow.title || tid));

  var result = { tournamentId: tid, metaOnly: true, updatedAt: updatedAt };
  if (poster.url) result.posterUrl = poster.url;
  if (poster.error) result.posterUploadError = poster.error;
  return result;
}

/**
 * 大会をアーカイブする(行削除ではなくarchived=trueを立てるだけ)。
 * entries/matchesには一切触れない(復元可能性を残すため)。
 */
function actionArchiveTournament_(payload) {
  if (!payload || !payload.tournamentId) throw new Error('tournamentIdが指定されていません。');
  var tid = payload.tournamentId;

  var tournaments = readSheet_('tournaments');
  var found = false, updatedAt = null;
  tournaments.forEach(function (t) {
    if (t.id === tid) { t.archived = true; updatedAt = stampUpdatedAt_(t); found = true; }
  });
  if (!found) throw new Error('大会が見つかりません: ' + tid);

  writeSheet_('tournaments', tournaments);
  exportTables_(['tournaments'], '大会をアーカイブ: ' + tid);

  return { tournamentId: tid, archived: true, updatedAt: updatedAt };
}

/* ============================================================
 * doPost (書き込みの唯一の入口)
 * ============================================================ */

/**
 * ⚠️ GASのContentServiceはHTTPステータスコードを変えられず、常に200を返す。
 *    そのため成否は必ずレスポンスボディの ok で判定すること(クライアント側も同様)。
 */
function doPost(e) {
  var email = null, action = null;
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('リクエストが空です。');
    var body = JSON.parse(e.postData.contents);
    action = body.action;

    // --- 防御線: ここを通らないと以降の処理には進めない ---
    email = verifyIdToken_(body.idToken);
    var role = assertAdmin_(email);

    if (action === 'ping') {
      return jsonResponse_({ ok: true, email: email, role: role });
    }

    // 同時書き込みでシートが壊れないよう直列化する
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('他の更新処理と競合しました。少し待ってからやり直してください。');
    try {
      var result;
      if (action === 'saveUsers')                result = actionSaveUsers_(body.payload);
      else if (action === 'saveTournament')       result = actionSaveTournament_(body.payload);
      else if (action === 'updateTournamentMeta') result = actionUpdateTournamentMeta_(body.payload);
      else if (action === 'archiveTournament')    result = actionArchiveTournament_(body.payload);
      else throw new Error('不明なaction: ' + action);

      writeAudit_(email, action, (body.payload && (
        (body.payload.tournamentRow && body.payload.tournamentRow.title) || body.payload.tournamentId
      )) || '');
      return jsonResponse_({ ok: true, email: email, role: role, result: result });
    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    var msg = String(err && err.message || err);
    if (err && err.isAuth) {
      writeAudit_(email || '(未認証)', 'DENIED:' + action, msg);
      return jsonResponse_({ ok: false, code: 'FORBIDDEN', error: msg });
    }
    Logger.log('doPost失敗: ' + msg);
    return jsonResponse_({ ok: false, code: 'ERROR', error: msg });
  }
}

/* ============================================================
 * セットアップ用(GASエディタから手動で1回だけ実行する)
 * ============================================================ */

/* ------------------------------------------------------------
 * GitHub → シート の取り込み
 *
 * このシステムは「シートが正本、GitHubはその書き出し先」という向きで動く。
 * したがって GitHub 側にだけ存在するデータがある状態で書き込みを行うと、
 * シートの内容(空)で上書きされてGitHub側が消える。
 * 移行時や、旧方式(アプリから直接GitHubへ書く)で更新した後は、必ず先にこれを実行すること。
 * ------------------------------------------------------------ */

/** GitHubから data/xxx.json を生JSONで取得する */
function readJsonFromGitHub_(path) {
  var res = UrlFetchApp.fetch(githubApiUrl_(path) + '?ref=' + prop_('GITHUB_BRANCH', 'main'), {
    headers: { Authorization: 'token ' + prop_('GITHUB_PAT'), Accept: 'application/vnd.github.raw' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 404) return [];
  if (code !== 200) throw new Error('GitHubからの取得に失敗(' + code + '): ' + path);
  var text = res.getContentText();
  return text.trim() ? JSON.parse(text) : [];
}

/**
 * 【変更なし・確認のみ】GitHubとシートの差分を報告する。
 * 取り込みや書き込みを行う前に、まずこれで状況を把握すること。
 */
function compareWithGitHub() {
  var out = [];
  DATA_SHEETS.forEach(function (name) {
    var sheetRows = readSheet_(name);
    var ghRows = readJsonFromGitHub_('data/' + name + '.json');
    var sIds = {}; sheetRows.forEach(function (r) { sIds[r.id] = true; });
    var gIds = {}; ghRows.forEach(function (r) { gIds[r.id] = true; });
    var onlyGh = ghRows.filter(function (r) { return !sIds[r.id]; });
    var onlySheet = sheetRows.filter(function (r) { return !gIds[r.id]; });

    var line = name + ': シート' + sheetRows.length + '行 / GitHub' + ghRows.length + '行';
    if (onlyGh.length)    line += '\n   ⚠️ GitHubにのみ存在(取り込まないと消える): ' + onlyGh.map(function (r) { return r.id; }).join(', ');
    if (onlySheet.length) line += '\n   ℹ️ シートにのみ存在(次の書き込みでGitHubへ反映される): ' + onlySheet.map(function (r) { return r.id; }).join(', ');
    if (!onlyGh.length && !onlySheet.length && sheetRows.length) line += ' ✅ id集合は一致';
    out.push(line);
  });
  Logger.log(out.join('\n'));
  return out;
}

/**
 * GitHubの data/*.json をシートへ取り込む(シートを上書きする)。
 * 上書き前の内容は実行ログへ出力するので、必要なら手動で復元できる。
 */
function importFromGitHub() {
  var out = [];
  DATA_SHEETS.forEach(function (name) {
    var before = readSheet_(name);
    if (before.length) {
      Logger.log('--- 上書き前の ' + name + ' (復元用) ---\n' + JSON.stringify(before));
    }
    var rows = readJsonFromGitHub_('data/' + name + '.json');
    writeSheet_(name, rows);
    out.push(name + ': ' + before.length + '行 → ' + rows.length + '行');
  });
  Logger.log('GitHub → シート の取り込みが完了しました。\n' + out.join('\n'));
  return out;
}

/**
 * デプロイ前の設定チェック。Script Propertiesの不足と、GitHub/シートへの到達性を確認する。
 * 実行ログに結果が出る。
 */
function checkConfig() {
  var out = [];
  var required = ['SPREADSHEET_ID', 'OAUTH_CLIENT_ID', 'GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO'];
  var props = PropertiesService.getScriptProperties();
  var missing = required.filter(function (k) { return !props.getProperty(k); });

  if (missing.length) {
    out.push('❌ 未設定のプロパティ: ' + missing.join(', '));
  } else {
    out.push('✅ Script Properties は揃っている');
  }

  try {
    var names = ss_().getSheets().map(function (s) { return s.getName(); });
    var need = DATA_SHEETS.concat(['admins', 'audit']);
    var lack = need.filter(function (n) { return names.indexOf(n) === -1; });
    out.push(lack.length ? '❌ 足りないシート: ' + lack.join(', ') : '✅ シートは揃っている (' + readSheet_('users').length + '人登録済み)');
  } catch (e) {
    out.push('❌ スプレッドシートを開けない: ' + e.message);
  }

  try {
    var admins = sheet_('admins').getDataRange().getValues().length - 1;
    out.push(admins > 0 ? '✅ adminsに' + admins + '件登録されている' : '❌ adminsシートが空です。自分のメールアドレスを登録してください');
  } catch (e) {
    out.push('❌ adminsシートを読めない: ' + e.message);
  }

  if (missing.indexOf('GITHUB_PAT') === -1 && missing.indexOf('GITHUB_OWNER') === -1) {
    try {
      var res = UrlFetchApp.fetch(githubApiUrl_('data/users.json') + '?ref=' + prop_('GITHUB_BRANCH', 'main'), {
        headers: { Authorization: 'token ' + prop_('GITHUB_PAT'), Accept: 'application/vnd.github+json' },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      out.push(code === 200 ? '✅ GitHubへ到達できる(data/users.json が見つかった)'
             : code === 404 ? '⚠️ GitHubへ到達できるが data/users.json が無い(初回書き込みで作成される)'
             : code === 401 ? '❌ GitHubの認証に失敗(PATが無効か権限不足)'
             : '❌ GitHub応答: ' + code);
    } catch (e) {
      out.push('❌ GitHubへの接続に失敗: ' + e.message);
    }
  }

  Logger.log(out.join('\n'));
  return out;
}

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

/**
 * 手作業でシートを直接編集した後に、GitHub側へ反映させるための実行用関数。
 * (シートを手で直しても、書き込みAPIを経由しない限りGitHub側は自動更新されないため)
 *
 * 事故防止のガードが働くため、対象テーブルが全部空だと中断される。
 * その場合は先に importFromGitHub() を実行して現状を取り込むこと。
 */
function pushSheetChangesToGitHub() {
  exportTables_(['tournaments', 'entries', 'matches'], '手動編集をGitHubへ反映');
  Logger.log('GitHubへの反映が完了しました。');
}

/**
 * ⚠️ 破壊的操作。シートが空でもGitHub側の安全チェック(exportTables_のforce)をスキップして
 * 常に上書きする。ゴミデータを一括削除したい場合、シート側の該当行を先に手で全部消してから
 * このままGASエディタで実行する(tournaments/entries/matchesの3シートが対象。実行するとGitHub側の
 * data/tournaments.json・entries.json・matches.jsonがシートの現在の内容==空、で上書きされる)。
 * 通常の運用では絶対に使わず、必ず pushSheetChangesToGitHub() を使うこと。
 */
function forcePushSheetChangesToGitHub() {
  exportTables_(['tournaments', 'entries', 'matches'], 'シートを空にしてGitHubへ強制反映(ゴミデータ削除)', true);
  Logger.log('GitHubへの強制反映が完了しました。');
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
