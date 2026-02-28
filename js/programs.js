let ALL_PROGRAMS = {};
let BUILTIN_IDS = new Set();
let activeProgram = 'barraLibre';
let BODY_MEASURES = [];

const CUSTOM_KEY = 'customPrograms';
const VALID_MODES = new Set(['sets', 'result', 'interval', 'tabata', 'rounds', 'ladder', 'pyramid', 'amrap', 'emom', 'superset']);

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
  BUILTIN_IDS = new Set(Object.keys(ALL_PROGRAMS));

  // Load custom programs from localStorage
  for (const cp of getCustomPrograms()) {
    ALL_PROGRAMS[cp._customId] = cp;
  }
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

/** @returns {boolean} Whether a program ID is built-in (not custom) */
export function isBuiltinProgram(id) { return BUILTIN_IDS.has(id); }

/** @returns {Array} Custom programs stored in localStorage */
export function getCustomPrograms() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; }
  catch { return []; }
}

/** Validate that a JSON object is a valid program */
export function validateProgram(data) {
  if (!data || typeof data !== 'object') return 'El archivo no contiene un objeto JSON válido';
  if (!data._meta?.name) return 'Falta _meta.name (nombre del programa)';
  const phases = Object.keys(data).filter(k => k !== '_meta');
  if (phases.length === 0) return 'El programa necesita al menos una fase (ej: "1": { ... })';
  for (const k of phases) {
    const phase = data[k];
    if (!phase.sessions || typeof phase.sessions !== 'object') return `Fase "${k}" no tiene sessions`;
    for (const [sName, exercises] of Object.entries(phase.sessions)) {
      if (!Array.isArray(exercises)) return `Sesión "${sName}" de fase "${k}" no es un array`;
      for (const ex of exercises) {
        if (!ex.name) return `Un ejercicio en "${sName}" no tiene nombre`;
        if (ex.mode && !VALID_MODES.has(ex.mode)) return `Modo "${ex.mode}" no es válido en "${ex.name}"`;
      }
    }
  }
  return null; // null = valid
}

/** Import a custom program and persist to localStorage */
export function importCustomProgram(data) {
  const slug = data._meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const id = `custom_${slug}_${Date.now()}`;
  data._customId = id;

  const list = getCustomPrograms();
  list.push(data);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));

  ALL_PROGRAMS[id] = data;
  return id;
}

/** Delete a custom program by ID */
export function deleteCustomProgram(id) {
  const list = getCustomPrograms().filter(p => p._customId !== id);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  delete ALL_PROGRAMS[id];

  if (activeProgram === id) {
    activeProgram = 'barraLibre';
  }
}
