// scripts/health-ui.js -- the surface for the warn-only audit (window.SheetHealthUI, #79):
// the top-bar ⚠ indicator, the summary panel, and the inline row badge every tab reuses.
//
// The rules live in scripts/domain/health-check.js; this file only renders them. Both halves
// obey the same stance: nothing here blocks, clamps, or auto-fixes — the strongest action
// offered is "take me to the tab where I could change it myself".
window.SheetHealthUI = (function () {
    'use strict';
    const { h } = window.SheetUI;
    const H = () => window.SheetHealth;

    /**
     * The ⚠ badge for one offending row (a skill, a feat). Returns null when that row is
     * clean — callers append unconditionally, so a quiet character grows no DOM at all.
     */
    function rowBadge(data, kind, subject) {
        const hits = H()?.findingsFor?.(data, kind, subject) || [];
        if (!hits.length) return null;
        const mark = h('button', 'health-badge no-print', '⚠');
        mark.type = 'button';
        mark.title = hits.map((f) => f.title + ' — ' + f.detail).join('\n\n')
            + '\n\nClick for the full health check.';
        mark.setAttribute('aria-label', 'Rules warning: ' + hits.map((f) => f.title).join('; '));
        mark.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();   // rows are clickable; a badge click must not also open them
            openPanel(data);
        });
        return mark;
    }

    /** Repaint the top-bar indicator. Hidden at zero findings and while the check is off. */
    function syncIndicator() {
        const btn = document.getElementById('health-btn');
        if (!btn) return;
        const data = window.SheetApp?.current;
        const report = data ? H()?.audit?.(data) : null;
        const n = report?.count || 0;
        btn.classList.toggle('hidden', !n);
        btn.textContent = `⚠ ${n}`;
        btn.title = `${n} rules ${n === 1 ? 'warning' : 'warnings'} on this character `
            + '— click to see them. Nothing is blocked.';
    }

    const RULE_LABELS = {
        'skill-rank-cap': 'Skill ranks over the cap',
        'skill-rank-budget': 'Skill points overspent',
        encumbrance: 'Carrying capacity',
        'feat-prereq': 'Feat prerequisites',
    };

    function openPanel(data) {
        const target = data || window.SheetApp?.current;
        if (!target) return;
        const body = h('div', 'health-panel');
        let handle = null;
        const render = () => {
            body.innerHTML = '';
            const report = H().audit(target);
            body.appendChild(h('p', 'dim',
                'Warnings only — nothing here is enforced, and nothing has been changed. '
                + 'A deliberately illegal NPC is a legitimate NPC; mute anything you meant.'));

            if (report.disabled) {
                body.appendChild(h('p', 'health-empty',
                    'The health check is switched off for this character.'));
            } else if (!report.findings.length) {
                body.appendChild(h('p', 'health-empty',
                    report.muted.length
                        ? 'Nothing to flag — everything else is muted.'
                        : 'Nothing to flag. This character reads as legal.'));
            } else {
                // Grouped by rule so five over-ranked skills read as one problem, not five.
                const byRule = new Map();
                for (const f of report.findings) {
                    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
                    byRule.get(f.rule).push(f);
                }
                for (const [rule, list] of byRule) {
                    const group = h('div', 'health-group');
                    const head = h('h4', null, RULE_LABELS[rule] || rule);
                    if (list[0].bestEffort) {
                        const tag = h('span', 'feat-tag health-besteffort', 'best effort');
                        tag.title = 'Read from each feat’s own description text. Retraining, '
                            + 'archetypes and house rules are invisible to it — treat these as hints.';
                        head.appendChild(tag);
                    }
                    group.appendChild(head);
                    for (const f of list) group.appendChild(findingRow(target, f, render));
                    body.appendChild(group);
                }
            }

            if (report.muted.length) {
                const restore = h('button', 'inv-btn health-restore',
                    `Restore ${report.muted.length} muted warning${report.muted.length === 1 ? '' : 's'}`);
                restore.type = 'button';
                restore.addEventListener('click', () => {
                    H().unmuteAll(target);
                    window.SheetApp?.renderSheet?.(target);
                    render();
                });
                body.appendChild(restore);
            }

            // The master switch, last: it is the escape hatch, not the headline.
            const offRow = h('label', 'health-off');
            const cb = h('input');
            cb.type = 'checkbox';
            cb.checked = H().isDisabled(target);
            cb.addEventListener('change', () => {
                H().setDisabled(target, cb.checked);
                window.SheetApp?.renderSheet?.(target);
                render();
            });
            offRow.append(cb, h('span', null, 'Turn the health check off for this character'));
            body.appendChild(offRow);
        };
        const findingRow = (target2, f, rerender) => {
            const row = h('div', 'health-finding' + (f.severity === 'info' ? ' is-info' : ''));
            const main = h('div', 'health-finding-main');
            main.appendChild(h('strong', null, f.title));
            main.appendChild(h('p', 'health-finding-detail', f.detail));
            const ctrl = h('div', 'health-finding-ctrl');
            if (f.tab) {
                const go = h('button', 'inv-btn', 'Go to ' + f.tab);
                go.type = 'button';
                go.addEventListener('click', () => {
                    handle?.close();
                    window.SheetApp?.setActiveTab?.(f.tab);
                });
                ctrl.appendChild(go);
            }
            const mute = h('button', 'inv-btn health-mute', '×');
            mute.type = 'button';
            mute.title = 'Mute this warning for this character (restorable below)';
            mute.addEventListener('click', () => {
                H().setMuted(target2, f.id, true);
                window.SheetApp?.renderSheet?.(target2);
                rerender();
            });
            ctrl.appendChild(mute);
            row.append(main, ctrl);
            return row;
        };
        render();
        const done = h('button', null, 'Done');
        done.type = 'button';
        handle = window.SheetOverlay.open({
            title: 'Rules health check',
            body,
            footer: [done],
            onClose: () => window.SheetApp?.renderSheet?.(target),
        });
        done.addEventListener('click', () => handle.close());
    }

    return { rowBadge, syncIndicator, openPanel };
})();
