// Usage: what each task took, by feature. Its time at work (from each time it turned Working to when it stopped),
// and the tokens its agent's sessions used, which Claude Code records with each message (server/sessions.ps1). These
// are counts of tokens, not money: what they cost depends on the user's plan, which Rocco doesn't know.
import { html, nothing } from '../lib/html.js';
import { $ } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { showSheet, openSheetKey } from '../ui/sheet.js';
import { openTaskById } from './workboard.js';
import { tokens, duration, allTokens, tokenDetail } from './taskparts.js';

let view = { data: null, loading: false, error: '' };

const sum = (rows, of) => rows.reduce((n, r) => n + of(r), 0);
const totals = rows => ({ in: sum(rows, r => r.in), out: sum(rows, r => r.out), cacheRead: sum(rows, r => r.cacheRead), cacheWrite: sum(rows, r => r.cacheWrite) });

function row(t) {
  return html`<div class="s-row use-row" data-use=${t.id} tabindex="0" role="button"><span class="s-id">${t.id}</span><span class="use-title">${t.title}</span><span class="use-n" title="Time at work">${t.worked ? duration(t.worked) : ''}</span><span class="use-n" title=${tokenDetail(t)}>${allTokens(t) ? tokens(allTokens(t)) : ''}</span><span class="use-n out" title="Tokens the model wrote">${t.out ? tokens(t.out) : ''}</span></div>`;
}

function group(name, rows) {
  if (!rows.length) return nothing;
  const all = totals(rows);
  return html`<div class="use-group"><div class="use-head"><span class="use-title">${name}</span><span class="use-n">${duration(sum(rows, r => r.worked))}</span><span class="use-n" title=${tokenDetail(all)}>${tokens(allTokens(all))}</span><span class="use-n out">${tokens(all.out)}</span></div>${rows.map(row)}</div>`;
}

function body() {
  const d = view.data;
  if (!d) return html`<h2 class="s-title">Usage</h2>${view.error ? html`<div class="load-error">${icon.alert}<span>Couldn't read the usage: ${view.error}</span><button class="btn-sm" data-use-retry>Retry</button></div>` : html`<div class="mut"><span class="spin"></span> Adding it up</div>`}`;
  const rows = d.tasks || [], all = totals(rows);
  const plans = (d.plans || []).filter(p => rows.some(r => r.plan === p.id));
  const c = d.conductor;
  return html`<h2 class="s-title">Usage</h2><div class="s-where">What each task took: its time at work, and the tokens its agent's sessions used. Tokens aren't money: what they cost depends on your plan.</div>${
    view.error ? html`<div class="load-error">${icon.alert}<span>Couldn't refresh it: ${view.error}</span><button class="btn-sm" data-use-retry>Retry</button></div>` : nothing
  }<div class="use-top"><div class="use-stat"><b>${duration(sum(rows, r => r.worked))}</b><span>at work</span></div><div class="use-stat" title=${tokenDetail(all)}><b>${tokens(allTokens(all))}</b><span>tokens, workers</span></div>${
    c ? html`<div class="use-stat" title=${tokenDetail(c)}><b>${tokens(allTokens(c))}</b><span>tokens, the conductor${c.model ? ` (${c.model})` : ''}</span></div>` : nothing}</div>${
    rows.length ? html`<div class="use-cols"><span class="use-title"></span><span class="use-n">Time</span><span class="use-n">Tokens</span><span class="use-n out">Written</span></div>` : html`<div class="mut">Nothing on record yet. A task shows here once it has been worked on.</div>`}${
    plans.map(p => group(p.title, rows.filter(r => r.plan === p.id)))}${group(plans.length ? 'Not part of a feature' : 'Tasks', rows.filter(r => !plans.some(p => p.id === r.plan)))}${
    rows.length && !d.sessions ? html`<div class="mut use-foot">No sessions with token counts were found, so only time shows. Rocco reads them from Claude Code's session files.</div>` : nothing}`;
}

const draw = () => { if (openSheetKey() === 'usage') showSheet('usage', { color: 'var(--violet)', chip: 'Usage', body: body(), wide: true }); };

async function load() {
  view.loading = true;
  view.error = '';
  try { view.data = await api.usage(); } catch (e) { view.error = e.message; }
  view.loading = false;
  draw();
}

export function showUsage() {
  showSheet('usage', { color: 'var(--violet)', chip: 'Usage', body: body(), wide: true });
  load();
}

export function resetUsage() { view = { data: null, loading: false, error: '' }; }

export function initUsage() {
  const sheet = $('#sheet');
  const open = el => openTaskById(el.dataset.use);
  sheet.addEventListener('click', e => {
    if (openSheetKey() !== 'usage') return;
    if (e.target.closest('[data-use-retry]')) load();
    else if (e.target.closest('[data-use]')) open(e.target.closest('[data-use]'));
  });
  sheet.addEventListener('keydown', e => {
    if (openSheetKey() !== 'usage' || e.key !== 'Enter') return;
    const row = e.target.closest('[data-use]');
    if (row) { e.preventDefault(); open(row); }
  });
}
