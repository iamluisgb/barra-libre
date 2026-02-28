import { saveDB, markDeleted } from '../data.js';
import { getBodyMeasures } from '../programs.js';
import { formatDate, safeNum, confirmDanger } from '../utils.js';
import { DEFAULT_HEIGHT, DEFAULT_AGE } from '../constants.js';
import { toast } from './toast.js';

let editingBodyId = null;
let $bodyDate, $bodyMeasures, $bodyHistory, $bodyEditBanner, $bodyEditText, $bodyDeleteBtn, $bodySaveBtn;
let $calcHeight, $calcAge, $proportionsPanel, $caloriesPanel;

function clearBodyEditState() {
  editingBodyId = null;
  $bodySaveBtn.textContent = 'Guardar medidas';
  $bodySaveBtn.style.background = '';
  $bodyEditBanner.style.display = 'none';
  $bodyDeleteBtn.style.display = 'none';
}

/** Render body measurement input fields with last-value placeholders */
export function renderBodyForm(db) {
  const last = db.bodyLogs.length ? db.bodyLogs[db.bodyLogs.length - 1] : {};
  $bodyMeasures.innerHTML = getBodyMeasures().map(m =>
    `<div class="measure-row"><label>${m.label}</label><input type="number" id="bm_${m.id}" step="0.1" placeholder="${last[m.id] || '—'}"></div>`
  ).join('');
}

/** Save or update a body measurement log entry */
export function saveBodyLog(db) {
  const date = $bodyDate.value;
  const entry = { date, id: editingBodyId || Date.now() };
  let has = false;
  getBodyMeasures().forEach(m => {
    const v = document.getElementById('bm_' + m.id).value;
    if (v) { const n = safeNum(v, 0.1, 500); if (n !== null) { entry[m.id] = n; has = true; } }
  });
  if (!has) { toast('Introduce al menos una medida', 'error'); return; }

  const wasEditing = !!editingBodyId;
  if (editingBodyId) {
    const idx = db.bodyLogs.findIndex(l => l.id === editingBodyId);
    if (idx !== -1) db.bodyLogs[idx] = entry;
    editingBodyId = null;
  } else {
    db.bodyLogs.push(entry);
  }
  saveDB(db);

  clearBodyEditState();
  renderBodyForm(db);
  renderBodyHistory(db);
  calcProportions(db);
  calcCalories(db);

  toast(wasEditing ? 'Medidas actualizadas' : 'Medidas guardadas');
}

