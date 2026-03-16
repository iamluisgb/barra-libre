import { saveDB, markDeleted } from '../data.js';
import { getRunningProgramList, getRunningPhases } from '../programs.js';
import { safeNum, esc, confirmDanger, formatDate, today } from '../utils.js';
import { toast } from './toast.js';
import { GpsTracker } from './running-tracker.js';
import { beep, vibrate, startCountdown, beepSplit, beepWorkStart, beepRestStart, beepAllDone, beepSegmentChange } from './running-audio.js';
import { ZONE_COLORS, ZONE_LABELS, getPaceZones, RUN_TYPE_META, formatPace, formatRunDuration, parseRunDuration, estimateZone, parseSegDistance, parseSegDuration, segModeToRunType } from './running-helpers.js';
import { renderRunHistory as _renderRunHistory, shareRunCard } from './running-history.js';
import { renderRunProgress as _renderRunProgress } from './running-progress.js';
import { populateRunWeeks as _populateRunWeeks, populateRunSessions as _populateRunSessions, loadRunSessionTemplate as _loadRunSessionTemplate, inferRunType, populateSumSessionSelect, updateRunContextBar, renderRunProgramModal, renderRunWeekModal, setOnStartSession } from './running-plan.js';

// Re-export for backward compatibility
export { formatPace, formatRunDuration, parseRunDuration, parseSegDuration, segModeToRunType };

// ── Active run persistence (survive reload) ──────────────

const RUN_SAVE_KEY = 'barra-libre-activeRun';
let _lastSaveTime = 0;

function saveActiveRun() {
  // Throttle: save at most every 5 seconds
  const now = Date.now();
  if (now - _lastSaveTime < 5000) return;
  _lastSaveTime = now;

  try {
    const snap = {
      tracker: tracker.serialize(),
      activeRunType,
      activeSegments,
      activePlanSession,
      targetDistance,
      intervalState,
      sessionState,
      savedAt: now,
    };
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(snap));
  } catch (e) {
    // localStorage full or unavailable — ignore silently
  }
}

function clearActiveRun() {
  localStorage.removeItem(RUN_SAVE_KEY);
}

