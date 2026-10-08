-- Candidate Day 12-15 content for the isolated evolution database only.
-- Publish each entity with its own world day when preparing the new public timeline.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('insect-grass', 'insect-habitat', 3, 7, 1, 1, 'map-insect-grass', '虫のいる草むら', '葉の間に、小さな羽音がします。', 0, 0, 12),
  ('insect-net', 'insect-net', 4, 8, 1, 1, 'map-insect-net', '借りられる網', '小さな網が立てかけてあります。', 0, 0, 13),
  ('insect-flowers', 'insect-flowers', 3, 9, 1, 1, 'map-insect-flowers', '岸辺の花', '虫が戻れる花です。', 0, 0, 14);
