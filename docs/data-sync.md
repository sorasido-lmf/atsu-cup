# データ同期と保存

> 共通ルール（禁止事項・必須手順）は [`../AGENTS.md`](../AGENTS.md) が正本です。
> この文書は「なぜそうなっているのか・どう実装されているか」を説明します。

🔴 **このアプリで最もデータ消失に直結する領域**。localStorage・静的JSON・GAS・
スプレッドシート・GitHub の間でどう同期しているか、マージと競合をどう解決しているか。

運用手順（シートの手編集の反映・取り込み）は [`operations.md`](operations.md)、
過去にここで起きた事故は [`incident-notes.md`](incident-notes.md) を参照。

---

## 「正本」は層によって違う

⚠️ **「正本」という語がこの資料と `README.md` の両方に出てくるが、指しているものが違う。** 全体は3層で、
それぞれ向きが決まっている。

```
Google スプレッドシート  ──GASが書き出す──▶  GitHub (data/*.json)  ──git pull──▶  ローカル作業ディレクトリ
   （データの発生源＝正本）                   （配信元。開発環境から見た正本）        （読むだけ。書き戻さない）
```

| 比較する2つ | どちらが正か | 反映の向き |
|---|---|---|
| スプレッドシート ↔ GitHub | **スプレッドシート**（`README.md` の「データの正本」はこれ） | シート → GitHub の一方向。逆向きは `importFromGitHub()` を手で実行した時だけ |
| GitHub ↔ 開発者のローカル作業ディレクトリ | **GitHub**（下の「基本原則」はこれ） | GitHub → ローカルの一方向 |

つまり **開発作業ディレクトリとの比較では GitHub が正**、**データの発生源としてはスプレッドシートが正**。
矛盾ではなく、見ている層が違う。

## 基本原則: GitHubが正、ローカルはそのクローン

（↑の表の2行目の話。開発環境から見た向き）

```
GitHub (data/*.json)  ──git→ローカル: やる──▶  ローカル作業ディレクトリ
                      ◀─ローカル→git: やらない──
```

- `data/` 配下（`SCHEMA.md` + `users.json` / `tournaments.json` / `entries.json` / `matches.json`）は**参照用マスタデータの正本**であり、**必ずGitHub上に存在させる**
- **git→ローカル方向は行う**: GitHubの内容をローカルへ取り込んで参照する
- **ローカル→git方向は行わない**: ローカルでの大会/ユーザーの追加テスト結果は、GitHubに反映する必要がない

## スキーマ

`data/SCHEMA.md` を参照（users / tournaments / entries / matches の4テーブル定義）。要点:

- キーは名前ではなく **ID**（改名の影響を受けないため）
- ポイントは保存せず、`placement`/`wins` から都度算出する
- `matches.json` が一次データ、`entries.json` は大会単位の要約（計算軽量化のためのキャッシュ）
- ユーザーの削除は物理削除ではなく **アーカイブ方式**（`archived: true`）。過去の対戦記録・戦績を保持するため

---

## アプリとの接続（2026-07-26 実装、同日中にGAS方式へ移行）

`data/*.json` はアプリが実際に読み書きする本番データである。

**読み込み（認証不要）**
- `atsucup-core.js` の `loadFromData()` が **同一オリジンの静的ファイル**（`fetch('data/users.json')` 等）を読む
- GAS/GitHub APIを読み込みに使わない理由: GASは実行クォータがあり毎回コールドスタートで遅い。GitHub APIも未認証だと60リクエスト/時の制限がある。静的ファイルなら両方とも回避できる
- 各ページは `render()`（localStorageで即描画）→ `AtsuCup.ready.then(()=> render())`（data/取り込み後に描き直し）の2段構え。**全ページを async 化しない**ための設計
- 取り込みに失敗しても reject せず `{ok:false}` で解決する。オフラインでも localStorage の内容で動き続ける

