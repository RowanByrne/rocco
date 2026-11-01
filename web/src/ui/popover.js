// The summary that appears when the pointer rests on a card or a doc.
import { $ } from '../lib/dom.js';

const pop = $('#pop');
const sources = []; // { selector, summary } for each kind of thing that has one
let hovered = null;
let timer = null;

export function hidePopover() {
  clearTimeout(timer);
  hovered = null;
  pop.classList.remove('show');
}

// selector: what to hover over; summary(el): its HTML, or '' for none.
export function initPopover(selector, summary) {
  if (!sources.length) {
    document.addEventListener('mouseover', over);
    document.addEventListener('scroll', hidePopover, true);
  }
  sources.push({ selector, summary });
}

// One listener for every kind, so moving within one thing doesn't hide its summary.
function over(e) {
  let el = null, summary = null;
  for (const s of sources) { el = e.target.closest(s.selector); if (el) { summary = s.summary; break; } }
  if (el === hovered) return;
  hidePopover();
  if (!el || $('#sheet').classList.contains('open')) return;
  hovered = el;
  timer = setTimeout(() => show(el, summary(el)), 280);
}

// To the right of the element, else below it, kept on screen.
function show(el, html) {
  if (!html || !el.isConnected) return;
  pop.innerHTML = html;
  const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.right + 10, top = r.top;
  if (left + w > innerWidth - 8) { left = Math.max(8, Math.min(r.left, innerWidth - w - 8)); top = r.bottom + 8; }
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.classList.add('show');
}
