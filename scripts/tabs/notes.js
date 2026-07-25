// scripts/tabs/notes.js -- the Notes tab + the shared prose helpers (window.SheetTabNotes).
// Extracted from sheet.js (Part B split); bodies moved verbatim. This is the home for the prose
// cluster (ensureProse / renderBioFacts / bindProseTextarea / joinProseField / seedNotesText),
// which the Biography tab and other tabs consume -- so it loads first among the tab modules.
// SheetApp.ensureProse (used by roster.js) is re-pointed here in the shell.
window.SheetTabNotes = (function () {
    'use strict';
    const { h, section, htmlBlock, escapeHtml, nonEmpty, foundry } = window.SheetUI;
    const { sheetState, quietSave } = window.SheetState;

    /** Join generator string/array fields into readable prose. */
    function joinProseField(v) {
        if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean).join(', ');
        if (v == null || v === '') return '';
        return String(v).trim();
    }
    /**
     * Freeform identity prose (Foundry-style biography/notes).
     * One-time seed from generator micro-fields when empty; then fully editable on Notes.
     */
    /** Prose backstory minus the legacy closing labeled list (Personality:/Mannerisms:/...): the
     * structured formatted_bio block already shows those facts. Covers old backend payloads. */
    function cleanBackstory(data) {
        const paragraphs = String(data.backstory || '').trim().split(/\n\s*\n/);
        while (paragraphs.length
               && /^(personality|mannerisms|appearance|flaws|traits)\s*:/i.test(paragraphs[paragraphs.length - 1].trim())) {
            paragraphs.pop();
        }
        return paragraphs.join('\n\n').trim();
    }
    /** The freeform backstory prose only. The generator's structured fact block (formatted_bio)
     * is rendered on its own by renderBioFacts, so it's no longer dumped into the editable notes
     * (that dump was what pushed the simple printed sheet onto a third page). */
    function seedNotesText(data) {
        return cleanBackstory(data);
    }
    /**
     * Parse the backend's structured_bio block into sections. Each section is a header line
     * followed by "- …" bullets, sections separated by a blank line (see backstory.py). Returns
     * [{ header, bullets: [{ label, value }] }] — a bullet with no "Label: " prefix has label ''.
     */
    function parseFormattedBio(text) {
        const raw = String(text || '').trim();
        if (!raw) return [];
        const sections = [];
        for (const chunk of raw.split(/\n\s*\n/)) {
            const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
            if (!lines.length) continue;
            const header = lines[0].replace(/^-\s*/, '');
            const bullets = [];
            for (const line of lines.slice(1)) {
                const b = line.replace(/^-\s*/, '');
                const m = /^([A-Z][\w' ]{0,22}?):\s*(.+)$/.exec(b);
                if (m) bullets.push({ label: m[1], value: m[2] });
                else bullets.push({ label: '', value: b });
            }
            sections.push({ header, bullets });
        }
        return sections;
    }
    // Identity bullets that already appear in the sheet's header id-grid — dropped from the
    // rendered background so nothing is shown twice.
    const BIO_HEADER_DUP = new Set(['alignment', 'deity', 'race', 'class', 'homeland']);
    /**
     * Compact, read-only structured background from data.formatted_bio: a grid of labelled fact
     * cards (Build / Vocation / Family / Personality / Appearance) that lays out horizontally
     * instead of stacking a wall of text vertically. Returns null when there's nothing to show.
     */
    function renderBioFacts(data, { compact = false, vertical = false } = {}) {
        const sections = parseFormattedBio(data.formatted_bio);
        if (!sections.length) return null;
        const grid = h('div', 'simple-bg'
            + (compact ? ' simple-bg-compact' : '')
            + (vertical ? ' simple-bg-vertical' : ''));
        sections.forEach((sec, i) => {
            let { header, bullets } = sec;
            if (i === 0) {
                // First section is Identity (headed by the name); most of it repeats the header
                // row, so relabel it "Build" and keep only the bullets not shown up top.
                header = 'Build';
                bullets = bullets.filter((b) => !BIO_HEADER_DUP.has(b.label.toLowerCase()));
            }
            if (!bullets.length) return;
            const card = h('div', 'simple-bg-card');
            card.appendChild(h('div', 'simple-bg-head', header));
            const ul = h('ul', 'simple-bg-list');
            for (const b of bullets) {
                const li = h('li');
                if (b.label) li.appendChild(h('span', 'simple-bg-k', b.label + ': '));
                li.appendChild(document.createTextNode(b.value));
                ul.appendChild(li);
            }
            card.appendChild(ul);
            grid.appendChild(card);
        });
        return grid.children.length ? grid : null;
    }
    function ensureProse(data) {
        const st = sheetState(data);
        st.prose ??= {};
        const p = st.prose;
        if (p._seeded) {
            if (!p.notes && st.notes) p.notes = String(st.notes);
            return p;
        }
        const hasAny = !!(p.description || p.personality || p.notes);
        if (!hasAny) {
            const descBits = [];
            const hair = [joinProseField(data.hair_type), joinProseField(data.hair_color)]
                .filter(Boolean).join(', ');
            if (hair) descBits.push('Hair: ' + hair);
            const eyes = joinProseField(data.eye_color);
            if (eyes) descBits.push('Eyes: ' + eyes);
            const appearance = joinProseField(data.appearance);
            if (appearance) descBits.push(appearance);
            p.description = descBits.join('\n');

            const personBits = [];
            const traits = joinProseField(data.personality_traits);
            if (traits) personBits.push(traits);
            const manner = joinProseField(data.mannerisms);
            if (manner) personBits.push('Mannerisms: ' + manner);
            const profs = joinProseField(data.professions);
            if (profs) personBits.push('Professions: ' + profs);
            p.personality = personBits.join('\n');

            const noteBits = [];
            // Only the backstory prose is seeded into the editable notes now; the structured
            // fact block (formatted_bio) renders separately via renderBioFacts. The family lines
            // below are still assembled for older payloads that predate formatted_bio.
            const seeded = seedNotesText(data);
            if (seeded) noteBits.push(seeded);
            if (st.notes) noteBits.push(String(st.notes).trim());
            if (!data.formatted_bio) {
                const parents = joinProseField(data.parents);
                if (parents) noteBits.push('Parents: ' + parents);
                const family = [
                    ['Older brothers', data.older_brothers],
                    ['Younger brothers', data.younger_brothers],
                    ['Older sisters', data.older_sisters],
                    ['Younger sisters', data.younger_sisters],
                ].map(([lab, v]) => {
                    const n = v == null || v === '' ? '' : String(v).trim();
                    return n && n !== '0' ? lab + ': ' + n : '';
                }).filter(Boolean);
                if (family.length) noteBits.push(family.join('\n'));
            }
            p.notes = noteBits.filter(Boolean).join('\n\n');
        } else {
            if (!p.notes && st.notes) p.notes = String(st.notes);
            if (!p.notes) p.notes = seedNotesText(data);
        }
        p.description = p.description || '';
        p.personality = p.personality || '';
        p.notes = p.notes || '';
        p._seeded = true;
        // Keep legacy notes field in sync for older readers
        st.notes = p.notes;
        return p;
    }
    function bindProseTextarea(ta, data, key) {
        let timer = null;
        ta.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const p = ensureProse(data);
                p[key] = ta.value;
                if (key === 'notes') (data._sheet ??= {}).notes = ta.value;
                if (data === currentData) quietSave();
            }, 800);
        });
    }
    function tabNotes(data) {
        const prose = ensureProse(data);
        const { sec, body } = section('Notes');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Freeform identity & session text (biography/notes). Auto-saves with the character.'));

        const mkBlock = (title, key, placeholder, extraClass, prefixNode) => {
            body.appendChild(h('h3', 'notes-prose-title', title));
            // Optional read-only content (e.g. the structured background) sits under the heading,
            // above the editable textarea, so it reads as part of this section.
            if (prefixNode) body.appendChild(prefixNode);
            const ta = h('textarea', 'notes-text' + (extraClass ? ' ' + extraClass : ''));
            ta.id = 'notes-prose-' + key;
            ta.placeholder = placeholder;
            ta.value = prose[key] || '';
            ta.rows = key === 'notes' ? 12 : 6;
            bindProseTextarea(ta, data, key);
            body.appendChild(ta);
        };
        mkBlock('Description', 'description',
            'Appearance, hair, eyes, build, clothing, distinguishing marks…');
        mkBlock('Personality', 'personality',
            'Traits, mannerisms, voice, ideals, flaws, how they act at the table…');
        // The structured background (from the generator's formatted_bio) lives inside the
        // Notes & background section, stacked vertically above the editable notes textarea.
        mkBlock('Notes & background', 'notes',
            'Backstory, family, relationships, session plans, secrets…',
            'notes-text-main', renderBioFacts(data, { vertical: true }));
        // Legacy id for re-render flush of the main notes field
        const main = body.querySelector('#notes-prose-notes');
        if (main) main.dataset.legacyNotes = '1';
        return sec;
    }

    return {
        tabNotes, ensureProse, renderBioFacts, bindProseTextarea, joinProseField,
        seedNotesText, parseFormattedBio, cleanBackstory,
    };
})();
