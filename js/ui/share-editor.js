// ── Share Editor: Canvas-based image generator for sharing ──
import { formatPace, formatRunDuration, RUN_TYPE_META } from './running-helpers.js';
import { formatDate } from '../utils.js';
import { toast } from './toast.js';

// ── State ───────────────────────────────────────────────────
let _data = null;       // normalized data
let _mode = 'running';  // 'running' | 'strength'
let _preset = 'minimal';
let _format = '9:16';
let _theme = 'dark';
let _projected = null;  // cached projected coords
let _onClose = null;

const PREF_KEY = 'areteSharePrefs';
const FONT = "'Inter', -apple-system, system-ui, sans-serif";

// ── Themes ──────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg: ['#0f0f0f', '#1a1a1a', '#0f0f0f'],
    bgFlat: ['#111111', '#111111'],
    bgRoute: ['#0a0a0a', '#111827'],
    text: '#ffffff',
    sub: (o) => `rgba(255,255,255,${o})`,
    accent: '#ff5545',
    card: 'rgba(255,255,255,.05)',
    cardBorder: 'rgba(255,255,255,.08)',
    separator: 'rgba(255,255,255,.25)',
    separatorLight: 'rgba(255,255,255,.06)',
    glowColor: 'rgba(212,55,44,.08)',
    route: '#ff5545',
    routeBg: '#ff5545',
    brandLine: 'rgba(255,255,255,.08)',
    brandText: 'rgba(255,255,255,.2)',
    brandAccent: 'rgba(255,85,69,.3)',
    accentGlow: 'rgba(255,85,69,0.6)',
    glassBg: 'rgba(255,255,255,.05)',
    glassBorder: 'rgba(255,255,255,.10)',
  },
  light: {
    bg: ['#f5f5f7', '#ffffff', '#f5f5f7'],
    bgFlat: ['#ffffff', '#ffffff'],
    bgRoute: ['#f0f0f2', '#e8e8ee'],
    text: '#1d1d1f',
    sub: (o) => `rgba(0,0,0,${o})`,
    accent: '#d4372c',
    card: 'rgba(0,0,0,.04)',
    cardBorder: 'rgba(0,0,0,.08)',
    separator: 'rgba(0,0,0,.15)',
    separatorLight: 'rgba(0,0,0,.06)',
    glowColor: 'rgba(212,55,44,.06)',
    route: '#d4372c',
    routeBg: '#d4372c',
    brandLine: 'rgba(0,0,0,.08)',
    brandText: 'rgba(0,0,0,.2)',
    brandAccent: 'rgba(212,55,44,.35)',
    accentGlow: 'rgba(212,55,44,0.4)',
    glassBg: 'rgba(0,0,0,.04)',
    glassBorder: 'rgba(0,0,0,.10)',
  }
};

// ── Presets ─────────────────────────────────────────────────

const RUN_PRESETS = {
  minimal: { name: 'Minimal' },
  statsPro: { name: 'Stats Pro' },
  routeHero: { name: 'Ruta', needsRoute: true },
};

const STR_PRESETS = {
  minimal: { name: 'Minimal' },
  statsPro: { name: 'Stats Pro' },
};

// ── Douglas-Peucker simplification ─────────────────────────

function _sqDist(p, a, b) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx !== 0 || dy !== 0) {
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    dx = a[0] + t * dx - p[0];
    dy = a[1] + t * dy - p[1];
  } else {
    dx = a[0] - p[0]; dy = a[1] - p[1];
  }
  return dx * dx + dy * dy;
}

function simplifyRoute(coords, tolerance = 0.00005) {
  if (coords.length <= 200) return coords;
  const tol2 = tolerance * tolerance;
  const stack = [[0, coords.length - 1]];
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0, idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = _sqDist(coords[i], coords[start], coords[end]);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tol2) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

// ── GPS projection ──────────────────────────────────────────

function minMax(arr) {
  let min = Infinity, max = -Infinity;
  for (const v of arr) { if (v < min) min = v; if (v > max) max = v; }
  return [min, max];
}

