import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveProgram } from '../js/programs.js';

// Mock programs module: inject program data directly
vi.mock('../js/programs.js', async () => {
  const actual = await vi.importActual('../js/programs.js');
  let activeProgram = 'barraLibre';
  const mockPrograms = {
    1: {
      name: 'Fuerza',
      sessions: {
        'Sesión A': [{ name: 'Sentadilla', sets: 3, reps: '5', type: 'main' }],
        'Sesión B': [{ name: 'Press Militar', sets: 3, reps: '5', type: 'main' }],
      },
    },
  };
  return {
    ...actual,
    getPrograms: () => mockPrograms,
    getActiveProgram: () => activeProgram,
    setActiveProgram: (id) => { activeProgram = id; },
    getAllPhases: () => [{ id: 1, name: 'Fuerza', desc: '' }],
  };
});

// Minimal DOM required by training.js
function setupDOM() {
  document.body.innerHTML = `
    <select id="trainSession"></select>
    <select id="historyFilter"></select>
    <div id="exerciseList"></div>
    <input id="trainDate" type="date">
    <textarea id="trainNotes"></textarea>
    <div id="prefillBanner" style="display:none"><span id="prefillText"></span></div>
    <div id="secTrain"><button class="btn">Guardar sesión</button></div>
    <div id="prCelebration"><ul id="prList"></ul></div>
  `;
}

describe('populateSessions', () => {
  beforeEach(() => {
    setupDOM();
    // Reset cached selectors by re-importing fresh module
    vi.resetModules();
  });

  it('works without calling initTraining first (regression)', async () => {
    // Re-import after resetModules to get fresh cached selectors (all undefined)
    const { populateSessions } = await import('../js/ui/training.js');
    const db = { phase: 1, workouts: [], program: 'barraLibre' };

    expect(() => populateSessions(db)).not.toThrow();

    const select = document.getElementById('trainSession');
    expect(select.options.length).toBe(2);
    expect(select.options[0].value).toBe('Sesión A');
  });

  it('populates historyFilter with all sessions plus "Todas"', async () => {
    const { populateSessions } = await import('../js/ui/training.js');
    const db = { phase: 1, workouts: [], program: 'barraLibre' };
    populateSessions(db);

    const filter = document.getElementById('historyFilter');
    expect(filter.options.length).toBe(3); // "Todas" + 2 sessions
    expect(filter.options[0].value).toBe('');
  });

  it('auto-selects next session based on last workout', async () => {
    const { populateSessions } = await import('../js/ui/training.js');
    const db = {
      phase: 1,
      program: 'barraLibre',
      workouts: [{ phase: 1, program: 'barraLibre', session: 'Sesión A', date: '2025-01-01', exercises: [] }],
    };
    populateSessions(db);

    const select = document.getElementById('trainSession');
    expect(select.value).toBe('Sesión B');
  });
});
