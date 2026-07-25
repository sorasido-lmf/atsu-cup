// 新規ユーザー登録用の共通モーダル。ユーザー管理画面・大会エントリー画面・途中参加(WalkinModal)から呼び出す。
// 既定では端末のroster(ユーザーマスタ)に登録するが、opts.persistを渡した呼び出し元は
// 保存先(GitHub等)を差し替えられる(例: ユーザー管理/大会エントリー画面はGitHubへ直接書き込む)。
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
      .urm-error{ margin-top:10px; background:#241214; border:1px solid #5a2222; border-radius:10px; padding:9px 11px; font-size:12.5px; color:#ffb3b3; line-height:1.6; }
    `;
    document.head.appendChild(style);
  }

  function close(){
    if(overlayEl){ overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(ev){ if(ev.key === 'Escape') close(); }

  async function defaultPersist(names){
    const state = AtsuCup.state;
    state.roster = [...state.roster, ...names];
    if(!state.userRecDefaults) state.userRecDefaults = {};
    names.forEach(name=>{ state.userRecDefaults[name] = true; });
    AtsuCup.persist();
  }

  // open({ onRegistered, existingNames, persist }):
  //  - onRegistered(names: string[]) : 保存成功後、新規登録された名前の配列を受けて呼ばれる
  //  - existingNames(string[]|Set, 省略時はstate.roster) : 重複チェックに使う既存名一覧
  //  - persist(names: string[]) => Promise (省略時は端末rosterへ保存): 失敗時はthrow/rejectするとモーダル内にエラー表示し、閉じない
  function open(opts){
    opts = opts || {};
    ensureStyle();
    close();
    const state = AtsuCup.state;
    const existing = opts.existingNames ? new Set(opts.existingNames) : new Set(state.roster);
    const persist = typeof opts.persist === 'function' ? opts.persist : defaultPersist;
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
        <div id="urmError"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    const errorBox = overlayEl.querySelector('#urmError');
    const saveBtn = overlayEl.querySelector('#urmSave');
    overlayEl.addEventListener('click', (ev)=>{ if(ev.target === overlayEl) close(); });
    overlayEl.querySelector('#urmCancel').addEventListener('click', close);
    saveBtn.addEventListener('click', async ()=>{
      errorBox.innerHTML = '';
      const lines = overlayEl.querySelector('#urmInput').value.split("\n").map(s=>s.trim()).filter(Boolean);
      if(!lines.length){ alert('名前を入力してください。'); return; }
      const uniqNew = [...new Set(lines)].filter(n=>!existing.has(n));
      if(!uniqNew.length){ alert('入力された名前は、すでにすべて登録済みです。'); return; }
      saveBtn.disabled = true; saveBtn.textContent = '登録中...';
      try{
        await persist(uniqNew);
        close();
        if(typeof opts.onRegistered === 'function') opts.onRegistered(uniqNew);
      }catch(e){
        errorBox.innerHTML = `<div class="urm-error">${AtsuCup.escapeHtml((e && e.message) || String(e))}</div>`;
        saveBtn.disabled = false; saveBtn.textContent = '登録する';
      }
    });
    document.addEventListener('keydown', onKeydown);
    overlayEl.querySelector('#urmInput').focus();
  }

  return { open, close };
})();
