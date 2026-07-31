// scripts/proto/combat-hud.js -- #43 PROTOTYPE: two rough candidates for a phone/tablet
// in-combat surface, built to be reacted to, not shipped as-is. Everything one tap away:
// HP (apply damage/heal/nonlethal), the selected attack routine, saves, conditions, and
// the round strip. No roll math lives here — every button delegates to the surfaces the
// sheet already has (SheetRoll appliers/routines, SheetStatKit.rollCheck, advanceRound).
//
//   Candidate A — "HUD mode": a full-screen SheetOverlay that replaces the sheet with
//   oversized tap targets. Good when the phone IS the character sheet at the table.
//   Candidate B — "dock": a slim fixed bar over the normal sheet (any tab), expandable
//   into candidate A. Good when you still want the sheet scrollable behind it.
//
// The ⚔ Combat topbar button opens A; A's footer offers "Try the dock"; the dock's ⤢
// expands back into A. Choice persists as sheet.hudMode ('' | 'dock').
window.SheetCombatHud = (function () {
    'use strict';
    const MODE_KEY = 'sheet.hudMode';
    const h = (...a) => window.SheetUI.h(...a);

    const data = () => window.SheetApp?.current;
    const blocks = (d) => window.SheetDerive.computeDerived(d).blocks;
    const roll = (label, total) => window.SheetStatKit.rollCheck(label, total);

    // ------------------------------------------------------------ shared pieces
    function hpState(d) {
        const st = d._sheet ??= {};
        const max = Number(d.Total_HP) || 0;
        const cur = st.hpCurrent == null || st.hpCurrent === '' ? max : Number(st.hpCurrent) || 0;
        return { cur, max, temp: Number(st.hpTemp) || 0, nl: Number(st.hpNonlethal) || 0 };
    }
    function saveButtons(d, big) {
        const b = blocks(d);
        const wrap = h('div', big ? 'hud-saves' : 'dock-saves');
        for (const [key, label] of [['fort', 'Fort'], ['ref', 'Ref'], ['will', 'Will']]) {
            const total = b[key].total;
            const btn = h('button', big ? 'hud-btn-big' : 'dock-btn',
                big ? `${label} ${total >= 0 ? '+' : ''}${total}` : label[0]);
            btn.type = 'button';
            btn.title = `Roll ${label} save (1d20${total >= 0 ? '+' : ''}${total})`;
            btn.addEventListener('click', () => roll(label + ' save', total));
            wrap.appendChild(btn);
        }
        return wrap;
    }
    function attackButton(d, big) {
        const routines = d._sheet?.attackRoutines || [];
        const btn = h('button', big ? 'hud-btn-big hud-btn-attack' : 'dock-btn dock-btn-attack', '⚔' + (big ? ' Full attack' : ''));
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
    function nextRoundButton(d, big) {
        const btn = h('button', big ? 'hud-btn-big' : 'dock-btn', big ? '⏭ Next round' : '⏭');
        btn.type = 'button';
        btn.title = 'Advance the round counter (ticks durations, refreshes swift/AoO)';
        btn.addEventListener('click', () => {
            const res = window.SheetState.advanceRound(d);
            window.SheetState.quietSave();
            window.SheetOverlay?.toast?.(`Round ${res.round}`
                + (res.expired.length ? ` — expired: ${res.expired.join(', ')}` : ''));
            window.SheetApp.renderSheet(d);
        });
        return btn;
    }

    // ------------------------------------------------------ candidate A: HUD mode
    let hudHandle = null;
    function openHud() {
        const d = data();
        if (!d) {
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
            rollCard.appendChild(attackButton(d, true));
            rollCard.appendChild(saveButtons(d, true));
            const initBtn = h('button', 'hud-btn-big',
                `Init ${b.init.total >= 0 ? '+' : ''}${b.init.total}`);
            initBtn.type = 'button';
            initBtn.addEventListener('click', () => roll('Initiative', b.init.total));
            rollCard.appendChild(initBtn);
            body.appendChild(rollCard);

            // Conditions: the full tray as a wrapping chip row.
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

            // Round strip (shared component) + candidate switch.
            const foot = h('div', 'hud-foot');
            foot.appendChild(window.SheetRoll.renderRoundStrip({ withReset: true }));
            const dockLink = h('button', 'inv-btn', 'Try the dock instead');
            dockLink.type = 'button';
            dockLink.title = 'Candidate B: a slim always-on bar over the normal sheet';
            dockLink.addEventListener('click', () => {
                hudHandle?.close();
                setMode('dock');
            });
            foot.appendChild(dockLink);
            body.appendChild(foot);
        };
        paint();
        hudHandle = window.SheetOverlay.open({
            title: '⚔ Combat',
            body,
            onClose: () => { hudHandle = null; },
        });
    }

    // ------------------------------------------------------- candidate B: dock
    let dockEl = null;
    function mountDock() {
        if (dockEl) return;
        const d = data();
        if (!d) return;
        dockEl = h('div', 'combat-dock no-print');
        dockEl.id = 'combat-dock';
        const paint = () => {
            const cur = data();
            if (!cur) return;
            dockEl.innerHTML = '';
            const hp = hpState(cur);
            const hpChip = h('button', 'dock-btn dock-hp' + (hp.max > 0 && hp.cur <= hp.max / 2 ? ' is-low' : ''),
                `${hp.cur}/${hp.max}`);
            hpChip.type = 'button';
            hpChip.title = 'Apply damage: tap, then use the HUD HP row';
            hpChip.addEventListener('click', openHud);
            dockEl.appendChild(hpChip);
            dockEl.appendChild(attackButton(cur, false));
            dockEl.appendChild(saveButtons(cur, false));
            dockEl.appendChild(nextRoundButton(cur, false));
            const condBtn = h('button', 'dock-btn', '☯');
            condBtn.type = 'button';
            condBtn.title = 'Conditions tray (Buffs tab)';
            condBtn.addEventListener('click', () => window.SheetApp.setActiveTab('buffs'));
            dockEl.appendChild(condBtn);
            const expand = h('button', 'dock-btn', '⤢');
            expand.type = 'button';
            expand.title = 'Expand into the full combat HUD';
            expand.addEventListener('click', openHud);
            dockEl.appendChild(expand);
            const hide = h('button', 'dock-btn dock-hide', '×');
            hide.type = 'button';
            hide.title = 'Hide the dock (⚔ Combat in the top bar brings it back)';
            hide.addEventListener('click', () => setMode(''));
            dockEl.appendChild(hide);
        };
        paint();
        // Keep HP fresh: repaint on every sheet render (cheap — the dock is 8 buttons).
        const origRender = window.SheetApp.renderSheet;
        dockEl._repaint = paint;
        document.body.appendChild(dockEl);
        document.body.classList.add('has-combat-dock');
        void origRender;
    }
    function unmountDock() {
        dockEl?.remove();
        dockEl = null;
        document.body.classList.remove('has-combat-dock');
    }
    function setMode(mode) {
        localStorage.setItem(MODE_KEY, mode || '');
        if (mode === 'dock') mountDock();
        else unmountDock();
        window.SheetOverlay?.toast?.(mode === 'dock'
            ? 'Dock on — × on the dock turns it off' : 'Dock off');
    }
    /** Boot hook: restore the dock once a character renders; keep it repainted after. */
    function init() {
        // The character loads async (IndexedDB), so the dock mounts lazily on the first
        // render rather than at boot; repaints ride every later render to stay honest.
        const orig = window.SheetApp.renderSheet;
        window.SheetApp.renderSheet = (d) => {
            const out = orig(d);
            if (!dockEl && localStorage.getItem(MODE_KEY) === 'dock') mountDock();
            dockEl?._repaint?.();
            return out;
        };
        // The boot render goes through sheet.js's local function (not the SheetApp
        // delegate), so a short poll covers the initial mount. Prototype-grade.
        if (localStorage.getItem(MODE_KEY) === 'dock') {
            let tries = 0;
            const t = setInterval(() => {
                tries += 1;
                if (data()) mountDock();
                if (dockEl || tries > 40) clearInterval(t);
            }, 250);
        }
    }

    return { openHud, setMode, init };
})();
