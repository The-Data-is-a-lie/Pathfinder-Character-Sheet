// scripts/create.js -- #44 guided PC creation wizard (window.SheetCreate). Three steps
// (Concept → Abilities → Review) that end in the SAME backend Generate call the quick form
// makes — the generator stays the assembly line; the wizard adds the player's choices on
// top (race/class/alignment/level pinned, chosen ability scores applied as the base scores
// after adoption, once seedRacialColumn has moved the racial share aside). A Finish
// checklist then routes to the real editing surfaces (Skills budget, Features Browse,
// Inventory) instead of re-implementing them — the level-up wizard's precedent.
// Warn-only throughout: an over-budget point buy goes red, it never blocks.
window.SheetCreate = (function () {
    'use strict';
    const { h, mod, fmt, parseIntLoose } = window.SheetUI;

    const ABILITIES = [
        ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
        ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
    ];
    const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
    // PF1 point-buy cost per score (7–18); Standard 15 / High fantasy 20 / Epic 25.
    const PB_COST = { 7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17 };
    // PF1 average starting wealth (gp) at level 1 by class; WBL from level 2 up.
    const WEALTH_LV1 = {
        barbarian: 105, bard: 105, cleric: 140, druid: 70, fighter: 175, monk: 35,
        paladin: 175, ranger: 175, rogue: 140, sorcerer: 70, wizard: 70, alchemist: 105,
        cavalier: 175, gunslinger: 175, inquisitor: 140, magus: 175, oracle: 105,
        summoner: 70, witch: 105, brawler: 140, bloodrager: 105, hunter: 140,
        investigator: 140, shaman: 105, skald: 105, slayer: 140, swashbuckler: 140,
        warpriest: 140, arcanist: 70, shifter: 105, ninja: 140, samurai: 175,
        antipaladin: 175,
    };
    const WBL = [0, 0, 1000, 3000, 6000, 10500, 16000, 23500, 33000, 46000, 62000,
        82000, 108000, 140000, 185000, 240000, 315000, 410000, 530000, 685000, 880000];

    function roll4d6DropLow() {
        const dice = Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6));
        dice.sort((a, b) => a - b);
        return dice[1] + dice[2] + dice[3];
    }
    function hintFor(label) {
        return window.SheetGuide?.hintFor?.(label) || '';
    }

    function open() {
        const SD = window.SheetData;
        const state = {
            step: 0,
            name: '',
            race: 'Human',
            cls: 'Fighter',
            alignment: 'ng',
            level: 1,
            method: 'array',
            budget: 20,
            scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
        };

        const body = h('div', 'create-wizard');
        const stepsBar = h('div', 'create-steps');
        const stepBody = h('div', 'create-step-body');
        body.append(stepsBar, stepBody);
        const backBtn = h('button', 'inv-btn', '← Back');
        backBtn.type = 'button';
        const nextBtn = h('button', 'inv-btn inv-btn-primary', 'Next →');
        nextBtn.type = 'button';
        const status = h('span', 'dim create-status');
        let handle = null;

        const STEPS = ['Concept', 'Abilities', 'Review', 'Finish'];
        const paintSteps = () => {
            stepsBar.innerHTML = '';
            STEPS.forEach((s, i) => {
                stepsBar.appendChild(h('span',
                    'create-step-tag' + (i === state.step ? ' is-active' : '')
                    + (i < state.step ? ' is-done' : ''),
                    `${i + 1} ${s}`));
            });
        };

        const mkRow = (label, ctrl, hint) => {
            const r = h('label', 'mm-row create-row');
            r.append(h('span', 'mm-name', label), ctrl);
            if (hint) r.title = hint;
            return r;
        };

        // ------------------------------------------------------------ step 1: concept
        function renderConcept() {
            stepBody.innerHTML = '';
            stepBody.appendChild(h('p', 'dim',
                'Pick what sounds fun — everything here can be changed later on the sheet.'));
            const nameIn = h('input', 'edit-field');
            nameIn.placeholder = 'Leave blank to roll one';
            nameIn.value = state.name;
            nameIn.addEventListener('input', () => { state.name = nameIn.value; });

            const raceSel = h('select', 'edit-field');
            window.SheetGenerate.fillGroupedSelect(raceSel,
                SD.RACES.filter((r) => r !== 'Random'), SD.CORE_RACES, 'More races');
            raceSel.value = state.race;
            raceSel.addEventListener('change', () => { state.race = raceSel.value; });

            const classSel = h('select', 'edit-field');
            window.SheetGenerate.fillGroupedSelect(classSel,
                SD.CLASSES.filter((c) => c !== 'Random'), SD.CORE_CLASSES, 'More classes');
            classSel.value = state.cls;
            const classInfo = h('p', 'dim create-class-info');
            const paintClassInfo = () => {
                const ci = SD.CLASS_STATS[state.cls.toLowerCase()];
                classInfo.textContent = ci
                    ? `d${ci.hd} hit die · ${ci.bab} BAB · ${ci.skills} skill ranks/level · ${ci.casting}`
                    : '';
            };
            classSel.addEventListener('change', () => {
                state.cls = classSel.value;
                paintClassInfo();
            });
            paintClassInfo();

            const alignSel = h('select', 'edit-field');
            for (const [v, t] of [['lg', 'Lawful Good'], ['ng', 'Neutral Good'], ['cg', 'Chaotic Good'],
                ['ln', 'Lawful Neutral'], ['n', 'Neutral'], ['cn', 'Chaotic Neutral'],
                ['le', 'Lawful Evil'], ['ne', 'Neutral Evil'], ['ce', 'Chaotic Evil']]) {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = t;
                alignSel.appendChild(opt);
            }
            alignSel.value = state.alignment;
            alignSel.addEventListener('change', () => { state.alignment = alignSel.value; });

            const levelSel = h('select', 'edit-field');
            for (let i = 1; i <= 20; i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = 'Level ' + i;
                levelSel.appendChild(opt);
            }
            levelSel.value = String(state.level);
            levelSel.addEventListener('change', () => {
                state.level = parseIntLoose(levelSel.value, 1);
            });

            stepBody.append(
                mkRow('Name', nameIn),
                mkRow('Race', raceSel),
                mkRow('Class', classSel),
                classInfo,
                mkRow('Alignment', alignSel),
                mkRow('Level', levelSel, 'New PCs usually start at level 1'),
            );
        }

        // ---------------------------------------------------------- step 2: abilities
        function renderAbilities() {
            stepBody.innerHTML = '';
            stepBody.appendChild(h('p', 'dim',
                'Three ways to set your six ability scores. Whatever the method fills in, '
                + 'every box stays editable — swap array values freely.'));

            const methods = h('div', 'create-methods');
            const budgetSel = h('select', 'edit-field');
            for (const [v, t] of [[15, '15 pts (standard)'], [20, '20 pts (high fantasy)'],
                [25, '25 pts (epic)']]) {
                const opt = document.createElement('option');
                opt.value = String(v);
                opt.textContent = t;
                budgetSel.appendChild(opt);
            }
            budgetSel.value = String(state.budget);
            budgetSel.addEventListener('change', () => {
                state.budget = parseIntLoose(budgetSel.value, 20);
                paintSummary();
            });
            const mkMethod = (id, label, apply) => {
                const b = h('button', 'inv-btn create-method' + (state.method === id ? ' is-active' : ''), label);
                b.type = 'button';
                b.addEventListener('click', () => {
                    state.method = id;
                    if (apply) apply();
                    renderAbilities();
                });
                return b;
            };
            methods.append(
                mkMethod('array', 'Standard array', () => {
                    ABILITIES.forEach(([ab], i) => { state.scores[ab] = STANDARD_ARRAY[i]; });
                }),
                mkMethod('roll', '🎲 Roll 4d6', () => {
                    ABILITIES.forEach(([ab]) => { state.scores[ab] = roll4d6DropLow(); });
                }),
                mkMethod('pointbuy', 'Point buy', null),
            );
            if (state.method === 'pointbuy') methods.appendChild(budgetSel);
            stepBody.appendChild(methods);

            const grid = h('div', 'create-abil-grid');
            const summary = h('p', 'mm-summary create-pb-summary');
            const paintSummary = () => {
                if (state.method !== 'pointbuy') {
                    summary.textContent = state.method === 'roll'
                        ? 'Rolled 4d6, dropped the lowest die — hit the button again to re-roll.'
                        : '';
                    summary.classList.remove('is-over');
                    return;
                }
                let spent = 0;
                let offTable = false;
                for (const [ab] of ABILITIES) {
                    const v = state.scores[ab];
                    if (PB_COST[v] == null) offTable = true;
                    else spent += PB_COST[v];
                }
                summary.textContent = `Points spent: ${spent} / ${state.budget}`
                    + (offTable ? ' (scores outside 7–18 are off the point-buy table)' : '')
                    + (spent > state.budget ? ' — over budget! (allowed, but ask your GM)' : '');
                summary.classList.toggle('is-over', spent > state.budget);
            };
            for (const [ab, label] of ABILITIES) {
                const row = h('div', 'create-abil-row');
                const inp = h('input', 'item-sheet-num');
                inp.type = 'number';
                inp.min = '3';
                inp.max = '20';
                inp.value = String(state.scores[ab]);
                const modEl = h('span', 'create-abil-mod', fmt(mod(state.scores[ab])));
                inp.addEventListener('input', () => {
                    state.scores[ab] = parseIntLoose(inp.value, 10);
                    modEl.textContent = fmt(mod(state.scores[ab]));
                    paintSummary();
                });
                row.append(h('span', 'create-abil-name', label), inp, modEl);
                const hint = hintFor(label);
                if (hint) row.appendChild(h('span', 'create-abil-hint dim', hint));
                grid.appendChild(row);
            }
            stepBody.append(grid, summary);
            paintSummary();
        }

        // ------------------------------------------------------------ step 3: review
        function renderReview() {
            stepBody.innerHTML = '';
            stepBody.appendChild(h('p', 'dim',
                'The generator builds the rest — feats, gear, spells, backstory — around your picks.'));
            const line = (k, v) => {
                const r = h('div', 'create-review-line');
                r.append(h('span', 'create-review-k', k), h('span', 'create-review-v', v));
                return r;
            };
            stepBody.append(
                line('Name', state.name.trim() || '(rolled by the generator)'),
                line('Race / Class', `${state.race} ${state.cls} ${state.level}`),
                line('Alignment', state.alignment.toUpperCase()),
                line('Abilities', ABILITIES.map(([ab]) =>
                    `${ab.toUpperCase()} ${state.scores[ab]}`).join(' · ')),
            );
            stepBody.appendChild(h('p', 'dim',
                'Racial ability bonuses are added on top of these scores (they land in the '
                + 'Racial column on the Attributes tab).'));
        }

        // ------------------------------------------------------------ step 4: finish
        function renderFinish(data) {
            stepBody.innerHTML = '';
            const nm = data?.character_full_name || 'Your character';
            stepBody.appendChild(h('p', null, `${nm} is ready! Three things to finish by hand:`));
            const ci = SD.CLASS_STATS[state.cls.toLowerCase()];
            const intMod = mod(state.scores.int);
            const ranks = ci?.skills != null
                ? Math.max(1, ci.skills + intMod) * state.level : null;
            const wealth = state.level === 1
                ? (WEALTH_LV1[state.cls.toLowerCase()] ?? 105)
                : WBL[Math.min(20, state.level)];
            const goBtn = (label, tab) => {
                const b = h('button', 'inv-btn', label);
                b.type = 'button';
                b.addEventListener('click', () => {
                    handle?.close();
                    window.SheetApp.setActiveTab(tab);
                });
                return b;
            };
            const item = (text, btn) => {
                const r = h('div', 'create-finish-item');
                r.append(h('span', null, text), btn);
                return r;
            };
            stepBody.append(
                item(`Spend your skill ranks${ranks != null ? ` (~${ranks} to place — the footer keeps count)` : ''}.`,
                    goBtn('Skills tab', 'skills')),
                item('Check the rolled feats, swap any you dislike via Browse.',
                    goBtn('Features tab', 'features')),
                item(`Review gear — a level-${state.level} PC usually owns about ${fmtGp(wealth)}.`,
                    goBtn('Inventory', 'inventory')),
            );
            stepBody.appendChild(h('p', 'dim',
                'Ability scores were applied as your base scores; racial bonuses sit in the '
                + 'Attributes tab’s Racial column.'));
        }
        const fmtGp = (n) => `${Number(n).toLocaleString('en-US')} gp`;

        // ------------------------------------------------------------ create action
        async function doCreate() {
            nextBtn.disabled = true;
            backBtn.disabled = true;
            status.textContent = 'Rolling up your hero… this can take a minute.';
            try {
                const data = await window.SheetGenerate.generateCustom({
                    race: state.race,
                    class: state.cls,
                    alignment: state.alignment,
                    highestLevel: String(state.level),
                    lowestLevel: String(state.level),
                });
                // Adoption has run seedRacialColumn, so the racial share lives in the
                // Racial column and data[ab] is the pure base — ours to set.
                if (state.name.trim()) data.character_full_name = state.name.trim();
                for (const [ab] of ABILITIES) data[ab] = state.scores[ab];
                window.SheetState.quietSave();
                window.SheetApp.renderSheet(data);
                status.textContent = '';
                state.step = 3;
                paint(data);
            } catch (err) {
                status.textContent = 'Failed: ' + err.message
                    + ' — check the backend in Settings, then try again.';
            } finally {
                nextBtn.disabled = false;
                backBtn.disabled = false;
            }
        }

        // ------------------------------------------------------------ step switcher
        function paint(data) {
            paintSteps();
            if (state.step === 0) renderConcept();
            else if (state.step === 1) renderAbilities();
            else if (state.step === 2) renderReview();
            else renderFinish(data);
            backBtn.style.visibility = state.step === 0 || state.step === 3 ? 'hidden' : '';
            nextBtn.textContent = state.step === 2 ? '✨ Create!'
                : (state.step === 3 ? 'Done' : 'Next →');
        }
        backBtn.addEventListener('click', () => {
            if (state.step > 0) { state.step -= 1; paint(); }
        });
        nextBtn.addEventListener('click', () => {
            if (state.step < 2) { state.step += 1; paint(); }
            else if (state.step === 2) doCreate();
            else handle?.close();
        });

        paint();
        handle = window.SheetOverlay.open({
            title: '🧭 Create a character',
            body,
            footer: [status, backBtn, nextBtn],
        });
    }

    return { open };
})();
