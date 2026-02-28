import { describe, it, expect, beforeEach } from 'vitest';
import { validateDB, markDeleted, loadDB, saveDB } from '../js/data.js';

beforeEach(() => {
  localStorage.clear();
});

describe('validateDB', () => {
  it('returns true for valid db', () => {
    expect(validateDB({ workouts: [], bodyLogs: [] })).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateDB(null)).toBeFalsy();
  });

  it('returns false without workouts array', () => {
    expect(validateDB({ bodyLogs: [] })).toBe(false);
    expect(validateDB({ workouts: 'not array', bodyLogs: [] })).toBe(false);
  });

  it('returns false without bodyLogs array', () => {
    expect(validateDB({ workouts: [] })).toBe(false);
  });
});

describe('markDeleted', () => {
  it('adds id to deletedIds', () => {
    const db = { deletedIds: [] };
    markDeleted(db, 42);
    expect(db.deletedIds).toContain(42);
  });

  it('does not add duplicate ids', () => {
    const db = { deletedIds: [42] };
    markDeleted(db, 42);
    expect(db.deletedIds).toEqual([42]);
  });

  it('creates deletedIds array if missing', () => {
    const db = {};
    markDeleted(db, 1);
    expect(db.deletedIds).toEqual([1]);
  });
});

describe('saveDB / loadDB roundtrip', () => {
  it('saves and loads data correctly', () => {
    const db = {
      program: 'test',
      phase: 2,
      workouts: [{ id: 1, date: '2025-01-01', exercises: [] }],
      bodyLogs: [{ id: 10, peso: 70 }],
      deletedIds: [],
    };
    saveDB(db);
    const loaded = loadDB();
    expect(loaded.workouts).toHaveLength(1);
    expect(loaded.workouts[0].id).toBe(1);
    expect(loaded.bodyLogs[0].peso).toBe(70);
  });

  it('rejects invalid db without saving', () => {
    saveDB({ workouts: [], bodyLogs: [] }); // valid first
    saveDB(null); // invalid — should not overwrite
    const loaded = loadDB();
    expect(loaded.workouts).toBeDefined();
  });

  it('returns defaults when localStorage is empty', () => {
    const loaded = loadDB();
    expect(loaded.workouts).toEqual([]);
    expect(loaded.bodyLogs).toEqual([]);
    expect(loaded.phase).toBe(1);
  });
});
