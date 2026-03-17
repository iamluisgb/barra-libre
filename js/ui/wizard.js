/**
 * Reusable Wizard / Stepper component.
 *
 * Usage:
 *   const wiz = createWizard({
 *     container: document.getElementById('myWiz'),
 *     steps: [
 *       { title: 'Basics', render(el) { el.innerHTML = '...' }, validate() { return true; } },
 *       { title: 'Details', render(el) { ... } },
 *     ],
 *     onFinish(data) { console.log('done'); },
 *     onCancel()     { console.log('cancelled'); },
 *   });
 *   wiz.open();   // shows the wizard
 *   wiz.close();  // hides it
 */

export function createWizard({ container, steps, onFinish, onCancel }) {
  let current = 0;
  const data = {};

  // ── Build DOM ───────────────────────────────────────
  container.innerHTML = '';
  container.classList.add('wizard');

  // Header: step indicators
  const $header = document.createElement('div');
  $header.className = 'wiz-header';
  steps.forEach((s, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'wiz-step-dot';
    dot.setAttribute('aria-label', s.title);
    dot.textContent = i + 1;
    dot.addEventListener('click', () => { if (i < current) goTo(i); });
    $header.appendChild(dot);
    if (i < steps.length - 1) {
      const line = document.createElement('span');
      line.className = 'wiz-step-line';
      $header.appendChild(line);
    }
  });
  container.appendChild($header);

  // Title
  const $title = document.createElement('h3');
  $title.className = 'wiz-title';
  container.appendChild($title);

  // Body (step content)
  const $body = document.createElement('div');
  $body.className = 'wiz-body';
  container.appendChild($body);

  // Footer: nav buttons
  const $footer = document.createElement('div');
  $footer.className = 'wiz-footer';

  const $back = document.createElement('button');
  $back.type = 'button';
  $back.className = 'btn btn-outline wiz-back';
  $back.textContent = 'Atrás';
  $back.addEventListener('click', prev);

  const $next = document.createElement('button');
  $next.type = 'button';
  $next.className = 'btn wiz-next';
  $next.addEventListener('click', next);

  const $cancel = document.createElement('button');
  $cancel.type = 'button';
  $cancel.className = 'btn btn-outline wiz-cancel';
  $cancel.textContent = 'Cancelar';
  $cancel.addEventListener('click', () => { if (onCancel) onCancel(); close(); });

  $footer.append($cancel, $back, $next);
  container.appendChild($footer);

  // ── Navigation ──────────────────────────────────────
  function render() {
    const step = steps[current];

    // Update dots
    $header.querySelectorAll('.wiz-step-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
      d.classList.toggle('done', i < current);
    });
    $header.querySelectorAll('.wiz-step-line').forEach((l, i) => {
      l.classList.toggle('done', i < current);
    });

    // Title
    $title.textContent = step.title;

    // Body
    $body.innerHTML = '';
    step.render($body, data);

    // Buttons
    $back.style.display = current === 0 ? 'none' : '';
    $cancel.style.display = current === 0 ? '' : 'none';
    $next.textContent = current === steps.length - 1 ? 'Finalizar' : 'Siguiente';
  }

  function goTo(i) {
    current = i;
    render();
  }

  function next() {
    const step = steps[current];
    if (step.validate && !step.validate(data)) return;
    if (current < steps.length - 1) {
      current++;
      render();
    } else {
      if (onFinish) onFinish(data);
      close();
    }
  }

  function prev() {
    if (current > 0) { current--; render(); }
  }

  function open() {
    current = 0;
    Object.keys(data).forEach(k => delete data[k]);
    container.style.display = '';
    render();
  }

  function close() {
    container.style.display = 'none';
  }

  // Start hidden
  container.style.display = 'none';

  return { open, close, goTo, getData: () => data };
}
