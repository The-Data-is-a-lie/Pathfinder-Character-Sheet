// Character library: an IndexedDB store of saved characters, optionally mirrored to a real
// disk folder via the File System Access API (Chrome/Edge, localhost or https). When a folder
// is connected it is the source of truth for the character list — every save/delete also
// writes/removes a <Name>.json file there, and files dropped into the folder by hand simply
// appear. Without a folder (or in Firefox/Safari) the IndexedDB library alone carries saves.
//
// Records: {id, name, klass, level, savedAt, fileName, data} where data is the full generator
// payload. Per-sheet state (id, savedAt, fileName, notes) travels INSIDE the payload as
// data._sheet so an exported/hand-copied file stays a self-contained character.

window.SheetLibrary = (function () {
    'use strict';

    const DB_NAME = 'sheet-library';
    const DIR_KEY = 'dirHandle';

    // ---------------------------------------------------------------- IndexedDB plumbing
    let dbPromise = null;
    function db() {
        dbPromise ??= new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore('characters', { keyPath: 'id' });
                req.result.createObjectStore('meta');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    function tx(store, mode, run) {
        return db().then((d) => new Promise((resolve, reject) => {
            const t = d.transaction(store, mode);
            const req = run(t.objectStore(store));
            t.oncomplete = () => resolve(req?.result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        }));
    }

    const idbAll = () => tx('characters', 'readonly', (s) => s.getAll());
    const idbGet = (id) => tx('characters', 'readonly', (s) => s.get(id));
    const idbPut = (rec) => tx('characters', 'readwrite', (s) => s.put(rec));
    const idbDelete = (id) => tx('characters', 'readwrite', (s) => s.delete(id));
    const metaGet = (key) => tx('meta', 'readonly', (s) => s.get(key));
    const metaPut = (key, val) => tx('meta', 'readwrite', (s) => s.put(val, key));
    const metaDelete = (key) => tx('meta', 'readwrite', (s) => s.delete(key));

    // ---------------------------------------------------------------- record helpers
    const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const sanitizeFileName = (name) => (String(name).replace(/[\\/:*?"<>|]/g, '').trim() || 'character');

    function toRecord(data) {
        const sheet = (data._sheet ??= {});
        sheet.id ??= newId();
        sheet.savedAt = Date.now();
        return {
            id: sheet.id,
            name: data.character_full_name || 'Unnamed',
            klass: data.c_class_display || data.c_class || '',
            level: data.level ?? '',
            savedAt: sheet.savedAt,
            fileName: sheet.fileName || null,
            data,
        };
    }

    // ---------------------------------------------------------------- folder mirror
    let dirHandle = null;
    // 'unsupported' | 'none' | 'need-permission' | 'connected'
    let folderState = 'none';

    async function init() {
        if (!window.showDirectoryPicker) { folderState = 'unsupported'; return status(); }
        try {
            dirHandle = await metaGet(DIR_KEY) || null;
            if (!dirHandle) { folderState = 'none'; return status(); }
            const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
            folderState = perm === 'granted' ? 'connected' : 'need-permission';
        } catch (err) {
            console.warn('SheetLibrary: folder init failed', err);
            dirHandle = null;
            folderState = 'none';
        }
        return status();
    }

    async function connectFolder() {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await metaPut(DIR_KEY, dirHandle);
        folderState = 'connected';
        return status();
    }

    // Re-granting access to a remembered folder needs a user gesture — call from a click.
    async function reconnectFolder() {
        if (!dirHandle) return connectFolder();
        const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        folderState = perm === 'granted' ? 'connected' : 'need-permission';
        return status();
    }

    async function disconnectFolder() {
        dirHandle = null;
        await metaDelete(DIR_KEY);
        folderState = 'none';
        return status();
    }

    function status() {
        return { state: folderState, folderName: dirHandle?.name || null };
    }

    async function uniqueFileName(data) {
        const base = sanitizeFileName(data.character_full_name || 'character');
        for (let n = 0; n < 50; n++) {
            const candidate = n === 0 ? `${base}.json` : `${base} (${n + 1}).json`;
            try {
                const fh = await dirHandle.getFileHandle(candidate);
                // Name taken — fine if it's this same character's file.
                const existing = JSON.parse(await (await fh.getFile()).text());
                if (existing?._sheet?.id === data._sheet.id) return candidate;
            } catch {
                return candidate; // free slot
            }
        }
        return `${base}-${data._sheet.id}.json`;
    }

    async function writeFile(record) {
        record.fileName = record.data._sheet.fileName ||= await uniqueFileName(record.data);
        const fh = await dirHandle.getFileHandle(record.fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(record.data, null, 1));
        await w.close();
    }

    async function listFolder() {
        const records = [];
        for await (const entry of dirHandle.values()) {
            if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
            try {
                const data = JSON.parse(await (await entry.getFile()).text());
                if (!data || typeof data !== 'object' || !(data.character_full_name || data.c_class)) continue;
                const sheet = (data._sheet ??= {});
                sheet.id ??= newId();        // hand-dropped file: adopt it with a fresh id
                sheet.fileName = entry.name; // the folder's name wins
                const rec = {
                    id: sheet.id,
                    name: data.character_full_name || entry.name.replace(/\.json$/i, ''),
                    klass: data.c_class_display || data.c_class || '',
                    level: data.level ?? '',
                    savedAt: sheet.savedAt || 0,
                    fileName: entry.name,
                    data,
                };
                records.push(rec);
            } catch (err) {
                console.warn('SheetLibrary: skipping unreadable ' + entry.name, err);
            }
        }
        return records;
    }

    // ---------------------------------------------------------------- public API
    // List cache so get(id) after list() needs no second folder read.
    let cache = new Map();

    async function list() {
        const records = folderState === 'connected' ? await listFolder() : await idbAll();
        records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        cache = new Map(records.map((r) => [r.id, r]));
        return records;
    }

    async function get(id) {
        return cache.get(id) || await idbGet(id) || null;
    }

    async function save(data) {
        const record = toRecord(data);
        if (folderState === 'connected') await writeFile(record);
        await idbPut(record);
        cache.set(record.id, record);
        return record;
    }

    async function remove(id) {
        const record = await get(id);
        await idbDelete(id);
        cache.delete(id);
        const fileName = record?.fileName || record?.data?._sheet?.fileName;
        if (folderState === 'connected' && fileName) {
            try { await dirHandle.removeEntry(fileName); }
            catch (err) { console.warn('SheetLibrary: could not delete ' + fileName, err); }
        }
        return record;
    }

    async function exportAll() {
        const records = await list();
        return records.map((r) => r.data);
    }

    return { init, list, get, save, remove, status, connectFolder, reconnectFolder,
        disconnectFolder, exportAll };
})();
