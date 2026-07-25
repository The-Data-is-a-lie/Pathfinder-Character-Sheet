// scripts/generate.js -- the generation form: payload build, quick-level + presets, submit,
// JSON load (window.SheetGenerate). Extracted from sheet.js (Part B split); bodies moved
// verbatim except FORM_KEY (read from SheetApp). Loads after roster.js (uses adoptCharacter),
// before the tabs. backendUrl / togglePanel are shell-owned and late-bound via SheetApp.
window.SheetGenerate = (function () {
    'use strict';
    const { parseIntLoose } = window.SheetUI;
    const { adoptCharacter } = window.SheetRoster;
    const backendUrl = () => window.SheetApp.backendUrl();
    const { togglePanel } = window.SheetShellUI;

    // ---------------------------------------------------------------- generate form
    function fillSelect(sel, options, valueFn) {
        for (const o of options) {
            const opt = document.createElement('option');
            opt.value = valueFn ? valueFn(o) : o;
            opt.textContent = o;
            sel.appendChild(opt);
        }
    }
    /**
     * Same as fillSelect, but splits the list into a "Common" optgroup and a "More…" one so a
     * beginner isn't scrolling past Yaddithian to find Gnome. `core` is a Set of labels; the
     * Random entry always leads. Nothing is removed — everything stays reachable.
     */
    function fillGroupedSelect(sel, options, core, moreLabel, valueFn) {
        const opt = (o, text) => {
            const node = document.createElement('option');
            node.value = valueFn ? valueFn(o) : o;
            node.textContent = text || o;
            return node;
        };
        const isRandom = (o) => String(o).toLowerCase() === 'random';
        const random = options.filter(isRandom);
        const common = options.filter((o) => !isRandom(o) && core.has(o));
        const rest = options.filter((o) => !isRandom(o) && !core.has(o));

        const top = document.createElement('optgroup');
        top.label = 'Common';
        for (const o of random) top.appendChild(opt(o, 'Surprise me (Random)'));
        for (const o of common) top.appendChild(opt(o));
        sel.appendChild(top);

        if (rest.length) {
            const more = document.createElement('optgroup');
            more.label = `${moreLabel} (${rest.length})`;
            for (const o of rest) more.appendChild(opt(o));
            sel.appendChild(more);
        }
    }
    // /update_character_data unpacks the payload POSITIONALLY (spheres_of_power is popped by
    // name), so this key order must stay exactly in sync with the Foundry module's button.js,
    // with use_backstory_api + backstory_focus appended as the optional 20th/21st inputs.
    function buildPayload(form) {
        const f = (name) => form.elements[name].value;
        return {
            input: 'Y',
            region: f('region'),
            race: f('race'),
            class: f('class'),
            bab: f('bab'),
            caster_level: f('caster_level'),
            multiclass: f('multiclass'),
            alignment: f('alignment'),
            deity: f('deity'),
            gender: f('gender'),
            randomFeats: f('randomFeats'),
            inherents: f('inherents'),
            modded_char_sheet: f('modded_char_sheet'),
            homebrew_feat_amount: f('homebrew_feat_amount'),
            spheres_of_power: f('spheres_of_power'),
            diceRolls: f('diceRolls'),
            diceSides: f('diceSides'),
            highestLevel: f('highestLevel'),
            lowestLevel: f('lowestLevel'),
            goldAmount: f('goldAmount'),
            use_backstory_api: f('use_backstory_api'),
            backstory_focus: f('backstory_focus'),
        };
    }
    // ------------------------------------------------------------ quick generate form
    // The quick block drives the same named controls the advanced grid always used. Level is
    // the one exception: the generator takes a RANGE (highestLevel/lowestLevel), so the single
    // kid-facing select mirrors into both. Set them to different values in More options and
    // the quick select shows the range instead of pretending it's one number.
    const QUICK_LEVEL_MAX = 20;
    function quickLevelSelect(form) {
        return form?.elements?.quickLevel || null;
    }
    function fillQuickLevel(form) {
        const sel = quickLevelSelect(form);
        if (!sel || sel.options.length) return;
        for (let i = 1; i <= QUICK_LEVEL_MAX; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = 'Level ' + i;
            sel.appendChild(opt);
        }
        const range = document.createElement('option');
        range.value = 'range';
        range.textContent = 'a range (see More options)';
        range.disabled = true;
        sel.appendChild(range);
    }
    /** Quick select → the two real level inputs. */
    function applyQuickLevel(form) {
        const sel = quickLevelSelect(form);
        if (!sel || sel.value === 'range') return;
        form.elements.highestLevel.value = sel.value;
        form.elements.lowestLevel.value = sel.value;
    }
    /** The two real level inputs → quick select (after a form restore or an advanced edit). */
    function syncQuickLevel(form) {
        const sel = quickLevelSelect(form);
        if (!sel) return;
        const hi = parseIntLoose(form.elements.highestLevel.value, 5);
        const lo = parseIntLoose(form.elements.lowestLevel.value, hi);
        if (hi === lo && hi >= 1 && hi <= QUICK_LEVEL_MAX) {
            sel.value = String(hi);
            sel.querySelector('option[value="range"]').textContent = 'a range (see More options)';
        } else {
            const opt = sel.querySelector('option[value="range"]');
            opt.textContent = `levels ${lo}–${hi} (More options)`;
            opt.disabled = false;
            sel.value = 'range';
        }
    }
    // One-click starting points for the 20 advanced generator fields. Each preset sets ONLY
    // its listed fields (never race/class/level) and does not submit, so a power user can
    // dial in a baseline and then tweak before rolling. Values must match option values in
    // the index.html advanced grid.
    const GEN_PRESETS = {
        standard: {
            label: 'Standard',
            fields: { bab: 'random', caster_level: 'random', multiclass: 'n',
                inherents: 'n', spheres_of_power: 'n', modded_char_sheet: 'n',
                homebrew_feat_amount: 'n' },
        },
        high: {
            label: 'High-powered',
            fields: { bab: 'h', caster_level: 'high', inherents: 'y' },
        },
        multiclass: {
            label: 'Multiclass',
            fields: { multiclass: 'y' },
        },
        spheres: {
            label: 'Spheres',
            fields: { spheres_of_power: 'y', modded_char_sheet: 'y' },
        },
    };
    function applyGenPreset(form, id) {
        const preset = GEN_PRESETS[id];
        if (!preset) return;
        // Open the advanced panel so a changed field is seen, not silently set behind a fold.
        const adv = document.querySelector('.gen-advanced');
        if (adv && !adv.open) adv.open = true;
        for (const [name, value] of Object.entries(preset.fields)) {
            const el = form.elements[name];
            if (!el || el.disabled) continue;
            // Only assign a value that exists as a real option, so a stale preset can't wedge
            // a select onto a nonexistent entry.
            if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === value)) continue;
            el.value = value;
        }
        window.SheetOverlay?.toast?.(preset.label + ' preset applied');
    }
    function surpriseMe(form) {
        const pick = (sel) => {
            const opts = Array.from(sel.options).filter((o) => !o.disabled
                && String(o.value).toLowerCase() !== 'random');
            if (opts.length) sel.value = opts[Math.floor(Math.random() * opts.length)].value;
        };
        pick(form.elements.race);
        pick(form.elements.class);
        applyQuickLevel(form);
        generate(form);
    }
    async function generate(form) {
        const status = document.getElementById('gen-status');
        // Two ways in now — the quick "Roll it!" and the advanced "Generate Character".
        const buttons = ['gen-roll', 'gen-submit', 'gen-surprise']
            .map((id) => document.getElementById(id)).filter(Boolean);
        const payload = buildPayload(form);
        localStorage.setItem(window.SheetApp.FORM_KEY, JSON.stringify(payload));
        for (const b of buttons) b.disabled = true;
        status.textContent = 'Rolling up your hero… this can take up to a minute the first time.';
        try {
            const resp = await fetch(backendUrl() + '/update_character_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            await adoptCharacter(data);
            status.textContent = '';
            document.getElementById('gen-panel').classList.add('hidden');
        } catch (err) {
            status.textContent = 'Failed: ' + err.message;
        } finally {
            for (const b of buttons) b.disabled = false;
        }
    }
    function loadJsonText(text) {
        try {
            const data = JSON.parse(text);
            adoptCharacter(data);
            document.getElementById('load-panel').classList.add('hidden');
        } catch (err) {
            alert('Not valid JSON: ' + err.message);
        }
    }

    return {
        fillSelect, fillGroupedSelect, buildPayload, quickLevelSelect, fillQuickLevel,
        applyQuickLevel, syncQuickLevel, applyGenPreset, surpriseMe, generate, loadJsonText,
    };
})();
