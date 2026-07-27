# あつ杯（atsu-cup）開発方針

LINE モンスターファーム のトーナメント運営ツール。静的HTML/CSS/JS（ビルドなし・フレームワークなし）。

---

## 🔴 最重要: データ設計と管理方法

このアプリの開発において**最も重要な方針**。`data/` の扱いを変更する前に、必ずこの節を読み直すこと。

### 基本原則: GitHubが正、ローカルはそのクローン

```
GitHub (data/*.json)  ──git→ローカル: やる──▶  ローカル作業ディレクトリ
                      ◀─ローカル→git: やらない──
```

- `data/` 配下（`SCHEMA.md` + `users.json` / `tournaments.json` / `entries.json` / `matches.json`）は**参照用マスタデータの正本**であり、**必ずGitHub上に存在させる**
- **git→ローカル方向は行う**: GitHubの内容をローカルへ取り込んで参照する
- **ローカル→git方向は行わない**: ローカルでの大会/ユーザーの追加テスト結果は、GitHubに反映する必要がない

### 実現方法: skip-worktree（gitignoreではない）

上記の非対称性は `git update-index --skip-worktree` で実現している。設定済み（2026-07-26）。

```bash
# 設定状況の確認（先頭が S なら skip-worktree 有効）
git ls-files -v data

# GitHub側の更新をローカルへ取り込む（一時解除 → 取得 → 再設定）
git update-index --no-skip-worktree data/*.json data/SCHEMA.md
git checkout data
git update-index --skip-worktree data/*.json data/SCHEMA.md
```

### ❌ やってはいけないこと

- **`.gitignore` で `data/` を除外しないこと。** gitignoreするとGitHub上からファイル自体が消えるため、「GitHubに残す」という要件を満たせない。過去に2回この誤りを犯し、GitHub上の `data/` を消してしまった（2026-07-25, 07-26）
- 「ローカルの変更をpushしたくない」＝「gitignore」と短絡しないこと。**GitHub上にファイルを残す要件がある場合は skip-worktree が正解**
- `data/` 配下のファイルを `git add -f` などで強制的にステージしないこと

### スキーマ

`data/SCHEMA.md` を参照（users / tournaments / entries / matches の4テーブル定義）。要点:

- キーは名前ではなく **ID**（改名の影響を受けないため）
- ポイントは保存せず、`placement`/`wins` から都度算出する
- `matches.json` が一次データ、`entries.json` は大会単位の要約（計算軽量化のためのキャッシュ）
- ユーザーの削除は物理削除ではなく **アーカイブ方式**（`archived: true`）。過去の対戦記録・戦績を保持するため

### アプリとの接続（2026-07-26 実装、同日中にGAS方式へ移行）

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
| `tournaments.json`（大会情報のみ。entries/matchesは含まない） | 大会の**作成時**・大会詳細の「編集する」保存時に**即時**（2026-07-27追加。以前は参加者エントリー前の大会が他端末から見えないバグがあった） | `tournament-create.html`/`detail-view.js`の`renderEditForm()` → `AtsuCup.saveTournamentToData(id)` |
| `tournaments/entries/matches.json`（参加者・対戦結果を含む完全な保存） | 大会詳細の「💾 GitHubに保存」ボタンで**明示的に**のみ | `AtsuCup.saveTournamentToData(id)` → `GasDB.saveTournament()` |
| ポスター画像（`posters/<id>.jpg`） | 大会の作成・情報編集・「💾 GitHubに保存」のいずれかで、ローカルにdata URL（未アップロード）のポスターがある場合 | `atsucup-data.js`の`fromAppTournament()`が`posterImageUpload`として分離送信 → `gas/Code.gs`の`actionSaveTournament_()`が`pushBinaryToGitHub_()`でファイルとしてアップロードし、そのURLを`tournamentRow.posterImage`に書き込む（2026-07-27変更。以前はdata URLをスプレッドシートのセルへ直接保存しており、1セル50,000文字の上限を超えると大会行ごと空欄化する不具合があった） |

