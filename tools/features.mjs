// Feature-ledger report + checker.
//   node tools/features.mjs           print the report (counts, untested debt, gap list)
//   node tools/features.mjs --check   also enforce the rules below; exit 1 on any violation
//
// Rules (decided on #135):
//   have      needs >= 1 tagged test, and every tagged test must pass
//   partial   needs a `gap` note; any tagged tests must pass
//   untested / missing / out   no test required (tagged tests, if any, must still pass)
//   every tagged id must exist in the ledger; ids are unique
// Tests tag ids with the `feature` annotation (tests/helpers.mjs -> feature()).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEDGER = `${ROOT}/tests/features.json`;
const RUN = `${ROOT}/tests/.last-run.json`;
const STATUSES = ['have', 'untested', 'partial', 'missing', 'out'];
const SOURCES = ['foundry', 'surpass', 'user'];
const REPO = 'https://github.com/The-Data-is-a-lie/Pathfinder-Character-Sheet/issues/';

const check = process.argv.includes('--check');
const errors = [];
const features = JSON.parse(readFileSync(LEDGER, 'utf8')).features;

// ---- ledger shape
const byId = new Map();
for (const f of features) {
    if (!f.id) { errors.push(`ledger row without id: ${JSON.stringify(f)}`); continue; }
    if (byId.has(f.id)) errors.push(`duplicate ledger id: ${f.id}`);
    byId.set(f.id, f);
    if (!STATUSES.includes(f.status)) errors.push(`${f.id}: bad status "${f.status}"`);
    if (!SOURCES.includes(f.source)) errors.push(`${f.id}: bad source "${f.source}"`);
    if (!f.area || !f.title) errors.push(`${f.id}: area and title are required`);
    if (f.status === 'partial' && !f.gap) errors.push(`${f.id}: partial rows need a "gap" note`);
}

// ---- test results (Playwright JSON reporter)
const results = new Map(); // id -> [{title, ok}]
let haveRun = false;
if (existsSync(RUN)) {
    haveRun = true;
    const run = JSON.parse(readFileSync(RUN, 'utf8'));
    const walk = (suite) => {
        for (const spec of suite.specs || []) {
            for (const t of spec.tests || []) {
                const ids = (t.annotations || []).filter((a) => a.type === 'feature').map((a) => a.description);
                const last = t.results?.[t.results.length - 1];
                const ok = t.status === 'expected' || t.status === 'flaky';
                for (const id of ids) {
                    if (!results.has(id)) results.set(id, []);
                    results.get(id).push({ title: spec.title, ok, skipped: t.status === 'skipped' || last?.status === 'skipped' });
                }
            }
        }
        for (const s of suite.suites || []) walk(s);
    };
    for (const s of run.suites || []) walk(s);
} else if (check) {
    errors.push('no test run found (tests/.last-run.json) — run `npx playwright test` first');
}

if (haveRun) {
    for (const [id, rs] of results) {
        if (!byId.has(id)) errors.push(`test tags unknown ledger id "${id}" (${rs[0].title})`);
        for (const r of rs) if (!r.ok && !r.skipped) errors.push(`${id}: test failed — ${r.title}`);
    }
    for (const f of features) {
        const rs = (results.get(f.id) || []).filter((r) => !r.skipped);
        if (f.status === 'have' && !rs.length) errors.push(`${f.id}: status "have" but no test proves it`);
    }
}

// ---- report
const count = Object.fromEntries(STATUSES.map((s) => [s, 0]));
for (const f of features) count[f.status] = (count[f.status] || 0) + 1;
const tag = (f) => (f.ticket ? `  ${REPO}${f.ticket}` : '');
const out = [];
out.push(`Features: ${STATUSES.map((s) => `${count[s]} ${s}`).join(' · ')}`);

const untested = features.filter((f) => f.status === 'untested');
if (untested.length) {
    const per = {};
    for (const f of untested) per[f.area] = (per[f.area] || 0) + 1;
    const top = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ');
    out.push('', `Untested debt (${untested.length}) — ${top}`);
}

const gaps = features.filter((f) => f.status === 'partial' || f.status === 'missing');
if (gaps.length) {
    out.push('', 'Gaps');
    const areas = [...new Set(gaps.map((f) => f.area))].sort();
    const w = Math.max(...gaps.map((f) => f.id.length));
    for (const a of areas) {
        out.push(`  ${a}`);
        for (const f of gaps.filter((g) => g.area === a)) {
            const note = f.status === 'partial' ? `gap: ${f.gap}` : f.title;
            out.push(`    ${f.status.padEnd(8)} ${f.id.padEnd(w)}  ${note}${tag(f)}`);
        }
    }
}
if (!haveRun) out.push('', '(no test run found — statuses shown unverified; run `npm test`)');
console.log(out.join('\n'));

if (errors.length) {
    console.error(`\nLedger check: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    if (check) process.exit(1);
} else if (check) {
    console.log('\nLedger check: OK');
}
