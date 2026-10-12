// scripts/backend.js -- the one door to the generator backend (window.SheetBackend).
//
// The hosted backend runs on Render's free tier, which puts it to sleep after ~15 minutes without
// traffic and takes up to about a minute to wake. Every generate surface (the quick row, the guided
// wizard, related NPCs, encounters) used to fetch on its own and say "this can take a minute" no
// matter what. This module owns three things they now share:
//
//   1. **Warm-up.** `warm()` is a cheap GET that wakes a sleeping backend in the background, so it
//      is already up by the time someone reaches Generate. It hits `/generate_loot`, the
//      limiter-exempt, zero-cost probe that the treasure button already needed, so ONE request
//      serves both. Any HTTP answer, a 404 from an older backend included, proves the server is up.
//   2. **An honest wait.** `postJson` reports progress once a second. It says "waking" when nothing
//      has answered recently, or when a supposedly awake backend is still silent after
//      `SLOW_MS`, so the message matches what is actually happening.
//   3. **One request at a time, with a timeout.** A second generate while one is in flight is
//      refused (kind 'busy') rather than queued, and a request that outlives `TIMEOUT_MS` is
//      aborted with kind 'timeout' so the caller can offer a retry instead of an endless spinner.
//
// Errors are `BackendError`s with a `kind` of 'offline' | 'busy' | 'timeout' | 'network' | 'http'
// and a message written for the person at the sheet, not for a console.
window.SheetBackend = (function () {
    'use strict';

    // Render spins a free service down after 15 idle minutes; treat 14 as the edge of "awake".
    const AWAKE_FOR_MS = 14 * 60 * 1000;
    // A warm backend answers a generate in a few seconds. Past this, say it may be waking after all.
    const SLOW_MS = 8000;
    // A cold start plus one generation fits comfortably inside this; anything longer is stuck.
    const TIMEOUT_MS = 100000;

    const base = () => (window.SheetApp?.backendUrl?.() || '').replace(/\/+$/, '');

    let lastContact = 0;          // Date.now() of the last HTTP answer of any status
    let lastContactUrl = '';      // ...from this backend; a changed URL is a different server
    let warmPromise = null;
    let warmUrl = '';
    let inFlight = false;

    class BackendError extends Error {
        constructor(kind, message) {
            super(message);
            this.name = 'BackendError';
            this.kind = kind;
        }
        /** Worth a "Try again" button: the request may simply have caught the backend asleep. */
        get retryable() { return this.kind === 'timeout' || this.kind === 'network'; }
    }

    function noteContact() {
        lastContact = Date.now();
        lastContactUrl = base();
    }
    function isAwake() {
        return lastContactUrl === base() && Date.now() - lastContact < AWAKE_FOR_MS;
    }
    function busy() { return inFlight; }

    /**
     * Wake the backend if it may be asleep. Idempotent: concurrent callers share one request, and a
     * backend heard from recently is not asked again. Resolves `{ ok, status, json }` (json is the
     * probe's body when it parses, else null) and never rejects, since a failed warm-up costs nothing.
     */
    function warm() {
        if (navigator.onLine === false) return Promise.resolve({ ok: false, status: 0, json: null });
        const url = base();
        if (warmPromise && warmUrl === url && (isAwake() || !warmPromise.settled)) return warmPromise;
        warmUrl = url;
        const p = (async () => {
            try {
                const resp = await fetch(url + '/generate_loot', { method: 'GET' });
                noteContact();
                let json = null;
                try { json = await resp.json(); } catch { /* an older backend's 404 page */ }
                return { ok: resp.ok, status: resp.status, json };
            } catch {
                // Offline, CORS, DNS: nothing learned, nothing worth a console error.
                return { ok: false, status: 0, json: null };
            }
        })();
        p.settled = false;
        p.then(() => { p.settled = true; });
        warmPromise = p;
        return p;
    }

    /** The default wait line, for callers that don't word their own. */
    function progressText(progress, workingText = 'Rolling up your hero…') {
        if (progress.phase !== 'waking') return workingText;
        return 'Waking the generator — this can take up to a minute the first time'
            + (progress.seconds >= 3 ? ` (${progress.seconds} s)` : '') + '…';
    }

    /**
     * POST `payload` as JSON to `path` and resolve the parsed JSON answer.
     * `onProgress({ phase: 'working' | 'waking', seconds })` fires immediately and then once a
     * second until the request settles.
     */
    async function postJson(path, payload, { onProgress, timeoutMs = TIMEOUT_MS } = {}) {
        if (navigator.onLine === false) {
            throw new BackendError('offline', 'You are offline — rolling up a new character needs the '
                + 'generator backend. Everything else on the sheet keeps working.');
        }
        if (inFlight) {
            throw new BackendError('busy', 'Already rolling up a character — wait for that one to finish.');
        }
        inFlight = true;
        const awakeAtStart = isAwake();
        const started = Date.now();
        const tick = () => {
            if (!onProgress) return;
            const ms = Date.now() - started;
            const phase = !awakeAtStart || ms >= SLOW_MS ? 'waking' : 'working';
            try { onProgress({ phase, seconds: Math.floor(ms / 1000) }); } catch { /* caller's bug */ }
        };
        tick();
        const timer = setInterval(tick, 1000);
        const ctl = new AbortController();
        const killer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
            let resp;
            try {
                resp = await fetch(base() + path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: ctl.signal,
                });
            } catch (err) {
                if (ctl.signal.aborted) {
                    throw new BackendError('timeout', `The generator didn't answer within `
                        + `${Math.round(timeoutMs / 1000)} seconds. It may still be waking up — try again.`);
                }
                throw new BackendError('network', 'Couldn’t reach the generator ('
                    + (err?.message || 'network error') + '). Check your connection, or the backend in '
                    + 'Settings, and try again.');
            }
            noteContact();
            if (!resp.ok) throw new BackendError('http', `The generator answered with an error (HTTP ${resp.status}).`);
            try {
                return await resp.json();
            } catch {
                throw new BackendError('http', 'The generator sent back something that isn’t a character.');
            }
        } finally {
            clearInterval(timer);
            clearTimeout(killer);
            inFlight = false;
        }
    }

    return { warm, isAwake, busy, postJson, progressText, BackendError, SLOW_MS, TIMEOUT_MS };
})();
