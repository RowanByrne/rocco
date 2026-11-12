// More of a task's sheet (views/workboard.js draws the rest and passes what's clicked here): stepping in on its
// worker (pause, start again, its lane and worker), the checks its worker ran, its time at work and what its sessions
// used, a link to it, and each changed file's lines.
import { state } from '../state.js';
import { html, nothing } from '../lib/html.js';
import { hhmm } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api, DEMO } from '../api.js';
import { toast } from '../ui/toast.js';
import { sessionUsage } from './session.js';

const TIERS = ['heavy', 'standard', 'light'];
const TIER_NAME = { heavy: 'Heavy', standard: 'Standard', light: 'Light' };

// What's open in the sheet's extra parts, for the task whose sheet it is.
let part = fresh('');
function fresh(id) { return { id, diffs: new Map(), outputs: new Map(), confirm: '' }; }
export function resetParts(id = '') { if (part.id !== id) part = fresh(id); }

// ---- Numbers ----

// 1,234 tokens as 1.2k, 2,900,000 as 2.9M.
export const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n || 0));
// Seconds at work as 45s, 14m, 2h 5m.
export const duration = s => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
export const allTokens = u => (u.in || 0) + (u.out || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
export const tokenDetail = u => `In ${Math.round(u.in || 0).toLocaleString()} · out ${Math.round(u.out || 0).toLocaleString()} · read from the cache ${Math.round(u.cacheRead || 0).toLocaleString()} · written to it ${Math.round(u.cacheWrite || 0).toLocaleString()}`;

// A task's time at work so far, in seconds: what's on record, and the stretch it's in now.
export const workedOf = t => (t.worked || 0) + (t.status === 'working' && t.workSince ? Math.max(0, (Date.now() - Date.parse(t.workSince)) / 1000) : 0);

// ---- What a task took: under its title ----

export function effort(t) {
  const worked = workedOf(t), u = sessionUsage(t.id);
  if (!worked && !u) return nothing;
  const parts = [];
  if (worked) parts.push(html`<span title="From each time it turned Working to when it stopped">Worked ${duration(worked)}${t.attempt > 1 ? ` over ${t.attempt} attempts` : ''}</span>`);
  if (u) parts.push(html`<span title=${tokenDetail(u)}>${tokens(allTokens(u))} tokens in ${u.sessions} session${u.sessions === 1 ? '' : 's'}${u.shared ? ' (shared with other tasks)' : ''}</span>`);
  return html`<div class="s-effort">${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}</div>`;
}

// ---- Stepping in on its worker ----

// Work that a worker does or will do: not a feature plan (its steps are the tasks) or a question to the conductor.
const stepsIn = t => t.kind !== 'plan' && t.kind !== 'question' && ['working', 'stuck', 'queued'].includes(t.status);

// Pause or Resume, and Start again: icons in the sheet's header, by Delete, each saying what it does when hovered.
// The conductor runs the workers, so each of these is handed to it (stepIn's note says so until it's done).
export function stepButtons(t) {
  if (!stepsIn(t)) return nothing;
  const running = t.status === 'working' || t.status === 'stuck';
  const pausing = t.held && t.pending === 'stop';
  const tip = t.held ? 'Resume: Rocco picks it up next' : running ? 'Pause: stop its worker and keep its branch, until you resume it' : 'Pause: keep it from starting until you resume it';
  return html`${t.held
    ? html`<button class="icon-btn go" data-step="resume" title=${tip} aria-label=${tip}>${icon.play}</button>`
    : html`<button class="icon-btn" data-step="pause" title=${tip} aria-label=${tip}>${icon.pause}</button>`}${
    running && !pausing ? (part.confirm === 'restart'
      ? html`<button class="btn-sm danger confirm" data-step="restart" title="Stop its worker and start a fresh one on it, from what it has so far">Start again?</button>`
      : html`<button class="icon-btn" data-step="restart" title="Start again: stop its worker and start a fresh one on it, from what it has so far" aria-label="Start again">${icon.retry}</button>`) : nothing}`;
}

// The row under a task's title: the lane and worker to use, and what Rocco is doing about a step in (stepButtons).
export function stepIn(t) {
  if (!stepsIn(t)) return nothing;
  const count = state.meta.lanes?.count || 0;
  const waits = { stop: 'Pausing: Rocco is stopping its worker', restart: 'Rocco is starting a fresh worker on it', assign: 'Rocco is moving it', resume: 'Resumed: Rocco picks it up next' }[t.pending] || (t.held ? 'Paused. Its branch is kept, and it waits here until you resume it.' : '');
  return html`<div class="s-step"><label class="s-pick">Lane<select class="input" data-want="lane" .value=${String(t.wantLane || 0)}><option value="0" ?selected=${!t.wantLane}>Any</option>${
    Array.from({ length: count }, (_, i) => i + 1).map(n => html`<option value=${n} ?selected=${t.wantLane === n}>${n}</option>`)}</select></label><label class="s-pick">Worker<select class="input" data-want="tier" .value=${t.wantTier || 'any'}><option value="any" ?selected=${!t.wantTier}>Any</option>${
    TIERS.map(x => html`<option value=${x} ?selected=${t.wantTier === x}>${TIER_NAME[x]}</option>`)}</select></label>${
    waits ? html`<span class="s-step-note">${waits}</span>` : nothing}</div>`;
}

// A chip for the board: paused, or where the user wants it.
export function stepChips(t) {
  const want = [t.wantLane ? `Lane ${t.wantLane}` : '', t.wantTier ? TIER_NAME[t.wantTier] : ''].filter(Boolean).join(' · ');
  return html`${t.held ? html`<span class="fchip paused" title="Paused: it waits until you resume it">Paused</span>` : nothing}${
    want && t.status === 'queued' ? html`<span class="fchip" title="What you picked for it">${want}</span>` : nothing}`;
}

// ---- A link to the task ----

export const taskUrl = id => `${location.origin}${location.pathname}?p=${encodeURIComponent(state.project)}${DEMO ? '&demo' : ''}#task/${id}`;
export const linkButton = t => html`<button class="icon-btn" data-copy-link title="Copy a link to this task" aria-label="Copy a link to this task">${icon.link}</button>`;

// ---- Checks: what its worker ran ----

export function checks(t) {
  const list = t.checks || [];
  if (!list.length) return nothing;
  return html`<div class="sec-h">Checks</div><div class="checks">${list.map(c => {
    const out = c.file ? part.outputs.get(c.file) : null;
    return html`<div class="check ${c.ok ? 'ok' : 'bad'}"><div class="check-row"><span class="check-mark">${c.ok ? icon.checkSm : '×'}</span><span class="check-text">${c.text}</span><span class="at">${hhmm(c.at)}</span>${
      c.file ? html`<button class="linkish" data-check-out=${c.file}>${out ? 'Hide output' : 'Output'}</button>` : nothing}</div>${
      out ? (out.error ? html`<div class="load-error">${icon.alert}<span>Couldn't read its output: ${out.error}</span></div>` : out.text == null ? html`<div class="mut">Loading…</div>` : html`<pre class="check-out">${out.text}</pre>`) : nothing}</div>`;
  })}</div>`;
}

async function toggleOutput(t, file, redraw) {
  if (part.outputs.has(file)) { part.outputs.delete(file); redraw(); return; }
  const out = { text: null, error: '' };
  part.outputs.set(file, out);
  redraw();
  try { out.text = await api.checkOutput(t.id, file); } catch (e) { out.error = e.message; }
  if (part.id === t.id) redraw();
}

// ---- What changed, file by file ----

// A diff's lines, each marked as git marks it. The file header (up to the first @@) is left out: the row above names
// the file.
function diffLines(text) {
  const lines = text.split('\n');
  const start = Math.max(0, lines.findIndex(l => l.startsWith('@@')));
  return lines.slice(start).map(l => html`<span class=${l.startsWith('@@') ? 'd-hunk' : l.startsWith('+') ? 'd-add' : l.startsWith('-') ? 'd-del' : 'd-same'}>${l || ' '}</span>`);
}

// One changed file: its row (click to open its lines), and its lines when open.
export function changedFile(f) {
  const d = part.diffs.get(f.path);
  return html`<div class="chg-file${d ? ' open' : ''}"><button class="chg" data-diff=${f.path} aria-expanded=${d ? 'true' : 'false'} title="See what changed in it">${icon.chev}<span class="chg-path">${f.path}</span><span class="chg-add">+${f.added}</span><span class="chg-del">−${f.removed}</span></button>${
    !d ? nothing
      : d.error ? html`<div class="load-error">${icon.alert}<span>Couldn't load its changes: ${d.error}</span><button class="btn-sm" data-diff-retry=${f.path}>Retry</button></div>`
      : !d.data ? html`<div class="mut diff-wait">Loading…</div>`
      : d.data.binary ? html`<div class="mut diff-wait">A binary file: nothing to show as lines.</div>`
      : html`<pre class="diff">${diffLines(d.data.text)}</pre>${d.data.cut ? html`<div class="mut diff-wait">A long change: this is its first part.</div>` : nothing}`}</div>`;
}

async function loadDiff(t, path, redraw) {
  const d = { data: null, error: '' };
  part.diffs.set(path, d);
  redraw();
  try { d.data = await api.diff(t.id, path); } catch (e) { d.error = e.message; }
  if (part.id === t.id) redraw();
}

// The task moved on (sent back, built again): the lines shown may not be its lines any more.
export function forgetDiffs() { part.diffs.clear(); }

// ---- What's clicked or changed in these parts ----

// run(what, action, text, done): does a task action and says so if it fails (workboard.js attempt and act).
// Returns true when the click was for one of these parts.
export function partsClick(e, t, { redraw, run }) {
  const hit = selector => e.target.closest(selector);
  if (hit('[data-step]')) {
    const step = hit('[data-step]').dataset.step;
    if (step === 'restart' && part.confirm !== 'restart') {
      part.confirm = 'restart';
      redraw();
      setTimeout(() => { if (part.confirm === 'restart') { part.confirm = ''; redraw(); } }, 4000);
      return true;
    }
    part.confirm = '';
    const said = { pause: t.status === 'queued' ? 'Paused. It stays here until you resume it.' : 'Pausing: Rocco stops its worker and keeps its branch.', resume: 'Resumed', restart: 'Rocco starts a fresh worker on it' }[step];
    run({ pause: 'pause it', resume: 'resume it', restart: 'start it again' }[step], step, '', () => toast(said, 'var(--violet)'));
    return true;
  }
  if (hit('[data-copy-link]')) {
    navigator.clipboard?.writeText(taskUrl(t.id)).then(() => toast('Link copied'), () => toast("Couldn't copy the link", 'var(--red)'));
    return true;
  }
  if (hit('[data-check-out]')) { toggleOutput(t, hit('[data-check-out]').dataset.checkOut, redraw); return true; }
  if (hit('[data-diff-retry]')) { loadDiff(t, hit('[data-diff-retry]').dataset.diffRetry, redraw); return true; }
  if (hit('[data-diff]')) {
    const path = hit('[data-diff]').dataset.diff;
    if (part.diffs.has(path)) { part.diffs.delete(path); redraw(); } else loadDiff(t, path, redraw);
    return true;
  }
  return false;
}

// The lane or worker picked for it.
export function partsChange(e, t, { run }) {
  const want = e.target.dataset?.want;
  if (!want) return false;
  const value = e.target.value;
  const text = want === 'lane' ? `lane=${value}` : `tier=${value}`;
  const moving = t.status === 'working' || t.status === 'stuck';
  run('change it', 'assign', text, () => toast(moving ? 'Rocco moves it there' : 'Kept for when it starts', 'var(--violet)'));
  return true;
}
