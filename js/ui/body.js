import { saveDB } from '../data.js';
import { BODY_MEASURES } from '../programs.js';
import { formatDate } from '../utils.js';

export function renderBodyForm(db) {
  const last = db.bodyLogs.length ? db.bodyLogs[db.bodyLogs.length - 1] : {};
  document.getElementById('bodyMeasures').innerHTML = BODY_MEASURES.map(m =>
    `<div class="measure-row"><label>${m.label}</label><input type="number" id="bm_${m.id}" step="0.1" placeholder="${last[m.id] || '—'}"></div>`
  ).join('');
}

export function saveBodyLog(db) {
  const date = document.getElementById('bodyDate').value;
  const entry = { date, id: Date.now() };
  let has = false;
  BODY_MEASURES.forEach(m => {
    const v = document.getElementById('bm_' + m.id).value;
    if (v) { entry[m.id] = parseFloat(v); has = true; }
  });
  if (!has) return alert('Introduce al menos una medida');
  db.bodyLogs.push(entry);
  saveDB(db);
  renderBodyForm(db);
  renderBodyHistory(db);
  calcProportions(db);
  calcCalories(db);
}

export function renderBodyHistory(db) {
  const logs = [...db.bodyLogs].reverse().slice(0, 10);
  document.getElementById('bodyHistory').innerHTML = logs.length === 0
    ? '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:20px 0">Sin registros</p>'
    : logs.map(l => {
      const vals = BODY_MEASURES.filter(m => l[m.id]).map(m => `${m.label}: ${l[m.id]}`).join(' · ');
      return `<div class="history-item"><div class="hi-date">${formatDate(l.date)}</div><div class="hi-summary">${vals}</div></div>`;
    }).join('');
}

function getLatestBodyData(db) {
  const r = {};
  [...db.bodyLogs].reverse().forEach(l => {
    BODY_MEASURES.forEach(m => { if (!r[m.id] && l[m.id]) r[m.id] = l[m.id]; });
  });
  return r;
}

export function calcProportions(db) {
  const last = getLatestBodyData(db);
  if (!last.muneca) {
    document.getElementById('proportionsPanel').innerHTML = '<p style="color:var(--text2);font-size:.8rem">Registra muñeca para calcular</p>';
    return;
  }
  const ps = [
    { label: 'Brazo / Muñeca', current: last.biceps, target: last.muneca * 2.5, tl: `${(last.muneca * 2.5).toFixed(1)}cm (2.5×)`, has: !!last.biceps },
    { label: 'Pecho / Muñeca', current: last.pecho, target: last.muneca * 6.5, tl: `${(last.muneca * 6.5).toFixed(1)}cm (6.5×)`, has: !!last.pecho },
    { label: 'Hombros / Cintura', current: last.hombros, target: last.cintura * 1.618, tl: `${(last.cintura * 1.618).toFixed(1)}cm (φ)`, has: !!(last.hombros && last.cintura) },
    { label: 'Pantorrilla ≈ Bíceps', current: last.pantorrilla, target: last.biceps, tl: `${last.biceps || '—'}cm`, has: !!(last.pantorrilla && last.biceps) },
    { label: 'Muslo / Rodilla', current: last.muslo, target: last.rodilla * 1.618, tl: `${((last.rodilla || 0) * 1.618).toFixed(1)}cm (φ)`, has: !!(last.muslo && last.rodilla) }
  ];
  document.getElementById('proportionsPanel').innerHTML = ps.map(p => {
    if (!p.has) return `<div class="proportion-card"><div class="p-label">${p.label}</div><div class="p-value" style="color:var(--text3);font-size:.8rem">Faltan medidas</div></div>`;
    const pct = Math.min((p.current / p.target) * 100, 120);
    const color = pct >= 95 && pct <= 105 ? 'var(--green)' : pct < 95 ? 'var(--accent)' : 'var(--teal)';
    return `<div class="proportion-card"><div class="p-label">${p.label}</div><div class="p-value" style="color:${color}">${p.current.toFixed(1)}cm <span style="font-size:.68rem;color:var(--text2)">/ ${p.tl}</span></div><div class="p-bar"><div class="p-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div></div>`;
  }).join('');
}

export function calcCalories(db) {
  const last = getLatestBodyData(db);
  const h = parseFloat(document.getElementById('calcHeight').value) || 175;
  const age = parseFloat(document.getElementById('calcAge').value) || 32;
  const peso = last.peso || 70, grasa = last.grasa || 15;
  const t1 = 10 * peso + 6.25 * h - 5 * age + 5;
  const lbm = peso * (1 - grasa / 100);
  const t2 = 370 + 21.6 * lbm;
  const tmb = (t1 + t2) / 2, m = tmb * 1.65;
  document.getElementById('caloriesPanel').innerHTML =
    `<div class="calc-result"><div class="cr-label">TMB (media)</div><div class="cr-value">${Math.round(tmb)} kcal</div><div class="cr-sub">Peso: ${peso}kg · Grasa: ${grasa}%</div></div>` +
    `<div class="calc-result"><div class="cr-label">Mantenimiento (×1.65)</div><div class="cr-value">${Math.round(m)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Volumen (+10-15%)</div><div class="cr-value">${Math.round(m * 1.1)} – ${Math.round(m * 1.15)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Definición (-15%)</div><div class="cr-value">${Math.round(m * .85)} kcal</div></div>` +
    `<div class="calc-result"><div class="cr-label">Def. Máxima (×22/kg)</div><div class="cr-value">${Math.round(peso * 22)} kcal</div></div>`;
}
