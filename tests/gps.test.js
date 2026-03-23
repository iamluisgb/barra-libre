import { describe, it, expect, beforeEach, vi } from 'vitest';
import { haversine, GpsTracker } from '../js/ui/running-tracker.js';

// ── Mock geolocation API for tests that call start/resume ──
const mockGeolocation = {
  watchPosition: vi.fn(() => 1),
  getCurrentPosition: vi.fn(),
  clearWatch: vi.fn(),
};
vi.stubGlobal('navigator', { ...navigator, geolocation: mockGeolocation });

// ── Helpers ─────────────────────────────────────────────

/** Create a mock geolocation position */
function mockPos(lat, lng, alt = 0, accuracy = 5, speed = 3, ts = Date.now()) {
  return {
    coords: { latitude: lat, longitude: lng, altitude: alt, accuracy, speed },
    timestamp: ts
  };
}

/** Simulate a GPS position arriving on the tracker */
function feedPos(tracker, lat, lng, opts = {}) {
  const { alt = 0, accuracy = 5, speed = 3, ts = Date.now() } = opts;
  tracker._onPosition(mockPos(lat, lng, alt, accuracy, speed, ts));
}

// Step of 0.0005 degrees ≈ 55m (safely under the 100m jump filter)
const STEP = 0.0005;

// ── _onPosition: accuracy filter ────────────────────────

describe('GPS position filtering', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._lastGpsTime = 0;
  });

  it('rejects positions with accuracy > 30m', () => {
    feedPos(tracker, 40.0, -3.0, { accuracy: 50 });
    expect(tracker.coords).toHaveLength(0);
    expect(tracker.distance).toBe(0);
  });

  it('accepts positions with accuracy <= 30m', () => {
    feedPos(tracker, 40.0, -3.0, { accuracy: 30 });
    expect(tracker.coords).toHaveLength(1);
  });

  it('accepts positions with accuracy = 1m', () => {
    feedPos(tracker, 40.0, -3.0, { accuracy: 1 });
    expect(tracker.coords).toHaveLength(1);
  });
});

// ── _onPosition: distance accumulation ──────────────────

describe('GPS distance accumulation', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._autoPauseEnabled = false;
  });

  it('does not accumulate distance on first point', () => {
    feedPos(tracker, 40.0, -3.0);
    expect(tracker.distance).toBe(0);
    expect(tracker.coords).toHaveLength(1);
  });

  it('accumulates distance between valid points', () => {
    // Two points ~55m apart (0.0005 degree latitude, under 100m jump filter)
    feedPos(tracker, 40.0, -3.0);
    feedPos(tracker, 40.0 + STEP, -3.0);
    expect(tracker.distance).toBeGreaterThan(0.05);  // > 50m in km
    expect(tracker.distance).toBeLessThan(0.06);
  });

  it('filters micro-movements < 1m', () => {
    feedPos(tracker, 40.0, -3.0);
    // ~0.5m movement
    feedPos(tracker, 40.0000045, -3.0);
    expect(tracker.distance).toBe(0);
  });

  it('filters GPS jumps > 100m between consecutive points', () => {
    feedPos(tracker, 40.0, -3.0);
    // ~1.1km jump
    feedPos(tracker, 40.01, -3.0);
    expect(tracker.distance).toBe(0);
  });

  it('accumulates distance over multiple valid points', () => {
    // 10 points each ~55m apart = 9 segments ≈ 495m
    for (let i = 0; i < 10; i++) {
      feedPos(tracker, 40.0 + i * STEP, -3.0);
    }
    expect(tracker.distance).toBeGreaterThan(0.45);
    expect(tracker.distance).toBeLessThan(0.55);
  });

  it('ignores points when state is not tracking', () => {
    tracker.state = 'paused';
    feedPos(tracker, 40.0, -3.0);
    feedPos(tracker, 40.001, -3.0);
    expect(tracker.coords).toHaveLength(0);
    expect(tracker.distance).toBe(0);
  });
});

// ── _onPosition: auto-pause ─────────────────────────────

