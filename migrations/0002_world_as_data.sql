-- 世界をコードからデータへ移す。
-- 以降、新しい存在の追加はこのデータベースへの書き込みだけで完結し、デプロイを必要としない。

-- 世界日の台帳。oracle が NULL の日は「神が何も創らなかった日」として残す。
CREATE TABLE world_days (
  world_day INTEGER PRIMARY KEY,
  oracle TEXT,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 追記型の創造ログ。過去の行は書き換えず、訂正も新しい行として足す。
CREATE TABLE creation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_day INTEGER NOT NULL REFERENCES world_days(world_day),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX creation_events_day_idx ON creation_events(world_day, id);

-- 存在。誕生日と消滅日を持ち、消えたものも行として残す。
-- blocks は当たり判定であり、見た目の大きさ（width/height）とは別に持つ。
CREATE TABLE world_entities (
  entity_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 1,
  height INTEGER NOT NULL DEFAULT 1,
  sprite TEXT NOT NULL,
  label TEXT NOT NULL,
  message TEXT NOT NULL,
  panel TEXT,
  flat INTEGER NOT NULL DEFAULT 0,
  blocks INTEGER NOT NULL DEFAULT 1,
  born_day INTEGER NOT NULL,
  gone_day INTEGER
);

CREATE INDEX world_entities_life_idx ON world_entities(born_day, gone_day);

-- 地形。既定の草地と異なるタイルだけを持つ。
CREATE TABLE world_tiles (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  kind TEXT NOT NULL,
  born_day INTEGER NOT NULL,
  gone_day INTEGER,
  PRIMARY KEY (x, y)
);

-- Day 1。これまでクライアントのコードに書かれていた世界を、最初の創造として記録する。
INSERT INTO world_days (world_day, oracle)
VALUES (1, '土と木と池を創りました。あなたが来てくれて、うれしい。');

INSERT INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
  ('tree', 'plant', 3, 3, 1, 1, 'map-tree', 'はじまりの木', '世界で最初の木。葉の間で、風が眠っています。', NULL, 0, 1, 1),
  ('house', 'structure', 7, 2, 2, 2, 'map-house', '小さな家', '小さな家です。中には、まだ誰もいません。', NULL, 0, 1, 1),
  ('well', 'structure', 5, 6, 1, 1, 'map-well', '古い井戸', '古い井戸です。水の音はしません。', NULL, 0, 1, 1),
  ('wish-board', 'structure', 2, 8, 1, 1, 'map-wish-board', '願いの掲示板', '願いを、ひとつだけ。', 'wish', 0, 1, 1),
  ('pond', 'water', 7, 7, 2, 2, 'map-pond', '静かな池', '底はまだ見えません。生き物の気配はありません。', NULL, 1, 1, 1);

-- 十字の小道。歩ける範囲（1〜10）に沿って敷く。
INSERT INTO world_tiles (x, y, kind, born_day) VALUES
  (1, 6, 'path', 1), (2, 6, 'path', 1), (3, 6, 'path', 1), (4, 6, 'path', 1), (5, 6, 'path', 1),
  (6, 6, 'path', 1), (7, 6, 'path', 1), (8, 6, 'path', 1), (9, 6, 'path', 1), (10, 6, 'path', 1),
  (5, 1, 'path', 1), (5, 2, 'path', 1), (5, 3, 'path', 1), (5, 4, 'path', 1), (5, 5, 'path', 1),
  (5, 7, 'path', 1), (5, 8, 'path', 1), (5, 9, 'path', 1), (5, 10, 'path', 1);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (1, 'world_created', '{"note":"はじまりの庭。土と小道と、五つの存在。"}'),
  (1, 'entity_added', '{"entity_key":"tree"}'),
  (1, 'entity_added', '{"entity_key":"house"}'),
  (1, 'entity_added', '{"entity_key":"well"}'),
  (1, 'entity_added', '{"entity_key":"wish-board"}'),
  (1, 'entity_added', '{"entity_key":"pond"}');