### 反映タイミングの一覧（2026-07-26 整理・重要）

「アプリでの編集」から「スプレッドシート/GitHubへの反映」までの間隔はデータ種別によって全く違う。**この非対称性を前提にサポート・デバッグすること。**

| データ | 編集操作 | 反映タイミング | 実装箇所 |
|---|---|---|---|
| ユーザーの登録・撮影可否デフォルト・アーカイブ/復元 | `users.html`での各操作 | **操作の都度、即時** | `users.html`の各ハンドラ末尾で`syncToGitHub()` |
| ユーザーの新規登録（大会エントリー画面経由） | `tournament-entry.html`の「新規ユーザー登録」 | **登録の都度、即時** | `tournament-entry.html`の`onRegistered`コールバック |
| 大会限定の撮影可否上書き（`person.rec`） | `tournament-entry.html`の📹/🚫トグル | **反映されるのは大会保存時のみ**（`entries.json`の`recAtEntry`列）。**ここ単体でのGitHub反映は無い** | `tournament-entry.html`、`fromAppTournament`の`recAtEntry`算出 |
| 大会の作成・タイトル/詳細/開催日/公式大会・制限杯フラグ/ポスター画像の編集 | `tournament-create.html`での作成、大会詳細の「編集する」→「更新する」 | **操作の都度、即時**（2026-07-27追加）。失敗してもローカルの保存は維持し、インライン警告のみ表示 | `tournament-create.html`、`detail-view.js`の`renderEditForm()` |
| 参加者の選出・組み合わせ・勝敗入力・ラウンド進行など、大会の進行に関する変更 | 大会詳細画面での各種操作 | **反映されない。「💾 GitHubに保存」ボタンを押した時のみ** | `detail-view.js`の`saveTournamentToGitHub()` |
| スプレッドシートの手編集 | 人がシートを直接編集 | **反映されない。`gas/Code.gs`の`pushSheetChangesToGitHub()`をGASエディタから手動実行するまでGitHubへは伝わらない** | `gas/README.md` |
| GitHub上の`data/*.json` → 開発者のローカル | 上記いずれかでGitHubが更新された後 | **反映されない。`git update-index --no-skip-worktree`→`git checkout data`→`--skip-worktree`の手動取り込みが必要** | 前節「データ管理方針」 |

大会データが「保存ボタンを押すまで一切外に出ない」設計は意図的（対戦表は入力の都度変化するため、自動保存だとコミットが乱発・競合する）。ユーザーには「保存ボタンを押し忘れると反映されない」ことを案内すること。

### 保存前の大会結果の所在とリスク（2026-07-26 整理）

保存前の大会結果は**この端末のブラウザの`localStorage`にのみ存在する**（サーバー側にも他端末にもコピーは無い）。以下の状況で、保存前のデータは失われる:

- 別の端末・別のブラウザで開く（localStorageは端末＋ブラウザごとに独立）
- ブラウザの閲覧データ削除をユーザーが実行
- **iOS SafariのITP（Intelligent Tracking Prevention）による自動削除**: 7日間そのサイトを開かないとlocalStorageが自動で消えることがある。保存せず1週間放置すると発生しうる、地味に一番怖いケース
- シークレット/プライベートモードでタブ・ウィンドウを閉じる
- 端末の初期化・機種変更、アプリ/ブラウザの再インストール
- `localStorage`の容量超過（`persist()`にポスター画像を諦めるフォールバックはあるが、それでも失敗した場合は`alert()`が出るのみで、それ以上の保護は無い）

### 保存は完全上書き方式・履歴は残さない（2026-07-26 正式決定）

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

**マージ規則（2026-07-26 変更・ローカル優先）**: `mergeRemoteTournaments()` は、**ローカルに既に同じidの大会があれば一切上書きしない**。data/ にしか無い大会（ローカルにまだ無いid）だけを追加する。

