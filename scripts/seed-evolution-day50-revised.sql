-- DAY 46-50 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('east-spring', 'water', 15, 15, 1, 1, 'map-east-spring', '東の小さな泉', '遠い草地の水面です。庭の池とは違う小さな波紋が見えます。', 1, 1, 48),
  ('east-waterbug', 'insect-habitat', 16, 15, 1, 1, 'map-east-waterbug', '泉辺の水生昆虫', '泉の縁で、水面を滑る虫が短く行き来しています。', 0, 0, 49);

-- Retire unusable raw drops from the old DAY 46-50 preview candidate.
UPDATE world_entities SET gone_day = born_day WHERE entity_key IN
  ('item-redbud', 'item-silverreed', 'item-lateberry', 'item-mirrorpebble', 'item-windseed');

UPDATE world_days SET oracle = CASE world_day
  WHEN 46 THEN '朝と夕では、水面と生き物の様子が少し違います。'
  WHEN 47 THEN '同じ岸に戻ると、前に見た魚影の通り道がわかります。'
  WHEN 48 THEN '東の小区画に、もう一つの水辺が現れました。'
  WHEN 49 THEN '二つの水辺には、違う生き物が暮らしています。'
  WHEN 50 THEN '今日は、釣り・庭・採集・観察から一つ選べます。'
  END WHERE world_day BETWEEN 46 AND 50;

UPDATE genesis_diary SET body = (SELECT oracle FROM world_days WHERE world_days.world_day = genesis_diary.world_day)
WHERE world_day BETWEEN 46 AND 50;
