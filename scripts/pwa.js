// scripts/pwa.js -- the page side of the offline PWA (window.SheetPWA, #61): service-worker
// registration, the update prompt, the install prompt, online/offline state, storage
// persistence, and the export nudge.
//
// SYNC STANCE, SETTLED (#47): there is no sync backend and there never will be one. Getting a
// character onto a second device is (1) the connected disk folder pointed at a Drive/Dropbox/
// OneDrive folder the desktop client already syncs, or (2) export/import JSON. This module
// therefore never talks to a server — its whole job is making the *local* copy trustworthy.
//
// THE DURABILITY PROBLEM THIS EXISTS TO BE HONEST ABOUT: WebKit deletes ALL script-writable
// storage — IndexedDB, Cache Storage, the service-worker registration — for an origin that
// goes 7 days without user interaction. For a sheet someone opens on game night once a week
// that is a real risk to the character library, not a theoretical one. `storage.persist()`
// helps and is requested here, but Safari decides silently and does not promise it survives
// the idle sweep. So the sheet nudges the user to export rather than claiming durability it
// cannot deliver.
window.SheetPWA = (function () {
    'use strict';

    const EXPORT_AT_KEY = 'sheet.lastExportAt';
    const NUDGE_AT_KEY = 'sheet.exportNudgeAt';
    const DAY = 86400000;
    // Long enough that a weekly player is never nagged twice in a campaign arc, short enough
    // that a year-old export is not treated as a backup.
    const NUDGE_EVERY = 30 * DAY;

    let registration = null;
    let waitingWorker = null;
    let installPrompt = null;
    const listeners = new Set();

    const toast = (msg) => window.SheetOverlay?.toast?.(msg);
    const notify = () => { for (const fn of listeners) { try { fn(state()); } catch { /* a broken listener must not break the rest */ } } };
    /** Settings re-renders from this; call it to be told when any of it changes. */
    function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    const readNum = (key) => {
        const raw = Number(localStorage.getItem(key));
        return Number.isFinite(raw) && raw > 0 ? raw : 0;
    };

    function state() {
        return {
            supported: 'serviceWorker' in navigator,
            registered: !!registration,
            updateReady: !!waitingWorker,
            canInstall: !!installPrompt,
            installed: window.matchMedia?.('(display-mode: standalone)')?.matches
                || window.navigator.standalone === true,
            online: navigator.onLine !== false,
            persisted: persistedState,
            lastExportAt: readNum(EXPORT_AT_KEY),
            evictionRisk: evictionRisk(),
        };
    }

    // ------------------------------------------------------------------ storage durability
    let persistedState = null;   // null = unknown / never asked
    let persistenceAsked = false;
    /** Query only — safe on a cold load, and what the Settings panel reports. */
    async function readPersistence() {
        if (!navigator.storage?.persisted) return null;
        try { persistedState = await navigator.storage.persisted(); } catch { persistedState = null; }
        notify();
        return persistedState;
    }
    /**
     * Ask once, and only after the user has actually saved a character: every engine weighs
     * site engagement, so the same request on a cold first paint is the one most likely to be
     * silently denied. Chrome/Safari decide by heuristic with no prompt; Firefox does ask.
     * Called from SheetRoster.saveCurrent.
     */
    async function requestPersistence() {
        if (persistenceAsked || !navigator.storage?.persist) return persistedState;
        persistenceAsked = true;
        try {
            persistedState = await navigator.storage.persisted();
            if (!persistedState) persistedState = await navigator.storage.persist();
        } catch {
            persistedState = null;
        }
        notify();
        return persistedState;
    }
    /** WebKit's 7-day idle sweep is the case worth warning about; it is the only engine with one. */
    function isWebKit() {
        const ua = navigator.userAgent;
        return /iP(hone|ad|od)/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua));
    }
    function evictionRisk() {
        if (!isWebKit()) return 'low';
        return persistedState ? 'reduced' : 'high';
    }

    // ------------------------------------------------------------------ export nudge
    /** Called by the Library export button; "I have a copy off this device" is the real signal. */
    function markExported() {
        try { localStorage.setItem(EXPORT_AT_KEY, String(Date.now())); } catch { /* private mode */ }
        notify();
    }
    /**
     * @returns {{ show: boolean, reason: string, days: number }} — whether the current
     * library is one browser wipe away from gone, and why.
     */
    function exportNudge(characterCount) {
        const count = Number(characterCount) || 0;
        const last = readNum(EXPORT_AT_KEY);
        const days = last ? Math.floor((Date.now() - last) / DAY) : Infinity;
        if (!count) return { show: false, reason: '', days };
        // A connected disk folder already mirrors every save to a real file — that IS the backup.
        if (window.SheetLibrary?.status?.().state === 'connected') {
            return { show: false, reason: 'folder', days };
        }
        if (!last) {
            return {
                show: true, days,
                reason: 'These characters only exist in this browser. Export them once and you '
                    + 'have a copy that survives a cleared cache or a new device.',
            };
        }
        if (days >= 30) {
            return {
                show: true, days,
                reason: `Your last export was ${days} days ago — anything changed since then `
                    + 'only exists in this browser.',
            };
        }
        return { show: false, reason: '', days };
    }
    /** At most one toast per NUDGE_EVERY, and only where the storage really can vanish. */
    async function maybeNudge() {
        if (!isWebKit() || persistedState) return;
        const lastNudge = readNum(NUDGE_AT_KEY);
        if (lastNudge && Date.now() - lastNudge < NUDGE_EVERY) return;
        const count = await window.SheetLibrary?.list?.().then((l) => l.length).catch(() => 0);
        if (!exportNudge(count).show) return;
        try { localStorage.setItem(NUDGE_AT_KEY, String(Date.now())); } catch { /* private mode */ }
        toast('Safari can clear this browser’s storage after 7 idle days — Settings → Library → '
            + 'Export all keeps a copy.');
    }

    // ------------------------------------------------------------------ cache warming
    // Must match DATA_CACHE in sw.js (`sheet-data-${DATA_VERSION}`) — the page fills this cache
    // on a first visit and the worker serves from it, so the two names version together.
    const DATA_CACHE = 'sheet-data-v1';
    /**
     * Store a response the page already fetched, so it is there when the network is not.
     * Called by SheetDetails.fetchJson with a clone: on a first visit the service worker is
     * still installing while the compendium files are being pulled, so nothing else would
     * capture them, and they are exactly what "works offline" means for this sheet.
     * Silent on every failure — a full disk must not break a page load.
     */
    function warmCache(url, response) {
        if (!('caches' in window) || !response) return;
        Promise.resolve()
            .then(() => caches.open(DATA_CACHE))
            .then((cache) => cache.put(new Request(url, { credentials: 'same-origin' }), response))
            .catch(() => { /* quota, private mode, or no service worker at all */ });
    }

    // ------------------------------------------------------------------ install
    function install() {
        if (!installPrompt) return Promise.resolve('unavailable');
        const prompt = installPrompt;
        installPrompt = null;    // a beforeinstallprompt event is single-use
        notify();
        return prompt.prompt().then(() => prompt.userChoice).then((c) => c?.outcome || 'dismissed');
    }

    // ------------------------------------------------------------------ updates
    function applyUpdate() {
        if (!waitingWorker) return;
        // controllerchange fires once the new worker takes over; reloading before that would
        // just re-serve the old shell.
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
    function trackWaiting(reg) {
        const w = reg.waiting;
        // A worker waiting with no controller is the very first install, not an update.
        if (!w || !navigator.serviceWorker.controller) return;
        waitingWorker = w;
        notify();
        toast('A new version of the sheet is ready — reload to use it.');
    }

    // ------------------------------------------------------------------ boot
    function init() {
        window.addEventListener('online', () => { document.body.classList.remove('is-offline'); notify(); });
        window.addEventListener('offline', () => {
            document.body.classList.add('is-offline');
            notify();
            toast('Offline — everything works except Generate, which needs the backend.');
        });
        if (navigator.onLine === false) document.body.classList.add('is-offline');

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();          // keep Chrome's mini-infobar out of the way…
            installPrompt = e;           // …and offer it from Settings instead
            notify();
        });
        window.addEventListener('appinstalled', () => { installPrompt = null; notify(); });

        if (!('serviceWorker' in navigator)) return;
        // file:// has no service workers at all, and registering from a page that is not
        // secure-context throws — both are normal local-dev states, not errors worth logging.
        if (!window.isSecureContext) return;
        window.addEventListener('load', async () => {
            try {
                registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
                trackWaiting(registration);
                registration.addEventListener('updatefound', () => {
                    const next = registration.installing;
                    if (!next) return;
                    next.addEventListener('statechange', () => {
                        if (next.state === 'installed') trackWaiting(registration);
                    });
                });
                notify();
            } catch {
                registration = null;     // offline mode simply stays off
            }
            await readPersistence();
            await maybeNudge();
        });
    }

    return {
        init, state, onChange, install, applyUpdate, warmCache,
        readPersistence, requestPersistence, markExported, exportNudge,
    };
})();
