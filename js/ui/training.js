import { saveDB, getSaveRevision } from '../data.js';
import { ROMAN } from '../constants.js';
import { getPrograms, getActiveProgram, getAllPhases } from '../programs.js';
import { esc } from '../utils.js';
import { toast } from './toast.js';
import { exFmtTime, parseDurationStr, buildTimerConfig, initExTimerEvents, stopExTimer, isExTimerActive } from './training-timer.js';

// Re-export for tests
export { exFmtTime, parseDurationStr, buildTimerConfig };

let editingId = null;
let _formExpanded = false;
let $exerciseList, $trainSession, $trainDate, $trainNotes, $prefillBanner, $prefillText, $saveBtn, $prCelebration, $prList, $sessionOverview;

// ── Session draft auto-save ──────────────────────────────
const DRAFT_KEY = 'arete_sessionDraft';
let _draftTimer = null;

function saveDraft() {
  if (editingId) return; // don't draft when editing existing
  const inputs = $exerciseList?.querySelectorAll('input');
  if (!inputs?.length) return;
  const values = [];
  let hasData = false;
  inputs.forEach(inp => {
    values.push(inp.value);
    if (inp.value && !inp.classList.contains('prefilled')) hasData = true;
  });
  // Collect set-done checks
  const checks = [];
  $exerciseList.querySelectorAll('.set-label.set-done').forEach(l => {
    checks.push({ ex: l.dataset.ex, set: l.dataset.set });
  });
  if (!hasData && !checks.length) { localStorage.removeItem(DRAFT_KEY); return; }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      session: $trainSession.value,
      date: $trainDate.value,
      notes: $trainNotes.value,
      values,
      checks,
      ts: Date.now()
    }));
  } catch { /* quota */ }
}

function scheduleDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 500);
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  clearTimeout(_draftTimer);
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    // Discard drafts older than 12 hours
    if (Date.now() - draft.ts > 12 * 60 * 60 * 1000) { clearDraft(); return false; }
    if (draft.session !== $trainSession.value) return false;
    const inputs = $exerciseList.querySelectorAll('input');
    if (inputs.length !== draft.values.length) return false;
    draft.values.forEach((v, i) => {
      if (v) { inputs[i].value = v; inputs[i].classList.remove('prefilled'); }
    });
    if (draft.notes) $trainNotes.value = draft.notes;
    if (draft.date) $trainDate.value = draft.date;
    // Restore set-done checks
    if (draft.checks?.length) {
      draft.checks.forEach(({ ex, set }) => {
        const label = $exerciseList.querySelector(`.set-label[data-ex="${ex}"][data-set="${set}"]`);
        if (label) _markSetDone(label);
      });
    }
    return true;
  } catch { return false; }
}



function cacheSelectors() {
  if ($trainSession) return;
  $exerciseList = document.getElementById('exerciseList');
  $trainSession = document.getElementById('trainSession');
  $trainDate = document.getElementById('trainDate');
  $trainNotes = document.getElementById('trainNotes');
  $prefillBanner = document.getElementById('prefillBanner');
  $prefillText = document.getElementById('prefillText');
  $saveBtn = document.querySelector('#strTrain .btn');
  $prCelebration = document.getElementById('prCelebration');
  $prList = document.getElementById('prList');
  $sessionOverview = document.getElementById('sessionOverview');
}

function clearEditState() {
  if (!editingId) return;
  editingId = null;
  $saveBtn.textContent = 'Guardar sesión';
  $saveBtn.style.background = '';
}

/** Populate session select dropdowns based on active phase */
export function populateSessions(db) {
  cacheSelectors();
  const progs = getPrograms();
  if (!progs[db.phase]) { db.phase = parseInt(Object.keys(progs)[0]) || 1; }
  const ss = Object.keys(progs[db.phase].sessions);
  $trainSession.innerHTML = ss.map(s => `<option value="${s}">${s}</option>`).join('');
  document.getElementById('historyFilter').innerHTML = '<option value="">Todas</option>' + ss.map(s => `<option value="${s}">${s}</option>`).join('');

  const prog = getActiveProgram();
  const lastW = db.workouts.filter(w => w.phase === db.phase && (w.program || 'arete') === prog).sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (lastW && ss.length > 1) {
    const lastIdx = ss.indexOf(lastW.session);
    const nextIdx = (lastIdx + 1) % ss.length;
    $trainSession.value = ss[nextIdx];
  }
  _formExpanded = false;
  loadSessionTemplate(db, true);
  // Restore draft if there's one saved for the current session (only when form shown)
  if (_formExpanded && restoreDraft()) toast('Borrador restaurado', 'info');
}

