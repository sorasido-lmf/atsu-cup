// data/*.json をGitHub API(Contents API)経由で読み書きする共通モジュール。
// トークンはこの端末のlocalStorageにのみ保存し、リポジトリには含めない。
const GitHubDB = (function(){
  "use strict";

  const OWNER = "sorasido-lmf";
  const REPO = "atsu-cup";
  const BRANCH = "main";
  const PAT_KEY = "atsucup:githubPat";

  function getToken(){ return localStorage.getItem(PAT_KEY) || ""; }
  function setToken(t){ localStorage.setItem(PAT_KEY, (t||"").trim()); }
  function clearToken(){ localStorage.removeItem(PAT_KEY); }
  function hasToken(){ return !!getToken(); }

  function authHeaders(){
    const token = getToken();
    if(!token) throw new Error("GitHubトークンが未設定です。設定画面からトークンを登録してください。");
    return { "Authorization": `token ${token}`, "Accept": "application/vnd.github+json" };
  }
  // 読み取り専用: リポジトリはPublicなのでトークンが無くても取得できる(あれば付ける。レート制限が緩和される)
  function readHeaders(){
    const token = getToken();
    const h = { "Accept": "application/vnd.github+json" };
    if(token) h["Authorization"] = `token ${token}`;
    return h;
  }

  function contentsUrl(path){
    return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  }

  // 日本語を含むUTF-8文字列をbase64に/から変換する
  function b64EncodeUnicode(str){
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64DecodeUnicode(str){
    return decodeURIComponent(escape(atob(str)));
  }

  // path配下のJSONを取得する。ファイルが存在しない場合は空配列として扱う
  async function getFile(path){
    const res = await fetch(`${contentsUrl(path)}?ref=${BRANCH}&t=${Date.now()}`, { headers: readHeaders() });
    if(res.status === 404){ return { data: [], sha: null }; }
    if(!res.ok){ throw new Error(`GitHubからの取得に失敗しました(status ${res.status})`); }
    const json = await res.json();
    const text = b64DecodeUnicode(json.content.replace(/\n/g, ''));
    return { data: JSON.parse(text), sha: json.sha };
  }

  // path配下のJSONを更新/新規作成する。既存ファイルの更新にはshaが必要(なければ新規作成扱い)
  async function putFile(path, dataObj, message, sha){
    const body = {
      message,
      content: b64EncodeUnicode(JSON.stringify(dataObj, null, 2) + "\n"),
      branch: BRANCH
    };
    if(sha) body.sha = sha;
    const res = await fetch(contentsUrl(path), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      if(res.status === 409){ throw new Error("他の端末が同時に更新したため保存できませんでした。もう一度「取り込む」からやり直してください。"); }
      throw new Error(`GitHubへの保存に失敗しました(status ${res.status})`);
    }
    return res.json();
  }

  async function testConnection(){
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: authHeaders() });
    if(!res.ok){ throw new Error(`接続確認に失敗しました(status ${res.status})。トークンや権限(repoスコープ・コラボレーター権限)を確認してください。`); }
    const json = await res.json();
    return { fullName: json.full_name, private: json.private };
  }

  // 指定プレフィックスで、既存idと衝突しない新しいidを発行する(例: genId('u', existingIds) -> "u0005")
  function genId(prefix, existingIds){
    let n = 1, id;
    do{ id = prefix + String(n).padStart(4, '0'); n++; }while(existingIds.has(id));
    return id;
  }

  return { OWNER, REPO, BRANCH, getToken, setToken, clearToken, hasToken, getFile, putFile, testConnection, genId };
})();
