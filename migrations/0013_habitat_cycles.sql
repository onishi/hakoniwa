ALTER TABLE player_fishing ADD COLUMN last_release_habitat TEXT
  CHECK (last_release_habitat IN ('shallow', 'deep'));
ALTER TABLE player_fishing ADD COLUMN bank_seen_day INTEGER;
ALTER TABLE player_insects ADD COLUMN flower_tended_day INTEGER;

CREATE TABLE player_habitat_care (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prepared_day INTEGER NOT NULL,
  flower_color TEXT NOT NULL CHECK (flower_color IN ('white', 'yellow')),
  garden_x INTEGER NOT NULL,
  garden_y INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, prepared_day)
);
