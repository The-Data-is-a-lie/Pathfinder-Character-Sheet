"""Build the slim data/*.json detail files for the static character sheet.

Reads the FoundryVTT pf1e_random_char_generator module's compendium exports
(every_feat / every_trait / every_class_feature / every_spell) in place and
extracts only what the sheet needs per item: the description HTML (which embeds
Prerequisites / Benefits), the numeric pf1 `changes` array (for future dice
rolling), and `contextNotes` (situational modifiers). Raw exports are NOT
copied into this repo -- rerun this script whenever the module data changes.

Like the module itself, the `_MODS` variant of each file is preferred (it
carries the fixed change formulas) with a fallback to the plain export.

Also copies combat/magic_talent_conditionals.json verbatim (they are already
small, curated files).

Usage:
    C:\\Python310\\python.exe tools/build_details.py [--module-dir PATH] [--out-dir PATH]
"""
import argparse
import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_MODULE_DIR = (Path.home() / "AppData" / "Local" / "FoundryVTT" / "Data" / "modules"
                      / "pf1e_random_char_generator" / "templates" / "character_sheet_folder")
DEFAULT_OUT_DIR = REPO / "data"

# (source stem, output filename, allow multiple entries per name)
SOURCES = [
    ("every_feat", "feat_details.json", False),
    ("every_trait", "trait_details.json", False),
    ("every_class_feature", "class_feature_details.json", True),
    ("every_spell", "spell_details.json", False),
]

VERBATIM = ["combat_talent_conditionals.json", "magic_talent_conditionals.json"]

# pf1 change fields worth keeping (drop _id and zeroed bookkeeping fields).
_CHANGE_FIELDS = ("formula", "target", "type", "operator", "priority", "value")


def _load_source(module_dir: Path, stem: str):
    """Prefer the _MODS variant (fixed change formulas), fall back to the plain export."""
    for name in (f"{stem}_MODS.json", f"{stem}.json"):
        path = module_dir / name
        if path.is_file():
            with path.open(encoding="utf-8") as fh:
                return name, json.load(fh)
    raise FileNotFoundError(f"neither {stem}_MODS.json nor {stem}.json found in {module_dir}")


def _slim_changes(changes):
    out = []
    for ch in changes or []:
        slim = {k: ch[k] for k in _CHANGE_FIELDS if k in ch and ch[k] not in (None, "")}
        # A change with no formula/target is dead weight.
        if slim.get("formula") not in (None, "", "0") and slim.get("target"):
            out.append(slim)
    return out


def _slim_notes(notes):
    out = []
    for note in notes or []:
        text = (note.get("text") or "").strip()
        if text:
            out.append({"text": text, "target": note.get("target", "")})
    return out


def _slim_actions(actions):
    """Keep only the roll-relevant basics of each action (spells mostly)."""
    out = []
    for act in actions or []:
        slim = {}
        if act.get("name"):
            slim["name"] = act["name"]
        save = act.get("save") or {}
        if save.get("type"):
            slim["save"] = {"type": save.get("type"), "description": save.get("description", ""),
                            "dc": save.get("dc", "")}
        rng = (act.get("range") or {})
        if rng.get("units"):
            slim["range"] = {"units": rng.get("units"), "value": rng.get("value", "")}
        dur = (act.get("duration") or {})
        if dur.get("units"):
            slim["duration"] = {"units": dur.get("units"), "value": dur.get("value", "")}
        if slim:
            out.append(slim)
    return out


def _slim_item(item, keep_actions):
    system = item.get("system") or {}
    entry = {"name": item.get("name", "")}
    desc = ((system.get("description") or {}).get("value") or "").strip()
    if desc:
        entry["description"] = desc
    for src_key, dst_key in (("subType", "subType"), ("traitType", "traitType"),
                             ("traitCategory", "traitCategory"), ("school", "school")):
        val = system.get(src_key)
        if val:
            entry[dst_key] = val
    tags = [t for t in (system.get("tags") or []) if t]
    if tags:
        entry["tags"] = tags
    classes = ((system.get("associations") or {}).get("classes") or [])
    classes = [c[0] if isinstance(c, list) else c for c in classes if c]
    if classes:
        entry["classes"] = classes
    learned = ((system.get("learnedAt") or {}).get("class") or {})
    if learned:
        entry["learnedAt"] = learned
    changes = _slim_changes(system.get("changes"))
    if changes:
        entry["changes"] = changes
    notes = _slim_notes(system.get("contextNotes"))
    if notes:
        entry["contextNotes"] = notes
    if keep_actions:
        actions = _slim_actions(system.get("actions"))
        if actions:
            entry["actions"] = actions
    return entry


def _items_of(data):
    """Every export is a top-level list of Items, except every_class.json-style Actor docs."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    raise ValueError("unrecognized export shape")


def _score(entry):
    """Pick the richer duplicate: automated changes first, then description length."""
    return (len(entry.get("changes", [])), len(entry.get("contextNotes", [])),
            len(entry.get("description", "")))


def build(module_dir: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    for stem, out_name, multi in SOURCES:
        src_name, data = _load_source(module_dir, stem)
        keep_actions = stem == "every_spell"
        details = {}
        count = 0
        for item in _items_of(data):
            if not item.get("name"):
                continue
            if (item.get("system") or {}).get("subType") == "temp":
                continue
            entry = _slim_item(item, keep_actions)
            key = entry["name"].lower()
            count += 1
            if multi:
                details.setdefault(key, []).append(entry)
            elif key not in details or _score(entry) > _score(details[key]):
                details[key] = entry
        out_path = out_dir / out_name
        with out_path.open("w", encoding="utf-8") as fh:
            json.dump(details, fh, ensure_ascii=False, separators=(",", ":"))
        size_mb = out_path.stat().st_size / 1e6
        print(f"{src_name:38s} -> {out_name:32s} {len(details):5d} keys "
              f"({count} items, {size_mb:.1f} MB)")

    for name in VERBATIM:
        src = module_dir / name
        if src.is_file():
            shutil.copyfile(src, out_dir / name)
            print(f"{name:38s} -> copied verbatim ({src.stat().st_size / 1e3:.0f} KB)")
        else:
            print(f"{name:38s} -> MISSING in module dir, skipped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--module-dir", type=Path, default=DEFAULT_MODULE_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ns = parser.parse_args()
    build(ns.module_dir, ns.out_dir)
