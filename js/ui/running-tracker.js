/**
 * GPS Running Tracker Engine
 * Handles live GPS tracking with distance, pace, splits, and route recording.
 * Runs in background by default (screen can sleep). Wake Lock is opt-in via
 * toggleWakeLock() to keep the screen on when the user wants it.
 */

// ── Haversine distance (meters) ─────────────────────────
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Tracker ─────────────────────────────────────────────

export class GpsTracker {
  constructor() {
    this.state = 'idle'; // idle | tracking | paused
    this._watchId = null;
    this._startTime = 0;
    this._pauseStart = 0;
    this._totalPaused = 0;
    this._timerRaf = null;
    this._timerInterval = null;
    this._bgPollInterval = null;   // background GPS polling fallback
    this._lastGpsTime = 0;         // timestamp of last GPS callback
    this._wakeLock = null;
    this._wakeLockEnabled = false; // opt-in: user toggles this
    this._visibilityHandler = null;

    // Auto-pause
    this._autoPauseEnabled = true;  // on by default
    this._autoPaused = false;
    this._autoPauseStart = 0;       // performance.now() when auto-paused
    this._totalAutoPaused = 0;      // ms accumulated in auto-pause
    this._stillSince = 0;           // timestamp when speed first dropped below threshold
    this._onAutoPause = null;

    // Accumulated data
    this.elapsed = 0;      // seconds (excluding pauses)
    this.distance = 0;     // km
    this.currentPace = 0;  // sec/km (rolling avg)
    this.avgPace = 0;      // sec/km (global)
    this.splits = [];      // { km, time, pace, elevation }
    this.coords = [];      // [[lat, lng, alt, timestamp], ...]

    // Internal
    this._lastPos = null;
    this._lastSplitDist = 0;
    this._lastSplitTime = 0;
    this._recentPoints = []; // for instantaneous pace calc

    // Callbacks
    this._onUpdate = null;
    this._onSplit = null;
    this._onError = null;
  }

  onUpdate(cb)     { this._onUpdate = cb; }
  onSplit(cb)      { this._onSplit = cb; }
  onError(cb)      { this._onError = cb; }
  onAutoPause(cb)  { this._onAutoPause = cb; }

  get autoPauseEnabled() { return this._autoPauseEnabled; }
  get isAutoPaused() { return this._autoPaused; }

  toggleAutoPause() {
    this._autoPauseEnabled = !this._autoPauseEnabled;
    // If disabling while auto-paused, resume immediately
    if (!this._autoPauseEnabled && this._autoPaused) {
      this._autoResume();
    }
    return this._autoPauseEnabled;
  }

  // ── Start tracking ──────────────────────────────────────

  start() {
    if (this.state === 'tracking') return;

    if (!navigator.geolocation) {
      this._onError?.('GPS no disponible en este dispositivo');
      return false;
    }

    this.state = 'tracking';
    this._startTime = performance.now();
    this._totalPaused = 0;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._totalAutoPaused = 0;
    this._stillSince = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.currentPace = 0;
    this.avgPace = 0;
    this.splits = [];
    this.coords = [];
    this._lastPos = null;
    this._lastSplitDist = 0;
    this._lastSplitTime = 0;
    this._recentPoints = [];

    this._startGps();
    this._startTimer();
    this._startBgPoll();
    this._bindVisibility();
    // Auto-enable wake lock on start (user can toggle off)
    this._wakeLockEnabled = true;
    this._acquireWakeLock();
    return true;
  }

  // ── Pause / Resume ──────────────────────────────────────

  pause() {
    if (this.state !== 'tracking') return;
    // Settle any active auto-pause into the total
    if (this._autoPaused) {
      this._totalAutoPaused += performance.now() - this._autoPauseStart;
      this._autoPaused = false;
      this._autoPauseStart = 0;
    }
    this.state = 'paused';
    this._pauseStart = performance.now();
    this._stopGps();
    this._stopTimer();
    this._stopBgPoll();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'tracking';
    this._totalPaused += performance.now() - this._pauseStart;
    this._startGps();
    this._startTimer();
    this._startBgPoll();
  }

  // ── Stop tracking ───────────────────────────────────────

