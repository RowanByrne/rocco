// Short messages in the corner, newest at the bottom, up to three at a time. One can carry an action (Undo, Retry);
// a new message never pushes that one out while a plain message can go instead.
import { $ } from '../lib/dom.js';

const MAX = 3;
const shown = []; // { el, message, action, timer }

function drop(t) {
  const i = shown.indexOf(t);
  if (i < 0) return;
  shown.splice(i, 1);
  clearTimeout(t.timer);
  t.el.classList.remove('show');
  setTimeout(() => t.el.remove(), 220);
}

// action: { label, run }. ms: how long it stays (5 s with an action, 3 s without); STAY keeps it until it's closed
// (its ×, its action, or the caller). Returns what closes it.
export const STAY = -1;
export function toast(message, color = 'var(--green)', action = null, ms = 0) {
  const stay = ms || (action ? 5000 : 3000);
  // The same plain message again (something that keeps failing) just stays longer.
  const same = !action && shown.find(t => !t.action && t.message === message);
  if (same) { clearTimeout(same.timer); if (stay !== STAY) same.timer = setTimeout(() => drop(same), stay); return () => drop(same); }

  const el = document.createElement('div'), text = document.createElement('span');
  el.className = `toast${action ? ' has-action' : ''}`;
  el.style.setProperty('--tc', color);
  text.textContent = message;
  el.append(document.createElement('i'), text);
  const t = { el, message, action: !!action, timer: 0 };
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => { drop(t); action.run?.(); });
    el.append(button);
  }
  // One that stays can be closed by hand.
  if (stay === STAY) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => drop(t));
    el.classList.add('has-action');
    el.append(close);
  }
  $('#toasts').append(el);
  shown.push(t);
  while (shown.length > MAX) drop(shown.find(x => !x.action && x !== t) || shown[0]);
  void el.offsetWidth; // so it fades in from where it starts
  el.classList.add('show');
  if (stay !== STAY) t.timer = setTimeout(() => drop(t), stay);
  return () => drop(t);
}
