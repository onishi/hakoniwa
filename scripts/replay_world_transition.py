#!/usr/bin/env python3
"""Build and replay deterministic transitions between shared-world snapshots."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any


Snapshot = dict[str, Any]
Transition = dict[str, Any]


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _snapshot_hash(snapshot: Snapshot) -> str:
    return hashlib.sha256(_canonical_json(normalize_snapshot(snapshot)).encode()).hexdigest()


def normalize_snapshot(snapshot: Snapshot) -> Snapshot:
    """Return a stable copy and reject ambiguous entity/tile identities."""
    normalized = copy.deepcopy(snapshot)
    required = {"worldDay", "map", "entities", "tiles"}
    if not required.issubset(normalized):
        raise ValueError(f"snapshot is missing: {', '.join(sorted(required - normalized.keys()))}")
    if not isinstance(normalized["worldDay"], int) or normalized["worldDay"] < 1:
        raise ValueError("worldDay must be a positive integer")
    map_size = normalized["map"]
    if not isinstance(map_size, dict) or not all(
        isinstance(map_size.get(name), int) and map_size[name] > 0
        for name in ("width", "height")
    ):
        raise ValueError("map width and height must be positive integers")

    entities = normalized["entities"]
    tiles = normalized["tiles"]
    if not isinstance(entities, list) or not isinstance(tiles, list):
        raise ValueError("entities and tiles must be arrays")
    if not all(isinstance(entity, dict) for entity in entities):
        raise ValueError("every entity must be an object")
    if not all(isinstance(tile, dict) for tile in tiles):
        raise ValueError("every tile must be an object")

    entity_keys = [entity.get("key") for entity in entities]
    tile_keys = [(tile.get("x"), tile.get("y")) for tile in tiles]
    if any(not isinstance(key, str) or not key for key in entity_keys):
        raise ValueError("every entity needs a non-empty string key")
    if len(entity_keys) != len(set(entity_keys)):
        raise ValueError("entity keys must be unique")
    if any(not all(isinstance(value, int) for value in key) for key in tile_keys):
        raise ValueError("every tile needs integer x and y coordinates")
    if len(tile_keys) != len(set(tile_keys)):
        raise ValueError("tile coordinates must be unique")

    normalized["entities"] = sorted(entities, key=lambda entity: entity["key"])
    normalized["tiles"] = sorted(tiles, key=lambda tile: (tile["y"], tile["x"]))
    return normalized


def build_transition(before: Snapshot, after: Snapshot) -> Transition:
    before = normalize_snapshot(before)
    after = normalize_snapshot(after)
    if after["worldDay"] != before["worldDay"] + 1:
        raise ValueError("snapshots must be consecutive world days")

    operations: list[dict[str, Any]] = []
    if before["map"] != after["map"]:
        operations.append({"kind": "set_map", "value": after["map"]})

    before_entities = {entity["key"]: entity for entity in before["entities"]}
    after_entities = {entity["key"]: entity for entity in after["entities"]}
    for key in sorted(before_entities.keys() - after_entities.keys()):
        operations.append({"kind": "remove_entity", "key": key})
    for key in sorted(after_entities):
        if before_entities.get(key) != after_entities[key]:
            operations.append({"kind": "upsert_entity", "value": after_entities[key]})

    before_tiles = {(tile["x"], tile["y"]): tile for tile in before["tiles"]}
    after_tiles = {(tile["x"], tile["y"]): tile for tile in after["tiles"]}
    for x, y in sorted(before_tiles.keys() - after_tiles.keys(), key=lambda key: (key[1], key[0])):
        operations.append({"kind": "remove_tile", "x": x, "y": y})
    for key in sorted(after_tiles, key=lambda key: (key[1], key[0])):
        if before_tiles.get(key) != after_tiles[key]:
            operations.append({"kind": "upsert_tile", "value": after_tiles[key]})

    return {
        "version": 1,
        "fromDay": before["worldDay"],
        "toDay": after["worldDay"],
        "beforeSha256": _snapshot_hash(before),
        "afterSha256": _snapshot_hash(after),
        "operations": operations,
    }


def replay_transition(before: Snapshot, transition: Transition) -> Snapshot:
    snapshot = normalize_snapshot(before)
    if transition.get("version") != 1:
        raise ValueError("unsupported transition version")
    if transition.get("fromDay") != snapshot["worldDay"]:
        raise ValueError("transition does not start at the snapshot world day")
    if transition.get("toDay") != snapshot["worldDay"] + 1:
        raise ValueError("transition does not advance exactly one world day")
    if transition.get("beforeSha256") != _snapshot_hash(snapshot):
        raise ValueError("snapshot hash does not match transition input")

    entities = {entity["key"]: entity for entity in snapshot["entities"]}
    tiles = {(tile["x"], tile["y"]): tile for tile in snapshot["tiles"]}
    for operation in transition.get("operations", []):
        kind = operation.get("kind")
        if kind == "set_map":
            snapshot["map"] = copy.deepcopy(operation["value"])
        elif kind == "remove_entity":
            entities.pop(operation["key"], None)
        elif kind == "upsert_entity":
            entity = copy.deepcopy(operation["value"])
            entities[entity["key"]] = entity
        elif kind == "remove_tile":
            tiles.pop((operation["x"], operation["y"]), None)
        elif kind == "upsert_tile":
            tile = copy.deepcopy(operation["value"])
            tiles[(tile["x"], tile["y"])] = tile
        else:
            raise ValueError(f"unsupported operation: {kind}")

    snapshot["worldDay"] = transition["toDay"]
    snapshot["entities"] = list(entities.values())
    snapshot["tiles"] = list(tiles.values())
    replayed = normalize_snapshot(snapshot)
    if transition.get("afterSha256") != _snapshot_hash(replayed):
        raise ValueError("replayed snapshot does not match transition output hash")
    return replayed


def _read_snapshot(path: Path) -> Snapshot:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("snapshot file must contain a JSON object")
    snapshot = value.get("snapshot", value)
    if not isinstance(snapshot, dict):
        raise ValueError("snapshot must be a JSON object")
    return snapshot


def _write_new(path: Path, value: Any) -> None:
    if path.exists():
        raise ValueError(f"refusing to replace existing file: {path}")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    make_parser = subparsers.add_parser("make-plan", help="derive and verify a transition plan")
    make_parser.add_argument("before", type=Path)
    make_parser.add_argument("after", type=Path)
    make_parser.add_argument("--output", type=Path)

    replay_parser = subparsers.add_parser("replay", help="apply an existing transition plan")
    replay_parser.add_argument("before", type=Path)
    replay_parser.add_argument("plan", type=Path)
    replay_parser.add_argument("--expected", type=Path)
    replay_parser.add_argument("--output", type=Path)

    args = parser.parse_args()
    try:
        before = _read_snapshot(args.before)
        if args.command == "make-plan":
            after = _read_snapshot(args.after)
            plan = build_transition(before, after)
            replayed = replay_transition(before, plan)
            assert replayed == normalize_snapshot(after)
            if args.output:
                _write_new(args.output, plan)
            print(f"DAY {plan['fromDay']} -> {plan['toDay']}: "
                  f"verified {len(plan['operations'])} deterministic operations")
        else:
            plan = json.loads(args.plan.read_text(encoding="utf-8"))
            replayed = replay_transition(before, plan)
            if args.expected and replayed != normalize_snapshot(_read_snapshot(args.expected)):
                raise ValueError("replayed snapshot differs from expected snapshot")
            if args.output:
                _write_new(args.output, replayed)
            print(f"DAY {plan['fromDay']} -> {plan['toDay']}: replay hash verified")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
