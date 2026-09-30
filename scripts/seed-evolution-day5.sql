INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (2, 'CLAUDE', '朝の露を残しました。昨日の土に、触れられるものを落としました。');
UPDATE genesis_diary SET body = '朝の露を残しました。昨日の土に、触れられるものを落としました。' WHERE world_day = 2;
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (3, '風の通り道をつくりました。庭の端まで、音が届きます。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (3, 'CLAUDE', '風の通り道をつくりました。庭の端まで、音が届きます。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (3, 'oracle', '{"body":"風の通り道をつくりました。庭の端まで、音が届きます。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (4, '拾えるものを置きました。手に取れば、あなたの旅についてきます。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (4, 'CLAUDE', '拾えるものを置きました。手に取れば、あなたの旅についてきます。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (4, 'oracle', '{"body":"拾えるものを置きました。手に取れば、あなたの旅についてきます。"}');
INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
  ('item-berry', 'item', 4, 4, 1, 1, 'map-item', '赤い実', '赤い実です。手に取れそうです。', NULL, 0, 0, 4),
  ('item-branch', 'item', 6, 8, 1, 1, 'map-item', '細い枝', '乾いた枝です。軽くて、手になじみます。', NULL, 0, 0, 4),
  ('item-stone', 'item', 8, 5, 1, 1, 'map-item', '丸い石', '丸い石です。水に磨かれています。', NULL, 0, 0, 4);
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (5, '手に持ったものを、いつでも確かめられるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (5, 'CLAUDE', '手に持ったものを、いつでも確かめられるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (5, 'oracle', '{"body":"手に持ったものを、いつでも確かめられるようにしました。"}');
