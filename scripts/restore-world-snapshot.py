#!/usr/bin/env python3
"""Restore a /api/world-history/<day> response into an isolated SQLite file."""

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path, help="Downloaded world-history JSON response")
    parser.add_argument("database", type=Path, help="New scratch SQLite file")
    args = parser.parse_args()
    if args.database.exists():
        parser.error(f"Refusing to replace existing file: {args.database}")

    response = json.loads(args.snapshot.read_text(encoding="utf-8"))
    world = response["snapshot"]
    day = world["worldDay"]
    width, height = world["map"]["width"], world["map"]["height"]
    entities, tiles = world["entities"], world["tiles"]
    if not all(isinstance(value, int) and value > 0 for value in (day, width, height)):
        parser.error("Invalid world day or map size")

    with sqlite3.connect(args.database) as db:
        db.executescript("""
            CREATE TABLE world (day INTEGER PRIMARY KEY, width INTEGER NOT NULL,
                height INTEGER NOT NULL, source TEXT NOT NULL);
            CREATE TABLE entities (key TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE tiles (x INTEGER NOT NULL, y INTEGER NOT NULL,
                data TEXT NOT NULL, PRIMARY KEY (x, y));
        """)
        db.execute("INSERT INTO world VALUES (?, ?, ?, ?)",
                   (day, width, height, response["source"]))
        db.executemany("INSERT INTO entities VALUES (?, ?)",
                       ((entity["key"], json.dumps(entity, ensure_ascii=False, sort_keys=True))
                        for entity in entities))
        db.executemany("INSERT INTO tiles VALUES (?, ?, ?)",
                       ((tile["x"], tile["y"], json.dumps(tile, ensure_ascii=False, sort_keys=True))
                        for tile in tiles))

        restored_entities = [json.loads(row[0]) for row in db.execute("SELECT data FROM entities")]
        restored_tiles = [json.loads(row[0]) for row in db.execute("SELECT data FROM tiles")]
        assert sorted(restored_entities, key=lambda row: row["key"]) == sorted(
            entities, key=lambda row: row["key"])
        assert sorted(restored_tiles, key=lambda row: (row["x"], row["y"])) == sorted(
            tiles, key=lambda row: (row["x"], row["y"]))

    print(f"DAY {day}: restored {len(entities)} entities and {len(tiles)} explicit tiles "
          f"into {args.database} ({response['source']})")


if __name__ == "__main__":
    main()
