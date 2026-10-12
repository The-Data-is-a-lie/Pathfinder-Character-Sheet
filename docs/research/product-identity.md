# Product Identity inventory and draft §15 (play-store ticket 09)

*Research ticket 09. Question: what must be removed from the shipped data, or credited, before a free app can rely on OGL 1.0a alone (no Paizo Community Use Policy)?*
*Branch note: `research/licensing` (the prior ticket's `docs/research/licensing.md`) does not exist locally or on `origin`; this branch was cut from `main`. The prior ticket's headline figures (Golarion names plus book cross-references in about 20 backend files, a §15 missing about 7 books) are re-measured below, not assumed.*

## 1. Headline numbers

| Measure | Value |
| --- | --- |
| Sheet `data/*.json` records scanned (feats, traits, class features, spells, items) | 24,874 |
| ...with at least one Golarion Product Identity term | **2,464 (9.9%)** |
| ...of which the record **name** is setting-bound (drop candidates) | 1,160 (traits 900, feats 106, items 97, class features 31, spells 26) |
| ...of which only the **description** mentions it (redact candidates) | 1,304 |
| Generator files (`Backend/json`, `data`) with at least one Golarion PI term | 60 files, 1,960 distinct strings (of 188 files scanned) |
| Deities shipped: sheet `DEITIES` list / generator `deity.json` | 34 / 36 distinct (89 name aliases across 10 alignment buckets) |
| Regions shipped (sheet `REGIONS` / generator `data.regions`) | 10 real regions; **0 Paizo PI** (all homebrew: Fairdell/Cronia world) |
| WotC Product Identity found | **0** (the only "Beholder" hit is the archetype feature "In the Eye of the Beholder") |
| Source books the sheet's shipped text cites (via `system.sources`) | **279 distinct Paizo product IDs** (21 core-line, 53 campaign setting, 94 player companion, 69 AP volume, 24 player's guide, 13 module, 2 PFS, 1 comic) |
| Core-line books **missing from the generator's current §15** | **8** (+ Technology Guide filed as "setting" = 9); **264 of the 277 resolvable products cited are uncredited** |
| Sheet records with **no** book attribution in the module export | 12,336 (49.6%) — §15 derived from fields is a lower bound |

## 2. Legal baseline (what "PI" means here)

* Paizo's own Product Identity declaration (verbatim from the Paizo reference document, `legacy.aonprd.com/openGameLicense.html`): *"All trademarks, registered trademarks, proper names (characters, deities, etc.), dialogue, plots, storylines, locations, characters, artworks, and trade dress. (Elements that have previously been designated as Open Game Content are not included in this declaration.)"* Open Content: *"Except for material designated as Product Identity (see above), the game mechanics of this Paizo Publishing game product are Open Game Content."* Only **game mechanics** are open; flavour prose is not OGC even where it contains no PI term.
* `paizo.com/licenses` (fetched 2026-10-11): the OGL "doesn't allow you to use any Product Identity, which includes Paizo's trademarks and copyrighted non-rules content" (characters, locations, organizations, deities, events, art, maps). The page lists a Community Use Policy (non-commercial, not paywalled) *and* a Fan Content Policy that excludes anything needing OGL/ORC mechanics. Secondary sources say the CUP has been replaced; confirm on the live page before relying on either.
* OGL 1.0a §7 (text in `Pathfinder_Char_Creator/LICENSE-OGL.txt`): no use of PI "including as an indication as to compatibility" and no indicating compatibility with any Trademark. **"Pathfinder" and "Paizo" are the PI/trademark terms that matter most for a store listing**: sheet `index.html` title + `<h1>`, `manifest.webmanifest` name/description, README all say "Pathfinder"; data text says "Pathfinder" 976 times (sheet) / 966 (generator), mostly book titles ("Pathfinder Society", "Pathfinder Campaign Setting") and cross-references.
* Three tiers used below: **T1 hard PI** (setting, places, peoples, organisations, named NPCs, deities, adventure-path names), **T2 product names** (book titles in `source`/cross-refs; needed in §15, avoidable everywhere else), **T3 marks** (Pathfinder, Paizo, PFS).

## 3. Inventory

Method: stdlib Python walked every JSON/CSV leaf (keys and values) in `data/*.json` (sheet, 13 files) and the generator's `Backend/json` (182 files) + `data/*.csv` (6 files, pipe-delimited). Case-sensitive, word-bounded regexes over curated term families (about 90 deities, 28 setting names, 75 places, 29 peoples, 12 planes, 40 organisations, 27 adventure paths, 46 named NPCs/iconics). "Strings" = distinct leaf strings (or keys) matching; "records" = top-level entries (sheet: one feat/trait/item/spell per key). Families overlap, so rows do not sum to the union figures in §1. Counts are lower bounds (term lists are curated, not exhaustive).

### 3a. Sheet `data/*.json` (shipped to users, ~22 MB)

