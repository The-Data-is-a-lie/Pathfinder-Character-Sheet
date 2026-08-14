// scripts/tabs/biography.js -- the Biography (vitals) tab (window.SheetTabBiography).
// Extracted from sheet.js (Part B split); body moved verbatim.
window.SheetTabBiography = (function () {
    'use strict';
    const { h, section, kvDbl } = window.SheetUI;

    /** Biography tab: vitals only — freeform description/personality live on Notes. */
    function renderBiographyVitals(data) {
        const { sec, body } = section('Biography');
        body.appendChild(h('p', 'dbl-edit-hint no-print',
            'Physical vitals. Description, personality, family, and backstory are freeform on the Notes tab.'));
        kvDbl(body, 'Age', data, 'age_number', { type: 'number', min: 0 });
        kvDbl(body, 'Height', data, 'height_number');
        kvDbl(body, 'Weight (lbs)', data, 'weight_number', { type: 'number', min: 0 });
        // Languages moved to Attributes (with senses / aura / proficiencies).
        renderRelationships(body, data);
        body.appendChild(h('p', 'dim no-print',
            'Tip: open Notes for Description, Personality, and session / background text.'));
        return sec;
    }

    /**
     * #73: who this character is tied to. Written by the "Generate related…" recipe on BOTH
     * sides, stored on `_sheet.relationships` so it rides every export and folder mirror.
     * Rendering is skipped entirely when there are none — no empty scaffolding.
     */
    function renderRelationships(body, data) {
        const list = data?._sheet?.relationships;
        if (!Array.isArray(list) || !list.length) return;
        body.appendChild(h('h3', null, 'Relationships'));
        const wrap = h('div', 'relationship-list');
        for (const rel of list) {
            const row = h('div', 'relationship-row');
            row.appendChild(h('span', 'relationship-type', rel.label || rel.type || 'Linked'));
            // A link only where there is something to open: an id can go stale if the other
            // character was deleted, and a dead button is worse than plain text.
            if (rel.id) {
                const open = h('button', 'relationship-open', rel.name);
                open.type = 'button';
                open.title = 'Open ' + rel.name;
                open.addEventListener('click', () => window.SheetRoster?.loadCharacter?.(rel.id));
                row.appendChild(open);
            } else {
                row.appendChild(h('span', 'relationship-name', rel.name));
            }
            wrap.appendChild(row);
        }
        body.appendChild(wrap);
    }

    return { renderBiographyVitals };
})();