describe('GPS auto-pause', () => {
  let tracker;
  let autoPauseState;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._autoPauseEnabled = true;
    autoPauseState = null;
    tracker.onAutoPause(paused => { autoPauseState = paused; });
  });

  it('does not auto-pause on first point', () => {
    feedPos(tracker, 40.0, -3.0, { speed: 0, ts: 1000 });
    expect(tracker.isAutoPaused).toBe(false);
  });

  it('auto-pauses after 5s of stillness (speed < 0.5 m/s)', () => {
    feedPos(tracker, 40.0, -3.0, { speed: 3, ts: 1000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.3, ts: 2000 });
    expect(tracker.isAutoPaused).toBe(false);
    // 5 seconds of stillness
    feedPos(tracker, 40.0, -3.0, { speed: 0.2, ts: 8000 });
    expect(tracker.isAutoPaused).toBe(true);
    expect(autoPauseState).toBe(true);
  });

  it('resumes from auto-pause when movement detected', () => {
    feedPos(tracker, 40.0, -3.0, { speed: 3, ts: 1000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 2000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 8000 });
    expect(tracker.isAutoPaused).toBe(true);
    // Resume with movement
    feedPos(tracker, 40.001, -3.0, { speed: 3, ts: 9000 });
    expect(tracker.isAutoPaused).toBe(false);
    expect(autoPauseState).toBe(false);
  });

  it('does not accumulate distance while auto-paused', () => {
    feedPos(tracker, 40.0, -3.0, { speed: 3, ts: 1000 });
    feedPos(tracker, 40.001, -3.0, { speed: 0.1, ts: 2000 });
    feedPos(tracker, 40.001, -3.0, { speed: 0.1, ts: 8000 });
    expect(tracker.isAutoPaused).toBe(true);
    const distAtPause = tracker.distance;
    // Feed more still points
    feedPos(tracker, 40.001, -3.0, { speed: 0.1, ts: 12000 });
    feedPos(tracker, 40.001, -3.0, { speed: 0.1, ts: 15000 });
    expect(tracker.distance).toBe(distAtPause);
  });

  it('does not auto-pause when disabled', () => {
    tracker._autoPauseEnabled = false;
    feedPos(tracker, 40.0, -3.0, { speed: 3, ts: 1000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 2000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 8000 });
    expect(tracker.isAutoPaused).toBe(false);
  });

  it('toggleAutoPause resumes if currently auto-paused', () => {
    feedPos(tracker, 40.0, -3.0, { speed: 3, ts: 1000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 2000 });
    feedPos(tracker, 40.0, -3.0, { speed: 0.1, ts: 8000 });
    expect(tracker.isAutoPaused).toBe(true);
    tracker.toggleAutoPause();
    expect(tracker.isAutoPaused).toBe(false);
    expect(tracker.autoPauseEnabled).toBe(false);
  });
});

// ── Splits ──────────────────────────────────────────────

describe('GPS splits', () => {
  let tracker;
  let splitData;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now();
    tracker._autoPauseEnabled = false;
    splitData = [];
    tracker.onSplit(s => splitData.push(s));
  });

  it('records a split at 1km', () => {
    // ~55m per STEP. Need ~19 steps for 1km
    for (let i = 0; i < 20; i++) {
      feedPos(tracker, 40.0 + i * STEP, -3.0, { ts: 1000 + i * 5000 });
    }
    expect(tracker.splits.length).toBeGreaterThanOrEqual(1);
    expect(tracker.splits[0].km).toBe(1);
    expect(tracker.splits[0]).toHaveProperty('time');
    expect(tracker.splits[0]).toHaveProperty('pace');
    expect(tracker.splits[0]).toHaveProperty('elevation');
  });

  it('fires onSplit callback', () => {
    for (let i = 0; i < 20; i++) {
      feedPos(tracker, 40.0 + i * STEP, -3.0, { ts: 1000 + i * 5000 });
    }
    expect(splitData.length).toBeGreaterThanOrEqual(1);
    expect(splitData[0].km).toBe(1);
  });
});

// ── Pace calculation ────────────────────────────────────

describe('GPS pace calculation', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now();
    tracker._autoPauseEnabled = false;
  });

  it('currentPace is 0 with < 2 recent points', () => {
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    expect(tracker.currentPace).toBe(0);
  });

  it('calculates current pace from recent points', () => {
    // 3 points within 15s window so _recentPoints keeps all of them
    // Each ~55m apart, 5s intervals → ~91 sec/km pace
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    feedPos(tracker, 40.0 + STEP, -3.0, { ts: 6000 });
    feedPos(tracker, 40.0 + STEP * 2, -3.0, { ts: 11000 });
    expect(tracker.currentPace).toBeGreaterThan(50);
    expect(tracker.currentPace).toBeLessThan(200);
  });

  it('calculates avgPace when distance > 0.01', () => {
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    feedPos(tracker, 40.0 + STEP, -3.0, { ts: 31000 });
    expect(tracker.avgPace).toBeGreaterThan(0);
  });
});

// ── Elevation ───────────────────────────────────────────

