// scripts/tabs/notes.js -- the Notes tab + the shared prose helpers (window.SheetTabNotes).
// Extracted from sheet.js (Part B split); bodies moved verbatim. This is the home for the prose
// cluster (ensureProse / bioFactsText / bindProseTextarea / joinProseField / seedNotesText),
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
    /** The freeform backstory prose only — the generator's structured fact block (formatted_bio)
     * is added separately by bioFactsText, so this stays a single-purpose helper. */
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
     * The structured background from data.formatted_bio as PLAIN TEXT, for seeding straight into
     * the editable notes. This used to render read-only fact cards above the textarea, which meant
     * the one part of the notes a user most wants to rewrite was the one part they couldn't touch.
     * Now there is a single editable box and this only prepares its text.
     *
     * Emits the same shape it parsed (header line, then "- Label: value" bullets, blank line
     * between sections) so the text reads naturally in a textarea and survives a round-trip
     * through parseFormattedBio. Returns '' when there's nothing to show.
     */
    function bioFactsText(data) {
        const sections = parseFormattedBio(data.formatted_bio);
        if (!sections.length) return '';
        const out = [];
        sections.forEach((sec, i) => {
            let { header, bullets } = sec;
            if (i === 0) {
                // First section is Identity (headed by the name); most of it repeats the header
                // row, so relabel it "Build" and keep only the bullets not shown up top.
                header = 'Build';
                bullets = bullets.filter((b) => !BIO_HEADER_DUP.has(b.label.toLowerCase()));
            }
            if (!bullets.length) return;
            const lines = [header];
            for (const b of bullets) lines.push('- ' + (b.label ? b.label + ': ' : '') + b.value);
            out.push(lines.join('\n'));
        });
        return out.join('\n\n');
    }
    /**
     * One-time fold of the structured background into the editable notes, for characters saved
     * before it lived there. Their prose is already _seeded, so the seed branch below never runs
     * again and the background would simply be missing once the read-only cards were removed.
     * Same idiom as _sheet.coreGearMigrated / currencyNormalized / classSkillsSeeded.
     */
    function foldBioIntoNotes(data, p) {
        if (p._bioFolded) return;
        p._bioFolded = true;
        const facts = bioFactsText(data);
        // Flag AND content check: a JSON exported before the flag existed, then re-imported, can
        // arrive already folded — appending again would double the whole block.
        if (!facts) return;
        if (String(p.notes || '').includes(facts.split('\n')[0])) return;
        p.notes = [facts, p.notes].filter(Boolean).join('\n\n');
    }
    function ensureProse(data) {
        const st = sheetState(data);
        st.prose ??= {};
        const p = st.prose;
        if (p._seeded) {
            if (!p.notes && st.notes) p.notes = String(st.notes);
            foldBioIntoNotes(data, p);
            st.notes = p.notes;
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
            // Facts first, then the backstory prose — the same reading order the read-only cards
            // gave when they sat above this textarea. The family lines below are still assembled
            // for older payloads that predate formatted_bio (where bioFactsText returns '').
            const facts = bioFactsText(data);
            if (facts) noteBits.push(facts);
            const seeded = seedNotesText(data);
            if (seeded) noteBits.push(seeded);
            // Generator build-family label + tactics blurb (#68) — GM-facing "how this
            // NPC fights" prose, seeded once like the rest of the background.
            const buildBits = [];
            const bArch = joinProseField(data.build_archetype);
            if (bArch) buildBits.push('Build: ' + bArch);
            const bTac = joinProseField(data.build_tactics);
            if (bTac) buildBits.push(bTac);
            if (buildBits.length) noteBits.push(buildBits.join('\n'));
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
        // Freshly seeded notes already contain the facts, so mark the migration done rather than
        // letting the next load re-scan and risk a second copy.
        p._bioFolded = true;
        // Keep legacy notes field in sync for older readers
        st.notes = p.notes;
        return p;
    }
    /**
     * A textarea crops on paper — nothing expands one for print, so whatever doesn't fit its box
     * is silently missing from the printout. That was harmless while the background rendered as
     * separate cards; now that it lives IN the notes, the overflow would be most of the content.
     * So each textarea gets a print-only twin holding the same text, swapped in by the print CSS.
     */
    function attachPrintMirror(ta) {
        const mirror = h('div', 'notes-print print-only');
        mirror.textContent = ta.value;
        ta._printMirror = mirror;
        return mirror;
    }
    function bindProseTextarea(ta, data, key) {
        let timer = null;
        ta.addEventListener('input', () => {
            // Un-debounced: a print fired mid-edit must show what's on screen, not what was
            // saved 800ms ago.
            if (ta._printMirror) ta._printMirror.textContent = ta.value;
            clearTimeout(timer);
            timer = setTimeout(() => {
                const p = ensureProse(data);
                p[key] = ta.value;
                if (key === 'notes') (data._sheet ??= {}).notes = ta.value;
                // Via SheetApp.current, not a bare `currentData`: that identifier lives in the
                // shell's IIFE and is not in scope here, so this line threw on every keystroke —
                // before quietSave() could run. Prose edits updated memory and were never saved.
                if (data === window.SheetApp.current) quietSave();
            }, 800);
        });
    }
    function tabNotes(data) {
        const prose = ensureProse(data);
        const { sec, body } = section('Notes');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Freeform identity & session text (biography/notes). Auto-saves with the character.'));

        const mkBlock = (title, key, placeholder, extraClass) => {
            body.appendChild(h('h3', 'notes-prose-title', title));
            const ta = h('textarea', 'notes-text' + (extraClass ? ' ' + extraClass : ''));
            ta.id = 'notes-prose-' + key;
            ta.placeholder = placeholder;
            ta.value = prose[key] || '';
            ta.rows = key === 'notes' ? 12 : 6;
            bindProseTextarea(ta, data, key);
            body.appendChild(ta);
            body.appendChild(attachPrintMirror(ta));
        };
        mkBlock('Description', 'description',
            'Appearance, hair, eyes, build, clothing, distinguishing marks…');
        mkBlock('Personality', 'personality',
            'Traits, mannerisms, voice, ideals, flaws, how they act at the table…');
        // The structured background (from the generator's formatted_bio) is seeded INTO this
        // textarea by ensureProse — it is no longer a separate read-only block above it.
        mkBlock('Notes & background', 'notes',
            'Backstory, family, relationships, session plans, secrets…',
            'notes-text-main');
        // Legacy id for re-render flush of the main notes field
        const main = body.querySelector('#notes-prose-notes');
        if (main) main.dataset.legacyNotes = '1';
        return sec;
    }

    return {
        tabNotes, ensureProse, bioFactsText, attachPrintMirror, bindProseTextarea, joinProseField,
        seedNotesText, parseFormattedBio, cleanBackstory,
    };
})();
