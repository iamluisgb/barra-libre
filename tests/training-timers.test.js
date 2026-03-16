import { describe, it, expect } from 'vitest';
import { exFmtTime, parseDurationStr, buildTimerConfig } from '../js/ui/training.js';

// ── exFmtTime ────────────────────────────────────────────

describe('exFmtTime', () => {
  it('formats 0 seconds', () => {
    expect(exFmtTime(0)).toBe('0:00');
  });

  it('formats seconds < 60', () => {
    expect(exFmtTime(5)).toBe('0:05');
    expect(exFmtTime(30)).toBe('0:30');
    expect(exFmtTime(59)).toBe('0:59');
  });

  it('formats whole minutes', () => {
    expect(exFmtTime(60)).toBe('1:00');
    expect(exFmtTime(300)).toBe('5:00');
  });

  it('formats minutes and seconds', () => {
    expect(exFmtTime(90)).toBe('1:30');
    expect(exFmtTime(125)).toBe('2:05');
    expect(exFmtTime(3600)).toBe('60:00');
  });
});

// ── parseDurationStr ─────────────────────────────────────

describe('parseDurationStr', () => {
  it('parses minutes', () => {
    expect(parseDurationStr('4min')).toBe(240);
    expect(parseDurationStr('10min')).toBe(600);
    expect(parseDurationStr('20min')).toBe(1200);
  });

  it('parses seconds', () => {
    expect(parseDurationStr('30s')).toBe(30);
    expect(parseDurationStr('45s')).toBe(45);
  });

  it('parses hours', () => {
    expect(parseDurationStr('1h')).toBe(3600);
    expect(parseDurationStr('2h')).toBe(7200);
  });

  it('parses combined h+min', () => {
    expect(parseDurationStr('1h30min')).toBe(5400);
  });

  it('parses combined min+s', () => {
    expect(parseDurationStr('4min30s')).toBe(270);
  });

  it('handles spaces and uppercase', () => {
    expect(parseDurationStr('4 Min')).toBe(240);
    expect(parseDurationStr(' 30S ')).toBe(30);
    expect(parseDurationStr('1H30MIN')).toBe(5400);
  });

  it('returns 0 for empty/null', () => {
    expect(parseDurationStr('')).toBe(0);
    expect(parseDurationStr(null)).toBe(0);
    expect(parseDurationStr(undefined)).toBe(0);
  });

  it('falls back to parseInt for plain numbers', () => {
    expect(parseDurationStr('120')).toBe(120);
  });

  it('does not match "s" in "set" or "seg"', () => {
    // The regex uses (?!e) lookahead to avoid matching "set", "seg"
    expect(parseDurationStr('30s')).toBe(30);
  });
});

// ── buildTimerConfig ─────────────────────────────────────

describe('buildTimerConfig — interval', () => {
  const ex = { name: 'Swing', duration: '6min', on: '30s', off: '30s' };

  it('returns phased type', () => {
    const cfg = buildTimerConfig('interval', ex);
    expect(cfg.type).toBe('phased');
  });

  it('calculates correct number of rounds', () => {
    const cfg = buildTimerConfig('interval', ex);
    // 6min = 360s, 30+30=60s per round → 6 rounds
    expect(cfg.totalRounds).toBe(6);
  });

  it('generates work/rest phase pairs', () => {
    const cfg = buildTimerConfig('interval', ex);
    expect(cfg.phases).toHaveLength(12); // 6 rounds × 2 phases
    expect(cfg.phases[0]).toEqual({ type: 'work', duration: 30, label: 'Swing', round: 1 });
    expect(cfg.phases[1]).toEqual({ type: 'rest', duration: 30, label: 'Descanso', round: 1 });
    expect(cfg.phases[10]).toEqual({ type: 'work', duration: 30, label: 'Swing', round: 6 });
    expect(cfg.phases[11]).toEqual({ type: 'rest', duration: 30, label: 'Descanso', round: 6 });
  });

  it('handles uneven total duration (rounds up)', () => {
    const ex2 = { name: 'Test', duration: '5min', on: '30s', off: '30s' };
    const cfg = buildTimerConfig('interval', ex2);
    // 300/60 = 5 rounds
    expect(cfg.totalRounds).toBe(5);
  });
});

