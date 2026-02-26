import { mergeDB } from './utils.js';

const SK = 'barraLibre';

let _onSave = null;
export function setOnSave(fn) { _onSave = fn; }

const DEFAULTS = { program: 'barraLibre', phase: 1, workouts: [], bodyLogs: [], deletedIds: [], settings: { height: 175, age: 32 } };

export function loadDB() {
  try {
    const d = JSON.parse(localStorage.getItem(SK));
    return d && d.workouts ? { ...DEFAULTS, ...d } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function markDeleted(db, id) {
  if (!db.deletedIds) db.deletedIds = [];
  if (!db.deletedIds.includes(id)) db.deletedIds.push(id);
}

export function saveDB(db) {
  localStorage.setItem(SK, JSON.stringify(db));
  if (_onSave) _onSave(db);
}

export function exportData(db) {
  const b = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = `barra-libre-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

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
    } catch {
      alert('Error al leer');
    }
  };
  r.readAsText(f);
}

export function clearAllData() {
  if (!confirm('¿Borrar TODOS los datos?')) return;
  if (!confirm('Última oportunidad. ¿Borrar todo?')) return;
  localStorage.removeItem(SK);
  location.reload();
}
