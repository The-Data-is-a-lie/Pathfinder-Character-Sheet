// Inline enricher acceptance tests (#147): @Save / @Damage / @Heal tokens and their prose forms
// render as buttons in description text; a save rolls vs its DC, damage applies through the
// #146 calculator, heal heals.
import { test, expect, openSheet, gotoTab, feature, fixture } from './helpers.mjs';

const hp = (page) => page.evaluate(() => {
    const d = window.SheetApp.current;
    const cur = d._sheet?.hpCurrent;
    return cur == null || cur === '' ? Number(d.Total_HP) : Number(cur);
});

// A description rendered through the shared details() helper, the path every feature, spell,
// maneuver and power description takes.
async function mountDescription(page, html) {
    await page.evaluate((body) => {
        window.SheetRoll.setOpen(false); // the drawer opens on every roll and would cover the probe
        const det = window.SheetUI.details('Test feature', body, 'feat-details');
        det.id = 'enrich-probe';
        document.querySelector('.tab-pane[data-tab="features"]').prepend(det);
    }, html);
    const det = page.locator('#enrich-probe');
    await det.locator('summary').click();
    return det;
}

test('scan() finds tokens and prose, and skips scaling dice and formula DCs (#147)',
    feature('text.inline-enrichers'), async ({ page }) => {
        await openSheet(page);
        const got = await page.evaluate(() => {
            const s = (t) => window.SheetEnrich.scan(t).map((m) => [m.kind, m.save || m.formula, m.dc || (m.types || []).join('/')]);
            return {
                token: s('@Save[will;dc=23] @Damage[2d6+3;slashing]{bite} @Heal[1d8]'),
                prose: s('A DC 15 Reflex save halves the 4d6 points of fire damage; a Fortitude save (DC 14) negates.'),
                heal: s('cures a target it hits of 1d6 points of damage'),
                scaling: s('deals 1d6 points of fire damage per caster level and needs a Will save (DC 15 + spell level)'),
                // Channel energy: the first die is only the base of a scaling amount.
                channel: s('is equal to 1d6 points of damage plus 1d6 points of damage for every two cleric levels'),
            };
        });
        expect(got.token).toEqual([['save', 'will', '23'], ['damage', '2d6+3', 'slashing'], ['heal', '1d8', '']]);
        expect(got.prose).toEqual([['save', 'ref', '15'], ['damage', '4d6', 'fire'], ['save', 'fort', '14']]);
        expect(got.heal).toEqual([['heal', '1d6', '']]);
        expect(got.scaling).toEqual([]);
        expect(got.channel).toEqual([]);
    });

test('a save button rolls this character\'s save against the DC (#147)',
    feature('text.inline-enrichers'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await gotoTab(page, 'features');
        const det = await mountDescription(page, '<p>Creatures in the area must make a DC 15 Reflex save or fall prone.</p>');
        const btn = det.locator('.enricher-save');
        await expect(btn).toHaveText('DC 15 Reflex save');
        await btn.click();
        const card = page.locator('#tools-log .roll-card').first();
        await expect(card.locator('.roll-card-title')).toHaveText('Reflex save');
        await expect(card.locator('.roll-card-sub')).toHaveText('DC 15');
        await expect(card).toContainText(/vs DC 15: (Success|Failure)/);
    });

test('a damage button posts a typed block whose Apply goes through the calculator; heal heals (#147)',
    feature('text.inline-enrichers'), async ({ page }) => {
        const data = fixture('wizard');
        data._sheet = { defenses: { dr: [], resist: [{ type: 'fire', amount: 100 }], dmgImmune: [], dmgVuln: [], condResist: [], condImmune: [] } };
        await openSheet(page, { fixture: data });
        await gotoTab(page, 'features');
        const det = await mountDescription(page,
            '<p>The blast deals @Damage[2d6;fire]{2d6 fire}. Drinking it @Heal[3]{heals 3}.</p>');

        await det.locator('.enricher-damage').click();
        const card = page.locator('#tools-log .roll-card').first();
        await expect(card.locator('.roll-card-title')).toHaveText('Damage');
        await card.locator('.roll-card-apply-btn').first().click();
        // Fire resistance 100 swallows it: the calculator ran, HP did not move.
        await expect(card.locator('.roll-card-mitigation')).toContainText('fire resist 100');
        expect(await hp(page)).toBe(28);

        // Take 5 by hand, then the heal button gives 3 back.
        await page.evaluate(() => window.SheetRoll.applyDamageToHp(5));
        await expect.poll(() => hp(page)).toBe(23);
        // Applying re-renders the sheet, which drops the probe; mount it again.
        const again = await mountDescription(page, '<p>Drinking it @Heal[3]{heals 3}.</p>');
        await again.locator('.enricher-heal').click();
        const healCard = page.locator('#tools-log .roll-card').first();
        await expect(healCard.locator('.roll-card-title')).toHaveText('Healing');
        await healCard.locator('.roll-card-apply-btn').click();
        await expect.poll(() => hp(page)).toBe(26);
    });

test('real compendium text gets buttons, and a scaling phrase does not (#147)',
    feature('text.inline-enrichers'), async ({ page }) => {
        await openSheet(page, { fixture: 'wizard' });
        await page.waitForFunction(() => window.SheetDetails.lookup('spells', 'Shocking Grasp') && window.SheetDetails.lookup('feats', 'Skaveling Companion'));
        const got = await page.evaluate(() => {
            const render = (html) => {
                const det = window.SheetUI.details('probe', html);
                det.open = true;
                window.SheetEnrich.enrich(det);
                return [...det.querySelectorAll('.enricher')].map((b) => b.dataset.enrich + ':' + b.textContent);
            };
            // A catalog feat whose prose carries a fixed save DC.
            const featButtons = render(window.SheetDetails.lookup('feats', 'Skaveling Companion').description);
            return {
                feat: featButtons,
                // "1d6 points of electricity damage per caster level" scales: no button.
                grasp: render(window.SheetDetails.lookup('spells', 'Shocking Grasp').description),
            };
        });
        expect(got.feat.some((k) => k.startsWith('save:'))).toBe(true);
        expect(got.grasp.filter((k) => k.startsWith('damage'))).toEqual([]);
    });
