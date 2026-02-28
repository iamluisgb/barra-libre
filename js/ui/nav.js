import { saveDB } from '../data.js';
import { getPrograms, getAllPhases } from '../programs.js';
import { renderCalendar } from './calendar.js';
import { renderHistory } from './history.js';
import { renderBodyForm, renderBodyHistory, calcProportions, calcCalories } from './body.js';
import { render1RMs } from './settings.js';
import { initProgress } from './progress.js';
import { populateSessions } from './training.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Update the phase name in the context bar */
export function updatePhaseDisplay(db) {
  const phases = getAllPhases();
  const phase = phases.find(p => p.id === db.phase);
  const roman = ROMAN[db.phase - 1] || db.phase;
  const name = phase ? phase.name : '';
  document.getElementById('phaseName').textContent = name
    ? `Fase ${roman} · ${name}`
    : `Fase ${roman}`;
}

/** Switch active section and render its content */
export function switchTab(btn, db) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.sec).classList.add('active');
  document.getElementById('timerBar').classList.toggle('active', btn.dataset.sec === 'secTrain');
  if (btn.dataset.sec === 'secHistory') { renderCalendar(db); renderHistory(db); }
  if (btn.dataset.sec === 'secBody') { renderBodyForm(db); renderBodyHistory(db); calcProportions(db); calcCalories(db); }
  if (btn.dataset.sec === 'secSettings') render1RMs(db);
  if (btn.dataset.sec === 'secProgress') initProgress(db);
}

export function openPhaseModal() {
  document.getElementById('phaseModal').classList.add('open');
}

export function closePhaseModal() {
  document.getElementById('phaseModal').classList.remove('open');
}

export function renderPhaseModal(db) {
  const phases = getAllPhases();
  const container = document.getElementById('phaseOptions');
  container.innerHTML = phases.map(p => `
    <div class="phase-option${p.id === db.phase ? ' selected' : ''}" data-phase="${p.id}">
      <div class="po-num">${ROMAN[p.id - 1] || p.id}</div>
      <div class="po-text"><div class="po-title">${p.name}</div><div class="po-desc">${p.desc}</div></div>
    </div>
  `).join('');
}

export function selectPhase(n, db) {
  db.phase = n;
  saveDB(db);
  updatePhaseDisplay(db);
  renderPhaseModal(db);
  populateSessions(db);
  closePhaseModal();
}

export function updatePhaseUI(db) {
  updatePhaseDisplay(db);
  renderPhaseModal(db);
}

/** Initialize navigation: tab switching and phase modal */
export function initNav(db) {
  document.querySelectorAll('nav button[data-sec]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn, db));
  });
  document.getElementById('phaseContext').addEventListener('click', () => openPhaseModal());
  document.getElementById('phaseModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('phaseModal')) closePhaseModal();
    const option = e.target.closest('.phase-option[data-phase]');
    if (option) selectPhase(parseInt(option.dataset.phase), db);
  });
  document.querySelector('#phaseModal .btn-outline').addEventListener('click', () => closePhaseModal());
}

/** Re-render the currently active section */
export function refreshActiveSection(db) {
  const sec = document.querySelector('.section.active')?.id;
  if (sec === 'secHistory') { renderCalendar(db); renderHistory(db); }
  if (sec === 'secBody') { renderBodyForm(db); renderBodyHistory(db); calcProportions(db); calcCalories(db); }
  if (sec === 'secSettings') render1RMs(db);
  if (sec === 'secProgress') initProgress(db);
}
