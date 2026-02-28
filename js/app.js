import { loadDB, saveDB, setOnSave, exportData, importData, clearAllData } from './data.js';
import { loadPrograms, setActiveProgram, getActiveProgram, getPrograms, getProgramList, isBuiltinProgram, validateProgram, importCustomProgram, deleteCustomProgram, getCustomPrograms } from './programs.js';
import { today, mergeDB, esc } from './utils.js';
import { DEBOUNCE_BACKUP_MS, GIS_CHECK_INTERVAL_MS, GIS_CHECK_TIMEOUT_MS, SYNC_INDICATOR_MS, DEFAULT_HEIGHT, DEFAULT_AGE, LOCALE, REVISION_PREVIEW_LIMIT, APP_VERSION } from './constants.js';
import { initTimer } from './ui/timer.js';
import { initNav, switchTab, updatePhaseUI, updatePhaseDisplay, refreshActiveSection } from './ui/nav.js';
import { initTraining, populateSessions, startEdit, cancelEdit } from './ui/training.js';
import { initCalendar } from './ui/calendar.js';
import { initHistory } from './ui/history.js';
import { initBody } from './ui/body.js';
import { initDrive, backupToDrive, restoreFromDrive, listRevisions, downloadRevision, silentBackup, syncOnLoad, onSyncStatus, isSyncing, clearStoredToken } from './drive.js';
import { initToast, toast } from './ui/toast.js';

const db = loadDB();
const AUTOSYNC_KEY = 'barraLibreAutoSync';

function debounce(fn, ms) {
  let t, lastArgs;
  const d = (...args) => { clearTimeout(t); lastArgs = args; t = setTimeout(() => { lastArgs = null; fn(...args); }, ms); };
  d.flush = () => { if (lastArgs) { clearTimeout(t); const a = lastArgs; lastArgs = null; fn(...a); } };
  return d;
}

function isAutoSync() { return localStorage.getItem(AUTOSYNC_KEY) === '1'; }

function updateSyncUI() {
  const btn = document.getElementById('autoSyncBtn');
  const desc = document.getElementById('autoSyncDesc');
  if (isAutoSync()) {
    btn.classList.add('active');
    desc.textContent = 'Activada';
  } else {
    btn.classList.remove('active');
    desc.textContent = 'Desactivada';
  }
}