以前は「idごとにdata/側を優先して上書き」だったが、これだと**保存ボタンを押すまでの進行状況が、ページを開くたびに直前の保存内容へ引き戻される**という実害が出た（2026-07-26発覚：大会エントリーで参加者を変更しても大会詳細に戻ると消えている、リセットしても再読み込みで元に戻る、等）。ローカル優先にした結果、他端末での保存内容は「ローカルにまだ無い大会」としてしか自動反映されなくなる（同じ大会を他端末の最新保存内容で更新したい場合は、ローカル側の該当大会を一旦削除する等の手動操作が必要）。この非対称はトレードオフとして許容している。

### 大会の削除 = アーカイブ方式（2026-07-27 導入）

大会詳細の「🗑️ この大会を削除」は、**プールによって挙動が異なる**:

- **ローカル(ゲスト)大会**: 完全削除。`state.history = state.history.filter(...)` + `persist()`のみ、サーバー通信なし(元々の挙動のまま)
- **DB(認証)大会**: `AtsuCup.archiveTournamentInData(id)` → GASの`archiveTournament`アクション → `tournaments`シートの該当行に`archived=true`を立てるだけで、**行の物理削除は行わない**。`entries`/`matches`もそのまま残す(復元可能性を残すため)。以前は削除がローカルのみに閉じており、DBには一切反映されないバグがあった(2026-07-27発覚・修正)

アーカイブ済みの大会は`atsucup-data.js`の`toAppTournaments()`で**そもそもローカルstateに取り込まれない**ため、大会一覧・歴代優勝者・戦績など`state.tournaments`を参照する箇所すべてから自動的に除外される(個別に除外ロジックを足す必要が無い)。

`actionSaveTournament_`(通常の進行状況保存)は`archived`列を常に既存行から引き継ぐ(クライアントは送ってこないため、素朴に置き換えるとアーカイブ済み大会が保存のたびに復元されてしまう)。

**⚠️ ローカル優先マージだけでは不十分だった点(2026-07-27発覚・修正)**: `mergeRemoteTournaments()`は「ローカルに既に同じidがあれば触らない」方式のため、**既にこの端末にキャッシュ済みの大会を他で(または同じ端末の別タイミングで)アーカイブしても、そのキャッシュは merge の対象外になり、いつまでも一覧に残り続けてしまう**バグがあった。`loadFromData()`で、フェッチした生の`tournaments`データから`archived===true`のidを集め、`state.tournaments`からそのidを**問答無用で除去する**処理を追加して解消した。これは「未保存の進行状況を守る」ローカル優先原則とは別軸の話(アーカイブは明示的な削除操作であり、巻き戻すべき進行状況が存在しない)。

### 「公式大会」「制限杯」フラグ（2026-07-27 導入）

`tournaments`に`isOfficial`/`isRestricted`の2つの真偽値フラグを追加した。大会作成・編集フォームのトグルボタンでオン/オフでき、通常の進行状況保存のたびにサーバーへ反映される。**集計ロジック(戦績・歴代優勝者)への組み込みは未実装**(将来の対応、現時点は保存・表示のみ)。表示は大会一覧・TOPの開催中大会・大会詳細のバッジで、**公式大会→制限杯→進行中/完了→ローカルの順**に固定。

### 開催日の編集（2026-07-27 導入）

大会の「開催日」は、以前はアプリに編集UIが無く、大会作成時刻がそのまま`heldAt`(DB)/`createdAt`(アプリ内部)に入っていた。作成/編集フォームに日付入力を追加し、実際に指定・変更できるようにした。新しいDB列は追加していない(既存の`heldAt`列をそのまま使う)。大会一覧の並び順もこの値(新しい順)を基準にする。

### 現状（2026-07-26時点）

| 項目 | 状態 |
|---|---|
| `data/users.json` | 実データあり |
| `data/tournaments.json` / `entries.json` / `matches.json` | 実データあり(進行中の大会含む) |
| スプレッドシート | 正本として稼働中。GASが読み書きしGitHubへ書き出す |