function projectCoords(coords, region, padding) {
  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const [minLat, maxLat] = minMax(lats);
  const [minLng, maxLng] = minMax(lngs);
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const rangeLat = (maxLat - minLat) || 0.001;
  const rangeLng = ((maxLng - minLng) || 0.001) * cosLat;
  const scaleX = (region.w - 2 * padding) / rangeLng;
  const scaleY = (region.h - 2 * padding) / rangeLat;
  const scale = Math.min(scaleX, scaleY);
  const projW = rangeLng * scale;
  const projH = rangeLat * scale;
  const offX = region.x + (region.w - projW) / 2;
  const offY = region.y + (region.h - projH) / 2;
  return coords.map(c => [
    offX + (c[1] - minLng) * cosLat * scale,
    offY + (maxLat - c[0]) * scale
  ]);
}

// ── Normalization ───────────────────────────────────────────

function normalizeRunData(log) {
  return {
    mode: 'running',
    distance: log.distance || 0,
    duration: log.duration || 0,
    pace: log.pace || 0,
    date: log.date || '',
    type: log.type || 'libre',
    session: log.session || '',
    coords: log.route?.coords || [],
    splits: log.splits || [],
    elevation: log.elevation || null,
    hr: log.hr || null,
    hrMax: log.hrMax || null,
    cadence: log.cadence || null,
    distanceStr: log.distance ? log.distance.toFixed(2) : '0',
    durationStr: formatRunDuration(log.duration),
    paceStr: formatPace(log.pace),
    dateStr: _formatDateLong(log.date),
    typeStr: RUN_TYPE_META[log.type]?.label || log.type || '',
  };
}

