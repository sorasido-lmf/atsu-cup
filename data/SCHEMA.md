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
| archived | boolean | アーカイブ済みかどうか(デフォルトfalse)。trueの場合、新規の大会エントリー選出には出てこないが、過去の対戦記録・戦績データは維持される(物理削除はしない) |
| createdAt | string (ISO8601) | 登録日 |
| note | string | メモ欄（任意） |

## tournaments.json（大会マスタ）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（例: t2026-07） |
| title | string | 大会名 |
| detail | string | 説明文 |
| posterImage | string | 画像へのパス（例: assets/posters/t2026-07.jpg） |
| heldAt | string (ISO8601 date) | 開催日 |
| status | string | "ongoing" \| "completed" |

## entries.json（大会参加者データ = 1行1エントリー、大会単位の要約）
| カラム | 型 | 説明 |
|---|---|---|
| id | string | 一意なID（`{tournamentId}_{userId}`） |
| tournamentId | string | 外部キー → tournaments.json |
| userId | string | 外部キー → users.json |
| placement | number \| null | 最終順位。未確定はnull |
| wins | number | その大会での勝利数 |
| recAtEntry | boolean | その大会時点での撮影可否（省略時はusers.recDefaultを使用） |

ポイントはここに保存せず、`placement`/`wins`から都度算出する。

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
| videoUrl | string | 対戦動画リンク（任意） |
| playedAt | string (ISO8601) | 対戦確定日時（任意） |

`entries.json`の`placement`/`wins`は本来`matches.json`から導出可能な要約値。
大会終了時にentriesを確定させるタイミングで、matches.jsonの内容から自動集計して書き込む運用とする。
