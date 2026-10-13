-- DAY 86-90 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (86, '小川に羽虫が現れました。時刻と天気で、飛び方の言葉が変わります。', 'published'),
  (87, NULL, 'published'),
  (88, '近くで見た生き物を、自分の観察記録に残せます。', 'published'),
  (89, '見つけた生き物だけを、図鑑で読み返せます。', 'published'),
  (90, '羽虫の姿は消えました。羽の跡から、かつての姿を知れます。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 86 AND 90 AND oracle IS NOT NULL;

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day, gone_day)
VALUES
  ('stream-mayfly', 'creature', 14, 13, 1, 1, 'map-stream-mayfly', '小川の羽虫',
    '水面と岸を短く行き来する羽虫です。', 0, 0, 86, 90),
  ('mayfly-trace', 'ecology', 14, 13, 1, 1, 'map-mayfly-trace', '羽虫の跡',
    '羽虫の姿は見えません。水辺に薄い羽の跡があります。', 0, 0, 90, NULL);

INSERT OR IGNORE INTO field_subjects
  (subject_key, entity_key, trace_key, label, place, movement, message_template, discover_day, observe_distance)
VALUES
  ('stream-fish', 'stream-fish', NULL, '流れの魚影', '小川の石の陰', '流れをさかのぼります',
    '{subject}は{weather}の{phase}、{place}で{movement}。', 88, 1),
  ('stream-dragonfly', 'stream-dragonfly', NULL, '小川のトンボ', '水面と草の間', '高く低く飛びます',
    '{subject}は{weather}の{phase}、{place}で{movement}。', 88, 1),
  ('stream-mayfly', 'stream-mayfly', 'mayfly-trace', '小川の羽虫', '岸の浅い流れ', '短い輪を描きます',
    '{subject}は{weather}の{phase}、{place}で{movement}。', 88, 1);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (86, 'entity_added', '{"entity_key":"stream-mayfly"}'),
  (90, 'entity_added', '{"entity_key":"mayfly-trace"}');