function getActiveRunSnap() {
  try {
    const raw = localStorage.getItem(RUN_SAVE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // Discard if older than 12 hours
    if (Date.now() - snap.savedAt > 12 * 3600 * 1000) {
      clearActiveRun();
      return null;
    }
    return snap;
  } catch (e) {
    return null;
  }
}

// ── State ────────────────────────────────────────────────

let editingId = null;
const tracker = new GpsTracker();
let liveMap = null;
let livePolyline = null;
let liveMarker = null;
let summaryMap = null;
let detailMap = null;

// Run type state
let activeRunType = 'libre';
let activeSegments = null;   // segments from plan session (guided mode)
let activePlanSession = '';  // session name from plan (for summary pre-fill)
let targetDistance = 0;       // for competicion mode
let intervalState = null;     // { rep, totalReps, isWork, segIdx, phaseStartDist, phaseStartTime, countdownStarted }
let sessionState = null;      // { currentIdx, segStartTime, segStartDist, segDurations, completed, countdownFired }

// ── DOM refs ─────────────────────────────────────────────

let $overlay, $liveScreen, $summaryScreen;
let $liveTimer, $liveDist, $livePace, $liveSplits, $liveMap, $liveStatus;
let $pauseBtn, $stopBtn, $lockBtn, $autoPauseBtn;
let $goalCard, $goalBody, $goalArc, $goalCurrent, $goalUnit, $goalTarget, $goalSessions;
let $prsGrid;
let $weekSelect, $sessionSelect, $segments;
let $historyFilter, $historyList;
let $weeklyChart, $paceChart, $statsPanel;
let $typePanel, $typeBadge;

function cacheSelectors() {
  $overlay = document.getElementById('runTrackingOverlay');
  $liveScreen = document.getElementById('runLiveScreen');
  $summaryScreen = document.getElementById('runSummaryScreen');
  $liveTimer = document.getElementById('runLiveTimer');
  $liveDist = document.getElementById('runLiveDist');
  $livePace = document.getElementById('runLivePace');
  $liveSplits = document.getElementById('runLiveSplits');
  $liveMap = document.getElementById('runLiveMap');
  $liveStatus = document.getElementById('runLiveStatus');
  $pauseBtn = document.getElementById('runPauseBtn');
  $stopBtn = document.getElementById('runStopBtn');
  $lockBtn = document.getElementById('runLockBtn');
  $autoPauseBtn = document.getElementById('runAutoPauseBtn');
  $goalCard = document.getElementById('runGoalCard');
  $goalBody = document.getElementById('runGoalBody');
  $goalArc = document.getElementById('runGoalArc');
  $goalCurrent = document.getElementById('runGoalCurrent');
  $goalUnit = document.getElementById('runGoalUnit');
  $goalTarget = document.getElementById('runGoalTarget');
  $goalSessions = document.getElementById('runGoalSessions');
  $prsGrid = document.getElementById('runPrsGrid');
  $weekSelect = document.getElementById('runWeekSelect');
  $sessionSelect = document.getElementById('runSessionSelect');
  $segments = document.getElementById('runSegments');
  $historyFilter = document.getElementById('runHistoryFilter');
  $historyList = document.getElementById('runHistoryList');
  $weeklyChart = document.getElementById('runWeeklyChart');
  $paceChart = document.getElementById('runPaceChart');
  $statsPanel = document.getElementById('runStatsPanel');
  $typePanel = document.getElementById('runLiveTypePanel');
  $typeBadge = document.getElementById('runLiveTypeBadge');
}

// ── Init ─────────────────────────────────────────────────

export function initRunning(db) {
  cacheSelectors();

  // Wire plan session start callback
  setOnStartSession((segs, runType, sessionLabel, d) => {
    activeSegments = segs;
    activeRunType = runType;
    activePlanSession = sessionLabel;
    startGpsRun(d);
  });

  // Sub-nav tabs
  document.querySelectorAll('.run-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.run-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.run-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.run).classList.add('active');

      if (btn.dataset.run === 'runHistory') renderRunHistory(db);
      if (btn.dataset.run === 'runProgress') renderRunProgress(db);
      if (btn.dataset.run === 'runPlan') {
        populateRunWeeks(db);
      }
    });
  });

  // Start GPS run (via type picker)
  document.getElementById('runStartBtn').addEventListener('click', () => openRunTypePicker(db));
  document.getElementById('runTypeStartBtn').addEventListener('click', () => { closeRunTypePicker(); startGpsRun(db); });
  document.getElementById('runTypeCancelBtn').addEventListener('click', closeRunTypePicker);
  document.getElementById('runTypeGrid').addEventListener('click', e => {
    const card = e.target.closest('.run-type-card');
    if (!card) return;
    document.querySelectorAll('.run-type-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    activeRunType = card.dataset.type;
    // Show/hide extra inputs
    document.getElementById('runTypeExtra').style.display = activeRunType === 'competicion' ? '' : 'none';
    document.getElementById('runTypeTempoExtra').style.display = activeRunType === 'tempo' ? '' : 'none';
  });

  // Manual entry modal
  document.getElementById('runManualBtn').addEventListener('click', () => openManualModal(db));
  document.getElementById('runManualCloseBtn').addEventListener('click', () => closeManualModal(db));

  // Live tracking controls
  $pauseBtn.addEventListener('click', () => togglePause());
  $stopBtn.addEventListener('click', () => stopGpsRun(db));
  $lockBtn.addEventListener('click', () => toggleLock());
  $autoPauseBtn.addEventListener('click', () => toggleAutoPause());

  // Post-run summary
  document.getElementById('runSumSaveBtn').addEventListener('click', () => saveGpsRun(db));
  document.getElementById('runSumDiscardBtn').addEventListener('click', () => discardGpsRun());

  // Goal settings
  document.getElementById('runGoalSettingsBtn').addEventListener('click', () => openGoalModal(db));
  document.getElementById('runGoalSaveBtn').addEventListener('click', () => saveGoal(db));
  document.getElementById('runGoalCloseBtn').addEventListener('click', closeGoalModal);

  // Manual form: live pace calc
  const $distance = document.getElementById('runDistance');
  const $duration = document.getElementById('runDuration');
  const $paceDisplay = document.getElementById('runPaceDisplay');
  const calcPace = () => {
    const dist = parseFloat($distance.value);
    const dur = parseRunDuration($duration.value);
    if (dist > 0 && dur > 0) {
      $paceDisplay.textContent = `Ritmo: ${formatPace(dur / dist)} /km`;
      $paceDisplay.style.display = '';
    } else {
      $paceDisplay.style.display = 'none';
    }
  };
  $distance.addEventListener('input', calcPace);
  $duration.addEventListener('input', calcPace);

  // Manual form: save
  document.getElementById('runSaveBtn').addEventListener('click', () => saveManualLog(db));
  document.getElementById('runDeleteBtn').addEventListener('click', () => {
    confirmDanger(document.getElementById('runDeleteBtn'), () => deleteRunLog(db, editingId));
  });
  document.querySelector('.run-edit-cancel')?.addEventListener('click', () => cancelEdit(db));

  // Manual splits
  document.getElementById('runAddSplitBtn').addEventListener('click', addSplitInput);

  // History filter
  $historyFilter.addEventListener('change', () => renderRunHistory(db));

  // History list click delegation
  $historyList.addEventListener('click', e => {
    const card = e.target.closest('.run-history-card');
    if (!card) return;
    const id = parseInt(card.dataset.id);
    // Open detail modal on card click
    openRunDetail(id, db);
  });

  // Detail modal
  document.getElementById('runDetailCloseBtn').addEventListener('click', closeRunDetail);
  document.getElementById('runDetailEditBtn').addEventListener('click', () => {
    const id = parseInt(document.getElementById('runDetailModal').dataset.logId);
    closeRunDetail();
    startRunEdit(id, db);
  });
  document.getElementById('runDetailShareBtn').addEventListener('click', () => shareRunCard());
  document.getElementById('runDetailDeleteBtn').addEventListener('click', () => {
    const btn = document.getElementById('runDetailDeleteBtn');
    const id = parseInt(document.getElementById('runDetailModal').dataset.logId);
    confirmDanger(btn, () => {
      deleteRunLog(db, id);
      closeRunDetail();
    });
  });

  // Plan tab: week/session selectors
  $weekSelect.addEventListener('change', () => {
    db.runningWeek = parseInt($weekSelect.value) || 1;
    saveDB(db);
    populateRunSessions(db);
    updateRunContextBar(db);
  });
  $sessionSelect.addEventListener('change', () => loadRunSessionTemplate(db));

  // Running program context bar
  document.getElementById('runProgramContext').addEventListener('click', () => {
    renderRunProgramModal(db);
    document.getElementById('runProgramModal').classList.add('open');
  });
  document.getElementById('runProgramModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('runProgramModal'))
      document.getElementById('runProgramModal').classList.remove('open');
    const item = e.target.closest('[data-prog]');
    if (item) {
      db.runningProgram = item.dataset.prog;
      db.runningWeek = 1;
      saveDB(db);
      document.getElementById('runProgramModal').classList.remove('open');
      updateRunContextBar(db);
      populateRunWeeks(db);
    }
  });
  document.getElementById('runProgramModalClose').addEventListener('click', () =>
    document.getElementById('runProgramModal').classList.remove('open')
  );

  // Running week context bar
  document.getElementById('runWeekContext').addEventListener('click', () => {
    renderRunWeekModal(db);
    document.getElementById('runWeekModal').classList.add('open');
  });
  document.getElementById('runWeekModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('runWeekModal'))
      document.getElementById('runWeekModal').classList.remove('open');
    const item = e.target.closest('[data-week]');
    if (item) {
      db.runningWeek = parseInt(item.dataset.week);
      saveDB(db);
      document.getElementById('runWeekModal').classList.remove('open');
      updateRunContextBar(db);
      $weekSelect.value = item.dataset.week;
      populateRunSessions(db);
    }
  });
  document.getElementById('runWeekModalClose').addEventListener('click', () =>
    document.getElementById('runWeekModal').classList.remove('open')
  );

  // Tracker callbacks
  tracker.onUpdate(data => { updateLiveUI(data); saveActiveRun(); });
  tracker.onSplit(split => onSplitComplete(split));
  tracker.onError(msg => {
    toast(msg, 'error');
    if (tracker.state === 'idle') closeLiveOverlay();
  });
  tracker.onAutoPause(paused => {
    if (paused) {
      $liveStatus.textContent = 'AUTO-PAUSA';
      $liveStatus.classList.add('paused');
      vibrate([100, 50, 100]);
    } else {
      $liveStatus.textContent = 'EN CURSO';
      $liveStatus.classList.remove('paused');
      vibrate([100]);
    }
  });

  // Check for a previously interrupted run
  checkAndRestoreRun(db);
}

// ── Restore interrupted run ──────────────────────────────

function checkAndRestoreRun(db) {
  const snap = getActiveRunSnap();
  if (!snap || !snap.tracker) return;

  const elapsed = snap.tracker.elapsed || 0;
  const dist = snap.tracker.distance || 0;
  const ago = Math.round((Date.now() - snap.savedAt) / 60000);

  // Show a confirmation toast with restore/discard options
  const msg = `Carrera interrumpida (${formatRunDuration(Math.round(elapsed))}, ${dist.toFixed(2)} km, hace ${ago} min). ¿Recuperar?`;
  showRestorePrompt(msg, () => restoreRun(snap, db), () => clearActiveRun());
}

