// GAS連携の設定値。デプロイやOAuthクライアントを作り直したらここだけ書き換える。
//
// GAS_URL          : GASを「ウェブアプリ」としてデプロイしたときの /exec URL
//                    ※「デプロイを管理 → 編集 → 新バージョン」で更新する限りURLは変わらない。
//                      「新しいデプロイ」を作るとURLが変わるので注意。
// OAUTH_CLIENT_ID  : GCPで作成したOAuth 2.0 クライアントID(ウェブアプリケーション)
//                    ※GAS側のScript Properties OAUTH_CLIENT_ID と同じ値にすること。
//                      ここがズレると、GASのaud検証で必ず弾かれる。
//
// この2つはリポジトリにコミットされる公開値。設計上それで問題ない:
//   ・クライアントIDは元々ブラウザに露出する前提の値
//   ・GAS_URLは「URLを知っていれば叩ける」前提で、防御はGAS側のトークン検証で行っている
// 秘密にすべきGitHub PATは、GASのScript Properties(サーバ側)にのみ存在する。
const AtsuCupGasConfig = {
  GAS_URL: "https://script.google.com/macros/s/AKfycbzPppR_iTQr8F4_uupCv8mAYG-zLTeAZ93GM32oyCqVQMRAaT2HLRUP-FioZ_dwS_2Y/exec",
  OAUTH_CLIENT_ID: "632087355084-kkge6gtiku4kcn45qsth0ji5d924ban0.apps.googleusercontent.com"
};
