# Cloudflare Workersへのデプロイ

このプロジェクトは、Viteのビルド成果物を Cloudflare Workers の静的アセットとして配信する。Cloudflare Pagesは使用しない。

## 現在の設定

- Worker名: `hakoniwa`
- ビルドコマンド: `npm run build`
- 静的アセット: `dist/`
- API・認証・定期撮影: `worker/index.ts`
- 永続データ: D1 `hakoniwa-db`
- 日次画像: R2 `hakoniwa-screenshots`
- 画面撮影: Browser Rendering（毎日15:05 UTC / 0:05 JST）
- デプロイコマンド: `npm run deploy`
- 公開先: `workers.dev`
- SPAフォールバック: `assets.not_found_handling = "single-page-application"`
- API優先ルーティング: `assets.run_worker_first = ["/api/*"]`
- HTTPヘッダー: `public/_headers`

設定元は [`package.json`](../package.json)、[`wrangler.jsonc`](../wrangler.jsonc)、[`public/_headers`](../public/_headers) にある。`dist/` は生成物なのでGitへコミットしない。

## 初回準備

Node.jsとnpmを用意し、ロックファイルに従って依存関係をインストールする。

```bash
npm install
```

Wranglerはプロジェクトの開発依存としてバージョンを固定している。グローバルインストールは不要である。

開発者の端末から公開する場合はCloudflareへログインし、意図したアカウントであることを確認する。

```bash
npx wrangler login
npx wrangler whoami
```

認証情報やAPIトークンはリポジトリへ保存しない。

## 初回リソース設定

D1とR2を一度だけ作成する。

```bash
npx wrangler d1 create hakoniwa-db
npx wrangler r2 bucket create hakoniwa-screenshots
```

D1作成時に表示されたIDを `wrangler.jsonc` の `database_id` へ設定し、マイグレーションを適用する。

```bash
npx wrangler d1 migrations apply hakoniwa-db --remote
```

次の秘密値を対話入力で登録する。値をファイルへ書かない。

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_TOKEN
```

Google Cloud Consoleでは承認済みリダイレクトURIを `https://<公開ホスト>/api/auth/google/callback` にする。GitHubトークンには対象リポジトリへIssueを作成する最小権限だけを付け、リポジトリには `wish` ラベルを作成する。`PUBLIC_ORIGIN`、`GITHUB_OWNER`、`GITHUB_REPO` は `wrangler.jsonc` の通常変数として公開先に合わせる。

Browser RenderingはWorkers Paid planの利用条件と上限を確認して有効にする。Cronの実行時刻はUTCで記述する。

## 本番デプロイ

### 1. 作業状態を確認する

```bash
git status --short --branch
```

原則として、公開する変更が `main` にコミットされ、リモートと同期している状態で実行する。

### 2. 品質チェックを実行する

```bash
npm run lint
npm run build
```

### 3. Workers用パッケージを検証する

```bash
npx wrangler deploy --dry-run
```

静的アセット、設定、アップロード対象を確認する。Dry runはCloudflare上のリソースや実際の応答までは検証しない。

### 4. Workersへ公開する

```bash
npm run deploy
```

このスクリプトはビルド後に `wrangler deploy` を実行する。成功すると `hakoniwa.<subdomain>.workers.dev` のような公開URLが返される。

### 5. 公開結果を確認する

```bash
curl -I https://<worker-url>.workers.dev
```

最低限、次を確認する。

- HTTPステータスが `200`
- HTML、JavaScript、CSSが読み込める
- 直接URLを開いた場合もSPAへフォールバックする
- `public/_headers` のセキュリティヘッダーが付与されている
- 主要なキーボード／タッチ操作が動作する
- Googleログイン後、再読み込みして位置が復元される
- 同意した願いが公開Issueになり、7日以内の再投稿が拒否される
- Cron実行後、創世日記へ当日の画像が表示される

## 世界日を動かす

世界はD1にあり、`world_settings.daily_advance` が世界日の自動進行を握っている。初日を公開するまでは `off` にしておく。この間、Cronは画像の撮り直しだけを行い、世界日は進まない。

**Day 1を基準として保ち、Day 5・10の候補を先に試す間は、本番の設定を `off` のままにする。** 下の `on` への変更は現行機能の説明であり、検証済み候補の承認・公開を行う手順ではない。実際にDay 2を公開する前に、[開発検証と公開ゲート](DEVELOPMENT_VALIDATION.md) を実装・実証する。

```bash
# 今の状態を見る
npx wrangler d1 execute hakoniwa-db --remote --command "SELECT key, value FROM world_settings"

# 公開ゲートを実装・検証し、承認済みの日を自動進行させる場合だけ実行する
npx wrangler d1 execute hakoniwa-db --remote --command "UPDATE world_settings SET value='on' WHERE key='daily_advance'"
```

`on` にすると、翌朝のCron（日本時間0:05）から世界日が進む。創造の提案がまだない間、新しい日は沈黙として記録される。

世界日は `draft` として作られ、その日の仕事が終わったときだけ `published` になる。読み取りAPIは `published` の最新日しか返さないため、日次処理が途中で落ちた日は、観測者には前日の世界が見え続ける。落ちた日を調べるには次を使う。

