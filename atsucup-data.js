// data/*.json(SCHEMA.md準拠・IDキー・正規化) ↔ アプリ内部のstate.tournaments(名前キー・ネスト構造)
// を相互変換する層。アプリ側のロジックは名前キーのまま動かし、永続化するJSONだけをID化する。
const AtsuCupData = (function(){
  "use strict";

  const BLANK_CARD = ()=> ({ a:null, b:null, winner:null, loser:null, video:"", bye:false });

  /* ================= 読み込み: data/*.json → アプリ内部 ================= */

  // 勝者と両者から敗者を導出する(bye枠のようにbが居ない場合は敗者なし)
  function deriveLoser(a, b, winner){
    if(!winner || !a || !b) return null;
    return winner === a ? b : a;
  }

  // 決勝(最終ラウンドが1試合)の勝者を優勝者とみなす。アプリのpickWinnerと同じ判定。
  function deriveWinnerName(matches){
    if(!matches.length) return "";
    const finalRound = matches[matches.length-1];
    if(finalRound.length !== 1) return "";
    return finalRound[0].winner || "";
  }

  // matches行(フラット)を matches[round][index] の二次元配列に組み直す。
  //
  // ⚠️ 枠数は「実際にエクスポートされた行の数」からではなく、参加人数(participantCount)から
  // nextPow2で本来あるべき形を先に組み立て、そこへ実データを重ねる(buildEmptyRound1と同じ考え方)。
  // fromAppTournamentは「両者未定・勝者なしの完全に空の枠」を書き出さない設計のため、
  // 行数だけから枠数を逆算すると、空欄のまま保存した枠が消えて対戦表が縮んでしまう
  // (2026-07-26に実データで確認: 参加者3人・シード枠未選択のまま保存→再読み込みで
  // シード枠が消滅し、決勝しか無いかのような表示になっていた)。
  function buildMatchGrid(rows, nameOf, participantCount){
    const normal = rows.filter(r=> (r.stage||'normal') === 'normal');

    const size = AtsuCup.nextPow2(participantCount||0);
    if(size < 2) return [];
    const totalRounds = Math.round(Math.log2(size));
    const grid = [];
    for(let r=0;r<totalRounds;r++){
      const matchCount = size / Math.pow(2, r+1);
      const cards = [];
      for(let i=0;i<matchCount;i++) cards.push(BLANK_CARD());
      grid.push(cards);
    }
    // 1回戦のシード枠は常に末尾(buildEmptyRound1と同じ規則)。実データが無い枠の既定値として置く。
    const byeCount = size - (participantCount||0);
    for(let i=0;i<byeCount;i++){
      const idx = grid[0].length - 1 - i;
      if(grid[0][idx]) grid[0][idx].bye = true;
    }

    // 実データを上から重ねる
    normal.forEach(r=>{
      const rIdx = (r.round||1) - 1, mIdx = r.matchIndex||0;
      if(!grid[rIdx] || !grid[rIdx][mIdx]) return; // 想定外の範囲は無視(壊れたデータ対策)
      const a = nameOf(r.player1Id), b = nameOf(r.player2Id), winner = nameOf(r.winnerId);
      const loser = deriveLoser(a, b, winner);
      const video = r.videoUrl || "";
      // キーの並びはアプリ側の生成順(buildRound1 / advanceRound)に合わせる。
      // 2回戦以降は「前ラウンドのどのカードの勝者か」の対応関係も復元する(撮影不可回避の入れ替えを保持)
      const hasSrc = rIdx >= 1 && r.player1SrcIndex !== undefined && r.player1SrcIndex !== null;
      // ⚠️ byeは2回戦以降(hasSrcが真)でも必ず引き継ぐこと。pickWinnerAsSeed(不戦勝で確定)は
      // どのラウンドでも使えるため、ここで落とすと保存→サーバーから再読込した時点で
      // 不戦勝の見た目と判定が消える(2026-07-27に実際の不具合として発覚・修正)
      grid[rIdx][mIdx] = hasSrc
        ? { a, b, aSrc: r.player1SrcIndex, bSrc: r.player2SrcIndex, winner, loser, video, bye: !!r.isBye }
        : { a, b, winner, loser, video, bye: !!r.isBye };
    });
    return grid;
  }

  function buildThirdPlace(rows, nameOf){
    const row = rows.find(r=> r.stage === 'thirdPlace');
    if(!row) return null;
    return { a: nameOf(row.player1Id), b: nameOf(row.player2Id), winner: nameOf(row.winnerId) };
  }

  // data/*.json 一式から、アプリのstate.tournaments形式の配列を組み立てる
  function toAppTournaments(data){
    const users = data.users || [];
    const tournaments = data.tournaments || [];
    const entries = data.entries || [];
    const matches = data.matches || [];

    const nameById = {};
    users.forEach(u=>{ if(u && u.id) nameById[u.id] = u.name; });
    const nameOf = (id)=> (id === null || id === undefined) ? null : (nameById[id] || null);

    // アーカイブ済み(削除扱い)の大会はそもそも取り込まない。これにより歴代優勝者・戦績・
    // 大会一覧など、state.tournamentsを参照する箇所すべてから自動的に除外される。
    return tournaments.filter(t=> !t.archived).map(t=>{
      const myEntries = entries.filter(e=> e.tournamentId === t.id);
      const myMatches = matches.filter(m=> m.tournamentId === t.id);
      const grid = buildMatchGrid(myMatches, nameOf, myEntries.length);
      return {
        id: t.id,
        title: t.title || "",
        details: t.detail || "",
        posterUrl: t.posterImage || null,
        createdAt: t.heldAt || new Date().toISOString(),
        status: t.status || 'ongoing',
        isOfficial: !!t.isOfficial,
        isRestricted: !!t.isRestricted,
        people: myEntries.map(e=>({ name: nameOf(e.userId), rec: e.recAtEntry !== false })).filter(p=> !!p.name),
        order: [], remaining: [],
        matches: grid,
        winnerName: deriveWinnerName(grid),
        thirdPlaceMatch: buildThirdPlace(myMatches, nameOf)
      };
    });
  }

  /* ================= 書き込み: アプリ内部 → data/*.json ================= */

  // 大会の参加者名のうち users.json に未登録のものを採番して追加する。
  // (途中参加の飛び入りなど、roster経由で登録されずに大会だけに現れる名前を取りこぼさない)
  function ensureUserIds(names, users, genId){
    const list = users.slice();
    const idByName = {};
    list.forEach(u=>{ if(u && u.name) idByName[u.name] = u.id; });
    const added = [];
    names.forEach(name=>{
      if(!name || idByName[name]) return;
      const existingIds = new Set(list.map(u=>u.id));
      const id = genId('u', existingIds);
      const nu = { id, name, recDefault: true, archived: false, createdAt: new Date().toISOString(), note: "" };
      list.push(nu);
      idByName[name] = id;
      added.push(nu);
    });
    return { users: list, idByName, added };
  }

  // 実際の対戦(bye除く)での勝利数。computeTournamentPointsの勝ち数カウントと同じ基準。
  function countWins(t, name){
    let n = 0;
    (t.matches||[]).forEach(round=>{
      round.forEach(m=>{ if(m.a && m.b && m.winner === name) n++; });
    });
    const tp = t.thirdPlaceMatch;
    if(tp && tp.a && tp.b && tp.winner === name) n++;
    return n;
  }

  // 大会1件から、data/tournaments.json用の行(tournamentRow)だけを組み立てる。
  // saveTournamentToData(entries/matches込みのフル保存)とsaveTournamentMetaToData
  // (大会情報のみの保存)の両方から共通で使う(行の形は完全に同じにするため)。
  //
  // archivedは含めない(通常保存では触らない専用フィールド。GAS側のactionSaveTournament_/
  // actionUpdateTournamentMeta_が既存行の値をそのまま引き継ぐ。archiveTournamentアクション
  // のみがここを変更する)。
  //
  // ⚠️ Googleスプレッドシートは1セル50,000文字が上限。ポスター画像をdata URL(base64)の
  // まま直接セルへ保存すると、大きめの写真だとこの上限を超え、tournaments行の書き込み
  // そのものが失敗して大会情報(heldAt/status/archived等)ごと空欄化していた(2026-07-27発覚)。
  // → シートには保存せず、data URLのままローカルに残っている(＝まだアップロード未済の)
  //   画像だけを別送りし、GAS側でGitHubへ画像ファイルとして保存、そのURLだけをシートに
  //   書き込む(URLなら短いので上限にかからない)。既にアップロード済み(http(s)://の
  //   URLになっている)ものはそのまま渡すだけで再アップロードしない。
  function tournamentRowOf(t){
    const isLocalDataUrl = !!(t.posterUrl && t.posterUrl.indexOf('data:') === 0);
    const tournamentRow = {
      id: t.id,
      title: t.title || "",
      detail: t.details || "",
      posterImage: isLocalDataUrl ? null : (t.posterUrl || null),
      heldAt: t.createdAt || new Date().toISOString(),
      status: t.status || 'ongoing',
      isOfficial: !!t.isOfficial,
      isRestricted: !!t.isRestricted
    };
    const posterImageUpload = isLocalDataUrl ? t.posterUrl : null;
    return { tournamentRow, posterImageUpload };
  }

  // アプリの大会1件を、data/*.json の3テーブル分の行に分解する
  function fromAppTournament(t, idByName){
    const idOf = (name)=> (name && idByName[name]) ? idByName[name] : null;

    const { tournamentRow, posterImageUpload } = tournamentRowOf(t);

    // placementは既存の順位計算をそのまま再利用する(history形式のentryを渡す)
    const placements = AtsuCup.computePlacements({
      matches: t.matches || [],
      championName: t.winnerName || null,
      thirdPlaceMatch: t.thirdPlaceMatch || null,
      participants: t.people || []
    });

    const entryRows = (t.people||[]).map(p=>{
      const userId = idOf(p.name);
      return {
        id: `${t.id}_${userId}`,
        tournamentId: t.id,
        userId,
        placement: (placements[p.name] && placements[p.name].place) || null,
        wins: countWins(t, p.name),
        recAtEntry: p.rec !== false
      };
    });

    const matchRows = [];
    (t.matches||[]).forEach((round, rIdx)=>{
      round.forEach((m, mIdx)=>{
        // 完全な空枠(両者未定・勝者なし)は書き出さない。読み込み時にBLANK_CARDで復元される。
        if(!m.a && !m.b && !m.winner) return;
        const row = {
          id: `${t.id}_r${rIdx+1}_m${mIdx}`,
          tournamentId: t.id,
          round: rIdx + 1,          // スキーマは1始まり、アプリの配列indexは0始まり
          stage: 'normal',
          matchIndex: mIdx,
          player1Id: idOf(m.a),
          player2Id: idOf(m.b),
          winnerId: idOf(m.winner),
          isBye: !!m.bye,
          player1SrcIndex: (m.aSrc === undefined) ? null : m.aSrc,
          player2SrcIndex: (m.bSrc === undefined) ? null : m.bSrc,
          videoUrl: m.video || "",
          playedAt: null
        };
        matchRows.push(row);
      });
    });

    const tp = t.thirdPlaceMatch;
    if(tp && (tp.a || tp.b)){
      matchRows.push({
        id: `${t.id}_third`,
        tournamentId: t.id,
        round: 0,
        stage: 'thirdPlace',
        matchIndex: 0,
        player1Id: idOf(tp.a),
        player2Id: idOf(tp.b),
        winnerId: idOf(tp.winner),
        isBye: false,
        player1SrcIndex: null,
        player2SrcIndex: null,
        videoUrl: "",
        playedAt: null
      });
    }

    return { tournamentRow, entryRows, matchRows, posterImageUpload };
  }

  /* ================= users.json ↔ 端末のroster ================= */

  // users.json(ID付き) から、アプリが使う名前キーの3つのマップを作る
  function toAppRoster(users){
    const roster = [], userRecDefaults = {}, archivedUsers = {};
    (users||[]).forEach(u=>{
      if(!u || !u.name) return;
      roster.push(u.name);
      userRecDefaults[u.name] = u.recDefault !== false;
      archivedUsers[u.name] = !!u.archived;
    });
    return { roster, userRecDefaults, archivedUsers };
  }

  return { toAppTournaments, fromAppTournament, tournamentRowOf, ensureUserIds, toAppRoster, deriveWinnerName, countWins };
})();
