# atsu-cup データベース スキーマ

GitHubリポジトリで管理する参加者・大会マスタデータ。JSON形式で `data/` 配下に配置する。
既存の `localStorage`(`atsucup:state:v2`)は大会進行中の一時データとして引き続き使用し、
大会が確定したタイミングでここのJSONに反映する運用を想定。

## users.json（ユーザーマスタ）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID。不変。名前変更の影響を受けない |
| name | string | 現在の表示名 |
| recDefault | boolean | 撮影可否のデフォルト設定 |
| archived | boolean | アーカイブ済みかどうか(デフォルトfalse)。trueの場合、新規の大会エントリー選出には出てこず、**戦績ランキングにも表示されない**が、過去の対戦記録・戦績データは維持される(物理削除はしない) |
| createdAt | string (ISO8601) | 登録日 |
| note | string | メモ欄（任意） |
| sortOrder | number | 表示順(昇順)。ユーザー管理画面のドラッグ&ドロップで決める。ユーザー管理・大会エントリーの候補一覧・飛び入り参加の候補で参照する。空欄/0は未設定で、同値のときは登録順(行順)を保つ。**2026-08-03に最終列として追加** |

## tournaments.json（大会マスタ）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（例: t2026-07） |
| title | string | 大会名 |
| detail | string | 説明文 |
| posterImage | string \| null | ポスター画像のURL。`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/posters/<id>.jpg`（GAS側`actionSaveTournament_`がアップロードして書き込む）。スプレッドシートは1セル50,000文字が上限のため、data URL（base64）のまま直接この列へ保存することはしない（2026-07-27に画像サイズ超過で行が空欄化する不具合があり、GitHubへのファイルアップロード方式に変更した） |
| heldAt | string (ISO8601 date) | 開催日。アプリの大会作成/編集フォームで指定した日付(内部的には`createdAt`と呼ぶ) |
| status | string | "ongoing" \| "completed" |
| archived | boolean | アーカイブ済み(=アプリ上で削除された)かどうか(デフォルトfalse)。行の物理削除は行わず、trueが立つと`toAppTournaments()`がそもそも読み込まない(大会一覧・歴代優勝者・戦績すべてに出てこなくなる)。entries/matchesはそのまま残るため、復元は可能(このフラグを手動でfalseに戻す) |
| isOfficial | boolean | 「公式大会」フラグ(デフォルトfalse)。集計での利用は未実装、保存/表示のみ |
| isRestricted | boolean | 「制限杯」フラグ(デフォルトfalse)。集計での利用は未実装、保存/表示のみ |
| updatedAt | string (ISO8601) \| "" | サーバー(GAS)がこの行を最後に書き換えた日時。**クライアントは書き込まない**(GAS側の`stampUpdatedAt_()`が`new Date().toISOString()`で打つ)。端末間同期で「サーバー側が更新されたか」を、内容比較ではなく**時刻の大小**で判定するために使う。列追加(2026-07-28)より前に保存された行は空欄で、その場合クライアントは内容比較にフォールバックする。⚠️**手で編集しないこと**(未来日付を入れると以後の更新がすべて「古い」扱いになり、他端末へ反映されなくなる) |

**2026-07-27〜28追加**: `archived`/`isOfficial`/`isRestricted`/`updatedAt`の4列は、既存データがある列の途中に挿入すると値がズレるため、必ず`status`の後ろ(最終列)に追加すること。GASの`readSheet_()`は列名をシートのヘッダから引き当てるため、**実際のGoogle Sheetの`tournaments`タブにも同名の列を先に追加してからデプロイする**必要がある(手順は`gas/README.md`参照)。

## entries.json（大会参加者データ = 1行1エントリー、大会単位の要約）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（`{tournamentId}_{userId}`） |
| tournamentId | string | 外部キー → tournaments.json |
| userId | string | 外部キー → users.json |
| placement | number \| null | 最終順位。未確定はnull |
| wins | number | その大会での勝利数 |
| recAtEntry | boolean | その大会時点での撮影可否（省略時はusers.recDefaultを使用） |
| monsterId | string \| null | 外部キー → monsters.json。その大会でこの人が使ったモンスター。未選択はnull。**2026-08-08に最終列として追加**（既存列の途中に挿入しないこと） |

