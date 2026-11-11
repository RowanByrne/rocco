// The conductor in Rocco (README.md "The conductor in Rocco"): a status line above the note box that says what it's
// doing; its questions and permission requests above the note box, each question with its pictures and its own answer
// box; and its history, which slides open from the status line, everything below moving down to make room. The data
// is its thread (server/thread.ps1).
import { state, on, emit } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing, repeat, live, ifDefined } from '../lib/html.js';
import { hhmm } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { draft } from '../lib/drafts.js';
import { once } from '../lib/busy.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { notify } from '../notify.js';
import { agentName } from '../agent.js';
import { go } from '../router.js';
import { prose, proseLine } from '../prose.js';
import { pics, picOption, openPicsFrom } from '../ui/pics.js';

let shown = false;           // the history is open
let history = null;          // { stamp, items, steps }
let loading = false;
let loadError = '';          // why the history couldn't be read
let mode = null;             // what the note box sends: { kind: 'reply', to }, else a note
const unfolded = new Set();  // step groups and runs of check-ins the user opened, by their first line
const expanded = new Set();  // long messages the user opened in full
const seen = new Set();      // open questions and requests already announced
const answering = new Set(); // questions whose answers are on their way
const deciding = new Set();  // permission requests whose answer is on its way
let first = true;

// What the user is in the middle of on one of its questions, kept by project until it's sent (lib/drafts.js): what's
// typed in its answer box, the answers picked so far (one per question), and what's ticked on a multi-select.
const typedOf = id => draft.get(`ask:${id}`);
const picksOf = id => draft.get(`askpicks:${id}`, []);
const tickedOf = id => draft.get(`askticks:${id}`, []);
const ASK_DRAFTS = ['ask:', 'askpicks:', 'askticks:'];

const SKIP = "No preference: it's your call.";
const conductor = () => state.meta.conductor || { state: 'none' };
const opened = () => (conductor().open || []);
const openAsks = () => opened().filter(e => e.kind === 'asked');
const openPermissions = () => opened().filter(e => e.kind === 'permission');
const firstLine = text => String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';

// A check-in with nothing in it: "Watching.", "Still watching the board." The history folds a run of them into one line.
const IDLE = /^(still |back to )?(watching|listening|waiting|standing by)\b[^\n]{0,70}$/i;
const isIdle = e => e.kind === 'said' && IDLE.test(String(e.text || '').trim());

// ---- The note box: a note, or a reply to one of the conductor's messages ----
// Its questions aren't answered here: each has its own answer box, on the question.

export function noteMode() {
  return mode?.kind === 'reply' ? { kind: 'reply', label: `Replying to Rocco`, placeholder: `Reply to Rocco` } : null;
}

function setMode(to) {
  mode = to ? { kind: 'reply', to } : null;
  draft.set('note-to', to || '');
  renderNoteMode();
}

// Back to a plain note (the chip's ×, or picking a note type).
export function leaveMode() { setMode(''); }