なお `data/SCHEMA.md` は**データではなく設計ドキュメント**のため skip-worktree を外して通常追跡している。
実データの4つのJSONのみ skip-worktree 対象。

---

## データ管理バックエンド: スプレッドシート + GAS（2026-07-26 導入）

### 経緯

当初はブラウザから直接GitHub Contents APIをPATで叩く方式だったが、以下の理由でスプレッドシート＋GASへ移行した。

1. **オンボーディングの重さ** — スタッフ全員にGitHubアカウントとPAT発行を要求するのは非現実的
2. **権限の粒度が粗い** — PATはリポジトリ全体への書き込み権限で、各端末に平文で置かれる

### アーキテクチャ

```
[ブラウザ]
  ├ 読み込み: GitHub Pagesの静的 data/*.json(認証不要・即時)
  └ 書き込み: Googleログイン → IDトークン → GAS doPost
       GAS側: IDトークン検証(aud/exp/email_verified) → adminsシート照合 → シート更新 → GitHubへpush
```

**シートが正本、GitHubはその書き出し先という一方向。** ローカル→GitHubの自動反映は無い。

### ⚠️ 唯一の防御線

GASのWebアプリは「実行するユーザー: 自分」でデプロイしているため、**呼び出した人が誰であろうとオーナー権限でシートを触れる**。スプレッドシートの共有設定は一切効かない。

防御しているのは `gas/Code.gs` の **`verifyIdToken_()`**（Googleの署名付きIDトークンを検証し`aud`まで確認）と **`assertAdmin_()`**（`admins`シートとの照合）の2つだけ。この2つを外すと、GAS URLを知っている全員が書き込める状態になる。

**実際に攻撃を模した検証を実施済み**（2026-07-26）: トークン無し・でたらめな文字列・`aud`を正しく詐称した署名無効JWT、いずれも `FORBIDDEN` で拒否されることを確認済み。

### 主要ファイル

| ファイル | 役割 |
|---|---|
| `gas/Code.gs` | GAS本体。シート↔JSON変換・`doGet`(検証用)・`doPost`(唯一の書き込み口) |
| `gas/README.md` | セットアップ手順・関数リファレンス・**GitHub→シート取り込みの手順(重要)** |
| `google-auth.js` | Google Identity Servicesのラッパー。トークン取得のみ、**検証は必ずGAS側** |
| `gas-db.js` | GAS呼び出し。`text/plain`でCORS preflightを回避。GASは常に200を返すため本文の`ok`で成否判定 |
| `gas-config.js` | `GAS_URL` / `OAUTH_CLIENT_ID`。公開前提の値でリポジトリにコミットしてよい |
| `gas-test.html` | Phase2検証用ページ。未認証・改ざんトークンでの拒否を実際に試せる |

**GitHub PATはGASのScript Properties(サーバ側)にのみ存在し、クライアントからは一切到達できない。**

### 🔴 データの向きと、必ず踏む手順（重要）

「シートが正本」で動くため、**GitHub側にだけ存在するデータがある状態で書き込むと、シートの内容(空 or 古い)で上書きされて消える。**

以下のタイミングでは、書き込み前に必ず `gas/Code.gs` の **`importFromGitHub()`** を実行すること（`compareWithGitHub()` で事前に差分確認できる）。

- スプレッドシートへの移行時
- 誰かがGitHub上で `data/*.json` を直接編集した後
- 他の経路(旧PAT方式など)でGitHub側だけが更新された後

`exportTables_()` には「シートが空なのにGitHubにデータがある場合は中断する」安全装置があるが、これは完全空のケースしか検知できないため過信しないこと。

### ID ↔ 名前の境界（重要）

