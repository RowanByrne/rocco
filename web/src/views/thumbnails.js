// Thumbnails: what's on the game page and how each one does (Roblox's numbers, with the user's key), what the numbers
// say, directions to try next (the agent's, in live/GAME-PAGE.md, else Rocco's starters), and concepts made from a
// direction with Codex in one click. Concepts are candidates: the user picks one, and the agent takes it from there.
import { state, emit } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { agoText } from '../lib/format.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { agentShort } from '../agent.js';
import { go } from '../router.js';
import { openTask } from './workboard.js';

const COUNT = 3; // concepts per click
let timer = null;
const modal = $('#thumbModal');

export async function loadThumbnails(force = false) {
  clearTimeout(timer);
  if (state.view !== 'thumbnails') return;
  const was = state.thumbs?.run;
  try {
    state.thumbs = await api.thumbnails(force);
    emit('thumbs');
    const run = state.thumbs.run;
    if (was?.running && run && !run.running) {
      if (run.error) toast(`Codex couldn't make every concept: ${run.error}`, 'var(--red)');
      else toast(`${run.count} new concepts for ${run.direction}`, 'var(--violet)');
    }
  } catch (e) { state.thumbs = { error: e.message }; emit('thumbs'); }
  const busy = state.thumbs?.run?.running || state.thumbs?.page?.loading;
  timer = setTimeout(() => loadThumbnails(), busy ? 3000 : 60000);
}

export function resetThumbnails() { state.thumbs = null; }

const pct = v => v == null ? '–' : `${(100 * v).toFixed(1)}%`;
const num = v => v == null ? '–' : Math.round(v).toLocaleString();

// ---- On the game page ----

function pageHTML(t) {
  const p = t.page || {};
  let body;
  if (!p.universe) body = `<div class="upd-empty">Add the game's universe id to <code>docs/game/PROJECT.md</code> (the Roblox row) to see its thumbnails here.</div>`;
  else if (p.loading && !p.thumbnails?.length) body = '<div class="upd-empty"><span class="spin"></span>Asking Roblox…</div>';
  else if (p.error) body = `<div class="upd-empty">${esc(p.error)}</div>`;
  else if (!p.thumbnails?.length) body = '<div class="upd-empty">The game page has no thumbnails yet.</div>';
  else {
    const best = Math.max(0, ...p.thumbnails.map(x => x.stats?.ptr || 0));
    body = `<div class="th-grid">${p.thumbnails.map(x => {
      const s = x.stats;
      return `<div class="th-card"><div class="th-img">${x.image ? `<img src="${esc(x.image)}" alt="${esc(x.altText || `Thumbnail ${x.rank}`)}" loading="lazy">` : icon.image}<span class="th-rank">${x.rank}</span>`
        + `${x.approved === false ? '<span class="th-flag">Waiting for Roblox to approve it</span>' : ''}</div>`
        + (s ? `<div class="th-stats"><span><b>${num(s.impressions)}</b>impressions</span><span><b>${num(s.plays)}</b>qualified plays</span><span><b>${pct(s.ptr)}</b>play-through</span></div>`
          + `<div class="th-bar"><i style="width:${best ? Math.round(100 * (s.ptr || 0) / best) : 0}%"></i></div>`
          : `<div class="th-stats none">${p.linked ? 'No numbers for this one yet' : 'Numbers need your Roblox key (Connections)'}</div>`)
        + '</div>';
    }).join('')}</div>`;
    if (p.other?.length) body += `<div class="th-other"><small>Other thumbnails Roblox showed players (the home page, or ones no longer on the page)</small>`
      + p.other.map(o => `<div class="th-other-row"><span>${esc(o.label || o.asset)}</span><span>${num(o.stats?.impressions)} impressions</span><span>${pct(o.stats?.ptr)} play-through</span></div>`).join('') + '</div>';
  }
  const foot = p.statsError ? p.statsError : p.linked && p.thumbnails?.length ? `Numbers for the last ${p.days || 7} days, from Roblox's analytics. Play-through counts players who stayed long enough to count.` : '';
  return `<div class="panel upd-panel"><div class="panel-head">${icon.image}On the game page${p.thumbnails?.length ? `<span class="count">${p.thumbnails.length}</span>` : ''}</div>${body}`
    + `${foot ? `<div class="panel-foot">${esc(foot)}</div>` : ''}</div>`;
}

function hintsHTML(t) {
  if (!t.hints?.length) return '';
  return `<div class="th-hints">${t.hints.map(h => `<div class="th-hint">${icon.sparkle}<span>${esc(h)}</span></div>`).join('')}</div>`;
}

// ---- Directions, and making concepts ----

function runHTML(t) {
  const r = t.run;
  if (!r) return '';
  if (r.running) return `<div class="ob-status"><span class="spin"></span><span>Codex is making concepts for <b>${esc(r.direction)}</b>: ${r.done} of ${r.count} ready. Each takes a minute or two.</span></div>`;
  if (r.error) return `<div class="ob-status err">${icon.alert}<span>The last run didn't make every concept: ${esc(r.error)}</span></div>`;
  return '';
}

