// Rolling & combat acceptance tests: routines, iteratives, ammo, conditionals, size, one-offs,
// round counter, apply-damage, re-roll. The backend is stubbed; rolls pin the dice where a
// specific d20 matters.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page, tab) => page.locator(`.tab-pane[data-tab="${tab}"]`);
const cards = (page) => page.locator('#tools-log .roll-card');
const lastCard = (page) => cards(page).first();

/**
 * Pin the dice. The roller draws from crypto.getRandomValues, so that is what gets stubbed: a die
 * of N sides shows (raw % N) + 1. raw=10 gives d20 11 / d6 5 / d4 3; raw=19 gives a natural 20.
 */
const pinDice = (page, raw) => page.evaluate((x) => {
    window.__realGrv ??= crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (buf) => { buf.fill(x); return buf; };
}, raw);
const realDice = (page) => page.evaluate(() => { if (window.__realGrv) crypto.getRandomValues = window.__realGrv; });
const MID = 10; // d20 = 11
const NAT20 = 19;

async function rerender(page, tab) {
    await page.evaluate((t) => { window.SheetApp.renderSheet(window.SheetApp.current); window.SheetApp.setActiveTab(t); }, tab);
}

/** Attack totals on a card, in order. */
const attackTotals = (card) => card.locator('.roll-card-attack .roll-card-result')
    .evaluateAll((els) => els.map((e) => Number(e.textContent)));

/** Add inventory items to the current character and re-render so they normalize. */
async function addItems(page, items) {
    await page.evaluate((list) => {
        const d = window.SheetApp.current;
        for (const it of list) d.equipment_list.push({ equipped: true, carried: true, quantity: 1, changes: [], ...it });
        window.SheetApp.renderSheet(d);
    }, items);
}

async function setRoutine(page, lines, name = 'Test routine') {
    await page.evaluate(({ lines, name }) => {
        const st = (window.SheetApp.current._sheet ??= {});
        st.attackRoutines = [{ id: 'rt-test', name, lines }];
        st.attackRoutineSel = 'rt-test';
    }, { lines, name });
}

const mainKey = (page) => page.evaluate(() => window.SheetRoll.attackContext().itemKey);

test('a routine rolls one d20 per line into one card; editing a line adjust moves only that line (attack-routines)',
    feature('combat.attack-routines'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'combat');
        const key = await mainKey(page);
        await setRoutine(page, [
            { type: 'weapon', itemKey: key, ammoKey: null, label: 'Swing A', adjust: 0 },
            { type: 'weapon', itemKey: key, ammoKey: null, label: 'Swing B', adjust: -3 },
            { type: 'weapon', itemKey: key, ammoKey: null, label: 'Swing C', adjust: -6 },
        ]);
        await rerender(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pinDice(page, MID);
        const combat = pane(page, 'combat');
        await combat.locator('.atk-routine-roll').click();
        await expect(cards(page)).toHaveCount(1);
        const first = lastCard(page);
        await expect(first.locator('.roll-card-title')).toHaveText('Test routine');
        await expect(first.locator('.roll-card-attack')).toHaveCount(3);
        const t1 = await attackTotals(first);
        expect(t1[0] - t1[1]).toBe(3);
        expect(t1[1] - t1[2]).toBe(3);

        // Edit line 2's adjust through the editor and roll again.
        await combat.locator('.atk-routine-row button', { hasText: 'Edit' }).click();
        const adj = pane(page, 'combat').locator('.atk-routine-editor input[aria-label^="Flat adjustment"]');
        await expect(adj).toHaveCount(3);
        await adj.nth(1).fill('-10');
        await adj.nth(1).press('Tab');
        await pane(page, 'combat').locator('.atk-routine-roll').click();
        await expect(cards(page)).toHaveCount(2);
        const t2 = await attackTotals(lastCard(page));
        expect(t2).toHaveLength(3);
        expect(t2[0]).toBe(t1[0]);
        expect(t2[1]).toBe(t1[0] - 10);
        expect(t2[2]).toBe(t1[2]);
        await realDice(page);
    });