**書き込み（Googleログイン必須・GAS経由）**
| 対象 | トリガー | 実装 |
|---|---|---|
| `users.json` | ユーザー管理/大会エントリーでの登録・撮影可否変更・アーカイブ時に**即時** | `AtsuCup.saveUsersToData()` → `GasDB.saveUsers()` |
| `tournaments.json`（大会情報のみ。entries/matchesは**一切触れない**） | 大会の**作成時**・大会詳細の「編集する」保存時に**即時** | `tournament-create.html`/`detail-view.js`の`renderEditForm()` → `AtsuCup.saveTournamentMetaToData(id)` → `GasDB.updateTournamentMeta()` → GASの`actionUpdateTournamentMeta_` |
| `tournaments/entries/matches.json`（参加者・対戦結果を含む完全な保存＝既存entries/matches行を丸ごと置き換え） | 大会詳細の「💾 GitHubに保存」ボタン、および大会エントリー画面から退出する時（変更があった場合のみ）に反映 | `AtsuCup.saveTournamentToData(id)` → `GasDB.saveTournament()` → GASの`actionSaveTournament_` |
| ポスター画像（`posters/<id>.jpg`） | 大会の作成・情報編集・「💾 GitHubに保存」のいずれかで、ローカルにdata URL（未アップロード）のポスターがある場合 | `atsucup-data.js`の`fromAppTournament()`が`posterImageUpload`として分離送信 → `gas/Code.gs`の`actionSaveTournament_()`が`pushBinaryToGitHub_()`でファイルとしてアップロードし、そのURLを`tournamentRow.posterImage`に書き込む（2026-07-27変更。以前はdata URLをスプレッドシートのセルへ直接保存しており、1セル50,000文字の上限を超えると大会行ごと空欄化する不具合があった） |

## 反映タイミングの一覧（2026-07-26 整理・重要）

「アプリでの編集」から「スプレッドシート/GitHubへの反映」までの間隔はデータ種別によって全く違う。**この非対称性を前提にサポート・デバッグすること。**

| データ | 編集操作 | 反映タイミング | 実装箇所 |
|---|---|---|---|
| ユーザーの登録・撮影可否デフォルト・アーカイブ/復元 | `users.html`での各操作 | **操作の都度、即時** | `users.html`の各ハンドラ末尾で`syncToGitHub()` |
| ユーザーの新規登録（大会エントリー画面経由） | `tournament-entry.html`の「新規ユーザー登録」 | **登録の都度、即時** | `tournament-entry.html`の`onRegistered`コールバック |
| 大会限定の撮影可否上書き（`person.rec`） | `tournament-entry.html`の📹/🚫トグル | **反映されるのは大会保存時のみ**（`entries.json`の`recAtEntry`列）。**ここ単体でのGitHub反映は無い** | `tournament-entry.html`、`fromAppTournament`の`recAtEntry`算出 |
| 大会の作成・タイトル/詳細/開催日/公式大会・制限杯フラグ/ポスター画像の編集 | `tournament-create.html`での作成、大会詳細の「編集する」→「更新する」 | **操作の都度、即時**。entries/matchesには一切触れない専用の保存経路(下記コラム参照)。失敗してもローカルの保存は維持し、インライン警告のみ表示 | `tournament-create.html`、`detail-view.js`の`renderEditForm()` → `AtsuCup.saveTournamentMetaToData()` |
| 参加者の選出・組み合わせ・勝敗入力・ラウンド進行など、大会の進行に関する変更 | 大会詳細画面での各種操作 | **反映されない。「💾 GitHubに保存」ボタンを押した時のみ** | `detail-view.js`の`saveTournamentToGitHub()` |
| 大会エントリー画面での参加者の選出・撮影可否変更 | `tournament-entry.html`での各種操作 | **反映されない。画面から退出(「‹ 戻る」「大会詳細に戻る」)する時に変更があれば自動保存**（2026-07-27追加。以前はエントリー画面だけでは一切サーバーへ反映されず、対戦表ページで別途保存ボタンを押す必要があった） | `tournament-entry.html`の`syncAndGo()` → `AtsuCup.saveTournamentToData()`(フル保存) |
| モンスターマスタ(`monsters`シート) | 人がシートを直接編集(アプリからは一切書き込めない) | **反映されない。GASエディタで`previewMonstersToGitHub()`で確認 → `pushMonstersToGitHub()`を手動実行するまでGitHubへは伝わらない**。大会用の`pushSheetChangesToGitHub()`とは経路が別(あちらの差分検出は大会id単位で`updatedAt`を打つ前提のため流用できない) | `gas/Code.gs`の`pushMonstersToGitHub()` |
| エントリー時のモンスター(`entries.monsterId`) | エントリー画面・途中参加・大会詳細「参加者とモンスター」での選択 | **エントリー画面からの変更は退出時に自動保存**(他のエントリー内容と同じ)。**大会詳細からの変更は「💾 進行状況を保存」を押した時のみ** | `tournament-entry.html`、`detail-view.js`の`renderMonsterPanel()` |
| スプレッドシートの手編集 | 人がシートを直接編集 | **反映されない。`gas/Code.gs`の`previewSheetChangesToGitHub()`で確認 → `pushSheetChangesToGitHub()`をGASエディタから手動実行するまでGitHubへは伝わらない**(後者が`updatedAt`も自動で打つ。下記参照) | `gas/README.md` |
| GitHub上の`data/*.json` → 開発者のローカル | 上記いずれかでGitHubが更新された後 | **反映されない。`git update-index --no-skip-worktree`→`git checkout data`→`--skip-worktree`の手動取り込みが必要** | 前節「データ管理方針」 |

