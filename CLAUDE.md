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

### アプリとの接続（2026-07-26 実装）

`data/*.json` はアプリが実際に読み書きする本番データである。

**読み込み（トークン不要）**
- `atsucup-core.js` の `loadFromData()` が **同一オリジンの静的ファイル**（`fetch('data/users.json')` 等）を読む
- GitHub API を読み込みに使わない理由: **未認証APIは60リクエスト/時**の制限があり、1ページで4ファイル取得するとすぐ枯渇するため
- 各ページは `render()`（localStorageで即描画）→ `AtsuCup.ready.then(()=> render())`（data/取り込み後に描き直し）の2段構え。**全ページを async 化しない**ための設計
- 取り込みに失敗しても reject せず `{ok:false}` で解決する。オフラインでも localStorage の内容で動き続ける

**書き込み（トークン必須・GitHub Contents API）**
| 対象 | トリガー | 実装 |
|---|---|---|
| `users.json` | ユーザー管理/大会エントリーでの登録・撮影可否変更・アーカイブ時に**即時** | `AtsuCup.saveUsersToData()` |
| `tournaments/entries/matches.json` | 大会詳細の「💾 GitHubに保存」ボタンで**明示的に**のみ | `AtsuCup.saveTournamentToData(id)` |

大会を自動保存しないのは、対戦表が勝敗入力のたびに変化しコミットが乱発・競合するため。

**マージ規則**: `mergeRemoteTournaments()` は id ごとに data/ 側を優先して上書きし、data/ に無いローカル大会は保持する。
オブジェクトごと差し替えず `Object.assign` で中身を更新すること（`video.html` が `t.matches` のライブ参照に書き込むため）。

### 現状（2026-07-26時点）

| 項目 | 状態 |
|---|---|
| `data/users.json` | 実データあり（8人 + テスト由来のA〜G） |
| `data/tournaments.json` / `entries.json` / `matches.json` | 空の `[]`。アプリの「💾 GitHubに保存」で最初の大会が入る |

なお `data/SCHEMA.md` は**データではなく設計ドキュメント**のため skip-worktree を外して通常追跡している。
実データの4つのJSONのみ skip-worktree 対象。

---

## GitHub連携について

**書き込み専用で有効**（2026-07-25に一度全削除→2026-07-26にユーザーの決定で再導入）。

- `github-db.js`: Contents API ラッパー。`getFile` は読み取り（トークン任意）、`putFile` は書き込み（トークン必須）
- `settings.html`: PAT の登録・接続確認・削除。トークンは `localStorage` の `atsucup:githubPat` に平文保存（静的サイト構成に伴う既知のトレードオフ）
- 読み込みは API ではなく静的ファイル取得を使う（レート制限のため。前節参照）

### ID ↔ 名前の境界（重要）

- **`data/*.json` は SCHEMA.md 完全準拠の ID キー**（`userId` 等）
- **アプリ内部（`state.people` / `matches` など）は名前キーのまま**
- 両者の変換は `atsucup-data.js`（`AtsuCupData`）が一手に引き受ける。`toAppTournaments()` / `fromAppTournament()`
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
| `settings.html` | GitHub PAT の設定 |
| `atsucup-core.js` | 共通のstate管理・データロジック・`data/`の読み書き（全ページ共有） |
| `atsucup-data.js` | `data/*.json`(IDキー) ↔ アプリ内部(名前キー) の変換層 |
| `github-db.js` | GitHub Contents API ラッパー |
| `user-register-modal.js` / `walkin-modal.js` | 共通モーダル |

---

## 未対応・今後の課題（TODO）

- **管理者権限のみの表示制御が未実装**。`users.html` のアーカイブ/復元・撮影可否編集・新規登録が、アクセス制御なしに誰でも操作可能。対象範囲には「アーカイブ済みを表示」トグルも含む。**これは意図的な未対応であり、バグとして扱わないこと。** ユーザーからの明示的な依頼があった際に着手する

---

## 運用ルール

- **`git push` はユーザーの明示的な許可を得てから行う。** ローカルコミットは各機能の完成ごとに行ってよい
- 検証にテストデータを使った場合、ターンの終わりに必ず `localStorage` から削除すること（実データのみを残す）
