// 大会詳細ページのコントローラ。?id= の大会の進行段階に応じて、
// 上部カード(進行中/過去) + 組み合わせ決定(matchup) or 対戦表(bracket) を出し分ける。
(function(){
  "use strict";
  const state = AtsuCup.state;
  const escapeHtml = AtsuCup.escapeHtml;
  const roundLabel = AtsuCup.roundLabel;
  AtsuCup.restore();
  if(!state.userRecDefaults) state.userRecDefaults = {};
  if(!state.archivedUsers) state.archivedUsers = {};

  const content = document.getElementById('content');
  const matchupSection = document.getElementById('matchupSection');
  const bracketSection = document.getElementById('bracketSection');
  const id = new URLSearchParams(location.search).get('id');
  // この大会を操作対象にする(state.people/matches等がこの大会を指すようになる)
  AtsuCup.setActive(id);

  let mode = 'view'; // 'view'|'editing'|'confirmEnd'|'confirmDelete'

  function initials(name){ return (name||'').trim().charAt(0) || '?'; }
  function truncate(s, n){ return (s && s.length > n) ? s.slice(0,n-1)+'…' : (s||''); }
  function isLive(){ const t=AtsuCup.activeT(); return !!(t && t.status==='ongoing'); }
  function findHistory(){ return state.history.find(h=>h.id===id); }
  function hasPairing(){ return state.matches.length>0 && state.matches[0].length>0 && state.remaining.length===0; }
  function recDefaultOf(name){ return state.userRecDefaults[name] !== false; }

  document.getElementById('rosterCandidates').innerHTML = state.roster.map(n=>`<option value="${escapeHtml(n)}">`).join('');

  /* ================= ルート ================= */
  function render(){
    if(!id){ renderNotFound(); return; }
    if(isLive()){
      if(mode === 'editing'){ renderEditForm(); return; }
      renderLiveHeader();
      if(hasPairing()){
        matchupSection.style.display = 'none';
        bracketSection.style.display = 'block';
        renderBracket();
      }else{
        bracketSection.style.display = 'none';
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
    const statusBadge = state.winnerName ? `<span class="status-badge done">優勝者決定</span>` : `<span class="status-badge open">進行中</span>`;
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
      ${state.winnerName?`<div class="cur-line champ">👑 優勝: ${escapeHtml(state.winnerName)}</div>`:''}
      ${state.thirdPlaceMatch&&state.thirdPlaceMatch.winner?`<div class="cur-line third">🥉 3位: ${escapeHtml(state.thirdPlaceMatch.winner)}</div>`:''}
      <div class="row">
        <button class="btn btn-ghost" id="editBtn">編集する</button>
        <button class="btn btn-ghost" id="endBtn">この大会を終了する</button>
      </div>
      ${confirmHtml}`;
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
    content.innerHTML = `
      <div class="video-card">
        <div class="field" style="margin-bottom:8px;"><label>大会名</label><input type="text" id="tfTitle" value="${escapeHtml(meta.title)}"></div>
        <div class="field" style="margin-bottom:8px;"><label>詳細・ルール</label><textarea id="tfDetails" style="min-height:100px;">${escapeHtml(meta.details||'')}</textarea></div>
        <div class="field" style="margin-bottom:8px;"><label>告知ポスター画像</label><input type="file" id="tfPoster" accept="image/*"></div>
        <div class="row"><button class="btn btn-primary" id="tfSave">更新する</button><button class="btn btn-ghost" id="tfCancel">キャンセル</button></div>
      </div>`;
    document.getElementById('tfCancel').addEventListener('click', ()=>{ mode='view'; render(); });
    document.getElementById('tfSave').addEventListener('click', async ()=>{
      const title = document.getElementById('tfTitle').value.trim();
      const details = document.getElementById('tfDetails').value.trim();
      const fileInput = document.getElementById('tfPoster');
      if(!title){ alert('大会名を入力してください。'); return; }
      const saveBtn = document.getElementById('tfSave'); saveBtn.disabled=true; saveBtn.textContent='保存中...';
      try{
        let posterUrl = meta.posterUrl;
        if(fileInput.files && fileInput.files[0]){ posterUrl = await AtsuCup.resizeImageToDataUrl(fileInput.files[0], 900, 0.75); }
        state.tournamentMeta = { id: meta.id, title, details, posterUrl };
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
    const confirmHtml = mode==='confirmDelete' ? `
      <div class="confirm-banner">「${escapeHtml(h.title)}」を大会一覧から削除します。よろしいですか？(元に戻せません)
        <div class="row"><button class="btn btn-primary" id="confirmDeleteBtn">削除する</button><button class="btn btn-ghost" id="cancelDeleteBtn">キャンセル</button></div></div>` : '';
    content.innerHTML = `
      <div class="row" style="margin-top:0;"><button class="btn btn-ghost" id="deleteBtn" style="color:#ff7373;">🗑️ この大会を削除</button></div>
      <div class="video-card" style="margin-top:14px;">
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
      ${thirdHtml}
      ${confirmHtml}`;
    document.getElementById('deleteBtn').addEventListener('click', ()=>{ mode='confirmDelete'; renderPast(h); });
    if(mode==='confirmDelete'){
      document.getElementById('cancelDeleteBtn').addEventListener('click', ()=>{ mode='view'; renderPast(h); });
      document.getElementById('confirmDeleteBtn').addEventListener('click', ()=>{ state.history = state.history.filter(x=>x.id!==h.id); AtsuCup.persist(); location.href='tournaments.html'; });
    }
    window.scrollTo({top:0, behavior:'instant'});
  }

  /* ================= 組み合わせ決定(matchup) ================= */
  let decideMode = 'roulette';
  let manualPool = [], manualBuilt = [], manualSeedMode = false;

  function flattenSeeds(){ const seeds=[]; if(state.matches.length){ state.matches[0].forEach(m=>{ if(m.b===null && m.a) seeds.push(m.a); }); } return seeds; }
  function flattenOrder(){ if(state.matches.length){ const names=[]; state.matches[0].forEach(m=>{ if(m.a) names.push(m.a); if(m.b) names.push(m.b); }); if(names.length) return names; } return state.people.map(p=>p.name); }

  function renderMatchup(){
    matchupSection.innerHTML = `
      <h2>組み合わせを決める</h2>
      <div id="peopleSummary"></div>
      <div class="decide-tabs" id="decideModeTabs" style="margin-top:14px;"></div>
      <div id="rouletteLauncher"></div>
      <div id="manualBox" style="display:none;"></div>
      <div class="row">
        <button class="btn btn-primary" id="instantAutoBtn">⚡ ワンタップで自動抽選</button>
        <button class="btn btn-ghost" id="resetOrderBtn">🔄 引き直す</button>
      </div>
      <h3 class="section-title" style="margin-top:18px;">組み合わせプレビュー</h3>
      <p class="hint" id="pairingHint">ルーレット・自動抽選で組み合わせが決まると、ここに表示されます。名前タップで書き換え、⠿ドラッグで入れ替えできます。</p>
      <div id="pairingArea" class="pairing-list"></div>`;

    document.getElementById('instantAutoBtn').addEventListener('click', ()=>{
      if(!state.people.length) return;
      AtsuCup.resetDownstream(); state.remaining=[]; state.order = state.people.map(p=>p.name); AtsuCup.persist();
      render(); // remaining空 → bracketへ
    });
    document.getElementById('resetOrderBtn').addEventListener('click', ()=>{ AtsuCup.resetDownstream(); refreshMatchup(); });

    renderDecideModeTabs();
    refreshMatchup();
  }

  function refreshMatchup(){
    renderPeopleSummary();
    drawWheel();
    renderPairingPreview();
    renderRouletteLauncher();
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

  function renderDecideModeTabs(){
    const tabs = document.getElementById('decideModeTabs');
    if(!tabs) return;
    tabs.innerHTML = `
      <button class="btn ${decideMode==='roulette'?'btn-gold':'btn-ghost'}" id="modeRouletteBtn">🎡 ルーレット</button>
      <button class="btn ${decideMode==='manual'?'btn-gold':'btn-ghost'}" id="modeManualBtn">✋ 手動で決める</button>`;
    document.getElementById('modeRouletteBtn').addEventListener('click', ()=>{
      decideMode='roulette'; manualPool=[]; manualBuilt=[]; manualSeedMode=false;
      document.getElementById('manualBox').style.display='none';
      renderDecideModeTabs(); renderRouletteLauncher();
    });
    document.getElementById('modeManualBtn').addEventListener('click', ()=>{
      decideMode='manual';
      if(state.matches.length && state.matches[0].length){
        const seeds = flattenSeeds();
        manualBuilt = flattenOrder().map(n=>({name:n, seed:seeds.includes(n)})); manualPool=[];
      }else{ manualBuilt=[]; manualPool = state.people.map(p=>p.name); }
      manualSeedMode=false;
      document.getElementById('rouletteLauncher').innerHTML='';
      document.getElementById('manualBox').style.display='block';
      renderDecideModeTabs(); renderManualEditor();
    });
  }

  function renderRouletteLauncher(){
    const el = document.getElementById('rouletteLauncher');
    if(!el) return;
    if(decideMode!=='roulette'){ el.innerHTML=''; return; }
    if(!state.people.length){ el.innerHTML=''; return; }
    const remain = state.remaining.length;
    el.innerHTML = `<button class="btn btn-gold" id="openRouletteBtn" style="width:100%; margin-bottom:6px;">🎲 ルーレットで決める${remain?`(残り${remain}人)`:''}</button>`;
    document.getElementById('openRouletteBtn').addEventListener('click', openRoulette);
  }

  /* ---- 手動編集 ---- */
  function renderManualEditor(){
    const manualBox = document.getElementById('manualBox');
    if(!manualBox) return;
    const recMap = AtsuCup.recMapOf();
    const total = manualBuilt.length + manualPool.length;
    const size = AtsuCup.nextPow2(total);
    const byeCount = size - total;
    const seedCount = manualBuilt.filter(b=>b.seed).length;
    const seedDone = seedCount === byeCount;
    const allPlaced = manualPool.length === 0;
    const canConfirm = total>0 && allPlaced && seedDone;
    let applyLabel = 'この組み合わせで決定する';
    if(!allPlaced) applyLabel = `あと${manualPool.length}人選んでください`;
    else if(!seedDone) applyLabel = byeCount>seedCount ? `シードをあと${byeCount-seedCount}人選んでください` : `シードが${seedCount-byeCount}人多いです`;
    manualBox.innerHTML = `
      <div class="row" style="margin-bottom:6px;">
        <button type="button" class="btn ${manualSeedMode?'btn-gold':'btn-ghost'}" id="seedModeBtn" style="width:100%;">${manualSeedMode ? '🌱 次にタップした人はシード(不戦勝)になります' : '🌱 次をシード(不戦勝)として追加する'}</button>
      </div>
      <p class="hint" style="margin-top:0;">下の候補を対戦させたい順にタップしてください。${byeCount>0?`(シードは${byeCount}人必要・現在${seedCount}人)`:''}</p>
      ${manualPool.length ? `<div class="manual-seed-label">候補(タップで追加)</div><div class="seed-chip-list" id="manualPoolList">${manualPool.map(name=>`<button type="button" class="seed-chip" data-pooltap="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}</div>` : ''}
      <div class="manual-seed-label" style="margin-top:16px;">決定した順番${manualBuilt.length?`(${manualBuilt.length}人)`:''}</div>
      ${manualBuilt.length ? `<p class="hint" style="margin-top:0;">⠿で並び替え、名前タップで書き換え、🌱でシード切替、✕で候補に戻す。上から2人ずつ対戦。</p>
        <div class="order-list" id="manualOrderList">${manualBuilt.map((b,i)=>`
          <div class="order-item ${b.seed?'is-seed':''}" data-idx="${i}">
            <span class="drag-handle">⠿</span><span class="idx">${i+1}</span>
            <span class="nm-edit" data-edit="${escapeHtml(b.name)}">${escapeHtml(b.name)}</span>
            <span class="cam">${recMap[b.name]?'📹':'🚫'}</span>
            <button type="button" class="seed-toggle-btn ${b.seed?'active':''}" data-seedtoggleidx="${i}">🌱</button>
            <button type="button" class="remove-btn" data-removeidx="${i}">✕</button>
          </div>`).join('')}</div>` : `<div class="empty-state" style="padding:10px;">上の候補をタップして並べてください。</div>`}
      <div class="row" style="margin-top:14px;"><button class="btn btn-primary" id="applyManualBtn" ${canConfirm?'':'disabled'}>${applyLabel}</button></div>`;

    document.getElementById('seedModeBtn').addEventListener('click', ()=>{ manualSeedMode=!manualSeedMode; renderManualEditor(); });
    manualBox.querySelectorAll('[data-pooltap]').forEach(btn=> btn.addEventListener('click', ()=>{ const name=btn.dataset.pooltap; manualPool=manualPool.filter(n=>n!==name); manualBuilt.push({name, seed:manualSeedMode}); renderManualEditor(); }));
    manualBox.querySelectorAll('[data-seedtoggleidx]').forEach(btn=> btn.addEventListener('click', ()=>{ const idx=+btn.dataset.seedtoggleidx; manualBuilt[idx].seed=!manualBuilt[idx].seed; renderManualEditor(); }));
    manualBox.querySelectorAll('[data-removeidx]').forEach(btn=> btn.addEventListener('click', ()=>{ const idx=+btn.dataset.removeidx; const [removed]=manualBuilt.splice(idx,1); manualPool.push(removed.name); renderManualEditor(); }));
    manualBox.querySelectorAll('[data-edit]').forEach(span=> span.addEventListener('click', ()=>{
      const oldName=span.dataset.edit; const input=document.createElement('input'); input.type='text'; input.className='nm-edit-input'; input.value=oldName;
      span.replaceWith(input); input.focus(); input.select();
      let done=false; const commit=()=>{ if(done)return; done=true; const val=input.value.trim(); if(val&&val!==oldName){ const e=manualBuilt.find(b=>b.name===oldName); if(e)e.name=val; } renderManualEditor(); };
      input.addEventListener('blur',commit); input.addEventListener('keydown',e=>{ if(e.key==='Enter')input.blur(); });
    }));
    const listEl = document.getElementById('manualOrderList');
    if(listEl){ listEl.querySelectorAll('.order-item').forEach(row=>{
      const handle = row.querySelector('.drag-handle');
      handle.addEventListener('pointerdown', (e)=>{
        e.preventDefault(); const startIdx=+row.dataset.idx; let curIdx=startIdx; const startY=e.clientY;
        const rows=Array.from(listEl.children); const rowStep=rows.length>1?(rows[1].offsetTop-rows[0].offsetTop):row.offsetHeight;
        row.classList.add('dragging'); row.setPointerCapture(e.pointerId);
        function onMove(ev){ const dy=ev.clientY-startY; const steps=Math.round(dy/rowStep); const newIdx=Math.max(0,Math.min(manualBuilt.length-1,startIdx+steps));
          row.style.transform=`translateY(${dy-(newIdx-startIdx)*rowStep}px)`;
          if(newIdx!==curIdx){ const item=manualBuilt.splice(curIdx,1)[0]; manualBuilt.splice(newIdx,0,item); const others=Array.from(listEl.children).filter(el=>el!==row); const refEl=others[newIdx]||null; if(refEl)listEl.insertBefore(row,refEl); else listEl.appendChild(row); curIdx=newIdx; } }
        function onUp(){ row.style.transform=''; row.classList.remove('dragging'); document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); renderManualEditor(); }
        document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
      });
    }); }
    document.getElementById('applyManualBtn').addEventListener('click', ()=>{
      if(!canConfirm) return;
      const orderedNames = manualBuilt.map(b=>b.name);
      const seedNames = manualBuilt.filter(b=>b.seed).map(b=>b.name);
      state.matches = [AtsuCup.buildRound1Manual(orderedNames, seedNames)];
      state.order = orderedNames; state.remaining=[]; state.thirdPlaceMatch=null; state.winnerName='';
      manualBuilt=[]; manualPool=[]; manualSeedMode=false; decideMode='roulette';
      AtsuCup.persist();
      render(); // 確定 → bracket
    });
  }

  /* ---- 組み合わせプレビュー ---- */
  function startEditPairName(m, side){
    const slotEl = document.querySelector(`#pairingArea .pair-slot[data-m="${m}"][data-side="${side}"]`);
    if(!slotEl) return; const nmSpan=slotEl.querySelector('.nm'); if(!nmSpan) return;
    const match=state.matches[0][m]; const current=side==='a'?match.a:match.b;
    const input=document.createElement('input'); input.type='text'; input.className='nm-edit-input'; input.value=current; input.setAttribute('list','rosterCandidates');
    input.addEventListener('click',ev=>ev.stopPropagation()); nmSpan.replaceWith(input); input.focus(); input.select();
    let done=false; const commit=()=>{ if(done)return; done=true; const val=input.value.trim(); if(val){ if(side==='a')match.a=val; else match.b=val; if(match.b===null)match.winner=match.a; AtsuCup.persist(); } renderPairingPreview(); };
    input.addEventListener('blur',commit); input.addEventListener('keydown',e=>{ if(e.key==='Enter')input.blur(); });
  }
  function swapPairSlots(m1,s1,m2,s2){
    if(m1===m2&&s1===s2) return; const M1=state.matches[0][m1], M2=state.matches[0][m2];
    const tmp=M1[s1]; M1[s1]=M2[s2]; M2[s2]=tmp;
    if(M1.b===null)M1.winner=M1.a; if(M2.b===null)M2.winner=M2.a; AtsuCup.persist(); renderPairingPreview();
  }
  function attachPairDrag(handleEl){
    handleEl.addEventListener('click',ev=>ev.stopPropagation());
    handleEl.addEventListener('pointerdown',(e)=>{
      e.preventDefault(); e.stopPropagation(); const m=+handleEl.dataset.m, side=handleEl.dataset.side;
      const slotEl=handleEl.closest('.pair-slot'); const startX=e.clientX, startY=e.clientY;
      slotEl.classList.add('dragging-slot'); slotEl.style.pointerEvents='none'; let dropTarget=null;
      function onMove(ev){ const dx=ev.clientX-startX, dy=ev.clientY-startY; slotEl.style.transform=`translate(${dx}px,${dy}px)`;
        const under=document.elementFromPoint(ev.clientX,ev.clientY); document.querySelectorAll('.pair-slot.drop-target').forEach(x=>x.classList.remove('drop-target'));
        const t=under?under.closest('.pair-slot[data-m]'):null; if(t&&t!==slotEl){ dropTarget=t; t.classList.add('drop-target'); } else dropTarget=null; }
      function onUp(){ slotEl.style.transform=''; slotEl.style.pointerEvents=''; slotEl.classList.remove('dragging-slot'); document.querySelectorAll('.pair-slot.drop-target').forEach(x=>x.classList.remove('drop-target')); document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); if(dropTarget){ swapPairSlots(m,side,+dropTarget.dataset.m,dropTarget.dataset.side); } }
      document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
    });
  }
  function pairSlotHtml(name,m,side,recMap,isForced){
    if(name===null) return `<div class="pair-slot bye">BYE (不戦勝)</div>`;
    if(!AtsuCup.isRevealed(name)) return `<div class="pair-slot pending"><span>🎲 ？？？</span></div>`;
    return `<div class="pair-slot ${isForced?'forced':''}" data-m="${m}" data-side="${side}"><span class="nm" data-editname>${escapeHtml(name)}</span><span class="cam-mark">${recMap[name]?'📹':'🚫'}</span><span class="drag-handle-sm" data-draghandle data-m="${m}" data-side="${side}">⠿</span></div>`;
  }
  function renderPairingPreview(){
    const area=document.getElementById('pairingArea'); const hint=document.getElementById('pairingHint'); if(!area) return;
    if(!state.people.length){ area.innerHTML=`<div class="empty-state"><span class="big">🙋</span>参加者がいません。</div>`; hint.style.display='none'; return; }
    hint.style.display='block';
    const has = state.matches.length>0 && state.matches[0].length>0;
    if(!has){ area.innerHTML=`<div class="empty-state"><span class="big">🌀</span>まだ組み合わせがありません。<br>上で決め方を選んでください。</div>`; return; }
    const recMap=AtsuCup.recMapOf(); const round=state.matches[0];
    let html=round.map((m,i)=>{
      const isForced=m.a&&m.b&&AtsuCup.isRevealed(m.a)&&AtsuCup.isRevealed(m.b)&&!recMap[m.a]&&!recMap[m.b];
      return `<div class="pair-card"><div class="pair-row">${pairSlotHtml(m.a,i,'a',recMap,isForced)}<span class="pair-vs">VS</span>${pairSlotHtml(m.b,i,'b',recMap,isForced)}</div></div>`;
    }).join('');
    const forced=AtsuCup.forcedPairsList();
    if(forced.length){ html+=`<div class="warn-box">⚠️ 撮影OKの人が足りず、以下は撮影不可同士の対戦になっています:<br>`+forced.map(f=>`・${escapeHtml(f.a)} vs ${escapeHtml(f.b)}`).join('<br>')+`</div>`; }
    area.innerHTML=html;
    area.querySelectorAll('[data-editname]').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); const slot=el.closest('.pair-slot'); startEditPairName(+slot.dataset.m, slot.dataset.side); }));
    area.querySelectorAll('[data-draghandle]').forEach(el=> attachPairDrag(el));
  }

  /* ---- ルーレットモーダル ---- */
  let rouletteEl=null, wheelCanvas=null, wheelCtx=null, currentRotation=0, spinning=false;
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
  function openRoulette(){
    if(!state.remaining.length){
      // 全員公開済みで開いた場合は何もしない(通常は確定してbracketに移っている)
      return;
    }
    ensureRouletteEl(); rouletteEl.style.display='flex'; rouletteEl.querySelector('#pickedBanner').innerHTML='&nbsp;'; drawWheel();
  }
  function closeRoulette(){ if(rouletteEl) rouletteEl.style.display='none'; }
  function drawWheel(){
    if(!wheelCtx) return;
    const list = state.remaining.length ? state.remaining : ["参加者を登録してください"];
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
    if(spinning) return; if(!state.remaining.length) return;
    const spinBtn=rouletteEl.querySelector('#spinBtn'); const pickedBanner=rouletteEl.querySelector('#pickedBanner');
    spinning=true; spinBtn.disabled=true;
    const n=state.remaining.length, seg=(Math.PI*2)/n; const winnerIdx=Math.floor(Math.random()*n); const targetSegCenter=winnerIdx*seg+seg/2;
    const spinDir=Math.random()<0.3?-1:1; const extraSpins=4+Math.random()*4; const duration=2600+Math.random()*1500; const spinEase=SPIN_STYLES[Math.floor(Math.random()*SPIN_STYLES.length)];
    const baseRotation=currentRotation+spinDir*extraSpins*Math.PI*2; const correction=-Math.PI/2-(baseRotation%(Math.PI*2))-targetSegCenter; const finalRotation=baseRotation+correction;
    const startRotation=currentRotation, delta=finalRotation-startRotation, startTime=performance.now();
    function frame(now){ const t=Math.min(1,(now-startTime)/duration); currentRotation=startRotation+delta*spinEase(t); drawWheel();
      if(t<1){ requestAnimationFrame(frame); }
      else{
        currentRotation=finalRotation; drawWheel(); spinning=false; spinBtn.disabled=false;
        const picked=state.remaining[winnerIdx]; state.remaining.splice(winnerIdx,1); state.order.push(picked);
        const isSeed=state.matches.length>0 && state.matches[0].some(m=>m.a===picked&&m.b===null);
        pickedBanner.classList.toggle('seed',isSeed);
        if(isSeed){ pickedBanner.textContent='🎉 シード権獲得！ '+picked; spawnSeedParticles(); } else { pickedBanner.textContent='🎯 '+picked; }
        AtsuCup.persist();
        renderPairingPreview();
        if(state.remaining.length===0){
          setTimeout(()=>{ closeRoulette(); render(); }, 900); // 全員公開 → bracketへ
        } else {
          renderRouletteLauncher();
        }
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
    const MAX = lc<=8?90:lc<=16?60:lc<=24?40:26;
    const avail=Math.max(200, window.innerHeight-200);
    TREE_ROW_H = lc ? Math.max(MIN, Math.min(MAX, avail/lc)) : MIN;
    BOX_H = Math.max(20, Math.min(30, TREE_ROW_H-8));
  }
  function leafY(i){ return HEADER_H + (i+0.5)*TREE_ROW_H; }
  function jointY(r,i){ if(r===0) return (leafY(2*i)+leafY(2*i+1))/2; return (jointY(r-1,2*i)+jointY(r-1,2*i+1))/2; }
  function colLeft(r){ return PAD_LEFT + r*COL_W; }

  let treeSlotRects={}, lastSvgW=0, bRecMap={};
  function boxSvg(r,i,side,name,centerY,isWinner,isForced){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    const fill=isWinner?'#161020':'#0d0a14'; const stroke=isWinner?'#5a4a2a':(isForced?'#7a2c2c':'#3a2f4d');
    const nameFill=isWinner?'#e8b34c':'#f1e6cf'; const weight=isWinner?'900':'700';
    treeSlotRects[`${r}_${i}_${side}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
      +`<text x="${cLeft+8}" y="${centerY+4.5}" font-size="13" font-weight="${weight}" fill="${nameFill}">${escapeHtml(truncate(name,7))}</text>`
      +`<text x="${cLeft+BOX_W-26}" y="${centerY+4.5}" font-size="10.5" text-anchor="end">${bRecMap[name]?'📹':'🚫'}</text>`
      +`<text class="tree-edit-icon" data-editr="${r}" data-editm="${i}" data-editside="${side}" x="${cLeft+BOX_W-4}" y="${centerY+4.5}" font-size="12" text-anchor="end">✏️</text>`;
  }
  function byeBoxSvg(r,i,centerY){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    treeSlotRects[`bye_${i}`]={x:cLeft,y:boxY,w:BOX_W,h:BOX_H};
    return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0d0a14" stroke="#3a2f4d" stroke-width="1.5" stroke-dasharray="3 3"/>`
      +`<text x="${cLeft+8}" y="${centerY+4.5}" font-size="12" font-style="italic" fill="#6b5f82">シード</text>`
      +`<text class="tree-add-icon" data-addm="${i}" x="${cLeft+BOX_W-6}" y="${centerY+5}" font-size="14" text-anchor="end">➕</text>`;
  }
  function pendingBoxSvg(r,centerY){
    const cLeft=colLeft(r), boxY=centerY-BOX_H/2;
    return `<rect x="${cLeft}" y="${boxY}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="#0a0810" stroke="#2a2338" stroke-width="1.5"/>`
      +`<text x="${cLeft+BOX_W/2}" y="${centerY+4.5}" font-size="12" text-anchor="middle" fill="#4a4060">？？？</text>`;
  }
  function buildTreeSVG(){
    treeSlotRects={}; bRecMap=AtsuCup.recMapOf();
    const round0=state.matches[0]; const leafCount=round0.length*2; const totalRounds=Math.round(Math.log2(leafCount));
    const lastColRight=colLeft(totalRounds-1)+BOX_W+STUB_W; const svgW=lastColRight+40; const svgH=HEADER_H+leafCount*TREE_ROW_H; lastSvgW=svgW;
    let framesSvg='', linesSvg='', boxesSvg='', pickBtnSvg='';
    for(let r=0;r<totalRounds;r++){
      const round=state.matches[r]||[]; const matchCount=leafCount/Math.pow(2,r+1);
      const boxRight=colLeft(r)+BOX_W, joinX=boxRight+STUB_W; const stubRight=(r===totalRounds-1)?joinX+22:colLeft(r+1);
      const frameX=colLeft(r)-4; const frameW=(r===totalRounds-1)?(BOX_W+8):COL_W;
      framesSvg+=`<rect x="${frameX}" y="${HEADER_H-2}" width="${frameW}" height="${svgH-HEADER_H}" rx="8" fill="none" stroke="#241d33" stroke-width="1"/>`;
      framesSvg+=`<text x="${colLeft(r)+BOX_W/2}" y="14" font-size="11.5" font-weight="700" text-anchor="middle" fill="#9a8fae">${escapeHtml(roundLabel(matchCount))}</text>`;
      for(let i=0;i<matchCount;i++){
        const m=round[i]; const centerY=jointY(r,i); const upY=centerY-TREE_ROW_H/2, downY=centerY+TREE_ROW_H/2;
        const isForced=m&&m.a&&m.b&&!bRecMap[m.a]&&!bRecMap[m.b];
        linesSvg+=`<path d="M${boxRight},${upY} H${joinX}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        linesSvg+=`<path d="M${boxRight},${downY} H${joinX}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        linesSvg+=`<path d="M${joinX},${upY} V${downY}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        linesSvg+=`<path d="M${joinX},${centerY} H${stubRight}" stroke="#3a2f4d" stroke-width="2" fill="none"/>`;
        [['a',m?m.a:null,upY,m?m.aSrc:undefined],['b',m?m.b:null,downY,m?m.bSrc:undefined]].forEach(([side,name,y,src])=>{
          if(name===null){ if(src===undefined && side==='b' && m && m.a){ boxesSvg+=byeBoxSvg(r,i,y); } else { boxesSvg+=pendingBoxSvg(r,y); } return; }
          const isWinner=!!m.winner && m.winner===name; boxesSvg+=boxSvg(r,i,side,name,y,isWinner,isForced);
        });
        if(m&&m.a&&m.b&&!m.winner){ const bx=boxRight+STUB_W/2; pickBtnSvg+=`<g class="tree-pick" data-r="${r}" data-m="${i}"><circle cx="${bx}" cy="${centerY}" r="11" fill="#241b12" stroke="#e8b34c" stroke-width="1.5"/><text x="${bx}" y="${centerY+4.5}" font-size="12" text-anchor="middle">⚔️</text></g>`; }
      }
    }
    let trophySvg=''; if(state.winnerName){ const fy=jointY(totalRounds-1,0); trophySvg=`<text x="${lastColRight+6}" y="${fy+8}" font-size="22">🏆</text>`; }
    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#0a0810"/>${framesSvg}${linesSvg}${boxesSvg}${pickBtnSvg}${trophySvg}</svg>`;
  }

  function renderBracket(){
    computeRowH();
    bracketSection.innerHTML = `
      <div class="tree-title" id="treeTitle">${escapeHtml(state.tournamentMeta.title||'トーナメント表')}</div>
      <p class="hint" style="margin:2px 0 8px;">⚔️で勝敗入力・✏️で名前変更・シード枠の➕で途中参加</p>
      ${AtsuCup.bracketNotStarted() ? `<div class="row" style="margin-bottom:8px;"><button class="btn btn-ghost" id="reshuffleBtn" style="width:100%;">🔄 組み合わせをやり直す</button></div>` : ''}
      <div class="row" id="jumpRow" style="display:none; margin-bottom:8px;"><button class="btn btn-ghost" id="jumpNextBtn" style="width:100%;">🎯 次の対戦へ</button></div>
      <div class="tree-scroll" id="treeScroll"></div>
      <div id="advanceArea"></div>
      <button class="btn btn-ghost" id="saveBracketImgBtn" style="margin-top:12px;">📸 画像で保存</button>
      <div id="noticeArea"></div>
      <div id="thirdPlaceArea"></div>
      <div id="championArea"></div>`;
    const reshuffle=document.getElementById('reshuffleBtn');
    if(reshuffle) reshuffle.addEventListener('click', ()=>{ AtsuCup.resetDownstream(); render(); });
    document.getElementById('saveBracketImgBtn').addEventListener('click', saveBracketImg);
    renderTree(); renderExtras();
  }

  function renderTree(){
    const ts=document.getElementById('treeScroll'); ts.innerHTML=buildTreeSVG(); ts.style.setProperty('--svg-natural-w', lastSvgW+'px'); wireTreeInteractions();
  }
  function wireTreeInteractions(){
    document.querySelectorAll('#treeScroll .tree-pick').forEach(el=> el.addEventListener('click', ()=> openMatchPickModal(+el.dataset.r, +el.dataset.m)));
    document.querySelectorAll('#treeScroll .tree-edit-icon').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); startEditTreeName(+el.dataset.editr,+el.dataset.editm,el.dataset.editside); }));
    document.querySelectorAll('#treeScroll .tree-add-icon').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); startAddChallenger(+el.dataset.addm); }));
  }
  function startEditTreeName(r,m,side){
    const match=state.matches[r][m]; if(!match) return; const current=side==='a'?match.a:match.b; const rect=treeSlotRects[`${r}_${m}_${side}`]; const svgEl=document.querySelector('#treeScroll svg'); if(!rect||!svgEl) return;
    const already=svgEl.querySelector('foreignObject.tree-edit-fo'); if(already)already.remove();
    const fo=document.createElementNS('http://www.w3.org/2000/svg','foreignObject'); fo.setAttribute('class','tree-edit-fo'); fo.setAttribute('x',rect.x); fo.setAttribute('y',rect.y); fo.setAttribute('width',rect.w); fo.setAttribute('height',rect.h);
    const input=document.createElementNS('http://www.w3.org/1999/xhtml','input'); input.setAttribute('type','text'); input.setAttribute('class','tree-edit-input'); input.value=current; input.setAttribute('list','rosterCandidates'); input.addEventListener('click',ev=>ev.stopPropagation());
    fo.appendChild(input); svgEl.appendChild(fo); input.focus(); input.select();
    let done=false; const commit=()=>{ if(done)return; done=true; const val=input.value.trim(); if(val&&val!==current){ AtsuCup.renameParticipant(current,val); } renderTree(); renderExtras(); };
    input.addEventListener('blur',commit); input.addEventListener('keydown',e=>{ if(e.key==='Enter')input.blur(); });
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
    document.getElementById('matchPickModal').style.display='flex';
  }
  let matchModalEl=null;
  function ensureMatchModal(){
    if(matchModalEl) return;
    matchModalEl=document.createElement('div'); matchModalEl.className='match-pick-modal'; matchModalEl.id='matchPickModal'; matchModalEl.style.display='none';
    matchModalEl.innerHTML=`<div class="match-pick-modal-backdrop" id="matchPickModalBackdrop"></div><div class="match-pick-modal-card"><div class="match-pick-modal-title" id="modalMatchTitle"></div><div class="match-pick-modal-row"><button type="button" class="modal-pick-btn" id="modalPickA"></button><span class="vs-label">VS</span><button type="button" class="modal-pick-btn" id="modalPickB"></button></div><button type="button" class="btn btn-ghost" id="modalCancelBtn" style="width:100%; margin-top:12px;">キャンセル</button></div>`;
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
    return `<div class="pick-btn ${isWinner?'winner':''}"><span class="pick-main" data-r="${r}" data-m="${m}" data-side="${side}"><span class="avatar">${escapeHtml(initials(name))}</span><span class="nm">${escapeHtml(name)}</span><span>${recMap[name]?'📹':'🚫'}</span></span><button class="pick-edit-btn" data-editname data-side="${side}">✏️</button></div>`;
  }
  function swappedMatchIndices(r){
    if(r===0) return new Set(); const cur=state.matches[r]; if(!cur) return new Set(); const swapped=new Set();
    cur.forEach((m,i)=>{ if(m.aSrc===undefined) return; if(m.aSrc!==2*i||m.bSrc!==2*i+1) swapped.add(i); }); return swapped;
  }
  function renderExtras(){
    const recMap=AtsuCup.recMapOf();
    // 次のラウンドへ進む
    const advanceArea=document.getElementById('advanceArea'); const lastR=state.matches.length-1; const lastRound=lastR>=0?state.matches[lastR]:null;
    if(lastRound && lastRound.length>1){
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
      thirdArea.querySelectorAll('.pick-main[data-r]').forEach(el=> el.addEventListener('click', ()=> pick('third',0,el.dataset.side)));
      thirdArea.querySelectorAll('[data-editname]').forEach(el=> el.addEventListener('click',(ev)=>{ ev.stopPropagation(); startEditThirdName(el.dataset.side, el.closest('.pick-btn')); }));
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
})();