| Family (tier) | Strings | Records | Main fields | Examples |
| --- | ---: | ---: | --- | --- |
| Deities (T1) | 988 | 699 | `trait_details` 448 strings/229 records, `item_details` 272/235, `feat_details` 166/144, `spell_details` 67/58, `class_feature_details` 31/29 | Iomedae 126, Sarenrae 111, Asmodeus 76, Desna 71 (76 distinct deities hit) |
| Places, nations, cities (T1) | 1,225 | 842 | name + description; `trait_details` 857/502 | Varisia 174, Osirion 126, Katapesh 126, Cheliax 125 (72 distinct) |
| Setting names (T1) | 803 | 749 | `trait_details` 502/433, `item_details` 208/226 | Inner Sea 194, Garund 177, Avistan 172, Tian Xia 144, Golarion 137 |
| Peoples / ethnicities (T1) | 589 | 422 | `trait_details` 357/207 | Mwangi 146, Shoanti 128, Varisian 105 |
| Organisations, factions (T1) | 434 | 309 | `trait_details` 245/128, `feat_details` 99/89 | Pathfinder Society 200, Hellknight 139, Red Mantis 34 |
| Adventure paths (T1/T2) | 301 | 256 | `trait_details` 252/215 (campaign traits are suffixed with the AP name) | Kingmaker 54, Curse of the Crimson Throne 41, Second Darkness 40 |
| Planes / planets (T1) | 89 | 91 | `feat_details` 28/31 | Outer Rifts 39, Boneyard 27, Maelstrom 23 |
| Named NPCs / iconics (T1) | 74 | 61 | `item_details` 59/47 | Xin 23, Karzoug 18, Alaznist 16, Baba Yaga 15 |
| Real-world demon lords (ambiguous; public-domain names, but Orcus is WotC-origin) | 46 | 33 | `item_details` 25/20 | Orcus 18, Baphomet 17 |
| "Pathfinder" / "Paizo" / "PFS" / "Starfinder" (T3) | 816 | 896 | all five catalogs | Pathfinder 976 occurrences |
| Third-party names (Spheres of Power/Might, Dreamscarred, Drop Dead Studios) | 8 | 8 | `feat_details` | credits-type text |

The setting-bound portion of the **trait** catalog is large by construction: by `traitType`, 461 region, 218 campaign, 214 religion + 109 faith (323 deity-keyed; 165 have a deity in the name), 66 faction = **1,068 of 2,059 traits**; 900 trait names hit a term outright. Of the 900 name-hit traits, 716 carry `changes` or `contextNotes` (mechanical).

By file (any Golarion family): `trait_details` 2,684 strings, `item_details` 948, `feat_details` 579, `spell_details` 172, `class_feature_details` 90, `archetypes_by_class` 26 (archetype names such as the Qadiran/Taldan-flavoured ones), `demo-character` 3, `weapon_details` 1 (key "Shoanti Bolas").
**Book cross-references:** the extracts carry **no `source` field** (the build dropped `system.sources`); citations survive only as prose ("Inner Sea Gods", "Pathfinder Campaign Setting" inside item/spell text: 80 "Inner Sea", 61 "Golarion" and 37 "Pathfinder Campaign Setting" occurrences in `item_details` alone).

### 3b. Generator (`Pathfinder_Char_Creator`, read-only)

| Family | Files | Strings | Heaviest files (strings) |
| --- | ---: | ---: | --- |
| Deities | 39 | 510 | `archetypes.json` 103, `spells.csv` 87, `foundry_item_names.json` 42, `oracle.json` 37, `warpriest.json` 37, `deity.json` 36, `campaign_lore.json` 25 |
| Places, nations, cities | 30 | 428 | `archetypes.json` 186, `spells.csv` 60, `companion_archetypes.json` 22, `feats*.csv` 22 each |
| Setting names | 33 | 460 | `archetypes.json` 202, `spells.csv` 46, `weapons_data.json` 40 (Inner Sea 553 occurrences, Golarion 259) |
| Peoples | 24 | 242 | `archetypes.json` 100, `spells.csv` 27, `CoreRaces.json` 13, `PlayableRaces.json` 13 |
| Organisations | 21 | 150 | `archetypes.json` 59, `spells.csv` 29 |
| Adventure paths | 13 | 56 | `weapons_data.json` 20, `traits.csv` 12 |
| Planes | 16 | 52 | `archetypes.json` 10 |
| Named NPCs | 14 | 62 | `foundry_item_names.json` 15, `archetypes.json` 14 |
| Pathfinder/Paizo marks | 48 | 734 | `spells.csv` 204, `archetypes.json` 195 |
| Third-party names (Psionics Augmented 74, Path of War 26, Spheres of Might 23, Psionics Unleashed 21, Spheres of Power 19) | 22 | 143 | `psionic_class_options.json` 37, `soulknife.json` 34 |

