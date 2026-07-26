// あつ杯ツール共通のstate管理・データロジック(全ページで共有、この端末のlocalStorageだけで完結)
const AtsuCup = (function(){
  "use strict";

  const STORE_KEY = "atsucup:state:v2";

  // 複数の大会を同時に進行できるよう、各大会が自分の進行データ(people/matches等)を持つ。
  // 端末共通のデータ(roster/userRecDefaults/archivedUsers)だけstate直下に置く。
  const state = {
    roster: [],       // [name, ...] この端末に登録済みの参加者マスタ(大会をまたいで再利用)
    userRecDefaults: {}, // {name: boolean} ユーザーごとの撮影可否デフォルト値
    archivedUsers: {}, // {name: boolean} アーカイブ済みユーザー
    tournaments: [],  // [{id,title,details,posterUrl,createdAt,status,people,order,remaining,matches,winnerName,thirdPlaceMatch}]
    activeId: null    // 現在操作対象の大会id(各画面が ?id= から setActive でセット)
  };

  function activeT(){ return state.tournaments.find(t=>t.id===state.activeId) || null; }
  function setActive(id){ state.activeId = id || null; }
  function newBlankTournament(meta){
    return {
      id: meta.id, title: meta.title||"", details: meta.details||"", posterUrl: meta.posterUrl||null,
      createdAt: new Date().toISOString(), status: 'ongoing',
      people: [], order: [], remaining: [], matches: [], winnerName: "", thirdPlaceMatch: null
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
    get(){ const t=activeT(); return t ? {id:t.id,title:t.title,details:t.details,posterUrl:t.posterUrl} : {id:null,title:"",details:"",posterUrl:null}; },
    set(v){
      if(!v || !v.title){ state.activeId = null; return; } // 空メタ代入はアクティブ解除(旧endの名残)
      const existing = state.tournaments.find(t=>t.id===v.id);
      if(existing){ existing.title=v.title; existing.details=v.details; existing.posterUrl=v.posterUrl; state.activeId=existing.id; }
      else { const nt=newBlankTournament(v); state.tournaments.push(nt); state.activeId=nt.id; }
    }
  });
  // 後方互換: state.history は「終了済みの大会」を旧history形式(participants/championName)で見せる
  Object.defineProperty(state, 'history', {
    enumerable:false,
    get(){
      return state.tournaments.filter(t=>t.status==='completed').map(t=>({
        id:t.id, title:t.title, details:t.details, posterUrl:t.posterUrl, createdAt:t.createdAt,
        finished:!!t.winnerName, championName:t.winnerName||null,
        matches:t.matches, thirdPlaceMatch:t.thirdPlaceMatch, participants:t.people
      }));
    },
    set(v){
      // 「state.history = state.history.filter(...)」による削除に対応(渡された配列に無いcompletedを削除)
      const keep = new Set((v||[]).map(h=>h.id));
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
          ...state, // enumerableな実データ(roster/userRecDefaults/archivedUsers/tournaments/activeId)のみ
          tournaments: state.tournaments.map(t=>({ ...t, posterUrl: null }))
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
    // 各大会の参加者で、登録者マスタ(roster)に無い人がいれば反映しておく
    const rosterSet = new Set(state.roster);
    state.tournaments.forEach(t=>{
      (t.people||[]).forEach(p=>{ if(!rosterSet.has(p.name)){ state.roster.push(p.name); rosterSet.add(p.name); } });
    });
  }

  /* ---------- data/*.json(GitHub側=正) の取り込み ---------- */
  const DATA_PATHS = { users:'data/users.json', tournaments:'data/tournaments.json', entries:'data/entries.json', matches:'data/matches.json' };

  // リモートの大会をローカルへ取り込む。ローカルに既に同じidがあれば触らず、無いものだけ追加する。
  //
  // ⚠️ 以前は同じidをリモートで無条件に上書きしていたが、これだと「保存ボタンを押すまでの
  // 進行状況」がページを開くたびに直前の保存内容へ引き戻されてしまう(2026-07-26に実際の
  // 不具合として発覚: 大会エントリーで参加者を変更しても大会詳細に戻ると消えている、
  // リセットしても再読み込みで元に戻る、等)。ローカル優先に変更したことで、他端末での
  // 保存内容は「ローカルにまだ無い大会」としてしか自動反映されなくなる
  // (＝同じ大会を他端末の最新保存内容で更新したい場合は、ローカル側の該当大会を
  // 一旦削除するなど手動の取り込み操作が必要になる)。
  function mergeRemoteTournaments(remoteList){
    (remoteList||[]).forEach(rt=>{
      const local = state.tournaments.find(t=>t.id===rt.id);
      if(!local){ state.tournaments.push(rt); }
    });
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
      mergeRemoteTournaments(AtsuCupData.toAppTournaments({ users, tournaments, entries, matches }));
      persist();
      return { ok:true, counts:{ users:users.length, tournaments:tournaments.length } };
    }catch(e){
      console.warn('[atsucup] data/ の取り込みに失敗しました:', e);
      return { ok:false, error:(e && e.message) || String(e) };
    }
  }

  // 端末のユーザーマスタ(roster/recDefaults/archived)を GAS 経由でシート/GitHubへ反映する。
  // IDの採番はサーバ側(GAS)が行う(複数端末からの同時登録で衝突しないように)。
  async function saveUsersToData(){
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
    if(typeof GasDB === 'undefined') throw new Error('GAS連携モジュールが読み込まれていません。');
    if(!GasDB.canWrite()) throw new Error('ログインが必要です。「設定」画面からGoogleログインしてください。');
    const t = state.tournaments.find(x=>x.id===tournamentId);
    if(!t) throw new Error('保存対象の大会が見つかりません。');

    const names = (t.people||[]).map(p=>p.name);
    // 名前をそのまま「id」として使う変換(identity map)。fromAppTournamentの出力の
    // userId/player*Id欄に実IDではなく名前が入り、GAS側でそこから実IDへ解決する。
    const identity = {};
    names.forEach(n=>{ identity[n] = n; });
    const { tournamentRow, entryRows, matchRows } = AtsuCupData.fromAppTournament(t, identity);

    return GasDB.saveTournament({ tournamentRow, entryRows, matchRows, participantNames: names });
  }

  // localStorageのデータを新形式(tournaments配列)に取り込む。旧形式(tournamentMeta+history+直下people)は移行する。
  function migrate(data){
    state.roster = data.roster || [];
    state.userRecDefaults = data.userRecDefaults || {};
    state.archivedUsers = data.archivedUsers || {};
    if(Array.isArray(data.tournaments)){
      state.tournaments = data.tournaments;
      state.activeId = data.activeId || null;
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

  function pickWinner(r, m, side){
    const match = state.matches[r][m];
    const val = side === 'a' ? match.a : match.b;
    if(!val) return;
    const isRepick = !!match.winner && match.winner !== val;
    const loser = side === 'a' ? match.b : match.a;
    match.winner = val;
    match.loser = loser || null;

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

  // 決着済みカードの勝敗を取り消す(下流に伝播済みなら一緒に掃除する)
  function resetMatchResult(r, m){
    const match = state.matches[r][m];
    if(!match || !match.winner) return;
    if(state.matches[r].length === 1){ state.winnerName = ""; }
    else { clearDownstreamFrom(r, m); }
    match.winner = null; match.loser = null;
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
  function addChallengerToBye(r, m, name){
    const match = state.matches[r] && state.matches[r][m];
    if(!match || match.b !== null) return;
    name = (name||'').trim();
    if(!name || name === match.a) return;
    match.b = name;
    match.winner = null;
    match.loser = null;
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
        if(m.a && m.b && m.winner){ points[m.winner] = (points[m.winner]||0) + 1; }
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
  function newTournamentId(){ return 't'+Date.now()+Math.random().toString(36).slice(2,8); }

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
  // 全大会(進行中・終了済み)を新しい順に選択肢にする
  function videoTournamentList(){
    return state.tournaments.slice().reverse().map(t=>({ key:t.id, title:t.title, matches:t.matches||[] }));
  }

  /* ---------- 更新通知バナー(あつ杯の全ページ共通、モンヒロと同じ方式) ---------- */
  // 更新のたびに手動で書き換える(日付+時刻、JST) ※version.jsonのbuildも同じ値に合わせること
  const BUILD_DATE = "2026-07-26 22:49";
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
          if(data && data.build && data.build !== BUILD_DATE){ banner.style.display = 'flex'; }
        })
        .catch(()=>{});
    }
    checkVersion();
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') checkVersion(); });
    setInterval(checkVersion, 5 * 60 * 1000);
  }
  if(typeof document !== 'undefined'){
    if(document.body) initUpdateBanner();
    else document.addEventListener('DOMContentLoaded', initUpdateBanner);
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
    mergeRemoteTournaments, saveTournamentToData, saveUsersToData,
    state, STORE_KEY, persist, restore, escapeHtml, roundLabel, recMapOf, resizeImageToDataUrl,
    nextPow2, shuffleArray, pairWithConstraint, buildRound1, buildEmptyRound1, resetDownstream,
    advanceRound, pickWinner, resetMatchResult, pickThirdPlaceWinner, renameParticipant, addChallengerToBye, bracketNotStarted, forcedPairsList, hasDownstreamProgress,
    propagateWinnerDownstream,
    computePlacements, computeTournamentPoints, computeAllTimeStats, allFinishedEntries, endCurrentTournament, newTournamentId,
    setActive, activeT,
    THEMES, themeForTitle, drawCard, generateAndSaveCard, championEntries,
    ytId, hostFromUrl, videoEmbedHtml, matchesToPlayable, videoTournamentList
  };
})();
