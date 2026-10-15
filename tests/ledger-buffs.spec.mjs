// Conditions, buffs, presets, templates, always-on sources, buff-granted defense chips and Rest.
// Everything here proves a ledger id by driving the real UI (chips, checkboxes, dialogs) and then
// reading the derived numbers, not by poking state and asserting the poke.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const buffsPane = (page) => page.locator('.tab-pane[data-tab="buffs"]');

/** Derived block totals for the current character (attack = melee, plus the saves/AC family). */
const blocks = (page) => page.evaluate(() => {
    const D = window.SheetDerive.computeDerived(window.SheetApp.current).blocks;
    const out = {};
    for (const k of ['ac', 'touch', 'flat', 'fort', 'ref', 'will', 'init', 'melee', 'ranged', 'cmb', 'cmd']) {
        out[k] = D[k]?.total;
    }
    return out;
});

/** The positive Dex contribution each block currently counts (parts labelled "Dex ..."). */
const dexParts = (page) => page.evaluate(() => {
    const B = window.SheetDerive.computeDerived(window.SheetApp.current).blocks;
    const dex = (blk) => (blk.parts || []).filter((p) => /^Dex/.test(p.label)).reduce((a, p) => a + p.value, 0);
    return { ac: dex(B.ac), touch: dex(B.touch), cmd: dex(B.cmd) };
});

/** A skill's total as the Skills tab prints it (the sheet's one skill-math path). */
async function skillTotal(page, id) {
    await gotoTab(page, 'skills');
    const txt = await page.locator(`.tab-pane[data-tab="skills"] tr[data-skill="${id}"] .skill-total`).first().innerText();
    return Number(txt.replace('−', '-').replace('+', ''));
}

/** Add an AC buff through the "+" button of a section, then return its row. */
async function addBuff(page, subtype) {
    await gotoTab(page, 'buffs');
    await buffsPane(page).locator(`.buffs-section[data-buff-subtype="${subtype}"] .buffs-section-controls button`, { hasText: /^\+$/ }).click();
}

test('Shaken from the tray lowers attack, CMB, saves and skills by 2 (and Clear restores them)',
    feature('conditions.mechanical'), async ({ page }) => {
        await openSheet(page);
        const before = await blocks(page);
        const perBefore = await skillTotal(page, 'per');

        await gotoTab(page, 'buffs');
        const chip = buffsPane(page).locator('.condition-chip', { hasText: /^Shaken$/ });
        await expect(chip).toHaveAttribute('aria-pressed', 'false');
        await chip.click();
        await expect(buffsPane(page).locator('.condition-chip.is-active', { hasText: 'Shaken' })).toBeVisible();

        const after = await blocks(page);
        expect(after.melee).toBe(before.melee - 2);
        expect(after.ranged).toBe(before.ranged - 2);
        expect(after.cmb).toBe(before.cmb - 2);
        for (const s of ['fort', 'ref', 'will']) expect(after[s]).toBe(before[s] - 2);
        expect(after.ac).toBe(before.ac);
        expect(await skillTotal(page, 'per')).toBe(perBefore - 2);

        // Clearing the chip undoes every number.
        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.condition-chip', { hasText: /^Shaken$/ }).click();
        expect(await blocks(page)).toEqual(before);
        expect(await skillTotal(page, 'per')).toBe(perBefore);
    });

test('Flat-footed drops the positive Dex bonus from AC, touch and CMD; a Dex penalty is kept',
    feature('conditions.lose-dex'), async ({ page }) => {
        await openSheet(page);
        // The demo cleric carries so much gear that load caps Dex at +1; whatever Dex the sheet
        // actually counts is what the condition has to remove (and it must be positive to matter).
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.dex = 16;
            d.armor_max_dex_bonus = '';
            window.SheetApp.renderSheet(d);
        });
        const base = await blocks(page);
        const dex = await dexParts(page);
        expect(dex.ac).toBeGreaterThan(0);
        expect(dex.cmd).toBeGreaterThan(0);

        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.condition-chip', { hasText: /^Flat-footed$/ }).click();
        const ff = await blocks(page);
        expect(ff.ac).toBe(base.ac - dex.ac);
        expect(ff.touch).toBe(base.touch - dex.touch);
        expect(ff.cmd).toBe(base.cmd - dex.cmd);
        expect(ff.fort).toBe(base.fort);
        // Flat-footed AC was already without Dex, so it does not drop further.
        expect(ff.flat).toBe(base.flat);
        // The AC part says why.
        const label = await page.evaluate(() => window.SheetDerive.computeDerived(window.SheetApp.current).blocks.ac.parts
            .find((p) => /^Dex/.test(p.label)).label);
        expect(label).toMatch(/denied.*flat-footed/);

        // A Dex PENALTY is not "denied": the sheet keeps it with or without the condition.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.dex = 6;
            d.armor_max_dex_bonus = '';
            window.SheetApp.renderSheet(d);
            window.SheetApp.setActiveTab('buffs');
        });
        expect((await dexParts(page)).ac).toBeLessThan(0);
        const penalised = await blocks(page);
        await buffsPane(page).locator('.condition-chip.is-active', { hasText: /^Flat-footed$/ }).click();
        expect((await blocks(page)).ac).toBe(penalised.ac);
    });

