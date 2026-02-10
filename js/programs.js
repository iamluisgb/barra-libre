let PROGRAMS = {};

export async function loadPrograms() {
  const res = await fetch('programs.json');
  const base = await res.json();

  const custom = JSON.parse(localStorage.getItem('bl_custom_programs') || '{}');
  PROGRAMS = { ...base, ...custom };
  return PROGRAMS;
}

export function getPrograms() {
  return PROGRAMS;
}

export function getAllPhases() {
  return Object.keys(PROGRAMS).map(k => ({
    id: parseInt(k),
    name: PROGRAMS[k].name || `Fase ${k}`,
    desc: PROGRAMS[k].desc || ''
  }));
}

export const BODY_MEASURES = [
  { id: 'peso', label: 'Peso (kg)' },
  { id: 'grasa', label: '% Grasa' },
  { id: 'muneca', label: 'Muñeca' },
  { id: 'biceps', label: 'Bíceps' },
  { id: 'pecho', label: 'Pecho' },
  { id: 'hombros', label: 'Hombros' },
  { id: 'cintura', label: 'Cintura' },
  { id: 'cuello', label: 'Cuello' },
  { id: 'muslo', label: 'Muslo' },
  { id: 'rodilla', label: 'Rodilla' },
  { id: 'pantorrilla', label: 'Pantorrilla' }
];
