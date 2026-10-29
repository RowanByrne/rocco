// A short message in the corner.
import { $ } from '../lib/dom.js';

let timer = null;

export function toast(message, color = 'var(--green)') {
  const el = $('#toast');
  el.style.setProperty('--tc', color);
  el.querySelector('span').textContent = message;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 3000);
}
