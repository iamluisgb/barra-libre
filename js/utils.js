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

/** Trap focus inside a modal element. Returns a cleanup function. */
export function trapFocus(el) {
  const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function handler(e) {
    if (e.key !== 'Tab') return;
    const nodes = [...el.querySelectorAll(focusable)].filter(n => !n.disabled && n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  el.addEventListener('keydown', handler);
  // Focus the first focusable element
  const first = el.querySelector(focusable);
  if (first) requestAnimationFrame(() => first.focus());
  return () => el.removeEventListener('keydown', handler);
}

const safeArr = v => Array.isArray(v) ? v : [];

function mergeById(local, remote, deleted, key = 'id') {
  const map = new Map();
  for (const item of local) { if (item?.[key] != null) map.set(item[key], item); }
  for (const item of remote) { if (item?.[key] != null) map.set(item[key], item); }
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
  merged.customPrograms = mergeById(safeArr(local.customPrograms), safeArr(remote.customPrograms), [], '_customId');
  merged.runningLogs = mergeById(safeArr(local.runningLogs), safeArr(remote.runningLogs), allDeleted);
  return merged;
}