function showRestorePrompt(msg, onRestore, onDiscard) {
  const el = document.createElement('div');
  el.className = 'toast-restore';
  el.innerHTML = `<div class="toast-restore-msg">${msg}</div>
    <div class="toast-restore-actions">
      <button class="toast-restore-yes">Recuperar</button>
      <button class="toast-restore-no">Descartar</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));

  el.querySelector('.toast-restore-yes').addEventListener('click', () => {
    el.remove();
    onRestore();
  });
  el.querySelector('.toast-restore-no').addEventListener('click', () => {
    el.remove();
    onDiscard();
  });
}

function restoreRun(snap, db) {
  // Restore module-level state
  activeRunType = snap.activeRunType || 'libre';
  activeSegments = snap.activeSegments || null;
  activePlanSession = snap.activePlanSession || '';
  targetDistance = snap.targetDistance || 0;
  intervalState = snap.intervalState || null;
  sessionState = snap.sessionState || null;

  // Restore tracker
  const restored = tracker.restore(snap.tracker);
  if (!restored) { clearActiveRun(); return; }

  // Show overlay in correct state
  $overlay.classList.add('active');
  $liveScreen.style.display = '';
  $summaryScreen.style.display = 'none';
  document.querySelector('nav').style.display = 'none';

  // Set UI for current tracker state
  if (tracker.state === 'paused') {
    $pauseBtn.classList.add('paused');
    $liveStatus.textContent = 'EN PAUSA';
    $liveStatus.classList.add('paused');
  } else {
    $pauseBtn.classList.remove('paused');
    $liveStatus.textContent = 'EN CURSO';
    $liveStatus.classList.remove('paused');
  }

  $lockBtn.classList.toggle('wake-active', tracker.wakeLockActive);
  $autoPauseBtn.classList.toggle('active', tracker.autoPauseEnabled);

  // Set type badge
  const meta = RUN_TYPE_META[activeRunType];
  if (meta && activeRunType !== 'libre') {
    $typeBadge.textContent = meta.label;
    $typeBadge.style.background = meta.zone ? ZONE_COLORS[meta.zone] : 'var(--accent)';
    $typeBadge.classList.add('visible');
  } else {
    $typeBadge.classList.remove('visible');
  }

  // Restore splits UI
  $liveSplits.innerHTML = '';
  for (const split of tracker.splits) {
    const el = document.createElement('div');
    el.className = 'run-live-split';
    el.innerHTML = `<span class="run-live-split-km">Km ${split.km}</span><span class="run-live-split-pace">${formatPace(split.pace)} /km</span>`;
    $liveSplits.prepend(el);
  }

  // Restore live stats
  $liveTimer.textContent = formatRunDuration(Math.floor(tracker.elapsed));
  $liveDist.textContent = tracker.distance.toFixed(2);
  $livePace.textContent = tracker.avgPace > 0 ? formatPace(tracker.avgPace) : '--:--';

  // Restore session progress if applicable
  renderSessionProgress();

  // Init map
  initLiveMap();

  // Draw existing route on map
  if (liveMap && tracker.coords.length > 0) {
    setTimeout(() => {
      for (const c of tracker.coords) {
        if (livePolyline) livePolyline.addLatLng([c[0], c[1]]);
      }
      const last = tracker.coords[tracker.coords.length - 1];
      if (liveMarker) liveMarker.setLatLng([last[0], last[1]]);
      liveMap.setView([last[0], last[1]], liveMap.getZoom());
    }, 300);
  }

  toast('Carrera recuperada');
}

// ── Run type picker ──────────────────────────────────────

function openRunTypePicker(db) {
  const grid = document.getElementById('runTypeGrid');
  grid.innerHTML = Object.entries(RUN_TYPE_META).map(([key, meta]) => {
    const zoneHtml = meta.zone
      ? `<span class="run-type-card-zone" style="background:${ZONE_COLORS[meta.zone]}">${meta.zone}</span>`
      : '';
    return `<div class="run-type-card${key === activeRunType ? ' selected' : ''}" data-type="${key}">
      <div class="run-type-card-name">${meta.label}</div>
      <div class="run-type-card-desc">${meta.desc}</div>
      ${zoneHtml}
    </div>`;
  }).join('');
  document.getElementById('runTypeExtra').style.display = activeRunType === 'competicion' ? '' : 'none';
  document.getElementById('runTypeTempoExtra').style.display = activeRunType === 'tempo' ? '' : 'none';
  document.getElementById('runTypeModal').classList.add('open');
}

function closeRunTypePicker() {
  document.getElementById('runTypeModal').classList.remove('open');
}

// ── GPS Run lifecycle ────────────────────────────────────

function startGpsRun(db) {
  // Read extra inputs from type picker
  if (activeRunType === 'competicion') {
    targetDistance = parseFloat(document.getElementById('runTypeTargetDist').value) || 0;
  }
  if (activeRunType === 'tempo') {
    const paceStr = document.getElementById('runTypeTargetPace').value;
    targetDistance = parseRunDuration(paceStr); // reuse parser: "5:30" → 330 sec/km
  }

  // Reset interval state
  intervalState = null;

  const started = tracker.start();
  if (!started) return;

  // Show overlay
  $overlay.classList.add('active');
  $liveScreen.style.display = '';
  $summaryScreen.style.display = 'none';
  $liveTimer.textContent = '00:00';
  $liveDist.textContent = '0.00';
  $livePace.textContent = '--:--';
  $liveSplits.innerHTML = '';
  $typePanel.innerHTML = '';
  $liveStatus.textContent = 'EN CURSO';
  $liveStatus.classList.remove('paused');
  $pauseBtn.classList.remove('paused');
  $lockBtn.classList.add('wake-active');

  // Set type badge
  const meta = RUN_TYPE_META[activeRunType];
  if (meta && activeRunType !== 'libre') {
    $typeBadge.textContent = meta.label;
    $typeBadge.style.background = meta.zone ? ZONE_COLORS[meta.zone] : 'var(--accent)';
    $typeBadge.classList.add('visible');
  } else {
    $typeBadge.classList.remove('visible');
  }

  // Init session state for guided runs (from plan)
  sessionState = null;
  if (activeSegments && activeSegments.length > 0) {
    sessionState = {
      currentIdx: 0,
      segStartTime: 0,
      segStartDist: 0,
      segDurations: activeSegments.map(s => s.mode === 'run-steady' ? parseSegDuration(s.duration) : 0),
      completed: activeSegments.map(() => false),
      countdownFired: false,
      segLog: [],
    };
    activeRunType = segModeToRunType(activeSegments[0]);
    // Update badge for first segment
    $typeBadge.textContent = activeSegments[0].name;
    $typeBadge.style.background = ZONE_COLORS[activeSegments[0].zone] || 'var(--accent)';
    $typeBadge.classList.add('visible');
    if (activeSegments[0].mode === 'run-intervals') initIntervalState();
  } else if (activeRunType === 'intervalos') {
    initIntervalState();
  }
  renderSessionProgress();

  // Hide nav
  document.querySelector('nav').style.display = 'none';

  // Init map
  initLiveMap();
}

function togglePause() {
  if (tracker.state === 'tracking') {
    tracker.pause();
    $pauseBtn.classList.add('paused');
    $liveStatus.textContent = 'EN PAUSA';
    $liveStatus.classList.add('paused');
  } else if (tracker.state === 'paused') {
    tracker.resume();
    $pauseBtn.classList.remove('paused');
    $liveStatus.textContent = 'EN CURSO';
    $liveStatus.classList.remove('paused');
  }
}

async function toggleLock() {
  const screenOn = await tracker.toggleWakeLock();
  $lockBtn.classList.toggle('wake-active', screenOn);
  $lockBtn.title = screenOn ? 'Pantalla encendida' : 'Pantalla puede apagarse';
}

function toggleAutoPause() {
  const enabled = tracker.toggleAutoPause();
  $autoPauseBtn.classList.toggle('active', enabled);
  $autoPauseBtn.title = enabled ? 'Auto-pausa activada' : 'Auto-pausa desactivada';
  toast(enabled ? 'Auto-pausa activada' : 'Auto-pausa desactivada');
}

function stopGpsRun(db) {
  clearActiveRun();
  const result = tracker.stop();
  if (!result) { closeLiveOverlay(); return; }

  // Log final segment if session is active
  if (sessionState && activeSegments) {
    const idx = sessionState.currentIdx;
    if (!sessionState.completed[idx]) {
      const seg = activeSegments[idx];
      sessionState.segLog.push({
        name: seg.name,
        zone: seg.zone || 'Z2',
        mode: seg.mode,
        duration: Math.round(result.duration - sessionState.segStartTime),
        distance: +(result.distance - sessionState.segStartDist).toFixed(3),
      });
    }
    result.sessionSegments = sessionState.segLog;
  }

  // Show summary screen
  $liveScreen.style.display = 'none';
  $summaryScreen.style.display = '';

  // Fill summary stats
  document.getElementById('runSumDist').textContent = result.distance.toFixed(2);
  document.getElementById('runSumTime').textContent = formatRunDuration(result.duration);
  document.getElementById('runSumPace').textContent = result.pace > 0 ? formatPace(result.pace) : '--:--';

  // Render splits
  renderSplitsUI(document.getElementById('runSumSplits'), result.splits);

  // Render summary map
  renderSummaryMap(result.route?.coords);

  // Populate session select for linking to plan
  populateSumSessionSelect(db);

  // Pre-fill session from plan if started from plan tab
  if (activePlanSession) {
    const $sel = document.getElementById('runSumSession');
    const match = Array.from($sel.options).find(o => o.value === activePlanSession);
    if (match) $sel.value = activePlanSession;
  }

  // Pre-fill run type from picker
  document.getElementById('runSumType').value = activeRunType;

  // Store result for saving
  $summaryScreen.dataset.result = JSON.stringify(result);
}

function saveGpsRun(db) {
  clearActiveRun();
  const result = JSON.parse($summaryScreen.dataset.result || '{}');
  if (!result.distance && !result.duration) { toast('Sin datos para guardar', 'warn'); return; }

  const log = {
    id: Date.now(),
    date: today(),
    session: document.getElementById('runSumSession').value || '',
    program: db.runningProgram || '',
    week: parseInt($weekSelect?.value) || 0,
    type: document.getElementById('runSumType').value || 'libre',
    distance: result.distance || 0,
    duration: result.duration || 0,
    pace: result.pace || 0,
    hr: null,
    elevation: result.elevation || null,
    cadence: null,
    splits: result.splits || [],
    route: result.route || null,
    segments: result.sessionSegments || [],
    source: 'gps',
    notes: document.getElementById('runSumNotes').value.trim()
  };

  if (!Array.isArray(db.runningLogs)) db.runningLogs = [];
  db.runningLogs.push(log);
  saveDB(db);

  // Check for new PRs
  checkAndNotifyPRs(db, log);

  toast('Carrera guardada');
  closeLiveOverlay();
  refreshRunning(db);
}

function discardGpsRun() {
  clearActiveRun();
  closeLiveOverlay();
}

function closeLiveOverlay() {
  clearActiveRun();
  $overlay.classList.remove('active');
  document.querySelector('nav').style.display = '';
  // Cleanup maps
  if (liveMap) { liveMap.remove(); liveMap = null; }
  if (summaryMap) { summaryMap.remove(); summaryMap = null; }
  // Reset type state
  activeSegments = null;
  activePlanSession = '';
  intervalState = null;
  sessionState = null;
  targetDistance = 0;
  document.getElementById('runSessionProgress').style.display = 'none';
  $typeBadge?.classList.remove('visible');
  if ($typePanel) { $typePanel.innerHTML = ''; delete $typePanel.dataset.goalReached; }
}

// ── Live UI updates ──────────────────────────────────────

function updateLiveUI(data) {
  $liveTimer.textContent = formatRunDuration(Math.floor(data.elapsed));
  $liveTimer.classList.toggle('auto-paused', !!data.autoPaused);
  $liveDist.textContent = data.distance.toFixed(2);
  $livePace.textContent = data.currentPace > 60 && data.currentPace < 1200
    ? formatPace(data.currentPace) : (data.avgPace > 0 ? formatPace(data.avgPace) : '--:--');

  // Update map position
  if (data.lat && data.lng && liveMap) {
    const latlng = [data.lat, data.lng];
    if (liveMarker) liveMarker.setLatLng(latlng);
    if (livePolyline) {
      livePolyline.addLatLng(latlng);
    }
    liveMap.setView(latlng, liveMap.getZoom());
  }

  // Type-specific panel update
  updateSessionUI(data);
}

function onSplitComplete(split) {
  beepSplit();
  const el = document.createElement('div');
  el.className = 'run-live-split';
  el.innerHTML = `<span class="run-live-split-km">Km ${split.km}</span><span class="run-live-split-pace">${formatPace(split.pace)} /km</span>`;
  $liveSplits.prepend(el);
}

// ── Type-specific panel updaters ─────────────────────────

function updateTypePanelUI(data) {
  switch (activeRunType) {
    case 'rodaje': updateRodajeUI(data); break;
    case 'tempo': updateTempoUI(data); break;
    case 'fartlek': updateFartlekUI(data); break;
    case 'competicion': updateCompeticionUI(data); break;
    case 'intervalos': updateIntervalosUI(data); break;
    case 'cuestas': updateCuestasUI(data); break;
    default: $typePanel.innerHTML = ''; break;
  }
}

function updateRodajeUI() {
  const color = ZONE_COLORS.Z2;
  $typePanel.innerHTML = `<div class="run-type-zone-bar" style="background:${color}">Z2 <span class="zone-label">· Aerobico</span></div>`;
}

function updateTempoUI(data) {
  const targetPace = targetDistance; // reused variable: stores sec/km for tempo
  if (!targetPace || !data.avgPace || data.avgPace <= 0) {
    const color = ZONE_COLORS.Z3;
    $typePanel.innerHTML = `<div class="run-type-zone-bar" style="background:${color}">Z3 <span class="zone-label">· Tempo</span></div>`;
    return;
  }
  const delta = data.avgPace - targetPace;
  const absDelta = Math.abs(delta);
  const sign = delta > 0 ? '+' : '-';
  const cls = delta <= 0 ? 'faster' : 'slower';
  const label = delta <= 0 ? 'mas rapido' : 'mas lento';
  $typePanel.innerHTML = `<div class="run-type-pace-compare">
    <div class="run-type-pace-target">
      <div class="run-type-pace-target-value">${formatPace(targetPace)}</div>
      <div class="run-type-pace-target-label">objetivo /km</div>
    </div>
    <div class="run-type-pace-delta ${cls}">${sign}${formatPace(absDelta)} ${label}</div>
  </div>`;
}

function updateFartlekUI(data) {
  const pace = data.currentPace > 60 && data.currentPace < 1200 ? data.currentPace : data.avgPace;
  const zone = estimateZone(pace, getPaceZones(db));
  const color = ZONE_COLORS[zone];
  const label = ZONE_LABELS[zone];
  $typePanel.innerHTML = `<div class="run-type-zone-bar" style="background:${color}">${zone} <span class="zone-label">· ${label}</span></div>`;
}

function updateCompeticionUI(data) {
  if (!targetDistance) {
    $typePanel.innerHTML = '';
    return;
  }
  const remaining = Math.max(0, targetDistance - data.distance);
  const pct = Math.min((data.distance / targetDistance) * 100, 100);
  const eta = data.avgPace > 0 ? formatRunDuration(Math.round(data.avgPace * targetDistance)) : '--:--';

  // Beep when goal reached
  if (remaining <= 0 && data.distance > 0 && !$typePanel.dataset.goalReached) {
    $typePanel.dataset.goalReached = '1';
    beepAllDone();
  }

  $typePanel.innerHTML = `<div class="run-type-race">
    <div class="run-type-race-remaining">${remaining.toFixed(2)} km</div>
    <div class="run-type-race-label">restantes de ${targetDistance} km</div>
    <div class="run-type-race-eta">Estimado: ${eta}</div>
    <div class="run-type-race-bar"><div class="run-type-race-bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function updateCuestasUI(data) {
  const elev = data.elevation || 0;
  $typePanel.innerHTML = `<div class="run-type-elev">
    <div><div class="run-type-elev-value">${elev} m</div><div class="run-type-elev-label">D+ acumulado</div></div>
  </div>`;
}

