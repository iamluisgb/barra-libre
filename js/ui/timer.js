let audioCtx = null;
let timerInterval = null;
let timerSeconds = 120;
let timerRunning = false;
let timerDuration = 120;
let timerMode = 'countdown';

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function playAlarm() {
  try {
    const ctx = getAudioCtx(), now = ctx.currentTime;
    [0, .25, .5].forEach((offset, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = 'sine';
      o.frequency.value = 880 + i * 220;
      g.gain.setValueAtTime(.3, now + offset);
      g.gain.exponentialRampToValueAtTime(.01, now + offset + .2);
      o.start(now + offset); o.stop(now + offset + .2);
    });
    [1320, 1760].forEach(f => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(.2, now + .9);
      g.gain.exponentialRampToValueAtTime(.01, now + 1.6);
      o.start(now + .9); o.stop(now + 1.7);
    });
  } catch (e) { }
}

function updateTimerDisplay() {
  const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
  const d = document.getElementById('timerDisplay');
  d.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (timerMode === 'countdown') {
    d.classList.toggle('warning', timerSeconds <= 10 && timerSeconds > 0);
  }
}

function startTimer() {
  if (timerMode === 'countdown') {
    timerSeconds = timerDuration;
  }
  timerRunning = true;
  const btn = document.getElementById('timerStartBtn');
  btn.textContent = '⏹'; btn.classList.add('running');
  updateTimerDisplay();

  if (timerMode === 'countdown') {
    timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerDisplay();
      if (timerSeconds <= 0) {
        stopTimer();
        const d = document.getElementById('timerDisplay');
        d.classList.add('done'); d.textContent = '¡GO!';
        playAlarm();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
        setTimeout(() => { d.classList.remove('done'); timerSeconds = timerDuration; updateTimerDisplay(); }, 3000);
      }
    }, 1000);
  } else {
    timerInterval = setInterval(() => {
      timerSeconds++;
      updateTimerDisplay();
    }, 1000);
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  const btn = document.getElementById('timerStartBtn');
  btn.textContent = '▶'; btn.classList.remove('running');
  if (timerMode === 'countdown') {
    timerSeconds = timerDuration;
    updateTimerDisplay();
  }
  document.getElementById('timerDisplay').classList.remove('warning', 'done');
}

export function toggleTimer() {
  if (audioCtx) audioCtx.resume();
  if (timerRunning) stopTimer(); else startTimer();
}

export function setTimerMode(mode) {
  if (timerRunning) stopTimer();
  timerMode = mode;
  const bar = document.getElementById('timerBar');
  bar.classList.remove('mode-countdown', 'mode-stopwatch');
  bar.classList.add('mode-' + mode);

  document.querySelectorAll('.timer-mode').forEach(b => b.classList.remove('active'));
  document.querySelector(`.timer-mode[data-mode="${mode}"]`).classList.add('active');

  document.getElementById('timerCustomInput').classList.remove('visible');
  document.getElementById('timerDisplay').style.display = '';

  if (mode === 'stopwatch') {
    timerSeconds = 0;
  } else {
    timerSeconds = timerDuration;
  }
  updateTimerDisplay();
}

export function showCustomInput() {
  const input = document.getElementById('timerCustomInput');
  const display = document.getElementById('timerDisplay');
  input.classList.add('visible');
  display.style.display = 'none';
  const m = Math.floor(timerDuration / 60), s = timerDuration % 60;
  input.value = `${m}:${s.toString().padStart(2, '0')}`;
  input.focus();
  input.select();
}

export function confirmCustomInput() {
  const input = document.getElementById('timerCustomInput');
  const display = document.getElementById('timerDisplay');
  const raw = input.value.trim();

  let seconds = 0;
  if (raw.includes(':')) {
    const parts = raw.split(':');
    seconds = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  } else {
    seconds = parseInt(raw) || 0;
  }

  if (seconds > 0) {
    timerDuration = seconds;
    timerSeconds = timerDuration;
    document.querySelectorAll('.timer-btn[data-dur]').forEach(b => b.classList.remove('active-dur'));
  }

  input.classList.remove('visible');
  display.style.display = '';
  updateTimerDisplay();
}

export function resetStopwatch() {
  if (timerRunning) stopTimer();
  timerSeconds = 0;
  updateTimerDisplay();
}

export function initTimer() {
  document.querySelectorAll('.timer-btn[data-dur]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timer-btn[data-dur]').forEach(b => b.classList.remove('active-dur'));
      btn.classList.add('active-dur');
      timerDuration = parseInt(btn.dataset.dur);
      if (!timerRunning) { timerSeconds = timerDuration; updateTimerDisplay(); }
    });
  });

  document.addEventListener('touchstart', function u() {
    getAudioCtx().resume();
    document.removeEventListener('touchstart', u);
  }, { once: true });
}
