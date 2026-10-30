// History: what's landed on main, the branches still open, and what each lane has been doing
// (busy lanes first). Loaded while the view is open, every ten seconds.
import { state, emit, of } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { agoText, hhmm, isToday } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { openTask } from './workboard.js';

const EVENT_ICON = { commit: icon.commit, merge: icon.merge, switch: icon.branch, refresh: icon.sync, pull: icon.down, reset: icon.alert, other: icon.commit };
const LANE_STATE = {
  working: ['Working', 'var(--blue)'], stuck: ['Stuck', 'var(--amber)'], held: ['Holding a branch', 'var(--cyan)'],
  branch: ['On a branch', 'var(--cyan)'], dirty: ['Uncommitted changes', 'var(--amber)'], idle: ['Idle', 'var(--gray)'],
};
let timer = null;

export async function loadHistory() {
  clearTimeout(timer);
  if (state.view !== 'history') return;
  try {
    state.history = await api.history();
    emit('history');
  } catch { /* the sidebar shows the server is offline */ }
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

function commitHTML(c, repo) {
  const subject = c.merge && c.branch ? `Merged <span class="br-chip">${icon.branch}${esc(c.branch)}</span>` : esc(c.subject);
  const hash = repo ? `<a class="hash" href="${esc(repo)}/commit/${esc(c.full)}" target="_blank" rel="noreferrer">${esc(c.hash)}</a>` : `<span class="hash">${esc(c.hash)}</span>`;
  // A published build gets its tag; the newest one is what players have now.
  const release = c.release ? `<span class="rel-chip${c.live ? ' is-live' : ''}" title="${c.live ? 'The build players have now' : 'Published to players'}">${icon.rocket}${c.live ? 'Live' : esc(c.release.replace(/^release\//, ''))}</span>` : '';
  const mark = `<button class="mark${c.bookmarked ? ' on' : ''}" data-mark="${esc(c.full)}" title="${c.bookmarked ? 'Remove bookmark' : 'Bookmark'}" aria-pressed="${!!c.bookmarked}">${icon.bookmark}</button>`;
  return `<div class="cm${c.merge ? ' merge' : ''}${c.live ? ' is-live' : ''}${c.bookmarked ? ' marked' : ''}"><span class="cm-node"></span><div class="cm-main"><div class="cm-subject">${subject}${release}</div>`
    + `<div class="cm-meta"><span class="who${c.claude ? ' claude' : ''}">${c.claude ? 'Claude' : esc(c.author)}</span>${hash}`
    + `${c.pushed ? '' : '<span class="unpushed">Not pushed</span>'}</div></div>${mark}<span class="cm-time">${hhmm(c.at)}</span></div>`;
}

function mainHTML(h) {
  const days = [];
  for (const c of h.main.commits) {
    const label = dayLabel(c.at);
    if (!days.length || days[days.length - 1].label !== label) days.push({ label, commits: [] });
    days[days.length - 1].commits.push(c);
  }
  const more = h.main.total - h.main.commits.length;
  return `<div class="panel-head">${icon.commit}Main<span class="count">${h.main.total} commits</span></div>`
    + (days.length ? days.map(d => `<div class="day">${esc(d.label)}</div><div class="cms">${d.commits.map(c => commitHTML(c, h.repo)).join('')}</div>`).join('')
      : '<div class="empty">No commits yet</div>')
    + (more > 0 ? `<div class="panel-foot">${more} older commit${more === 1 ? '' : 's'}${h.repo ? ` · <a href="${esc(h.repo)}/commits/main" target="_blank" rel="noreferrer">see them on GitHub</a>` : ''}</div>` : '');
}

// ---- Branches ----

function branchHTML(b) {
  const tags = (b.lane ? `<span class="lc">L${b.lane}</span>` : '') + (b.pushed ? '' : '<span class="local">Not on GitHub</span>');
  return `<div class="br-row"><span class="br-icon">${icon.branch}</span><div class="br-main"><div class="br-name"><span>${esc(b.name)}</span>${tags}</div>`
    + `<div class="br-sub">${esc(b.subject)}</div></div><div class="br-side"><span class="ahead" title="Commits not on main">+${b.ahead}</span>`
    + `${b.behind ? `<span class="behind" title="Main commits it doesn't have">−${b.behind}</span>` : ''}<span class="age">${agoText(b.at)}</span></div></div>`;
}

function branchesHTML(h) {
  const open = h.branches.filter(b => b.ahead > 0).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const merged = h.branches.length - open.length;
  return `<div class="panel-head">${icon.branch}Open branches<span class="count">${open.length}</span></div>`
    + (open.length ? open.map(branchHTML).join('') : '<div class="empty">Everything is merged into main</div>')
    + (merged ? `<div class="panel-foot">${merged} merged branch${merged === 1 ? '' : 'es'} not deleted yet</div>` : '');
}

// ---- Lanes ----

// What a lane is doing: its Workboard task first, else what git shows.
function laneState(l) {
  const task = state.tasks.find(t => t.lane === l.lane && (t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && (t.status === 'ready' || t.status === 'queued'))));
  const kind = task ? (task.status === 'working' || task.status === 'stuck' ? task.status : 'held') : l.branch ? 'branch' : l.dirty ? 'dirty' : 'idle';
  const last = l.events[0]?.at || '';
  return { task, kind, active: kind !== 'idle', last };
}

