// Drag to reorder a vertical list: the item follows the pointer and the others slide out of its way.
// A press that doesn't move is still a click; Esc puts the item back. From the keyboard, Alt+Up and Alt+Down move the
// item that has focus. onDrop gets the items in their new order.
export function sortable(list, { items, handle = items, onDrop }) {
  const kids = () => [...list.children].filter(el => el.matches(items));
  let drag = null;

  // Links drag their URL by default, which would end the pointer's drag.
  list.addEventListener('dragstart', e => { if (e.target.closest(handle)) e.preventDefault(); });

  // From the keyboard: the focused item moves one place, and keeps focus.
  list.addEventListener('keydown', e => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || drag) return;
    const el = e.target.closest(handle)?.closest(items);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();
    e.stopPropagation();
    const all = kids(), at = all.indexOf(el), to = at + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= all.length) return;
    const focused = /** @type {HTMLElement} */ (document.activeElement);
    list.insertBefore(el, e.key === 'ArrowUp' ? all[to] : all[to].nextSibling);
    focused?.focus?.();
    onDrop?.(kids());
  });

  list.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    const el = e.target.closest(handle)?.closest(items);
    if (!el || el.parentElement !== list) return;
    drag = { el, y0: e.clientY, top0: el.offsetTop, moved: false, home: el.nextElementSibling, dy: 0 };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', key, true);
  });

  function place() {
    const { el } = drag, all = kids();
    const lo = Math.min(...all.map(s => s.offsetTop)) - 4;
    const hi = Math.max(...all.map(s => s.offsetTop + s.offsetHeight)) - el.offsetHeight + 4;
    const top = Math.min(hi, Math.max(lo, drag.top0 + drag.dy));
    el.style.transform = `translateY(${top - el.offsetTop}px)`;
    return top + el.offsetHeight / 2;
  }

  // Moves the item in the DOM, sliding the others from where they were.
  function moveTo(ref) {
    const { el } = drag;
    if (ref === el || ref === el.nextElementSibling) return;
    const others = kids().filter(s => s !== el), before = new Map(others.map(s => [s, s.getBoundingClientRect().top]));
    list.insertBefore(el, ref);
    for (const s of others) {
      const shift = before.get(s) - s.getBoundingClientRect().top;
      if (shift) s.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
  }

  function move(e) {
    drag.dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(drag.dy) < 5) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
      list.classList.add('sorting');
      document.body.classList.add('sorting');
    }
    const mid = place();
    const ref = kids().find(s => s !== drag.el && mid < s.offsetTop + s.offsetHeight / 2);
    moveTo(ref || kids().at(-1).nextSibling);
    place();
  }

  function finish(keep) {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', cancel);
    removeEventListener('keydown', key, true);
    const d = drag;
    drag = null;
    if (!d.moved) return;
    // Settle into its slot from wherever the pointer left it.
    const from = d.el.getBoundingClientRect().top;
    if (!keep) { drag = d; moveTo(d.home); drag = null; }
    d.el.style.transform = '';
    const shift = from - d.el.getBoundingClientRect().top;
    if (shift) d.el.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,.7,.3,1)' });
    d.el.classList.remove('dragging');
    list.classList.remove('sorting');
    document.body.classList.remove('sorting');
    // The press that ended the drag isn't a click.
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener('click', stop, true);
    setTimeout(() => removeEventListener('click', stop, true));
    if (keep) onDrop?.(kids());
  }

  const end = () => finish(true);
  const cancel = () => finish(false);
  const key = e => { if (e.key === 'Escape' && drag?.moved) { e.preventDefault(); e.stopPropagation(); cancel(); } };
}