**Book cross-references in the generator:** `source` fields of the form "`<Title> pg. N`" occur ~4,800 times in JSON (`items_best` 1,456, `archetypes` 1,275, `mythic_path_abilities` 597, `weapons_data` 306, `weapon_qualities` 266, `Magic_Rings` 219, `companion_archetypes` 202, `armor_qualities` 160, `firearms` 134, plus `armor`, `oracle`, `warpriest`, `CoreRaces`, `NonCoreRaces`), and a `source` column in `feats.csv` (1,486 rows), `feats_new.csv` (3,306), `spells.csv` (2,827), `traits.csv`. 301 distinct titles/aliases appear; after collapsing aliases the generator adds only a handful beyond the sheet's set (§5).

Other generator files that matter for PI but are not term hits: `campaign_lore.json` (homebrew world "Fairdell / Cronia", year 5256; names Iomedae/Pharasma as rival churches), `backstory_examples/*.json` (4 of 13 name Golarion deities), `Backend/utils/data.py` (`all_deities` good/neutral/evil lists incl. real-world gods and a commented-out longer list; `languages` includes Kelish/Wayang).

## 4. What each term family affects

| Surface | Mechanism | Consumes PI? | Break if replaced by generic/OGL-safe names |
| --- | --- | --- | --- |
| Sheet generate form `Deity` select | `DEITIES` in `scripts/data.js` (34 names + `random`) → `buildPayload` → positional `deity_choice` (9th input of `app.py` unpack) | Yes, 34 T1 names | Pure label swap in `data.js` **only if** the backend recognises the new names |
| Sheet generate form `Region` select | `REGIONS` in `data.js` → `region` | No (10 homebrew regions) | Nothing; keep |
| Backend `deity_choice` resolution | `alignment_and_deity.py::randomize_deity`: input name matched against `deity.json` `Name[]`; **unknown name silently falls back to a random deity** (region-biased 70%) | Yes (`deity.json`: 36 deities × `Name`, `Portfolio`, `Worshipers`, `Domains`, `Subdomains`) | Old saved forms/recipes passing "Sarenrae" quietly randomise; no error. Only `Name` and `Domains` are read by code; `Portfolio`/`Worshipers`/`Subdomains` are dead text (safe to drop) |
| **Deity → domain link** | `domain_inquisition.py` samples 2 of `deity_choice['Domains']` for a cleric (or, 10% of the time, a non-cleric inquisitor); `cleric_domains.json` (37 domains) supplies the powers | Domain names/powers are OGC mechanics; only the deity key is PI | Renaming deities is free **if each replacement keeps the same `Domains` list** (36 rows). Dropping deity records instead removes domain choice for clerics unless a generic pool replaces it |
| `region_deity_affinity` (`data.py`) | 3 regions (Sojoria, Esterdragon, Feyador) bias deity choice toward 11 listings (8 distinct: Abadar, Pharasma, Cayden Cailean, Desna, Iomedae, Shelyn, Ragathiel; Tanagaar looks homebrew) | Yes | Names that no longer exist yield no match → falls to plain random (silent loss of campaign flavour) |
| Backstory | `campaign_lore.json` `deities` index (25 PI strings), LLM brief includes "Deity: …", 4 example backstories | Yes | Lore text must be re-keyed; otherwise deity notes just stop appearing (`_lore_deity_notes` returns nothing) |
| Sheet header `Region` / `Deity` (`header.js`, `simple.js`) | Free-text editable fields (`region`, `deity_name`) | No constraint | None; user-typed Golarion deities remain user content |
| Related-NPC recipes (`generate-recipes.js`) | Passes the open character's `deity_name`/`region` back as generator inputs | Indirect | Free-text deity not in list → random deity on the backend (acceptable) |
| Religion/faith traits (323) and deity-keyed feats/spells/items | Trait catalog `Requirements: <deity>`; spells like "Light of Iomedae"; items like "Staff of Curchanus" | Yes, in name | Rename = break trait ↔ deity matching; drop = lose 323 traits (deity-mentioning records overall: 699, overlapping) |
| Region traits (461), campaign traits (218), faction traits (66) | Pure catalog entries, no code dependency | Yes, in name | Drop whole families; characters that already store such a trait keep the name but lose its description/changes lookup |
| Book `source` fields | Display/provenance only (no code path found that branches on them; not exhaustively checked) | T2 | Safe to strip from the shipped build; §15 must still list the books |

## 5. Completing §15

Current generator `LICENSE-OGL.txt` §15 lists 13 Paizo rulebooks plus Dreamscarred and Drop Dead Studios entries and WotC/legacy boilerplate. Evidence for completeness:

