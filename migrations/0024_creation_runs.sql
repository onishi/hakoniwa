-- Keep the accepted proposal, deterministic seed and exact transition beside
-- every automatically published world day. The expected output is checked
-- against the snapshot captured by 0023 in the same D1 transaction.
CREATE TABLE world_creation_runs (
  world_day INTEGER PRIMARY KEY REFERENCES world_days(world_day),
  source_world_day INTEGER NOT NULL REFERENCES world_days(world_day),
  algorithm TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  seed TEXT NOT NULL CHECK (length(seed) = 64),
  transition_json TEXT NOT NULL CHECK (json_valid(transition_json)),
  expected_snapshot_json TEXT NOT NULL CHECK (json_valid(expected_snapshot_json)),
  input_snapshot_sha256 TEXT NOT NULL CHECK (length(input_snapshot_sha256) = 64),
  output_snapshot_sha256 TEXT NOT NULL CHECK (length(output_snapshot_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'published')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TRIGGER creation_run_verify_on_publish BEFORE UPDATE OF status ON world_creation_runs
WHEN NEW.status = 'published' AND OLD.status <> 'published'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM world_snapshots
    WHERE world_day = NEW.world_day
      AND json(snapshot_json) = json(NEW.expected_snapshot_json)
  ) THEN RAISE(ABORT, 'creation run output does not match captured snapshot') END;
END;
