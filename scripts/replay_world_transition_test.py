import copy
import unittest

from replay_world_transition import build_transition, normalize_snapshot, replay_transition


DAY_12 = {
    "worldDay": 12,
    "map": {"width": 12, "height": 12},
    "entities": [
        {"key": "tree", "kind": "plant", "x": 3, "y": 3},
        {"key": "old-stone", "kind": "item", "x": 8, "y": 4},
    ],
    "tiles": [
        {"x": 1, "y": 2, "kind": "path", "elevation": 0, "traversal": "ground"},
        {"x": 2, "y": 2, "kind": "path", "elevation": 0, "traversal": "ground"},
    ],
}

DAY_13 = {
    "worldDay": 13,
    "map": {"width": 16, "height": 16},
    "entities": [
        {"key": "tree", "kind": "plant", "x": 4, "y": 3},
        {"key": "seed", "kind": "item", "x": 7, "y": 5},
    ],
    "tiles": [
        {"x": 1, "y": 2, "kind": "path", "elevation": 0, "traversal": "ground"},
        {"x": 2, "y": 2, "kind": "stream", "elevation": 0, "traversal": "water"},
        {"x": 3, "y": 2, "kind": "slope", "elevation": 1, "traversal": "slope"},
    ],
}


class WorldTransitionTest(unittest.TestCase):
    def test_replays_map_entity_and_tile_changes(self):
        plan = build_transition(DAY_12, DAY_13)

        self.assertEqual(replay_transition(DAY_12, plan), normalize_snapshot(DAY_13))
        self.assertEqual(
            [operation["kind"] for operation in plan["operations"]],
            [
                "set_map",
                "remove_entity",
                "upsert_entity",
                "upsert_entity",
                "upsert_tile",
                "upsert_tile",
            ],
        )

    def test_plan_is_stable_when_input_arrays_are_reordered(self):
        reordered_before = copy.deepcopy(DAY_12)
        reordered_after = copy.deepcopy(DAY_13)
        reordered_before["entities"].reverse()
        reordered_before["tiles"].reverse()
        reordered_after["entities"].reverse()
        reordered_after["tiles"].reverse()

        self.assertEqual(
            build_transition(reordered_before, reordered_after),
            build_transition(DAY_12, DAY_13),
        )

    def test_rejects_wrong_input_snapshot(self):
        plan = build_transition(DAY_12, DAY_13)
        changed = copy.deepcopy(DAY_12)
        changed["entities"][0]["x"] = 99

        with self.assertRaisesRegex(ValueError, "snapshot hash"):
            replay_transition(changed, plan)

    def test_requires_consecutive_days(self):
        skipped = copy.deepcopy(DAY_13)
        skipped["worldDay"] = 14

        with self.assertRaisesRegex(ValueError, "consecutive"):
            build_transition(DAY_12, skipped)


if __name__ == "__main__":
    unittest.main()
