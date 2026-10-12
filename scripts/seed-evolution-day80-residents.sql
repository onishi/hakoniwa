-- DAY 76-80 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (76, '丘と小川に、それぞれの話をする住人が現れました。', 'published'),
  (77, '同じ水辺の出来事も、住人によって違う言葉になります。', 'published'),
  (78, '丘で採った石のかけらを、住人へ渡せます。', 'published'),
  (79, '木材を水辺の住人へ渡すと、風の種と交換できます。', 'published'),
  (80, '住人は前に渡したものを覚え、再訪に短い言葉を返します。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 76 AND 80;

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('hill-resident', 'resident', 11, 10, 1, 1, 'map-hill-resident', '丘を見守る住人',
    '丘の石と林の様子を見ている住人です。', 0, 0, 76),
  ('stream-resident', 'resident', 15, 11, 1, 1, 'map-stream-resident', '小川を見守る住人',
    '流れと魚影を見ている住人です。', 0, 0, 76);

-- Inventory and trace metadata. born_day = gone_day keeps it out of the shared map.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day, gone_day)
VALUES ('item-windseed', 'item', 0, 0, 1, 1, 'map-seed', '風の種',
  '小川の住人から受け取った種です。庭に植えられます。', 0, 0, 79, 79);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (76, 'entity_added', '{"entity_key":"hill-resident"}'),
  (76, 'entity_added', '{"entity_key":"stream-resident"}');
