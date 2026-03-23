import { saveDB, markDeleted } from '../data.js';
import { ROMAN } from '../constants.js';
import { formatDate, esc, confirmDanger } from '../utils.js';
import { getActiveProgram } from '../programs.js';
import { renderCalendar } from './calendar.js';
import { toast } from './toast.js';
const PAGE_SIZE = 50;
let detailWorkoutId = null;
let historyPage = 0;
let _currentDb = null;
let _lastWorkoutCount = -1;

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
    list.innerHTML = '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:40px 0">Sin registros aún.<br><span style="font-size:.72rem;color:var(--text3)">Completa tu primera sesión en la pestaña Entreno.</span></p>';
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
    const prTag = isPR ? `<span class="detail-pr-tag" style="font-size:${fs(.55)}">🏆 PR</span>` : '';
    const hasKg = e.sets.some(s => parseFloat(s.kg) > 0);
    const setsHtml = hasKg ? e.sets.map((s, i) => {
      const kg = parseFloat(s.kg) || 0, reps = parseInt(s.reps) || 0;
      totalVol += kg * reps; totalSets++; if (kg > maxKg) maxKg = kg;
      return `<div class="detail-set-row" style="font-size:${fs(.9)}"><span class="detail-set-num">S${i + 1}</span><span class="detail-set-kg">${s.kg || '—'} kg</span><span class="detail-set-reps">× ${s.reps || '—'}</span></div>`;
    }).join('') : `<div class="detail-set-single" style="font-size:${fs(.85)}">${e.sets[0]?.reps || '—'}</div>`;
    return `<div><div class="detail-ex-name" style="font-size:${fs(.88)}"><span class="detail-ex-accent"></span>${esc(e.name)}${prTag}</div><div class="detail-sets">${setsHtml}</div></div>`;
  }).join('');
  const exContainer = document.getElementById('detailExercises');
  exContainer.innerHTML = exHtml;

  const notesEl = document.getElementById('detailNotes');
  if (w.notes) { notesEl.textContent = '💬 ' + w.notes; notesEl.style.display = 'block'; notesEl.style.fontSize = fs(.75); }
  else { notesEl.style.display = 'none'; }

  const statsHtml = totalVol > 0 ? [
    { label: 'Volumen', value: totalVol > 1000 ? (totalVol / 1000).toFixed(1) + 't' : Math.round(totalVol) + 'kg' },
    { label: 'Series', value: totalSets },
    { label: 'Máx peso', value: maxKg + 'kg' }
  ].map(s => `<div class="detail-stat"><div class="detail-stat-value" style="font-size:${fs(1.4)}">${s.value}</div><div class="detail-stat-label" style="font-size:${fs(.65)}">${s.label}</div></div>`).join('') : `<div class="detail-stat"><div class="detail-stat-value" style="font-size:${fs(1.4)}">${w.exercises.length}</div><div class="detail-stat-label" style="font-size:${fs(.65)}">Ejercicios</div></div>`;
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
    const deleted = db.workouts.find(w => w.id === detailWorkoutId);
    markDeleted(db, detailWorkoutId);
    db.workouts = db.workouts.filter(w => w.id !== detailWorkoutId);
    saveDB(db);
    closeDetailModal();
    renderHistory(db);
    renderCalendar(db);
    toast('Sesión eliminada', 'info', {
      action: 'Deshacer',
      onAction: () => {
        if (deleted) {
          db.workouts.push(deleted);
          db.deletedIds = (db.deletedIds || []).filter(id => id !== deleted.id);
          saveDB(db);
          renderHistory(db);
          renderCalendar(db);
          toast('Sesión restaurada');
        }
      }
    });
  });
}