function directionsHTML(t) {
  const running = t.run?.running;
  const can = t.codex && !running;
  const reason = !t.codex ? 'Concepts are made with Codex, which isn\'t on this PC (Connections)' : running ? 'Wait for the concepts being made' : `Make ${COUNT} concepts with Codex`;
  return `<div class="panel"><div class="panel-head">${icon.sparkle}Directions to try<span class="sp"></span>`
    + `<button class="mini" id="thumbsAsk">Ask ${esc(agentShort())} for new directions</button></div>`
    + (t.ownDirections ? '' : `<div class="th-note">Rocco's starting points, until ${esc(agentShort())} suggests some for this game from its docs and numbers.</div>`)
    + runHTML(t)
    + `<div class="th-dirs">${(t.directions || []).map(d => `<div class="th-dir"><b>${esc(d.name)}</b>${d.why ? `<span class="th-why">${esc(d.why)}</span>` : ''}`
      + `<details class="th-prompt"><summary>Prompt</summary><p>${esc(d.prompt)}</p></details>`
      + `<button class="btn accent th-make" data-make="${esc(d.id)}"${can ? '' : ' disabled'} title="${esc(reason)}">${running && t.run.direction === d.name ? '<span class="spin"></span>Making' : `Make ${COUNT} concepts`}</button></div>`).join('')}</div></div>`;
}

function conceptsHTML(t) {
  const list = t.concepts || [];
  if (!list.length) return '';
  return `<div class="panel"><div class="panel-head">${icon.image}Concepts<span class="count">${list.length}</span><span class="sp"></span><span class="th-note-sm">In art\\generated\\thumbnails, outside git</span></div>`
    + `<div class="th-grid concepts">${list.map(c => `<div class="th-card${c.status === 'picked' ? ' picked' : ''}">`
      + `<button class="th-img" data-view-concept="${esc(c.file)}" title="See it bigger"><img src="${esc(api.artFile(c.file))}" alt="" loading="lazy"></button>`
      + `<div class="th-concept-foot"><span class="th-dir-name">${esc(c.direction)}<small>${esc(agoText(c.created))}</small></span>`
      + (c.status === 'picked' ? `<button class="mini" data-task="${esc(c.task)}">${icon.checkSm}Picked${c.task ? ` · ${esc(c.task)}` : ''}</button>` : `<button class="mini" data-use="${esc(c.file)}">Use this one</button>`)
      + '</div></div>').join('')}</div></div>`;
}

export function renderThumbnails() {
  const t = state.thumbs;
  const el = $('#thumbs');
  if (!t) { el.innerHTML = '<div class="upd-empty"><span class="spin"></span> Loading…</div>'; $('#thumbsSub').textContent = ''; return; }
  if (t.error) { el.innerHTML = `<div class="upd-empty">${esc(t.error)}</div>`; return; }
  const n = t.page?.thumbnails?.length || 0;
  $('#thumbsSub').textContent = t.page?.universe ? `${n} on the game page${t.concepts?.length ? ` · ${t.concepts.length} concepts` : ''}` : '';
  el.innerHTML = pageHTML(t) + hintsHTML(t) + `<div class="th-layout">${directionsHTML(t)}${conceptsHTML(t)}</div>`;
}

// ---- Actions ----

async function make(id, button) {
  button.disabled = true;
  button.innerHTML = '<span class="spin"></span>Starting';
  try {
    await api.makeConcepts(id, COUNT);
    toast(`Codex is making ${COUNT} concepts. They show up here as they're ready`, 'var(--violet)');
    await loadThumbnails();
  } catch (e) { toast(e.message, 'var(--red)'); button.disabled = false; button.textContent = `Make ${COUNT} concepts`; }
}

async function use(file) {
  try {
    const r = await api.useConcept(file);
    closeThumbView();
    toast(`${r.task} is in Up next: ${agentShort()} puts it on the game page`, 'var(--violet)');
    await loadThumbnails();
  } catch (e) { toast(e.message, 'var(--red)'); }
}

async function ask(button) {
  button.disabled = true;
  try {
    const r = await api.askDirections();
    toast(`${r.task} is in Up next: ${agentShort()} suggests directions for this game`, 'var(--violet)');
  } catch (e) { toast(e.message, 'var(--red)'); }
  button.disabled = false;
}

function viewConcept(file) {
  const c = (state.thumbs?.concepts || []).find(x => x.file === file);
  if (!c) return;
  modal.querySelector('.modal-card').innerHTML = `<img class="th-big" src="${esc(api.artFile(c.file))}" alt="">`
    + `<div class="th-big-foot"><div><b>${esc(c.direction)}</b>${c.prompt ? `<p>${esc(c.prompt)}</p>` : ''}</div>`
    + `<div class="m-actions"><button class="btn" data-th="close">Close</button>${c.status === 'picked' ? '' : `<button class="btn accent" data-use="${esc(c.file)}">Use this one</button>`}</div></div>`;
  modal.classList.add('open');
}

export const thumbViewOpen = () => modal.classList.contains('open');
export function closeThumbView() { modal.classList.remove('open'); }

export function initThumbnails() {
  $('#thumbsRefresh').addEventListener('click', () => loadThumbnails(true));
  $('#thumbs').addEventListener('click', e => {
    const el = e.target.closest('[data-make],[data-use],[data-task],[data-view-concept],#thumbsAsk');
    if (!el) return;
    if (el.id === 'thumbsAsk') ask(el);
    else if (el.dataset.make) make(el.dataset.make, el);
    else if (el.dataset.use) use(el.dataset.use);
    else if (el.dataset.task) { go('workboard'); openTask(el.dataset.task); }
    else if (el.dataset.viewConcept) viewConcept(el.dataset.viewConcept);
  });
  modal.addEventListener('click', e => {
    if (e.target === modal || e.target.closest('[data-th="close"]')) closeThumbView();
    else if (e.target.closest('[data-use]')) use(e.target.closest('[data-use]').dataset.use);
  });
}
