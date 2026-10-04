UPDATE world_entities SET gone_day = 20 WHERE entity_key = 'item-berry' AND gone_day IS NULL;
INSERT OR IGNORE INTO world_entities (entity_key, kind, x, y, width, height, sprite, label, message, panel, flat, blocks, born_day)
VALUES ('source-fruit-tree', 'source', 4, 3, 1, 1, 'map-tree', '実のなる果樹', '季節ごとに実をつける果樹です。実りを採れそうです。', NULL, 0, 1, 20);
