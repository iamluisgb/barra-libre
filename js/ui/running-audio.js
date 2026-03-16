// ── Running audio/haptic engine ──────────────────────────

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

export function beep(freq = 880, ms = 200) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.5;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch (e) { /* silent fail */ }
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (e) { /* silent fail */ }
}

/** 3-2-1 countdown: 3 short beeps + 1 long beep, then calls onComplete */
export function startCountdown(onComplete) {
  beep(880, 150); vibrate(200);
  setTimeout(() => { beep(880, 150); vibrate(200); }, 1000);
  setTimeout(() => { beep(880, 150); vibrate(200); }, 2000);
  setTimeout(() => { beep(1200, 400); vibrate(500); onComplete?.(); }, 3000);
}

export function beepSplit() { beep(880, 150); vibrate([100, 50, 100]); }
export function beepWorkStart() { beep(1200, 150); setTimeout(() => beep(1200, 150), 200); vibrate([200, 100, 200]); }
export function beepRestStart() { beep(440, 500); vibrate(500); }
export function beepAllDone() { beep(880, 150); setTimeout(() => beep(1200, 150), 200); setTimeout(() => beep(1500, 300), 400); vibrate([200, 100, 200, 100, 400]); }
export function beepSegmentChange() { beep(880, 400); vibrate(400); }