* The module exports the sheet extracts come from carry `system.sources` with Paizo product IDs. Resolved through the pf1 system's own source registry (`systems/pf1/pf1.js` `Sources._defaultData`, 466 entries with name/date/type), the **sheet's shipped records cite 279 distinct products** (record counts below = records in `data/*.json` that name the book; a record can cite several).
* The Paizo reference document (`legacy.aonprd.com/openGameLicense.html`) lists 20 Paizo books plus the Reference Document itself as the open set (Core, Bestiary 1-5, GMG, ACG, APG, ARG, Monster Codex, Mythic Adventures, NPC Codex, Occult Adventures, Unchained, UM, UCampaign, UC, Ultimate Equipment, Technology Guide). Books outside that list (Ultimate Intrigue, Horror Adventures, Ultimate Wilderness, Adventurer's Guide, ...) carry their own §15 and the same mechanics-only Open Content declaration; they are credited here but are not on the reference-document list.

### 5a. Core line (21 books cited in the sheet)

| Book | ID | Year | §15 entity | Sheet records | In PRD list | Status |
| --- | --- | --- | --- | ---: | --- | --- |
| Core Rulebook | PZO1110 | 2009 | Paizo Publishing, LLC | 1787 | PRD | in current §15 |
| Bestiary [1] | PZO1112 | 2009 | Paizo Publishing, LLC | 1 | PRD | in current §15 |
| GameMastery Guide | PZO1114 | 2010 | Paizo Publishing, LLC | 8 | PRD | in current §15 |
| Advanced Player's Guide | PZO1115 | 2010 | Paizo Publishing, LLC | 831 | PRD | in current §15 |
| Ultimate Magic | PZO1117 | 2011 | Paizo Publishing, LLC | 332 | PRD | in current §15 |
| Ultimate Combat | PZO1118 | 2011 | Paizo Publishing, LLC | 281 | PRD | in current §15 |
| Advanced Race Guide | PZO1121 | 2012 | Paizo Publishing, LLC | 256 | PRD | in current §15 |
| Ultimate Equipment | PZO1123 | 2012 | Paizo Publishing, LLC | 1851 | PRD | **MISSING** |
| Ultimate Campaign | PZO1125 | 2013 | Paizo Publishing, LLC | 233 | PRD | in current §15 |
| Mythic Adventures | PZO1126 | 2013 | Paizo Publishing, LLC | 116 | PRD | in current §15 |
| Monster Codex | PZO1130 | 2014 | Paizo Inc. | 94 | PRD | **MISSING** |
| Pathfinder Unchained | PZO1131 | 2015 | Paizo Inc. | 144 | PRD | **MISSING** |
| Occult Adventures | PZO1132 | 2015 | Paizo Inc. | 265 | PRD | in current §15 |
| Advanced Class Guide | PZO1129 | 2015 | Paizo Inc. | 655 | PRD | in current §15 |
| Ultimate Intrigue | PZO1134 | 2016 | Paizo Inc. | 219 | - | in current §15 |
| Horror Adventures | PZO1135 | 2016 | Paizo Inc. | 156 | - | in current §15 |
| Villain Codex | PZO1136 | 2016 | Paizo Inc. | 127 | - | **MISSING** |
| Adventurer's Guide | PZO1138 | 2017 | Paizo Inc. | 146 | - | **MISSING** |
| Book of the Damned | PZO1139 | 2017 | Paizo Inc. | 53 | - | **MISSING** |
| Ultimate Wilderness | PZO1140 | 2017 | Paizo Inc. | 179 | - | **MISSING** |
| Planar Adventures | PZO1141 | 2018 | Paizo Inc. | 70 | - | **MISSING** |

Technology Guide (PZO9272, 2014, Paizo Inc., 25 records) is typed "setting" by the registry but is a reference-document book; it is also missing. Bestiary 2-5 and NPC Codex are on the reference-document list and referenced by the generator's data (races, `cr_benchmarks`, creature chassis) but have zero or one citation in the sheet extracts; include them if any creature-derived data (races, companion statistics) ships. **Missing core-line books actually cited: 8 (Ultimate Equipment, Monster Codex, Pathfinder Unchained, Villain Codex, Adventurer's Guide, Book of the Damned, Ultimate Wilderness, Planar Adventures) + Technology Guide**; Ultimate Equipment alone supports 1,851 item records.

### 5b. The rest of the cited products (all missing from current §15)

**Campaign Setting / Chronicles — 53 titles, 1,328 record-citations.** Aquatic Adventures (2017); Artifacts & Legends (2012); Belkzen, Hold of the Orc Hordes (2015); Castles of the Inner Sea (2013); Chronicle of the Righteous (2013); Demons Revisited (2013); Distant Realms (2018); Distant Shores (2015); Distant Worlds (2012); Dungeons of Golarion (2011); Giants Revisited (2012); Heaven Unleashed (2016); Hell Unleashed (2015); Horror Realms (2016); Horsemen of the Apocalypse (2011); Inner Sea Combat (2014); Inner Sea Gods (2014); Inner Sea Intrigue (2016); Inner Sea Magic (2011); Inner Sea Monster Codex (2015); Inner Sea Races (2015); Inner Sea Temples (2016); Lands of the Linnorm Kings (2011); Lords of Chaos (2010); Lost Kingdoms (2012); Lost Treasures (2014); Misfit Monsters Redeemed (2010); Mystery Monsters Revisited (2012); Occult Bestiary (2015); Occult Mysteries (2014); Occult Realms (2015); Osirion, Legacy of Pharaohs (2014); Path of the Hellknight (2016); Pathfinder Chronicles: Campaign Setting (2008); Pathfinder Chronicles: Cities of Golarion (2009); Pathfinder Chronicles: City of Strangers (2010); Pathfinder Chronicles: Classic Horrors Revisited (2010); Pathfinder Chronicles: Classic Monsters Revisited (2008); Pathfinder Chronicles: Classic Treasures Revisited (2010); Pathfinder Chronicles: Dark Markets: A Guide to Katapesh (2009); Pathfinder Chronicles: Dungeon Denizens Revisited (2009); Pathfinder Chronicles: Faction Guide (2010); Pathfinder Chronicles: Gods and Magic (2008); Pathfinder Chronicles: Guide to the River Kingdoms (2010); Pathfinder Chronicles: Seekers of Secrets (2009); Pathfinder Society Field Guide (2011); Planes of Power (2016); Qadira, Jewel of the East (2017); Rival Guide (2011); Technology Guide (2014); The First World, Realm of the Fey (2016); The Inner Sea World Guide (2011); Undead Unleashed (2014).

