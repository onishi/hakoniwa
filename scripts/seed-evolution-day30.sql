INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (21, '庭の外から、細い風が届きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (21, 'CLAUDE', '庭の外から、細い風が届きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (21, 'oracle', '{"body":"庭の外から、細い風が届きました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (22, '隣の土にも、同じ空が続いています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (22, 'CLAUDE', '隣の土にも、同じ空が続いています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (22, 'oracle', '{"body":"隣の土にも、同じ空が続いています。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (23, '道の先に、違う匂いを置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (23, 'CLAUDE', '道の先に、違う匂いを置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (23, 'oracle', '{"body":"道の先に、違う匂いを置きました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (24, 'まだ知らないものが、柵の向こうで待っています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (24, 'CLAUDE', 'まだ知らないものが、柵の向こうで待っています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (24, 'oracle', '{"body":"まだ知らないものが、柵の向こうで待っています。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (25, '遠い場所にも、拾えるものを置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (25, 'CLAUDE', '遠い場所にも、拾えるものを置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (25, 'oracle', '{"body":"遠い場所にも、拾えるものを置きました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (26, '庭の外にも、小さな目印を残しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (26, 'CLAUDE', '庭の外にも、小さな目印を残しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (26, 'oracle', '{"body":"庭の外にも、小さな目印を残しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (27, '明日は、もう少し先まで歩けます。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (27, 'CLAUDE', '明日は、もう少し先まで歩けます。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (27, 'oracle', '{"body":"明日は、もう少し先まで歩けます。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (28, '柵の向こうへ、道を伸ばしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (28, 'CLAUDE', '柵の向こうへ、道を伸ばしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (28, 'oracle', '{"body":"柵の向こうへ、道を伸ばしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (29, '隣の区画だけに育つものを置きました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (29, 'CLAUDE', '隣の区画だけに育つものを置きました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (29, 'oracle', '{"body":"隣の区画だけに育つものを置きました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (30, '庭と隣の区画を、ひとつの道でつなぎました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (30, 'CLAUDE', '庭と隣の区画を、ひとつの道でつなぎました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (30, 'oracle', '{"body":"庭と隣の区画を、ひとつの道でつなぎました。"}');

-- The second region opens at Day 28. The old garden remains at 12x12.
INSERT OR IGNORE INTO world_tiles (x, y, kind, born_day) VALUES
  (11,6,'path',28),(12,6,'path',28),(13,6,'path',28),(14,6,'path',28),
  (11,5,'path',28),(12,5,'path',28),(13,5,'path',28),(14,5,'path',28),
  (11,7,'path',28),(12,7,'path',28),(13,7,'path',28),(14,7,'path',28),
  (11,8,'path',28),(12,8,'path',28),(13,8,'path',28),(14,8,'path',28),
  (11,9,'path',28),(12,9,'path',28),(13,9,'path',28),(14,9,'path',28),
  (11,10,'path',28),(12,10,'path',28),(13,10,'path',28),(14,10,'path',28);

INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
 ('item-reed','item',11,2,1,1,'map-branch','細い葦','水辺の細い葦です。',NULL,0,0,21),
 ('item-clay','item',12,2,1,1,'map-stone','赤土','乾いた赤土のかけらです。',NULL,0,0,22),
 ('item-cone','item',13,2,1,1,'map-berry','松ぼっくり','木の香りがする松ぼっくりです。',NULL,0,0,23),
 ('item-root','item',14,2,1,1,'map-branch','細い根','土から顔を出した細い根です。',NULL,0,0,24),
 ('item-bark','item',11,4,1,1,'map-branch','樹皮','ざらざらした樹皮です。',NULL,0,0,25),
 ('item-seedling','item',12,4,1,1,'map-flower','小さな苗','まだ葉を閉じた小さな苗です。',NULL,0,0,26),
 ('item-lichen','item',13,4,1,1,'map-berry','地衣類','石に沿って広がる地衣類です。',NULL,0,0,27),
 ('item-wildflower','item',14,4,1,1,'map-flower','野の花','隣の区画にだけ咲く野の花です。',NULL,0,0,28),
 ('item-blueberry','item',11,8,1,1,'map-berry','青い実','隣の区画の青い実です。',NULL,0,0,29),
 ('item-pollen','item',12,8,1,1,'map-berry','黄色い花粉','風に舞う黄色い花粉です。',NULL,0,0,29),
 ('item-sand','item',13,8,1,1,'map-stone','白い砂','指の間からこぼれる白い砂です。',NULL,0,0,29),
 ('item-driftwood','item',14,8,1,1,'map-branch','流木','遠くから流れてきた木です。',NULL,0,0,29),
 ('item-nest','item',11,10,1,1,'map-berry','空の巣','誰もいない空の巣です。',NULL,0,0,30),
 ('item-amber','item',12,10,1,1,'map-stone','琥珀のかけら','光を閉じ込めた琥珀のかけらです。',NULL,0,0,30),
 ('item-rainwater','item',13,10,1,1,'map-stone','雨水','葉にたまった雨水です。',NULL,0,0,30),
 ('item-thistle','item',14,10,1,1,'map-flower','紫の花','とげのある紫の花です。',NULL,0,0,30),
 ('item-willow','item',11,12,1,1,'map-branch','柳の葉','風に揺れる柳の葉です。',NULL,0,0,30),
 ('item-pebble','item',12,12,1,1,'map-stone','小石','道端の小さな石です。',NULL,0,0,30),
 ('item-sap','item',13,12,1,1,'map-berry','樹液','木から落ちた樹液です。',NULL,0,0,30);
