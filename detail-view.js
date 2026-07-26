// 大会詳細ページのコントローラ。?id= の大会の進行段階に応じて、
// 上部カード(進行中/過去) + 組み合わせ決定(matchup) or 対戦表(bracket) を出し分ける。
(function(){
  "use strict";
  const state = AtsuCup.state;
  const escapeHtml = AtsuCup.escapeHtml;
  const roundLabel = AtsuCup.roundLabel;
  AtsuCup.restore();

  const content = document.getElementById('content');
  const matchupSection = document.getElementById('matchupSection');
  const bracketSection = document.getElementById('bracketSection');
  const id = new URLSearchParams(location.search).get('id');
  // この大会を操作対象にする(state.people/matches等がこの大会を指すようになる)
  AtsuCup.setActive(id);

  let mode = 'view'; // 'view'|'editing'|'confirmEnd'|'confirmDelete'
  let readOnly = false; // 非ログイン中にDB(認証プール)大会を見ている: 編集UIを一切出さない
  function isGuestTournament(){ return AtsuCup.poolKindOfTournamentId(id)==='guest'; }
  function localTagHtml(){ return isGuestTournament() ? ' <span class="status-badge open" style="background:none; border:1px solid var(--line);">ローカル</span>' : ''; }
  // 公式大会/制限杯バッジ。並び順は呼び出し側で 公式大会→制限杯→進行中/完了→ローカル に固定する
  function flagBadgesHtml(t){
    const official = t && t.isOfficial ? '<span class="flag-badge official">🏅 公式大会</span> ' : '';
    const restricted = t && t.isRestricted ? '<span class="flag-badge restricted">🔒 制限杯</span> ' : '';
    return official + restricted;
  }
  function heldDateLine(iso){
    const d = iso ? new Date(iso).toLocaleDateString('ja-JP') : '';
    return d ? `<div class="cur-details" style="color:var(--muted);">開催日: ${d}</div>` : '';
  }

  function initials(name){ return (name||'').trim().charAt(0) || '?'; }
  function truncate(s, n){ return (s && s.length > n) ? s.slice(0,n-1)+'…' : (s||''); }
  function isLive(){ const t=AtsuCup.activeT(); return !!(t && t.status==='ongoing'); }
  function findHistory(){ return state.history.find(h=>h.id===id); }
  function recDefaultOf(name){ return AtsuCup.pool().userRecDefaults[name] !== false; }
  // 1回戦のどこか(a/b)に空き枠が残っているか(=まだ全枠埋まっていない)
  function round1HasEmpty(){
    if(!state.matches.length) return false;
    return state.matches[0].some(m=> m.a===null || (!m.bye && m.b===null));
  }
  // ログイン中に(ログインで削除されるはずの)練習用大会をURL直指定で開こうとしていないか。
  // 逆方向(非ログイン中にDB大会を開く)はブロックせず、読み取り専用(readOnly)として閲覧を許可する
  // (「過去の大会のログは閲覧のみ可」という要件のため)。
  function isCrossPool(){
    return isGuestTournament() && !AtsuCup.isGuestMode();
  }
  // 非ログイン中にDB(認証プール)大会を見ている: 保存はおろかローカル編集もさせない(編集UIを一切出さない)
  function isReadOnlyView(){
    return AtsuCup.poolKindOfTournamentId(id)==='auth' && AtsuCup.isGuestMode();
  }
  function renderBlocked(){
    hideSub(); content.style.display='block';
    content.innerHTML = `<div class="empty-state"><span class="big">🚫</span>この大会は表示できません。<br><a class="btn btn-ghost" href="tournaments.html" style="margin-top:12px;">大会一覧へ戻る</a></div>`;
  }

  document.getElementById('rosterCandidates').innerHTML = AtsuCup.pool().roster.map(n=>`<option value="${escapeHtml(n)}">`).join('');

  /* ================= ルート ================= */
  function render(){
    if(!id){ renderNotFound(); return; }
    if(isCrossPool()){ renderBlocked(); return; }
    readOnly = isReadOnlyView();
    if(isLive()){
      if(mode === 'editing' && !readOnly){ renderEditForm(); return; }
      mode = readOnly ? 'view' : mode;
      renderLiveHeader();
      // 組み合わせ操作(まだ対戦が始まっておらず参加者がいる間)とトーナメント表を、必要に応じて両方表示する
      // readOnly中は組み合わせ決定(編集操作)を一切見せない
      const decidable = !readOnly && AtsuCup.bracketNotStarted() && state.people.length>0;
      const hasTree = state.matches.length>0 && state.matches[0].length>0;
      matchupSection.style.display = decidable ? 'block' : 'none';
      if(decidable) renderMatchup();
      bracketSection.style.display = hasTree ? 'block' : 'none';
      if(hasTree) renderBracket();
      // 参加者0で組み合わせも無いときは、エントリー誘導だけ出す(readOnly中は誘導も出さない)
      if(!decidable && !hasTree && !readOnly){
        matchupSection.style.display = 'block';
        renderMatchup();
      }
      return;
    }
    const h = findHistory();
    if(h){ renderPast(h); return; }
    renderNotFound();
  }

  function hideSub(){ matchupSection.style.display='none'; bracketSection.style.display='none'; }

  function renderNotFound(){
    hideSub(); content.style.display='block';
    content.innerHTML = `<div class="empty-state"><span class="big">🔍</span>大会が見つかりません。<br><a class="btn btn-ghost" href="tournaments.html" style="margin-top:12px;">大会一覧へ戻る</a></div>`;
  }

  /* ================= 進行中: 上部カード ================= */
  function renderLiveHeader(){
    content.style.display='block';
    const meta = state.tournamentMeta;
    const statusBadge = flagBadgesHtml(meta) + (state.winnerName ? `<span class="status-badge done">優勝者決定</span>` : `<span class="status-badge open">進行中</span>`) + localTagHtml();
    const confirmHtml = mode==='confirmEnd' ? `
      <div class="confirm-banner">
        ${state.winnerName ? "この大会を終了して「大会一覧」に保存します。よろしいですか？" : "この大会はまだ優勝者が決まっていません。それでも終了して「大会一覧」に保存しますか？"}
        <div class="row"><button class="btn btn-primary" id="confirmEndBtn">終了する</button><button class="btn btn-ghost" id="cancelEndBtn">キャンセル</button></div>
      </div>` : '';
    content.innerHTML = `
      ${statusBadge}
      ${meta.posterUrl?`<img class="poster-img" src="${escapeHtml(meta.posterUrl)}" alt="poster">`:''}
      <div class="cur-title">${escapeHtml(meta.title)}</div>
      ${meta.details?`<div class="cur-details">${escapeHtml(meta.details)}</div>`:''}
      ${heldDateLine(meta.createdAt)}
      ${state.winnerName?`<div class="cur-line champ">👑 優勝: ${escapeHtml(state.winnerName)}</div>`:''}
      ${state.thirdPlaceMatch&&state.thirdPlaceMatch.winner?`<div class="cur-line third">🥉 3位: ${escapeHtml(state.thirdPlaceMatch.winner)}</div>`:''}
      ${readOnly ? '' : `<div class="row">
        <button class="btn btn-ghost" id="editBtn">編集する</button>
        <button class="btn btn-ghost" id="endBtn">この大会を終了する</button>
      </div>`}
      ${confirmHtml}`;
    if(readOnly) return;
    document.getElementById('editBtn').addEventListener('click', ()=>{ mode='editing'; render(); });
    document.getElementById('endBtn').addEventListener('click', ()=>{ mode='confirmEnd'; renderLiveHeader(); });
    if(mode==='confirmEnd'){
      document.getElementById('cancelEndBtn').addEventListener('click', ()=>{ mode='view'; renderLiveHeader(); });
      document.getElementById('confirmEndBtn').addEventListener('click', ()=>{ AtsuCup.endCurrentTournament(); mode='view'; render(); });
    }
  }

  function renderEditForm(){
    hideSub(); content.style.display='block';
    const meta = state.tournamentMeta;
    let editOfficial = !!meta.isOfficial, editRestricted = !!meta.isRestricted;
    content.innerHTML = `
      <div class="video-card">
        <div class="field" style="margin-bottom:8px;"><label>大会名</label><input type="text" id="tfTitle" value="${escapeHtml(meta.title)}"></div>
        <div class="field" style="margin-bottom:8px;"><label>詳細・ルール</label><textarea id="tfDetails" style="min-height:100px;">${escapeHtml(meta.details||'')}</textarea></div>
        <div class="field" style="margin-bottom:8px;"><label>開催日</label><input type="date" id="tfHeldDate" value="${AtsuCup.dateInputValueOf(meta.createdAt)}"></div>
        <div class="field" style="margin-bottom:8px;"><label>告知ポスター画像</label><input type="file" id="tfPoster" accept="image/*"></div>
        <div class="field" style="margin-bottom:8px;">
          <button type="button" class="flag-toggle-btn official ${editOfficial?'on':'off'}" id="tfOfficial">🏅 公式大会</button>
          <button type="button" class="flag-toggle-btn restricted ${editRestricted?'on':'off'}" id="tfRestricted">🔒 制限杯</button>
        </div>
        <div class="row"><button class="btn btn-primary" id="tfSave">更新する</button><button class="btn btn-ghost" id="tfCancel">キャンセル</button></div>
      </div>`;
    document.getElementById('tfCancel').addEventListener('click', ()=>{ mode='view'; render(); });
    // トグルは他の入力欄を巻き込まないよう、ボタン自身のクラスだけ直接切り替える
    document.getElementById('tfOfficial').addEventListener('click', (ev)=>{
      editOfficial=!editOfficial; ev.currentTarget.classList.toggle('on', editOfficial); ev.currentTarget.classList.toggle('off', !editOfficial);
    });
    document.getElementById('tfRestricted').addEventListener('click', (ev)=>{
      editRestricted=!editRestricted; ev.currentTarget.classList.toggle('on', editRestricted); ev.currentTarget.classList.toggle('off', !editRestricted);
    });
    document.getElementById('tfSave').addEventListener('click', async ()=>{
      const title = document.getElementById('tfTitle').value.trim();
      const details = document.getElementById('tfDetails').value.trim();
      const heldDate = document.getElementById('tfHeldDate').value;
      const fileInput = document.getElementById('tfPoster');
      if(!title){ alert('大会名を入力してください。'); return; }
      const saveBtn = document.getElementById('tfSave'); saveBtn.disabled=true; saveBtn.textContent='保存中...';
      try{
        let posterUrl = meta.posterUrl;
        if(fileInput.files && fileInput.files[0]){ posterUrl = await AtsuCup.resizeImageToDataUrl(fileInput.files[0], 900, 0.75); }
        const createdAt = AtsuCup.isoFromDateInputValue(heldDate);
        state.tournamentMeta = { id: meta.id, title, details, posterUrl, createdAt, isOfficial: editOfficial, isRestricted: editRestricted };
        AtsuCup.persist(); mode='view'; render();
      }catch(e){ alert('保存に失敗しました: '+(e.message||e)); saveBtn.disabled=false; saveBtn.textContent='更新する'; }
    });
  }

  /* ================= 過去大会 ================= */
  function recMapOfEntry(entry){ const m={}; (entry.participants||[]).forEach(p=> m[p.name]=p.rec); return m; }
  function renderPast(h){
    hideSub(); content.style.display='block';
    const placements = AtsuCup.computePlacements(h);
    const rows = (h.participants||[]).map(p=>({ name:p.name, ...(placements[p.name]||{place:null,label:'参加'}) }));
    rows.sort((a,b)=> (a.place||99) - (b.place||99));
    const date = h.createdAt ? new Date(h.createdAt).toLocaleDateString('ja-JP') : '';
    const recMap = recMapOfEntry(h);
    const matchRounds = (h.matches||[]).map((round)=> round.map(m=>{
      if(m.b===null){ return `<div class="video-card"><div class="vs"><span class="rlabel">${roundLabel(round.length)}</span> ${escapeHtml(m.a)} <span class="rlabel">BYE(不戦勝)</span></div></div>`; }
      return `<div class="video-card"><div class="vs"><span class="rlabel">${roundLabel(round.length)}</span> ${escapeHtml(m.a)}${recMap[m.a]?'📹':'🚫'} vs ${escapeHtml(m.b)}${recMap[m.b]?'📹':'🚫'} ${m.winner?`<span class="rlabel">勝者: ${escapeHtml(m.winner)}</span>`:'<span class="rlabel">未決着</span>'}</div>${AtsuCup.videoEmbedHtml(m.video)}</div>`;
    }).join('')).join('');
    let thirdHtml = '';
    if(h.thirdPlaceMatch){ const tp=h.thirdPlaceMatch; thirdHtml = `<div class="video-card"><div class="vs"><span class="rlabel">3位決定戦</span> ${escapeHtml(tp.a)} vs ${escapeHtml(tp.b)} ${tp.winner?`<span class="rlabel">勝者: ${escapeHtml(tp.winner)}</span>`:'<span class="rlabel">未決着</span>'}</div></div>`; }
    // ゲスト(ローカル)大会は完全削除で本当に元に戻せないが、DB大会はアーカイブ(復元可能)なので文言を分ける
    const isGuestT = isGuestTournament();
    const confirmMsg = isGuestT
      ? `「${escapeHtml(h.title)}」を大会一覧から削除します。よろしいですか？(元に戻せません)`
      : `「${escapeHtml(h.title)}」を大会一覧から削除します。よろしいですか？(データは残りますが一覧には出なくなります。復元が必要な場合は管理者にご連絡ください)`;
    const confirmHtml = mode==='confirmDelete' ? `
      <div class="confirm-banner">${confirmMsg}
        <div class="row"><button class="btn btn-primary" id="confirmDeleteBtn">削除する</button><button class="btn btn-ghost" id="cancelDeleteBtn">キャンセル</button></div>
        <div id="deleteErrorArea"></div>
      </div>` : '';
    content.innerHTML = `
      ${readOnly ? '' : `<div class="row" style="margin-top:0;">
        ${saveButtonHtml()}
        <button class="btn btn-ghost" id="deleteBtn" style="color:#ff7373;">🗑️ この大会を削除</button>
      </div>
      <div id="dataSaveStatus"></div>
      ${confirmHtml}`}
      <div class="video-card" style="margin-top:14px;">
        <div style="margin-bottom:8px;">${flagBadgesHtml(h)}${localTagHtml()}</div>
        ${h.posterUrl?`<img class="poster-img" src="${escapeHtml(h.posterUrl)}" alt="poster">`:''}
        <div class="cur-title">${escapeHtml(h.title)}</div>
        ${h.details?`<div class="cur-details">${escapeHtml(h.details)}</div>`:''}
        ${date?`<div class="cur-details" style="color:var(--muted);">開催日: ${date}</div>`:''}
        ${h.championName?`<div class="cur-line champ">👑 優勝: ${escapeHtml(h.championName)}</div>`:'<div class="cur-line" style="color:var(--muted);">結果未記録(途中終了)</div>'}
      </div>
      <h3 class="section-title" style="margin-top:18px;">🏅 順位</h3>
      ${rows.map(r=>`<div class="place-row ${r.place===1?'p1':''}"><span class="p">${r.place?('#'+r.place):'-'}</span><span style="flex:1;">${escapeHtml(r.name)}</span><span>${escapeHtml(r.label)}</span></div>`).join('') || '<div class="empty-state" style="padding:12px;">参加者データがありません。</div>'}
      <h3 class="section-title" style="margin-top:18px;">⚔️ 対戦結果</h3>
      ${matchRounds || '<div class="empty-state" style="padding:12px;">対戦データがありません。</div>'}
      ${thirdHtml}`;
    if(!readOnly){
      wireSaveButton(h.id);
      document.getElementById('deleteBtn').addEventListener('click', ()=>{ mode='confirmDelete'; renderPast(h); });
      if(mode==='confirmDelete'){
        document.getElementById('cancelDeleteBtn').addEventListener('click', ()=>{ mode='view'; renderPast(h); });
        document.getElementById('confirmDeleteBtn').addEventListener('click', async ()=>{
          if(isGuestT){
            state.history = state.history.filter(x=>x.id!==h.id);
            AtsuCup.persist();
            location.href='tournaments.html';
            return;
          }
          const btn = document.getElementById('confirmDeleteBtn');
          const errBox = document.getElementById('deleteErrorArea');
          btn.disabled = true; btn.textContent = '削除中...';
          try{
            await AtsuCup.archiveTournamentInData(h.id);
            location.href='tournaments.html';
          }catch(e){
            errBox.innerHTML = `<div class="empty-state" style="padding:9px 12px; margin-top:8px; font-size:12.5px; color:#ff6a6a;">削除に失敗しました: ${escapeHtml((e&&e.message)||String(e))}</div>`;
            btn.disabled = false; btn.textContent = '削除する';
          }
        });
      }
    }
    window.scrollTo({top:0, behavior:'instant'});
  }

  /* ================= 組み合わせ決定(matchup) ================= */
  let matchupMode = 'view'; // 'view'|'confirmReset'
  function renderMatchup(){
    const hasPeople = state.people.length>0;
    const confirmHtml = matchupMode==='confirmReset' ? `
      <div class="advance-warn">組み合わせをリセットしていいですか？(入力済みの勝敗もすべて消えます)
        <div class="row"><button class="btn btn-primary" id="confirmResetBtn">リセットする</button><button class="btn btn-ghost" id="cancelResetBtn">キャンセル</button></div>
      </div>` : '';
    matchupSection.innerHTML = `
      <h2>組み合わせを決める</h2>
      <div id="peopleSummary"></div>
      ${hasPeople ? `
        <p class="hint" style="margin-top:14px;">下のトーナメント表の空いている枠をタップすると、エントリー者から相手を選べます。まとめて決めたい場合は自動抽選も使えます。</p>
        <div class="row">
          <button class="btn btn-primary" id="instantAutoBtn">⚡ ワンタップで自動抽選</button>
          <button class="btn btn-ghost" id="resetOrderBtn">🔄 リセット</button>
        </div>
        ${confirmHtml}
      ` : ''}`;

    if(hasPeople){
      document.getElementById('instantAutoBtn').addEventListener('click', ()=>{
        if(!state.people.length) return;
        state.matches = [AtsuCup.buildRound1(state.people.map(p=>p.name))];
        state.thirdPlaceMatch = null; state.winnerName = '';
        AtsuCup.persist();
        render();
      });
      document.getElementById('resetOrderBtn').addEventListener('click', ()=>{ matchupMode='confirmReset'; renderMatchup(); });
      if(matchupMode==='confirmReset'){
        document.getElementById('cancelResetBtn').addEventListener('click', ()=>{ matchupMode='view'; renderMatchup(); });
        document.getElementById('confirmResetBtn').addEventListener('click', ()=>{ matchupMode='view'; AtsuCup.resetDownstream(); render(); });
      }
    }
    renderPeopleSummary();
  }

  function renderPeopleSummary(){
    const box = document.getElementById('peopleSummary');
    if(!box) return;
    if(!state.people.length){
      box.innerHTML = `<div class="empty-state"><span class="big">🙋</span>参加者が選ばれていません。</div>
        <a class="btn btn-primary" style="width:100%;" href="tournament-entry.html?id=${encodeURIComponent(state.tournamentMeta.id)}">🙋 大会エントリー</a>`;
      return;
    }
    const rec = state.people.filter(p=>p.rec).length;
    const entryHref = `tournament-entry.html?id=${encodeURIComponent(state.tournamentMeta.id)}`;
    box.innerHTML = `
      <span class="count-badge">参加: ${state.people.length}人</span>
      <span class="count-badge muted2">📹 撮影OK: ${rec}人</span>
      <span class="count-badge muted2">🚫 撮影不可: ${state.people.length-rec}人</span>
      <div class="row">
        <a class="btn btn-ghost" style="width:100%;" href="${entryHref}">🙋 大会エントリー</a>
      </div>`;
  }

  /* ---- 1回戦の空き枠ピッカー(候補一覧＋ルーレット) ---- */
  // 1回戦のどの枠にもまだ入っていない参加者
  function unplacedEntrants(){
    const placed = new Set();
    (state.matches[0]||[]).forEach(m=>{ if(m.a) placed.add(m.a); if(m.b) placed.add(m.b); });
    return state.people.map(p=>p.name).filter(n=>!placed.has(n));
  }
  // 指定の枠に対する候補リストを、撮影不可の偏りを避ける方向に絞り込んで返す。
  // (pairWithConstraintと同じ「可能な限り混ぜる、足りない時だけ同士」をその場で適用する)
  function candidatesFor(m, side){
    const unplaced = unplacedEntrants();
    const recMap = AtsuCup.recMapOf();
    const match = state.matches[0][m];
    if(match.bye){
      // シード枠: 未配置に撮影不可の人がいれば優先的に候補にする(撮影不可を先に安全な不戦勝へ逃がす)
      const nonRec = unplaced.filter(n=>!recMap[n]);
      return nonRec.length ? nonRec : unplaced;
    }
    const otherSide = side==='a' ? match.b : match.a;
    if(otherSide && !recMap[otherSide]){
      // 相方が撮影不可確定済み: 撮影可能な人が残っていれば、強制ペアを避けるためそちらのみ候補にする
      const rec = unplaced.filter(n=>recMap[n]);
      if(rec.length) return rec;
    }
    return unplaced;
  }

  let slotPickerEl=null;
  function ensureSlotPickerStyle(){
    if(document.getElementById('slotPickStyle')) return;
    const s=document.createElement('style'); s.id='slotPickStyle';
    s.textContent=`
      .slotpick-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.72); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
      .slotpick-sheet{ width:100%; max-width:520px; max-height:80vh; overflow-y:auto; background:#150f22; border:1.5px solid var(--line); border-bottom:none; border-top-left-radius:20px; border-top-right-radius:20px; padding:20px 18px calc(20px + env(safe-area-inset-bottom)); }
      .slotpick-sheet h3{ margin:0 0 4px; font-size:16px; color:var(--cream,#f5efe0); }
      .slotpick-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
      .slotpick-cand{ background:#0d0a14; border:1.5px solid var(--line); border-radius:10px; padding:9px 8px; font-weight:700; font-size:13px; color:var(--cream); cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .slotpick-cand:active{ background:rgba(255,255,255,.08); }
      .slotpick-actions{ display:flex; gap:10px; margin-top:14px; }
      .slotpick-actions .btn{ flex:1; }
    `;
    document.head.appendChild(s);
  }
  function ensureSlotPickerEl(){
    ensureSlotPickerStyle();
    if(slotPickerEl) return;
    slotPickerEl=document.createElement('div'); slotPickerEl.className='slotpick-overlay'; slotPickerEl.style.display='none';
    document.body.appendChild(slotPickerEl);
    slotPickerEl.addEventListener('click', (ev)=>{ if(ev.target===slotPickerEl) closeSlotPicker(); });
  }
  function closeSlotPicker(){ if(slotPickerEl) slotPickerEl.style.display='none'; }
  function openSlotPicker(m, side){
    ensureSlotPickerEl();
    const match = state.matches[0][m];
    const recMap = AtsuCup.recMapOf();
    const allUnplaced = unplacedEntrants();
    const restricted = candidatesFor(m, side);
    const isRestricted = restricted.length !== allUnplaced.length;
    const place = (name)=>{
      if(match.bye){ match.a = name; match.winner = name; }
      else { match[side] = name; }
      AtsuCup.persist();
      closeSlotPicker();
      renderTree(); renderExtras();
    };
    slotPickerEl.innerHTML = `
      <div class="slotpick-sheet">
        <h3>🙋 エントリー者を選ぶ</h3>
        ${isRestricted ? `<p class="hint" style="margin-top:0; color:#ffb3b3;">撮影不可の偏りを避けるため、候補を絞っています。</p>` : `<p class="hint" style="margin-top:0;">タップでこの枠に入れます。</p>`}
        ${restricted.length ? `
          <div class="slotpick-grid">
            ${restricted.map(n=>`<button type="button" class="slotpick-cand" data-pick="${escapeHtml(n)}">${escapeHtml(n)} ${recMap[n]?'📹':'🚫'}</button>`).join('')}
          </div>` : `<div class="empty-state" style="padding:12px 4px;">選べる人がいません。</div>`}
        <div class="slotpick-actions">
          <button class="btn btn-gold" id="slotRouletteBtn" ${restricted.length?'':'disabled'}>🎲 ルーレットで決める</button>
          <button class="btn btn-ghost" id="slotPickerCloseBtn">閉じる</button>
        </div>
      </div>`;
    slotPickerEl.style.display='flex';
    slotPickerEl.querySelectorAll('[data-pick]').forEach(btn=> btn.addEventListener('click', ()=> place(btn.dataset.pick)));
    slotPickerEl.querySelector('#slotPickerCloseBtn').addEventListener('click', closeSlotPicker);
    slotPickerEl.querySelector('#slotRouletteBtn').addEventListener('click', ()=>{
      openRouletteFor(restricted, (picked)=>{ place(picked); }, !!match.bye);
    });
  }

  /* ---- ルーレットモーダル(候補リスト＋結果コールバックを渡して使う汎用版) ---- */
  let rouletteEl=null, wheelCanvas=null, wheelCtx=null, currentRotation=0, spinning=false;
  let wheelCandidates=[], wheelOnPick=null;
  const WHEEL_COLORS=["#ff6a2b","#e8b34c","#7c4dff","#2bc9a0","#ff4d94","#4fb0e8","#a8e83b","#ff9145"];
  function ensureRouletteEl(){
    if(rouletteEl) return;
    rouletteEl=document.createElement('div'); rouletteEl.className='roulette-modal'; rouletteEl.style.display='none';
    rouletteEl.innerHTML=`
      <div class="roulette-backdrop" id="rouletteBackdrop"></div>
      <div class="roulette-card">
        <div class="wheel-holder"><div class="pointer"></div><canvas id="wheel" width="260" height="260"></canvas><div class="wheel-center">🐾</div></div>
        <div class="picked-banner" id="pickedBanner">&nbsp;</div>
        <div class="row" style="justify-content:center;"><button class="btn btn-gold" id="spinBtn">ルーレットを回す</button><button class="btn btn-ghost" id="rouletteCloseBtn">閉じる</button></div>
      </div>`;
    document.body.appendChild(rouletteEl);
    wheelCanvas=rouletteEl.querySelector('#wheel'); wheelCtx=wheelCanvas.getContext('2d');
    rouletteEl.querySelector('#rouletteBackdrop').addEventListener('click', closeRoulette);
    rouletteEl.querySelector('#rouletteCloseBtn').addEventListener('click', closeRoulette);
    rouletteEl.querySelector('#spinBtn').addEventListener('click', spin);
  }
  let wheelIsBye=false;
  // candidates(名前の配列)の中から1人選んでonPick(name)に渡す。呼び出し元が結果の反映方法を決める。
  // isBye=trueだとシード当選演出(紙吹雪)を出す。
  function openRouletteFor(candidates, onPick, isBye){
    if(!candidates.length) return;
    wheelCandidates = candidates.slice();
    wheelOnPick = onPick;
    wheelIsBye = !!isBye;
    ensureRouletteEl(); rouletteEl.style.display='flex'; rouletteEl.querySelector('#pickedBanner').innerHTML='&nbsp;';
    rouletteEl.querySelector('#spinBtn').disabled=false;
    drawWheel();
  }
  function closeRoulette(){ if(rouletteEl) rouletteEl.style.display='none'; }
  function drawWheel(){
    if(!wheelCtx) return;
    const list = wheelCandidates.length ? wheelCandidates : ["候補がいません"];
    const n=list.length, R=wheelCanvas.width/2;
    wheelCtx.clearRect(0,0,wheelCanvas.width,wheelCanvas.height); wheelCtx.save(); wheelCtx.translate(R,R); wheelCtx.rotate(currentRotation);
    const seg=(Math.PI*2)/n;
    for(let i=0;i<n;i++){ wheelCtx.beginPath(); wheelCtx.moveTo(0,0); wheelCtx.arc(0,0,R-4,i*seg,(i+1)*seg); wheelCtx.closePath(); wheelCtx.fillStyle=WHEEL_COLORS[i%WHEEL_COLORS.length]; wheelCtx.fill();
      wheelCtx.save(); wheelCtx.rotate(i*seg+seg/2); wheelCtx.textAlign='right'; wheelCtx.fillStyle='#160f08'; wheelCtx.font="bold 13px 'Noto Sans JP', sans-serif";
      const label=list[i].length>8?list[i].slice(0,7)+'…':list[i]; wheelCtx.fillText(label,R-16,5); wheelCtx.restore(); }
    wheelCtx.restore();
  }
  function spawnSeedParticles(){
    const holder=rouletteEl&&rouletteEl.querySelector('.wheel-holder'); if(!holder) return;
    const rect=holder.getBoundingClientRect(); const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2; const emojis=['🎉','✨','⭐','🎊'];
    for(let i=0;i<10;i++){ const el=document.createElement('span'); el.className='seed-particle'; el.textContent=emojis[i%emojis.length];
      const a=Math.random()*Math.PI*2, d=80+Math.random()*110; el.style.left=cx+'px'; el.style.top=cy+'px'; el.style.setProperty('--dx',Math.cos(a)*d+'px'); el.style.setProperty('--dy',Math.sin(a)*d+'px'); document.body.appendChild(el); setTimeout(()=>el.remove(),950); }
  }
  function easeOutBackSpin(t,s){ const p=t-1; return 1+(s+1)*p*p*p+s*p*p; }
  function easeOutQuint(t){ const p=t-1; return p*p*p*p*p+1; }
  function easeOutElastic(t){ const c4=(2*Math.PI)/3; return t===0?0:t===1?1:Math.pow(2,-10*t)*Math.sin((t*10-0.75)*c4)+1; }
  function easeOutBounce(t){ const n1=7.5625,d1=2.75; if(t<1/d1)return n1*t*t; if(t<2/d1)return n1*(t-=1.5/d1)*t+0.75; if(t<2.5/d1)return n1*(t-=2.25/d1)*t+0.9375; return n1*(t-=2.625/d1)*t+0.984375; }
  const SPIN_STYLES=[ (t)=>easeOutBackSpin(t,0.7+Math.random()*1.3), (t)=>easeOutQuint(t), (t)=>easeOutElastic(t), (t)=>easeOutBounce(t) ];
  function spin(){
    if(spinning || !wheelCandidates.length) return;
    const spinBtn=rouletteEl.querySelector('#spinBtn'); const pickedBanner=rouletteEl.querySelector('#pickedBanner');
    spinning=true; spinBtn.disabled=true;
    const n=wheelCandidates.length, seg=(Math.PI*2)/n; const winnerIdx=Math.floor(Math.random()*n); const targetSegCenter=winnerIdx*seg+seg/2;
    const spinDir=Math.random()<0.3?-1:1; const extraSpins=4+Math.random()*4; const duration=2600+Math.random()*1500; const spinEase=SPIN_STYLES[Math.floor(Math.random()*SPIN_STYLES.length)];
    const baseRotation=currentRotation+spinDir*extraSpins*Math.PI*2; const correction=-Math.PI/2-(baseRotation%(Math.PI*2))-targetSegCenter; const finalRotation=baseRotation+correction;
    const startRotation=currentRotation, delta=finalRotation-startRotation, startTime=performance.now();
    function frame(now){ const t=Math.min(1,(now-startTime)/duration); currentRotation=startRotation+delta*spinEase(t); drawWheel();
      if(t<1){ requestAnimationFrame(frame); }
      else{
        currentRotation=finalRotation; drawWheel(); spinning=false; spinBtn.disabled=false;
        const picked=wheelCandidates[winnerIdx];
        pickedBanner.classList.toggle('seed', wheelIsBye);
        if(wheelIsBye){ pickedBanner.textContent='🎉 シード権獲得！ '+picked; spawnSeedParticles(); } else { pickedBanner.textContent='🎯 '+picked; }
        const onPick=wheelOnPick;
        setTimeout(()=>{ closeRoulette(); if(onPick) onPick(picked); }, 700);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ================= 対戦表(bracket) ================= */
  const initialLeafCount = ()=> state.matches[0] ? state.matches[0].length*2 : 0;
  let TREE_ROW_H=40, BOX_H=30;
  const BOX_W=104, STUB_W=22, COL_GAP=6, COL_W=BOX_W+STUB_W+COL_GAP, PAD_LEFT=8, HEADER_H=22;
  function computeRowH(){
    const lc=initialLeafCount();
    const MIN = lc<=8?40:lc<=16?30:lc<=24?22:18;
    // 少人数時に生まれる過大な余白を圧縮するため上限を縮小(旧: 90/60/40/26)
    const MAX = lc<=8?56:lc<=16?44:lc<=24?32:22;
    const avail=Math.max(200, window.innerHeight-200);
    TREE_ROW_H = lc ? Math.max(MIN, Math.min(MAX, avail/lc)) : MIN;
    // 枠の高さは行の高さに対してできるだけ大きく取る(タップしやすく・余白を圧縮)
    BOX_H = Math.max(24, Math.min(TREE_ROW_H-6, 46));
  }
  function leafY(i){ return HEADER_H + (i+0.5)*TREE_ROW_H; }
  function jointY(r,i){ if(r===0) return (leafY(2*i)+leafY(2*i+1))/2; return (jointY(r-1,2*i)+jointY(r-1,2*i+1))/2; }
  function colLeft(r){ return PAD_LEFT + r*COL_W; }

  // 枠(r,m,side)がD&Dの対象(ドラッグ元/ドロップ先)として有効か。
  // 「後戻りできない進行」の単位をカード自身の決着有無にする: 決着済みのペアカードはロック、
  // シード枠(1回戦のbye)は勝敗という概念が無いので常に対象(b側の➕途中参加枠は別関数で描画するためここには来ない)
  function slotDndEligible(r, m, side){
    const match = state.matches[r] && state.matches[r][m];
    if(!match) return false;
    if(match.bye) return side==='a';
    return !match.winner;
  }
  let treeSlotRects={}, lastSvgW=0, bRecMap={};
  function boxSvg(r,i,side,name,centerY,isWinner,isForced,hasWinner,dndOn){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    const isLoser = hasWinner && !isWinner;
    const fill=isWinner?'#161020':'#0d0a14'; const stroke=isWinner?'#e8b34c':(isForced?'#7a2c2c':'#3a2f4d');
    const strokeW=isWinner?2.5:1.5;
    const nameFill=isWinner?'#e8b34c':'#f1e6cf'; const weight=isWinner?'900':'700';
    const opacity=isLoser?0.45:1;
    treeSlotRects[`${r}_${i}_${side}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    return `<g class="tree-slot" data-r="${r}" data-m="${i}" data-side="${side}" opacity="${opacity}"${dndOn?' data-dnd="1"':''}>`
      +`<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>`
      +`<text x="${cLeft+8}" y="${centerY+4.5}" font-size="13" font-weight="${weight}" fill="${nameFill}">${escapeHtml(truncate(name,7))}</text>`
      +`<text x="${cLeft+BOX_W-8}" y="${centerY+4.5}" font-size="10.5" text-anchor="end">${bRecMap[name]?'📹':'🚫'}</text>`
      +`</g>`;
  }
  // 大会開始後に残っているシード空き枠(➕・WalkinModalで新規登録込みの飛び入り)。readOnly中は➕を出さない
  function byeBoxSvg(r,i,centerY){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    treeSlotRects[`bye_${i}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    const addIcon = readOnly ? '' : `<text class="tree-add-icon" data-addm="${i}" x="${cLeft+BOX_W-6}" y="${centerY+5}" font-size="14" text-anchor="end">➕</text>`;
    return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0d0a14" stroke="#3a2f4d" stroke-width="1.5" stroke-dasharray="3 3"/>`
      +`<text x="${cLeft+8}" y="${centerY+4.5}" font-size="12" font-style="italic" fill="#6b5f82">シード</text>`
      +addIcon;
  }
  // シード保持者(a)がまだ決まっていない間の、b側の非インタラクティブなプレースホルダ
  function byePlaceholderSvg(centerY){
    const cLeft=colLeft(0), boxY=centerY-BOX_H/2;
    return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0a0810" stroke="#2a2338" stroke-width="1.5" stroke-dasharray="3 3"/>`
      +`<text x="${cLeft+8}" y="${centerY+4.5}" font-size="12" font-style="italic" fill="#4a4060">シード</text>`;
  }
  // 1回戦の空き枠: タップでエントリー者ピッカーを開く。D&Dのドロップ先にもなる。readOnly中は非インタラクティブな「未定」表示のみ
  function slotTapBoxSvg(m,side,centerY,label){
    const cLeft=colLeft(0), boxY=centerY-BOX_H/2;
    if(readOnly){
      return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0a0810" stroke="#2a2338" stroke-width="1.5"/>`
        +`<text x="${cLeft+BOX_W/2}" y="${centerY+4.5}" font-size="12" text-anchor="middle" fill="#4a4060">未定</text>`;
    }
    treeSlotRects[`0_${m}_${side}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    return `<g class="tree-slot tree-slot-tap" data-r="0" data-m="${m}" data-side="${side}">`
      +`<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0d0a14" stroke="#5a4a2a" stroke-width="1.5" stroke-dasharray="3 3"/>`
      +`<text x="${cLeft+BOX_W/2}" y="${centerY+4.5}" font-size="11.5" text-anchor="middle" fill="#e8b34c">${escapeHtml(label)}</text>`
      +`</g>`;
  }
  // 2回戦以降で、まだ勝ち上がりが決まっていない未確定枠。D&Dのドロップ先にもなる
  function pendingBoxSvg(r,i,side,centerY){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    treeSlotRects[`${r}_${i}_${side}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    return `<g class="tree-slot" data-r="${r}" data-m="${i}" data-side="${side}">`
      +`<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0a0810" stroke="#2a2338" stroke-width="1.5"/>`
      +`<text x="${cLeft+BOX_W/2}" y="${centerY+4.5}" font-size="12" text-anchor="middle" fill="#4a4060">？？？</text>`
      +`</g>`;
  }
  function buildTreeSVG(){
    treeSlotRects={}; bRecMap=AtsuCup.recMapOf();
    const round0=state.matches[0]; const leafCount=round0.length*2; const totalRounds=Math.round(Math.log2(leafCount));
    const lastColRight=colLeft(totalRounds-1)+BOX_W+STUB_W; const svgW=lastColRight+40; const svgH=HEADER_H+leafCount*TREE_ROW_H; lastSvgW=svgW;
    let framesSvg='', linesSvg='', boxesSvg='', pickBtnSvg='';
    for(let r=0;r<totalRounds;r++){
      const round=state.matches[r]||[]; const matchCount=leafCount/Math.pow(2,r+1);
      const boxRight=colLeft(r)+BOX_W, joinX=boxRight+STUB_W;
      const frameX=colLeft(r)-4; const frameW=(r===totalRounds-1)?(BOX_W+8):COL_W;
      framesSvg+=`<rect x="${frameX}" y="${HEADER_H-2}" width="${frameW}" height="${svgH-HEADER_H}" rx="8" fill="none" stroke="#241d33" stroke-width="1"/>`;
      framesSvg+=`<text x="${colLeft(r)+BOX_W/2}" y="14" font-size="11.5" font-weight="700" text-anchor="middle" fill="#9a8fae">${escapeHtml(roundLabel(matchCount))}</text>`;
      for(let i=0;i<matchCount;i++){
        const m=round[i]; const centerY=jointY(r,i); const upY=centerY-TREE_ROW_H/2, downY=centerY+TREE_ROW_H/2;
        const isForced = m && m.a && m.b && !bRecMap[m.a] && !bRecMap[m.b];
        // カード内の短いコの字のみ(次カラムへ伸びる線は引かない)
        linesSvg+=`<path d="M${boxRight},${upY} H${joinX}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        linesSvg+=`<path d="M${boxRight},${downY} H${joinX}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        linesSvg+=`<path d="M${joinX},${upY} V${downY}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        [['a',m?m.a:null,upY],['b',m?m.b:null,downY]].forEach(([side,name,y])=>{
          if(name===null){
            if(r===0 && m && m.bye && side==='b'){
              // シード枠の空側(b): 保持者(a)が決まっていれば、途中参加として挑戦者を迎えられる(D&D対象外)
              if(m.a){ boxesSvg+=byeBoxSvg(r,i,y); }
              else { boxesSvg+=byePlaceholderSvg(y); } // 保持者未定の間はタップ不可のプレースホルダのみ
              return;
            }
            if(r===0){ boxesSvg+=slotTapBoxSvg(i, side, y, 'タップで選ぶ'); return; } // 1回戦の空き枠は常にタップ可能
            boxesSvg+=pendingBoxSvg(r,i,side,y); return;
          }
          const isWinner=!!m.winner && m.winner===name; const hasWinner=!!m.winner;
          const dndOn = !readOnly && slotDndEligible(r,i,side);
          boxesSvg+=boxSvg(r,i,side,name,y,isWinner,isForced,hasWinner,dndOn);
        });
        if(!readOnly && m && m.a && m.b){ const bx=boxRight+STUB_W/2; pickBtnSvg+=`<g class="tree-pick" data-r="${r}" data-m="${i}"><circle cx="${bx}" cy="${centerY}" r="11" fill="#241b12" stroke="#e8b34c" stroke-width="1.5"/><text x="${bx}" y="${centerY+4.5}" font-size="12" text-anchor="middle">⚔️</text></g>`; }
      }
    }
    let trophySvg=''; if(state.winnerName){ const fy=jointY(totalRounds-1,0); trophySvg=`<text x="${lastColRight+6}" y="${fy+8}" font-size="22">🏆</text>`; }
    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#0a0810"/>${framesSvg}${linesSvg}${boxesSvg}${pickBtnSvg}${trophySvg}</svg>`;
  }

  function renderBracket(){
    computeRowH();
    const hint = readOnly
      ? '対戦表(閲覧のみ)'
      : round1HasEmpty()
        ? '空いている枠をタップして、対戦相手を選んでください。ドラッグ&ドロップで枠の移動・入れ替え・取り消しもできます。'
        : '⚔️で勝敗入力・シード枠の➕で途中参加・ドラッグ&ドロップで枠の移動/入れ替え';
    bracketSection.innerHTML = `
      <div class="tree-title" id="treeTitle">${escapeHtml(state.tournamentMeta.title||'トーナメント表')}</div>
      <p class="hint" style="margin:2px 0 8px;">${hint}</p>
      <div class="row" id="jumpRow" style="display:none; margin-bottom:8px;"><button class="btn btn-ghost" id="jumpNextBtn" style="width:100%;">🎯 次の対戦へ</button></div>
      <div class="tree-scroll" id="treeScroll"></div>
      <div id="advanceArea"></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn btn-ghost" id="saveBracketImgBtn">📸 画像で保存</button>
        ${readOnly ? '' : saveButtonHtml()}
      </div>
      <div id="dataSaveStatus"></div>
      <div id="noticeArea"></div>
      <div id="thirdPlaceArea"></div>
      <div id="championArea"></div>`;
    document.getElementById('saveBracketImgBtn').addEventListener('click', saveBracketImg);
    if(!readOnly) wireSaveButton(state.tournamentMeta.id);
    renderTree(); renderExtras();
  }

  // ゲスト(練習用)大会はサーバーに保存できないため、ボタンの代わりに案内文を出す
  function saveButtonHtml(){
    return AtsuCup.isGuestMode()
      ? '<p class="hint" style="margin:0; color:var(--muted);">練習用の大会のため、サーバーへの保存はできません。</p>'
      : '<button class="btn btn-gold" id="saveToDataBtn">💾 進行状況を保存</button>';
  }
  function wireSaveButton(tid){
    const btn = document.getElementById('saveToDataBtn');
    if(btn) btn.addEventListener('click', ()=> saveTournamentToGitHub(tid));
  }

  // 大会の内容を data/*.json(GitHub) へ保存する。対戦表は勝敗入力のたびに変わるため自動保存はせず、
  // 明示的なボタン操作でのみ書き込む(コミットの乱発と競合を避けるため)。
  async function saveTournamentToGitHub(tid){
    const box = document.getElementById('dataSaveStatus');
    const btn = document.getElementById('saveToDataBtn');
    const show = (msg, color)=>{ box.innerHTML = msg ? `<div class="empty-state" style="padding:9px 12px; margin-top:8px; font-size:12.5px; color:${color||'inherit'};">${escapeHtml(msg)}</div>` : ''; };
    if(!GasDB.canWrite()){ show('ログインが必要です。「設定」画面からGoogleログインしてください。', '#ff6a6a'); return; }
    btn.disabled = true; btn.textContent = '保存中...';
    show('保存中...(参加者・大会・対戦結果をスプレッドシートへ反映します)');
    try{
      const r = await AtsuCup.saveTournamentToData(tid || (state.tournamentMeta && state.tournamentMeta.id));
      show(`保存しました(エントリー${r.entries}件・対戦${r.matches}件${r.addedUsers?`・新規ユーザー${r.addedUsers}人`:''})`, '#7cffb0');
    }catch(e){
      show('保存に失敗しました: ' + ((e && e.message) || e), '#ff6a6a');
    }finally{
      btn.disabled = false; btn.textContent = '💾 進行状況を保存';
    }
  }

  function renderTree(){
    const ts=document.getElementById('treeScroll'); ts.innerHTML=buildTreeSVG(); ts.style.setProperty('--svg-natural-w', lastSvgW+'px');
    if(!readOnly) wireTreeInteractions();
  }
  function wireTreeInteractions(){
    document.querySelectorAll('#treeScroll .tree-pick').forEach(el=> el.addEventListener('click', ()=> openMatchPickModal(+el.dataset.r, +el.dataset.m)));
    document.querySelectorAll('#treeScroll .tree-add-icon').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); startAddChallenger(+el.dataset.addm); }));
    document.querySelectorAll('#treeScroll .tree-slot-tap').forEach(el=> el.addEventListener('click', ()=> { if(dndJustDragged){ dndJustDragged=false; return; } openSlotPicker(+el.dataset.m, el.dataset.side); }));
    wireTreeDnd();
  }

  /* ---- エントリー枠のドラッグ&ドロップ(同ラウンド内の移動・入れ替え・選択解除) ---- */
  let dndState=null, dndGhostEl=null, dndUnassignEl=null, dndJustDragged=false;
  function ensureDndEls(){
    if(!dndGhostEl){ dndGhostEl=document.createElement('div'); dndGhostEl.className='dnd-ghost'; dndGhostEl.style.display='none'; document.body.appendChild(dndGhostEl); }
    if(!dndUnassignEl){ dndUnassignEl=document.createElement('div'); dndUnassignEl.className='dnd-unassign-zone'; dndUnassignEl.textContent='🗑️ ここにドロップして枠を空にする'; document.body.appendChild(dndUnassignEl); }
  }
  function wireTreeDnd(){
    ensureDndEls();
    document.querySelectorAll('#treeScroll .tree-slot[data-dnd="1"]').forEach(el=> el.addEventListener('pointerdown', onDndPointerDown));
  }
  function onDndPointerDown(ev){
    const el=ev.currentTarget;
    const r=+el.dataset.r, m=+el.dataset.m, side=el.dataset.side;
    const match=state.matches[r][m]; const name = side==='a'?match.a:match.b;
    if(!name) return;
    ev.preventDefault();
    try{ el.setPointerCapture(ev.pointerId); }catch(e){}
    dndState={ pointerId:ev.pointerId, srcR:r, srcM:m, srcSide:side, name, startX:ev.clientX, startY:ev.clientY, dragging:false, el, hoverTarget:null, hoverIsUnassign:false };
    el.addEventListener('pointermove', onDndPointerMove);
    el.addEventListener('pointerup', onDndPointerUp);
    el.addEventListener('pointercancel', onDndPointerCancel);
  }
  function startDndVisuals(){
    dndState.el.classList.add('dragging');
    dndUnassignEl.classList.add('active');
    const recMap=AtsuCup.recMapOf();
    dndGhostEl.textContent = dndState.name+' '+(recMap[dndState.name]?'📹':'🚫');
    dndGhostEl.style.display='block';
  }
  function onDndPointerMove(ev){
    if(!dndState || ev.pointerId!==dndState.pointerId) return;
    const dx=ev.clientX-dndState.startX, dy=ev.clientY-dndState.startY;
    if(!dndState.dragging){
      if(Math.hypot(dx,dy) < 6) return;
      dndState.dragging = true;
      startDndVisuals();
    }
    dndGhostEl.style.left=ev.clientX+'px'; dndGhostEl.style.top=(ev.clientY-40)+'px';
    updateDndHover(ev.clientX, ev.clientY);
  }
  function clearHoverTarget(){
    if(dndState.hoverTarget){
      const {r,m,side}=dndState.hoverTarget;
      const el=document.querySelector(`#treeScroll .tree-slot[data-r="${r}"][data-m="${m}"][data-side="${side}"]`);
      if(el) el.classList.remove('drop-hover');
    }
    dndState.hoverTarget=null;
  }
  function updateDndHover(clientX, clientY){
    const uRect=dndUnassignEl.getBoundingClientRect();
    const overUnassign = clientX>=uRect.left && clientX<=uRect.right && clientY>=uRect.top && clientY<=uRect.bottom;
    dndUnassignEl.classList.toggle('drop-hover', overUnassign);
    if(overUnassign){ clearHoverTarget(); dndState.hoverIsUnassign=true; return; }
    dndState.hoverIsUnassign=false;

    const svgEl=document.querySelector('#treeScroll svg');
    if(!svgEl){ clearHoverTarget(); return; }
    const ctm=svgEl.getScreenCTM();
    if(!ctm){ clearHoverTarget(); return; }
    const pt=svgEl.createSVGPoint(); pt.x=clientX; pt.y=clientY;
    const svgPt=pt.matrixTransform(ctm.inverse());

    let found=null;
    for(const key in treeSlotRects){
      const parts=key.split('_'); if(parts.length!==3) continue; // 'bye_i'キーは対象外
      const rNum=+parts[0], mNum=+parts[1], sSide=parts[2];
      if(rNum!==dndState.srcR) continue; // 同ラウンド内のみ
      if(mNum===dndState.srcM && sSide===dndState.srcSide) continue; // 自分自身は除外
      if(!slotDndEligible(rNum, mNum, sSide)) continue;
      const rect=treeSlotRects[key];
      if(svgPt.x>=rect.x && svgPt.x<=rect.x+rect.w && svgPt.y>=rect.y && svgPt.y<=rect.y+rect.h){ found={r:rNum,m:mNum,side:sSide,key}; break; }
    }
    if(found){
      if(dndState.hoverTarget && dndState.hoverTarget.key!==found.key) clearHoverTarget();
      dndState.hoverTarget=found;
      const targetEl=document.querySelector(`#treeScroll .tree-slot[data-r="${found.r}"][data-m="${found.m}"][data-side="${found.side}"]`);
      if(targetEl) targetEl.classList.add('drop-hover');
    } else {
      clearHoverTarget();
    }
  }
  function unassignSlot(r,m,side){
    const match=state.matches[r][m];
    if(match.bye){ match.a=null; match.winner=null; if(state.matches[r+1]) AtsuCup.propagateWinnerDownstream(r,m,null); }
    else if(side==='a'){ match.a=null; } else { match.b=null; }
  }
  function swapSlots(r,m1,s1,m2,s2){
    const match1=state.matches[r][m1], match2=state.matches[r][m2];
    const name1 = s1==='a'?match1.a:match1.b, name2 = s2==='a'?match2.a:match2.b;
    if(r===0){
      if(s1==='a') match1.a=name2; else match1.b=name2;
      if(s2==='a') match2.a=name1; else match2.b=name1;
    } else {
      const src1 = s1==='a'?match1.aSrc:match1.bSrc, src2 = s2==='a'?match2.aSrc:match2.bSrc;
      if(s1==='a'){ match1.a=name2; match1.aSrc=src2; } else { match1.b=name2; match1.bSrc=src2; }
      if(s2==='a'){ match2.a=name1; match2.aSrc=src1; } else { match2.b=name1; match2.bSrc=src1; }
    }
    // シード枠が絡む場合はwinnerを保持者(a)に同期し、2回戦以降が既にあれば追従させる
    [[m1,s1,match1],[m2,s2,match2]].forEach(([mm,ss,mt])=>{
      if(r===0 && mt.bye && ss==='a'){
        mt.winner = mt.a;
        if(state.matches[1]) AtsuCup.propagateWinnerDownstream(0, mm, mt.a);
      }
    });
  }
  function commitDnd(){
    const {srcR,srcM,srcSide,hoverTarget,hoverIsUnassign}=dndState;
    if(hoverIsUnassign){ unassignSlot(srcR,srcM,srcSide); }
    else if(hoverTarget){ swapSlots(srcR,srcM,srcSide,hoverTarget.m,hoverTarget.side); }
    else { return; }
    AtsuCup.persist();
    renderTree(); renderExtras();
  }
  function cleanupDnd(){
    if(dndState){
      dndState.el.removeEventListener('pointermove', onDndPointerMove);
      dndState.el.removeEventListener('pointerup', onDndPointerUp);
      dndState.el.removeEventListener('pointercancel', onDndPointerCancel);
    }
    if(dndGhostEl) dndGhostEl.style.display='none';
    if(dndUnassignEl){ dndUnassignEl.classList.remove('active'); dndUnassignEl.classList.remove('drop-hover'); }
    document.querySelectorAll('#treeScroll .tree-slot.dragging, #treeScroll .tree-slot.drop-hover').forEach(el=>{ el.classList.remove('dragging'); el.classList.remove('drop-hover'); });
    dndState=null;
  }
  function onDndPointerUp(ev){
    if(!dndState || ev.pointerId!==dndState.pointerId) return;
    const wasDragging=dndState.dragging;
    if(wasDragging){ commitDnd(); dndJustDragged=true; setTimeout(()=>{ dndJustDragged=false; }, 0); }
    cleanupDnd();
  }
  function onDndPointerCancel(ev){
    if(!dndState || ev.pointerId!==dndState.pointerId) return;
    cleanupDnd();
  }

  let pendingChallengerM=null;
  function startAddChallenger(m){
    WalkinModal.open({
      excludeNames: (function(){ const s=new Set(); state.matches.forEach(round=>round.forEach(x=>{ if(x.a)s.add(x.a); if(x.b)s.add(x.b); })); return [...s]; })(),
      onPick: (name)=>{
        if(AtsuCup.hasDownstreamProgress(0)){
          pendingChallengerM={m,name};
          const area=document.getElementById('advanceArea');
          area.innerHTML=`<div class="advance-warn">この先のラウンドに進んだ対戦があります。途中参加者を入れると、その先の組み合わせはいったんリセットされます。よろしいですか？<div class="row"><button class="btn btn-primary" id="chYes">追加する</button><button class="btn btn-ghost" id="chNo">キャンセル</button></div></div>`;
          document.getElementById('chYes').addEventListener('click', ()=>{ AtsuCup.addChallengerToBye(0, pendingChallengerM.m, pendingChallengerM.name); pendingChallengerM=null; renderTree(); renderExtras(); });
          document.getElementById('chNo').addEventListener('click', ()=>{ pendingChallengerM=null; renderExtras(); });
        } else {
          AtsuCup.addChallengerToBye(0, m, name); renderTree(); renderExtras();
        }
      }
    });
  }
  async function saveBracketImg(){
    const svgStr=buildTreeSVG(); const blob=new Blob([svgStr],{type:'image/svg+xml;charset=utf-8'}); const url=URL.createObjectURL(blob);
    try{ const img=new Image(); await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; }); const canvas=document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height; canvas.getContext('2d').drawImage(img,0,0);
      const cur=state.tournamentMeta; const nameForFile=(cur&&cur.title)?cur.title.replace(/[^\w぀-ヿ一-鿿]/g,''):'tournament'; const link=document.createElement('a'); link.download=`atsucup_bracket_${nameForFile}.png`; link.href=canvas.toDataURL('image/png'); link.click();
    }finally{ URL.revokeObjectURL(url); }
  }
  function findNextMatch(){
    for(let r=0;r<state.matches.length;r++){ for(let m=0;m<state.matches[r].length;m++){ const x=state.matches[r][m]; if(x.a&&x.b&&!x.winner) return {r,m,match:x}; } }
    if(state.thirdPlaceMatch&&!state.thirdPlaceMatch.winner&&state.thirdPlaceMatch.a&&state.thirdPlaceMatch.b) return {r:'third',m:0,match:state.thirdPlaceMatch};
    return null;
  }
  function pick(r,m,side){ if(r==='third'){ AtsuCup.pickThirdPlaceWinner(side); } else { AtsuCup.pickWinner(r,m,side); } renderTree(); renderExtras(); renderLiveHeader(); }
  function openMatchPickModal(r,m){
    const match=state.matches[r]&&state.matches[r][m]; if(!match||!match.a||!match.b) return; const recMap=AtsuCup.recMapOf();
    ensureMatchModal();
    document.getElementById('modalMatchTitle').textContent=AtsuCup.roundLabel(state.matches[r].length);
    const btnA=document.getElementById('modalPickA'), btnB=document.getElementById('modalPickB');
    btnA.innerHTML=`<span class="nm">${escapeHtml(match.a)}</span><span>${recMap[match.a]?'📹':'🚫'}</span>`;
    btnB.innerHTML=`<span class="nm">${escapeHtml(match.b)}</span><span>${recMap[match.b]?'📹':'🚫'}</span>`;
    btnA.classList.toggle('winner',match.winner===match.a); btnB.classList.toggle('winner',match.winner===match.b);
    btnA.onclick=()=>{ pick(r,m,'a'); closeMatchModal(); }; btnB.onclick=()=>{ pick(r,m,'b'); closeMatchModal(); };
    const resetBtn=document.getElementById('modalResetBtn');
    resetBtn.style.display = match.winner ? 'block' : 'none';
    resetBtn.onclick=()=>{ AtsuCup.resetMatchResult(r,m); closeMatchModal(); renderTree(); renderExtras(); renderLiveHeader(); };
    document.getElementById('matchPickModal').style.display='flex';
  }
  let matchModalEl=null;
  function ensureMatchModal(){
    if(matchModalEl) return;
    matchModalEl=document.createElement('div'); matchModalEl.className='match-pick-modal'; matchModalEl.id='matchPickModal'; matchModalEl.style.display='none';
    matchModalEl.innerHTML=`<div class="match-pick-modal-backdrop" id="matchPickModalBackdrop"></div><div class="match-pick-modal-card"><div class="match-pick-modal-title" id="modalMatchTitle"></div><p class="hint" style="margin-top:0; text-align:center;">勝った方をタップしてください</p><div class="match-pick-modal-row"><button type="button" class="modal-pick-btn" id="modalPickA"></button><span class="vs-label">VS</span><button type="button" class="modal-pick-btn" id="modalPickB"></button></div><button type="button" class="btn btn-ghost" id="modalResetBtn" style="width:100%; margin-top:12px; display:none;">勝敗をリセット</button><button type="button" class="btn btn-ghost" id="modalCancelBtn" style="width:100%; margin-top:8px;">キャンセル</button></div>`;
    document.body.appendChild(matchModalEl);
    matchModalEl.querySelector('#matchPickModalBackdrop').addEventListener('click', closeMatchModal);
    matchModalEl.querySelector('#modalCancelBtn').addEventListener('click', closeMatchModal);
  }
  function closeMatchModal(){ if(matchModalEl) matchModalEl.style.display='none'; }
  function jumpToNextMatch(next){
    if(!next) return;
    if(next.r==='third'){ const el=document.getElementById('thirdPlaceCard'); if(el)el.scrollIntoView({behavior:'smooth',block:'center'}); return; }
    const zones=document.querySelectorAll(`#treeScroll .tree-pick[data-r="${next.r}"][data-m="${next.m}"]`); if(!zones.length) return;
    zones[0].scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'}); zones.forEach(z=>{ z.classList.remove('tree-flash'); void z.getBoundingClientRect(); z.classList.add('tree-flash'); });
  }
  function startEditThirdName(side,scopeEl){
    const nmSpan=scopeEl?scopeEl.querySelector('.nm'):null; if(!nmSpan) return; const match=state.thirdPlaceMatch; const current=side==='a'?match.a:match.b;
    const input=document.createElement('input'); input.type='text'; input.className='nm-edit-input'; input.value=current; input.setAttribute('list','rosterCandidates'); input.addEventListener('click',ev=>ev.stopPropagation());
    nmSpan.replaceWith(input); input.focus(); input.select();
    let done=false; const commit=()=>{ if(done)return; done=true; const val=input.value.trim(); if(val&&val!==current){ AtsuCup.renameParticipant(current,val); } renderTree(); renderExtras(); };
    input.addEventListener('blur',commit); input.addEventListener('keydown',e=>{ if(e.key==='Enter')input.blur(); });
  }
  function pickBtnHtml(name,winner,r,m,side,recMap){
    const isWinner=winner===name;
    const mainAttrs = readOnly ? '' : ` data-r="${r}" data-m="${m}" data-side="${side}"`;
    const editBtn = readOnly ? '' : `<button class="pick-edit-btn" data-editname data-side="${side}">✏️</button>`;
    return `<div class="pick-btn ${isWinner?'winner':''}"><span class="pick-main"${mainAttrs}><span class="avatar">${escapeHtml(initials(name))}</span><span class="nm">${escapeHtml(name)}</span><span>${recMap[name]?'📹':'🚫'}</span></span>${editBtn}</div>`;
  }
  function swappedMatchIndices(r){
    if(r===0) return new Set(); const cur=state.matches[r]; if(!cur) return new Set(); const swapped=new Set();
    cur.forEach((m,i)=>{ if(m.aSrc===undefined) return; if(m.aSrc!==2*i||m.bSrc!==2*i+1) swapped.add(i); }); return swapped;
  }
  function renderExtras(){
    const recMap=AtsuCup.recMapOf();
    // 1回戦の枠がまだ埋まりきっていない間は、進行・警告・優勝などのUIを出さない
    if(round1HasEmpty()){
      document.getElementById('advanceArea').innerHTML='';
      document.getElementById('jumpRow').style.display='none';
      document.getElementById('noticeArea').innerHTML='';
      document.getElementById('thirdPlaceArea').innerHTML='';
      document.getElementById('championArea').innerHTML='';
      return;
    }
    // 次のラウンドへ進む(readOnly中は進行操作を出さない)
    const advanceArea=document.getElementById('advanceArea'); const lastR=state.matches.length-1; const lastRound=lastR>=0?state.matches[lastR]:null;
    if(readOnly){ advanceArea.innerHTML=''; }
    else if(lastRound && lastRound.length>1){
      const nextLabel=AtsuCup.roundLabel(lastRound.length/2);
      advanceArea.innerHTML=`<button class="btn btn-gold" id="advanceRoundBtn" style="width:100%; margin-top:10px;">▶ ${escapeHtml(nextLabel)}へ進む</button><div id="advanceConfirm"></div>`;
      const doAdvance=()=>{ AtsuCup.advanceRound(lastR); renderTree(); renderExtras(); };
      document.getElementById('advanceRoundBtn').onclick=()=>{
        const undecided=lastRound.filter(m=>m.a&&m.b&&!m.winner).length;
        if(undecided>0){
          document.getElementById('advanceConfirm').innerHTML=`<div class="advance-warn">終了していない対戦が${undecided}件ありますが、${escapeHtml(nextLabel)}を始めますか？(未決着カードの勝者は決まり次第この先の枠に自動で入ります)<div class="row"><button class="btn btn-primary" id="advanceYesBtn">進む</button><button class="btn btn-ghost" id="advanceNoBtn">キャンセル</button></div></div>`;
          document.getElementById('advanceYesBtn').onclick=doAdvance;
          document.getElementById('advanceNoBtn').onclick=()=>{ document.getElementById('advanceConfirm').innerHTML=''; };
        } else { doAdvance(); }
      };
    } else { advanceArea.innerHTML=''; }

    const next=findNextMatch(); const jumpRow=document.getElementById('jumpRow');
    if(next){ jumpRow.style.display='block'; document.getElementById('jumpNextBtn').onclick=()=>jumpToNextMatch(next); } else { jumpRow.style.display='none'; }

    let noticeHtml=''; const forced=AtsuCup.forcedPairsList();
    if(forced.length){ noticeHtml+=`<div class="warn-box">⚠️ 撮影OKの人が足りず、以下は撮影不可同士の対戦になっています:<br>`+forced.map(f=>`・${AtsuCup.roundLabel(state.matches[f.r].length)}: ${escapeHtml(f.a)} vs ${escapeHtml(f.b)}`).join('<br>')+`</div>`; }
    const swapNotes=[]; state.matches.forEach((round,r)=>{ swappedMatchIndices(r).forEach(i=>{ swapNotes.push(`・${AtsuCup.roundLabel(round.length)}: ${escapeHtml(round[i].a)} vs ${escapeHtml(round[i].b)}`); }); });
    if(swapNotes.length){ noticeHtml+=`<div class="swap-note">🔀 撮影不可の人が重ならないよう、以下の組み合わせを入れ替えました:<br>${swapNotes.join('<br>')}</div>`; }
    document.getElementById('noticeArea').innerHTML=noticeHtml;

    const thirdArea=document.getElementById('thirdPlaceArea');
    if(state.thirdPlaceMatch){
      const tp=state.thirdPlaceMatch;
      thirdArea.innerHTML=`<h3 class="section-title" style="margin-top:16px;">🥉 3位決定戦</h3><div class="video-card" id="thirdPlaceCard"><div class="match-pick-row">${pickBtnHtml(tp.a,tp.winner,'third',0,'a',recMap)}<span class="vs-label">VS</span>${pickBtnHtml(tp.b,tp.winner,'third',0,'b',recMap)}</div></div>`;
      if(!readOnly){
        thirdArea.querySelectorAll('.pick-main[data-r]').forEach(el=> el.addEventListener('click', ()=> pick('third',0,el.dataset.side)));
        thirdArea.querySelectorAll('[data-editname]').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); startEditThirdName(el.dataset.side, el.closest('.pick-btn')); }));
      }
    } else { thirdArea.innerHTML=''; }

    const championArea=document.getElementById('championArea');
    if(state.winnerName){
      championArea.innerHTML=`<div class="champion-box"><div class="label">Champion</div><div class="name">👑 ${escapeHtml(state.winnerName)}</div>${state.thirdPlaceMatch&&state.thirdPlaceMatch.winner?`<div style="color:var(--muted);font-weight:700;margin-bottom:10px;">🥉 3位: ${escapeHtml(state.thirdPlaceMatch.winner)}</div>`:''}<a class="btn btn-gold" style="width:100%; margin-bottom:10px;" href="results.html?id=${encodeURIComponent(state.tournamentMeta.id)}">🏆 最終結果を見る(1位〜4位・全順位)</a><div class="row" style="justify-content:center;"><button class="btn btn-ghost" id="toCardBtn">優勝カードを作る</button><a class="btn btn-ghost" href="hall.html">歴代優勝者を見る</a></div></div>`;
      document.getElementById('toCardBtn').addEventListener('click', ()=>{ const c=document.createElement('canvas'); c.width=1000; c.height=1000; AtsuCup.generateAndSaveCard(c, state.tournamentMeta.title, state.winnerName); });
    } else { championArea.innerHTML=''; }
  }

  // pick-btn の CSS(3位決定戦で使用)を注入
  (function ensurePickBtnStyle(){
    const s=document.createElement('style');
    s.textContent=`.match-pick-row{display:flex; flex-direction:column; gap:6px;}
      .pick-btn{display:flex; align-items:center; gap:6px; min-width:0; background:#161320; border:1px solid var(--line); border-radius:10px; color:var(--cream); font-weight:700; font-size:16px; padding:4px;}
      .pick-main{flex:1; display:flex; align-items:center; gap:10px; min-width:0; padding:9px 8px; cursor:pointer; border-radius:8px;}
      .pick-main:active{ background:rgba(255,255,255,.08); }
      .pick-btn span.nm{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .pick-btn.winner{ background:linear-gradient(90deg,rgba(232,179,76,.28),rgba(232,179,76,.08)); border-color:var(--gold-dim); color:var(--gold); font-weight:900; }
      .pick-edit-btn{flex-shrink:0; background:none; border:1px solid var(--line); border-radius:6px; color:var(--muted); font-size:14px; padding:0 10px; cursor:pointer; align-self:center; height:34px;}
      .nm-edit-input{flex:1; min-width:0; background:#0d0a14; border:1px solid var(--ember2); color:var(--cream); border-radius:6px; padding:7px 9px; font-size:15px; font-family:'Noto Sans JP',sans-serif;}`;
    document.head.appendChild(s);
  })();

  render();
  // data/*.json(GitHub側=正)の取り込みが終わったら描き直す
  AtsuCup.ready.then(()=>{ render(); });
  // ログイン状態が変わったら(このタブ内で)、プール跨ぎガードや候補ロースターが変わるので描き直す
  if(typeof GoogleAuth !== 'undefined') GoogleAuth.onStateChange(()=> render());
})();
