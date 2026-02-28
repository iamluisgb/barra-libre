import { mergeDB } from './utils.js';

const SK = 'barraLibre';

let _onSave = null;
/** @param {Function} fn - Callback invoked after every saveDB */
export function setOnSave(fn) { _onSave = fn; }

const DEFAULTS = { program: 'barraLibre', phase: 1, workouts: [], bodyLogs: [], deletedIds: [], settings: { height: 175, age: 32 } };

/** Load database from localStorage, falling back to defaults */
export function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(SK));
    return d && d.workouts ? { ...DEFAULTS, ...d } : { ...DEFAULTS };
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

/** Persist db to localStorage (validates structure first) */
export function saveDB(db) {
  if (!validateDB(db)) { console.error('saveDB: invalid db, aborting save', db); return; }
  localStorage.setItem(SK, JSON.stringify(db));
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

/** Import and merge a JSON backup from a file input event */
export function importData(event, db, onSuccess) {
  const f = event.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.workouts) {
        Object.assign(db, mergeDB(db, d));
        saveDB(db);
        alert('Datos importados');
        location.reload();
      } else {
        alert('Formato no válido');
      }
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
