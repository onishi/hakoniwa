-- DAY 51-55 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (51, '泉の虫を追う、小さな鳥が現れました。', 'published'),
  (52, '鳥は泉と草の巣を行き来します。', 'published'),
  (53, '巣のそばに、軽い羽の跡が残りました。', 'published'),
  (54, '泉の生き物は増えすぎず、居場所を分けています。', 'published'),
  (55, '花と水と泉を知る庭に、訪問者が戻ります。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 51 AND 55;

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('east-bird', 'creature', 14, 15, 1, 1, 'map-east-bird', '泉の小鳥', '泉辺の虫を見つめ、巣のある草へ短く飛び戻ります。', 0, 0, 51),
  ('east-nest', 'ecology', 14, 16, 1, 1, 'map-east-nest', '草の巣', '泉の小鳥が戻る巣です。草の間に浅いくぼみがあります。', 0, 0, 52);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (51, 'entity_added', '{"entity_key":"east-bird"}'),
  (52, 'entity_added', '{"entity_key":"east-nest"}');
