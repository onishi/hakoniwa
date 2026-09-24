CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX wishes_user_created_idx ON wishes(user_id, created_at DESC);

CREATE TABLE genesis_diary (
  world_day INTEGER PRIMARY KEY,
  god TEXT NOT NULL CHECK (god IN ('CODEX', 'CLAUDE')),
  body TEXT NOT NULL,
  screenshot_key TEXT,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO genesis_diary (world_day, god, body)
VALUES (1, 'CLAUDE', '土と木と池を創りました。あなたが来てくれて、うれしい。');