- **`data/*.json` は SCHEMA.md 完全準拠の ID キー**（`userId` 等）
- **アプリ内部（`state.people` / `matches` など）は名前キーのまま**
- 変換は2箇所で行われる:
  - `atsucup-data.js`（`AtsuCupData`）: アプリ内部 ⇄ 行データの構造変換（ネスト⇄フラット、round番号のずれ等）
  - `gas/Code.gs`: 名前 → ID の解決（`ensureUsers_`）。未登録の参加者名への**ID採番はサーバ側で行う**（複数端末からの同時保存で衝突しないように）
- 送信時は `fromAppTournament(t, identityMap)` に「名前→名前」の恒等写像を渡すことで、`userId`/`player*Id` 欄に実IDの代わりに名前を乗せて送り、GAS側で名前→実IDへ解決させている（`atsucup-core.js` の `saveTournamentToData` 参照）
- アプリ内部を ID キーに移行する案は、全消費者（`computePlacements`・`detail-view.js` 全体など）の書き換えが必要な大工事のため**見送っている**。この境界を勝手に動かさないこと

変換で失われやすい情報に注意:
- `aSrc`/`bSrc`（撮影不可回避の入れ替え後の対応関係）は `player1SrcIndex`/`player2SrcIndex` として保存する。**これが無いと勝敗のやり直しで勝者が誤った枠に入る**
- `loser` は列を持たず、読み込み時に `winnerId` から再計算する

---

## アプリの実行時データ

- 大会進行中の作業データは `localStorage`（キー: `atsucup:state:v2`）に保持し、確定した内容を `data/*.json` へ書き出す
- `pagehide` / `visibilitychange` で強制保存する保険あり（`atsucup-core.js`）
- `state.tournaments` 配列 + `state.activeId` で複数大会の同時進行に対応。`state.people`/`matches` 等は `Object.defineProperty` のgetter/setterでアクティブな大会へ透過的にプロキシされる

---

## ゲスト/認証済みの二重プール分離（2026-07-27 導入）

**過去のデータをだれでも削除できることを避けつつ、ふらっと使いたい人にも使ってもらえるようにする**ため、ロースター/大会データを完全に2つの入れ物に分離している（「同じ配列にタグを付けて区別する」方式ではなく、最初から別のキーに分ける方式を採用。名前重複の曖昧さや集計側のフィルタ漏れが原理的に起きないため）。

### state形状

```
state = {
  // 認証プール: data/*.json(スプレッドシート)由来 + GASへ保存する対象
  roster, userRecDefaults, archivedUsers, tournaments,
  // ゲストプール: 未ログイン時の練習用。この端末だけ。サーバーへは絶対に出さない
  guestRoster, guestUserRecDefaults, guestArchivedUsers, guestTournaments,
  // 共通のアクティブ大会ポインタ(どちらのプールの大会かを activePool が示す)
  activeId, activePool // 'auth' | 'guest'
}
```

### 不変条件

**ログイン中はゲストプールが空でなければならない。** `GoogleAuth`のログイン状態変化(`onStateChange`、core側で自動購読)と`restore()`実行時の両方で`enforceGuestSeparation()`が呼ばれ、ログイン中にゲストプールが非空なら非ダイスミス(Esc・オーバーレイクリック不可)の確認バナーを出す。「削除してログインする」で`clearGuestPool()`、「ログインをやめる」で自動`GoogleAuth.signOut()`(どちらもタップ後`location.reload()`)。

これは、2026-07-26に直した「`mergeRemoteTournaments()`はローカルの進行状況を黙って失わせない」原則の**唯一の、ユーザーが明示的にタップした場合だけの例外**。認証プールには一切触れない。

### アクセス方法(`pool()`アクセサ)

各ページは `const P = AtsuCup.pool();` を **render/handler関数の内側で毎回呼ぶ**(トップレベルでキャッシュしない)。ログイン中は認証プール、未ログインはゲストプールを指す`{roster, userRecDefaults, archivedUsers, tournaments}`の生きた参照が返る。`AtsuCup.isGuestMode()`/`AtsuCup.authPool()`/`AtsuCup.guestPool()`/`AtsuCup.poolKindOfTournamentId(id)`も利用可能。

