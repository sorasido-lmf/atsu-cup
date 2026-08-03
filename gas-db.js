// GASのWebアプリを呼び出すモジュール。github-db.js の書き込み側を置き換える。
//
// 読み込みは従来どおり GitHub Pages の静的 data/*.json を使う(このモジュールは書き込み専用)。
const GasDB = (function(){
  "use strict";

  function gasUrl(){
    const url = (typeof AtsuCupGasConfig !== 'undefined') && AtsuCupGasConfig.GAS_URL;
    if(!url) throw new Error('gas-config.js の GAS_URL が未設定です。');
    return url;
  }

  // 書き込みにはログインが必要。呼び出し側はこれで可否を判定する。
  function canWrite(){ return typeof GoogleAuth !== 'undefined' && GoogleAuth.isSignedIn(); }
  function currentEmail(){ return typeof GoogleAuth !== 'undefined' ? GoogleAuth.getEmail() : ''; }

  /* ---------- 役割(role)のキャッシュ ----------
   * adminsシートの role は ping の応答にしか含まれない。毎ページGASを叩くと
   * コールドスタートで遅く実行クォータも食うので、sessionStorage に持つ。
   * ⚠️ これは**UIの出し分け専用**。権限の実体は gas/Code.gs 側にあり、
   *    ここを書き換えても saveUsers の既存行変更はサーバーで無視される。
   * キーにメールアドレスを含めるのは、別アカウントでログインし直した時に
   * 前のアカウントの役割を使い回してしまわないようにするため。 */
  const ROLE_KEY = 'atsucup:role';
  function readRoleCache(){
    try{ return JSON.parse(sessionStorage.getItem(ROLE_KEY) || 'null'); }catch(e){ return null; }
  }
  /** 同期。キャッシュ済みなら 'admin'/'editor' 等、未確定なら null */
  function getRole(){
    if(!canWrite()) return null;
    const c = readRoleCache();
    return (c && c.email && c.email === currentEmail()) ? (c.role || null) : null;
  }
  function clearRole(){ try{ sessionStorage.removeItem(ROLE_KEY); }catch(e){} }
  let rolePending = null;
  /** 非同期。未確定なら ping を1回だけ投げて確定させる。失敗しても投げない(nullを返す) */
  async function ensureRole(){
    if(!canWrite()) return null;
    const cached = getRole();
    if(cached) return cached;
    if(rolePending) return rolePending;
    rolePending = ping().then(r=>{
      try{ sessionStorage.setItem(ROLE_KEY, JSON.stringify({ email: r.email, role: r.role })); }catch(e){}
      return r.role || null;
    }).catch(()=> null).then(v=>{ rolePending = null; return v; });
    return rolePending;
  }

  /**
   * GASへPOSTする。
   *
   * ⚠️ Content-Type に application/json を使ってはいけない。
   *    preflight(OPTIONS)が飛ぶが、GASはOPTIONSを処理できずCORSで失敗する。
   *    text/plain にして「単純リクエスト」に保ち、GAS側で JSON.parse させる。
   *
   * ⚠️ GASは常にHTTP 200を返す(ContentServiceはステータスコードを変えられない)。
   *    したがって成否は res.ok ではなく、本文の ok で判定する。
   */
  async function call(action, payload){
    const idToken = GoogleAuth.getIdToken();
    if(!idToken) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');

    let res;
    try{
      res = await fetch(gasUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ idToken, action, payload })
      });
    }catch(e){
      throw new Error('サーバーへ接続できませんでした(ネットワークを確認してください)。');
    }

    let data;
    try{
      data = await res.json();
    }catch(e){
      throw new Error('サーバーの応答を解釈できませんでした。GASのデプロイ設定を確認してください。');
    }

    if(!data.ok){
      // 認証・権限エラーは呼び出し側で再ログイン導線に使えるよう印を付ける
      // ⚠️ GASがerrorを返さないケースが実際にあり、「保存に失敗しました」としか出ずに
      //    原因を追えなくなった(2026-07-28)。手掛かりになる値を必ず文言に混ぜる
      const detail = data.error || `原因不明(HTTP ${res.status} / code=${data.code || 'なし'} / action=${action})`;
      const err = new Error(detail);
      err.code = data.code || 'ERROR';
      if(err.code === 'FORBIDDEN') err.needsAuth = true;
      throw err;
    }
    return data.result;
  }

  /** 接続と権限の確認。成功すると {email, role} が返る。 */
  async function ping(){
    const idToken = GoogleAuth.getIdToken();
    if(!idToken) throw new Error('ログインしていません。');
    const res = await fetch(gasUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ idToken, action: 'ping' })
    });
    const data = await res.json();
    if(!data.ok) { const e = new Error(data.error); e.code = data.code; throw e; }
    return { email: data.email, role: data.role };
  }

  /** ユーザーマスタ(名前キー)をまとめて送る。ID採番はGAS側が行う。 */
  async function saveUsers(users){
    return call('saveUsers', { users });
  }

  /**
   * 大会を保存する。
   * entryRows.userId / matchRows.player*Id には「名前」を入れて送り、
   * GAS側で名前→IDへ解決させる(未登録の参加者はそこで採番される)。
   */
  async function saveTournament(bundle){
    return call('saveTournament', Object.assign({ keyedBy: 'name' }, bundle));
  }

  /**
   * 大会の基本情報(タイトル・詳細・開催日・ポスター・フラグ)だけを更新する。
   * entries/matchesには一切触れない(参加者名を含まないため keyedBy は不要)。
   */
  async function updateTournamentMeta(bundle){
    return call('updateTournamentMeta', bundle);
  }

  /** 大会をアーカイブする(行削除ではなくarchivedフラグを立てるだけ)。 */
  async function archiveTournament(tournamentId){
    return call('archiveTournament', { tournamentId });
  }

  // ログアウト/アカウント切替に追従してキャッシュを捨てる(登録時には発火しない)
  if(typeof GoogleAuth !== 'undefined' && GoogleAuth.onStateChange){
    GoogleAuth.onStateChange((s)=>{ if(!s || !s.signedIn) clearRole(); });
  }

  return { canWrite, currentEmail, getRole, ensureRole, clearRole,
           call, ping, saveUsers, saveTournament, updateTournamentMeta, archiveTournament };
})();