function normalizeWorkoutData(w) {
  let totalSets = 0, totalVolume = 0;
  for (const ex of (w.exercises || [])) {
    for (const s of (ex.sets || [])) {
      totalSets++;
      totalVolume += (parseFloat(s.kg) || 0) * (parseInt(s.reps) || 0);
    }
  }
  return {
    mode: 'strength',
    date: w.date || '',
    session: w.session || '',
    phase: w.phase || '',
    exercises: w.exercises || [],
    totalSets,
    totalVolume,
    prs: w.prs || [],
    notes: w.notes || '',
    dateStr: _formatDateLong(w.date),
    sessionStr: w.session || 'Entrenamiento',
    volumeStr: totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}t` : `${Math.round(totalVolume)} kg`,
  };
}

function _formatDateLong(d) {
  if (!d) return '';
  try {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return formatDate(d); }
}

// ── Canvas drawing helpers ──────────────────────────────────

function drawBackground(ctx, W, H, colors) {
  const grad = ctx.createLinearGradient(0, 0, W * 0.3, H);
  colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawAccentGlow(ctx, W, H, theme) {
  const t = theme || THEMES.dark;
  const glow = ctx.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, W * 0.8);
  glow.addColorStop(0, t.glowColor);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawRoute(ctx, points, color, lineWidth, glowWidth, opacity) {
  if (!points || points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // glow
  if (glowWidth > 0) {
    ctx.strokeStyle = color.replace(')', ',.3)').replace('rgb(', 'rgba(');
    ctx.lineWidth = glowWidth;
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
    ctx.stroke();
  }
  // main line
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
  ctx.stroke();
  ctx.restore();
}

function drawRouteEndpoints(ctx, points) {
  if (!points || points.length < 2) return;
  const start = points[0], end = points[points.length - 1];
  // Start point (green)
  ctx.beginPath();
  ctx.arc(start[0], start[1], 9, 0, Math.PI * 2);
  ctx.fillStyle = '#30d158';
  ctx.fill();
  // End point (red)
  ctx.beginPath();
  ctx.arc(end[0], end[1], 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ff453a';
  ctx.fill();
}

function drawText(ctx, text, x, y, { size = 16, weight = 400, color = '#fff', align = 'center', spacing = 0, upper = false } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const t = upper ? text.toUpperCase() : text;
  if (spacing > 0) ctx.letterSpacing = `${spacing}em`;
  ctx.fillText(t, x, y);
  if (spacing > 0) ctx.letterSpacing = '0em';
}

function drawFauxItalic(ctx, text, x, y, opts = {}) {
  const skew = opts.skew || -0.15;
  ctx.save();
  ctx.transform(1, 0, skew, 1, 0, 0);
  // Compensate x for the skew displacement at this y
  const adjustedX = x - y * skew;
  drawText(ctx, text, adjustedX, y, opts);
  ctx.restore();
}

function drawTextGlow(ctx, text, x, y, opts = {}) {
  const { glowColor, glowBlur = 30, italic = false, ...rest } = opts;
  ctx.save();
  ctx.shadowColor = glowColor || opts.color || '#fff';
  ctx.shadowBlur = glowBlur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (italic) {
    drawFauxItalic(ctx, text, x, y, rest);
  } else {
    drawText(ctx, text, x, y, rest);
  }
  ctx.restore();
}

function drawGlassPanel(ctx, x, y, w, h, r, theme) {
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = theme.glassBg || theme.card;
  ctx.fill();
  ctx.strokeStyle = theme.glassBorder || theme.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawPillBadge(ctx, text, cx, y, theme) {
  ctx.font = `700 26px ${FONT}`;
  const tw = ctx.measureText(text.toUpperCase()).width;
  const pillW = tw + 48, pillH = 44, pillR = pillH / 2;
  const px = cx - pillW / 2;
  drawRoundedRect(ctx, px, y, pillW, pillH, pillR);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  drawText(ctx, text, cx, y + pillH / 2, { size: 26, weight: 700, color: '#ffffff', upper: true, spacing: 0.05 });
}

function drawBrandingTopRight(ctx, W, theme) {
  ctx.save();
  const skew = -0.15;
  ctx.transform(1, 0, skew, 1, 0, 0);
  const y = 52;
  const x = W - 60 - y * skew;
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '0.08em';
  ctx.fillText('ARETÉ', x, y);
  ctx.letterSpacing = '0em';
  ctx.restore();
}

function drawBranding(ctx, W, y, theme) {
  const t = theme || THEMES.dark;
  // Line decoration
  ctx.strokeStyle = t.brandLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 28, y - 18);
  ctx.lineTo(W / 2 + 28, y - 18);
  ctx.stroke();
  // ARETÉ
  drawText(ctx, 'ARETÉ', W / 2, y, { size: 18, weight: 700, color: t.brandAccent, spacing: 0.2, upper: true, align: 'center' });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ── Running presets rendering ───────────────────────────────

function renderMinimal(ctx, W, H, data, theme) {
  const t = theme;
  drawBackground(ctx, W, H, t.bg);
  drawAccentGlow(ctx, W, H, t);

  // Route as subtle background decoration
  if (data.coords.length > 1) {
    const simplified = simplifyRoute(data.coords);
    const region = { x: W * 0.05, y: H * 0.1, w: W * 0.9, h: H * 0.6 };
    const pts = projectCoords(simplified, region, 40);
    drawRoute(ctx, pts, t.routeBg, 1.5, 6, 0.10);
  }

  const is916 = H > 1200;

  // Brand top-right
  drawBrandingTopRight(ctx, W, t);

  // Date glass pill top-left
  const meta = [data.dateStr, data.typeStr].filter(Boolean).join('  ·  ');
  if (meta) {
    ctx.font = `600 20px ${FONT}`;
    const mw = ctx.measureText(meta).width;
    drawGlassPanel(ctx, 40, 36, mw + 40, 40, 20, t);
    drawText(ctx, meta, 60, 56, { size: 20, weight: 600, color: t.sub(.5), align: 'left' });
  }

  // Distance HERO - faux italic + glow
  const heroY = is916 ? H * 0.38 : H * 0.36;
  const heroSize = is916 ? 360 : 280;
  drawTextGlow(ctx, data.distanceStr, W / 2, heroY, {
    size: heroSize, weight: 900, color: t.text, italic: true,
    glowColor: t.sub(.15), glowBlur: 40
  });

  // "KILÓMETROS" label in accent
  const kmY = heroY + (is916 ? 190 : 150);
  drawFauxItalic(ctx, 'KILÓMETROS', W / 2, kmY, { size: 72, weight: 700, color: t.accent, upper: true, spacing: 0.08 });

  // Time block
  const timeY = kmY + (is916 ? 140 : 110);
  drawText(ctx, 'TIEMPO', W / 2, timeY, { size: 24, weight: 600, color: t.sub(.4), upper: true, spacing: 0.25 });
  drawTextGlow(ctx, data.durationStr, W / 2, timeY + 70, {
    size: 96, weight: 900, color: t.text, italic: true,
    glowColor: t.sub(.1), glowBlur: 20
  });

  // Pace block - in RED with glow
  const paceY = timeY + (is916 ? 180 : 150);
  drawText(ctx, 'RITMO', W / 2, paceY, { size: 24, weight: 600, color: t.sub(.4), upper: true, spacing: 0.25 });
  drawTextGlow(ctx, data.paceStr + '/km', W / 2, paceY + 70, {
    size: 96, weight: 900, color: t.accent, italic: true,
    glowColor: t.accentGlow, glowBlur: 25
  });

  drawBranding(ctx, W, H * (is916 ? 0.94 : 0.92), t);
}

function renderStatsPro(ctx, W, H, data, theme) {
  const t = theme;
  drawBackground(ctx, W, H, t.bgFlat);

  // Route as subtle background decoration
  if (data.coords?.length > 1) {
    const simplified = simplifyRoute(data.coords);
    const region = { x: W * 0.05, y: H * 0.25, w: W * 0.9, h: H * 0.45 };
    const pts = projectCoords(simplified, region, 50);
    drawRoute(ctx, pts, t.route, 1.5, 6, 0.08);
  }

  const pad = 60;
  const is916 = H > 1200;
  let y = pad;

  // Brand top-right
  drawBrandingTopRight(ctx, W, t);

  // Date in accent
  drawText(ctx, data.dateStr?.toUpperCase?.() || '', pad, y + 10, { size: 24, weight: 700, color: t.accent, align: 'left' });
  y += 34;
  drawText(ctx, data.typeStr, pad, y + 10, { size: 18, weight: 600, color: t.sub(.5), align: 'left', upper: true, spacing: 0.1 });
  y += 54;

  // Distance hero glass card
  drawGlassPanel(ctx, pad, y, W - 2 * pad, 220, 20, t);
  drawTextGlow(ctx, data.distanceStr, W / 2, y + 90, {
    size: 120, weight: 900, color: t.text, italic: true,
    glowColor: t.sub(.08), glowBlur: 30
  });
  drawFauxItalic(ctx, 'KM', W / 2, y + 170, { size: 32, weight: 700, color: t.accent, spacing: 0.15 });
  y += 240;

  // Stat grid (2 columns) - glass panels with accent labels
  const stats = [
    { val: data.durationStr, label: 'TIEMPO' },
    { val: data.paceStr, label: '/KM' },
  ];
  if (data.hr) stats.push({ val: `${data.hr}`, label: 'BPM AVG' });
  if (data.cadence) stats.push({ val: `${data.cadence}`, label: 'PPM' });
  if (data.elevation) stats.push({ val: `${Math.round(data.elevation)}`, label: 'D+ M' });
  if (data.hrMax) stats.push({ val: `${data.hrMax}`, label: 'BPM MAX' });

  const cols = 2;
  const cardW = (W - 2 * pad - 14) / cols;
  const cardH = 140;
  for (let i = 0; i < stats.length && i < 6; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = pad + col * (cardW + 14);
    const cy = y + row * (cardH + 12);
    drawGlassPanel(ctx, cx, cy, cardW, cardH, 16, t);
    drawFauxItalic(ctx, stats[i].val, cx + cardW / 2, cy + 55, { size: 64, weight: 900, color: t.text });
    drawText(ctx, stats[i].label, cx + cardW / 2, cy + 112, { size: 22, weight: 700, color: t.accent, spacing: 0.12 });
  }
  y += Math.ceil(stats.length / cols) * (cardH + 12) + 24;

  // Vertical splits bar chart (only in 9:16 and if available)
  if (is916 && data.splits?.length > 0) {
    drawGlassPanel(ctx, pad, y, W - 2 * pad, 340, 24, t);
    const panelPad = 24;
    const innerX = pad + panelPad;
    const innerW = W - 2 * pad - 2 * panelPad;

    drawText(ctx, 'PERFORMANCE SPLITS', innerX, y + 28, { size: 20, weight: 700, color: t.sub(.4), align: 'left', spacing: 0.15 });

    const maxSplits = Math.min(data.splits.length, 12);
    const fastestPace = Math.min(...data.splits.slice(0, maxSplits).map(s => s.pace || Infinity));
    const slowestPace = Math.max(...data.splits.slice(0, maxSplits).map(s => s.pace || 0));

    const barGap = 8;
    const barW = (innerW - (maxSplits - 1) * barGap) / maxSplits;
    const barMaxH = 220;
    const barBaseY = y + 300;

    for (let i = 0; i < maxSplits; i++) {
      const sp = data.splits[i];
      const pct = slowestPace > fastestPace ? 1 - (sp.pace - fastestPace) / (slowestPace - fastestPace) : 1;
      const barH = Math.max(20, 0.3 * barMaxH + pct * 0.7 * barMaxH);
      const bx = innerX + i * (barW + barGap);
      const by = barBaseY - barH;
      const isFastest = sp.pace === fastestPace;

      drawRoundedRect(ctx, bx, by, barW, barH, 3);
      if (isFastest) {
        // Fastest bar in accent with glow
        ctx.save();
        ctx.shadowColor = t.accentGlow;
        ctx.shadowBlur = 15;
        ctx.fillStyle = t.accent;
        ctx.fill();
        ctx.restore();
        // Pace label above
        drawText(ctx, formatPace(sp.pace), bx + barW / 2, by - 16, { size: 18, weight: 700, color: t.accent });
      } else {
        ctx.fillStyle = t.sub(.12);
        ctx.fill();
      }
    }
    y += 350;
  }

  drawBranding(ctx, W, H * (is916 ? 0.94 : 0.92), t);
}

function renderRouteHero(ctx, W, H, data, theme) {
  const t = theme;
  drawBackground(ctx, W, H, t.bgRoute);

  // Subtle accent glow centered on route
  const glow = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, W * 0.6);
  glow.addColorStop(0, t.glowColor);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const is916 = H > 1200;

  // Brand top-right
  drawBrandingTopRight(ctx, W, t);

  // Date glass pill top-left
  const dateStr = data.dateStr?.toUpperCase?.() || '';
  if (dateStr) {
    ctx.font = `600 20px ${FONT}`;
    const dtw = ctx.measureText(dateStr).width;
    drawGlassPanel(ctx, 40, 36, dtw + 40, 40, 20, t);
    drawText(ctx, dateStr, 60, 56, { size: 20, weight: 600, color: t.sub(.5), align: 'left' });
  }

  // Route
  if (data.coords.length > 1) {
    const simplified = simplifyRoute(data.coords);
    const routeH = is916 ? H * 0.55 : H * 0.60;
    const region = { x: 0, y: H * 0.08, w: W, h: routeH };
    const pts = projectCoords(simplified, region, 60);
    drawRoute(ctx, pts, t.route, 5, 16, 1);
    drawRouteEndpoints(ctx, pts);
    _projected = pts;
  }

  // Stats glass bar at bottom
  const barH = 200;
  const barPad = 40;
  const barY = is916 ? H * 0.74 : H * 0.68;
  drawGlassPanel(ctx, barPad, barY, W - 2 * barPad, barH, 24, t);

  const fields = [
    { val: data.distanceStr, label: 'km', isAccent: true },
    { val: data.durationStr, label: 'tiempo', isAccent: false },
    { val: data.paceStr, label: '/km', isAccent: true },
  ];
  const fw = (W - 2 * barPad) / fields.length;
  fields.forEach((f, i) => {
    const fx = barPad + fw * i + fw / 2;
    const valColor = (i === 2) ? t.accent : t.text; // pace in red
    if (i === 2) {
      drawTextGlow(ctx, f.val, fx, barY + 72, { size: 56, weight: 900, color: valColor, italic: true, glowColor: t.accentGlow, glowBlur: 20 });
    } else {
      drawFauxItalic(ctx, f.val, fx, barY + 72, { size: i === 0 ? 72 : 56, weight: 900, color: valColor });
    }
    drawText(ctx, f.label, fx, barY + 130, { size: 20, weight: 600, color: f.isAccent ? t.accent : t.sub(.4), upper: true, spacing: 0.12 });
    // separator
    if (i < fields.length - 1) {
      ctx.fillStyle = t.sub(.1);
      ctx.fillRect(barPad + fw * (i + 1), barY + 40, 1, barH - 80);
    }
  });

  drawBranding(ctx, W, is916 ? H * 0.96 : H * 0.93, t);
}

// ── Strength presets rendering ──────────────────────────────

function renderMinimalStrength(ctx, W, H, data, theme) {
  const t = theme;
  drawBackground(ctx, W, H, t.bg);
  drawAccentGlow(ctx, W, H, t);

  const is916 = H > 1200;
  const pad = 60;

  // Brand top-right
  drawBrandingTopRight(ctx, W, t);

  // PR pill badge (if any)
  let headerY = 120;
  if (data.prs?.length > 0) {
    drawPillBadge(ctx, `${data.prs.length} PR batido${data.prs.length > 1 ? 's' : ''}`, W / 2, headerY - 22, t);
    headerY += 50;
  }

  // Session name HERO - faux italic + glow
  const name = data.sessionStr || 'Entrenamiento';
  const nameSize = name.length > 15 ? (is916 ? 96 : 80) : (is916 ? 140 : 110);
  drawTextGlow(ctx, name, W / 2, headerY + 60, {
    size: nameSize, weight: 900, color: t.text, italic: true,
    glowColor: t.sub(.1), glowBlur: 30
  });

  // Date below name
  const dateY = headerY + 60 + (nameSize > 100 ? 85 : 65);
  drawText(ctx, data.dateStr || '', W / 2, dateY, { size: 24, weight: 500, color: t.sub(.35) });

  // Exercises as glass cards
  const exStartY = dateY + (is916 ? 80 : 60);
  const maxEx = is916 ? 7 : 5;
  const cardH = 90;
  const cardGap = 12;

  for (let i = 0; i < Math.min(data.exercises.length, maxEx); i++) {
    const ex = data.exercises[i];
    const ey = exStartY + i * (cardH + cardGap);
    const isPR = data.prs?.some(p => p.exercise === ex.name);

    // Glass card
    drawGlassPanel(ctx, pad, ey, W - 2 * pad, cardH, 16, t);

    // Exercise name (left)
    drawText(ctx, ex.name, pad + 30, ey + 35, {
      size: 36, weight: 700, color: isPR ? t.accent : t.text, align: 'left'
    });

    // Best set (right) - "80 kg × 5"
    const bestSet = ex.sets?.reduce((a, b) =>
      (parseFloat(b.kg) || 0) > (parseFloat(a.kg) || 0) ? b : a, ex.sets[0]);
    if (bestSet && (parseFloat(bestSet.kg) || 0) > 0) {
      const rx = W - pad - 30;
      drawFauxItalic(ctx, `${bestSet.kg}`, rx - 120, ey + 35, { size: 36, weight: 900, color: t.text, align: 'right' });
      drawText(ctx, 'kg', rx - 60, ey + 35, { size: 28, weight: 700, color: t.accent, align: 'center' });
      drawFauxItalic(ctx, `×${bestSet.reps}`, rx, ey + 35, { size: 28, weight: 500, color: t.sub(.6), align: 'right' });
    }

    // PR indicator
    if (isPR) {
      drawText(ctx, 'PR', pad + 30, ey + 68, { size: 18, weight: 700, color: t.accent, align: 'left', spacing: 0.1 });
    }
  }
  if (data.exercises.length > maxEx) {
    const overY = exStartY + maxEx * (cardH + cardGap) + 10;
    drawText(ctx, `+${data.exercises.length - maxEx} más`, W / 2, overY, {
      size: 22, weight: 500, color: t.sub(.3)
    });
  }

  drawBranding(ctx, W, H * (is916 ? 0.94 : 0.92), t);
}

function renderStatsStrength(ctx, W, H, data, theme) {
  const t = theme;
  drawBackground(ctx, W, H, t.bgFlat);

  const pad = 60;
  const is916 = H > 1200;
  let y = pad;

  // Brand top-right
  drawBrandingTopRight(ctx, W, t);

  // Date + session
  drawText(ctx, data.dateStr?.toUpperCase?.() || '', pad, y + 10, { size: 24, weight: 700, color: t.accent, align: 'left' });
  y += 34;
  drawFauxItalic(ctx, data.sessionStr, pad, y + 10, { size: 44, weight: 800, color: t.text, align: 'left' });
  y += 56;

  // Bento grid summary (3 columns)
  const bentoGap = 14;
  const bentoW = (W - 2 * pad - 2 * bentoGap) / 3;
  const bentoH = 120;
  const bentoItems = [
    { val: `${data.totalSets}`, label: 'SERIES' },
    { val: data.volumeStr, label: 'VOLUMEN' },
    { val: `${data.prs?.length || 0}`, label: 'PRs' },
  ];
  for (let i = 0; i < 3; i++) {
    const bx = pad + i * (bentoW + bentoGap);
    drawGlassPanel(ctx, bx, y, bentoW, bentoH, 16, t);
    drawText(ctx, bentoItems[i].label, bx + bentoW / 2, y + 30, { size: 22, weight: 700, color: t.accent, spacing: 0.1 });
    drawFauxItalic(ctx, bentoItems[i].val, bx + bentoW / 2, y + 78, { size: 52, weight: 900, color: t.text });
  }
  y += bentoH + 30;

  // Exercises section
  drawText(ctx, 'EJERCICIOS', pad, y + 8, { size: 20, weight: 700, color: t.sub(.4), align: 'left', spacing: 0.15 });
  y += 42;

  const maxEx = is916 ? 7 : 5;
  for (let i = 0; i < Math.min(data.exercises.length, maxEx); i++) {
    const ex = data.exercises[i];
    const isPR = data.prs?.some(p => p.exercise === ex.name);

    // Glass card for each exercise
    const setsStr = ex.sets.map(s => `${s.kg || 0}kg × ${s.reps || 0}`).join('  ·  ');
    const exCardH = 100;
    drawGlassPanel(ctx, pad, y, W - 2 * pad, exCardH, 16, t);

    // Exercise name + PR label
    drawText(ctx, ex.name, pad + 24, y + 32, {
      size: 30, weight: 700, color: isPR ? t.accent : t.text, align: 'left'
    });
    if (isPR) {
      ctx.font = `700 30px ${FONT}`;
      const nameW = ctx.measureText(ex.name).width;
      drawText(ctx, 'PR', pad + 24 + nameW + 16, y + 32, {
        size: 22, weight: 800, color: t.accent, align: 'left', spacing: 0.05
      });
    }

    // Sets row
    drawText(ctx, setsStr, pad + 24, y + 70, { size: 24, weight: 500, color: t.sub(.55), align: 'left' });
    y += exCardH + 10;
  }

  drawBranding(ctx, W, H * (is916 ? 0.94 : 0.92), t);
}

// ── Main render ─────────────────────────────────────────────

async function renderToCanvas() {
  const canvas = document.getElementById('seCanvas');
  if (!canvas || !_data) return;
  const ctx = canvas.getContext('2d');
  const W = 1080;
  const H = _format === '9:16' ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;

  // Ensure font is loaded
  if (document.fonts) {
    try { await document.fonts.load(`800 72px ${FONT}`); } catch {}
  }

  _projected = null;
  const theme = THEMES[_theme] || THEMES.dark;

  if (_mode === 'running') {
    if (_preset === 'minimal') renderMinimal(ctx, W, H, _data, theme);
    else if (_preset === 'statsPro') renderStatsPro(ctx, W, H, _data, theme);
    else if (_preset === 'routeHero') renderRouteHero(ctx, W, H, _data, theme);
  } else {
    if (_preset === 'minimal') renderMinimalStrength(ctx, W, H, _data, theme);
    else if (_preset === 'statsPro') renderStatsStrength(ctx, W, H, _data, theme);
  }
}

// ── Export ───────────────────────────────────────────────────

async function exportImage() {
  const canvas = document.getElementById('seCanvas');
  const btn = document.getElementById('seShareBtn');
  if (!canvas || !btn) return;

  btn.disabled = true;
  btn.textContent = 'Exportando...';

  try {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { toast('Error al generar imagen', 'error'); return; }

    const date = _data?.date || new Date().toISOString().slice(0, 10);
    const prefix = _mode === 'running' ? 'run' : 'workout';
    const fileName = `arete-${prefix}-${date}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: _mode === 'running' ? 'Mi carrera — Areté' : 'Mi entreno — Areté' });
      } catch (e) {
        if (e.name !== 'AbortError') toast('Error al compartir', 'error');
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast('Imagen descargada');
    }
  } catch (e) {
    toast('Error al generar imagen', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">share</span> Compartir';
  }
}

