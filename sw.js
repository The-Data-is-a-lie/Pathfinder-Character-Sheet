/* sw.js -- offline service worker for the Pathfinder NPC Sheet (#61).
 *
 * The sheet is a no-build static site served as raw files with NO content hashing, which
 * decides everything below:
 *
 *  - **The cache name is the only version signal there is.** Bump CACHE_VERSION on every
 *    deploy; `activate` deletes every cache that is not in the current set. Without that a
 *    service worker would serve last month's `sheet.js` forever, because the filename never
 *    changes and the HTTP cache cannot be trusted to invalidate it either.
 *  - **The shell list is discovered, not hardcoded.** Install fetches `index.html` and reads
 *    its own <script src> / <link href> tags, so adding a module to the page cannot silently
 *    leave it out of the offline build. CORE below is the fallback if that parse ever fails.
 *  - **`data/*.json` is NOT precached.** It is ~22 MB of compendium extracts; paying that on
 *    a phone at install time to make the first launch slow is the wrong trade. Those files
 *    are cached lazily, cache-first, the first time a tab actually asks for one.
 *
 * Scope is the directory this file is served from, so every path here is relative — the site
 * lives under /Pathfinder-Character-Sheet/ on GitHub Pages and at / in local dev.
 */
// Two versions, not one, because the two caches change on completely different clocks: the
// ~700 KB app shell changes every deploy, the ~22 MB of compendium extracts only when
// tools/build_details.py reruns. Sharing a version would re-download 22 MB for a CSS tweak.
//   SHELL_VERSION -> bump on every deploy.
//   DATA_VERSION  -> bump ONLY when data/*.json is regenerated.
//                    Keep in sync with DATA_CACHE in scripts/pwa.js, which fills this cache
//                    from the page side on a first visit.
const SHELL_VERSION = 'v2';
const DATA_VERSION = 'v1';
const SHELL_CACHE = `sheet-shell-${SHELL_VERSION}`;
const DATA_CACHE = `sheet-data-${DATA_VERSION}`;
const KEEP = new Set([SHELL_CACHE, DATA_CACHE]);

// Enough to boot offline even if the index.html scrape returns nothing.
const CORE = [
    './',
    './index.html',
    './styles/sheet.css',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

/** The page's own <script src> / <link rel=stylesheet href> list — same-origin, relative only. */
async function shellFromIndex() {
    try {
        const resp = await fetch('./index.html', { cache: 'reload' });
        if (!resp.ok) return [];
        const html = await resp.text();
        const urls = new Set();
        const add = (raw) => {
            const u = String(raw || '').trim();
            // Skip absolute/protocol URLs: a CDN asset is not ours to cache, and inline
            // data: URIs are already in the HTML.
            if (!u || /^(https?:)?\/\//.test(u) || u.startsWith('data:')) return;
            urls.add(new URL(u, self.registration.scope).href);
        };
        for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) add(m[1]);
        for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) add(m[1]);
        return [...urls];
    } catch {
        return [];
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        const found = await shellFromIndex();
        // One at a time rather than cache.addAll: addAll rejects the whole install if a
        // single URL 404s, and a stale <script> tag should not cost the user offline mode.
        await Promise.all([...CORE, ...found].map(async (url) => {
            try {
                const resp = await fetch(url, { cache: 'reload' });
                if (resp.ok) await cache.put(url, resp);
            } catch { /* skipped; the runtime handler will pick it up on first use */ }
        }));
        // Take over as soon as the user asks for it — SheetPWA drives the "Reload" prompt.
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key.startsWith('sheet-') && !KEEP.has(key)) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const isData = (url) => /\/data\/[^/]+\.json$/.test(url.pathname);

/** Serve the cached copy at once, refresh it in the background for the next load. */
async function staleWhileRevalidate(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((resp) => {
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
    }).catch(() => null);
    return cached || (await network) || Response.error();
}

/** Compendium data: only ever fetched once, then read from disk forever. */
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;              // the Generate POST is never ours
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;   // the backend stays untouched

    if (isData(url)) {
        event.respondWith(cacheFirst(request, DATA_CACHE).catch(() => Response.error()));
        return;
    }
    if (request.mode === 'navigate') {
        // Offline, any URL under the scope should still boot the app shell.
        event.respondWith(staleWhileRevalidate(request)
            .then((r) => (r && r.ok ? r : caches.match('./index.html')))
            .catch(() => caches.match('./index.html')));
        return;
    }
    event.respondWith(staleWhileRevalidate(request));
});
