// 飛び入り参加用の共通モーダル。組み合わせ決定前(参加者選出)・決定後(BYE枠埋め)の両方から呼び出す。
// 「登録済み・今回未参加のユーザーから選ぶ」と「新規ユーザー登録(UserRegisterModalを内部で呼ぶ)」を1つのボトムシートで提供する。
// user-register-modal.js と同じ IIFE + ensureStyle + オーバーレイ + onPick コールバックのパターン。
const WalkinModal = (function(){
  "use strict";

  let overlayEl = null;

  function ensureStyle(){
    if(document.getElementById('wkmStyle')) return;
    const style = document.createElement('style');
    style.id = 'wkmStyle';
    style.textContent = `
      .wkm-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.72); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
      .wkm-sheet{ width:100%; max-width:520px; max-height:80vh; overflow-y:auto; background:var(--pale-marble); color:var(--fantasy-text); border:1.5px solid var(--frame-brown); border-bottom:none; border-top-left-radius:20px; border-top-right-radius:20px; padding:20px 18px calc(20px + env(safe-area-inset-bottom)); }
      .wkm-sheet h3{ margin:0 0 4px; font-size:16px; color:var(--cream,#f5efe0); }
      .wkm-cand-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
      .wkm-cand{ background:#fffdf7; border:1.5px solid var(--stone-beige); border-radius:10px; padding:9px 8px; font-weight:700; font-size:13px; color:var(--fantasy-text); cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wkm-cand:active{ background:rgba(255,255,255,.08); }
      .wkm-actions{ display:flex; gap:10px; margin-top:14px; }
      .wkm-actions .btn{ flex:1; }
    `;
    document.head.appendChild(style);
  }

  function close(){
    if(overlayEl){ overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(ev){ if(ev.key === 'Escape') close(); }

  // open({ excludeNames, onPick }) :
  //   excludeNames … 候補から除外する名前(既に参加している人など)
  //   onPick(name)  … 既存ユーザー選択 or 新規登録で選ばれた名前を1件ずつ受け取る
  function open(opts){
    opts = opts || {};
    ensureStyle();
    close();
    const P = AtsuCup.pool();
    const exclude = new Set(opts.excludeNames || []);
    // ユーザー管理画面で決めた並び順で出す(orderedRosterがアーカイブ済みを除いてくれる)
    const candidates = AtsuCup.orderedRoster(P).filter(n => !exclude.has(n));

    const escapeHtml = AtsuCup.escapeHtml;
    overlayEl = document.createElement('div');
    overlayEl.className = 'wkm-overlay';
    overlayEl.innerHTML = `
      <div class="wkm-sheet">
        <h3>👋 参加者を追加</h3>
        <p class="hint" style="margin-top:0;">登録済みの人をタップで追加、または新規登録できます。</p>
        ${candidates.length ? `
          <div class="wkm-cand-grid">
            ${candidates.map(n=>`<button type="button" class="wkm-cand" data-pick="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
          </div>
        ` : `<div class="empty-state" style="padding:12px 4px;">追加できる登録済みユーザーがいません。新規登録してください。</div>`}
        <div class="wkm-actions">
          <button class="btn btn-primary" id="wkmNew">➕ 新規ユーザー登録</button>
          <button class="btn btn-ghost" id="wkmCancel">閉じる</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', (ev)=>{ if(ev.target === overlayEl) close(); });
    overlayEl.querySelector('#wkmCancel').addEventListener('click', close);
    overlayEl.querySelectorAll('[data-pick]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const name = btn.dataset.pick;
        close();
        if(typeof opts.onPick === 'function') opts.onPick(name);
      });
    });
    overlayEl.querySelector('#wkmNew').addEventListener('click', ()=>{
      close();
      UserRegisterModal.open({
        onRegistered: (names)=>{
          if(typeof opts.onPick === 'function') names.forEach(n => opts.onPick(n));
        }
      });
    });
    document.addEventListener('keydown', onKeydown);
  }

  return { open, close };
})();
