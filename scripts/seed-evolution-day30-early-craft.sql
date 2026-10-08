-- DAY 26-30 candidate for the isolated evolution database only.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('material-marker', 'hint', 11, 8, 1, 1, 'map-signpost', '素材の道標', '岩の石と倒木の木材を、東の作業場へ持っていけそうです。', 0, 0, 26),
  ('workbench', 'workbench', 12, 9, 1, 1, 'map-workbench', '小さな作業台', '石のかけらと木材から、小さな灯りを作れます。', 0, 0, 27),
  ('item-lantern', 'item', 12, 9, 1, 1, 'map-lantern', '小さな灯り', '自分の庭に置ける灯りです。', 0, 0, 28);

-- Older preview data may already contain the lantern as a Day 36 raw drop.
-- Keep its label and sprite for inventory while never showing it as a public pickup.
UPDATE world_entities SET born_day = 28, gone_day = 28, sprite = 'map-lantern',
  message = '自分の庭に置ける灯りです。'
WHERE entity_key = 'item-lantern';

INSERT OR IGNORE INTO craft_recipes
  (recipe_key, label, ingredient_a, ingredient_b, output_key, born_day)
VALUES ('lantern', '小さな灯り', 'item-ore', 'item-wood', 'item-lantern', 28);
