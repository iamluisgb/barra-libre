import { saveDB } from '../data.js';
import { PROGRAMS } from '../programs.js';
import { formatDate } from '../utils.js';

export function populateSessions(db) {
  const sel = document.getElementById('trainSession');
  const fsel = document.getElementById('historyFilter');
  const ss = Object.keys(PROGRAMS[db.phase].sessions);
  sel.innerHTML = ss.map(s => `<option value="${s}">${s}</option>`).join('');
  fsel.innerHTML = '<option value="">Todas</option>' + ss.map(s => `<option value="${s}">${s}</option>`).join('');

  const lastW = db.workouts.filter(w => w.phase === db.phase).sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (lastW && ss.length > 1) {
    const lastIdx = ss.indexOf(lastW.session);
    const nextIdx = (lastIdx + 1) % ss.length;
    sel.value = ss[nextIdx];
  }
  loadSessionTemplate(db, true);
}

export function loadSessionTemplate(db, autoPrefill) {
  const session = document.getElementById('trainSession').value;
  const exercises = PROGRAMS[db.phase].sessions[session];
  if (!exercises) return;
  const container = document.getElementById('exerciseList');
  const prev = getPrevSession(db, session);
  const prefillBanner = document.getElementById('prefillBanner');
  const shouldPrefill = autoPrefill && prev;

  if (shouldPrefill) {
    const prevDate = prev.date.slice(5).replace('-', '/');
    document.getElementById('prefillText').textContent = `📋 Cargada tu última ${session} (${prevDate})`;
    prefillBanner.style.display = 'flex';
  } else {
    prefillBanner.style.display = 'none';
  }

  container.innerHTML = exercises.map((ex, i) => {
    const isH = ex.type === 'hiit' || ex.type === 'density';
    const prevEx = prev ? prev.exercises[i] : null;
    if (isH) {
      const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
      const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
      return `<div class="ex-card"><div class="ex-name">${ex.name}</div><div style="margin-top:8px"><label>Resultado</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="Tiempo / reps totales" value="${pv}"></div>${pi}</div>`;
    }
    let sh = `<div class="sets-grid"><div></div><div class="sets-header">Kg</div><div class="sets-header">Reps</div>`;
    for (let s = 0; s < ex.sets; s++) {
      const pK = prevEx?.sets[s]?.kg ?? '';
      const pR = prevEx?.sets[s]?.reps ?? '';
      const vK = shouldPrefill && pK ? pK : '';
      const vR = shouldPrefill && pR ? pR : '';
      sh += `<div class="set-label">S${s + 1}</div><input type="number" data-ex="${i}" data-set="${s}" data-field="kg" placeholder="${pK || '—'}" value="${vK}" step="0.5"><input type="text" data-ex="${i}" data-set="${s}" data-field="reps" placeholder="${pR || ex.reps}" value="${vR}" inputmode="numeric">`;
    }
    sh += '</div>';
    const pi = prevEx ? `<div class="prev-data">Anterior: ${prevEx.sets.map(s => `<span>${s.kg || '—'}×${s.reps || '—'}</span>`).join(' · ')}</div>` : '';
    return `<div class="ex-card"><div class="ex-name">${ex.name}</div><div class="ex-target">${ex.sets}×${ex.reps}${ex.type === 'extra' ? ' (extra)' : ''}</div>${sh}${pi}</div>`;
  }).join('');
}

export function clearPrefill() {
  document.getElementById('prefillBanner').style.display = 'none';
  document.querySelectorAll('#exerciseList input').forEach(inp => inp.value = '');
}

function getPrevSession(db, n) {
  const f = db.workouts.filter(w => w.session === n && w.phase === db.phase);
  return f.length ? f[f.length - 1] : null;
}

export function getExercisePR(db, name, excludeId) {
  let max = 0;
  db.workouts.forEach(w => {
    if (excludeId && w.id === excludeId) return;
    w.exercises.forEach(e => {
      if (e.name === name) e.sets.forEach(s => { const kg = parseFloat(s.kg) || 0; if (kg > max) max = kg; });
    });
  });
  return max;
}

export function saveWorkout(db) {
  const date = document.getElementById('trainDate').value;
  const session = document.getElementById('trainSession').value;
  const notes = document.getElementById('trainNotes').value;
  const exercises = PROGRAMS[db.phase].sessions[session];
  const exData = exercises.map((ex, i) => {
    const sets = [];
    for (let s = 0; s < ex.sets; s++) {
      const k = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="kg"]`);
      const r = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="reps"]`);
      sets.push({ kg: k ? k.value : '', reps: r ? r.value : '' });
    }
    return { name: ex.name, sets };
  });

  const prs = [];
  exData.forEach(e => {
    const maxKg = Math.max(...e.sets.map(s => parseFloat(s.kg) || 0));
    if (maxKg <= 0) return;
    const prevPR = getExercisePR(db, e.name);
    if (maxKg > prevPR) prs.push({ exercise: e.name, kg: maxKg, prevKg: prevPR });
  });

  const workout = { id: Date.now(), date, session, phase: db.phase, notes, exercises: exData };
  if (prs.length > 0) workout.prs = prs;
  db.workouts.push(workout);
  saveDB(db);

  if (prs.length > 0) {
    document.getElementById('prList').innerHTML = prs.map(p =>
      `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,85,255,.06);border-radius:var(--radius);margin-bottom:6px">
        <div style="font-size:.75rem;font-weight:700;color:var(--accent);flex:1">${p.exercise}</div>
        <div style="font-size:.7rem;color:var(--text3);text-decoration:line-through">${p.prevKg > 0 ? p.prevKg + 'kg' : '—'}</div>
        <div style="font-size:.85rem;font-weight:800;color:var(--green)">${p.kg}kg</div>
      </div>`
    ).join('');
    const cel = document.getElementById('prCelebration');
    cel.style.display = 'flex';
  }

  document.getElementById('trainNotes').value = '';
  loadSessionTemplate(db, true);
  const btn = document.querySelector('#secTrain .btn'), o = btn.textContent;
  btn.textContent = '✓ Guardado'; btn.style.background = 'var(--green)';
  setTimeout(() => { btn.textContent = o; btn.style.background = ''; }, 1200);
}
