// A short message in the corner, optionally with one action (Undo).
import { $, esc } from '../lib/dom.js';

let timer = null;
let onAction = null;

export function toast(message, color = 'var(--green)', action = null) {
  const el = $('#toast');
  el.style.setProperty('--tc', color);
  el.querySelector('span').textContent = message;
  const button = el.querySelector('button');
  onAction = action?.run || null;
  button.hidden = !action;
  if (action) button.innerHTML = esc(action.label);
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 3000);
}

$('#toast button').addEventListener('click', () => {
  $('#toast').classList.remove('show');
  const run = onAction;
  onAction = null;
  run?.();
});
