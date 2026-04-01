// ── Exercise inline timer ────────────────────────────────
import { esc } from '../utils.js';
import { playAlarm } from './timer.js';
import { beep, vibrate, getAudioCtx } from './audio.js';

let activeExTimer = null;
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

function exBeepWork() { beep(1200, 150); setTimeout(() => beep(1200, 150), 200); vibrate([200, 100, 200]); }
function exBeepRest() { beep(440, 500); vibrate(500); }
function exBeepDone() { playAlarm(); vibrate([200, 100, 200, 100, 400]); }

export function exFmtTime(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function parseDurationStr(str) {
  if (!str) return 0;
  const s = str.toLowerCase().replace(/\s/g, '');
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
  // result (structured HIIT) — guided rounds with checklist
  if (ex.exercises && ex.exercises.length > 0) {
    return {
      type: 'hiit-rounds',
      exercises: ex.exercises,
      rounds: ex.rounds || 1,
      restDuration: parseDurationStr(ex.rest)
    };
  }
  // result (HIIT) — stopwatch
  return { phases: [], totalRounds: 0, type: 'stopwatch' };
}

function renderExTimerUI(zone) {
  if (!activeExTimer) return;
  const { config } = activeExTimer;
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
  } else if (t === 'hiit-rounds') {
    const { exercises, rounds } = config;
    const exItems = exercises.map((e, idx) => {
      const repsLabel = e.duration ? e.duration : (e.perSide ? `${e.reps}×c/lado` : `${e.reps}`);
      const cls = idx === 0 ? ' active' : '';
      return `<div class="hiit-ex-item${cls}" data-ex-item="${idx}"><span class="hiit-ex-name">${esc(e.name)}</span><span class="hiit-ex-reps">${repsLabel}</span></div>`;
    }).join('');
    zone.innerHTML = `<div class="ex-timer neutral">
      <div class="ex-timer-phase">RONDA 1 / ${rounds}</div>
      <div class="ex-timer-display">0:00</div>
      <div class="hiit-ex-list">${exItems}</div>
      <div class="ex-timer-actions">
        <button class="hiit-ex-btn">Hecho (1/${exercises.length})</button>
        <button class="ex-timer-stop">Parar</button>
      </div>
    </div>`;
    activeExTimer.hiitCurrentRound = 1;
    activeExTimer.hiitCurrentExIdx = 0;
  } else {
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

    if (remaining <= 3 && remaining > 0 && remaining !== lastBeepSec) {
      lastBeepSec = remaining;
      beep(660 + (3 - remaining) * 220, 100);
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
      beep(660 + (3 - remaining) * 220, 100);
    }

    if (remaining <= 0) {
      stopExTimer(true);
    }
  }
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

  if (newPhase.type === 'work') exBeepWork();
  else exBeepRest();

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

export function isExTimerActive() { return activeExTimer !== null; }

export function startExTimer(exIdx, mode, ex) {
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
  getAudioCtx().resume();

  if (config.type === 'phased' && config.phases[0]?.type === 'work') {
    exBeepWork();
  }
  if (config.type === 'hiit-rounds') {
    document.body.classList.add('hiit-focus');
    exBeepWork();
  }
}

export function stopExTimer(completed) {
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
      } else if (activeExTimer.config.type === 'hiit-rounds') {
        input.value = exFmtTime(totalElapsed);
      } else if (activeExTimer.config.type === 'countdown-manual' || activeExTimer.config.type === 'manual-rounds') {
        if (activeExTimer.roundCount > 0) input.value = activeExTimer.roundCount;
      }
      input.classList.add('prefilled');
    }
    exBeepDone();
  }

  const wasHiitRounds = activeExTimer.config.type === 'hiit-rounds';
  const hiitElapsed = wasHiitRounds ? Math.floor((Date.now() - activeExTimer.startedAt) / 1000) : 0;
  const hiitRounds = wasHiitRounds ? activeExTimer.config.rounds : 0;

  if (zone) {
    if (completed && wasHiitRounds) {
      zone.innerHTML = `<div class="ex-timer hiit-done">
        <div class="ex-timer-phase">Completado</div>
        <div class="ex-timer-display">${exFmtTime(hiitElapsed)}</div>
        <div class="ex-timer-round">${hiitRounds} rondas</div>
      </div>`;
    } else {
      zone.innerHTML = '';
    }
  }
  if (btn) btn.style.display = '';
  if (wasHiitRounds) document.body.classList.remove('hiit-focus');
  activeExTimer = null;
  lastBeepSec = -1;
  releaseWakeLock();
}

