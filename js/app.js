import { loadDB, saveDB, exportData, importData, clearAllData } from './data.js';
import { loadPrograms } from './programs.js';
import { today } from './utils.js';
import { initTimer, toggleTimer, setTimerMode, showCustomInput, confirmCustomInput, resetStopwatch } from './ui/timer.js';
import { switchTab, openPhaseModal, closePhaseModal, selectPhase, updatePhaseUI } from './ui/nav.js';
import { populateSessions, loadSessionTemplate, saveWorkout, clearPrefill, startEdit, cancelEdit } from './ui/training.js';
import { renderCalendar, calNav, calDayClick } from './ui/calendar.js';
import { renderHistory, showDetail, shareCard, closeDetailModal, deleteWorkout, getDetailWorkout } from './ui/history.js';
import { renderProgressChart } from './ui/progress.js';
import { saveBodyLog, calcCalories, startBodyEdit, cancelBodyEdit, deleteBodyLog } from './ui/body.js';
import { initDrive, backupToDrive, restoreFromDrive } from './drive.js';

const db = loadDB();

// === SEED ===
function seedInitialData() {
  if (db.workouts.length > 0) return;
  db.workouts.push({
    id: 1739145600000, date: '2026-02-09', session: 'Sesión A', phase: 1, notes: 'Primera sesión',
    exercises: [
      { name: 'Sentadilla', sets: [{ kg: '65', reps: '5' }, { kg: '65', reps: '5' }, { kg: '65', reps: '5' }] },
      { name: 'Press de Banca', sets: [{ kg: '50', reps: '5' }, { kg: '50', reps: '5' }, { kg: '50', reps: '5' }] },
      { name: 'Peso Muerto', sets: [{ kg: '70', reps: '5' }, { kg: '70', reps: '5' }] },
      { name: 'Dominada Prono', sets: [{ kg: '', reps: '14' }, { kg: '', reps: '11' }, { kg: '', reps: '8' }] },
      { name: 'Plancha Abdominal', sets: [{ kg: '', reps: '2min' }, { kg: '', reps: '2min' }] }
    ]
  });
  saveDB(db);
}

// === INIT ===
async function init() {
  seedInitialData();
  await loadPrograms();
  document.getElementById('trainDate').value = today();
  document.getElementById('bodyDate').value = today();
  document.getElementById('phaseBadge').textContent = ['I', 'II', 'III', 'IV'][db.phase - 1];
  document.getElementById('calcHeight').value = db.settings?.height || 175;
  document.getElementById('calcAge').value = db.settings?.age || 32;
  document.getElementById('timerBar').classList.add('active');
  initTimer();
  populateSessions(db);
  bindEvents();

  // Initialize Google Drive when GIS library is ready
  if (typeof google !== 'undefined' && google.accounts) {
    initDrive();
  } else {
    const checkGIS = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) {
        clearInterval(checkGIS);
        initDrive();
      }
    }, 200);
    setTimeout(() => clearInterval(checkGIS), 10000);
  }
}

