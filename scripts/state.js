// scripts/state.js -- per-character _sheet state accessors, seeders and mutators
// (window.SheetState). Extracted from sheet.js (Part B split); bodies moved verbatim except
// bare `currentData` reads, which now go through the shell's live pointer window.SheetApp.current.
// Loads after derive.js (uses effectiveLedger) and before sheet.js. renderSheet / saveCurrent
// are shell-owned and late-bound. cloneChanges now lives in ui.js.
window.SheetState = (function () {
    'use strict';
    const { h, cloneChanges } = window.SheetUI;
    const { effectiveLedger } = window.SheetDerive;
    // Shell-owned, late-bound (read at call time, long after boot).
    const renderSheet = (d) => window.SheetApp.renderSheet(d);
    const saveCurrent = (opts) => window.SheetApp.saveCurrent(opts);

    // Debounced quiet save for inline edits (notes / fields / ready toggles).
    let quietSaveTimer = null;

    /**
     * One-time copy of the generator's per-stat inherent (data.inherents) and level-up
     * (data.level_up_stats) bonuses into the editable Inherent / Level-up columns, so they
     * show in the ability table and feed the total. Flag-guarded so later user edits
     * (including clearing to 0) are not overwritten on re-render.
     */
    function seedBackendStatBonuses(data) {
        if (!data || typeof data !== 'object') return;
        const st = sheetState(data);
        if (st.statSeeded) return;
        st.statSeeded = true;
        const seed = (dict, field) => {
            if (!dict || typeof dict !== 'object') return;
            for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
                const v = Number(dict[ab]) || 0;
                if (!v) continue;
                st.abilityAdjust ??= {};
                st.abilityAdjust[ab] ??= {};
                if (st.abilityAdjust[ab][field] == null) st.abilityAdjust[ab][field] = v;
            }
        };
        seed(data.inherents, 'inherent');
        seed(data.level_up_stats, 'levelup');
    }
    /**
     * One-time move of the generator's racial share out of the base score and into the
     * editable Racial column: the backend bakes racial_stats into the exported score, so
     * seeding subtracts it from data[ab] and adds it to abilityAdjust[ab].racial — every
     * total is unchanged, but the Racial column shows real numbers instead of "—".
     * Own flag (not statSeeded) so characters saved before this feature still upgrade.
     */
    function seedRacialColumn(data) {
        if (!data || typeof data !== 'object') return;
        const st = sheetState(data);
        if (st.racialSeeded || !data.racial_stats || typeof data.racial_stats !== 'object') return;
        st.racialSeeded = true;
        for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
            const v = Number(data.racial_stats[ab]) || 0;
            if (!v || !Number.isFinite(Number(data[ab]))) continue;
            data[ab] = Number(data[ab]) - v;
            st.abilityAdjust ??= {};
            st.abilityAdjust[ab] ??= {};
            st.abilityAdjust[ab].racial = (Number(st.abilityAdjust[ab].racial) || 0) + v;
        }
    }
    function quietSave() {
        clearTimeout(quietSaveTimer);
        quietSaveTimer = setTimeout(() => {
            if (window.SheetApp.current && !window.SheetApp.current.error) saveCurrent({ quiet: true });
        }, 800);
    }
    /** Per-source always-on buff keys stored as disabled set on data._sheet.disabledBuffSources */
    function disabledBuffSet(data) {
        const d = data || window.SheetApp.current;
        const arr = d?._sheet?.disabledBuffSources;
        return new Set(Array.isArray(arr) ? arr : []);
    }
    function buffSourceKey(source, sourceKind) {
        return String(sourceKind || 'buff') + '::' + String(source || '?');
    }
    /** Deleted passive sources: hidden from the panel AND stripped from math. */
    function removedBuffSet(data) {
        const d = data || window.SheetApp.current;
        const arr = d?._sheet?.removedBuffSources;
        return new Set(Array.isArray(arr) ? arr : []);
    }
    function isBuffSourceActive(data, source, sourceKind) {
        const key = buffSourceKey(source, sourceKind);
        return !disabledBuffSet(data).has(key) && !removedBuffSet(data).has(key);
    }
    function isBuffSourceRemoved(data, source, sourceKind) {
        return removedBuffSet(data).has(buffSourceKey(source, sourceKind));
    }
    function setBuffSourceActive(data, source, sourceKind, on) {
        if (!data) return;
        const key = buffSourceKey(source, sourceKind);
        const set = disabledBuffSet(data);
        if (on) set.delete(key);
        else set.add(key);
        (data._sheet ??= {}).disabledBuffSources = [...set];
        quietSave();
        renderSheet(data);
    }
    function removeBuffSource(data, source, sourceKind) {
        if (!data) return;
        const set = removedBuffSet(data);
        set.add(buffSourceKey(source, sourceKind));
        (data._sheet ??= {}).removedBuffSources = [...set];
        quietSave();
        renderSheet(data);
    }
    function restoreRemovedBuffSources(data) {
        if (!data) return;
        (data._sheet ??= {}).removedBuffSources = [];
        quietSave();
        renderSheet(data);
    }
    /** Path of War stances the character is currently in (independent toggles). */
    function activeStanceSet(data) {
        const arr = data?._sheet?.activeStances;
        return new Set(Array.isArray(arr) ? arr : []);
    }
    function setStanceActive(data, name, on) {
        if (!data || !name) return;
        const set = activeStanceSet(data);
        if (on) set.add(name);
        else set.delete(name);
        (data._sheet ??= {}).activeStances = [...set];
    }
    /**
     * Situational contextNotes for a set of change targets, deduped and plain-text —
     * shown as hover tooltips on the relevant skill / attack rows (not a panel).
     */
    function notesForTargets(data, targets) {
        const ledger = window.sheetChangesFull
            || window.SheetDetails?.collectChanges?.(data)
            || { notes: [] };
        const want = targets instanceof Set ? targets : new Set(targets || []);
        const seen = new Set();
        const out = [];
        for (const n of ledger.notes || []) {
            if (!want.has(n.target)) continue;
            if (!isBuffSourceActive(data, n.source, n.sourceKind)) continue;
            const text = String(n.text || '').replace(/<[^>]*>/g, '').trim();
            if (!text) continue;
            const key = n.source + '|' + n.target + '|' + text;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(text + ' — ' + n.source);
        }
        return out;
    }
    /** Add an ⓘ hover marker (and row tooltip) when targets have situational notes. */
    function attachNotesHover(el, data, targets, markHost) {
        const notes = notesForTargets(data, targets);
        if (!notes.length || !el) return;
        el.title = notes.join('\n');
        const mark = h('span', 'note-hover-mark no-print', 'ⓘ');
        mark.title = notes.join('\n');
        mark.setAttribute('aria-label', 'Situational notes: ' + notes.join('; '));
        (markHost || el).appendChild(mark);
    }
    function refreshDerived() {
        if (window.SheetApp.current && !window.SheetApp.current.error) {
            window.sheetChanges = effectiveLedger(window.SheetApp.current);
            window.SheetRoll?.setCharacter(window.SheetApp.current);
        }
    }
    /** Session state bag on each character (HP trackers, conditions, …). */
    function sheetState(data) {
        return (data._sheet ??= {});
    }
    /**
     * User-authored buffs attached to a feature (feat/trait/class feature), keyed by its
     * display name. Stored on _sheet.featureChanges[name] = { sourceKind, changes: [...] }
     * and folded into the ledger by SheetDetails.collectChanges.
     */
    // Non-mutating read: the stored change array for a feature, or [] if none.
    function featureCustomList(data, name) {
        const arr = data?._sheet?.featureChanges?.[name]?.changes;
        return Array.isArray(arr) ? arr : [];
    }
    // Get-or-create the entry (only call when about to write).
    function featureCustomEntry(data, name, sourceKind = 'feat') {
        const st = sheetState(data);
        st.featureChanges ??= {};
        const entry = st.featureChanges[name] ??= { sourceKind, changes: [] };
        if (!Array.isArray(entry.changes)) entry.changes = [];
        entry.sourceKind = sourceKind; // keep in sync with the row's kind
        return entry;
    }
    // Drop an emptied entry so saved data doesn't accumulate blanks.
    function pruneFeatureCustom(data, name) {
        const map = data?._sheet?.featureChanges;
        if (map && map[name] && !map[name].changes?.length) delete map[name];
    }
    function activeConditions(data) {
        const arr = sheetState(data).conditions;
        return new Set(Array.isArray(arr) ? arr : []);
    }
    function setConditionActive(data, id, on) {
        const st = sheetState(data);
        const set = activeConditions(data);
        if (on) set.add(id);
        else set.delete(id);
        st.conditions = [...set];
        quietSave();
    }
    function ensureSpellCasts(data) {
        const st = sheetState(data);
        const perDay = Array.isArray(data.day_list) ? data.day_list : [];
        if (!Array.isArray(st.spellCastsRemaining)
            || st.spellCastsRemaining.length < perDay.length) {
            const prev = Array.isArray(st.spellCastsRemaining) ? st.spellCastsRemaining : [];
            st.spellCastsRemaining = perDay.map((n, i) =>
                (prev[i] != null ? Number(prev[i]) : Number(n)) || 0);
        }
        return st.spellCastsRemaining;
    }
    function spendSpellSlot(data, level) {
        const casts = ensureSpellCasts(data);
        while (casts.length <= level) casts.push(0);
        if ((casts[level] || 0) <= 0) return false;
        casts[level] -= 1;
        quietSave();
        return true;
    }
    /** Seed casting ability from main_stat or class (Foundry spellbook.ability). */
    function ensureCastingAbility(data) {
        if (!data) return 'int';
        const cur = String(data.casting_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(cur)) return cur;
        const ms = String(data.main_stat || '').toLowerCase();
        if (['int', 'wis', 'cha'].includes(ms)) {
            data.casting_stat = ms;
            return ms;
        }
        const cls = String(data.c_class || '').toLowerCase();
        let ab = 'cha'; // sorcerer, bard, oracle, bloodrager, skald, …
        if (/wizard|magus|alchemist|investigator|witch|arcanist/.test(cls)) ab = 'int';
        else if (/cleric|druid|ranger|paladin|shaman|warpriest|inquisitor/.test(cls)) ab = 'wis';
        data.casting_stat = ab;
        return ab;
    }
    function ensureInitiationStat(data) {
        if (!data) return 'int';
        const cur = String(data.initiation_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(cur)) return cur;
        const ms = String(data.main_stat || '').toLowerCase();
        if (['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ms)) {
            data.initiation_stat = ms;
            return ms;
        }
        data.initiation_stat = 'int';
        return 'int';
    }
    // Foundry PF1 buff subtypes (systems/pf1 buffTypes)
    const BUFF_SUBTYPES = [
        { id: 'temp', label: 'Temporary' },
        { id: 'spell', label: 'Spell' },
        { id: 'feat', label: 'Feat' },
        { id: 'perm', label: 'Permanent' },
        { id: 'item', label: 'Item' },
        { id: 'misc', label: 'Misc' },
    ];
    const BUFF_DURATION_UNITS = [
        { id: '', label: 'Infinite' },
        { id: 'turn', label: 'Turn(s)' },
        { id: 'round', label: 'Round(s)' },
        { id: 'minute', label: 'Minute(s)' },
        { id: 'hour', label: 'Hour(s)' },
    ];
    /**
     * Foundry-shaped buff list on _sheet.buffs (migrates legacy tempBuffs once).
     * { id, name, subType, active, level, duration:{value,units}, changes[], notes }
     */
    function ensureBuffs(data) {
        const st = sheetState(data);
        if (Array.isArray(st.buffs) && st.buffs.length) {
            // Preserve object identity (rendered rows hold references; fresh objects
            // here would orphan them and break delete/edit) — same rule as
            // ensureInventoryObjects.
            st.buffs = st.buffs.map((b) => (b && typeof b === 'object')
                ? Object.assign(b, normalizeBuffEntry(b))
                : normalizeBuffEntry(b));
            return st.buffs;
        }
        // Migrate session tempBuffs → Foundry-style buffs
        const legacy = Array.isArray(st.tempBuffs) ? st.tempBuffs : [];
        st.buffs = legacy.map((b) => normalizeBuffEntry({
            ...b,
            subType: b.subType || 'temp',
        }));
        if (legacy.length) {
            // Keep legacy array empty so we don't double-apply if something still reads it
            st.tempBuffs = [];
        } else if (!Array.isArray(st.buffs)) {
            st.buffs = [];
        }
        return st.buffs;
    }
    function normalizeBuffEntry(raw) {
        const b = raw && typeof raw === 'object' ? raw : {};
        const sub = String(b.subType || 'temp').toLowerCase();
        const okSub = BUFF_SUBTYPES.some((s) => s.id === sub) ? sub : 'temp';
        const dur = b.duration && typeof b.duration === 'object' ? b.duration : {};
        return {
            id: b.id || ('buff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
            name: String(b.name || 'Buff').trim() || 'Buff',
            subType: okSub,
            active: b.active !== false,
            level: Number.isFinite(Number(b.level)) ? Number(b.level) : 0,
            duration: {
                value: dur.value != null ? String(dur.value) : '',
                units: ['turn', 'round', 'minute', 'hour'].includes(String(dur.units || ''))
                    ? String(dur.units) : '',
            },
            changes: Array.isArray(b.changes) ? cloneChanges(b.changes) : [],
            notes: b.notes != null ? String(b.notes) : '',
            // Size-setting buffs (Enlarge Person → 'large'); '' = no size effect.
            setSize: typeof b.setSize === 'string' ? b.setSize : '',
            // #16: 'always' = standing ledger changes; 'perRoll' = a Custom-group toggle
            // in the conditional panel. itemKey optionally scopes a per-roll buff to one
            // weapon (same scoping enhancement qualities use).
            activation: b.activation === 'perRoll' ? 'perRoll' : 'always',
            itemKey: typeof b.itemKey === 'string' ? b.itemKey : '',
            // #45: set on buffs auto-created by a spell cast ('spell:<name lowercased>').
            // Recasting matches on it and refreshes instead of stacking a duplicate.
            autoKey: typeof b.autoKey === 'string' ? b.autoKey : '',
        };
    }
    /**
     * Per-round action-economy state (#19): one shared swift/immediate flag (they share a
     * budget in PF1) plus the AoO counter. `aooMax` is a user override; null/absent means
     * auto-derive (1, or 1 + Dex mod with Combat Reflexes — SheetRoll.aooMaxFor).
     */
    function ensureActionEconomy(data) {
        const st = sheetState(data);
        if (!st.actionEconomy || typeof st.actionEconomy !== 'object') st.actionEconomy = {};
        const ae = st.actionEconomy;
        ae.swiftSpent = ae.swiftSpent === true;
        ae.aooUsed = Math.max(0, Number(ae.aooUsed) || 0);
        return ae;
    }

    /**
     * The Features-tab uses tracker entry for a named feature ({ value, max }), created on
     * first touch. One owner for the shape — the Buffs-tab controls and the marquee
     * class-feature spend/tick paths all read this same object.
     */
    // Class level lookup mirroring evalSimpleFormula's strict @classes resolver: a class
    // the character does not have is 0, never the whole level.
    function classLevelOf(data, cls) {
        if (!cls) return 0;
        const want = String(cls).toLowerCase();
        if (Array.isArray(data?.classes)) {
            const hit = data.classes.find((c) => [c?.name, c?.display]
                .some((n) => String(n || '').toLowerCase().trim() === want));
            return Number(hit?.level) || 0;
        }
        return Number(window.SheetClassInfo?.classLevelFor?.(data, cls)) || 0;
    }
    /** The MARQUEE_FEATURES entry whose uses pool `name` refers to — only when the
     *  character actually has the owning class (a fighter's "Rage" note must not
     *  sprout a rage pool). Paren-stripped, so a backend "Rage (Ex)" row matches. */
    function marqueeUsesFor(data, name) {
        const norm = (s) => String(s || '').split(' (')[0].trim().toLowerCase();
        const t = (window.SheetData?.MARQUEE_FEATURES || [])
            .find((x) => x.uses && norm(x.uses.name || x.name) === norm(name));
        return t && classLevelOf(data, t.cls) > 0 ? t : null;
    }
    /** True when `name` already tracks uses, or is a marquee pool this character owns. */
    function hasFeaturePool(data, name) {
        const e = data?._sheet?.featureUses?.[name];
        if (e && (e.max || e.chargeSource)) return true;
        return !!marqueeUsesFor(data, name);
    }
    function featureUses(data, name) {
        const st = sheetState(data);
        st.featureUses ??= {};
        const entry = (st.featureUses[name] ??= { value: 0, max: 0 });
        // #100: marquee pools (Rage rounds, Smite uses) seed from their formula on first
        // touch anywhere — the Features tab included — not only via the Combat toggle.
        if (!entry.max && !entry.chargeSource) {
            const t = marqueeUsesFor(data, name);
            if (t) {
                const canonical = t.uses.name || t.name;
                if (canonical === name) {
                    const ev = window.SheetDetails?.evalSimpleFormula?.(t.uses.max, data);
                    if (ev?.ok && ev.value > 0) {
                        entry.max = ev.value;
                        entry.value = ev.value;
                    }
                } else {
                    // Alias row ("Rage (Ex)") — seed the canonical pool and draw from it
                    // via the existing charge-link, so the Combat toggle and this row
                    // share one counter instead of forking.
                    featureUses(data, canonical);
                    entry.chargeSource = { kind: 'feature', name: canonical };
                }
            }
        }
        return entry;
    }

    // ------------------------------------------------------------ charge-linking (#25)
    // A spender (inventory item or feature-uses entry) may carry `chargeSource`:
    // {kind:'item', id} | {kind:'feature', name}. Spends follow the chain to the terminal
    // pool owner; a broken link falls back to the spender's own pool (warn, never block).
    /** Every linkable pool: charged items + feature pools with a max. */
    function chargePoolOptions(data, exclude = null) {
        const out = [];
        for (const it of (Array.isArray(data?.equipment_list) ? data.equipment_list : [])) {
            if (!it || typeof it !== 'object') continue;
            const ch = it.charges;
            if (!ch || (ch.value == null && ch.max == null)) continue;
            if (exclude?.kind === 'item' && exclude.id === it.id) continue;
            out.push({ ref: { kind: 'item', id: it.id }, label: it.name || 'Item' });
        }
        for (const [name, u] of Object.entries(data?._sheet?.featureUses || {})) {
            if (!u || !(Number(u.max) > 0)) continue;
            if (exclude?.kind === 'feature' && exclude.name === name) continue;
            out.push({ ref: { kind: 'feature', name }, label: name });
        }
        return out;
    }
    /** The pool a ref points AT (no chain-following). Null when the target is gone. */
    function poolAt(data, ref) {
        if (!ref || typeof ref !== 'object') return null;
        if (ref.kind === 'item') {
            const it = (data?.equipment_list || []).find(
                (x) => x && typeof x === 'object' && x.id === ref.id);
            if (!it) return null;
            it.charges = it.charges && typeof it.charges === 'object' ? it.charges : {};
            return {
                kind: 'item', item: it, label: it.name || 'Item',
                get value() { return Number(it.charges.value) || 0; },
                set value(v) { it.charges.value = Math.max(0, v); },
                get max() { return Number(it.charges.max) || 0; },
                source: it.chargeSource,
            };
        }
        if (ref.kind === 'feature') {
            if (!data?._sheet?.featureUses?.[ref.name]) return null;
            const u = featureUses(data, ref.name);
            return {
                kind: 'feature', entry: u, label: ref.name,
                get value() { return Number(u.value) || 0; },
                set value(v) { u.value = Math.max(0, v); },
                get max() { return Number(u.max) || 0; },
                source: u.chargeSource,
            };
        }
        return null;
    }
    /**
     * Terminal pool owner for a spender ref — follows chargeSource links (depth ≤ 4,
     * cycle-safe). `linked` is true when the result is a different pool than the
     * spender's own. Returns null only when even the spender's own pool is gone.
     */
    function resolveChargePool(data, ref) {
        const seen = new Set();
        let cur = poolAt(data, ref);
        let curRef = ref;
        let linked = false;
        for (let i = 0; i < 4 && cur; i++) {
            const key = curRef.kind + ':' + (curRef.id || curRef.name);
            if (seen.has(key)) break;
            seen.add(key);
            const nextRef = cur.source;
            if (!nextRef) break;
            const next = poolAt(data, nextRef);
            if (!next) break; // broken link → stop at the last live pool
            cur = next;
            curRef = nextRef;
            linked = true;
        }
        if (cur) cur.linked = linked;
        return cur;
    }
    /** Spend n from the spender's terminal pool. Never blocks — `ok:false` = ran dry. */
    function spendPooledUse(data, ref, n = 1) {
        const pool = resolveChargePool(data, ref);
        if (!pool) return null;
        const ok = pool.value >= n;
        pool.value = Math.max(0, pool.value - n);
        return { ok, left: pool.value, max: pool.max, label: pool.label, linked: pool.linked };
    }

    /**
     * Advance combat by one round: bump the round counter and tick every round-denominated
     * duration down by one. Conditions store durations as free text ("5 rounds") — parse
     * the leading number when the unit is rounds (or absent), rewrite what's left, and
     * clear the condition at zero. Buffs use their structured {value, units}. Minute/hour
     * buffs are untouched (a round is 6 seconds; ticking them here would be noise).
     * @returns {{ round: number, expired: string[] }}
     */
    function advanceRound(data) {
        const st = sheetState(data);
        st.roundCounter = (Number(st.roundCounter) || 0) + 1;
        const expired = [];

        st.conditionDurations ??= {};
        const condLabel = (id) => (window.SheetData?.PF1_CONDITIONS || [])
            .find((c) => c.id === id)?.label || id;
        for (const id of [...activeConditions(data)]) {
            const raw = String(st.conditionDurations[id] || '').trim();
            const m = raw.match(/^(\d+)(\s*(?:round|rnd|rd|r)s?\.?)?$/i);
            if (!m) continue; // free-text ("until save") — never auto-expire
            const left = Number(m[1]) - 1;
            if (left <= 0) {
                delete st.conditionDurations[id];
                setConditionActive(data, id, false);
                expired.push(condLabel(id));
            } else {
                st.conditionDurations[id] = left + (m[2] ? ' ' + (left === 1 ? 'round' : 'rounds') : '');
            }
        }

        for (const b of ensureBuffs(data)) {
            if (!b || b.active === false) continue;
            const u = String(b.duration?.units || '');
            if (u !== 'round' && u !== 'turn') continue;
            const v = Number(b.duration.value);
            if (!Number.isFinite(v) || v <= 0) continue;
            const left = v - 1;
            b.duration.value = String(left);
            if (left <= 0) {
                b.active = false;
                expired.push(b.name);
            }
        }

        // Combat toggles marked autoExpire:'round' (charge: its −2 AC lasts until your next
        // turn) clear here so the toast names them; the panel repaints on the re-render.
        const prefs = st.conditionalPrefs || {};
        for (const t of window.SheetData?.COMBAT_TOGGLES || []) {
            if (t.autoExpire === 'round' && prefs[t.id]) {
                prefs[t.id] = false;
                expired.push(t.name);
            }
        }

        // Timed marquee features (Rage, Inspire Courage) burn one round from their
        // Features-tab uses pool each round they stay on and auto-end at 0 — Rage's end
        // applies fatigued (PF1: for 2× rounds raged; the duration stays a chip note).
        for (const t of window.SheetData?.MARQUEE_FEATURES || []) {
            if (!t.timed || !prefs[t.id]) continue;
            const uname = t.uses?.name || t.name;
            featureUses(data, uname); // ensure the entry exists for the resolver
            // #25: the burn follows a charge link when one is set (pool owner pays).
            const spent = spendPooledUse(data, { kind: 'feature', name: uname }, 1);
            if (!spent || spent.left <= 0) {
                prefs[t.id] = false;
                let label = t.name;
                if (t.endCondition) {
                    setConditionActive(data, t.endCondition, true);
                    label += ` → ${t.endCondition}`;
                }
                expired.push(label);
            }
        }

        // New round: the swift/immediate slot and AoO pool refresh (#19).
        const ae = ensureActionEconomy(data);
        ae.swiftSpent = false;
        ae.aooUsed = 0;

        // Fast healing + regeneration heal at the start of the creature's turn (#4).
        // Both heal lethal and nonlethal alike; regeneration's "can't die" side and its
        // bypass types stay the Defenses tab's prose (regenBypass) — warn, don't model.
        let healed = 0;
        const defs = st.defenses || {};
        const healRate = (Number(defs.fastHealing) || 0) + (Number(defs.regen) || 0);
        if (healRate > 0) {
            const max = Number(data.Total_HP) || 0;
            const cur = st.hpCurrent == null || st.hpCurrent === ''
                ? max : Number(st.hpCurrent) || 0;
            if (cur < max) {
                st.hpCurrent = Math.min(max, cur + healRate);
                healed = st.hpCurrent - cur;
            }
            const nl = Number(st.hpNonlethal) || 0;
            if (nl > 0) {
                st.hpNonlethal = Math.max(0, nl - healRate);
                healed = Math.max(healed, nl - st.hpNonlethal);
            }
        }

        quietSave();
        return { round: st.roundCounter, expired, healed };
    }
    function resetRoundCounter(data) {
        sheetState(data).roundCounter = 0;
        const ae = ensureActionEconomy(data);
        ae.swiftSpent = false;
        ae.aooUsed = 0;
        quietSave();
    }

    function formatBuffDuration(buff) {
        const v = String(buff?.duration?.value || '').trim();
        const u = String(buff?.duration?.units || '').trim();
        if (!v && !u) return '—';
        if (v && u) {
            const unitLab = ({
                turn: 'turn', round: 'round', minute: 'min', hour: 'hour',
            })[u] || u;
            const plural = v !== '1' ? 's' : '';
            return v + ' ' + unitLab + (unitLab === 'min' ? '' : plural);
        }
        if (v) return v;
        return u || '—';
    }
    function createBuff(data, opts = {}) {
        const list = ensureBuffs(data);
        const changes = cloneChanges(opts.changes);
        if (!changes.length && opts.seedDefault !== false) {
            changes.push({
                formula: '1', target: 'ac', type: 'untyped',
                operator: 'add', priority: 0,
            });
        }
        // No explicit id: normalizeBuffEntry's default carries a random suffix, so two
        // buffs created in the same millisecond cannot collide — presets (#83) key on it.
        const buff = normalizeBuffEntry({
            name: opts.name || 'New buff',
            subType: opts.subType || 'temp',
            active: opts.active !== false,
            level: opts.level != null ? opts.level : 0,
            duration: opts.duration || { value: '', units: '' },
            changes,
            notes: opts.notes || '',
        });
        list.push(buff);
        quietSave();
        return buff;
    }
    function addBuffFromCatalog(data, name, entry, subType) {
        // Exactly the compendium changes — possibly none. No "+1 → AC" placeholder;
        // the buff editor is one click away for adding real modifiers.
        return createBuff(data, {
            name: name || entry?.name || 'Buff',
            subType: subType || 'temp',
            changes: cloneChanges(entry?.changes),
            seedDefault: false,
        });
    }
    /**
     * Ensure equipment_list is an array of editable inventory objects.
     * Migrates plain name strings in place (persisted on next save).
     */
    function ensureInventoryObjects(data) {
        if (!data) return [];
        if (!Array.isArray(data.equipment_list)) data.equipment_list = [];
        const SD = window.SheetDetails;
        data.equipment_list = data.equipment_list.map((raw, i) => {
            const norm = SD?.normalizeInventoryEntry?.(raw, data);
            if (!norm) {
                return typeof raw === 'object' && raw
                    ? raw
                    : { id: 'eq-empty-' + i, name: String(raw || ''), equipped: true, changes: [] };
            }
            // Persist as object so equip/buffs/remove stick
            const rawObj = (raw && typeof raw === 'object') ? raw : {};
            const obj = {
                id: norm.id || ('eq-' + i),
                name: norm.name,
                equipped: norm.equipped !== false,
                carried: norm.carried !== false,
                identified: norm.identified !== false,
                quantity: norm.quantity == null ? 1 : Math.max(0, Number(norm.quantity) || 0),
                weight: norm.weight,
                price: norm.price,
                description: norm.description || '',
                changes: cloneChanges(norm.changes),
                contextNotes: (norm.contextNotes || []).map((n) => ({ ...n })),
                changesCustomized: !!norm.changesCustomized,
            };
            if (rawObj.value != null && obj.price == null) obj.price = Number(rawObj.value);
            if (norm.subType) obj.subType = norm.subType;
            if (norm.slot) obj.slot = norm.slot;
            if (norm.itemType) obj.itemType = norm.itemType;
            if (norm.containerId) obj.containerId = norm.containerId;
            // Keep equip_descrip in sync for other consumers
            if (obj.description) {
                (data.equip_descrip ??= {})[obj.name] = obj.description;
            }
            // Preserve object identity: setActiveTab re-hydrates the list after panes render,
            // and rendered rows (checkboxes, editors) hold references to these objects — a new
            // object here would orphan them, so their edits would silently stop persisting.
            return (raw && typeof raw === 'object') ? Object.assign(raw, obj) : obj;
        });
        return data.equipment_list;
    }
    /** Ensure skill_ranks is a mutable object; return map used for display. */
    function ensureSkillRanksObject(data) {
        let ranks = data.skill_ranks;
        if (typeof ranks === 'string') {
            try { ranks = JSON.parse(ranks); } catch { ranks = {}; }
        }
        if (!ranks || typeof ranks !== 'object') ranks = {};
        // Normalize once so writes stick
        const map = {};
        for (const [k, v] of Object.entries(ranks)) {
            map[String(k).toLowerCase().trim()] = Number(v) || 0;
        }
        data.skill_ranks = map;
        return map;
    }
    // ---- Classes & archetypes as ordered, catalog-backed lists ----
    // class_list is the source of truth; c_class / c_class_2 mirror its first two entries
    // so every existing consumer (casting detection, multiclass saves, class-feature
    // lookup, header fields) keeps working unchanged.
    function ensureClassList(data) {
        if (!Array.isArray(data.class_list)) {
            // multiclass payloads carry classes: [{name, display, level}, ...] (up to 4);
            // older payloads seed from the legacy c_class / c_class_2 pair
            const seed = (Array.isArray(data.classes) && data.classes.length
                ? data.classes.map((c) => String(c.name || '').trim())
                : [data.c_class, data.c_class_2].map((c) => String(c || '').trim())
            ).filter(Boolean);
            const seen = new Set();
            data.class_list = seed.filter((c) => {
                const k = c.toLowerCase();
                if (seen.has(k)) return false;
                seen.add(k); return true;
            });
        }
        return data.class_list;
    }
    function syncLegacyClasses(data) {
        const list = ensureClassList(data);
        data.c_class = list[0] || '';
        data.c_class_2 = list[1] || '';
    }
    function ensureArchetypeList(data) {
        if (!Array.isArray(data.archetype_list)) {
            let obj = data.archetype_info;
            if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = null; } }
            data.archetype_list = (obj && typeof obj === 'object') ? Object.keys(obj) : [];
        }
        return data.archetype_list;
    }
    function ensureDefenses(data) {
        const st = sheetState(data);
        st.defenses ??= {};
        for (const key of ['dr', 'resist', 'dmgImmune', 'dmgVuln', 'condResist', 'condImmune']) {
            if (!Array.isArray(st.defenses[key])) st.defenses[key] = [];
        }
        return st.defenses;
    }

    /** #21 variant rules — per-character opt-in toggles. House rules are campaign
     *  properties, so they live on _sheet (travel in the one-JSON export), not in
     *  localStorage. All default OFF: an existing character must not shift by a point. */
    function ensureVariantRules(data) {
        const st = sheetState(data);
        st.variantRules ??= {};
        const vr = st.variantRules;
        vr.woundsVigor ??= false;
        vr.backgroundSkills ??= false;
        vr.fractionalBases ??= false;
        vr.abp ??= false;
        vr.abpChoices ??= {};
        return vr;
    }
    const variantRuleOn = (data, key) => Boolean(data?._sheet?.variantRules?.[key]);

    return {
        sheetState, quietSave, refreshDerived, seedBackendStatBonuses, seedRacialColumn,
        disabledBuffSet, buffSourceKey, removedBuffSet, isBuffSourceActive, isBuffSourceRemoved,
        setBuffSourceActive, removeBuffSource, restoreRemovedBuffSources, activeStanceSet,
        setStanceActive, activeConditions, setConditionActive, notesForTargets, attachNotesHover,
        featureCustomList, featureCustomEntry, pruneFeatureCustom, ensureBuffs, normalizeBuffEntry,
        formatBuffDuration, advanceRound, resetRoundCounter, featureUses, hasFeaturePool,
        ensureActionEconomy,
        chargePoolOptions, resolveChargePool, spendPooledUse,
        createBuff, addBuffFromCatalog, ensureSpellCasts, spendSpellSlot,
        ensureCastingAbility, ensureInitiationStat, ensureInventoryObjects, ensureDefenses,
        ensureClassList, syncLegacyClasses, ensureArchetypeList, ensureSkillRanksObject,
        ensureVariantRules, variantRuleOn,
        BUFF_SUBTYPES, BUFF_DURATION_UNITS,
    };
})();