// ── Exercise scroll spy dots ─────────────────────────────
let _exObserver = null;

function _setupExDots(count) {
  const $dots = document.getElementById('exerciseDots');
  if (!$dots) return;
  if (count < 3) { $dots.classList.remove('visible'); return; }
  $dots.innerHTML = Array.from({ length: count }, (_, i) =>
    `<span class="ex-dot" data-dot="${i}"></span>`
  ).join('');
  $dots.classList.add('visible');

  // Click to scroll
  $dots.addEventListener('click', (e) => {
    const dot = e.target.closest('.ex-dot');
    if (!dot) return;
    const card = $exerciseList.children[parseInt(dot.dataset.dot)];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // IntersectionObserver
  if (_exObserver) _exObserver.disconnect();
  _exObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = Array.from($exerciseList.children).indexOf(entry.target);
        if (idx >= 0) {
          $dots.querySelectorAll('.ex-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
        }
      }
    });
  }, { threshold: 0.5 });
  Array.from($exerciseList.children).forEach(card => _exObserver.observe(card));
}

export function exTargetText(ex) {
  const mode = ex.mode || (ex.type === 'hiit' || ex.type === 'density' ? 'result' : 'sets');
  if (mode === 'sets') return `${ex.sets}×${ex.reps}`;
  if (mode === 'superset') return `${ex.sets || ex.rounds || ''}× superset`;
  if (mode === 'interval') return `${ex.intervals || ''}× intervalos`;
  if (mode === 'tabata') return 'Tabata';
  if (mode === 'rounds') return `${ex.rounds || ''}× rondas`;
  if (mode === 'ladder') return 'Escalera';
  if (mode === 'pyramid') return 'Pirámide';
  if (mode === 'amrap') return `AMRAP ${ex.duration || ''}`;
  if (mode === 'emom') return `EMOM ${ex.duration || ''}`;
  if (ex.type === 'hiit') return 'HIIT';
  if (ex.type === 'density') return 'Densidad';
  return ex.reps || '';
}

function setFormVisible(show) {
  const timerBar = document.getElementById('timerBar');
  const miniTimer = document.getElementById('miniTimer');
  const dots = document.getElementById('exerciseDots');
  const notes = $trainNotes?.closest('.mb');
  [timerBar, miniTimer, $prefillBanner, dots, $exerciseList, notes, $saveBtn].forEach(el => {
    if (el) el.style.display = show ? '' : 'none';
  });
  if ($sessionOverview) $sessionOverview.style.display = show ? 'none' : '';
}

