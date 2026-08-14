// Shared rich-text description editor (#106): a rendered, directly-editable HTML surface
// with a small formatting toolbar and a raw-HTML escape hatch. No dependencies — the
// toolbar rides document.execCommand, which is deprecated-but-universal and the only
// dependency-free way to get inline formatting in a contenteditable.
//
// Every override description this produces is re-rendered later via innerHTML (htmlBlock),
// so sanitize() is the security boundary: commit never stores script/style/iframe tags,
// on* attributes, or javascript: URLs.

window.SheetRichText = (function () {
    'use strict';

    const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM',
        'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE']);

    /** Strip active content from an HTML string; returns markup safe for innerHTML. */
    function sanitize(html) {
        const doc = document.implementation.createHTMLDocument('');
        doc.body.innerHTML = String(html ?? '');
        const walk = (node) => {
            for (const el of [...node.children]) {
                if (BLOCKED_TAGS.has(el.tagName)) {
                    el.remove();
                    continue;
                }
                for (const attr of [...el.attributes]) {
                    const name = attr.name.toLowerCase();
                    const val = String(attr.value || '');
                    if (name.startsWith('on')
                        || ((name === 'href' || name === 'src' || name === 'xlink:href')
                            && /^\s*(?:javascript|data|vbscript):/i.test(val))) {
                        el.removeAttribute(attr.name);
                    }
                }
                walk(el);
            }
        };
        walk(doc.body);
        return doc.body.innerHTML;
    }

    function toolButton(label, title, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rt-btn';
        b.innerHTML = label;
        b.title = title;
        // mousedown + preventDefault keeps the contenteditable selection alive — a click
        // would blur the surface first and execCommand would land on nothing.
        b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onClick();
        });
        return b;
    }

    /**
     * Build the editor. Returns { el, getHtml, setHtml, focus }.
     *   html      initial HTML (rendered into the editable surface)
     *   onCommit  called with sanitized HTML on blur and (debounced) on input
     *   placeholder  hint shown while empty
     */
    function richTextEditor(opts = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'rt-editor';

        const bar = document.createElement('div');
        bar.className = 'rt-toolbar no-print';
        const surface = document.createElement('div');
        surface.className = 'rt-surface item-desc-body';
        surface.contentEditable = 'true';
        surface.dataset.placeholder = opts.placeholder || 'Description…';
        surface.innerHTML = sanitize(opts.html || '');

        const raw = document.createElement('textarea');
        raw.className = 'edit-field rt-raw';
        raw.rows = 10;
        raw.style.display = 'none';
        raw.spellcheck = false;

        const exec = (cmd, arg = null) => {
            surface.focus();
            try { document.execCommand(cmd, false, arg); } catch { /* unsupported */ }
            scheduleCommit();
        };

        bar.append(
            toolButton('<b>B</b>', 'Bold', () => exec('bold')),
            toolButton('<i>I</i>', 'Italic', () => exec('italic')),
            toolButton('H', 'Heading', () => exec('formatBlock', '<h3>')),
            toolButton('¶', 'Paragraph', () => exec('formatBlock', '<p>')),
            toolButton('•', 'Bullet list', () => exec('insertUnorderedList')),
            toolButton('1.', 'Numbered list', () => exec('insertOrderedList')),
            toolButton('🔗', 'Link', () => {
                const url = prompt('Link URL:');
                if (url && !/^\s*(?:javascript|data|vbscript):/i.test(url)) {
                    exec('createLink', url);
                }
            }),
            toolButton('⌫', 'Clear formatting', () => exec('removeFormat')),
        );
        const rawBtn = toolButton('&lt;/&gt;', 'Edit raw HTML', () => toggleRaw());
        rawBtn.classList.add('rt-btn-raw');
        bar.appendChild(rawBtn);

        let rawMode = false;
        function toggleRaw() {
            rawMode = !rawMode;
            rawBtn.classList.toggle('is-on', rawMode);
            if (rawMode) {
                raw.value = surface.innerHTML;
                surface.style.display = 'none';
                raw.style.display = '';
                raw.focus();
            } else {
                surface.innerHTML = sanitize(raw.value);
                raw.style.display = 'none';
                surface.style.display = '';
                scheduleCommit();
            }
        }

        let timer = null;
        const commit = () => {
            clearTimeout(timer);
            timer = null;
            opts.onCommit?.(getHtml());
        };
        const scheduleCommit = () => {
            clearTimeout(timer);
            timer = setTimeout(commit, 600);
        };

        surface.addEventListener('input', scheduleCommit);
        surface.addEventListener('blur', commit);
        raw.addEventListener('input', scheduleCommit);
        raw.addEventListener('blur', () => {
            surface.innerHTML = sanitize(raw.value);
            commit();
        });

        function getHtml() {
            const html = rawMode ? raw.value : surface.innerHTML;
            const clean = sanitize(html);
            // An empty editing surface leaves "<p><br></p>" / "<br>" husks behind —
            // normalize those to '' so "no description" round-trips as absent.
            const probe = document.createElement('div');
            probe.innerHTML = clean;
            return probe.textContent.trim() || probe.querySelector('img') ? clean : '';
        }
        function setHtml(html) {
            surface.innerHTML = sanitize(html || '');
            if (rawMode) raw.value = surface.innerHTML;
        }

        wrap.append(bar, surface, raw);
        return { el: wrap, getHtml, setHtml, focus: () => surface.focus() };
    }

    return { richTextEditor, sanitize };
})();
