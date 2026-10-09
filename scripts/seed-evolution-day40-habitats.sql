-- DAY 36-40 candidate for the isolated evolution database only.
UPDATE world_days SET oracle = CASE world_day
  WHEN 36 THEN '花の色を選ぶと、虫の来る場所も変わります。'
  WHEN 37 THEN '水をやった庭に、小さな訪問者が現れました。'
  WHEN 38 THEN '水辺の葦を、池のそばへ戻せるようにしました。'
  WHEN 39 THEN '岸辺では、近づく方向で生き物の様子が変わります。'
  WHEN 40 THEN '池と草むらを行き来すると、それぞれの気配がつながります。'
  END WHERE world_day BETWEEN 36 AND 40;

UPDATE genesis_diary SET body = (SELECT oracle FROM world_days WHERE world_days.world_day = genesis_diary.world_day)
WHERE world_day BETWEEN 36 AND 40;
