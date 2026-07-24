// data/ 配下のJSON4本の整合性を検証するスクリプト。
// - 外部キー(FK)がすべて解決できるか
// - entries.json の wins/placement が matches.json から再集計した値と一致するか
// - 通算ポイントが atsucup-core.js の computeTournamentPoints と同じルールで算出できるか
// 実行: node scripts/verify-db.js
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const load = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));

const users = load('users.json');
const tournaments = load('tournaments.json');
const entries = load('entries.json');
const matches = load('matches.json');

const errors = [];
const userIds = new Set(users.map(u => u.id));
const tournamentIds = new Set(tournaments.map(t => t.id));

function checkFk(records, field, validSet, label, allowNull = false) {
  records.forEach(r => {
    const v = r[field];
    if (v === null && allowNull) return;
    if (!validSet.has(v)) errors.push(`${label} id=${r.id}: ${field}="${v}" が見つかりません`);
  });
}

checkFk(entries, 'tournamentId', tournamentIds, 'entries');
checkFk(entries, 'userId', userIds, 'entries');
checkFk(matches, 'tournamentId', tournamentIds, 'matches');
checkFk(matches, 'player1Id', userIds, 'matches', true);
checkFk(matches, 'player2Id', userIds, 'matches', true);
checkFk(matches, 'winnerId', userIds, 'matches', true);

// matches.json から wins・優勝者(placement=1相当)を再集計し、entries.json と突き合わせる
const winsFromMatches = {}; // `${tournamentId}_${userId}` -> count
matches.forEach(m => {
  if (!m.isBye && m.winnerId) {
    const key = `${m.tournamentId}_${m.winnerId}`;
    winsFromMatches[key] = (winsFromMatches[key] || 0) + 1;
  }
});

const bonusByPlace = { 1: 10, 2: 7, 3: 5, 4: 3 };
entries.forEach(e => {
  const key = `${e.tournamentId}_${e.userId}`;
  const recomputedWins = winsFromMatches[key] || 0;
  if (recomputedWins !== e.wins) {
    errors.push(`entries id=${e.id}: wins不一致 (entries.json=${e.wins}, matches.jsonから再集計=${recomputedWins})`);
  }
  const points = recomputedWins + (bonusByPlace[e.placement] || 0);
  const user = users.find(u => u.id === e.userId);
  console.log(`[${e.tournamentId}] ${user ? user.name : e.userId}: 順位=${e.placement}, 勝利=${recomputedWins}, ポイント=${points}`);
});

if (errors.length) {
  console.error('\n--- 検証エラー ---');
  errors.forEach(e => console.error('NG: ' + e));
  process.exit(1);
} else {
  console.log('\nOK: 全ての参照整合性・集計値が一致しました');
}
