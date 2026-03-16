import { esc, formatDate } from '../utils.js';
import { toast } from './toast.js';
import { formatPace, formatRunDuration, ZONE_COLORS } from './running-helpers.js';

// ── History rendering ───────────────────────────────────

export function renderRunHistory(db, $historyFilter, $historyList) {
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

  renderMiniMaps();
}

let _mapObserver = null;

function renderMiniMaps() {
  // Lazy-render mini maps as they scroll into view
  if (!_mapObserver) {
    _mapObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target;
        _mapObserver.unobserve(canvas);
        try {
          const coords = JSON.parse(canvas.dataset.coords || '[]');
          if (coords.length >= 2) drawMiniRoute(canvas, coords);
        } catch (e) { /* skip */ }
      }
    }, { rootMargin: '100px' });
  }
  document.querySelectorAll('.run-hist-minimap canvas').forEach(canvas => {
    _mapObserver.observe(canvas);
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

export async function shareRunCard() {
  const card = document.getElementById('runShareCard');
  const mapEl = document.getElementById('runDetailMap');
  const mapDisplay = mapEl.style.display;
  mapEl.style.display = 'none';
  try {
    const canvas = await html2canvas(card, { backgroundColor: '#f0f2f8', scale: 3, useCORS: true, logging: false });
    mapEl.style.display = mapDisplay;
    canvas.toBlob(async blob => {
      if (!blob) { toast('Error al generar imagen', 'error'); return; }
      const file = new File([blob], 'run.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi carrera — Barra Libre' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'barra-libre-run-' + new Date().toISOString().slice(0, 10) + '.png';
        a.click(); URL.revokeObjectURL(url);
      }
    }, 'image/png');
  } catch (e) {
    mapEl.style.display = mapDisplay;
    toast('Error al generar imagen', 'error');
  }
}