export function handleExTimerRound() {
  if (!activeExTimer) return;
  activeExTimer.roundCount++;
  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  if (!zone) return;
  const roundEl = zone.querySelector('.ex-timer-round strong');
  if (roundEl) roundEl.textContent = activeExTimer.roundCount;

  beep(1000, 100);
  vibrate(100);

  if (activeExTimer.config.type === 'manual-rounds' && activeExTimer.config.restDuration > 0) {
    const { totalRounds, restDuration } = activeExTimer.config;
    if (totalRounds > 0 && activeExTimer.roundCount >= totalRounds) {
      stopExTimer(true);
      return;
    }
    activeExTimer.resting = true;
    startRestCountdown(zone, restDuration);
  }
}

function startRestCountdown(zone, duration, onComplete) {
  if (!activeExTimer) return;
  const timer = zone.querySelector('.ex-timer');
  if (timer) {
    timer.className = 'ex-timer rest';
    const phaseEl = timer.querySelector('.ex-timer-phase');
    if (phaseEl) phaseEl.textContent = 'Descanso';
    const listEl = timer.querySelector('.hiit-ex-list');
    if (listEl) listEl.style.display = 'none';
    const hiitBtn = timer.querySelector('.hiit-ex-btn');
    if (hiitBtn) hiitBtn.style.display = 'none';
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
      beep(660 + (3 - remaining) * 220, 100);
    }

    if (remaining <= 0) {
      clearInterval(restInterval);
      lastBeepSec = -1;
      exBeepWork();
      if (timer) {
        timer.className = 'ex-timer neutral';
        const phaseEl = timer.querySelector('.ex-timer-phase');
        if (phaseEl) phaseEl.textContent = 'Circuito';
        const listEl = timer.querySelector('.hiit-ex-list');
        if (listEl) listEl.style.display = '';
        const hiitBtn = timer.querySelector('.hiit-ex-btn');
        if (hiitBtn) hiitBtn.style.display = '';
      }
      if (activeExTimer) activeExTimer.resting = false;
      if (onComplete) onComplete();
    }
  }, 250);
}

function _updateHiitUI(zone) {
  if (!activeExTimer) return;
  const { config, hiitCurrentRound, hiitCurrentExIdx } = activeExTimer;
  const { exercises, rounds } = config;

  const phaseEl = zone.querySelector('.ex-timer-phase');
  if (phaseEl) phaseEl.textContent = `RONDA ${hiitCurrentRound} / ${rounds}`;

  zone.querySelectorAll('.hiit-ex-item').forEach((el, idx) => {
    el.className = 'hiit-ex-item' +
      (idx < hiitCurrentExIdx ? ' done' : '') +
      (idx === hiitCurrentExIdx ? ' active' : '');
  });

  const btn = zone.querySelector('.hiit-ex-btn');
  if (btn) btn.textContent = `Hecho (${hiitCurrentExIdx + 1}/${exercises.length})`;
}

function handleHiitExDone() {
  if (!activeExTimer || activeExTimer.config.type !== 'hiit-rounds') return;
  const { config } = activeExTimer;
  const { exercises, rounds, restDuration } = config;
  const zone = document.querySelector(`.ex-timer-zone[data-ex="${activeExTimer.exIdx}"]`);
  if (!zone) return;

  activeExTimer.hiitCurrentExIdx++;

  if (activeExTimer.hiitCurrentExIdx >= exercises.length) {
    // Round complete
    if (activeExTimer.hiitCurrentRound >= rounds) {
      // All rounds done
      stopExTimer(true);
      return;
    }
    activeExTimer.hiitCurrentRound++;
    activeExTimer.hiitCurrentExIdx = 0;
    beep(1000, 150); vibrate([100, 50, 100]);

    if (restDuration > 0) {
      activeExTimer.resting = true;
      startRestCountdown(zone, restDuration, () => {
        _updateHiitUI(zone);
      });
    } else {
      _updateHiitUI(zone);
    }
  } else {
    _updateHiitUI(zone);
  }
}

/** Initialize timer event delegation on the exercise list */
export function initExTimerEvents($exerciseList, getExercise) {
  $exerciseList.addEventListener('click', (e) => {
    const timerBtn = e.target.closest('.ex-timer-btn');
    if (timerBtn) {
      const exIdx = parseInt(timerBtn.dataset.exTimer);
      const mode = timerBtn.dataset.timerMode;
      const ex = getExercise(exIdx);
      if (ex) startExTimer(exIdx, mode, ex);
      return;
    }
    const stopBtn = e.target.closest('.ex-timer-stop');
    if (stopBtn) { stopExTimer(false); return; }
    const roundBtn = e.target.closest('.ex-timer-round-btn');
    if (roundBtn) { handleExTimerRound(); return; }
    const hiitExBtn = e.target.closest('.hiit-ex-btn');
    if (hiitExBtn) { handleHiitExDone(); return; }
  });

  document.addEventListener('touchstart', function u() {
    getAudioCtx().resume();
    document.removeEventListener('touchstart', u);
  }, { once: true });
}
