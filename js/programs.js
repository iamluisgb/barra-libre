let ALL_PROGRAMS = {};
let activeProgram = 'barraLibre';
let BODY_MEASURES = [];

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (r.ok) return r.json();
  } catch (e) { console.warn('fetchJSON failed:', url, e); }
  // Offline fallback: try cache directly
  const cached = await caches.match(url);
  if (cached) return cached.json();
  return null;
}

/** Fetch program catalog + body measures from JSON config */
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

/** @param {string} id - Program identifier */
export function setActiveProgram(id) { activeProgram = id; }
/** @returns {string} Current active program ID */
export function getActiveProgram() { return activeProgram; }

/** @returns {Object} Phases/sessions for the active program */
export function getPrograms() {
  const prog = ALL_PROGRAMS[activeProgram];
  if (!prog) return {};
  const { _meta, ...phases } = prog;
  return phases;
}

/** @returns {Array<{id:string, name:string, desc:string}>} All available programs */
export function getProgramList() {
  return Object.entries(ALL_PROGRAMS).map(([id, p]) => ({
    id, name: p._meta?.name || id, desc: p._meta?.desc || ''
  }));
}

/** @returns {Array<{id:string, label:string}>} Body measure definitions */
export function getBodyMeasures() {
  return BODY_MEASURES;
}

/** @returns {Array<{id:number, name:string, desc:string}>} Phases for active program */
export function getAllPhases() {
  const progs = getPrograms();
  return Object.keys(progs).map(k => ({
    id: parseInt(k),
    name: progs[k].name || `Fase ${k}`,
    desc: progs[k].desc || ''
  }));
}