ポイントはここに保存せず、`placement`/`wins`から都度算出する。

`monsterId`は`userId`と違い、**クライアントが送ったidをGASがそのまま書き込む**（名前→ID解決をしない）。
モンスターマスタはシートを人が手で編集する読み取り専用マスタで、アプリ側が採番することが無いため。
マスタから消えたidが残っていても行は壊れず、表示側で「不明なモンスター」になるだけ。

## monsters.json（モンスターの種族カタログ）

🔴 **このテーブルだけはアプリから一切書き込まない。** スプレッドシートの`monsters`シートを人が直接編集し、
GASエディタで`previewMonstersToGitHub()`→`pushMonstersToGitHub()`を手動実行して反映する
（`gas/README.md`参照）。個体ではなく**種族**の一覧である点に注意。

| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（`m0001`形式）。不変。entries.monsterIdから参照される |
| name | string | 種族名 |
| aura | string | オーラ色: 赤 / 青 / 黄 / 緑 / 白 / 黒 |
| kind | string | モン類: 創造 / 幻霊 / 魔族 / 獣 / 怪物 / 無機 |
| mainBlood | string | 主血統。**候補値が未確定のため自由入力**（アプリ側でバリデーションしない） |
| subBlood | string | 副血統。入りうる値は「主血統の値 + ロード種 + ノーブル種」の想定。同じく自由入力 |
| archived | boolean | trueで選択候補から外れる。**過去の記録の表示・集計には影響しない**（引退した種族を隠すための列） |
| sortOrder | number | 選択モーダルでの表示順（昇順・同値は行順）。`users.sortOrder`と同じ扱い |

`aura`/`kind`の値はアプリ側にも定数がある（`atsucup-core.js`の`MONSTER_AURAS`/`MONSTER_KINDS`。
絞り込みUIの並びと集計の内訳に使う）が、**ここに無い値がシートに入っていても弾かない**
（マスタは人が育てるもので、アプリ側の定数が運用のボトルネックにならないようにするため）。
定数に無い値は絞り込みチップに出ず、内訳では「その他」にまとまる。

## matches.json（対戦データ = 一次データ／詳細ログ）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（`{tournamentId}_r{round}_m{index}`） |
| tournamentId | string | 外部キー → tournaments.json |
| round | number | ラウンド番号（1回戦=1, 2回戦=2…） |
| stage | string | "normal" \| "thirdPlace" |
| matchIndex | number | ラウンド内での対戦カード順 |
| player1Id | string \| null | 外部キー → users.json（bye枠はnull） |
| player2Id | string \| null | 外部キー → users.json |
| winnerId | string \| null | 外部キー → users.json（未確定はnull） |
| isBye | boolean | 不戦勝カードかどうか |
| player1SrcIndex | number \| null | player1が「前ラウンドのどのカードの勝者か」を指すindex（0始まり）。2回戦以降のみ。1回戦とthirdPlaceはnull |
| player2SrcIndex | number \| null | 同上（player2側） |
| videoUrl | string | 対戦動画リンク（任意） |
| playedAt | string (ISO8601) | 対戦確定日時（任意） |

`entries.json`の`placement`/`wins`は本来`matches.json`から導出可能な要約値。
大会終了時にentriesを確定させるタイミングで、matches.jsonの内容から自動集計して書き込む運用とする。

### player1SrcIndex / player2SrcIndex について
撮影不可の偏りを避けるため、ラウンド進行時に組み合わせを入れ替えることがある。その結果
「2回戦のカードkのplayer1 = 1回戦のカード2kの勝者」という既定の対応関係が崩れるため、
実際の対応関係をこの2列に保持する。**この情報が無いと、後から前ラウンドの勝敗を
やり直した際に勝者が誤った枠へ入る**ため、導出で代替することはできない。

なお敗者(loser)は`winnerId`とplayer1/player2から一意に定まるため列を持たない（読み込み時に再計算する）。
