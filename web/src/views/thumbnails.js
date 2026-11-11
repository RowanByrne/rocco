// Thumbnails: what's on the game page and how each one does (Roblox's numbers, with the user's key), what the numbers
// say, directions to try next (the agent's, in live/GAME-PAGE.md, else Rocco's starters), and concepts made from a
// direction with Codex in one click. Concepts are candidates: the user picks one, and the agent takes it from there.
import { state, emit } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { agoText } from '../lib/format.js';
import { busy, once } from '../lib/busy.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { openTask } from './workboard.js';

const COUNT = 3; // concepts per click
let timer = null;
let loadError = '';   // why the last load couldn't be read
let viewing = '';     // the concept open big, by its file
const modal = $('#thumbModal');

export async function loadThumbnails(force = false) {
  clearTimeout(timer);
  if (state.view !== 'thumbnails') return;
  const was = state.thumbs?.run;
  try {
    state.thumbs = await api.thumbnails(force);
    loadError = '';
    emit('thumbs');
    const run = state.thumbs.run;
    if (was?.running && run && !run.running) {
      if (run.error) toast(`Codex couldn't make every concept: ${run.error}`, 'var(--red)');
      else toast(`${run.count} new concepts for ${run.direction}`, 'var(--violet)');
    }
  } catch (e) {
    // What was loaded before stays, under what went wrong.
    loadError = e.message;
    emit('thumbs');
  }
  const waiting = state.thumbs?.run?.running || state.thumbs?.page?.loading;
  timer = setTimeout(() => loadThumbnails(), waiting ? 3000 : 60000);
}

export function resetThumbnails() { state.thumbs = null; loadError = ''; }

const pct = v => v == null ? '–' : `${(100 * v).toFixed(1)}%`;
const num = v => v == null ? '–' : Math.round(v).toLocaleString();

// ---- On the game page ----

function page(t) {
  const p = t.page || {};
  let body;
  if (!p.universe) body = html`<div class="upd-empty">Add the game's universe id to <code>docs/game/PROJECT.md</code> (the Roblox row) to see its thumbnails here.</div>`;
  else if (p.loading && !p.thumbnails?.length) body = html`<div class="upd-empty"><span class="spin"></span>Asking Roblox…</div>`;
  else if (p.error) body = html`<div class="upd-empty">${p.error}</div>`;
  else if (!p.thumbnails?.length) body = html`<div class="upd-empty">The game page has no thumbnails yet.</div>`;
  else {
    const best = Math.max(0, ...p.thumbnails.map(x => x.stats?.ptr || 0));
    body = html`<div class="th-grid">${p.thumbnails.map(x => {
      const s = x.stats;
      return html`<div class="th-card"><div class="th-img">${x.image ? html`<img src=${x.image} alt=${x.altText || `Thumbnail ${x.rank}`} loading="lazy">` : icon.image}<span class="th-rank">${x.rank}</span>${
        x.approved === false ? html`<span class="th-flag">Waiting for Roblox to approve it</span>` : nothing}</div>${
        s ? html`<div class="th-stats"><span><b>${num(s.impressions)}</b>impressions</span><span><b>${num(s.plays)}</b>qualified plays</span><span><b>${pct(s.ptr)}</b>play-through</span></div><div class="th-bar"><i style="width:${best ? Math.round(100 * (s.ptr || 0) / best) : 0}%"></i></div>`
          : html`<div class="th-stats none">${p.linked ? 'No numbers for this one yet' : 'Numbers need your Roblox key (Connections)'}</div>`}</div>`;
    })}</div>${p.other?.length ? html`<div class="th-other"><small>Other thumbnails Roblox showed players (the home page, or ones no longer on the page)</small>${
      p.other.map(o => html`<div class="th-other-row"><span>${o.label || o.asset}</span><span>${num(o.stats?.impressions)} impressions</span><span>${pct(o.stats?.ptr)} play-through</span></div>`)}</div>` : nothing}`;
  }
  const foot = p.statsError ? p.statsError : p.linked && p.thumbnails?.length ? `Numbers for the last ${p.days || 7} days, from Roblox's analytics. Play-through counts players who stayed long enough to count.` : '';
  return html`<div class="panel upd-panel"><div class="panel-head">${icon.image}On the game page${p.thumbnails?.length ? html`<span class="count">${p.thumbnails.length}</span>` : nothing}</div>${body}${
    foot ? html`<div class="panel-foot">${foot}</div>` : nothing}</div>`;
}

