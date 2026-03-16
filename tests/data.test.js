import { describe, it, expect, beforeEach } from 'vitest';
import { validateDB, validateImportData, markDeleted, loadDB, saveDB, migrateDB, pruneDeletedIds } from '../js/data.js';

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

describe('validateImportData', () => {
  it('returns null for valid data', () => {
    expect(validateImportData({ workouts: [{ id: 1, exercises: [] }], bodyLogs: [] })).toBeNull();
  });

  it('rejects null/undefined', () => {
    expect(validateImportData(null)).toBeTruthy();
    expect(validateImportData(undefined)).toBeTruthy();
  });

  it('rejects missing workouts', () => {
    expect(validateImportData({ bodyLogs: [] })).toMatch(/workouts/);
  });

  it('rejects non-array workouts', () => {
    expect(validateImportData({ workouts: 'nope' })).toMatch(/workouts/);
  });

  it('rejects workout without id', () => {
    expect(validateImportData({ workouts: [{ exercises: [] }] })).toMatch(/sin id/);
  });

  it('rejects workout without exercises array', () => {
    expect(validateImportData({ workouts: [{ id: 1 }] })).toMatch(/sin exercises/);
  });

  it('rejects non-array bodyLogs', () => {
    expect(validateImportData({ workouts: [], bodyLogs: 'nope' })).toMatch(/bodyLogs/);
  });

  it('rejects non-array runningLogs', () => {
    expect(validateImportData({ workouts: [], runningLogs: {} })).toMatch(/runningLogs/);
  });

  it('accepts data with only workouts (other arrays optional)', () => {
    expect(validateImportData({ workouts: [] })).toBeNull();
  });
});

describe('migrateDB', () => {
  it('adds program field to old workouts without it', () => {
    const db = { schemaVersion: 1, program: 'test', workouts: [{ id: 1, exercises: [] }], bodyLogs: [] };
    migrateDB(db);
    expect(db.workouts[0].program).toBe('test');
    expect(db.schemaVersion).toBe(2);
  });

  it('ensures settings object exists after migration', () => {
    const db = { schemaVersion: 1, workouts: [], bodyLogs: [] };
    migrateDB(db);
    expect(db.settings).toBeDefined();
    expect(db.settings.height).toBe(175);
  });

  it('ensures runningLogs and customPrograms arrays exist', () => {
    const db = { schemaVersion: 1, workouts: [], bodyLogs: [] };
    migrateDB(db);
    expect(Array.isArray(db.runningLogs)).toBe(true);
    expect(Array.isArray(db.customPrograms)).toBe(true);
  });

  it('does not re-run migrations on current schema', () => {
    const db = { schemaVersion: 2, workouts: [{ id: 1, exercises: [] }], bodyLogs: [] };
    migrateDB(db);
    expect(db.workouts[0].program).toBeUndefined(); // not touched
    expect(db.schemaVersion).toBe(2);
  });
});

describe('pruneDeletedIds', () => {
  it('does nothing when under 500', () => {
    const db = { deletedIds: [1, 2, 3], workouts: [], bodyLogs: [], runningLogs: [] };
    pruneDeletedIds(db);
    expect(db.deletedIds).toEqual([1, 2, 3]);
  });

  it('prunes when over 500, keeping last 200', () => {
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    const db = { deletedIds: ids, workouts: [], bodyLogs: [], runningLogs: [] };
    pruneDeletedIds(db);
    expect(db.deletedIds.length).toBeLessThanOrEqual(200);
    expect(db.deletedIds).toContain(600); // most recent kept
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
