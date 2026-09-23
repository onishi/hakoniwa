# Cloudflare Pagesへのデプロイ

このプロジェクトの静的フロントエンドを Cloudflare Pages の `hakoniwa` プロジェクトへ直接アップロードする手順をまとめる。

## 現在の設定

- ビルドコマンド: `npm run build`
- 出力先: `dist/`
- Pagesプロジェクト: `hakoniwa`
- 本番ブランチ: `main`
- デプロイコマンド: `npm run deploy`
- SPAフォールバック: `public/_redirects`
- HTTPヘッダー: `public/_headers`

設定元は [`package.json`](../package.json)、[`wrangler.jsonc`](../wrangler.jsonc)、[`public/`](../public/) にある。`dist/` は生成物なのでGitへコミットしない。

## 初回準備

Node.jsとnpmを用意し、リポジトリのルートで依存関係をインストールする。

```bash
npm install
```

開発者の端末から公開する場合は、ブラウザを使ってCloudflareへログインする。

```bash
npx --yes wrangler@4.86.0 login
npx --yes wrangler@4.86.0 whoami
```

`whoami` で意図したCloudflareアカウントが表示され、Pagesへの書き込み権限があることを確認する。認証情報やAPIトークンはリポジトリへ保存しない。

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

両方が成功するまでデプロイしない。

### 3. Pagesへ公開する

```bash
npm run deploy
```

このスクリプトは再度ビルドした後、次の処理を実行する。

```bash
npx --yes wrangler@4.86.0 pages deploy dist --branch main
```

成功すると、Cloudflareからデプロイ固有の `*.pages.dev` URLが返される。`main` を指定しているため、Pagesプロジェクトの本番デプロイとして扱われる。

### 4. 公開結果を確認する

```bash
curl -I https://<deployment-id>.hakoniwa-5hg.pages.dev
```

最低限、次を確認する。

- HTTPステータスが `200`
- HTML、JavaScript、CSSが読み込める
- 直接URLを開いた場合もSPAが表示される
- `public/_headers` のセキュリティヘッダーが付与されている
- 主要な画面とキーボード／タッチ操作が動作する

## CIからデプロイする場合

対話ログインの代わりに、Cloudflareで発行した権限を絞ったAPIトークンをCIのシークレットへ登録する。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

トークン値を `.env`、シェルスクリプト、ログ、Git管理ファイルへ書かない。Pagesへのデプロイに必要な対象アカウントとプロジェクトだけへ権限を限定する。

## トラブル対応

### `tsc` または `eslint` が見つからない

依存関係が未導入である。

```bash
npm install
```

### 認証エラーになる

```bash
npx --yes wrangler@4.86.0 whoami
```

ログイン先と権限を確認し、必要なら `wrangler login` をやり直す。複数アカウントを使っている場合は、意図しないアカウントへ公開しないよう特に注意する。

### デプロイ後に画面が更新されない

デプロイ固有URLで新しい成果物を確認する。`/assets/*` には長期キャッシュが設定されているが、Viteがファイル名へ内容ハッシュを付けるため、正常なビルドでは新しいURLに切り替わる。

### 公開版に問題がある

追加のデプロイを急ぐ前に、Cloudflare Dashboardの Pages プロジェクトで直前の正常なデプロイを確認する。再公開またはロールバック時は、対象のコミットとデプロイIDを記録し、公開後に同じ確認項目を再実施する。

## 参考資料

- [Cloudflare Pages: Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
