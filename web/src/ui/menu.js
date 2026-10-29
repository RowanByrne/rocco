// Floating menus (project picker, profile), placed next to the button that opened them.
import { $$ } from '../lib/dom.js';

export const menuOpen = () => !!document.querySelector('.menu.open');

export function closeMenus() {
  $$('.menu.open').forEach(m => m.classList.remove('open'));
  $$('[aria-haspopup][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Opens the menu, or closes it if it was already open. up: it grows upward from the button.
export function openMenu(menu, anchor, html, { up = false } = {}) {
  const wasOpen = menu.classList.contains('open');
  closeMenus();
  if (wasOpen) return;
  menu.innerHTML = html;
  place(menu, anchor, up);
  menu.classList.add('open');
  anchor.setAttribute('aria-expanded', 'true');
}

// Below or above the button; beside it when the sidebar is collapsed to icons.
function place(menu, anchor, up) {
  const r = anchor.getBoundingClientRect();
  const beside = document.querySelector('.app').classList.contains('collapsed');
  menu.style.left = (beside ? r.right + 8 : r.left) + 'px';
  if (up) {
    menu.style.top = '';
    menu.style.bottom = (innerHeight - (beside ? r.bottom : r.top - 6)) + 'px';
  } else {
    menu.style.bottom = '';
    menu.style.top = (beside ? r.top : r.bottom + 6) + 'px';
  }
}

document.addEventListener('click', e => { if (!e.target.closest('.menu, [aria-haspopup]')) closeMenus(); });
addEventListener('resize', closeMenus);
