# 運用手順

> 共通ルール（禁止事項・必須手順）は [`../AGENTS.md`](../AGENTS.md) が正本です。
> この文書は「なぜそうなっているのか・どう実装されているか」を説明します。

ローカルでの確認、デプロイ、バージョン更新、スプレッドシートの操作、
2つのローカル環境での Git 運用、復旧手順。

---

## ローカルでの動作確認

`.claude/launch.json` をリポジトリに含めている（2026-08-03 コミット）。`python3 -m http.server 8765` で静的配信するだけの設定で、ビルドは不要。

⚠️ **`--directory` は `.`（相対パス）にすること。** 絶対パス（`/Users/<誰か>/…/atsu_cup` のような形）を書くと、その環境以外でプレビューが起動しない。コミットして共有する以上、特定端末のパスを含めない。Claude を使う環境と Codex を使う環境で置き場所が違うため、これは実際に問題になる。

`file://` で直接開くと `loadFromData()` の `fetch('data/users.json')` がCORSで失敗し、localStorageのキャッシュだけで動く（＝実データの確認にならない）ため、必ずHTTPサーバー経由で確認する。

---

---

## 実現方法: skip-worktree（gitignoreではない）

上記の非対称性は `git update-index --skip-worktree` で実現している。設定済み（2026-07-26）。

```bash
# 設定状況の確認（先頭が S なら skip-worktree 有効）
git ls-files -v data

# GitHub側の更新をローカルへ取り込む（一時解除 → 取得 → 再設定）
git update-index --no-skip-worktree data/*.json data/SCHEMA.md
git checkout data
git update-index --skip-worktree data/*.json data/SCHEMA.md
```

なお `data/SCHEMA.md` は**データではなく設計ドキュメント**のため skip-worktree を外して通常追跡している。
実データの4つのJSONのみ skip-worktree 対象。

---

## 🔴 データの向きと、必ず踏む手順（重要）

「シートが正本」で動くため、**GitHub側にだけ存在するデータがある状態で書き込むと、シートの内容(空 or 古い)で上書きされて消える。**

以下のタイミングでは、書き込み前に必ず `gas/Code.gs` の **`importFromGitHub()`** を実行すること（`compareWithGitHub()` で事前に差分確認できる）。

- スプレッドシートへの移行時
- 誰かがGitHub上で `data/*.json` を直接編集した後
- 他の経路(旧PAT方式など)でGitHub側だけが更新された後

`exportTables_()` には「シートが空なのにGitHubにデータがある場合は中断する」安全装置があるが、これは完全空のケースしか検知できないため過信しないこと。

## 🔴 シートの手編集をアプリへ届ける(`pushSheetChangesToGitHub`, 2026-08-03修正)

スプレッドシートを人が手で直した後に`pushSheetChangesToGitHub()`を実行しても、GitHubの`data/*.json`は更新されるのに`tournaments`行の`updatedAt`は据え置きだった。クライアントの`mergeRemoteTournaments()`は「サーバー側が変わったか」を`isRemoteNewer()`の**時刻の大小**で判定するため、`remoteChanged=false`で早期returnし、**手編集の内容が全端末へ永久に届かなかった**。`updatedAt`が空の行だけは内容比較へフォールバックするが、**実データは34大会すべて充填済み**でフォールバックは1件も効いていなかった(それまでは`updatedAt`セルを手で進めて回避していた)。

⚠️ **修正として「全`tournaments`行に一律で`updatedAt`を打つ」をやってはいけない。** 署名(`syncSignatureOf`)は`updatedAt`/`archived`を含まないため、無関係な大会にまで打つと**未保存の進行状況を持つ端末で「ローカルも変わった・サーバーも変わった」＝競合と判定され、競合モーダルが全大会で誤爆する**(上の`SIG_VERSION`の節が警告しているのと同じ事故)。

現在は**GitHubの現行`data/*.json`とシートを突き合わせ、実際に内容が変わる大会だけ**に打つ:

- `changedTournamentIds_()` … `tournaments`/`entries`/`matches`の3テーブルを`id`で突き合わせ、差がある行の大会idを集める。**`updatedAt`列は比較から除外する**(自分が前回打った値なので、除外しないと毎回全行が差分になる)。`archived`は含める。行の並び順には依存しない
- `stampUpdatedAtInSheet_(ids)` … 該当行の`updatedAt`**セルだけ**を書く。⚠️ `writeSheet_('tournaments', rows)`は使わない(ヘッダ以外を`getLastColumn()`の幅で`clearContent`するため、SCHEMA外の運用メモ列まで消える)
- `previewSheetChangesToGitHub()` … 読み取り専用の確認用。GASエディタにはインライン確認UIが作れないので、**これが「破壊的操作の確認は自前UIで」の代替**にあたる

