// Damage calculator acceptance tests (#146): incoming damage through DR / ER / immunity, one
// click to apply, the breakdown on a roll-log card, and an Undo that restores HP exactly.
import { test, expect, openSheet, gotoTab, feature, fixture } from './helpers.mjs';

// The wizard fixture (Total_HP 28) with defenses typed onto the sheet: DR 5/silver,
// fire resistance 10, immune to acid, vulnerable to cold.
function defendedWizard() {
    const data = fixture('wizard');
    data._sheet = {
        ...(data._sheet || {}),
        defenses: {
            dr: [{ amount: 5, bypass: 'silver' }],
            resist: [{ type: 'fire', amount: 10 }],
            dmgImmune: [{ type: 'acid' }],
            dmgVuln: [{ type: 'cold' }],
            condResist: [],
            condImmune: [],
        },
    };
    return data;
}

// Current HP as the sheet reads it: an untouched character is at max.
const hp = (page) => page.evaluate(() => {
    const d = window.SheetApp.current;
    const cur = d._sheet?.hpCurrent;
    return cur == null || cur === '' ? Number(d.Total_HP) : Number(cur);
});
const calc = (page) => page.locator('.tab-pane[data-tab="defenses"] #dmg-calc');

async function enterParts(page, parts) {
    const c = calc(page);
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) await c.locator('.dmg-calc-add').click();
        const row = c.locator('.dmg-calc-row').nth(i);
        await row.locator('.dmg-calc-type').selectOption(parts[i].type);
        await row.locator('.dmg-calc-amt').fill(String(parts[i].amount));
    }
}

const check = (page, label) => calc(page).locator('.dmg-calc-check', {
    has: page.locator('.dmg-calc-check-label', { hasText: label }),
});

test('12 slashing + 6 fire: DR and fire resistance apply, Apply takes the net, Undo restores it (#146)',
    feature('damage.calculator'), async ({ page }) => {
        await openSheet(page, { fixture: defendedWizard() });
        await gotoTab(page, 'defenses');
        await enterParts(page, [{ amount: 12, type: 'slashing' }, { amount: 6, type: 'fire' }]);

        await expect(check(page, 'DR 5/silver')).toHaveClass(/is-applied/);
        await expect(check(page, 'DR 5/silver')).toContainText('12 → 7');
        await expect(check(page, 'Resist fire 10')).toHaveClass(/is-applied/);
        await expect(check(page, 'Immune: acid')).toHaveClass(/is-idle/);
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('7');

        await calc(page).locator('.dmg-calc-apply').click();
        await expect.poll(() => hp(page)).toBe(28 - 7);
        // The breakdown is on the roll-log card.
        const card = page.locator('#tools-log .roll-card').first();
        await expect(card.locator('.roll-card-title')).toHaveText('Damage taken');
        await expect(card).toContainText('DR 5/silver: 12 → 7');
        await expect(card).toContainText('fire resist 10: 6 → 0');
        // Undo in the toast puts HP back exactly as it was (untouched → unset).
        const toast = page.locator('#sheet-toast');
        await expect(toast).toContainText('7 damage');
        await toast.locator('.sheet-toast-action').click();
        await expect.poll(() => hp(page)).toBe(28);
        await expect(card.locator('.roll-card-sub')).toContainText('undone');
    });

test('silver bypasses DR/silver; a spell ignores DR; immunity and vulnerability apply (#146)',
    feature('damage.calculator'), async ({ page }) => {
        await openSheet(page, { fixture: defendedWizard() });
        await gotoTab(page, 'defenses');
        await enterParts(page, [{ amount: 12, type: 'slashing' }]);
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('7');

        await calc(page).locator('.dmg-calc-chip[data-bypass="silver"]').click();
        await expect(check(page, 'DR 5/silver')).toHaveClass(/is-bypassed/);
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('12');

        await calc(page).locator('.dmg-calc-chip[data-bypass="silver"]').click();
        await calc(page).locator('input[data-opt="spell"]').check();
        await expect(check(page, 'DR 5/silver')).toContainText('spells ignore DR');
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('12');

        await calc(page).locator('.dmg-calc-row').first().locator('.dmg-calc-type').selectOption('acid');
        await expect(check(page, 'Immune: acid')).toHaveClass(/is-applied/);
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('0');

        await calc(page).locator('.dmg-calc-row').first().locator('.dmg-calc-type').selectOption('cold');
        await expect(check(page, 'Vulnerable: cold')).toContainText('12 → 18');
        await calc(page).locator('input[data-opt="half"]').check();
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('9');
    });