describe('GPS elevation tracking', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._autoPauseEnabled = false;
  });

  it('tracks elevation gain from coords', () => {
    feedPos(tracker, 40.0, -3.0, { alt: 100 });
    feedPos(tracker, 40.0 + STEP, -3.0, { alt: 110 });
    feedPos(tracker, 40.0 + STEP * 2, -3.0, { alt: 105 });
    feedPos(tracker, 40.0 + STEP * 3, -3.0, { alt: 120 });
    // +10 (counted) -5 (ignored) +15 (counted) = 25
    expect(tracker._calcTotalElevation()).toBe(25);
  });

  it('filters elevation noise < 1m', () => {
    feedPos(tracker, 40.0, -3.0, { alt: 100 });
    feedPos(tracker, 40.0 + STEP, -3.0, { alt: 100.5 });
    feedPos(tracker, 40.0 + STEP * 2, -3.0, { alt: 100.8 });
    expect(tracker._calcTotalElevation()).toBe(0);
  });

  it('getResult includes elevation in output', () => {
    tracker.coords = [
      [40.0, -3.0, 100, 1000],
      [40.001, -3.0, 115, 2000],
    ];
    const result = tracker.getResult();
    expect(result.elevation).toBe(15);
  });
});

// ── Serialize / Restore ─────────────────────────────────

describe('GPS tracker serialize/restore', () => {
  it('serializes tracking state', () => {
    const tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now() - 60000;
    tracker.distance = 1.5;
    tracker.elapsed = 60;
    tracker.coords = [[40.0, -3.0, 100, 1000]];
    tracker.splits = [{ km: 1, time: 300, pace: 300, elevation: 5 }];
    tracker._wakeLockEnabled = true;
    tracker._autoPauseEnabled = true;

    const snap = tracker.serialize();

    expect(snap.state).toBe('tracking');
    expect(snap.distance).toBe(1.5);
    expect(snap.coords).toHaveLength(1);
    expect(snap.splits).toHaveLength(1);
    expect(snap.wakeLockEnabled).toBe(true);
    expect(snap.autoPauseEnabled).toBe(true);
    expect(snap).toHaveProperty('wallClockAnchor');
    expect(snap).toHaveProperty('perfNowAnchor');
  });

  it('restores state and recalculates timing', () => {
    const tracker = new GpsTracker();
    const snap = {
      state: 'paused',
      startedAt: performance.now() - 120000,
      totalPaused: 0,
      pauseStart: performance.now() - 10000,
      elapsed: 110,
      distance: 2.0,
      currentPace: 300,
      avgPace: 330,
      splits: [{ km: 1, time: 300, pace: 300, elevation: 0 }],
      coords: [[40.0, -3.0, 100, 1000], [40.001, -3.0, 105, 2000]],
      lastPos: [40.001, -3.0, 105, 2000],
      lastSplitDist: 1,
      lastSplitTime: 300,
      recentPoints: [],
      wakeLockEnabled: false,
      autoPauseEnabled: true,
      totalAutoPaused: 5000,
      wallClockAnchor: Date.now(),
      perfNowAnchor: performance.now(),
    };

    const restored = tracker.restore(snap);

    expect(restored).toBe(true);
    expect(tracker.state).toBe('paused');
    expect(tracker.distance).toBe(2.0);
    expect(tracker.coords).toHaveLength(2);
    expect(tracker.splits).toHaveLength(1);
    expect(tracker._wakeLockEnabled).toBe(false);
    expect(tracker._autoPauseEnabled).toBe(true);
    expect(tracker._totalAutoPaused).toBe(5000);
  });

  it('returns false for null/idle snapshots', () => {
    const tracker = new GpsTracker();
    expect(tracker.restore(null)).toBe(false);
    expect(tracker.restore({ state: 'idle' })).toBe(false);
    expect(tracker.restore({})).toBe(false);
  });
});

// ── onUpdate callback ───────────────────────────────────

describe('GPS onUpdate callback', () => {
  let tracker;
  let updates;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now();
    tracker._autoPauseEnabled = false;
    updates = [];
    tracker.onUpdate(data => updates.push(data));
  });

  it('fires onUpdate with position data', () => {
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty('elapsed');
    expect(updates[0]).toHaveProperty('distance');
    expect(updates[0]).toHaveProperty('lat', 40.0);
    expect(updates[0]).toHaveProperty('lng', -3.0);
  });

  it('includes autoPaused flag', () => {
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    expect(updates[0].autoPaused).toBe(false);
  });

  it('does not fire when state is not tracking', () => {
    tracker.state = 'idle';
    feedPos(tracker, 40.0, -3.0, { ts: 1000 });
    expect(updates).toHaveLength(0);
  });
});

// ── getResult structure ─────────────────────────────────

