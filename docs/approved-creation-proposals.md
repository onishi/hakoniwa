# 承認済み創造提案

世界の自動更新は、AIが本番DBへ直接書き込む構成にしない。提案は外部で生成・人間がレビューし、承認後に `world_creation_proposals` へ投入する。公開Workerには提案投入APIを設けない。

## Proposal v1

現在許可する変更は、共有世界への存在と地形の追加だけである。削除・上書き・プレイヤーデータ変更は拒否する。1提案は最大32操作、座標は翌日のマップ内に限り、既存または同一提案内のキー・地形座標との衝突も拒否する。

```json
{
  "version": 1,
  "kind": "creation",
  "title": "苔むす標石",
  "oracle": "小道のそばに、小さな標石を置きました。",
  "operations": [
    {
      "kind": "add_entity",
      "value": {
        "key": "moss-marker",
        "kind": "stone",
        "x": 4,
        "y": 4,
        "width": 1,
        "height": 1,
        "sprite": "map-moss-marker",
        "label": "苔むす標石",
        "message": "苔の下に古い印があります。",
        "panel": null,
        "flat": false,
        "blocks": true
      }
    },
    {
      "kind": "add_tile",
      "value": { "x": 4, "y": 5, "kind": "moss", "elevation": 0, "traversal": "ground" }
    }
  ]
}
```

`traversal` は `ground`、`slope`、`water` のいずれか。`key`、`kind`、`sprite`、`panel` は小文字英数字とハイフンのみを使う。提案JSON以外に、承認者、生成モデル名、生成に使ったプロンプトのSHA-256を台帳へ保存する。

## 適用と安全性

次回の定期実行は、直前の公開日を `source_world_day` とする `approved` 提案だけを選ぶ。WorkerがProposal v1を再検証した後、以下を単一のD1バッチで行う。

1. 翌日をdraftとして作る。
2. 決定的な遷移、入出力ハッシュ、期待スナップショットを記録する。
3. 承認済みの追加操作を適用する。
4. 日と創造runを公開し、実スナップショットが期待値と一致することをDBトリガーで確認する。
5. 提案を `applied` にして公開runへ結びつける。

どこかで失敗すれば全操作がロールバックされ、前日の公開世界が残る。承認提案がなければ、従来どおり何も追加しない `silence-v1` runを記録する。

提案の投入自体は運用者がWrangler経由で行う。JSONはSQLへ直接連結せず、ファイル入力またはパラメータ化した手段を使うこと。投入後も `daily_advance` を明示的に有効化するまでは世界日は進まない。
