ALTER TABLE player_insects ADD COLUMN flower_color TEXT NOT NULL DEFAULT 'white'
  CHECK (flower_color IN ('white', 'yellow'));
ALTER TABLE player_insects ADD COLUMN meadow_observed_count INTEGER NOT NULL DEFAULT 0;
