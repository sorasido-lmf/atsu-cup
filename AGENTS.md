# AGENTS.md — 作業前に必ず読むこと

あつ杯（atsu-cup）のリポジトリ共通ルール。**Claude Code と OpenAI Codex の両方に適用される。**

- **ここは「規範」の正本**（何をしてはいけないか・何を必ずするか）
- **「なぜそうなのか・どう実装されているか」は [`docs/`](docs/) が正本**
- 同じ規範の本文が2ファイルに現れたら、それはどちらかが誤り。**規範は AGENTS.md、説明は docs/** という切り分けだけを守る
- ルールを変えたら必ずこのファイルか `docs/` を更新し、同じコミットに含める。**AI のメモリにだけ重要な決定を残さない**（次に作業するのは別のツールかもしれない）

---

## このプロジェクトは何か

LINE モンスターファーム のコミュニティ大会「あつ杯」の運営ツール。
**ビルド不要の静的サイト**（素の HTML/CSS/JS、フレームワーク・トランスパイルなし）。
書き込みは Google Apps Script 経由でスプレッドシートへ行き、そこから GitHub へ書き出される。

人間向けの概要は [`README.md`](README.md)。

---

## 🔴 絶対に守ること

### データを壊さないために

- **`data/` を `.gitignore` に追加しない。** `data/*.json` は GitHub 上に存在させることが要件で、ローカルの変更だけを push しないために `skip-worktree` で運用している。gitignore すると GitHub 上からファイル自体が消える（**過去に2回この誤りを犯している**）
- **「ローカルの変更を push したくない」＝「gitignore」と短絡しない。** GitHub 上にファイルを残す要件があるなら `skip-worktree` が正解
- **`data/` 配下を `git add -f` で強制的にステージしない**
- **`data/` の扱いを変える前に必ず [`docs/data-sync.md`](docs/data-sync.md) と [`docs/operations.md`](docs/operations.md) を読み直す**
- **大会情報の編集・作成は `saveTournamentMetaToData()`、進行状況の保存は `saveTournamentToData()`。取り違えない。** メタ保存のつもりでフル保存を呼ぶと、他端末が保存済みの対戦結果を空の entries/matches で上書きして消す（実害が出た事故）
- **`fromAppTournament()` の書き出し規則を変えたら、必ず `atsucup-data.js` の `SIG_VERSION` を上げる。** 上げ忘れると全端末で競合モーダルが誤爆する
- **`state.people` の配列順を変えない。** 同期署名に順序込みで入るため、並べ替えると全大会の署名が変わって全端末で競合モーダルが誤爆する。表示だけ並べ替えること

### 改悪しないために

- **撮影可否（rec）の回避ロジックのうち、⚡ワンタップ自動抽選（`buildRound1`）と ▶次のラウンドへ進む（`advanceRound`）は理論下限を達成済み。改善しようとしない**（シミュレーションで検証済み。詳細は [`docs/tournament.md`](docs/tournament.md)）
- **`window.confirm()` / `window.alert()` に処理の成否を依存させない。** 一部の WebView やテスト環境で抑制され、`confirm()` が常に `false` を返しうる。破壊的操作の確認は自前のインライン UI で作る
- **ポインタイベントの `pointerdown` で無条件に `preventDefault()` を呼ばない。** タッチ端末で以降の click イベント一式が抑制される。スクロール抑止は CSS の `touch-action:none` に任せ、ドラッグ確定後にだけ呼ぶ
- **GAS の `verifyIdToken_()` と `assertAdmin_()` を外さない。** この2つがサーバー側の唯一の防御線で、外すと GAS URL を知る全員が書き込める
- **役割の判定 `canManageUsers_()` / `canDeleteTournament_()` も GAS 側が実体。** クライアントのボタンの出し分けは**目隠しに過ぎない**ので、UI を直しただけで「制限した」と考えない
- **権限不足を `authError_()` で投げない。** それは `FORBIDDEN` になり「再ログインすれば直る」導線に落ちる。権限不足は `permissionError_()`（`PERMISSION`）を使う

### コードを変更したら

- **`.html` / `.js`（GAS 除く）を1文字でも変更して push するなら、commit 前に `version.json` の `build` と `atsucup-core.js` の `BUILD_DATE` を同じ値（日付+時刻・JST）に更新する。**
  「今回はコードに影響するか」を判断するのではなく、**変更ファイル一覧に該当ファイルがあるかだけで機械的に判定する**（2回忘れた実績がある → [`docs/incident-notes.md`](docs/incident-notes.md)）
- **検証にテストデータを使ったら、作業の終わりに `localStorage` から必ず削除する**（実データだけを残す）
- **ローカル確認は HTTP サーバー経由で行う。** `python3 -m http.server 8765`。`file://` で開くと `fetch('data/users.json')` が CORS で失敗し、キャッシュだけで動いてしまうため確認にならない

### Git

- **作業開始前に `git pull --rebase`。** `data/*.json` は GAS が自動コミットするため、省くと push が弾かれる
- **作業単位でブランチを切る。** `main` 直コミットは小さな文書修正だけ
- **同じファイルを両環境（Claude / Codex）で同時に編集しない**
- **push 前に `git status -sb` と `git log --oneline origin/main..HEAD` で差分と競合を確認する**
- **`git push --force` を通常運用にしない。** もう一方の環境の未統合コミットを上書きしない
- **`git pull` でローカルの未コミット変更を捨てない**（残っているなら先に `git stash`）
- **push は所有者の明示的な許可を得てから。** ローカルコミットは随時してよい
- **端末固有の絶対パス・認証情報・トークン・個人設定をコミットしない**

- 🔴 **クローンを増やしたら `data/*.json` に `skip-worktree` を設定する。** これはリポジトリに保存されない
  ローカル設定なので、クローンしただけでは効いていない（手順は下記リンク先）

詳しい手順は [`docs/operations.md`](docs/operations.md) の「2つのローカル環境での Git 運用」。

---

## 作業内容ごとに最初に読む資料

| これから触るもの | 最初に読む |
|---|---|
| 端末間の同期、保存、マージ、署名、大会の削除 | [`docs/data-sync.md`](docs/data-sync.md) 🔴最重要 |
| 対戦表、シード枠、ラウンド進行、大会の終了、3位決定戦、撮影可否 | [`docs/tournament.md`](docs/tournament.md) |
| 戦績ランキング、ユーザー管理、権限、並び順 | [`docs/records-users.md`](docs/records-users.md) |
| 画面追加、state の持ち方、ゲスト/認証プール、GAS 構成 | [`docs/architecture.md`](docs/architecture.md) |
| デプロイ、バージョン更新、スプレッドシート操作、Git 運用、復旧 | [`docs/operations.md`](docs/operations.md) |
| 「なぜこの設計なのか」が分からない時 | [`docs/incident-notes.md`](docs/incident-notes.md) |
| `data/*.json` の列定義 | [`data/SCHEMA.md`](data/SCHEMA.md) |
| Apps Script のセットアップ・関数 | [`gas/README.md`](gas/README.md) |

**迷ったら [`docs/data-sync.md`](docs/data-sync.md) を読む。** このアプリで実害が出た不具合の大半はここに集中している。

---

## 必ず行う検証

- **ローカルサーバーを立てて実際に動かす。** 「コードを読んで正しそう」で終わらせない
- **実データで確かめる。** `data/*.json` に本番データがあるので、集計やマージの変更は実データで前後比較する
- **既存の値が変わっていないことを確認する。** 指標や集計を追加した時は、既存のポイント・順位・件数が1つも動いていないことを照合する
- **スマホ幅（375px）で確認する。** iOS Safari には実機でしか出ない描画の癖がある
- **GAS を変更した場合**、デプロイはユーザー作業になる。何を確認してほしいかを明示的に伝える

---

## ツール固有の設定について

| ツール | 起点ファイル | 役割 |
|---|---|---|
| OpenAI Codex | `AGENTS.md`（このファイル） | 自動で読まれる |
| Claude Code | `CLAUDE.md` | 自動で読まれ、このファイルへ誘導する |

**ツール固有の設定ファイルを共有ルールの正本にしない。** `CLAUDE.md` は Claude 固有の作法だけを持ち、共有ルールは1行も持たない。
