// Read-only pf1-style character sheet, rendered client-side from the generator's JSON.
// Standalone static build: character generation happens on the Flask backend (Render); this
// page only POSTs to it. Item details (descriptions, prerequisites, numeric changes) come
// from the slim Foundry-data extracts loaded by scripts/details.js; saved characters live in
// the SheetLibrary (scripts/library.js — IndexedDB + optional connected disk folder).
//
// Layout: a persistent header (name / class line / ability boxes) over a fixed FoundryVTT-style
// tab bar — Summary/Attributes/Combat/Inventory/Features/Skills/Path of War/Spells/Buffs/
// Biography/Notes/Settings/Spheres. Every character gets the identical 13 tabs (empty ones show
// a placeholder); ALL panes are rendered up front and toggled by CSS class, so switching tabs is
// instant and printing shows the whole sheet.

(function () {
    'use strict';

    const LEGACY_CHAR_KEY = 'sheet.characterData'; // pre-library single slot (migrated once)
    const FORM_KEY = 'sheet.formData';
    const BACKEND_KEY = 'sheet.backendUrl';
    const TAB_KEY = 'sheet.activeTab';
    const CURRENT_KEY = 'sheet.currentId';
    const DEFAULT_BACKEND = 'https://pathfinder-char-creator-web-public-use.onrender.com';

    // Generation backend base URL: default the hosted server, overridable via the Settings tab
    // or ?backend=http://127.0.0.1:5001 (persisted) — ?backend=default clears the override.
    function backendUrl() {
        return localStorage.getItem(BACKEND_KEY) || DEFAULT_BACKEND;
    }

    // ---------------------------------------------------------------- form option data
    // Mirrors the Foundry module's generator dialog (button.js) so both clients send the
    // same values to /update_character_data.
    const REGIONS = ['Random', 'Tal-falko', 'Dolestan', 'Sojoria', 'Ieso', 'Spire', 'Feyador',
        'Esterdragon', 'Grundykin Damplands', 'Dust Cairn', 'Kaeru no Tochi'];
    const RACES = ['Random', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Halfling', 'Half-Orc', 'Human',
        'Aasimar', 'Aquatic Elf', 'Catfolk', 'Changeling', 'Dhampir', 'Drow', 'Fetchling',
        'Gathlain', 'Ghoran', 'Gillman', 'Goblin', 'Grippli', 'Hobgoblin', 'Ifrit', 'Kitsune',
        'Kobold', 'Locathah', 'Merfolk', 'Monkey Goblin', 'Nagaji', 'Orc', 'Oread', 'Ratfolk',
        'Sahuagin', 'Skinwalker', 'Strix', 'Svirfneblin', 'Sylph', 'Syrinx', 'Tengu', 'Tiefling',
        'Triaxian', 'Triton', 'Undine', 'Vanara', 'Vine Leshy', 'Vishkanya', 'Wayang', 'Wyrwood',
        'Wyvaran', 'Yaddithian'];
    // Unlike the Foundry module, the web sheet has no compendium constraint, so Stalker and
    // Zealot are selectable here even while they stay out of the module's class list.
    const CLASSES = ['Random', 'Alchemist', 'Antipaladin', 'Arcanist', 'Barbarian',
        'Barbarian (Unchained)', 'Bard', 'Bloodrager', 'Brawler', 'Cavalier', 'Cleric', 'Druid',
        'Fighter', 'Gunslinger', 'Hunter', 'Inquisitor', 'Investigator', 'Magus', 'Monk',
        'Monk (Unchained)', 'Ninja', 'Oracle', 'Paladin', 'Ranger', 'Rogue', 'Rogue (Unchained)',
        'Samurai', 'Shaman', 'Shifter', 'Skald', 'Slayer', 'Sorcerer', 'Summoner',
        'Summoner (Unchained)', 'Swashbuckler', 'Vigilante', 'Warpriest', 'Witch', 'Wizard',
        'Warlord', 'Warder', 'Harbinger', 'Mystic', 'Medic', 'Stalker', 'Zealot'];
    const DEITIES = ['random', 'Abadar', 'Achaekek', 'Ahriman', 'Alazhra', 'Alseta', 'Apsu',
        'Arazni', 'Asmodeus', 'Besmara', 'Calistria', 'Cayden Cailean', 'Desna', 'Easivra',
        'Erastil', 'Erecura', 'Gorum', 'Gozreh', 'Groetus', 'Hanspur', 'Iomedae', 'Irori',
        'Kurgess', 'Lamashtu', 'Lissala', 'Nethys', 'Norgorber', 'Pharasma', 'Rovagug',
        'Sarenrae', 'Shelyn', 'Torag', 'Urgathoa', 'Zon-Kuthon', 'Zyphus'];

    // Good-save progressions per class, extracted from the pf1e_random_char_generator module's
    // every_class.json (pf1 + pf1-pow compendium export). Stalker/Zealot are absent from that
    // compendium; their entries follow the d20pfsrd Path of War class tables.
    const GOOD_SAVES = {
        'alchemist': ['fort', 'ref'], 'antipaladin': ['fort', 'will'], 'arcanist': ['will'],
        'barbarian': ['fort'], 'barbarian (unchained)': ['fort'], 'bard': ['ref', 'will'],
        'bloodrager': ['fort'], 'brawler': ['fort', 'ref'], 'cavalier': ['fort'],
        'cleric': ['fort', 'will'], 'druid': ['fort', 'will'], 'fighter': ['fort'],
        'gunslinger': ['fort', 'ref'], 'harbinger': ['fort', 'will'], 'hunter': ['fort', 'ref'],
        'inquisitor': ['fort', 'will'], 'investigator': ['ref', 'will'],
        'kineticist': ['fort', 'ref'], 'magus': ['fort', 'will'], 'medic': ['fort', 'will'],
        'medium': ['will'], 'mesmerist': ['ref', 'will'], 'monk': ['fort', 'ref', 'will'],
        'monk (unchained)': ['fort', 'ref'], 'mystic': ['will'], 'ninja': ['ref'],
        'occultist': ['fort', 'will'], 'oracle': ['will'], 'paladin': ['fort', 'will'],
        'psychic': ['will'], 'ranger': ['fort', 'ref'], 'rogue': ['ref'],
        'rogue (unchained)': ['ref'], 'samurai': ['fort'], 'shaman': ['will'],
        'shifter': ['fort', 'ref'], 'skald': ['fort', 'will'], 'slayer': ['fort', 'ref'],
        'sorcerer': ['will'], 'spiritualist': ['fort', 'will'], 'stalker': ['will'],
        'summoner': ['will'], 'summoner (unchained)': ['will'], 'swashbuckler': ['ref'],
        'vigilante': ['ref', 'will'], 'warder': ['fort', 'will'], 'warlord': ['fort'],
        'warpriest': ['fort', 'will'], 'witch': ['will'], 'wizard': ['will'],
        'zealot': ['fort', 'will'],
    };

    // ---------------------------------------------------------------- tiny DOM helpers
    function h(tag, cls, content) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (content !== undefined && content !== null) {
            if (content instanceof Node) el.appendChild(content);
            else el.textContent = String(content);
        }
        return el;
    }

    // Descriptions come from our own backend / game data, so rendering them as HTML is fine.
    function htmlBlock(cls, html) {
        const el = h('div', cls);
        el.innerHTML = html;
        return el;
    }

    function details(summaryText, bodyHtml, cls) {
        const d = h('details', cls);
        d.appendChild(h('summary', null, summaryText));
        if (bodyHtml) d.appendChild(htmlBlock('desc', bodyHtml));
        return d;
    }

    function section(title, cls) {
        const sec = h('section', 'sheet-section' + (cls ? ' ' + cls : ''));
        sec.appendChild(h('h2', null, title));
        const body = h('div', 'section-body');
        sec.appendChild(body);
        return { sec, body };
    }

    function kv(body, label, value) {
        const row = h('div', 'kv');
        row.appendChild(h('span', 'k', label));
        row.appendChild(h('span', 'v', value));
        body.appendChild(row);
    }

    const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
    const mod = (score) => Math.floor((Number(score) - 10) / 2);
    const fmt = (n) => (n >= 0 ? '+' + n : String(n));
    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    };
    // true only for non-empty arrays/objects (strings like 'N/A' don't count)
    const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
        : Boolean(v && typeof v === 'object' && Object.keys(v).length > 0);
    const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Foundry inline-roll markup ("[[1d4]]") reads fine without the brackets.
    const stripRolls = (s) => String(s).replace(/\[\[|\]\]/g, '');
    const foundry = (kind, name) => window.SheetDetails?.lookup(kind, name) ?? null;

    // ---------------------------------------------------------------- shared combat math
    function combatStats(data) {
        const level = Number(data.level) || 0;
        const bab = Number(data.bab_total) || 0;
        const strM = mod(data.str), dexM = mod(data.dex), conM = mod(data.con), wisM = mod(data.wis);
        const armorAc = toInt(data.armor_ac) ?? 0;
        const shieldAc = toInt(data.shield_ac) ?? 0;
        const maxDex = toInt(data.armor_max_dex_bonus);
        const effDex = maxDex === null ? dexM : Math.min(dexM, maxDex);
        const stats = {
            level, bab, strM, dexM, conM, wisM,
            ac: 10 + armorAc + shieldAc + effDex,
            touch: 10 + effDex,
            flat: 10 + armorAc + shieldAc,
            cmb: bab + strM, cmd: 10 + bab + strM + dexM,
            savesText: null,
        };
        const goods = GOOD_SAVES[String(data.c_class || '').toLowerCase()];
        if (goods && level) {
            const bonus = (name) => goods.includes(name) ? 2 + Math.floor(level / 2) : Math.floor(level / 3);
            stats.savesText = `Fort ${fmt(bonus('fort') + conM)}, Ref ${fmt(bonus('ref') + dexM)}, Will ${fmt(bonus('will') + wisM)}`
                + (data.c_class_2 ? ' (multiclass: first class only)' : '');
        }
        return stats;
    }

    const gearLine = (name, enhList) => name && name.trim()
        ? name + (nonEmpty(enhList) ? ' [' + enhList.join(', ') + ']' : '') : null;

    // ---------------------------------------------------------------- section renderers
    function renderHeader(data) {
        const head = h('div', 'sheet-header');
        head.appendChild(h('h1', 'char-name', data.character_full_name || 'Unnamed'));
        const cls2 = data.c_class_2 ? ' / ' + titleCase(data.c_class_2) : '';
        const arch = data.archetype1 ? ` (${data.archetype1})` : '';
        const line = [
            `${data.chosen_race || '?'} ${(data.c_class_display || data.c_class || '?')}${cls2}${arch} ${data.level ?? '?'}`,
            data.alignment,
            data.gender,
            Array.isArray(data.deity_name) ? data.deity_name.join(', ') : data.deity_name,
            data.region,
        ].filter(Boolean).join(' · ');
        head.appendChild(h('p', 'char-line', line));
        head.appendChild(renderAbilities(data));
        return head;
    }

    function renderAbilities(data) {
        const wrap = h('div', 'ability-row');
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const score = data[ab];
            if (score == null) continue;
            const box = h('div', 'ability-box' + (data.main_stat === ab ? ' main-stat' : ''));
            box.appendChild(h('div', 'ab-name', ab.toUpperCase()));
            box.appendChild(h('div', 'ab-score', score));
            box.appendChild(h('div', 'ab-mod', fmt(mod(score))));
            wrap.appendChild(box);
        }
        return wrap;
    }

    // Aggregated pf1 changes/notes/conditionals ledger — the data layer future dice rolling
    // will consume. Also exposed as window.sheetChanges.
    function renderModifiers(data) {
        const SD = window.SheetDetails;
        if (!SD) return null;
        const ledger = SD.collectChanges(data);
        window.sheetChanges = ledger;
        if (!ledger.changes.length && !ledger.notes.length && !ledger.conditionals.length) return null;
        const { sec, body } = section('Modifiers (from feats, traits & talents)', 'modifiers');

        if (ledger.changes.length) {
            const byTarget = {};
            for (const c of ledger.changes) (byTarget[SD.targetLabel(c.target)] ??= []).push(c);
            for (const [label, list] of Object.entries(byTarget).sort((a, b) => a[0].localeCompare(b[0]))) {
                const line = h('div', 'mod-line');
                line.appendChild(h('span', 'mod-target', label + ': '));
                line.appendChild(h('span', null, list.map((c) => {
                    const t = SD.typeLabel(c.type);
                    const num = /^-?\d+$/.test(String(c.formula).trim())
                        ? fmt(Number(c.formula)) : String(c.formula);
                    return `${num}${t ? ' ' + t : ''} (${c.source})`;
                }).join(', ')));
                body.appendChild(line);
            }
        }
        if (ledger.notes.length) {
            body.appendChild(h('h3', null, 'Situational'));
            for (const n of ledger.notes) {
                const line = h('div', 'mod-note');
                line.textContent = stripRolls(n.text) + ' — ' + n.source;
                body.appendChild(line);
            }
        }
        if (ledger.conditionals.length) {
            body.appendChild(h('h3', null, 'Per-Roll Toggles & Riders'));
            const ul = h('ul', 'plain-list');
            for (const c of ledger.conditionals) {
                const modTxt = (c.modifiers || []).map((m) =>
                    `${m.formula} ${m.type && m.type !== 'untyped' ? m.type + ' ' : ''}${m.subTarget || m.target || ''}`.trim()).join('; ');
                const bodyHtml = [
                    c.name ? `<p>${escapeHtml(stripRolls(c.name))}</p>` : '',
                    modTxt ? `<p><strong>Modifiers:</strong> ${escapeHtml(modTxt)}</p>` : '',
                    c.rider ? `<p><strong>Rider:</strong> ${escapeHtml(stripRolls(c.rider))}</p>` : '',
                ].join('');
                ul.appendChild(h('li', null, null)).appendChild(
                    bodyHtml ? details(c.source, bodyHtml, 'cond-rider') : h('span', null, c.source));
            }
            body.appendChild(ul);
        }
        return sec;
    }

    function renderGear(data) {
        const { sec, body } = section('Gear & Wealth');
        const w = gearLine(data.weapon_name, data.weapon_enhancement_chosen_list);
        if (w) kv(body, 'Weapon', w);
        const a = gearLine(data.armor_name, data.armor_enhancement_chosen_list);
        if (a) {
            const bits = [
                data.armor_ac ? `+${data.armor_ac} AC` : null,
                data.armor_max_dex_bonus?.trim?.() ? `max Dex ${data.armor_max_dex_bonus}` : null,
                data.armor_armor_check_penalty?.trim?.() ? `ACP ${data.armor_armor_check_penalty}` : null,
                data.armor_spell_failure ? `ASF ${data.armor_spell_failure}%` : null,
            ].filter(Boolean).join(', ');
            kv(body, 'Armor', bits ? `${a} (${bits})` : a);
        }
        const s = gearLine(data.shield_name, data.shield_enhancement_chosen_list);
        if (s) kv(body, 'Shield', s);
        if (data.gold != null) kv(body, 'Gold', `${data.gold} gp` + (data.platnium ? ` (${data.platnium} pp)` : ''));
        if (nonEmpty(data.equipment_list)) {
            const ul = h('ul', 'plain-list');
            for (const item of data.equipment_list) {
                const name = typeof item === 'string' ? item : (item?.name ?? JSON.stringify(item));
                const d = data.equip_descrip?.[name];
                ul.appendChild(h('li', null, null)).appendChild(d ? details(name, d) : h('span', null, name));
            }
            body.appendChild(ul);
        }
        return body.childNodes.length ? sec : null;
    }

    function renderSkills(data) {
        let ranks = data.skill_ranks;
        if (typeof ranks === 'string') { try { ranks = JSON.parse(ranks); } catch { ranks = null; } }
        if (!nonEmpty(ranks)) return null;
        const { sec, body } = section('Skills');
        const table = h('table', 'skills-table');
        const unlockSkill = (data.skill_unlock?.base_skill || '').toLowerCase();
        for (const [name, r] of Object.entries(ranks).sort((a, b) => a[0].localeCompare(b[0]))) {
            if (!r) continue;
            const tr = h('tr', name.toLowerCase() === unlockSkill ? 'unlocked' : null);
            tr.appendChild(h('td', null, titleCase(name) + (name.toLowerCase() === unlockSkill ? ' ★' : '')));
            tr.appendChild(h('td', 'num', r));
            table.appendChild(tr);
        }
        body.appendChild(table);
        if (data.skill_unlock?.skill) {
            const u = data.skill_unlock;
            const tiers = Object.entries(u.unlock || {})
                .map(([lv, txt]) => `<p><strong>${lv} ranks:</strong> ${txt}</p>`).join('');
            body.appendChild(details(`★ Skill Unlock: ${u.skill}`, tiers));
        }
        if (nonEmpty(data.profession_ranks)) {
            const t2 = h('table', 'skills-table professions');
            for (const p of data.profession_ranks) {
                const tr = h('tr');
                tr.appendChild(h('td', null, p.skill_label || p.name));
                tr.appendChild(h('td', 'num', `${p.ranks}/${p.cap}`));
                t2.appendChild(tr);
            }
            body.appendChild(h('h3', null, 'Professions'));
            body.appendChild(t2);
            if (data.profession_pool != null) kv(body, 'Profession rank pool', data.profession_pool);
        }
        return sec;
    }

    function featItem(name, descSource, label) {
        const text = label ? `${name} ${label}` : name;
        // Foundry compendium HTML (with Prerequisites/Benefits) first; backend homebrew
        // descriptions cover what the compendium lacks (style chains, professions, ...).
        const desc = foundry('feats', name)?.description || descSource?.[name];
        const li = h('li');
        li.appendChild(desc ? details(text, desc) : h('span', null, text));
        return li;
    }

    function renderFeats(data) {
        const descs = data.homebrew_feat_desc_dict || {};
        const groups = [
            ['Feats', data.feats, null],
            ['Class Feats', data.class_feats, data.class_feat_labels],
            ['Story Feats', data.story_feats, null],
            ['Flaw Feats', data.flaw_feats, null],
            ['Flavor Feats', data.flavor_feats, null],
            ['Teamwork Feats', data.teamwork_feat_labels, null],
            ['Bloodline Feats', data.bloodline_feats, data.bloodline_feat_labels],
            ['Trainer Feats', data.trainer_feats, data.trainer_feat_labels],
            ['Profession Feats', data.profession_feats, null],
            ['Sphere Feats', data.sphere_feats, null],
            ['Martial Training', data.mt_feats, null],
        ].filter(([, list]) => nonEmpty(list));
        if (!groups.length) return null;
        const { sec, body } = section('Feats');
        for (const [title, list, labels] of groups) {
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list');
            list.forEach((f, i) => {
                const label = labels?.[i] ? `(${String(labels[i]).replace(/^\(|\)$/g, '')})` : null;
                const descSource = title === 'Profession Feats'
                    ? { ...descs, ...(data.profession_feat_desc || {}) } : descs;
                ul.appendChild(featItem(f, descSource, label));
            });
            body.appendChild(ul);
        }
        return sec;
    }

    function renderTraits(data) {
        const groups = [
            ['Traits', data.selected_traits],
            ['Background', data.background_traits],
            ['Sphere Traits', data.sphere_traits],
            ['Flaws', data.flaw],
        ].filter(([, l]) => nonEmpty(l));
        if (!groups.length) return null;
        // Backend-supplied trait descriptions (homebrew traits missing from the compendium).
        const backendDesc = {};
        for (const t of data.selected_traits_desc || []) {
            if (t?.name && t.description) backendDesc[t.name] = t.description;
        }
        const { sec, body } = section('Traits & Flaws');
        for (const [title, list] of groups) {
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list');
            list.forEach((t) => {
                const desc = foundry('traits', t)?.description
                    || foundry('feats', t)?.description || backendDesc[t];
                ul.appendChild(h('li', null, null))
                    .appendChild(desc ? details(t, desc) : h('span', null, t));
            });
            body.appendChild(ul);
        }
        return sec;
    }

    function renderClassFeatures(data) {
        const list = data.class_ability;
        const classes = [data.c_class, data.c_class_2];
        const items = [];
        if (nonEmpty(list)) {
            for (const entry of list) {
                // entries look like "arcane school_wizard" -> name + owning class
                const cut = String(entry).lastIndexOf('_');
                const name = cut > 0 ? entry.slice(0, cut) : entry;
                const desc = window.SheetDetails?.lookupClassFeature(name, classes)?.description
                    || data.class_ability_desc?.[name] || data.class_features?.[name]?.description;
                items.push([titleCase(name), desc]);
            }
        }
        for (const pa of data.profession_ability_items || []) items.push([pa.name, pa.description]);
        if (!items.length) return null;
        const { sec, body } = section('Class Features & Abilities');
        const extras = [
            ['Wizard School', data.school !== 'N/A' ? data.school : null],
            ['Opposition Schools', nonEmpty(data.opposing_school) ? data.opposing_school.join(', ') : null],
            ['Bloodline', data.bloodline && data.bloodline !== 'N/A' ? data.bloodline : null],
            ['Domains', nonEmpty(data.full_domain) ? data.full_domain.join(', ') : null],
        ];
        for (const [k, v] of extras) if (v) kv(body, k, titleCase(String(v)));
        const ul = h('ul', 'plain-list');
        for (const [name, desc] of items) ul.appendChild(h('li', null, null)).appendChild(desc ? details(name, desc) : h('span', null, name));
        body.appendChild(ul);
        return sec;
    }

    // pf1 abbreviates spell schools in item data.
    const SPELL_SCHOOLS = { abj: 'Abjuration', con: 'Conjuration', div: 'Divination',
        enc: 'Enchantment', evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy',
        trs: 'Transmutation', uni: 'Universal' };

    // One expandable entry per spell: compendium description plus a compact meta line
    // (school / save / range / duration) pulled from the slim spell extract.
    function spellItem(name) {
        const sd = foundry('spells', name);
        if (!sd?.description) return h('span', null, name);
        const act = sd.actions?.[0] || {};
        const meta = [
            sd.school ? 'School: ' + (SPELL_SCHOOLS[sd.school] || titleCase(sd.school)) : null,
            act.save?.type ? 'Save: ' + (act.save.description || act.save.type) : null,
            act.range?.units ? 'Range: ' + `${act.range.value ?? ''} ${act.range.units}`.trim() : null,
            act.duration?.units ? 'Duration: ' + `${act.duration.value ?? ''} ${act.duration.units}`.trim() : null,
        ].filter(Boolean).join(' · ');
        const metaHtml = meta ? `<p><em>${escapeHtml(meta)}</em></p>` : '';
        return details(name, metaHtml + sd.description);
    }

    function renderSpells(data) {
        const perDay = data.day_list, known = data.known_list, lists = data.spell_list_choose_from;
        if (!nonEmpty(perDay) && !nonEmpty(lists)) return null;
        const { sec, body } = section('Spellcasting');
        if (data.casting_level_str_foundry) kv(body, 'Caster progression', data.casting_level_str_foundry);
        if (nonEmpty(perDay)) {
            const table = h('table', 'spell-table');
            const hd = h('tr');
            ['Spell Level', 'Per Day', 'Known'].forEach((t) => hd.appendChild(h('th', null, t)));
            table.appendChild(hd);
            perDay.forEach((d, i) => {
                const tr = h('tr');
                tr.appendChild(h('td', null, i));
                tr.appendChild(h('td', 'num', d));
                tr.appendChild(h('td', 'num', known?.[i] ?? '—'));
                table.appendChild(tr);
            });
            body.appendChild(table);
        }
        if (nonEmpty(lists)) {
            lists.forEach((spells, i) => {
                if (!nonEmpty(spells)) return;
                const d = h('details', 'spell-list');
                d.appendChild(h('summary', null, `Level ${i} spells (${spells.length})`));
                const ul = h('ul', 'plain-list');
                spells.forEach((name) => ul.appendChild(h('li', null, null)).appendChild(spellItem(name)));
                d.appendChild(ul);
                body.appendChild(d);
            });
        }
        return sec;
    }

    function renderPathOfWar(data) {
        if (!(Number(data.initiator_level) > 0) && !nonEmpty(data.martial_disciplines)) return null;
        const { sec, body } = section('Path of War');
        kv(body, 'Initiator Level', data.initiator_level);
        kv(body, 'Initiation Stat', (data.initiation_stat || '').toUpperCase());
        if (nonEmpty(data.martial_disciplines)) kv(body, 'Disciplines', data.martial_disciplines.join(', '));
        if (nonEmpty(data.maneuvers_known_list)) {
            kv(body, 'Maneuvers Known', data.maneuvers_known_list.map((n, i) => `L${i + 1}: ${n}`).join(', '));
        }
        const descs = data.maneuvers_desc_dict || {};
        const maneuverLine = (name) => {
            const d = descs[name];
            const summary = d && typeof d === 'object' ? d.description : d;
            return summary ? details(name, summary) : h('span', null, name);
        };
        if (nonEmpty(data.maneuvers_readied_names)) {
            body.appendChild(h('h3', null, 'Readied Maneuvers'));
            data.maneuvers_readied_names.forEach((names, i) => {
                if (!nonEmpty(names)) return;
                const wrap = h('div', 'maneuver-level');
                wrap.appendChild(h('strong', null, `Level ${i + 1}: `));
                const ul = h('ul', 'plain-list');
                names.forEach((n) => ul.appendChild(h('li', null, null)).appendChild(maneuverLine(n)));
                wrap.appendChild(ul);
                body.appendChild(wrap);
            });
        }
        if (nonEmpty(data.stances_chosen)) {
            body.appendChild(h('h3', null, 'Stances'));
            const ul = h('ul', 'plain-list');
            data.stances_chosen.forEach((s) => ul.appendChild(h('li', null, null)).appendChild(maneuverLine(s)));
            body.appendChild(ul);
        }
        return sec;
    }

    function renderSpheres(data) {
        const talents = [...(data.magic_talent_items || []), ...(data.combat_talent_items || [])];
        if (!nonEmpty(data.spheres_chosen) && !talents.length) return null;
        const { sec, body } = section('Spheres');
        if (data.sphere_mana_pool) kv(body, 'Spell Points', data.sphere_mana_pool);
        const ct = data.casting_tradition || {};
        if (ct.casting_ability_modifier) kv(body, 'Casting Ability', ct.casting_ability_modifier);
        if (nonEmpty(data.spheres_chosen)) {
            kv(body, 'Spheres', data.spheres_chosen
                .map((s) => `${s.sphere} (${s.system})`).join(', '));
        }
        const detailList = (title, names, detailArr) => {
            if (!nonEmpty(names)) return;
            body.appendChild(h('h3', null, title));
            const ul = h('ul', 'plain-list');
            const byName = {};
            (detailArr || []).forEach((d) => { if (d?.name) byName[d.name] = d.description; });
            names.forEach((n) => ul.appendChild(h('li', null, null))
                .appendChild(byName[n] ? details(n, byName[n]) : h('span', null, n)));
            body.appendChild(ul);
        };
        detailList('Tradition Drawbacks', data.sphere_drawbacks, ct.drawbacks_detail);
        detailList('Tradition Boons', data.sphere_boons, ct.boons_detail);
        if (talents.length) {
            body.appendChild(h('h3', null, 'Talents'));
            const bySphere = {};
            for (const t of talents) (bySphere[t.sphere || 'Other'] ??= []).push(t);
            for (const [sphere, ts] of Object.entries(bySphere)) {
                const wrap = h('div', 'maneuver-level');
                wrap.appendChild(h('strong', null, sphere + ': '));
                const ul = h('ul', 'plain-list');
                ts.forEach((t) => {
                    const label = t.name + (t.advanced ? ' (advanced)' : '');
                    // Sphere talents aren't in the compendium exports — description comes from
                    // the backend payload; per-roll modifiers/riders from the conditionals files.
                    const cond = window.SheetDetails?.conditionalForTalent(t.name);
                    const hasCond = cond && (cond.modifiers?.length || cond.rider);
                    if (!t.description && !hasCond) {
                        ul.appendChild(h('li', null, null)).appendChild(h('span', null, label));
                        return;
                    }
                    const d = details(label, t.description || '');
                    if (hasCond) {
                        const modTxt = (cond.modifiers || []).map((m) =>
                            `${m.formula} ${m.type && m.type !== 'untyped' ? m.type + ' ' : ''}${m.subTarget || m.target || ''}`.trim()).join('; ');
                        const parts = [
                            modTxt ? `<p><strong>Per-roll modifiers:</strong> ${escapeHtml(modTxt)}</p>` : '',
                            cond.rider ? `<p><strong>Rider:</strong> ${escapeHtml(stripRolls(cond.rider))}</p>` : '',
                        ].join('');
                        d.appendChild(htmlBlock('desc cond-rider', parts));
                    }
                    ul.appendChild(h('li', null, null)).appendChild(d);
                });
                wrap.appendChild(ul);
                body.appendChild(wrap);
            }
        }
        return sec;
    }

    function renderDescription(data) {
        const { sec, body } = section('Description & Personality');
        const hair = [data.hair_type, data.hair_color].flat().filter(Boolean).join(' ');
        if (hair) kv(body, 'Hair', hair);
        if (nonEmpty(data.eye_color)) kv(body, 'Eyes', [].concat(data.eye_color).join(', '));
        if (nonEmpty(data.appearance)) kv(body, 'Appearance', [].concat(data.appearance).join(', '));
        if (nonEmpty(data.personality_traits)) kv(body, 'Personality', data.personality_traits.join(', '));
        if (nonEmpty(data.mannerisms)) kv(body, 'Mannerisms', data.mannerisms.join(', '));
        if (nonEmpty(data.professions)) kv(body, 'Professions', data.professions.join(', '));
        if (data.craft_type) kv(body, 'Craft', data.craft_type);
        const family = [data.parents, data.older_brothers, data.younger_brothers,
            data.older_sisters, data.younger_sisters]
            .map((s) => String(s || '').trim()).filter((s) => s && !/you have 0/.test(s)).join('; ');
        if (family) kv(body, 'Family', family);
        return body.childNodes.length ? sec : null;
    }

    function renderBackstory(data) {
        if (!data.backstory) return null;
        const { sec, body } = section('Backstory');
        String(data.backstory).split(/\n+/).forEach((p) => { if (p.trim()) body.appendChild(h('p', null, p)); });
        return sec;
    }

    // ---------------------------------------------------------------- tab composites
    const emptyState = (text) => h('p', 'placeholder tab-empty', text);

    function compose(...sections) {
        const frag = document.createDocumentFragment();
        for (const s of sections) if (s) frag.appendChild(s);
        return frag.childNodes.length ? frag : null;
    }

    function tabSummary(data) {
        const c = combatStats(data);
        const { sec, body } = section('Overview');
        const fluff = [
            data.age_number != null ? `Age ${data.age_number}` : null,
            data.height_number, data.weight_number != null ? `${data.weight_number} lbs` : null,
        ].filter(Boolean).join(' · ');
        if (fluff) kv(body, 'Vitals', fluff);
        if (Array.isArray(data.language_text) && data.language_text.length) {
            kv(body, 'Languages', 'Common, ' + data.language_text.join(', '));
        }
        kv(body, 'HP', data.Total_HP ?? '?');
        kv(body, 'AC', `${c.ac} (touch ${c.touch}, flat-footed ${c.flat})`);
        kv(body, 'Saves', c.savesText || 'unknown class progression');
        kv(body, 'Speed', (data.land_speed ?? '?') + ' ft');
        const w = gearLine(data.weapon_name, data.weapon_enhancement_chosen_list);
        if (w) kv(body, 'Weapon', w);
        const a = gearLine(data.armor_name, data.armor_enhancement_chosen_list);
        if (a) kv(body, 'Armor', a);
        if (data.gold != null) kv(body, 'Gold', `${data.gold} gp`);
        return sec;
    }

    function tabAttributes(data) {
        const c = combatStats(data);
        const { sec, body } = section('Attributes (base estimates — before feats, buffs & items)');
        kv(body, 'Initiative', fmt(c.dexM));
        kv(body, 'Speed', (data.land_speed ?? '?') + ' ft');
        kv(body, 'BAB', fmt(c.bab));
        kv(body, 'Saves', c.savesText || 'unknown class progression');
        if (data.main_stat) kv(body, 'Main Stat', data.main_stat.toUpperCase());
        return sec;
    }

    function tabCombat(data) {
        const c = combatStats(data);
        const { sec, body } = section('Combat (base estimates — before feats, buffs & items)', 'combat');
        kv(body, 'HP', data.Total_HP ?? '?');
        kv(body, 'AC', `${c.ac} (touch ${c.touch}, flat-footed ${c.flat})`);
        kv(body, 'Melee / Ranged', `${fmt(c.bab + c.strM)} / ${fmt(c.bab + c.dexM)}`);
        kv(body, 'CMB / CMD', `${fmt(c.cmb)} / ${c.cmd}`);
        const w = gearLine(data.weapon_name, data.weapon_enhancement_chosen_list);
        if (w) kv(body, 'Weapon', w);
        const a = gearLine(data.armor_name, data.armor_enhancement_chosen_list);
        if (a) {
            const bits = [
                data.armor_ac ? `+${data.armor_ac} AC` : null,
                data.armor_max_dex_bonus?.trim?.() ? `max Dex ${data.armor_max_dex_bonus}` : null,
                data.armor_armor_check_penalty?.trim?.() ? `ACP ${data.armor_armor_check_penalty}` : null,
                data.armor_spell_failure ? `ASF ${data.armor_spell_failure}%` : null,
            ].filter(Boolean).join(', ');
            kv(body, 'Armor', bits ? `${a} (${bits})` : a);
        }
        const s = gearLine(data.shield_name, data.shield_enhancement_chosen_list);
        if (s) kv(body, 'Shield', s);
        return sec;
    }

    function tabNotes(data) {
        const { sec, body } = section('Notes');
        const ta = h('textarea', 'notes-text');
        ta.id = 'notes-text';
        ta.placeholder = 'Session notes, plans, relationships… saved with this character.';
        ta.value = data._sheet?.notes || '';
        let timer = null;
        ta.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                (data._sheet ??= {}).notes = ta.value;
                if (data === currentData) saveCurrent({ quiet: true });
            }, 800);
        });
        body.appendChild(ta);
        return sec;
    }

    function tabSettings() {
        const { sec, body } = section('Settings');

        body.appendChild(h('h3', null, 'Generation Backend'));
        const urlRow = h('div', 'settings-row');
        const urlInput = h('input');
        urlInput.type = 'text';
        urlInput.value = backendUrl();
        urlInput.className = 'settings-input';
        const setBtn = h('button', null, 'Set');
        setBtn.addEventListener('click', () => {
            const v = urlInput.value.trim().replace(/\/+$/, '');
            if (v) localStorage.setItem(BACKEND_KEY, v);
            urlInput.value = backendUrl();
        });
        const resetBtn = h('button', null, 'Reset to hosted');
        resetBtn.addEventListener('click', () => {
            localStorage.removeItem(BACKEND_KEY);
            urlInput.value = backendUrl();
        });
        urlRow.append(urlInput, setBtn, resetBtn);
        body.appendChild(urlRow);

        body.appendChild(h('h3', null, 'Character Folder'));
        const folderStatus = h('p', 'dim');
        const folderRow = h('div', 'settings-row');
        const refreshFolderUi = () => {
            const st = window.SheetLibrary?.status() || { state: 'unsupported' };
            folderStatus.textContent = {
                unsupported: 'This browser cannot write disk folders (File System Access API — use Chrome/Edge). Characters are stored in the browser.',
                none: 'No folder connected — characters are stored in the browser only.',
                'need-permission': `Folder "${st.folderName}" remembered — click Reconnect to re-grant access.`,
                connected: `Connected to "${st.folderName}" — every save writes a .json file there.`,
            }[st.state];
            connectBtn.textContent = st.state === 'connected' ? 'Change folder' : 'Connect folder';
            reconnectBtn.classList.toggle('hidden', st.state !== 'need-permission');
            disconnectBtn.classList.toggle('hidden', st.state !== 'connected' && st.state !== 'need-permission');
            connectBtn.disabled = st.state === 'unsupported';
        };
        const connectBtn = h('button', null, 'Connect folder');
        connectBtn.addEventListener('click', async () => {
            try { await window.SheetLibrary.connectFolder(); } catch { /* picker cancelled */ }
            refreshFolderUi(); refreshRoster();
        });
        const reconnectBtn = h('button', null, 'Reconnect');
        reconnectBtn.addEventListener('click', async () => {
            await window.SheetLibrary.reconnectFolder();
            refreshFolderUi(); refreshRoster();
        });
        const disconnectBtn = h('button', null, 'Disconnect');
        disconnectBtn.addEventListener('click', async () => {
            await window.SheetLibrary.disconnectFolder();
            refreshFolderUi(); refreshRoster();
        });
        folderRow.append(connectBtn, reconnectBtn, disconnectBtn);
        body.append(folderStatus, folderRow);
        refreshFolderUi();

        body.appendChild(h('h3', null, 'Library'));
        const libRow = h('div', 'settings-row');
        const exportBtn = h('button', null, 'Export all');
        exportBtn.addEventListener('click', async () => {
            const all = await window.SheetLibrary.exportAll();
            const blob = new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' });
            const aEl = h('a');
            aEl.href = URL.createObjectURL(blob);
            aEl.download = 'characters-export.json';
            aEl.click();
            URL.revokeObjectURL(aEl.href);
        });
        const importInput = h('input');
        importInput.type = 'file';
        importInput.accept = '.json,application/json';
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                const items = Array.isArray(parsed) ? parsed : [parsed];
                for (const item of items) await window.SheetLibrary.save(item);
                refreshRoster();
            } catch (err) { alert('Import failed: ' + err.message); }
            e.target.value = '';
        });
        libRow.append(exportBtn, importInput);
        body.appendChild(libRow);

        return sec;
    }

    const TABS = [
        { id: 'summary', label: 'Summary', render: tabSummary },
        { id: 'attributes', label: 'Attributes', render: tabAttributes },
        { id: 'combat', label: 'Combat', render: tabCombat },
        { id: 'inventory', label: 'Inventory', render: (d) => renderGear(d) || emptyState('No gear.') },
        { id: 'features', label: 'Features', render: (d) => compose(renderFeats(d), renderTraits(d), renderClassFeatures(d)) || emptyState('No feats, traits, or class features.') },
        { id: 'skills', label: 'Skills', render: (d) => renderSkills(d) || emptyState('No skill ranks.') },
        { id: 'path-of-war', label: 'Path of War', render: (d) => renderPathOfWar(d) || emptyState('Not an initiator — no maneuvers or stances.') },
        { id: 'spells', label: 'Spells', render: (d) => renderSpells(d) || emptyState('No spellcasting.') },
        { id: 'buffs', label: 'Buffs', render: (d) => renderModifiers(d) || emptyState('No always-on or per-roll modifiers.') },
        { id: 'biography', label: 'Biography', render: (d) => compose(renderDescription(d), renderBackstory(d)) || emptyState('No description or backstory.') },
        { id: 'notes', label: 'Notes', render: tabNotes },
        { id: 'settings', label: 'Settings', render: tabSettings },
        { id: 'spheres', label: 'Spheres', render: (d) => renderSpheres(d) || emptyState('No spheres or talents.') },
    ];

    // ---------------------------------------------------------------- sheet shell
    let currentData = null;

    function activeTabId() {
        const saved = localStorage.getItem(TAB_KEY);
        return TABS.some((t) => t.id === saved) ? saved : 'summary';
    }

    function setActiveTab(id) {
        localStorage.setItem(TAB_KEY, id);
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.tab === id));
    }

    function renderSheet(data) {
        // Keep un-debounced notes edits when re-rendering (details-ready, manual save, …).
        const notesEl = document.getElementById('notes-text');
        if (notesEl && currentData) (currentData._sheet ??= {}).notes = notesEl.value;

        currentData = data;
        const sheet = document.getElementById('sheet');
        sheet.innerHTML = '';
        if (!data || typeof data !== 'object' || data.error) {
            sheet.appendChild(h('p', 'placeholder error', data?.error ? 'Backend error: ' + data.error : 'No character yet — hit Generate or Load JSON above.'));
            sheet.appendChild(tabSettings()); // folder + backend setup stay reachable
            return;
        }
        sheet.appendChild(renderHeader(data));

        const nav = h('nav', 'tab-nav no-print');
        const panes = h('div', 'tab-panes');
        for (const tab of TABS) {
            const btn = h('button', 'tab-btn', tab.label);
            btn.type = 'button';
            btn.dataset.tab = tab.id;
            btn.addEventListener('click', () => setActiveTab(tab.id));
            nav.appendChild(btn);

            const pane = h('div', 'tab-pane');
            pane.dataset.tab = tab.id;
            pane.appendChild(h('h2', 'print-only tab-print-title', tab.label));
            const content = tab.render(data);
            pane.appendChild(content || emptyState('Nothing here.'));
            panes.appendChild(pane);
        }
        sheet.append(nav, panes);
        setActiveTab(activeTabId());
        if (data.generator_version) sheet.appendChild(h('p', 'dim footer', 'generator ' + data.generator_version));
    }

    // Exposed for console debugging and future interactive layers.
    window.renderSheet = renderSheet;

    // ---------------------------------------------------------------- character roster
    function rosterSelect() { return document.getElementById('char-select'); }

    async function refreshRoster(selectedId) {
        const sel = rosterSelect();
        const lib = window.SheetLibrary;
        if (!sel || !lib) return;
        const records = await lib.list().catch(() => []);
        sel.innerHTML = '';
        const placeholder = h('option', null, records.length ? '— pick a character —' : '(no saved characters)');
        placeholder.value = '';
        sel.appendChild(placeholder);
        for (const r of records) {
            const opt = h('option', null, `${r.name} — ${titleCase(r.klass || '?')} ${r.level}`);
            opt.value = r.id;
            sel.appendChild(opt);
        }
        const want = selectedId ?? currentData?._sheet?.id ?? localStorage.getItem(CURRENT_KEY);
        if (want && records.some((r) => r.id === want)) sel.value = want;
    }

    async function saveCurrent({ quiet } = {}) {
        if (!currentData || currentData.error) return;
        const notesEl = document.getElementById('notes-text');
        if (notesEl) (currentData._sheet ??= {}).notes = notesEl.value;
        const record = await window.SheetLibrary.save(currentData);
        localStorage.setItem(CURRENT_KEY, record.id);
        if (!quiet) await refreshRoster(record.id);
        return record;
    }

    async function loadCharacter(id) {
        const record = await window.SheetLibrary.get(id);
        if (!record) return;
        localStorage.setItem(CURRENT_KEY, record.id);
        renderSheet(record.data);
        await refreshRoster(record.id);
    }

    async function deleteCurrent() {
        const id = currentData?._sheet?.id || rosterSelect()?.value;
        if (!id) return;
        const name = currentData?.character_full_name || 'this character';
        if (!confirm(`Delete ${name} from the library${window.SheetLibrary.status().state === 'connected' ? ' and its file in the connected folder' : ''}?`)) return;
        await window.SheetLibrary.remove(id);
        localStorage.removeItem(CURRENT_KEY);
        currentData = null;
        const records = await window.SheetLibrary.list().catch(() => []);
        if (records.length) await loadCharacter(records[0].id);
        else {
            renderSheet(null);
            await refreshRoster();
        }
    }

    // ---------------------------------------------------------------- generate form
    function fillSelect(sel, options, valueFn) {
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = valueFn ? valueFn(o) : o;
            opt.textContent = o;
            sel.appendChild(opt);
        }
    }

    // /update_character_data unpacks the payload POSITIONALLY (spheres_of_power is popped by
    // name), so this key order must stay exactly in sync with the Foundry module's button.js,
    // with use_backstory_api + backstory_focus appended as the optional 20th/21st inputs.
    function buildPayload(form) {
        const f = (name) => form.elements[name].value;
        return {
            input: 'Y',
            region: f('region'),
            race: f('race'),
            class: f('class'),
            bab: f('bab'),
            caster_level: f('caster_level'),
            multiclass: f('multiclass'),
            alignment: f('alignment'),
            deity: f('deity'),
            gender: f('gender'),
            randomFeats: f('randomFeats'),
            inherents: f('inherents'),
            modded_char_sheet: f('modded_char_sheet'),
            homebrew_feat_amount: f('homebrew_feat_amount'),
            spheres_of_power: f('spheres_of_power'),
            diceRolls: f('diceRolls'),
            diceSides: f('diceSides'),
            highestLevel: f('highestLevel'),
            lowestLevel: f('lowestLevel'),
            goldAmount: f('goldAmount'),
            use_backstory_api: f('use_backstory_api'),
            backstory_focus: f('backstory_focus'),
        };
    }

    async function adoptCharacter(data) {
        renderSheet(data);
        await saveCurrent(); // auto-save: every generated/loaded character lands in the library
    }

    async function generate(form) {
        const status = document.getElementById('gen-status');
        const btn = document.getElementById('gen-submit');
        const payload = buildPayload(form);
        localStorage.setItem(FORM_KEY, JSON.stringify(payload));
        btn.disabled = true;
        status.textContent = 'Generating… (the backend can take up to a minute)';
        try {
            const resp = await fetch(backendUrl() + '/update_character_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            await adoptCharacter(data);
            status.textContent = '';
            document.getElementById('gen-panel').classList.add('hidden');
        } catch (err) {
            status.textContent = 'Failed: ' + err.message;
        } finally {
            btn.disabled = false;
        }
    }

    function loadJsonText(text) {
        try {
            const data = JSON.parse(text);
            adoptCharacter(data);
            document.getElementById('load-panel').classList.add('hidden');
        } catch (err) {
            alert('Not valid JSON: ' + err.message);
        }
    }

    // ---------------------------------------------------------------- wiring
    document.addEventListener('DOMContentLoaded', async () => {
        // ?backend=http://host:port overrides the generation backend (persisted);
        // ?backend=default clears the override. Also editable in the Settings tab.
        const backendParam = new URLSearchParams(location.search).get('backend');
        if (backendParam === 'default') localStorage.removeItem(BACKEND_KEY);
        else if (backendParam) localStorage.setItem(BACKEND_KEY, backendParam.replace(/\/+$/, ''));

        const form = document.getElementById('gen-form');
        fillSelect(form.elements.region, REGIONS);
        fillSelect(form.elements.race, RACES, (r) => r.toLowerCase().replace(/\s/g, '-'));
        fillSelect(form.elements.class, CLASSES, (c) => c.toLowerCase().replace(/\s/g, '-'));
        fillSelect(form.elements.deity, DEITIES);

        const savedForm = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
        if (savedForm) {
            for (const [k, v] of Object.entries(savedForm)) {
                if (form.elements[k]) form.elements[k].value = v;
            }
        }

        const toggle = (id) => document.getElementById(id).classList.toggle('hidden');
        document.getElementById('toggle-gen').addEventListener('click', () => toggle('gen-panel'));
        document.getElementById('toggle-load').addEventListener('click', () => toggle('load-panel'));
        document.getElementById('print-btn').addEventListener('click', () => window.print());
        form.addEventListener('submit', (e) => { e.preventDefault(); generate(form); });
        document.getElementById('render-paste').addEventListener('click', () =>
            loadJsonText(document.getElementById('json-paste').value));
        document.getElementById('json-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) file.text().then(loadJsonText);
        });

        rosterSelect().addEventListener('change', (e) => { if (e.target.value) loadCharacter(e.target.value); });
        document.getElementById('save-btn').addEventListener('click', () => saveCurrent());
        document.getElementById('delete-btn').addEventListener('click', deleteCurrent);
        const reconnectChip = document.getElementById('reconnect-chip');
        reconnectChip.addEventListener('click', async () => {
            await window.SheetLibrary.reconnectFolder();
            reconnectChip.classList.toggle('hidden', window.SheetLibrary.status().state !== 'need-permission');
            await refreshRoster();
            const id = localStorage.getItem(CURRENT_KEY);
            if (id && !currentData) loadCharacter(id);
        });

        await window.SheetLibrary?.init();
        reconnectChip.classList.toggle('hidden', window.SheetLibrary?.status().state !== 'need-permission');

        // One-time migration of the pre-library single character slot.
        const legacy = localStorage.getItem(LEGACY_CHAR_KEY);
        if (legacy) {
            try {
                const data = JSON.parse(legacy);
                const record = await window.SheetLibrary.save(data);
                localStorage.setItem(CURRENT_KEY, record.id);
            } catch { /* corrupt legacy slot — drop it */ }
            localStorage.removeItem(LEGACY_CHAR_KEY);
        }

        await refreshRoster();
        const startId = localStorage.getItem(CURRENT_KEY);
        if (startId) {
            const record = await window.SheetLibrary.get(startId);
            if (record) renderSheet(record.data);
            await refreshRoster(startId);
        }

        // The details data usually lands after first paint — re-render once so descriptions
        // and the Buffs ledger fill in.
        window.SheetDetails?.ready.then(() => { if (currentData) renderSheet(currentData); });
    });
})();