**Player Companion — 94 titles, 3,565 record-citations.** Advanced Class Origins (2014); Adventurer's Armory (2010); Adventurer's Armory 2 (2017); Agents of Evil (2015); Alchemy Manual (2014); Andoran, Spirit of Liberty (2010); Animal Archive (2013); Antihero's Handbook (2017); Arcane Anthology (2016); Armor Master's Handbook (2016); Bastards of Golarion (2014); Black Markets (2015); Blood of Angels (2012); Blood of Fiends (2012); Blood of Shadows (2016); Blood of the Ancients (2018); Blood of the Beast (2016); Blood of the Coven (2017); Blood of the Elements (2014); Blood of the Moon (2013); Blood of the Night (2012); Blood of the Sea (2017); Champions of Balance (2014); Champions of Corruption (2014); Champions of Purity (2013); Cheliax, Empire of Devils (2009); Chronicle of Legends (2019); Cohorts and Companions (2015); Demon Hunter's Handbook (2013); Dirty Tactics Toolbox (2015); Disciple's Doctrine (2018); Divine Anthology (2016); Dragon Empires Primer (2012); Dragonslayer's Handbook (2013); Dungeoneer's Handbook (2013); Dwarves of Golarion (2009); Elemental Master's Handbook (2017); Elves of Golarion (2008); Faiths & Philosophies (2013); Faiths of Balance (2011); Faiths of Corruption (2011); Faiths of Purity (2011); Familiar Folio (2015); Giant Hunter's Handbook (2014); Gnomes of Golarion (2010); Goblins of Golarion (2011); Halflings of Golarion (2011); Haunted Heroes Handbook (2016); Healer's Handbook (2017); Heroes from the Fringe (2018); Heroes of Golarion (2019); Heroes of the Darklands (2017); Heroes of the High Court (2017); Heroes of the Streets (2015); Heroes of the Wild (2015); Humans of Golarion (2011); Inner Sea Primer (2010); Knights of the Inner Sea (2012); Kobolds of Golarion (2013); Legacy of Dragons (2016); Legacy of the First World (2017); Magic Tactics Toolbox (2016); Magical Marketplace (2013); Martial Arts Handbook (2018); Melee Tactics Toolbox (2015); Merchant's Manifest (2018); Monster Hunter's Handbook (2017); Monster Summoner's Handbook (2015); Mythic Origins (2013); Occult Origins (2015); Orcs of Golarion (2010); Osirion, Land of Pharaohs (2008); Pathfinder Society Primer (2013); Paths of the Righteous (2016); People of the North (2013); People of the River (2014); People of the Sands (2014); People of the Stars (2014); People of the Wastes (2017); Pirates of the Inner Sea (2012); Plane-Hopper's Handbook (2018); Potions & Poisons (2017); Psychic Anthology (2017); Qadira, Gateway to the East (2009); Quests & Campaigns (2013); Ranged Tactics Toolbox (2014); Sargava, the Lost Colony (2010); Spymaster's Handbook (2016); Taldor, Echoes of Glory (2009); The Harrow Handbook (2014); Undead Slayer's Handbook (2014); Varisia, Birthplace of Legends (2012); Weapon Master's Handbook (2015); Wilderness Origins (2019).