// ── Preferences ─────────────────────────────────────────────

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}

function savePrefs() {
  localStorage.setItem(PREF_KEY, JSON.stringify({ preset: _preset, format: _format, theme: _theme }));
}

// ── UI ──────────────────────────────────────────────────────

let _bound = false;

function _bindUI() {
  if (_bound) return;
  _bound = true;

  document.getElementById('seCloseBtn').addEventListener('click', closeShareEditor);
  document.getElementById('seShareBtn').addEventListener('click', exportImage);

  // Format toggle
  document.querySelectorAll('.se-format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.se-format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _format = btn.dataset.format;
      savePrefs();
      renderToCanvas();
    });
  });

  // Theme toggle
  document.querySelectorAll('.se-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.se-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _theme = btn.dataset.theme;
      savePrefs();
      renderToCanvas();
    });
  });

  // Preset chips
  document.querySelectorAll('.se-preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.se-preset-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _preset = btn.dataset.preset;
      savePrefs();
      renderToCanvas();
    });
  });

  // Close on backdrop click
  document.getElementById('shareEditor').addEventListener('click', (e) => {
    if (e.target.id === 'shareEditor') closeShareEditor();
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('shareEditor')?.classList.contains('open')) {
      closeShareEditor();
    }
  });
}

function _updatePresetChips() {
  const presets = _mode === 'running' ? RUN_PRESETS : STR_PRESETS;
  const hasRoute = _data?.coords?.length > 1;

  document.querySelectorAll('.se-preset-chip').forEach(btn => {
    const key = btn.dataset.preset;
    const presetDef = presets[key];
    if (!presetDef) {
      btn.classList.add('hidden');
      return;
    }
    if (presetDef.needsRoute && !hasRoute) {
      btn.classList.add('hidden');
      // If this was selected, fallback to minimal
      if (_preset === key) {
        _preset = 'minimal';
        document.querySelector('.se-preset-chip[data-preset="minimal"]')?.classList.add('active');
      }
      return;
    }
    btn.classList.remove('hidden');
    btn.textContent = presetDef.name;
  });

  // Ensure active state is correct
  document.querySelectorAll('.se-preset-chip').forEach(b => b.classList.toggle('active', b.dataset.preset === _preset));
}

