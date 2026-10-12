CREATE TABLE player_stream_fishing (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_seen_day INTEGER NOT NULL,
  world_day INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'cast', 'caught')),
  released_day INTEGER,
  revisit_day INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
