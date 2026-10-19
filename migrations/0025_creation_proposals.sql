-- Proposals are staged out-of-band and become executable only after a human
-- has approved and inserted them here. No public Worker endpoint writes this table.
CREATE TABLE world_creation_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_world_day INTEGER NOT NULL UNIQUE,
  source_world_day INTEGER NOT NULL REFERENCES world_days(world_day),
  proposer TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL CHECK (length(prompt_sha256) = 64),
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'applied', 'rejected')),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  applied_run_day INTEGER REFERENCES world_creation_runs(world_day),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (target_world_day = source_world_day + 1),
  CHECK ((status = 'applied' AND applied_at IS NOT NULL AND applied_run_day = target_world_day)
    OR (status <> 'applied' AND applied_at IS NULL AND applied_run_day IS NULL))
);
CREATE INDEX world_creation_proposals_status_idx ON world_creation_proposals(status, target_world_day);
