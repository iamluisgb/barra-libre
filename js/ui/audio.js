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

// ── Keep-alive: prevent Chrome Android from suspending the page ──
// Chrome checks audio buffers for non-zero samples. A silent MP3 alone won't
// create the foreground service needed to keep JS alive with screen locked.
// Primary mechanism: Web Audio oscillator at 200Hz / gain 0.005 — produces
// non-zero samples that Chrome recognises as real media playback.
// Secondary: <audio> element for Media Session lock-screen notification.

let _keepAliveAudio = null;
let _keepAliveOsc = null;
let _keepAliveActive = false;

function _createKeepAliveAudio() {
  const audio = new Audio('assets/silence.mp3');
  audio.loop = true;
  audio.volume = 0.05;
  return audio;
}

async function _startOscillator() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 200;
    gain.gain.value = 0.005;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    _keepAliveOsc = osc;
  } catch (e) { /* silent fail */ }
}

/** Start keep-alive audio to maintain background execution (e.g. screen locked) */
export async function startKeepAlive() {
  if (_keepAliveActive) return;
  _keepAliveActive = true;

  _keepAliveAudio = _createKeepAliveAudio();
  _keepAliveAudio.play().catch(() => {});
  await _startOscillator();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Carrera en curso',
      artist: 'Barra Libre',
    });
  }
}

/** Stop the keep-alive audio */
export function stopKeepAlive() {
  _keepAliveActive = false;
  if (_keepAliveAudio) { _keepAliveAudio.pause(); _keepAliveAudio.src = ''; _keepAliveAudio = null; }
  if (_keepAliveOsc) { try { _keepAliveOsc.stop(); } catch (e) {} _keepAliveOsc = null; }
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

/** Resume or recreate keep-alive after returning to foreground */
export function resumeKeepAlive() {
  if (!_keepAliveActive) return;

  try { const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}

  if (!_keepAliveAudio || _keepAliveAudio.paused) {
    if (_keepAliveAudio) { _keepAliveAudio.src = ''; }
    _keepAliveAudio = _createKeepAliveAudio();
    _keepAliveAudio.play().catch(() => {});
  }

  if (!_keepAliveOsc) _startOscillator();
}
