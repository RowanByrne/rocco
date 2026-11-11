// The archive: what the board no longer shows (approved more than a few days ago, or deleted), newest first, and
// searched by word across each task's title, note, summary and history (server/tasks.ps1 Get-Archive). A row opens
// the task as it was: its session, what it changed, its checks.
import { html, nothing } from '../lib/html.js';
import { $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { showSheet, openSheetKey } from '../ui/sheet.js';
import { openTaskById } from './workboard.js';

let view = { q: '', rows: [], total: 0, loading: false, error: '', asked: 0 };
let timer = 0;

const when = iso => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
const kind = t => t.status === 'removed' ? 'Deleted' : t.kind === 'plan' ? 'Feature' : t.kind === 'question' ? 'Question' : 'Approved';

function body() {
  const more = view.rows.length < view.total;
  return html`<h2 class="s-title">Archive</h2><div class="s-where">Everything approved more than a few days ago, or deleted. A task opens as it was.</div><div class="arch-find">${icon.search}<input class="input" id="archiveQ" type="search" placeholder="Find a task by any words in it" aria-label="Search the archive" .value=${view.q}></div>${
    view.error ? html`<div class="load-error">${icon.alert}<span>Couldn't read the archive: ${view.error}</span><button class="btn-sm" data-arch-retry>Retry</button></div>` : nothing}${
    !view.rows.length && !view.loading && !view.error ? html`<div class="mut arch-none">${view.q ? 'Nothing in the archive has all of those words.' : 'Nothing here yet. Tasks arrive a few days after they\'re approved.'}</div>` : nothing
  }<div class="arch-list">${view.rows.map(t => html`<div class="s-row arch-row${t.status === 'removed' ? ' gone' : ''}" data-arch=${t.id} tabindex="0" role="button"><span class="s-id">${t.id}</span><span class="arch-title">${t.title}</span><span class="at">${kind(t)} · ${when(t.doneAt || t.updated)}</span></div>`)}</div>${
    view.loading ? html`<div class="mut arch-none"><span class="spin"></span> Looking</div>` : more ? html`<div class="row arch-more"><button class="btn-sm" data-arch-more>Show more</button><span class="mut">${view.rows.length} of ${view.total}</span></div>` : view.rows.length ? html`<div class="mut arch-none">${view.total} task${view.total === 1 ? '' : 's'}</div>` : nothing}`;
}

const draw = () => { if (openSheetKey() === 'archive') showSheet('archive', { color: 'var(--gray)', chip: 'Archive', body: body() }); };

// add: the next page, added to what's shown. The latest search wins: an answer to an older one is dropped.
async function load(add = false) {
  const asked = ++view.asked, q = view.q;
  view.loading = true;
  view.error = '';
  draw();
  try {
    const got = await api.archive(q, add ? view.rows.length : 0);
    if (asked !== view.asked) return;
    view.rows = add ? [...view.rows, ...got.tasks] : got.tasks;
    view.total = got.total;
  } catch (e) {
    if (asked !== view.asked) return;
    view.error = e.message;
  }
  view.loading = false;
  draw();
}

export function showArchive(q = '') {
  view = { q, rows: [], total: 0, loading: true, error: '', asked: view.asked };
  showSheet('archive', { color: 'var(--gray)', chip: 'Archive', body: body() });
  load();
  setTimeout(() => $('#archiveQ')?.focus(), 150);
}

// A different project's archive is its own.
export function resetArchive() { view = { q: '', rows: [], total: 0, loading: false, error: '', asked: view.asked + 1 }; clearTimeout(timer); }

export function initArchive() {
  const sheet = $('#sheet');
  sheet.addEventListener('input', e => {
    if (openSheetKey() !== 'archive' || e.target.id !== 'archiveQ') return;
    view.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
  });
  const open = el => { const t = view.rows.find(x => x.id === el.dataset.arch); if (t) openTaskById(t.id, t); };
  sheet.addEventListener('click', e => {
    if (openSheetKey() !== 'archive') return;
    const row = e.target.closest('[data-arch]');
    if (row) open(row);
    else if (e.target.closest('[data-arch-more]')) load(true);
    else if (e.target.closest('[data-arch-retry]')) load();
  });
  sheet.addEventListener('keydown', e => {
    if (openSheetKey() !== 'archive' || e.key !== 'Enter') return;
    const row = e.target.closest('[data-arch]');
    if (row) { e.preventDefault(); open(row); }
  });
}
