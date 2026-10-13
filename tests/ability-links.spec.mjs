// Ability links + carry modifiers acceptance tests (#157): Settings picks which ability drives
// HP, saves, initiative, CMB, melee, ranged, AC/touch and CMD; Inventory adds a carry Str bonus and
// a multiplier, with carryStr / carryMult ledger changes on top.
import { test, expect, openSheet, gotoTab, feature } from './helpers.mjs';

const derived = (page) => page.evaluate(() => {
    const d = window.SheetApp.current;
    const b = window.SheetDerive.computeDerived(d).blocks;
    const m = (ab) => window.SheetDerive.abModOf(d, ab);
    return {
        mods: { str: m('str'), dex: m('dex'), con: m('con'), int: m('int'), wis: m('wis'), cha: m('cha') },
        cmb: b.cmb.total, ac: b.ac.total, touch: b.touch.total, will: b.will.total, init: b.init.total,
        hp: b.hp.total, cmd: b.cmd.total, cmdFF: b.cmdFF.total, level: Number(d.level) || 0,
    };
});

test('Settings ability links re-point CMB, AC/touch, Will, init, CMD and HP (#157)',
    feature('attributes.ability-links'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        const before = await derived(page);
        await gotoTab(page, 'settings');
        const pick = async (key, ab) => {
            await page.locator(`.ability-link-select[data-link="${key}"]`).selectOption(ab);
        };
        await pick('cmb', 'dex');
        await pick('ac', 'wis');
        await pick('will', 'cha');
        await pick('init', 'wis');
        await pick('cmdDex', 'wis');
        await pick('hp', 'cha');
        const after = await derived(page);
        const m = before.mods;
        expect(after.cmb - before.cmb).toBe(m.dex - m.str);
        expect(after.will - before.will).toBe(m.cha - m.wis);
        expect(after.init - before.init).toBe(m.wis - m.dex);
        expect(after.cmd - before.cmd).toBe(m.wis - m.dex);
        expect(after.cmdFF).toBe(before.cmdFF);
        expect(after.hp - before.hp).toBe((m.cha - m.con) * before.level);
        // AC / touch: Wis replaces Dex (armour and load caps still apply to it).
        const acPart = await page.evaluate(() => window.SheetDerive.computeDerived(window.SheetApp.current)
            .blocks.touch.parts.find((p) => p.kind === 'ability').label);
        expect(acPart).toMatch(/^Wisdom/);
        // The changed rows are marked; resetting to the default drops the stored key.
        await expect(page.locator('.ability-link.is-changed')).toHaveCount(6);
        await pick('cmb', 'str');
        const stored = await page.evaluate(() => window.SheetApp.current._sheet.abilityLinks);
        expect(stored.cmb).toBeUndefined();
        expect(stored.ac).toBe('wis');
        expect((await derived(page)).cmb).toBe(before.cmb);
    });

test('the melee attack roll follows the melee link (#157)',
    feature('attributes.ability-links'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        const ctx = await page.evaluate(() => {
            const d = window.SheetApp.current;
            const a = window.SheetRoll.attackContext();
            window.SheetState.sheetState(d).abilityLinks = { melee: 'wis' };
            const b = window.SheetRoll.attackContext();
            return { a: a?.meleeBonus, b: b?.meleeBonus, str: window.SheetDerive.abModOf(d, 'str'), wis: window.SheetDerive.abModOf(d, 'wis'), melee: window.SheetDerive.computeDerived(d).blocks.melee.parts.find((p) => p.kind === 'ability').label };
        });
        expect(ctx.melee).toBe('Wisdom');
        expect(ctx.b - ctx.a).toBe(ctx.wis - ctx.str);
    });

test('Inventory: carry Str bonus and multiplier rescale the load bands; carryMult changes stack (#157)',
    feature('attributes.ability-links'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        const lim = () => page.evaluate(() => window.SheetDerive.carryCapacity(window.SheetApp.current));
        const base = await lim();
        const raw = await page.evaluate((s) => window.SheetDerive.carryLimits(s), base.str + 4);
        await gotoTab(page, 'inventory');
        await page.evaluate(() => window.SheetRoll.setOpen(false));
        await page.locator('.inv-carry-input[data-carry="strBonus"]').fill('4');
        await page.locator('.inv-carry-input[data-carry="strBonus"]').press('Enter');
        await expect.poll(async () => (await lim()).lim.heavy).toBe(raw.heavy);
        await page.locator('.inv-carry-input[data-carry="mult"]').fill('1.5');
        await page.locator('.inv-carry-input[data-carry="mult"]').press('Enter');
        await expect.poll(async () => (await lim()).lim.heavy).toBe(Math.floor(raw.heavy * 1.5));
        await expect(page.locator('.inv-load-seg.load-heavy')).toContainText(String(Math.floor(raw.heavy * 1.5)));

        // Ant Haul as a buff: carryMult +2 → ×3.5 with the ×1.5 input.
        await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Ant Haul', subType: 'spell', active: true,
                changes: [{ formula: '2', target: 'carryMult', type: 'untyped' }],
            }));
            window.SheetApp.renderSheet(d);
        });
        expect((await lim()).mult).toBe(3.5);
        expect((await lim()).lim.heavy).toBe(Math.floor(raw.heavy * 3.5));
    });

test('rolled attacks use the effective Str (a belt counts), matching the displayed bonus (#157)',
    feature('attributes.ability-links'), async ({ page }) => {
        await openSheet(page, { fixture: 'demo-cleric' });
        const r = await page.evaluate(() => {
            const d = window.SheetApp.current;
            window.SheetState.ensureBuffs(d).push(window.SheetState.normalizeBuffEntry({
                name: 'Belt test', subType: 'item', active: true,
                changes: [{ formula: '6', target: 'str', type: 'enhancement' }],
            }));
            window.SheetApp.renderSheet(d);
            const c = window.SheetRoll.attackContext();
            return { roll: c.meleeBonus, shown: window.SheetDerive.computeDerived(d).blocks.melee.total };
        });
        expect(r.roll).toBe(r.shown);
    });
