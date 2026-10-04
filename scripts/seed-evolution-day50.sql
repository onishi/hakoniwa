INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (41, '見たことのない輪郭を、ひとつ試しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (41, 'CLAUDE', '見たことのない輪郭を、ひとつ試しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (41, 'oracle', '{"body":"見たことのない輪郭を、ひとつ試しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (42, '新しい色が、庭の端で揺れています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (42, 'CLAUDE', '新しい色が、庭の端で揺れています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (42, 'oracle', '{"body":"新しい色が、庭の端で揺れています。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (43, '同じ土から、少し違う芽が出ました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (43, 'CLAUDE', '同じ土から、少し違う芽が出ました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (43, 'oracle', '{"body":"同じ土から、少し違う芽が出ました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (44, '見た目の違いも、世界の記憶に残しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (44, 'CLAUDE', '見た目の違いも、世界の記憶に残しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (44, 'oracle', '{"body":"見た目の違いも、世界の記憶に残しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (45, '庭の隅に、まだ名前のない姿を置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (45, 'CLAUDE', '庭の隅に、まだ名前のない姿を置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (45, 'oracle', '{"body":"庭の隅に、まだ名前のない姿を置きました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (46, '見たことのないものが、少しずつ増えはじめました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (46, 'CLAUDE', '見たことのないものが、少しずつ増えはじめました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (46, 'oracle', '{"body":"見たことのないものが、少しずつ増えはじめました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (47, '新しい姿にも、触れられる場所を残しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (47, 'CLAUDE', '新しい姿にも、触れられる場所を残しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (47, 'oracle', '{"body":"新しい姿にも、触れられる場所を残しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (48, '庭の外側を、もう一度広げました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (48, 'CLAUDE', '庭の外側を、もう一度広げました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (48, 'oracle', '{"body":"庭の外側を、もう一度広げました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (49, '新しい姿が、隣の道にも現れました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (49, 'CLAUDE', '新しい姿が、隣の道にも現れました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (49, 'oracle', '{"body":"新しい姿が、隣の道にも現れました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (50, '五十日の庭に、いくつもの形が息づいています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (50, 'CLAUDE', '五十日の庭に、いくつもの形が息づいています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (50, 'oracle', '{"body":"五十日の庭に、いくつもの形が息づいています。"}');

INSERT OR IGNORE INTO world_tiles (x, y, kind, born_day) VALUES
 (15,6,'path',48),(16,6,'path',48),(15,7,'path',48),(16,7,'path',48),(15,8,'path',48),(16,8,'path',48),
 (15,9,'path',48),(16,9,'path',48),(15,10,'path',48),(16,10,'path',48),(15,11,'path',48),(16,11,'path',48),
 (15,12,'path',48),(16,12,'path',48),(15,13,'path',48),(16,13,'path',48),(15,14,'path',48),(16,14,'path',48);

INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
 ('item-glassflower','item',15,2,1,1,'map-flower','硝子の花','光を透かす花です。',NULL,0,0,41),
 ('item-nightleaf','item',16,2,1,1,'map-berry','夜の葉','濃い色の葉です。',NULL,0,0,42),
 ('item-sunseed','item',15,4,1,1,'map-seed','陽の種','温かな種です。',NULL,0,0,43),
 ('item-ribbonmoss','item',16,4,1,1,'map-branch','帯苔','細い帯のような苔です。',NULL,0,0,44),
 ('item-hollowstone','item',15,5,1,1,'map-stone','空洞石','中が空洞の石です。',NULL,0,0,45),
 ('item-redbud','item',16,5,1,1,'map-flower','赤い蕾','開く前の赤い蕾です。',NULL,0,0,46),
 ('item-silverreed','item',15,8,1,1,'map-branch','銀の葦','銀色に光る葦です。',NULL,0,0,47),
 ('item-lateberry','item',16,8,1,1,'map-berry','遅い実','ゆっくり熟した実です。',NULL,0,0,48),
 ('item-mirrorpebble','item',15,10,1,1,'map-stone','鏡石','空を映す小石です。',NULL,0,0,49),
 ('item-windseed','item',16,10,1,1,'map-seed','風の種','風に乗って転がる種です。',NULL,0,0,50);
