-- A quiet observation belongs to one observer and one part of the pond.
CREATE TABLE player_habitat_observations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habitat_key TEXT NOT NULL CHECK (habitat_key IN ('shallow', 'deep')),
  first_day INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, habitat_key)
);
