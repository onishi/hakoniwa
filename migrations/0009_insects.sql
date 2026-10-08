-- An insect remains visible in the shared world while each observer can
-- observe, catch, release, and tend flowers independently.
CREATE TABLE player_insects (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  net_borrowed INTEGER NOT NULL DEFAULT 0 CHECK (net_borrowed IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'free' CHECK (state IN ('free', 'held')),
  world_day INTEGER NOT NULL,
  observed_count INTEGER NOT NULL DEFAULT 0,
  released_count INTEGER NOT NULL DEFAULT 0,
  flower_tended INTEGER NOT NULL DEFAULT 0 CHECK (flower_tended IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
