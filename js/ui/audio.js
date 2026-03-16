// ── Shared audio/haptic engine ───────────────────────────

let _audioCtx = null;

export function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

export function beep(freq = 880, ms = 200) {
  try {
    const ctx = getAudioCtx(), now = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.01, now + ms / 1000);
    o.start(now); o.stop(now + ms / 1000);
  } catch (e) { /* silent fail */ }
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (e) { /* silent fail */ }
}
