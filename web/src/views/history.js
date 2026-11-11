// History: what's landed on main, the branches still open, and what each lane has been doing
// (busy lanes first). Loaded while the view is open, every ten seconds.
import { state, emit, of } from '../state.js';
import { $, webUrl } from '../lib/dom.js';
import { html, render, nothing } from '../lib/html.js';
import { agoText, hhmm, isToday } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { busy, once } from '../lib/busy.js';
import { openTask } from './workboard.js';

const EVENT_ICON = { commit: icon.commit, merge: icon.merge, switch: icon.branch, refresh: icon.sync, pull: icon.down, reset: icon.alert, other: icon.commit };
const LANE_STATE = {
  working: ['Working', 'var(--blue)'], stuck: ['Stuck', 'var(--amber)'], held: ['Holding a branch', 'var(--cyan)'],
  branch: ['On a branch', 'var(--cyan)'], check: ['Checking before main', 'var(--accent)'], dirty: ['Uncommitted changes', 'var(--amber)'],
  idle: ['Idle', 'var(--gray)'],
};
let timer = null;
let loadError = ''; // why the last load couldn't be read

export async function loadHistory() {
  clearTimeout(timer);
  if (state.view !== 'history') return;
  try {
    state.history = await api.history();
    loadError = '';
    emit('history');
  } catch (e) {
    // The sidebar says when the server is gone; anything else it answered is shown here.
    loadError = e.offline ? '' : e.message;
    emit('history');
  }
  timer = setTimeout(loadHistory, 10000);
}

const dayLabel = iso => {
  const d = new Date(iso), today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// ---- Main ----

function commit(c, repo) {
  // A published build gets its tag; the newest one is what players have now.
  const release = c.release ? html`<span class="rel-chip${c.live ? ' is-live' : ''}" title=${c.live ? 'The build players have now' : 'Published to players'}>${icon.rocket}${c.live ? 'Live' : c.release.replace(/^release\//, '')}</span>` : nothing;
  return html`<div class="cm${c.merge ? ' merge' : ''}${c.live ? ' is-live' : ''}${c.bookmarked ? ' marked' : ''}"><span class="cm-node"></span><div class="cm-main"><div class="cm-subject">${
    c.merge && c.branch ? html`Merged <span class="br-chip">${icon.branch}${c.branch}</span>` : c.subject}${release}</div><div class="cm-meta"><span class="who${c.agent ? ' agent' : ''}" title=${c.author}>${c.agent || c.author}</span>${
    repo ? html`<a class="hash" href=${webUrl(`${repo}/commit/${c.full}`)} target="_blank" rel="noreferrer">${c.hash}</a>` : html`<span class="hash">${c.hash}</span>`}${
    c.pushed ? nothing : html`<span class="unpushed">Not pushed</span>`}</div></div><button class="mark${c.bookmarked ? ' on' : ''}" data-mark=${c.full} title=${c.bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed=${c.bookmarked ? 'true' : 'false'}>${icon.bookmark}</button><span class="cm-time">${hhmm(c.at)}</span></div>`;
}

function main(h) {
  const days = [];
  for (const c of h.main.commits) {
    const label = dayLabel(c.at);
    if (!days.length || days[days.length - 1].label !== label) days.push({ label, commits: [] });
    days[days.length - 1].commits.push(c);
  }
  const more = h.main.total - h.main.commits.length;
  return html`<div class="panel-head">${icon.commit}Main<span class="count">${h.main.total} commits</span></div>${
    days.length ? days.map(d => html`<div class="day">${d.label}</div><div class="cms">${d.commits.map(c => commit(c, h.repo))}</div>`) : html`<div class="empty">No commits yet</div>`}${
    more > 0 ? html`<div class="panel-foot">${more} older commit${more === 1 ? '' : 's'}${h.repo ? html` · <a href=${webUrl(`${h.repo}/commits/main`)} target="_blank" rel="noreferrer">see them on GitHub</a>` : nothing}</div>` : nothing}`;
}

// ---- Branches ----

const branch = b => html`<div class="br-row"><span class="br-icon">${icon.branch}</span><div class="br-main"><div class="br-name"><span>${b.name}</span>${b.lane ? html`<span class="lc">L${b.lane}</span>` : nothing}${
  b.pushed ? nothing : html`<span class="local">Not on GitHub</span>`}</div><div class="br-sub">${b.subject}</div></div><div class="br-side"><span class="ahead" title="Commits not on main">+${b.ahead}</span>${
  b.behind ? html`<span class="behind" title="Main commits it doesn't have">−${b.behind}</span>` : nothing}<span class="age">${agoText(b.at)}</span></div></div>`;

function branches(h) {
  const open = h.branches.filter(b => b.ahead > 0).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const merged = h.branches.length - open.length;
  return html`<div class="panel-head">${icon.branch}Open branches<span class="count">${open.length}</span></div>${
    open.length ? open.map(branch) : html`<div class="empty">Everything is merged into main</div>`}${
    merged ? html`<div class="panel-foot">${merged} merged branch${merged === 1 ? '' : 'es'} not deleted yet</div>` : nothing}`;
}

// ---- Lanes ----

// What a lane is doing: its Workboard task first, else what git shows. A detached lane with commits main doesn't
// have yet is the conductor checking a merge or a fix there before it goes to Main (CONDUCTOR.md "Checking in a lane").
function laneState(l) {
  const task = state.tasks.find(t => t.lane === l.lane && (t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && (t.status === 'ready' || t.status === 'queued'))));
  const kind = task ? (task.status === 'working' || task.status === 'stuck' ? task.status : 'held') : l.branch ? 'branch' : l.ahead ? 'check' : l.dirty ? 'dirty' : 'idle';
  const last = l.events[0]?.at || '';
  return { task, kind, active: kind !== 'idle', last };
}