⚠️ **シートへの書き戻しは必須。** GitHubにだけ新しい`updatedAt`を書いてシートを据え置くと、次回の反映でシートの古い値がGitHubへ戻り`updatedAt`が巻き戻る。順序は stamp → export(`exportTables_`がシートを読み直す)。exportが失敗しても次回が同じ差分を再検出して打ち直すので自己修復する。

`entries`/`matches`だけを直した場合も、その大会の`tournaments`行に打つ(アプリは大会単位で取り込むため)。シートから**行ごと削除**した大会は打てないが、`pruneTournamentsGoneFromServer()`が`updatedAt`を使わずに処理するので対応不要。`users`シートは対象外のまま(ユーザー修正はアプリから行う)。

## 🔴 中身が変わらない書き込みはコミットしない(2026-08-03)

`gas/Code.gs`の`putGithubContent_()`が、送る内容の**git blob sha**(`SHA1("blob "+バイト長+"\0"+中身)`)をローカル計算し、PUT前に必ず取得している既存ファイルの`sha`と一致したらPUT自体を省く。

- **GitHubへの問い合わせは増えない**(sha取得のGETは元々必ず走っている)。大会保存・ユーザー保存・ポスター画像を含む**全ての書き込み経路**に効く
- 判定は「一致したら省く」方向。sha計算が万一狂っても「従来どおり書き込む」に倒れるだけで、データが届かない事故にはならない
- 実データ4ファイルで`git hash-object`と一致することを検証済み

---

## デプロイとバージョン更新

`.html`/`.js`(GAS除く) を変更したら `version.json` の `build` と `atsucup-core.js` の `BUILD_DATE` を
同じ値（日付+時刻、JST）に更新する。**判定は「該当ファイルが差分に含まれるか」だけで機械的に行う**
（規範としての正本は [`../AGENTS.md`](../AGENTS.md)、忘れた時に何が起きたかは
[`incident-notes.md`](incident-notes.md)）。

- **更新通知バナーは「検知したら自動で1回だけリロードする」自己修復方式（2026-07-27〜）。** GitHub Pagesの`atsucup-core.js`等は`cache-control: max-age=600`のため、バージョンを上げてpushしても、初回訪問者や10分以内の再訪問者は古いJSのままバナーにも気づかず使い続けてしまうリスクがあった。`initUpdateBanner`の`checkVersion()`は、バージョン不一致を検知した際にバナー表示に加えて`sessionStorage`のフラグを見て**タブのセッション内で1回だけ**`location.reload()`する。無限リロードにならないのは、リロード後に取得される新しいJSの`BUILD_DATE`が`version.json`と一致し、以降`checkVersion()`が不一致を検知しなくなるため。この仕組み自体、古いキャッシュ済みJSにはまだ入っていないため即座には効かないが、そのJSが一度でも再取得されれば以降の取りこぼしを自動で吸収するようになる

---

## 2つのローカル環境での Git 運用

Claude Code を使う環境と OpenAI Codex を使う環境が、**それぞれ別のローカルクローン**を持ち、
同じ GitHub リポジトリを更新する。作業ディレクトリは共有しない。統合は必ず Git/GitHub 経由で行う。

### 毎回守ること

1. **作業開始前にリモートを取り込む** — `git pull --rebase`
   🔴 `data/*.json` は GAS が自動でコミットするため、これを省くと push が必ず弾かれる
2. **作業単位でブランチを切る** — `main` への直コミットは小さな文書修正だけにする
3. **着手前に、今どのブランチで何をしているかを確認する** — `git status -sb`
4. **同じファイルを両環境で同時に編集しない** — 片方を終えて push してから、もう片方が pull する
5. **push 前に差分と競合の有無を確認する**
   ```bash
   git status -sb
   git log --oneline origin/main..HEAD
   ```
6. **もう一方の環境の未統合コミットを上書きしない** — `git push --force` は通常運用にしない
7. **pull でローカルの未コミット変更を捨てない** — 変更が残っているなら先に `git stash`
8. **コミットは変更目的が分かる単位にする**
9. **push は所有者の明示的な許可を得てから行う**（ローカルコミットは随時してよい）

### 🔴 `data/` は通常の Git 運用と別枠

`data/*.json` は `skip-worktree` で運用している（上の「skip-worktree」節を参照）。

- **`.gitignore` に `data/` を追加しない**
- **`git add -f` で強制的にステージしない**
- GitHub 側の更新をローカルへ取り込むのは、上記の3行手順（`--no-skip-worktree` → `git checkout data` → `--skip-worktree`）だけ
- ブランチを切り替えても skip-worktree は維持される。`git ls-files -v data` の先頭が `S` であることを確認する

### 共有すべき決定は必ず Git 管理下の文書へ

- ルールや設計判断を **AI のメモリにだけ残さない**。次に作業するのが別のツールかもしれない
- ルールを変えたら [`../AGENTS.md`](../AGENTS.md) か `docs/` を更新し、同じコミットに含める
- 端末固有の絶対パス・認証情報・トークン・個人設定はコミットしない（`.gitignore` を参照）
