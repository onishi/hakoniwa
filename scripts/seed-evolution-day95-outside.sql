-- DAY 91-95 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (91, '東の道が村の外の草原へつながりました。', 'published'),
  (92, '外へ出る足取りを記録し、帰ると道に慣れていきます。', 'published'),
  (93, '草原に気の荒い獣が現れました。道を選べば避けられます。', 'published'),
  (94, '獣には近づかず、落ち着かせる道もあります。', 'published'),
  (95, '力尽きても村の入口へ戻れます。持ち物は失いません。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 91 AND 95;

-- The 18x18 garden grows four columns to the east. A continuous path marks the crossing.
WITH RECURSIVE columns(x) AS (SELECT 17 UNION ALL SELECT x + 1 FROM columns WHERE x < 20),
  rows(y) AS (SELECT 1 UNION ALL SELECT y + 1 FROM rows WHERE y < 16)
INSERT OR IGNORE INTO world_tiles (x, y, kind, elevation, traversal, born_day)
  SELECT x, y, CASE WHEN y = 10 THEN 'path' ELSE 'field' END, 0, 'ground', 91
  FROM columns CROSS JOIN rows;

INSERT OR IGNORE INTO world_tiles (x, y, kind, elevation, traversal, born_day)
  VALUES (16, 10, 'path', 0, 'ground', 91);

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('field-marker', 'landmark', 18, 10, 1, 1, 'map-field-marker', '外へ続く道標',
    'この先は村の外です。草原の道は広く、戻る道も見えます。', 0, 0, 91),
  ('field-stray', 'hazard', 19, 11, 1, 1, 'map-field-stray', '草原の獣',
    '草原の獣が道の脇にいます。遠回りすれば接触せずに進めます。', 0, 1, 93);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (91, 'terrain_added', '{"region":"east-field"}'),
  (93, 'entity_added', '{"entity_key":"field-stray"}');
