# あつ杯（atsu-cup）

LINE モンスターファーム のコミュニティ大会「あつ杯」を運営するためのツール。
参加者の管理、トーナメント表の作成と進行、対戦結果の記録、通算戦績の集計を行う。

公開先: GitHub Pages

---

## 技術構成

**ビルド不要の静的サイト**。フレームワークもトランスパイルも使わず、素の HTML / CSS / JavaScript で動く。

```
[ブラウザ]
  ├─ 読み込み  GitHub Pages の静的 data/*.json（認証不要・高速）
  └─ 書き込み  Googleログイン → IDトークン → GAS(doPost)
                  └→ スプレッドシートを更新 → GitHub へ書き出し
```

| 層 | 使っているもの |
|---|---|
| フロントエンド | 素の HTML / CSS / JS（依存ライブラリなし） |
| 認証 | Google Identity Services（IDトークンの検証は必ずサーバー側） |
| バックエンド | Google Apps Script（`gas/Code.gs`） |
| データの正本 | Google スプレッドシート（GitHub の `data/*.json` はその書き出し先。詳細は [`docs/data-sync.md`](docs/data-sync.md) の「「正本」は層によって違う」） |
| 配信 | GitHub Pages（`data/*.json` を静的配信） |

---

## ローカルでの起動

```bash
python3 -m http.server 8765
```

ブラウザで `http://localhost:8765` を開く。`.claude/launch.json` に同じ設定が入っている。

⚠️ **`file://` で直接開かないこと。** `fetch('data/users.json')` が CORS で失敗し、
ブラウザに残っているキャッシュだけで動いてしまうため、実データの確認にならない。

---

## 主要なファイルとディレクトリ

| パス | 内容 |
|---|---|
| `index.html` ほか各 `.html` | 画面。1画面1ファイル |
| `atsucup-core.js` | 共通の state 管理・データロジック・`data/` の読み書き（全ページ共有） |
| `atsucup-data.js` | `data/*.json`（IDキー）↔ アプリ内部（名前キー）の変換層 |
| `detail-view.js` | 大会詳細（対戦表・勝敗入力）の描画 |
| `google-auth.js` / `gas-db.js` / `gas-config.js` | GAS 連携 |
| `data/` | 本番データ（JSON）とスキーマ定義 |
| `gas/` | Apps Script 本体とセットアップ手順 |
| `docs/` | 開発・運用資料 |
| `posters/` | 大会のポスター画像 |

画面ごとの役割は [`docs/architecture.md`](docs/architecture.md) を参照。

---

## 開発・運用資料

| 資料 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **作業前に必ず読む共通ルール**（禁止事項・必須手順・資料の索引） |
| [`docs/architecture.md`](docs/architecture.md) | 画面構成・モジュール・state の持ち方・GAS 構成 |
| [`docs/data-sync.md`](docs/data-sync.md) | 端末間の同期、保存経路、マージ規則。**データ消失に直結する箇所** |
| [`docs/tournament.md`](docs/tournament.md) | 対戦表・シード枠・ラウンド進行・撮影可否の仕様 |
| [`docs/records-users.md`](docs/records-users.md) | 戦績集計・ユーザー管理・権限・並び順 |
| [`docs/operations.md`](docs/operations.md) | ローカル作業・デプロイ・シート操作・Git 運用・復旧手順 |
| [`docs/incident-notes.md`](docs/incident-notes.md) | 過去の不具合と、現在の設計になった理由 |
| [`data/SCHEMA.md`](data/SCHEMA.md) | 4テーブルの列定義 |
| [`gas/README.md`](gas/README.md) | Apps Script のセットアップと関数リファレンス |

---

## AI コーディングツールでの開発

このリポジトリは **Claude Code と OpenAI Codex のどちらからでも作業できる**ように構成している。
2つの環境はそれぞれ別のローカルクローンを持ち、変更の共有は Git/GitHub 経由で行う。

| ツール | 起点 |
|---|---|
| Codex | `AGENTS.md` を自動で読む |
| Claude Code | `CLAUDE.md` が自動で読み込まれ、そこから `AGENTS.md` へ誘導される |

共通ルールの正本は `AGENTS.md` と `docs/`。ツール固有の設定ファイルを共通ルールの正本にはしない。

### 開発を始めるときの手順

1. `git pull --rebase` でリモートの最新を取り込む（`data/*.json` は GAS が自動コミットするため必須）
2. `AGENTS.md` を読む
3. 作業内容に対応する `docs/*.md` を読む（対応表は `AGENTS.md` にある）
4. 作業単位でブランチを切る
5. `.html` / `.js` を変更したら `version.json` と `atsucup-core.js` の `BUILD_DATE` を更新する
6. push は所有者の許可を得てから

---

## 未対応・今後の課題

- GAS の `role` は `admin` / `editor` の2種類。さらに細かい粒度（大会は可・特定の大会だけ不可 等）は未着手
- スプレッドシートの手編集はアプリへ自動で伝わらない。手編集後は `previewSheetChangesToGitHub()` → `pushSheetChangesToGitHub()` の手動実行が必要（[`gas/README.md`](gas/README.md) 参照）
