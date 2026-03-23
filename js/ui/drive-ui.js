import { saveDB } from '../data.js';
import { LOCALE, REVISION_PREVIEW_LIMIT } from '../constants.js';
import { mergeDB, esc } from '../utils.js';
import { backupToDrive, restoreFromDrive, listRevisions, downloadRevision } from '../drive.js';

/** Bind all Drive-related UI events in the Settings section */
export function initDriveUI(db) {
  const btnLabel = (btn) => btn.querySelector('span:nth-child(2)') || btn;
  const getBtnText = (btn) => btnLabel(btn).textContent;
  const setBtnText = (btn, text) => { btnLabel(btn).textContent = text; };

  // Backup
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
        ? 'Inicio de sesión cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      setBtnText(btn, originalText);
    }
  });

  // Restore
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
        status.textContent = 'Restauración cancelada';
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
        ? 'Inicio de sesión cancelado'
        : `Error: ${e.message}`;
      status.className = 'drive-status drive-error';
    } finally {
      btn.disabled = false;
      setBtnText(btn, originalText);
    }
  });

  // Revision recovery
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
          const date = esc(new Date(r.modifiedTime).toLocaleString(LOCALE));
          const size = r.size ? esc(`${(parseInt(r.size) / 1024).toFixed(1)} KB`) : '';
          return `<div class="history-item" data-rev="${esc(r.id)}" style="cursor:pointer"><div class="hi-main"><div class="hi-date">${date}</div><div class="hi-session">${size}</div></div></div>`;
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
        return `<div class="history-item"><div class="hi-main"><div class="hi-date">${esc(w.date)}</div><div class="hi-session">${esc(w.session || '')} · ${esc(w.program || 'barraLibre')} · Fase ${esc(String(w.phase || '?'))}</div></div><div class="hi-detail" style="font-size:12px;color:#666;margin-top:4px">${exList}</div></div>`;
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
}
