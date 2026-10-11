CREATE TABLE player_ecology_observations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bird_seen_day INTEGER,
  nest_seen_day INTEGER,
  feather_seen_day INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
