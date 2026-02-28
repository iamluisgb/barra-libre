import { saveDB, markDeleted } from '../data.js';
import { formatDate, esc, confirmDanger } from '../utils.js';
import { getActiveProgram } from '../programs.js';
import { renderCalendar } from './calendar.js';
import { toast } from './toast.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const PAGE_SIZE = 50;
let detailWorkoutId = null;
let historyPage = 0;
let _currentDb = null;

function renderItem(w) {
  const summary = w.exercises.filter(e => e.sets.some(s => s.kg)).map(e => `${esc(e.name)}: ${e.sets.map(s => `${esc(s.kg) || '—'}×${esc(s.reps) || '—'}`).join(', ')}`).join(' · ');
  const hs = w.exercises.filter(e => !e.sets.some(s => s.kg) && e.sets[0]?.reps).map(e => `${esc(e.name)}: ${esc(e.sets[0].reps)}`).join(' · ');
  const hasPR = w.prs && w.prs.length > 0;
  const prBadge = hasPR ? '<span style="font-size:.55rem;background:var(--accent);color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:6px">🏆 PR</span>' : '';
  return `<div class="history-item" data-id="${w.id}"><div class="hi-date">${formatDate(w.date)}</div><div class="hi-session">Fase ${ROMAN[w.phase - 1] || w.phase} · ${w.session}${prBadge}</div><div class="hi-summary">${summary || hs || '—'}</div></div>`;
}

/** Render paginated workout history list */
export function renderHistory(db, dateFilter) {
  _currentDb = db;
  historyPage = 0;
  const filter = document.getElementById('historyFilter').value;
  const prog = getActiveProgram();
  let items = [...db.workouts].reverse();
  items = items.filter(w => (w.program || 'barraLibre') === prog);
  if (filter) items = items.filter(w => w.session === filter);
  if (dateFilter) items = items.filter(w => w.date === dateFilter);

  const list = document.getElementById('historyList');
  if (items.length === 0) {
    list.innerHTML = '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:40px 0">Sin registros aún</p>';
    return;
  }

  const slice = items.slice(0, PAGE_SIZE);
  list.innerHTML = slice.map(renderItem).join('');
  if (items.length > PAGE_SIZE) {
    list.innerHTML += `<button class="load-more-btn" data-total="${items.length}">Cargar más (${items.length - PAGE_SIZE} restantes)</button>`;
  }
}

function loadMore() {
  if (!_currentDb) return;
  historyPage++;
  const filter = document.getElementById('historyFilter').value;
  const prog = getActiveProgram();
  let items = [..._currentDb.workouts].reverse();
  items = items.filter(w => (w.program || 'barraLibre') === prog);
  if (filter) items = items.filter(w => w.session === filter);

  const end = (historyPage + 1) * PAGE_SIZE;
  const slice = items.slice(0, end);
  const list = document.getElementById('historyList');
  list.innerHTML = slice.map(renderItem).join('');
  if (end < items.length) {
    list.innerHTML += `<button class="load-more-btn" data-total="${items.length}">Cargar más (${items.length - end} restantes)</button>`;
  }
}

