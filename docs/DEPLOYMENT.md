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

## ロールバック

Cloudflare DashboardまたはWranglerで、直前の正常なWorkerバージョンを確認してロールバックする。コードのロールバックと、D1やR2など接続先データのロールバックは別であるため、将来バインディングを追加した場合はデータの整合性を個別に確認する。

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