test('BAB +15 reads +15/+10/+5 and a full attack makes three attack lines stepped by 5 (bab-iteratives)',
    feature('combat.bab-iteratives'), async ({ page }) => {
        await openSheet(page);
        expect(await page.evaluate(() => window.SheetApp.current.bab_total)).toBe(15);
        expect(await page.evaluate(() => window.SheetDerive.babIterativesStr(15))).toBe('+15/+10/+5');
        expect(await page.evaluate(() => window.SheetDerive.babIterativesStr(6))).toBe('+6/+1');
        await gotoTab(page, 'combat');
        const babBox = pane(page, 'combat').locator('.summary-stat-box', { has: page.locator('.summary-stat-head', { hasText: /^BAB/ }) });
        await expect(babBox.locator('.summary-stat-val')).toHaveText('+15/+10/+5');

        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page, 'combat').locator('.combat-atk-btns button', { hasText: 'Full attack' }).click();
        await expect(cards(page)).toHaveCount(1);
        const totals = await attackTotals(lastCard(page));
        expect(totals).toHaveLength(3);
        expect(totals[0] - totals[1]).toBe(5);
        expect(totals[1] - totals[2]).toBe(5);
        await realDice(page);
    });

test('re-seeding with Two-Weapon Fighting adds off-hand lines with the penalty baked into adjust (routine-seeding)',
    feature('combat.routine-seeding'), async ({ page }) => {
        await openSheet(page);
        await addItems(page, [{ id: 'eq:test-dagger', name: 'Dagger', itemType: 'weapon' }]);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.feats = [...(d.feats || []), 'Two-Weapon Fighting', 'Improved Two-Weapon Fighting'];
        });
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const combat = pane(page, 'combat');
        await combat.locator('.atk-routine-row button', { hasText: 'Edit' }).click();
        await combat.locator('.atk-routine-editor button', { hasText: 'Re-seed' }).click();
        const lines = await page.evaluate(() => window.SheetApp.current._sheet.attackRoutines[0].lines
            .map((l) => ({ label: l.label, adjust: l.adjust, itemKey: l.itemKey })));
        // Three iteratives all at -2 for TWF, then two off-hand lines (Improved TWF adds the second).
        expect(lines.map((l) => l.adjust)).toEqual([-2, -7, -12, -2, -7]);
        expect(lines.slice(3).every((l) => /^Off-hand: Dagger/.test(l.label) && l.itemKey === 'eq:test-dagger')).toBe(true);
        expect(lines.slice(0, 3).every((l) => l.itemKey !== 'eq:test-dagger')).toBe(true);
        await expect(pane(page, 'combat').locator('.atk-routine-editor select[aria-label="Weapon for this attack"]')).toHaveCount(5);
    });

test('re-seeding a ranged character with Rapid Shot adds an extra line and -2 on all (routine-seeding)',
    feature('combat.routine-seeding'), async ({ page }) => {
        await openSheet(page);
        await addItems(page, [{ id: 'eq:test-xbow', name: 'Light Crossbow', itemType: 'weapon' }]);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.feats = [...(d.feats || []), 'Rapid Shot'];
            (d._sheet ??= {}).activeWeaponKey = 'eq:test-xbow';
        });
        expect(await page.evaluate(() => window.SheetRoll.attackContext().ranged)).toBe(true);
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const combat = pane(page, 'combat');
        await combat.locator('.atk-routine-row button', { hasText: 'Edit' }).click();
        await combat.locator('.atk-routine-editor button', { hasText: 'Re-seed' }).click();
        const lines = await page.evaluate(() => window.SheetApp.current._sheet.attackRoutines[0].lines
            .map((l) => ({ label: l.label, adjust: l.adjust })));
        expect(lines).toHaveLength(4);
        expect(lines[1].label).toMatch(/Rapid Shot/);
        expect(lines.map((l) => l.adjust)).toEqual([-2, -2, -7, -12]);
    });

test('a routine line linked to ammo spends one per attack; at zero it still rolls and flags Out of (ammo)',
    feature('combat.ammo'), async ({ page }) => {
        await openSheet(page);
        await addItems(page, [
            { id: 'eq:test-xbow', name: 'Light Crossbow', itemType: 'weapon' },
            { id: 'eq:test-bolts', name: 'Crossbow bolts', itemType: 'equipment', equipped: false, quantity: 2 },
        ]);
        await setRoutine(page, [
            { type: 'weapon', itemKey: 'eq:test-xbow', ammoKey: 'eq:test-bolts', label: 'Bolt', adjust: 0 },
            { type: 'weapon', itemKey: 'eq:test-xbow', ammoKey: 'eq:test-bolts', label: 'Bolt 2', adjust: 0 },
        ], 'Volley');
        const qty = () => page.evaluate(() => window.SheetApp.current.equipment_list.find((i) => i.id === 'eq:test-bolts').quantity);
        expect(await qty()).toBe(2);
        await page.evaluate(() => window.SheetRoll.rollRoutine());
        await expect(cards(page)).toHaveCount(1);
        expect(await qty()).toBe(0);
        await expect(lastCard(page).locator('.roll-card-attack')).toHaveCount(2);
        await expect(lastCard(page)).toContainText('last one spent');
        // Empty quiver: still rolls both lines, flags them, quantity stays at 0.
        await page.evaluate(() => window.SheetRoll.rollRoutine());
        await expect(cards(page)).toHaveCount(2);
        await expect(lastCard(page).locator('.roll-card-attack')).toHaveCount(2);
        await expect(lastCard(page)).toContainText('Out of Crossbow bolts!');
        expect(await qty()).toBe(0);
    });