/** Open the workout detail modal for a given workout ID */
export function showDetail(id, db) {
  detailWorkoutId = id;
  const w = db.workouts.find(x => x.id === id);
  if (!w) return;
  const totalItems = w.exercises.reduce((a, e) => a + 1 + e.sets.length, 0);
  let scale = totalItems <= 12 ? 1 : totalItems <= 18 ? .85 : totalItems <= 24 ? .72 : .62;
  const fs = (base) => (base * scale).toFixed(2) + 'rem';
  const gap = (base) => Math.round(base * scale) + 'px';

  document.getElementById('detailDate').style.fontSize = fs(.82);
  document.getElementById('detailSession').style.fontSize = fs(1.7);
  document.getElementById('detailPhase').style.fontSize = fs(.68);
  document.getElementById('detailDate').textContent = formatDate(w.date);
  document.getElementById('detailSession').textContent = w.session;
  document.getElementById('detailPhase').textContent = 'Fase ' + (ROMAN[w.phase - 1] || w.phase);

  let totalVol = 0, totalSets = 0, maxKg = 0;
  const prNames = new Set((w.prs || []).map(p => p.exercise));
  const exHtml = w.exercises.map(e => {
    const isPR = prNames.has(e.name);
    const prTag = isPR ? `<span style="font-size:${fs(.55)};background:var(--accent);color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:4px">🏆 PR</span>` : '';
    const hasKg = e.sets.some(s => parseFloat(s.kg) > 0);
    const setsHtml = hasKg ? e.sets.map((s, i) => {
      const kg = parseFloat(s.kg) || 0, reps = parseInt(s.reps) || 0;
      totalVol += kg * reps; totalSets++; if (kg > maxKg) maxKg = kg;
      return `<div style="display:flex;align-items:center;justify-content:center;gap:${gap(10)};font-size:${fs(.9)}"><span style="color:var(--text3);font-weight:600;width:22px;text-align:right">S${i + 1}</span><span style="color:var(--text);font-weight:600;min-width:52px;text-align:right">${s.kg || '—'} kg</span><span style="color:var(--text2)">× ${s.reps || '—'}</span></div>`;
    }).join('') : `<div style="font-size:${fs(.85)};color:var(--text);text-align:center;font-weight:600">${e.sets[0]?.reps || '—'}</div>`;
    return `<div><div style="font-size:${fs(.88)};font-weight:700;color:var(--accent);margin-bottom:${gap(6)};display:flex;align-items:center;justify-content:center;gap:6px"><span style="width:3px;height:${gap(14)};background:var(--accent);border-radius:2px;display:inline-block"></span>${esc(e.name)}${prTag}</div><div style="display:flex;flex-direction:column;gap:${gap(4)};align-items:center">${setsHtml}</div></div>`;
  }).join('');
  const exContainer = document.getElementById('detailExercises');
  exContainer.style.gap = gap(10);
  exContainer.innerHTML = exHtml;

  const notesEl = document.getElementById('detailNotes');
  if (w.notes) { notesEl.textContent = '💬 ' + w.notes; notesEl.style.display = 'block'; notesEl.style.fontSize = fs(.75); }
  else { notesEl.style.display = 'none'; }

  const statsHtml = totalVol > 0 ? [
    { label: 'Volumen', value: totalVol > 1000 ? (totalVol / 1000).toFixed(1) + 't' : Math.round(totalVol) + 'kg' },
    { label: 'Series', value: totalSets },
    { label: 'Máx peso', value: maxKg + 'kg' }
  ].map(s => `<div style="flex:1;text-align:center"><div style="font-size:${fs(1.4)};font-weight:800;color:var(--text);letter-spacing:-.02em">${s.value}</div><div style="font-size:${fs(.65)};color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">${s.label}</div></div>`).join('') : `<div style="flex:1;text-align:center"><div style="font-size:${fs(1.4)};font-weight:800;color:var(--text)">${w.exercises.length}</div><div style="font-size:${fs(.65)};color:var(--text3);font-weight:600;text-transform:uppercase;margin-top:2px">Ejercicios</div></div>`;
  document.getElementById('detailStats').innerHTML = statsHtml;

  document.querySelectorAll('.card-brand,.card-url').forEach(el => el.style.fontSize = fs(.68));

  document.getElementById('detailModal').classList.add('open');
  const bb = document.getElementById('detailBtnBar'); bb.style.display = 'flex';
  const dbtn = document.getElementById('deleteBtn');
  dbtn.dataset.confirm = 'false'; dbtn.textContent = 'Borrar'; dbtn.style.width = '70px';
}

export async function shareCard() {
  const card = document.getElementById('shareCard');
  try {
    const canvas = await html2canvas(card, { backgroundColor: null, scale: 3, useCORS: true, logging: false });
    canvas.toBlob(async blob => {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'workout.png', { type: 'image/png' })] })) {
        await navigator.share({ files: [new File([blob], 'workout.png', { type: 'image/png' })], title: 'Mi entreno — Barra Libre' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'barra-libre-' + new Date().toISOString().slice(0, 10) + '.png';
        a.click(); URL.revokeObjectURL(url);
      }
    }, 'image/png');
  } catch (e) { alert('Error al generar imagen. Intenta hacer captura de pantalla.'); }
}

export function closeDetailModal() {
  document.getElementById('detailModal').classList.remove('open');
  document.getElementById('detailBtnBar').style.display = 'none';
}

export function getDetailWorkout(db) {
  return db.workouts.find(x => x.id === detailWorkoutId) || null;
}

/** Initialize history section: bind filter, list clicks, and detail modal */
export function initHistory(db, { onEdit }) {
  document.getElementById('historyFilter').addEventListener('change', () => renderHistory(db));
  document.getElementById('historyList').addEventListener('click', (e) => {
    if (e.target.closest('.load-more-btn')) { loadMore(); return; }
    const item = e.target.closest('.history-item[data-id]');
    if (item) showDetail(parseInt(item.dataset.id), db);
  });
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailModal')) closeDetailModal();
  });
  document.querySelector('.detail-close-btn').addEventListener('click', () => closeDetailModal());
  document.getElementById('editBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const workout = getDetailWorkout(db);
    if (!workout) return;
    closeDetailModal();
    onEdit(workout);
  });
  document.querySelector('.detail-share-btn').addEventListener('click', (e) => { e.stopPropagation(); shareCard(); });
  document.getElementById('deleteBtn').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkout(db); });
}

export function deleteWorkout(db) {
  confirmDanger(document.getElementById('deleteBtn'), () => {
    markDeleted(db, detailWorkoutId);
    db.workouts = db.workouts.filter(w => w.id !== detailWorkoutId);
    saveDB(db);
    toast('Sesión eliminada', 'info');
    closeDetailModal();
    renderHistory(db);
    renderCalendar(db);
  });
}
