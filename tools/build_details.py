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

Builds weapon_details.json from every_weapon: name-keyed roll stats (action type,
crit range/mult, damage ability, Medium-size dice formula) for the Tools drawer.

Usage:
    C:\\Python310\\python.exe tools/build_details.py [--module-dir PATH] [--out-dir PATH]
"""
import argparse
import json
import re
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

VERBATIM = [
    "combat_talent_conditionals.json",
    "magic_talent_conditionals.json",
    "maneuver_changes.json",  # Path of War per-roll conditionals (Foundry attach table)
]

# sizeRoll(n, s, @size) at Medium == n d s. Also allow plain "NdX" / "N".
_SIZE_ROLL = re.compile(
    r"sizeRoll\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*@size\s*\)", re.IGNORECASE)
_PLAIN_DICE = re.compile(r"^(\d+)d(\d+)$", re.IGNORECASE)
_PLAIN_FLAT = re.compile(r"^(\d+)$")

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
    """Keep roll-relevant action fields (spells): type, save, damage, range, duration, area."""
    out = []
    for act in actions or []:
        slim = {}
        if act.get("name"):
            slim["name"] = act["name"]
        if act.get("actionType"):
            slim["actionType"] = act["actionType"]
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
        # Damage parts (Fireball (min(10,@cl))d6 fire, Acid Splash 1d3, …)
        dmg = act.get("damage") or {}
        parts_out = []
        for part in dmg.get("parts") or []:
            formula = (part.get("formula") or "").strip()
            if not formula:
                continue
            types = ((part.get("type") or {}).get("values") or [])
            entry = {"formula": formula}
            if types:
                entry["type"] = {"values": list(types)}
            parts_out.append(entry)
        if parts_out:
            slim["damage"] = {"parts": parts_out}
        ability = act.get("ability") or {}
        ab_out = {}
        if ability.get("attack"):
            ab_out["attack"] = ability["attack"]
        if ability.get("damage"):
            ab_out["damage"] = ability["damage"]
        if ab_out:
            slim["ability"] = ab_out
        mt = act.get("measureTemplate") or {}
        if mt.get("type"):
            slim["measureTemplate"] = {
                "type": mt.get("type"),
                "size": mt.get("size", ""),
            }
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


def _dice_from_formula(formula):
    """Resolve a weapon damage part formula to a Medium-size dice string (e.g. '1d8').

    Only the leading sizeRoll / NdX / flat number is kept; trailing ability riders
    (e.g. '+ min(@abilities.str.mod, 0)') are dropped — ability damage is applied
    separately at roll time.
    """
    if not formula:
        return None
    s = str(formula).strip()
    m = _SIZE_ROLL.search(s)
    if m:
        n, sides = int(m.group(1)), int(m.group(2))
        return f"{n}d{sides}" if sides > 1 else str(n)
    # First NdX or flat token in the string
    m = re.search(r"(\d+d\d+|\d+)", s, re.IGNORECASE)
    if not m:
        return None
    token = m.group(1)
    if _PLAIN_DICE.match(token) or _PLAIN_FLAT.match(token):
        return token.lower() if "d" in token.lower() else token
    return None


def _slim_weapon(item):
    """Roll-relevant weapon fields for the Tools attack menu."""
    system = item.get("system") or {}
    actions = system.get("actions") or []
    act = actions[0] if actions else {}
    ability = act.get("ability") or {}
    parts = []
    for p in (act.get("damage") or {}).get("parts") or []:
        formula = p.get("formula") or ""
        dice = _dice_from_formula(formula)
        if not dice:
            continue
        raw = p.get("types") if p.get("types") is not None else p.get("type")
        if isinstance(raw, dict):
            types = list(raw.get("values") or [])
            custom = (raw.get("custom") or "").strip()
            if custom:
                types.append(custom)
        elif isinstance(raw, str):
            types = [raw] if raw else []
        elif isinstance(raw, list):
            types = list(raw)
        else:
            types = []
        parts.append({"dice": dice, "types": types})
    if not parts and not act:
        return None
    entry = {
        "name": item.get("name", ""),
        "actionType": act.get("actionType") or "mwak",
        "critRange": int(ability.get("critRange") or 20),
        "critMult": int(ability.get("critMult") or 2),
        "damageAbility": ability.get("damage") or "str",
    }
    if parts:
        entry["parts"] = parts
        # Convenience: primary dice string for the common single-part case
        entry["dice"] = parts[0]["dice"]
    return entry


def build_weapons(module_dir: Path, out_dir: Path):
    src_name, data = _load_source(module_dir, "every_weapon")
    details = {}
    count = 0
    for item in _items_of(data):
        if not item.get("name"):
            continue
        if item.get("type") and item.get("type") != "weapon":
            continue
        entry = _slim_weapon(item)
        if not entry or not entry.get("name"):
            continue
        key = entry["name"].lower()
        count += 1
        # Prefer the entry that has dice parts
        if key not in details or (entry.get("parts") and not details[key].get("parts")):
            details[key] = entry
    out_path = out_dir / "weapon_details.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(details, fh, ensure_ascii=False, separators=(",", ":"))
    size_kb = out_path.stat().st_size / 1e3
    print(f"{src_name:38s} -> {'weapon_details.json':32s} {len(details):5d} keys "
          f"({count} items, {size_kb:.0f} KB)")


def _weight_value(system):
    """pf1 weight is usually {value, total, …}; older exports may use a bare number."""
    w = system.get("weight")
    if w is None:
        return None
    if isinstance(w, (int, float)):
        return float(w)
    if isinstance(w, dict):
        for key in ("value", "total"):
            if w.get(key) not in (None, ""):
                try:
                    return float(w[key])
                except (TypeError, ValueError):
                    pass
    return None


def _slim_loot_item(item):
    """Inventory gear: description, weight, always-on changes, slot metadata."""
    system = item.get("system") or {}
    entry = {"name": item.get("name", "")}
    desc = ((system.get("description") or {}).get("value") or "").strip()
    if desc:
        entry["description"] = desc
    weight = _weight_value(system)
    if weight is not None and weight != 0:
        entry["weight"] = weight
    elif weight == 0:
        entry["weight"] = 0
    changes = _slim_changes(system.get("changes"))
    if changes:
        entry["changes"] = changes
    notes = _slim_notes(system.get("contextNotes"))
    if notes:
        entry["contextNotes"] = notes
    for src_key in ("subType", "slot", "equipmentSubtype"):
        val = system.get(src_key)
        if val:
            entry[src_key] = val
    if item.get("type"):
        entry["itemType"] = item["type"]
    # Price (gp) when present — Foundry inventory value column
    price = system.get("price")
    if isinstance(price, dict):
        price = price.get("value", price.get("total"))
    if price not in (None, ""):
        try:
            entry["price"] = float(price)
        except (TypeError, ValueError):
            pass
    # Armor numbers when present (for display; combat still uses character armor fields)
    armor = system.get("armor") or {}
    if armor.get("value") not in (None, "", 0):
        entry["armor"] = {
            "value": armor.get("value"),
            "dex": armor.get("dex"),
            "acp": armor.get("acp"),
        }
    return entry


def _item_score(entry):
    return (len(entry.get("changes", [])), len(entry.get("contextNotes", [])),
            len(entry.get("description", "")), 1 if entry.get("weight") is not None else 0)


def build_items(module_dir: Path, out_dir: Path):
    """every_item + every_armor + every_weapon → item_details.json (name-keyed inventory lookup)."""
    details = {}
    total_items = 0
    sources_used = []
    for stem in ("every_item", "every_armor", "every_weapon"):
        try:
            src_name, data = _load_source(module_dir, stem)
        except FileNotFoundError:
            # some stems have no _MODS variant — load plain file
            path = module_dir / f"{stem}.json"
            if not path.is_file():
                print(f"{stem + '.json':38s} -> MISSING, skipped for item_details")
                continue
            with path.open(encoding="utf-8") as fh:
                data = json.load(fh)
            src_name = path.name
        sources_used.append(src_name)
        for item in _items_of(data):
            if not item.get("name"):
                continue
            # Skip pure containers with no useful payload? Keep them for weight/desc if any.
            entry = _slim_loot_item(item)
            if not entry.get("name"):
                continue
            key = entry["name"].lower()
            total_items += 1
            if key not in details or _item_score(entry) > _item_score(details[key]):
                details[key] = entry
    out_path = out_dir / "item_details.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(details, fh, ensure_ascii=False, separators=(",", ":"))
    size_mb = out_path.stat().st_size / 1e6
    src_label = "+".join(sources_used) if sources_used else "none"
    print(f"{src_label[:38]:38s} -> {'item_details.json':32s} {len(details):5d} keys "
          f"({total_items} items, {size_mb:.1f} MB)")


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

    try:
        build_weapons(module_dir, out_dir)
    except FileNotFoundError as err:
        print(f"every_weapon                        -> SKIPPED ({err})")

    try:
        build_items(module_dir, out_dir)
    except Exception as err:
        print(f"item_details                        -> SKIPPED ({err})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--module-dir", type=Path, default=DEFAULT_MODULE_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ns = parser.parse_args()
    build(ns.module_dir, ns.out_dir)
