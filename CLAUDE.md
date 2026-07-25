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

### 現状（2026-07-26時点）

| 項目 | 状態 |
|---|---|
| `data/users.json` | 実データあり（8人 + テスト由来のA〜G） |
| `data/tournaments.json` / `entries.json` / `matches.json` | 空の `[]`（未着手） |
| アプリからの `data/*.json` 読み込み | **未実装**（アプリは `localStorage` のみで動作） |

---

## GitHub連携について

**ブラウザから GitHub Contents API を直接叩く連携機能は、2026-07-25 に全削除済み。**
`github-db.js` / `settings.html`(PAT設定画面) / `scripts/verify-db.js` は削除された。

- アプリ側のコードに **GitHub API呼び出し・トークン管理・「取り込む/書き出す」ボタン等は一切持たせない**
- ユーザーからの明示的な指示なしに再導入しないこと
- `data/*.json` は「gitで管理される参照用マスタデータ」であり、アプリの実行時データ（localStorage）とは**別物**として扱う

---

## アプリの実行時データ

- 全データ（大会進行・参加者roster等）は `localStorage`（キー: `atsucup:state:v2`）で完結
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
| `atsucup-core.js` | 共通のstate管理・データロジック（全ページ共有） |
| `user-register-modal.js` / `walkin-modal.js` | 共通モーダル |

---

## 未対応・今後の課題（TODO）

- **管理者権限のみの表示制御が未実装**。`users.html` のアーカイブ/復元・撮影可否編集・新規登録が、アクセス制御なしに誰でも操作可能。対象範囲には「アーカイブ済みを表示」トグルも含む。**これは意図的な未対応であり、バグとして扱わないこと。** ユーザーからの明示的な依頼があった際に着手する

---

## 運用ルール

- **`git push` はユーザーの明示的な許可を得てから行う。** ローカルコミットは各機能の完成ごとに行ってよい
- 検証にテストデータを使った場合、ターンの終わりに必ず `localStorage` から削除すること（実データのみを残す）
