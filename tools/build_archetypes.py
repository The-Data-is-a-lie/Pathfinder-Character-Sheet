#!/usr/bin/env python3
"""Build the slim data/archetypes_by_class.json used by the sheet's archetype picker.

Reads the generator's full archetypes.json ({ "Class": { "Archetype": {...} } }) and
emits a compact { "lowercase class": ["Archetype Name", ...] } map — names only, so the
front-end can offer per-class archetypes without shipping the multi-MB source.

Point SRC at your local Pathfinder_Char_Creator backend copy, then run from the repo root:
    python tools/build_archetypes.py
"""
import json
import os

SRC = os.environ.get(
    "ARCHETYPES_SRC",
    r"C:\Users\Daniel\Documents\GitHub\Pathfinder_Char_Creator\Backend\json\archetypes.json",
)
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "archetypes_by_class.json")


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    slim = {}
    total = 0
    for cls, arche in data.items():
        if not isinstance(arche, dict):
            continue
        names = sorted(arche.keys(), key=lambda s: s.lower())
        if names:
            slim[cls.lower()] = names
            total += len(names)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"wrote {len(slim)} classes / {total} archetypes -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
