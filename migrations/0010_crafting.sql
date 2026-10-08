-- Recipes are world data; crafting and permanent personal placements stay per observer.
CREATE TABLE craft_recipes (
  recipe_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  ingredient_a TEXT NOT NULL,
  ingredient_b TEXT NOT NULL,
  output_key TEXT NOT NULL,
  born_day INTEGER NOT NULL
);

CREATE TABLE player_crafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_key TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  world_day INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, recipe_key)
);

CREATE TABLE player_decorations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  world_day INTEGER NOT NULL,
  placement_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_key)
);