describe('GPS getResult', () => {
  it('returns complete result structure', () => {
    const tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now() - 1800000; // 30 min ago
    tracker._autoPauseEnabled = false;
    tracker.elapsed = 1800;
    tracker.distance = 5.0;
    tracker.coords = [
      [40.0, -3.0, 100, 1000],
      [40.001, -3.0, 110, 2000],
      [40.002, -3.0, 105, 3000],
    ];
    tracker.splits = [
      { km: 1, time: 360, pace: 360, elevation: 10 },
    ];

    const result = tracker.getResult();

    expect(result.distance).toBe(5.0);
    expect(result.duration).toBe(1800);
    expect(result.pace).toBe(360); // 1800/5 = 360 sec/km
    expect(result.avgSpeed).toBe(10); // 5km / 0.5h = 10 km/h
    expect(result.source).toBe('gps');
    expect(result.splits).toHaveLength(1);
    expect(result.route.coords).toHaveLength(3);
    expect(result.route.coords[0]).toHaveLength(4);
    // Coords should be rounded
    expect(result.route.coords[0][0]).toBe(40.0);
    expect(result.route.coords[0][2]).toBe(100);
    expect(result.elevation).toBe(10); // +10, -5 ignored, total gain = 10
  });

  it('handles zero distance gracefully', () => {
    const tracker = new GpsTracker();
    tracker.elapsed = 600;
    tracker.distance = 0;
    const result = tracker.getResult();
    expect(result.pace).toBe(0);
    expect(result.avgSpeed).toBe(0);
  });

  it('handles zero elapsed gracefully', () => {
    const tracker = new GpsTracker();
    tracker.elapsed = 0;
    tracker.distance = 5;
    const result = tracker.getResult();
    expect(result.avgSpeed).toBe(0);
  });
});

// ── Pause / Resume lifecycle ────────────────────────────

describe('GPS pause/resume', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._startTime = performance.now() - 60000;
    tracker._autoPauseEnabled = false;
  });

  it('pause changes state to paused', () => {
    tracker.pause();
    expect(tracker.state).toBe('paused');
  });

  it('resume changes state back to tracking', () => {
    tracker.pause();
    tracker.resume();
    expect(tracker.state).toBe('tracking');
  });

  it('pause does nothing if not tracking', () => {
    tracker.state = 'idle';
    tracker.pause();
    expect(tracker.state).toBe('idle');
  });

  it('resume does nothing if not paused', () => {
    tracker.resume();
    expect(tracker.state).toBe('tracking'); // unchanged
  });

  it('stop returns result when tracking', () => {
    tracker.distance = 3.0;
    tracker.elapsed = 900;
    const result = tracker.stop();
    expect(result).not.toBeNull();
    expect(result.distance).toBe(3.0);
    expect(tracker.state).toBe('idle');
  });

  it('stop returns result when paused', () => {
    tracker.distance = 2.0;
    tracker.pause();
    const result = tracker.stop();
    expect(result).not.toBeNull();
    expect(result.distance).toBe(2.0);
    expect(tracker.state).toBe('idle');
  });

  it('stop returns null when idle', () => {
    tracker.state = 'idle';
    expect(tracker.stop()).toBeNull();
  });
});

// ── lastGpsTime tracking for background poll ────────────

describe('GPS background poll threshold', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GpsTracker();
    tracker.state = 'tracking';
    tracker._autoPauseEnabled = false;
  });

  it('updates _lastGpsTime on every position', () => {
    expect(tracker._lastGpsTime).toBe(0);
    feedPos(tracker, 40.0, -3.0);
    expect(tracker._lastGpsTime).toBeGreaterThan(0);
  });

  it('updates _lastGpsTime even for filtered positions', () => {
    // Inaccurate position still updates lastGpsTime because
    // _onPosition sets it before filtering
    feedPos(tracker, 40.0, -3.0, { accuracy: 50 });
    expect(tracker._lastGpsTime).toBeGreaterThan(0);
  });
});

// ── Route coordinates rounding ──────────────────────────

describe('GPS route coordinate rounding', () => {
  it('rounds lat/lng to 6 decimals and alt to 1 decimal', () => {
    const tracker = new GpsTracker();
    tracker.coords = [[40.41681234567, -3.70381234567, 650.1789, 1000]];
    const result = tracker.getResult();
    const c = result.route.coords[0];
    expect(c[0]).toBe(40.416812);
    expect(c[1]).toBe(-3.703812);
    expect(c[2]).toBe(650.2);
    expect(c[3]).toBe(1000);
  });
});

// ── Wake Lock state ─────────────────────────────────────

describe('GPS wake lock state', () => {
  it('wakeLockActive is false by default', () => {
    const tracker = new GpsTracker();
    expect(tracker.wakeLockActive).toBe(false);
  });

  it('wakeLockActive requires both enabled and lock object', () => {
    const tracker = new GpsTracker();
    tracker._wakeLockEnabled = true;
    tracker._wakeLock = null;
    expect(tracker.wakeLockActive).toBe(false);
    tracker._wakeLock = {};
    expect(tracker.wakeLockActive).toBe(true);
  });
});
