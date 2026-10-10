CREATE TABLE player_revisits (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habitat_key TEXT NOT NULL CHECK (habitat_key IN ('shallow', 'deep')),
  world_day INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, habitat_key)
);

CREATE TABLE player_east_observations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_day INTEGER NOT NULL,
  compared_day INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
