-- An approved proposal is an append-only audit record. It may only move once
-- to a terminal state; its content and provenance cannot change afterwards.
CREATE TRIGGER world_creation_proposals_content_immutable
BEFORE UPDATE OF target_world_day, source_world_day, proposer, model,
  prompt_sha256, proposal_json, approved_at, created_at ON world_creation_proposals
BEGIN
  SELECT RAISE(ABORT, 'creation proposal content is immutable');
END;

CREATE TRIGGER world_creation_proposals_status_transition
BEFORE UPDATE OF status ON world_creation_proposals
WHEN NOT (
  OLD.status = NEW.status
  OR (OLD.status = 'approved' AND NEW.status IN ('applied', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid creation proposal status transition');
END;

CREATE TRIGGER world_creation_proposals_application_immutable
BEFORE UPDATE OF applied_at, applied_run_day ON world_creation_proposals
WHEN NOT (OLD.status = 'approved' AND NEW.status = 'applied')
BEGIN
  SELECT RAISE(ABORT, 'creation proposal application is immutable');
END;

CREATE TRIGGER world_creation_proposals_no_delete
BEFORE DELETE ON world_creation_proposals
BEGIN
  SELECT RAISE(ABORT, 'creation proposals cannot be deleted');
END;
