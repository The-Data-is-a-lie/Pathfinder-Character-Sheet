// Spells acceptance tests for the ledger: extra spellbooks, metamagic, concentration / CL
// rolls, casting rules, slot-table badges, the cast card and the Psionics tab.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const pane = (page) => page.locator('.tab-pane[data-tab="spells"]');
const mainBook = (page) => pane(page).locator('.spellbook-block').first();
const bookById = (page, id) => pane(page).locator(`.spellbook-block[data-book-id="${id}"]`);

/** Mutate the character in the page, then repaint the Spells tab. */
async function mutate(page, fn, arg) {
    await page.evaluate(({ src, arg }) => {
        const d = window.SheetApp.current;
        // eslint-disable-next-line no-new-func
        new Function('d', 'arg', src)(d, arg);
        window.SheetApp.renderSheet(d);
        window.SheetApp.setActiveTab('spells');
    }, { src: `(${fn.toString()})(d, arg)`, arg });
}

const casts = (page) => page.evaluate(() => [...window.SheetApp.current._sheet.spellCastsRemaining]);
const extraCasts = (page, i = 0) => page.evaluate((n) => [...window.SheetApp.current._sheet.extraSpellbooks[n].casts], i);

/** Click a row's Cast button; confirm the metamagic picker if it opens (no boxes ticked). */
async function castRow(page, row, { pickerOk = true } = {}) {
    await page.evaluate(() => window.SheetRoll.setOpen(false));
    await row.locator('.spell-cast-btn').click();
    if (pickerOk) {
        const mm = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
        if (await mm.count()) await mm.click();
    }
}

const levelRow = (book, level, name) =>
    book.locator(`.spell-level-block[data-spell-level="${level}"] .spell-prep-row[data-dnd-id="${name}"]`);

/** Wizard with known spells added to the main book (prepared once). */
async function wizardWithSpells(page) {
    await openSheet(page, { fixture: 'wizard' });
    await gotoTab(page, 'spells');
    await mutate(page, (d) => {
        const add = (lv, name) => {
            if (!d.spell_list_choose_from[lv].includes(name)) d.spell_list_choose_from[lv].push(name);
            while (d.spells_prepared_names.length <= lv) d.spells_prepared_names.push([]);
            if (!d.spells_prepared_names[lv].includes(name)) d.spells_prepared_names[lv].push(name);
        };
        add(1, 'Magic Missile');
        add(3, 'Fireball');
    });
}

test('a second spellbook has its own ability and CL, and casting there spends only its slots',
    feature('spells.multi-book'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await expect(pane(page).locator('.spellbook-block')).toHaveCount(1);
        const mainBefore = await casts(page);

        page.once('dialog', (dlg) => dlg.accept('Cleric'));
        await pane(page).locator('.spellbook-add').click();
        await expect(pane(page).locator('.spellbook-block')).toHaveCount(2);
        const second = pane(page).locator('.spellbook-block').nth(1);
        await expect(second.locator('input.spellbook-name')).toHaveValue('Cleric');

        // Own ability: switch to WIS in the UI. Own CL/slots/list: written to the book record.
        await second.locator('select.spell-cast-ability').selectOption('wis');
        const id = await page.evaluate(() => window.SheetApp.current._sheet.extraSpellbooks[0].id);
        expect(await page.evaluate(() => window.SheetApp.current._sheet.extraSpellbooks[0].castAb)).toBe('wis');
        await mutate(page, (d) => {
            const b = d._sheet.extraSpellbooks[0];
            b.cl = 3;
            b.dayList = [3, 4, 2];
            b.casts = [3, 4, 2];
            b.lists = [[], ['Bless'], []];
        });
        const book = bookById(page, id);
        const want = await page.evaluate(() => window.SheetDerive.abModOf(window.SheetApp.current, 'wis'));
        await expect(book.locator('.kv', { hasText: 'Concentration' })).toContainText(`(CL 3 + WIS ${want >= 0 ? '+' : ''}${want})`);
        // The main book keeps its own (higher) CL.
        const mainCl = Number((await mainBook(page).locator('.spellbook-ranges').getAttribute('title')).match(/At CL (\d+)/)[1]);
        expect(mainCl).toBeGreaterThan(3);
        await expect(book.locator('.spellbook-ranges')).toHaveAttribute('title', /At CL 3/);

        await castRow(page, levelRow(book, 1, 'Bless'));
        await expect.poll(() => extraCasts(page)).toEqual([3, 3, 2]);
        expect(await casts(page)).toEqual(mainBefore);
    });