// ── Intervals logic ─────────────────────────────────────

function initIntervalState() {
  if (activeSegments) {
    // Guided mode: find the first interval segment
    const idx = activeSegments.findIndex(s => s.mode === 'run-intervals');
    const seg = activeSegments[idx >= 0 ? idx : 0];
    intervalState = {
      rep: 0,
      totalReps: seg?.reps || 0,
      isWork: true,
      segIdx: idx >= 0 ? idx : 0,
      phaseStartDist: 0,
      phaseStartTime: 0,
      countdownStarted: false,
      segmentDistance: parseSegDistance(seg?.distance),
      recoveryDistance: parseSegDistance(seg?.recovery),
    };
  } else {
    // Manual mode
    intervalState = {
      rep: 0,
      totalReps: 0,
      isWork: true,
      segIdx: 0,
      phaseStartDist: 0,
      phaseStartTime: 0,
      countdownStarted: false,
      segmentDistance: 0,
      recoveryDistance: 0,
    };
  }
}

// ── Session-level tracking ───────────────────────────────

function renderSessionProgress() {
  const $progress = document.getElementById('runSessionProgress');
  if (!sessionState || !activeSegments) { $progress.style.display = 'none'; return; }
  $progress.style.display = '';
  $progress.innerHTML = activeSegments.map((seg, i) => {
    const color = ZONE_COLORS[seg.zone] || ZONE_COLORS.Z2;
    const cls = i === sessionState.currentIdx ? 'active' : sessionState.completed[i] ? 'done' : '';
    return `<div class="run-session-seg ${cls}" style="background:${color}">${esc(seg.name.substring(0, 12))}</div>`;
  }).join('');
}

