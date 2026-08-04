(function(){
  "use strict";

  const IMAGES = Array.from({length:9}, (_,i)=>
    `assets/guide-assistant/assistant-${String(i+1).padStart(2,'0')}.png`
  );

  const LINES = {
    "index.html":[
      "「開催中の大会」には、進行中の大会が表示されます。大会名をタップすると、対戦表や進行状況を確認できますよ！",
      "「大会一覧」では、進行中の大会や終了した大会をまとめて確認できます。",
      "「戦績」では、参加者のみなさんのポイントや勝率、過去の活躍を見られますよ！",
      "「ユーザー管理」では、参加者の登録や、撮影ができるかどうかの設定ができます。",
      "「設定」では、Googleアカウントへのログインや、保存先との接続確認ができますよ。"
    ],
    "tournaments.html":[
      "「大会一覧」には、進行中の大会と終了した大会がまとめて表示されます。",
      "大会名の近くにある「公式大会」「制限杯」「ローカル」のタグで、大会の種類を見分けられますよ。",
      "大会のカードには、ポスターや進行状況、優勝者が表示されます！",
      "大会のカードをタップすると、順位や対戦結果を確認できますよ。"
    ],
    "tournament-create.html":[
      "「大会名」と「詳細・ルール」に、大会名や参加者へ伝えたい内容を入力してくださいね。",
      "「開催日」と「告知ポスター画像」では、開催する日やポスター画像を設定できます。",
      "ログイン中は、「公式大会」と「制限杯」のボタンで大会の種類も設定できますよ！",
      "入力が終わったら、「この内容で作成する」を押しましょう。作成後は参加者の選択へ進めます！"
    ],
    "tournament-entry.html":[
      "「登録済みユーザーから追加」で名前をタップすると、大会の参加者に追加できますよ。",
      "「今回参加する人」にある「外す」を押すと、選択した参加者を大会から外せます。",
      "参加者名の横にある「📹」「🚫」を押すと、大会ごとに撮影ができるかどうかを変更できます。",
      "登録されていない参加者は、「新規ユーザー登録」から登録して大会へ追加できますよ！"
    ],
    "tournament-detail.html":[
      "参加者がそろったら、組み合わせを決めましょう。自動抽選と手動調整の両方が使えますよ！",
      "対戦表の選手やシード枠は、タップやドラッグで調整できます。大会に合う並びに整えてくださいね。",
      "対戦が終わったら、「⚔️」を押して勝者を記録しましょう。不戦勝として勝ち上がる選手も選べます。",
      "「進行状況を保存」で対戦結果を保存できます。全対戦の終了後は「大会を終了する」を押してくださいね！"
    ],
    "results.html":[
      "「上位入賞」では、優勝から4位までの結果を確認できます。みなさん、お疲れさまでした！",
      "「その他の順位」では、上位入賞者以外の到達ラウンドを確認できますよ。",
      "「優勝カードを作る」を押すと、優勝者を記念した画像を作成して保存できます！",
      "「対戦表を見る」を押すと、大会の対戦表を振り返れますよ。"
    ],
    "record.html":[
      "「戦績ランキング」では、公式大会で獲得したポイントや通算成績を確認できます！",
      "「並び順」では、Pt順・勝率順・優勝率順・4強率順・名前順に切り替えられますよ。",
      "「対象の大会」「最低出場回数」「期間」を設定すると、表示する戦績を絞り込めます。",
      "ランキングの名前をタップすると、選んだ参加者の詳しい戦績を確認できますよ！"
    ],
    "record-detail.html":[
      "「通算成績」では、{ユーザー名}さんの通算ポイントや出場回数、勝敗、入賞回数を確認できます。",
      "「大会別の記録」では、{ユーザー名}さんが参加した大会ごとの順位や獲得ポイントを振り返れますよ。",
      "大会名をタップすると、{ユーザー名}さんの対戦相手と勝敗をラウンド順に確認できます！",
      "「対象の大会」と「期間」を設定すると、{ユーザー名}さんの表示する戦績を絞り込めますよ。"
    ],
    "users.html":[
      "「新規ユーザー登録」を押すと、大会に参加する方を新しく登録できますよ。",
      "ユーザー名の横にある「📹」「🚫」を押すと、撮影ができるかどうかの基本設定を変更できます。",
      "ユーザー名の左にある「☰」をドラッグすると、一覧の並び順を変更できます。よく参加する方を上に並べると見つけやすいですよ！"
    ],
    "settings.html":[
      "Googleアカウントでログインすると、大会・参加者・対戦結果を共有データへ保存できます。複数の端末で情報を共有しながら大会を運営できますよ！"
    ]
  };

  const pageName = location.pathname.split('/').pop() || "index.html";
  const pageLines = LINES[pageName];
  if(!pageLines) return;

  const userName = new URLSearchParams(location.search).get('name') || "選択中のユーザー";
  const lines = pageLines.map(line=>line.replaceAll("{ユーザー名}",userName));
  let currentLine = -1;
  let currentImage = -1;

  function randomIndex(length){
    return Math.floor(Math.random()*length);
  }

  function randomIndexExcluding(length,excludedIndex){
    if(length<=1) return 0;
    if(excludedIndex<0 || excludedIndex>=length) return randomIndex(length);
    const candidate = randomIndex(length-1);
    return candidate>=excludedIndex ? candidate+1 : candidate;
  }

  function nextSelection(){
    return {
      lineIndex:randomIndexExcluding(lines.length,currentLine),
      imageIndex:randomIndexExcluding(IMAGES.length,currentImage)
    };
  }

  function init(){
    document.body.classList.add("guide-assistant-enabled");
    document.body.classList.add("guide-assistant-compact");
    const backLink = document.querySelector(".back-link");
    if(backLink){
      document.body.classList.add("guide-assistant-compact-with-back");
    }

    const root = document.createElement("aside");
    root.className = "guide-assistant";
    root.setAttribute("aria-label","ページ案内");

    const control = document.createElement("button");
    control.type = "button";
    control.className = "guide-assistant__control";
    control.setAttribute("aria-label","案内のせりふと助手の表情を切り替える");

    const bubble = document.createElement("span");
    bubble.className = "guide-assistant__bubble";
    bubble.setAttribute("role","status");
    bubble.setAttribute("aria-live","polite");

    const visual = document.createElement("span");
    visual.className = "guide-assistant__visual";
    visual.setAttribute("aria-hidden","true");

    const image = document.createElement("img");
    image.className = "guide-assistant__image";
    image.alt = "";
    image.width = 1024;
    image.height = 1536;
    image.decoding = "async";
    image.draggable = false;

    visual.appendChild(image);
    control.append(bubble,visual);
    root.appendChild(control);
    document.body.appendChild(root);

    function syncCompactLayout(){
      if(!window.matchMedia("(max-width:600px)").matches) return;
      if(backLink){
        const backRight = backLink.getBoundingClientRect().right;
        document.body.style.setProperty("--guide-assistant-left",Math.ceil(backRight+1)+"px");
      }
      const bottom = root.getBoundingClientRect().bottom;
      document.body.style.setProperty("--guide-assistant-clearance",Math.ceil(bottom+12)+"px");
    }

    function renderNext(){
      const next = nextSelection();
      currentLine = next.lineIndex;
      currentImage = next.imageIndex;
      bubble.textContent = lines[currentLine];
      image.src = IMAGES[currentImage];
      root.classList.remove("is-changing");
      void root.offsetWidth;
      root.classList.add("is-changing");
      window.setTimeout(()=>root.classList.remove("is-changing"),240);
      window.requestAnimationFrame(syncCompactLayout);
    }

    control.addEventListener("click",renderNext);
    control.addEventListener("keydown",event=>{
      if(event.key!=="Enter" && event.key!==" " && event.key!=="Spacebar") return;
      event.preventDefault();
      renderNext();
    });
    window.addEventListener("resize",syncCompactLayout,{passive:true});
    renderNext();

    window.GuideAssistant = Object.freeze({
      refresh:renderNext,
      images:Object.freeze(IMAGES.slice()),
      lines:Object.freeze(lines.slice())
    });
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",init,{once:true});
  }else{
    init();
  }
})();
