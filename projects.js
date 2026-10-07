// ==================== PROJECTS.JS ====================
// Multi-project storage via IndexedDB. Each project stores its full scene
// payload (the same plain-object shape config.js's _serialize()/
// _applyProjectData() already use for .nex files) directly as structured-
// clone data — no binary encode/decode round-trip needed for local storage,
// that layer only matters for the portable downloadable .nex file format.
//
// Chosen over localStorage because: (a) localStorage's ~5-10MB total quota
// would be exhausted by just a few real projects with embedded textures/
// models, (b) IndexedDB supports storing large structured objects natively
// and scales to hundreds of MB+ depending on available disk, (c) its async
// API doesn't block the main thread on large reads/writes like
// localStorage's synchronous API would.

const DB_NAME    = 'nexus_engine_db';
const DB_VERSION = 1;
const STORE      = 'projects';

let _dbPromise = null;

function _openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        };
        // A stale connection left open in another tab (older DB version)
        // can stall indexedDB.open() indefinitely — neither onsuccess nor
        // onerror ever fires, just onblocked. Log it for diagnosis; the
        // timeout below still guarantees callers (the launcher's project
        // grid, the settings gear menu, etc.) aren't left hanging forever.
        req.onblocked = () => console.warn('[projects] IndexedDB bloqueado por outra aba/conexão.');
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
    // Safety net: never let a stuck IndexedDB permanently hang whatever UI
    // is waiting on the project list (launcher screen, project switcher…).
    const withTimeout = Promise.race([
        _dbPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB timeout')), 8000)),
    ]);
    withTimeout.catch(() => { _dbPromise = null; }); // allow a fresh retry later
    return withTimeout;
}

function _tx(mode) {
    return _openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

function _genId() {
    return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** Returns all projects, most recently updated first. Each record includes
 *  metadata (id, name, thumbnail, timestamps, hasAnimation) but NOT the
 *  heavy scene payload — use loadProject(id) to fetch that on demand. */
export async function listProjects() {
    const store = await _tx('readonly');
    return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
            const all = req.result || [];
            all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            resolve(all.map(p => ({
                id: p.id, name: p.name, thumbnail: p.thumbnail,
                renderThumb: p.renderThumb || null,
                createdAt: p.createdAt, updatedAt: p.updatedAt,
                hasAnimation: p.hasAnimation,
            })));
        };
        req.onerror = () => reject(req.error);
    });
}

/** Creates a new, empty project record and returns its id. The scene
 *  payload itself is saved separately via saveProjectData() once the
 *  editor has something to persist (or immediately with a blank payload). */
export async function createProject(name) {
    const store = await _tx('readwrite');
    const now = Date.now();
    const record = {
        id: _genId(), name: name || 'Novo Projeto',
        thumbnail: null, data: null,
        hasAnimation: false,
        createdAt: now, updatedAt: now,
    };
    return new Promise((resolve, reject) => {
        const req = store.add(record);
        req.onsuccess = () => resolve(record.id);
        req.onerror   = () => reject(req.error);
    });
}

/** Full record including the scene payload — used when opening a project. */
export async function loadProject(id) {
    const store = await _tx('readonly');
    return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

/** Garante que o payload é clonável pelo IndexedDB. Se algo não clonável
 *  (função, objeto Three.js…) escapou para dentro da cena salva, o put() lança
 *  DataCloneError — aqui caímos para um round-trip JSON que descarta esses
 *  valores em vez de perder o save inteiro. */
function _putSafe(store, record) {
    try {
        return store.put(record);
    } catch (err) {
        if (err && err.name === 'DataCloneError') {
            console.warn('[projects] Payload não clonável; salvando versão JSON-safe.', err);
            const safe = { ...record, data: record.data == null ? record.data : JSON.parse(JSON.stringify(record.data)) };
            return store.put(safe);
        }
        throw err;
    }
}

/** Persists the current scene payload + a fresh thumbnail back to a
 *  project record. Called when leaving the editor and periodically as an
 *  autosave safety net.
 *
 *  Resolve só quando a transação COMPLETA (dado realmente gravado) e sempre
 *  resolve/rejeita — antes, uma exceção dentro do callback deixava a Promise
 *  pendurada para sempre e travava todos os saves seguintes. */
export async function saveProjectData(id, sceneData, thumbnailDataURL) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        let tx, found = false;
        try {
            tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) return;   // transação termina sem escrita → resolve(false)
                found = true;
                existing.data      = sceneData;
                existing.thumbnail = thumbnailDataURL ?? existing.thumbnail;
                existing.hasAnimation = !!(sceneData?.animation?.keyframes &&
                    Object.keys(sceneData.animation.keyframes).length > 0);
                existing.updatedAt = Date.now();
                try { _putSafe(store, existing); }
                catch (err) { try { tx.abort(); } catch { /* já abortada */ } reject(err); }
            };
            getReq.onerror = () => reject(getReq.error);
            tx.oncomplete = () => resolve(found);
            tx.onerror    = () => reject(tx.error);
            tx.onabort    = () => reject(tx.error || new Error('Transação de save abortada'));
        } catch (err) { reject(err); }
    });
}

/** Guarda a ÚLTIMA RENDER tirada (miniatura JPEG) como imagem do projeto na
 *  tela de Projetos. Independente do save da cena. */
export async function saveProjectRenderThumb(id, dataURL) {
    if (!id || !dataURL) return false;
    const db = await _openDB();
    return new Promise((resolve, reject) => {
        let tx, found = false;
        try {
            tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) return;
                found = true;
                existing.renderThumb = dataURL;
                existing.renderThumbAt = Date.now();
                store.put(existing);
            };
            getReq.onerror = () => reject(getReq.error);
            tx.oncomplete = () => resolve(found);
            tx.onerror    = () => reject(tx.error);
            tx.onabort    = () => reject(tx.error || new Error('Transação abortada'));
        } catch (err) { reject(err); }
    });
}

export async function renameProject(id, newName) {
    const store = await _tx('readwrite');
    return new Promise((resolve, reject) => {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
            const existing = getReq.result;
            if (!existing) { resolve(false); return; }
            existing.name = newName;
            existing.updatedAt = Date.now();
            const putReq = store.put(existing);
            putReq.onsuccess = () => resolve(true);
            putReq.onerror   = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

export async function deleteProject(id) {
    const store = await _tx('readwrite');
    return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror   = () => reject(req.error);
    });
}

export async function duplicateProject(id) {
    const original = await loadProject(id);
    if (!original) return null;
    const store = await _tx('readwrite');
    const now = Date.now();
    const copy = {
        ...original,
        id: _genId(),
        name: original.name + ' (cópia)',
        createdAt: now, updatedAt: now,
    };
    return new Promise((resolve, reject) => {
        const req = store.add(copy);
        req.onsuccess = () => resolve(copy.id);
        req.onerror   = () => reject(req.error);
    });
}
