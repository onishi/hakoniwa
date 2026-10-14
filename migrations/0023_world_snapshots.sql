-- Freeze the shared, data-defined map whenever a draft day becomes published.
-- Personal gardens, traces and time-dependent climate are intentionally excluded.
CREATE TABLE world_snapshots (
  world_day INTEGER PRIMARY KEY REFERENCES world_days(world_day),
  source TEXT NOT NULL CHECK (source IN ('reconstructed', 'captured')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW world_snapshot_projection AS
SELECT days.world_day,
  json_object(
    'worldDay', days.world_day,
    'map', json_object(
      'width', CASE WHEN days.world_day >= 91 THEN 22 WHEN days.world_day >= 48 THEN 18
        WHEN days.world_day >= 22 THEN 16 ELSE 12 END,
      'height', CASE WHEN days.world_day >= 91 THEN 18 WHEN days.world_day >= 48 THEN 18
        WHEN days.world_day >= 22 THEN 16 ELSE 12 END),
    'entities', json(COALESCE((
      SELECT json_group_array(json_object(
        'key', entity_key, 'kind', kind, 'x', x, 'y', y,
        'width', width, 'height', height, 'sprite', sprite,
        'label', label, 'message', message, 'panel', panel,
        'flat', json(CASE WHEN flat = 1 THEN 'true' ELSE 'false' END),
        'blocks', json(CASE WHEN blocks = 1 THEN 'true' ELSE 'false' END)))
      FROM (SELECT * FROM world_entities
        WHERE born_day <= days.world_day AND (gone_day IS NULL OR gone_day > days.world_day)
        ORDER BY y, x, entity_key)
    ), '[]')),
    'tiles', json(COALESCE((
      SELECT json_group_array(json_object(
        'x', x, 'y', y, 'kind', kind, 'elevation', elevation, 'traversal', traversal))
      FROM (SELECT * FROM world_tiles
        WHERE born_day <= days.world_day AND (gone_day IS NULL OR gone_day > days.world_day)
        ORDER BY y, x)
    ), '[]'))
  ) AS snapshot_json
FROM world_days AS days WHERE days.status = 'published';

-- Earlier published days were not frozen when they happened. Preserve this
-- reconstruction separately so it is never mistaken for an original capture.
INSERT INTO world_snapshots (world_day, source, snapshot_json)
SELECT world_day, 'reconstructed', snapshot_json FROM world_snapshot_projection;

CREATE TRIGGER world_day_snapshot_on_publish AFTER UPDATE OF status ON world_days
WHEN NEW.status = 'published' AND OLD.status <> 'published'
BEGIN
  INSERT INTO world_snapshots (world_day, source, snapshot_json)
  SELECT world_day, 'captured', snapshot_json FROM world_snapshot_projection
  WHERE world_day = NEW.world_day;
END;