function renderCustomProgramsList() {
  const list = document.getElementById('customProgramsList');
  const customs = getCustomPrograms();
  if (customs.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = customs.map(p => {
    const name = esc(p._meta?.name || 'Sin nombre');
    const desc = esc(p._meta?.desc || '');
    return `<div class="custom-prog-item">
      <div style="flex:1"><div class="custom-prog-name">${name}</div>${desc ? `<div class="custom-prog-desc">${desc}</div>` : ''}</div>
      <span class="custom-prog-badge">Custom</span>
      <button class="custom-prog-del" data-prog-id="${esc(p._customId)}">Eliminar</button>
    </div>`;
  }).join('');
}

function renderProgramSelector() {
  const progList = getProgramList();
  const active = db.program || 'barraLibre';
  const activeProg = progList.find(p => p.id === active);
  document.getElementById('activeProgramName').textContent = activeProg?.name || active;

  const modal = document.getElementById('programModal');
  const options = document.getElementById('programOptions');
  options.innerHTML = progList.map(p => {
    const isCustom = !isBuiltinProgram(p.id);
    const badge = isCustom ? '<span class="custom-prog-badge" style="margin-left:6px">Custom</span>' : '';
    return `<div class="prog-modal-item${p.id === active ? ' active' : ''}" data-prog="${esc(p.id)}">
      <div style="flex:1"><div class="prog-modal-name">${esc(p.name)}${badge}</div><div class="prog-modal-desc">${esc(p.desc)}</div></div>
    </div>`;
  }).join('');
}

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
  initToast();
  await loadPrograms();

  // Set active program from saved state + render selector
  setActiveProgram(db.program || 'barraLibre');
  renderProgramSelector();

  document.getElementById('trainDate').value = today();
  document.getElementById('bodyDate').value = today();
  updatePhaseDisplay(db);
  document.getElementById('calcHeight').value = db.settings?.height || DEFAULT_HEIGHT;
  document.getElementById('calcAge').value = db.settings?.age || DEFAULT_AGE;
  document.getElementById('timerBar').classList.add('active');
  initTimer();
  populateSessions(db);
  document.getElementById('appVersion').textContent = `Barra Libre v${APP_VERSION}`;
  bindEvents();

  // Sync indicator
  const syncEl = document.getElementById('syncIndicator');
  onSyncStatus(status => {
    syncEl.className = 'sync-indicator visible ' + status;
    syncEl.textContent = status === 'syncing' ? '' : status === 'ok' ? '✓' : '✗';
    if (status !== 'syncing') setTimeout(() => syncEl.classList.remove('visible'), SYNC_INDICATOR_MS);
  });

  // Auto-sync: debounced backup on every saveDB
  const debouncedBackup = debounce((d) => silentBackup(d), DEBOUNCE_BACKUP_MS);
  setOnSave((d) => { if (isAutoSync() && !isSyncing()) debouncedBackup(d); });

  updateSyncUI();

  // Initialize Google Drive when GIS library is ready
  const startDrive = () => {
    initDrive();
    if (isAutoSync()) syncOnLoad(db, saveDB);
  };
  if (typeof google !== 'undefined' && google.accounts) {
    startDrive();
  } else {
    const checkGIS = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) {
        clearInterval(checkGIS);
        startDrive();
      }
    }, GIS_CHECK_INTERVAL_MS);
    setTimeout(() => clearInterval(checkGIS), GIS_CHECK_TIMEOUT_MS);
  }

  // Flush pending backup when leaving, re-sync when returning
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isAutoSync()) {
      debouncedBackup.flush();
    } else if (document.visibilityState === 'visible' && isAutoSync() && !isSyncing()) {
      syncOnLoad(db, saveDB);
    }
  });

  // Offline indicator
  const offlineBanner = document.getElementById('offlineBanner');
  const updateOnline = () => { offlineBanner.classList.toggle('visible', !navigator.onLine); };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