function updateProgressBarHighlight() {
  document.querySelectorAll('.run-session-seg').forEach((el, i) => {
    el.classList.toggle('active', i === sessionState.currentIdx);
    el.classList.toggle('done', sessionState.completed[i]);
  });
}

function updateSteadySegmentUI(data, seg) {
  const elapsed = data.elapsed - sessionState.segStartTime;
  const target = sessionState.segDurations[sessionState.currentIdx];
  const remaining = Math.max(0, target - elapsed);
  const zone = seg.zone || 'Z2';
  const color = ZONE_COLORS[zone];
  const label = ZONE_LABELS[zone];
  const pct = target > 0 ? Math.min((elapsed / target) * 100, 100) : 0;
  const isLast = sessionState.currentIdx >= activeSegments.length - 1;
  const skipBtn = !isLast ? `<button class="run-seg-skip-btn" id="runSegSkipBtn">Siguiente ▸</button>` : '';
  $typePanel.innerHTML = `<div class="run-type-steady-seg">
    <div class="run-type-zone-bar" style="background:${color}">${zone} <span class="zone-label">· ${label}</span></div>
    <div class="run-type-steady-info">
      <span class="run-type-steady-name">${esc(seg.name)}</span>
      <span class="run-type-steady-remaining">${target > 0 ? formatRunDuration(Math.floor(remaining)) : ''}</span>
    </div>
    ${target > 0 ? `<div class="run-type-steady-bar"><div class="run-type-steady-bar-fill" style="width:${pct}%;background:${color}"></div></div>` : ''}
    ${skipBtn}
  </div>`;
  const skipEl = document.getElementById('runSegSkipBtn');
  if (skipEl) skipEl.onclick = () => advanceSegment(data);
}

function updateSessionUI(data) {
  if (!sessionState || !activeSegments) {
    updateTypePanelUI(data);
    return;
  }
  const seg = activeSegments[sessionState.currentIdx];
  if (seg.mode === 'run-steady') checkSteadySegmentTransition(data);

  switch (seg.mode) {
    case 'run-steady': updateSteadySegmentUI(data, seg); break;
    case 'run-intervals': updateIntervalosUI(data); break;
    default: updateTypePanelUI(data); break;
  }
  updateProgressBarHighlight();
}

function checkSteadySegmentTransition(data) {
  const target = sessionState.segDurations[sessionState.currentIdx];
  if (target <= 0) return;
  const elapsed = data.elapsed - sessionState.segStartTime;
  const remaining = target - elapsed;

  if (remaining <= 3 && remaining > 0 && !sessionState.countdownFired) {
    sessionState.countdownFired = true;
    startCountdown(() => advanceSegment(data));
    return;
  }
  if (remaining <= 0 && !sessionState.countdownFired) {
    sessionState.countdownFired = true;
    advanceSegment(data);
  }
}

function advanceSegment(data) {
  const oldIdx = sessionState.currentIdx;
  sessionState.completed[oldIdx] = true;
  // Log completed segment
  const oldSeg = activeSegments[oldIdx];
  sessionState.segLog.push({
    name: oldSeg.name,
    zone: oldSeg.zone || 'Z2',
    mode: oldSeg.mode,
    duration: Math.round(data.elapsed - sessionState.segStartTime),
    distance: +(data.distance - sessionState.segStartDist).toFixed(3),
  });

  if (oldIdx >= activeSegments.length - 1) {
    beepAllDone();
    renderSessionProgress();
    return;
  }

  sessionState.currentIdx = oldIdx + 1;
  sessionState.segStartTime = data.elapsed;
  sessionState.segStartDist = data.distance;
  sessionState.countdownFired = false;

  const nextSeg = activeSegments[sessionState.currentIdx];
  beepSegmentChange();

  activeRunType = segModeToRunType(nextSeg);
  $typeBadge.textContent = nextSeg.name;
  $typeBadge.style.background = ZONE_COLORS[nextSeg.zone] || 'var(--accent)';

  if (nextSeg.mode === 'run-intervals') {
    intervalState = {
      rep: 0, totalReps: nextSeg.reps || 0, isWork: true,
      segIdx: sessionState.currentIdx,
      phaseStartDist: data.distance, phaseStartTime: data.elapsed,
      countdownStarted: false,
      segmentDistance: parseSegDistance(nextSeg.distance),
      recoveryDistance: parseSegDistance(nextSeg.recovery),
    };
    beepWorkStart();
  } else {
    intervalState = null;
  }

  renderSessionProgress();
}

