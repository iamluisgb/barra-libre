import { saveDB } from '../data.js';
import { getPrograms, getActiveProgram, getAllPhases } from '../programs.js';

let editingId = null;

function clearEditState() {
  if (!editingId) return;
  editingId = null;
  const btn = document.querySelector('#secTrain .btn');
  btn.textContent = 'Guardar sesión';
  btn.style.background = '';
}

export function populateSessions(db) {
  const sel = document.getElementById('trainSession');
  const fsel = document.getElementById('historyFilter');
  const progs = getPrograms();
  if (!progs[db.phase]) { db.phase = parseInt(Object.keys(progs)[0]) || 1; }
  const ss = Object.keys(progs[db.phase].sessions);
  sel.innerHTML = ss.map(s => `<option value="${s}">${s}</option>`).join('');
  fsel.innerHTML = '<option value="">Todas</option>' + ss.map(s => `<option value="${s}">${s}</option>`).join('');

  const prog = getActiveProgram();
  const lastW = db.workouts.filter(w => w.phase === db.phase && (w.program || 'barraLibre') === prog).sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (lastW && ss.length > 1) {
    const lastIdx = ss.indexOf(lastW.session);
    const nextIdx = (lastIdx + 1) % ss.length;
    sel.value = ss[nextIdx];
  }
  loadSessionTemplate(db, true);
}

export function loadSessionTemplate(db, autoPrefill) {
  clearEditState();
  const session = document.getElementById('trainSession').value;
  const progs = getPrograms();
  if (!progs[db.phase]) return;
  const exercises = progs[db.phase].sessions[session];
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
    const prevEx = prev ? prev.exercises[i] : null;
    const mode = ex.mode || (ex.type === 'hiit' || ex.type === 'density' ? 'result' : 'sets');
    switch (mode) {
      case 'sets': return renderSetsCard(ex, i, prevEx, shouldPrefill);
      case 'result': return renderResultCard(ex, i, prevEx, shouldPrefill);
      case 'interval': return renderIntervalCard(ex, i, prevEx, shouldPrefill);
      case 'tabata': return renderTabataCard(ex, i, prevEx, shouldPrefill);
      case 'rounds': return renderRoundsCard(ex, i, prevEx, shouldPrefill);
      case 'ladder': return renderLadderCard(ex, i, prevEx, shouldPrefill);
      case 'pyramid': return renderPyramidCard(ex, i, prevEx, shouldPrefill);
      case 'amrap': return renderAmrapCard(ex, i, prevEx, shouldPrefill);
      default: return renderResultCard(ex, i, prevEx, shouldPrefill);
    }
  }).join('');
}

function renderSetsCard(ex, i, prevEx, shouldPrefill) {
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
}

function renderResultCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  return `<div class="ex-card"><div class="ex-name">${ex.name}</div><div style="margin-top:8px"><label>Resultado</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="Tiempo / reps totales" value="${pv}"></div>${pi}</div>`;
}

function renderIntervalCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge interval">Intervalos</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">${ex.duration} · ${ex.on} on / ${ex.off} off</div>
    <div><label>Reps totales</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 30" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderTabataCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const rounds = ex.rounds || [];
  const grid = `<div class="tabata-grid">${rounds.map((r, ri) => `<div class="tabata-round"><span class="tr-num">R${ri + 1}</span>${r}</div>`).join('')}</div>`;
  return `<div class="ex-card">
    <div class="ex-mode-badge tabata">Tabata</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">8 rondas · 20s on / 10s off</div>
    ${grid}
    <div><label>Reps totales</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 64" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderRoundsCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exList = (ex.exercises || []).map(e =>
    `<div class="round-item"><span class="ri-name">${e.name}</span><span class="ri-reps">${e.reps}</span></div>`
  ).join('');
  const countLabel = ex.count > 0 ? `${ex.count} rondas` : 'Max rondas';
  const restLabel = ex.rest && ex.rest !== '0' ? ` · Desc: ${ex.rest}` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge rounds">Circuito</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">${countLabel}${restLabel}</div>
    <div class="round-list">${exList}</div>
    <div><label>Rondas completadas</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 4" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderLadderCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exNames = (ex.exercises || []).join(' → ');
  return `<div class="ex-card">
    <div class="ex-mode-badge ladder">Escalera</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">${ex.duration} · ${exNames}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    <div><label>Peldaño máximo</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 5" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderPyramidCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exNames = (ex.exercises || []).join(' → ');
  const stepInfo = ex.step ? `De ${ex.step} en ${ex.step}` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge pyramid">Pirámide</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">${ex.duration} · ${exNames}${stepInfo ? ' · ' + stepInfo : ''}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    <div><label>Nivel máximo</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 8" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderAmrapCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge amrap">AMRAP</div>
    <div class="ex-name">${ex.name}</div>
    <div class="ex-mode-info">${ex.duration}</div>
    <div><label>Reps totales</label><input type="text" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 45" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

