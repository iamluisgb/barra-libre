import { esc } from '../utils.js';
import { getRunningProgramList, getRunningPhases } from '../programs.js';
import { saveDB } from '../data.js';
import { ZONE_COLORS, ZONE_LABELS } from './running-helpers.js';

// ── Plan tab (programs) ──────────────────────────────────

let _onStartSession = null;
export function setOnStartSession(fn) { _onStartSession = fn; }

export function populateRunWeeks(db, $weekSelect, $sessionSelect, $segments) {
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

  populateRunSessions(db, $weekSelect, $sessionSelect, $segments);
}

export function populateRunSessions(db, $weekSelect, $sessionSelect, $segments) {
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

  loadRunSessionTemplate(db, $weekSelect, $sessionSelect, $segments);
}

export function loadRunSessionTemplate(db, $weekSelect, $sessionSelect, $segments) {
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

  $segments.innerHTML += `<button class="btn run-seg-start-btn" id="runSegStartBtn" style="width:100%;margin-top:8px">Iniciar esta sesion</button>`;
  document.getElementById('runSegStartBtn').addEventListener('click', () => {
    const runType = inferRunType(segs);
    const sessionLabel = $sessionSelect.value || '';
    _onStartSession?.(segs, runType, sessionLabel, db);
  });
}

export function inferRunType(segments) {
  const hasIntervals = segments.some(s => s.mode === 'run-intervals');
  const hasZ3Z4 = segments.some(s => s.zone === 'Z3' || s.zone === 'Z4');
  if (hasIntervals) return 'intervalos';
  if (hasZ3Z4 && !hasIntervals) return 'tempo';
  return 'rodaje';
}

export function populateSumSessionSelect(db) {
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

export function updateRunContextBar(db) {
  const programs = getRunningProgramList();
  const prog = programs.find(p => p.id === db.runningProgram);
  document.getElementById('runProgramName').textContent = prog?.name || 'Sin programa';
  const phases = getRunningPhases(db.runningProgram);
  const week = phases[db.runningWeek];
  document.getElementById('runWeekName').textContent = week?.name || `Semana ${db.runningWeek || 1}`;
}

export function renderRunProgramModal(db) {
  const programs = getRunningProgramList();
  const active = db.runningProgram || '';
  document.getElementById('runProgramOptions').innerHTML = programs.map(p =>
    `<div class="prog-modal-item${p.id === active ? ' active' : ''}" data-prog="${esc(p.id)}">
      <div style="flex:1"><div class="prog-modal-name">${esc(p.name)}</div><div class="prog-modal-desc">${esc(p.desc)}</div></div>
    </div>`
  ).join('') || '<div class="empty-state">No hay programas de running</div>';
}

export function renderRunWeekModal(db) {
  const phases = getRunningPhases(db.runningProgram);
  const weekKeys = Object.keys(phases).sort((a, b) => parseInt(a) - parseInt(b));
  const current = db.runningWeek || 1;
  document.getElementById('runWeekOptions').innerHTML = weekKeys.map(k => {
    const w = phases[k];
    return `<div class="phase-option${parseInt(k) === current ? ' selected' : ''}" data-week="${k}">
      <div class="po-num">${k}</div>
      <div class="po-text"><div class="po-title">${w.name || 'Semana ' + k}</div><div class="po-desc">${w.desc || Object.keys(w.sessions || {}).join(', ')}</div></div>
    </div>`;
  }).join('');
}
