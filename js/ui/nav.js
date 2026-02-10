import { saveDB } from '../data.js';
import { renderCalendar } from './calendar.js';
import { renderHistory } from './history.js';
import { renderBodyForm, renderBodyHistory, calcProportions, calcCalories } from './body.js';
import { render1RMs } from './settings.js';
import { initProgress } from './progress.js';
import { populateSessions } from './training.js';

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

export function selectPhase(n, db) {
  db.phase = n;
  saveDB(db);
  document.getElementById('phaseBadge').textContent = ['I', 'II', 'III', 'IV'][n - 1];
  updatePhaseUI(db);
  populateSessions(db);
  closePhaseModal();
}

export function updatePhaseUI(db) {
  document.querySelectorAll('.phase-option').forEach(el =>
    el.classList.toggle('selected', parseInt(el.dataset.phase) === db.phase)
  );
}
