-- DAY 31-35 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('insect-meadow', 'insect-habitat', 2, 10, 1, 1, 'map-insect-meadow', '歩く虫の草むら', '葉の下を歩く虫がいます。岸辺を飛ぶ虫とは動きが違います。', 0, 0, 35);

-- Retire two unused raw drops from the old DAY 34-35 preview.
UPDATE world_entities SET gone_day = born_day WHERE entity_key IN ('item-fiber', 'item-craft-dust');

UPDATE world_days SET oracle = CASE world_day
  WHEN 31 THEN '池の浅瀬と深場に、違う通り道ができました。'
  WHEN 32 THEN '水草のそばと暗い底に、二つの魚影が泳いでいます。'
  WHEN 33 THEN '釣らずに見ていたことも、池の記録に残ります。'
  WHEN 34 THEN '雨のあとの水面に、新しい波紋が広がります。'
  WHEN 35 THEN '飛ぶ虫のほかに、葉の下を歩く虫が現れました。'
  END WHERE world_day BETWEEN 31 AND 35;

UPDATE genesis_diary SET body = (SELECT oracle FROM world_days WHERE world_days.world_day = genesis_diary.world_day)
WHERE world_day BETWEEN 31 AND 35;