// What the user typed, sent in the note box's mode. Returns false when it's a plain note.
export async function sendInMode(text) {
  if (!noteMode()) return false;
  const to = mode.to;
  setMode('');
  try {
    const r = await api.conductorMessage(text, to);
    await refresh();
    toast(`Sent to Rocco${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--claude)');
  } catch (e) {
    // Still a reply: the note box gets its words back (composer.js).
    setMode(to);
    toast(`Couldn't send it: ${e.message}`, 'var(--red)');
    throw e;
  }
  return true;
}

function renderNoteMode() {
  const m = noteMode(), box = $('#noteMode');
  box.hidden = !m;
  render(m ? html`<span class="nm-label">${icon.send}${m.label}</span><button type="button" class="nm-x" data-leave-mode title="Write a note instead" aria-label="Write a note instead">×</button>` : nothing, box);
  $('#composer').classList.toggle('to-conductor', !!m);
  emit('note-mode');
}

// ---- Answering its questions ----

// One answer per question: a picked option (several, for a multi-select), the user's words, or "your call".
// Returns false when it couldn't be sent: the picks before it are kept, to answer the last question again.
async function answer(id, given) {
  const ask = openAsks().find(e => e.id === id);
  if (!ask || answering.has(id)) return false;
  const got = [...picksOf(id)];
  if (given) got.push(given);
  draft.clear(`askticks:${id}`);
  if (got.length < ask.questions.length) { draft.set(`askpicks:${id}`, got); renderAsks(); focusAnswer(id); return true; }
  answering.add(id);
  renderAsks();
  const text = ask.questions.map((q, i) => `${q.text.trim()} ${got[i]}`).join('\n');
  let ok = true;
  try {
    const r = await api.conductorAnswer(id, got, text);
    draft.clear(`askpicks:${id}`);
    await refresh();
    toast(`Answer sent to Rocco${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--amber)');
  } catch (e) { ok = false; draft.set(`askpicks:${id}`, got.slice(0, -1)); toast(`Couldn't send the answer: ${e.message}`, 'var(--red)'); }
  answering.delete(id);
  renderAll();
  return ok;
}

// The question's answer box: what's typed, with what's ticked on a multi-select. Enter or its send button.
async function sendTyped(id) {
  const words = typedOf(id).trim(), ticked = tickedOf(id);
  const value = [ticked.join(', '), words].filter(Boolean).join('. ');
  if (!value) { focusAnswer(id); return; }
  // The box empties for the next question; an answer that didn't send gets its words back.
  draft.clear(`ask:${id}`);
  if (!await answer(id, value)) { draft.set(`ask:${id}`, words); draft.set(`askticks:${id}`, ticked); renderAsks(); }
}

const SEND_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;

function askCard(ask) {
  const got = picksOf(ask.id), i = got.length, q = ask.questions[i];
  if (!q || answering.has(ask.id)) return html`<div class="c-ask done"><span class="spin"></span>Sending your answer</div>`;
  const ticked = tickedOf(ask.id);
  const opt = o => o.image ? picOption(o, api.conductorFile(o.image), { cPick: o.label, ask: ask.id }, ticked.includes(o.label))
    : html`<button class="opt${ticked.includes(o.label) ? ' on' : ''}" data-c-pick=${o.label} data-ask=${ask.id} title=${ifDefined(o.detail || undefined)}><span>${o.label}</span></button>`;
  const pictured = (q.options || []).some(o => o.image);
  return html`<div class="c-ask${ask.expired ? ' late' : ''}" data-ask-card=${ask.id}><div class="c-ask-head"><span class="c-who">Rocco asks</span>${q.header ? html`<span class="c-tag">${q.header}</span>` : nothing}${
    ask.questions.length > 1 ? html`<span class="ask-n">${i + 1} of ${ask.questions.length}</span>` : nothing}<span class="c-at">${hhmm(ask.at)}</span></div><div class="c-ask-q">${proseLine(q.text)}</div><div data-pic-set data-ask=${ask.id}>${pics((q.images || []).map(api.conductorFile))}${
    q.options?.length ? html`<div class="opts${pictured ? ' with-pics' : ''}">${q.options.map(opt)}</div>` : nothing
  }</div><div class="c-reply"><textarea data-c-input=${ask.id} rows="1" placeholder=${q.options?.length ? (q.multi ? 'Tick some, or type your answer' : 'Or type your answer') : 'Type your answer'} aria-label="Your answer to Rocco" .value=${live(typedOf(ask.id))}></textarea><button type="button" class="send" data-c-send=${ask.id} title="Send your answer" aria-label="Send your answer">${SEND_ICON}</button></div><div class="ask-foot">${
    q.multi ? html`<button class="btn-sm go" data-c-multi=${ask.id} ?disabled=${!ticked.length}>Send these</button>` : nothing
  }<button class="linkish" data-c-skip=${ask.id}>Let Rocco decide</button>${i ? html`<button class="linkish" data-c-back=${ask.id}>Back</button>` : nothing}</div></div>`;
}

const grow = box => { box.style.height = 'auto'; box.style.height = box.scrollHeight + 'px'; };

function focusAnswer(id) {
  const box = $('#condAsks').querySelector(`[data-c-input="${CSS.escape(id)}"]`);
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

const permission = p => html`<div class="c-perm${deciding.has(p.id) ? ' sending' : ''}" data-perm-card=${p.id}><div class="c-ask-head"><span class="c-who">${p.worker ? 'A worker' : 'Rocco'} wants your OK</span><span class="c-at">${hhmm(p.at)}</span></div><div class="c-ask-q">${p.text}</div>${
  p.detail && p.detail !== p.text ? html`<pre class="c-detail">${p.detail}</pre>` : nothing
}<div class="c-perm-btns"><button class="btn-sm go" data-allow=${p.id}>${icon.check}Allow</button><button class="btn-sm danger" data-deny=${p.id}>Deny</button></div></div>`;

// A request its hook stopped waiting on: the agent's own window asks now.
const elsewhere = list => list.length ? html`<div class="c-perm late"><div class="c-ask-head"><span class="c-who">Rocco is waiting for your OK in its window</span></div><div class="c-ask-q">${list.at(-1).text}</div><div class="c-perm-btns"><button class="btn-sm" data-show-window>Show its window</button></div></div>` : nothing;

// Only what changed is touched, so each answer box keeps what's typed in it and where the caret is.
function renderAsks() {
  const box = $('#condAsks');
  render(html`${repeat(openPermissions(), p => p.id, permission)}${elsewhere(conductor().elsewhere || [])}${repeat(openAsks(), a => a.id, askCard)}`, box);
  for (const input of box.querySelectorAll('[data-c-input]')) grow(input);
}

// ---- The status line ----

function statusOf() {
  // Rocco, whichever agent runs as the conductor (agent.js).
  const c = conductor(), name = 'Rocco';
  if (openPermissions().length) return { tone: 'ask', text: `${name} wants your OK` };
  if (openAsks().length) return { tone: 'ask', text: `${name} is asking you something` };
  if ((c.elsewhere || []).length) return { tone: 'ask', text: `${name} is waiting for your OK in its window` };
  // Opened by Rocco, and its hooks haven't spoken: it's asking something in its window first (whether to trust the folder).
  if (c.inWindow) return { tone: 'ask', text: `${name} is waiting for you in its window`, faded: 'the first time in a folder, it asks whether you trust it', show: true };
  // Running, but not watching the board, and silent while something waits on it (server/conductor.ps1): it has
  // stopped mid-way, or it's asking in its own window. Its window, or a restart, is the way out.
  if (c.stalled) return { tone: 'ask', text: `${name} hasn't answered for ${c.quiet} minutes`, faded: `${c.waiting} thing${c.waiting === 1 ? ' is' : 's are'} waiting on it`, show: true, restart: true };
  if (c.state === 'busy') return { tone: 'busy', text: name, doing: c.doing || 'Working' };
  if (c.state === 'listening') {
    // The last thing it said, unless that was only a check-in.
    const last = c.last && !c.last.replied && Date.now() - new Date(c.last.at).getTime() < 12 * 3600e3 ? firstLine(c.last.text) : '';
    return { tone: 'on', text: `${name} is listening`, faded: IDLE.test(last) ? '' : last };
  }
  return { tone: 'none', text: 'No conductor', faded: 'Sending a note starts one' };
}

function renderBar() {
  const s = statusOf(), c = conductor();
  const cutOff = state.tasks.some(t => t.status === 'working');
  const waiting = state.tasks.some(t => t.pending);
  const start = c.state === 'none' && (waiting || cutOff) && state.agent?.installed
    ? html`<button class="btn-sm go cond-start" data-start-conductor title=${cutOff ? 'No conductor is running, and work was cut off: this carries it on' : 'No conductor is running for this game'}>${cutOff ? 'Carry on with' : 'Start'} ${agentName()}</button>` : nothing;
  render(html`<button class="cond-stat t-${s.tone}" data-cond-toggle aria-expanded=${shown ? 'true' : 'false'} title="${shown ? 'Hide' : 'Show'} what Rocco has been doing"><i class="cond-dot"></i><span class="cond-text"><b>${s.text}</b>${
    s.doing ? html`<span class="cond-doing"> · ${s.doing}</span>` : nothing}${s.faded ? html`<span class="cond-faded"> · ${s.faded}</span>` : nothing
  }</span><span class="cond-more"><span class="cond-more-label">History</span><span class="cond-chev${shown ? ' up' : ''}">${icon.chev}</span></span></button>${start}${
    s.show ? html`<button class="btn-sm cond-start" data-show-window>Show its window</button>` : nothing}${
    s.restart ? html`<button class="btn-sm cond-start${restartArmed ? ' danger confirm' : ''}" data-restart-conductor title="End its session and open a new one, which picks the work up from the board and the lanes">${restartArmed ? 'End its session and start again?' : 'Restart it'}</button>` : nothing}${
    usageNote(c)}`, $('#condBar'));
}

// What the conductor's own session has used so far, and the model it's on, when Rocco can read them: small, at the
// end of its line.
function usageNote(c) {
  const u = c.usage, total = u ? (u.in || 0) + (u.out || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0;
  if (!total && !c.model) return nothing;
  const model = c.model || u?.model || '';
  const size = total >= 1e6 ? `${(total / 1e6).toFixed(1)}M` : total >= 1e3 ? `${Math.round(total / 1e3)}k` : String(total);
  return html`<span class="cond-used" title=${total ? `Its session so far: ${u.messages} messages, ${Math.round(u.out || 0).toLocaleString()} tokens written, ${Math.round(u.cacheRead || 0).toLocaleString()} read from the cache` : 'The model it was opened on'}>${[model, total ? `${size} tokens` : ''].filter(Boolean).join(' · ')}</span>`;
}

// Restart asks once more for a few seconds: it ends the conductor's session, and its workers with it.
let restartArmed = 0;
function restartConductor(button) {
  if (!restartArmed) { restartArmed = setTimeout(() => { restartArmed = 0; renderBar(); }, 4000); renderBar(); return; }
  clearTimeout(restartArmed);
  restartArmed = 0;
  renderBar();
  once('conductor:restart', async () => {
    try {
      const r = await api.restartConductor();
      await refresh();
      toast(r.agent ? `${r.agent} started again as the conductor, on what's on the board` : "Its session is ended. No agent could be opened in its place", r.agent ? 'var(--claude)' : 'var(--amber)');
    } catch (err) { toast(`Couldn't restart the conductor: ${err.message}`, 'var(--red)'); }
  }, button);
}

async function showWindow() {
  try { const r = await api.showConductor(); if (!r.shown) toast("Couldn't find its window. It's in your taskbar", 'var(--amber)'); } catch (err) { toast(err.message, 'var(--red)'); }
}

// ---- The history ----

const ACT = {
  note: 'Note', question: 'Question', answer: 'Answer', reopen: 'Sent back', followup: 'Follow-up', approve: 'Approved',
  'approve-plan': 'Approved the plan', revise: 'Asked for changes', queue: 'Queued', remove: 'Deleted', undo: 'Took back',
  'got-it': 'Got it', 'ask-more': 'Asked more',
  pause: 'Paused', resume: 'Resumed', restart: 'Started again', assign: 'Lane or worker',
};

function row(e, all) {
  const at = html`<span class="h-at">${hhmm(e.at)}</span>`;
  const task = e.task || undefined; // a row about a task opens it
  switch (e.kind) {
    case 'said': {
      const long = (String(e.text || '').length > 700 || String(e.text || '').split('\n').length > 14) && !expanded.has(e.id);
      return html`<div class="h-msg them"><div class="h-head"><span class="h-who">Rocco</span>${e.re ? html`<span class="h-re" data-open-task=${ifDefined(task)}>re: ${e.re}</span>` : nothing}${at}<button class="linkish h-reply" data-reply=${e.id}>Reply</button></div><div class="h-text${long ? ' clamp' : ''}">${prose(e.text)}</div>${
        long ? html`<button class="linkish h-more" data-more=${e.id}>Show all</button>` : nothing}</div>`;
    }
    case 'message':
      return html`<div class="h-msg you"><div class="h-head">${e.via === 'terminal' ? html`<span class="h-re">In Rocco's window</span>` : nothing}${at}</div><div class="h-text">${e.text}</div></div>`;
    case 'sent':
      return html`<div class="h-sent" data-open-task=${ifDefined(task)}><span class="h-act">${ACT[e.act] || e.act}</span><span class="h-what">${e.text || e.title || ''}</span>${at}</div>`;
    case 'asked': {
      const reply = all.find(x => x.kind === 'answered' && x.to === e.id);
      return html`<div class="h-q"><div class="h-head"><span class="h-who">Rocco asked</span>${at}</div>${e.questions.map((q, i) => {
        // The picture of the option picked, when it had one.
        const pic = reply && (q.options || []).find(o => o.image && o.label === reply.answers?.[i])?.image;
        return html`<div class="h-qq">${proseLine(q.text)}</div><div class="h-qa${reply ? '' : ' open'}">${pic ? html`<img class="h-pic" src=${api.conductorFile(pic)} alt="" loading="lazy">` : nothing}${reply ? reply.answers?.[i] ?? '' : 'Waiting for your answer'}</div>`;
      })}</div>`;
    }
    case 'permission': {
      const d = all.find(x => x.kind === 'decided' && x.to === e.id), gone = all.find(x => x.kind === 'expired' && x.to === e.id);
      const verdict = d ? (d.allow ? 'Allowed' : 'Denied') : gone ? 'Asked in its window' : 'Waiting for your OK';
      return html`<div class="h-event perm"><span class="h-dot"></span><span>${e.worker ? 'A worker' : 'Rocco'} asked to: ${e.text}</span><span class="h-verdict v-${d ? (d.allow ? 'yes' : 'no') : 'wait'}">${verdict}</span>${at}</div>`;
    }
    case 'event':
      return html`<div class="h-event" data-open-task=${ifDefined(task)}><span class="h-dot"></span><span>${e.text}</span>${at}</div>`;
  }
  return nothing;
}

// Steps between two messages fold into one line that opens to the list.
function stepGroup(group) {
  const key = group[0].at, open = unfolded.has(key), last = group.at(-1);
  return html`<div class="h-steps${open ? ' open' : ''}"><button class="h-steps-head" data-steps=${key}>${icon.chev}<span>${group.length} step${group.length === 1 ? '' : 's'}</span><span class="h-steps-last">${last.text}</span><span class="h-at">${hhmm(group[0].at)}${group.length > 1 ? `–${hhmm(last.at)}` : ''}</span></button>${
    open ? html`<ul>${group.map(s => html`<li><span class="h-at">${hhmm(s.at)}</span>${s.text}</li>`)}</ul>` : nothing}</div>`;
}

// A run of check-ins with nothing in them, as one line: how many, and when the latest was. It opens to each one.
function idleRun(lines) {
  const key = `idle:${lines[0].id}`, open = unfolded.has(key), last = lines.at(-1);
  return html`<div class="h-steps h-idle${open ? ' open' : ''}"><button class="h-steps-head" data-steps=${key}>${icon.chev}<span>Watching the board</span><span class="h-steps-last">${lines.length} check-ins with nothing new</span><span class="h-at">latest ${hhmm(last.at)}</span></button>${
    open ? html`<ul>${lines.map(e => html`<li><span class="h-at">${hhmm(e.at)}</span>${e.text}</li>`)}</ul>` : nothing}</div>`;
}

function historyView() {
  const failed = loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't load Rocco's history: ${loadError}</span><button class="btn-sm" data-history-retry>Retry</button></div>` : nothing;
  if (!history) return loadError ? failed : html`<div class="h-empty"><span class="spin"></span>Loading</div>`;
  const items = history.items.filter(e => !['answered', 'decided', 'expired', 'handled'].includes(e.kind));
  if (!items.length && !history.steps.length) return html`<div class="h-empty">Nothing yet. What Rocco does and says, and what you send it, shows here.</div>${failed}`;
  const rows = [...items.map(e => ({ at: e.at, e })), ...history.steps.map(s => ({ at: s.at, s }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const out = [];
  let group = [], day = '', idle = null; // idle: the run of check-ins being read, and the steps since its last one
  const flushSteps = () => { if (group.length) { out.push(stepGroup(group)); group = []; } };
  const flushIdle = () => {
    if (!idle) return;
    out.push(idle.lines.length > 1 ? idleRun(idle.lines) : row(idle.lines[0], history.items));
    group = idle.after; // what it did after its last check-in belongs to what comes next
    idle = null;
  };
  for (const r of rows) {
    const d = new Date(r.at).toDateString();
    if (d !== day) {
      flushIdle();
      flushSteps();
      day = d;
      out.push(html`<div class="h-day">${d === new Date().toDateString() ? 'Today' : new Date(r.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>`);
    }
    if (r.s) { (idle ? idle.after : group).push(r.s); continue; }
    if (isIdle(r.e)) {
      // The steps between two check-ins are the checking itself: they fold away with them.
      if (idle) { idle.lines.push(r.e); idle.after = []; } else { flushSteps(); idle = { lines: [r.e], after: [] }; }
      continue;
    }
    flushIdle();
    flushSteps();
    out.push(row(r.e, history.items));
  }
  flushIdle();
  flushSteps();
  return html`${out}${failed}`;
}

function renderHistory() {
  const list = $('#condList');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  render(historyView(), list);
  if (atBottom) list.scrollTop = list.scrollHeight;
}

async function loadHistory() {
  if (loading || !shown) return;
  loading = true;
  try {
    const r = await api.conductorThread(history?.stamp || '');
    const hadError = !!loadError;
    loadError = '';
    if (!r.same) history = r;
    if (!r.same || hadError) renderHistory();
  } catch (e) {
    if (loadError !== e.message) { loadError = e.message; renderHistory(); }
  }
  loading = false;
}

function toggleHistory() {
  shown = !shown;
  $('#condHistory').classList.toggle('open', shown);
  renderBar();
  if (shown) {
    renderHistory();
    const list = $('#condList');
    list.scrollTop = list.scrollHeight;
    loadHistory();
  }
}

// ---- Keeping it current ----

// New questions and requests get a toast and a desktop notification; what was already open when Rocco loaded doesn't.
function announce() {
  if (!('stamp' in conductor())) return; // not loaded yet
  for (const e of opened()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (first) continue;
    const message = e.kind === 'permission' ? `Rocco wants your OK: ${e.text}` : `Rocco asks: ${e.questions?.[0]?.text || ''}`;
    toast(message, 'var(--amber)');
    notify('Rocco', message, () => { go('workboard'); $('#condAsks').scrollIntoView({ block: 'center' }); });
  }
  first = false;
}

function renderAll() {
  renderBar();
  renderAsks();
  renderNoteMode();
}

export function renderConductor() {
  // A question that's gone (answered elsewhere) leaves nothing behind. Not before its state has loaded, or what was
  // being typed when the page reloaded would go too.
  if ('stamp' in conductor()) {
    const ids = openAsks().map(e => e.id);
    for (const kind of ASK_DRAFTS) draft.prune(kind, ids);
  }
  announce();
  renderAll();
  if (shown && (history?.stamp !== conductor().stamp || loadError)) loadHistory();
}

// A different project: its own thread, and its own reply in progress.
export function resetConductor() {
  history = null;
  loadError = '';
  mode = draft.get('note-to') ? { kind: 'reply', to: draft.get('note-to') } : null;
  unfolded.clear();
  expanded.clear();
  seen.clear();
  answering.clear();
  deciding.clear();
  first = true;
}

export function initConductor() {
  resetConductor();
  on('conductor', renderConductor);
  on('prose', () => { renderAsks(); if (shown) renderHistory(); });
  $('#composer').addEventListener('click', e => { if (e.target.closest('[data-leave-mode]')) { leaveMode(); $('#noteText').focus(); } });
  $('#condBar').addEventListener('click', e => {
    if (e.target.closest('[data-cond-toggle]')) toggleHistory();
    else if (e.target.closest('[data-show-window]')) showWindow();
    else if (e.target.closest('[data-restart-conductor]')) restartConductor(e.target.closest('[data-restart-conductor]'));
    else if (e.target.closest('[data-start-conductor]')) once('conductor:start', async () => {
      try {
        const r = await api.openConductor();
        await refresh();
        if (r.agent) toast(`${r.agent} started as the conductor, minimized in your taskbar`, 'var(--claude)');
      } catch (err) { toast(`Couldn't start the conductor: ${err.message}`, 'var(--red)'); }
    }, e.target.closest('[data-start-conductor]'));
  });
  // An option picked: on a multi-select it's ticked, otherwise it's the answer (with the last question, sent).
  const pickOption = (id, label) => {
    const ask = openAsks().find(a => a.id === id), q = ask?.questions[picksOf(id).length];
    if (!q) return;
    if (q.multi) {
      const t = tickedOf(id);
      draft.set(`askticks:${id}`, t.includes(label) ? t.filter(x => x !== label) : [...t, label]);
      renderAsks();
    } else answer(id, label);
  };
  const box = $('#condAsks');
  box.addEventListener('input', e => {
    const input = e.target.closest('[data-c-input]');
    if (input) { draft.set(`ask:${input.dataset.cInput}`, input.value); grow(input); }
  });
  box.addEventListener('keydown', e => {
    const input = e.target.closest('[data-c-input]');
    if (input && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendTyped(input.dataset.cInput); }
  });
  box.addEventListener('click', async e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-pic-src]')) openPicsFrom(hit('[data-pic-src]'), (label, set) => pickOption(set.dataset.ask, label));
    else if (hit('[data-c-pick]')) pickOption(hit('[data-c-pick]').dataset.ask, hit('[data-c-pick]').dataset.cPick);
    else if (hit('[data-c-send]')) sendTyped(hit('[data-c-send]').dataset.cSend);
    else if (hit('[data-c-multi]')) {
      const id = hit('[data-c-multi]').dataset.cMulti, t = tickedOf(id);
      if (t.length && !await answer(id, t.join(', '))) { draft.set(`askticks:${id}`, t); renderAsks(); }
    } else if (hit('[data-c-skip]')) answer(hit('[data-c-skip]').dataset.cSkip, SKIP);
    else if (hit('[data-c-back]')) {
      const id = hit('[data-c-back]').dataset.cBack;
      draft.set(`askpicks:${id}`, picksOf(id).slice(0, -1));
      draft.clear(`askticks:${id}`);
      renderAsks();
    } else if (hit('[data-allow]') || hit('[data-deny]')) {
      const allow = !!hit('[data-allow]'), id = (hit('[data-allow]') || hit('[data-deny]')).dataset[allow ? 'allow' : 'deny'];
      if (deciding.has(id)) return;
      deciding.add(id);
      renderAsks();
      try { await api.conductorPermission(id, allow); await refresh(); toast(allow ? 'Allowed' : `Denied. Rocco hears you said no`, allow ? 'var(--green)' : 'var(--gray)'); }
      catch (err) { toast(err.message, 'var(--red)'); await refresh(); }
      deciding.delete(id);
      renderAsks();
    } else if (hit('[data-show-window]')) showWindow();
  });
  $('#condList').addEventListener('click', e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-steps]')) {
      const key = hit('[data-steps]').dataset.steps;
      if (unfolded.has(key)) unfolded.delete(key); else unfolded.add(key);
      renderHistory();
    } else if (hit('[data-reply]')) {
      setMode(hit('[data-reply]').dataset.reply);
      $('#noteText').focus();
    } else if (hit('[data-more]')) {
      expanded.add(hit('[data-more]').dataset.more);
      renderHistory();
    } else if (hit('[data-history-retry]')) loadHistory();
    else if (hit('[data-open-task]') && !hit('a')) emit('open-task', hit('[data-open-task]').dataset.openTask);
  });
}
