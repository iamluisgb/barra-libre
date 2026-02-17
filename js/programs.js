let ALL_PROGRAMS = {};
let activeProgram = 'barraLibre';
let BODY_MEASURES = [];

export async function loadPrograms() {
  const [base, kb] = await Promise.all([
    fetch('programs.json').then(r => r.json()),
    fetch('kettlebell.json').then(r => r.json())
  ]);

  BODY_MEASURES = base.bodyMeasures || [];
  delete base.bodyMeasures;
  delete base._meta;

  const kbMeta = kb._meta;
  delete kb._meta;

  const custom = JSON.parse(localStorage.getItem('bl_custom_programs') || '{}');

  ALL_PROGRAMS = {
    barraLibre: { _meta: { name: 'Barra Libre', desc: 'Fuerza · Hipertrofia · Definición' }, ...base, ...custom },
    kettlebell: { _meta: kbMeta, ...kb }
  };
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
