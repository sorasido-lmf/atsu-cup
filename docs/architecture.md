# アーキテクチャ

> 共通ルール（禁止事項・必須手順）は [`../AGENTS.md`](../AGENTS.md) が正本です。
> この文書は「なぜそうなっているのか・どう実装されているか」を説明します。

アプリ全体の構造・画面・モジュール・state の持ち方・GAS 構成。
個別の機能仕様は [`tournament.md`](tournament.md) / [`records-users.md`](records-users.md)、
データの同期は [`data-sync.md`](data-sync.md) を参照。

---

## 画面構成

| ファイル | 役割 |
|---|---|
| `index.html` | トップ。開催中の大会 + メニュー |
| `tournaments.html` | 大会一覧（進行中を先頭に表示） |
| `tournament-create.html` | 大会作成専用 |
| `tournament-detail.html` + `detail-view.js` | 大会詳細。組み合わせ決定・対戦表・勝敗入力を統合。**終了済みも同じ描画パス**(編集ロック+リザルト枠を足すだけ) |
| `tournament-entry.html` | 大会ごとの参加者選出 |
| `users.html` | ユーザーマスタ管理（新規登録・撮影可否・アーカイブ/復元） |
| `record.html` / `record-detail.html` | 戦績ランキングと個人の戦績(認証プールのみ集計)。**公式大会に限定＋制限杯/期間の絞り込みあり** |
| `results.html` | 大会の最終結果。「優勝カードを作る」もここ |
| `settings.html` | Googleログイン・接続確認 |
| `gas-test.html` | GAS連携の動作確認ページ（通常運用では使わない）。接続と権限の確認(`ping`)、**トークン無し・改ざんトークンでの書き込みが拒否されることの実地検証**、ユーザー/大会の保存テストができる |
| `atsucup-core.js` | 共通のstate管理・データロジック・`data/`の読み書き（全ページ共有） |
| `atsucup-data.js` | `data/*.json`(IDキー) ↔ アプリ内部(名前キー) の構造変換層 |
| `google-auth.js` / `gas-db.js` / `gas-config.js` | GAS連携（Googleログイン・API呼び出し・設定値） |
| `gas/Code.gs` / `gas/README.md` | GASバックエンド本体とセットアップ手順 |
| `user-register-modal.js` / `walkin-modal.js` | 共通モーダル |
| `guide-assistant.js` / `guide-assistant.css` | 対象10ページ共通の助手キャラクター案内。ページ別せりふ・画像抽選・固定表示を担当 |

対象10ページはすべて、スマホ幅で戻るボタンと吹き出しを同じ段に置き、
せりふの高さに応じてタイトルまでの余白を自動調整する。

---

---

## アーキテクチャ

```
[ブラウザ]
  ├ 読み込み: GitHub Pagesの静的 data/*.json(認証不要・即時)
  └ 書き込み: Googleログイン → IDトークン → GAS doPost
       GAS側: IDトークン検証(aud/exp/email_verified) → adminsシート照合 → シート更新 → GitHubへpush
```

**シートが正本、GitHubはその書き出し先という一方向。** ローカル→GitHubの自動反映は無い。

## ⚠️ 唯一の防御線

GASのWebアプリは「実行するユーザー: 自分」でデプロイしているため、**呼び出した人が誰であろうとオーナー権限でシートを触れる**。スプレッドシートの共有設定は一切効かない。

防御しているのは `gas/Code.gs` の **`verifyIdToken_()`**（Googleの署名付きIDトークンを検証し`aud`まで確認）と **`assertAdmin_()`**（`admins`シートとの照合）の2つだけ。この2つを外すと、GAS URLを知っている全員が書き込める状態になる。

**実際に攻撃を模した検証を実施済み**（2026-07-26）: トークン無し・でたらめな文字列・`aud`を正しく詐称した署名無効JWT、いずれも `FORBIDDEN` で拒否されることを確認済み。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `gas/Code.gs` | GAS本体。シート↔JSON変換・`doGet`(検証用)・`doPost`(唯一の書き込み口) |
| `gas/README.md` | セットアップ手順・関数リファレンス・**GitHub→シート取り込みの手順(重要)** |
| `google-auth.js` | Google Identity Servicesのラッパー。トークン取得のみ、**検証は必ずGAS側** |
| `gas-db.js` | GAS呼び出し。`text/plain`でCORS preflightを回避。GASは常に200を返すため本文の`ok`で成否判定 |
| `gas-config.js` | `GAS_URL` / `OAUTH_CLIENT_ID`。公開前提の値でリポジトリにコミットしてよい |
| `gas-test.html` | GAS連携の動作確認ページ。未認証・改ざんトークンでの拒否を実際に試せる（防御線が生きていることの確認に使う） |

