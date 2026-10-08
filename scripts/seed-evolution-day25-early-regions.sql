-- Reconcile the isolated evolution world with the accelerated Day 21-25 plan.
-- Existing Day 50 content stays available after its new opening dates.
INSERT OR IGNORE INTO world_entities
  (entity_key, kind, x, y, width, height, sprite, label, message, flat, blocks, born_day)
VALUES
  ('east-path-marker', 'hint', 10, 5, 1, 1, 'map-signpost', '東へ続く道標', '柵の向こうへ、道が続きそうです。', 0, 0, 21);

UPDATE world_tiles SET born_day = 22 WHERE kind = 'path' AND x BETWEEN 11 AND 14 AND y BETWEEN 5 AND 10;

INSERT OR IGNORE INTO world_tiles (x, y, kind, born_day) VALUES
  (11,2,'wetland',23),(12,2,'wetland',23),(11,3,'wetland',23),
  (12,3,'wetland',23),(11,4,'wetland',23),(12,4,'wetland',23),
  (13,2,'forest',23),(14,2,'forest',23),(13,3,'forest',23),
  (14,3,'forest',23),(13,4,'forest',23),(14,4,'forest',23);

UPDATE world_entities SET born_day = 26
WHERE entity_key IN ('source-clay-pit', 'source-root-bed', 'source-bark-tree');
UPDATE world_entities SET born_day = 23, x = 11, y = 3, sprite = 'map-reeds',
  message = '湿った地面に葦が揺れています。近づけば細い葦を採れます。'
WHERE entity_key = 'source-reed-bed';
UPDATE world_entities SET born_day = 23, x = 13, y = 3, sprite = 'map-tree map-conifer',
  message = '林の松に、小さな松ぼっくりがあります。'
WHERE entity_key = 'source-conifer';

UPDATE world_entities SET born_day = 24, sprite = 'map-stone map-resource-rock',
  message = '岩にひびが入っています。道具があれば石を採れそうです。'
WHERE entity_key = 'resource-rock';
UPDATE world_entities SET born_day = 24, sprite = 'map-branch map-resource-log',
  message = '倒木の切り口が見えます。道具があれば木材を採れそうです。'
WHERE entity_key = 'resource-log';
UPDATE world_entities SET born_day = 25, sprite = 'map-house map-tool-shed',
  message = 'ここで小さな道具を借り、岩や倒木に使えます。'
WHERE entity_key = 'source-tool-shed';