test('Blinded both denies Dex and costs -2 AC (the table entry, end to end)',
    feature('conditions.lose-dex', 'conditions.mechanical'), async ({ page }) => {
        await openSheet(page);
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            d.dex = 16;
            d.armor_max_dex_bonus = '';
            window.SheetApp.renderSheet(d);
        });
        const base = await blocks(page);
        const dex = await dexParts(page);
        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.condition-chip', { hasText: /^Blinded$/ }).click();
        const blind = await blocks(page);
        expect(blind.ac).toBe(base.ac - dex.ac - 2);
        expect(blind.touch).toBe(base.touch - dex.touch - 2);
    });

test('a buff with an AC change: Active raises AC, unticking removes it, duplicate and delete work',
    feature('buffs.categories'), async ({ page }) => {
        await openSheet(page);
        const base = (await blocks(page)).ac;
        await addBuff(page, 'temp');

        const temp = buffsPane(page).locator('.buffs-section[data-buff-subtype="temp"]');
        const row = temp.locator('.buffs-row[data-buff-id]');
        await expect(row).toHaveCount(1);
        await expect(row.locator('.buff-source-name')).toHaveText('New temporary buff');
        // The "+" seeds a +1 untyped AC change and starts Active.
        await expect(row.locator('input[type=checkbox]')).toBeChecked();
        expect((await blocks(page)).ac).toBe(base + 1);

        await row.locator('input[type=checkbox]').uncheck();
        expect((await blocks(page)).ac).toBe(base);
        await expect(temp.locator('.buffs-row.buff-off')).toHaveCount(1);
        await temp.locator('.buffs-row[data-buff-id] input[type=checkbox]').check();
        expect((await blocks(page)).ac).toBe(base + 1);

        // Duplicate: a copy lands inactive (so AC is unchanged), then it can be switched on too.
        await temp.locator('.buffs-row[data-buff-id]').first().locator('button[title="Duplicate buff"]').click();
        await expect(temp.locator('.buffs-row[data-buff-id]')).toHaveCount(2);
        await expect(temp.locator('.buffs-row[data-buff-id]', { hasText: '(copy)' })).toHaveCount(1);
        expect((await blocks(page)).ac).toBe(base + 1);
        await temp.locator('.buffs-row[data-buff-id]', { hasText: '(copy)' }).locator('input[type=checkbox]').check();
        expect((await blocks(page)).ac).toBe(base + 2);

        // Delete the copy (soft delete with a restore row), then the original.
        await temp.locator('.buffs-row[data-buff-id]', { hasText: '(copy)' }).locator('button[title^="Remove buff"]').click();
        await expect(temp.locator('.buffs-row[data-buff-id]')).toHaveCount(1);
        expect((await blocks(page)).ac).toBe(base + 1);
        await temp.locator('.buffs-row[data-buff-id]').locator('button[title^="Remove buff"]').click();
        await expect(temp.locator('.buffs-row[data-buff-id]')).toHaveCount(0);
        expect((await blocks(page)).ac).toBe(base);
        await expect(buffsPane(page).locator('.buffs-trash-row button')).toContainText('Restore removed (2)');
    });

