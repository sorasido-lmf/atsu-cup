// GAS連携の設定値。デプロイやOAuthクライアントを作り直したらここだけ書き換える。
//
// GAS_URL          : GASを「ウェブアプリ」としてデプロイしたときの /exec URL
//                    ※「デプロイを管理 → 編集 → 新バージョン」で更新する限りURLは変わらない。
//                      「新しいデプロイ」を作るとURLが変わるので注意。
// OAUTH_CLIENT_ID  : GCPで作成したOAuth 2.0 クライアントID(ウェブアプリケーション)
//                    ※GAS側のScript Properties OAUTH_CLIENT_ID と同じ値にすること。
//                      ここがズレると、GASのaud検証で必ず弾かれる。
const AtsuCupGasConfig = {
  GAS_URL: "",
  OAUTH_CLIENT_ID: ""
};
