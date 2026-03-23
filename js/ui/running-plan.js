import { esc } from '../utils.js';
import { getRunningProgramList, getRunningPhases } from '../programs.js';
import { saveDB } from '../data.js';
import { ZONE_COLORS, ZONE_LABELS, parseSegDistance, parseSegDuration, estimateZone, getPaceZones } from './running-helpers.js';

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

function parsePaceToSec(pace) {
  if (!pace) return 0;
  const m = String(pace).match(/(\d+):(\d+)/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
}

function inferZone(seg, db) {
  if (seg.zone) return seg.zone;
  if (seg.mode === 'run-intervals' && seg.pace) return estimateZone(parsePaceToSec(seg.pace), getPaceZones(db));
  return 'Z2';
}

export function buildSegmentBar(segs, db) {
  const blocks = [];
  const GAP = { dur: 0, gap: true };

  for (let i = 0; i < segs.length; i++) {
    if (i > 0) blocks.push(GAP); // gap between main segments

    const seg = segs[i];
    const zone = inferZone(seg, db);
    const color = ZONE_COLORS[zone] || ZONE_COLORS.Z2;

    if (seg.mode === 'run-intervals' && seg.reps > 0) {
      const distKm = parseSegDistance(seg.distance) || 0;
      const paceSec = parsePaceToSec(seg.pace) || 300;
      const workSec = distKm > 0 ? distKm * paceSec : (parseSegDuration(seg.duration) || 60);
      const recSec = parseSegDuration(seg.recovery)
        || (parseSegDistance(seg.recovery) * 360)
        || workSec * 0.5;

      for (let r = 0; r < seg.reps; r++) {
        blocks.push({ dur: workSec, color });
        if (r < seg.reps - 1) blocks.push({ dur: recSec, color: ZONE_COLORS.Z1 });
      }
    } else {
      blocks.push({ dur: parseSegDuration(seg.duration) || 60, color });
    }
  }

  const total = blocks.filter(b => !b.gap).reduce((s, b) => s + b.dur, 0);
  return `<div class="run-seg-bar">${blocks.map(b => {
    if (b.gap) return '<div class="run-seg-bar-gap"></div>';
    const pct = (b.dur / total * 100).toFixed(1);
    return `<div class="run-seg-bar-block" style="width:${pct}%;background:${b.color}"></div>`;
  }).join('')}</div>`;
}

export function loadRunSessionTemplate(db, $weekSelect, $sessionSelect, $segments) {
  const progId = db.runningProgram;
  const phases = getRunningPhases(progId);
  const week = phases[$weekSelect.value];
  if (!week) { $segments.innerHTML = ''; return; }

  const sessionName = $sessionSelect.value;
  const segs = week.sessions?.[sessionName];
  if (!segs || segs.length === 0) { $segments.innerHTML = ''; return; }

  $segments.innerHTML = buildSegmentBar(segs, db) + segs.map(seg => {
    const zone = inferZone(seg, db);
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

  $segments.innerHTML += `<button class="btn run-seg-start-btn" id="runSegStartBtn" style="width:100%;margin-top:8px">Iniciar esta sesión</button>`;
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

/** Return the next unfinished plan session for the current week, or null */
export function getNextPlanSession(db) {
  const programs = getRunningProgramList();
  if (!programs.length || !db.runningProgram) return null;

  const phases = getRunningPhases(db.runningProgram);
  const week = phases[db.runningWeek];
  if (!week?.sessions) return null;

  // Get this week's logs (Monday–Sunday)
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().slice(0, 10);

  const weekLogs = (db.runningLogs || []).filter(l => l.date >= mondayStr);
  const doneSessions = new Set(weekLogs.map(l => l.session).filter(Boolean));

  const sessionNames = Object.keys(week.sessions);
  const nextName = sessionNames.find(name => !doneSessions.has(name));
  if (!nextName) return null;

  return {
    name: nextName,
    segments: week.sessions[nextName],
    weekName: week.name || `Semana ${db.runningWeek}`,
    weekKey: db.runningWeek,
    done: doneSessions.size,
    total: sessionNames.length
  };
}