// ── Public API ──────────────────────────────────────────────

export function openShareEditor(logData, options = {}) {
  _mode = options.mode || 'running';
  _onClose = options.onClose || null;

  if (_mode === 'running') {
    _data = normalizeRunData(logData);
  } else {
    _data = normalizeWorkoutData(logData);
  }

  // Restore prefs
  const prefs = loadPrefs();
  const presets = _mode === 'running' ? RUN_PRESETS : STR_PRESETS;
  _preset = (prefs.preset && presets[prefs.preset]) ? prefs.preset : 'minimal';
  _format = prefs.format || '9:16';
  _theme = (prefs.theme && THEMES[prefs.theme]) ? prefs.theme : 'dark';

  // Validate Route Hero availability
  if (_preset === 'routeHero' && (!_data.coords || _data.coords.length < 2)) {
    _preset = 'minimal';
  }

  _bindUI();

  // Set active states
  document.querySelectorAll('.se-format-btn').forEach(b => b.classList.toggle('active', b.dataset.format === _format));
  document.querySelectorAll('.se-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === _theme));
  _updatePresetChips();

  // Show overlay
  const overlay = document.getElementById('shareEditor');
  overlay.classList.add('open');

  // Show loading, render, hide loading
  const loading = document.getElementById('seLoading');
  loading.classList.remove('hidden');
  renderToCanvas().then(() => loading.classList.add('hidden'));
}

export function closeShareEditor() {
  const overlay = document.getElementById('shareEditor');
  if (overlay) overlay.classList.remove('open');
  _data = null;
  _projected = null;
  _onClose?.();
}
