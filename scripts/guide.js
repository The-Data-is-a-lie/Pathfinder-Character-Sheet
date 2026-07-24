// Beginner-facing wording for the character sheet: the plain-English glossary behind
// "Explain" mode, and the content of the Instructions overlay.
//
// This is the ONE place kid-facing copy lives. The sublabels under stat boxes and the
// "What the numbers mean" section of the Instructions overlay both read from GLOSSARY, so
// the two can never drift apart. Keys are the exact label strings the sheet already renders
// (see spCell / spBoxBig / spHeading / spTable in sheet.js) — a term with no entry simply
// renders no hint, so this file can grow without touching any render code.
//
// House style for entries: plain and concrete, second person, 8-14 words, about what happens
// in the story rather than how the rules work. "how hard you are to trip or grab", not
// "the DC to resist a combat maneuver".

window.SheetGuide = (function () {
    'use strict';

    // Grouped for the Instructions overlay; flattened into a lookup map below.
    const GROUPS = [
        {
            title: 'Your six ability scores',
            lead: 'Every hero has these six. Higher is better.',
            terms: [
                ['STR', 'how strong you are — lifting, shoving and hitting hard'],
                ['DEX', 'how quick and nimble you are — dodging, aiming, balancing'],
                ['CON', 'how tough you are — staying on your feet when things hurt'],
                ['INT', 'how much you know, and how fast you figure things out'],
                ['WIS', 'how much you notice, and how good your gut feelings are'],
                ['CHA', 'how well you talk people around, and how much they notice you'],
            ],
        },
        {
            title: 'Staying alive',
            terms: [
                ['Max HP', 'how much hurt you can take before you drop'],
                ['Current HP', 'how much hurt you can still take right now'],
                ['Nonlethal', 'bumps and bruises that knock you out instead of killing you'],
                ['AC', 'how hard you are to hit'],
                ['Touch', 'how hard you are to hit with a quick jab or a zap of magic'],
                ['Flat-Footed', 'how hard you are to hit before you get a chance to react'],
                ['SR', 'a shield around you that some spells just bounce off'],
            ],
        },
        {
            title: 'Saving throws — dodging trouble',
            lead: 'When something nasty happens to you, you roll one of these to avoid the worst of it.',
            terms: [
                ['Fortitude', 'shrugging off poison, disease and pure exhaustion'],
                ['Reflex', 'dodging out of the way fast'],
                ['Will', 'keeping your head when magic tries to trick you'],
            ],
        },
        {
            title: 'Fighting',
            terms: [
                ['Initiative', 'who goes first in a fight'],
                ['Speed', 'how far you can move in one turn, in feet'],
                ['BAB', 'how good you are at hitting things'],
                ['Melee', 'hitting someone standing right next to you'],
                ['Ranged', 'hitting someone far away, with a bow or a thrown rock'],
                ['CMB', 'how good you are at tripping, grabbing and shoving people'],
                ['CMD', 'how hard you are to trip, grab or shove'],
            ],
        },
        {
            title: 'What your hero can do',
            terms: [
                ['Skills', 'things you have practised — sneaking, climbing, spotting traps'],
                ['Feats', 'special tricks your hero has learned to do'],
                ['Traits & Flaws', 'small good and bad things left over from your past'],
                ['Special Abilities', 'powers you get from your race or your class'],
                ['Spells', 'the magic you can cast'],
                ['Languages', 'the languages your hero can speak'],
            ],
        },
        {
            title: 'Who your hero is',
            terms: [
                ['Class & Level', 'what your hero does for a living, and how experienced they are'],
                ['Race', 'what kind of creature your hero is — human, elf, dwarf and so on'],
                ['Alignment', 'how your hero tends to act — kind or cruel, orderly or wild'],
                ['Deity', 'the god your hero follows, if any'],
                ['Homeland', 'the part of the world your hero comes from'],
                ['Size', 'how big your hero is'],
                ['Experience', 'points you earn for adventuring — enough of them and you level up'],
                ['Money', 'the coins in your pocket'],
                ['Gear', 'everything you are carrying'],
                ['Weapons', 'what you fight with'],
            ],
        },
    ];

    // Headings on the simple sheet get a one-line "what this block is" note.
    const HEADINGS = {
        'Ability Scores': 'the six numbers that say what your hero is naturally good at',
        'Hit Points & Initiative': 'how much hurt you can take, and how fast you act',
        'Defense': 'how hard you are to hit and to hurt',
        'Saving Throws': 'your chances to avoid something nasty that is already happening',
        'Offense': 'how well you hit things',
        'Biography & Notes': 'who your hero is, and anything you want to remember',
    };

    // The complex view abbreviates some of the same stats ("Init", "Fort"). Alias them onto
    // the canonical entry rather than writing the wording twice.
    const ALIASES = {
        'Init': 'Initiative',
        'Fort': 'Fortitude',
        'Ref': 'Reflex',
        'HP': 'Max HP',
        'Hit Points': 'Max HP',
        'Spell Resistance': 'SR',
        'Base Attack Bonus': 'BAB',
        'CMB (maneuvers)': 'CMB',
    };

    // Flat lookup: label -> hint. Headings merge in on top of the grouped terms.
    const GLOSSARY = {};
    for (const group of GROUPS) {
        for (const [term, hint] of group.terms) GLOSSARY[term] = hint;
    }
    Object.assign(GLOSSARY, HEADINGS);
    for (const [alias, target] of Object.entries(ALIASES)) {
        if (GLOSSARY[target]) GLOSSARY[alias] = GLOSSARY[target];
    }

    // Labels arrive from render helpers in whatever case/spacing the sheet uses; normalize so
    // 'Flat-Footed', 'flat-footed' and 'Flat-Footed ' all land on the same entry.
    const NORMALIZED = {};
    for (const [term, hint] of Object.entries(GLOSSARY)) {
        NORMALIZED[term.trim().toLowerCase()] = hint;
    }

    function hintFor(label) {
        if (label == null) return null;
        const key = String(label).trim().toLowerCase();
        return NORMALIZED[key] || null;
    }

    const INSTRUCTIONS = [
        {
            title: 'What is this?',
            paras: [
                'This is a character sheet for the game Pathfinder. A character sheet is just a record of one pretend hero — what they are good at, what they are carrying, and what they can do.',
                'Everything on it is either a number you roll dice against, or a note about who your hero is. Nothing here can break, so click things and see what happens.',
            ],
        },
        {
            title: 'Make your own character',
            paras: ['Hit the big Generate button — on the right-hand strip, or up in the bar at the top.'],
            steps: [
                'Pick what kind of creature you want to be (your race).',
                'Pick what you do (your class) — a Fighter hits things, a Wizard casts spells, a Rogue sneaks.',
                'Pick a level. Level 1 is brand new; level 5 has a few tricks already.',
                'Hit Roll it! — or Surprise me if you would rather the computer chose.',
                'Wait a bit. The first character of the day can take up to a minute to appear.',
            ],
            note: 'Want more control? Open "More options" for everything else the generator can do.',
        },
        {
            title: 'Simple and Complex',
            paras: [
                'There are two ways to look at the same hero, and you can swap whenever you like using the Simple / Complex switch.',
                'Simple is one page that looks like a paper character sheet. It is the one to print out and take to the table.',
                'Complex splits everything across tabs, with far more detail — every feat, every spell, every piece of gear, and buttons that roll the dice for you.',
            ],
        },
        {
            title: 'What the numbers mean',
            glossary: true,
        },
        {
            title: 'Rolling dice',
            paras: [
                'Anywhere you see a Roll button, clicking it rolls the dice for you and shows the result.',
                'The ☰ button on the left edge opens the Tools drawer, where you can roll any dice you like and see a list of everything you have rolled.',
            ],
        },
        {
            title: 'Saving and printing',
            paras: [
                'Your hero is saved in this browser automatically — close the page and they will still be here when you come back.',
                'Use the dropdown at the top to swap between heroes you have made, and Print to put your sheet on paper.',
            ],
        },
    ];

    // The 30-second on-ramp. INSTRUCTIONS above is the reference manual — thorough, and far
    // too much for someone's first ten seconds, who will read a wall of text and leave. This
    // is what a newcomer actually needs: four steps and a button that starts the game.
    const START = {
        lead: 'Four steps and you have a hero.',
        steps: [
            'Hit Generate, then pick a race, a class and a level.',
            'Press Roll it! and wait — the first hero of the day takes a minute.',
            'Simple is one page. Complex shows every detail, across tabs.',
            '💡 Explain puts plain-English notes under every number.',
        ],
        go: '🎲 Make a character',
        more: 'Show me everything',
        expert: "I've played before — hide the beginner stuff",
    };

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = String(text);
        return node;
    }

    /** Builds the Instructions overlay body. Section 4 renders straight from GROUPS. */
    function buildInstructions() {
        const wrap = el('div', 'guide');
        for (const section of INSTRUCTIONS) {
            wrap.appendChild(el('h3', 'guide-h', section.title));
            for (const p of section.paras || []) wrap.appendChild(el('p', 'guide-p', p));
            if (section.steps) {
                const ol = el('ol', 'guide-steps');
                for (const s of section.steps) ol.appendChild(el('li', null, s));
                wrap.appendChild(ol);
            }
            if (section.note) wrap.appendChild(el('p', 'guide-note', section.note));
            if (section.glossary) {
                for (const group of GROUPS) {
                    wrap.appendChild(el('h4', 'guide-h4', group.title));
                    if (group.lead) wrap.appendChild(el('p', 'guide-p', group.lead));
                    const dl = el('dl', 'guide-terms');
                    for (const [term, hint] of group.terms) {
                        dl.appendChild(el('dt', null, term));
                        dl.appendChild(el('dd', null, hint));
                    }
                    wrap.appendChild(dl);
                }
            }
        }
        return wrap;
    }

    /**
     * Builds the Start-here card. Callbacks are injected rather than looked up, so this file
     * stays copy + DOM and never reaches into sheet state — same contract buildInstructions
     * already keeps.
     *
     * @param {{onGenerate: Function, onFull: Function, onExpert: Function}} actions
     */
    function buildStartHere(actions) {
        const wrap = el('div', 'start');
        wrap.appendChild(el('p', 'start-lead', START.lead));

        const ol = el('ol', 'start-steps');
        for (const step of START.steps) ol.appendChild(el('li', null, step));
        wrap.appendChild(ol);

        const go = el('button', 'start-go', START.go);
        go.type = 'button';
        go.addEventListener('click', () => actions?.onGenerate?.());
        wrap.appendChild(go);

        const links = el('div', 'start-links');
        for (const [text, run] of [[START.more, actions?.onFull], [START.expert, actions?.onExpert]]) {
            const link = el('button', 'start-link', text);
            link.type = 'button';
            link.addEventListener('click', () => run?.());
            links.appendChild(link);
        }
        wrap.appendChild(links);
        return wrap;
    }

    return { GLOSSARY, GROUPS, INSTRUCTIONS, START, hintFor, buildInstructions, buildStartHere };
})();
