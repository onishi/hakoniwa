-- DAY 66-70 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (66, '小川が少し広がり、流れの筋が見えます。', 'published'),
  (67, '流れの端に、池とは違う細い魚影が現れました。', 'published'),
  (68, '小川の魚影を、釣らずに見守れます。', 'published'),
  (69, '借りた竿で小川の魚を釣り、流れへ戻せます。', 'published'),
  (70, '戻した魚影の通り道を、また見に行けます。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 66 AND 70;

INSERT OR IGNORE INTO world_tiles (x, y, kind, elevation, traversal, born_day)
  VALUES (13, 12, 'stream', 0, 'water', 66);

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES ('stream-fish', 'creature', 13, 12, 1, 1, 'map-stream-fish', '流れの魚影',
  '小川の流れに沿って、細い魚影が泳いでいます。', 1, 0, 67);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (66, 'terrain_added', '{"region":"stream-pool"}'),
  (67, 'entity_added', '{"entity_key":"stream-fish"}');
