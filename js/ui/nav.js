import { saveDB } from '../data.js';
import { ROMAN } from '../constants.js';
import { getPrograms, getAllPhases } from '../programs.js';
import { renderCalendar } from './calendar.js';
import { renderHistory } from './history.js';
import { renderBodyForm, renderBodyHistory, calcProportions, calcCalories } from './body.js';
import { render1RMs } from './settings.js';
import { initProgress } from './progress.js';
import { populateSessions, exTargetText, selectAndStartSession } from './training.js';
import { refreshRunning, renderRunHistory, renderRunProgress } from './running.js';
import { renderDashboard } from './dashboard.js';
import { esc } from '../utils.js';

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
  document.querySelectorAll('nav button').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  try { navigator.vibrate?.(10); } catch {}
  btn.setAttribute('aria-current', 'page');
  document.getElementById(btn.dataset.sec).classList.add('active');
  localStorage.setItem('areteLastTab', btn.dataset.sec);

  const activeStrPanel = document.querySelector('.str-panel.active')?.id;

  if (btn.dataset.sec === 'secDashboard') renderDashboard(db);
  if (btn.dataset.sec === 'secStrength') {
    if (activeStrPanel === 'strHistory') { renderCalendar(db); renderHistory(db); }
    if (activeStrPanel === 'strProgress') initProgress(db);
  }
  if (btn.dataset.sec === 'secBody') { renderBodyForm(db); renderBodyHistory(db); calcProportions(db); calcCalories(db); }
  if (btn.dataset.sec === 'secSettings') render1RMs(db);
  if (btn.dataset.sec === 'secRunning') refreshRunning(db);
}

/** Switch strength sub-tab */
export function switchStrTab(tabName, db) {
  document.querySelectorAll('.str-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.str-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.str-tab[data-str="${tabName}"]`)?.classList.add('active');
  document.getElementById(tabName)?.classList.add('active');
  localStorage.setItem('areteLastStrTab', tabName);
  // Render content
  if (tabName === 'strHistory') { renderCalendar(db); renderHistory(db); }
  if (tabName === 'strProgress') initProgress(db);
  if (tabName === 'strPlan') renderStrPlan(db);
}

/** Render strength Plan tab — browse all phases and sessions */
function renderStrPlan(db) {
  const $phase = document.getElementById('strPlanPhase');
  const $content = document.getElementById('strPlanContent');
  if (!$phase || !$content) return;

  const progs = getPrograms();
  const phaseKeys = Object.keys(progs).sort((a, b) => parseInt(a) - parseInt(b));
  if (!phaseKeys.length) { $content.innerHTML = '<div class="empty-state">No hay fases disponibles</div>'; return; }

  $phase.innerHTML = phaseKeys.map(k => {
    const p = progs[k];
    return `<option value="${k}">${esc(p.name || 'Fase ' + k)}</option>`;
  }).join('');
  $phase.value = String(db.phase);
  $phase.onchange = () => renderPlanPhaseContent(progs, $phase.value, $content, db);

  renderPlanPhaseContent(progs, $phase.value, $content, db);
}

function renderPlanPhaseContent(progs, phaseKey, $content, db) {
  const phase = progs[phaseKey];
  if (!phase?.sessions) { $content.innerHTML = ''; return; }

  const sessionNames = Object.keys(phase.sessions);
  $content.innerHTML = `
    ${phase.desc ? `<div class="str-plan-desc">${esc(phase.desc)}</div>` : ''}
    ${sessionNames.map(name => {
      const exercises = phase.sessions[name];
      return `<div class="str-plan-session">
        <div class="str-plan-session-header">
          <span class="str-plan-session-name">${esc(name)}</span>
          <span class="str-plan-session-count">${exercises.length} ej.</span>
        </div>
        <div class="str-plan-ex-list">${exercises.map(ex =>
          `<div class="so-ex"><span class="so-ex-name">${esc(ex.name)}</span><span class="so-ex-target">${exTargetText(ex)}</span></div>`
        ).join('')}</div>
        <button class="btn str-plan-start-btn" data-plan-session="${esc(name)}" data-plan-phase="${phaseKey}">Iniciar sesión</button>
      </div>`;
    }).join('')}`;

  $content.querySelectorAll('.str-plan-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectAndStartSession(btn.dataset.planSession, btn.dataset.planPhase, db);
      switchStrTab('strTrain', db);
    });
  });
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

/** Initialize navigation: tab switching, strength sub-tabs, and phase modal */
export function initNav(db) {
  document.querySelectorAll('nav button[data-sec]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn, db));
  });
  // Strength sub-tabs
  document.querySelectorAll('.str-tab[data-str]').forEach(btn => {
    btn.addEventListener('click', () => switchStrTab(btn.dataset.str, db));
  });
  document.getElementById('phaseContext').addEventListener('click', () => {
    renderPhaseModal(db);
    openPhaseModal();
  });
  document.getElementById('phaseModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('phaseModal')) closePhaseModal();
    const option = e.target.closest('.phase-option[data-phase]');
    if (option) selectPhase(parseInt(option.dataset.phase), db);
  });
  document.querySelector('#phaseModal .btn-outline').addEventListener('click', () => closePhaseModal());
}

/** Restore last active tab after all UI modules are initialized */
export function restoreLastTab(db) {
  const lastTab = localStorage.getItem('areteLastTab');
  if (lastTab && lastTab !== 'secDashboard') {
    const savedBtn = document.querySelector(`nav button[data-sec="${lastTab}"]`);
    if (savedBtn) switchTab(savedBtn, db);
  }
  const lastStrTab = localStorage.getItem('areteLastStrTab');
  if (lastStrTab && lastStrTab !== 'strTrain') {
    switchStrTab(lastStrTab, db);
  }
}

/** Re-render the currently active section */
export function refreshActiveSection(db) {
  const sec = document.querySelector('.section.active')?.id;
  if (sec === 'secDashboard') renderDashboard(db);
  if (sec === 'secStrength') {
    const panel = document.querySelector('.str-panel.active')?.id;
    if (panel === 'strHistory') { renderCalendar(db); renderHistory(db); }
    if (panel === 'strProgress') initProgress(db);
  }
  if (sec === 'secBody') { renderBodyForm(db); renderBodyHistory(db); calcProportions(db); calcCalories(db); }
  if (sec === 'secSettings') render1RMs(db);
  if (sec === 'secRunning') refreshRunning(db);
}
