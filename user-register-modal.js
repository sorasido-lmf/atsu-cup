// 新規ユーザー登録用の共通モーダル。ユーザー管理画面・大会エントリー画面の両方から呼び出す。
// 登録はこの端末のroster(ユーザーマスタ)に対してのみ行う(今回の大会への参加選出はしない)。
const UserRegisterModal = (function(){
  "use strict";

  let overlayEl = null;

  function ensureStyle(){
    if(document.getElementById('urmStyle')) return;
    const style = document.createElement('style');
    style.id = 'urmStyle';
    style.textContent = `
      .urm-overlay{ position:fixed; inset:0; background:rgba(5,3,10,.72); z-index:200; display:flex; align-items:flex-end; justify-content:center; }
      .urm-sheet{ width:100%; max-width:520px; background:#150f22; border:1.5px solid var(--line); border-bottom:none; border-top-left-radius:20px; border-top-right-radius:20px; padding:20px 18px calc(20px + env(safe-area-inset-bottom)); }
      .urm-sheet h3{ margin:0 0 10px; font-size:16px; color:var(--cream,#f5efe0); }
      .urm-actions{ display:flex; gap:10px; margin-top:12px; }
      .urm-actions .btn{ flex:1; }
    `;
    document.head.appendChild(style);
  }

  function close(){
    if(overlayEl){ overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(ev){ if(ev.key === 'Escape') close(); }

  // open({ onRegistered }) : onRegistered(names: string[]) は新規登録された名前の配列を受けて呼ばれる
  function open(opts){
    opts = opts || {};
    ensureStyle();
    close();
    overlayEl = document.createElement('div');
    overlayEl.className = 'urm-overlay';
    overlayEl.innerHTML = `
      <div class="urm-sheet">
        <h3>➕ 新規ユーザー登録</h3>
        <p class="hint" style="margin-top:0;">1行に1人ずつ名前を入力してください。</p>
        <textarea id="urmInput" placeholder="名前を入力(1行に1人ずつ)" style="min-height:70px;"></textarea>
        <div class="urm-actions">
          <button class="btn btn-primary" id="urmSave">登録する</button>
          <button class="btn btn-ghost" id="urmCancel">キャンセル</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', (ev)=>{ if(ev.target === overlayEl) close(); });
    overlayEl.querySelector('#urmCancel').addEventListener('click', close);
    overlayEl.querySelector('#urmSave').addEventListener('click', ()=>{
      const P = AtsuCup.pool();
      const lines = overlayEl.querySelector('#urmInput').value.split("\n").map(s=>s.trim()).filter(Boolean);
      if(!lines.length){ alert('名前を入力してください。'); return; }
      const uniqNew = [...new Set(lines)].filter(n=>!P.roster.includes(n));
      if(!uniqNew.length){ alert('入力された名前は、すでにすべて登録済みです。'); return; }
      P.roster = [...P.roster, ...uniqNew];
      uniqNew.forEach(name=>{ P.userRecDefaults[name] = true; });
      AtsuCup.persist();
      close();
      if(typeof opts.onRegistered === 'function') opts.onRegistered(uniqNew);
    });
    document.addEventListener('keydown', onKeydown);
    overlayEl.querySelector('#urmInput').focus();
  }

  return { open, close };
})();
