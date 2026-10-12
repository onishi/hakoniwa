-- DAY 71-75 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (71, '小川のそばに、細い羽のトンボが現れました。', 'published'),
  (72, 'トンボは水面と草の間を行き来します。', 'published'),
  (73, '飛び方を見守るだけでも、観察記録を残せます。', 'published'),
  (74, '魚を戻した水辺では、トンボの飛び方も違って見えます。', 'published'),
  (75, '昨日見た水辺へ戻ると、同じ飛ぶ道をたどれます。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CLAUDE', oracle FROM world_days WHERE world_day BETWEEN 71 AND 75;

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES ('stream-dragonfly', 'creature', 14, 11, 1, 1, 'map-stream-dragonfly', '小川のトンボ',
  '水面と草の間を行き来するトンボです。', 0, 0, 71);

INSERT INTO creation_events (world_day, kind, payload)
  VALUES (71, 'entity_added', '{"entity_key":"stream-dragonfly"}');
