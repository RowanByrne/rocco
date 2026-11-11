// The sheet that slides in from the right, for one thing at a time (a task, today's approvals, a connection).
// Showing the same thing again only updates what changed: its scroll, focus and what's typed in it stay.
import { $ } from '../lib/dom.js';
import { html, render, nothing, keyed } from '../lib/html.js';
import { emit } from '../state.js';
import { closeMenus } from './menu.js';
import { hidePopover } from './popover.js';

const sheet = $('#sheet');
const scrim = $('#scrim');
let openKey = null;

// What's open: a task id, or another key like 'approved'; null when closed.
export const openSheetKey = () => openKey;

// body, foot and tools are templates. tools: buttons in the header, by the close button (a task's Delete).
// wide: room for a card's session.
export function showSheet(key, { color, chip, id = '', body, foot = nothing, tools = nothing, wide = false }) {
  const fresh = key !== openKey;
  if (fresh) { hidePopover(); closeMenus(); }
  openKey = key;
  sheet.classList.toggle('wide', wide);
  sheet.style.setProperty('--c', color);
  render(html`<span class="chip"><i></i>${chip}</span>`, $('#sChip'));
  $('#sId').textContent = id;
  // Keyed by what's open, so a different thing starts from fresh fields.
  render(keyed(key, tools), $('#sTools'));
  render(keyed(key, body), $('#sBody'));
  render(keyed(key, foot), $('#sFoot'));
  if (!fresh) return;
  $('#sBody').scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
  // It can't take focus until it has started to show, a moment after it opens: tried until it takes. Not if the user
  // is already in it by then.
  const takeFocus = tries => {
    if (openKey !== key || sheet.contains(document.activeElement)) return;
    $('#sClose').focus();
    if (document.activeElement !== $('#sClose') && tries) setTimeout(() => takeFocus(tries - 1), 120);
  };
  setTimeout(() => takeFocus(4), 60);
}

export function closeSheet() {
  if (!openKey) return;
  openKey = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('on');
  emit('sheet-closed');
}

scrim.addEventListener('click', closeSheet);
$('#sClose').addEventListener('click', closeSheet);