const hints = t => t.hints?.length ? html`<div class="th-hints">${t.hints.map(h => html`<div class="th-hint">${icon.sparkle}<span>${h}</span></div>`)}</div>` : nothing;

// ---- Directions, and making concepts ----

function run(t) {
  const r = t.run;
  if (!r) return nothing;
  if (r.running) return html`<div class="ob-status"><span class="spin"></span><span>Codex is making concepts for <b>${r.direction}</b>: ${r.done} of ${r.count} ready. Each takes a minute or two.</span><button class="linkish" id="thumbsStop" ?disabled=${busy('thumbs:stop')}>Stop</button></div>`;
  if (r.error) return html`<div class="ob-status err">${icon.alert}<span>The last run didn't make every concept: ${r.error}</span></div>`;
  return nothing;
}

function directions(t) {
  const running = t.run?.running;
  const can = t.codex && !running;
  const reason = !t.codex ? 'Concepts are made with Codex, which isn\'t on this PC (Connections)' : running ? 'Wait for the concepts being made' : `Make ${COUNT} concepts with Codex`;
  return html`<div class="panel"><div class="panel-head">${icon.sparkle}Directions to try<span class="sp"></span><button class="mini" id="thumbsAsk" ?disabled=${busy('thumbs:ask')}>Ask Rocco for new directions</button></div>${
    t.ownDirections ? nothing : html`<div class="th-note">Starting points, until Rocco suggests some for this game from its docs and numbers.</div>`}${run(t)}<div class="th-dirs">${
    (t.directions || []).map(d => {
      const starting = busy(`thumbs:make:${d.id}`);
      return html`<div class="th-dir"><b>${d.name}</b>${d.why ? html`<span class="th-why">${d.why}</span>` : nothing}<details class="th-prompt"><summary>Prompt</summary><p>${d.prompt}</p></details><button class="btn accent th-make" data-make=${d.id} ?disabled=${!can || starting} title=${reason}>${
        starting ? html`<span class="spin"></span>Starting` : running && t.run.direction === d.name ? html`<span class="spin"></span>Making` : `Make ${COUNT} concepts`}</button></div>`;
    })}</div></div>`;
}

function concepts(t) {
  const list = t.concepts || [];
  if (!list.length) return nothing;
  return html`<div class="panel"><div class="panel-head">${icon.image}Concepts<span class="count">${list.length}</span><span class="sp"></span><span class="th-note-sm">In art\\generated\\thumbnails, outside git</span></div><div class="th-grid concepts">${
    list.map(c => html`<div class="th-card${c.status === 'picked' ? ' picked' : ''}"><button class="th-img" data-view-concept=${c.file} title="See it bigger"><img src=${api.artFile(c.file)} alt="" loading="lazy"></button><div class="th-concept-foot"><span class="th-dir-name">${c.direction}<small>${agoText(c.created)}</small></span>${
      c.status === 'picked' ? html`<button class="mini" data-task=${c.task || ''}>${icon.checkSm}Picked${c.task ? ` · ${c.task}` : ''}</button>` : html`<button class="mini" data-use=${c.file}>Use this one</button>`}</div></div>`)}</div></div>`;
}

const failed = () => loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't load the thumbnails: ${loadError}</span><button class="btn-sm" data-thumbs-retry>Retry</button></div>` : nothing;