  stop() {
    if (this.state === 'idle') return null;

    if (this.state === 'paused') {
      this._totalPaused += performance.now() - this._pauseStart;
    }

    this._stopGps();
    this._stopTimer();
    this._stopBgPoll();
    this._releaseWakeLock();
    this._unbindVisibility();
    this._wakeLockEnabled = false;
    this._updateElapsed();
    this.state = 'idle';

    return this.getResult();
  }

  // ── Get result object ───────────────────────────────────

  getResult() {
    return {
      distance: Math.round(this.distance * 1000) / 1000,
      duration: Math.round(this.elapsed),
      pace: this.distance > 0 ? Math.round(this.elapsed / this.distance) : 0,
      avgSpeed: this.elapsed > 0 ? Math.round((this.distance / (this.elapsed / 3600)) * 10) / 10 : 0,
      splits: [...this.splits],
      route: {
        coords: this.coords.map(c => [
          Math.round(c[0] * 1e6) / 1e6,
          Math.round(c[1] * 1e6) / 1e6,
          Math.round((c[2] || 0) * 10) / 10,
          c[3]
        ])
      },
      elevation: this._calcTotalElevation(),
      source: 'gps'
    };
  }

  // ── Serialize / Restore (survive page reload) ───────────

  serialize() {
    return {
      state: this.state,
      startedAt: this._startTime,
      totalPaused: this._totalPaused,
      pauseStart: this._pauseStart,
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      splits: this.splits,
      coords: this.coords,
      lastPos: this._lastPos,
      lastSplitDist: this._lastSplitDist,
      lastSplitTime: this._lastSplitTime,
      recentPoints: this._recentPoints,
      wakeLockEnabled: this._wakeLockEnabled,
      autoPauseEnabled: this._autoPauseEnabled,
      totalAutoPaused: this._totalAutoPaused + (this._autoPaused ? performance.now() - this._autoPauseStart : 0),
      // Wall-clock anchor: convert performance.now() to Date.now() for cross-reload
      wallClockAnchor: Date.now(),
      perfNowAnchor: performance.now(),
    };
  }

  restore(snap) {
    if (!snap || !snap.state || snap.state === 'idle') return false;

    // Reconstruct performance.now()-based times using wall-clock delta
    const wallDelta = Date.now() - snap.wallClockAnchor; // ms since snapshot
    const perfOffset = performance.now() - (snap.perfNowAnchor + wallDelta);

    this.state = snap.state;
    this._startTime = snap.startedAt + perfOffset;
    this._totalPaused = snap.totalPaused;
    this._pauseStart = snap.pauseStart ? snap.pauseStart + perfOffset : 0;
    this.elapsed = snap.elapsed;
    this.distance = snap.distance;
    this.currentPace = snap.currentPace;
    this.avgPace = snap.avgPace;
    this.splits = snap.splits || [];
    this.coords = snap.coords || [];
    this._lastPos = snap.lastPos;
    this._lastSplitDist = snap.lastSplitDist;
    this._lastSplitTime = snap.lastSplitTime;
    this._recentPoints = snap.recentPoints || [];
    this._wakeLockEnabled = snap.wakeLockEnabled ?? true;
    this._autoPauseEnabled = snap.autoPauseEnabled ?? true;
    this._totalAutoPaused = snap.totalAutoPaused || 0;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._stillSince = 0;

    // If was tracking, resume GPS + timer
    if (this.state === 'tracking') {
      this._updateElapsed();
      this._startGps();
      this._startTimer();
      this._startBgPoll();
      this._bindVisibility();
      if (this._wakeLockEnabled) this._acquireWakeLock();
    } else if (this.state === 'paused') {
      // Paused: just recalc elapsed, don't start GPS
      this._updateElapsed();
      this._bindVisibility();
    }

    return true;
  }

  // ── Wake Lock (opt-in: keeps screen on) ─────────────────
  // Called by the UI when user taps the lock/unlock button.
  // Returns the new state (true = screen stays on, false = screen can sleep).

  async toggleWakeLock() {
    this._wakeLockEnabled = !this._wakeLockEnabled;
    if (this._wakeLockEnabled) {
      await this._acquireWakeLock();
    } else {
      this._releaseWakeLock();
    }
    return this._wakeLockEnabled;
  }