export function startBodyEdit(logId, db) {
  const log = db.bodyLogs.find(l => l.id === logId);
  if (!log) return;

  editingBodyId = logId;

  // Fill form
  $bodyDate.value = log.date;
  getBodyMeasures().forEach(m => {
    const input = document.getElementById('bm_' + m.id);
    input.value = log[m.id] || '';
  });

  // Show edit banner
  const dateStr = log.date.slice(5).replace('-', '/');
  $bodyEditText.textContent = `✏️ Editando registro (${dateStr})`;
  $bodyEditBanner.style.display = 'flex';

  // Show delete, change save text
  $bodyDeleteBtn.style.display = '';
  $bodySaveBtn.textContent = 'Guardar cambios';

  // Scroll to banner
  $bodyEditBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Initialize body section: cache selectors and bind events */
export function initBody(db) {
  $bodyDate = document.getElementById('bodyDate');
  $bodyMeasures = document.getElementById('bodyMeasures');
  $bodyHistory = document.getElementById('bodyHistory');
  $bodyEditBanner = document.getElementById('bodyEditBanner');
  $bodyEditText = document.getElementById('bodyEditText');
  $bodyDeleteBtn = document.getElementById('bodyDeleteBtn');
  $bodySaveBtn = document.querySelector('#secBody .btn.mb2');
  $calcHeight = document.getElementById('calcHeight');
  $calcAge = document.getElementById('calcAge');
  $proportionsPanel = document.getElementById('proportionsPanel');
  $caloriesPanel = document.getElementById('caloriesPanel');

  $bodySaveBtn.addEventListener('click', () => saveBodyLog(db));
  $bodyHistory.addEventListener('click', (e) => {
    const btn = e.target.closest('.hi-edit-btn');
    if (!btn) return;
    const item = btn.closest('.history-item[data-body-id]');
    if (item) startBodyEdit(parseInt(item.dataset.bodyId), db);
  });
  $bodyEditBanner.addEventListener('click', (e) => {
    if (e.target.closest('.body-edit-cancel')) cancelBodyEdit(db);
  });
  $bodyDeleteBtn.addEventListener('click', () => deleteBodyLog(db));
  $calcHeight.addEventListener('change', () => calcCalories(db));
  $calcAge.addEventListener('change', () => calcCalories(db));
}

export function cancelBodyEdit(db) {
  clearBodyEditState();
  renderBodyForm(db);
}

export function deleteBodyLog(db) {
  confirmDanger($bodyDeleteBtn, () => {
    markDeleted(db, editingBodyId);
    db.bodyLogs = db.bodyLogs.filter(l => l.id !== editingBodyId);
    saveDB(db);
    toast('Registro eliminado', 'info');
    clearBodyEditState();
    renderBodyForm(db);
    renderBodyHistory(db);
    calcProportions(db);
    calcCalories(db);
  });
}

/** Render the last 10 body measurement logs */
export function renderBodyHistory(db) {
  const logs = [...db.bodyLogs].reverse().slice(0, 10);
  $bodyHistory.innerHTML = logs.length === 0
    ? '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:20px 0">Sin registros</p>'
    : logs.map(l => {
      const vals = getBodyMeasures().filter(m => l[m.id]).map(m => `${m.label}: ${l[m.id]}`).join(' · ');
      return `<div class="history-item" data-body-id="${l.id}"><div class="hi-date">${formatDate(l.date)}</div><div class="hi-summary">${vals}</div><button class="hi-edit-btn">Editar</button></div>`;
    }).join('');
}

function getLatestBodyData(db) {
  const r = {}, dates = {};
  [...db.bodyLogs].reverse().forEach(l => {
    getBodyMeasures().forEach(m => {
      if (!r[m.id] && l[m.id]) { r[m.id] = l[m.id]; dates[m.id] = l.date; }
    });
  });
  r._dates = dates;
  return r;
}

/** Calculate and display ideal body proportions based on wrist ratio */
export function calcProportions(db) {
  const last = getLatestBodyData(db);
  if (!last.muneca) {
    $proportionsPanel.innerHTML = '<p style="color:var(--text2);font-size:.8rem">Registra muñeca para calcular</p>';
    return;
  }
  const ps = [
    { label: 'Brazo / Muñeca', current: last.biceps, target: last.muneca * 2.5, tl: `${(last.muneca * 2.5).toFixed(1)}cm (2.5×)`, has: !!last.biceps },
    { label: 'Pecho / Muñeca', current: last.pecho, target: last.muneca * 6.5, tl: `${(last.muneca * 6.5).toFixed(1)}cm (6.5×)`, has: !!last.pecho },
    { label: 'Hombros / Cintura', current: last.hombros, target: last.cintura * 1.618, tl: `${(last.cintura * 1.618).toFixed(1)}cm (φ)`, has: !!(last.hombros && last.cintura) },
    { label: 'Pantorrilla ≈ Bíceps', current: last.pantorrilla, target: last.biceps, tl: `${last.biceps || '—'}cm`, has: !!(last.pantorrilla && last.biceps) },
    { label: 'Muslo / Rodilla', current: last.muslo, target: last.rodilla * 1.618, tl: `${((last.rodilla || 0) * 1.618).toFixed(1)}cm (φ)`, has: !!(last.muslo && last.rodilla) }
  ];
  const usedIds = ['muneca', 'biceps', 'pecho', 'hombros', 'cintura', 'pantorrilla', 'muslo', 'rodilla'];
  const usedDates = new Set(usedIds.filter(id => last[id]).map(id => last._dates[id]));
  const dateWarning = usedDates.size > 1
    ? `<p style="color:var(--text3);font-size:.68rem;text-align:center;margin-bottom:8px">Datos de ${usedDates.size} fechas distintas — registra todas las medidas el mismo día para mayor precisión</p>`
    : '';
  $proportionsPanel.innerHTML = dateWarning + ps.map(p => {
    if (!p.has) return `<div class="proportion-card"><div class="p-label">${p.label}</div><div class="p-value" style="color:var(--text3);font-size:.8rem">Faltan medidas</div></div>`;
    const pct = Math.min((p.current / p.target) * 100, 120);
    const color = pct >= 95 && pct <= 105 ? 'var(--green)' : pct < 95 ? 'var(--accent)' : 'var(--teal)';
    return `<div class="proportion-card"><div class="p-label">${p.label}</div><div class="p-value" style="color:${color}">${p.current.toFixed(1)}cm <span style="font-size:.68rem;color:var(--text2)">/ ${p.tl}</span></div><div class="p-bar"><div class="p-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div></div>`;
  }).join('');
}

/** Calculate BMR, maintenance, and target calorie ranges */
export function calcCalories(db) {
  const last = getLatestBodyData(db);
  const h = safeNum($calcHeight.value, 100, 250) ?? DEFAULT_HEIGHT;
  const age = safeNum($calcAge.value, 10, 120) ?? DEFAULT_AGE;
  const peso = last.peso || 70, grasa = last.grasa || 15;
  const t1 = 10 * peso + 6.25 * h - 5 * age + 5;
  const lbm = peso * (1 - grasa / 100);
  const t2 = 370 + 21.6 * lbm;
  const tmb = (t1 + t2) / 2, m = tmb * 1.65;
  $caloriesPanel.innerHTML =
    `<div class="calc-result"><div class="cr-label">TMB (media)</div><div class="cr-value">${Math.round(tmb)} kcal</div><div class="cr-sub">Peso: ${peso}kg · Grasa: ${grasa}%</div></div>` +
    `<div class="calc-result"><div class="cr-label">Mantenimiento (×1.65)</div><div class="cr-value">${Math.round(m)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Volumen (+10-15%)</div><div class="cr-value">${Math.round(m * 1.1)} – ${Math.round(m * 1.15)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Definición (-15%)</div><div class="cr-value">${Math.round(m * .85)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Def. Máxima (×22/kg)</div><div class="cr-value">${Math.round(peso * 22)} kcal</div></div>`;
}
