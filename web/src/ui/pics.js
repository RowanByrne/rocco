// Pictures on a question (server/tasks.ps1 Add-Pictures): concepts to pick from, each on its option, and the
// question's own pictures (a model to approve, from the front and the side). Clicking one opens it big, with the
// others in its set a key away and, for an option, a button that picks it.
//
// A set is the element with data-pic-set around a question's pictures; the caller's pick gets the label and the set.
import { $, esc } from '../lib/dom.js';

const arrow = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
let list = [], at = 0, onPick = null, set = null, ready = false;

const modal = () => $('#picModal');

// The question's own pictures, in a row.
export const picsHTML = srcs => (srcs || []).filter(Boolean).length
  ? `<div class="pics">${srcs.filter(Boolean).map((src, i) => `<button type="button" class="pic-img" data-pic-src="${esc(src)}" title="See it bigger"><img src="${esc(src)}" alt="Picture ${i + 1}" loading="lazy"></button>`).join('')}</div>` : '';

// An option with a picture: the picture opens it big, the label under it picks it. attrs: what makes the label a pick.
export const picOptionHTML = (o, src, attrs, on, extra = '') => `<div class="pic-opt${on ? ' on' : ''}">`
  + `<button type="button" class="pic-img" data-pic-src="${esc(src)}" data-pic-label="${esc(o.label)}" data-pic-detail="${esc(o.detail || '')}" title="See it bigger"><img src="${esc(src)}" alt="${esc(o.label)}" loading="lazy"></button>`
  + `<span class="pic-row"><button type="button" class="opt${on ? ' on' : ''}" ${attrs}${o.detail ? ` title="${esc(o.detail)}"` : ''}><span>${esc(o.label)}</span></button>${extra}</span></div>`;

// Opens the clicked picture big. pick(label, set) is called when the user picks an option's picture there.
export function openPicsFrom(button, pick) {
  set = button.closest('[data-pic-set]') || button.parentElement;
  const all = [...set.querySelectorAll('[data-pic-src]')];
  list = all.map(b => ({ src: b.dataset.picSrc, label: b.dataset.picLabel || '', detail: b.dataset.picDetail || '' }));
  at = Math.max(0, all.indexOf(button));
  onPick = pick;
  if (!ready) init();
  render();
  modal().classList.add('open');
}

function render() {
  const p = list[at];
  if (!p) return;
  const many = list.length > 1;
  modal().querySelector('.modal-card').innerHTML = `<div class="pv-stage"><img class="pv-img" src="${esc(p.src)}" alt="${esc(p.label)}">`
    + (many ? `<button type="button" class="pv-nav prev" data-pv="prev" aria-label="Previous picture">${arrow('M15 6l-6 6 6 6')}</button>`
      + `<button type="button" class="pv-nav next" data-pv="next" aria-label="Next picture">${arrow('M9 6l6 6-6 6')}</button>` : '') + '</div>'
    + `<div class="pv-foot"><div class="pv-text">${p.label ? `<b>${esc(p.label)}</b>` : ''}${p.detail ? `<p>${esc(p.detail)}</p>` : ''}</div>`
    + `${many ? `<span class="pv-n">${at + 1} of ${list.length}</span>` : ''}`
    + `<div class="m-actions"><button type="button" class="btn" data-pv="close">Close</button>`
    + `${p.label && onPick ? `<button type="button" class="btn accent" data-pv="pick">Pick “${esc(p.label)}”</button>` : ''}</div></div>`;
}

const step = n => { at = (at + n + list.length) % list.length; render(); };

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
