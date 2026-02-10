import { saveDB } from '../data.js';
import { formatDate } from '../utils.js';
import { renderCalendar } from './calendar.js';

let detailWorkoutId = null;

export function renderHistory(db, dateFilter) {
  const filter = document.getElementById('historyFilter').value;
  let items = [...db.workouts].reverse();
  if (filter) items = items.filter(w => w.session === filter);
  if (dateFilter) items = items.filter(w => w.date === dateFilter);
  document.getElementById('historyList').innerHTML = items.length === 0
    ? '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:40px 0">Sin registros aún</p>'
    : items.map(w => {
      const summary = w.exercises.filter(e => e.sets.some(s => s.kg)).map(e => `${e.name}: ${e.sets.map(s => `${s.kg || '—'}×${s.reps || '—'}`).join(', ')}`).join(' · ');
      const hs = w.exercises.filter(e => !e.sets.some(s => s.kg) && e.sets[0]?.reps).map(e => e.sets[0].reps).join(' · ');
      const hasPR = w.prs && w.prs.length > 0;
      const prBadge = hasPR ? '<span style="font-size:.55rem;background:var(--accent);color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:6px">🏆 PR</span>' : '';
      return `<div class="history-item" data-id="${w.id}"><div class="hi-date">${formatDate(w.date)}</div><div class="hi-session">Fase ${['I', 'II', 'III', 'IV'][w.phase - 1]} · ${w.session}${prBadge}</div><div class="hi-summary">${summary || hs || '—'}</div></div>`;
    }).join('');
}

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
  document.getElementById('detailPhase').textContent = 'Fase ' + ['I', 'II', 'III', 'IV'][w.phase - 1];

  let totalVol = 0, totalSets = 0, maxKg = 0;
  const prNames = new Set((w.prs || []).map(p => p.exercise));
  const exHtml = w.exercises.map(e => {
    const isPR = prNames.has(e.name);
    const prTag = isPR ? `<span style="font-size:${fs(.55)};background:var(--accent);color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:4px">🏆 PR</span>` : '';
    const setsHtml = e.sets.map((s, i) => {
      const kg = parseFloat(s.kg) || 0, reps = parseInt(s.reps) || 0;
      totalVol += kg * reps; totalSets++; if (kg > maxKg) maxKg = kg;
      return `<div style="display:flex;align-items:center;justify-content:center;gap:${gap(10)};font-size:${fs(.9)}"><span style="color:var(--text3);font-weight:600;width:22px;text-align:right">S${i + 1}</span><span style="color:var(--text);font-weight:600;min-width:52px;text-align:right">${s.kg || '—'} kg</span><span style="color:var(--text2)">× ${s.reps || '—'}</span></div>`;
    }).join('');
    return `<div><div style="font-size:${fs(.88)};font-weight:700;color:var(--accent);margin-bottom:${gap(6)};display:flex;align-items:center;justify-content:center;gap:6px"><span style="width:3px;height:${gap(14)};background:var(--accent);border-radius:2px;display:inline-block"></span>${e.name}${prTag}</div><div style="display:flex;flex-direction:column;gap:${gap(4)};align-items:center">${setsHtml}</div></div>`;
  }).join('');
  const exContainer = document.getElementById('detailExercises');
  exContainer.style.gap = gap(10);
  exContainer.innerHTML = exHtml;

  const notesEl = document.getElementById('detailNotes');
  if (w.notes) { notesEl.textContent = '💬 ' + w.notes; notesEl.style.display = 'block'; notesEl.style.fontSize = fs(.75); }
  else { notesEl.style.display = 'none'; }

  const statsHtml = [
    { label: 'Volumen', value: totalVol > 1000 ? (totalVol / 1000).toFixed(1) + 't' : Math.round(totalVol) + 'kg' },
    { label: 'Series', value: totalSets },
    { label: 'Máx peso', value: maxKg + 'kg' }
  ].map(s => `<div style="flex:1;text-align:center"><div style="font-size:${fs(1.4)};font-weight:800;color:var(--text);letter-spacing:-.02em">${s.value}</div><div style="font-size:${fs(.65)};color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:2px">${s.label}</div></div>`).join('');
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

export function deleteWorkout(db) {
  const btn = document.getElementById('deleteBtn');
  if (btn.dataset.confirm === 'true') {
    db.workouts = db.workouts.filter(w => w.id !== detailWorkoutId);
    saveDB(db);
    closeDetailModal();
    renderHistory(db);
    renderCalendar(db);
  } else {
    btn.dataset.confirm = 'true'; btn.textContent = '¿Seguro?'; btn.style.width = '80px';
    setTimeout(() => { btn.dataset.confirm = 'false'; btn.textContent = 'Borrar'; btn.style.width = '70px'; }, 3000);
  }
}
