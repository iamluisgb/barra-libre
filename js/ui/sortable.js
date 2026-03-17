/**
 * Lightweight touch-friendly sortable list.
 *
 * Usage:
 *   import { makeSortable } from './sortable.js';
 *
 *   makeSortable({
 *     container: document.getElementById('myList'),
 *     handle: '.drag-handle',              // optional CSS selector for grab handle
 *     onReorder(fromIndex, toIndex) { ... } // called after a successful reorder
 *   });
 *
 * Items are the direct children of `container`.
 * If `handle` is omitted the entire item is draggable.
 */

export function makeSortable({ container, handle, onReorder }) {
  let dragged = null;
  let placeholder = null;
  let startY = 0;
  let offsetY = 0;
  let items = [];

  function getItem(el) {
    while (el && el.parentNode !== container) el = el.parentNode;
    return el;
  }

  function clientY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }

  function onStart(e) {
    if (handle && !e.target.closest(handle)) return;
    const item = getItem(e.target);
    if (!item) return;

    e.preventDefault();
    dragged = item;
    items = Array.from(container.children);
    const rect = item.getBoundingClientRect();
    startY = clientY(e);
    offsetY = startY - rect.top;

    // Create placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'sortable-placeholder';
    placeholder.style.height = rect.height + 'px';

    // Style dragged item
    dragged.classList.add('sortable-dragging');
    dragged.style.width = rect.width + 'px';
    dragged.style.top = rect.top + 'px';
    dragged.style.left = rect.left + 'px';

    container.insertBefore(placeholder, dragged);

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('mouseup', onEnd);
  }

  function onMove(e) {
    if (!dragged) return;
    e.preventDefault();
    const y = clientY(e);
    dragged.style.top = (y - offsetY) + 'px';

    // Find insertion point
    const children = Array.from(container.children).filter(c => c !== dragged && c !== placeholder);
    let inserted = false;
    for (const child of children) {
      const r = child.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        container.insertBefore(placeholder, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      container.appendChild(placeholder);
    }
  }

  function onEnd() {
    if (!dragged) return;

    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('mouseup', onEnd);

    dragged.classList.remove('sortable-dragging');
    dragged.style.width = '';
    dragged.style.top = '';
    dragged.style.left = '';

    // Insert dragged element at placeholder position
    container.insertBefore(dragged, placeholder);
    placeholder.remove();

    const newItems = Array.from(container.children);
    const fromIndex = items.indexOf(dragged);
    const toIndex = newItems.indexOf(dragged);

    placeholder = null;
    dragged = null;
    items = [];

    if (fromIndex !== toIndex && onReorder) {
      onReorder(fromIndex, toIndex);
    }
  }

  container.addEventListener('touchstart', onStart, { passive: false });
  container.addEventListener('mousedown', onStart);

  return {
    destroy() {
      container.removeEventListener('touchstart', onStart);
      container.removeEventListener('mousedown', onStart);
    }
  };
}