test('buffs file into their category sections and carry level and duration columns',
    feature('buffs.categories'), async ({ page }) => {
        await openSheet(page);
        for (const sub of ['spell', 'item', 'misc']) await addBuff(page, sub);
        await gotoTab(page, 'buffs');
        for (const [sub, label] of [['spell', 'Spell'], ['item', 'Item'], ['misc', 'Misc']]) {
            const sec = buffsPane(page).locator(`.buffs-section[data-buff-subtype="${sub}"]`);
            await expect(sec.locator('.buffs-section-title')).toHaveText(label);
            await expect(sec.locator('.buffs-row[data-buff-id]')).toHaveCount(1);
        }
        const buffs = await page.evaluate(() => window.SheetApp.current._sheet.buffs.map((b) => b.subType).sort());
        expect(buffs).toEqual(['item', 'misc', 'spell']);
        // Each category row exposes Duration, Level, Active, Edit.
        const row = buffsPane(page).locator('.buffs-row[data-buff-id]').first();
        await expect(row.locator('.buffs-col-dur')).toBeVisible();
        await expect(row.locator('.buffs-col-lv')).toBeVisible();
        await expect(row.locator('.buffs-col-active')).toBeVisible();
        await expect(row.locator('button', { hasText: 'Edit' })).toBeVisible();
    });

test('Browse opens a category grid with counts; Defense lists entries that change AC',
    feature('buffs.effect-finder'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.buffs-section[data-buff-subtype="item"] button', { hasText: 'Browse' }).click();

        const finder = page.locator('#buff-finder');
        await expect(finder).toBeVisible();
        const tiles = finder.locator('.buff-finder-tile');
        await expect(tiles).toHaveCount(10);
        const defense = finder.locator('.buff-finder-tile', { hasText: 'Defense' });
        const n = Number(await defense.locator('.buff-finder-count').innerText());
        expect(n).toBeGreaterThan(0);
        await expect(finder.locator('.buff-finder-tile', { hasText: 'Hit points' })).toBeVisible();

        await defense.click();
        const results = finder.locator('.buff-finder-result');
        await expect(results.first()).toBeVisible();
        // Every listed entry prints the change that put it in this category (AC, CMD, natural
        // armor, SR ... all file under Defense), and AC itself is among them.
        await expect(results.first().locator('.catalog-result-sub')).toBeVisible();
        const subs = await results.locator('.catalog-result-sub').allInnerTexts();
        expect(subs.length).toBeGreaterThan(0);
        for (const s of subs) expect(s).toContain('→');
        expect(subs.some((s) => /\u2192\s*AC(\s|$)/.test(s)), subs.join(" | ")).toBe(true);

        // Narrowing works and picking adds a buff to the section it was opened from.
        await finder.locator('input[type=search]').fill('shield');
        await expect(results.first()).toContainText('Shield');
        const first = (await results.first().locator('.catalog-result-name').innerText()).replace(/\s+\w+$/, '').trim();
        await results.first().click();
        await expect(finder).toHaveCount(0);
        const added = await page.evaluate(() => window.SheetApp.current._sheet.buffs.map((b) => [b.name, b.subType]));
        expect(added.length).toBe(1);
        expect(added[0][1]).toBe('item');
        expect(first.toLowerCase()).toContain(added[0][0].toLowerCase().slice(0, 4));
        await expect(buffsPane(page).locator('.buffs-section[data-buff-subtype="item"] .buffs-row[data-buff-id]')).toHaveCount(1);
    });

test('saving the active buffs as a preset, then applying it, re-activates them',
    feature('buffs.presets'), async ({ page }) => {
        await openSheet(page);
        const base = (await blocks(page)).ac;
        await addBuff(page, 'temp');
        await addBuff(page, 'spell');
        expect((await blocks(page)).ac).toBe(base + 2);

        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.buff-preset-name').fill('Battle prep');
        await buffsPane(page).locator('.buff-presets button', { hasText: 'Save set' }).click();
        const chip = buffsPane(page).locator('.buff-preset-chip');
        await expect(chip).toHaveText('Battle prep (2)');

        // Click the chip: all members are on, so it switches them off.
        await chip.click();
        expect((await blocks(page)).ac).toBe(base);
        await expect(buffsPane(page).locator('.buffs-row.buff-off')).toHaveCount(2);
        // Click again: applies the preset, both back on.
        await buffsPane(page).locator('.buff-preset-chip').click();
        expect((await blocks(page)).ac).toBe(base + 2);
        await expect(buffsPane(page).locator('.buffs-row.buff-off')).toHaveCount(0);

        // Deleting the preset keeps the buffs.
        await buffsPane(page).locator('.buff-preset-del').click();
        await expect(buffsPane(page).locator('.buff-preset-chip')).toHaveCount(0);
        expect((await blocks(page)).ac).toBe(base + 2);

        // With nothing active there is nothing to save.
        await page.evaluate(() => { for (const b of window.SheetApp.current._sheet.buffs) b.active = false; window.SheetApp.renderSheet(window.SheetApp.current); window.SheetApp.setActiveTab('buffs'); });
        await buffsPane(page).locator('.buff-presets button', { hasText: 'Save set' }).click();
        await expect(page.locator('#sheet-toast')).toContainText('No active buffs to save');
    });

