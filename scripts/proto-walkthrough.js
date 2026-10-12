// scripts/proto-walkthrough.js -- PROTOTYPE, THROWAWAY. Play Store App ticket 06.
//
// Question: how should the creation walkthrough look and behave on a phone?
// Plan: three structurally different phone-width walkthroughs, switchable via `?walk=A|B|C`, mounted
// over the real sheet (sub-shape A) so the hand-off lands on real tabs. The floating bar at the bottom
// (or ← / →) cycles variants. Everything here is in memory. The ONE real effect is the final Generate,
// which goes through SheetGenerate.generateCustom exactly as create.js does. Skill / feat / spell
// picks are NOT applied to the generated character; they are only here to judge the screens.
//
//   A  Card stack  — one decision per full screen, big tap tiles, hints always visible.
//   B  One scroll  — everything on one prefilled page in collapsible groups; Create is always live;
//                    skills/feats/spells deferred to the sheet; hints behind ⓘ.
//   C  Guide chat  — a conversation: the guide explains, you answer with chips; "What's that?" for hints.
//
// Lives only on branch proto/phone-walkthrough. Never merge it.
(function () {
    'use strict';
    const VARIANTS = { A: 'Card stack', B: 'One scroll', C: 'Guide chat' };
    const params = new URLSearchParams(location.search);
    if (!params.has('walk')) return;
    let current = VARIANTS[params.get('walk')] ? params.get('walk') : 'A';

    // ------------------------------------------------------------------ shared (data + state only)
    const RACE_BLURB = {
        Human: ['🧑', 'Flexible at anything. An extra feat and extra skill points.'],
        Elf: ['🧝', 'Graceful and long-lived. Sharp eyes, good at magic.'],
        Dwarf: ['🧔', 'Tough and stubborn. Hard to knock down, sees in the dark.'],
        Halfling: ['🦶', 'Small, lucky and sneaky. Good at dodging trouble.'],
        Gnome: ['🍄', 'Small and curious. A little natural magic.'],
        'Half-Elf': ['🌗', 'Between two worlds. Gets along with everyone.'],
        'Half-Orc': ['💪', 'Strong and fierce. Keeps fighting when badly hurt.'],
    };
    const CLASS_BLURB = {
        Fighter: ['⚔️', 'martial', 'Best with weapons and armour. Simple to play.'],
        Rogue: ['🗝️', 'skill', 'Sneaky and skilled. Big damage from surprise attacks.'],
        Cleric: ['✨', 'divine', 'Heals friends and fights with a god’s power.'],
        Wizard: ['📘', 'arcane', 'Learns spells from a book. Powerful but fragile.'],
        Sorcerer: ['🔥', 'arcane', 'Magic in the blood. Fewer spells, cast more often.'],
        Ranger: ['🏹', 'martial', 'Hunter and tracker. Great with a bow.'],
        Paladin: ['🛡️', 'martial', 'Holy knight. Protects others, smites evil.'],
        Barbarian: ['🪓', 'martial', 'Rages to hit harder. Very tough.'],
        Bard: ['🎻', 'skill', 'Music and magic that help the whole team.'],
        Druid: ['🌿', 'nature', 'Nature magic. Has an animal friend, can turn into animals.'],
        Monk: ['🥋', 'martial', 'Fights unarmed, moves fast, hard to hit.'],
    };
    // Which ability each class wants highest first (for "Suggest for my class").
    const PRIORITY = {
        Fighter: ['str', 'con', 'dex', 'wis', 'int', 'cha'], Rogue: ['dex', 'int', 'con', 'wis', 'cha', 'str'],
        Cleric: ['wis', 'con', 'str', 'cha', 'dex', 'int'], Wizard: ['int', 'dex', 'con', 'wis', 'cha', 'str'],
        Sorcerer: ['cha', 'dex', 'con', 'wis', 'int', 'str'], Ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
        Paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'], Barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
        Bard: ['cha', 'dex', 'con', 'int', 'wis', 'str'], Druid: ['wis', 'con', 'dex', 'str', 'int', 'cha'],
        Monk: ['wis', 'dex', 'str', 'con', 'int', 'cha'],
    };
    const FEATS = {
        martial: [['Power Attack', 'Trade accuracy for big damage.'], ['Weapon Focus', '+1 to hit with one weapon.'],
            ['Toughness', 'Extra hit points.'], ['Improved Initiative', 'Act earlier in a fight.']],
        skill: [['Weapon Finesse', 'Use Dexterity to hit with light weapons.'], ['Dodge', '+1 to your armour class.'],
            ['Skill Focus', '+3 on one skill you love.'], ['Improved Initiative', 'Act earlier in a fight.']],
        arcane: [['Spell Focus', 'Your spells are harder to resist.'], ['Combat Casting', 'Cast safely next to enemies.'],
            ['Toughness', 'Extra hit points.'], ['Improved Initiative', 'Act earlier in a fight.']],
        divine: [['Selective Channeling', 'Heal friends without healing enemies.'], ['Toughness', 'Extra hit points.'],
            ['Combat Casting', 'Cast safely next to enemies.'], ['Extra Channel', 'Heal more times a day.']],
        nature: [['Augment Summoning', 'Summoned animals are stronger.'], ['Toughness', 'Extra hit points.'],
            ['Combat Casting', 'Cast safely next to enemies.'], ['Natural Spell', 'Cast while in animal form (later).']],
    };
    const SPELLS = {
        Wizard: ['Magic Missile', 'Mage Armor', 'Sleep', 'Color Spray', 'Grease', 'Shield'],
        Sorcerer: ['Magic Missile', 'Mage Armor', 'Sleep', 'Color Spray', 'Grease', 'Shield'],
        Cleric: ['Bless', 'Cure Light Wounds', 'Shield of Faith', 'Command', 'Divine Favor', 'Protection from Evil'],
        Druid: ['Entangle', 'Faerie Fire', 'Goodberry', 'Produce Flame', 'Cure Light Wounds', 'Speak with Animals'],
        Bard: ['Cure Light Wounds', 'Grease', 'Hideous Laughter', 'Silent Image', 'Charm Person', 'Disguise Self'],
    };
    const SPELL_PICKS = { Wizard: 3, Sorcerer: 2, Bard: 2 };   // prepared casters pick daily; illustrative
    const ALIGN = [['lg', 'Lawful Good'], ['ng', 'Neutral Good'], ['cg', 'Chaotic Good'],
        ['ln', 'Lawful Neutral'], ['n', 'Neutral'], ['cn', 'Chaotic Neutral'],
        ['le', 'Lawful Evil'], ['ne', 'Neutral Evil'], ['ce', 'Chaotic Evil']];
    const ABILS = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
        ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
    const ARRAY = [15, 14, 13, 12, 10, 8];
    const PB = { 7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17 };

    const freshState = () => ({
        name: '', race: 'Human', cls: 'Fighter', alignment: 'ng', level: 1,
        method: 'array', budget: 20, scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
        skills: new Set(), feats: new Set(), spells: new Set(), pickMode: 'auto',
    });
    let S = freshState();

    const hint = (label) => window.SheetGuide?.hintFor?.(label) || '';
    const mod = (v) => Math.floor((v - 10) / 2);
    const sgn = (n) => (n >= 0 ? '+' : '') + n;
    const roll4d6 = () => { const d = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b); return d[1] + d[2] + d[3]; };
    const pbSpent = () => ABILS.reduce((t, [a]) => t + (PB[S.scores[a]] ?? 0), 0);
    const ci = () => window.SheetData.CLASS_STATS[S.cls.toLowerCase()] || {};
    const role = () => CLASS_BLURB[S.cls]?.[1] || 'martial';
    const skillBudget = () => Math.max(1, (ci().skills || 2) + mod(S.scores.int)) * S.level + (S.race === 'Human' ? S.level : 0);
    const classSkills = () => {
        const ids = new Set(ci().classSkills || []);
        return (window.SheetData.ALL_SKILLS || []).filter((s) => ids.has(s.id) && !s.variant && !s.subsystem);
    };
    const featCount = () => (S.race === 'Human' ? 2 : 1);
    const applyMethod = (m) => {
        S.method = m;
        if (m === 'array') ABILS.forEach(([a], i) => { S.scores[a] = ARRAY[i]; });
        if (m === 'roll') ABILS.forEach(([a]) => { S.scores[a] = roll4d6(); });
        if (m === 'pointbuy') ABILS.forEach(([a]) => { S.scores[a] = 10; });
    };
    const suggestForClass = () => {
        const vals = ABILS.map(([a]) => S.scores[a]).sort((x, y) => y - x);
        (PRIORITY[S.cls] || ABILS.map(([a]) => a)).forEach((a, i) => { S.scores[a] = vals[i]; });
    };
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const btn = (cls, text, on) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', on); return b; };

    async function generate(onLine) {
        const data = await window.SheetGenerate.generateCustom({
            race: S.race, class: S.cls, alignment: S.alignment,
            highestLevel: String(S.level), lowestLevel: String(S.level),
        }, { onProgress: (p) => onLine(window.SheetBackend.progressText(p)) });
        if (S.name.trim()) data.character_full_name = S.name.trim();
        for (const [a] of ABILS) data[a] = S.scores[a];
        window.SheetState.quietSave();
        window.SheetApp.renderSheet(data);
        return data;
    }
    function handOff(tab) {
        closeFrame();
        window.SheetApp.setActiveTab(tab || 'summary');
    }

    // ------------------------------------------------------------------ frame + switcher
    let frame = null;
    let screen = null;
    function openFrame() {
        closeFrame();
        frame = el('div', 'pw-backdrop');
        const phone = el('div', 'pw-phone');
        phone.dataset.variant = current;
        screen = el('div', 'pw-screen');
        phone.appendChild(screen);
        frame.appendChild(phone);
        document.body.appendChild(frame);
        document.body.classList.add('pw-open');
        window.SheetBackend?.warm?.();
        ({ A: variantA, B: variantB, C: variantC })[current]();
    }
    function closeFrame() {
        frame?.remove();
        frame = null;
        document.body.classList.remove('pw-open');
    }
    function setVariant(k) {
        current = k;
        const u = new URL(location.href);
        u.searchParams.set('walk', k);
        history.replaceState(null, '', u);
        S = freshState();
        label.textContent = `${k} — ${VARIANTS[k]}`;
        openFrame();
    }
    const keys = Object.keys(VARIANTS);
    const cycle = (d) => setVariant(keys[(keys.indexOf(current) + d + keys.length) % keys.length]);
    const bar = el('div', 'pw-switch');
    const label = el('span', 'pw-switch-label', `${current} — ${VARIANTS[current]}`);
    bar.append(btn('pw-switch-btn', '←', () => cycle(-1)), label, btn('pw-switch-btn', '→', () => cycle(1)),
        btn('pw-switch-btn', '⟲', () => setVariant(current)));
    bar.title = 'PROTOTYPE switcher (ticket 06). ⟲ restarts the current variant.';
    document.addEventListener('keydown', (e) => {
        if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (e.key === 'ArrowLeft') cycle(-1);
        if (e.key === 'ArrowRight') cycle(1);
    });

    // =================================================================== A — Card stack
    function variantA() {
        const steps = [
            'name', 'race', 'class', 'alignment', 'level', 'method', 'scores', 'skills', 'feats',
            ...(SPELLS[S.cls] ? ['spells'] : []), 'review',
        ];
        let i = 0;
        const recompute = () => {
            const cur = steps[i];
            steps.splice(0, steps.length, 'name', 'race', 'class', 'alignment', 'level', 'method', 'scores',
                'skills', 'feats', ...(SPELLS[S.cls] ? ['spells'] : []), 'review');
            i = Math.max(0, steps.indexOf(cur));
        };
        const shell = (title, sub, content, { next = 'Next', onNext, canSkip } = {}) => {
            screen.innerHTML = '';
            const top = el('div', 'a-top');
            top.append(btn('a-back', i ? '‹' : '✕', () => { if (i) { i -= 1; paint(); } else closeFrame(); }),
                el('div', 'a-progress'));
            const prog = top.lastChild;
            steps.forEach((_, k) => prog.appendChild(el('span', 'a-dot' + (k < i ? ' done' : k === i ? ' on' : ''))));
            const body = el('div', 'a-body');
            body.append(el('h2', 'a-title', title));
            if (sub) body.append(el('p', 'a-sub', sub));
            body.append(content);
            const foot = el('div', 'a-foot');
            if (canSkip) foot.append(btn('a-skip', canSkip, () => { i += 1; paint(); }));
            foot.append(btn('a-next', next, () => { if (onNext) onNext(); else { i += 1; paint(); } }));
            screen.append(top, body, foot);
        };
        const tiles = (items, isOn, onPick, cls = '') => {
            const g = el('div', 'a-tiles ' + cls);
            for (const it of items) {
                const t = btn('a-tile' + (isOn(it) ? ' on' : ''), '', () => { onPick(it); paint(); });
                if (it.icon) t.append(el('span', 'a-tile-icon', it.icon));
                t.append(el('span', 'a-tile-name', it.name));
                if (it.hint) t.append(el('span', 'a-tile-hint', it.hint));
                g.append(t);
            }
            return g;
        };
        const moreSelect = (list, core, value, onChange, lab) => {
            const d = el('details', 'a-more');
            d.append(el('summary', null, lab));
            const sel = el('select', 'a-select');
            for (const o of list.filter((x) => x !== 'Random' && !core[x])) sel.append(new Option(o, o));
            sel.value = core[value] ? '' : value;
            sel.addEventListener('change', () => { onChange(sel.value); paint(); });
            if (!core[value]) d.open = true;
            d.append(sel);
            return d;
        };
        function paint() {
            const st = steps[i];
            if (st === 'name') {
                const inp = el('input', 'a-input');
                inp.placeholder = 'e.g. Mira Stonebrook';
                inp.value = S.name;
                inp.addEventListener('input', () => { S.name = inp.value; });
                shell('What’s your hero called?', 'You can leave this blank and we’ll make one up.', inp,
                    { canSkip: 'Make one up' });
            } else if (st === 'race') {
                const wrap = el('div');
                wrap.append(tiles(Object.entries(RACE_BLURB).map(([name, [icon, h]]) => ({ name, icon, hint: h })),
                    (it) => S.race === it.name, (it) => { S.race = it.name; }),
                moreSelect(window.SheetData.RACES, RACE_BLURB, S.race, (v) => { S.race = v; }, 'More races…'));
                shell('Pick a race', 'Your people. It changes a few numbers and how you look.', wrap);
            } else if (st === 'class') {
                const wrap = el('div');
                wrap.append(tiles(Object.entries(CLASS_BLURB).map(([name, [icon, , h]]) => ({ name, icon, hint: h })),
                    (it) => S.cls === it.name, (it) => { S.cls = it.name; S.skills.clear(); S.feats.clear(); S.spells.clear(); recompute(); }),
                moreSelect(window.SheetData.CLASSES, CLASS_BLURB, S.cls, (v) => { S.cls = v; recompute(); }, 'More classes…'));
                shell('Pick a class', 'Your job in the party. This is the biggest choice.', wrap);
            } else if (st === 'alignment') {
                shell('How do they behave?', 'Good or evil, rule-follower or free spirit. Most heroes are some kind of Good.',
                    tiles(ALIGN.map(([v, n]) => ({ v, name: n })), (it) => S.alignment === it.v,
                        (it) => { S.alignment = it.v; }, 'grid3'));
            } else if (st === 'level') {
                shell('Starting level', 'New characters start at level 1. Only change this if your GM said so.',
                    tiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20].map((n) => ({ name: String(n), n })),
                        (it) => S.level === it.n, (it) => { S.level = it.n; }, 'grid4'));
            } else if (st === 'method') {
                shell('How do you want your scores?', hint('Abilities') || 'Six numbers for what your hero is good at.',
                    tiles([
                        { m: 'array', icon: '📋', name: 'Standard set', hint: 'Fair and quick: 15, 14, 13, 12, 10, 8. Recommended.' },
                        { m: 'roll', icon: '🎲', name: 'Roll dice', hint: 'Roll 4 dice, keep the best 3. Could be great, could be rough.' },
                        { m: 'pointbuy', icon: '🧮', name: 'Point buy', hint: 'Spend points on exactly what you want.' },
                    ], (it) => S.method === it.m, (it) => { applyMethod(it.m); }));
            } else if (st === 'scores') {
                const list = el('div', 'a-scores');
                const info = el('p', 'a-sub');
                const paintInfo = () => {
                    if (S.method !== 'pointbuy') { info.textContent = ''; return; }
                    const spent = pbSpent();
                    info.textContent = `Points spent: ${spent} / ${S.budget}` + (spent > S.budget ? ' — over budget (allowed, ask your GM)' : '');
                    info.classList.toggle('over', spent > S.budget);
                };
                for (const [a, n] of ABILS) {
                    const row = el('div', 'a-score');
                    const v = el('span', 'a-score-v', String(S.scores[a]));
                    const m = el('span', 'a-score-m', sgn(mod(S.scores[a])));
                    const step = (d) => { S.scores[a] = Math.max(3, Math.min(20, S.scores[a] + d)); v.textContent = S.scores[a]; m.textContent = sgn(mod(S.scores[a])); paintInfo(); };
                    const lab = el('div', 'a-score-lab');
                    lab.append(el('b', null, n), el('small', null, hint(n)));
                    row.append(lab, btn('a-step', '−', () => step(-1)), v, btn('a-step', '+', () => step(1)), m);
                    list.append(row);
                }
                const tools = el('div', 'a-row');
                tools.append(btn('a-chip', `⭐ Best order for a ${S.cls}`, () => { suggestForClass(); paint(); }));
                if (S.method === 'roll') tools.append(btn('a-chip', '🎲 Roll again', () => { applyMethod('roll'); paint(); }));
                if (S.method === 'pointbuy') for (const b of [15, 20, 25]) tools.append(btn('a-chip' + (S.budget === b ? ' on' : ''), `${b} pts`, () => { S.budget = b; paint(); }));
                const wrap = el('div');
                wrap.append(tools, list, info);
                paintInfo();
                shell('Your ability scores', 'Tap − and + to adjust. The number on the right is what gets added to rolls.', wrap);
            } else if (st === 'skills') {
                const n = skillBudget();
                const wrap = el('div');
                const counter = el('p', 'a-sub');
                const paintC = () => { counter.textContent = `${S.skills.size} of ${n} picked` + (S.skills.size > n ? ' — that’s more than you get (allowed, the sheet will warn)' : ''); };
                const g = el('div', 'a-chips');
                for (const s of classSkills()) {
                    const c = btn('a-chip big' + (S.skills.has(s.name) ? ' on' : ''), s.name, () => {
                        S.skills.has(s.name) ? S.skills.delete(s.name) : S.skills.add(s.name);
                        c.classList.toggle('on'); paintC();
                    });
                    c.title = hint(s.name);
                    g.append(c);
                }
                paintC();
                wrap.append(counter, g, el('p', 'a-sub small', 'These are your class skills (+3 bonus). Other skills can be picked on the sheet.'));
                shell('What are you good at?', `Pick ${n} skill${n === 1 ? '' : 's'} to train. Not sure? Skip and the generator picks for you.`, wrap,
                    { canSkip: 'Pick for me' });
            } else if (st === 'feats') {
                const n = featCount();
                const items = FEATS[role()] || FEATS.martial;
                shell(`Pick ${n === 1 ? 'a feat' : n + ' feats'}`, 'Feats are special tricks. Here are good first picks for your class.',
                    tiles(items.map(([name, h]) => ({ name, hint: h })), (it) => S.feats.has(it.name),
                        (it) => { S.feats.has(it.name) ? S.feats.delete(it.name) : S.feats.add(it.name); }),
                    { canSkip: 'Pick for me' });
            } else if (st === 'spells') {
                const n = SPELL_PICKS[S.cls];
                shell(n ? `Pick ${n} first spells` : 'Your first spells',
                    n ? 'You can learn more as you level up.' : `${S.cls}s know every spell on their list — just see what you’ll have.`,
                    tiles(SPELLS[S.cls].map((name) => ({ name })), (it) => S.spells.has(it.name),
                        (it) => { if (!n) return; S.spells.has(it.name) ? S.spells.delete(it.name) : S.spells.add(it.name); }, 'grid2'),
                    { canSkip: n ? 'Pick for me' : null });
            } else if (st === 'review') {
                const list = el('div', 'a-review');
                const line = (k, v, go) => { const r = btn('a-review-line', '', () => { i = steps.indexOf(go); paint(); }); r.append(el('span', null, k), el('b', null, v), el('span', 'a-edit', '✎')); list.append(r); };
                line('Name', S.name || '(made up for you)', 'name');
                line('Race', S.race, 'race');
                line('Class', `${S.cls}, level ${S.level}`, 'class');
                line('Alignment', ALIGN.find(([v]) => v === S.alignment)[1], 'alignment');
                line('Scores', ABILS.map(([a]) => S.scores[a]).join(' · '), 'scores');
                line('Skills', S.skills.size ? [...S.skills].join(', ') : 'generator picks', 'skills');
                line('Feats', S.feats.size ? [...S.feats].join(', ') : 'generator picks', 'feats');
                if (SPELLS[S.cls]) line('Spells', S.spells.size ? [...S.spells].join(', ') : 'generator picks', 'spells');
                const status = el('p', 'a-sub');
                list.append(status);
                shell('Ready?', 'Tap a line to change it. The generator fills in gear, backstory and everything else.', list, {
                    next: '✨ Make my hero',
                    onNext: async () => {
                        const go = screen.querySelector('.a-next');
                        go.disabled = true;
                        try { await generate((t) => { status.textContent = t; }); i = steps.length; paintDone(); } catch (e) { status.textContent = e.message; go.disabled = false; }
                    },
                });
            }
        }
        function paintDone() {
            screen.innerHTML = '';
            const body = el('div', 'a-body center');
            body.append(el('div', 'a-big', '🎉'), el('h2', 'a-title', `${window.SheetApp.current?.character_full_name || 'Your hero'} is ready!`),
                el('p', 'a-sub', 'Here’s your character sheet. A few things you might check:'));
            const t = el('div', 'a-tiles');
            for (const [icon, name, h, tab] of [['📊', 'See my hero', 'The one-page summary', 'summary'],
                ['🎯', 'Skills', 'Spend or change your skill ranks', 'skills'], ['⭐', 'Feats & powers', 'What your hero can do', 'features']]) {
                const b = btn('a-tile', '', () => handOff(tab));
                b.append(el('span', 'a-tile-icon', icon), el('span', 'a-tile-name', name), el('span', 'a-tile-hint', h));
                t.append(b);
            }
            body.append(t);
            screen.append(body);
        }
        paint();
    }

    // =================================================================== B — One scroll
    function variantB() {
        screen.innerHTML = '';
        const page = el('div', 'b-page');
        const head = el('div', 'b-head');
        head.append(btn('b-x', '✕', closeFrame), el('h2', null, 'New hero'), el('span', 'b-head-sub', 'Everything is pre-filled. Change what you like, then Create.'));
        const status = el('p', 'b-status');
        const create = btn('b-create', '✨ Create my hero', async () => {
            create.disabled = true;
            try {
                await generate((t) => { status.textContent = t; });
                handOff('summary');
                finishBanner();
            } catch (e) { status.textContent = e.message; create.disabled = false; }
        });
        const foot = el('div', 'b-foot');
        foot.append(status, create);

        const info = (text) => {
            if (!text) return el('span');
            const w = el('span', 'b-info');
            const tip = el('span', 'b-tip', text);
            w.append(btn('b-i', 'ⓘ', () => tip.classList.toggle('show')), tip);
            return w;
        };
        const section = (title, summaryFn, build, open) => {
            const d = el('details', 'b-sec');
            d.open = !!open;
            const sm = el('summary');
            const val = el('span', 'b-val');
            sm.append(el('span', 'b-sec-t', title), val);
            const refresh = () => { val.textContent = summaryFn(); };
            refresh();
            d.append(sm);
            const inner = el('div', 'b-inner');
            build(inner, refresh);
            d.append(inner);
            return d;
        };
        const sel = (options, value, onChange) => {
            const s = el('select', 'b-select');
            for (const o of options) s.append(Array.isArray(o) ? new Option(o[1], o[0]) : new Option(o, o));
            s.value = value;
            s.addEventListener('change', () => onChange(s.value));
            return s;
        };
        const field = (lab, ctrl, tip) => { const r = el('label', 'b-field'); const l = el('span', 'b-lab', lab); l.append(info(tip)); r.append(l, ctrl); return r; };

        page.append(head,
            section('Who', () => `${S.name || 'Random name'} · ${S.race} ${S.cls} ${S.level}`, (inner, refresh) => {
                const nm = el('input', 'b-input'); nm.placeholder = 'Leave blank to roll one'; nm.value = S.name;
                nm.addEventListener('input', () => { S.name = nm.value; refresh(); });
                const ci2 = el('p', 'b-note');
                const paintCi = () => { const c = ci(); ci2.textContent = (CLASS_BLURB[S.cls]?.[2] || '') + (c.hd ? ` d${c.hd} hit die · ${c.skills} skills/level.` : ''); };
                paintCi();
                inner.append(field('Name', nm),
                    field('Race', sel(window.SheetData.RACES.filter((r) => r !== 'Random'), S.race, (v) => { S.race = v; refresh(); }), RACE_BLURB[S.race]?.[1] || 'Your people.'),
                    field('Class', sel(window.SheetData.CLASSES.filter((r) => r !== 'Random'), S.cls, (v) => { S.cls = v; paintCi(); refresh(); }), 'Your job in the party.'),
                    ci2,
                    field('Level', sel(Array.from({ length: 20 }, (_, k) => String(k + 1)), String(S.level), (v) => { S.level = +v; refresh(); }), 'New characters start at 1.'),
                    field('Alignment', sel(ALIGN, S.alignment, (v) => { S.alignment = v; refresh(); }), hint('Alignment') || 'Good or evil, lawful or chaotic.'));
            }, true),
            section('Ability scores', () => ABILS.map(([a]) => S.scores[a]).join(' · '), (inner, refresh) => {
                const seg = el('div', 'b-seg');
                const grid = el('div', 'b-abil');
                const pb = el('p', 'b-note');
                const paintGrid = () => {
                    grid.innerHTML = '';
                    for (const [a, n] of ABILS) {
                        const cell = el('label', 'b-abil-cell');
                        const inp = el('input', 'b-num'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.value = S.scores[a];
                        const m = el('span', 'b-mod', sgn(mod(S.scores[a])));
                        inp.addEventListener('input', () => { S.scores[a] = +inp.value || 10; m.textContent = sgn(mod(S.scores[a])); paintPb(); refresh(); });
                        const l = el('span', 'b-abil-l', a.toUpperCase()); l.append(info(hint(n)));
                        cell.append(l, inp, m);
                        grid.append(cell);
                    }
                    paintPb();
                };
                const paintPb = () => { pb.textContent = S.method === 'pointbuy' ? `Point buy: ${pbSpent()} / ${S.budget}` + (pbSpent() > S.budget ? ' — over (allowed)' : '') : ''; };
                const paintSeg = () => {
                    seg.innerHTML = '';
                    for (const [m, t] of [['array', 'Standard'], ['roll', '🎲 Roll'], ['pointbuy', 'Point buy']]) {
                        seg.append(btn('b-seg-btn' + (S.method === m ? ' on' : ''), t, () => { applyMethod(m); paintSeg(); paintGrid(); refresh(); }));
                    }
                    seg.append(btn('b-seg-btn', '⭐ Sort for class', () => { suggestForClass(); paintGrid(); refresh(); }));
                };
                paintSeg(); paintGrid();
                inner.append(seg, grid, pb);
            }),
            section('Skills, feats & spells', () => 'Generator picks', (inner) => {
                inner.append(el('p', 'b-note', 'The generator chooses skills, feats and spells that suit your class. '
                    + 'After Create you land on your sheet, where every one of them can be swapped — a checklist at the top shows you where.'));
            }));
        screen.append(page, foot);
    }
    function finishBanner() {
        document.querySelector('.pw-banner')?.remove();
        const b = el('div', 'pw-banner');
        b.append(el('b', null, 'Finish up:'));
        for (const [t, tab] of [['Skills', 'skills'], ['Feats', 'features'], ['Gear', 'inventory']]) {
            b.append(btn('pw-banner-btn', t, () => window.SheetApp.setActiveTab(tab)));
        }
        b.append(btn('pw-banner-x', '✕', () => b.remove()));
        document.body.append(b);
    }

    // =================================================================== C — Guide chat
    function variantC() {
        screen.innerHTML = '';
        const head = el('div', 'c-head');
        head.append(el('span', 'c-avatar', '🧙'), el('div', 'c-who', 'Your guide'), btn('c-x', '✕', closeFrame));
        const log = el('div', 'c-log');
        const replies = el('div', 'c-replies');
        screen.append(head, log, replies);
        const say = (text, who = 'guide') => { const m = el('div', 'c-msg ' + who, text); log.append(m); log.scrollTop = log.scrollHeight; return m; };
        const ask = (chips, { multi, max, done } = {}) => new Promise((res) => {
            replies.innerHTML = '';
            const picked = new Set();
            for (const c of chips) {
                const label = typeof c === 'string' ? c : c.label;
                const b = btn('c-chip', label, () => {
                    if (c.explain) { say(c.explain); return; }
                    if (!multi) { replies.innerHTML = ''; say(label, 'me'); res(c); return; }
                    picked.has(c) ? picked.delete(c) : picked.add(c);
                    b.classList.toggle('on');
                    if (doneBtn) doneBtn.textContent = `Done (${picked.size}${max ? '/' + max : ''})`;
                });
                if (c.explain) b.classList.add('ghost');
                replies.append(b);
            }
            let doneBtn = null;
            if (multi) {
                doneBtn = btn('c-chip primary', done || 'Done', () => {
                    replies.innerHTML = '';
                    say(picked.size ? [...picked].map((x) => x.label || x).join(', ') : 'You pick for me', 'me');
                    res([...picked]);
                });
                replies.append(doneBtn);
            }
        });
        const askText = (placeholder, skipLabel) => new Promise((res) => {
            replies.innerHTML = '';
            const inp = el('input', 'c-input'); inp.placeholder = placeholder;
            const go = () => { replies.innerHTML = ''; say(inp.value || skipLabel, 'me'); res(inp.value.trim()); };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
            replies.append(inp, btn('c-chip primary', 'Send', go), btn('c-chip ghost', skipLabel, () => { inp.value = ''; go(); }));
            inp.focus();
        });
        const what = (label, text) => ({ label: `❓ ${label}`, explain: text });

        (async () => {
            say('Hi! I’ll help you make a Pathfinder hero. It takes a couple of minutes, and you can change anything later.');
            say('First: who are you? Pick a race — that’s your people.');
            const race = await ask([...Object.entries(RACE_BLURB).map(([n, [i]]) => ({ label: `${i} ${n}`, v: n })),
                what('Which is best for beginners?', 'Human is the easiest — good at everything, with a bonus feat. Dwarves are very hard to kill.')]);
            S.race = race.v;
            say(`${RACE_BLURB[S.race][1]} Now, what do you do in the party? That’s your class.`);
            const cls = await ask([...Object.entries(CLASS_BLURB).map(([n, [i]]) => ({ label: `${i} ${n}`, v: n })),
                what('Help me choose', 'Like hitting things? Fighter or Barbarian. Sneaky? Rogue. Magic? Wizard or Sorcerer. Want to help friends? Cleric.')]);
            S.cls = cls.v;
            say(`${CLASS_BLURB[S.cls][2]} Good choice.`);
            say('Are they good, neutral or evil? (Most heroes are good.)');
            const al = await ask([{ label: '😇 Good', v: 'ng' }, { label: '⚖️ Neutral', v: 'n' }, { label: '😈 Evil', v: 'ne' },
                { label: 'More precise…', v: 'more' }, what('What’s alignment?', hint('Alignment') || 'Your hero’s morals — how they treat others and rules.')]);
            if (al.v === 'more') {
                say('Pick exactly:');
                S.alignment = (await ask(ALIGN.map(([v, n]) => ({ label: n, v })))).v;
            } else S.alignment = al.v;
            say('Now your six ability scores — what your hero is naturally good at. How should we get them?');
            const m = await ask([{ label: '📋 Standard set', v: 'array' }, { label: '🎲 Roll dice', v: 'roll' }, { label: '🧮 Point buy', v: 'pointbuy' },
                what('Which should I pick?', 'Standard set is fair and fast. Rolling is exciting but can go badly. Point buy is for people who know exactly what they want.')]);
            applyMethod(m.v);
            if (m.v === 'pointbuy') ABILS.forEach(([a], k) => { S.scores[a] = ARRAY[k]; });
            suggestForClass();
            const card = say('');
            card.classList.add('card');
            const paintCard = () => {
                card.innerHTML = '';
                card.append(el('div', 'c-card-t', `I put the best scores where a ${S.cls} needs them:`));
                const g = el('div', 'c-abil');
                for (const [a, n] of ABILS) { const c = el('div', 'c-abil-cell'); c.title = hint(n); c.append(el('small', null, a.toUpperCase()), el('b', null, String(S.scores[a])), el('small', null, sgn(mod(S.scores[a])))); g.append(c); }
                card.append(g);
                log.scrollTop = log.scrollHeight;
            };
            paintCard();
            for (;;) {
                const r = await ask([{ label: '👍 Looks good', v: 'ok' }, ...(S.method === 'roll' ? [{ label: '🎲 Roll again', v: 'roll' }] : []),
                    { label: '✏️ Let me change them', v: 'edit' }]);
                if (r.v === 'ok') break;
                if (r.v === 'roll') { applyMethod('roll'); suggestForClass(); paintCard(); continue; }
                say('Type over any score — the sheet also lets you edit them any time.');
                card.querySelectorAll('.c-abil-cell').forEach((c, k) => {
                    const a = ABILS[k][0];
                    const b = c.querySelector('b');
                    const inp = el('input', 'c-abil-in'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.value = S.scores[a];
                    inp.addEventListener('change', () => { S.scores[a] = +inp.value || S.scores[a]; c.lastChild.textContent = sgn(mod(S.scores[a])); });
                    b.replaceWith(inp);
                });
            }
            const n = skillBudget();
            say(`You get ${n} skill rank${n === 1 ? '' : 's'}. These suit a ${S.cls} — pick a few, or let me choose.`);
            const sk = classSkills().slice(0, 10).map((s) => ({ label: s.name }));
            (await ask(sk, { multi: true, max: n, done: 'Done' })).forEach((s) => S.skills.add(s.label));
            say(`And ${featCount() === 1 ? 'a feat' : featCount() + ' feats'} — a special trick. My suggestions:`);
            const fs = (FEATS[role()] || FEATS.martial).map(([l, x]) => ({ label: l, x }));
            (await ask([...fs, what('What do these do?', fs.map((f) => `${f.label}: ${f.x}`).join('\n'))], { multi: true, max: featCount() })).forEach((f) => S.feats.add(f.label));
            if (SPELLS[S.cls]) {
                say(SPELL_PICKS[S.cls] ? `Pick ${SPELL_PICKS[S.cls]} first spells:` : `Here are some spells you’ll have:`);
                (await ask(SPELLS[S.cls].map((l) => ({ label: l })), { multi: true, max: SPELL_PICKS[S.cls] })).forEach((s) => S.spells.add(s.label));
            }
            say('Last thing — a name? Or I can make one up.');
            S.name = await askText('Hero name', 'Make one up');
            say(`Here’s the plan: a ${S.race} ${S.cls}. Ready to make it?`);
            await ask([{ label: '✨ Make my hero!' }]);
            const wait = say('…');
            for (;;) {
                try {
                    const data = await generate((t) => { wait.textContent = t; });
                    wait.textContent = `Meet ${data.character_full_name}! 🎉`;
                    break;
                } catch (e) {
                    wait.textContent = e.message;
                    await ask([{ label: '↻ Try again' }]);
                }
            }
            say('Your sheet is ready. Where to?');
            const go = await ask([{ label: '📊 Show me my hero', v: 'summary' }, { label: '🎯 Skills', v: 'skills' }, { label: '⭐ Feats', v: 'features' }]);
            handOff(go.v);
        })();
    }

    // ------------------------------------------------------------------ styles + boot
    const css = `
    .pw-backdrop{position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
    .pw-phone{width:min(100vw,390px);height:min(100dvh,800px);background:var(--paper);color:var(--ink);display:flex;flex-direction:column;overflow:hidden;font-size:16px}
    @media (max-width:499px){.pw-phone{width:100vw;height:100dvh}}
    @media (min-width:500px){.pw-phone{border-radius:28px;box-shadow:0 0 0 10px #111,0 20px 60px rgba(0,0,0,.5)}}
    .pw-screen{flex:1;display:flex;flex-direction:column;min-height:0}
    .pw-switch{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99500;display:flex;gap:6px;align-items:center;background:#111;color:#fff;border-radius:999px;padding:4px 8px;font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.4)}
    .pw-switch-btn{background:#333;color:#fff;border:0;border-radius:999px;width:30px;height:30px;cursor:pointer}
    .pw-switch-label{min-width:120px;text-align:center}
    @media (max-width:499px){.pw-switch{bottom:auto;top:4px;opacity:.85}}
    .pw-banner{position:fixed;top:0;left:0;right:0;z-index:8000;display:flex;gap:8px;align-items:center;padding:8px 12px;background:var(--accent);color:var(--paper);flex-wrap:wrap}
    .pw-banner-btn{background:var(--paper);color:var(--ink);border:0;border-radius:999px;padding:8px 14px;min-height:40px}
    .pw-banner-x{margin-left:auto;background:none;border:0;color:inherit;font-size:18px;min-width:40px;min-height:40px}
    /* A */
    .a-top{display:flex;align-items:center;gap:8px;padding:10px 12px}
    .a-back{font-size:24px;background:none;border:0;color:var(--ink);min-width:44px;min-height:44px}
    .a-progress{display:flex;gap:4px;flex:1}.a-dot{flex:1;height:6px;border-radius:3px;background:var(--panel)}.a-dot.done{background:var(--accent);opacity:.5}.a-dot.on{background:var(--accent)}
    .a-body{flex:1;overflow:auto;padding:4px 16px 16px}.a-body.center{text-align:center;padding-top:40px}.a-big{font-size:56px}
    .a-title{font-size:24px;margin:8px 0 4px}.a-sub{opacity:.8;margin:0 0 14px;line-height:1.35}.a-sub.small{font-size:13px;margin-top:12px}.a-sub.over{color:var(--accent);opacity:1;font-weight:600}
    .a-tiles{display:grid;gap:8px}.a-tiles.grid3{grid-template-columns:repeat(3,1fr)}.a-tiles.grid4{grid-template-columns:repeat(4,1fr)}.a-tiles.grid2{grid-template-columns:1fr 1fr}
    .a-tile{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center;text-align:left;padding:12px 14px;min-height:56px;border:2px solid var(--panel);border-radius:14px;background:var(--panel);color:var(--ink);font-size:16px}
    .grid3 .a-tile,.grid4 .a-tile,.grid2 .a-tile{grid-template-columns:1fr;text-align:center;justify-items:center;font-size:14px;padding:10px 6px}
    .a-tile.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--paper))}
    .a-tile-icon{font-size:28px;grid-row:span 2}.a-tile-name{font-weight:700}.a-tile-hint{font-size:13px;opacity:.75;grid-column:2}
    .a-more{margin-top:12px}.a-more summary{padding:12px 0;font-weight:600}.a-select,.a-input{width:100%;font-size:18px;padding:12px;border-radius:12px;border:2px solid var(--panel);background:var(--paper);color:var(--ink);box-sizing:border-box}
    .a-foot{display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--panel)}
    .a-next{flex:1;min-height:52px;font-size:18px;font-weight:700;border:0;border-radius:14px;background:var(--accent);color:var(--paper)}.a-next:disabled{opacity:.5}
    .a-skip{min-height:52px;padding:0 14px;border-radius:14px;border:2px solid var(--panel);background:none;color:var(--ink)}
    .a-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .a-chip{border:2px solid var(--panel);background:var(--panel);color:var(--ink);border-radius:999px;padding:8px 12px;min-height:40px;font-size:14px}.a-chip.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,var(--paper))}.a-chip.big{font-size:15px}
    .a-chips{display:flex;flex-wrap:wrap;gap:8px}
    .a-scores{display:grid;gap:6px}.a-score{display:grid;grid-template-columns:1fr 44px 36px 44px 40px;align-items:center;gap:4px;padding:6px 0;border-bottom:1px solid var(--panel)}
    .a-score-lab small{display:block;font-size:12px;opacity:.7;line-height:1.2}.a-step{min-height:44px;border-radius:10px;border:0;background:var(--panel);color:var(--ink);font-size:22px}
    .a-score-v{text-align:center;font-size:20px;font-weight:700}.a-score-m{text-align:center;opacity:.8}
    .a-review{display:grid;gap:6px}.a-review-line{display:grid;grid-template-columns:90px 1fr auto;gap:8px;text-align:left;padding:12px;border-radius:12px;border:0;background:var(--panel);color:var(--ink);font-size:15px}.a-edit{opacity:.6}
    /* B */
    .b-page{flex:1;overflow:auto;padding-bottom:12px}
    .b-head{display:grid;grid-template-columns:44px 1fr;align-items:center;padding:10px 12px 6px}.b-head h2{margin:0}.b-head-sub{grid-column:1/-1;font-size:14px;opacity:.75}
    .b-x{min-width:44px;min-height:44px;background:none;border:0;color:var(--ink);font-size:20px}
    .b-sec{margin:8px 12px;border-radius:14px;background:var(--panel)}.b-sec summary{display:flex;flex-direction:column;padding:14px;cursor:pointer}
    .b-sec-t{font-weight:700}.b-val{font-size:14px;opacity:.75}.b-inner{padding:0 14px 14px;display:grid;gap:10px}
    .b-field{display:grid;gap:4px}.b-lab{font-size:14px;font-weight:600;display:flex;gap:4px;align-items:center}
    .b-select,.b-input{width:100%;font-size:17px;padding:10px;border-radius:10px;border:1px solid var(--line, #9995);background:var(--paper);color:var(--ink);box-sizing:border-box;min-height:44px}
    .b-note{font-size:14px;opacity:.8;margin:0}
    .b-i{background:none;border:0;color:var(--accent);font-size:16px;min-width:32px;min-height:32px}.b-tip{display:none;font-weight:400;font-size:13px;opacity:.85}.b-tip.show{display:block}.b-info{display:inline-flex;flex-direction:column}
    .b-seg{display:flex;flex-wrap:wrap;gap:6px}.b-seg-btn{flex:1 1 30%;min-height:40px;border-radius:10px;border:1px solid var(--accent);background:var(--paper);color:var(--ink)}.b-seg-btn.on{background:var(--accent);color:var(--paper)}
    .b-abil{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.b-abil-cell{display:grid;justify-items:center;padding:6px;border-radius:10px;background:var(--paper)}.b-abil-l{font-size:12px;font-weight:700;display:flex;align-items:center}
    .b-num{width:60px;font-size:20px;text-align:center;padding:6px;border-radius:8px;border:1px solid #9995;background:var(--paper);color:var(--ink)}.b-mod{font-size:13px;opacity:.8}
    .b-foot{padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--panel);background:var(--paper)}
    .b-status{margin:0 0 6px;font-size:13px;opacity:.85}.b-status:empty{display:none}
    .b-create{width:100%;min-height:52px;font-size:18px;font-weight:700;border:0;border-radius:14px;background:var(--accent);color:var(--paper)}.b-create:disabled{opacity:.5}
    /* C */
    .c-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--panel)}.c-avatar{font-size:28px}.c-who{flex:1;font-weight:700}
    .c-x{min-width:44px;min-height:44px;background:none;border:0;color:var(--ink);font-size:20px}
    .c-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
    .c-msg{max-width:85%;padding:10px 14px;border-radius:18px;line-height:1.35;white-space:pre-line}
    .c-msg.guide{align-self:flex-start;background:var(--panel);border-bottom-left-radius:4px}.c-msg.me{align-self:flex-end;background:var(--accent);color:var(--paper);border-bottom-right-radius:4px}
    .c-msg.card{max-width:100%;width:100%;box-sizing:border-box}
    .c-card-t{margin-bottom:8px}.c-abil{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}.c-abil-cell{display:grid;justify-items:center;background:var(--paper);border-radius:8px;padding:4px 0}.c-abil-cell b{font-size:18px}.c-abil-in{width:44px;font-size:17px;text-align:center;border:1px solid #9995;border-radius:6px;background:var(--paper);color:var(--ink)}
    .c-replies{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--panel);max-height:45%;overflow:auto}
    .c-chip{border:2px solid var(--accent);background:var(--paper);color:var(--ink);border-radius:999px;padding:8px 14px;min-height:42px;font-size:15px}.c-chip.on{background:color-mix(in srgb,var(--accent) 22%,var(--paper))}
    .c-chip.primary{background:var(--accent);color:var(--paper)}.c-chip.ghost{border-style:dashed;opacity:.85}
    .c-input{flex:1 1 100%;font-size:17px;padding:10px;border-radius:12px;border:1px solid #9995;background:var(--paper);color:var(--ink)}
    `;
    function boot() {
        const st = document.createElement('style');
        st.textContent = css;
        document.head.append(st);
        document.body.append(bar);
        if (window.SheetCreate) window.SheetCreate.open = openFrame;   // 🧭 Guided create opens the prototype too
        openFrame();
    }
    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', () => setTimeout(boot, 300));
})();
