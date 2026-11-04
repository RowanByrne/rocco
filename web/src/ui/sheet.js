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

// tools: buttons in the header, by the close button (a task's Delete).
// wide: room for a card's session.
export function showSheet(key, { color, chip, id = '', body, foot = '', tools = '', wide = false }) {
  hidePopover();
  closeMenus();
  openKey = key;
  sheet.classList.toggle('wide', wide);
  sheet.style.setProperty('--c', color);
  $('#sChip').innerHTML = `<span class="chip"><i></i>${esc(chip)}</span>`;
  $('#sId').textContent = id;
  $('#sTools').innerHTML = tools;
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
