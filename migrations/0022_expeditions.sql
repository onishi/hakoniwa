CREATE TABLE player_expeditions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hp INTEGER NOT NULL DEFAULT 3 CHECK (hp BETWEEN 1 AND 3),
  trips INTEGER NOT NULL DEFAULT 0,
  readiness INTEGER NOT NULL DEFAULT 0 CHECK (readiness IN (0, 1)),
  inside INTEGER NOT NULL DEFAULT 0 CHECK (inside IN (0, 1)),
  encounter TEXT NOT NULL DEFAULT 'idle' CHECK (encounter IN ('idle', 'active')),
  calmed_day INTEGER,
  defeats INTEGER NOT NULL DEFAULT 0,
  entered_day INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
