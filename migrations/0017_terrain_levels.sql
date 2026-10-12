ALTER TABLE world_tiles ADD COLUMN elevation INTEGER NOT NULL DEFAULT 0
  CHECK (elevation BETWEEN 0 AND 2);
ALTER TABLE world_tiles ADD COLUMN traversal TEXT NOT NULL DEFAULT 'ground'
  CHECK (traversal IN ('ground', 'slope', 'water'));