**Adventure Path volumes — 69 titles, 235 record-citations.** Carrion Crown #1: The Haunting of Harrowstone (2011); Carrion Crown #2: Trial of the Beast (2011); Council of Thieves #2: The Sixfold Trial (2009); Council of Thieves #5: Mother of Flies (2010); Council of Thieves #6: The Twice-Damned Prince (2010); Curse of the Crimson Throne (2016); Curse of the Crimson Throne #2: Seven Days to the Grave (2008); Giantslayer #1: Battle of Bloodmarch Hill (2015); Giantslayer #3: Forge of the Giant God (2015); Giantslayer #5: Anvil of Fire (2015); Hell's Rebels #3: Dance of the Damned (2015); Hell's Rebels #6: Breaking the Bones of Hell (2016); Hell's Vengeance #2: Wrath of Thrune (2016); Hell's Vengeance #4: For Queen & Empire (2016); Hell's Vengeance #5: Scourge of the Godclaw (2016); Iron Gods #2: Lords of Rust (2014); Iron Gods #5: Palace of Fallen Stars (2014); Iron Gods #6: The Divinity Drive (2015); Ironfang Invasion #1: Trail of the Hunted (2017); Ironfang Invasion #2: Fangs of War (2017); Ironfang Invasion #3: Assault on Longshadow (2017); Ironfang Invasion #5: Prisoners of the Blight (2017); Jade Regent #2: Night of Frozen Shadows (2011); Jade Regent #3: The Hungry Storm (2011); Jade Regent #5: Tide of Honor (2012); Kingmaker #2: Rivers Run Red (2010); Kingmaker #5: War of the River Kings (2010); Legacy of Fire #1: Howl of the Carrion King (2009); Legacy of Fire #5: The Impossible Eye (2009); Legacy of Fire #6: The Final Wish (2009); Mummy's Mask #2: Empty Graves (2014); Mummy's Mask #3: Shifting Sands (2014); Mummy's Mask #4: Secrets of the Sphinx (2014); Mummy's Mask #6: Pyramid of the Sky Pharaoh (2014); Reign of Winter #1: The Snows of Summer (2013); Reign of Winter #2: The Shackled Hut (2013); Reign of Winter #3: Maiden, Mother, Crone (2013); Reign of Winter #5: Rasputin Must Die! (2013); Return of the Runelords #2: It Came from Hollow Mountain (2018); Return of the Runelords #3: Runeplague (2018); Rise of the Runelords #2: The Skinsaw Murders (2007); Rise of the Runelords #5: Sins of the Saviors (2007); Rise of the Runelords Anniversary Edition (2012); Ruins of Azlant #3: The Flooded Cathedral (2017); Second Darkness #2: Children of the Void (2008); Second Darkness #3: The Armageddon Echo (2008); Second Darkness #4: Endless Night (2008); Second Darkness #5: A Memory of Darkness (2008); Serpent's Skull #2: Racing to Ruin (2010); Serpent's Skull #3: City of Seven Spears (2010); Serpent's Skull #5: The Thousand Fangs Below (2011); Serpent's Skull #6: Sanctum of the Serpent God (2011); Shattered Star #1: Shards of Sin (2012); Shattered Star #2: Curse of the Lady's Light (2012); Shattered Star #4: Beyond the Doomsday Door (2012); Shattered Star #5: Into the Nightmare Rift (2012); Skull & Shackles #1: The Wormwood Mutiny (2012); Skull & Shackles #2: Raiders of the Fever Sea (2012); Skull & Shackles #5: The Price of Infamy (2012); Strange Aeons #2: The Thrushmoor Terror (2016); Strange Aeons #4: The Whisper Out of Time (2016); Strange Aeons #5: What Grows Within (2017); Tyrant's Grasp #1: The Dead Roads (2019); Tyrant's Grasp #2: Eulogy for Roslar's Coffer (2019); Tyrant's Grasp #5: Borne by the Sun's Grace (2019); War for the Crown #5: The Reaper's Right Hand (2018); Wrath of the Righteous #2: Sword of Valor (2013); Wrath of the Righteous #5: Herald of the Ivory Labyrinth (2014); Wrath of the Righteous #6: City of Locusts (2014).

**AP Player's Guides — 24 titles, 319 record-citations.** Carrion Crown Player's Guide (2011); Council of Thieves Player's Guide (2009); Curse of the Crimson Throne Player's Guide (2008); Giantslayer Player's Guide (2015); Hell's Rebels Player's Guide (2015); Hell's Vengeance Player's Guide (2016); Iron Gods Player's Guide (2014); Ironfang Invasion Player's Guide (2017); Jade Regent Player's Guide (2011); Kingmaker Player's Guide (2010); Legacy of Fire Player's Guide (2009); Mummy's Mask Player's Guide (2014); Reign of Winter Player's Guide (2013); Return of the Runelords Player's Guide (2018); Rise of the Runelords Anniversary Edition Player's Guide (2012); Ruins of Azlant Player's Guide (2017); Second Darkness Player's Guide (2008); Serpent's Skull Player's Guide (2010); Shattered Star Player's Guide (2012); Skull and Shackles Player's Guide (2012); Strange Aeons Player's Guide (2016); Tyrant's Grasp Player's Guide (2019); War for the Crown Player's Guide (2018); Wrath of the Righteous Player's Guide (2013).

**Modules — 13 titles, 19 record-citations.** Conquest of Bloodsworn Vale (2007); Curse of the Riven Sky (2010); Daughters of Fury (2015); Fangwood Keep (2013); From Shore to Sea (2010); Guardians of Dragonfall (2007); Murder's Mark (2012); Plunder & Peril (2014); The Dragon's Demand (2013); The House on Hook Street (2015); The Midnight Mirror (2012); The Moonscar (2012); We Be Goblins! (2011).