// === EVENT BINDING ===
function bindEvents() {
  // Bottom nav tabs
  document.querySelectorAll('nav button[data-sec]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn, db));
  });

  // Header phase badge
  document.querySelector('.phase-badge').addEventListener('click', () => openPhaseModal());

  // Timer
  document.getElementById('timerStartBtn').addEventListener('click', () => toggleTimer());
  document.querySelectorAll('.timer-mode[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => setTimerMode(btn.dataset.mode));
  });
  document.getElementById('timerCustomBtn').addEventListener('click', () => showCustomInput());
  const customInput = document.getElementById('timerCustomInput');
  customInput.addEventListener('blur', () => confirmCustomInput());
  customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') customInput.blur(); });
  document.getElementById('timerResetBtn').addEventListener('click', () => resetStopwatch());

  // Training section
  document.getElementById('trainSession').addEventListener('change', () => loadSessionTemplate(db, true));
  document.querySelector('#secTrain .btn').addEventListener('click', () => saveWorkout(db));
  document.getElementById('prefillBanner').addEventListener('click', (e) => {
    if (e.target.closest('.prefill-clear')) {
      cancelEdit(db);
      clearPrefill();
    }
  });

  // Calendar nav
  document.querySelector('.cal-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('cal-nav-today')) calNav(0, db);
    else if (btn.previousElementSibling === null) calNav(-1, db);
    else calNav(1, db);
  });

  // Calendar day clicks (event delegation)
  document.getElementById('calendarPanel').addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day[data-date]');
    if (day) calDayClick(day.dataset.date, db);
  });

  // History filter
  document.getElementById('historyFilter').addEventListener('change', () => renderHistory(db));

  // History item clicks (event delegation)
  document.getElementById('historyList').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item[data-id]');
    if (item) showDetail(parseInt(item.dataset.id), db);
  });

  // Detail modal
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailModal')) closeDetailModal();
  });

  // Detail buttons
  document.querySelector('.detail-close-btn').addEventListener('click', () => closeDetailModal());
  document.getElementById('editBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const workout = getDetailWorkout(db);
    if (!workout) return;
    closeDetailModal();
    const trainBtn = document.querySelector('nav button[data-sec="secTrain"]');
    switchTab(trainBtn, db);
    startEdit(workout, db);
  });
  document.querySelector('.detail-share-btn').addEventListener('click', (e) => { e.stopPropagation(); shareCard(); });
  document.getElementById('deleteBtn').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkout(db); });

  // Phase modal
  document.getElementById('phaseModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('phaseModal')) closePhaseModal();
    const option = e.target.closest('.phase-option[data-phase]');
    if (option) selectPhase(parseInt(option.dataset.phase), db);
  });
  document.querySelector('#phaseModal .btn-outline').addEventListener('click', () => closePhaseModal());

  // Progress exercise selector
  document.getElementById('progressExercise').addEventListener('change', () => renderProgressChart(db));

  // Body section
  document.querySelector('#secBody .btn.mb2').addEventListener('click', () => saveBodyLog(db));
  document.getElementById('bodyHistory').addEventListener('click', (e) => {
    const btn = e.target.closest('.hi-edit-btn');
    if (!btn) return;
    const item = btn.closest('.history-item[data-body-id]');
    if (item) startBodyEdit(parseInt(item.dataset.bodyId), db);
  });
  document.getElementById('bodyEditBanner').addEventListener('click', (e) => {
    if (e.target.closest('.body-edit-cancel')) cancelBodyEdit(db);
  });
  document.getElementById('bodyDeleteBtn').addEventListener('click', () => deleteBodyLog(db));
  document.getElementById('calcHeight').addEventListener('change', () => calcCalories(db));
  document.getElementById('calcAge').addEventListener('change', () => calcCalories(db));

  // Google Drive
  document.getElementById('driveBackupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('driveBackupBtn');
    const status = document.getElementById('driveStatus');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      await backupToDrive(db);
      status.textContent = `Copia guardada en Drive (${new Date().toLocaleString('es')})`;
      status.className = 'drive-status drive-success';
    } catch (e) {
      status.textContent = e.message === 'popup_closed_by_user'
        ? 'Inicio de sesion cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  document.getElementById('driveRestoreBtn').addEventListener('click', async () => {
    const btn = document.getElementById('driveRestoreBtn');
    const status = document.getElementById('driveStatus');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Cargando...';
    try {
      const result = await restoreFromDrive();
      if (!result.success) {
        status.textContent = 'No hay copia de seguridad en Drive';
        status.className = 'drive-status drive-error';
        return;
      }
      const when = new Date(result.modifiedTime).toLocaleString('es');
      if (!confirm(`Restaurar copia del ${when}?\nSe reemplazaran los datos actuales.`)) {
        status.textContent = 'Restauracion cancelada';
        status.className = 'drive-status';
        return;
      }
      Object.assign(db, result.data);
      saveDB(db);
      status.textContent = 'Datos restaurados correctamente';
      status.className = 'drive-status drive-success';
      location.reload();
    } catch (e) {
      status.textContent = e.message === 'popup_closed_by_user'
        ? 'Inicio de sesion cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Settings section
  document.querySelector('#secSettings .btn-outline:first-of-type').addEventListener('click', () => exportData(db));
  document.querySelector('#secSettings .btn-outline:nth-of-type(2)').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => importData(e, db));
  document.querySelector('#secSettings .btn-danger').addEventListener('click', () => clearAllData());

  // PR celebration dismiss
  document.getElementById('prCelebration').addEventListener('click', function () { this.style.display = 'none'; });
}

init();

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(() => console.log('SW registered'))
    .catch(e => console.log('SW failed', e));
}
