// scripts/companion-sheet.js -- #141: a companion's full mini-sheet (window.SheetCompanionSheet).
// A full-screen SheetOverlay with four internal tabs — Vitals · Buffs · Skills · Features —
// over the derived model in domain/companion-adapter.js. The Companions tab stays a roster of
// cards; this is where a creature is actually played.
//
// Every number is DERIVED (abilities, HD, BAB, size, its own buffs and conditions) and every
// derived box takes a hand override: double-click to type one, ↺ to drop it. An overridden
// box carries the "edited" mark, and backend refreshes never write over anything edited.
// Rolls land in the shared Tools log, prefixed with the creature's name, exactly as the
// roster cards' rolls always have.
window.SheetCompanionSheet = (function () {
    'use strict';
    const AD = () => window.SheetCompanionAdapter;
    const h = (...a) => window.SheetUI.h(...a);
    const fmt = (n) => window.SheetUI.fmt(n);
    const AB = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const TABS = [['vitals', 'Vitals'], ['buffs', 'Buffs'], ['skills', 'Skills'], ['features', 'Features']];
    // The change targets a creature can meaningfully carry. Labels come from the master's
    // own vocabulary (SheetDetails.targetLabel), so a buff reads the same in both places.
    const TARGETS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'nac', 'attack', 'damage',
        'allSavingThrows', 'fort', 'ref', 'will', 'cmb', 'cmd', 'init', 'skills', 'mhp'];
    const TYPES = ['untyped', 'enh', 'morale', 'competence', 'luck', 'insight', 'sacred', 'profane',
        'dodge', 'deflection', 'natural', 'size', 'circumstance', 'resist', 'penalty'];

    let handle = null;
    let activeTab = 'vitals';

    function rollLog(comp, label, bonus) {
        const r = window.SheetRoll?.rollAndLog?.('1d20' + fmt(Number(bonus) || 0), `${comp.name} — ${label}`);
        if (r?.ok) window.SheetOverlay?.toast?.(`${comp.name} — ${label}: ${r.total}`);
    }
    function rollFormula(comp, label, formula) {
        const r = window.SheetRoll?.rollAndLog?.(formula, `${comp.name} — ${label}`);
        if (r?.ok) window.SheetOverlay?.toast?.(`${comp.name} — ${label}: ${r.total}`);
    }
    const partsTitle = (parts) => (parts || [])
        .filter((p) => !p.info && (p.value || p.unresolved))
        .map((p) => `${p.label} ${p.unresolved ? '(?)' : fmt(Number(p.value) || 0)}`).join('\n');

    function open(data, compId) {
        const list = window.SheetTabCompanions.companions(data);
        const comp = list.find((c) => c.id === compId);
        if (!comp) return null;
        AD().migrate(comp, null);
        handle?.close();
        const root = h('div', 'companion-sheet');
        root.dataset.companion = comp.id;

        const commit = () => {
            AD().syncLegacy(comp);
            window.SheetState.quietSave();
            paint();
        };

        // ---- small editors --------------------------------------------------------------- //
        /** A base number: a plain number input. Edits mark the path so the backend leaves it. */
        function baseInput(path, value, cls) {
            const inp = h('input', 'edit-field companion-sheet-num ' + (cls || ''));
            inp.type = 'number';
            inp.value = String(value ?? 0);
            inp.dataset.base = path;
            inp.addEventListener('change', () => { AD().setBase(comp, path, Number(inp.value) || 0); commit(); });
            return inp;
        }
        /** A derived number with an override: dblclick to type, ↺ to drop. */
        function derivedBox(field, derivedTotal, parts, opts = {}) {
            const edited = AD().isOverridden(comp, field);
            const shown = edited ? comp.overrides[field] : derivedTotal;
            const wrap = h('span', 'companion-sheet-derived' + (edited ? ' is-edited' : ''));
            wrap.dataset.field = field;
            const val = h('span', 'companion-sheet-value', opts.text ? String(shown) : fmt(Number(shown) || 0)
                .replace(/^\+/, opts.signed ? '+' : ''));
            val.title = (edited ? `Edited by hand (derived: ${derivedTotal})\n` : '')
                + (partsTitle(parts) || '') + '\nDouble-click to override';
            val.addEventListener('dblclick', () => {
                const inp = h('input', 'edit-field companion-sheet-num');
                inp.type = opts.text ? 'text' : 'number';
                inp.value = String(shown);
                const done = (save) => {
                    if (save) {
                        const raw = inp.value.trim();
                        if (raw === '') AD().clearOverride(comp, field);
                        else AD().setOverride(comp, field, opts.text ? raw : Number(raw) || 0);
                    }
                    commit();
                };
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); done(true); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
                });
                inp.addEventListener('blur', () => done(true));
                val.replaceWith(inp);
                inp.focus();
                inp.select();
            });
            wrap.appendChild(val);
            if (edited) {
                const mark = h('span', 'companion-edited-mark', 'edited');
                mark.title = `Hand edit — the derived value is ${derivedTotal}`;
                const reset = h('button', 'inv-btn companion-sheet-reset', '↺');
                reset.type = 'button';
                reset.title = `Use the derived value (${derivedTotal})`;
                reset.addEventListener('click', () => { AD().clearOverride(comp, field); commit(); });
                wrap.append(mark, reset);
            }
            return wrap;
        }
        function rollBtn(label, bonus, title) {
            const b = h('button', 'inv-btn companion-roll', label);
            b.type = 'button';
            b.title = title || 'Roll';
            b.addEventListener('click', bonus);
            return b;
        }

        // ---- Vitals ---------------------------------------------------------------------- //
        function vitals(d) {
            const pane = h('div', 'companion-sheet-pane');
            const b = comp.base;
            const shared = window.SheetCompanionShare?.sharedBonuses?.(data) || null;
            const plus = (f) => (shared ? Number(shared[f]) || 0 : 0);
            const badge = (f) => {
                const n = plus(f);
                if (!n) return null;
                const s = h('span', 'companion-shared', fmt(n));
                s.title = 'Shared buffs: ' + window.SheetCompanionShare.describe(shared, f);
                return s;
            };

            // identity strip
            const id = h('div', 'companion-sheet-row');
            const name = h('input', 'edit-field companion-sheet-name');
            name.value = comp.name || '';
            name.addEventListener('change', () => {
                comp.name = name.value.trim() || comp.name;
                handle?.card?.querySelector('.overlay-title')?.replaceChildren(comp.name);
                commit();
            });
            id.append(name, h('span', 'feat-tag', comp.type || 'companion'));
            const hdWrap = h('label', 'companion-sheet-field');
            hdWrap.append('HD ', baseInput('hd', b.hd));
            const babWrap = h('label', 'companion-sheet-field');
            babWrap.append('BAB ', baseInput('bab', b.bab));
            const sizeSel = h('select', 'edit-field companion-sheet-size');
            for (const s of window.SheetData.SIZES) {
                const o = h('option', null, s.label);
                o.value = s.id;
                if (s.id === b.size) o.selected = true;
                sizeSel.appendChild(o);
            }
            sizeSel.addEventListener('change', () => { AD().setBase(comp, 'size', sizeSel.value); commit(); });
            const sizeWrap = h('label', 'companion-sheet-field');
            sizeWrap.append('Base size ', sizeSel);
            if (d.size.id !== b.size) sizeWrap.appendChild(h('span', 'dim', ` → ${d.size.label} (buff)`));
            id.append(hdWrap, babWrap, sizeWrap);
            pane.appendChild(id);

            // HP card
            const hp = AD().hpOf(comp);
            const hpCard = h('div', 'companion-sheet-card companion-sheet-hp');
            const hpLine = h('div', 'companion-sheet-row');
            const cur = h('span', 'companion-hp-current' + (hp.max > 0 && hp.cur <= hp.max / 2 ? ' is-low' : ''), String(hp.cur));
            hpLine.append(h('span', 'companion-vital-label', 'HP'), cur, ' / ',
                derivedBox('hpMax', d.blocks.hpMax.total, d.blocks.hpMax.parts),
                h('span', 'dim', ` · temp ${hp.temp} · NL ${hp.nl}`));
            const rolled = h('label', 'companion-sheet-field');
            rolled.append(`Rolled HD${b.hitDie ? ' (' + b.hitDie + ')' : ''} `, baseInput('rolledHp', b.rolledHp));
            hpLine.appendChild(rolled);
            hpCard.appendChild(hpLine);
            const apply = h('div', 'companion-sheet-row');
            const amt = h('input', 'edit-field companion-hp-amount');
            amt.type = 'number';
            amt.min = '0';
            amt.placeholder = 'amount';
            const ap = (label, fn, cls) => {
                const btn = h('button', 'inv-btn ' + (cls || ''), label);
                btn.type = 'button';
                btn.dataset.hpAction = label;
                btn.addEventListener('click', () => {
                    const n = Math.max(0, Number(amt.value) || 0);
                    if (!n) { amt.focus(); return; }
                    fn(n);
                    window.SheetState.quietSave();
                    paint();
                });
                return btn;
            };
            const temp = h('label', 'companion-sheet-field');
            const tempIn = h('input', 'edit-field companion-sheet-num');
            tempIn.type = 'number';
            tempIn.value = String(hp.temp);
            tempIn.addEventListener('change', () => { comp._sheet.hpTemp = Number(tempIn.value) || 0; commit(); });
            temp.append('Temp ', tempIn);
            apply.append(amt,
                ap('Damage', (n) => AD().applyDamage(comp, n), 'inv-btn-danger'),
                ap('Heal', (n) => AD().applyHealing(comp, n)),
                ap('NL', (n) => AD().applyDamage(comp, n, { nonlethal: true })),
                temp);
            hpCard.appendChild(apply);
            pane.appendChild(hpCard);

            // abilities
            const abCard = h('div', 'companion-sheet-card companion-sheet-abilities');
            for (const ab of AB) {
                const cell = h('div', 'companion-sheet-ab');
                const info = d.abilities[ab];
                cell.appendChild(h('span', 'companion-vital-label', ab.toUpperCase()));
                cell.appendChild(baseInput('abilities.' + ab, b.abilities[ab], 'companion-sheet-ab-input'));
                const tot = h('span', 'companion-sheet-ab-total',
                    (info.total !== b.abilities[ab] ? info.total + ' ' : '') + `(${fmt(info.mod)})`);
                tot.title = info.formula;
                cell.appendChild(tot);
                cell.appendChild(rollBtn('🎲', () => rollLog(comp, ab.toUpperCase() + ' check', info.mod), 'Roll ' + ab.toUpperCase() + ' check'));
                abCard.appendChild(cell);
            }
            pane.appendChild(abCard);

            // defense + offense grid
            const grid = h('div', 'companion-sheet-card companion-sheet-grid');
            const cell = (label, field, blk, rollLabel, sharedField) => {
                const c = h('div', 'companion-sheet-stat');
                c.appendChild(h('span', 'companion-vital-label', label));
                c.appendChild(derivedBox(field, blk.total, blk.parts, { signed: !!rollLabel && field !== 'cmd' }));
                const sb = sharedField ? badge(sharedField) : null;
                if (sb) c.appendChild(sb);
                if (rollLabel) {
                    c.appendChild(rollBtn('🎲', () => rollLog(comp, rollLabel,
                        (Number(AD().value(comp, field, d)) || 0) + plus(sharedField)), 'Roll ' + rollLabel));
                }
                grid.appendChild(c);
            };
            cell('AC', 'ac', d.blocks.ac, null, 'ac');
            cell('Touch', 'touch', d.blocks.touch, null, 'touch');
            cell('Flat-footed', 'ff', d.blocks.ff, null, 'ff');
            cell('Fort', 'fort', d.blocks.fort, 'Fortitude save', 'fort');
            cell('Ref', 'ref', d.blocks.ref, 'Reflex save', 'ref');
            cell('Will', 'will', d.blocks.will, 'Will save', 'will');
            cell('Init', 'init', d.blocks.init, 'Initiative', null);
            cell('CMB', 'cmb', d.blocks.cmb, 'combat manoeuvre', 'cmb');
            cell('CMD', 'cmd', d.blocks.cmd, null, 'cmd');
            pane.appendChild(grid);

            // base saves + natural armour (the inputs behind the grid)
            const baseRow = h('div', 'companion-sheet-row dim');
            for (const [k, lbl] of [['fort', 'Fort base'], ['ref', 'Ref base'], ['will', 'Will base']]) {
                const l = h('label', 'companion-sheet-field');
                l.append(lbl + ' ', baseInput('saveBases.' + k, b.saveBases?.[k]));
                baseRow.appendChild(l);
            }
            const na = h('label', 'companion-sheet-field');
            na.append('Natural armour ', baseInput('natArmor', b.natArmor));
            baseRow.appendChild(na);
            const speed = h('label', 'companion-sheet-field');
            const sp = h('input', 'edit-field companion-sheet-speed');
            sp.value = String(comp.speed || '');
            sp.addEventListener('change', () => { comp.speed = sp.value.trim(); commit(); });
            speed.append('Speed ', sp);
            baseRow.appendChild(speed);
            pane.appendChild(baseRow);

            if (comp.evolutions && (comp.evolutions.list?.length || comp.evolutions.free?.length)) {
                pane.appendChild(window.SheetTabCompanions.renderEvolutions(comp.evolutions));
            }
            const notes = h('textarea', 'edit-field companion-notes');
            notes.rows = 3;
            notes.value = comp.notes || '';
            notes.placeholder = 'Special abilities, notes…';
            notes.addEventListener('change', () => { comp.notes = notes.value; window.SheetState.quietSave(); });
            pane.appendChild(notes);
            return pane;
        }

        // ---- Buffs & conditions ----------------------------------------------------------- //
        function changeRow(buff, ch, idx) {
            const row = h('div', 'companion-change-row');
            const f = h('input', 'edit-field companion-change-formula');
            f.value = String(ch.formula ?? '');
            f.addEventListener('change', () => { ch.formula = f.value.trim() || '0'; commit(); });
            const t = h('select', 'edit-field companion-change-target');
            const targets = TARGETS.includes(ch.target) ? TARGETS : [ch.target, ...TARGETS];
            for (const id of targets) {
                const o = h('option', null, window.SheetDetails?.targetLabel?.(id) || id);
                o.value = id;
                if (id === ch.target) o.selected = true;
                t.appendChild(o);
            }
            t.addEventListener('change', () => { ch.target = t.value; commit(); });
            const ty = h('select', 'edit-field companion-change-type');
            const types = TYPES.includes(ch.type) ? TYPES : [ch.type || 'untyped', ...TYPES];
            for (const id of types) {
                const o = h('option', null, window.SheetDetails?.typeLabel?.(id) || id);
                o.value = id;
                if (id === ch.type) o.selected = true;
                ty.appendChild(o);
            }
            ty.addEventListener('change', () => { ch.type = ty.value; commit(); });
            const rm = h('button', 'inv-btn inv-btn-danger', '×');
            rm.type = 'button';
            rm.addEventListener('click', () => { buff.changes.splice(idx, 1); commit(); });
            row.append(f, t, ty, rm);
            return row;
        }
        function buffs() {
            const pane = h('div', 'companion-sheet-pane');
            const ad = AD().toData(comp);
            const list = window.SheetState.ensureBuffs(ad);

            const condCard = h('div', 'companion-sheet-card companion-sheet-conds');
            condCard.appendChild(h('div', 'companion-vital-label', 'Conditions'));
            const active = new Set(comp._sheet.conditions || []);
            for (const c of window.SheetData.PF1_CONDITIONS) {
                const on = active.has(c.id);
                const chip = h('button', 'condition-chip' + (on ? ' is-active' : ''), c.label);
                chip.type = 'button';
                chip.title = c.note;
                chip.dataset.condition = c.id;
                chip.addEventListener('click', () => {
                    if (on) active.delete(c.id); else active.add(c.id);
                    comp._sheet.conditions = [...active];
                    commit();
                });
                condCard.appendChild(chip);
            }
            pane.appendChild(condCard);

            const card = h('div', 'companion-sheet-card companion-sheet-buffs');
            const head = h('div', 'companion-sheet-row');
            head.appendChild(h('span', 'companion-vital-label', 'Buffs'));
            const add = h('button', 'inv-btn companion-buff-add', '+ buff');
            add.type = 'button';
            add.addEventListener('click', () => {
                window.SheetState.createBuff(ad, { name: 'New buff' });
                commit();
            });
            const browse = h('button', 'inv-btn', 'Browse');
            browse.type = 'button';
            browse.addEventListener('click', () => window.SheetModals?.openCatalogPicker?.({
                title: `Add a buff to ${comp.name}`,
                kinds: ['feats', 'items', 'traits', 'classFeatures'],
                onPick: (hit) => {
                    window.SheetState.addBuffFromCatalog(ad, hit.name, hit.entry, 'temp');
                    commit();
                },
            }));
            head.append(add, browse);
            card.appendChild(head);
            if (!list.length) card.appendChild(h('p', 'dim', 'No buffs. Its own buffs apply only to this creature.'));
            list.forEach((buff, bi) => {
                const row = h('div', 'companion-buff-row');
                row.dataset.buffId = buff.id;
                const chk = h('input');
                chk.type = 'checkbox';
                chk.checked = buff.active !== false;
                chk.title = 'Active';
                chk.addEventListener('change', () => { buff.active = chk.checked; commit(); });
                const nm = h('input', 'edit-field companion-buff-name');
                nm.value = buff.name || '';
                nm.addEventListener('change', () => { buff.name = nm.value.trim() || buff.name; commit(); });
                const addCh = h('button', 'inv-btn', '+ change');
                addCh.type = 'button';
                addCh.addEventListener('click', () => {
                    buff.changes.push({ formula: '1', target: 'ac', type: 'untyped', operator: 'add', priority: 0 });
                    commit();
                });
                const del = h('button', 'inv-btn inv-btn-danger', '×');
                del.type = 'button';
                del.title = 'Delete buff';
                del.addEventListener('click', () => { list.splice(bi, 1); commit(); });
                const top = h('div', 'companion-sheet-row');
                top.append(chk, nm);
                if (buff.setSize) top.appendChild(h('span', 'feat-tag', 'size → ' + buff.setSize));
                top.append(addCh, del);
                row.appendChild(top);
                (buff.changes || []).forEach((ch, ci) => row.appendChild(changeRow(buff, ch, ci)));
                card.appendChild(row);
            });
            pane.appendChild(card);
            return pane;
        }

        // ---- Skills ----------------------------------------------------------------------- //
        function skills(d) {
            const pane = h('div', 'companion-sheet-pane');
            const table = h('table', 'companion-sheet-table companion-skills-table');
            const thead = h('tr');
            for (const c of ['Skill', 'CS', 'Ranks', 'Total', '']) thead.appendChild(h('th', null, c));
            table.appendChild(thead);
            const names = Object.keys(comp.base.skills || {}).sort();
            for (const name of names) {
                const s = comp.base.skills[name];
                const st = AD().skillTotal(comp, name, d);
                const tr = h('tr');
                tr.dataset.skill = name;
                tr.appendChild(h('td', null, name));
                const cs = h('input');
                cs.type = 'checkbox';
                cs.checked = !!s.cs;
                cs.title = 'Class skill (+3 with at least one rank)';
                cs.addEventListener('change', () => { s.cs = cs.checked; comp.edited['base.skills'] = true; commit(); });
                const csTd = h('td');
                csTd.appendChild(cs);
                tr.appendChild(csTd);
                const rk = h('input', 'edit-field companion-sheet-num companion-skill-ranks');
                rk.type = 'number';
                rk.min = '0';
                rk.value = String(s.ranks || 0);
                rk.addEventListener('change', () => {
                    s.ranks = Math.max(0, Number(rk.value) || 0);
                    comp.edited['base.skills'] = true;
                    commit();
                });
                const rkTd = h('td');
                rkTd.appendChild(rk);
                tr.appendChild(rkTd);
                const tot = h('td');
                tot.appendChild(derivedBox(st.key, st.derived,
                    st.parts.map((p) => ({ label: p.label, value: p.value })), { signed: true }));
                tr.appendChild(tot);
                const act = h('td');
                act.appendChild(rollBtn('🎲', () => rollLog(comp, name, AD().skillTotal(comp, name).total), 'Roll ' + name));
                const rm = h('button', 'inv-btn inv-btn-danger', '×');
                rm.type = 'button';
                rm.title = 'Remove this skill';
                rm.addEventListener('click', () => {
                    delete comp.base.skills[name];
                    comp.edited['base.skills'] = true;
                    commit();
                });
                act.appendChild(rm);
                tr.appendChild(act);
                table.appendChild(tr);
            }
            pane.appendChild(table);
            const addRow = h('div', 'companion-sheet-row');
            const sel = h('select', 'edit-field companion-skill-add');
            sel.appendChild(h('option', null, '+ skill…'));
            for (const sk of window.SheetData.ALL_SKILLS) {
                if (sk.variant || comp.base.skills[sk.name]) continue;
                const o = h('option', null, sk.name);
                o.value = sk.name;
                sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
                const def = AD().skillDef(sel.value);
                if (!def) return;
                comp.base.skills[def.name] = { ranks: 0, cs: false, ab: def.ab };
                comp.edited['base.skills'] = true;
                commit();
            });
            addRow.appendChild(sel);
            pane.appendChild(addRow);
            return pane;
        }

        // ---- Features & attacks ----------------------------------------------------------- //
        function featureList(key, label, kindLabel) {
            const card = h('div', 'companion-sheet-card companion-sheet-' + key);
            const head = h('div', 'companion-sheet-row');
            head.appendChild(h('span', 'companion-vital-label', label));
            if (key === 'tricks' && comp.base.bonusTricks) head.appendChild(h('span', 'dim', ` (${comp.base.bonusTricks} bonus tricks)`));
            card.appendChild(head);
            const items = comp.base[key] ??= [];
            items.forEach((f, i) => {
                const row = h('div', 'feature-row companion-feature-row');
                const entry = key === 'feats' ? window.SheetDetails?.lookup?.('feats', f.name) : null;
                const desc = f.description || entry?.description || '';
                if (desc) {
                    const det = window.SheetUI.details(f.name, desc, 'companion-feature-details');
                    row.appendChild(det);
                } else {
                    row.appendChild(h('span', null, f.name));
                }
                const post = h('button', 'inv-btn', '💬');
                post.type = 'button';
                post.title = 'Post to the roll log';
                post.addEventListener('click', () => window.SheetRoll?.postFeatureCard?.({
                    title: `${comp.name}: ${f.name}`, name: f.name, typeLabel: kindLabel, descHtml: desc,
                }));
                const rm = h('button', 'inv-btn inv-btn-danger', '×');
                rm.type = 'button';
                rm.addEventListener('click', () => { items.splice(i, 1); comp.edited['base.' + key] = true; commit(); });
                row.append(post, rm);
                card.appendChild(row);
            });
            const add = h('button', 'inv-btn companion-feature-add', '+ ' + kindLabel.toLowerCase());
            add.type = 'button';
            add.addEventListener('click', () => {
                const push = (name, description) => {
                    if (!String(name || '').trim()) return;
                    items.push({ name: String(name).trim(), ...(description ? { description } : {}) });
                    comp.edited['base.' + key] = true;
                    commit();
                };
                if (key === 'feats' && window.SheetModals?.openCatalogPicker) {
                    window.SheetModals.openCatalogPicker({
                        title: `Add a feat to ${comp.name}`, kinds: ['feats'], allowCustom: true,
                        customPlaceholder: 'Custom feat name',
                        onPick: (hit) => push(hit.name), onCustom: (n) => push(n),
                    });
                } else {
                    const row = h('div', 'companion-sheet-row');
                    const inp = h('input', 'edit-field companion-trick-name');
                    inp.placeholder = 'Trick name (e.g. Attack, Come, Defend)';
                    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') push(inp.value); });
                    inp.addEventListener('change', () => push(inp.value));
                    row.appendChild(inp);
                    add.replaceWith(row);
                    inp.focus();
                }
            });
            card.appendChild(add);
            return card;
        }
        function attacks(d) {
            const card = h('div', 'companion-sheet-card companion-sheet-attacks');
            card.appendChild(h('span', 'companion-vital-label', 'Attacks'));
            const shared = window.SheetCompanionShare?.sharedBonuses?.(data) || null;
            const plus = (f) => (shared ? Number(shared[f]) || 0 : 0);
            (comp.base.attacks || []).forEach((a, i) => {
                const line = AD().attackLine(comp, i, d);
                const row = h('div', 'companion-attack-row');
                row.dataset.attack = String(i);
                const nm = h('input', 'edit-field companion-attack-name');
                nm.value = a.name;
                nm.addEventListener('change', () => { a.name = nm.value.trim() || a.name; comp.edited['base.attacks'] = true; commit(); });
                const kind = h('select', 'edit-field');
                for (const k of ['primary', 'secondary']) {
                    const o = h('option', null, k);
                    o.value = k;
                    if ((a.kind || 'primary') === k) o.selected = true;
                    kind.appendChild(o);
                }
                kind.addEventListener('change', () => { a.kind = kind.value; comp.edited['base.attacks'] = true; commit(); });
                const atkWrap = h('span');
                atkWrap.append('atk ', derivedBox(line.atkKey, line.atkDerived, line.atkParts, { signed: true }));
                const dmgWrap = h('span');
                dmgWrap.append('dmg ', derivedBox(line.dmgKey, line.dmgDerived || '—', [], { text: true }));
                if (line.crit) dmgWrap.appendChild(h('span', 'dim', ' ' + line.crit));
                const dice = h('input', 'edit-field companion-attack-dice');
                dice.value = a.dice || '';
                dice.placeholder = '1d6';
                dice.title = 'Base damage dice';
                dice.addEventListener('change', () => { a.dice = dice.value.trim(); a.diceSize = d.size.id; comp.edited['base.attacks'] = true; commit(); });
                const atkBtn = rollBtn('Attack', () => rollLog(comp, line.name + ' attack', line.atk + plus('attack')), 'Roll attack');
                const dmgBtn = rollBtn('Damage', () => {
                    const extra = plus('damage');
                    const f = String(line.dmg || '').trim();
                    if (!f || f === '—') return;
                    rollFormula(comp, line.name + ' damage', extra ? f + fmt(extra) : f);
                }, 'Roll damage');
                const rm = h('button', 'inv-btn inv-btn-danger', '×');
                rm.type = 'button';
                rm.addEventListener('click', () => { AD().removeAttack(comp, i); commit(); });
                row.append(nm, kind, atkWrap, dmgWrap, dice, atkBtn, dmgBtn, rm);
                if (line.notes) row.appendChild(h('span', 'dim', ' ' + line.notes));
                card.appendChild(row);
            });
            const add = h('button', 'inv-btn', '+ attack');
            add.type = 'button';
            add.addEventListener('click', () => { AD().addAttack(comp, d.size.id); commit(); });
            card.appendChild(add);
            return card;
        }
        function features(d) {
            const pane = h('div', 'companion-sheet-pane');
            pane.appendChild(attacks(d));
            pane.appendChild(featureList('feats', 'Feats', 'Feat'));
            pane.appendChild(featureList('tricks', 'Tricks', 'Trick'));
            return pane;
        }

        // ---- shell ------------------------------------------------------------------------ //
        const tabBar = h('div', 'item-sheet-tabs companion-sheet-tabs');
        const content = h('div', 'companion-sheet-content');
        for (const [id, label] of TABS) {
            const t = h('button', 'item-sheet-tab', label);
            t.type = 'button';
            t.dataset.tab = id;
            t.addEventListener('click', () => { activeTab = id; paint(); });
            tabBar.appendChild(t);
        }
        root.append(tabBar, content);

        function paint() {
            // keep focus/scroll stable across repaints
            const scroll = content.scrollTop;
            const d = AD().derive(comp);
            for (const t of tabBar.children) t.classList.toggle('is-active', t.dataset.tab === activeTab);
            content.innerHTML = '';
            const pane = activeTab === 'buffs' ? buffs()
                : activeTab === 'skills' ? skills(d)
                    : activeTab === 'features' ? features(d) : vitals(d);
            pane.dataset.pane = activeTab;
            content.appendChild(pane);
            content.scrollTop = scroll;
        }
        AD().syncLegacy(comp);
        paint();
        handle = window.SheetOverlay.open({
            title: comp.name || 'Companion',
            body: root,
            cls: 'overlay-fullscreen',
            onClose: () => {
                handle = null;
                window.SheetApp?.renderSheet?.(data);
                window.SheetApp?.setActiveTab?.('companions');
            },
        });
        return handle;
    }

    return { open, isOpen: () => !!handle };
})();