test('DR granted by an active buff counts, and the larger DR wins (#146)',
    feature('damage.calculator'), async ({ page }) => {
        const data = defendedWizard();
        data._sheet.buffs = [{
            id: 'buff-stoneskin', name: 'Stoneskin', subType: 'spell', active: true, changes: [],
            grants: { dr: [{ amount: 10, bypass: 'adamantine' }] },
        }];
        await openSheet(page, { fixture: data });
        await gotoTab(page, 'defenses');
        await enterParts(page, [{ amount: 12, type: 'piercing' }]);
        await expect(check(page, 'DR 10/adamantine')).toHaveClass(/is-applied/);
        await expect(check(page, 'DR 5/silver')).toHaveClass(/is-unused/);
        await expect(calc(page).locator('.dmg-calc-net-value')).toHaveText('2');
    });

test('roll-log Apply routes spell and freeform damage through the calculator (#146)',
    feature('damage.calculator'), async ({ page }) => {
        await openSheet(page, { fixture: defendedWizard() });
        await page.waitForFunction(() => window.SheetDetails.lookup('spells', 'Fireball'));
        // Spell damage is typed from its description: Fireball is fire, Flame Strike is not
        // trusted to a single type.
        const inferred = await page.evaluate(() => ({
            fireball: window.SheetDamageCalc.inferSpellTypes(window.SheetDetails.lookup('spells', 'Fireball')?.description),
            flameStrike: window.SheetDamageCalc.inferSpellTypes(window.SheetDetails.lookup('spells', 'Flame Strike')?.description),
        }));
        expect(inferred).toEqual({ fireball: ['fire'], flameStrike: [] });

        // Freeform 8 fire: resistance 10 eats all of it, so HP is untouched.
        await page.evaluate(() => window.SheetRoll.setOpen(true));
        await page.locator('#tools-damage-row .tools-dmg-formula').fill('8');
        await page.locator('#tools-damage-row .tools-dmg-type').selectOption('fire');
        await page.locator('#tools-damage-row .tools-dmg-go').click();
        const card = page.locator('#tools-log .roll-card').first();
        await card.locator('.roll-card-apply-btn', { hasText: 'Apply 8' }).click();
        await expect(card.locator('.roll-card-mitigation')).toContainText('fire resist 10: 8 → 0');
        expect(await hp(page)).toBe(28);

        // A cast Fireball posts a fire-typed block; Apply runs it through resistance.
        await page.evaluate(() => window.SheetRoll.rollSpellCast({
            name: 'Fireball', level: 3, data: window.SheetApp.current,
            spellData: window.SheetDetails.lookup('spells', 'Fireball'), casterLevel: 5, castingMod: 3,
        }));
        const spellCard = page.locator('#tools-log .roll-card').first();
        const dmgBlock = spellCard.locator('.roll-card-damage');
        const rolled = Number(await dmgBlock.locator('.roll-card-result').textContent());
        await dmgBlock.locator('.roll-card-apply-btn').first().click();
        await expect(dmgBlock.locator('.roll-card-mitigation')).toContainText('fire resist 10');
        await expect.poll(() => hp(page)).toBe(28 - Math.max(0, rolled - 10));

        // ⚖ opens the same block pre-filled in the Defenses-tab calculator.
        await dmgBlock.locator('.roll-card-calc-btn').click();
        await expect(page.locator('.tab-pane[data-tab="defenses"]')).toBeVisible();
        await expect(calc(page).locator('.dmg-calc-type').first()).toHaveValue('fire');
        await expect(calc(page).locator('.dmg-calc-amt').first()).toHaveValue(String(rolled));
        await expect(calc(page).locator('input[data-opt="spell"]')).toBeChecked();
    });

test('evaluate() is pure and pools physical parts into one DR application (#146)',
    feature('damage.calculator'), async ({ page }) => {
        await openSheet(page);
        const res = await page.evaluate(() => window.SheetDamageCalc.evaluate(
            { parts: [{ amount: 4, types: ['slashing'] }, { amount: 3, types: ['bludgeoning'] }], bypass: [] },
            { dr: [{ amount: 5, bypass: '—' }] }));
        // DR applies once to the pooled 7, not to each part (which would leave 0).
        expect(res.total).toBe(2);
        expect(res.buckets).toHaveLength(1);
    });
