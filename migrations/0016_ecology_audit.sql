ALTER TABLE player_ecology_observations ADD COLUMN garden_seen_day INTEGER;

CREATE TABLE player_ecology_events (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_day INTEGER NOT NULL,
  event_key TEXT NOT NULL CHECK (event_key IN ('east-bird', 'east-nest', 'east-feather', 'garden-visitor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, world_day, event_key)
);