test('applying the Advanced template adds a Template buff that changes derived numbers; unticking reverses them',
    feature('buffs.templates'), async ({ page }) => {
        await openSheet(page);
        const base = await blocks(page);
        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.buffs-section[data-buff-subtype="template"] button', { hasText: 'Templates' }).click();
        const dialog = page.locator('.template-picker');
        await expect(dialog.locator('.template-row:not(.is-rebuild)')).toHaveCount(7);
        await dialog.locator('.template-row', { hasText: 'Advanced' }).first().locator('button', { hasText: 'Apply' }).click();
        await expect(dialog.locator('.template-row.is-applied', { hasText: 'Advanced' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);

        const tpl = buffsPane(page).locator('.buffs-section[data-buff-subtype="template"] .buffs-row[data-buff-id]');
        await expect(tpl).toHaveCount(1);
        await expect(tpl.locator('.buff-source-name')).toContainText('Advanced');
        const adv = await blocks(page);
        // +2 natural armor, +4 Str/Dex/Con/Wis/Cha: AC, attack, saves, init all move.
        expect(adv.ac).toBeGreaterThan(base.ac);
        expect(adv.melee).toBeGreaterThan(base.melee);
        expect(adv.fort).toBeGreaterThan(base.fort);
        expect(adv.init).toBeGreaterThan(base.init);

        await tpl.locator('input[type=checkbox]').uncheck();
        expect(await blocks(page)).toEqual(base);
        await buffsPane(page).locator('.buffs-section[data-buff-subtype="template"] .buffs-row[data-buff-id] input[type=checkbox]').check();
        expect(await blocks(page)).toEqual(adv);
        // × removes it entirely.
        await buffsPane(page).locator('.buffs-section[data-buff-subtype="template"] button[title^="Remove buff"]').click();
        expect(await blocks(page)).toEqual(base);
    });

test('an always-on source shows in Permanent; untick drops its change; × removes it; Restore brings it back',
    feature('buffs.permanent-sources'), async ({ page }) => {
        await openSheet(page);
        await gotoTab(page, 'buffs');
        const rows = buffsPane(page).locator('.buffs-section[data-buff-subtype="perm"] .buffs-row-derived');
        await expect(rows.first()).toBeVisible();

        // Pick a source with an AC change if there is one, else any numeric source.
        const pick = await page.evaluate(() => {
            const ch = window.SheetDetails.collectChanges(window.SheetApp.current).changes
                .filter((c) => !['buff', 'condition', 'combat', 'marquee', 'wound'].includes(c.sourceKind));
            const bySource = new Map();
            for (const c of ch) {
                const k = c.sourceKind + '::' + c.source;
                (bySource.get(k) || bySource.set(k, []).get(k)).push(c);
            }
            for (const [, list] of bySource) {
                if (list.length === 1 && /^\+?-?\d+$/.test(String(list[0].formula).trim())
                    && Number(list[0].formula) && ['ac', 'attack', 'fort', 'ref', 'will', 'init'].includes(list[0].target)) {
                    return { source: list[0].source, kind: list[0].sourceKind, target: list[0].target };
                }
            }
            return null;
        });
        expect(pick).not.toBeNull();
        const ledgerHas = () => page.evaluate(({ source, kind }) =>
            window.SheetDetails.collectChanges(window.SheetApp.current).changes.length
            && window.SheetDerive.effectiveLedger(window.SheetApp.current).changes
                .some((c) => c.source === source && c.sourceKind === kind), pick);
        const row = () => buffsPane(page).locator('.buffs-row-derived', { has: page.locator('.buff-source-name', { hasText: new RegExp('^' + pick.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();

        await expect(row()).toBeVisible();
        await expect(row().locator('.buffs-col-dur')).toHaveText('Permanent');
        expect(await ledgerHas()).toBe(true);

        // Untick: row stays (dimmed), its change leaves the active ledger.
        await row().locator('input[type=checkbox]').uncheck();
        await expect(row()).toHaveClass(/buff-off/);
        expect(await ledgerHas()).toBe(false);
        await row().locator('input[type=checkbox]').check();
        expect(await ledgerHas()).toBe(true);

        // × (confirm) removes the row and the change; Restore brings both back.
        page.once('dialog', (dlg) => dlg.accept());
        await row().locator('button', { hasText: '×' }).click();
        await expect(row()).toHaveCount(0);
        expect(await ledgerHas()).toBe(false);
        const restore = buffsPane(page).locator('.buffs-trash-row button');
        await expect(restore).toContainText('Restore removed');
        await restore.click();
        await expect(row()).toBeVisible();
        expect(await ledgerHas()).toBe(true);
    });

test('a buff that grants DR shows a chip on Defenses while active and loses it when switched off',
    feature('defenses.buff-granted-chips'), async ({ page }) => {
        await openSheet(page);
        // The grant itself is authored on the buff (data); the chip is what the UI must show.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            const b = window.SheetState.createBuff(d, { name: 'Stoneskin', subType: 'spell', seedDefault: false, changes: [] });
            b.grants = { dr: [{ amount: 10, bypass: 'adamantine' }], resist: [{ type: 'fire', amount: 5 }] };
            window.SheetApp.renderSheet(d);
        });
        await gotoTab(page, 'defenses');
        const def = page.locator('.tab-pane[data-tab="defenses"]');
        const chips = def.locator('.def-chip-granted');
        await expect(chips).toHaveCount(2);
        const dr = def.locator('.def-chip-granted', { hasText: '/adamantine' });
        await expect(dr).toBeVisible();
        await expect(dr).toContainText('10');
        await expect(dr).toHaveAttribute('title', /From Stoneskin/);
        // Granted chips are read-only: no remove button.
        await expect(dr.locator('button')).toHaveCount(0);
        await expect(def.locator('.def-chip-granted', { hasText: /Fire/i })).toContainText('5');

        // Switch the buff off on the Buffs tab; the chips go.
        await gotoTab(page, 'buffs');
        await buffsPane(page).locator('.buffs-row[data-buff-id]', { hasText: 'Stoneskin' }).locator('input[type=checkbox]').uncheck();
        await gotoTab(page, 'defenses');
        await expect(def.locator('.def-chip-granted')).toHaveCount(0);
    });

test('Rest restores HP, spell slots and feature uses (and itemizes it in a toast)',
    feature('rest.full-rest'), async ({ page }) => {
        await openSheet(page);
        // Run it low first: HP down, every slot spent, a feature pool half empty.
        const setup = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const st = window.SheetState.sheetState(d);
            const level = Number(d.level) || 1;
            st.hpCurrent = Math.max(1, Number(d.Total_HP) - 50);
            st.spellCastsRemaining = d.day_list.map(() => 0);
            st.featureUses = { 'Channel Energy': { value: 0, max: 5 } };
            st.abilityAdjust = { str: { damage: 3 } };
            window.SheetApp.renderSheet(d);
            return { level, hp: st.hpCurrent, max: Number(d.Total_HP), days: d.day_list.map((n) => Number(n) || 0) };
        });
        await gotoTab(page, 'summary');
        await page.locator('.tab-pane[data-tab="summary"] .quick-action-btn', { hasText: /^Rest$/ }).click();

        const after = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const st = window.SheetState.sheetState(d);
            return {
                hp: st.hpCurrent,
                slots: st.spellCastsRemaining,
                uses: st.featureUses['Channel Energy'].value,
                strDmg: st.abilityAdjust.str.damage,
            };
        });
        expect(after.hp).toBe(Math.min(setup.max, setup.hp + setup.level));
        expect(after.slots).toEqual(setup.days);
        expect(after.uses).toBe(5);
        expect(after.strDmg).toBe(2);
        await expect(page.locator('#sheet-toast')).toContainText('Rest');
        await expect(page.locator('#sheet-toast')).toContainText('slots & uses restored');
    });
