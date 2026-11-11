// Dialogs and the sheet keep the keyboard: Tab stays inside the one on top, and when it closes, focus goes back to
// what had it before (the card or button that opened it).
const LAYERS = ['#markupModal', '#picModal', '#paletteModal', '#updateModal', '#thumbModal', '#onboarding', '#sheet']; // top-most first
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openers = new Map(); // an open layer -> what had focus before it opened
let trail = [];            // the last few things that had focus, newest last

const layers = () => LAYERS.map(s => document.querySelector(s)).filter(Boolean);
// A card's conversation docked in the chat's place (ui/sheet.js) is part of the page, not over it: Tab leaves it.
const topLayer = () => layers().find(l => l.classList.contains('open') && !l.classList.contains('docked'));
const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

function keepInside(e) {
  if (e.key !== 'Tab') return;
  const layer = topLayer();
  if (!layer) return;
  const items = /** @type {HTMLElement[]} */ ([...layer.querySelectorAll(FOCUSABLE)]).filter(visible);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1], at = document.activeElement;
  if (!layer.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
}

// A layer opened or closed (its 'open' class changed).
function changed(records) {
  for (const r of records) {
    const layer = r.target, isOpen = layer.classList.contains('open'), was = /(^|\s)open(\s|$)/.test(r.oldValue || '');
    if (isOpen && !was) {
      // Whoever opened it has often already put focus inside: the opener is the newest thing outside it.
      openers.set(layer, [...trail].reverse().find(el => el.isConnected && !layer.contains(el)) || null);
    } else if (!isOpen && was) {
      const back = openers.get(layer), at = document.activeElement;
      openers.delete(layer);
      if (back?.isConnected && visible(back) && (!at || at === document.body || layer.contains(at))) back.focus({ preventScroll: true });
    }
  }
}

export function initFocus() {
  const note = el => { if (el && el !== document.body) trail = [...trail.filter(x => x !== el), el].slice(-8); };
  document.addEventListener('focusin', e => note(e.target));
  // What has focus as a key or a click starts being handled, before the handler moves it: a window that isn't the
  // active one yet sends no focus events.
  document.addEventListener('keydown', () => note(document.activeElement), true);
  document.addEventListener('click', () => note(document.activeElement), true);
  document.addEventListener('keydown', keepInside);
  const watch = new MutationObserver(changed);
  for (const layer of layers()) watch.observe(layer, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}
