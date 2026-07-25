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
        body.appendChild(h('p', 'dim no-print',
            'Tip: open Notes for Description, Personality, and session / background text.'));
        return sec;
    }

    return { renderBiographyVitals };
})();
