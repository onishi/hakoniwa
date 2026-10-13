-- DAY 81-85 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (81, '世界の時計が動き始めました。今の時刻はみんなに同じです。', 'published'),
  (82, '夕方と夜には、池と草地の色が静かに変わります。', 'published'),
  (83, '雨が通り過ぎる日があります。水辺の見え方を確かめてください。', 'published'),
  (84, '芽吹きから霜まで、世界は長い周期も持つようになりました。', 'published'),
  (85, '雨の夕暮れに地衣類の石を調べると、別の石が見つかります。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 81 AND 85;

-- Inventory metadata only; born_day = gone_day keeps it off the shared map.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day, gone_day)
VALUES ('item-mirrorpebble', 'item', 0, 0, 1, 1, 'map-stone', '鏡石',
  '雨の夕暮れに採れた、空を映す小石です。', 0, 0, 85, 85);