test('a natural routine line rolls its own attack mod and damage formula (natural-attacks)',
    feature('combat.natural-attacks'), async ({ page }) => {
        await openSheet(page);
        await setRoutine(page, [{ type: 'natural', name: 'Bite', atkMod: 5, dmg: '1d6+4', adjust: 0 }], 'Beast');
        await pinDice(page, MID); // d20 = 11, 1d6 = 4
        await page.evaluate(() => window.SheetRoll.rollRoutine());
        const card = lastCard(page);
        await expect(card.locator('.roll-card-title')).toHaveText('Beast');
        await expect(card.locator('.roll-card-attack .roll-card-kind')).toHaveText('Bite');
        expect(await attackTotals(card)).toEqual([16]);
        await expect(card.locator('.roll-card-damage')).toHaveCount(1);
        await realDice(page);
    });

test('weapon-quality conditionals apply only to the weapon being rolled (weapon-quality-scope)',
    feature('combat.weapon-quality-scope'), async ({ page }) => {
        await openSheet(page);
        await addItems(page, [{ id: 'eq:test-sword', name: 'Longsword', itemType: 'weapon' }]);
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const spear = await mainKey(page);
        // Open the groups, then tick every quality of the shortspear through the real checkboxes.
        await page.evaluate(() => document.querySelectorAll('.tab-pane[data-tab="combat"] .cond-group').forEach((g) => { g.open = true; }));
        const boxes = pane(page, 'combat').locator(`.cond-check[data-cond-id^="enh:${spear}:"]`);
        const n = await boxes.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) await boxes.nth(i).check();
        await pinDice(page, MID);
        await page.evaluate((k) => window.SheetRoll.rollWeaponAttackFor(k, { withDamage: true, action: null }), spear);
        await expect(cards(page)).toHaveCount(1);
        await expect(lastCard(page)).toContainText('Fury-Born');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttackFor('eq:test-sword', { withDamage: true, action: null }));
        await expect(cards(page)).toHaveCount(2);
        await expect(lastCard(page)).toContainText('Longsword');
        await expect(lastCard(page)).not.toContainText('Fury-Born');
        await expect(lastCard(page)).not.toContainText('Spellstealing');
        await realDice(page);
    });

test('a natural 20 in the threat range posts a confirmation roll (crit-confirm)',
    feature('combat.crit-confirm'), async ({ page }) => {
        await openSheet(page);
        await pinDice(page, NAT20);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        const card = lastCard(page);
        await expect(card).toContainText('Critical threat');
        await expect(card).toContainText('Confirm d20');
        await expect(card.locator('.roll-card-result.is-threat')).toHaveCount(1);
        // A plain 11 is no threat and posts no confirmation.
        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(cards(page)).toHaveCount(2);
        await expect(lastCard(page)).not.toContainText('Confirm d20');
        await realDice(page);
    });

test('conditionals are collapsible groups whose "N on" badge follows the checkboxes (conditionals-panel)',
    feature('combat.conditionals-panel'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const groups = pane(page, 'combat').locator('.cond-group');
        expect(await groups.count()).toBeGreaterThanOrEqual(3);
        const combatOpts = groups.filter({ has: page.locator('.cond-group-title', { hasText: 'Combat options' }) });
        const badge = combatOpts.locator('.cond-group-count');
        await expect(badge).toHaveText(/^\d+$/); // nothing on: plain count
        // Collapse, then expand again.
        const summary = combatOpts.locator('summary');
        await expect(combatOpts).toHaveJSProperty('open', true);
        await summary.click();
        await expect(combatOpts).toHaveJSProperty('open', false);
        await summary.click();
        await expect(combatOpts).toHaveJSProperty('open', true);
        // Ticking boxes updates the badge; unticking brings it back down.
        const box = combatOpts.locator('.cond-check[data-cond-id="combat:flanking"]');
        await box.check();
        await expect(badge).toHaveText('1 on');
        await combatOpts.locator('.cond-check[data-cond-id="combat:higher-ground"]').check();
        await expect(badge).toHaveText('2 on');
        await box.uncheck();
        await expect(badge).toHaveText('1 on');
    });