function updateIntervalosUI(data) {
  if (!intervalState) { $typePanel.innerHTML = ''; return; }

  // Guided mode: check auto-transitions
  if (activeSegments && intervalState.segmentDistance > 0) {
    checkIntervalAutoTransition(data);
  }

  const repLabel = intervalState.totalReps
    ? `Rep ${intervalState.rep + (intervalState.isWork ? 1 : 0)}/${intervalState.totalReps}`
    : `Rep ${intervalState.rep}`;
  const phaseLabel = intervalState.isWork ? 'TRABAJO' : 'RECUPERACION';
  const phaseCls = intervalState.isWork ? 'work' : 'rest';

  const segInfo = activeSegments
    ? `<div class="run-type-interval-seg">${activeSegments[intervalState.segIdx]?.name || ''}</div>`
    : '';

  const lapBtn = !activeSegments
    ? `<button class="run-type-interval-lap-btn" id="runIntervalLapBtn">Vuelta</button>`
    : '';

  $typePanel.innerHTML = `<div class="run-type-interval">
    <div class="run-type-interval-rep">${repLabel}</div>
    <div class="run-type-interval-phase ${phaseCls}">${phaseLabel}</div>
    ${segInfo}${lapBtn}
  </div>`;

  // Bind lap button for manual mode
  const lapBtnEl = document.getElementById('runIntervalLapBtn');
  if (lapBtnEl) {
    lapBtnEl.onclick = () => manualLap(data);
  }
}

function manualLap(data) {
  if (!intervalState) return;
  if (intervalState.isWork) {
    intervalState.rep++;
    intervalState.isWork = false;
    beepRestStart();
  } else {
    intervalState.isWork = true;
    beepWorkStart();
  }
  intervalState.phaseStartDist = data.distance;
  intervalState.phaseStartTime = data.elapsed;
  intervalState.countdownStarted = false;
}

function checkIntervalAutoTransition(data) {
  if (!intervalState || !activeSegments) return;

  const dist = intervalState.isWork ? intervalState.segmentDistance : intervalState.recoveryDistance;
  if (dist <= 0) return;

  const phaseDist = data.distance - intervalState.phaseStartDist;
  const remaining = dist - phaseDist;

  // Countdown 3 seconds before transition
  if (remaining > 0 && remaining < dist * 0.15 && !intervalState.countdownStarted) {
    // Estimate time remaining from pace
    const pace = data.currentPace > 60 ? data.currentPace : (data.avgPace || 360);
    const timeRemaining = remaining * pace;
    if (timeRemaining <= 4) {
      intervalState.countdownStarted = true;
      startCountdown(() => autoTransitionPhase(data));
      return;
    }
  }

  // Hard cutoff if countdown didn't fire
  if (remaining <= 0 && !intervalState.countdownStarted) {
    intervalState.countdownStarted = true;
    autoTransitionPhase(data);
  }
}

function autoTransitionPhase(data) {
  if (!intervalState) return;

  if (intervalState.isWork) {
    intervalState.rep++;
    intervalState.isWork = false;
    beepRestStart();

    // Check if all reps done
    if (intervalState.totalReps > 0 && intervalState.rep >= intervalState.totalReps) {
      beepAllDone();
      if (sessionState) {
        // Session state machine handles segment transition
        advanceSegment(data);
        return;
      }
      // Non-session mode: try to advance to next interval segment
      if (activeSegments && intervalState.segIdx < activeSegments.length - 1) {
        intervalState.segIdx++;
        const nextSeg = activeSegments[intervalState.segIdx];
        if (nextSeg.mode === 'run-intervals') {
          intervalState.rep = 0;
          intervalState.totalReps = nextSeg.reps || 0;
          intervalState.segmentDistance = parseSegDistance(nextSeg.distance);
          intervalState.recoveryDistance = parseSegDistance(nextSeg.recovery);
          beepSegmentChange();
        }
      }
    }
  } else {
    intervalState.isWork = true;
    beepWorkStart();
  }

  intervalState.phaseStartDist = data.distance;
  intervalState.phaseStartTime = data.elapsed;
  intervalState.countdownStarted = false;
}

// ── Maps ─────────────────────────────────────────────────

function initLiveMap() {
  if (typeof L === 'undefined') return;

  // Clear old map
  if (liveMap) { liveMap.remove(); liveMap = null; }

  liveMap = L.map($liveMap, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false
  }).setView([40.4168, -3.7038], 15); // Default Madrid

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(liveMap);

  livePolyline = L.polyline([], { color: '#0055ff', weight: 4, opacity: 0.8 }).addTo(liveMap);

  liveMarker = L.circleMarker([0, 0], {
    radius: 8,
    fillColor: '#0055ff',
    fillOpacity: 1,
    color: '#fff',
    weight: 3
  }).addTo(liveMap);

  // Center on user location
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    liveMap.setView(ll, 16);
    liveMarker.setLatLng(ll);
  }, () => {}, { enableHighAccuracy: true });
}

