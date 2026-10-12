CREATE TABLE player_resident_relations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gift_day INTEGER,
  gift_token TEXT UNIQUE,
  exchange_day INTEGER,
  exchange_token TEXT UNIQUE,
  revisit_day INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
