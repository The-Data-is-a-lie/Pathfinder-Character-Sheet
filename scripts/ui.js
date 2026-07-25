// Shared DOM kit for the character sheet — the leaf every renderer builds on.
//
// These are the pure, state-free element helpers that used to live at the top of the
// 10k-line sheet.js. They depend only on `document` and each other, never on character
// data or sheet state, which makes them the natural first module to lift out of the
// monolith. sheet.js pulls them back into its own scope with a destructure
// (`const { h, section, … } = window.SheetUI`), so no call site had to change.
//
// Anything that needs character/explain/glossary state (kLabel, kv, kvStat, the spTable
// family) deliberately stays behind for a later, less mechanical extraction.

window.SheetUI = (function () {
    'use strict';

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

    const emptyState = (text) => h('p', 'placeholder tab-empty', text);

    function compose(...sections) {
        const frag = document.createDocumentFragment();
        for (const s of sections) if (s) frag.appendChild(s);
        return frag.childNodes.length ? frag : null;
    }

    /**
     * Wrap every <table> in a horizontal-scroll container so wide, dense tables (skills,
     * saves, abilities, spells) scroll within their column on narrow screens instead of
     * forcing the whole page to overflow sideways. Idempotent per render.
     */
    function wrapWideTables(root) {
        if (!root) return;
        for (const table of root.querySelectorAll('table')) {
            if (table.closest('.table-scroll')) continue; // already wrapped (incl. nested)
            const wrap = document.createElement('div');
            wrap.className = 'table-scroll';
            table.replaceWith(wrap);
            wrap.appendChild(table);
        }
    }

    return { h, htmlBlock, details, section, emptyState, compose, wrapWideTables };
})();
