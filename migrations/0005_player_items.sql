-- Day 4-5: collecting and carrying things.
-- Inventory is per observer. A shared world object can be picked once by each
-- observer, so one visitor cannot consume the experience for everyone else.
CREATE TABLE player_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  first_picked_day INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_key)
);

CREATE INDEX player_items_user_idx ON player_items(user_id, updated_at DESC);