大会データが「保存ボタンを押すまで一切外に出ない」設計は意図的（対戦表は入力の都度変化するため、自動保存だとコミットが乱発・競合する）。ユーザーには「保存ボタンを押し忘れると反映されない」ことを案内すること。

**⚠️ メタ保存とフル保存を分離した理由(2026-07-27発覚・修正、重大)**: 大会の作成/情報編集時の「即時反映」機能を最初に実装した際、実際には`AtsuCup.saveTournamentToData()`(entries/matches込みの**フル**保存)をそのまま呼んでいた。これにより、ある端末でタイトルを編集しただけで、**他端末が既に保存していた対戦結果がその端末の(空または古い)entries/matchesで上書きされて消える**という実害のあるバグが起きていた。修正として、GASに`actionUpdateTournamentMeta_`(tournamentsシートの該当行のみ読み書きし、entries/matchesシートには一切触れない)を新設し、`AtsuCup.saveTournamentMetaToData()`という別関数から呼ぶようにした。**大会情報の編集・作成時は必ず`saveTournamentMetaToData()`を使い、entries/matchesを反映したい場合(進行状況保存・エントリー画面退出時)のみ`saveTournamentToData()`(フル)を使うこと。取り違えると同じバグが再発する。**

**⚠️ ローカルキャッシュが「空のまま」固まる問題への対処(2026-07-27追加、2026-07-27深夜にスナップショット比較方式へ更に発展)**: 上記のバグにより、既に他端末で「空のentries/matches」を持つ大会をキャッシュしてしまった端末は、当時の「ローカルに同idがあれば触らない」方針により、後から他端末で本物の進行状況が保存されても永久にそれを取り込めなかった。現在は下記「マージ規則」のスナップショット比較方式がこれを含む同種の問題全般(他端末の保存が反映されない、スプレッドシート作り直し後も古いまま等)を解決している。詳細は下の「マージ規則」を参照。

## 保存前の大会結果の所在とリスク（2026-07-26 整理）

保存前の大会結果は**この端末のブラウザの`localStorage`にのみ存在する**（サーバー側にも他端末にもコピーは無い）。以下の状況で、保存前のデータは失われる:

- 別の端末・別のブラウザで開く（localStorageは端末＋ブラウザごとに独立）
- ブラウザの閲覧データ削除をユーザーが実行
- **iOS SafariのITP（Intelligent Tracking Prevention）による自動削除**: 7日間そのサイトを開かないとlocalStorageが自動で消えることがある。保存せず1週間放置すると発生しうる、地味に一番怖いケース
- シークレット/プライベートモードでタブ・ウィンドウを閉じる
- 端末の初期化・機種変更、アプリ/ブラウザの再インストール
- `localStorage`の容量超過（`persist()`にポスター画像を諦めるフォールバックはあるが、それでも失敗した場合は`alert()`が出るのみで、それ以上の保護は無い）

