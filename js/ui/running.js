import { saveDB, markDeleted } from '../data.js';
import { getRunningProgramList, getRunningPhases } from '../programs.js';
import { safeNum, esc, confirmDanger, formatDate, today } from '../utils.js';
import { toast } from './toast.js';
import { GpsTracker } from './running-tracker.js';

// ── Helpers ──────────────────────────────────────────────

const ZONE_COLORS = { Z1: '#999', Z2: '#34c759', Z3: '#ff9f0a', Z4: '#ff6b35', Z5: '#ff3b30' };
const ZONE_LABELS = { Z1: 'Recuperacion', Z2: 'Aerobico', Z3: 'Tempo', Z4: 'Umbral', Z5: 'VAM/VO2max' };

/** Format seconds as "m:ss /km" */
export function formatPace(secPerKm) {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format total seconds as "h:mm:ss" or "mm:ss" */
export function formatRunDuration(totalSec) {
  if (!totalSec || totalSec <= 0) return '00:00';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Parse "mm:ss" or "h:mm:ss" into total seconds */
export function parseRunDuration(str) {
  if (!str) return 0;
  str = str.trim();
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// ── State ────────────────────────────────────────────────

let editingId = null;
const tracker = new GpsTracker();
let liveMap = null;
let livePolyline = null;
let liveMarker = null;
let summaryMap = null;
let detailMap = null;
let isLocked = false;

// ── DOM refs ─────────────────────────────────────────────

let $overlay, $liveScreen, $summaryScreen;
let $liveTimer, $liveDist, $livePace, $liveSplits, $liveMap, $liveStatus;
let $pauseBtn, $stopBtn, $lockBtn;
let $goalCard, $goalBody, $goalArc, $goalCurrent, $goalUnit, $goalTarget, $goalSessions;
let $prsGrid;
let $weekSelect, $sessionSelect, $segments;
let $historyFilter, $historyList;
let $weeklyChart, $paceChart, $statsPanel;

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
}

// ── Init ─────────────────────────────────────────────────

export function initRunning(db) {
  cacheSelectors();

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

  // Start GPS run
  document.getElementById('runStartBtn').addEventListener('click', () => startGpsRun(db));

  // Manual entry modal
  document.getElementById('runManualBtn').addEventListener('click', () => openManualModal(db));
  document.getElementById('runManualCloseBtn').addEventListener('click', () => closeManualModal(db));

  // Live tracking controls
  $pauseBtn.addEventListener('click', () => togglePause());
  $stopBtn.addEventListener('click', () => stopGpsRun(db));
  $lockBtn.addEventListener('click', () => toggleLock());

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
  });
  $sessionSelect.addEventListener('change', () => loadRunSessionTemplate(db));

  // Tracker callbacks
  tracker.onUpdate(data => updateLiveUI(data));
  tracker.onSplit(split => onSplitComplete(split));
  tracker.onError(msg => {
    toast(msg, 'error');
    if (tracker.state === 'idle') closeLiveOverlay();
  });
}

// ── GPS Run lifecycle ────────────────────────────────────

