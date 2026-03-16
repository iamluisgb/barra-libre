import { describe, it, expect } from 'vitest';
import { parseSegDuration, segModeToRunType } from '../js/ui/running.js';

// ── parseSegDuration ─────────────────────────────────────

describe('parseSegDuration', () => {
  it('parses minutes', () => {
    expect(parseSegDuration('20min')).toBe(1200);
    expect(parseSegDuration('10min')).toBe(600);
    expect(parseSegDuration('5min')).toBe(300);
  });

  it('parses hours', () => {
    expect(parseSegDuration('1h')).toBe(3600);
    expect(parseSegDuration('2h')).toBe(7200);
  });

  it('parses hours + minutes (e.g. 1h30)', () => {
    expect(parseSegDuration('1h30')).toBe(5400);
    expect(parseSegDuration('1h15')).toBe(4500);
  });

  it('handles whitespace and case', () => {
    expect(parseSegDuration(' 20min ')).toBe(1200);
    expect(parseSegDuration('20MIN')).toBe(1200);
    expect(parseSegDuration('1H30')).toBe(5400);
  });

  it('returns 0 for empty/null/undefined', () => {
    expect(parseSegDuration('')).toBe(0);
    expect(parseSegDuration(null)).toBe(0);
    expect(parseSegDuration(undefined)).toBe(0);
  });

  it('returns 0 for unrecognized formats', () => {
    expect(parseSegDuration('abc')).toBe(0);
    expect(parseSegDuration('fast')).toBe(0);
  });
});

// ── segModeToRunType ─────────────────────────────────────

describe('segModeToRunType', () => {
  it('maps run-intervals to intervalos', () => {
    expect(segModeToRunType({ mode: 'run-intervals' })).toBe('intervalos');
  });

  it('maps Z3 zone to tempo', () => {
    expect(segModeToRunType({ mode: 'run-steady', zone: 'Z3' })).toBe('tempo');
  });

  it('maps Z4 zone to tempo', () => {
    expect(segModeToRunType({ mode: 'run-steady', zone: 'Z4' })).toBe('tempo');
  });

  it('maps Z1 zone to rodaje', () => {
    expect(segModeToRunType({ mode: 'run-steady', zone: 'Z1' })).toBe('rodaje');
  });

  it('maps Z2 zone to rodaje', () => {
    expect(segModeToRunType({ mode: 'run-steady', zone: 'Z2' })).toBe('rodaje');
  });

  it('maps Z5 zone to rodaje (not tempo)', () => {
    expect(segModeToRunType({ mode: 'run-steady', zone: 'Z5' })).toBe('rodaje');
  });

  it('defaults to rodaje for unknown mode/zone', () => {
    expect(segModeToRunType({ mode: 'other' })).toBe('rodaje');
    expect(segModeToRunType({})).toBe('rodaje');
  });
});