```bash
npx wrangler d1 execute hakoniwa-db --remote --command "SELECT world_day, status, oracle FROM world_days ORDER BY world_day DESC LIMIT 5"
```

`draft` のまま残った日は、原因を直してから手で `published` にするか、行を消して翌日やり直す。**公開済みの日は書き換えない。** 訂正は新しい `creation_events` として足す。

## 世界へ何かを足す

存在を増やすのにデプロイは要らない。D1へ書き込むだけで、描画、当たり判定、観察文がまとめて変わる。

```bash
npx wrangler d1 execute hakoniwa-db --remote --command "
INSERT INTO world_entities (entity_key, kind, x, y, sprite, label, message, born_day)
VALUES ('sapling', 'plant', 4, 4, 'map-tree', '若木', 'まだ名前がありません。', 2);"
```

`creation_events` へ書く必要はない。**トリガーが、その存在の全項目を含む履歴を自動で残す。** 訂正も同じで、`UPDATE` すれば前後の状態が追記される。

```bash
# 訂正。前の姿と後の姿が履歴に残る
npx wrangler d1 execute hakoniwa-db --remote --command "
UPDATE world_entities SET message='芽が、少しだけ伸びました。' WHERE entity_key='sapling';"

# 消すとき。行は削除せず gone_day を立てる
npx wrangler d1 execute hakoniwa-db --remote --command "
UPDATE world_entities SET gone_day=5 WHERE entity_key='sapling';"
```

`sprite` はCSSクラス名であり、現時点では手書きの図形（`map-tree` など）しか選べない。

**行を `DELETE` しない。** 消滅は `gone_day` で表し、図鑑では「現在は確認されていない」として残す。削除した場合もその事実だけは履歴に残るが、消えた姿は戻らない。

## ローカル確認

画面実装の開発にはViteを使う。

```bash
npm run dev
```

Workersの静的アセット配信設定まで含めて確認する場合は、先にビルドしてWranglerを起動する。

```bash
npm run build
npx wrangler dev
```

ローカルD1へ初期スキーマを入れる場合は次を実行する。

```bash
npx wrangler d1 migrations apply hakoniwa-db --local
```

## CIからデプロイする場合

対話ログインの代わりに、対象Workerへ必要最小限の権限を持つAPIトークンをCIのシークレットへ登録する。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

トークン値を `.env`、シェルスクリプト、ログ、Git管理ファイルへ書かない。

## バックアップと復元

世界はD1にあるため、コードのロールバックと世界の復元は別の操作になる。**コードを戻しても、消えた行は戻らない。**

### 世界の書き出し

危険な操作（マイグレーション、まとめての書き換え、創造の一括適用）の前に取る。

```bash
npx wrangler d1 export hakoniwa-db --remote --output=backup-$(date +%Y%m%d).sql
```

全テーブルのスキーマとデータがSQLとして落ちる。保管先はリポジトリの外にする。

### 時点への巻き戻し

D1のTime Travelで、過去の時点へ戻せる。まず現在地のブックマークを控える。

```bash
npx wrangler d1 time-travel info hakoniwa-db
npx wrangler d1 time-travel restore hakoniwa-db --timestamp=2026-09-28T00:00:00Z
```

**巻き戻しは世界の歴史を消す操作である。** 過去を上書きしないという約束に反するため、事故で壊れた場合の最後の手段とし、通常の訂正は新しい `creation_events` として足す。

### 画像

日次スクリーンショットはR2の `hakoniwa-screenshots` にあり、D1の巻き戻しでは戻らない。D1を過去へ戻した場合、`world_days.screenshot_key` が指す画像と実体の対応を確認する。

## ロールバック

Cloudflare DashboardまたはWranglerで、直前の正常なWorkerバージョンを確認してロールバックする。コードのロールバックと、D1やR2など接続先データのロールバックは別である。

**マイグレーションを含むデプロイを戻すときは順序に注意する。** 新しいコードは新しいテーブルを前提にしているため、コードだけを戻すと動かなくなる場合がある。世界の表示に関わる変更では、先に書き出しを取ってから進める。

## トラブル対応

### `wrangler`、`tsc`、`eslint`が見つからない

```bash
npm install
```

### 認証エラーになる

```bash
npx wrangler whoami
```

ログイン先と権限を確認し、必要なら `npx wrangler login` をやり直す。

### APIを開くとゲーム画面が表示される

[`wrangler.jsonc`](../wrangler.jsonc) の `assets.run_worker_first` に `/api/*` が含まれていることを確認する。SPAフォールバックより先にWorkerを実行しないと、APIパスにも `index.html` が返る。

### 画面内のURLで404になる

[`wrangler.jsonc`](../wrangler.jsonc) の `assets.not_found_handling` が `single-page-application` であることを確認する。Pages用の `_redirects` は使用しない。

### デプロイ後に画面が更新されない

ビルド時に出力されたアセット名とWorkerのデプロイバージョンを確認する。Viteはファイル名へ内容ハッシュを付けるため、正常なビルドでは新しいURLへ切り替わる。

## 参考資料

- [Cloudflare: PagesからWorkersへの移行](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
