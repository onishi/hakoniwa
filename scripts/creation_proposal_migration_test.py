import json
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = [
    ROOT / "migrations" / "0025_creation_proposals.sql",
    ROOT / "migrations" / "0026_creation_proposal_guards.sql",
]


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
        for migration in MIGRATIONS:
            self.db.executescript(migration.read_text(encoding="utf-8"))
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

    def test_approved_content_and_provenance_are_immutable(self):
        self.insert()
        for column, value in (
            ("proposal_json", "{}"),
            ("model", "different-model"),
            ("prompt_sha256", "b" * 64),
            ("target_world_day", 101),
        ):
            with self.subTest(column=column), self.assertRaisesRegex(
                sqlite3.IntegrityError, "content is immutable"
            ):
                self.db.execute(
                    f"UPDATE world_creation_proposals SET {column} = ? WHERE target_world_day = 100",
                    (value,),
                )

    def test_proposal_cannot_be_deleted_or_reopened(self):
        self.insert()
        self.db.execute("UPDATE world_creation_proposals SET status = 'rejected' WHERE target_world_day = 100")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "status transition"):
            self.db.execute("UPDATE world_creation_proposals SET status = 'approved' WHERE target_world_day = 100")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "cannot be deleted"):
            self.db.execute("DELETE FROM world_creation_proposals WHERE target_world_day = 100")

    def test_application_link_cannot_change_after_application(self):
        self.insert()
        self.db.execute("INSERT INTO world_days VALUES (100)")
        self.db.execute("INSERT INTO world_creation_runs VALUES (100)")
        self.db.execute("""UPDATE world_creation_proposals
          SET status = 'applied', applied_at = CURRENT_TIMESTAMP, applied_run_day = 100
          WHERE target_world_day = 100""")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "application is immutable"):
            self.db.execute("UPDATE world_creation_proposals SET applied_at = 'later' WHERE target_world_day = 100")

    def test_publication_guard_rolls_back_if_proposal_is_no_longer_approved(self):
        self.insert()
        proposal_json = self.db.execute(
            "SELECT proposal_json FROM world_creation_proposals WHERE target_world_day = 100"
        ).fetchone()[0]
        proposal_id = self.db.execute(
            "SELECT id FROM world_creation_proposals WHERE target_world_day = 100"
        ).fetchone()[0]
        self.db.execute("UPDATE world_creation_proposals SET status = 'rejected' WHERE id = ?", (proposal_id,))

        with self.assertRaises(sqlite3.IntegrityError), self.db:
            self.db.execute("""INSERT INTO world_days (world_day)
              SELECT 100 WHERE EXISTS (
                SELECT 1 FROM world_creation_proposals
                WHERE id = ? AND status = 'approved' AND proposal_json = ?
              )""", (proposal_id, proposal_json))
            self.db.execute("INSERT INTO world_creation_runs VALUES (100)")

        self.assertIsNone(self.db.execute("SELECT 1 FROM world_days WHERE world_day = 100").fetchone())
        self.assertIsNone(self.db.execute("SELECT 1 FROM world_creation_runs WHERE world_day = 100").fetchone())


if __name__ == "__main__":
    unittest.main()
