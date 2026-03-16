import { saveDB } from '../data.js';
import { ROMAN } from '../constants.js';
import { getPrograms, getActiveProgram, getAllPhases } from '../programs.js';
import { esc } from '../utils.js';
import { toast } from './toast.js';
import { playAlarm } from './timer.js';

let editingId = null;
let $exerciseList, $trainSession, $trainDate, $trainNotes, $prefillBanner, $prefillText, $saveBtn, $prCelebration, $prList;

// --- Exercise inline timer state ---
let activeExTimer = null;
let exAudioCtx = null;
let lastBeepSec = -1;
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function getExAudioCtx() {
  if (!exAudioCtx) exAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return exAudioCtx;
}

function exBeep(freq = 880, ms = 200) {
  try {
    const ctx = getExAudioCtx(), now = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + ms / 1000);
    o.start(now); o.stop(now + ms / 1000);
  } catch (e) { }
}

function exVibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function exBeepWork() { exBeep(1200, 150); setTimeout(() => exBeep(1200, 150), 200); exVibrate([200, 100, 200]); }
function exBeepRest() { exBeep(440, 500); exVibrate(500); }
function exBeepDone() { playAlarm(); exVibrate([200, 100, 200, 100, 400]); }

export function exFmtTime(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function parseDurationStr(str) {
  if (!str) return 0;
  const s = str.toLowerCase().replace(/\s/g, '');
  // "4min" → 240, "30s" → 30, "1h" → 3600, "1h30" → 5400, "10min" → 600
  let total = 0;
  const hm = s.match(/(\d+)h/); if (hm) total += parseInt(hm[1]) * 3600;
  const mm = s.match(/(\d+)min/); if (mm) total += parseInt(mm[1]) * 60;
  const sm = s.match(/(\d+)s(?!e)/); if (sm) total += parseInt(sm[1]);
  if (total === 0) total = parseInt(s) || 0;
  return total;
}

export function buildTimerConfig(mode, ex) {
  if (mode === 'interval') {
    const onSec = parseDurationStr(ex.on);
    const offSec = parseDurationStr(ex.off);
    const totalSec = parseDurationStr(ex.duration);
    const roundDur = onSec + offSec;
    const rounds = roundDur > 0 ? Math.ceil(totalSec / roundDur) : 1;
    const phases = [];
    for (let r = 0; r < rounds; r++) {
      phases.push({ type: 'work', duration: onSec, label: ex.name, round: r + 1 });
      phases.push({ type: 'rest', duration: offSec, label: 'Descanso', round: r + 1 });
    }
    return { phases, totalRounds: rounds, type: 'phased' };
  }
  if (mode === 'tabata') {
    const rounds = ex.rounds || [];
    const phases = [];
    for (let r = 0; r < 8; r++) {
      phases.push({ type: 'work', duration: 20, label: rounds[r] || ex.name, round: r + 1 });
      if (r < 7) phases.push({ type: 'rest', duration: 10, label: 'Descanso', round: r + 1 });
    }
    return { phases, totalRounds: 8, type: 'phased' };
  }
  if (mode === 'emom') {
    const totalSec = parseDurationStr(ex.duration);
    const totalMin = Math.max(1, Math.floor(totalSec / 60));
    const phases = [];
    for (let m = 0; m < totalMin; m++) {
      phases.push({ type: 'work', duration: 60, label: `Minuto ${m + 1}`, round: m + 1 });
    }
    return { phases, totalRounds: totalMin, type: 'phased' };
  }
  if (mode === 'amrap') {
    const totalSec = parseDurationStr(ex.duration);
    return { phases: [{ type: 'neutral', duration: totalSec, label: ex.name, round: 1 }], totalRounds: 0, type: 'countdown-manual' };
  }
  if (mode === 'rounds') {
    const restSec = parseDurationStr(ex.rest);
    const count = ex.count || 0;
    return { phases: [], totalRounds: count, restDuration: restSec, type: 'manual-rounds' };
  }
  // result (HIIT) — stopwatch
  return { phases: [], totalRounds: 0, type: 'stopwatch' };
}

function renderExTimerUI(zone) {
  if (!activeExTimer) return;
  const { config, mode } = activeExTimer;
  const t = config.type;

  if (t === 'phased') {
    const phase = config.phases[activeExTimer.phaseIdx];
    const cls = phase.type;
    zone.innerHTML = `<div class="ex-timer ${cls}">
      <div class="ex-timer-phase">${phase.type === 'work' ? 'Work' : 'Rest'}</div>
      <div class="ex-timer-display">${exFmtTime(phase.duration)}</div>
      <div class="ex-timer-round">R${phase.round} / ${config.totalRounds}</div>
      <div class="ex-timer-label">${esc(phase.label)}</div>
      <div class="ex-timer-bar"><div class="ex-timer-bar-fill" style="width:100%"></div></div>
      <div class="ex-timer-actions"><button class="ex-timer-stop">Parar</button></div>
    </div>`;
  } else if (t === 'countdown-manual') {
    const phase = config.phases[0];
    zone.innerHTML = `<div class="ex-timer neutral">
      <div class="ex-timer-phase">AMRAP</div>
      <div class="ex-timer-display">${exFmtTime(phase.duration)}</div>
      <div class="ex-timer-round">Rondas: <strong>0</strong></div>
      <div class="ex-timer-bar"><div class="ex-timer-bar-fill" style="width:100%"></div></div>
      <div class="ex-timer-actions"><button class="ex-timer-round-btn">Ronda ✓</button><button class="ex-timer-stop">Parar</button></div>
    </div>`;
  } else if (t === 'manual-rounds') {
    zone.innerHTML = `<div class="ex-timer neutral">
      <div class="ex-timer-phase">Circuito</div>
      <div class="ex-timer-display">0:00</div>
      <div class="ex-timer-round">Rondas: <strong>0</strong>${config.totalRounds > 0 ? ` / ${config.totalRounds}` : ''}</div>
      <div class="ex-timer-actions"><button class="ex-timer-round-btn">Ronda ✓</button><button class="ex-timer-stop">Parar</button></div>
    </div>`;
  } else {
    // stopwatch
    zone.innerHTML = `<div class="ex-timer neutral">
      <div class="ex-timer-phase">Tiempo</div>
      <div class="ex-timer-display">0:00</div>
      <div class="ex-timer-actions"><button class="ex-timer-stop">Parar</button></div>
    </div>`;
  }
}

function updateExTimerDisplay() {
  if (!activeExTimer) return;
  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  if (!zone) return;
  const display = zone.querySelector('.ex-timer-display');
  const barFill = zone.querySelector('.ex-timer-bar-fill');
  if (!display) return;

  const { config } = activeExTimer;
  const t = config.type;

  if (t === 'phased') {
    const phase = config.phases[activeExTimer.phaseIdx];
    if (!phase) return;
    const elapsed = Math.floor((Date.now() - activeExTimer.phaseStartedAt) / 1000);
    const remaining = Math.max(0, phase.duration - elapsed);
    display.textContent = exFmtTime(remaining);
    if (barFill) barFill.style.width = `${(remaining / phase.duration) * 100}%`;
  } else if (t === 'countdown-manual') {
    const phase = config.phases[0];
    const elapsed = Math.floor((Date.now() - activeExTimer.startedAt) / 1000);
    const remaining = Math.max(0, phase.duration - elapsed);
    display.textContent = exFmtTime(remaining);
    if (barFill) barFill.style.width = `${(remaining / phase.duration) * 100}%`;
  } else {
    // stopwatch / manual-rounds — skip display while rest countdown owns it
    if (activeExTimer.resting) return;
    const elapsed = Math.floor((Date.now() - activeExTimer.startedAt) / 1000);
    display.textContent = exFmtTime(elapsed);
  }
}

function tickExTimer() {
  if (!activeExTimer) return;
  const { config } = activeExTimer;
  const t = config.type;

  updateExTimerDisplay();

  if (t === 'phased') {
    const phase = config.phases[activeExTimer.phaseIdx];
    if (!phase) return;
    const elapsed = Math.floor((Date.now() - activeExTimer.phaseStartedAt) / 1000);
    const remaining = phase.duration - elapsed;

    // Countdown beeps at 3, 2, 1
    if (remaining <= 3 && remaining > 0 && remaining !== lastBeepSec) {
      lastBeepSec = remaining;
      exBeep(660 + (3 - remaining) * 220, 100);
    }

    if (remaining <= 0) {
      advanceExPhase();
    }
  } else if (t === 'countdown-manual') {
    const phase = config.phases[0];
    const elapsed = Math.floor((Date.now() - activeExTimer.startedAt) / 1000);
    const remaining = phase.duration - elapsed;

    if (remaining <= 3 && remaining > 0 && remaining !== lastBeepSec) {
      lastBeepSec = remaining;
      exBeep(660 + (3 - remaining) * 220, 100);
    }

    if (remaining <= 0) {
      stopExTimer(true);
    }
  }
  // stopwatch and manual-rounds just keep running
}

function advanceExPhase() {
  if (!activeExTimer) return;
  const { config } = activeExTimer;
  activeExTimer.phaseIdx++;
  lastBeepSec = -1;

  if (activeExTimer.phaseIdx >= config.phases.length) {
    stopExTimer(true);
    return;
  }

  const newPhase = config.phases[activeExTimer.phaseIdx];
  activeExTimer.phaseStartedAt = Date.now();

  // Audio/haptic feedback
  if (newPhase.type === 'work') exBeepWork();
  else exBeepRest();

  // Update UI classes and content
  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  if (!zone) return;
  const timer = zone.querySelector('.ex-timer');
  if (timer) {
    timer.className = `ex-timer ${newPhase.type}`;
    const phaseEl = timer.querySelector('.ex-timer-phase');
    if (phaseEl) phaseEl.textContent = newPhase.type === 'work' ? 'Work' : 'Rest';
    const roundEl = timer.querySelector('.ex-timer-round');
    if (roundEl) roundEl.textContent = `R${newPhase.round} / ${config.totalRounds}`;
    const labelEl = timer.querySelector('.ex-timer-label');
    if (labelEl) labelEl.textContent = newPhase.label;
  }
}

function startExTimer(exIdx, mode, ex) {
  if (activeExTimer) stopExTimer(false);

  const zone = document.querySelector(`.ex-timer-zone[data-ex="${exIdx}"]`);
  const btn = document.querySelector(`[data-ex-timer="${exIdx}"]`);
  if (!zone) return;
  if (btn) btn.style.display = 'none';

  const config = buildTimerConfig(mode, ex);

  activeExTimer = {
    exIdx, mode, config,
    startedAt: Date.now(),
    phaseIdx: 0,
    phaseStartedAt: Date.now(),
    roundCount: 0,
    interval: setInterval(tickExTimer, 250)
  };
  lastBeepSec = -1;

  renderExTimerUI(zone);
  requestWakeLock();

  // Resume audio context on user gesture
  if (exAudioCtx) exAudioCtx.resume();

  // Initial beep for phased work start
  if (config.type === 'phased' && config.phases[0]?.type === 'work') {
    exBeepWork();
  }
}

function stopExTimer(completed) {
  if (!activeExTimer) return;
  clearInterval(activeExTimer.interval);

  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  const btn = document.querySelector(`[data-ex-timer="${activeExTimer.exIdx}"]`);

  if (completed) {
    const input = document.querySelector(`[data-ex="${activeExTimer.exIdx}"][data-set="0"][data-field="reps"]`);
    if (input && !input.value) {
      const totalElapsed = Math.floor((Date.now() - activeExTimer.startedAt) / 1000);
      if (activeExTimer.config.type === 'stopwatch') {
        input.value = exFmtTime(totalElapsed);
      } else if (activeExTimer.config.type === 'countdown-manual' || activeExTimer.config.type === 'manual-rounds') {
        if (activeExTimer.roundCount > 0) input.value = activeExTimer.roundCount;
      }
      input.classList.add('prefilled');
    }
    exBeepDone();
  }

  if (zone) zone.innerHTML = '';
  if (btn) btn.style.display = '';
  activeExTimer = null;
  lastBeepSec = -1;
  releaseWakeLock();
}

function handleExTimerRound() {
  if (!activeExTimer) return;
  activeExTimer.roundCount++;
  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  if (!zone) return;
  const roundEl = zone.querySelector('.ex-timer-round strong');
  if (roundEl) roundEl.textContent = activeExTimer.roundCount;

  exBeep(1000, 100);
  exVibrate(100);

  // For manual-rounds with rest: start rest countdown
  if (activeExTimer.config.type === 'manual-rounds' && activeExTimer.config.restDuration > 0) {
    const { totalRounds, restDuration } = activeExTimer.config;
    if (totalRounds > 0 && activeExTimer.roundCount >= totalRounds) {
      stopExTimer(true);
      return;
    }
    // Show rest countdown inline — set flag so tickExTimer skips display
    activeExTimer.resting = true;
    startRestCountdown(zone, restDuration);
  }
}

function startRestCountdown(zone, duration) {
  if (!activeExTimer) return;
  const timer = zone.querySelector('.ex-timer');
  if (timer) {
    timer.className = 'ex-timer rest';
    const phaseEl = timer.querySelector('.ex-timer-phase');
    if (phaseEl) phaseEl.textContent = 'Descanso';
  }

  const restStart = Date.now();
  const restInterval = setInterval(() => {
    if (!activeExTimer) { clearInterval(restInterval); return; }
    const elapsed = Math.floor((Date.now() - restStart) / 1000);
    const remaining = Math.max(0, duration - elapsed);
    const display = zone.querySelector('.ex-timer-display');
    if (display) display.textContent = exFmtTime(remaining);

    if (remaining <= 3 && remaining > 0 && remaining !== lastBeepSec) {
      lastBeepSec = remaining;
      exBeep(660 + (3 - remaining) * 220, 100);
    }

    if (remaining <= 0) {
      clearInterval(restInterval);
      lastBeepSec = -1;
      exBeepWork();
      if (timer) {
        timer.className = 'ex-timer neutral';
        const phaseEl = timer.querySelector('.ex-timer-phase');
        if (phaseEl) phaseEl.textContent = 'Circuito';
      }
      // Resume stopwatch display
      if (activeExTimer) activeExTimer.resting = false;
    }
  }, 250);
}

// --- end exercise timer ---

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
  const lastW = db.workouts.filter(w => w.phase === db.phase && (w.program || 'barraLibre') === prog).sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (lastW && ss.length > 1) {
    const lastIdx = ss.indexOf(lastW.session);
    const nextIdx = (lastIdx + 1) % ss.length;
    $trainSession.value = ss[nextIdx];
  }
  loadSessionTemplate(db, true);
}

