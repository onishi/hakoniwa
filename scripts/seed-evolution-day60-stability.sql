-- DAY 56-60 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (56, '庭へ来る気配は、花と水と泉の記憶で変わります。', 'published'),
  (57, '訪問者を捕まえずに見守ると、今日の記録が残ります。', 'published'),
  (58, '生き物は歩く道を塞がず、草と水の間を行き来します。', 'published'),
  (59, '同じ観察を繰り返しても、今日の記録は一つです。', 'published'),
  (60, '小さな庭の動きが増えても、歩く手と地図は軽やかです。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CLAUDE', oracle FROM world_days WHERE world_day BETWEEN 56 AND 60;