function renderSummaryMap(coords) {
  const container = document.getElementById('runSummaryMap');
  if (typeof L === 'undefined' || !coords || coords.length < 2) {
    container.innerHTML = '<div class="empty-state" style="padding:20px">Sin ruta GPS</div>';
    return;
  }

  if (summaryMap) { summaryMap.remove(); summaryMap = null; }

  summaryMap = L.map(container, {
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(summaryMap);

  const latlngs = coords.map(c => [c[0], c[1]]);
  const polyline = L.polyline(latlngs, { color: '#0055ff', weight: 4 }).addTo(summaryMap);

  // Start/end markers
  L.circleMarker(latlngs[0], { radius: 6, fillColor: '#34c759', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(summaryMap);
  L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, fillColor: '#ff3b30', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(summaryMap);

  summaryMap.fitBounds(polyline.getBounds(), { padding: [30, 30] });
}

function renderDetailMap(container, coords) {
  if (typeof L === 'undefined' || !coords || coords.length < 2) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  if (detailMap) { detailMap.remove(); detailMap = null; }

  detailMap = L.map(container, {
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(detailMap);

  const latlngs = coords.map(c => [c[0], c[1]]);
  const polyline = L.polyline(latlngs, { color: '#0055ff', weight: 4 }).addTo(detailMap);

  L.circleMarker(latlngs[0], { radius: 5, fillColor: '#34c759', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(detailMap);
  L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, fillColor: '#ff3b30', fillOpacity: 1, color: '#fff', weight: 2 }).addTo(detailMap);

  detailMap.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

// ── Splits rendering ─────────────────────────────────────

function renderSplitsUI(container, splits) {
  if (!splits || splits.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:8px">Sin splits</div>';
    return;
  }

  const paces = splits.map(s => s.pace).filter(p => p > 0);
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const range = maxPace - minPace || 1;

  container.innerHTML = splits.map(s => {
    const pct = maxPace > 0 ? ((maxPace - s.pace) / range) * 100 : 50;
    let barClass = 'run-split-mid';
    if (paces.length > 1) {
      const ratio = (s.pace - minPace) / range;
      if (ratio < 0.33) barClass = 'run-split-fast';
      else if (ratio > 0.66) barClass = 'run-split-slow';
    }
    return `<div class="run-split-row">
      <span class="run-split-km">Km ${s.km}</span>
      <span class="run-split-pace">${formatPace(s.pace)}</span>
      <div class="run-split-bar"><div class="run-split-fill ${barClass}" style="width:${Math.max(pct, 10)}%"></div></div>
    </div>`;
  }).join('');
}

// ── Manual entry modal ───────────────────────────────────

function openManualModal(db) {
  editingId = null;
  document.getElementById('runDate').value = today();
  document.getElementById('runDistance').value = '';
  document.getElementById('runDuration').value = '';
  document.getElementById('runHr').value = '';
  document.getElementById('runElevation').value = '';
  document.getElementById('runCadence').value = '';
  document.getElementById('runNotes').value = '';
  document.getElementById('runPaceDisplay').style.display = 'none';
  document.getElementById('runEditBanner').style.display = 'none';
  document.getElementById('runDeleteBtn').style.display = 'none';
  document.getElementById('runSaveBtn').textContent = 'Guardar sesion';
  document.getElementById('runSplitInputs').innerHTML = '';
  document.getElementById('runManualModal').classList.add('open');
}

function closeManualModal() {
  document.getElementById('runManualModal').classList.remove('open');
  editingId = null;
}

function addSplitInput() {
  const container = document.getElementById('runSplitInputs');
  const count = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'run-split-input-row';
  row.innerHTML = `
    <span class="run-split-input-label">Km ${count}</span>
    <input type="text" placeholder="m:ss" inputmode="numeric" class="run-split-time-input">
    <button class="run-split-remove btn-sm" aria-label="Eliminar split">&times;</button>`;
  row.querySelector('.run-split-remove').addEventListener('click', () => {
    row.remove();
    renumberSplitInputs();
  });
  container.appendChild(row);
}

function renumberSplitInputs() {
  document.querySelectorAll('.run-split-input-row').forEach((row, i) => {
    row.querySelector('.run-split-input-label').textContent = `Km ${i + 1}`;
  });
}

function collectManualSplits() {
  const splits = [];
  document.querySelectorAll('.run-split-input-row').forEach((row, i) => {
    const timeStr = row.querySelector('.run-split-time-input').value;
    const time = parseRunDuration(timeStr);
    if (time > 0) {
      splits.push({ km: i + 1, time, pace: time, elevation: 0 });
    }
  });
  return splits;
}

// ── Save manual log ──────────────────────────────────────

function saveManualLog(db) {
  const $distance = document.getElementById('runDistance');
  const $duration = document.getElementById('runDuration');
  const distance = safeNum($distance.value, 0.01, 500);
  const duration = parseRunDuration($duration.value);

  if (!distance && !duration) {
    toast('Introduce al menos distancia o duracion', 'warn');
    return;
  }

  const splits = collectManualSplits();

  const log = {
    id: editingId || Date.now(),
    date: document.getElementById('runDate').value || today(),
    session: '',
    program: db.runningProgram || '',
    week: parseInt($weekSelect?.value) || 0,
    type: document.getElementById('runType').value,
    distance: distance || 0,
    duration: duration || 0,
    pace: distance && duration ? Math.round(duration / distance) : 0,
    hr: safeNum(document.getElementById('runHr').value, 30, 250) || null,
    elevation: safeNum(document.getElementById('runElevation').value, 0, 10000) || null,
    cadence: safeNum(document.getElementById('runCadence').value, 50, 300) || null,
    splits: splits.length > 0 ? splits : [],
    segments: [],
    route: null,
    source: 'manual',
    notes: document.getElementById('runNotes').value.trim()
  };

  if (!Array.isArray(db.runningLogs)) db.runningLogs = [];

  if (editingId) {
    const idx = db.runningLogs.findIndex(l => l.id === editingId);
    if (idx >= 0) db.runningLogs[idx] = log;
    else db.runningLogs.push(log);
  } else {
    db.runningLogs.push(log);
  }

  saveDB(db);
  checkAndNotifyPRs(db, log);
  toast(editingId ? 'Sesion actualizada' : 'Sesion guardada');
  closeManualModal();
  refreshRunning(db);
}

// ── Edit / Delete ────────────────────────────────────────

function startRunEdit(id, db) {
  const log = (db.runningLogs || []).find(l => l.id === id);
  if (!log) return;

  editingId = id;
  openManualModal(db);

  document.getElementById('runDate').value = log.date || '';
  document.getElementById('runType').value = log.type || 'libre';
  document.getElementById('runDistance').value = log.distance || '';
  document.getElementById('runDuration').value = log.duration ? formatRunDuration(log.duration) : '';
  document.getElementById('runHr').value = log.hr || '';
  document.getElementById('runElevation').value = log.elevation || '';
  document.getElementById('runCadence').value = log.cadence || '';
  document.getElementById('runNotes').value = log.notes || '';

  if (log.pace) {
    const $pd = document.getElementById('runPaceDisplay');
    $pd.textContent = `Ritmo: ${formatPace(log.pace)} /km`;
    $pd.style.display = '';
  }

  // Fill splits
  const splitsContainer = document.getElementById('runSplitInputs');
  splitsContainer.innerHTML = '';
  if (log.splits?.length) {
    log.splits.forEach((s, i) => {
      addSplitInput();
      const rows = splitsContainer.querySelectorAll('.run-split-input-row');
      const lastRow = rows[rows.length - 1];
      lastRow.querySelector('.run-split-time-input').value = formatPace(s.pace);
    });
  }

  document.getElementById('runEditBanner').style.display = '';
  document.getElementById('runEditText').textContent = `Editando sesion del ${formatDate(log.date)}`;
  document.getElementById('runDeleteBtn').style.display = '';
  document.getElementById('runSaveBtn').textContent = 'Guardar cambios';
}

function cancelEdit(db) {
  editingId = null;
  closeManualModal();
}

function deleteRunLog(db, id) {
  if (!id) return;
  markDeleted(db, id);
  db.runningLogs = (db.runningLogs || []).filter(l => l.id !== id);
  saveDB(db);
  toast('Sesion eliminada');
  if (editingId === id) { editingId = null; closeManualModal(); }
  renderRunHistory(db);
  refreshRunning(db);
}

// ── Run Detail Modal ─────────────────────────────────────

function openRunDetail(id, db) {
  const log = (db.runningLogs || []).find(l => l.id === id);
  if (!log) return;

  const modal = document.getElementById('runDetailModal');
  modal.dataset.logId = id;

  // Header
  const typeLabel = log.type ? log.type.charAt(0).toUpperCase() + log.type.slice(1) : '';
  document.getElementById('runDetailHeader').innerHTML = `
    <div class="run-detail-date">${formatDate(log.date)}</div>
    <span class="run-detail-type">${esc(typeLabel)}</span>
    ${log.session ? `<div class="run-detail-session-name">${esc(log.session)}</div>` : ''}`;

  // Stats
  const stats = [];
  if (log.distance) stats.push({ value: `${log.distance}`, label: 'km' });
  if (log.duration) stats.push({ value: formatRunDuration(log.duration), label: 'tiempo' });
  if (log.pace) stats.push({ value: formatPace(log.pace), label: '/km' });
  if (log.hr) stats.push({ value: `${log.hr}`, label: 'bpm' });
  if (log.elevation) stats.push({ value: `${log.elevation}`, label: 'm D+' });
  if (log.cadence) stats.push({ value: `${log.cadence}`, label: 'ppm' });
  document.getElementById('runDetailStats').innerHTML = stats.map(s =>
    `<div class="run-detail-stat"><div class="run-detail-stat-value">${s.value}</div><div class="run-detail-stat-label">${s.label}</div></div>`
  ).join('');

  // Map
  setTimeout(() => {
    renderDetailMap(document.getElementById('runDetailMap'), log.route?.coords);
  }, 100);

  // Splits
  const splitsContainer = document.getElementById('runDetailSplits');
  if (log.splits?.length) {
    splitsContainer.innerHTML = '<div class="run-summary-splits-title">Splits por km</div>';
    const splitsDiv = document.createElement('div');
    splitsContainer.appendChild(splitsDiv);
    renderSplitsUI(splitsDiv, log.splits);
  } else {
    splitsContainer.innerHTML = '';
  }

  // Notes
  document.getElementById('runDetailNotes').textContent = log.notes || '';
  document.getElementById('runDetailNotes').style.display = log.notes ? '' : 'none';

  modal.classList.add('open');
}

function closeRunDetail() {
  document.getElementById('runDetailModal').classList.remove('open');
  if (detailMap) { detailMap.remove(); detailMap = null; }
}

// ── Goal ─────────────────────────────────────────────────

function openGoalModal(db) {
  const goal = db.runningGoal || {};
  document.getElementById('runGoalType').value = goal.type || 'km';
  document.getElementById('runGoalValue').value = goal.target || '';
  document.getElementById('runGoalModal').classList.add('open');
}

function closeGoalModal() {
  document.getElementById('runGoalModal').classList.remove('open');
}

function saveGoal(db) {
  db.runningGoal = {
    type: document.getElementById('runGoalType').value,
    target: parseFloat(document.getElementById('runGoalValue').value) || 0,
    enabled: true
  };
  saveDB(db);
  closeGoalModal();
  renderGoalWidget(db);
  toast('Objetivo guardado');
}

function renderGoalWidget(db) {
  const goal = db.runningGoal || {};
  if (!goal.enabled || !goal.target) {
    $goalTarget.textContent = 'Toca el engranaje para definir tu objetivo';
    $goalCurrent.textContent = '—';
    $goalUnit.textContent = '';
    $goalSessions.textContent = '';
    $goalArc.setAttribute('stroke-dashoffset', '327');
    return;
  }

  // Get this week's logs (Monday to Sunday)
  const weekLogs = getThisWeekLogs(db);
  const isKm = goal.type === 'km';
  const current = isKm
    ? weekLogs.reduce((s, l) => s + (l.distance || 0), 0)
    : weekLogs.length;

  const pct = Math.min(current / goal.target, 1);
  const circumference = 327; // 2 * PI * 52
  const offset = circumference * (1 - pct);

  $goalArc.setAttribute('stroke-dashoffset', String(Math.max(offset, 0)));
  $goalCurrent.textContent = isKm ? current.toFixed(1) : String(current);
  $goalUnit.textContent = isKm ? 'km' : 'sesiones';
  $goalTarget.textContent = `Objetivo: ${goal.target} ${isKm ? 'km' : 'sesiones'}`;
  $goalSessions.textContent = `${weekLogs.length} sesiones esta semana`;

  // Color based on progress
  const color = pct >= 1 ? '#34c759' : 'var(--accent)';
  $goalArc.setAttribute('stroke', color);
}

function getThisWeekLogs(db) {
  const logs = db.runningLogs || [];
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().slice(0, 10);

  return logs.filter(l => l.date >= mondayStr);
}

// ── Personal Records ─────────────────────────────────────

function computePersonalRecords(db) {
  const logs = db.runningLogs || [];
  const prs = { 1: null, 5: null, 10: null, 21.1: null };
  const distances = [1, 5, 10, 21.1];

  for (const log of logs) {
    if (!log.distance || !log.pace || log.pace <= 0) continue;

    for (const d of distances) {
      if (log.distance >= d * 0.95) { // Allow 5% tolerance
        let time;
        // Try to get precise time from splits
        if (log.splits?.length >= d) {
          time = log.splits.slice(0, Math.ceil(d)).reduce((s, sp) => s + sp.time, 0);
        } else {
          time = Math.round(log.pace * d);
        }

        if (!prs[d] || time < prs[d].time) {
          prs[d] = { time, date: log.date, logId: log.id };
        }
      }
    }
  }

  return prs;
}

function renderPRs(db) {
  const prs = computePersonalRecords(db);
  const items = $prsGrid.querySelectorAll('.run-pr-item');

  items.forEach(item => {
    const val = item.querySelector('.run-pr-value');
    const dist = parseFloat(val.dataset.pr);
    const pr = prs[dist];
    if (pr) {
      val.textContent = formatRunDuration(pr.time);
      item.classList.add('has-pr');
    } else {
      val.textContent = '--:--';
      item.classList.remove('has-pr');
    }
    item.classList.remove('new-pr');
  });
}

function checkAndNotifyPRs(db, newLog) {
  if (!newLog.distance || !newLog.pace) return;

  const oldPrs = computePersonalRecords({
    ...db,
    runningLogs: (db.runningLogs || []).filter(l => l.id !== newLog.id)
  });
  const newPrs = computePersonalRecords(db);

  const beaten = [];
  for (const d of [1, 5, 10, 21.1]) {
    if (newPrs[d] && newPrs[d].logId === newLog.id) {
      if (!oldPrs[d] || newPrs[d].time < oldPrs[d].time) {
        beaten.push(d);
      }
    }
  }

  if (beaten.length > 0) {
    const msg = beaten.map(d => `${d} km: ${formatRunDuration(newPrs[d].time)}`).join(' | ');
    toast(`Nuevo PR! ${msg}`, 'success');
  }
}

// ── Delegated functions (from sub-modules) ───────────────

function populateRunWeeks(db) { _populateRunWeeks(db, $weekSelect, $sessionSelect, $segments); }
function populateRunSessions(db) { _populateRunSessions(db, $weekSelect, $sessionSelect, $segments); }
function loadRunSessionTemplate(db) { _loadRunSessionTemplate(db, $weekSelect, $sessionSelect, $segments); }

export function renderRunHistory(db) { _renderRunHistory(db, $historyFilter, $historyList); }
export function renderRunProgress(db) { _renderRunProgress(db, $weeklyChart, $paceChart, $statsPanel); }

export function refreshRunning(db) {
  updateRunContextBar(db);
  renderGoalWidget(db);
  renderPRs(db);
}