// === EVENT BINDING ===
function bindEvents() {
  // Delegate to UI modules
  initNav(db);
  initTraining(db, { onCancelEdit: () => cancelEdit(db) });
  initCalendar(db);
  initHistory(db, {
    onEdit: (workout) => {
      const trainBtn = document.querySelector('nav button[data-sec="secTrain"]');
      switchTab(trainBtn, db);
      startEdit(workout, db);
    }
  });
  initBody(db);

  // Program selector modal
  document.getElementById('programContext').addEventListener('click', () => {
    renderProgramSelector();
    document.getElementById('programModal').classList.add('open');
  });
  document.getElementById('programModalClose').addEventListener('click', () => {
    document.getElementById('programModal').classList.remove('open');
  });
  document.getElementById('programModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('programModal'))
      document.getElementById('programModal').classList.remove('open');
  });
  document.getElementById('programOptions').addEventListener('click', (e) => {
    const item = e.target.closest('.prog-modal-item');
    if (!item) return;
    const prog = item.dataset.prog;
    if (prog === getActiveProgram()) { document.getElementById('programModal').classList.remove('open'); return; }
    setActiveProgram(prog);
    db.program = prog;
    db.phase = parseInt(Object.keys(getPrograms())[0]) || 1;
    saveDB(db);
    updatePhaseUI(db);
    populateSessions(db);
    renderProgramSelector();
    document.getElementById('historyFilter').value = '';
    refreshActiveSection(db);
    document.getElementById('programModal').classList.remove('open');
  });

  // Auto-sync toggle
  document.getElementById('autoSyncBtn').addEventListener('click', async () => {
    if (isAutoSync()) {
      localStorage.removeItem(AUTOSYNC_KEY);
      clearStoredToken();
      updateSyncUI();
      document.getElementById('driveStatus').textContent = '';
      return;
    }
    const btn = document.getElementById('autoSyncBtn');
    const desc = document.getElementById('autoSyncDesc');
    const status = document.getElementById('driveStatus');
    btn.disabled = true;
    desc.textContent = 'Activando...';
    try {
      status.textContent = 'Conectando con Google...';
      status.className = 'drive-status';
      await backupToDrive(db);
      localStorage.setItem(AUTOSYNC_KEY, '1');
      updateSyncUI();
      status.textContent = 'Sincronización activada';
      status.className = 'drive-status drive-success';
    } catch (e) {
      status.textContent = e.message === 'popup_closed_by_user'
        ? 'Inicio de sesión cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
      desc.textContent = 'Desactivada';
    } finally {
      btn.disabled = false;
    }
  });

  // Helper: get/set label text inside settings row buttons
  const btnLabel = (btn) => btn.querySelector('span:nth-child(2)') || btn;
  const getBtnText = (btn) => btnLabel(btn).textContent;
  const setBtnText = (btn, text) => { btnLabel(btn).textContent = text; };

  // Google Drive manual buttons
  document.getElementById('driveBackupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('driveBackupBtn');
    const status = document.getElementById('driveStatus');
    const originalText = getBtnText(btn);
    btn.disabled = true;
    setBtnText(btn, 'Guardando...');
    try {
      await backupToDrive(db);
      status.textContent = `Copia guardada en Drive (${new Date().toLocaleString(LOCALE)})`;
      status.className = 'drive-status drive-success';
    } catch (e) {
      status.textContent = e.message === 'popup_closed_by_user'
        ? 'Inicio de sesion cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      setBtnText(btn, originalText);
    }
  });

  document.getElementById('driveRestoreBtn').addEventListener('click', async () => {
    const btn = document.getElementById('driveRestoreBtn');
    const status = document.getElementById('driveStatus');
    const originalText = getBtnText(btn);
    btn.disabled = true;
    setBtnText(btn, 'Cargando...');
    try {
      const result = await restoreFromDrive();
      if (!result.success) {
        status.textContent = 'No hay copia de seguridad en Drive';
        status.className = 'drive-status drive-error';
        return;
      }
      const when = new Date(result.modifiedTime).toLocaleString(LOCALE);
      if (!confirm(`Restaurar copia del ${when}?\nLos datos se fusionarán con los actuales.`)) {
        status.textContent = 'Restauracion cancelada';
        status.className = 'drive-status';
        return;
      }
      Object.assign(db, mergeDB(db, result.data));
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
      setBtnText(btn, originalText);
    }
  });

  // Drive revision recovery
  let _revFileId = null;
  let _revData = null;

  document.getElementById('driveRevisionsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('driveRevisionsBtn');
    const status = document.getElementById('driveStatus');
    btn.disabled = true;
    setBtnText(btn, 'Cargando revisiones...');
    try {
      const result = await listRevisions();
      if (!result.success) {
        status.textContent = 'No hay copia de seguridad en Drive';
        status.className = 'drive-status drive-error';
        return;
      }
      _revFileId = result.fileId;
      const list = document.getElementById('revisionsList');
      const revs = result.revisions.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
      if (revs.length === 0) {
        list.innerHTML = '<p>No hay versiones anteriores disponibles.</p>';
      } else {
        list.innerHTML = revs.map(r => {
          const date = new Date(r.modifiedTime).toLocaleString(LOCALE);
          const size = r.size ? `${(parseInt(r.size) / 1024).toFixed(1)} KB` : '';
          return `<div class="history-item" data-rev="${r.id}" style="cursor:pointer"><div class="hi-main"><div class="hi-date">${date}</div><div class="hi-session">${size}</div></div></div>`;
        }).join('');
      }
      document.getElementById('revisionPreview').style.display = 'none';
      document.getElementById('revisionsList').style.display = '';
      document.getElementById('revisionsCloseBtn').style.display = '';
      document.getElementById('revisionsModal').classList.add('open');
    } catch (e) {
      status.textContent = e.message === 'popup_closed_by_user'
        ? 'Inicio de sesión cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      setBtnText(btn, 'Recuperar versión anterior');
    }
  });

  document.getElementById('revisionsList').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-rev]');
    if (!item) return;
    const revId = item.dataset.rev;
    item.style.opacity = '0.5';
    try {
      _revData = await downloadRevision(_revFileId, revId);
      const workouts = (_revData.workouts || []).sort((a, b) => b.date.localeCompare(a.date));
      const preview = document.getElementById('revisionPreviewContent');
      document.getElementById('revisionPreviewTitle').textContent =
        `${workouts.length} sesiones encontradas`;
      preview.innerHTML = workouts.slice(0, REVISION_PREVIEW_LIMIT).map(w => {
        const exList = (w.exercises || []).map(ex =>
          `${esc(ex.name)}: ${ex.sets.map(s => `${esc(s.kg) || '-'}kg×${esc(s.reps)}`).join(', ')}`
        ).join('<br>');
        return `<div class="history-item"><div class="hi-main"><div class="hi-date">${w.date}</div><div class="hi-session">${w.session || ''} · ${w.program || 'barraLibre'} · Fase ${w.phase || '?'}</div></div><div class="hi-detail" style="font-size:12px;color:#666;margin-top:4px">${exList}</div></div>`;
      }).join('');
      if (workouts.length > REVISION_PREVIEW_LIMIT) {
        preview.innerHTML += `<p style="color:#666;font-size:13px">... y ${workouts.length - REVISION_PREVIEW_LIMIT} sesiones más</p>`;
      }
      document.getElementById('revisionsList').style.display = 'none';
      document.getElementById('revisionsCloseBtn').style.display = 'none';
      document.getElementById('revisionPreview').style.display = '';
    } catch (err) {
      alert('Error al descargar revisión: ' + err.message);
    } finally {
      item.style.opacity = '';
    }
  });

  document.getElementById('revisionBackBtn').addEventListener('click', () => {
    document.getElementById('revisionPreview').style.display = 'none';
    document.getElementById('revisionsList').style.display = '';
    document.getElementById('revisionsCloseBtn').style.display = '';
    _revData = null;
  });

  document.getElementById('revisionRestoreBtn').addEventListener('click', () => {
    if (!_revData) return;
    if (!confirm('¿Restaurar esta versión? Los datos se fusionarán con los actuales.')) return;
    Object.assign(db, mergeDB(db, _revData));
    saveDB(db);
    location.reload();
  });

  document.getElementById('revisionsCloseBtn').addEventListener('click', () => {
    document.getElementById('revisionsModal').classList.remove('open');
  });
  document.getElementById('revisionsModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('revisionsModal'))
      document.getElementById('revisionsModal').classList.remove('open');
  });

  // Custom programs
  renderCustomProgramsList();
  document.getElementById('importProgramBtn').addEventListener('click', () => document.getElementById('importProgramFile').click());
  document.getElementById('importProgramFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const err = validateProgram(data);
        if (err) { alert('Plan no válido: ' + err); return; }
        importCustomProgram(data);
        renderCustomProgramsList();
        renderProgramSelector();
        toast('Plan importado: ' + (data._meta?.name || 'Sin nombre'));
      } catch { alert('Error al leer el archivo JSON'); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('customProgramsList').addEventListener('click', (e) => {
    const btn = e.target.closest('.custom-prog-del');
    if (!btn) return;
    const id = btn.dataset.progId;
    if (!confirm('¿Eliminar este plan?')) return;
    deleteCustomProgram(id);
    if (db.program === id) {
      db.program = 'barraLibre';
      setActiveProgram('barraLibre');
      db.phase = parseInt(Object.keys(getPrograms())[0]) || 1;
      saveDB(db);
      updatePhaseUI(db);
      populateSessions(db);
    }
    renderCustomProgramsList();
    renderProgramSelector();
    toast('Plan eliminado', 'info');
  });

  // Settings section
  document.getElementById('exportBtn').addEventListener('click', () => exportData(db));
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => importData(e, db));
  document.querySelector('#secSettings .sc-row-danger').addEventListener('click', () => clearAllData());
}

init();

// Register Service Worker + prompt update
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(newSW);
        }
      });
    });
  }).catch(e => console.log('SW failed', e));

  // Reload when new SW takes over
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) { refreshing = true; location.reload(); }
  });
}

function showUpdateBanner(worker) {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = 'Nueva versión disponible <button>Actualizar</button>';
  banner.querySelector('button').addEventListener('click', () => {
    worker.postMessage('skipWaiting');
    banner.remove();
  });
  document.body.appendChild(banner);
}
