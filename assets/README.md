# 静的アセット

## backgrounds

2026-08-04にプロジェクト所有者から、非キャラクターUI刷新用の背景素材として提供された画像。
ファイル名末尾の`-v1`をキャッシュ更新キーとして扱い、画像内容を差し替える場合は番号を上げる。

| ファイル | 用途 |
|---|---|
| `backgrounds/festival-colosseum-main-desktop-v1.png` | ホーム系画面のデスクトップ背景 |
| `backgrounds/festival-colosseum-main-mobile-v1.png` | ホーム系画面のモバイル背景 |
| `backgrounds/festival-colosseum-tournament-desktop-v1.png` | トーナメント画面のデスクトップ背景（Phase 3で使用予定） |
| `backgrounds/colosseum/top-settings-desktop-v1.png` | TOP・設定画面のデスクトップ背景 |
| `backgrounds/colosseum/top-settings-mobile-v1.png` | TOP・設定画面のモバイル背景 |
| `backgrounds/colosseum/tournament-list-desktop-v2.png` | 大会一覧のデスクトップ背景 |
| `backgrounds/colosseum/tournament-list-mobile-v2.png` | 大会一覧のモバイル背景 |
| `backgrounds/colosseum/lobby-desktop-v2.png` | 戦績・ユーザー管理画面のデスクトップ背景 |
| `backgrounds/colosseum/lobby-mobile-v2.png` | 戦績・ユーザー管理画面のモバイル背景 |

元PNGを正式素材として保持する。現時点ではリポジトリに再現可能なWebP/AVIF変換ツールチェーンがないため、派生形式は追加しない。

## icons/headings

一般ユーザー向けページの見出し（`.crown-mark`）で使用する透過PNG。
大会系・戦績系の複数ページは、それぞれ共通のアイコンを使用する。
TOPの各メニューカードと大会詳細のエントリー導線にも、対応する見出しアイコンを使用する。
`page-home-v1.png`はサイト共通のファビコンとしても使用する。
ファイル名末尾の`-v1`をキャッシュ更新キーとして扱い、画像内容を差し替える場合は番号を上げる。

## guide-assistant

対象ページ右上の案内表示で使う助手キャラクターの透過PNG。
プロジェクト所有者から提供された元PNGを加工せず、元ファイルの`00`〜`08`を
`assistant-01.png`〜`assistant-09.png`へ対応させて格納している。
9枚すべてが`guide-assistant.js`のランダム抽選対象。
