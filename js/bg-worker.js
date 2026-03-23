// Background timer Web Worker
// Worker timers are significantly less throttled than main-thread timers
// when the page is backgrounded or the screen is locked on Chrome Android.

let interval = null;

self.onmessage = (e) => {
  if (e.data === 'start') {
    if (interval) clearInterval(interval);
    interval = setInterval(() => self.postMessage('tick'), 3000);
  } else if (e.data === 'stop') {
    if (interval) { clearInterval(interval); interval = null; }
  }
};
