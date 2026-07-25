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

    // Late-bound shell hooks: the edit widgets below commit through these at edit time (long
    // after boot), so they resolve to the shell's real implementations via window.SheetApp
    // even though ui.js loads first.
    const quietSave = () => window.SheetApp?.quietSave?.();
    const refreshDerived = () => window.SheetApp?.refreshDerived?.();

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

    // ---- small pure utils (parsers / formatters / escapers) ----
    const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
    const mod = (score) => Math.floor((Number(score) - 10) / 2);
    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    };
    // true only for non-empty arrays/objects (strings like 'N/A' don't count)
    const nonEmpty = (v) => Array.isArray(v) ? v.length > 0
        : Boolean(v && typeof v === 'object' && Object.keys(v).length > 0);
    const escapeHtml = (s) => String(s).replace(/[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function parseIntLoose(s, fallback = 0) {
        const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10);
        return Number.isFinite(n) ? n : fallback;
    }
    function fmtWeight(lbs) {
        if (lbs == null || !Number.isFinite(Number(lbs))) return '—';
        const n = Number(lbs);
        if (n === 0) return '0 lb';
        const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        return s + (Math.abs(n) === 1 ? ' lb' : ' lbs');
    }
    function fmtPrice(gp) {
        if (gp == null || !Number.isFinite(Number(gp))) return '—';
        const n = Number(gp);
        if (n === 0) return '0 gp';
        const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        return s + ' gp';
    }
    const foundry = (kind, name) => window.SheetDetails?.lookup(kind, name) ?? null;

    /** Escape HTML and wrap [[formula]] as .inline-roll chips (delegates to SheetRoll when ready). */
    function highlightInlineRolls(text) {
        if (window.SheetRoll?.highlightInlineRolls) {
            return window.SheetRoll.highlightInlineRolls(text);
        }
        // Fallback before tools init: same chip markup (+ expanded [[total¦formula]])
        const s = String(text || '');
        let out = '';
        let last = 0;
        const re = /\[\[([^\]]+)\]\]/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            out += escapeHtml(s.slice(last, m.index));
            const inner = String(m[1] || '').trim();
            const sep = inner.indexOf('¦');
            const display = sep >= 0 ? inner.slice(0, sep).trim() : inner;
            const formula = sep >= 0 ? inner.slice(sep + 1).trim() : inner;
            const title = formula && formula !== display
                ? `Rolled ${display} from ${formula}`
                : `Inline roll: ${display}`;
            out += `<span class="inline-roll" title="${escapeHtml(title)}">`
                + escapeHtml(display) + '</span>';
            last = re.lastIndex;
        }
        out += escapeHtml(s.slice(last));
        return out;
    }

    // ---- inline edit widgets (commit via the late-bound quietSave/refreshDerived above) ----
    function editableField(data, key, opts = {}) {
        const type = opts.type || 'text';
        const input = h('input', 'edit-field');
        input.type = type === 'number' ? 'number' : 'text';
        if (type === 'number') {
            if (opts.min != null) input.min = opts.min;
            if (opts.max != null) input.max = opts.max;
            if (opts.step != null) input.step = opts.step;
        }
        const raw = data[key];
        if (opts.asArray) {
            input.value = Array.isArray(raw) ? raw.join(', ') : (raw == null ? '' : String(raw));
        } else if (opts.format) {
            input.value = opts.format(raw);
        } else {
            input.value = raw == null ? '' : String(raw);
        }
        input.addEventListener('change', () => {
            let v = input.value;
            if (opts.asArray) {
                data[key] = v.split(',').map((s) => s.trim()).filter(Boolean);
            } else if (opts.parse) {
                data[key] = opts.parse(v);
            } else if (type === 'number') {
                const n = v === '' ? null : Number(v);
                data[key] = Number.isFinite(n) ? n : v;
            } else {
                data[key] = v;
            }
            opts.onChange?.(data[key], data);
            quietSave();
            refreshDerived();
        });
        // Live ability-mod updates without waiting for change blur
        if (opts.live) {
            input.addEventListener('input', () => {
                if (type === 'number') {
                    const n = input.value === '' ? null : Number(input.value);
                    if (Number.isFinite(n)) data[key] = n;
                }
                opts.live(data[key], data, input);
            });
        }
        return input;
    }

    function kvEdit(body, label, data, key, opts) {
        return kv(body, label, editableField(data, key, opts));
    }

    /**
     * Display value that becomes an input on double-click (Foundry-ish sheet feel).
     * Visual: plain text + hover hint; editing: outlined field. Commits on blur/Enter.
     */
    function dblclickEditable(data, key, opts = {}) {
        const wrap = h('span', 'dbl-edit');
        wrap.title = 'Double-click to edit';
        const display = h('span', 'dbl-edit-display');
        const input = editableField(data, key, {
            ...opts,
            onChange: (v, d) => {
                opts.onChange?.(v, d);
                exitEdit();
            },
        });
        input.classList.add('dbl-edit-input', 'edit-field');
        input.classList.add('hidden');

        function formatDisplay() {
            const raw = data[key];
            if (opts.format) {
                display.textContent = opts.format(raw) || '—';
            } else if (opts.asArray) {
                display.textContent = Array.isArray(raw) && raw.length
                    ? raw.join(', ')
                    : (raw == null || raw === '' ? '—' : String(raw));
            } else if (raw == null || raw === '') {
                display.textContent = '—';
            } else {
                display.textContent = String(raw);
            }
            if (opts.suffix && display.textContent !== '—') {
                display.textContent += opts.suffix;
            }
        }

        function enterEdit(e) {
            e?.preventDefault?.();
            if (wrap.classList.contains('is-editing')) return;
            wrap.classList.add('is-editing');
            display.classList.add('hidden');
            input.classList.remove('hidden');
            // Sync input from current data (may have changed)
            if (opts.asArray) {
                input.value = Array.isArray(data[key]) ? data[key].join(', ') : '';
            } else if (opts.format) {
                input.value = opts.format(data[key]) ?? '';
            } else {
                input.value = data[key] == null ? '' : String(data[key]);
            }
            input.focus();
            input.select?.();
        }

        function exitEdit() {
            wrap.classList.remove('is-editing');
            input.classList.add('hidden');
            display.classList.remove('hidden');
            formatDisplay();
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                // revert input without writing
                formatDisplay();
                if (opts.asArray) {
                    input.value = Array.isArray(data[key]) ? data[key].join(', ') : '';
                } else {
                    input.value = data[key] == null ? '' : String(data[key]);
                }
                exitEdit();
            }
            if (e.key === 'Enter' && input.type !== 'textarea') {
                e.preventDefault();
                input.blur(); // triggers change via editableField if value changed
                // If unchanged, still leave edit mode
                setTimeout(() => { if (wrap.classList.contains('is-editing')) exitEdit(); }, 0);
            }
        });
        input.addEventListener('blur', () => {
            // change event fires before blur when value changed; always leave edit UI
            setTimeout(() => { if (wrap.classList.contains('is-editing')) exitEdit(); }, 0);
        });

        wrap.addEventListener('dblclick', enterEdit);
        display.addEventListener('dblclick', enterEdit);

        formatDisplay();
        wrap.append(display, input);
        return wrap;
    }

    function kvDbl(body, label, data, key, opts) {
        return kv(body, label, dblclickEditable(data, key, opts));
    }

    // ---- generic drag-to-reorder ----
    function bindDragReorder(container, itemSelector, onReorder) {
        if (!container || container.dataset.dragBound === '1') return;
        container.dataset.dragBound = '1';
        let dragEl = null;

        container.querySelectorAll(itemSelector).forEach((el) => {
            el.classList.add('dnd-item');
            const handle = el.querySelector('.dnd-handle') || el;
            handle.setAttribute('draggable', 'true');

            const start = (e) => {
                dragEl = el;
                el.classList.add('is-dragging');
                try {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', el.dataset.dndId || 'x');
                } catch { /* */ }
            };
            const end = () => {
                el.classList.remove('is-dragging');
                container.querySelectorAll('.dnd-over').forEach((n) => n.classList.remove('dnd-over'));
                dragEl = null;
            };
            // Listen on handle (the draggable node) and on the row as fallback
            handle.addEventListener('dragstart', start);
            handle.addEventListener('dragend', end);
            el.addEventListener('dragstart', (e) => {
                if (e.target === handle || handle.contains(e.target)) start(e);
            });
            el.addEventListener('dragend', end);

            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragEl || dragEl === el) return;
                el.classList.add('dnd-over');
                try { e.dataTransfer.dropEffect = 'move'; } catch { /* */ }
            });
            el.addEventListener('dragleave', (e) => {
                if (!el.contains(e.relatedTarget)) el.classList.remove('dnd-over');
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.classList.remove('dnd-over');
                if (!dragEl || dragEl === el) return;
                const items = [...container.querySelectorAll(itemSelector)];
                const from = items.indexOf(dragEl);
                const to = items.indexOf(el);
                if (from < 0 || to < 0 || from === to) return;
                onReorder(from, to);
            });
        });
    }

    function reorderArray(arr, from, to) {
        if (!Array.isArray(arr) || from === to) return arr;
        if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        return arr;
    }

    function dndHandle() {
        const el = h('span', 'dnd-handle no-print', '⋮⋮');
        el.title = 'Drag to reorder';
        el.setAttribute('draggable', 'true');
        return el;
    }

    // Shallow-normalize a pf1 `changes` array into fresh plain objects (used by buffs, inventory
    // items, and item sheets — anywhere a change list is copied rather than referenced).
    function cloneChanges(list) {
        return (list || []).map((c) => ({
            formula: c.formula,
            target: c.target,
            type: c.type || 'untyped',
            operator: c.operator || 'add',
            priority: c.priority || 0,
        }));
    }

    return {
        h, htmlBlock, details, section, emptyState, compose, wrapWideTables,
        fmt, termHint, kLabel, kv, kvStat, attachStatHint,
        spCell, spHeading, spBoxBig, spTable,
        titleCase, mod, toInt, nonEmpty, escapeHtml, parseIntLoose, fmtWeight, fmtPrice,
        foundry, highlightInlineRolls,
        editableField, kvEdit, dblclickEditable, kvDbl,
        bindDragReorder, reorderArray, dndHandle, cloneChanges,
    };
})();
