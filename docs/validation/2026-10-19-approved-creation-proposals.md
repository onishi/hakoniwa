# 承認済み創造提案の検証 — 2026-10-19

## 対象

- commit: `3905895`
- migration: `0025_creation_proposals.sql`
- evolution Worker version: `3cf00464-183e-401f-9d76-1e20659a865f`
- production: 未変更

## 自動検証

以下をすべて成功確認した。

- `npm test`: Node 7件、Python 10件
- `npm run lint`
- `npm run build`
- `npm run typecheck:worker`
- `git diff --check`
- `wrangler deploy --dry-run --config wrangler.evolution.jsonc`
- 空のローカルD1へ `0001`〜`0025` を通しで適用

テストは、承認提案の決定性、存在・地形追加、SQLスナップショット順、既存キー衝突、未知フィールド、範囲外座標、DBの翌日制約、適用runとの参照整合性、不正JSONと不正ハッシュの拒否を含む。

## evolution反映後

- `0025_creation_proposals.sql`: 適用済み
- `world_creation_proposals`: 0件（検証用提案は投入していない）
- 最新世界日: DAY99
- DAY100のDB行: 0件
- `/`: HTTP 200
- `/api/world`: HTTP 200
- `/api/world-history/100`: HTTP 404

evolutionは `APP_MODE=evolution` のためscheduled更新を実行しない。DAY100を公開せず、承認キューとWorkerの受け入れ経路だけを先行配置した。