function renderSessionOverview(db, session, exercises) {
  const prev = getPrevSession(db, session);
  const hasDraft = (() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      return d.session === session && Date.now() - d.ts < 12 * 60 * 60 * 1000;
    } catch { return false; }
  })();

  const lastDate = prev ? prev.date.slice(5).replace('-', '/') : null;
  const btnText = hasDraft ? 'Continuar entreno' : 'Empezar entreno';

  let draftInfo = '';
  if (hasDraft) {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      const ago = Math.round((Date.now() - d.ts) / 60000);
      const agoText = ago < 60 ? `hace ${ago}min` : `hace ${Math.round(ago / 60)}h`;
      draftInfo = `<div class="so-draft">Borrador guardado ${agoText}</div>`;
    } catch { /* */ }
  }

  $sessionOverview.innerHTML = `
    <div class="session-overview-card">
      <div class="so-header">
        <span class="so-name">${esc(session)}</span>
        <span class="so-count">${exercises.length} ejercicios</span>
      </div>
      <div class="so-list">${exercises.map(ex => {
        if (ex.type === 'hiit' && ex.exercises && ex.exercises.length > 0) {
          const subList = ex.exercises.map(e => {
            const repsLabel = e.duration ? e.duration : (e.perSide ? `${e.reps} c/lado` : `${e.reps}`);
            return `<div class="so-hiit-ex"><span>${esc(e.name)}</span><span>${repsLabel}</span></div>`;
          }).join('');
          const roundsLabel = ex.rounds ? `${ex.rounds} rondas` : 'HIIT';
          return `<div class="so-ex so-ex-hiit">
            <div class="so-ex-hiit-header"><span class="so-ex-name">${esc(ex.name)}</span><span class="so-ex-target">${roundsLabel}</span></div>
            <div class="so-hiit-list">${subList}</div>
          </div>`;
        }
        return `<div class="so-ex"><span class="so-ex-name">${esc(ex.name)}</span><span class="so-ex-target">${exTargetText(ex)}</span></div>`;
      }).join('')}</div>
      ${lastDate ? `<div class="so-last">Última vez: ${lastDate}</div>` : ''}
      ${draftInfo}
      <button class="btn so-start">${btnText}</button>
    </div>`;

  $sessionOverview.querySelector('.so-start').addEventListener('click', () => {
    _formExpanded = true;
    loadSessionTemplate(db, true);
    if (hasDraft && restoreDraft()) toast('Borrador restaurado', 'info');
  });
}

/** Render exercise cards for the selected session template */
export function loadSessionTemplate(db, autoPrefill) {
  if (isExTimerActive()) stopExTimer(false);
  clearEditState();
  const session = $trainSession.value;
  const progs = getPrograms();
  if (!progs[db.phase]) return;
  const exercises = progs[db.phase].sessions[session];
  if (!exercises) return;

  // Show overview if form not yet expanded and not editing
  const hasDraft = (() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      return d.session === session && Date.now() - d.ts < 12 * 60 * 60 * 1000;
    } catch { return false; }
  })();

  if (!_formExpanded && !editingId && !hasDraft && $sessionOverview) {
    renderSessionOverview(db, session, exercises);
    setFormVisible(false);
    return;
  }

  setFormVisible(true);
  const prev = getPrevSession(db, session);
  const shouldPrefill = autoPrefill && prev;

  if (shouldPrefill) {
    const prevDate = prev.date.slice(5).replace('-', '/');
    $prefillText.textContent = `📋 Cargada tu última ${session} (${prevDate})`;
    $prefillBanner.style.display = 'flex';
  } else {
    $prefillBanner.style.display = 'none';
  }

  $exerciseList.innerHTML = exercises.map((ex, i) => {
    const prevEx = prev ? prev.exercises[i] : null;
    const mode = ex.mode || (ex.type === 'hiit' || ex.type === 'density' ? 'result' : 'sets');
    switch (mode) {
      case 'sets': return renderSetsCard(ex, i, prevEx, shouldPrefill);
      case 'result': return renderResultCard(ex, i, prevEx, shouldPrefill, ex.type);
      case 'interval': return renderIntervalCard(ex, i, prevEx, shouldPrefill);
      case 'tabata': return renderTabataCard(ex, i, prevEx, shouldPrefill);
      case 'rounds': return renderRoundsCard(ex, i, prevEx, shouldPrefill);
      case 'ladder': return renderLadderCard(ex, i, prevEx, shouldPrefill);
      case 'pyramid': return renderPyramidCard(ex, i, prevEx, shouldPrefill);
      case 'amrap': return renderAmrapCard(ex, i, prevEx, shouldPrefill);
      case 'emom': return renderEmomCard(ex, i, prevEx, shouldPrefill);
      case 'superset': return renderSupersetCard(ex, i, prevEx, shouldPrefill);
      default: return renderResultCard(ex, i, prevEx, shouldPrefill, ex.type);
    }
  }).join('');
  _setupExDots(exercises.length);
}

function timerBtnHtml(i, mode) {
  return `<button class="ex-timer-btn" data-ex-timer="${i}" data-timer-mode="${mode}">▶ Iniciar timer</button><div class="ex-timer-zone" data-ex="${i}"></div>`;
}

