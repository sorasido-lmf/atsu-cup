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
      const err = new Error(data.error || '保存に失敗しました。');
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

  /** 大会をアーカイブする(行削除ではなくarchivedフラグを立てるだけ)。 */
  async function archiveTournament(tournamentId){
    return call('archiveTournament', { tournamentId });
  }

  return { canWrite, currentEmail, call, ping, saveUsers, saveTournament, archiveTournament };
})();
