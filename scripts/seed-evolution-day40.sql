INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (31, '庭の外で使えるものを、ひとつずつ考えています。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (31, 'CLAUDE', '庭の外で使えるものを、ひとつずつ考えています。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (31, 'oracle', '{"body":"庭の外で使えるものを、ひとつずつ考えています。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (32, '手のひらに収まる道具をつくりました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (32, 'CLAUDE', '手のひらに収まる道具をつくりました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (32, 'oracle', '{"body":"手のひらに収まる道具をつくりました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (33, '硬いものを、少しだけ掘れるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (33, 'CLAUDE', '硬いものを、少しだけ掘れるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (33, 'oracle', '{"body":"硬いものを、少しだけ掘れるようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (34, '割れたものの中にも、使えるものを残しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (34, 'CLAUDE', '割れたものの中にも、使えるものを残しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (34, 'oracle', '{"body":"割れたものの中にも、使えるものを残しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (35, '集めたものを、別の形へ組み合わせられるようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (35, 'CLAUDE', '集めたものを、別の形へ組み合わせられるようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (35, 'oracle', '{"body":"集めたものを、別の形へ組み合わせられるようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (36, '作ったものにも、置き場所を用意しました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (36, 'CLAUDE', '作ったものにも、置き場所を用意しました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (36, 'oracle', '{"body":"作ったものにも、置き場所を用意しました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (37, '道具は壊れず、使うたびに少し手になじみます。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (37, 'CLAUDE', '道具は壊れず、使うたびに少し手になじみます。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (37, 'oracle', '{"body":"道具は壊れず、使うたびに少し手になじみます。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (38, '木材の匂いが、庭まで届くようにしました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (38, 'CLAUDE', '木材の匂いが、庭まで届くようにしました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (38, 'oracle', '{"body":"木材の匂いが、庭まで届くようにしました。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (39, '灯りを持てば、少し遠くまで見える気がします。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (39, 'CLAUDE', '灯りを持てば、少し遠くまで見える気がします。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (39, 'oracle', '{"body":"灯りを持てば、少し遠くまで見える気がします。"}');
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES (40, '道具と素材が、庭の外への準備になりました。', 'published');
INSERT OR IGNORE INTO genesis_diary (world_day, god, body) VALUES (40, 'CLAUDE', '道具と素材が、庭の外への準備になりました。');
INSERT OR IGNORE INTO creation_events (world_day, kind, payload) VALUES (40, 'oracle', '{"body":"道具と素材が、庭の外への準備になりました。"}');

INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day) VALUES
 ('item-tool','item',10,2,1,1,'map-branch','小さな道具','掘ったり割ったりできそうな道具です。',NULL,0,0,32),
 ('resource-rock','resource',13,6,1,1,'map-stone','硬い岩','道具があれば、何か出てきそうです。',NULL,0,0,33),
 ('resource-log','resource',14,7,1,1,'map-branch','倒木','割れば木材が取れそうです。',NULL,0,0,33),
 ('item-fiber','item',12,6,1,1,'map-branch','繊維','細く丈夫な繊維です。',NULL,0,0,34),
 ('item-craft-dust','item',13,7,1,1,'map-stone','石粉','作るために使えそうな石粉です。',NULL,0,0,35),
 ('item-lantern','item',14,6,1,1,'map-shell','小さな灯り','手のひらに乗る小さな灯りです。',NULL,0,0,36),
 ('item-charcoal','item',12,9,1,1,'map-stone','炭','黒く軽い炭です。',NULL,0,0,38),
 ('item-resin','item',13,9,1,1,'map-berry','樹脂','木の香りがする樹脂です。',NULL,0,0,40);