**GitHub PATはGASのScript Properties(サーバ側)にのみ存在し、クライアントからは一切到達できない。**

## ID ↔ 名前の境界（重要）

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

---

## アプリの実行時データ

- 大会進行中の作業データは `localStorage`（キー: `atsucup:state:v2`）に保持し、確定した内容を `data/*.json` へ書き出す
- `pagehide` / `visibilitychange` で強制保存する保険あり（`atsucup-core.js`）
- `state.tournaments` 配列 + `state.activeId` で複数大会の同時進行に対応。`state.people`/`matches` 等は `Object.defineProperty` のgetter/setterでアクティブな大会へ透過的にプロキシされる

---

## ゲスト/認証済みの二重プール分離（2026-07-27 導入）

**過去のデータをだれでも削除できることを避けつつ、ふらっと使いたい人にも使ってもらえるようにする**ため、ロースター/大会データを完全に2つの入れ物に分離している（「同じ配列にタグを付けて区別する」方式ではなく、最初から別のキーに分ける方式を採用。名前重複の曖昧さや集計側のフィルタ漏れが原理的に起きないため）。

## state形状

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

## 不変条件

**ログイン中はゲストプールが空でなければならない。** `GoogleAuth`のログイン状態変化(`onStateChange`、core側で自動購読)と`restore()`実行時の両方で`enforceGuestSeparation()`が呼ばれ、ログイン中にゲストプールが非空なら非ダイスミス(Esc・オーバーレイクリック不可)の確認バナーを出す。「削除してログインする」で`clearGuestPool()`、「ログインをやめる」で自動`GoogleAuth.signOut()`(どちらもタップ後`location.reload()`)。

これは、2026-07-26に直した「`mergeRemoteTournaments()`はローカルの進行状況を黙って失わせない」原則の**唯一の、ユーザーが明示的にタップした場合だけの例外**。認証プールには一切触れない。

## アクセス方法(`pool()`アクセサ)

各ページは `const P = AtsuCup.pool();` を **render/handler関数の内側で毎回呼ぶ**(トップレベルでキャッシュしない)。ログイン中は認証プール、未ログインはゲストプールを指す`{roster, userRecDefaults, archivedUsers, tournaments}`の生きた参照が返る。`AtsuCup.isGuestMode()`/`AtsuCup.authPool()`/`AtsuCup.guestPool()`/`AtsuCup.poolKindOfTournamentId(id)`も利用可能。

`activeT()`/`setActive()`/`state.people`/`state.matches`等の既存のgetter/setterプロキシは無変更のまま、`state.activePool`経由で両プールに対応済み。**集計関数(`computeAllTimeStats`/`allFinishedEntries`)はプール分岐を持たない** — 認証プール(`state.roster`/`state.tournaments`)のみを読むため、ゲストデータは原理的に混ざらない。

## プールを跨いだ閲覧のガード(2026-07-27 修正: 方向によって扱いが異なる)

- **ログイン中に練習用(ゲスト)大会をURL直指定で開こうとした場合**: `detail-view.js`の`isCrossPool()`が検知し「この大会は表示できません」でブロックしてトップへ誘導する。ログインでゲストプールは削除される前提のため、通常はそもそもそのURLが存在しなくなる(実害の少ない安全網)。
- **非ログイン中にDB(認証プール)大会を開こうとした場合**: **ブロックしない。** 「過去の大会のログは閲覧のみ可」という要件があるため、`isReadOnlyView()`が真になり、**編集UIを一切出さない読み取り専用**で大会詳細(進行中・過去とも)を閲覧できる。具体的には: 編集する/終了する/削除ボタン、組み合わせ決定(自動抽選・エントリー導線)、対戦表の枠タップ・D&D・⚔️勝敗入力・シード➕・進行ボタン・3位決定戦の⚔️勝敗入力、保存ボタンを全て非表示にする。`tournament-entry.html`も同じ判定(`isBlocked()`)で直接アクセスをブロックし、編集の抜け道を塞ぐ。非破壊的な操作(📸画像保存・次の対戦へジャンプ)はreadOnly中も利用可能なまま残す。
- 結果として、**非ログイン状態で編集できるのは「ローカル」タグの付いた練習用大会のみ**になる。DB大会は認証済み(ログイン)状態でのみ編集可能。