function renderSetsCard(ex, i, prevEx, shouldPrefill) {
  let sh = `<div class="sets-grid"><div></div><div class="sets-header">Kg</div><div class="sets-header">Reps</div>`;
  for (let s = 0; s < ex.sets; s++) {
    const pK = prevEx?.sets[s]?.kg ?? '';
    const pR = prevEx?.sets[s]?.reps ?? '';
    const vK = shouldPrefill && pK ? pK : '';
    const vR = shouldPrefill && pR ? pR : '';
    const cK = vK ? ' prefilled' : '';
    const cR = vR ? ' prefilled' : '';
    const activeClass = s === 0 ? ' active-set' : '';
    sh += `<button type="button" class="set-label${activeClass}" data-ex="${i}" data-set="${s}">S${s + 1}</button><input type="number" class="${cK}" data-ex="${i}" data-set="${s}" data-field="kg" placeholder="${pK || '—'}" value="${vK}" step="0.5" aria-label="Peso serie ${s + 1} de ${esc(ex.name)}"><input type="text" class="${cR}" data-ex="${i}" data-set="${s}" data-field="reps" placeholder="${pR || ex.reps}" value="${vR}" inputmode="numeric" aria-label="Reps serie ${s + 1} de ${esc(ex.name)}">`;
  }
  sh += '</div>';
  const pi = prevEx ? `<div class="prev-data">Anterior: ${prevEx.sets.map(s => `<span>${s.kg || '—'}×${s.reps || '—'}</span>`).join(' · ')}</div>` : '';
  return `<div class="ex-card"><div class="ex-name">${esc(ex.name)}</div><div class="ex-target">${ex.sets}×${ex.reps}${ex.type === 'extra' ? ' (extra)' : ''}</div>${sh}${pi}</div>`;
}

function renderResultCard(ex, i, prevEx, shouldPrefill, exType) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';

  if (exType === 'hiit' && ex.exercises && ex.exercises.length > 0) {
    const roundsLabel = ex.rounds ? `${ex.rounds} rondas` : '';
    const restLabel = ex.rest && ex.rest !== '0s' ? ` · Desc: ${ex.rest}` : '';
    const exList = ex.exercises.map(e => {
      const repsLabel = e.duration ? e.duration : (e.perSide ? `${e.reps} c/lado` : `${e.reps}`);
      return `<div class="round-item"><span class="ri-name">${esc(e.name)}</span><span class="ri-reps">${repsLabel}</span></div>`;
    }).join('');
    return `<div class="ex-card">
      <div class="ex-mode-badge hiit">HIIT</div>
      <div class="ex-name">${esc(ex.name)}</div>
      <div class="ex-mode-info">${roundsLabel}${restLabel}</div>
      <div class="round-list">${exList}</div>
      <button class="ex-timer-btn hiit-start" data-ex-timer="${i}" data-timer-mode="result">▶ Iniciar HIIT</button>
      <div class="ex-timer-zone" data-ex="${i}"></div>
      <div style="margin-top:8px"><label>Resultado</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="Tiempo total" value="${pv}"></div>
      ${pi}</div>`;
  }

  const isTimed = exType === 'hiit' || exType === 'density';
  const timer = isTimed ? timerBtnHtml(i, 'result') : '';
  return `<div class="ex-card"><div class="ex-name">${esc(ex.name)}</div>${timer}<div style="margin-top:8px"><label>Resultado</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="Tiempo / reps totales" value="${pv}"></div>${pi}</div>`;
}

function renderIntervalCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge interval">Intervalos</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${ex.duration} · ${ex.on} on / ${ex.off} off</div>
    ${timerBtnHtml(i, 'interval')}
    <div><label>Reps totales</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 30" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderTabataCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const rounds = ex.rounds || [];
  const grid = `<div class="tabata-grid">${rounds.map((r, ri) => `<div class="tabata-round"><span class="tr-num">R${ri + 1}</span>${r}</div>`).join('')}</div>`;
  return `<div class="ex-card">
    <div class="ex-mode-badge tabata">Tabata</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">8 rondas · 20s on / 10s off</div>
    ${grid}
    ${timerBtnHtml(i, 'tabata')}
    <div><label>Reps totales</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 64" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderRoundsCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exList = (ex.exercises || []).map(e =>
    `<div class="round-item"><span class="ri-name">${e.name}</span><span class="ri-reps">${e.reps}</span></div>`
  ).join('');
  const countLabel = ex.count > 0 ? `${ex.count} rondas` : 'Max rondas';
  const restLabel = ex.rest && ex.rest !== '0' ? ` · Desc: ${ex.rest}` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge rounds">Circuito</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${countLabel}${restLabel}</div>
    <div class="round-list">${exList}</div>
    ${timerBtnHtml(i, 'rounds')}
    <div><label>Rondas completadas</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 4" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderLadderCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exNames = (ex.exercises || []).join(' → ');
  return `<div class="ex-card">
    <div class="ex-mode-badge ladder">Escalera</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${ex.duration} · ${exNames}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    <div><label>Peldaño máximo</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 5" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderPyramidCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exNames = (ex.exercises || []).join(' → ');
  const stepInfo = ex.step ? `De ${ex.step} en ${ex.step}` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge pyramid">Pirámide</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${ex.duration} · ${exNames}${stepInfo ? ' · ' + stepInfo : ''}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    <div><label>Nivel máximo</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 8" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderAmrapCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  return `<div class="ex-card">
    <div class="ex-mode-badge amrap">AMRAP</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${ex.duration}</div>
    ${timerBtnHtml(i, 'amrap')}
    <div><label>Reps totales</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 45" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderEmomCard(ex, i, prevEx, shouldPrefill) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
  const exList = (ex.exercises || []).map(e => `${esc(e.name || e)}: ${e.reps || ''}`).join(' + ');
  return `<div class="ex-card">
    <div class="ex-mode-badge emom">EMOM</div>
    <div class="ex-name">${esc(ex.name)}</div>
    <div class="ex-mode-info">${ex.duration || ''}${exList ? ' · ' + exList : ''}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    ${timerBtnHtml(i, 'emom')}
    <div><label>Rondas completadas</label><input type="text" class="${cp}" data-ex="${i}" data-set="0" data-field="reps" placeholder="ej: 10" inputmode="numeric" value="${pv}"></div>
    ${pi}</div>`;
}

function renderSupersetCard(ex, i, prevEx, shouldPrefill) {
  const exercises = ex.exercises || [];
  const numSets = ex.sets || 3;
  const setsHtml = [];
  for (let s = 0; s < numSets; s++) {
    const setRows = exercises.map((subEx, subIdx) => {
      const prevSet = prevEx?.sets?.[s * exercises.length + subIdx];
      const pvKg = shouldPrefill && prevSet ? prevSet.kg || '' : '';
      const pvReps = shouldPrefill && prevSet ? prevSet.reps || '' : '';
      const cpKg = pvKg ? ' prefilled' : '';
      const cpReps = pvReps ? ' prefilled' : '';
      return `<div style="display:flex;align-items:center;gap:6px;font-size:.8rem">
        <span style="color:var(--text2);font-weight:600;min-width:60px;font-size:.7rem">${esc(subEx.name)}</span>
        <input type="number" class="mini-input${cpKg}" data-ex="${i}" data-set="${s * exercises.length + subIdx}" data-field="kg" step="0.5" placeholder="kg" inputmode="decimal" value="${pvKg}" style="width:55px">
        <span style="color:var(--text3)">x</span>
        <input type="text" class="mini-input${cpReps}" data-ex="${i}" data-set="${s * exercises.length + subIdx}" data-field="reps" placeholder="${subEx.reps || '—'}" inputmode="numeric" value="${pvReps}" style="width:45px">
      </div>`;
    }).join('');
    setsHtml.push(`<div style="margin-bottom:8px"><div style="font-size:.65rem;color:var(--text3);font-weight:600;margin-bottom:4px">Serie ${s + 1}</div>${setRows}</div>`);
  }
  return `<div class="ex-card">
    <div class="ex-mode-badge superset">Superserie</div>
    <div class="ex-name">${esc(ex.name)}</div>
    ${ex.desc ? `<div class="ex-mode-desc">${ex.desc}</div>` : ''}
    ${setsHtml.join('')}</div>`;
}

export function clearPrefill() {
  $prefillBanner.style.display = 'none';
  $exerciseList.querySelectorAll('input').forEach(inp => inp.value = '');
}

function getPrevSession(db, n) {
  const prog = getActiveProgram();
  const f = db.workouts.filter(w => w.session === n && w.phase === db.phase && (w.program || 'arete') === prog);
  return f.length ? f[f.length - 1] : null;
}

// PR cache: avoids scanning all workouts on every save
let _prCache = null;
let _prCacheRev = -1;

function buildPRCache(db) {
  const rev = getSaveRevision();
  if (_prCache && _prCacheRev === rev) return _prCache;
  const cache = new Map();
  for (const w of db.workouts) {
    for (const e of w.exercises) {
      for (const s of e.sets) {
        const kg = parseFloat(s.kg) || 0;
        if (kg > 0) {
          const key = e.name;
          const entry = cache.get(key);
          if (!entry || kg > entry.kg) cache.set(key, { kg, workoutId: w.id });
        }
      }
    }
  }
  _prCache = cache;
  _prCacheRev = rev;
  return cache;
}

/** Get highest kg ever lifted for an exercise */
export function getExercisePR(db, name, excludeId) {
  const cache = buildPRCache(db);
  const entry = cache.get(name);
  if (!entry) return 0;
  if (excludeId && entry.workoutId === excludeId) {
    // Fallback: scan without cache for this edge case
    let max = 0;
    for (const w of db.workouts) {
      if (w.id === excludeId) continue;
      for (const e of w.exercises) {
        if (e.name === name) for (const s of e.sets) { const kg = parseFloat(s.kg) || 0; if (kg > max) max = kg; }
      }
    }
    return max;
  }
  return entry.kg;
}

/** Pre-fill the training form for editing an existing workout */
export function startEdit(workout, db) {
  _formExpanded = true;
  if (workout.phase !== db.phase) {
    db.phase = workout.phase;
    saveDB(db);
    const phases = getAllPhases();
    const phase = phases.find(p => p.id === db.phase);
    const roman = ROMAN[db.phase - 1] || db.phase;
    document.getElementById('phaseName').textContent = phase ? `Fase ${roman} · ${phase.name}` : `Fase ${roman}`;
    populateSessions(db);
  }

  $trainDate.value = workout.date;
  $trainSession.value = workout.session;
  $trainNotes.value = workout.notes || '';

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

  const dateStr = workout.date.slice(5).replace('-', '/');
  $prefillText.textContent = `✏️ Editando ${workout.session} (${dateStr})`;
  $prefillBanner.style.display = 'flex';

  $saveBtn.textContent = 'Guardar cambios';
}

export function cancelEdit(db) {
  clearEditState();
  loadSessionTemplate(db, true);
}

/** Programmatically select a session and expand the training form */
export function selectAndStartSession(sessionName, phaseKey, db) {
  cacheSelectors();
  const needPhaseSwitch = parseInt(phaseKey) !== db.phase;
  if (needPhaseSwitch) {
    db.phase = parseInt(phaseKey);
    saveDB(db);
    const phases = getAllPhases();
    const phase = phases.find(p => p.id === db.phase);
    const roman = ROMAN[db.phase - 1] || db.phase;
    document.getElementById('phaseName').textContent = phase ? `Fase ${roman} · ${phase.name}` : `Fase ${roman}`;
    populateSessions(db);
  }
  $trainSession.value = sessionName;
  _formExpanded = true;
  loadSessionTemplate(db, true);
}

/** Save or update a workout from the training form data */
export function saveWorkout(db) {
  const date = $trainDate.value;
  const session = $trainSession.value;
  const notes = $trainNotes.value;
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

  const hasAnyData = exData.some(e => e.sets.some(s => s.kg || s.reps));
  if (!hasAnyData) {
    toast('Introduce al menos un dato antes de guardar', 'error');
    return;
  }

  const wasEditing = !!editingId;
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
    $prList.innerHTML = prs.map(p =>
      `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,85,255,.06);border-radius:var(--radius);margin-bottom:6px">
        <div style="font-size:.75rem;font-weight:700;color:var(--accent);flex:1">${esc(p.exercise)}</div>
        <div style="font-size:.7rem;color:var(--text3);text-decoration:line-through">${p.prevKg > 0 ? p.prevKg + 'kg' : '—'}</div>
        <div style="font-size:.85rem;font-weight:800;color:var(--green)">${p.kg}kg</div>
      </div>`
    ).join('');
    $prCelebration.style.display = 'flex';
  }

  $trainNotes.value = '';
  clearDraft();
  _formExpanded = false;
  loadSessionTemplate(db, true);
  toast(wasEditing ? 'Cambios guardados' : 'Sesión guardada');
}

// ── Set completion helpers ────────────────────────────────

function _markSetDone(label) {
  if (!label.dataset.original) label.dataset.original = label.textContent;
  label.classList.add('set-done');
  label.classList.remove('active-set');
  label.textContent = '✓';
  _updateActiveSet(label.closest('.sets-grid'));
}

function _unmarkSetDone(label) {
  label.classList.remove('set-done');
  label.textContent = label.dataset.original || `S${(parseInt(label.dataset.set) || 0) + 1}`;
  _updateActiveSet(label.closest('.sets-grid'));
}

function _updateActiveSet(grid) {
  if (!grid) return;
  const labels = grid.querySelectorAll('.set-label');
  let found = false;
  labels.forEach(l => {
    l.classList.remove('active-set');
    if (!found && !l.classList.contains('set-done')) {
      l.classList.add('active-set');
      found = true;
    }
  });
}

/** Initialize training section: cache selectors and bind events */
export function initTraining(db, { onCancelEdit }) {
  cacheSelectors();

  $exerciseList.addEventListener('input', (e) => {
    e.target.classList.remove('prefilled');
    scheduleDraft();
  }, true);
  // Auto-mark set done when both kg+reps filled (no prefill case)
  $exerciseList.addEventListener('blur', (e) => {
    const inp = e.target;
    if (!inp.matches('input[data-field]')) return;
    if (inp.classList.contains('prefilled')) return;
    const ex = inp.dataset.ex, set = inp.dataset.set;
    const kg = $exerciseList.querySelector(`[data-ex="${ex}"][data-set="${set}"][data-field="kg"]`);
    const reps = $exerciseList.querySelector(`[data-ex="${ex}"][data-set="${set}"][data-field="reps"]`);
    if (kg?.value && reps?.value) {
      const label = $exerciseList.querySelector(`.set-label[data-ex="${ex}"][data-set="${set}"]`);
      if (label && !label.classList.contains('set-done')) {
        _markSetDone(label);
      }
    }
  }, true);
  // Tap on set label to toggle done (essential for prefill case)
  $exerciseList.addEventListener('click', (e) => {
    const label = e.target.closest('.set-label');
    if (!label) return;
    if (label.classList.contains('set-done')) {
      _unmarkSetDone(label);
    } else {
      _markSetDone(label);
    }
    scheduleDraft();
  });
  $trainNotes.addEventListener('input', scheduleDraft);
  $trainSession.addEventListener('change', () => { clearDraft(); _formExpanded = false; loadSessionTemplate(db, true); });
  $saveBtn.addEventListener('click', () => saveWorkout(db));
  $prefillBanner.addEventListener('click', (e) => {
    if (e.target.closest('.prefill-clear')) {
      onCancelEdit();
      clearPrefill();
    }
  });
  $prCelebration.addEventListener('click', function () { this.style.display = 'none'; });

  // Exercise timer event delegation
  initExTimerEvents($exerciseList, (exIdx) => {
    const progs = getPrograms();
    const session = $trainSession.value;
    const exercises = progs[db.phase]?.sessions[session];
    return exercises?.[exIdx] || null;
  });
}