---

## 保存は完全上書き方式・履歴は残さない（2026-07-26 正式決定）

`gas/Code.gs`の`actionSaveTournament_`は、保存のたびに**その大会の`entries`/`matches`行を全部削除してから、現在の状態で書き直す**（追記ではなく完全上書き）:

```js
var entries = readSheet_('entries').filter(r => r.tournamentId !== tid);  // 既存を全部除外
writeSheet_('entries', entries.concat(entryRows));                          // 今の状態で置き換え
```

このため、**勝敗の巻き戻し（`resetMatchResult`）や2回戦以降の組み合わせ再抽選（`advanceRound`の再実行）を行った後に保存すると、巻き戻し・再抽選前の古い結果の履歴は残らず消える。** `audit`シートには「いつ・誰が・どの大会を保存したか」のみ記録され、**中身の差分（何がどう変わったか）は記録されない。**

**これは意図的な設計決定であり、バグではない**（2026-07-26、ユーザーとの合意）:
- 履歴は残さない。保存＝その時点の状態を正としたスナップショット上書きでよい（現時点で履歴の必要性が無いため）
- 自動保存化もしない。「💾 GitHubに保存」ボタンによる手動保存のみを維持する（自動保存にすると、巻き戻し・再抽選のたびにGAS実行・GitHubコミットが増えるため）

**将来この方針を見直す場合**: 履歴を残したくなったら、「保存のたびに`matches`/`entries`を追記型にしてバージョン列を持たせる」「保存前に差分スナップショットを別シートへ退避する」等の設計変更が必要になる。今は未実装、このメモを参照点とする。

## 🔴 マージ規則（2026-07-28 現行・3分類マージ）

上記のスナップショット比較方式は、**そもそも比較が常に不一致になっており機能していなかった**。原因は2つ:

1. ローカルには`everSyncedToServer`が付くのに、スナップショットには付かない状態で`JSON.stringify`同士を比較していた(`everSyncedToServer`を足した時の見落とし)
2. **1を直しても足りない。** アプリ内部の大会オブジェクトと`toAppTournaments()`の出力は、内容が同じでも構造が一致しない:
   - `state.remaining`はローカルでは`resetDownstream()`が参加者名で埋めるが、`toAppTournaments`は**常に空配列**
   - `matches`の深さが、ローカルは`advanceRound`で組んだラウンド分だけなのに対し、`buildMatchGrid`は**常に全ラウンド分**を生成する
   - 2回戦以降のカードに、ローカル(`advanceRound`製)は**`bye`キーを持たない**

このため「一度でもこの端末でエントリー→対戦表を組んだ大会」は永久に「未保存の編集あり」と誤判定され、**他端末の保存が一切反映されなかった**。

**現行方式**: 比較を「オブジェクトの構造」ではなく**「保存したらサーバーに書かれる行(row)の内容」**で行う。`AtsuCupData.syncSignatureOf(t)`が`fromAppTournament()`の出力(tournamentRow + entryRows + matchRows)を`stableStringify`(キー順非依存)したものを署名として返す。**「保存してもサーバーの内容が変わらない ⇔ 署名が一致する」**という定義になるので、ローカル専用フィールドが将来増えても壊れない(`fromAppTournament`が見ないものは署名に入らない)。

`state.remoteMeta[id] = {sig, updatedAt}`(旧`remoteSnapshots`を置換。**sigとupdatedAtを1本にまとめてあるのは、大会を消すときに片方だけ消し忘れる事故を防ぐため**)に「この端末が最後に把握しているサーバーの状態」を持ち、差異を3つに分類する:

| 状態 | 判定 | 動作 |
|---|---|---|
| この端末だけ変更 | ローカル署名≠基準値、サーバーは基準値のまま | **何もしない**(次の保存で反映される) |
| 他の端末だけ変更 | ローカル署名=基準値、サーバーが新しい | **自動で取り込む**(モーダル無し) |
| 両方変更＝競合 | 両方とも基準値と違う | **競合モーダル**で選択させる(`showSyncConflictModal`) |

