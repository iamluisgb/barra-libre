import { mergeDB } from './utils.js';

const SK = 'barraLibre';

let _onSave = null;
let _onQuotaError = null;
/** @param {Function} fn - Callback invoked after every saveDB */
export function setOnSave(fn) { _onSave = fn; }
/** @param {Function} fn - Callback invoked when localStorage is full */
export function setOnQuotaError(fn) { _onQuotaError = fn; }

const CURRENT_SCHEMA = 2;

const DEFAULTS = { schemaVersion: CURRENT_SCHEMA, program: 'barraLibre', phase: 1, workouts: [], bodyLogs: [], deletedIds: [], customPrograms: [], runningLogs: [], runningProgram: '', runningWeek: 1, runningGoal: { type: 'km', target: 0, enabled: false }, settings: { height: 175, age: 32 } };

/** Schema migrations — each takes a db object and mutates it in place */
const migrations = [
  // v1 → v2: ensure all workouts have a program field; ensure settings exists
  (db) => {
    for (const w of (db.workouts || [])) {
      if (!w.program) w.program = db.program || 'barraLibre';
    }
    if (!db.settings || typeof db.settings !== 'object') {
      db.settings = { height: 175, age: 32 };
    }
    if (!db.runningLogs) db.runningLogs = [];
    if (!db.customPrograms) db.customPrograms = [];
  },
];

/** Run pending migrations on a loaded db object */
export function migrateDB(db) {
  const from = db.schemaVersion || 1;
  for (let v = from; v < CURRENT_SCHEMA; v++) {
    const fn = migrations[v - 1];
    if (fn) fn(db);
  }
  db.schemaVersion = CURRENT_SCHEMA;
  return db;
}

/** Load database from localStorage, falling back to defaults */
export function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(SK));
    if (d && d.workouts) {
      const db = { ...DEFAULTS, ...d };
      return migrateDB(db);
    }
    return { ...DEFAULTS };
  } catch (e) {
    console.warn('loadDB: corrupt localStorage data, using defaults', e);
    return { ...DEFAULTS };
  }
}

/** Track a deleted item ID so mergeDB never resurrects it */
export function markDeleted(db, id) {
  if (!db.deletedIds) db.deletedIds = [];
  if (!db.deletedIds.includes(id)) db.deletedIds.push(id);
}

/** @returns {boolean} true if db has valid minimal structure */
export function validateDB(db) {
  return db && typeof db === 'object' && Array.isArray(db.workouts) && Array.isArray(db.bodyLogs);
}

/** Prune deletedIds that no longer match any live record (max 500) */
export function pruneDeletedIds(db) {
  if (!db.deletedIds || db.deletedIds.length <= 500) return;
  const liveIds = new Set([
    ...(db.workouts || []).map(w => w.id),
    ...(db.bodyLogs || []).map(b => b.id),
    ...(db.runningLogs || []).map(r => r.id),
  ]);
  // Keep only IDs that are still referenced or recent (last 200)
  const recent = db.deletedIds.slice(-200);
  db.deletedIds = [...new Set([...recent, ...db.deletedIds.filter(id => liveIds.has(id))])];
}

/** Persist db to localStorage (validates structure first) */
export function saveDB(db) {
  if (!validateDB(db)) { console.error('saveDB: invalid db, aborting save', db); return; }
  pruneDeletedIds(db);
  try {
    localStorage.setItem(SK, JSON.stringify(db));
  } catch (e) {
    console.error('saveDB: storage write failed', e);
    if (_onQuotaError) _onQuotaError(db);
    return;
  }
  if (_onSave) _onSave(db);
}

/** Download db as a JSON file */
export function exportData(db) {
  const b = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `barra-libre-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

/** Validate imported data structure before merging */
export function validateImportData(d) {
  if (!d || typeof d !== 'object') return 'Datos inválidos';
  if (!Array.isArray(d.workouts)) return 'Falta el array de workouts';
  for (let i = 0; i < d.workouts.length; i++) {
    const w = d.workouts[i];
    if (!w || typeof w !== 'object') return `Workout #${i} inválido`;
    if (w.id == null) return `Workout #${i} sin id`;
    if (!Array.isArray(w.exercises)) return `Workout #${i} sin exercises[]`;
  }
  if (d.bodyLogs && !Array.isArray(d.bodyLogs)) return 'bodyLogs no es un array';
  if (d.runningLogs && !Array.isArray(d.runningLogs)) return 'runningLogs no es un array';
  if (d.deletedIds && !Array.isArray(d.deletedIds)) return 'deletedIds no es un array';
  if (d.customPrograms && !Array.isArray(d.customPrograms)) return 'customPrograms no es un array';
  return null;
}

/** Import and merge a JSON backup from a file input event */
export function importData(event, db, onSuccess) {
  const f = event.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const err = validateImportData(d);
      if (err) { alert(`Formato no válido: ${err}`); return; }
      Object.assign(db, mergeDB(db, d));
      saveDB(db);
      alert('Datos importados');
      location.reload();
    } catch (e) {
      console.warn('importData failed:', e);
      alert('Error al leer el archivo');
    }
  };
  r.readAsText(f);
}

/** Wipe all data after double confirmation */
export function clearAllData() {
  if (!confirm('¿Borrar TODOS los datos?')) return;
  if (!confirm('Última oportunidad. ¿Borrar todo?')) return;
  localStorage.removeItem(SK);
  location.reload();
}
