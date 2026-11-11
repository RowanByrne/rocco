// Pictures on a question (server/tasks.ps1 Add-Pictures): concepts to pick from, each on its option, and the
// question's own pictures (a model to approve, from the front and the side). Clicking one opens it big, with the
// others in its set a key away and, for an option, a button that picks it.
//
// A set is the element with data-pic-set around a question's pictures; the caller's pick gets the label and the set.
import { $ } from '../lib/dom.js';
import { html, render, nothing, ifDefined, fixed } from '../lib/html.js';

const arrow = d => fixed(`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`);
const PREV = arrow('M15 6l-6 6 6 6'), NEXT = arrow('M9 6l6 6-6 6');
let list = [], at = 0, onPick = null, set = null, ready = false;

const modal = () => $('#picModal');

// The question's own pictures, in a row.
export function pics(srcs) {
  const shown = (srcs || []).filter(Boolean);
  return shown.length ? html`<div class="pics">${shown.map((src, i) => html`<button type="button" class="pic-img" data-pic-src=${src} title="See it bigger"><img src=${src} alt="Picture ${i + 1}" loading="lazy"></button>`)}</div>` : nothing;
}

// An option with a picture: the picture opens it big, the label under it picks it. data: what makes the label a pick,
// as the data attributes the caller's click handler reads ({ pick, q } on a task, { cPick, ask } on the conductor's).
export const picOption = (o, src, data, on, extra = nothing) => html`<div class="pic-opt${on ? ' on' : ''}"><button type="button" class="pic-img" data-pic-src=${src} data-pic-label=${o.label} data-pic-detail=${o.detail || ''} title="See it bigger"><img src=${src} alt=${o.label} loading="lazy"></button><span class="pic-row"><button type="button" class="opt${on ? ' on' : ''}" data-pick=${ifDefined(data.pick)} data-q=${ifDefined(data.q)} data-c-pick=${ifDefined(data.cPick)} data-ask=${ifDefined(data.ask)} title=${ifDefined(o.detail || undefined)}><span>${o.label}</span></button>${extra}</span></div>`;

// Opens the clicked picture big. pick(label, set) is called when the user picks an option's picture there.
export function openPicsFrom(button, pick) {
  set = button.closest('[data-pic-set]') || button.parentElement;
  const all = [...set.querySelectorAll('[data-pic-src]')];
  list = all.map(b => ({ src: b.dataset.picSrc, label: b.dataset.picLabel || '', detail: b.dataset.picDetail || '' }));
  at = Math.max(0, all.indexOf(button));
  onPick = pick;
  if (!ready) init();
  draw();
  modal().classList.add('open');
  modal().querySelector('[data-pv="close"]')?.focus();
}

function draw() {
  const p = list[at];
  if (!p) return;
  const many = list.length > 1;
  const nav = many ? html`<button type="button" class="pv-nav prev" data-pv="prev" aria-label="Previous picture">${PREV}</button><button type="button" class="pv-nav next" data-pv="next" aria-label="Next picture">${NEXT}</button>` : nothing;
  render(html`<div class="pv-stage"><img class="pv-img" src=${p.src} alt=${p.label}>${nav}</div><div class="pv-foot"><div class="pv-text">${
    p.label ? html`<b>${p.label}</b>` : nothing}${p.detail ? html`<p>${p.detail}</p>` : nothing}</div>${
    many ? html`<span class="pv-n">${at + 1} of ${list.length}</span>` : nothing
  }<div class="m-actions"><button type="button" class="btn" data-pv="close">Close</button>${
    p.label && onPick ? html`<button type="button" class="btn accent" data-pv="pick">Pick “${p.label}”</button>` : nothing}</div></div>`,
  modal().querySelector('.modal-card'));
}

const step = n => { at = (at + n + list.length) % list.length; draw(); };

export const picViewOpen = () => !!modal()?.classList.contains('open');
export function closePicView() { modal()?.classList.remove('open'); }

function init() {
  ready = true;
  modal().addEventListener('click', e => {
    const b = e.target.closest('[data-pv]');
    if (e.target === modal() || b?.dataset.pv === 'close') closePicView();
    else if (b?.dataset.pv === 'prev') step(-1);
    else if (b?.dataset.pv === 'next') step(1);
    else if (b?.dataset.pv === 'pick') { const p = list[at], pick = onPick, from = set; closePicView(); pick?.(p.label, from); }
  });
  document.addEventListener('keydown', e => {
    if (!picViewOpen() || list.length < 2) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
}