test('with a metamagic feat known, Cast opens the picker and a +N feat spends a slot N levels higher',
    feature('spells.metamagic'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await wizardWithSpells(page);
        await mutate(page, (d) => { d.feats.push('Empower Spell'); });
        await expect(mainBook(page).locator('.kv', { hasText: 'Metamagic' })).toContainText('Empower Spell');
        const before = await casts(page);

        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await levelRow(mainBook(page), 1, 'Magic Missile').locator('.spell-cast-btn').click();
        const picker = page.locator('.sheet-overlay .mm-picker');
        await expect(picker).toBeVisible();
        await expect(picker.locator('.mm-summary')).toContainText('Cast plain from a level 1 slot');
        await picker.locator('.mm-row', { hasText: 'Empower Spell' }).locator('input').check();
        await expect(picker.locator('.mm-summary')).toContainText('Cast from a level 3 slot');
        await page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' }).click();

        await expect.poll(() => casts(page)).toEqual(before.map((n, i) => (i === 3 ? n - 1 : n)));
        const card = page.locator('#tools-log .roll-card').first();
        await expect(card).toContainText('Magic Missile');
        await expect(card).toContainText('Empower Spell — cast from a level 3 slot');
    });

test('Maximize (+3) cast of a 1d4+1 spell is maximised and spends a level-4 slot',
    feature('spells.metamagic'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await wizardWithSpells(page);
        await mutate(page, (d) => { d.feats.push('Maximize Spell'); });
        const before = await casts(page);
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await levelRow(mainBook(page), 1, 'Magic Missile').locator('.spell-cast-btn').click();
        const picker = page.locator('.sheet-overlay .mm-picker');
        await picker.locator('.mm-row', { hasText: 'Maximize Spell' }).locator('input').check();
        await expect(picker.locator('.mm-summary')).toContainText('level 4 slot');
        await page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' }).click();
        await expect.poll(() => casts(page)).toEqual(before.map((n, i) => (i === 4 ? n - 1 : n)));
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('maximized');
    });

test('the Concentration and CL-check Roll buttons post d20 rolls with the book\'s bonus',
    feature('spells.conc-cl-rolls'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        const { conc, cl, name } = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const t = document.querySelector('.tab-pane[data-tab="spells"] .spellbook-ranges').title;
            const cl = Number(t.match(/At CL (\d+)/)[1]);
            return { cl, conc: cl + window.SheetDerive.abModOf(d, 'int'), name: d.c_class };
        });
        const sign = (n) => (n >= 0 ? '+' : '') + n;
        const log = page.locator('#tools-log');
        const concBtn = mainBook(page).locator('.kv', { hasText: 'Concentration' }).locator('button').first();
        const clBtn = mainBook(page).locator('.kv', { hasText: 'CL check vs SR' }).locator('button').first();
        await expect(concBtn).toHaveAttribute('title', new RegExp(`1d20${sign(conc).replace('+', '\\+')}`));
        await expect(clBtn).toHaveAttribute('title', new RegExp(`1d20${sign(cl).replace('+', '\\+')}`));

        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await concBtn.click();
        await expect(log).toContainText('Concentration (');
        await expect(log.locator('.tools-log-entry').first()).toContainText(`d20:`);
        await expect(log.locator('.tools-log-entry').first()).toContainText(`${sign(conc)}`);
        await expect(log.locator('.tools-log-entry').first()).toContainText('=');
        await clBtn.click();
        await expect(log).toContainText('Caster level check vs SR (');
        await expect(log.locator('.tools-log-entry').first()).toContainText(`${sign(cl)}`);
        expect(name).toBeTruthy();
    });

test('an opposition-school cast warns and spends a second slot',
    feature('spells.casting-rules'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await wizardWithSpells(page);
        await mutate(page, (d) => {
            d._sheet.spellBookRules = { main: { restricted: 'specialist', label: 'Abjuration', opposition: 'Evocation, Necromancy', conversion: 'none' } };
        });
        const before = await casts(page);
        await castRow(page, levelRow(mainBook(page), 1, 'Magic Missile'));
        await expect(page.locator('#sheet-toast')).toContainText('evocation is an opposition school — costs 2 slots (second slot spent)');
        await expect.poll(() => casts(page)).toEqual(before.map((n, i) => (i === 1 ? n - 2 : n)));
    });

