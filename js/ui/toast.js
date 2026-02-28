let container;

/** Initialize toast notification container */
export function initToast() {
  container = document.getElementById('toastContainer');
}

/** Show a toast notification
 *  @param {string} message - Text to display
 *  @param {'success'|'error'|'info'} type - Toast style */
export function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  if (navigator.vibrate) navigator.vibrate(type === 'success' ? 50 : [50, 30, 50]);

  requestAnimationFrame(() => el.classList.add('visible'));

  setTimeout(() => {
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => el.remove());
  }, 2500);
}
