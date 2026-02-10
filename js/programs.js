let PROGRAMS = {};
let BODY_MEASURES = [];

export async function loadPrograms() {
  const res = await fetch('programs.json');
  const base = await res.json();

  BODY_MEASURES = base.bodyMeasures || [];
  delete base.bodyMeasures;

  const custom = JSON.parse(localStorage.getItem('bl_custom_programs') || '{}');
  PROGRAMS = { ...base, ...custom };
  return PROGRAMS;
}

export function getPrograms() {
  return PROGRAMS;
}

export function getBodyMeasures() {
  return BODY_MEASURES;
}

export function getAllPhases() {
  return Object.keys(PROGRAMS).map(k => ({
    id: parseInt(k),
    name: PROGRAMS[k].name || `Fase ${k}`,
    desc: PROGRAMS[k].desc || ''
  }));
}