**`updatedAt`列(2026-07-28にtournamentsシートへ追加)**: サーバー(GAS)が書き込みのたびに`stampUpdatedAt_()`で打つ。「サーバー側が変わったか」を内容比較ではなく**時刻の大小(`isRemoteNewer`)**で判定するために使う。⚠️**単なる不一致ではなく大小比較にするのが要点**: GAS保存→GitHubコミット→Pages反映には数十秒〜数分の遅延があり、保存直後のリロードでは「自分が保存する前の古い行」が返ってくる。不一致で判定すると、この古い行を「サーバーが変わった」と誤検出して自分の保存内容を巻き戻してしまう。`updatedAt`が空の旧行(列追加前に保存された大会)は内容比較にフォールバックする。

**保存成功時に基準値を更新するのが最重要の1手**: `saveTournamentToData`はGASが返した`updatedAt`と保存内容の署名で`remoteMeta`を更新する。これにより、Pages反映が間に合わない間に読み込んでも「サーバーは新しくない」と正しく判定される。⚠️ **`saveTournamentMetaToData`(メタのみ保存)では`sig`を更新してはいけない**。entries/matchesを送っていないのに「反映済み」と誤認すると、この端末の未保存の対戦表進行が次の自動取り込みで黙って消える。`updatedAt`だけ進める。

**UI**: `showSyncChoiceModal()`(core、全ページ共通。`.match-pick-modal`のCSSは`tournament-detail.html`内のインライン定義で他ページでは使えないため、`showGuestWipeBanner`と同じくJSからstyleを注入する)を競合モーダルと保存前警告で共用。競合時は「サーバーの内容を取り込む」/「この端末の内容を使う」の2択で、**どちらを選んでも`remoteMeta`をサーバー現在値へ更新する**(しないと毎回同じ競合を聞かれ続ける)。取り込みを選んだ場合は`location.reload()`で描き直す(coreに購読機構が無いため、`showGuestWipeBanner`と同じ流儀)。

**保存前チェック**: `confirmOverwriteIfRemoteNewer(id)`を`detail-view.js`の「💾 進行状況を保存」で保存前に呼ぶ。⚠️**「それでも上書き保存する」を必ず選べるようにすること**。保存ボタンを押した時点では必ずローカルに未保存の変更があるので、ここで操作不能になると大会の進行そのものが止まる。

**残るリスク(設計上の割り切り)**: ①2台がほぼ同時に保存した場合は検知できず後勝ちになる(保存前チェックはPagesを見るため、直前の他端末の保存は見逃す)。根治するにはGAS側で`baseUpdatedAt`を受け取って食い違えばエラーを返す楽観ロックが要る(将来の拡張点)。②GitHub Pages の CDN キャッシュは制御できないため「GASがcommit済み=全端末が即読める」ではない。③`updatedAt`を人がシートで手編集すると判定が壊れる(`gas/README.md`に警告済み)。

## 🔴 対戦カードは全て書き出す(2026-07-28) — 省略の最適化で3度不具合を踏んだ

`fromAppTournament()`は以前「両者未定・勝者なしの完全な空枠は書き出さない(読み込み時にBLANK_CARDで復元される)」という最適化をしていた。**これが3つの不具合の原因だったため、省略ロジックそのものを撤廃し、全ラウンドの全カードを無条件に書き出すようにした。**

読み込み側(`buildMatchGrid`)は、行が無い枠を「**1回戦の末尾から`byeCount`個がシード**」という規則で補っていた。この推測が成り立たないケースが3つあった:

1. **末尾以外の位置にある空シードが消える** — `convertCardToSeed(m, null)`が作る`{a:null,b:null,winner:null,bye:true}`は行が出ず、末尾規則の範囲外なら通常枠として復元される。実データで確認: 参加者18人=32枠の大会で`matchIndex 1`だけが欠番になり、他端末でシードが解除されていた
2. **逆に、末尾側の空の通常枠が勝手にシード化する** — `mergeSeedsIntoMatch()`(シード同士をD&Dで対戦にする)が`bye:false`の空枠を末尾に作るため、実際に到達する
3. **2回戦以降の`aSrc`/`bSrc`が失われる** — `advanceRound`が作るカードは必ず`aSrc`/`bSrc`を持つが、`BLANK_CARD`は持たない。`{a:null,b:null,aSrc:9,bSrc:6}`のような「両者未定だが対応関係は確定している」カードを省略すると、`data/SCHEMA.md`記載のとおり**後から前ラウンドをやり直した時に勝者が誤った枠へ入る**(導出で代替できない情報)

