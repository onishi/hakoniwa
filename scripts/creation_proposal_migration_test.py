import json
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "migrations" / "0025_creation_proposals.sql"


class CreationProposalMigrationTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript("""
            CREATE TABLE world_days (world_day INTEGER PRIMARY KEY);
            CREATE TABLE world_creation_runs (
              world_day INTEGER PRIMARY KEY REFERENCES world_days(world_day)
            );
        """)
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO world_days VALUES (99)")
        self.proposal = json.dumps({"version": 1, "kind": "creation", "operations": []})

    def tearDown(self):
        self.db.close()

    def insert(self, **overrides):
        values = {
            "target": 100,
            "source": 99,
            "proposer": "operator@example.test",
            "model": "reviewed-model",
            "digest": "a" * 64,
            "proposal": self.proposal,
        } | overrides
        self.db.execute("""INSERT INTO world_creation_proposals
          (target_world_day, source_world_day, proposer, model, prompt_sha256, proposal_json)
          VALUES (:target, :source, :proposer, :model, :digest, :proposal)""", values)

    def test_approved_proposal_can_be_linked_to_its_published_run(self):
        self.insert()
        self.db.execute("INSERT INTO world_days VALUES (100)")
        self.db.execute("INSERT INTO world_creation_runs VALUES (100)")
        self.db.execute("""UPDATE world_creation_proposals
          SET status = 'applied', applied_at = CURRENT_TIMESTAMP, applied_run_day = 100
          WHERE target_world_day = 100""")

        self.assertEqual(
            self.db.execute("SELECT status, applied_run_day FROM world_creation_proposals").fetchone(),
            ("applied", 100),
        )

    def test_target_must_be_the_next_day(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(target=101)

    def test_applied_status_requires_a_matching_run(self):
        self.insert()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE world_creation_proposals SET status = 'applied' WHERE target_world_day = 100")

    def test_proposal_json_and_prompt_digest_are_constrained(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(proposal="not-json")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(digest="short")


if __name__ == "__main__":
    unittest.main()
