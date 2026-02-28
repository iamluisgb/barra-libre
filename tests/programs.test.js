import { describe, it, expect } from 'vitest';
import { setActiveProgram, getActiveProgram, getPrograms, getProgramList, getAllPhases } from '../js/programs.js';

describe('activeProgram getter/setter', () => {
  it('returns default program initially', () => {
    expect(getActiveProgram()).toBe('barraLibre');
  });

  it('sets and gets active program', () => {
    setActiveProgram('ppl');
    expect(getActiveProgram()).toBe('ppl');
    setActiveProgram('barraLibre'); // restore
  });
});

describe('getPrograms', () => {
  it('returns empty object when no programs loaded', () => {
    const result = getPrograms();
    expect(typeof result).toBe('object');
  });
});

describe('getProgramList', () => {
  it('returns an array', () => {
    const result = getProgramList();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('getAllPhases', () => {
  it('returns an array', () => {
    const result = getAllPhases();
    expect(Array.isArray(result)).toBe(true);
  });
});