test('ticking Power Attack lowers the next attack by 1 per 4 BAB and raises damage (tactical-toggles)',
    feature('combat.tactical-toggles'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        const base = (await attackTotals(lastCard(page)))[0];
        const baseDmg = Number(await lastCard(page).locator('.roll-card-damage .roll-card-result').first().innerText());
        await pane(page, 'combat').locator('.cond-check[data-cond-id="combat:power-attack"]').check();
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(cards(page)).toHaveCount(2);
        const pa = (await attackTotals(lastCard(page)))[0];
        // BAB 15: 1 + floor(15/4) = 4 steps, so -4 attack.
        expect(base - pa).toBe(4);
        const paDmg = Number(await lastCard(page).locator('.roll-card-damage .roll-card-result').first().innerText());
        expect(paDmg).toBeGreaterThan(baseDmg);
        await expect(lastCard(page)).toContainText('Power Attack');
        await realDice(page);
    });

test('Large size steps the damage dice and drops the attack size modifier (size-dice)',
    feature('combat.size-dice'), async ({ page }) => {
        await openSheet(page);
        // 1d6 shortspear becomes 1d8; a 1d8 longsword becomes 2d6 (Paizo FAQ ladder).
        await addItems(page, [{ id: 'eq:test-sword', name: 'Longsword', itemType: 'weapon' }]);
        const read = () => page.evaluate(() => {
            const sp = window.SheetRoll.attackContext();
            const sw = window.SheetRoll.attackContext('eq:test-sword');
            return { spear: sp.damageDice, sword: sw.damageDice, atk: sp.weaponBonus, sizeMod: sp.size.mod, size: sp.size.id };
        });
        const med = await read();
        expect(med.size).toBe('medium');
        expect(med.spear).toBe('1d6');
        expect(med.sword).toBe('1d8');
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page, 'combat').locator('.combat-size-row select').selectOption('large');
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.size)).toBe('large');
        const lg = await read();
        expect(lg.size).toBe('large');
        expect(lg.spear).toBe('1d8');
        expect(lg.sword).toBe('2d6');
        expect(lg.sizeMod).toBe(-1);
        expect(lg.atk).toBe(med.atk - 1);
        // The rolled card agrees with the context: its damage block names the stepped dice.
        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(lastCard(page).locator('.roll-card-damage')).toContainText('1d8');
        await realDice(page);
    });

test('a "Next roll" +atk applies to the next attack only and is then cleared (one-off-modifiers)',
    feature('combat.one-off-modifiers'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: false }));
        const base = (await attackTotals(lastCard(page)))[0];

        const atkIn = pane(page, 'combat').locator('.oneoff-input[data-oneoff="attack"]');
        await atkIn.fill('3');
        await pane(page, 'combat').locator('.oneoff-input[data-oneoff="label"]').fill('flanking');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: false }));
        await expect(cards(page)).toHaveCount(2);
        expect((await attackTotals(lastCard(page)))[0]).toBe(base + 3);
        await expect(lastCard(page)).toContainText('flanking (one-off)');
        // Consumed: the box is empty and the following attack is back to base.
        await expect(atkIn).toHaveValue('');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: false }));
        await expect(cards(page)).toHaveCount(3);
        expect((await attackTotals(lastCard(page)))[0]).toBe(base);
        await expect(lastCard(page)).not.toContainText('one-off');

        // A dice formula is rolled fresh: with the dice pinned, 1d4 is 3.
        await atkIn.fill('1d4');
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: false }));
        await expect(cards(page)).toHaveCount(4);
        expect((await attackTotals(lastCard(page)))[0]).toBe(base + 3);
        await realDice(page);
    });

test('Large adds +1 to CMB and CMD over Medium, shown on the Combat strip and rollable (cmb-cmd)',
    feature('combat.cmb-cmd'), async ({ page }) => {
        await openSheet(page);
        const blocks = () => page.evaluate(() => {
            const b = window.SheetDerive.computeDerived(window.SheetApp.current).blocks;
            return { cmb: b.cmb.total, cmd: b.cmd.total, melee: b.melee.total };
        });
        const med = await blocks();
        await gotoTab(page, 'combat');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await pane(page, 'combat').locator('.combat-size-row select').selectOption('large');
        await expect.poll(() => page.evaluate(() => window.SheetApp.current._sheet.size)).toBe('large');
        const lg = await blocks();
        expect(lg.cmb).toBe(med.cmb + 1);
        expect(lg.cmd).toBe(med.cmd + 1);
        expect(lg.melee).toBe(med.melee - 1);
        const cmbBox = pane(page, 'combat').locator('.summary-stat-box', { has: page.locator('.summary-stat-head', { hasText: /^CMB/ }) });
        await expect(cmbBox.locator('.summary-stat-val')).toHaveText('+' + lg.cmb);
        // The CMB box has a roll button that posts to the log.
        await cmbBox.locator('button').first().click();
        await page.evaluate(() => window.SheetRoll.setOpen(true));
        await expect(page.locator('#tools-log .tools-log-entry').first()).toContainText('CMB');
    });

