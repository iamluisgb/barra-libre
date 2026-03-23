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
// Chrome inspects <audio> element buffers for non-zero PCM samples.
// If it finds real audio, it creates an Android foreground service that
// keeps JS timers and GPS alive even with the screen locked.
//
// Primary: <audio> element playing a generated WAV with a near-inaudible
//   200Hz tone (~-50dB). Chrome sees non-zero samples → foreground service.
// Secondary: Web Audio oscillator as extra insurance.
// Tertiary: Media Session API for lock-screen notification.

let _keepAliveAudio = null;
let _keepAliveOsc = null;
let _keepAliveActive = false;
let _keepAliveWavUrl = null;

function _writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function _getKeepAliveWavUrl() {
  if (_keepAliveWavUrl) return _keepAliveWavUrl;

  const sampleRate = 44100;
  const numSamples = sampleRate; // 1 second
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  _writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  _writeString(view, 8, 'WAVE');
  _writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample

  _writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // 200Hz tone at amplitude 100/32767 ≈ -50dB — inaudible but non-zero
  const amplitude = 100;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * 200 * i / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }

  _keepAliveWavUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return _keepAliveWavUrl;
}

function _createKeepAliveAudio() {
  const audio = new Audio(_getKeepAliveWavUrl());
  audio.loop = true;
  audio.volume = 0.01;
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
