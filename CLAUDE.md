# CLAUDE.md — Claude Code 向けの作業手順

あつ杯（atsu-cup）。LINE モンスターファーム のトーナメント運営ツール。
静的HTML/CSS/JS（ビルドなし・フレームワークなし）+ Google Apps Script + スプレッドシート。

---

## 🔴 作業を始める前に必ず `AGENTS.md` を読むこと

このリポジトリの**共通ルールの正本は [`AGENTS.md`](AGENTS.md)** です。禁止事項・必須手順・
各資料への索引がそこに集約されています。**`CLAUDE.md` には共有ルールを1行も置いていません。**

@AGENTS.md

⚠️ **上の `@AGENTS.md` が自動で展開されない環境では、この CLAUDE.md だけではルールが足りません。**
その場合は、コードを読み始める前に必ず `AGENTS.md` を Read してください。
`AGENTS.md` は1ファイルで完結しており、事故に直結するルールはすべてそこにあります。

続けて、`AGENTS.md` 末尾の対応表から**今回の作業に対応する `docs/*.md` を1つ読んでから**着手してください。

| これから触るもの | 読む資料 |
|---|---|
| 同期・保存・マージ・大会の削除 | [`docs/data-sync.md`](docs/data-sync.md) 🔴最重要 |
| 対戦表・シード枠・進行・終了・撮影可否 | [`docs/tournament.md`](docs/tournament.md) |
| 戦績・ユーザー管理・権限・並び順 | [`docs/records-users.md`](docs/records-users.md) |
| 画面追加・state・プール・GAS構成 | [`docs/architecture.md`](docs/architecture.md) |
| デプロイ・バージョン・シート・Git運用 | [`docs/operations.md`](docs/operations.md) |
| 「なぜこの設計なのか」が分からない時 | [`docs/incident-notes.md`](docs/incident-notes.md) |

---

## メモリとリポジトリ文書の優先関係

1. **リポジトリの Git 管理下の文書が唯一の正本**（`AGENTS.md` → `docs/` → `data/SCHEMA.md` / `gas/README.md`）
2. Claude のメモリは**補助**。文書と食い違ったら**文書が正しい**
3. 🔴 **共有すべき決定をメモリにだけ残さない。** このリポジトリは Codex を使う別のローカル環境からも
   更新される。メモリは Codex からは読めないので、ルールや設計判断は必ず `AGENTS.md` か `docs/` へ書き、
   同じコミットに含めること
4. メモリに書いてよいのは、**そのユーザーの好み・作業の進め方**など、リポジトリに属さないものだけ

---

## ローカルでの起動と確認

`.claude/launch.json` に設定済み。`preview_start` で `atsu-cup` を起動する（ポート 8765）。

⚠️ **Bash で dev サーバーを立てないこと。** プレビュー用のツールを使う。

```bash
python3 -m http.server 8765   # 手で立てる場合の同等コマンド
```

### ブラウザ検証で踏みやすい落とし穴

- **`localhost` と `127.0.0.1` は別オリジン。** 片方でキャッシュや localStorage が残っていても、
  もう片方には引き継がれない。**JS の変更が反映されない時は `127.0.0.1` で開き直すと確実**
  （`python3 -m http.server` は `Cache-Control` を返さないため、Chrome が古いファイルを長く掴む）
- **`computer` ツールの座標はビューポート座標ではない。** スクリーンショットのピクセル空間で、
  1280x720 のビューポートなら **ツール座標 × 1.6 = ページ座標**。要素の位置は
  `getBoundingClientRect()` を取って換算してから渡す
- **`left_click_drag` は PointerEvent を出さないことがある。** ポインタイベントで実装した D&D は、
  `dispatchEvent(new PointerEvent(...))` で検証する
- **検証が終わったら `localStorage` と `sessionStorage` を両オリジンでクリアする**

---

## このリポジトリでの作業の進め方

- **実装より先に、実データやシミュレーションで裏を取る。** `data/*.json` に本番データがあるので、
  集計・マージ・並び順の変更は「変更前後で既存の値が1つも動いていないこと」を照合してから進める
- **GAS（`gas/Code.gs`）はローカル実行できない。** 検証するときは、本物の `Code.gs` を Node の `vm` へ
  読み込み、`readSheet_` / `readJsonFromGitHub_` / `UrlFetchApp` などデータ取得だけを差し替える
  （ロジックを写経すると、写経した側だけが正しくなって意味がなくなる）
- **破壊的操作の確認は自前のインライン UI で作る**（`AGENTS.md` 参照）。GAS のように UI を作れない場所では、
  読み取り専用の `preview...()` 関数を確認ステップの代わりにする
- **返答は日本語で**

---

## push の前に

1. `git pull --rebase`（`data/*.json` は GAS が自動コミットするため必須）
2. `.html` / `.js` を変更したなら `version.json` と `BUILD_DATE` を更新したか、**変更ファイル一覧を見て機械的に確認**
3. テストデータを消したか
4. **push はユーザーの明示的な許可を得てから**

詳細は [`AGENTS.md`](AGENTS.md) と [`docs/operations.md`](docs/operations.md)。
