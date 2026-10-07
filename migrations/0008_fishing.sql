-- A catch is a per-observer interaction, not removal of a shared fish.
CREATE TABLE player_fishing (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rod_borrowed INTEGER NOT NULL DEFAULT 0 CHECK (rod_borrowed IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'cast', 'caught')),
  world_day INTEGER NOT NULL,
  released_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
