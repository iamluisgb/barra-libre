import { formatDate } from '../utils.js';
import { formatPace } from './running-helpers.js';

// ── Progress charts ─────────────────────────────────────

let _lastLogCount = -1;

export function renderRunProgress(db, $weeklyChart, $paceChart, $statsPanel) {
  const logs = (db.runningLogs || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  // Skip re-render if log count hasn't changed
  if (logs.length === _lastLogCount && logs.length > 0) return;
  _lastLogCount = logs.length;

  if (logs.length === 0) {
    $weeklyChart.innerHTML = '<div class="empty-state">Sin datos</div>';
    $paceChart.innerHTML = '';
    $statsPanel.innerHTML = '';
    return;
  }

  renderWeeklyChart(logs, $weeklyChart);
  renderPaceChart(logs, $paceChart);
  renderStats(logs, $statsPanel);
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function renderWeeklyChart(logs, $weeklyChart) {
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

function renderPaceChart(logs, $paceChart) {
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

function renderStats(logs, $statsPanel) {
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
