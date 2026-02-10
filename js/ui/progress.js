export function initProgress(db) {
  const sel = document.getElementById('progressExercise');
  const exercises = new Set();
  db.workouts.forEach(w => w.exercises.forEach(e => exercises.add(e.name)));
  const sorted = [...exercises].sort();
  const prev = sel.value;
  sel.innerHTML = sorted.map(n => `<option value="${n}">${n}</option>`).join('');
  if (prev && sorted.includes(prev)) sel.value = prev;
  renderProgressChart(db);
}

export function renderProgressChart(db) {
  const name = document.getElementById('progressExercise').value;
  if (!name) {
    document.getElementById('progressChart').innerHTML = '<p style="color:var(--text3);text-align:center;padding:60px 0;font-size:.85rem">Sin datos aún</p>';
    return;
  }
  const points = [];
  db.workouts.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(w => {
    const ex = w.exercises.find(e => e.name === name); if (!ex) return;
    let maxKg = 0, totalVol = 0, maxReps = 0;
    ex.sets.forEach(s => { const kg = parseFloat(s.kg) || 0, r = parseInt(s.reps) || 0; if (kg > maxKg) maxKg = kg; totalVol += kg * r; if (r > maxReps) maxReps = r; });
    points.push({ date: w.date, maxKg, totalVol, maxReps, session: w.session });
  });
  if (points.length === 0) {
    document.getElementById('progressChart').innerHTML = '<p style="color:var(--text3);text-align:center;padding:60px 0;font-size:.85rem">Sin datos para este ejercicio</p>';
    document.getElementById('progressStats').innerHTML = '';
    document.getElementById('progressHistory').innerHTML = '';
    return;
  }

  const W = 340, H = 180, pad = { t: 20, r: 16, b: 30, l: 40 };
  const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  const vals = points.map(p => p.maxKg);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const xStep = points.length > 1 ? cW / (points.length - 1) : cW / 2;

  const coords = points.map((p, i) => ({
    x: pad.l + (points.length > 1 ? i * xStep : cW / 2),
    y: pad.t + cH - (((p.maxKg - minV) / range) * cH)
  }));

  let path = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const cp = (coords[i].x - coords[i - 1].x) * 0.3;
    path += ` C${coords[i - 1].x + cp},${coords[i - 1].y} ${coords[i].x - cp},${coords[i].y} ${coords[i].x},${coords[i].y}`;
  }
  const area = path + ` L${coords[coords.length - 1].x},${pad.t + cH} L${coords[0].x},${pad.t + cH} Z`;

  const ySteps = 4;
  let yLabels = '';
  for (let i = 0; i <= ySteps; i++) {
    const v = minV + (range / ySteps) * i;
    const y = pad.t + cH - ((i / ySteps) * cH);
    yLabels += `<text x="${pad.l - 8}" y="${y + 3}" text-anchor="end" fill="var(--text3)" font-size="9" font-weight="500">${Math.round(v)}</text>`;
    yLabels += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  }

  let xLabels = '';
  const showX = points.length <= 6 ? points.map((_, i) => i) : [0, Math.floor(points.length / 2), points.length - 1];
  showX.forEach(i => {
    const d = points[i].date.slice(5).replace('-', '/');
    xLabels += `<text x="${coords[i].x}" y="${H - 4}" text-anchor="middle" fill="var(--text3)" font-size="9" font-weight="500">${d}</text>`;
  });

  const dots = coords.map((c, i) => {
    const isLast = i === coords.length - 1;
    const r = isLast ? 4.5 : 3;
    const opacity = isLast ? 1 : 0.6;
    return `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="var(--accent)" opacity="${opacity}"/>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/></linearGradient></defs>
    ${yLabels}${xLabels}
    <path d="${area}" fill="url(#areaGrad)"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <text x="${pad.l}" y="12" fill="var(--text2)" font-size="10" font-weight="600">Peso máx (kg)</text>
  </svg>`;

  document.getElementById('progressChart').innerHTML = svg;

  const first = points[0], last = points[points.length - 1];
  const diff = last.maxKg - first.maxKg;
  const diffPct = first.maxKg > 0 ? ((diff / first.maxKg) * 100).toFixed(0) : 0;
  const pr = Math.max(...vals);
  const totalSessions = points.length;

  document.getElementById('progressStats').innerHTML = [
    { label: 'PR', value: pr + 'kg', color: 'var(--accent)' },
    { label: 'Progreso', value: (diff >= 0 ? '+' : '') + diff + 'kg', color: diff >= 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'Cambio', value: (diff >= 0 ? '+' : '') + diffPct + '%', color: diff >= 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'Sesiones', value: totalSessions, color: 'var(--text2)' }
  ].map(s => `<div style="flex:1;background:var(--surface);border:.5px solid var(--border);border-radius:var(--radius);padding:10px 8px;text-align:center"><div style="font-size:1.1rem;font-weight:800;color:${s.color}">${s.value}</div><div style="font-size:.6rem;color:var(--text3);font-weight:600;text-transform:uppercase;margin-top:2px">${s.label}</div></div>`).join('');

  document.getElementById('progressHistory').innerHTML = `<div style="font-size:.75rem;font-weight:600;color:var(--text2);margin-bottom:8px">Historial de ${name}</div>` +
    points.slice().reverse().map(p => {
      const isPR = p.maxKg === pr;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:.5px solid var(--border)">
        <div style="font-size:.7rem;color:var(--text3);min-width:55px">${p.date.slice(5).replace('-', '/')}</div>
        <div style="font-size:.82rem;font-weight:700;color:var(--text);flex:1">${p.maxKg} kg</div>
        <div style="font-size:.65rem;color:var(--text3)">${p.maxReps} reps</div>
        <div style="font-size:.65rem;color:var(--text3)">${p.totalVol > 1000 ? (p.totalVol / 1000).toFixed(1) + 't' : p.totalVol + 'kg'} vol</div>
        ${isPR ? '<div style="font-size:.55rem;background:var(--accent);color:#fff;padding:2px 6px;border-radius:6px;font-weight:700">PR</div>' : ''}
      </div>`;
    }).join('');
}
