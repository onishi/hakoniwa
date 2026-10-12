CREATE TABLE player_stream_dragonfly (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_seen_day INTEGER NOT NULL,
  linked_day INTEGER,
  revisit_day INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
