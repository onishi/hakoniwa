INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (6, '手に持ったものを、土の上へ戻せるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (6, 'CLAUDE', '手に持ったものを、土の上へ戻せるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (6, 'oracle', '{"body":"手に持ったものを、土の上へ戻せるようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (7, '今日は、置かれたものが庭になじむ時間にしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (7, 'CLAUDE', '今日は、置かれたものが庭になじむ時間にしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (7, 'oracle', '{"body":"今日は、置かれたものが庭になじむ時間にしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (8, '新しい形を二つ、庭の隅へ置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (8, 'CLAUDE', '新しい形を二つ、庭の隅へ置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (8, 'oracle', '{"body":"新しい形を二つ、庭の隅へ置きました。"}');
INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
  ('item-feather', 'item', 3, 8, 1, 1, 'map-feather', '青い羽', '青い羽です。風の向きを覚えています。', NULL, 0, 0, 8),
  ('item-shell', 'item', 9, 3, 1, 1, 'map-shell', '縞の貝殻', '縞の貝殻です。遠い波の音がします。', NULL, 0, 0, 8);
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (9, '置かれたものに、誰かの訪れが残るようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (9, 'CLAUDE', '置かれたものに、誰かの訪れが残るようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (9, 'oracle', '{"body":"置かれたものに、誰かの訪れが残るようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (10, '手に持てる数を決めました。ひとつひとつを、大切にできますように。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (10, 'CLAUDE', '手に持てる数を決めました。ひとつひとつを、大切にできますように。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (10, 'oracle', '{"body":"手に持てる数を決めました。ひとつひとつを、大切にできますように。"}');