枠数は最大でも参加者数程度(32人大会で31行)で、`writeSheet_`は毎回この大会の行を全置換するためゴミも溜まらない。**省略の最適化より往復のロスレス性を優先する。** これにより末尾規則は「旧データ専用の後方互換フォールバック」に降格し、新規保存分には二度と適用されない。

## 🔴 `SIG_VERSION`: 署名の算出方法を変えたら必ず上げること(2026-07-28導入)

同期の差分判定に使う署名(`AtsuCupData.syncSignatureOf`)は`fromAppTournament()`の出力から作るため、**書き出し規則を変えると署名も変わる**。旧版で計算された基準値(`state.remoteMeta[id].sig`)をそのまま残すと、ローカルもサーバーも基準値と食い違い「両方変更された」と誤判定され、**全端末で競合モーダルが誤爆する**。

対策として署名文字列の先頭にバージョン印を埋めている(`'v2|' + stableStringify(...)`)。別キーで版数を持つのではなく署名自体に埋めるのは、**版数と算出アルゴリズムが乖離しないようにするため**。`migrate()`が`AtsuCupData.isCurrentSigVersion(sig)`で判定し、印が合わない基準値だけを捨てて張り直す。

⚠️ **`fromAppTournament`の書き出し規則(どの枠を行にするか)を変更したら、必ず`atsucup-data.js`の`SIG_VERSION`を上げること。** 上げ忘れが誤爆の再発リスクの本体。なお「`updatedAt`があるから時刻比較で守られる」とは**言えない** — 列追加前に保存された行は`updatedAt`が空で、内容比較経路に落ちるため。実際に導入時点の本番データは全大会が`updatedAt`空だった。

**v3(2026-08-08)**: `entryRows`に`monsterId`(エントリー時に使ったモンスター)を追加したため上げた。

**モンスターマスタ(`data/monsters.json`)は署名にも競合判定にも一切関与しない。** 読み取り専用の共有マスタで、
`loadFromData()`のたびに`state.monsters`を丸ごと差し替えるだけ(マージも基準値も無い)。
⚠️ ただし取得は他の4本と**同列に置かない**こと。`fetchJson`は404で例外を投げるので、
`Promise.all`に混ぜると`monsters.json`がまだ無い環境で**大会・ユーザーの同期まで丸ごと止まる**。
個別に`.catch(()=>null)`で受け、取れなかった時はローカルの前回値を使う(空にはしない)。

基準値を捨てた直後は`mergeRemoteTournaments`の「基準値なし」フォールバックを1回通る。この分岐は`conflicts.push`に到達しないので**競合モーダルは構造上発火せず**、ローカルに進行状況があれば保護される。ただし**その1回だけ、他端末の未取り込みの変更がスキップされる**(全端末でリロードし、最新を持つ端末で1回保存し直せば揃う)。

---

## 大会の削除 = アーカイブ方式（2026-07-27 導入）

大会詳細の「🗑️ この大会を削除」は、**プールによって挙動が異なる**:

- **ローカル(ゲスト)大会**: 完全削除。`state.history = state.history.filter(...)` + `persist()`のみ、サーバー通信なし(元々の挙動のまま)
- **DB(認証)大会**: `AtsuCup.archiveTournamentInData(id)` → GASの`archiveTournament`アクション → `tournaments`シートの該当行に`archived=true`を立てるだけで、**行の物理削除は行わない**。`entries`/`matches`もそのまま残す(復元可能性を残すため)。以前は削除がローカルのみに閉じており、DBには一切反映されないバグがあった(2026-07-27発覚・修正)

