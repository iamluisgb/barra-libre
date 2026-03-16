// ── Running constants and helpers ────────────────────────

export const ZONE_COLORS = { Z1: '#999', Z2: '#34c759', Z3: '#ff9f0a', Z4: '#ff6b35', Z5: '#ff3b30' };
export const ZONE_LABELS = { Z1: 'Recuperacion', Z2: 'Aerobico', Z3: 'Tempo', Z4: 'Umbral', Z5: 'VAM/VO2max' };

// ── VDOT-based pace zones (Jack Daniels) ─────────────────

const DEFAULT_PACE_ZONES = [
  { zone: 'Z5', max: 280 },
  { zone: 'Z4', max: 310 },
  { zone: 'Z3', max: 360 },
  { zone: 'Z2', max: 420 },
  { zone: 'Z1', max: Infinity }
];

/** @deprecated Use getPaceZones(db) instead */
export const PACE_ZONES = DEFAULT_PACE_ZONES;

function calcVDOT(distMeters, timeSec) {
  const T = timeSec / 60;
  const V = distMeters / T;
  const o2cost = -4.60 + 0.182258 * V + 0.000104 * V * V;
  const pctVO2 = 0.8 + 0.1894393 * Math.exp(-0.012778 * T)
                     + 0.2989558 * Math.exp(-0.1932605 * T);
  return o2cost / pctVO2;
}

function velocityAtVO2(targetVO2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - targetVO2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 200; // fallback ~5:00/km
  return (-b + Math.sqrt(disc)) / (2 * a);
}

function paceAtPct(vdot, pct) {
  const vel = velocityAtVO2(vdot * pct);
  return vel > 0 ? 1000 / vel * 60 : 600;
}

export function calcPaceZones(raceDistM, raceTimeSec) {
  const vdot = calcVDOT(raceDistM, raceTimeSec);
  return [
    { zone: 'Z5', max: Math.round(paceAtPct(vdot, 1.00)) },
    { zone: 'Z4', max: Math.round(paceAtPct(vdot, 0.88)) },
    { zone: 'Z3', max: Math.round(paceAtPct(vdot, 0.84)) },
    { zone: 'Z2', max: Math.round(paceAtPct(vdot, 0.74)) },
    { zone: 'Z1', max: Infinity }
  ];
}

export function getPaceZones(db) {
  const race5k = db?.settings?.race5k;
  if (race5k && race5k > 0) return calcPaceZones(5000, race5k);
  return DEFAULT_PACE_ZONES;
}

export const RUN_TYPE_META = {
  libre:       { label: 'Libre',       desc: 'Sin estructura, corre a tu ritmo',     zone: null },
  rodaje:      { label: 'Rodaje',      desc: 'Carrera suave en zona aerobica',       zone: 'Z2' },
  intervalos:  { label: 'Intervalos',  desc: 'Series de alta intensidad',            zone: 'Z5' },
  tempo:       { label: 'Tempo',       desc: 'Ritmo sostenido en zona umbral',       zone: 'Z3' },
  fartlek:     { label: 'Fartlek',     desc: 'Cambios de ritmo libres',              zone: null },
  cuestas:     { label: 'Cuestas',     desc: 'Trabajo de fuerza en pendiente',       zone: 'Z4' },
  competicion: { label: 'Competicion', desc: 'Carrera con distancia objetivo',        zone: null }
};

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

export function estimateZone(pace, zones) {
  if (!pace || pace <= 0) return 'Z2';
  const pz = zones || DEFAULT_PACE_ZONES;
  for (const z of pz) {
    if (pace < z.max) return z.zone;
  }
  return 'Z1';
}

export function parseSegDistance(str) {
  if (!str) return 0;
  const m = String(str).match(/([\d.]+)\s*(km|m)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  if (isNaN(val)) return 0;
  return m[2].toLowerCase() === 'km' ? val : val / 1000;
}

export function parseSegDuration(str) {
  if (!str) return 0;
  str = String(str).toLowerCase().trim();
  let m = str.match(/^(\d+)h(\d+)?$/);
  if (m) return parseInt(m[1]) * 3600 + (parseInt(m[2]) || 0) * 60;
  m = str.match(/^(\d+)\s*min$/);
  if (m) return parseInt(m[1]) * 60;
  return 0;
}

export function segModeToRunType(seg) {
  if (seg.mode === 'run-intervals') return 'intervalos';
  if (seg.zone === 'Z3' || seg.zone === 'Z4') return 'tempo';
  return 'rodaje';
}
