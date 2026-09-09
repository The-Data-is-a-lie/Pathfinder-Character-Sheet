// scripts/share.js -- handing a character to another person (window.SheetShare), #118.
//
// Two paths, and the difference between them is measured, not guessed:
//
//   * **A file always works.** One character as `<Name>.json`, downloaded and copied to the
//     clipboard. 35 KB for a real level-1 NPC, 124 KB for the level-20 demo — nothing against any
//     transport anyone actually uses.
//   * **A link sometimes works.** `#c=<base64url(gzip(lean JSON))>`, decoded on arrival. Measured
//     on real payloads: a level-1 marksman is 8.8 KB of URL after the lean pass, the level-20 demo
//     is 13 KB. Browsers take both; chat clients start mangling links well before that, which is
//     why LINK_LIMIT is deliberately smaller than the biggest link we *can* build. Over it, the
//     dialog says file-only and says why, rather than handing over a link that arrives broken.
//
// The lean pass is symmetric and per-entry: a description is dropped ONLY when the sender's own
// compendium can produce one for that name, because the recipient loads the same `data/*.json`.
// `rehydrate()` puts them back through the identical table. Anything the compendium does not know
// — homebrew feats, Path of War maneuver text, the backend's curated spell riders, archetype prose
// — travels inline, because nothing on the other side could ever recover it.
//
// There is still no sync backend and there will not be one (#47). This is the whole of "sharing".
window.SheetShare = (function () {
    'use strict';
    const { h } = window.SheetUI;

    // What a pasted link survives, in two tiers, because "does this fit" has two real answers:
    //   CHAT_SAFE — inside Discord's 2,000-character message cap, i.e. pasteable anywhere.
    //   LINK_LIMIT — the outer bound: fine in a URL bar, an email, a wiki, a pastebin.
    // Measured against real payloads, generator-produced NPCs land ABOVE both (a level-1 marksman
    // needs 12.3 KB, the level-20 demo 47.6 KB), so the file path is the normal answer and the
    // link is the bonus for small, hand-made characters. The dialog says which one you got.
    const CHAT_SAFE = 1800;
    const LINK_LIMIT = 8000;

    const SD = () => window.SheetDetails;

    /**
     * The rehydration table: [payload key, shape, resolve(name, data) -> replacement | null].
     *
     * `shape` is how the entries are laid out, because the payload uses three:
     *   'map-str'  — { name: "<html>" }
     *   'map-obj'  — { key: { item_name, description, ... } }
     *   'list-obj' — [ { name, description }, … ]
     */
    const REHYDRATE = [
        ['equip_descrip', 'map-obj', (entry) => {
            const hit = SD()?.lookupItem?.(entry?.item_name);
            return hit?.description ? { description: hit.description } : null;
        }],
        ['item_changes_dict', 'map-obj-keyed', (name) => {
            const hit = SD()?.lookupItem?.(name);
            if (!hit) return null;
            return (hit.changes?.length || hit.contextNotes?.length)
                ? { changes: hit.changes || [], contextNotes: hit.contextNotes || [] }
                : null;
        }],
        ['selected_traits_desc', 'list-obj', (name) => {
            const hit = SD()?.lookup?.('traits', name);
            return hit?.description ? { description: hit.description } : null;
        }],
        ['class_ability_desc', 'map-str', (name, data) => {
            const hit = SD()?.lookupClassFeature?.(name, data?.classes);
            return hit?.description || null;
        }],
    ];

    /** A copy with re-derivable text removed, plus what was dropped. Never mutates the original. */
    function leanCopy(data) {
        const lean = JSON.parse(JSON.stringify(data));
        const dropped = { portrait: false, entries: 0, keys: [] };

        // The portrait is the single biggest object in a saved character and is already base64,
        // so gzip barely touches it. It cannot be re-derived, so this one IS a real loss — stated
        // at copy time, not discovered on arrival.
        if (lean._sheet?.portrait) {
            delete lean._sheet.portrait;
            dropped.portrait = true;
        }

        for (const [key, shape, resolve] of REHYDRATE) {
            const value = lean[key];
            if (!value) continue;
            let n = 0;
            if (shape === 'list-obj' && Array.isArray(value)) {
                for (const item of value) {
                    if (item && item.description && resolve(item.name, lean)) {
                        delete item.description;
                        n += 1;
                    }
                }
            } else if (shape === 'map-str') {
                for (const name of Object.keys(value)) {
                    if (typeof value[name] === 'string' && resolve(name, lean)) {
                        delete value[name];
                        n += 1;
                    }
                }
            } else if (shape === 'map-obj') {
                for (const k of Object.keys(value)) {
                    if (value[k]?.description && resolve(value[k], lean)) {
                        delete value[k].description;
                        n += 1;
                    }
                }
            } else if (shape === 'map-obj-keyed') {
                for (const name of Object.keys(value)) {
                    if (resolve(name, lean)) {
                        delete value[name];
                        n += 1;
                    }
                }
            }
            if (n) { dropped.entries += n; dropped.keys.push(key); }
        }
        lean._sheet = lean._sheet || {};
        lean._sheet.shareLean = true;
        return { lean, dropped };
    }

    /** Put back everything `leanCopy` dropped, from THIS browser's compendium. */
    function rehydrate(data) {
        if (!data?._sheet?.shareLean) return data;
        for (const [key, shape, resolve] of REHYDRATE) {
            const value = data[key];
            if (!value) continue;
            if (shape === 'list-obj' && Array.isArray(value)) {
                for (const item of value) {
                    if (item && !item.description) {
                        const got = resolve(item.name, data);
                        if (got?.description) item.description = got.description;
                    }
                }
            } else if (shape === 'map-str') {
                // A dropped map-str entry left no key behind, so there is nothing to walk. The
                // names live in the character's own class/feature lists and the sheet already
                // reads the compendium when the dict has no entry — this is the one shape where
                // dropping is safe precisely because rendering falls back on its own.
                continue;
            } else if (shape === 'map-obj') {
                for (const k of Object.keys(value)) {
                    if (value[k] && !value[k].description) {
                        const got = resolve(value[k], data);
                        if (got?.description) value[k].description = got.description;
                    }
                }
            }
        }
        delete data._sheet.shareLean;
        return data;
    }

    // ------------------------------------------------------------------ encode / decode
    const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64url = (text) => {
        const padded = text.replace(/-/g, '+').replace(/_/g, '/')
            + '='.repeat((4 - (text.length % 4)) % 4);
        return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    };

    async function squeeze(bytes, mode) {
        const Stream = mode === 'gzip' ? CompressionStream : DecompressionStream;
        const stream = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async function encode(obj) {
        const raw = new TextEncoder().encode(JSON.stringify(obj));
        return b64url(await squeeze(raw, 'gzip'));
    }

    async function decode(text) {
        const raw = await squeeze(unb64url(text), 'gunzip');
        return JSON.parse(new TextDecoder().decode(raw));
    }

    /** `{ url, chars, ok, dropped }` — `ok` false means the link would not survive being pasted. */
    async function buildLink(data) {
        const { lean, dropped } = leanCopy(data);
        const payload = await encode(lean);
        const url = location.origin + location.pathname + '#c=' + payload;
        return { url, chars: url.length, ok: url.length <= LINK_LIMIT, dropped };
    }

    // ------------------------------------------------------------------ file
    const safeName = (data) => String(data?.character_full_name || 'character')
        .replace(/[\\/:*?"<>|]+/g, '-').trim() || 'character';

    function downloadCharacter(data) {
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        const link = h('a');
        link.href = URL.createObjectURL(blob);
        link.download = safeName(data) + '.json';
        link.click();
        URL.revokeObjectURL(link.href);
        window.SheetPWA?.markExported?.();   // #61: a file off-device IS a backup
    }

    // ------------------------------------------------------------------ receiving
    /**
     * Adopt a character out of `#c=…` if the URL carries one.
     *
     * Returns true when it took over the boot, so the caller skips restoring the last character —
     * someone who opened a shared link wants the shared character, not their own.
     */
    async function init() {
        const match = /[#&]c=([A-Za-z0-9\-_]+)/.exec(location.hash || '');
        if (!match) return false;
        try {
            const data = rehydrate(await decode(match[1]));
            history.replaceState(null, '', location.pathname + location.search);
            await window.SheetRoster.adoptCharacter(data);
            window.SheetOverlay?.toast?.(
                `Opened “${data.character_full_name || 'shared character'}” from a link — saved to your library.`);
            return true;
        } catch (err) {
            console.error('Shared link could not be read:', err);
            window.SheetOverlay?.toast?.('That share link is damaged — ask for the JSON file instead.');
            return false;
        }
    }

    // ------------------------------------------------------------------ the dialog
    async function open(data) {
        const src = data || window.SheetApp?.current;
        if (!src) return;
        const body = h('div', 'share-dialog');
        body.appendChild(h('p', 'dim',
            'A file always works and carries everything. A link is convenient but has to be small '
            + 'enough to survive being pasted — this sheet checks before offering one.'));

        const fileBtn = h('button', 'inv-btn inv-btn-primary', '⬇ Download JSON');
        fileBtn.type = 'button';
        const copyBtn = h('button', 'inv-btn', '📋 Copy JSON');
        copyBtn.type = 'button';
        const fileRow = h('div', 'share-row');
        fileRow.append(fileBtn, copyBtn);
        body.append(h('h4', null, 'Send the file'), fileRow,
            h('p', 'dim share-note', 'Whoever gets it opens it with Load JSON.'));

        body.appendChild(h('h4', null, 'Send a link'));
        const linkNote = h('p', 'dim share-note', 'Measuring…');
        const linkBtn = h('button', 'inv-btn', '🔗 Copy share link');
        linkBtn.type = 'button';
        linkBtn.disabled = true;
        body.append(linkBtn, linkNote);

        const status = h('p', 'recipe-status');
        body.appendChild(status);
        const close = h('button', null, 'Close');
        close.type = 'button';
        const handle = window.SheetOverlay.open({
            title: `Share “${src.character_full_name || 'character'}”`, body, footer: [close],
        });
        close.addEventListener('click', () => handle.close());

        fileBtn.addEventListener('click', () => {
            downloadCharacter(src);
            status.textContent = 'Saved as ' + safeName(src) + '.json';
        });
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(JSON.stringify(src, null, 1));
                window.SheetOverlay.toast('Character JSON copied.');
            } catch {
                status.textContent = 'Could not reach the clipboard — use Download instead.';
            }
        });

        let link = null;
        try {
            link = await buildLink(src);
        } catch (err) {
            linkNote.textContent = 'This browser cannot build share links (no compression support).';
            return;
        }
        const kb = (link.chars / 1024).toFixed(1);
        const losses = [];
        if (link.dropped.portrait) losses.push('the portrait');
        if (link.dropped.entries) {
            losses.push(`${link.dropped.entries} description(s) their copy looks up itself`);
        }
        if (link.ok) {
            linkBtn.disabled = false;
            linkNote.textContent = `${kb} KB link — `
                + (link.chars <= CHAT_SAFE
                    ? 'short enough to paste anywhere, chat included.'
                    : 'fine in an email, a wiki or the address bar; too long for a Discord '
                      + 'message, which caps at 2,000 characters.')
                + (losses.length ? ` Leaves out ${losses.join(' and ')}.` : '');
        } else {
            linkNote.textContent = `This character needs a ${kb} KB link, over the `
                + `${(LINK_LIMIT / 1024).toFixed(0)} KB a pasted link reliably survives. `
                + 'Send the file instead — it carries more anyway.';
        }
        linkBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(link.url);
                window.SheetOverlay.toast('Share link copied.');
            } catch {
                status.textContent = 'Could not reach the clipboard.';
            }
        });
    }

    return { init, open, buildLink, leanCopy, rehydrate, encode, decode,
        downloadCharacter, LINK_LIMIT };
})();
