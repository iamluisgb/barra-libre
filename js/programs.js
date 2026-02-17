let ALL_PROGRAMS = {};
let activeProgram = 'barraLibre';
let BODY_MEASURES = [];

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return r.json();
  } catch {}
  // Offline fallback: try cache directly
  const cached = await caches.match(url);
  if (cached) return cached.json();
  return null;
}

export async function loadPrograms() {
  const index = await fetchJSON('programs.json');
  if (!index) return;

  BODY_MEASURES = index.bodyMeasures || [];

  const entries = await Promise.all(
    (index.catalog || []).map(async p => {
      const data = await fetchJSON(p.file);
      return data ? [p.id, data] : null;
    })
  );

  ALL_PROGRAMS = Object.fromEntries(entries.filter(Boolean));
}

export function setActiveProgram(id) { activeProgram = id; }
export function getActiveProgram() { return activeProgram; }

export function getPrograms() {
  const prog = ALL_PROGRAMS[activeProgram];
  if (!prog) return {};
  const { _meta, ...phases } = prog;
  return phases;
}

export function getProgramList() {
  return Object.entries(ALL_PROGRAMS).map(([id, p]) => ({
    id, name: p._meta?.name || id, desc: p._meta?.desc || ''
  }));
}

export function getBodyMeasures() {
  return BODY_MEASURES;
}

export function getAllPhases() {
  const progs = getPrograms();
  return Object.keys(progs).map(k => ({
    id: parseInt(k),
    name: progs[k].name || `Fase ${k}`,
    desc: progs[k].desc || ''
  }));
}
