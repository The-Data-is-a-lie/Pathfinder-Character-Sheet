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

    // Signed number: +3 / -1 / +0. The sheet's default stat formatter.
    const fmt = (n) => (n >= 0 ? '+' + n : String(n));

    /** Plain-English hint node for a stat label, or null when the glossary has no entry. */
    function termHint(label) {
        const text = window.SheetGuide?.hintFor(label);
        return text ? h('span', 'term-hint', text) : null;
    }

    /**
     * Label cell for the complex view's key/value rows, carrying an Explain-mode hint when
     * the glossary knows the term. Shared by kv and kvStat, which is most of the Summary,
     * Defenses and Combat surface. Defined lazily via termHint so a glossary miss costs
     * nothing.
     */
    function kLabel(label) {
        const span = h('span', 'k', label);
        const hint = termHint(label);
        if (hint) span.appendChild(hint);
        return span;
    }

    function kv(body, label, value) {
        const row = h('div', 'kv');
        row.appendChild(kLabel(label));
        const v = h('span', 'v');
        if (value instanceof Node) v.appendChild(value);
        else v.textContent = value == null ? '' : String(value);
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    function kvStat(body, label, block, opts = {}) {
        const row = h('div', 'kv kv-stat');
        row.appendChild(kLabel(label));
        const v = h('span', 'v');
        const totalEl = h('span', 'stat-total',
            opts.formatTotal ? opts.formatTotal(block.total) : String(block.total));
        v.appendChild(totalEl);

        if (block.parts?.length) {
            const det = h('details', 'stat-sources');
            const sum = h('summary', null, 'sources');
            det.appendChild(sum);
            const list = h('ul', 'stat-source-list');
            for (const p of block.parts) {
                const li = h('li', 'stat-source-line'
                    + (p.unresolved ? ' unresolved' : '')
                    + (p.info ? ' info' : ''));
                const left = h('span', 'stat-source-label', p.label);
                let right;
                if (p.unresolved) {
                    right = h('span', 'stat-source-value', p.formula || '?');
                } else if (p.info) {
                    // Prefer explicit formula (e.g. weapon dice "1d8"); else numeric note
                    right = h('span', 'stat-source-value',
                        p.formula
                            || ((Number(p.value) >= 0 ? '+' : '') + p.value + ' (ledger)'));
                } else {
                    right = h('span', 'stat-source-value', fmt(Number(p.value) || 0));
                }
                li.append(left, right);
                list.appendChild(li);
            }
            if (block.note) {
                list.appendChild(h('li', 'stat-source-note', block.note));
            }
            det.appendChild(list);
            v.appendChild(det);
        }
        if (opts.footnote) {
            v.appendChild(h('div', 'stat-footnote', opts.footnote));
        }
        row.appendChild(v);
        body.appendChild(row);
        return row;
    }

    /** Hangs a hint under a complex-view .summary-stat-box (label / value / hint). */
    function attachStatHint(box, label) {
        const hint = termHint(label);
        if (hint) box.appendChild(hint);
        return box;
    }

    // ---- simple/print sheet cell builders (all carry Explain hints via termHint) ----
    function spCell(label, value, cls) {
        const cell = h('div', 'simple-id-cell' + (cls ? ' ' + cls : ''));
        if (value instanceof Node) {
            const v = h('div', 'simple-id-v');
            v.appendChild(value);
            cell.appendChild(v);
        } else {
            const text = value == null ? '' : String(value).trim();
            cell.appendChild(h('div', 'simple-id-v', text || ' '));
        }
        const key = h('div', 'simple-id-k', label);
        const keyHint = termHint(label);
        if (keyHint) key.appendChild(keyHint);
        cell.appendChild(key);
        return cell;
    }

    function spHeading(text) {
        const head = h('h2', 'simple-h', text);
        const hint = termHint(text);
        if (hint) {
            hint.classList.add('term-hint-block');
            head.appendChild(hint);
        }
        return head;
    }

    function spBoxBig(label, value) {
        const box = h('div', 'simple-stat-box');
        const lab = () => {
            const el = h('div', 'simple-stat-lab', label);
            const hint = termHint(label);
            if (hint) el.appendChild(hint);
            return el;
        };
        if (value instanceof Node) {
            const v = h('div', 'simple-stat-val');
            v.appendChild(value);
            box.appendChild(v);
            box.appendChild(lab());
            return box;
        }
        const text = value == null ? '' : String(value);
        box.appendChild(h('div', 'simple-stat-val', text || ' '));
        box.appendChild(lab());
        return box;
    }

    /** headers/cells: string or { text, cls } ('num' right-aligns, 'strong' bolds). */
    function spTable(headers, rows, cls) {
        const t = h('table', 'simple-table' + (cls ? ' ' + cls : ''));
        const hd = h('tr');
        for (const c of headers) {
            hd.appendChild(h('th', typeof c === 'object' ? c.cls : null,
                typeof c === 'object' ? c.text : c));
        }
        t.appendChild(hd);
        for (const raw of rows) {
            // Rows may be { cls, cells } so blank write-in rows can be tagged for print
            const isRowObj = raw && !Array.isArray(raw) && typeof raw === 'object' && Array.isArray(raw.cells);
            const row = isRowObj ? raw.cells : raw;
            const tr = h('tr', isRowObj ? raw.cls : null);
            let firstCell = true;
            for (const c of row) {
                // The leading cell names the row (STR, Fortitude, a skill…), so that is where
                // an Explain-mode hint belongs. Rows whose label isn't in the glossary — every
                // skill, for instance — simply get nothing.
                const rowHint = firstCell ? termHint(typeof c === 'object' ? c.text : c) : null;
                firstCell = false;
                if (rowHint) {
                    const text = typeof c === 'object' ? c.text : c;
                    const td = h('td', typeof c === 'object' ? c.cls : null, String(text ?? ''));
                    td.appendChild(rowHint);
                    tr.appendChild(td);
                    continue;
                }
                if (c instanceof Node) {
                    tr.appendChild(h('td', null, c));
                    continue;
                }
                if (c && typeof c === 'object' && c.node instanceof Node) {
                    tr.appendChild(h('td', c.cls, c.node));
                    continue;
                }
                const text = typeof c === 'object' ? c.text : c;
                tr.appendChild(h('td', typeof c === 'object' ? c.cls : null,
                    text == null || text === '' ? ' ' : String(text)));
            }
            t.appendChild(tr);
        }
        return t;
    }

    return {
        h, htmlBlock, details, section, emptyState, compose, wrapWideTables,
        fmt, termHint, kLabel, kv, kvStat, attachStatHint,
        spCell, spHeading, spBoxBig, spTable,
    };
})();
