-- DAY 41-45 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('insect-striped', 'insect-habitat', 12, 11, 1, 1, 'map-striped-beetle', '縞のある虫', '東の草地で縞のある虫が葉の下を歩いています。岸辺の虫とは色も歩き方も違います。', 0, 0, 41);

-- The old preview's raw drops have no matching use in the revised play loop.
UPDATE world_entities SET gone_day = born_day WHERE entity_key IN
  ('item-glassflower', 'item-nightleaf', 'item-sunseed', 'item-ribbonmoss', 'item-hollowstone');

UPDATE world_days SET oracle = CASE world_day
  WHEN 41 THEN '東の草地に、縞のある新しい虫が現れました。'
  WHEN 42 THEN '花を整えると、果樹にも虫が訪れます。'
  WHEN 43 THEN '池の縁を進む、三つ目の魚影が見えます。'
  WHEN 44 THEN '魚を戻す岸を選ぶと、池の記録が変わります。'
  WHEN 45 THEN '花と庭の水を整え、次の訪問の準備を残しました。'
  END WHERE world_day BETWEEN 41 AND 45;

UPDATE genesis_diary SET body = (SELECT oracle FROM world_days WHERE world_days.world_day = genesis_diary.world_day)
WHERE world_day BETWEEN 41 AND 45;
