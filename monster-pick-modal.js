// エントリー時に使ったモンスターを選ぶ共通モーダル。大会エントリー画面・途中参加・大会詳細の
// 参加者一覧から呼び出す。walkin-modal.js と同じ IIFE + ensureStyle + オーバーレイ +
// onPick コールバックのパターン。
//
// モンスターマスタ(AtsuCup.state.monsters)は data/monsters.json 由来の読み取り専用マスタで、
// この画面からは一切書き換えない(追加はスプレッドシートの monsters シートで行う)。
const MonsterPickModal = (function(){
  "use strict";

  let overlayEl = null;

  function ensureStyle(){
    if(document.getElementById('mpmStyle')) return;
    const style = document.createElement('style');
    style.id = 'mpmStyle';
    style.textContent = `
      .mpm-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.72); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
      .mpm-sheet{ width:100%; max-width:520px; max-height:86vh; display:flex; flex-direction:column; background:var(--pale-marble); color:var(--fantasy-text); border:1.5px solid var(--frame-brown); border-bottom:none; border-top-left-radius:20px; border-top-right-radius:20px; padding:18px 16px calc(16px + env(safe-area-inset-bottom)); }
      /* シートの背景は明るい(--pale-marble)ので、見出しは明るい --cream ではなく本文色にする
         (--cream のままだと375px実機でほとんど読めない) */
      .mpm-sheet h3{ margin:0 0 2px; font-size:16px; color:var(--fantasy-text); }
      .mpm-search{ width:100%; box-sizing:border-box; margin-top:10px; padding:10px 12px; font-size:15px; border:1.5px solid var(--stone-beige); border-radius:10px; background:#fffdf7; color:var(--fantasy-text); }
      .mpm-filters{ display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
      .mpm-chip{ border:1.5px solid var(--stone-beige); background:#fffdf7; color:var(--fantasy-text); border-radius:999px; padding:5px 10px; font-size:12px; font-weight:700; cursor:pointer; line-height:1; }
      .mpm-chip.on{ border-color:var(--ember2); background:linear-gradient(180deg,rgba(255,145,69,.20),rgba(255,106,43,.08)); }
      .mpm-list{ flex:1; overflow-y:auto; margin-top:10px; -webkit-overflow-scrolling:touch; }
      .mpm-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:6px; }
      .mpm-cell{ text-align:left; background:#fffdf7; border:1.5px solid var(--stone-beige); border-radius:10px; padding:8px 10px; cursor:pointer; min-width:0; }
      .mpm-cell.on{ border-color:var(--ember2); background:linear-gradient(180deg,rgba(255,145,69,.16),rgba(255,106,43,.05)); }
      .mpm-cell .nm{ display:block; font-weight:700; font-size:13.5px; color:var(--fantasy-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mpm-cell .meta{ display:block; margin-top:3px; font-size:11px; color:var(--fantasy-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mpm-count{ margin-top:8px; font-size:11.5px; color:var(--fantasy-muted); }
      .mpm-actions{ display:flex; gap:8px; margin-top:12px; }
      .mpm-actions .btn{ flex:1; }
    `;
    document.head.appendChild(style);
  }

  function close(){
    if(overlayEl){ overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(ev){ if(ev.key === 'Escape') close(); }

  // open({ currentId, personName, onPick })
  //   currentId  … 現在選ばれている monsterId(選択済みの強調表示に使う)
  //   personName … 見出しに出す参加者名(任意)
  //   onPick(monsterId | null) … 選択で id、「未設定にする」で null を渡す。閉じただけなら呼ばれない
  function open(opts){
    opts = opts || {};
    ensureStyle();
    close();

    const escapeHtml = AtsuCup.escapeHtml;
    const all = AtsuCup.selectableMonsters();
    // 現在選ばれているモンスターがアーカイブ済みでも、選択中として一覧に出す
    // (見えていないものが選ばれている状態にしない)
    const cur = opts.currentId ? AtsuCup.monsterById(opts.currentId) : null;
    if(cur && !all.some(m=> m.id === cur.id)) all.unshift(cur);

    const filter = { q:'', aura:'', kind:'' };

    overlayEl = document.createElement('div');
    overlayEl.className = 'mpm-overlay';
    const chip = (kind, value, label)=>
      `<button type="button" class="mpm-chip" data-${kind}="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    overlayEl.innerHTML = `
      <div class="mpm-sheet">
        <h3>🐾 モンスターを選ぶ</h3>
        <p class="hint" style="margin-top:0;">${opts.personName ? escapeHtml(opts.personName) + 'さんが使ったモンスターを選びます。' : 'エントリー時に使ったモンスターを選びます。'}</p>
        <input type="search" class="mpm-search" id="mpmSearch" placeholder="名前で検索" autocomplete="off">
        <div class="mpm-filters" id="mpmAura">
          ${chip('aura','','オーラ色: 全て')}${AtsuCup.MONSTER_AURAS.map(a=> chip('aura', a, a)).join('')}
        </div>
        <div class="mpm-filters" id="mpmKind">
          ${chip('kind','','モン類: 全て')}${AtsuCup.MONSTER_KINDS.map(k=> chip('kind', k, k)).join('')}
        </div>
        <div class="mpm-list"><div id="mpmGrid"></div></div>
        <div class="mpm-count" id="mpmCount"></div>
        <div class="mpm-actions">
          <button class="btn btn-ghost" id="mpmClear">未設定にする</button>
          <button class="btn btn-ghost" id="mpmCancel">閉じる</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    const grid = overlayEl.querySelector('#mpmGrid');
    const countEl = overlayEl.querySelector('#mpmCount');

    function visible(){
      const q = filter.q.trim().toLowerCase();
      return all.filter(m=>{
        if(filter.aura && m.aura !== filter.aura) return false;
        if(filter.kind && m.kind !== filter.kind) return false;
        if(q && String(m.name||'').toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
    }

    function renderList(){
      const list = visible();
      if(!all.length){
        grid.className = '';
        grid.innerHTML = `<div class="empty-state" style="padding:14px 4px;">モンスターが登録されていません。スプレッドシートの「monsters」シートに追加してください。</div>`;
      }else if(!list.length){
        grid.className = '';
        grid.innerHTML = `<div class="empty-state" style="padding:14px 4px;">条件に合うモンスターがいません。</div>`;
      }else{
        grid.className = 'mpm-grid';
        grid.innerHTML = list.map(m=>{
          const meta = [m.aura, m.kind, m.subBlood].filter(Boolean).join(' / ');
          return `<button type="button" class="mpm-cell${m.id === opts.currentId ? ' on' : ''}" data-pick="${escapeHtml(m.id)}">
            <span class="nm">${escapeHtml(m.name || m.id)}</span>
            <span class="meta">${escapeHtml(meta || '—')}</span>
          </button>`;
        }).join('');
      }
      countEl.textContent = all.length ? `${list.length} / ${all.length}件` : '';
      grid.querySelectorAll('[data-pick]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const id = btn.dataset.pick;
          close();
          if(typeof opts.onPick === 'function') opts.onPick(id);
        });
      });
    }

    function bindChips(containerId, key){
      overlayEl.querySelectorAll(`#${containerId} [data-${key}]`).forEach(btn=>{
        const val = btn.dataset[key];
        if(val === filter[key]) btn.classList.add('on');
        btn.addEventListener('click', ()=>{
          // 同じチップをもう一度押したら解除(「全て」へ戻す)
          filter[key] = (filter[key] === val) ? '' : val;
          overlayEl.querySelectorAll(`#${containerId} [data-${key}]`).forEach(b=>
            b.classList.toggle('on', b.dataset[key] === filter[key]));
          renderList();
        });
      });
    }
    bindChips('mpmAura', 'aura');
    bindChips('mpmKind', 'kind');

    overlayEl.querySelector('#mpmSearch').addEventListener('input', (ev)=>{
      filter.q = ev.target.value || '';
      renderList();
    });
    overlayEl.addEventListener('click', (ev)=>{ if(ev.target === overlayEl) close(); });
    overlayEl.querySelector('#mpmCancel').addEventListener('click', close);
    overlayEl.querySelector('#mpmClear').addEventListener('click', ()=>{
      close();
      if(typeof opts.onPick === 'function') opts.onPick(null);
    });
    document.addEventListener('keydown', onKeydown);

    renderList();
  }

  return { open, close };
})();