  get wakeLockActive() {
    return this._wakeLockEnabled && this._wakeLock !== null;
  }

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener('release', () => {
        this._wakeLock = null;
      });
    } catch (e) {
      console.warn('Wake Lock failed:', e.message);
    }
  }

  _releaseWakeLock() {
    if (this._wakeLock) {
      this._wakeLock.release();
      this._wakeLock = null;
    }
  }

  // ── Visibility handling (restart GPS on foreground) ──────

  _bindVisibility() {
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.state === 'tracking') {
        // Re-acquire wake lock if user had it enabled (it's auto-released on hidden)
        if (this._wakeLockEnabled) this._acquireWakeLock();
        // Restart GPS watcher in case browser suspended it in background
        this._stopGps();
        this._startGps();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _unbindVisibility() {
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  // ── Background GPS polling ─────────────────────────────
  // Fallback: if watchPosition stops delivering (screen off on some devices),
  // poll getCurrentPosition every 5s to keep collecting data.

  _startBgPoll() {
    this._stopBgPoll();
    this._bgPollInterval = setInterval(() => {
      if (this.state !== 'tracking') return;
      // Only poll if watchPosition hasn't fired recently (> 6s)
      if (Date.now() - this._lastGpsTime > 4000) {
        navigator.geolocation.getCurrentPosition(
          pos => this._onPosition(pos),
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
        );
      }
    }, 5000);
  }

  _stopBgPoll() {
    if (this._bgPollInterval) {
      clearInterval(this._bgPollInterval);
      this._bgPollInterval = null;
    }
  }

  // ── GPS watcher ─────────────────────────────────────────

  _startGps() {
    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => {
        const msgs = {
          1: 'Permiso GPS denegado',
          2: 'GPS no disponible',
          3: 'Timeout GPS'
        };
        this._onError?.(msgs[err.code] || 'Error GPS');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  _stopGps() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  _onPosition(pos) {
    if (this.state !== 'tracking') return;
    this._lastGpsTime = Date.now();

    const { latitude: lat, longitude: lng, altitude: alt, accuracy, speed } = pos.coords;
    const ts = pos.timestamp;

    // Filter out inaccurate readings
    if (accuracy > 30) return;

    const point = [lat, lng, alt || 0, ts];

    // ── Auto-pause detection ──────────────────────────────
    if (this._autoPauseEnabled && this._lastPos) {
      const d = haversine(this._lastPos[0], this._lastPos[1], lat, lng);
      // Use GPS speed if available, otherwise estimate from distance
      const isStill = (speed !== null && speed >= 0)
        ? speed < 0.5   // < 0.5 m/s ≈ 1.8 km/h
        : d < 2;        // < 2m movement

      if (isStill) {
        if (!this._stillSince) this._stillSince = ts;
        if (!this._autoPaused && ts - this._stillSince > 5000) {
          this._autoPauseAt();
        }
        if (this._autoPaused) {
          // Still paused — just emit update with autoPaused flag, don't accumulate distance
          this._updateElapsed();
          this._onUpdate?.({
            elapsed: this.elapsed, distance: this.distance,
            currentPace: this.currentPace, avgPace: this.avgPace,
            lat, lng, splits: this.splits, autoPaused: true
          });
          return;
        }
      } else {
        this._stillSince = 0;
        if (this._autoPaused) this._autoResume();
      }
    }

    // ── Normal tracking ───────────────────────────────────
    this.coords.push(point);

    if (this._lastPos) {
      const d = haversine(this._lastPos[0], this._lastPos[1], lat, lng);

      // Filter GPS drift: ignore jumps > 100m between points
      if (d > 100) {
        this._lastPos = point;
        return;
      }

      // Filter micro-movements (< 1m)
      if (d < 1) return;

      this.distance += d / 1000; // to km
    }

    this._lastPos = point;

    // Track recent points for instantaneous pace (last 15 seconds)
    this._recentPoints.push({ lat, lng, time: ts });
    const cutoff = ts - 15000;
    this._recentPoints = this._recentPoints.filter(p => p.time >= cutoff);
    this._calcCurrentPace();

    // Global avg pace
    this._updateElapsed();
    if (this.distance > 0.01) {
      this.avgPace = this.elapsed / this.distance;
    }

    // Check for split completion
    this._checkSplit();

    this._onUpdate?.({
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      lat, lng,
      splits: this.splits,
      autoPaused: false
    });
  }

  // ── Auto-pause internals ──────────────────────────────

  _autoPauseAt() {
    this._autoPaused = true;
    this._autoPauseStart = performance.now();
    this._onAutoPause?.(true);
  }

  _autoResume() {
    if (!this._autoPaused) return;
    this._totalAutoPaused += performance.now() - this._autoPauseStart;
    this._autoPaused = false;
    this._autoPauseStart = 0;
    this._stillSince = 0;
    this._recentPoints = []; // reset pace window after pause
    this._onAutoPause?.(false);
  }

  // ── Pace calculation ────────────────────────────────────

  _calcCurrentPace() {
    if (this._recentPoints.length < 2) { this.currentPace = 0; return; }

    const first = this._recentPoints[0];
    const last = this._recentPoints[this._recentPoints.length - 1];
    const dt = (last.time - first.time) / 1000; // seconds
    if (dt < 3) { return; } // need at least 3s of data

    const dist = haversine(first.lat, first.lng, last.lat, last.lng) / 1000; // km
    if (dist > 0.001) {
      this.currentPace = dt / dist; // sec/km
    }
  }

  // ── Splits ──────────────────────────────────────────────

  _checkSplit() {
    const nextKm = this.splits.length + 1;
    if (this.distance >= nextKm) {
      this._updateElapsed();
      const splitTime = this.elapsed - this._lastSplitTime;
      const splitPace = splitTime; // 1 km, so pace = time

      const split = {
        km: nextKm,
        time: Math.round(splitTime),
        pace: Math.round(splitPace),
        elevation: this._calcSplitElevation(nextKm)
      };

      this.splits.push(split);
      this._lastSplitTime = this.elapsed;
      this._lastSplitDist = nextKm;

      this._onSplit?.(split);
    }
  }

  _calcSplitElevation(km) {
    const startIdx = Math.max(0, this.coords.length - 100);
    let gain = 0;
    for (let i = startIdx + 1; i < this.coords.length; i++) {
      const diff = (this.coords[i][2] || 0) - (this.coords[i - 1][2] || 0);
      if (diff > 0) gain += diff;
    }
    return Math.round(gain);
  }

  _calcTotalElevation() {
    let gain = 0;
    for (let i = 1; i < this.coords.length; i++) {
      const diff = (this.coords[i][2] || 0) - (this.coords[i - 1][2] || 0);
      if (diff > 1) gain += diff; // filter noise < 1m
    }
    return Math.round(gain);
  }

  // ── Timer ───────────────────────────────────────────────
  // RAF for smooth UI when screen is on.
  // setInterval as fallback for background (RAF is suspended on screen off).
  // Elapsed time uses performance.now() so it's always accurate regardless.

  _startTimer() {
    const tick = () => {
      this._updateElapsed();
      this._emitUpdate();
      this._timerRaf = requestAnimationFrame(tick);
    };
    this._timerRaf = requestAnimationFrame(tick);

    this._timerInterval = setInterval(() => {
      this._updateElapsed();
      this._emitUpdate();
    }, 1000);
  }

  _stopTimer() {
    if (this._timerRaf) {
      cancelAnimationFrame(this._timerRaf);
      this._timerRaf = null;
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _emitUpdate() {
    this._onUpdate?.({
      elapsed: this.elapsed,
      distance: this.distance,
      currentPace: this.currentPace,
      avgPace: this.avgPace,
      splits: this.splits,
      elevation: this._calcTotalElevation()
    });
  }

  _updateElapsed() {
    const autoPauseNow = this._autoPaused ? performance.now() - this._autoPauseStart : 0;
    const totalAuto = this._totalAutoPaused + autoPauseNow;
    if (this.state === 'tracking') {
      this.elapsed = (performance.now() - this._startTime - this._totalPaused - totalAuto) / 1000;
    } else if (this.state === 'paused') {
      this.elapsed = (this._pauseStart - this._startTime - this._totalPaused - totalAuto) / 1000;
    }
  }
}
