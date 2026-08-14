// Google Identity Services(GIS)の薄いラッパー。
// 目的は「GASへ渡すIDトークンを取得すること」だけ。
//
// ⚠️ ここで取り出すメールアドレスは画面表示のためだけに使うこと。
//    トークンの正当性の検証は必ずGAS側(verifyIdToken_)で行う。
//    クライアント側のデコードは誰でも偽装できるため、権限判定には一切使わない。
const GoogleAuth = (function(){
  "use strict";

  const TOKEN_KEY = 'atsucup:idToken';
  // ログイン中に一度でもトークンを持ったことがあるかのマーカー。sessionExpired()が
  // 「未ログイン」と「ログインしていたが期限切れ」を区別するために使う(2026-07-27追加)。
  // ⚠️ 期限切れによるstoreToken('')ではクリアしない(そこがまさに検知したい状態のため)、
  // signOut()による明示的なログアウトでのみクリアする。
  const HAD_SESSION_KEY = 'atsucup:hadSession';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  // 期限のどれくらい前から再認証を試みるか。scheduleRenewal()とmaybeRenew()で共有する
  const RENEW_MARGIN_MS = 5 * 60 * 1000;
  // 再認証の試行間隔。maybeRenew()は1分ごとのポーリングから呼ばれるので、これが無いと
  // 「無音更新が絶対に成功しない環境」(FedCM無効・別ブラウザでGoogle未ログイン等)で
  // GISのpromptを1分おきに永久に叩き続けることになる。試行のたびに倍にして上限で頭打ちにし、
  // 成功したら最短に戻す
  const RENEW_COOLDOWN_MS = 60 * 1000;
  const RENEW_BACKOFF_MAX_MS = 10 * 60 * 1000;

  let gisLoaded = null;
  const listeners = []; // 複数ページ/複数機能が同時に購読できるようにする(単一のonChangeだと上書き事故が起きるため)

  function clientId(){
    const id = (typeof AtsuCupGasConfig !== 'undefined') && AtsuCupGasConfig.OAUTH_CLIENT_ID;
    if(!id) throw new Error('gas-config.js の OAUTH_CLIENT_ID が未設定です。');
    return id;
  }

  // GISのスクリプトを一度だけ読み込む
  function loadGis(){
    if(gisLoaded) return gisLoaded;
    gisLoaded = new Promise((resolve, reject)=>{
      if(window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement('script');
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('Googleログインの読み込みに失敗しました(ネットワークを確認してください)。'));
      document.head.appendChild(s);
    });
    return gisLoaded;
  }

  // JWTのpayloadを取り出す(表示用のみ。検証はしない)
  function decodePayload(jwt){
    try{
      const base = jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const json = decodeURIComponent(atob(base).split('').map(c=>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    }catch(e){ return null; }
  }

  function storedToken(){
    try{ return sessionStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; }
  }
  function storeToken(t){
    try{ t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); }catch(e){}
    if(t){
      try{ sessionStorage.setItem(HAD_SESSION_KEY, '1'); }catch(e){}
      renewBackoffMs = RENEW_COOLDOWN_MS; // 更新に成功したので試行間隔を最短に戻す
      scheduleRenewal(t);
    }
    notifyIfChanged();
  }

  /* ---------- リスナーへの通知 ----------
   * 🔴 通知は「ログイン状態(signedIn)またはアカウント(email)が実際に変わった時」だけに限る。
   *    トークン文字列が変わっただけの無音更新(attemptSilentRenewal)では通知しない。
   *
   *    理由: 購読者の1つが atsucup-core.js の reconcileAuthPoolWithServer() で、これは
   *    「サーバーに存在しないDB大会をこの端末から取り除く」処理。同ファイルのコメント通り
   *    **ログインした瞬間だけに限定する**という不変条件があり、無音更新のたびに走ると
   *    GitHub Pagesへの反映がまだ済んでいない大会を巻き込んで消しかねない。
   *    ほかに detail-view.js / users.html などが再描画を購読しており、編集中に
   *    再描画が割り込むのも防げる。ここを緩めると大会消失の経路が復活するので戻さないこと。
   */
  let lastNotified = null;
  function stateKey(s){ return (s.signedIn ? '1' : '0') + '\t' + s.email; }
  function notifyIfChanged(){
    const s = getState();
    const key = stateKey(s);
    if(lastNotified === key) return;
    lastNotified = key;
    listeners.forEach(fn=>{ try{ fn(s); }catch(e){ /* 1つのリスナーの例外で他を止めない */ } });
  }

  /* ---------- ベストエフォートの自動延長(2026-07-27追加 / 2026-08-14改修) ----------
   * GoogleのIDトークン自体の有効期限(~1時間)はアプリ側で延長できない固定値。できるのは
   * 「期限が来る前に google.accounts.id.prompt({auto_select:true}) で無音の再認証を試みる」
   * ことだけ。成功すればstoreToken()経由で無音更新される。
   *
   * ⚠️ 2026-08-14の改修: 以前は scheduleRenewal() が storeToken() からしか呼ばれておらず、
   *    このアプリはビルド無しのマルチページ構成なので**画面遷移のたびにsetTimeoutが消えて
   *    再スケジュールされず、実質機能していなかった**。ロード時の復元(bootRenewal)と、
   *    任意のタイミングから呼べる maybeRenew() を足してイベント駆動にしている。
   */
  let renewalTimer = null;
  let renewInFlight = false;
  let lastRenewAttempt = 0;
  let renewBackoffMs = RENEW_COOLDOWN_MS;
  let buttonRendered = false; // renderButton()で確実なログインボタンを出したページかどうか

  function scheduleRenewal(t){
    if(renewalTimer){ clearTimeout(renewalTimer); renewalTimer = null; }
    const p = decodePayload(t);
    if(!p || !p.exp) return;
    const msUntilRenewal = (p.exp * 1000) - Date.now() - RENEW_MARGIN_MS;
    // 既にマージンを割っている場合はここでは何もしない(maybeRenew()のポーリングが拾う)。
    // ここから直接呼ぶと storeToken → scheduleRenewal → 再認証 の連鎖になりうる
    if(msUntilRenewal <= 0) return;
    renewalTimer = setTimeout(()=>{ renewalTimer = null; attemptSilentRenewal(); }, msUntilRenewal);
  }

  async function attemptSilentRenewal(){
    // 確実なログインボタンを出しているページで、かつ未ログイン(＝ボタンが見えている)なら
    // 無音更新は試みない。initialize()を呼び直すと描画済みボタンの設定を上書きするため、
    // 「目の前にボタンがあるならそれを押してもらう」方を優先する
    if(buttonRendered && !isSignedIn()) return;
    if(renewInFlight) return;
    if(Date.now() - lastRenewAttempt < renewBackoffMs) return;
    renewInFlight = true;
    lastRenewAttempt = Date.now();
    // 試すたびに間隔を倍にする。成功すればstoreToken()が最短に戻す
    renewBackoffMs = Math.min(renewBackoffMs * 2, RENEW_BACKOFF_MAX_MS);
    try{
      await loadGis();
      google.accounts.id.initialize({
        client_id: clientId(),
        callback: (res)=>{ if(res && res.credential) storeToken(res.credential); },
        auto_select: true,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true
      });
      // 結果は問わない(ベストエフォート)。FedCM有効時は notification の
      // isNotDisplayed()/isSkippedMoment() が例外を投げる仕様なので、そもそも判定に使わない。
      // 失敗した場合は上のバックオフが次の試行を遅らせ、成功した場合はcallbackが走る
      google.accounts.id.prompt();
    }catch(e){ /* 無音で失敗を許容(バックオフ済み) */ }
    finally{ renewInFlight = false; }
  }

  /**
   * 「今、再認証を試みるべきか」を判定して必要なら試みる。冪等で、どこから何度呼んでもよい。
   * atsucup-core.js のセッションバナーが1分ごと + 画面復帰時に呼ぶ。
   */
  function maybeRenew(){
    // 明示ログアウト済み(hadSessionが無い)なら何もしない。
    // ⚠️ 一度もログインしていない人に勝手にOne Tapを出さないための必須ガード
    let had = false;
    try{ had = sessionStorage.getItem(HAD_SESSION_KEY) === '1'; }catch(e){}
    if(!had) return;

    const t = storedToken();
    if(t && !isExpired(t)){
      const p = decodePayload(t);
      const msLeft = (p && p.exp) ? (p.exp * 1000 - Date.now()) : 0;
      if(msLeft > RENEW_MARGIN_MS){
        // まだ余裕がある。画面遷移でタイマーが失われている場合の保険として張り直すだけ
        if(!renewalTimer) scheduleRenewal(t);
        return;
      }
    }
    // 期限が近い、または既に切れている(切れた後も諦めずに無音復帰を試みる)
    attemptSilentRenewal();
  }

  // 期限切れ(約1時間)のトークンは無効として扱う
  function isExpired(jwt){
    const p = decodePayload(jwt);
    if(!p || !p.exp) return true;
    return p.exp * 1000 <= Date.now();
  }

  function getIdToken(){
    const t = storedToken();
    if(!t) return '';
    if(isExpired(t)){ storeToken(''); return ''; }
    return t;
  }

  function isSignedIn(){ return !!getIdToken(); }

  function getEmail(){
    const t = getIdToken();
    if(!t) return '';
    const p = decodePayload(t);
    return (p && p.email) || '';
  }

  function getState(){
    return { signedIn: isSignedIn(), email: getEmail() };
  }

  /**
   * ログインする。GISのポップアップでアカウントを選ばせ、IDトークンを取得する。
   * 既に有効なトークンがあればそれを返す。
   */
  async function signIn(){
    const existing = getIdToken();
    if(existing) return existing;

    await loadGis();
    return new Promise((resolve, reject)=>{
      let settled = false;
      try{
        google.accounts.id.initialize({
          client_id: clientId(),
          callback: (res)=>{
            settled = true;
            if(res && res.credential){ storeToken(res.credential); resolve(res.credential); }
            else reject(new Error('ログインに失敗しました。'));
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true
        });
        // One Tapが出せない環境(サードパーティCookie無効など)ではボタン方式へ促す
        google.accounts.id.prompt((notification)=>{
          if(settled) return;
          try{
            if(notification.isNotDisplayed && notification.isNotDisplayed()){
              reject(new Error('ログイン画面を表示できませんでした。renderButton()でボタンを設置してください。'));
            }else if(notification.isSkippedMoment && notification.isSkippedMoment()){
              reject(new Error('ログインがキャンセルされました。'));
            }
          }catch(e){ /* FedCM有効時は判定できない。callbackの到着を待つ */ }
        });
      }catch(e){ reject(e); }
    });
  }

  /**
   * 「Googleでログイン」ボタンを指定要素に描画する。
   * One Tapが使えない環境ではこちらが確実。
   */
  async function renderButton(el, opts){
    await loadGis();
    google.accounts.id.initialize({
      client_id: clientId(),
      callback: (res)=>{ if(res && res.credential) storeToken(res.credential); },
      auto_select: false,
      use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton(el, Object.assign({
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ja'
    }, opts || {}));
    // このページには確実なログインボタンがある。attemptSilentRenewal()が
    // initialize()を呼び直してこの設定を上書きしないようにするための目印
    buttonRendered = true;
  }

  function signOut(){
    // ⚠️ storeToken('')より先にマーカーを消す。順序を逆にすると、通知を受けた
    //    セッション切れバナーが sessionExpired()===true を見て一瞬表示されてしまう
    try{ sessionStorage.removeItem(HAD_SESSION_KEY); }catch(e){}
    storeToken('');
    if(renewalTimer){ clearTimeout(renewalTimer); renewalTimer = null; }
    renewBackoffMs = RENEW_COOLDOWN_MS;
    try{ if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); }catch(e){}
  }

  // 「未ログイン」なのか「ログインしていたが期限切れになった」なのかを区別する。
  // detail-view.js/tournament-entry.htmlのreadOnly表示で、後者の場合だけ再ログインを促す
  // バナーを出すために使う(2026-07-27追加)。
  function sessionExpired(){
    if(isSignedIn()) return false;
    try{ return sessionStorage.getItem(HAD_SESSION_KEY) === '1'; }catch(e){ return false; }
  }

  // ログイン状態が変わったときに呼ばれるコールバックを登録する(複数登録可)。解除関数を返す。
  function onStateChange(fn){
    listeners.push(fn);
    return ()=>{ const i=listeners.indexOf(fn); if(i>=0) listeners.splice(i,1); };
  }

  // ページ読み込み時の初期化。
  // (1) 通知の基準値を「今の状態」に合わせる(ロード直後に空の通知を出さないため)
  // (2) 有効なトークンが残っていれば自動延長タイマーを張り直す。これが無いと、
  //     画面遷移のたびにタイマーが失われて自動延長が働かない
  (function bootRenewal(){
    lastNotified = stateKey(getState());
    const t = storedToken();
    if(t && !isExpired(t)) scheduleRenewal(t);
  })();

  return { signIn, signOut, renderButton, getIdToken, isSignedIn, getEmail, getState,
           onStateChange, loadGis, sessionExpired, maybeRenew };
})();