PFS: Pathfinder Society Roleplaying Guild Guide (66 records), Pathfinder Society Scenario #3-10 The Immortal Conundrum (1). Comics: Pathfinder Comics #10 (2). Two non-resolving IDs ("PZO110", "Languid Venom") are typos in the module export and should be fixed upstream.

**Generator-only additions** (cited in generator `source` strings, not in the sheet's set): Mythic Realms (60 mythic path abilities), Construct Handbook (12), Inner Sea Taverns, Inner Sea Bestiary, Bestiary 6, Gallery of Evil, Condition Cards, Book of the Damned vol. 1-2, Worldscape and Spiral of Bones issues, about 25 individually named Adventure Path volumes ("Pathfinder #71: Rasputin Must Die!" etc.) and about 35 volumes cited only as "AP NN". Non-Paizo/unclear: **"3.5 SRD" (8 rows, WotC SRD: already covered by the first two §15 lines)**, **"Sieg's Guide (homebrew)" / "Sieg's Feats Doc" (93 feats in `feats_new.csv` / E-Kat feats)** and the **Metzofitz** dataset (1,735 rows with blank source, `feats_new.csv`): these are fan compilations whose licence/provenance is unknown and must be cleared separately.

### 5c. Draft §15 (what to publish)

Entry format for every Paizo title: `Pathfinder Roleplaying Game <Title>. © <year>, Paizo Publishing, LLC (through 2013) / Paizo Inc. (2014 on); Authors: <copy from the book>`. Title, year and entity above are verified from the pf1 source registry and the reference document; the **author clauses are not machine-verifiable here** and must be copied verbatim from each book's own Section 15 (for the 20 reference-document books, from `legacy.aonprd.com/openGameLicense.html`). Order: OGL text, WotC lines, Paizo, third-party, then the unchanged generator boilerplate.

1. Keep verbatim from the generator: OGL v1.0a, System Reference Document, the 13 current Paizo entries, and every Dreamscarred Press / Drop Dead Studios / legacy-boilerplate line (Book of Experimental Might, Tome of Horrors, Unearthed Arcana, Hyperconscious, If Thoughts Could Kill, Mindscapes, Mutants & Masterminds, Swords of Our Fathers, Modern SRD).
2. **Add core line (8):** Pathfinder Roleplaying Game Ultimate Equipment (2012, Paizo Publishing, LLC); Pathfinder Unchained (2015); Monster Codex (2014); Villain Codex (2016); Adventurer's Guide (2017); Book of the Damned (2017); Ultimate Wilderness (2017); Planar Adventures (2018). Technology Guide (2014) is in the next group. Also add Bestiary 2 (2010), 3 (2011), 4 (2013), 5 (2015) and NPC Codex (2012) if any creature-derived data ships.
3. **Add campaign-setting, player-companion, AP, player's-guide, module, PFS and comic entries (§5b)**: 53 + 94 + 69 + 24 + 13 + 3 = **256 entries**, each in the Paizo format above (setting and AP books: `Pathfinder <Line> <Title>. © <year>, Paizo Publishing, LLC / Paizo Inc.; Authors: ...`). If the build instead keeps only mechanics from reference-document books (sub-option B2 below), this block shrinks to zero.
4. Third-party additions to check: Mythic Realms (Paizo), Sieg/E-Kat feats and Metzofitz data only if cleared.

**Draft §15 book count: 277 resolvable Paizo products cited by the sheet = 13 already credited + 8 missing core-line + 256 setting/companion/AP/PG/module/PFS/comic (Technology Guide included) = 13 + 264 to add.** Optional extras: Bestiary 2-5 and NPC Codex (5) and about 9 generator-only titles (§5b). The other 2 of the 279 IDs are typos in the export. Third-party and legacy lines already in the file are kept unchanged.

Caveat: 12,336 sheet records (feats 7,225, class features 3,342, items 1,709, traits 50, spells 10) have no `sources` in the Foundry export (Dreamscarred/DDS/psionics content and core Foundry rows), so even 279 is a floor. The safe posture is an over-inclusive §15 plus the mechanics-only filter, not a proof of exact derivation.

## 6. Third-party Product Identity

| Publisher | Shipped in sheet | In generator | PI declaration findable? |
| --- | --- | --- | --- |
| Dreamscarred Press (Path of War, Psionics Unleashed/Ultimate Psionics/Psionics Augmented) | `maneuver_changes.json` 854 maneuvers, `stance_changes.json` 159 stances | `class_data/path_of_war/` (8 files, 1.8 MB), `class_data/psionics/` (8 files, 2 MB, 660 powers) | **Partly.** Other Dreamscarred books (Psionics Augmented, April Augmented) use Paizo-style wording: trademarks, proper names, dialogue, plots, storylines, locations, characters, artwork, trade dress under §1(e); previously open or public-domain elements excluded; logos and product/line names reserved. Path of War: "game mechanics are Open Game Content apart from material marked Product Identity", built from scratch because Book of Nine Swords is not open. **The exact declarations in Path of War, Psionics Unleashed and Ultimate Psionics were not retrievable online (PDFs); unverified.** Practical consequence: setting names, class/discipline lore names and product names ("Path of War", "Dreamscarred Press") must not be used as marketing or compatibility claims; the mechanical maneuver text is OGC. |
| Drop Dead Studios (Spheres of Power, Spheres of Might, Mythic Spheres) | `combat_talent_conditionals.json` 428 talents (24 spheres), `magic_talent_conditionals.json` 420 talents (24 spheres) | `class_data/spheres/` (13 files, 4.7 MB), `sphere_feats.json` 625 | **Only from the fan wiki** (`spheresofpower.wikidot.com/legal:start`, not authoritative): same Paizo-style PI list (trademarks, proper names, dialogue, plots, storylines, locations, characters, artwork, trade dress), plus named PI: the **Skybourne** name and setting and the **realm of Faerie as it appears in DDS works**; everything else declared OGC. The wiki warns compatibility with Pathfinder requires the Paizo rulebook and that Paizo does not endorse it. **The official books' declarations were not retrievable; unverified.** No "Skybourne" or Faerie text was found in the shipped data (0 hits for Skybourne). |

Action: confirm each third-party PDF's last page by hand, and keep "Spheres of Power" / "Path of War" only as source credits in §15, never as a compatibility claim.

## 7. Recommendation

**Do an app-only filtered data build; do not scrub the shared data in place.** The Foundry module and the generator are built around Golarion (the homebrew campaign lore names Iomedae and Pharasma as rival churches); destructive scrubbing would break that parity, and the next `tools/build_details.py` rerun would resurrect everything anyway.

| | A. Scrub in place (generator + sheet `data/`) | B. App-only OGL profile (build-time filter, upstream untouched) |
| --- | --- | --- |
| Sheet data | Edit/regenerate 24,874-record extracts: drop 1,160 name-bound records, redact 1,304 descriptions; repeat on every rebuild | `build_details.py --profile ogl`: same 2,464 records handled by a denylist pass (term families above), output to a separate dir; sheet loads it behind the profile flag |
| Deity input | Rename 36 `deity.json` rows (keep `Domains`; drop dead `Portfolio`/`Worshipers`), 34 `DEITIES`, 3 `region_deity_affinity` entries, `campaign_lore` + 4 backstory examples | Same 36-row alias table applied in the profile only (a generic-god table keyed to the same `Domains`); Foundry/campaign keep real names |
| Generator inputs that change | `deity` (positional #9: unknown names silently randomise); **`region` unchanged (homebrew)** | Same, but only the profile's list is exposed in the app; hosted backend must either honour a `profile` parameter or be bypassed |
| Records removed | Permanently: 900 traits (region 322 / campaign 213 / religion 166 / race 81 / faction 66 name-hits), 106 feats, 97 items, 26 spells, 31 class features | Only in the app build; ~323 deity-keyed traits plus 461 region/218 campaign/66 faction traits not shipped |
| Generator files touched | 60 files / 1,960 strings (`archetypes.json` 679, `spells.csv` 269, `foundry_item_names` 92, `feats*.csv` 170, `weapons_data` 81, ...) | Same files read, filtered at export; none edited |
| Risk | Divergence from Foundry; regressions in feat/conditional tables keyed by deity; loses campaign flavour | Two data paths to test; filter must be rerun with every data rebuild (add a CI gate: term scan returns 0) |
| §15 | Still needs the full list in §5 | Shrinks to reference-document books if sub-option B2 below is adopted |

Sub-options for B: **B1 term-scrub** (above, keeps all 279 books so §15 stays at ~290 entries); **B2 reference-document-only** (also drop records whose only sources are non-PRD books: 6,004 records with a non-PRD-only citation, plus the 12,336 unattributed ones need a manual allowlist), which cuts §15 to about 20 Paizo entries but is far more destructive. B1 is the pragmatic default.

Other required changes regardless of option: rename the app/store listing away from "Pathfinder" (title, `<h1>`, manifest, README) and describe compatibility only via the OGC credits; keep `Paizo`/`PFS` out of UI strings; clear Sieg/E-Kat/Metzofitz provenance or exclude them; add the §15 block and the OGL text to an in-app credits screen.

## 8. Open questions

1. Does the store app call the hosted Render backend? If yes, the backend's responses (archetype and spell text with Golarion names) are also distribution and need a `profile` parameter or an offline subset.
2. Is Paizo's Community Use Policy still in force, or only the Fan Content Policy (which excludes rules content)? The licensing ticket should settle this; the live `paizo.com/licenses` page lists both.
3. Drop or rename the 323 deity-keyed traits and the 699 deity-mentioning records? Renaming needs a deity map applied inside descriptions.
4. Dreamscarred and Drop Dead Studios PI declarations need a manual read of the PDFs.
5. Flavour prose is not OGC even in Open Content books (Open Content = mechanics). The fluff sentences inside descriptions are a separate, larger audit than this PI scan.
6. Provenance of Sieg's Guide (homebrew), E-Kat feats and the Metzofitz dataset.