test('Apply on a damage block takes temp HP first and the toast Undo restores every pool (apply-damage)',
    feature('log.apply-damage'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => { const st = window.SheetApp.current._sheet ??= {}; st.hpCurrent = 100; st.hpTemp = 5; });
        await pinDice(page, MID);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        const block = lastCard(page).locator('.roll-card-damage').first();
        const total = Number(await block.locator('.roll-card-result').innerText());
        expect(total).toBeGreaterThan(5);
        await block.locator('.roll-card-apply-btn', { hasText: /^Apply/ }).evaluate((b) => b.click());
        const hp = () => page.evaluate(() => { const s = window.SheetApp.current._sheet; return { cur: s.hpCurrent, temp: s.hpTemp }; });
        // The mitigation note (when the block is typed) names what actually landed.
        const note = await lastCard(page).locator('.roll-card-mitigation').first().innerText().catch(() => '');
        const applied = Number((note.match(/Applied (\d+)/) || [])[1] ?? total);
        expect(applied).toBeGreaterThan(5);
        // Temp HP absorbs first (5), the remainder comes off current HP.
        expect(await hp()).toEqual({ cur: 100 - (applied - 5), temp: 0 });
        const undo = page.locator('#sheet-toast button', { hasText: 'Undo' });
        await expect(undo).toBeVisible();
        await undo.click();
        expect(await hp()).toEqual({ cur: 100, temp: 5 });
        await realDice(page);
    });

test('the re-roll button on a card posts a fresh card without touching the first (reroll)',
    feature('log.reroll'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => window.SheetRoll.rollWeaponAttack({ full: false, withDamage: true }));
        await expect(cards(page)).toHaveCount(1);
        const title = await lastCard(page).locator('.roll-card-title').innerText();
        await page.evaluate(() => window.SheetRoll.setOpen(true));
        await expect(lastCard(page).locator('.tools-log-reroll')).toHaveCount(1);
        await lastCard(page).locator('.tools-log-reroll').click();
        await expect(cards(page)).toHaveCount(2);
        await expect(cards(page).nth(0).locator('.roll-card-title')).toHaveText(title);
        await expect(cards(page).nth(1).locator('.roll-card-title')).toHaveText(title);
        // A routine card re-rolls too, still as a new card.
        await page.evaluate(() => window.SheetRoll.rollRoutine());
        await expect(cards(page)).toHaveCount(3);
        await lastCard(page).locator('.tools-log-reroll').click();
        await expect(cards(page)).toHaveCount(4);
    });

test('Next round counts up and expires a 1-round buff (round-counter)',
    feature('combat.round-counter'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetState.createBuff(d, { name: 'Test shield', duration: { value: '1', units: 'round' } });
            window.SheetState.createBuff(d, { name: 'Test long buff', duration: { value: '3', units: 'round' } });
        });
        await gotoTab(page, 'buffs');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        const strip = pane(page, 'buffs').locator('.round-strip').first();
        await expect(strip.locator('.round-strip-num')).toHaveText('Round 0');
        const state = () => page.evaluate(() => {
            const d = window.SheetApp.current;
            const by = (n) => window.SheetState.ensureBuffs(d).find((b) => b.name === n);
            return { round: d._sheet.roundCounter, short: by('Test shield').active, long: by('Test long buff').active,
                longLeft: by('Test long buff').duration.value };
        });
        expect(await state()).toMatchObject({ short: true, long: true, longLeft: '3' });
        await strip.locator('button', { hasText: 'Next round' }).click();
        await expect(page.locator('#sheet-toast')).toContainText('Round 1');
        await expect(page.locator('#sheet-toast')).toContainText('Test shield');
        expect(await state()).toEqual({ round: 1, short: false, long: true, longLeft: '2' });
        await gotoTab(page, 'buffs');
        await expect(pane(page, 'buffs').locator('.round-strip-num').first()).toHaveText('Round 1');
    });
