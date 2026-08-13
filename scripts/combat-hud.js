// scripts/combat-hud.js -- #43: the phone/tablet combat HUD (window.SheetCombatHud).
// The A/B prototype (PR #57) picked candidate A: a full-screen SheetOverlay of oversized
// tap targets — HP with damage/heal/nonlethal appliers, the selected attack routine,
// saves, initiative, the condition tray as chips, and the shared round strip. No roll
// math lives here — every button delegates to SheetRoll / SheetStatKit / SheetState, so
// the HUD can never disagree with the sheet underneath it.
window.SheetCombatHud = (function () {
    'use strict';
    const h = (...a) => window.SheetUI.h(...a);

    const data = () => window.SheetApp?.current;
    const blocks = (d) => window.SheetDerive.computeDerived(d).blocks;
    const roll = (label, total) => window.SheetStatKit.rollCheck(label, total);

    function hpState(d) {
        const st = d._sheet ??= {};
        const max = Number(d.Total_HP) || 0;
        const cur = st.hpCurrent == null || st.hpCurrent === '' ? max : Number(st.hpCurrent) || 0;
        return { cur, max, temp: Number(st.hpTemp) || 0, nl: Number(st.hpNonlethal) || 0 };
    }

    function saveButtons(d) {
        const b = blocks(d);
        const wrap = h('div', 'hud-saves');
        for (const [key, label] of [['fort', 'Fort'], ['ref', 'Ref'], ['will', 'Will']]) {
            const total = b[key].total;
            const btn = h('button', 'hud-btn-big', `${label} ${total >= 0 ? '+' : ''}${total}`);
            btn.type = 'button';
            btn.title = `Roll ${label} save (1d20${total >= 0 ? '+' : ''}${total})`;
            btn.addEventListener('click', () => roll(label + ' save', total));
            wrap.appendChild(btn);
        }
        return wrap;
    }

    function attackButton(d) {
        const routines = d._sheet?.attackRoutines || [];
        const btn = h('button', 'hud-btn-big hud-btn-attack', '⚔ Full attack');
        btn.type = 'button';
        btn.title = routines.length
            ? 'Roll the selected attack routine into the log'
            : 'Roll an attack with the equipped weapon';
        btn.addEventListener('click', () => {
            if (routines.length && window.SheetRoll.rollRoutine) window.SheetRoll.rollRoutine();
            else window.SheetRoll.rollWeaponAttack?.({});
        });
        return btn;
    }

    let hudHandle = null;
    function openHud() {
        const d = data();
        if (!d || d.error) {
            window.SheetOverlay?.toast?.('Load a character first');
            return;
        }
        hudHandle?.close();
        const body = h('div', 'combat-hud');
        const paint = () => {
            body.innerHTML = '';
            const b = blocks(d);
            const hp = hpState(d);

            // HP block: big readout + amount + Damage / Heal / NL appliers.
            const hpCard = h('div', 'hud-card hud-hp');
            const hpLine = h('div', 'hud-hp-line');
            hpLine.append(
                h('span', 'hud-hp-cur' + (hp.max > 0 && hp.cur <= hp.max / 2 ? ' is-low' : ''),
                    String(hp.cur)),
                h('span', 'hud-hp-max', `/ ${hp.max}`),
                h('span', 'hud-hp-side', `temp ${hp.temp} · NL ${hp.nl}`),
            );
            hpCard.appendChild(hpLine);
            const applyRow = h('div', 'hud-apply-row');
            const amt = h('input', 'hud-amt');
            amt.type = 'number';
            amt.min = '0';
            amt.placeholder = '5';
            const applyBtn = (label, fn, cls) => {
                const btn = h('button', 'hud-btn-big ' + (cls || ''), label);
                btn.type = 'button';
                btn.addEventListener('click', () => {
                    const n = Math.max(0, Number(amt.value) || 0);
                    if (!n) { amt.focus(); return; }
                    fn(n);
                    amt.value = '';
                    paint();
                });
                return btn;
            };
            applyRow.append(amt,
                applyBtn('Damage', (n) => window.SheetRoll.applyDamageToHp(n), 'hud-btn-dmg'),
                applyBtn('Heal', (n) => window.SheetRoll.applyHealingToHp(n), 'hud-btn-heal'),
                applyBtn('NL', (n) => window.SheetRoll.applyDamageToHp(n, { nonlethal: true })));
            hpCard.appendChild(applyRow);
            body.appendChild(hpCard);

            // AC / defense readouts (tap nothing — glance data).
            const acRow = h('div', 'hud-ac-row');
            for (const [key, label] of [['ac', 'AC'], ['touch', 'Touch'], ['flat', 'FF'], ['cmd', 'CMD']]) {
                const chip = h('span', 'hud-ac-chip');
                chip.append(h('span', 'hud-ac-label', label), h('span', 'hud-ac-val', String(b[key].total)));
                acRow.appendChild(chip);
            }
            body.appendChild(acRow);

            // Attack + saves + init — the one-tap rolls.
            const rollCard = h('div', 'hud-card hud-rolls');
            rollCard.appendChild(attackButton(d));
            rollCard.appendChild(saveButtons(d));
            const initBtn = h('button', 'hud-btn-big',
                `Init ${b.init.total >= 0 ? '+' : ''}${b.init.total}`);
            initBtn.type = 'button';
            initBtn.addEventListener('click', () => roll('Initiative', b.init.total));
            rollCard.appendChild(initBtn);
            body.appendChild(rollCard);

            // Conditions: the full tray as a wrapping chip row (mechanical, same as Buffs).
            const condCard = h('div', 'hud-card hud-conds');
            const active = window.SheetState.activeConditions(d);
            for (const c of window.SheetData.PF1_CONDITIONS) {
                const on = active.has(c.id);
                const chip = h('button', 'condition-chip' + (on ? ' is-active' : ''), c.label);
                chip.type = 'button';
                chip.title = c.note;
                chip.addEventListener('click', () => {
                    window.SheetState.setConditionActive(d, c.id, !on);
                    window.SheetState.quietSave();
                    window.SheetApp.renderSheet(d);
                    paint();
                });
                condCard.appendChild(chip);
            }
            body.appendChild(condCard);

            // Round strip (the same component the Buffs tray and Tools drawer mount).
            const foot = h('div', 'hud-foot');
            foot.appendChild(window.SheetRoll.renderRoundStrip({ withReset: true }));
            body.appendChild(foot);
        };
        paint();
        hudHandle = window.SheetOverlay.open({
            title: '⚔ Combat',
            body,
            onClose: () => { hudHandle = null; },
        });
    }

    return { openHud };
})();