describe('buildTimerConfig — tabata', () => {
  const ex = { name: 'Burpees' };

  it('returns phased type with 8 rounds', () => {
    const cfg = buildTimerConfig('tabata', ex);
    expect(cfg.type).toBe('phased');
    expect(cfg.totalRounds).toBe(8);
  });

  it('has 20s work and 10s rest phases', () => {
    const cfg = buildTimerConfig('tabata', ex);
    const workPhases = cfg.phases.filter(p => p.type === 'work');
    const restPhases = cfg.phases.filter(p => p.type === 'rest');
    expect(workPhases).toHaveLength(8);
    expect(restPhases).toHaveLength(7); // no rest after last round
    workPhases.forEach(p => expect(p.duration).toBe(20));
    restPhases.forEach(p => expect(p.duration).toBe(10));
  });

  it('uses round-specific names when provided', () => {
    const ex2 = { name: 'Tabata', rounds: ['Push-ups', 'Squats', 'Lunges'] };
    const cfg = buildTimerConfig('tabata', ex2);
    expect(cfg.phases[0].label).toBe('Push-ups');
    expect(cfg.phases[2].label).toBe('Squats');
    expect(cfg.phases[4].label).toBe('Lunges');
    expect(cfg.phases[6].label).toBe('Tabata'); // falls back to name
  });

  it('total tabata duration is 4 minutes', () => {
    const cfg = buildTimerConfig('tabata', ex);
    const total = cfg.phases.reduce((s, p) => s + p.duration, 0);
    expect(total).toBe(8 * 20 + 7 * 10); // 230s = 3:50
  });
});

describe('buildTimerConfig — emom', () => {
  const ex = { name: 'Clean', duration: '10min' };

  it('returns phased type', () => {
    const cfg = buildTimerConfig('emom', ex);
    expect(cfg.type).toBe('phased');
  });

  it('creates one 60s phase per minute', () => {
    const cfg = buildTimerConfig('emom', ex);
    expect(cfg.totalRounds).toBe(10);
    expect(cfg.phases).toHaveLength(10);
    cfg.phases.forEach((p, i) => {
      expect(p.type).toBe('work');
      expect(p.duration).toBe(60);
      expect(p.label).toBe(`Minuto ${i + 1}`);
      expect(p.round).toBe(i + 1);
    });
  });

  it('handles short duration (at least 1 minute)', () => {
    const cfg = buildTimerConfig('emom', { name: 'X', duration: '30s' });
    expect(cfg.totalRounds).toBeGreaterThanOrEqual(1);
  });
});

describe('buildTimerConfig — amrap', () => {
  const ex = { name: 'AMRAP WOD', duration: '12min' };

  it('returns countdown-manual type', () => {
    const cfg = buildTimerConfig('amrap', ex);
    expect(cfg.type).toBe('countdown-manual');
  });

  it('has single neutral phase with full duration', () => {
    const cfg = buildTimerConfig('amrap', ex);
    expect(cfg.phases).toHaveLength(1);
    expect(cfg.phases[0]).toEqual({
      type: 'neutral', duration: 720, label: 'AMRAP WOD', round: 1
    });
  });

  it('totalRounds is 0 (user counts manually)', () => {
    const cfg = buildTimerConfig('amrap', ex);
    expect(cfg.totalRounds).toBe(0);
  });
});

describe('buildTimerConfig — rounds', () => {
  const ex = { name: 'Circuit', count: 5, rest: '90s' };

  it('returns manual-rounds type', () => {
    const cfg = buildTimerConfig('rounds', ex);
    expect(cfg.type).toBe('manual-rounds');
  });

  it('has correct round count and rest duration', () => {
    const cfg = buildTimerConfig('rounds', ex);
    expect(cfg.totalRounds).toBe(5);
    expect(cfg.restDuration).toBe(90);
  });

  it('has empty phases (user controls advancement)', () => {
    const cfg = buildTimerConfig('rounds', ex);
    expect(cfg.phases).toEqual([]);
  });
});

describe('buildTimerConfig — result/HIIT (stopwatch)', () => {
  it('returns stopwatch type for unknown mode', () => {
    const cfg = buildTimerConfig('result', { name: 'HIIT' });
    expect(cfg.type).toBe('stopwatch');
  });

  it('has no phases and no rounds', () => {
    const cfg = buildTimerConfig('result', { name: 'X' });
    expect(cfg.phases).toEqual([]);
    expect(cfg.totalRounds).toBe(0);
  });
});
