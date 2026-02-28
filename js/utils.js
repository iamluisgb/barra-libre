/** Parse a number safely, returning null if out of range or NaN */
export function safeNum(val, min = 0, max = Infinity) {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Escape HTML entities to prevent XSS */
export function esc(str) {
  if (!str && str !== 0) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

/** Two-tap confirm for dangerous actions (delete, clear, etc.) */
export function confirmDanger(btn, action, timeout = 3000) {
  if (btn.dataset.confirm === 'true') { action(); return; }
  const orig = btn.textContent;
  const origW = btn.style.width;
  btn.dataset.confirm = 'true';
  btn.textContent = '¿Seguro?';
  setTimeout(() => { btn.dataset.confirm = 'false'; btn.textContent = orig; btn.style.width = origW; }, timeout);
}

/** Format 'YYYY-MM-DD' as 'DD/MM/YYYY' */
export function formatDate(d) {
  if (!d) return '—';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

/** @returns {string} Today's date as 'YYYY-MM-DD' */
export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const safeArr = v => Array.isArray(v) ? v : [];

function mergeById(local, remote, deleted) {
  const map = new Map();
  for (const item of local) { if (item?.id != null) map.set(item.id, item); }
  for (const item of remote) { if (item?.id != null) map.set(item.id, item); }
  for (const id of deleted) map.delete(id);
  return [...map.values()];
}

/** @param {Object} local - Local DB object
 *  @param {Object} remote - Remote DB object (e.g. from Drive)
 *  @returns {Object} Merged DB */
export function mergeDB(local, remote) {
  const localDel = safeArr(local.deletedIds);
  const remoteDel = safeArr(remote.deletedIds);
  const allDeleted = [...new Set([...localDel, ...remoteDel])];
  const merged = { ...remote };
  merged.workouts = mergeById(safeArr(local.workouts), safeArr(remote.workouts), allDeleted);
  merged.bodyLogs = mergeById(safeArr(local.bodyLogs), safeArr(remote.bodyLogs), allDeleted);
  merged.deletedIds = allDeleted;
  return merged;
}