export function clearPrefill() {
  document.getElementById('prefillBanner').style.display = 'none';
  document.querySelectorAll('#exerciseList input').forEach(inp => inp.value = '');
}

function getPrevSession(db, n) {
  const prog = getActiveProgram();
  const f = db.workouts.filter(w => w.session === n && w.phase === db.phase && (w.program || 'barraLibre') === prog);
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

export function startEdit(workout, db) {
  if (workout.phase !== db.phase) {
    db.phase = workout.phase;
    saveDB(db);
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const phases = getAllPhases();
    const phase = phases.find(p => p.id === db.phase);
    const roman = ROMAN[db.phase - 1] || db.phase;
    document.getElementById('phaseName').textContent = phase ? `Fase ${roman} · ${phase.name}` : `Fase ${roman}`;
    populateSessions(db);
  }

  document.getElementById('trainDate').value = workout.date;
  document.getElementById('trainSession').value = workout.session;
  document.getElementById('trainNotes').value = workout.notes || '';

  loadSessionTemplate(db, false);

  editingId = workout.id;

  workout.exercises.forEach((ex, i) => {
    ex.sets.forEach((set, s) => {
      const kgInput = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="kg"]`);
      const repsInput = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="reps"]`);
      if (kgInput) kgInput.value = set.kg || '';
      if (repsInput) repsInput.value = set.reps || '';
    });
  });

  const banner = document.getElementById('prefillBanner');
  const dateStr = workout.date.slice(5).replace('-', '/');
  document.getElementById('prefillText').textContent = `✏️ Editando ${workout.session} (${dateStr})`;
  banner.style.display = 'flex';

  document.querySelector('#secTrain .btn').textContent = 'Guardar cambios';
}

export function cancelEdit(db) {
  clearEditState();
  loadSessionTemplate(db, true);
}

export function saveWorkout(db) {
  const date = document.getElementById('trainDate').value;
  const session = document.getElementById('trainSession').value;
  const notes = document.getElementById('trainNotes').value;
  const progs = getPrograms();
  if (!progs[db.phase]) return;
  const exercises = progs[db.phase].sessions[session];
  if (!exercises) return;

  const exData = exercises.map((ex, i) => {
    const mode = ex.mode || (ex.type === 'hiit' || ex.type === 'density' ? 'result' : 'sets');
    if (mode === 'sets') {
      const sets = [];
      for (let s = 0; s < ex.sets; s++) {
        const k = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="kg"]`);
        const r = document.querySelector(`[data-ex="${i}"][data-set="${s}"][data-field="reps"]`);
        sets.push({ kg: k ? k.value : '', reps: r ? r.value : '' });
      }
      return { name: ex.name, sets };
    } else {
      const r = document.querySelector(`[data-ex="${i}"][data-set="0"][data-field="reps"]`);
      return { name: ex.name || ex.mode, sets: [{ kg: '', reps: r ? r.value : '' }] };
    }
  });

  const prs = [];
  exData.forEach(e => {
    const maxKg = Math.max(...e.sets.map(s => parseFloat(s.kg) || 0));
    if (maxKg <= 0) return;
    const prevPR = getExercisePR(db, e.name, editingId);
    if (maxKg > prevPR) prs.push({ exercise: e.name, kg: maxKg, prevKg: prevPR });
  });

  const prog = getActiveProgram();

  if (editingId) {
    const idx = db.workouts.findIndex(w => w.id === editingId);
    if (idx !== -1) {
      const workout = { id: editingId, date, session, phase: db.phase, program: prog, notes, exercises: exData };
      if (prs.length > 0) workout.prs = prs;
      db.workouts[idx] = workout;
    }
    editingId = null;
  } else {
    const workout = { id: Date.now(), date, session, phase: db.phase, program: prog, notes, exercises: exData };
    if (prs.length > 0) workout.prs = prs;
    db.workouts.push(workout);
  }
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