export function renderThumbnails() {
  const t = state.thumbs;
  const el = $('#thumbs');
  if (!t) {
    render(loadError ? failed() : html`<div class="upd-empty"><span class="spin"></span> Loading…</div>`, el);
    $('#thumbsSub').textContent = '';
    return;
  }
  const n = t.page?.thumbnails?.length || 0;
  $('#thumbsSub').textContent = t.page?.universe ? `${n} on the game page${t.concepts?.length ? ` · ${t.concepts.length} concepts` : ''}` : '';
  render(html`${failed()}${page(t)}${hints(t)}<div class="th-layout">${directions(t)}${concepts(t)}</div>`, el);
  if (viewing) drawConcept();
}

// ---- Actions ----

const make = id => once(`thumbs:make:${id}`, async () => {
  renderThumbnails();
  try {
    await api.makeConcepts(id, COUNT);
    toast(`Codex is making ${COUNT} concepts. They show up here as they're ready`, 'var(--violet)');
    await loadThumbnails();
  } catch (e) { toast(e.message, 'var(--red)'); }
}).then(renderThumbnails);

const use = file => once(`thumbs:use:${file}`, async () => {
  try {
    const r = await api.useConcept(file);
    closeThumbView();
    toast(`${r.task} is in Up next: Rocco puts it on the game page`, 'var(--violet)');
    await loadThumbnails();
  } catch (e) { toast(e.message, 'var(--red)'); }
});

const ask = () => once('thumbs:ask', async () => {
  renderThumbnails();
  try {
    const r = await api.askDirections();
    toast(`${r.task} is in Up next: Rocco suggests directions for this game`, 'var(--violet)');
  } catch (e) { toast(e.message, 'var(--red)'); }
}).then(renderThumbnails);

// The concept open big: drawn from the list, so picking it shows there too.
function drawConcept() {
  const c = (state.thumbs?.concepts || []).find(x => x.file === viewing);
  if (!c) { closeThumbView(); return; }
  render(html`<img class="th-big" src=${api.artFile(c.file)} alt=""><div class="th-big-foot"><div><b>${c.direction}</b>${c.prompt ? html`<p>${c.prompt}</p>` : nothing}</div><div class="m-actions"><button class="btn" data-th="close">Close</button>${
    c.status === 'picked' ? nothing : html`<button class="btn accent" data-use=${c.file}>Use this one</button>`}</div></div>`, modal.querySelector('.modal-card'));
}

function viewConcept(file) {
  viewing = file;
  drawConcept();
  if (!viewing) return;
  modal.classList.add('open');
  modal.querySelector('[data-th="close"]')?.focus();
}

export const thumbViewOpen = () => modal.classList.contains('open');
export function closeThumbView() { viewing = ''; modal.classList.remove('open'); }

export function initThumbnails() {
  $('#thumbsRefresh').addEventListener('click', () => loadThumbnails(true));
  $('#thumbs').addEventListener('click', e => {
    const el = e.target.closest('[data-make],[data-use],[data-task],[data-view-concept],[data-thumbs-retry],#thumbsAsk,#thumbsStop');
    if (!el) return;
    if (el.id === 'thumbsAsk') ask();
    // Stops the concepts being made; the ones already made stay.
    else if (el.id === 'thumbsStop') once('thumbs:stop', async () => {
      try { await api.cancelConcepts(); toast('Stopped. The concepts already made are kept', 'var(--gray)'); }
      catch (err) { toast(`Couldn't stop it: ${err.message}`, 'var(--red)'); }
      loadThumbnails(false);
    }, el);
    else if (el.hasAttribute('data-thumbs-retry')) loadThumbnails(true);
    else if (el.dataset.make) make(el.dataset.make);
    else if (el.dataset.use) use(el.dataset.use);
    else if (el.dataset.task) { go('workboard'); openTask(el.dataset.task); }
    else if (el.dataset.viewConcept) viewConcept(el.dataset.viewConcept);
  });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-th="close"]')) closeThumbView();
    else if (e.target.closest('[data-use]')) use(e.target.closest('[data-use]').dataset.use);
  });
}