function laneHTML(l, s) {
  const [label, color] = LANE_STATE[s.kind];
  const where = l.branch ? `${icon.branch}<span>${esc(l.branch)}</span>` : `<span>main @ ${esc(l.head)}</span>`;
  const done = of('done').filter(t => t.lane === l.lane).slice(0, 3);
  const events = l.events.slice(0, 6);
  return `<div class="lane-card${s.active ? ' active' : ''}" style="--c:${color}">`
    + `<div class="lane-head"><span class="lane-num">${l.lane}</span><div class="lane-title"><div class="lane-name">Lane ${l.lane}</div><div class="lane-where">${where}</div></div>`
    + `<span class="state-pill">${label}</span></div>`
    + `<div class="lane-flags"><span class="flag${l.open ? ' on' : ''}"><i></i>${l.open ? 'Syncing to Studio' : 'Not open'}</span>`
    + `${l.dirty ? `<span class="flag warn">${l.dirty} uncommitted file${l.dirty === 1 ? '' : 's'}</span>` : ''}</div>`
    + (s.task ? `<button class="lane-task" data-task="${esc(s.task.id)}"><span class="s-id">${esc(s.task.id)}</span><span>${esc(s.task.title)}</span>${icon.chev}</button>` : '')
    + (events.length ? `<ol class="lane-events">${events.map(e => `<li class="ev ev-${esc(e.kind)}"><span class="ev-icon">${EVENT_ICON[e.kind] || icon.commit}</span>`
      + `<span class="ev-text">${esc(e.text)}</span><span class="ev-at" title="${esc(e.at)}">${agoText(e.at)}</span></li>`).join('')}</ol>` : '<div class="empty">Nothing done here yet</div>')
    + (done.length ? `<div class="lane-done">${done.map(t => `<button class="done-row" data-task="${esc(t.id)}">${icon.checkSm}<span>${esc(t.title)}</span></button>`).join('')}</div>` : '')
    + `</div>`;
}

function lanesHTML(h) {
  if (!h.lanes.length) return '<div class="empty lanes-empty">No lanes yet. A game gets them in Foundation (LANES.md).</div>';
  const lanes = h.lanes.map(l => ({ l, s: laneState(l) }))
    .sort((a, b) => (b.s.active - a.s.active) || String(b.s.last).localeCompare(String(a.s.last)) || a.l.lane - b.l.lane);
  return `<div class="lane-grid-cards">${lanes.map(({ l, s }) => laneHTML(l, s)).join('')}</div>`;
}

// ---- The view ----

export function renderHistory() {
  const h = state.history;
  $('#histRepo').hidden = !h?.repo;
  if (h?.repo) $('#histRepo').href = h.repo;
  if (!h) {
    $('#histSub').textContent = '';
    $('#histBody').innerHTML = '<div class="blank" style="min-height:40vh"><div class="blank-in"><div class="blank-title">Loading history…</div></div></div>';
    return;
  }
  const today = h.main.commits.filter(c => isToday(c.at));
  const busy = h.lanes.filter(l => laneState(l).active).length;
  const live = h.main.live ? `Live on Roblox: ${h.main.live.tag.replace(/^release\//, '')}` : 'Not published yet';
  const pushed = h.main.unpushed ? `${h.main.unpushed} commit${h.main.unpushed === 1 ? '' : 's'} on main not pushed` : (h.main.remote ? 'Main is pushed to GitHub' : 'Main has no GitHub copy yet');
  $('#histSub').textContent = `${live} · ${pushed}`;
  const stat = (value, label, color = 'var(--text)') => `<div class="stat-tile" style="--c:${color}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
  $('#histBody').innerHTML = `<div class="stat-row">${stat(today.length, 'Commits today')}${stat(today.filter(c => c.merge).length, 'Merged today', 'var(--violet)')}`
    + `${stat(h.branches.filter(b => b.ahead > 0).length, 'Open branches', 'var(--cyan)')}${stat(`${busy}<span>/${h.lanes.length}</span>`, 'Lanes busy', 'var(--blue)')}</div>`
    + `<div class="hist-top"><div class="panel">${mainHTML(h)}</div><div class="panel">${branchesHTML(h)}</div></div>`
    + `<div class="section">Lanes<span class="sec-note">busy first</span></div>${lanesHTML(h)}`;
}

export function initHistory() {
  $('#histBody').addEventListener('click', async e => {
    const mark = e.target.closest('[data-mark]');
    if (mark) {
      const on = !mark.classList.contains('on');
      mark.classList.toggle('on', on);
      mark.closest('.cm').classList.toggle('marked', on);
      try { await api.bookmark(mark.dataset.mark); } catch { toast('Couldn\'t save the bookmark', 'var(--red)'); }
      loadHistory();
      return;
    }
    const task = e.target.closest('[data-task]');
    if (task) openTask(task.dataset.task);
  });
}
