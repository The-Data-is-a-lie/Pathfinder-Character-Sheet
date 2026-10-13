// scripts/post-cards.js -- post a list row (or the whole defensive line) to the roll log as a card
// (window.SheetPostCards, #151). Features already did this through SheetRoll.postFeatureCard; this
// gives Inventory / Combat (the same row card), Spells and Buffs the same verb, plus a one-click
// Defenses card for "what's your AC / touch / CMD / saves?" at the table. No dice, no sound.
window.SheetPostCards = (function () {
    'use strict';
    const { h, fmt, escapeHtml } = window.SheetUI;

    const post = (card) => {
        window.SheetRoll?.setOpen?.(true);
        return window.SheetRoll?.postCard?.(card);
    };
    const changeLines = (changes) => (changes || [])
        .map((c) => window.SheetModals?.formatChangeLine?.(c, window.SheetDetails) || `${c.formula} ${c.target}`)
        .filter(Boolean);

    /** The row's post button — the same 🎲 "Post to the roll log" Features rows carry. */
    function postBtn(onPost, cls = '') {
        const b = h('button', 'inv-btn row-post-btn no-print' + (cls ? ' ' + cls : ''), '🎲');
        b.type = 'button';
        b.title = 'Post to the roll log';
        b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onPost();
        });
        return b;
    }

    /** An inventory item: identified text (or the unidentified one), type, charges, effects. */
    function postItem(data, item) {
        const unid = item.identified === false;
        const riders = [];
        const ch = item.charges;
        if (ch && (ch.value != null || ch.max != null)) {
            riders.push({ source: 'Charges', text: `${ch.value ?? '—'}${ch.max != null ? ' / ' + ch.max : ''}` });
        }
        if ((Number(item.quantity) || 0) > 1) riders.push({ source: 'Quantity', text: String(item.quantity) });
        if (!unid) {
            const eff = changeLines(item.changes);
            if (eff.length) riders.push({ source: item.equipped ? 'While equipped' : 'When equipped', text: eff.join('; ') });
        }
        const type = [item.itemType, item.subType || item.equipmentSubtype].filter(Boolean)
            .map((s) => String(s).replace(/^\w/, (c) => c.toUpperCase())).join(' · ');
        return post({
            title: unid ? (item.unidName || 'Unidentified item') : (item.name || 'Item'),
            subtitle: (type || 'Item') + (unid ? ' · unidentified' : ''),
            descHtml: unid ? (item.unidDescription || '<p class="dim">Not yet identified.</p>')
                : (item.description || ''),
            descOpen: false,
            riders,
        });
    }

    /** A spell: the same school / action / save / damage line the row expander shows, then text. */
    function postSpell(data, name, { level, dc, descHtml } = {}) {
        return post({
            title: name,
            subtitle: (level === 0 || level === '0' ? 'Cantrip' : level != null ? `Level ${level} spell` : 'Spell')
                + (dc != null ? ` · DC ${dc}` : ''),
            descHtml: descHtml || '',
            descOpen: false,
        });
    }

    /** A buff: its changes as the rider, notes as the body. */
    function postBuff(data, buff) {
        const riders = [];
        const eff = changeLines(buff.changes);
        if (eff.length) riders.push({ source: 'Changes', text: eff.join('; ') });
        const dur = window.SheetState?.formatBuffDuration?.(buff);
        if (dur && dur !== '—') riders.push({ source: 'Duration', text: dur });
        return post({
            title: buff.name || 'Buff',
            subtitle: 'Buff · ' + (buff.subType || 'temp') + (buff.active === false ? ' · inactive' : ''),
            descHtml: buff.notes ? `<p>${escapeHtml(buff.notes)}</p>` : '',
            descOpen: false,
            riders,
        });
    }

    /** The defensive line in one card: AC / touch / flat-footed, CMD, saves, SR, DR / ER / immunities. */
    function postDefenses(data) {
        const D = window.SheetDerive;
        const d = D.computeDerived(data);
        const b = d.blocks;
        const riders = [
            { source: 'AC', text: `${b.ac.total} · touch ${b.touch.total} · flat-footed ${b.flat.total}` },
            { source: 'CMD', text: `${b.cmd.total} · flat-footed ${b.cmdFF.total}` },
            { source: 'Saves', text: `Fort ${fmt(b.fort.total)} · Ref ${fmt(b.ref.total)} · Will ${fmt(b.will.total)}` },
        ];
        const sr = Number(D.srTotal?.(data)) || 0;
        if (sr) riders.push({ source: 'SR', text: String(sr) });
        const defs = window.SheetDamageCalc?.effectiveDefenses?.(data) || {};
        const dr = (defs.dr || []).filter((e) => Number(e.amount));
        if (dr.length) riders.push({ source: 'DR', text: dr.map((e) => `${e.amount}/${e.bypass || '—'}`).join(', ') });
        const er = (defs.resist || []).filter((e) => Number(e.amount));
        if (er.length) riders.push({ source: 'Resist', text: er.map((e) => `${e.type} ${e.amount}`).join(', ') });
        const im = (defs.dmgImmune || []).map((e) => e.type).filter(Boolean);
        if (im.length) riders.push({ source: 'Immune', text: im.join(', ') });
        const vu = (defs.dmgVuln || []).map((e) => e.type).filter(Boolean);
        if (vu.length) riders.push({ source: 'Vulnerable', text: vu.join(', ') });
        const flags = d.conditionFlags || {};
        const notes = [
            flags.loseDex ? `loses Dex to AC (${flags.sources.join(', ')})` : null,
            flags.noDodge ? 'no dodge bonuses' : null,
        ].filter(Boolean);
        return post({
            title: 'Defenses',
            subtitle: data.character_full_name || 'Character',
            riders,
            descHtml: notes.length ? `<p class="dim">${escapeHtml(notes.join(' · '))}</p>` : '',
        });
    }

    return { postBtn, postItem, postSpell, postBuff, postDefenses };
})();
