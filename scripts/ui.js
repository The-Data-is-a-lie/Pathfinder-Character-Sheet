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

    // ---- generic drag-to-reorder (pointer-based: mouse, touch and pen) ----
    //
    // This replaces an HTML5 `dataTransfer` implementation that never fired on touch, which
    // meant every reorderable list on the sheet was silently desktop-only — not a defensible
    // state for a sheet whose stated audience is a classroom on tablets. Pointer events cover
    // mouse, touch and pen through one path, and the hold-then-drag threshold is the same one
    // edgepanel.js uses so a tap on the grip can't become an accidental move.
    //
    // Scrolling is preserved by scoping `touch-action: none` to the grip alone (see the
    // .dnd-handle rule in sheet.css) — dragging the row body still scrolls the page normally.
    //
    // Lists opt into exchanging rows by sharing a `group`; `canAccept` has the final say. That
    // is the seam where "a drop is a shortcut for an edit you could already make in the detail
    // sheet" gets enforced, so a refused drop springs back instead of corrupting data.

    const DRAG_START = 5;      // px of movement before a press on the grip becomes a drag
    const EDGE = 56;           // distance from a viewport edge that starts auto-scrolling
    // Per SECOND, not per frame. It used to be 16px/frame, which is ~960px/s on a 60Hz panel
    // and ~2300px/s on a 144Hz one — the same gesture flung the page at wildly different
    // speeds depending on the monitor, and on a fast one it read as the page bolting.
    const EDGE_SPEED = 500;
    const EDGE_MAX_DT = 0.05;  // s — a hitched frame must not teleport the page
    let drag = null;           // the one in-flight drag, if any
    let edgeRAF = null;
    let edgeLast = 0;          // rAF timestamp of the previous edge-scroll frame

    // HTML5 drag-and-drop auto-scrolled the page for free; pointer drags do not, and these
    // lists run long (a level-20 character has ~70 feats), so without this a row simply
    // cannot be dragged past the fold.
    function edgeScroll(now) {
        if (!drag || !drag.started) { edgeRAF = null; edgeLast = 0; return; }
        const dt = edgeLast ? Math.min((now - edgeLast) / 1000, EDGE_MAX_DT) : 0;
        edgeLast = now;
        const y = drag.lastY;
        let dy = 0;
        if (y < EDGE) dy = -EDGE_SPEED * (1 - y / EDGE) * dt;
        else if (y > window.innerHeight - EDGE) {
            dy = EDGE_SPEED * (1 - (window.innerHeight - y) / EDGE) * dt;
        }
        if (dy) {
            window.scrollBy(0, dy);
            paintTarget(dropTargetAt(drag.lastX, drag.lastY));
        }
        edgeRAF = requestAnimationFrame(edgeScroll);
    }

    /**
     * Run `mutate` (which is expected to change layout) and scroll by however much `row`
     * moved, so the row ends up back under the pointer. Reading the rect either side forces
     * the two layouts we need; the try/catch is for a row detached mid-gesture.
     */
    function anchorRow(row, mutate) {
        let before = 0;
        try { before = row.getBoundingClientRect().top; } catch { mutate(); return; }
        mutate();
        try {
            const after = row.getBoundingClientRect().top;
            if (after !== before) window.scrollBy(0, after - before);
        } catch { /* row went away — nothing to anchor to */ }
    }

    function listOf(el, group) {
        if (!el) return null;
        return group
            ? el.closest('[data-dnd-group="' + group + '"]')
            : el.closest('[data-dnd-list="1"]');
    }

    // Callers pass either a bare selector ('.feat-item') or an already-scoped one
    // (':scope > .inv-item', which inventory uses to keep contained child items out of the
    // drag). Normalize to the bare form: `:scope` is invalid inside closest(), and doubling
    // the prefix would throw on querySelectorAll.
    function bareSelector(sel) {
        return String(sel).replace(/^\s*:scope\s*>\s*/, '');
    }

    function rowsIn(list, rowSel) {
        // Direct children only, so a nested list's rows are never claimed by its parent
        // (inventory containers hold their contents inside the row they belong to).
        return [...list.querySelectorAll(':scope > ' + rowSel)];
    }

    function clearMarks() {
        document.querySelectorAll('.dnd-indicator').forEach((n) => n.remove());
        document.querySelectorAll('.dnd-refuse').forEach((n) => n.classList.remove('dnd-refuse'));
    }

    // Where would a release right now put the row? Returns null when the pointer is over no
    // eligible list, or over one that refuses this row.
    function dropTargetAt(x, y) {
        if (!drag) return null;
        // elementFromPoint is viewport-relative and returns null outside it, so a pointer
        // dragged past an edge would otherwise lose its target mid-gesture.
        const cx = Math.max(0, Math.min(window.innerWidth - 1, x));
        const cy = Math.max(0, Math.min(window.innerHeight - 1, y));
        const under = document.elementFromPoint(cx, cy);
        const list = listOf(under, drag.group);
        if (!list) return null;
        if (list !== drag.list && !drag.canAccept(list, drag.row)) return { list, refused: true };

        const rows = rowsIn(list, drag.rowSel).filter((r) => r !== drag.row);
        const over = under.closest(drag.rowSel);
        let insertAt = rows.length;
        if (over && rows.includes(over)) {
            const box = over.getBoundingClientRect();
            const after = cy > box.top + box.height / 2;
            insertAt = rows.indexOf(over) + (after ? 1 : 0);
        }
        return { list, insertAt, refused: false };
    }

    function paintTarget(t) {
        clearMarks();
        if (!t || !drag) return;
        if (t.refused) { t.list.classList.add('dnd-refuse'); return; }
        // Resolve the anchor node *after* clearMarks, never before: the previous frame's
        // indicator is often exactly the node sitting at this position, and inserting
        // before a node that clearMarks has just detached throws.
        const rows = rowsIn(t.list, drag.rowSel).filter((r) => r !== drag.row);
        const line = h('div', 'dnd-indicator');
        const anchor = rows[t.insertAt] || null;
        if (anchor) t.list.insertBefore(line, anchor);
        else t.list.appendChild(line);
    }

    function endDrag(commit, x, y) {
        if (!drag) return;
        const d = drag;
        const target = commit ? dropTargetAt(x, y) : null;
        drag = null;
        if (edgeRAF) { cancelAnimationFrame(edgeRAF); edgeRAF = null; }
        edgeLast = 0;

        clearMarks();
        d.row.classList.remove('is-dragging');
        // The mirror of the reveal in onDragMove: dropping collapses every empty-group strip
        // again, so without this the page snaps back up by the height it grew at drag start.
        anchorRow(d.row, () => document.body.classList.remove('dnd-dragging'));
        document.removeEventListener('selectstart', blockSelect);
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        window.removeEventListener('pointercancel', onDragCancel);
        try { d.handle.releasePointerCapture(d.pointerId); } catch { /* */ }

        if (!target || target.refused) return;         // springs back
        const sameList = target.list === d.list;
        const fromIndex = d.fromIndex;
        // dropTargetAt measures the insertion point against the list *without* the dragged
        // row, which is precisely the array reorderArray sees after its splice-out. So this
        // needs no adjustment in either direction — and callers keep the (from, to)
        // convention they already pass straight into reorderArray.
        const toIndex = target.insertAt;
        if (sameList && toIndex === fromIndex) return;

        d.onDrop({
            row: d.row,
            sameList,
            fromIndex,
            toIndex,
            fromSection: d.list.dataset.dndSection ?? null,
            toSection: target.list.dataset.dndSection ?? null,
            fromList: d.list,
            toList: target.list,
        });
    }

    const blockSelect = (e) => e.preventDefault();
    const onDragMove = (e) => {
        if (!drag) return;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.started) {
            if (Math.abs(e.clientY - drag.startY) < DRAG_START
                && Math.abs(e.clientX - drag.startX) < DRAG_START) return;
            drag.started = true;
            drag.row.classList.add('is-dragging');
            // `dnd-dragging` reveals the empty-group drop strips (see the .is-empty rules in
            // sheet.css). On a character with several empty feat groups that injects a few
            // hundred px of layout, much of it ABOVE the row being dragged, so the row —
            // and the whole page with it — lurches down under a stationary finger. Measure
            // the row across the class change and give the scroll position back what the
            // reveal took, which pins the row where the pointer grabbed it.
            anchorRow(drag.row, () => document.body.classList.add('dnd-dragging'));
            document.addEventListener('selectstart', blockSelect);
            window.getSelection?.()?.removeAllRanges?.();
            try { drag.handle.setPointerCapture(drag.pointerId); } catch { /* */ }
            edgeLast = 0;
            if (!edgeRAF) edgeRAF = requestAnimationFrame(edgeScroll);
        }
        e.preventDefault();
        paintTarget(dropTargetAt(e.clientX, e.clientY));
    };
    const onDragUp = (e) => endDrag(drag?.started === true, e.clientX, e.clientY);
    const onDragCancel = () => endDrag(false, 0, 0);

    /**
     * @param {object} opts
     * @param {HTMLElement} opts.container      the element holding the rows
     * @param {string} opts.itemSelector        selector matching one row
     * @param {string} [opts.group]             lists sharing a group can exchange rows
     * @param {string} [opts.sectionId]         reported back as from/toSection
     * @param {(list: HTMLElement, row: HTMLElement) => boolean} [opts.canAccept]
     * @param {(move: object) => void} opts.onDrop
     */
    function bindDragList(opts) {
        const {
            container, itemSelector, group = null, sectionId = null,
            canAccept = () => false, onDrop,
        } = opts;
        if (!container || container.dataset.dndBound === '1') return;
        const rowSel = bareSelector(itemSelector);
        container.dataset.dndBound = '1';
        container.dataset.dndList = '1';
        if (group) container.dataset.dndGroup = group;
        if (sectionId != null) container.dataset.dndSection = sectionId;

        // Delegated, so rows rebuilt by the next renderSheet are covered with no rebinding.
        container.addEventListener('pointerdown', (e) => {
            if (drag || (e.button != null && e.button > 0)) return;
            const handle = e.target.closest('.dnd-handle');
            if (!handle || !container.contains(handle)) return;
            const row = handle.closest(rowSel);
            if (!row || row.parentElement !== container) return;
            drag = {
                row, handle, container, rowSel, group, onDrop, canAccept,
                list: container,
                fromIndex: rowsIn(container, rowSel).indexOf(row),
                pointerId: e.pointerId,
                startX: e.clientX, startY: e.clientY,
                started: false,
            };
            window.addEventListener('pointermove', onDragMove);
            window.addEventListener('pointerup', onDragUp);
            window.addEventListener('pointercancel', onDragCancel);
        });

        // Keyboard equivalent of the drag: the grip is focusable and arrows move the row
        // within its list. Moving a row to a *different* section by keyboard goes through the
        // row's detail sheet, which is the same edit the drop performs.
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const handle = e.target.closest?.('.dnd-handle');
            if (!handle || !container.contains(handle)) return;
            const row = handle.closest(rowSel);
            if (!row || row.parentElement !== container) return;
            const rows = rowsIn(container, rowSel);
            const from = rows.indexOf(row);
            const to = from + (e.key === 'ArrowUp' ? -1 : 1);
            if (from < 0 || to < 0 || to >= rows.length) return;
            e.preventDefault();
            onDrop({
                row, sameList: true, fromIndex: from, toIndex: to,
                fromSection: sectionId, toSection: sectionId,
                fromList: container, toList: container,
                viaKeyboard: true,
            });
        });
    }

    // Back-compat wrapper: the original three-argument form, now pointer-driven. Reorder-only,
    // no cross-list moves, `to` in the same reorderArray convention callers already pass on.
    function bindDragReorder(container, itemSelector, onReorder) {
        return bindDragList({
            container,
            itemSelector,
            onDrop: ({ fromIndex, toIndex }) => {
                if (fromIndex !== toIndex) onReorder(fromIndex, toIndex);
            },
        });
    }

    function reorderArray(arr, from, to) {
        if (!Array.isArray(arr) || from === to) return arr;
        if (from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        return arr;
    }

    function dndHandle(label) {
        const el = h('span', 'dnd-handle no-print', '⋮⋮');
        el.title = label || 'Drag to reorder (or focus and press ↑ / ↓)';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', label || 'Reorder — press up or down arrow to move');
        return el;
    }

    // Shallow-normalize a pf1 `changes` array into fresh plain objects (used by buffs, inventory
    // items, and item sheets — anywhere a change list is copied rather than referenced).
    function cloneChanges(list) {
        return (list || []).map((c) => {
            const out = {
                formula: c.formula,
                target: c.target,
                type: c.type || 'untyped',
                operator: c.operator || 'add',
                priority: c.priority || 0,
            };
            // Which attack d20 the change rides (see details.js pushEntry). This whitelist is
            // what every change list is rebuilt through, so a field missing here is silently
            // dropped on load no matter where it was authored. Only carried when narrowed, so
            // ordinary changes stay byte-identical.
            if (c.appliesOn && c.appliesOn !== 'both') out.appliesOn = c.appliesOn;
            return out;
        });
    }

    return {
        h, htmlBlock, details, section, emptyState, compose, wrapWideTables,
        fmt, termHint, kLabel, kv, kvStat, attachStatHint,
        spCell, spHeading, spBoxBig, spTable,
        titleCase, mod, toInt, nonEmpty, escapeHtml, parseIntLoose, fmtWeight, fmtPrice,
        foundry, highlightInlineRolls,
        editableField, kvEdit, dblclickEditable, kvDbl,
        bindDragReorder, bindDragList, reorderArray, dndHandle, cloneChanges,
    };
})();
