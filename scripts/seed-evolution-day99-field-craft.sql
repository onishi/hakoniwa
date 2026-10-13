-- DAY 96-99 candidates for the isolated evolution database only.
-- DAY 100 stays unpublished until every acceptance condition has evidence.
INSERT OR IGNORE INTO world_days (world_day, oracle, status) VALUES
  (96, '草原の長い草から繊維を採り、村の木と組み合わせられるようになりました。', 'published'),
  (97, '獣との短い接触を確かめ、旅の中心が観察のままか見直しました。', 'published'),
  (98, '創世日記を水辺、生き物、庭、旅の関心から辿れるようになりました。', 'published'),
  (99, '村の庭と外の道を行き来し、別々の観測者が同じ世界を見られるか確かめました。', 'published');

INSERT OR IGNORE INTO genesis_diary (world_day, god, body)
  SELECT world_day, 'CODEX', oracle FROM world_days WHERE world_day BETWEEN 96 AND 99;

INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day, gone_day)
VALUES
  ('source-field-grass', 'source', 20, 13, 1, 1, 'map-field-grass', '草原の長い草',
    '道具で繊維を採れます。村の木と組み合わせると庭に残るものができます。', 0, 0, 96, NULL),
  ('item-field-fiber', 'item', 0, 0, 1, 1, 'map-field-grass', '草の繊維',
    '外で採った繊維です。', 0, 0, 96, 96),
  ('item-field-bundle', 'item', 0, 0, 1, 1, 'map-field-bundle', '草と木の束',
    '外の草と村の木を組み合わせた束です。', 0, 0, 96, 96);

INSERT OR IGNORE INTO craft_recipes
  (recipe_key, label, ingredient_a, ingredient_b, output_key, born_day)
VALUES ('field-bundle', '草と木の束', 'item-field-fiber', 'item-wood', 'item-field-bundle', 96);

INSERT INTO creation_events (world_day, kind, payload) VALUES
  (96, 'entity_added', '{"entity_key":"source-field-grass"}'),
  (96, 'recipe_added', '{"recipe_key":"field-bundle"}');