test('a cleric "cure" conversion button spends a slot even when the spell is not prepared',
    feature('spells.casting-rules'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page); // demo-cleric
        await gotoTab(page, 'spells');
        const rules = mainBook(page).locator('.spellbook-rules');
        await expect(mainBook(page).locator('.spell-convert-btn')).toHaveCount(0);
        await rules.locator('select').nth(1).selectOption('cure');
        const conv = mainBook(page).locator('.spell-level-block[data-spell-level="1"] .spell-convert-btn');
        await expect(conv).toHaveText(/Cure Light Wounds/);
        const prepared = await page.evaluate(() => (window.SheetApp.current.spells_prepared_names?.[1] || []).includes('Cure Light Wounds'));
        expect(prepared).toBe(false);
        const before = await casts(page);
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await conv.click();
        const mm = page.locator('.sheet-overlay .inv-btn-primary', { hasText: 'Cast' });
        if (await mm.count()) await mm.click();
        await expect.poll(() => casts(page)).toEqual(before.map((n, i) => (i === 1 ? n - 1 : n)));
        await expect(page.locator('#tools-log .roll-card').first()).toContainText('Cure Light Wounds');
    });

test('a per-day cell off the standard table gets a badge, and Use table fills the row',
    feature('spells.slot-table'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'spells');
        await mutate(page, (d) => { d.day_list[1] = 99; });
        const table = mainBook(page).locator('table.spell-table');
        const badge = table.locator('tr').nth(2).locator('.slot-table-badge'); // header + L0 + L1
        await expect(badge).toBeVisible();
        const want = Number((await badge.textContent()).match(/table: (\d+)/)[1]);
        expect(want).not.toBe(99);
        await mainBook(page).getByRole('button', { name: 'Use table' }).click();
        await expect.poll(() => page.evaluate(() => Number(window.SheetApp.current.day_list[1]))).toBe(want);
        await expect(table.locator('tr').nth(2).locator('.slot-table-badge')).toHaveCount(0);
    });

test('Cast spends one slot, the Left count drops, and the card shows the save DC',
    feature('spells.cast-card'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await wizardWithSpells(page);
        const before = await casts(page);
        const dc = await page.evaluate(() => 13 + window.SheetDerive.abModOf(window.SheetApp.current, 'int'));
        const meta = mainBook(page).locator('.spell-level-block[data-spell-level="3"] .spell-level-meta');
        await expect(meta).toContainText(`${before[3]} left /`);
        await castRow(page, levelRow(mainBook(page), 3, 'Fireball'));
        await expect.poll(() => casts(page)).toEqual(before.map((n, i) => (i === 3 ? n - 1 : n)));
        await expect(mainBook(page).locator('.spell-level-block[data-spell-level="3"] .spell-level-meta')).toContainText(`${before[3] - 1} left /`);
        const card = page.locator('#tools-log .roll-card').first();
        await expect(card).toContainText('Fireball');
        await expect(card).toContainText(`Save: Reflex half · DC ${dc}`);
    });

test('the psion fixture\'s Psionics tab shows the power point pool and powers by level',
    feature('spells.psionics'), async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 950 });
        await openSheet(page, { fixture: 'psion' });
        await gotoTab(page, 'psionics');
        const tab = page.locator('.tab-pane[data-tab="psionics"]');
        const pp = tab.locator('.kv', { hasText: 'Power points' });
        await expect(pp.locator('input')).toHaveValue('32');
        await expect(pp).toContainText('/ 32 per day');
        await expect(tab.locator('.kv', { hasText: 'Manifesting ability' })).toContainText('INT');
        const lv = (n) => tab.locator(`.spell-level-block[data-spell-level="${n}"]`);
        await expect(lv(0)).toContainText('Detect Psionics');
        await expect(lv(0)).toContainText('3 known');
        await expect(lv(1)).toContainText('Inertial Armor');
        await expect(lv(2)).toContainText('Mental Mist');
        await expect(lv(3)).toContainText('Touchsight');
        // The pool is editable and persists on the character.
        await pp.locator('input').fill('20');
        await pp.locator('input').press('Tab');
        await expect.poll(() => page.evaluate(() => Object.values(window.SheetApp.current._sheet.powerPoints || {})[0])).toBe(20);
    });
