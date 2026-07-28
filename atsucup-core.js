// あつ杯ツール共通のstate管理・データロジック(全ページで共有、この端末のlocalStorageだけで完結)
const AtsuCup = (function(){
  "use strict";

  const STORE_KEY = "atsucup:state:v2";

  // 複数の大会を同時に進行できるよう、各大会が自分の進行データ(people/matches等)を持つ。
  // 端末共通のデータ(roster/userRecDefaults/archivedUsers)だけstate直下に置く。
  const state = {
    // ---- 認証プール: ログイン中に使う。data/*.json(スプレッドシート)由来 + GASへ保存する対象 ----
    roster: [],       // [name, ...] この端末に登録済みの参加者マスタ(大会をまたいで再利用)
    userRecDefaults: {}, // {name: boolean} ユーザーごとの撮影可否デフォルト値
    archivedUsers: {}, // {name: boolean} アーカイブ済みユーザー
    tournaments: [],  // [{id,title,details,posterUrl,createdAt,status,people,order,remaining,matches,winnerName,thirdPlaceMatch}]
    // {tournamentId: {sig, updatedAt}} 「この端末が最後に把握しているサーバー側の状態」。
    //   sig       : AtsuCupData.syncSignatureOf() で作った、その時点のサーバー内容の署名
    //   updatedAt : その内容のサーバー側更新時刻(GASが打ったISO文字列。''=不明な旧行)
    // ローカル/サーバーそれぞれが前回時点から変わったかを判定する基準値。
    // ⚠️ 旧 remoteSnapshots(生JSON文字列)から置き換え。sigとupdatedAtを1本にまとめてあるのは、
    //    大会を消すときに片方だけ消し忘れる事故を防ぐため(delete state.remoteMeta[id] の1箇所で済む)
    remoteMeta: {},
    // ---- ゲストプール: 未ログイン時の練習用。この端末だけ。サーバーへは絶対に出さない ----
    guestRoster: [],
    guestUserRecDefaults: {},
    guestArchivedUsers: {},
    guestTournaments: [],
    // ---- 共通のアクティブ大会ポインタ(どちらのプールの大会かを activePool が示す) ----
    activeId: null,   // 現在操作対象の大会id(各画面が ?id= から setActive でセット)
    activePool: 'auth' // 'auth' | 'guest'
  };

  // ログイン状態の判定はGoogleAuthに一本化する(サーバー側の許可判定はGAS側のallowlistが正、ここは表示/出し分けのみに使う)
  function signedIn(){ return typeof GoogleAuth !== 'undefined' && GoogleAuth.isSignedIn(); }
  function currentPoolKind(){ return signedIn() ? 'auth' : 'guest'; }
  function isGuestMode(){ return currentPoolKind() === 'guest'; }
  function tournamentsOf(kind){ return kind === 'guest' ? state.guestTournaments : state.tournaments; }
  // roster/userRecDefaults/archivedUsers/tournaments への「生きた」参照をまとめて返す(呼び出し側は
  // render/handler関数の内側で毎回呼ぶこと。トップレベルでキャッシュするとログイン状態変化に追従しない)
  function poolOf(kind){
    const guest = kind === 'guest';
    return {
      kind,
      get roster(){ return guest ? state.guestRoster : state.roster; },
      set roster(v){ if(guest) state.guestRoster = v; else state.roster = v; },
      get userRecDefaults(){ return guest ? state.guestUserRecDefaults : state.userRecDefaults; },
      set userRecDefaults(v){ if(guest) state.guestUserRecDefaults = v; else state.userRecDefaults = v; },
      get archivedUsers(){ return guest ? state.guestArchivedUsers : state.archivedUsers; },
      set archivedUsers(v){ if(guest) state.guestArchivedUsers = v; else state.archivedUsers = v; },
      get tournaments(){ return tournamentsOf(kind); },
      set tournaments(v){ if(guest) state.guestTournaments = v; else state.tournaments = v; }
    };
  }
  function pool(){ return poolOf(currentPoolKind()); }
  function authPool(){ return poolOf('auth'); }
  function guestPool(){ return poolOf('guest'); }
  function poolKindOfTournamentId(id){
    if(!id) return null;
    if(state.guestTournaments.some(t=>t.id===id)) return 'guest';
    if(state.tournaments.some(t=>t.id===id)) return 'auth';
    return null;
  }
  function guestPoolHasData(){ return !!(state.guestRoster.length || state.guestTournaments.length); }

  function activeT(){ return tournamentsOf(state.activePool || 'auth').find(t=>t.id===state.activeId) || null; }
  function setActive(id){
    if(!id){ state.activeId = null; state.activePool = currentPoolKind(); return; }
    state.activeId = id;
    state.activePool = poolKindOfTournamentId(id) || currentPoolKind();
  }
  function newBlankTournament(meta){
    return {
      id: meta.id, title: meta.title||"", details: meta.details||"", posterUrl: meta.posterUrl||null,
      createdAt: meta.createdAt || new Date().toISOString(), status: 'ongoing',
      isOfficial: !!meta.isOfficial, isRestricted: !!meta.isRestricted,
      people: [], order: [], remaining: [], matches: [], winnerName: "", thirdPlaceMatch: null,
      // 作成直後はまだサーバーへ一度も反映できていない(=falseの間はpruneTournamentsGoneFromServerの対象外にする)。
      // 保存成功時・リモートからの取り込み時にtrueへ切り替える
      everSyncedToServer: false
    };
  }

  // 既存コードの state.people / matches 等の参照を、アクティブな大会に転送する(getter/setter)。
  // enumerable:false なので JSON.stringify(state) には出ず、実データは tournaments 配列にのみ保存される。
  ['people','order','remaining','matches'].forEach(key=>{
    Object.defineProperty(state, key, {
      enumerable:false,
      get(){ const t=activeT(); return t ? t[key] : []; },
      set(v){ const t=activeT(); if(t) t[key]=v; }
    });
  });
  Object.defineProperty(state, 'winnerName', {
    enumerable:false,
    get(){ const t=activeT(); return t ? t.winnerName : ""; },
    set(v){ const t=activeT(); if(t) t.winnerName=v; }
  });
  Object.defineProperty(state, 'thirdPlaceMatch', {
    enumerable:false,
    get(){ const t=activeT(); return t ? t.thirdPlaceMatch : null; },
    set(v){ const t=activeT(); if(t) t.thirdPlaceMatch=v; }
  });
  Object.defineProperty(state, 'tournamentMeta', {
    enumerable:false,
    get(){
      const t=activeT();
      return t
        ? {id:t.id,title:t.title,details:t.details,posterUrl:t.posterUrl,createdAt:t.createdAt,isOfficial:!!t.isOfficial,isRestricted:!!t.isRestricted}
        : {id:null,title:"",details:"",posterUrl:null,createdAt:null,isOfficial:false,isRestricted:false};
    },
    set(v){
      if(!v || !v.title){ state.activeId = null; return; } // 空メタ代入はアクティブ解除(旧endの名残)
      const kind = poolKindOfTournamentId(v.id);
      const existing = kind ? tournamentsOf(kind).find(t=>t.id===v.id) : null;
      if(existing){
        existing.title=v.title; existing.details=v.details; existing.posterUrl=v.posterUrl;
        existing.createdAt = v.createdAt || existing.createdAt;
        existing.isOfficial = !!v.isOfficial; existing.isRestricted = !!v.isRestricted;
        state.activeId=existing.id; state.activePool=kind;
      }
      else {
        const nt=newBlankTournament(v);
        const k = currentPoolKind();
        tournamentsOf(k).push(nt);
        state.activeId=nt.id; state.activePool=k;
      }
    }
  });
  // 後方互換: state.history は「終了済みの大会」を旧history形式(participants/championName)で見せる。
  // ゲスト/認証済み両プールにまたがって扱う(detail-view.jsのfindHistory/削除処理がプールを意識せず動くように)。
  Object.defineProperty(state, 'history', {
    enumerable:false,
    get(){
      const map = t=>({
        id:t.id, title:t.title, details:t.details, posterUrl:t.posterUrl, createdAt:t.createdAt,
        finished:!!t.winnerName, championName:t.winnerName||null,
        isOfficial:!!t.isOfficial, isRestricted:!!t.isRestricted,
        matches:t.matches, thirdPlaceMatch:t.thirdPlaceMatch, participants:t.people
      });
      return state.guestTournaments.filter(t=>t.status==='completed').map(map)
        .concat(state.tournaments.filter(t=>t.status==='completed').map(map));
    },
    set(v){
      // 「state.history = state.history.filter(...)」による削除に対応(渡された配列に無いcompletedを削除)
      const keep = new Set((v||[]).map(h=>h.id));
      state.guestTournaments = state.guestTournaments.filter(t=> t.status!=='completed' || keep.has(t.id));
      state.tournaments = state.tournaments.filter(t=> t.status!=='completed' || keep.has(t.id));
    }
  });

  let persistFailWarned = false;
  function persist(){
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }catch(e){
      // 容量オーバー等で保存に失敗した場合、ポスター画像を除いてでも他の進行状況(参加者・対戦表・結果)は必ず保存する
      try{
        const fallback = {
          ...state, // enumerableな実データ(roster/userRecDefaults/archivedUsers/tournaments/guest*/activeId等)のみ
          tournaments: state.tournaments.map(t=>({ ...t, posterUrl: null })),
          guestTournaments: state.guestTournaments.map(t=>({ ...t, posterUrl: null }))
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(fallback));
        console.error('[atsucup] persist: quota exceeded, saved without local poster image', e);
      }catch(e2){
        console.error('[atsucup] persist failed completely:', e2);
        if(!persistFailWarned){
          persistFailWarned = true;
          alert('この端末への保存に失敗しました(空き容量不足、またはプライベートブラウジング等でこの端末への保存が無効になっている可能性があります)。直前の操作が保存されていない場合があるので、画面を切り替える前に一度リロードして反映されているか確認してください。');
        }
      }
    }
  }

  function restore(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(raw) migrate(JSON.parse(raw));
    }catch(e){}
    // 各大会の参加者で、登録者マスタ(roster)に無い人がいれば反映しておく(認証済み/ゲスト、互いに混ぜない)
    const rosterSet = new Set(state.roster);
    state.tournaments.forEach(t=>{
      (t.people||[]).forEach(p=>{ if(!rosterSet.has(p.name)){ state.roster.push(p.name); rosterSet.add(p.name); } });
    });
    const guestRosterSet = new Set(state.guestRoster);
    state.guestTournaments.forEach(t=>{
      (t.people||[]).forEach(p=>{ if(!guestRosterSet.has(p.name)){ state.guestRoster.push(p.name); guestRosterSet.add(p.name); } });
    });
    enforceGuestSeparation();
  }

  /* ---------- data/*.json(GitHub側=正) の取り込み ---------- */
  const DATA_PATHS = { users:'data/users.json', tournaments:'data/tournaments.json', entries:'data/entries.json', matches:'data/matches.json' };

  // リモートの大会をローカルへ取り込む。
  //
  // ⚠️ 以前は同じidをリモートで無条件に上書きしていたが、これだと「保存ボタンを押すまでの
  // 進行状況」がページを開くたびに直前の保存内容へ引き戻されてしまう(2026-07-26に実際の
  // 不具合として発覚)。そこで一旦「ローカルに既に同じidがあれば一切触らない」方針にしたが、
  // 今度は逆に「他端末で保存した内容がいつまで経っても反映されない」「スプレッドシートを
  // 作り直しても古いキャッシュのまま」という不具合(2026-07-27夜に発覚)を生んでいた。
  //
  // ⚠️ 現方式(2026-07-28): `state.remoteMeta[id]`に「この端末が最後に把握しているサーバーの状態」
  // (署名 sig + サーバー更新時刻 updatedAt)を保持し、ローカル・サーバーそれぞれが前回時点から
  // 変わったかを判定して3つに分類する:
  //   ・この端末だけ変更 → 何もしない(次の保存で反映される)
  //   ・他の端末だけ変更 → 自動で取り込む
  //   ・両方変更(競合)  → ローカルを保護し、ユーザーに選ばせる(showSyncConflictModal)
  //
  // ⚠️ 比較には必ず AtsuCupData.syncSignatureOf() を使うこと。アプリ内部の大会オブジェクトを
  // そのままJSON.stringifyして比べると、内容が同じでも必ず不一致になる(remaining/matchesの深さ/
  // byeキーの有無がローカルとtoAppTournamentsで構造的に違うため)。詳細は syncSignatureOf の
  // コメント参照。2026-07-27〜28に「他端末の保存が永久に反映されない」不具合の真因だった。
  //
  // このidを一度も取り込んだことが無い(=`remoteMeta[id]`が無い)場合は、上記の判定基準が
  // まだ無いため、従来通り「ローカルに守るべき進行状況が無い場合のみ上書きする」保守的な
  // 判定にフォールバックする(このコード更新の直後の初回読み込みや、大会作成直後で
  // まだ一度もリモートから取り込んでいない大会が誤って巻き込まれないようにするため)。
  //
  // ⚠️ ゲスト/認証済みプール分離(2026-07-27)の`clearGuestPool()`は、この「ローカル進行状況を
  // 黙って失わせない」原則の**唯一の、ユーザーが明示的にタップした場合だけの例外**。
  // ログインした瞬間にゲストプールだけを削除する(認証プールには一切触れない)、かつ
  // 削除前に非ダイスミスの確認バナーでユーザーの明示操作を必須にしている。詳細は
  // enforceGuestSeparation()/clearGuestPool()を参照。
  // 大会に「守るべき進行状況」が有るかどうか(参加者・対戦が1件でもあれば有り)
  function hasProgress(t){
    return !!((t && t.people && t.people.length) || (t && t.matches && t.matches.length));
  }
  // サーバー側の更新時刻が、この端末が最後に把握している時刻より「厳密に新しい」か。
  // 判定できない(どちらかが空の旧行など)場合は null を返し、呼び出し側で内容比較へ倒す。
  //
  // ⚠️ 不一致ではなく大小比較にすること。GAS保存→GitHubコミット→Pages反映には数十秒〜数分の
  //    遅延があり、保存直後のリロードでは「自分が保存する前の古い行」が返ってくる。
  //    不一致で判定すると、この古い行を「サーバーが変わった」と誤検出して自分の保存内容を
  //    巻き戻してしまう(2026-07-27に実際に起きた「保存した大会が直後のリロードで消える」)。
  function isRemoteNewer(remoteUpdatedAt, knownUpdatedAt){
    if(!remoteUpdatedAt || !knownUpdatedAt) return null;
    const r = new Date(remoteUpdatedAt).getTime(), k = new Date(knownUpdatedAt).getTime();
    if(isNaN(r) || isNaN(k)) return null;
    return r > k;
  }

  // リモートの大会をローカルへ取り込む。差異を3つに分類して扱う(2026-07-28方針):
  //   ・この端末だけ変更 → 何もしない(次の保存で反映される)
  //   ・他の端末だけ変更 → 自動で取り込む(モーダル無し)
  //   ・両方変更(競合)  → ローカルを保護したまま、戻り値のconflictsで呼び出し側へ渡す
  // 戻り値: [{ id, local, remote, remoteSig, remoteUpdatedAt }] 競合した大会の一覧
  function mergeRemoteTournaments(remoteList, remoteUpdatedAtMap){
    const upd = remoteUpdatedAtMap || {};
    const conflicts = [];
    (remoteList||[]).forEach(rt=>{
      const remoteUpdatedAt = upd[rt.id] || '';
      const remoteSig = AtsuCupData.syncSignatureOf(rt);
      const i = state.tournaments.findIndex(t=>t.id===rt.id);

      // (a) この端末に無い大会 → 無条件で取り込む
      if(i < 0){
        state.tournaments.push({...rt, everSyncedToServer:true});
        state.remoteMeta[rt.id] = { sig: remoteSig, updatedAt: remoteUpdatedAt };
        return;
      }
      // このidが実際にサーバーに存在することは確定した事実なので必ず記録する
      // (pruneTournamentsGoneFromServerが「未同期の新規作成大会」と正しく区別するために使う)
      state.tournaments[i].everSyncedToServer = true;

      const local = state.tournaments[i];
      const localSig = AtsuCupData.syncSignatureOf(local);
      const known = state.remoteMeta[rt.id];

      // (b) 基準値が無い(初回取り込み・コード更新直後) → 従来通りの保守的な判定で基準値を張る
      if(!known){
        const take = (localSig === remoteSig) || (!hasProgress(local) && hasProgress(rt));
        if(take) state.tournaments[i] = {...rt, everSyncedToServer:true};
        state.remoteMeta[rt.id] = { sig: remoteSig, updatedAt: remoteUpdatedAt };
        return;
      }

      // (c) 中身が完全に同じ → 何もしない(updatedAtだけ進んだ無意味な再保存を競合扱いしない)
      if(localSig === remoteSig){
        state.remoteMeta[rt.id] = { sig: remoteSig, updatedAt: remoteUpdatedAt };
        return;
      }

      const localChanged = (localSig !== known.sig);
      // updatedAtが使えない旧行だけ、内容比較にフォールバックする
      const newer = isRemoteNewer(remoteUpdatedAt, known.updatedAt);
      const remoteChanged = (newer === null) ? (remoteSig !== known.sig) : newer;

      if(!remoteChanged){
        // サーバー側は前回把握した状態のまま(または反映待ちの古いコピー)。
        // ⚠️ ここで remoteMeta を更新してはいけない。古いコピーを「最新の把握値」として
        //    書き込むと、次に本物の新しい行が来たときの比較基準が壊れる
        return;
      }
      if(!localChanged){
        state.tournaments[i] = {...rt, everSyncedToServer:true}; // 他の端末だけ変更 → 自動取り込み
        state.remoteMeta[rt.id] = { sig: remoteSig, updatedAt: remoteUpdatedAt };
        return;
      }
      // 両方変更 = 競合。ローカルは保護したまま、判断をユーザーへ委ねる
      conflicts.push({ id: rt.id, local, remote: rt, remoteSig, remoteUpdatedAt });
    });
    return conflicts;
  }
  // サーバー(data/tournaments.json)に存在しなくなった大会を、この端末のキャッシュからも取り除く。
  // 「以前にサーバーへ実際に反映されたことがある(everSyncedToServer===true)」大会に限定することで、
  // まだ一度もサーバーへ反映できていない(オフライン等で未同期の)作成直後の大会を誤って消してしまわない
  // ようにする。
  // ※以前は`remoteSnapshots`の有無で判定していたが、これは「このコードに更新された後、リモートに
  // まだ存在するうちに一度でも取り込んだこと」が前提になり、既にサーバー側で削除済みの大会は
  // 一度もその条件を満たせず永久にプルーニングされない不具合があった(2026-07-27深夜に発覚・修正)。
  // `everSyncedToServer`はmigrate()で「この機能追加より前からキャッシュされている大会は既定でtrue」
  // として補完するため、既存キャッシュの孤立大会もこの修正で正しく消えるようになる。
  // ⚠️ 呼び出し元(loadFromData)は、data/*.jsonの取得に失敗した場合はfetchJson()が例外を投げて
  // catchブロックへ抜けるため、この関数に到達した時点で「取得は成功している」ことが保証されている。
  // したがって空配列=「サーバーに大会が1件も無い」という正当な結果であり、取得失敗の可能性と
  // 混同して何もしない安全弁を入れるのは誤り(2026-07-27深夜に実際にこれが原因で、スプレッド
  // シートを空にしたのに古い大会が消えない不具合が起きていた)。空配列でも普通にプルーニングする。
  function pruneTournamentsGoneFromServer(remoteTournaments){
    if(!remoteTournaments) return [];
    const remoteIds = new Set(remoteTournaments.map(t=>t.id));
    const removed = state.tournaments.filter(t=> !remoteIds.has(t.id) && t.everSyncedToServer===true);
    if(removed.length){
      const removedIdSet = new Set(removed.map(t=>t.id));
      state.tournaments = state.tournaments.filter(t=>!removedIdSet.has(t.id));
      removed.forEach(t=>{ delete state.remoteMeta[t.id]; });
    }
    return removed;
  }

  // users.jsonの内容を端末のマスタ(roster/recDefaults/archived)へ反映する
  function mergeRemoteUsers(users){
    const m = AtsuCupData.toAppRoster(users);
    const set = new Set(state.roster);
    m.roster.forEach(n=>{ if(!set.has(n)){ state.roster.push(n); set.add(n); } });
    Object.assign(state.userRecDefaults, m.userRecDefaults);
    Object.assign(state.archivedUsers, m.archivedUsers);
  }

  // 読み込みは同一オリジンの静的ファイルから行う(アプリと一緒に配信されているdata/を読む)。
  // GitHub APIを使わない理由: 未認証APIは60回/時の制限があり、1ページ4ファイル取得では
  // すぐ枯渇するため。書き込み側(saveTournamentToData)はsha取得が要るのでAPIを使う。
  async function fetchJson(path){
    const res = await fetch(path + '?t=' + Date.now(), { cache:'no-store' });
    if(!res.ok) throw new Error(`${path} の取得に失敗しました(status ${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  // data/*.json を取得してstateへ取り込む。失敗してもrejectせず{ok:false}で解決する
  // (オフラインや取得失敗時でも、localStorageの内容で画面が動き続けるようにするため)
  async function loadFromData(){
    if(typeof AtsuCupData === 'undefined') return { ok:false, error:'モジュール未読み込み' };
    try{
      const [users, tournaments, entries, matches] = await Promise.all([
        fetchJson(DATA_PATHS.users),
        fetchJson(DATA_PATHS.tournaments),
        fetchJson(DATA_PATHS.entries),
        fetchJson(DATA_PATHS.matches)
      ]);
      mergeRemoteUsers(users);
      const appTournaments = AtsuCupData.toAppTournaments({ users, tournaments, entries, matches });
      // updatedAtは生の行にしか無い(アプリの大会オブジェクトには持たせない方針)ので、
      // ここでid→updatedAtのマップにしてmergeへ渡す
      const conflicts = mergeRemoteTournaments(appTournaments, AtsuCupData.updatedAtMapOf(tournaments));
      // 以前にサーバーへ反映されたことがある大会が、サーバー側でid自体無くなっていれば
      // この端末のキャッシュからも取り除く(スプレッドシートの作り直し等でidが変わった場合の回復)。
      // 未同期の新規作成大会(everSyncedToServer:false)は対象外なので安全
      pruneTournamentsGoneFromServer(appTournaments);
      // ⚠️ 3分類マージは「未保存の進行状況を勝手に上書きしない」ためのものだが、
      // アーカイブ(削除)はこれとは別軸: サーバー側でarchived=trueになった大会は、
      // 既にこの端末にキャッシュ済みかどうかに関わらず必ず消す(でないと、他端末で削除した
      // 大会が「ローカルに既にあるid」として merge の対象外になり、いつまでも消えない)。
      const archivedIds = new Set((tournaments||[]).filter(t=>t.archived).map(t=>t.id));
      if(archivedIds.size){ state.tournaments = state.tournaments.filter(t=>!archivedIds.has(t.id)); }
      persist();
      // ⚠️ awaitしない。ready(=各ページのrender)をブロックせず、まずローカルの内容で画面を出し、
      // その上にモーダルを重ねる(取り込みを選んだ場合だけ location.reload() で描き直す)
      if(conflicts.length) showSyncConflictModal(conflicts);
      return { ok:true, counts:{ users:users.length, tournaments:tournaments.length }, conflicts };
    }catch(e){
      console.warn('[atsucup] data/ の取り込みに失敗しました:', e);
      return { ok:false, error:(e && e.message) || String(e) };
    }
  }

  // ⚠️ 2026-07-27方針変更: ログインした瞬間だけは、data/tournaments.jsonに存在しない
  // DB(認証)大会をこの端末のキャッシュから取り除く(サーバー側を正とする)。
  // 通常のページ読み込み(loadFromData、上記のローカル優先マージ)ではこれをしない。
  // 理由: 大会作成直後などサーバーへまだ一度も保存できていない大会を、ログイン中の
  // 通常利用の裏でうっかり消してしまわないようにするため。ログインの瞬間
  // (GoogleAuth.onStateChangeの発火時)だけに限定すれば、その端末で今まさに
  // 作りかけの未保存大会が巻き込まれることはまず無い。
  async function reconcileAuthPoolWithServer(){
    if(typeof AtsuCupData === 'undefined') return;
    let remoteTournaments, remoteUsers;
    try{
      [remoteTournaments, remoteUsers] = await Promise.all([
        fetchJson(DATA_PATHS.tournaments), fetchJson(DATA_PATHS.users)
      ]);
    }catch(e){ console.warn('[atsucup] ログイン時のサーバー整合チェックに失敗しました:', e); return; }

    // --- 大会 ---
    // 安全弁: 取得結果が空(取得失敗・空データ等)の場合は何も消さない
    let removedTournaments = [];
    if(remoteTournaments.length){
      const remoteIds = new Set(remoteTournaments.map(t=>t.id));
      // ⚠️ everSyncedToServer のガードが必須(2026-07-28追加)。これが無いと、大会を作った直後
      // (GitHub Pagesへの反映がまだ済んでいない状態)でログインした瞬間に、作りたての大会が
      // 「サーバーに存在しない」と判定されて消える。pruneTournamentsGoneFromServer と同じ条件。
      removedTournaments = state.tournaments.filter(t=> !remoteIds.has(t.id) && t.everSyncedToServer===true);
      if(removedTournaments.length){
        // 上の判定で選んだものだけを取り除く(remoteIds基準で消し直すと、ガードで守った
        // 未同期の大会まで巻き込んで消してしまう)
        const removedIds = new Set(removedTournaments.map(t=>t.id));
        state.tournaments = state.tournaments.filter(t=> !removedIds.has(t.id));
        removedTournaments.forEach(t=>{ delete state.remoteMeta[t.id]; });
      }
    }

    // --- ユーザー(2026-07-27追加、大会と同じ考え方) ---
    // シートから行ごと削除された(archived=trueではなく、行自体が無い)ユーザーは
    // mergeRemoteUsers()では追加のみで削除されないため、ここで消す。
    // 安全弁: remoteUsersが空の場合はロースター全消去という重大な誤爆を防ぐため何もしない
    let removedUsers = [];
    if(remoteUsers.length){
      const remoteNames = new Set(remoteUsers.map(u=>u && u.name).filter(Boolean));
      removedUsers = state.roster.filter(n=>!remoteNames.has(n));
      if(removedUsers.length){
        state.roster = state.roster.filter(n=>remoteNames.has(n));
        removedUsers.forEach(n=>{ delete state.userRecDefaults[n]; delete state.archivedUsers[n]; });
      }
    }

    if(!removedTournaments.length && !removedUsers.length) return;
    persist();
    showAuthResyncNotice({ tournaments: removedTournaments, users: removedUsers });
  }

  let authResyncNoticeShown = false;
  // サーバーから既に消えていた大会・ユーザーをこの端末からも取り除いた旨を知らせる、閉じるだけの
  // 非ブロッキングな通知(ゲストプールの確認バナーと違い「元に戻す」選択肢が無いための簡易版)。
  function showAuthResyncNotice(removed){
    if(typeof document === 'undefined') return;
    if(!document.body){ document.addEventListener('DOMContentLoaded', ()=> showAuthResyncNotice(removed)); return; }
    if(authResyncNoticeShown) return;
    authResyncNoticeShown = true;

    const style = document.createElement('style');
    style.textContent = `
      .atsucup-resync-toast{ position:fixed; left:14px; right:14px; z-index:9998;
        /* セッション切れバナー(下部固定)が出ている時はその上に重ねる。出ていなければ0pxで従来通り */
        bottom:calc(14px + var(--atsucup-bottom-bar, 0px));
        max-width:460px; margin:0 auto; background:#150f22; border:1.5px solid var(--gold-dim,#8a6d2f);
        border-radius:14px; padding:14px 16px; color:#f5efe0; font-family:'Noto Sans JP',sans-serif;
        box-shadow:0 10px 30px rgba(0,0,0,.5); }
      .atsucup-resync-toast p{ margin:0 0 10px; font-size:13px; line-height:1.7; color:#d8cfe6; }
      .atsucup-resync-toast button{ font-family:inherit; font-size:13px; font-weight:700; padding:8px 14px;
        border-radius:9px; cursor:pointer; border:1.5px solid #3a2f4d; background:transparent; color:#f5efe0; }
    `;
    document.head.appendChild(style);

    let lines = '';
    if(removed.tournaments && removed.tournaments.length) lines += `<p>🔄 サーバー側で既に削除されていた大会(${removed.tournaments.length}件)を、この端末のキャッシュからも取り除きました。</p>`;
    if(removed.users && removed.users.length) lines += `<p>🔄 サーバー側で既に削除されていたユーザー(${removed.users.length}件)を、この端末の登録リストからも取り除きました。</p>`;

    const box = document.createElement('div');
    box.className = 'atsucup-resync-toast';
    box.innerHTML = `${lines}<button id="atsucupResyncCloseBtn">閉じる</button>`;
    document.body.appendChild(box);
    document.getElementById('atsucupResyncCloseBtn').addEventListener('click', ()=> box.remove());
  }

  /* ---------- ゲスト/認証済みプールの分離: ログイン時の自己申告制リセット ---------- */
  // 不変条件: ログイン中はゲストプールが空でなければならない。
  // これを満たすため、ログイン状態への変化を検知するたびに enforceGuestSeparation() を呼ぶ。
  function clearGuestPool(){
    state.guestRoster = [];
    state.guestUserRecDefaults = {};
    state.guestArchivedUsers = {};
    state.guestTournaments = [];
    if(state.activePool === 'guest'){ state.activeId = null; state.activePool = 'auth'; }
    persist();
  }

  let guestWipeBannerShown = false;
  function enforceGuestSeparation(){
    if(!signedIn()) return; // 非ログインならゲストプールを使い続けるだけなので何もしない
    if(!guestPoolHasData()) return; // ゲストプールが空なら不変条件は既に満たされている
    if(guestWipeBannerShown) return; // 二重表示防止
    showGuestWipeBanner();
  }

  // 非ダイスミス(Esc・オーバーレイクリックでは閉じない)の確認バナー。
  // confirm()/alert()は使わない(プロジェクトの方針)。タップでの明示操作を必須にする。
  function showGuestWipeBanner(){
    if(typeof document === 'undefined') return;
    if(!document.body){ document.addEventListener('DOMContentLoaded', showGuestWipeBanner); return; }
    guestWipeBannerShown = true;

    const style = document.createElement('style');
    style.textContent = `
      .atsucup-guestwipe-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.86); z-index:9999;
        display:flex; align-items:center; justify-content:center; padding:20px; }
      .atsucup-guestwipe-card{ max-width:420px; width:100%; background:#150f22; border:1.5px solid #5a2222;
        border-radius:16px; padding:22px 20px; color:#f5efe0; font-family:'Noto Sans JP',sans-serif; }
      .atsucup-guestwipe-card h3{ margin:0 0 10px; font-size:16px; }
      .atsucup-guestwipe-card p{ margin:0 0 16px; font-size:13.5px; line-height:1.7; color:#d8cfe6; }
      .atsucup-guestwipe-card .row{ display:flex; flex-direction:column; gap:8px; }
      .atsucup-guestwipe-card button{ font-family:inherit; font-size:14px; font-weight:700; padding:11px 14px;
        border-radius:10px; cursor:pointer; border:1.5px solid transparent; }
      .atsucup-guestwipe-card .primary{ background:#e8b34c; color:#160f08; }
      .atsucup-guestwipe-card .ghost{ background:transparent; border-color:#3a2f4d; color:#f5efe0; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'atsucup-guestwipe-overlay';
    overlay.innerHTML = `
      <div class="atsucup-guestwipe-card">
        <h3>⚠️ ローカルデータが残っています</h3>
        <p>この端末には未ログイン時に作ったローカルのユーザー登録・大会データが残っています。ログインすると、このローカルデータは削除され、以後はスプレッドシート側のデータのみを扱います。</p>
        <div class="row">
          <button class="primary" id="atsucupGuestWipeConfirm">ローカルデータを削除してログインする</button>
          <button class="ghost" id="atsucupGuestWipeCancel">ログインをやめる</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('atsucupGuestWipeConfirm').addEventListener('click', ()=>{
      clearGuestPool();
      location.reload();
    });
    document.getElementById('atsucupGuestWipeCancel').addEventListener('click', ()=>{
      if(typeof GoogleAuth !== 'undefined') GoogleAuth.signOut();
      location.reload();
    });
  }

  /* ---------- 端末間同期: 選択モーダル(競合の解決・保存前の警告で共用) ---------- */
  // confirm()/alert()は使わない(プロジェクト方針)。非ダイスミス(Esc・オーバーレイクリックでは
  // 閉じない)で、必ずどれか1つをタップさせる。showGuestWipeBannerと同じ流儀。
  // ⚠️ .match-pick-modal のCSSは tournament-detail.html 内のインライン定義なので他ページでは
  //    使えない。全ページ共通で使うため、ここでstyleを注入する。
  //
  // choices = [{ key, label, primary? }] / 戻り値: 選ばれたkeyで解決するPromise
  let syncModalStyleInjected = false;
  function showSyncChoiceModal({ title, bodyHtml, choices }){
    return new Promise(resolve=>{
      if(typeof document === 'undefined') return resolve(null);
      if(!document.body){
        document.addEventListener('DOMContentLoaded', ()=> showSyncChoiceModal({title, bodyHtml, choices}).then(resolve));
        return;
      }
      if(!syncModalStyleInjected){
        syncModalStyleInjected = true;
        const style = document.createElement('style');
        style.textContent = `
          .atsucup-sync-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.86); z-index:9999;
            display:flex; align-items:center; justify-content:center; padding:20px; }
          .atsucup-sync-card{ max-width:440px; width:100%; background:#150f22; border:1.5px solid var(--gold-dim,#8a6d2f);
            border-radius:16px; padding:22px 20px; color:#f5efe0; font-family:'Noto Sans JP',sans-serif;
            box-shadow:0 10px 30px rgba(0,0,0,.5); }
          .atsucup-sync-card h3{ margin:0 0 10px; font-size:16px; }
          .atsucup-sync-card p{ margin:0 0 14px; font-size:13.5px; line-height:1.7; color:#d8cfe6; }
          .atsucup-sync-card .atsucup-sync-actions{ display:flex; flex-direction:column; gap:8px; }
          .atsucup-sync-card button{ font-family:inherit; font-size:13.5px; font-weight:700; padding:11px 14px;
            border-radius:10px; cursor:pointer; border:1.5px solid transparent; text-align:left; line-height:1.5; }
          .atsucup-sync-card button.primary{ background:#e8b34c; color:#160f08; }
          .atsucup-sync-card button.ghost{ background:transparent; border-color:#3a2f4d; color:#f5efe0; }
        `;
        document.head.appendChild(style);
      }
      const overlay = document.createElement('div');
      overlay.className = 'atsucup-sync-overlay';
      overlay.innerHTML = `
        <div class="atsucup-sync-card">
          <h3>${title}</h3>
          ${bodyHtml}
          <div class="atsucup-sync-actions">${choices.map((c,i)=>
            `<button class="${c.primary?'primary':'ghost'}" data-i="${i}">${escapeHtml(c.label)}</button>`).join('')}</div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('button').forEach(b=>{
        b.addEventListener('click', ()=>{ overlay.remove(); resolve(choices[+b.dataset.i].key); });
      });
    });
  }

  // 読み込み時に検出した競合(この端末とサーバーの両方が前回把握時から変わっている)を解決させる。
  // 複数大会が同時に競合しうるのでキューで1件ずつ聞き、取り込みがあれば最後に1回だけリロードする。
  let syncConflictModalRunning = false;
  async function showSyncConflictModal(conflicts){
    if(syncConflictModalRunning || !conflicts || !conflicts.length) return;
    syncConflictModalRunning = true;
    let changed = false;
    for(const c of conflicts){
      const when = c.remoteUpdatedAt ? new Date(c.remoteUpdatedAt).toLocaleString('ja-JP') : '不明';
      const key = await showSyncChoiceModal({
        title: '🔄 他の端末でも更新されています',
        bodyHtml: `<p>「${escapeHtml(c.local.title||'(無題)')}」は、この端末にまだ保存していない変更があり、`
          + `同時にサーバー側も別の端末から更新されています(サーバーの更新: ${escapeHtml(when)})。`
          + `どちらの内容を使うか選んでください。</p>`,
        choices: [
          { key:'remote', label:'🔄 サーバーの内容を取り込む(この端末の未保存の変更は破棄されます)' },
          { key:'local',  label:'この端末の内容を使う(次に保存すると他の端末の変更を上書きします)', primary:true }
        ]
      });
      const i = state.tournaments.findIndex(t=>t.id===c.id);
      if(key === 'remote' && i >= 0){
        state.tournaments[i] = {...c.remote, everSyncedToServer:true};
        changed = true;
      }
      // どちらを選んでも「サーバーのこの状態は把握した」ことにする。これをしないと次の
      // ページ読み込みでも同じ競合を毎回聞かれ続ける。ローカルを選んだ場合、ローカルは
      // 基準値と食い違ったまま(=未保存の変更あり)になるので、その後もローカルは保護され、
      // 次の保存でサーバーへ反映される
      state.remoteMeta[c.id] = { sig: c.remoteSig, updatedAt: c.remoteUpdatedAt };
    }
    persist();
    syncConflictModalRunning = false;
    // 取り込んだ場合の再描画。coreには購読機構が無いため、showGuestWipeBannerと同じくreloadで揃える
    if(changed) location.reload();
  }

  // 保存の直前に、サーバー側がこの端末の把握している状態より新しくなっていないか確認する。
  // ⚠️ ベストエフォート。data/tournaments.json はGASのコミット→Pages反映に数十秒〜数分の
  //    遅延があるため、「直前に他の端末が保存した」ケースは検知できないことがある。
  // 戻り値: null(問題なし/判定不能) または { remoteUpdatedAt }
  async function checkRemoteNewerBeforeSave(tournamentId){
    const known = state.remoteMeta[tournamentId];
    if(!known || !known.updatedAt) return null; // 基準値が無ければ判定できない(保存は止めない)
    let rows;
    try{ rows = await fetchJson(DATA_PATHS.tournaments); }
    catch(e){ return null; } // 取得できない=オフライン等。保存を妨げない
    const row = (rows||[]).find(r=>r.id===tournamentId);
    if(!row || !row.updatedAt) return null;
    return isRemoteNewer(row.updatedAt, known.updatedAt) ? { remoteUpdatedAt: row.updatedAt } : null;
  }

  // 保存前の確認。⚠️「それでも上書き保存する」を必ず選べるようにすること。
  // 保存ボタンを押した時点では必ずローカルに未保存の変更があるので、ここで操作不能になると
  // 大会の進行そのものが止まってしまう。
  // 戻り値: 'overwrite' | 'reload' | 'cancel'
  async function confirmOverwriteIfRemoteNewer(tournamentId){
    const hit = await checkRemoteNewerBeforeSave(tournamentId);
    if(!hit) return 'overwrite';
    const when = new Date(hit.remoteUpdatedAt).toLocaleString('ja-JP');
    return await showSyncChoiceModal({
      title: '⚠️ 他の端末で更新されています',
      bodyHtml: `<p>この大会はサーバー側で ${escapeHtml(when)} に更新されています。`
        + `このまま保存すると、その変更をこの端末の内容で上書きします。</p>`,
      choices: [
        { key:'overwrite', label:'それでも上書き保存する', primary:true },
        { key:'reload',    label:'サーバーの内容を見る(このページを再読み込み)' },
        { key:'cancel',    label:'保存をやめる' }
      ]
    });
  }

  if(typeof GoogleAuth !== 'undefined'){
    GoogleAuth.onStateChange((s)=>{
      enforceGuestSeparation();
      if(s && s.signedIn) reconcileAuthPoolWithServer();
    });
  }

  // 端末のユーザーマスタ(roster/recDefaults/archived)を GAS 経由でシート/GitHubへ反映する。
  // IDの採番はサーバ側(GAS)が行う(複数端末からの同時登録で衝突しないように)。
  async function saveUsersToData(){
    if(isGuestMode()) throw new Error('練習モードではサーバーに保存できません。ログインしてください。');
    if(typeof GasDB === 'undefined') throw new Error('GAS連携モジュールが読み込まれていません。');
    if(!GasDB.canWrite()) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');
    const users = state.roster.map(name => ({
      name,
      recDefault: state.userRecDefaults[name] !== false,
      archived: !!state.archivedUsers[name]
    }));
    const r = await GasDB.saveUsers(users);
    return r.total;
  }

  // 大会1件を GAS 経由で保存する(シート更新 → GitHubへ書き出しまでGAS側が行う)。
  // entryRows/matchRowsの参照キーには名前をそのまま乗せて送り、名前→ID解決はGAS側で行う
  // (未登録の参加者名にIDを採番する処理をサーバ側に一本化するため)。
  async function saveTournamentToData(tournamentId){
    if(poolKindOfTournamentId(tournamentId)==='guest') throw new Error('ローカル(未ログインで作成した)大会はサーバーに保存できません。');
    if(typeof GasDB === 'undefined') throw new Error('GAS連携モジュールが読み込まれていません。');
    if(!GasDB.canWrite()) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');
    const t = state.tournaments.find(x=>x.id===tournamentId);
    if(!t) throw new Error('保存対象の大会が見つかりません。');

    const names = (t.people||[]).map(p=>p.name);
    // 名前をそのまま「id」として使う変換(identity map)。fromAppTournamentの出力の
    // userId/player*Id欄に実IDではなく名前が入り、GAS側でそこから実IDへ解決する。
    const identity = {};
    names.forEach(n=>{ identity[n] = n; });
    const { tournamentRow, entryRows, matchRows, posterImageUpload } = AtsuCupData.fromAppTournament(t, identity);

    const result = await GasDB.saveTournament({ tournamentRow, entryRows, matchRows, participantNames: names, posterImageUpload });
    // ポスター画像をGitHubへアップロードした場合、サーバーから返ってきた最終URLを
    // ローカルの保持データにも反映する(巨大なdata URLをlocalStorageに残さない・
    // 次回以降の保存で毎回再アップロードしないようにするため)
    if(result.posterUrl) { t.posterUrl = result.posterUrl; }
    // ⚠️ 保存が成功した時点で「サーバーはこの内容・この時刻になった」ことが確定する。
    // これを記録しておかないと、直後のリロードで返ってくる反映待ちの古いPagesコピーを
    // 「サーバーが変わった」と誤検出し、保存した内容が巻き戻る(2026-07-27の不具合)。
    // posterUrlを反映した後に署名を取ること(実際に送った内容と一致させるため)。
    if(result.updatedAt){
      state.remoteMeta[t.id] = { sig: AtsuCupData.syncSignatureOf(t), updatedAt: result.updatedAt };
    }
    persist();
    // ⚠️ ここでeverSyncedToServerをtrueにしてはいけない(2026-07-27未明に実際に規制退行が発生し修正)。
    // GAS書き込みの成功は、GitHub Pages側のdata/tournaments.jsonへの反映完了を意味しない
    // (GAS→GitHubコミット→Pagesへの反映には時間差がある)。ここで即trueにすると、その反映が
    // 間に合う前に次のページ読み込みが走った場合、pruneTournamentsGoneFromServerが「サーバーに
    // まだ見当たらない」と誤判定し、作成直後の大会を消してしまう。everSyncedToServerは、実際に
    // data/tournaments.jsonから取り込めたこと(mergeRemoteTournaments)を確認できてから初めてtrueにする。
    return result;
  }

  // 大会の基本情報(タイトル・詳細・開催日・ポスター・フラグ)だけをサーバーへ反映する。
  // ⚠️ entries/matchesには一切触れない。参加者・対戦結果を反映したい場合は必ず
  // saveTournamentToData(フル保存)を使うこと(大会作成時・情報編集時の「即時反映」専用)。
  async function saveTournamentMetaToData(tournamentId){
    if(poolKindOfTournamentId(tournamentId)==='guest') throw new Error('ローカル(未ログインで作成した)大会はサーバーに保存できません。');
    if(typeof GasDB === 'undefined') throw new Error('GAS連携モジュールが読み込まれていません。');
    if(!GasDB.canWrite()) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');
    const t = state.tournaments.find(x=>x.id===tournamentId);
    if(!t) throw new Error('保存対象の大会が見つかりません。');

    const { tournamentRow, posterImageUpload } = AtsuCupData.tournamentRowOf(t);
    const result = await GasDB.updateTournamentMeta({ tournamentRow, posterImageUpload });
    if(result.posterUrl) { t.posterUrl = result.posterUrl; }
    // ⚠️ メタ情報だけの保存では entries/matches をサーバーへ送っていない。ここで sig を
    // 「ローカル全体の署名」に更新すると、この端末の未保存の対戦表進行までサーバーに反映済みだと
    // 誤認し、次の自動取り込みで黙って消えてしまう。そのため updatedAt(=競合の誤検出を防ぐ値)
    // だけを進め、sig は前回の基準値のまま残す。結果として「ローカルに未保存の変更あり」の
    // 判定が続くが、entries/matchesは実際にまだ送っていないのでそれが正しい状態
    if(result.updatedAt && state.remoteMeta[t.id]){
      state.remoteMeta[t.id].updatedAt = result.updatedAt;
    }
    persist();
    // ⚠️ everSyncedToServerはここでは立てない(理由はsaveTournamentToData内の同種コメント参照)。
    // 大会作成直後はこの関数が呼ばれるが、GitHub Pages側への反映が間に合う前に次の読み込みが
    // 走ってプルーニングされてしまうのを防ぐため、実際にdata/tournaments.jsonから取り込めたこと
    // (mergeRemoteTournaments)を確認できてから初めてtrueにする
    return result;
  }

  // 大会をアーカイブする(行削除ではなくサーバー側でarchived=trueを立てる)。
  // 成功したらローカルのstate.tournamentsからも取り除く(次回data/*.json再取得時も
  // toAppTournamentsがarchived済みを除外するので、二重にガードされる)。
  async function archiveTournamentInData(tournamentId){
    if(poolKindOfTournamentId(tournamentId)!=='auth') throw new Error('ローカル大会はこの方法では削除できません。');
    if(typeof GasDB === 'undefined') throw new Error('GAS連携モジュールが読み込まれていません。');
    if(!GasDB.canWrite()) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');
    const r = await GasDB.archiveTournament(tournamentId);
    state.tournaments = state.tournaments.filter(t=>t.id!==tournamentId);
    delete state.remoteMeta[tournamentId];
    persist();
    return r;
  }

  // <input type="date">の値(YYYY-MM-DD) ⇔ ISO日時文字列の相互変換。
  // toISOString()はUTC変換されるため、そのまま使うとタイムゾーンによって表示日が1日ズレることがある。
  // ローカルの年月日で組み立てる/パースすることでズレを防ぐ。
  function dateInputValueOf(iso){
    if(!iso) return '';
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function isoFromDateInputValue(str){
    if(!str) return new Date().toISOString();
    const [y,m,d] = str.split('-').map(Number);
    return new Date(y, m-1, d).toISOString();
  }

  // localStorageのデータを新形式(tournaments配列)に取り込む。旧形式(tournamentMeta+history+直下people)は移行する。
  function migrate(data){
    state.roster = data.roster || [];
    state.userRecDefaults = data.userRecDefaults || {};
    state.archivedUsers = data.archivedUsers || {};
    // ゲストプールは新規追加のキーなので、既存の保存データには無くて当然(空のデフォルトで補う)
    state.guestRoster = data.guestRoster || [];
    state.guestUserRecDefaults = data.guestUserRecDefaults || {};
    state.guestArchivedUsers = data.guestArchivedUsers || {};
    state.guestTournaments = data.guestTournaments || [];
    if(Array.isArray(data.tournaments)){
      // everSyncedToServer導入(2026-07-27深夜)より前にキャッシュされた大会にはこのフィールドが
      // 無いため、既定でtrue(=既にサーバーへ反映済みの実データのはず)を補う。これにより、
      // 導入前から残っていた「サーバー側では既に削除済みの孤立キャッシュ」もpruneTournamentsGoneFromServer
      // の対象として正しく扱われるようになる
      state.tournaments = data.tournaments.map(t=> t.everSyncedToServer===undefined ? {...t, everSyncedToServer:true} : t);
      // 基準値(remoteMeta)は、署名の算出方法が変わったら引き継げない。
      // ・remoteMeta導入(2026-07-28)より前のキャッシュには旧 remoteSnapshots(生JSON文字列)しか無い
      // ・署名の算出方法を変えた場合(AtsuCupData.SIG_VERSIONを上げた場合)も、旧版の署名は
      //   新しい署名と比較できない。そのまま残すと「ローカルもサーバーも変わった」と誤判定され、
      //   全端末で競合モーダルが誤爆する
      // どちらの場合も該当分を捨てる。捨てても実害は無い: 次のloadFromDataで「基準値なし」の
      // フォールバック判定が一度だけ走って張り直される(その間ローカルの進行状況は保守的に保護される)。
      // ⚠️ AtsuCupDataが未読み込みなら判定できないので、安全側(捨てる)に倒す
      const savedMeta = data.remoteMeta || {};
      state.remoteMeta = {};
      if(typeof AtsuCupData !== 'undefined'){
        Object.keys(savedMeta).forEach(tid=>{
          const m = savedMeta[tid];
          if(m && AtsuCupData.isCurrentSigVersion(m.sig)) state.remoteMeta[tid] = m;
        });
      }
      state.activeId = data.activeId || null;
      state.activePool = data.activePool || 'auth';
      return;
    }
    // --- 旧形式からの移行 ---
    const list = [];
    (data.history||[]).forEach(h=>{
      list.push({
        id: h.id || newTournamentId(), title: h.title||"", details: h.details||"", posterUrl: h.posterUrl||null,
        createdAt: h.createdAt || new Date().toISOString(), status:'completed',
        people: h.participants||[], order:[], remaining:[],
        matches: h.matches||[], winnerName: h.championName||"", thirdPlaceMatch: h.thirdPlaceMatch||null
      });
    });
    const meta = data.tournamentMeta;
    if(meta && meta.title){
      list.push({
        id: meta.id || newTournamentId(), title: meta.title, details: meta.details||"", posterUrl: meta.posterUrl||null,
        createdAt: new Date().toISOString(), status:'ongoing',
        people: data.people||[], order: data.order||[], remaining: data.remaining||[],
        matches: data.matches||[], winnerName: data.winnerName||"", thirdPlaceMatch: data.thirdPlaceMatch||null
      });
    }
    state.tournaments = list;
    state.activeId = null;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function roundLabel(total){
    const map = {1:"決勝",2:"準決勝",4:"準々決勝",8:"ベスト16",16:"ベスト32",32:"ベスト64"};
    return map[total] || `${total*2}回戦`;
  }

  function recMapOf(){
    const m = {};
    state.people.forEach(p=> m[p.name]=p.rec);
    return m;
  }

  // データベース未接続でも保存容量の上限を超えないよう、ポスター画像は縮小・圧縮してから保存する
  function resizeImageToDataUrl(file, maxDim, quality){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = ()=>{
        let { width, height } = img;
        if(width > maxDim || height > maxDim){
          if(width >= height){ height = Math.round(height * maxDim / width); width = maxDim; }
          else{ width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  /* ---------- 対戦表の構築(撮影不可同士が当たらないよう配慮) ---------- */
  function nextPow2(n){ let p=1; while(p<n) p*=2; return p; }
  function shuffleArray(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  // pairs a list of names so that two non-recorders are matched together
  // only when unavoidable (more non-recorders than recorders in the pool).
  function pairWithConstraint(list, recMap){
    let Ns = list.filter(n=>!recMap[n]);
    let Rs = list.filter(n=>recMap[n]);
    shuffleArray(Ns); shuffleArray(Rs);
    const pairs = [];
    while(Ns.length && Rs.length){ pairs.push([Ns.pop(), Rs.pop()]); }
    while(Ns.length>=2){ pairs.push([Ns.pop(), Ns.pop()]); }
    while(Rs.length>=2){ pairs.push([Rs.pop(), Rs.pop()]); }
    shuffleArray(pairs);
    return pairs;
  }

  // シード(不戦勝)は勝者がその場で確定するため、隣り合う2つのシードが両方とも撮影不可だと
  // 次のラウンドで撮影不可同士が対戦することが「その時点で」わかってしまう。
  // 実際の対戦(bが決まっている試合)には手を触れず、シード同士の並び順だけを入れ替えて事前に回避する。
  function avoidByeCameraCollision(round1, recMap){
    for(let k=0;k+1<round1.length;k+=2){
      const m0 = round1[k], m1 = round1[k+1];
      if(!m0 || !m1 || m0.b !== null || m1.b !== null) continue;
      if(recMap[m0.a] || recMap[m1.a]) continue;
      let bestJ = -1, bestDist = Infinity;
      for(let j=0;j+1<round1.length;j+=2){
        if(j===k) continue;
        const n0 = round1[j], n1 = round1[j+1];
        if(!n0 || !n1 || n0.b !== null || n1.b !== null) continue;
        if(recMap[n0.a] && recMap[n1.a]){
          const dist = Math.abs(j-k);
          if(dist < bestDist){ bestDist = dist; bestJ = j; }
        }
      }
      if(bestJ>=0){
        const donor = round1[bestJ+1];
        const tmp = m1.a;
        m1.a = donor.a; m1.winner = donor.a;
        donor.a = tmp; donor.winner = tmp;
      }
    }
    return round1;
  }

  // 参加者リストから、撮影不可同士が当たらないようラウンド1(不戦勝含む)を組む。
  // シード(不戦勝)カードは常に配列の末尾(=表示上は一番下)にまとめる。
  function buildRound1(names){
    const recMap = recMapOf();
    const size = nextPow2(names.length);
    const byes = size - names.length;
    let pool = [...names];
    const byePlayers = [];
    for(let i=0;i<byes;i++){
      let idx = pool.findIndex(n=>!recMap[n]);
      if(idx===-1) idx = 0;
      byePlayers.push(pool.splice(idx,1)[0]);
    }
    const pairs = pairWithConstraint(pool, recMap);
    const round1 = [];
    pairs.forEach(([a,b])=> round1.push({a, b, winner:null, loser:null, video:"", bye:false}));
    byePlayers.forEach(p=> round1.push({a:p, b:null, winner:p, loser:null, video:"", bye:true}));
    return avoidByeCameraCollision(round1, recMap);
  }

  // 参加者数(names)から、まだ誰も割り当てられていない空のラウンド1を組み立てる。
  // 枠タップで1人ずつ埋めていく方式の初期状態として使う。シード(不戦勝)枠は常に末尾(一番下)にする。
  function buildEmptyRound1(names){
    const size = nextPow2(names.length);
    const matchCount = size/2;
    const byeCount = size - names.length;
    const round1 = [];
    for(let i=0;i<matchCount;i++){
      round1.push({a:null, b:null, winner:null, loser:null, video:"", bye:false});
    }
    for(let i=0;i<byeCount;i++){
      round1[matchCount-1-i].bye = true;
    }
    return round1;
  }

  function resetDownstream(){
    state.order = [];
    state.remaining = state.people.map(p=>p.name);
    state.matches = state.remaining.length ? [buildEmptyRound1(state.remaining)] : [];
    state.thirdPlaceMatch = null;
    state.winnerName = "";
    persist();
  }

  // 次ラウンドの各スロットには、その勝者の出所(前ラウンドのカードindex)を aSrc/bSrc として記録する。
  // これにより、未決着のまま先のラウンドへ進んだ場合でも、後から前ラウンドを決着させた勝者を、
  // 正しい空きスロットへ入れられる(位置・相手・入れ替え結果は「進む」を押した時点で固定される)。
  function slotSourcedBy(r1, srcIdx){
    const round = state.matches[r1];
    if(!round) return null;
    for(let k=0;k<round.length;k++){
      if(round[k].aSrc === srcIdx) return {k, side:'a'};
      if(round[k].bSrc === srcIdx) return {k, side:'b'};
    }
    return null;
  }

  // 勝者が決まったカードmの勝者を、次ラウンドの対応スロットへ入れる(未決着で先に進んでいた場合の後追い反映)
  function propagateWinnerDownstream(r, m, name){
    const loc = slotSourcedBy(r+1, m);
    if(!loc) return;
    state.matches[r+1][loc.k][loc.side] = name;
  }

  // 選び直し時: カードmの旧勝者が入っていた下流スロットを空に戻し、そのカードの勝敗も無効化して連鎖的に掃除する
  function clearDownstreamFrom(r, m){
    const loc = slotSourcedBy(r+1, m);
    if(!loc) return;
    const card = state.matches[r+1][loc.k];
    card[loc.side] = null;
    if(card.winner){
      card.winner = null; card.loser = null;
      clearDownstreamFrom(r+1, loc.k);
    }
    // 準決勝(2試合)より先を触った場合は、3位決定戦・優勝も作り直しになるためクリアしておく
    if(state.matches[r].length === 2){ state.thirdPlaceMatch = null; }
    if(state.matches[r+1] && state.matches[r+1].length === 1){ state.winnerName = ""; }
  }

  // 準決勝(2試合)の両敗者が決まっていれば3位決定戦を作る(未生成なら)
  function maybeCreateThirdPlace(r){
    const round = state.matches[r];
    if(round && round.length === 2 && round[0].loser && round[1].loser && !state.thirdPlaceMatch){
      state.thirdPlaceMatch = { a:round[0].loser, b:round[1].loser, winner:null };
    }
  }

  // ラウンドrの勝者から次のラウンド(r+1)の組み合わせを生成する。「次のラウンドへ進む」で明示的に呼ぶ。
  // 撮影不可同士になる組を、決着済みの勝者だけを使って撮影可同士の組と入れ替える。
  // 不可同士が無ければ入れ替えは起きない(順序を保つ)。未決着カードの勝者スロットはnull(後から後追い反映)。
  function advanceRound(r){
    const round = state.matches[r];
    if(!round || round.length < 2) return false;
    const matchCount = round.length / 2;
    const recMap = recMapOf();

    // naive: 次カードk = [前カード2kの勝者, 前カード2k+1の勝者]。srcで対応を固定する
    const slots = [];
    for(let k=0;k<matchCount;k++){
      slots.push({ a: round[2*k].winner || null, aSrc: 2*k, b: round[2*k+1].winner || null, bSrc: 2*k+1 });
    }

    // 撮影不可回避: 両方決着済みで撮影不可同士のカードを、両方決着済みで撮影可同士のカードと入れ替える。
    // 片側スロット(名前とsrcをセット)を交換して対応関係を保つ(既存の入れ替え方と同じ考え方)。
    const decided = [];
    for(let k=0;k<matchCount;k++){ if(slots[k].a && slots[k].b) decided.push(k); }
    for(const ii of decided){
      const a = slots[ii].a, b = slots[ii].b;
      if(recMap[a] || recMap[b]) continue; // 不可同士でなければそのまま
      let bestJJ = -1, bestDist = Infinity;
      for(const jj of decided){
        if(jj === ii) continue;
        if(recMap[slots[jj].a] && recMap[slots[jj].b]){
          const dist = Math.abs(jj - ii);
          if(dist < bestDist){ bestDist = dist; bestJJ = jj; }
        }
      }
      if(bestJJ >= 0){
        const nB = slots[ii].b, nBSrc = slots[ii].bSrc;
        slots[ii].b = slots[bestJJ].a; slots[ii].bSrc = slots[bestJJ].aSrc;
        slots[bestJJ].a = nB; slots[bestJJ].aSrc = nBSrc;
      }
    }

    // r+1以降を作り直す(「進む」の再実行にも対応)
    state.matches = state.matches.slice(0, r+1);
    state.matches[r+1] = slots.map(s=>({ a:s.a, b:s.b, aSrc:s.aSrc, bSrc:s.bSrc, winner:null, loser:null, video:"" }));
    state.thirdPlaceMatch = null;
    state.winnerName = "";
    maybeCreateThirdPlace(r);
    persist();
    return true;
  }

  // r回戦より先に、実際の対戦カードや結果が1つでも存在するかどうか
  // (まだ何も確定していない空枠だけなら、変更しても実質的に失われるものはない)
  function hasDownstreamProgress(r){
    for(let i=r+1; i<state.matches.length; i++){
      if(state.matches[i].some(m => m.a !== null)) return true;
    }
    if(state.thirdPlaceMatch) return true;
    return false;
  }

  // pickWinnerAsSeedで不戦勝(シード)化した対戦を、通常の対戦の状態に戻す。
  // 本物のシード枠は1回戦(r===0・b===null)にしか存在しないため、それ以外のbyeは常に解除してよい。
  // ⚠️ 「a&&b が両方ある時だけ解除」という条件にすると、片側だけ埋まった不戦勝カード
  // (相手が永久に入らない枠を不戦勝で確定したもの)でbyeが残り続け、slotDndEligibleが
  // それを1回戦の本物のシード枠と誤認してD&D対象にしてしまう。ラウンドで判定すること
  function clearPickedSeedFlag(r, match){
    if(!match.bye) return;
    if(r === 0 && !match.b) return;   // 1回戦の本物のシード枠は維持する
    match.bye = false;
  }

  function pickWinner(r, m, side){
    const match = state.matches[r][m];
    const val = side === 'a' ? match.a : match.b;
    if(!val) return;
    const isRepick = !!match.winner && match.winner !== val;
    const loser = side === 'a' ? match.b : match.a;
    match.winner = val;
    match.loser = loser || null;
    // 以前pickWinnerAsSeedで不戦勝(シード)化していた対戦を、通常の勝敗入力で選び直した場合は
    // 見た目も通常の決着済み対戦に戻す
    clearPickedSeedFlag(r, match);

    // 決勝(1試合)の勝者は優勝者
    if(state.matches[r].length === 1){
      state.winnerName = match.winner;
      persist();
      return;
    }
    // 選び直しの場合は、旧勝者が入っていた下流スロットを掃除してから新勝者を反映する
    if(isRepick){ clearDownstreamFrom(r, m); }
    // 次のラウンドが既に生成済みなら、この勝者を対応スロットへ後追い反映する
    if(state.matches[r+1]){ propagateWinnerDownstream(r, m, val); }
    // 準決勝の両敗者が揃ったら3位決定戦を作る
    maybeCreateThirdPlace(r);
    persist();
  }

  // 対戦を実際には行わせず、不戦勝(シード)として片方を勝ち上がらせる。
  // pickWinnerとほぼ同じだが、a/bはどちらも残したままmatch.bye=trueを立てる(見た目をシード枠にするため)。
  // これにより、対戦せずに次ラウンドへ進めたい枠(相手が見つからない・単に見栄えの都合等)に対応できる。
  //
  // 2つの使われ方がある:
  //  1. 両者決まっている対戦を不戦勝にする → 敗れた側は通常の敗者と同様に扱う(順位・戦績も通常の敗北と同じ)
  //  2. 片側だけ埋まった枠(相手が前ラウンドの空カード由来で永久に入らない)を確定する
  //     → loserがnullになる。3位決定戦は「両敗者が揃った時」しか作られないので、準決勝で
  //        このケースが起きると3位決定戦は作られない(敗者が存在しないため、仕様として正しい)
  function pickWinnerAsSeed(r, m, side){
    const match = state.matches[r][m];
    const val = side === 'a' ? match.a : match.b;
    if(!val) return;
    const isRepick = !!match.winner && match.winner !== val;
    const loser = side === 'a' ? match.b : match.a;
    match.winner = val;
    match.loser = loser || null;
    match.bye = true;

    if(state.matches[r].length === 1){
      state.winnerName = match.winner;
      persist();
      return;
    }
    if(isRepick){ clearDownstreamFrom(r, m); }
    if(state.matches[r+1]){ propagateWinnerDownstream(r, m, val); }
    maybeCreateThirdPlace(r);
    persist();
  }

  // 決着済みカードの勝敗を取り消す(下流に伝播済みなら一緒に掃除する)
  function resetMatchResult(r, m){
    const match = state.matches[r][m];
    if(!match || !match.winner) return;
    if(state.matches[r].length === 1){ state.winnerName = ""; }
    else { clearDownstreamFrom(r, m); }
    match.winner = null; match.loser = null;
    // pickWinnerAsSeedで不戦勝(シード)化した対戦を取り消す場合は、通常の対戦の状態に戻す
    clearPickedSeedFlag(r, match);
    persist();
  }

  function pickThirdPlaceWinner(side){
    const m = state.thirdPlaceMatch;
    if(!m) return;
    const val = side === 'a' ? m.a : m.b;
    if(!val) return;
    m.winner = val;
    persist();
  }

  // 3位決定戦の勝敗を取り消す。トーナメント本体と違い先の対戦が無いので、勝者を消すだけでよい
  // (resetMatchResultはstate.matches[r][m]を見るため3位決定戦では使えない)。
  // a/bは残るので、そのまま選び直せる
  function resetThirdPlaceWinner(){
    const m = state.thirdPlaceMatch;
    if(!m || !m.winner) return;
    m.winner = null;
    persist();
  }

  // 対戦が始まった後でも参加者名を書き換えられるよう、全ラウンド・3位決定戦・優勝者名・参加者一覧まで
  // 同じ名前をまとめて置き換える(対戦表の接続線は勝者名の一致で辿っているため、一部だけ書き換えると
  // つながりが壊れてしまう)
  function renameParticipant(oldName, newName){
    if(!oldName || !newName || oldName === newName) return;
    const swap = v => v === oldName ? newName : v;
    state.matches.forEach(round=>{
      round.forEach(m=>{
        m.a = swap(m.a); m.b = swap(m.b);
        m.winner = swap(m.winner); m.loser = swap(m.loser);
      });
    });
    if(state.thirdPlaceMatch){
      const tp = state.thirdPlaceMatch;
      tp.a = swap(tp.a); tp.b = swap(tp.b); tp.winner = swap(tp.winner);
    }
    state.winnerName = swap(state.winnerName);
    state.order = state.order.map(swap);
    const person = state.people.find(p=>p.name===oldName);
    if(person) person.name = newName;
    const rIdx = state.roster.indexOf(oldName);
    if(rIdx>=0) state.roster[rIdx] = newName;
    if(Object.prototype.hasOwnProperty.call(state.userRecDefaults, oldName)){
      state.userRecDefaults[newName] = state.userRecDefaults[oldName];
      delete state.userRecDefaults[oldName];
    }
    if(Object.prototype.hasOwnProperty.call(state.archivedUsers, oldName)){
      state.archivedUsers[newName] = state.archivedUsers[oldName];
      delete state.archivedUsers[oldName];
    }
    persist();
  }

  // 大会途中で参加者が増えた場合、空いているBYE(不戦勝)枠に新しい参加者を入れて実際の対戦に変える。
  // それより先のラウンドはいったん破棄され、「次のラウンドへ進む」で組み直す。
  // シード枠への飛び入り登録。保持者(a)が未定ならa(自動勝利)として、決まっていればb(挑戦者)として追加する。
  // 挑戦者を追加した場合は実質ただの通常対戦になるため、bye扱いを解除する(D&D対象・自動勝利判定などの
  // 特別扱いをやめて、以降は他の通常枠と同じに振る舞わせるため)
  function addChallengerToBye(r, m, name){
    const match = state.matches[r] && state.matches[r][m];
    if(!match) return;
    name = (name||'').trim();
    if(!name) return;
    if(match.a === null){
      if(name === match.b) return;
      match.a = name;
      match.winner = name;
    } else {
      if(match.b !== null || name === match.a) return;
      match.b = name;
      match.winner = null;
      match.loser = null;
      match.bye = false;
    }
    if(!state.roster.includes(name)) state.roster.push(name);
    if(!state.people.some(p=>p.name===name)) state.people.push({name, rec:true});
    state.matches = state.matches.slice(0, r+1);
    state.thirdPlaceMatch = null;
    state.winnerName = "";
    persist();
  }

  // ラウンド1がまだ1試合も決着していない(=組み合わせをいつでも自由に組み替えられる)かどうか
  function bracketNotStarted(){
    if(!state.matches.length) return true;
    return !state.matches[0].some(m => m.b !== null && m.winner);
  }

  function forcedPairsList(){
    const recMap = recMapOf();
    const forced = [];
    state.matches.forEach((round, r)=>{
      round.forEach(m=>{
        if(m.a && m.b && !recMap[m.a] && !recMap[m.b]){
          forced.push({r, a:m.a, b:m.b});
        }
      });
    });
    return forced;
  }

  /* ---------- 大会の順位計算(過去の大会・戦績で共通利用) ---------- */
  // 大会の最終結果(matches/thirdPlaceMatch/championName)から、参加者ごとの順位を割り出す
  function computePlacements(entry){
    const result = {};
    const matches = entry.matches || [];
    const champion = entry.championName;
    // 決勝(最終ラウンドが1試合だけ)が優勝者確定まで終わっている場合のみ準優勝を確定させる。
    // 途中終了した大会では最後の配列要素が準決勝以前のこともあるため、誤って準優勝扱いにしない。
    const finalRound = matches.length ? matches[matches.length-1] : null;
    const runnerUp = (champion && finalRound && finalRound.length===1 && finalRound[0]) ? finalRound[0].loser : null;
    const thirdName = entry.thirdPlaceMatch ? entry.thirdPlaceMatch.winner : null;
    const fourthName = (entry.thirdPlaceMatch && thirdName) ? (entry.thirdPlaceMatch.a===thirdName ? entry.thirdPlaceMatch.b : entry.thirdPlaceMatch.a) : null;
    (entry.participants||[]).forEach(p=>{
      let place=null, label='参加(結果未確定)', roundIdx=-1;
      if(champion && p.name===champion){ place=1; label='🥇 優勝'; }
      else if(runnerUp && p.name===runnerUp){ place=2; label='🥈 準優勝'; }
      else if(thirdName && p.name===thirdName){ place=3; label='🥉 3位'; }
      else if(fourthName && p.name===fourthName){ place=4; label='4位'; }
      else{
        matches.forEach((round,r)=>{ round.forEach(m=>{ if(m.loser===p.name) roundIdx=Math.max(roundIdx,r); }); });
        if(roundIdx>=0){ label = roundLabel(matches[roundIdx].length)+'敗退'; }
      }
      result[p.name] = {place, label, roundIdx};
    });
    return result;
  }

  // 大会ごとのポイントを計算する: 実際の対戦での勝利(BYEによる不戦勝は含まない)1回につき1P。
  // これに加えて順位ボーナス(優勝10P・準優勝7P・3位5P・4位3P)を上乗せする。
  function computeTournamentPoints(entry){
    const points = {};
    (entry.participants||[]).forEach(p=>{ points[p.name] = 0; });
    (entry.matches||[]).forEach(round=>{
      round.forEach(m=>{
        if(m.a && m.b && m.winner && !m.bye){ points[m.winner] = (points[m.winner]||0) + 1; }
      });
    });
    const tp = entry.thirdPlaceMatch;
    if(tp && tp.a && tp.b && tp.winner){ points[tp.winner] = (points[tp.winner]||0) + 1; }
    const placements = computePlacements(entry);
    const bonusByPlace = {1:10, 2:7, 3:5, 4:3};
    Object.keys(placements).forEach(name=>{
      const bonus = bonusByPlace[placements[name].place];
      if(bonus){ points[name] = (points[name]||0) + bonus; }
    });
    return points;
  }

  // 登録者全員(まだ大会に出ていない人も含む)を対象に、通算ポイント・優勝/準優勝/3位/4位の回数を集計する
  function computeAllTimeStats(){
    const stats = {};
    const ensure = name=>{
      if(!stats[name]) stats[name] = {name, points:0, p1:0, p2:0, p3:0, p4:0, played:0};
      return stats[name];
    };
    state.roster.forEach(name=> ensure(name));
    allFinishedEntries().forEach(entry=>{
      const pts = computeTournamentPoints(entry);
      const placements = computePlacements(entry);
      (entry.participants||[]).forEach(p=>{
        const s = ensure(p.name);
        s.played += 1;
        s.points += (pts[p.name]||0);
        const place = placements[p.name] ? placements[p.name].place : null;
        if(place===1) s.p1++; else if(place===2) s.p2++; else if(place===3) s.p3++; else if(place===4) s.p4++;
      });
    });
    return Object.values(stats);
  }

  // 過去の大会(state.history)に加え、優勝が決まった今回の大会もあわせて集計対象にする
  // 戦績集計の対象: 優勝が決まっている全大会(終了済み・進行中を問わない)
  function allFinishedEntries(){
    return state.tournaments
      .filter(t=> t.status==='completed' || t.winnerName)
      .map(t=>({ title:t.title, championName:t.winnerName||null, matches:t.matches, thirdPlaceMatch:t.thirdPlaceMatch, participants:t.people }));
  }

  /* ---------- 大会のライフサイクル ---------- */
  // プレフィックスは診断用(g=ゲスト/t=認証済み)。由来の正はpoolKindOfTournamentId()で、
  // このプレフィックスに依存しない(サーバー側=data/tournaments.json由来のidはこの形式を保証しないため)。
  function newTournamentId(){ return (currentPoolKind()==='guest'?'g':'t')+Date.now()+Math.random().toString(36).slice(2,8); }

  // アクティブな大会を終了(status='completed')にする。複数同時進行なので他の大会には影響しない。
  function endCurrentTournament(){
    const t = activeT();
    if(t){ t.status = 'completed'; }
    state.activeId = null;
    persist();
  }

  /* ---------- 歴代優勝者カード ---------- */
  const THEMES = {
    ember:{bg1:"#3a0f02",bg2:"#0a0603",ring:"#e8b34c",accent:"#ff6a2b",glow:"rgba(255,106,43,.55)"},
    ice:{bg1:"#04213a",bg2:"#040912",ring:"#bfe9ff",accent:"#4fd1e8",glow:"rgba(79,209,232,.55)"},
    forest:{bg1:"#0c3a1a",bg2:"#050c07",ring:"#a8e83b",accent:"#2bc97a",glow:"rgba(43,201,122,.5)"}
  };
  const THEME_KEYS = Object.keys(THEMES);
  // 大会名から毎回同じテーマ色になるよう決定的に選ぶ(見た目に変化を持たせるため)
  function themeForTitle(title){
    let h = 0;
    for(let i=0;i<title.length;i++) h = (h*31 + title.charCodeAt(i)) >>> 0;
    return THEMES[THEME_KEYS[h % THEME_KEYS.length]];
  }
  function drawCard(canvas, title, name, theme){
    const cctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    cctx.clearRect(0,0,W,H);
    const grad = cctx.createRadialGradient(W/2,H*0.38,40,W/2,H*0.38,W*0.75);
    grad.addColorStop(0, theme.bg1); grad.addColorStop(1, theme.bg2);
    cctx.fillStyle = grad; cctx.fillRect(0,0,W,H);
    cctx.save(); cctx.translate(W/2,H*0.38); cctx.globalAlpha = 0.25;
    for(let i=0;i<28;i++){
      cctx.rotate(Math.PI*2/28);
      cctx.beginPath(); cctx.moveTo(0,0); cctx.lineTo(W*0.7,-14); cctx.lineTo(W*0.7,14); cctx.closePath();
      cctx.fillStyle = theme.accent; cctx.fill();
    }
    cctx.restore(); cctx.globalAlpha = 1;
    const circ = cctx.createRadialGradient(W/2,H*0.42,W*0.1,W/2,H*0.42,W*0.62);
    circ.addColorStop(0,"rgba(0,0,0,0)"); circ.addColorStop(1,"rgba(0,0,0,0.55)");
    cctx.fillStyle = circ; cctx.fillRect(0,0,W,H);
    cctx.strokeStyle = theme.ring; cctx.lineWidth = 10;
    cctx.beginPath(); cctx.arc(W/2,H/2,W/2-10,0,Math.PI*2); cctx.stroke();
    cctx.strokeStyle = "rgba(255,255,255,.25)"; cctx.lineWidth = 2;
    cctx.beginPath(); cctx.arc(W/2,H/2,W/2-26,0,Math.PI*2); cctx.stroke();
    cctx.font = "80px serif"; cctx.fillStyle = theme.ring; cctx.textAlign = "center";
    cctx.shadowColor = theme.glow; cctx.shadowBlur = 30;
    cctx.fillText("👑", W/2, H*0.30); cctx.shadowBlur = 0;
    cctx.font = "600 22px 'Noto Sans JP', sans-serif"; cctx.fillStyle = "rgba(255,255,255,.75)";
    cctx.letterSpacing = "6px"; cctx.fillText("W I N N E R", W/2, H*0.40); cctx.letterSpacing = "0px";
    let fontSize = 92;
    cctx.font = `900 ${fontSize}px 'Cinzel', 'Noto Serif JP', serif`;
    while(cctx.measureText(name).width > W*0.78 && fontSize > 40){
      fontSize -= 4; cctx.font = `900 ${fontSize}px 'Cinzel', 'Noto Serif JP', serif`;
    }
    cctx.fillStyle = "#fff8ec"; cctx.shadowColor = theme.glow; cctx.shadowBlur = 36;
    cctx.fillText(name, W/2, H*0.56); cctx.shadowBlur = 0;
    cctx.font = "700 26px 'Noto Serif JP', serif"; cctx.fillStyle = theme.ring;
    cctx.fillText(`優勝者 ${name}`, W/2, H*0.88);
    let titleSize = 15;
    cctx.font = `500 ${titleSize}px 'JetBrains Mono', monospace`;
    while(cctx.measureText(title).width > W*0.8 && titleSize > 9){
      titleSize -= 1; cctx.font = `500 ${titleSize}px 'JetBrains Mono', monospace`;
    }
    cctx.fillStyle = "rgba(255,255,255,.5)";
    cctx.fillText(title, W/2, H*0.93);
  }
  async function generateAndSaveCard(canvas, title, name){
    if(document.fonts && document.fonts.ready){ await document.fonts.ready; }
    drawCard(canvas, title, name, themeForTitle(title));
    canvas.style.display = "block";
    const link = document.createElement("a");
    link.download = `atsucup_winner_${name}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
  // 優勝が確定した大会だけを、新しい順に一覧表示する(終了済み・進行中を問わない)
  function championEntries(){
    return state.tournaments.filter(t=>t.winnerName).map(t=>({
      id:t.id, title:t.title, details:t.details, posterUrl:t.posterUrl, createdAt:t.createdAt,
      championName:t.winnerName, matches:t.matches, thirdPlaceMatch:t.thirdPlaceMatch, participants:t.people
    })).reverse();
  }

  /* ---------- 対戦動画 ---------- */
  function ytId(url){
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/);
    return m ? m[1] : null;
  }
  function hostFromUrl(u){ try{ return new URL(u).hostname.replace('www.',''); }catch(e){ return 'link'; } }
  function videoEmbedHtml(url){
    if(!url) return '';
    const yid = ytId(url);
    if(yid){ return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${yid}" allowfullscreen loading="lazy"></iframe></div>`; }
    if(/\.(mp4|webm|mov)(\?|$)/i.test(url)){ return `<div class="video-embed"><video controls preload="metadata" src="${url}"></video></div>`; }
    return `<a class="video-link-btn" href="${url}" target="_blank" rel="noopener">🔗 動画を開く (${hostFromUrl(url)})</a>`;
  }
  function matchesToPlayable(matches){
    const list = [];
    (matches||[]).forEach((round, r)=>{
      round.forEach((m,i)=>{
        if(m.a && m.b) list.push({r,i,m});
      });
    });
    return list;
  }
  /* ---------- 更新通知バナー(あつ杯の全ページ共通、モンヒロと同じ方式) ---------- */
  // 更新のたびに手動で書き換える(日付+時刻、JST) ※version.jsonのbuildも同じ値に合わせること
  const BUILD_DATE = "2026-07-28 06:40";
  function initUpdateBanner(){
    if(typeof document === 'undefined' || !document.body) return;
    if(document.getElementById('atsucupUpdateBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'atsucupUpdateBanner';
    banner.className = 'atsucup-update-banner';
    banner.style.display = 'none';
    banner.innerHTML = '<button id="atsucupUpdateReloadBtn">⟳ 新しいバージョンがあります。タップして更新</button>';
    document.body.appendChild(banner);
    document.getElementById('atsucupUpdateReloadBtn').addEventListener('click', ()=> location.reload());
    function checkVersion(){
      fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
        .then(res=> res.ok ? res.json() : null)
        .then(data=>{
          if(!(data && data.build && data.build !== BUILD_DATE)) return;
          banner.style.display = 'flex';
          // 初回訪問者やバナーに気づかないユーザーがキャッシュ済みの古いJSのまま
          // 使い続けてしまわないよう、検知時に1回だけ自動でリロードして自己修復する
          // (無限リロードを避けるため、このタブのセッション内で1回のみ)
          if(!sessionStorage.getItem('atsucupAutoReloaded')){
            sessionStorage.setItem('atsucupAutoReloaded', '1');
            location.reload();
          }
        })
        .catch(()=>{});
    }
    checkVersion();
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') checkVersion(); });
    setInterval(checkVersion, 5 * 60 * 1000);
  }
  /* ---------- セッション切れバナー(全ページ共通・画面下部固定) ---------- */
  // ⚠️ 以前は大会詳細の一部の分岐でだけ、しかもページ上部に出していた。対戦表が縦に長い大会では
  //    下までスクロールすると気づけず、「編集したのに保存できない」状態に陥っていた
  //    (2026-07-28にユーザーから指摘)。全ページで、スクロールしても常に見える下部固定にする。
  //    上部固定の更新通知バナー(.atsucup-update-banner)とは位置が競合しない。
  function initSessionExpiredBanner(){
    if(typeof document === 'undefined' || !document.body) return;
    if(document.getElementById('atsucupSessionBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'atsucupSessionBanner';
    banner.className = 'atsucup-session-banner';
    banner.innerHTML = '<span>⚠️ ログインの有効期限が切れました。編集するには再ログインしてください。</span>'
      + '<button type="button" id="atsucupSessionReloginBtn">再ログイン</button>';
    document.body.appendChild(banner);
    document.getElementById('atsucupSessionReloginBtn').addEventListener('click', ()=>{
      // coreには再描画の購読機構が無いため、他の同種UI(showGuestWipeBanner/showSyncConflictModal)と
      // 同じくリロードで画面全体を揃える
      if(typeof GoogleAuth !== 'undefined') GoogleAuth.signIn().then(()=> location.reload()).catch(()=>{});
    });

    function update(){
      const show = (typeof GoogleAuth !== 'undefined') && GoogleAuth.sessionExpired();
      banner.classList.toggle('is-on', show);
      document.body.classList.toggle('atsucup-has-session-banner', show);
      // 下部トースト(.atsucup-resync-toast)がこのバーに重ならないよう、実測の高さを共有する
      // (文言が2行に折り返す端末でも自動で追従する)
      document.documentElement.style.setProperty('--atsucup-bottom-bar', show ? banner.offsetHeight + 'px' : '0px');
    }
    update();
    // トークンは時間経過で切れる(約1時間)。切れた瞬間の通知は無いので、開きっぱなしでも
    // 気づけるよう定期確認する。sessionExpired()はgetIdToken()が期限切れトークンを毎回
    // 破棄する作りなので、呼べば常に正しい状態が返る
    setInterval(update, 60 * 1000);
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') update(); });
    if(typeof GoogleAuth !== 'undefined') GoogleAuth.onStateChange(update); // 再ログイン/ログアウトに追従
  }

  if(typeof document !== 'undefined'){
    const bootBanners = ()=>{ initUpdateBanner(); initSessionExpiredBanner(); };
    if(document.body) bootBanners();
    else document.addEventListener('DOMContentLoaded', bootBanners);
  }

  // 保険: 各画面がpersist()を呼び忘れているケースがあっても、画面を離れる瞬間に必ず保存する
  if(typeof window !== 'undefined'){
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden') persist(); });
  }

  // data/*.json の取り込みは「最初に AtsuCup.ready を参照した時点」で開始する。
  // 各ページは restore() の後に参照するため、localStorageの復元→リモート取り込みの順序が保証される。
  let readyPromise = null;

  return {
    get ready(){ if(!readyPromise) readyPromise = loadFromData(); return readyPromise; },
    mergeRemoteTournaments, pruneTournamentsGoneFromServer, saveTournamentToData, saveTournamentMetaToData, saveUsersToData, archiveTournamentInData,
    checkRemoteNewerBeforeSave, confirmOverwriteIfRemoteNewer, showSyncChoiceModal,
    dateInputValueOf, isoFromDateInputValue,
    state, STORE_KEY, persist, restore, escapeHtml, roundLabel, recMapOf, resizeImageToDataUrl,
    nextPow2, shuffleArray, pairWithConstraint, buildRound1, buildEmptyRound1, resetDownstream,
    advanceRound, pickWinner, pickWinnerAsSeed, resetMatchResult, pickThirdPlaceWinner, resetThirdPlaceWinner, renameParticipant, addChallengerToBye, bracketNotStarted, forcedPairsList, hasDownstreamProgress,
    propagateWinnerDownstream,
    computePlacements, computeTournamentPoints, computeAllTimeStats, allFinishedEntries, endCurrentTournament, newTournamentId,
    setActive, activeT,
    isGuestMode, pool, authPool, guestPool, poolKindOfTournamentId, guestPoolHasData,
    THEMES, themeForTitle, drawCard, generateAndSaveCard, championEntries,
    ytId, hostFromUrl, videoEmbedHtml, matchesToPlayable
  };
})();