/** Render exercise cards for the selected session template */
export function loadSessionTemplate(db, autoPrefill) {
  if (activeExTimer) stopExTimer(false);
  clearEditState();
  const session = $trainSession.value;
  const progs = getPrograms();
  if (!progs[db.phase]) return;
  const exercises = progs[db.phase].sessions[session];
  if (!exercises) return;
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
    sh += `<div class="set-label">S${s + 1}</div><input type="number" class="${cK}" data-ex="${i}" data-set="${s}" data-field="kg" placeholder="${pK || '—'}" value="${vK}" step="0.5"><input type="text" class="${cR}" data-ex="${i}" data-set="${s}" data-field="reps" placeholder="${pR || ex.reps}" value="${vR}" inputmode="numeric">`;
  }
  sh += '</div>';
  const pi = prevEx ? `<div class="prev-data">Anterior: ${prevEx.sets.map(s => `<span>${s.kg || '—'}×${s.reps || '—'}</span>`).join(' · ')}</div>` : '';
  return `<div class="ex-card"><div class="ex-name">${esc(ex.name)}</div><div class="ex-target">${ex.sets}×${ex.reps}${ex.type === 'extra' ? ' (extra)' : ''}</div>${sh}${pi}</div>`;
}

function renderResultCard(ex, i, prevEx, shouldPrefill, exType) {
  const pv = shouldPrefill && prevEx ? prevEx.sets[0]?.reps || '' : '';
  const cp = pv ? ' prefilled' : '';
  const pi = prevEx ? `<div class="prev-data">Anterior: <span>${prevEx.sets[0]?.reps || '—'}</span></div>` : '';
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
  const f = db.workouts.filter(w => w.session === n && w.phase === db.phase && (w.program || 'barraLibre') === prog);
  return f.length ? f[f.length - 1] : null;
}

