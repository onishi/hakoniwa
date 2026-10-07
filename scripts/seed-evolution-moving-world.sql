-- Apply only to the isolated evolution database after the fishing migration.
-- The historical DAY 5/7 entries are preview candidates, not production history.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('shore-creature', 'creature', 9, 8, 1, 1, 'map-shore-creature', '岸辺の小さな生き物', '近づくと立ち止まり、また岸辺を歩き出します。', 0, 0, 5),
  ('fishing-rod', 'fishing-rod', 6, 8, 1, 1, 'map-fishing-rod', '借りられる釣り竿', '池のそばに置かれた竿です。', 0, 0, 7);
