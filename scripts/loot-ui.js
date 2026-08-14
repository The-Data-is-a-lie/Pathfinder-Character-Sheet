// scripts/loot-ui.js -- the treasure dialog (window.SheetLootUI), #81.
//
// The backend owns the numbers (POST /generate_loot -> coins + gems + items against a CR budget);
// this file owns the dialog and the one thing the backend cannot do: putting the parcel into a
// character. Everything here is deploy-independent, which is the whole design of the ticket:
//
//   * The 💰 button starts HIDDEN and is revealed only if `GET /generate_loot` answers. Against a
//     backend without the endpoint the probe 404s and the button never appears — so this file can
//     merge and ship long before the backend deploy, and starts working the moment it lands with
//     no second release here.
//   * The probe runs ONCE per session and is cached as a promise, so ten dialog opens are one
//     request. It is a GET against a limiter-exempt route that generates nothing.
//
// The target character is deliberately ANY character in the library, not just the open one: a GM
// rolling loot is usually filling a party-loot holder or a specific NPC, and the sheet had no
// "write to a character I am not looking at" path before this. That path is
// SheetLibrary.get -> mutate -> SheetLibrary.save; SheetRoster.saveCurrent is only correct when
// the target IS the open character, because it writes window.SheetApp.current over whatever the
// library holds.
window.SheetLootUI = (function () {
    'use strict';
    const { h } = window.SheetUI;

    const backend = () => (window.SheetApp?.backendUrl?.() || '').replace(/\/+$/, '');
    const fmtGp = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString();

    // ------------------------------------------------------------------ feature detection
    let probePromise = null;
    function probe() {
        if (probePromise) return probePromise;
        probePromise = (async () => {
            try {
                const resp = await fetch(backend() + '/generate_loot', { method: 'GET' });
                if (!resp.ok) return null;
                const caps = await resp.json();
                return caps && caps.ok ? caps : null;
            } catch {
                // Offline, CORS, DNS — all of them mean "cannot offer this right now", and none of
                // them are worth a console error on a page that works fine without treasure.
                return null;
            }
        })();
        return probePromise;
    }

    /** Reveal the topbar button iff the backend can actually roll treasure. */
    async function init() {
        const btn = document.getElementById('gen-loot');
        if (!btn) return;
        const caps = await probe();
        if (caps) {
            btn.hidden = false;
            btn.dataset.crMax = String(caps.cr?.[1] ?? 20);
        }
    }

    async function rollLoot(cr, speed) {
        const resp = await fetch(backend() + '/generate_loot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cr, speed }),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const parcel = await resp.json();
        if (parcel.error) throw new Error(parcel.error);
        return parcel;
    }

    // ------------------------------------------------------------------ putting it somewhere
    /** Gems have no sheet concept, so they land as ordinary valuables — carried, never equipped. */
    const gemItemName = (gem) => `${gem.name} (gem)`;

    function addParcelTo(data, parcel, picks) {
        const IM = window.SheetInventoryModel;
        IM.normalizeCurrency(data);
        const coins = parcel.coins || {};
        if (picks.coins) {
            data.platinum = (Number(data.platinum) || 0) + (Number(coins.pp) || 0);
            data.gold = (Number(data.gold) || 0) + (Number(coins.gp) || 0);
            data.silver = (Number(data.silver) || 0) + (Number(coins.sp) || 0);
            data.copper = (Number(data.copper) || 0) + (Number(coins.cp) || 0);
        }
        let seq = 0;
        const place = (name, price, weight, slot) => {
            const item = IM.addInventoryItem(data, name);
            if (!item) return;
            // addInventoryItem stamps ids from Date.now(), so a loop adding six items in the same
            // millisecond hands them all the same id. Same collision #93 hit with buffs.
            seq += 1;
            item.id += '-' + seq;
            // Found treasure is in the sack, not strapped on. Equipping it would silently move the
            // character's AC and attack numbers the moment loot is added.
            item.equipped = false;
            item.carried = true;
            if (item.price == null && price != null) item.price = Number(price);
            if (item.weight == null && weight != null) item.weight = Number(weight);
            if (!item.slot && slot) item.slot = slot;
        };
        for (const gem of picks.gems) place(gemItemName(gem), gem.value, 0, '');
        for (const it of picks.items) place(it.name, it.price, it.weight, it.slot);
    }

    /**
     * Write a parcel into any library character.
     *
     * Two paths on purpose: the open character must go through the roster (its in-memory object is
     * the authority and a library write would be overwritten by the next auto-save), and any other
     * character is a plain library read/mutate/write that never touches the open sheet.
     */
    async function commit(targetId, parcel, picks) {
        const open = window.SheetApp?.current;
        if (open && open._sheet?.id === targetId) {
            addParcelTo(open, parcel, picks);
            await window.SheetRoster.saveCurrent({ quiet: true });
            window.SheetApp.renderSheet(open);
            return open.character_full_name || 'this character';
        }
        const rec = await window.SheetLibrary.get(targetId);
        if (!rec?.data) throw new Error('that character is no longer in the library');
        addParcelTo(rec.data, parcel, picks);
        await window.SheetLibrary.save(rec.data);
        await window.SheetRoster.refreshRoster();
        return rec.name || 'that character';
    }

    function asText(parcel) {
        const lines = [`Treasure — CR ${parcel.cr}, ${parcel.speed} track (${fmtGp(parcel.value)} gp)`];
        const c = parcel.coins || {};
        const coinBits = [[c.pp, 'pp'], [c.gp, 'gp'], [c.sp, 'sp'], [c.cp, 'cp']]
            .filter(([n]) => Number(n) > 0).map(([n, unit]) => `${Number(n).toLocaleString()} ${unit}`);
        if (coinBits.length) lines.push('Coins: ' + coinBits.join(', '));
        for (const gem of parcel.gems || []) lines.push(`${gem.name} — ${fmtGp(gem.value)} gp`);
        for (const it of parcel.items || []) lines.push(`${it.name} — ${fmtGp(it.price)} gp`);
        return lines.join('\n');
    }

    // ------------------------------------------------------------------ the dialog
    async function open() {
        const caps = await probe();
        if (!caps) {
            window.SheetOverlay.toast('The backend does not offer treasure generation yet.');
            return;
        }
        const crMax = caps.cr?.[1] ?? 20;
        let cr = Math.min(crMax, Math.max(1, Number(window.SheetApp?.current?.total_level) || 4));
        let speed = 'medium';
        let parcel = null;
        const chosen = { coins: true, gems: new Set(), items: new Set() };

        const body = h('div', 'recipe-dialog loot-dialog');
        body.appendChild(h('p', 'dim',
            'Rolls one encounter\'s worth of treasure against Paizo\'s per-encounter value table, '
            + 'then puts it wherever you want it — including a character you do not have open.'));

        const controls = h('div', 'recipe-params');
        const crIn = h('input', 'edit-field');
        crIn.type = 'number';
        crIn.min = '1';
        crIn.max = String(crMax);
        crIn.value = String(cr);
        crIn.addEventListener('change', () => { cr = Math.max(1, Number(crIn.value) || 1); });
        const crRow = h('label', 'recipe-field');
        crRow.append(h('span', 'recipe-field-label', 'Encounter CR'), crIn);
        const speedSel = h('select', 'edit-field');
        for (const [id, label] of [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']]) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = label;
            speedSel.appendChild(opt);
        }
        speedSel.value = speed;
        speedSel.addEventListener('change', () => { speed = speedSel.value; });
        const speedRow = h('label', 'recipe-field');
        speedRow.append(h('span', 'recipe-field-label', 'Campaign track'), speedSel);
        controls.append(crRow, speedRow);

        const targetSel = h('select', 'edit-field');
        const targetRow = h('label', 'recipe-field');
        targetRow.append(h('span', 'recipe-field-label', 'Add to'), targetSel);
        controls.appendChild(targetRow);
        const fillTargets = async () => {
            const list = await window.SheetLibrary.list();
            targetSel.innerHTML = '';
            for (const rec of list) {
                const opt = document.createElement('option');
                opt.value = rec.id;
                opt.textContent = `${rec.name}${rec.level ? ' (' + rec.klass + ' ' + rec.level + ')' : ''}`;
                targetSel.appendChild(opt);
            }
            const openId = window.SheetApp?.current?._sheet?.id;
            if (openId && list.some((r) => r.id === openId)) targetSel.value = openId;
        };

        const result = h('div', 'loot-result');
        const status = h('p', 'recipe-status');

        const paintResult = () => {
            result.innerHTML = '';
            if (!parcel) {
                result.appendChild(h('p', 'tools-empty', 'Roll to see what is in the pile.'));
                return;
            }
            result.appendChild(h('p', 'recipe-preview-head',
                `CR ${parcel.cr} · ${parcel.speed} track · ${fmtGp(parcel.value)} gp`
                + (parcel.value < parcel.budget ? ` of a ${fmtGp(parcel.budget)} gp budget` : '')));

            const c = parcel.coins || {};
            const coinLine = [[c.pp, 'pp'], [c.gp, 'gp'], [c.sp, 'sp'], [c.cp, 'cp']]
                .filter(([n]) => Number(n) > 0)
                .map(([n, unit]) => `${Number(n).toLocaleString()} ${unit}`).join(' · ');
            const coinRow = h('label', 'loot-row');
            const coinBox = h('input');
            coinBox.type = 'checkbox';
            coinBox.checked = chosen.coins;
            coinBox.addEventListener('change', () => { chosen.coins = coinBox.checked; });
            coinRow.append(coinBox, h('span', 'loot-row-name', coinLine || 'no coins'));
            result.appendChild(coinRow);

            const row = (key, idx, label, price, note) => {
                const line = h('label', 'loot-row');
                const box = h('input');
                box.type = 'checkbox';
                box.checked = chosen[key].has(idx);
                box.addEventListener('change', () => {
                    if (box.checked) chosen[key].add(idx); else chosen[key].delete(idx);
                });
                line.append(box, h('span', 'loot-row-name', label),
                    h('span', 'loot-row-price', fmtGp(price) + ' gp'));
                if (note) line.appendChild(h('span', 'loot-row-tag', note));
                result.appendChild(line);
            };
            (parcel.gems || []).forEach((g, i) => row('gems', i, g.name, g.value, 'gem'));
            (parcel.items || []).forEach((it, i) =>
                row('items', i, it.name, it.price, it.magic ? 'magic' : null));
        };
        paintResult();
        body.append(controls, result, status);

        const roll = h('button', null, '🎲 Roll treasure');
        roll.type = 'button';
        const add = h('button', null, 'Add to character');
        add.type = 'button';
        add.disabled = true;
        const copy = h('button', null, 'Copy as text');
        copy.type = 'button';
        copy.disabled = true;
        const close = h('button', null, 'Close');
        close.type = 'button';

        const handle = window.SheetOverlay.open({
            title: 'Roll treasure', body, footer: [roll, add, copy, close],
        });
        close.addEventListener('click', () => handle.close());
        await fillTargets();

        roll.addEventListener('click', async () => {
            roll.disabled = true;
            status.textContent = 'Rolling…';
            try {
                parcel = await rollLoot(cr, speed);
                chosen.coins = true;
                chosen.gems = new Set((parcel.gems || []).map((_, i) => i));
                chosen.items = new Set((parcel.items || []).map((_, i) => i));
                status.textContent = '';
                add.disabled = false;
                copy.disabled = false;
                paintResult();
            } catch (err) {
                status.textContent = 'Failed: ' + err.message;
            }
            roll.disabled = false;
        });

        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(asText(parcel));
                window.SheetOverlay.toast('Treasure copied.');
            } catch {
                status.textContent = 'Could not reach the clipboard.';
            }
        });

        add.addEventListener('click', async () => {
            if (!parcel) return;
            add.disabled = true;
            const picks = {
                coins: chosen.coins,
                gems: (parcel.gems || []).filter((_, i) => chosen.gems.has(i)),
                items: (parcel.items || []).filter((_, i) => chosen.items.has(i)),
            };
            try {
                const name = await commit(targetSel.value, parcel, picks);
                handle.close();
                window.SheetOverlay.toast(
                    `Treasure added to ${name} — ${picks.items.length + picks.gems.length} item(s)`
                    + (picks.coins ? ' and coins' : ''));
            } catch (err) {
                status.textContent = 'Failed: ' + err.message;
                add.disabled = false;
            }
        });
    }

    return { init, open, probe, asText, addParcelTo };
})();
