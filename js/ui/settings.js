import { formatDate } from '../utils.js';

function normLift(name) {
  const n = name.toLowerCase();
  if (n.includes('sentadilla') && !n.includes('frontal') && !n.includes('1 pierna')) return 'Sentadilla';
  if (n.includes('press') && (n.includes('banca') || n.includes('bench'))) return 'Press Banca';
  if (n.includes('press') && n.includes('militar')) return 'Press Militar';
  if (n.includes('peso muerto') && !n.includes('rumano') && !n.includes('unilateral')) return 'Peso Muerto';
  if (n === 'clean') return 'Clean';
  if (n.includes('remo')) return 'Remo con Barra';
  return null;
}

export function render1RMs(db) {
  const lifts = {};
  db.workouts.forEach(w => {
    w.exercises.forEach(ex => {
      const n = normLift(ex.name);
      if (!n) return;
      ex.sets.forEach(s => {
        const kg = parseFloat(s.kg), reps = parseInt(s.reps);
        if (!kg || !reps || reps < 1) return;
        const rm = kg * reps * .0333 + kg;
        if (!lifts[n] || rm > lifts[n].rm) lifts[n] = { rm, kg, reps, date: w.date };
      });
    });
  });
  const p = document.getElementById('rmPanel'), k = Object.keys(lifts);
  if (!k.length) {
    p.innerHTML = '<p style="color:var(--text2);font-size:.8rem;text-align:center;padding:20px 0">Registra entrenamientos para ver 1RM</p>';
    return;
  }
  p.innerHTML = k.map(n =>
    `<div class="calc-result"><div class="cr-label">${n}</div><div class="cr-value">${lifts[n].rm.toFixed(1)} kg</div><div class="cr-sub">Basado en ${lifts[n].kg}kg × ${lifts[n].reps} (${formatDate(lifts[n].date)})</div></div>`
  ).join('');
}
