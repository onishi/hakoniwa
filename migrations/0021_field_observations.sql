CREATE TABLE field_subjects (
  subject_key TEXT PRIMARY KEY,
  entity_key TEXT NOT NULL,
  trace_key TEXT,
  label TEXT NOT NULL,
  place TEXT NOT NULL,
  movement TEXT NOT NULL,
  message_template TEXT NOT NULL,
  discover_day INTEGER NOT NULL,
  observe_distance INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE player_field_observations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL REFERENCES field_subjects(subject_key),
  first_seen_day INTEGER NOT NULL,
  first_note TEXT NOT NULL,
  PRIMARY KEY (user_id, subject_key)
);
