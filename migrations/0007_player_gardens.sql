-- Day 11-20: a personal garden plot and the grow cycle.
CREATE TABLE player_garden_tiles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('tilled', 'planted', 'watered')),
  seed_key TEXT,
  planted_day INTEGER,
  last_watered_day INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, x, y)
);

CREATE INDEX player_garden_user_idx ON player_garden_tiles(user_id, updated_at DESC);
