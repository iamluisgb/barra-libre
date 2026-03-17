// ── IndexedDB store for heavy running log data ──────────

const DB_NAME = 'barraLibreRuns';
const DB_VERSION = 1;
const STORE = 'runRoutes';
const HEAVY_FIELDS = ['route', 'splits', 'hrTimeSeries', 'hrZoneTimes', 'segments'];

let _db = null;

function openRunStore() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => {
      console.warn('IndexedDB open failed:', req.error);
      reject(req.error);
    };
  });
}

function idbTx(mode, fn) {
  return openRunStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result._result);
    tx.onerror = () => reject(tx.error);
    // For get requests, capture result via onsuccess
    if (result instanceof IDBRequest) {
      result.onsuccess = () => { result._result = result.result; };
    }
  }));
}

/** Save heavy fields for a run log */
export function saveRunRoute(id, heavy) {
  if (!heavy) return Promise.resolve();
  return idbTx('readwrite', store => store.put(heavy, id)).catch(e => {
    console.warn('saveRunRoute failed:', e);
  });
}

/** Load heavy fields for a run log */
export function loadRunRoute(id) {
  return idbTx('readonly', store => store.get(id)).catch(e => {
    console.warn('loadRunRoute failed:', e);
    return null;
  });
}

/** Delete heavy fields for a run log */
export function deleteRunRoute(id) {
  return idbTx('readwrite', store => store.delete(id)).catch(e => {
    console.warn('deleteRunRoute failed:', e);
  });
}

/** Get all heavy data as a Map<id, heavy> */
export function getAllRunRoutes() {
  return openRunStore().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const map = new Map();
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        map.set(cursor.key, cursor.value);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(map);
    tx.onerror = () => reject(tx.error);
  })).catch(e => {
    console.warn('getAllRunRoutes failed:', e);
    return new Map();
  });
}

/** Clear all stored routes */
export function clearRunStore() {
  return idbTx('readwrite', store => store.clear()).catch(e => {
    console.warn('clearRunStore failed:', e);
  });
}

/** Extract heavy fields from a log (returns null if no heavy data) */
export function extractHeavyFields(log) {
  const heavy = {};
  let hasData = false;
  for (const f of HEAVY_FIELDS) {
    if (log[f] != null) { heavy[f] = log[f]; hasData = true; }
  }
  return hasData ? heavy : null;
}

/** Return a copy of the log with heavy fields set to null */
export function stripHeavyFields(log) {
  const stripped = { ...log };
  for (const f of HEAVY_FIELDS) stripped[f] = null;
  return stripped;
}

/** Migrate: extract heavy fields from logs, store in IDB, return stripped logs */
export async function splitAndStoreRoutes(runningLogs) {
  if (!runningLogs?.length) return runningLogs || [];
  try {
    await openRunStore();
  } catch {
    return runningLogs; // IDB unavailable, keep logs as-is
  }
  const stripped = [];
  for (const log of runningLogs) {
    const heavy = extractHeavyFields(log);
    if (heavy) await saveRunRoute(log.id, heavy);
    stripped.push(stripHeavyFields(log));
  }
  return stripped;
}
