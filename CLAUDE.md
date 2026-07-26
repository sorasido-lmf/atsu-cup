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
| `tournaments/entries/matches.json` | 大会詳細の「💾 GitHubに保存」ボタンで**明示的に**のみ | `AtsuCup.saveTournamentToData(id)` → `GasDB.saveTournament()` |

### 反映タイミングの一覧（2026-07-26 整理・重要）

「アプリでの編集」から「スプレッドシート/GitHubへの反映」までの間隔はデータ種別によって全く違う。**この非対称性を前提にサポート・デバッグすること。**

| データ | 編集操作 | 反映タイミング | 実装箇所 |
|---|---|---|---|
| ユーザーの登録・撮影可否デフォルト・アーカイブ/復元 | `users.html`での各操作 | **操作の都度、即時** | `users.html`の各ハンドラ末尾で`syncToGitHub()` |
| ユーザーの新規登録（大会エントリー画面経由） | `tournament-entry.html`の「新規ユーザー登録」 | **登録の都度、即時** | `tournament-entry.html`の`onRegistered`コールバック |
| 大会限定の撮影可否上書き（`person.rec`） | `tournament-entry.html`の📹/🚫トグル | **反映されるのは大会保存時のみ**（`entries.json`の`recAtEntry`列）。**ここ単体でのGitHub反映は無い** | `tournament-entry.html`、`fromAppTournament`の`recAtEntry`算出 |
| 参加者の選出・組み合わせ・勝敗入力・ラウンド進行など、大会に関するすべての変更 | 大会詳細画面での各種操作 | **反映されない。「💾 GitHubに保存」ボタンを押した時のみ** | `detail-view.js`の`saveTournamentToGitHub()` |
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

**マージ規則**: `mergeRemoteTournaments()` は id ごとに data/ 側を優先して上書きし、data/ に無いローカル大会は保持する。
オブジェクトごと差し替えず `Object.assign` で中身を更新すること（`video.html` が `t.matches` のライブ参照に書き込むため）。

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
| `hall.html` / `record.html` / `record-detail.html` / `results.html` / `video.html` | 戦績・優勝者・動画 |
| `settings.html` | Googleログイン・接続確認 |
| `atsucup-core.js` | 共通のstate管理・データロジック・`data/`の読み書き（全ページ共有） |
| `atsucup-data.js` | `data/*.json`(IDキー) ↔ アプリ内部(名前キー) の構造変換層 |
| `google-auth.js` / `gas-db.js` / `gas-config.js` | GAS連携（Googleログイン・API呼び出し・設定値） |
| `gas/Code.gs` / `gas/README.md` | GASバックエンド本体とセットアップ手順 |
| `user-register-modal.js` / `walkin-modal.js` | 共通モーダル |

---

## 未対応・今後の課題（TODO）

- **書き込み(GitHubへの反映)には認証があるが、UI上の操作自体には制限が無い**。`users.html` のアーカイブ/復元・撮影可否編集・新規登録の**ボタン自体は誰でも押せる**（未ログインなら「この端末にのみ保存しました」という案内が出るだけで、操作は止まらない）。「アーカイブ済みを表示」トグルの閲覧制限も未実装。**これは意図的な未対応であり、バグとして扱わないこと。** ユーザーからの明示的な依頼があった際に着手する
- GASの `role` は現状 `admin` の1種類のみ運用。`editor`（大会のみ可・ユーザーマスタ不可）等の細分化は未着手
- スプレッドシートの手編集からアプリへの双方向同期は無い（シートは閲覧・緊急修正用。手編集後は `gas/Code.gs` の関数でGitHubへ反映が必要。`gas/README.md` 参照）

---

## 運用ルール

- **`git push` はユーザーの明示的な許可を得てから行う。** ローカルコミットは各機能の完成ごとに行ってよい
- 検証にテストデータを使った場合、ターンの終わりに必ず `localStorage` から削除すること（実データのみを残す）
- **コードに影響する変更をpushする際は、必ず `version.json` の `build` と `atsucup-core.js` の `BUILD_DATE` を同じ値（日付+時刻、JST）に更新すること。** これを怠ると更新バナーが出ず、ユーザーの端末に古いJSがキャッシュされたまま残り、削除済みのモジュールを参照してエラーになる（2026-07-26に実際に発生: `github-db.js`削除後、2日以上バージョンを更新し忘れ、キャッシュされた古い`atsucup-core.js`が存在しない`GitHubDB`を参照してエラーを出した）