アーカイブ済みの大会は`atsucup-data.js`の`toAppTournaments()`で**そもそもローカルstateに取り込まれない**ため、大会一覧・歴代優勝者・戦績など`state.tournaments`を参照する箇所すべてから自動的に除外される(個別に除外ロジックを足す必要が無い)。

`actionSaveTournament_`(通常の進行状況保存)は`archived`列を常に既存行から引き継ぐ(クライアントは送ってこないため、素朴に置き換えるとアーカイブ済み大会が保存のたびに復元されてしまう)。

**⚠️ ローカル優先マージだけでは不十分だった点(2026-07-27発覚・修正)**: `mergeRemoteTournaments()`は「ローカルに既に同じidがあれば触らない」方式のため、**既にこの端末にキャッシュ済みの大会を他で(または同じ端末の別タイミングで)アーカイブしても、そのキャッシュは merge の対象外になり、いつまでも一覧に残り続けてしまう**バグがあった。`loadFromData()`で、フェッチした生の`tournaments`データから`archived===true`のidを集め、`state.tournaments`からそのidを**問答無用で除去する**処理を追加して解消した。これは「未保存の進行状況を守る」ローカル優先原則とは別軸の話(アーカイブは明示的な削除操作であり、巻き戻すべき進行状況が存在しない)。

**ログイン時だけのサーバー整合(2026-07-27追加)**: 上記のアーカイブ除去は「サーバー側でarchived=trueになった」ケースしか救えない。GASのシート/GitHub側から**行ごと削除**された大会(ゴミデータの一括削除など)は、`data/tournaments.json`に存在自体しなくなるため、当時の通常マージでは検知できず、この端末にキャッシュされたままいつまでも残り続けていた(2026-07-27発覚)。

これに対応するため、`reconcileAuthPoolWithServer()`を追加し、**Googleログインした瞬間(`GoogleAuth.onStateChange`が`signedIn:true`で発火した時)にだけ**、`state.tournaments`のうち`data/tournaments.json`に存在しないidを問答無用で削除するようにした(ユーザーロースターについても同様、下記参照)。削除が発生した場合は非ブロッキングのトースト通知(`showAuthResyncNotice()`)で件数を知らせる(ゲストプールの確認バナーと違い「元に戻す」選択肢は無い簡易版)。

**⚠️ 2026-07-27深夜追記**: 大会については、上記のログイン限定の仕組みに加えて`pruneTournamentsGoneFromServer()`(前述「マージ規則」参照)が**通常のページ読み込み(`loadFromData()`)でも**、以前に一度でも取り込んだことがある大会に限定して同様の削除を行うようになった。そのためログインを待たずとも、次にどれかのページを開いた時点で反映される。**ユーザーロースターの行削除検知は引き続きログイン時限定のまま**(未同期の新規登録ユーザーを通常利用中に誤って消さないための安全策、下記参照)。

**`reconcileAuthPoolWithServer()`はユーザー(ロースター)にも同じ考え方を適用する(2026-07-27追加)**: `mergeRemoteUsers()`もロースター名を追加するだけで、`data/users.json`から行ごと削除された(archived=trueではなく物理削除された)名前は永久に`state.roster`/`state.archivedUsers`に残り続けてしまう(users.htmlの「アーカイブ済み」一覧にゴミが溜まる原因)。同じ関数内で`data/users.json`も取得し、リモートに存在しない名前を`state.roster`/`state.userRecDefaults`/`state.archivedUsers`から除去する。**安全弁として、取得結果(大会・ユーザーどちらも)が空の場合は何も削除しない**(取得失敗や空データでの誤爆を防ぐ)。過去の大会の`t.people`は名前を独立した文字列として持つだけでロースターへの生きた参照ではないため、ロースターから名前を消しても過去の大会記録には一切影響しない。

**ゲストプールのクリア(`enforceGuestSeparation`/`clearGuestPool`)とは別物**であることに注意: あちらは未ログイン時に作ったローカルデータを消す(常に発生、非ブロッキング確認バナー付き)。こちらはDB(認証)大会・ユーザーのうちサーバーから消えたものだけを消す(該当が無ければ何も起きない)。両方とも同じ`GoogleAuth.onStateChange`フックから呼ばれるが、対象プールも発火条件も異なる。
