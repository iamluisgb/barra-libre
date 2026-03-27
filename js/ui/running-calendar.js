import { renderRunHistory } from './running.js';

let _viewDate = new Date();

export function runCalNav(d, db) {
  if (d === 0) _viewDate = new Date();
  else _viewDate.setMonth(_viewDate.getMonth() + d);
  renderRunCalendar(db);
}

/** Render the monthly calendar grid with running session indicators */
export function renderRunCalendar(db) {
  const panel = document.getElementById('runCalendarPanel');
  if (!panel) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const logs = db.runningLogs || [];
  const byDate = {};
  logs.forEach(l => { if (!byDate[l.date]) byDate[l.date] = []; byDate[l.date].push(l); });
  const vm = new Date(_viewDate.getFullYear(), _viewDate.getMonth(), 1);
  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const MN = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const y = vm.getFullYear(), m = vm.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  let fd = new Date(y, m, 1).getDay();
  fd = fd === 0 ? 6 : fd - 1;
  let mc = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (byDate[ds]) mc++;
  }
  let html = `<div class="cal-container"><div class="cal-header"><div class="cal-title">${MN[m]} ${y}</div><div class="cal-count">Sesiones<span>${mc}</span></div></div><div class="cal-grid">`;
  DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
  for (let e = 0; e < fd; e++) html += '<div class="cal-day empty">·</div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = byDate[ds], isToday = ds === todayStr;
    let c = 'cal-day';
    if (has) c += ' has-workout';
    if (isToday) c += ' today';
    const dataAttr = has ? ` data-date="${ds}"` : '';
    html += `<div class="${c}"${dataAttr}>${d}</div>`;
  }
  html += '</div></div>';
  panel.innerHTML = html;
}

/** Initialize running calendar: navigation and day clicks */
export function initRunCalendar(db) {
  const nav = document.getElementById('runCalNav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('cal-nav-today')) runCalNav(0, db);
    else if (btn.previousElementSibling === null) runCalNav(-1, db);
    else runCalNav(1, db);
  });
  document.getElementById('runCalendarPanel').addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day[data-date]');
    if (day) runCalDayClick(day.dataset.date, db);
  });
}

function runCalDayClick(ds, db) {
  const runs = (db.runningLogs || []).filter(l => l.date === ds);
  if (runs.length >= 1) {
    document.getElementById('runHistoryFilter').value = '';
    renderRunHistory(db, ds);
  }
}
