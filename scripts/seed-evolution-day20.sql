INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (11, '庭をひとつずつ、あなたの手元に分けました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (11, 'CLAUDE', '庭をひとつずつ、あなたの手元に分けました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (11, 'oracle', '{"body":"庭をひとつずつ、あなたの手元に分けました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (12, '土を耕せるようにしました。急がなくても、庭は待っています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (12, 'CLAUDE', '土を耕せるようにしました。急がなくても、庭は待っています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (12, 'oracle', '{"body":"土を耕せるようにしました。急がなくても、庭は待っています。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (13, '植えるものを、ひとつだけ残しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (13, 'CLAUDE', '植えるものを、ひとつだけ残しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (13, 'oracle', '{"body":"植えるものを、ひとつだけ残しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (14, '小さな種を、庭の風下へ置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (14, 'CLAUDE', '小さな種を、庭の風下へ置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (14, 'oracle', '{"body":"小さな種を、庭の風下へ置きました。"}');
INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
  ('item-seed', 'item', 4, 9, 1, 1, 'map-seed', '小さな種', '土に植えられそうな種です。', NULL, 0, 0, 14);
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (15, '芽が出るまでの静かな時間をつくりました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (15, 'CLAUDE', '芽が出るまでの静かな時間をつくりました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (15, 'oracle', '{"body":"芽が出るまでの静かな時間をつくりました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (16, '土が乾いたら、水を受け取れるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (16, 'CLAUDE', '土が乾いたら、水を受け取れるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (16, 'oracle', '{"body":"土が乾いたら、水を受け取れるようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (17, '少し空いても、芽は待ってくれます。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (17, 'CLAUDE', '少し空いても、芽は待ってくれます。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (17, 'oracle', '{"body":"少し空いても、芽は待ってくれます。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (18, '育ったものを、手のひらへ戻せるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (18, 'CLAUDE', '育ったものを、手のひらへ戻せるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (18, 'oracle', '{"body":"育ったものを、手のひらへ戻せるようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (19, '庭の匂いを、少しだけ濃くしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (19, 'CLAUDE', '庭の匂いを、少しだけ濃くしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (19, 'oracle', '{"body":"庭の匂いを、少しだけ濃くしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (20, '植えたものが、庭の記憶になるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (20, 'CLAUDE', '植えたものが、庭の記憶になるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (20, 'oracle', '{"body":"植えたものが、庭の記憶になるようにしました。"}');
INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
  ('item-flower', 'item', 9, 9, 1, 1, 'map-flower', '白い花', '白い花です。まだ摘まずに見ていたい。', NULL, 0, 0, 20),
  ('item-acorn', 'item', 2, 4, 1, 1, 'map-berry', '小さなどんぐり', '小さなどんぐりです。土の匂いがします。', NULL, 0, 0, 20),
  ('item-petal', 'item', 10, 4, 1, 1, 'map-berry', '花びら', '風に乗る花びらです。', NULL, 0, 0, 20),
  ('item-moss', 'item', 2, 2, 1, 1, 'map-branch', '柔らかな苔', '柔らかな苔です。', NULL, 0, 0, 20),
  ('item-dew', 'item', 10, 8, 1, 1, 'map-stone', '朝露の玉', '朝露の玉です。', NULL, 0, 0, 20);