`activeT()`/`setActive()`/`state.people`/`state.matches`等の既存のgetter/setterプロキシは無変更のまま、`state.activePool`経由で両プールに対応済み。**集計関数(`computeAllTimeStats`/`allFinishedEntries`/`championEntries`)は無変更** — 認証プール(`state.roster`/`state.tournaments`)のみを読むため、ゲストデータは原理的に混ざらない。

### プールを跨いだ閲覧のガード(2026-07-27 修正: 方向によって扱いが異なる)

- **ログイン中に練習用(ゲスト)大会をURL直指定で開こうとした場合**: `detail-view.js`の`isCrossPool()`が検知し「この大会は表示できません」でブロックしてトップへ誘導する。ログインでゲストプールは削除される前提のため、通常はそもそもそのURLが存在しなくなる(実害の少ない安全網)。
- **非ログイン中にDB(認証プール)大会を開こうとした場合**: **ブロックしない。** 「過去の大会のログは閲覧のみ可」という要件があるため、`isReadOnlyView()`が真になり、**編集UIを一切出さない読み取り専用**で大会詳細(進行中・過去とも)を閲覧できる。具体的には: 編集する/終了する/削除ボタン、組み合わせ決定(自動抽選・エントリー導線)、対戦表の枠タップ・D&D・⚔️勝敗入力・シード➕・進行ボタン・3位決定戦の勝敗入力/名前編集、保存ボタンを全て非表示にする。`tournament-entry.html`も同じ判定(`isBlocked()`)で直接アクセスをブロックし、編集の抜け道を塞ぐ。非破壊的な操作(📸画像保存・優勝カード作成・次の対戦へジャンプ)はreadOnly中も利用可能なまま残す。
- 結果として、**非ログイン状態で編集できるのは「ローカル」タグの付いた練習用大会のみ**になる。DB大会は認証済み(ログイン)状態でのみ編集可能。

### 「ローカル」タグ

大会一覧(`tournaments.html`)・TOPの開催中の大会(`index.html`)・大会詳細(`detail-view.js`)のいずれも、練習用(ゲストプール)の大会には「進行中」等のステータスバッジの隣に「ローカル」タグを表示し、DB大会と区別できるようにしている。`tournaments.html`は現在、認証プールとゲストプールの大会を1本のリストに統合し、このタグだけで見分ける方式(以前の「別セクション表示」から変更)。

### 既存データとの関係

`STORE_KEY`(`atsucup:state:v2`)はバージョンを上げていない。この機能導入前から存在した`state.roster`/`state.tournaments`は、そのまま認証プールとして扱われる。

---

## 実装上の注意

### ネイティブダイアログを使わない

**`window.confirm()` / `window.alert()` に処理の成否を依存させないこと。**

テスト環境（Claude Browserペイン）や一部のスマホ内蔵ブラウザ（WebView）ではネイティブダイアログが抑制され、`confirm()` が常に `false` を返しうる。「ボタンを押しても何も起きない」というバグの原因になった。

破壊的操作の確認は**自前のインラインUI**で実装すること（例: `users.html` のアーカイブ確認行、`detail-view.js` の `.advance-warn` バナー）。

### 撮影可否（rec）の制約

参加者には「撮影可（📹）/ 撮影不可（🚫）」の属性がある。**撮影不可同士の対戦をできる限り避ける**ペアリングロジックが実装されており（`pairWithConstraint`、枠タップ時の `candidatesFor`、`advanceRound` の入れ替え）、これは仕様上非常に重要。組み合わせ関連を変更する際は、この回避ロジックが壊れていないか必ず検証すること。

---

## 画面構成

