-- DAY 61-65 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (61, '林の先に丘と細い小川が見つかりました。', 'published'),
  (62, '丘の高い面と、登り口の斜面が見えます。', 'published'),
  (63, '段差は斜面から登り、水面では足を止めます。', 'published'),
  (64, '斜面を登り、小川を渡れるようになりました。', 'published'),
  (65, '丘の石を採り、作業台の材料にできます。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 61 AND 65;

INSERT OR IGNORE INTO world_tiles (x, y, kind, elevation, traversal, born_day) VALUES
  (10,11,'forest',0,'ground',61),(11,11,'forest',0,'ground',61),(12,11,'forest',0,'ground',61),
  (10,12,'hill',1,'ground',61),(11,12,'hill',1,'ground',61),(12,12,'hill',1,'ground',61),
  (10,13,'hill',1,'ground',61),(11,13,'hill',1,'ground',61),(12,13,'hill',1,'ground',61),
  (10,14,'hill',1,'ground',61),(11,14,'hill',1,'ground',61),(12,14,'hill',1,'ground',61),
  (13,13,'slope',1,'slope',62),(13,14,'slope',1,'slope',62),
  (14,12,'stream',0,'water',61);

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES ('source-hill-stone', 'source', 11, 13, 1, 1, 'map-stone', '丘の石',
  '斜面を登った先の石です。採ると作業台で使える石のかけらになります。', 0, 1, 65);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (61, 'terrain_added', '{"region":"east-hill-and-stream"}'),
  (65, 'entity_added', '{"entity_key":"source-hill-stone"}');