function lane(l, s) {
  const [label, color] = LANE_STATE[s.kind];
  const done = of('done').filter(t => t.lane === l.lane).slice(0, 3);
  const events = l.events.slice(0, 6);
  return html`<div class="lane-card${s.active ? ' active' : ''}" style="--c:${color}"><div class="lane-head"><span class="lane-num">${l.lane}</span><div class="lane-title"><div class="lane-name">Lane ${l.lane}</div><div class="lane-where">${
    l.branch ? html`${icon.branch}<span>${l.branch}</span>` : html`<span>main @ ${l.head}${l.ahead ? ` · ${l.ahead} commit${l.ahead === 1 ? '' : 's'} not on main yet` : ''}</span>`
  }</div></div><span class="state-pill">${label}</span></div><div class="lane-flags"><span class="flag${l.open ? ' on' : ''}"><i></i>${l.open ? 'Syncing to Studio' : 'Not open'}</span>${
    l.dirty ? html`<span class="flag warn">${l.dirty} uncommitted file${l.dirty === 1 ? '' : 's'}</span>` : nothing}</div>${
    s.task ? html`<button class="lane-task" data-task=${s.task.id}><span class="s-id">${s.task.id}</span><span>${s.task.title}</span>${icon.chev}</button>` : nothing}${
    events.length ? html`<ol class="lane-events">${events.map(e => html`<li class="ev ev-${e.kind}"><span class="ev-icon">${EVENT_ICON[e.kind] || icon.commit}</span><span class="ev-text">${e.text}</span><span class="ev-at" title=${e.at}>${agoText(e.at)}</span></li>`)}</ol>` : html`<div class="empty">Nothing done here yet</div>`}${
    done.length ? html`<div class="lane-done">${done.map(t => html`<button class="done-row" data-task=${t.id}>${icon.checkSm}<span>${t.title}</span></button>`)}</div>` : nothing}</div>`;
}

function lanes(h) {
  if (!h.lanes.length) return html`<div class="empty lanes-empty">No lanes yet. A game gets them in Foundation (LANES.md).</div>`;
  const sorted = h.lanes.map(l => ({ l, s: laneState(l) }))
    .sort((a, b) => (b.s.active - a.s.active) || String(b.s.last).localeCompare(String(a.s.last)) || a.l.lane - b.l.lane);
  return html`<div class="lane-grid-cards">${sorted.map(({ l, s }) => lane(l, s))}</div>`;
}

// ---- The view ----

const failed = () => loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't load the history: ${loadError}</span><button class="btn-sm" data-history-retry>Retry</button></div>` : nothing;

export function renderHistory() {
  const h = state.history;
  $('#histRepo').hidden = !h?.repo;
  if (h?.repo) $('#histRepo').href = webUrl(h.repo);
  if (!h) {
    $('#histSub').textContent = '';
    render(loadError ? failed() : html`<div class="blank" style="min-height:40vh"><div class="blank-in"><div class="blank-title">Loading history…</div></div></div>`, $('#histBody'));
    return;
  }
  const today = h.main.commits.filter(c => isToday(c.at));
  const active = h.lanes.filter(l => laneState(l).active).length;
  const live = h.main.live ? `Live on Roblox: ${h.main.live.tag.replace(/^release\//, '')}` : 'Not published yet';
  const pushed = h.main.unpushed ? `${h.main.unpushed} commit${h.main.unpushed === 1 ? '' : 's'} on main not pushed` : (h.main.remote ? 'Main is pushed to GitHub' : 'Main has no GitHub copy yet');
  $('#histSub').textContent = `${live} · ${pushed}`;
  const stat = (value, label, color = 'var(--text)') => html`<div class="stat-tile" style="--c:${color}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
  render(html`${failed()}<div class="stat-row">${stat(today.length, 'Commits today')}${stat(today.filter(c => c.merge).length, 'Merged today', 'var(--violet)')}${
    stat(h.branches.filter(b => b.ahead > 0).length, 'Open branches', 'var(--cyan)')}${stat(html`${active}<span>/${h.lanes.length}</span>`, 'Lanes busy', 'var(--blue)')
  }</div><div class="hist-top"><div class="panel">${main(h)}</div><div class="panel">${branches(h)}</div></div><div class="section">Lanes<span class="sec-note">busy first</span></div>${lanes(h)}`, $('#histBody'));
}

export function initHistory() {
  $('#histBody').addEventListener('click', e => {
    if (e.target.closest('[data-history-retry]')) { loadHistory(); return; }
    const mark = e.target.closest('[data-mark]');
    if (mark) {
      const full = mark.dataset.mark, c = state.history?.main.commits.find(x => x.full === full);
      if (!c || busy(`mark:${full}`)) return;
      // Shown at once; the next load says what the server kept.
      c.bookmarked = !c.bookmarked;
      renderHistory();
      once(`mark:${full}`, async () => {
        try { await api.bookmark(full); } catch { c.bookmarked = !c.bookmarked; renderHistory(); toast('Couldn\'t save the bookmark', 'var(--red)'); }
        await loadHistory();
      });
      return;
    }
    const task = e.target.closest('[data-task]');
    if (task) openTask(task.dataset.task);
  });
}