function startGpsRun(db) {
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
  $liveStatus.textContent = 'EN CURSO';
  $liveStatus.classList.remove('paused');
  $pauseBtn.classList.remove('paused');
  isLocked = false;
  $overlay.classList.remove('locked');

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

function toggleLock() {
  isLocked = !isLocked;
  $overlay.classList.toggle('locked', isLocked);
}

function stopGpsRun(db) {
  const result = tracker.stop();
  if (!result) { closeLiveOverlay(); return; }

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

  // Store result for saving
  $summaryScreen.dataset.result = JSON.stringify(result);
}

function saveGpsRun(db) {
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
    segments: [],
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
  closeLiveOverlay();
}

function closeLiveOverlay() {
  $overlay.classList.remove('active');
  $overlay.classList.remove('locked');
  document.querySelector('nav').style.display = '';
  // Cleanup maps
  if (liveMap) { liveMap.remove(); liveMap = null; }
  if (summaryMap) { summaryMap.remove(); summaryMap = null; }
}

// ── Live UI updates ──────────────────────────────────────

function updateLiveUI(data) {
  $liveTimer.textContent = formatRunDuration(Math.floor(data.elapsed));
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
}

function onSplitComplete(split) {
  const el = document.createElement('div');
  el.className = 'run-live-split';
  el.innerHTML = `<span class="run-live-split-km">Km ${split.km}</span><span class="run-live-split-pace">${formatPace(split.pace)} /km</span>`;
  $liveSplits.prepend(el);
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
    <button class="run-split-remove btn-sm">&times;</button>`;
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

// ── Plan tab (programs) ──────────────────────────────────

function populateRunWeeks(db) {
  const programs = getRunningProgramList();
  if (programs.length === 0) {
    $weekSelect.innerHTML = '<option value="">Sin programa</option>';
    $sessionSelect.innerHTML = '<option value="">—</option>';
    $segments.innerHTML = '<div class="empty-state">No hay programas de running disponibles</div>';
    return;
  }

  const progId = db.runningProgram || programs[0].id;
  db.runningProgram = progId;
  const phases = getRunningPhases(progId);
  const weekKeys = Object.keys(phases).sort((a, b) => parseInt(a) - parseInt(b));

  $weekSelect.innerHTML = weekKeys.map(k =>
    `<option value="${k}" ${parseInt(k) === db.runningWeek ? 'selected' : ''}>${phases[k].name || 'Semana ' + k}</option>`
  ).join('');

  populateRunSessions(db);
}

function populateRunSessions(db) {
  const progId = db.runningProgram;
  const phases = getRunningPhases(progId);
  const week = phases[$weekSelect.value];
  if (!week || !week.sessions) {
    $sessionSelect.innerHTML = '<option value="">—</option>';
    $segments.innerHTML = '';
    return;
  }

  const sessionNames = Object.keys(week.sessions);
  $sessionSelect.innerHTML = sessionNames.map(s =>
    `<option value="${esc(s)}">${esc(s)}</option>`
  ).join('');

  loadRunSessionTemplate(db);
}

function loadRunSessionTemplate(db) {
  const progId = db.runningProgram;
  const phases = getRunningPhases(progId);
  const week = phases[$weekSelect.value];
  if (!week) { $segments.innerHTML = ''; return; }

  const sessionName = $sessionSelect.value;
  const segs = week.sessions?.[sessionName];
  if (!segs || segs.length === 0) { $segments.innerHTML = ''; return; }

  $segments.innerHTML = segs.map(seg => {
    const zone = seg.zone || 'Z2';
    const color = ZONE_COLORS[zone] || ZONE_COLORS.Z2;
    const zoneLabel = ZONE_LABELS[zone] || zone;

    let info = '';
    if (seg.mode === 'run-intervals') {
      info = `${seg.reps} x ${seg.distance || seg.duration || ''}`;
      if (seg.pace) info += ` a ${seg.pace}`;
      if (seg.recovery) info += ` · Rec: ${seg.recovery}`;
    } else {
      info = seg.duration || '';
      if (seg.desc) info += ` · ${seg.desc}`;
    }

    return `
      <div class="run-segment-card" style="border-left-color:${color}">
        <div class="run-seg-header">
          <span class="run-seg-name">${esc(seg.name)}</span>
          <span class="run-seg-zone" style="background:${color}">${zone}</span>
        </div>
        <div class="run-seg-info">${esc(info)}</div>
      </div>`;
  }).join('');
}

function populateSumSessionSelect(db) {
  const $sel = document.getElementById('runSumSession');
  $sel.innerHTML = '<option value="">Ninguna</option>';
  const programs = getRunningProgramList();
  if (programs.length === 0) return;

  const progId = db.runningProgram || programs[0].id;
  const phases = getRunningPhases(progId);
  for (const [wk, phase] of Object.entries(phases)) {
    if (phase.sessions) {
      for (const name of Object.keys(phase.sessions)) {
        $sel.innerHTML += `<option value="${esc(name)}">S${wk}: ${esc(name)}</option>`;
      }
    }
  }
}

// ── History ──────────────────────────────────────────────

export function renderRunHistory(db) {
  const logs = (db.runningLogs || []).slice().sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.id - a.id;
  });

  const filter = $historyFilter?.value || '';
  const filtered = filter ? logs.filter(l => l.type === filter) : logs;

  if (filtered.length === 0) {
    $historyList.innerHTML = '<div class="empty-state">Sin sesiones de running registradas</div>';
    return;
  }

  $historyList.innerHTML = filtered.slice(0, 50).map(log => {
    const typeLabel = log.type ? log.type.charAt(0).toUpperCase() + log.type.slice(1) : '';
    const pace = log.pace ? formatPace(log.pace) + ' /km' : '';
    const dur = log.duration ? formatRunDuration(log.duration) : '';
    const dist = log.distance ? `${log.distance} km` : '';

    let details = [dist, dur, pace].filter(Boolean).join(' · ');
    let extras = [];
    if (log.hr) extras.push(`♥ ${log.hr}`);
    if (log.elevation) extras.push(`↑ ${log.elevation} m`);
    if (log.cadence) extras.push(`${log.cadence} ppm`);

    const hasRoute = log.route?.coords?.length > 1;
    const splitsPreview = log.splits?.length
      ? log.splits.slice(0, 5).map(s => formatPace(s.pace)).join(' | ') + (log.splits.length > 5 ? ' ...' : '')
      : '';

    const minimap = hasRoute ? `<div class="run-hist-minimap"><canvas data-coords='${JSON.stringify(log.route.coords.map(c => [c[0], c[1]]))}'></canvas></div>` : '';

    return `
      <div class="run-history-card" data-id="${log.id}">
        <div class="run-hist-body">
          ${minimap}
          <div class="run-hist-content">
            <div class="run-hist-top">
              <span class="run-hist-date">${formatDate(log.date)}</span>
              <span class="run-hist-type">${esc(typeLabel)}</span>
            </div>
            ${log.session ? `<div class="run-hist-session">${esc(log.session)}</div>` : ''}
            <div class="run-hist-details">${esc(details)}</div>
            ${extras.length ? `<div class="run-hist-extras">${extras.join(' · ')}</div>` : ''}
            ${splitsPreview ? `<div class="run-hist-splits">${splitsPreview}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  // Render mini-map canvases
  renderMiniMaps();
}

function renderMiniMaps() {
  document.querySelectorAll('.run-hist-minimap canvas').forEach(canvas => {
    try {
      const coords = JSON.parse(canvas.dataset.coords || '[]');
      if (coords.length < 2) return;
      drawMiniRoute(canvas, coords);
    } catch (e) { /* skip */ }
  });
}

function drawMiniRoute(canvas, coords) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width = 128;
  const h = canvas.height = 128;

  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const rangeLat = maxLat - minLat || 0.001;
  const rangeLng = maxLng - minLng || 0.001;
  const pad = 12;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#0055ff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  coords.forEach((c, i) => {
    const x = pad + ((c[1] - minLng) / rangeLng) * (w - 2 * pad);
    const y = pad + (1 - (c[0] - minLat) / rangeLat) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// ── Progress ─────────────────────────────────────────────

export function renderRunProgress(db) {
  const logs = (db.runningLogs || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  if (logs.length === 0) {
    $weeklyChart.innerHTML = '<div class="empty-state">Sin datos</div>';
    $paceChart.innerHTML = '';
    $statsPanel.innerHTML = '';
    return;
  }

  renderWeeklyChart(logs);
  renderPaceChart(logs);
  renderStats(logs);
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function renderWeeklyChart(logs) {
  const weekMap = new Map();
  for (const log of logs) {
    if (!log.distance) continue;
    const wk = getWeekKey(log.date);
    weekMap.set(wk, (weekMap.get(wk) || 0) + log.distance);
  }

  const weeks = [...weekMap.entries()].slice(-12);
  if (weeks.length === 0) {
    $weeklyChart.innerHTML = '<div class="empty-state">Sin datos de distancia</div>';
    return;
  }

  const maxKm = Math.max(...weeks.map(w => w[1]));
  $weeklyChart.innerHTML = `
    <div class="run-bar-chart">
      ${weeks.map(([wk, km]) => {
        const pct = maxKm > 0 ? (km / maxKm) * 100 : 0;
        const label = wk.split('-W')[1];
        return `<div class="run-bar-col">
          <div class="run-bar-value">${km.toFixed(1)}</div>
          <div class="run-bar" style="height:${Math.max(pct, 4)}%"></div>
          <div class="run-bar-label">S${label}</div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderPaceChart(logs) {
  const paceLogs = logs.filter(l => l.pace && l.pace > 0 && l.distance >= 1);
  if (paceLogs.length < 2) {
    $paceChart.innerHTML = '<div class="empty-state">Necesitas al menos 2 sesiones con distancia >= 1km</div>';
    return;
  }

  const paces = paceLogs.map(l => l.pace);
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const range = maxPace - minPace || 1;

  const points = paceLogs.map((l, i) => {
    const x = (i / (paceLogs.length - 1)) * 100;
    const y = 100 - ((l.pace - minPace) / range) * 80 - 10;
    return { x, y, pace: l.pace, date: l.date };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  $paceChart.innerHTML = `
    <svg class="run-pace-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${polyline}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2" fill="var(--accent)" vector-effect="non-scaling-stroke"/>`).join('')}
    </svg>
    <div class="run-pace-labels">
      <span>${formatPace(maxPace)} /km</span>
      <span>${formatPace(minPace)} /km</span>
    </div>
    <div class="run-pace-dates">
      <span>${formatDate(paceLogs[0].date)}</span>
      <span>${formatDate(paceLogs[paceLogs.length - 1].date)}</span>
    </div>`;
}

function renderStats(logs) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthLogs = logs.filter(l => l.date?.startsWith(thisMonth));

  const totalKm = logs.reduce((s, l) => s + (l.distance || 0), 0);
  const monthKm = monthLogs.reduce((s, l) => s + (l.distance || 0), 0);
  const withPace = logs.filter(l => l.pace > 0);
  const avgPace = withPace.length ? withPace.reduce((s, l) => s + l.pace, 0) / withPace.length : 0;
  const bestPace = withPace.length ? Math.min(...withPace.map(l => l.pace)) : 0;

  $statsPanel.innerHTML = `
    <div class="run-stats-grid">
      <div class="run-stat-card"><div class="run-stat-value">${totalKm.toFixed(1)}</div><div class="run-stat-label">Km totales</div></div>
      <div class="run-stat-card"><div class="run-stat-value">${monthKm.toFixed(1)}</div><div class="run-stat-label">Km este mes</div></div>
      <div class="run-stat-card"><div class="run-stat-value">${formatPace(avgPace)}</div><div class="run-stat-label">Ritmo medio</div></div>
      <div class="run-stat-card"><div class="run-stat-value">${formatPace(bestPace)}</div><div class="run-stat-label">Mejor ritmo</div></div>
      <div class="run-stat-card"><div class="run-stat-value">${logs.length}</div><div class="run-stat-label">Sesiones totales</div></div>
      <div class="run-stat-card"><div class="run-stat-value">${monthLogs.length}</div><div class="run-stat-label">Sesiones este mes</div></div>
    </div>`;
}

// ── Refresh (called when switching to running tab) ───────

export function refreshRunning(db) {
  renderGoalWidget(db);
  renderPRs(db);
}
