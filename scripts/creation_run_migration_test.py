import json
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "migrations" / "0024_creation_runs.sql"


class CreationRunMigrationTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript("""
            CREATE TABLE world_days (
              world_day INTEGER PRIMARY KEY,
              status TEXT NOT NULL
            );
            CREATE TABLE creation_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              world_day INTEGER NOT NULL REFERENCES world_days(world_day),
              kind TEXT NOT NULL,
              payload TEXT NOT NULL
            );
            CREATE TABLE world_snapshots (
              world_day INTEGER PRIMARY KEY REFERENCES world_days(world_day),
              snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
            );
            CREATE TRIGGER capture_snapshot AFTER UPDATE OF status ON world_days
            WHEN NEW.status = 'published' AND OLD.status <> 'published'
            BEGIN
              INSERT INTO world_snapshots (world_day, snapshot_json)
              SELECT NEW.world_day, json_set(snapshot_json, '$.worldDay', NEW.world_day)
              FROM world_snapshots WHERE world_day = NEW.world_day - 1;
            END;
        """)
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.day1 = {"worldDay": 1, "map": {"width": 12, "height": 12}, "entities": [], "tiles": []}
        self.day2 = {**self.day1, "worldDay": 2}
        self.db.execute("INSERT INTO world_days VALUES (1, 'published')")
        self.db.execute("INSERT INTO world_snapshots VALUES (1, ?)", (self.compact(self.day1),))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    @staticmethod
    def compact(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def publish(self, expected):
        digest = "a" * 64
        with self.db:
            self.db.execute("INSERT INTO world_days VALUES (2, 'draft')")
            self.db.execute(
                """INSERT INTO world_creation_runs
                   (world_day, source_world_day, algorithm, proposal_json, seed,
                    transition_json, expected_snapshot_json,
                    input_snapshot_sha256, output_snapshot_sha256)
                   VALUES (2, 1, 'silence-v1', '{}', ?, '{}', ?, ?, ?)""",
                (digest, self.compact(expected), digest, digest),
            )
            self.db.execute("INSERT INTO creation_events (world_day, kind, payload) VALUES (2, 'silence', '{}')")
            self.db.execute("UPDATE world_days SET status = 'published' WHERE world_day = 2")
            self.db.execute(
                "UPDATE world_creation_runs SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE world_day = 2"
            )

    def test_matching_snapshot_publishes_run(self):
        self.publish(self.day2)

        self.assertEqual(
            self.db.execute("SELECT status FROM world_creation_runs WHERE world_day = 2").fetchone(),
            ("published",),
        )
        self.assertEqual(
            json.loads(self.db.execute("SELECT snapshot_json FROM world_snapshots WHERE world_day = 2").fetchone()[0]),
            self.day2,
        )

    def test_mismatch_rolls_back_the_entire_publication(self):
        wrong = {**self.day2, "map": {"width": 99, "height": 99}}

        with self.assertRaisesRegex(sqlite3.IntegrityError, "does not match"):
            self.publish(wrong)

        self.assertIsNone(self.db.execute("SELECT 1 FROM world_days WHERE world_day = 2").fetchone())
        self.assertIsNone(self.db.execute("SELECT 1 FROM world_creation_runs WHERE world_day = 2").fetchone())
        self.assertIsNone(self.db.execute("SELECT 1 FROM creation_events WHERE world_day = 2").fetchone())