## 「ローカル」タグ

大会一覧(`tournaments.html`)・TOPの開催中の大会(`index.html`)・大会詳細(`detail-view.js`)のいずれも、練習用(ゲストプール)の大会には「進行中」等のステータスバッジの隣に「ローカル」タグを表示し、DB大会と区別できるようにしている。`tournaments.html`は現在、認証プールとゲストプールの大会を1本のリストに統合し、このタグだけで見分ける方式(以前の「別セクション表示」から変更)。

## 既存データとの関係

`STORE_KEY`(`atsucup:state:v2`)はバージョンを上げていない。この機能導入前から存在した`state.roster`/`state.tournaments`は、そのまま認証プールとして扱われる。

---

---

## セッション切れバナーの共通化(2026-07-28)

以前は`detail-view.js`の「エントリーがまだ無い大会」の分岐でだけ、しかもページ**上部**に出していた。対戦表が縦に長い大会では下までスクロールすると気づけず、「編集したのに保存できない」状態に陥っていた。

`atsucup-core.js`の`initSessionExpiredBanner()`に共通化し、**全ページで画面下部に固定表示**する(`initUpdateBanner`と同じ自動起動パターン。更新通知バナーは上部固定なので位置は競合しない)。
「再ログイン」は表示できない環境があるOne Tapを直接呼ばず、確実なGISログインボタンを持つ`settings.html?reauth=1`へ誘導する。設定画面上では同じボタンが`#signinArea`までスクロールする。

- CSSは`atsucup-style.css`の`.atsucup-session-banner`。`z-index:9997`で競合モーダル(9999)・resyncトースト(9998)より下にし、モーダル表示中は隠れるようにしている
- 表示中は`body`に`padding-bottom`を足してページ末尾のコンテンツが隠れないようにする(実測の高さを`--atsucup-bottom-bar`で共有し、`showAuthResyncNotice`の下部トーストもその分だけ持ち上げる)
- トークンは時間経過で切れるが「切れた瞬間の通知」は無いので、`setInterval`(1分)+`visibilitychange`+`GoogleAuth.onStateChange`で追従する
- **閉じるボタンは付けない**。セッション切れは再ログイン以外で解消せず、閉じられると「編集したのに保存できない」状態に静かに戻るだけのため
- `tournament-entry.html`のブロック画面内の説明は**残している**(「なぜこの画面が丸ごと使えないか」という画面固有の理由説明で、下部バーとは目的が違う)

## Googleログインのセッション切れ時のUX（2026-07-27追加）

GoogleのIDトークンは有効期限が約1時間で固定(Google側の仕様、アプリからは延長不可)。以前は期限切れになると`isGuestMode()`が無音でtrueになり、DB大会の閲覧が突然「読み取り専用」表示に切り替わるだけでなく、大会詳細画面ではエントリー関連UIが丸ごと空白になっていた(フォールバック表示の条件が`!readOnly`を要求していたため)。

- `detail-view.js`の`render()`のフォールバックを、`readOnly`でも何かしら(閲覧のみの空き状態)表示するよう修正(空白になるバグ自体の根本修正)
- `google-auth.js`に`sessionStorage`マーカー`atsucup:hadSession`を追加(トークンを一度でも持ったら立てる、`signOut()`でのみクリア、期限切れでは消さない)。`GoogleAuth.sessionExpired()`で「未ログイン」と「ログインしていたが期限切れ」を区別し、後者の場合は`detail-view.js`/`tournament-entry.html`の読み取り専用表示に再ログインを促すバナーを追加で出す
- ベストエフォートの自動延長として、トークンの`exp`の5分前を目安に`google.accounts.id.prompt({auto_select:true})`による無音の再認証を一度だけ試みる(`scheduleRenewal`/`attemptSilentRenewal`)。成功すれば気づかれずに継続、失敗しても何もしない(上記のバナーが保険)。**IDトークン自体の寿命は延長できないため、これはあくまで気づかれる前に再認証を試みる対症療法**であることに注意
