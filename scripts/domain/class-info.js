// scripts/domain/class-info.js -- the class & archetype domain (window.SheetClassInfo): the
// PF1 class chassis (built-in table + per-character overrides), per-class level resolution, the
// class-skill seeder, and the scraped-archetype catalog + history. Part D.1: modals-free, loaded
// after skill-math (uses setSkillBonus) and before modals, so the Summary tab, modals' class/
// archetype sheets and the Features tab import it directly. CLASS_STATS/DEFAULT_CLASS_INFO come
// from SheetData.
window.SheetClassInfo = (function () {
    'use strict';
    const { escapeHtml, titleCase } = window.SheetUI;
    const { sheetState, quietSave, ensureClassList } = window.SheetState;
    const { setSkillBonus } = window.SheetSkillMath;
    const { CLASS_STATS, DEFAULT_CLASS_INFO } = window.SheetData;
    // Previously-used archetype names the picker offers, persisted across characters (moved here
    // from the shell during Part D).
    const USED_ARCHETYPES_KEY = 'sheet.usedArchetypes';

    let archetypesByClass = null;
    function classKeyOf(name) {
        return String(name || '').toLowerCase().trim();
    }
    /**
     * Level of ONE named class, for per-class labels. Without this every class card showed the
     * PRIMARY class's level, so the Wizard card on a Monk 8 / Wizard 5 read "Wizard — level 8".
     * Falls back to the legacy `level` so old payloads (no classes[]) and user-added classes with no
     * payload entry render exactly as they do today, rather than inheriting a fabricated total.
     */
    function classLevelFor(data, clsName) {
        const key = classKeyOf(clsName);
        const hit = (Array.isArray(data?.classes) ? data.classes : [])
            .find((c) => classKeyOf(c.name) === key || classKeyOf(c.display) === key);
        return Number(hit?.level) || (Number(data?.level) || 0);
    }
    /** Built-in chassis + per-character overrides (_sheet.classInfo[key]). */
    function classInfoFor(data, clsName) {
        const key = classKeyOf(clsName);
        const base = CLASS_STATS[key] || {};
        const over = data?._sheet?.classInfo?.[key] || {};
        return { ...DEFAULT_CLASS_INFO, ...base, ...over };
    }
    function setClassInfo(data, clsName, field, value) {
        const st = sheetState(data);
        st.classInfo ??= {};
        const key = classKeyOf(clsName);
        st.classInfo[key] ??= {};
        if (value == null || value === '' || value === '—') delete st.classInfo[key][field];
        else st.classInfo[key][field] = value;
        if (!Object.keys(st.classInfo[key]).length) delete st.classInfo[key];
        if (!Object.keys(st.classInfo).length) delete st.classInfo;
        quietSave();
    }
    /** One-time: check the class-skill CS toggles from the class defaults. */
    function seedClassSkills(data) {
        const st = sheetState(data);
        if (st.classSkillsSeeded) return;
        st.classSkillsSeeded = true;
        for (const cls of ensureClassList(data)) {
            if (!cls) continue;
            for (const id of classInfoFor(data, cls).classSkills || []) {
                setSkillBonus(data, id, 'cs', true);
            }
        }
        quietSave();
    }
    /** { name, raw } from the backend archetype_info ({ "<Name>": <description> }). */
    function archetypeInfoOf(data) {
        let obj = data?.archetype_info;
        if (typeof obj === 'string') {
            try { obj = JSON.parse(obj); } catch { return null; }
        }
        if (!obj || typeof obj !== 'object') return null;
        const name = Object.keys(obj)[0];
        return name ? { name, raw: obj[name] } : null;
    }
    /** Render scraped archetype content (string / array / object) as readable HTML. */
    function archetypeDescHtml(raw) {
        if (raw == null) return '<p class="dim">No description.</p>';
        if (typeof raw === 'string') {
            return /</.test(raw) ? raw : '<p>' + escapeHtml(raw) + '</p>';
        }
        if (Array.isArray(raw)) {
            return raw.map((x) => archetypeDescHtml(x)).join('');
        }
        return Object.entries(raw).map(([k, v]) =>
            `<p><strong>${escapeHtml(titleCase(k.replace(/_/g, ' ')))}:</strong></p>`
            + archetypeDescHtml(v)).join('');
    }
    function usedArchetypeArr() {
        try {
            const arr = JSON.parse(localStorage.getItem(USED_ARCHETYPES_KEY));
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    }
    function recordUsedArchetype(name) {
        const nm = String(name || '').trim();
        if (!nm) return;
        const arr = usedArchetypeArr();
        if (arr.some((x) => x.toLowerCase() === nm.toLowerCase())) return;
        arr.push(nm);
        try { localStorage.setItem(USED_ARCHETYPES_KEY, JSON.stringify(arr)); } catch { /* private */ }
    }
    function usedArchetypeHits(query) {
        const q = String(query || '').toLowerCase();
        return usedArchetypeArr()
            .filter((nm) => nm.toLowerCase().includes(q))
            .sort((a, b) => a.localeCompare(b))
            .map((nm) => ({ name: nm, kind: 'archetypes', subtitle: 'Used before' }));
    }
    function loadArchetypesByClass() {
        if (archetypesByClass) return;
        fetch('data/archetypes_by_class.json')
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => { if (j && typeof j === 'object') archetypesByClass = j; })
            .catch(() => { /* offline / missing file — picker falls back to used + custom */ });
    }
    /** Archetypes available to the character's current classes, filtered by query. */
    function classArchetypeHits(data, query) {
        if (!archetypesByClass) return [];
        const q = String(query || '').toLowerCase();
        const seen = new Set();
        const out = [];
        for (const cls of ensureClassList(data)) {
            const key = String(cls).toLowerCase();
            for (const name of archetypesByClass[key] || []) {
                const k = name.toLowerCase();
                if (seen.has(k) || !k.includes(q)) continue;
                seen.add(k);
                out.push({ name, kind: 'archetypes', subtitle: titleCase(cls) + ' archetype' });
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
        classKeyOf, classLevelFor, classInfoFor, setClassInfo, seedClassSkills, archetypeInfoOf,
        archetypeDescHtml, usedArchetypeArr, recordUsedArchetype, usedArchetypeHits,
        loadArchetypesByClass, classArchetypeHits,
    };
})();
