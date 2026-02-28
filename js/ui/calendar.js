import { showDetail } from './history.js';
import { renderHistory } from './history.js';
import { getActiveProgram } from '../programs.js';

let calViewDate = new Date();

export function calNav(d, db) {
  if (d === 0) calViewDate = new Date();
  else calViewDate.setMonth(calViewDate.getMonth() + d);
  renderCalendar(db);
}

/** Render the monthly calendar grid with workout indicators */
export function renderCalendar(db) {
  const panel = document.getElementById('calendarPanel');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const prog = getActiveProgram();
  const filtered = db.workouts.filter(w => (w.program || 'barraLibre') === prog);
  const wd = {};
  filtered.forEach(w => { if (!wd[w.date]) wd[w.date] = []; wd[w.date].push(w.session); });
  const vm = new Date(calViewDate.getFullYear(), calViewDate.getMonth(), 1);
  let html = '';
  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const MN = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const y = vm.getFullYear(), m = vm.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  let fd = new Date(y, m, 1).getDay();
  fd = fd === 0 ? 6 : fd - 1;
  let mc = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (wd[ds]) mc++;
  }
  html += `<div class="cal-container"><div class="cal-header"><div class="cal-title">${MN[m]} ${y}</div><div class="cal-count">Sesiones<span>${mc}</span></div></div><div class="cal-grid">`;
  DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  for (let e = 0; e < fd; e++) html += '<div class="cal-day empty">·</div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hw = wd[ds], it = ds === todayStr;
    let c = 'cal-day';
    if (hw) c += ' has-workout';
    if (it) c += ' today';
    const dataAttr = hw ? ` data-date="${ds}"` : '';
    html += `<div class="${c}"${dataAttr}>${d}</div>`;
  }
  html += '</div></div>';
  panel.innerHTML = html;
}

/** Initialize calendar: navigation buttons and day click events */
export function initCalendar(db) {
  document.querySelector('.cal-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('cal-nav-today')) calNav(0, db);
    else if (btn.previousElementSibling === null) calNav(-1, db);
    else calNav(1, db);
  });
  document.getElementById('calendarPanel').addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day[data-date]');
    if (day) calDayClick(day.dataset.date, db);
  });
}

export function calDayClick(ds, db) {
  const prog = getActiveProgram();
  const ws = db.workouts.filter(w => w.date === ds && (w.program || 'barraLibre') === prog);
  if (ws.length === 1) showDetail(ws[0].id, db);
  else if (ws.length > 1) {
    document.getElementById('historyFilter').value = '';
    renderHistory(db, ds);
  }
}