| ファイル | 役割 |
|---|---|
| `index.html` | トップ。開催中の大会 + メニュー |
| `tournaments.html` | 大会一覧（進行中を先頭に表示） |
| `tournament-create.html` | 大会作成専用 |
| `tournament-detail.html` + `detail-view.js` | 大会詳細。進行中/終了済みを `?id=` で出し分け。組み合わせ決定・対戦表・勝敗入力を統合 |
| `tournament-entry.html` | 大会ごとの参加者選出 |
| `users.html` | ユーザーマスタ管理（新規登録・撮影可否・アーカイブ/復元） |
| `hall.html` / `record.html` / `record-detail.html` / `results.html` | 戦績・優勝者(認証プールのみ集計。無変更) |
| `settings.html` | Googleログイン・接続確認 |
| `atsucup-core.js` | 共通のstate管理・データロジック・`data/`の読み書き（全ページ共有） |
| `atsucup-data.js` | `data/*.json`(IDキー) ↔ アプリ内部(名前キー) の構造変換層 |
| `google-auth.js` / `gas-db.js` / `gas-config.js` | GAS連携（Googleログイン・API呼び出し・設定値） |
| `gas/Code.gs` / `gas/README.md` | GASバックエンド本体とセットアップ手順 |
| `user-register-modal.js` / `walkin-modal.js` | 共通モーダル |

---

## 未対応・今後の課題（TODO）

- GASの `role` は現状 `admin` の1種類のみ運用。`editor`（大会のみ可・ユーザーマスタ不可）等の細分化は未着手
- スプレッドシートの手編集からアプリへの双方向同期は無い（シートは閲覧・緊急修正用。手編集後は `gas/Code.gs` の関数でGitHubへ反映が必要。`gas/README.md` 参照）

---

## 運用ルール

- **`git push` はユーザーの明示的な許可を得てから行う。** ローカルコミットは各機能の完成ごとに行ってよい
- 検証にテストデータを使った場合、ターンの終わりに必ず `localStorage` から削除すること（実データのみを残す）
- **`.html`/`.js`(GAS除く)を1文字でも変更してpushする際は、`git commit`する前に必ず `version.json` の `build` と `atsucup-core.js` の `BUILD_DATE` を同じ値（日付+時刻、JST）に更新すること。** これはコミット内容を精査して「今回はコードに影響するか」を判断するのではなく、**該当ファイルが差分に含まれているかどうかだけで機械的に判定する**（判断に迷う余地を無くすため）。忘れると更新バナーが出ず、ユーザーの端末に古いJSがキャッシュされたまま残る。
  - 2026-07-26 1回目: `github-db.js`削除後、2日以上バージョンを更新し忘れ、キャッシュされた古い`atsucup-core.js`が存在しない`GitHubDB`を参照してエラーを出した
  - 2026-07-26 2回目: 上記インシデントを踏まえてこのルールを明文化した**直後の次のpushで、当のルールの実行自体を忘れた**（`mergeRemoteTournaments`/`buildMatchGrid`のバグ修正をpushしたのにバージョンを据え置き、ユーザーから「直っていない」と再度報告が来て発覚）。ルールの存在を知っていることと、pushの瞬間に実行することは別。**pushコマンドを打つ直前に、変更ファイル一覧を見てこのルールに該当するかを毎回機械的にチェックする**
- **更新通知バナーは「検知したら自動で1回だけリロードする」自己修復方式（2026-07-27〜）。** GitHub Pagesの`atsucup-core.js`等は`cache-control: max-age=600`のため、バージョンを上げてpushしても、初回訪問者や10分以内の再訪問者は古いJSのままバナーにも気づかず使い続けてしまうリスクがあった。`initUpdateBanner`の`checkVersion()`は、バージョン不一致を検知した際にバナー表示に加えて`sessionStorage`のフラグを見て**タブのセッション内で1回だけ**`location.reload()`する。無限リロードにならないのは、リロード後に取得される新しいJSの`BUILD_DATE`が`version.json`と一致し、以降`checkVersion()`が不一致を検知しなくなるため。この仕組み自体、古いキャッシュ済みJSにはまだ入っていないため即座には効かないが、そのJSが一度でも再取得されれば以降の取りこぼしを自動で吸収するようになる
