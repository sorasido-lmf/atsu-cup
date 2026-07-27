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
      scheduleRenewal(t);
    }
    const s = getState();
    listeners.forEach(fn=>{ try{ fn(s); }catch(e){ /* 1つのリスナーの例外で他を止めない */ } });
  }

  // ⚠️ ベストエフォートの自動延長(2026-07-27追加)。GoogleのIDトークン自体の有効期限
  // (~1時間)はアプリ側で延長できない固定値だが、期限が近づいたら裏で
  // google.accounts.id.prompt({auto_select:true})による無音の再認証を一度だけ試みる。
  // 成功すればstoreToken()経由で無音更新される。FedCM/サードパーティCookieの状態次第で
  // 失敗することもあるが、失敗しても何もしない(sessionExpired()のバナー表示が保険として機能する)。
  let renewalTimer = null;
  function scheduleRenewal(t){
    if(renewalTimer){ clearTimeout(renewalTimer); renewalTimer = null; }
    const p = decodePayload(t);
    if(!p || !p.exp) return;
    const msUntilRenewal = (p.exp * 1000) - Date.now() - 5*60*1000; // 期限の5分前を目安に試みる
    if(msUntilRenewal <= 0) return;
    renewalTimer = setTimeout(()=>{ attemptSilentRenewal(); }, msUntilRenewal);
  }
  async function attemptSilentRenewal(){
    try{
      await loadGis();
      google.accounts.id.initialize({
        client_id: clientId(),
        callback: (res)=>{ if(res && res.credential) storeToken(res.credential); },
        auto_select: true,
        cancel_on_tap_outside: true
      });
      google.accounts.id.prompt(); // 結果は問わない(ベストエフォート)
    }catch(e){ /* 無音で失敗を許容 */ }
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
          cancel_on_tap_outside: true
        });
        // One Tapが出せない環境(サードパーティCookie無効など)ではボタン方式へ促す
        google.accounts.id.prompt((notification)=>{
          if(settled) return;
          if(notification.isNotDisplayed && notification.isNotDisplayed()){
            reject(new Error('ログイン画面を表示できませんでした。renderButton()でボタンを設置してください。'));
          }else if(notification.isSkippedMoment && notification.isSkippedMoment()){
            reject(new Error('ログインがキャンセルされました。'));
          }
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
      auto_select: false
    });
    google.accounts.id.renderButton(el, Object.assign({
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ja'
    }, opts || {}));
  }

  function signOut(){
    storeToken('');
    try{ sessionStorage.removeItem(HAD_SESSION_KEY); }catch(e){}
    if(renewalTimer){ clearTimeout(renewalTimer); renewalTimer = null; }
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

  return { signIn, signOut, renderButton, getIdToken, isSignedIn, getEmail, getState, onStateChange, loadGis, sessionExpired };
})();