/** Get highest kg ever lifted for an exercise */
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

/** Pre-fill the training form for editing an existing workout */
export function startEdit(workout, db) {
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
  loadSessionTemplate(db, true);
  toast(wasEditing ? 'Cambios guardados' : 'Sesión guardada');
}

/** Initialize training section: cache selectors and bind events */
export function initTraining(db, { onCancelEdit }) {
  cacheSelectors();

  $exerciseList.addEventListener('input', (e) => {
    e.target.classList.remove('prefilled');
  }, true);
  $trainSession.addEventListener('change', () => loadSessionTemplate(db, true));
  $saveBtn.addEventListener('click', () => saveWorkout(db));
  $prefillBanner.addEventListener('click', (e) => {
    if (e.target.closest('.prefill-clear')) {
      onCancelEdit();
      clearPrefill();
    }
  });
  $prCelebration.addEventListener('click', function () { this.style.display = 'none'; });

  // Exercise timer event delegation
  $exerciseList.addEventListener('click', (e) => {
    const timerBtn = e.target.closest('.ex-timer-btn');
    if (timerBtn) {
      const exIdx = parseInt(timerBtn.dataset.exTimer);
      const mode = timerBtn.dataset.timerMode;
      const progs = getPrograms();
      const session = $trainSession.value;
      const exercises = progs[db.phase]?.sessions[session];
      if (exercises && exercises[exIdx]) {
        startExTimer(exIdx, mode, exercises[exIdx]);
      }
      return;
    }
    const stopBtn = e.target.closest('.ex-timer-stop');
    if (stopBtn) { stopExTimer(false); return; }
    const roundBtn = e.target.closest('.ex-timer-round-btn');
    if (roundBtn) { handleExTimerRound(); return; }
  });

  // Unlock audio context on first touch
  document.addEventListener('touchstart', function u() {
    if (exAudioCtx) exAudioCtx.resume();
    else exAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    document.removeEventListener('touchstart', u);
  }, { once: true });
}
