// The sheet that slides in from the right, for one thing at a time (a task, today's approvals).
import { $, esc } from '../lib/dom.js';
import { emit } from '../state.js';
import { closeMenus } from './menu.js';
import { hidePopover } from './popover.js';

const sheet = $('#sheet');
const scrim = $('#scrim');
let openKey = null;

// What's open: a task id, or another key like 'approved'; null when closed.
export const openSheetKey = () => openKey;

export function showSheet(key, { color, chip, id = '', body, foot = '' }) {
  hidePopover();
  closeMenus();
  openKey = key;
  sheet.style.setProperty('--c', color);
  $('#sChip').innerHTML = `<span class="chip"><i></i>${esc(chip)}</span>`;
  $('#sId').textContent = id;
  $('#sBody').innerHTML = body;
  $('#sBody').scrollTop = 0;
  $('#sFoot').innerHTML = foot;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
  $('#sClose').focus();
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
