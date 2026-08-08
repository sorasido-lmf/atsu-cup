// モンスター集計の描画ヘルパ。record.html(全体) / record-detail.html(個人) /
// tournament-detail.html(単一大会) の3画面で共有する。
//
// 🔴 この描画をページごとにコピーしないこと。数え方は AtsuCup.aggregateMonsterStats_ に
//    1本化してあるが、見せ方(率の分母・端数処理・不明モンスターの出し方)まで揃っていないと
//    「同じ数字なのに画面ごとに違う%が出る」という一番タチの悪い状態になる。
//
// ⚠️ 率の分母は常に「モンスターが記録されているぶんだけ」。未記録は集計に入らない
//    (AtsuCup 側の仕様。docs/records-users.md)。呼び出し側は必ず
//    「記録済み N / M」を別途併記して、母数が何なのかを画面に出すこと。
const MonsterStatsView = (function(){
  "use strict";

  const esc = s => AtsuCup.escapeHtml(s);

  // 分母0は率が定義できない。0%にすると「まだ記録が無い」が「0%だった」と同じ見え方になる
  const rateOf = (num, den) => den > 0 ? num / den : null;
  const pct = r => r === null ? '—' : (r*100).toFixed(1).replace(/\.0$/,'') + '%';

  // 横バー。数値の代わりではなく補助なので、必ず数値と併記して使う
  function barHtml(rate){
    if(rate === null) return '';
    const w = Math.max(0, Math.min(100, rate*100));
    return `<div class="usage-bar" aria-hidden="true"><i style="width:${w.toFixed(1)}%;"></i></div>`;
  }

  // マスタから消えた(または旧データの)idも落とさず出す。名前が引けないのでidを見せる
  const labelOf = s => s.known ? (s.name || s.id) : `不明なモンスター(${s.id})`;
  const metaOf  = s => [s.aura, s.kind, s.mainBlood, s.subBlood].filter(Boolean).join(' / ');

  // 集計結果に実際に現れた値だけを、使用数の多い順で返す。
  // 主血統のように固定リスト(MONSTER_AURAS/MONSTER_KINDS)が無く候補が多い軸で使う
  function valuesPresent(stats, key){
    const sum = {};
    stats.forEach(s=>{ const v = s[key]; if(v) sum[v] = (sum[v]||0) + s.used; });
    return Object.keys(sum).sort((a,b)=> sum[b]-sum[a] || a.localeCompare(b,'ja'));
  }

  // 一覧の1行。opts.total を渡したときだけ使用率とバーを足す
  //   opts.total … 率の分母(記録済みの件数)
  //   opts.unit  … 使用回数の単位。全体/個人は '回'、単一大会は '人'
  function rowHtml(s, rank, opts){
    const total = opts && opts.total;
    const unit  = (opts && opts.unit) || '回';
    const wr = rateOf(s.wins, s.games);
    const use = total ? rateOf(s.used, total) : null;
    const useLine = total
      ? `<div class="rr-sub">使用率 ${pct(use)}</div>${barHtml(use)}`
      : '';
    return `<div class="rank-row mon-row">
      <div class="rank">${rank}</div>
      <div class="rr-main">
        <div class="rr-name">${esc(labelOf(s))}</div>
        <div class="rr-sub">${esc(metaOf(s) || '—')}</div>
        <div class="rr-sub">🥇${s.p1} 🥈${s.p2} 🥉${s.p3} 4位${s.p4} ・ 勝率${pct(wr)}(${s.wins}/${s.games})</div>
        ${useLine}
      </div>
      <div class="rr-points">${s.used}<span class="u">${esc(unit)}</span></div>
    </div>`;
  }

  // オーラ色別・モン類別・主血統別の内訳。同じ集計結果から足し上げるだけなので、
  // 一覧とロールアップで数字が食い違うことが原理的に起きない
  //   values … 出す軸の値の配列。固定リストを渡せば0件のセルも出る
  function rollupHtml(stats, key, values, title, opts){
    const total = opts && opts.total;
    const unit  = (opts && opts.unit) || '回';
    const sum = {};
    values.forEach(v=>{ sum[v] = { used:0, wins:0, games:0, p1:0 }; });
    let other = { used:0, wins:0, games:0, p1:0 };
    stats.forEach(s=>{
      const bucket = sum[s[key]] || other;
      bucket.used += s.used; bucket.wins += s.wins; bucket.games += s.games; bucket.p1 += s.p1;
    });
    const cell = (name, b)=>{
      const use = total ? rateOf(b.used, total) : null;
      return `<div class="roll-cell">
        <span class="k">${esc(name)}</span>
        <span class="v">${b.used}<span style="font-size:10px;">${esc(unit)}</span></span>
        ${total ? `<span class="s">使用率${pct(use)}</span>${barHtml(use)}` : ''}
        <span class="s">勝率${pct(rateOf(b.wins, b.games))} ・ 👑${b.p1}</span>
      </div>`;
    };
    const cells = values.map(v=> cell(v, sum[v])).join('');
    const otherCell = other.used ? cell('その他', other) : '';
    return `<div class="roll-label">${esc(title)}</div><div class="roll-grid">${cells}${otherCell}</div>`;
  }

  return { rateOf, pct, barHtml, labelOf, metaOf, valuesPresent, rowHtml, rollupHtml };
})();
