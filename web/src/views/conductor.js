// The chat in the middle of the Workboard (README.md "The chat"). Its first tab is the conductor's thread: what you
// send Rocco, what it says and asks, and a line for each thing that happens to a card. A feature with an agent of its
// own (server/leads.ps1), or a card given one, has a tab and a thread of its own, and what you type there goes
// straight to that agent. Under the chat: the open questions and permission requests, each with its own answer box,
// the agent's status line, and the note box. The data is a thread (server/thread.ps1), named by ?t= when it isn't
// the conductor's.
import { state, on, emit, byId } from '../state.js';
import { $ } from '../lib/dom.js';
import { html, render, nothing, repeat, live, ifDefined } from '../lib/html.js';
import { hhmm, featureVars } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { draft } from '../lib/drafts.js';
import { storage } from '../lib/storage.js';
import { once } from '../lib/busy.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { notify } from '../notify.js';
import { agentName } from '../agent.js';
import { go } from '../router.js';
import { prose, proseLine } from '../prose.js';
import { pics, picOption, openPicsFrom } from '../ui/pics.js';

let active = '';             // the thread shown: '' for the conductor's, else the id of a feature or card with its own agent
const threads = new Map();   // thread -> { history: { stamp, items, steps }, loading, loadError, since }
let mode = null;             // what the note box sends when it isn't a note: { kind: 'reply', to } or { kind: 'card', task }
let decisionsOpen = false;   // a feature thread's decisions are listed
const unfolded = new Set();  // step groups and runs of check-ins the user opened, by their first line
const expanded = new Set();  // long messages the user opened in full
const seen = new Set();      // open questions and requests already announced
const whyOf = new Map();     // an open question -> what the agent said just before asking it (historyView)
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
// A thread is a tab while its work is going: not once its card is approved or deleted, or every step of its feature
// is done. Its agent has stopped by then (server/leads.ps1 Stop-Lead), and what it did is in the archive.
const finished = l => {
  const t = byId(l.id);
  if (l.done || t?.status === 'done' || t?.status === 'removed') return true;
  if (l.kind !== 'feature') return false;
  const p = progressOf(l.id);
  return p.total > 0 && p.done === p.total;
};
const leads = () => (state.meta.leads || []).filter(l => !finished(l));
const leadOf = id => leads().find(l => l.id === id);
const agentOf = id => (id ? leadOf(id)?.conductor : state.meta.conductor) || { state: 'none' };
const conductor = () => agentOf(active);
const opened = () => (conductor().open || []);
const openAsks = () => opened().filter(e => e.kind === 'asked');
const openPermissions = () => opened().filter(e => e.kind === 'permission');
const view = (id = active) => { let v = threads.get(id); if (!v) threads.set(id, v = { history: null, loading: false, loadError: '', since: '' }); return v; };
// A picture on one of this thread's questions.
const fileOf = rel => api.conductorFile(rel, active);

// The thread shown, for the cards beside it (workboard.js lists a feature's own cards on its tab).
export const activeThread = () => active;

// A check-in with nothing in it: "Watching.", "Still watching the board." The history leaves them out.
const IDLE = /^(still |back to )?(watching|listening|waiting|standing by)\b[^\n]{0,70}$/i;
const isIdle = e => e.kind === 'said' && IDLE.test(String(e.text || '').trim());

// ---- When each thread was last looked at: what's new in it since ----

const seenKey = id => `rocco.seen:${state.project}:${id || 'main'}`;
const seenAt = id => storage.get(seenKey(id)) || '';
const markSeen = id => { if (!document.hidden && state.view === 'workboard') storage.set(seenKey(id), new Date().toISOString()); };
const unread = id => { const last = agentOf(id).last?.at || ''; return !!last && id !== active && last > seenAt(id); };

// ---- The note box: a note, or something for one message, card or thread ----
// The conductor's questions aren't answered here: each has its own answer box, on the question.

const cardVerb = t => t.status === 'ready' ? 'Send back' : t.status === 'stuck' ? 'Answer' : 'Add to';
const cardAction = t => t.status === 'ready' ? 'reopen' : t.status === 'stuck' ? 'answer' : 'followup';

// What the note box is for right now, when it isn't a new note: { kind, label, placeholder }.
export function noteMode() {
  if (mode?.kind === 'reply') return { kind: 'reply', label: 'Replying to Rocco', placeholder: 'Reply to Rocco' };
  if (mode?.kind === 'card') {
    const t = byId(mode.task);
    if (t) return { kind: 'card', label: cardVerb(t), detail: t.title, placeholder: t.status === 'ready' ? "What's still wrong? Enter sends it back" : t.status === 'stuck' ? 'Your answer' : 'Add something for its agent' };
  }
  const lead = active && leadOf(active);
  if (lead) return { kind: 'thread', label: '', placeholder: `Message ${lead.title}'s agent` };
  return null;
}

function setMode(to) {
  mode = to || null;
  draft.set('note-to', !mode ? '' : mode.kind === 'card' ? `card:${mode.task}` : mode.to);
  renderNoteMode();
}
const savedMode = () => { const to = draft.get('note-to'); return !to ? null : String(to).startsWith('card:') ? { kind: 'card', task: String(to).slice(5) } : { kind: 'reply', to }; };

// Back to a plain note (the chip's ×, or picking what the note is).
export function leaveMode() { setMode(null); }

// What the user typed, sent in the note box's mode. Returns false when it's a plain note.
export async function sendInMode(text) {
  const m = noteMode();
  if (!m) return false;
  const was = mode, thread = active;
  setMode(null);
  try {
    if (m.kind === 'card') {
      const t = byId(was.task);
      const r = await api.act(t.id, cardAction(t), text);
      await refresh();
      toast(`${t.status === 'ready' ? 'Sent back' : t.status === 'stuck' ? 'Answer sent' : 'Added'}: ${t.title}${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--amber)');
    } else {
      const r = await api.conductorMessage(text, m.kind === 'reply' ? was.to : '', thread);
      await refresh();
      if (r.opened) toast(`${r.opened} started, minimized in your taskbar, to pick it up`, 'var(--claude)');
    }
    stickToEnd();
  } catch (e) {
    // Still what it was: the note box gets its words back (composer.js).
    setMode(was);
    toast(`Couldn't send it: ${e.message}`, 'var(--red)');
    throw e;
  }
  return true;
}

function renderNoteMode() {
  const m = noteMode(), chip = m && m.label, box = $('#noteMode');
  box.hidden = !chip;
  render(chip ? html`<span class="nm-label">${icon.send}${m.label}</span>${m.detail ? html`<span class="nm-detail">${m.detail}</span>` : nothing}<button type="button" class="nm-x" data-leave-mode title="Write a note instead" aria-label="Write a note instead">×</button>` : nothing, box);
  $('#composer').classList.toggle('to-conductor', !!chip);
  emit('note-mode');
}

// ---- Answering its questions ----

// One answer per question: a picked option (several, for a multi-select), the user's words, or "your call".
// Returns false when it couldn't be sent: the picks before it are kept, to answer the last question again.
async function answer(id, given) {
  const ask = openAsks().find(e => e.id === id), thread = active;
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
    const r = await api.conductorAnswer(id, got, text, thread);
    draft.clear(`askpicks:${id}`);
    await refresh();
    toast(`Answer sent${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--amber)');
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
  const opt = o => o.image ? picOption(o, fileOf(o.image), { cPick: o.label, ask: ask.id }, ticked.includes(o.label))
    : html`<button class="opt${ticked.includes(o.label) ? ' on' : ''}" data-c-pick=${o.label} data-ask=${ask.id} title=${ifDefined(o.detail || undefined)}><span>${o.label}</span></button>`;
  const pictured = (q.options || []).some(o => o.image);
  return html`<div class="c-ask${ask.expired ? ' late' : ''}" data-ask-card=${ask.id}><div class="c-ask-head"><span class="c-who">Rocco asks</span>${q.header ? html`<span class="c-tag">${q.header}</span>` : nothing}${
    ask.questions.length > 1 ? html`<span class="ask-n">${i + 1} of ${ask.questions.length}</span>` : nothing}<span class="c-at">${hhmm(ask.at)}</span></div><div class="c-ask-q">${proseLine(q.text)}</div>${
    whyOf.get(ask.id) && !i ? html`<details class="c-why"><summary>Why Rocco asks</summary><div class="prose">${prose(whyOf.get(ask.id))}</div></details>` : nothing}<div data-pic-set data-ask=${ask.id}>${pics((q.images || []).map(fileOf))}${
    q.options?.length ? html`<div class="opts${pictured ? ' with-pics' : ''}">${q.options.map(opt)}</div>` : nothing
  }</div><div class="c-reply"><textarea data-c-input=${ask.id} rows="1" placeholder=${q.options?.length ? (q.multi ? 'Tick some, or type your answer' : 'Or type your answer') : 'Type your answer'} aria-label="Your answer to Rocco" .value=${live(typedOf(ask.id))}></textarea><button type="button" class="send round" data-c-send=${ask.id} title="Send your answer" aria-label="Send your answer">${SEND_ICON}</button></div><div class="ask-foot">${
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

// What the agent asks in its own window, which Rocco can't answer for you: a request its hook stopped waiting on, or a
// dialog no hook is offered (Claude Code's "Read outside the working directories?"; server/conductor.ps1 windowAsk).
// Where to answer it, and a way there.
function inWindowCard(c) {
  const late = (c.elsewhere || []).at(-1), ask = c.windowAsk;
  if (!late && !ask) return nothing;
  const text = ask ? ask.text : late.text;
  return html`<div class="c-perm late"><div class="c-ask-head"><span class="c-who">${active ? 'Its agent' : 'Rocco'} is waiting for you in its window</span>${ask ? html`<span class="c-at">${hhmm(ask.at)}</span>` : nothing}</div><div class="c-ask-q">${text}</div><div class="c-hint">Rocco can't answer this one for you: answer it in the agent's window, and it carries on.</div><div class="c-perm-btns"><button class="btn-sm go" data-show-window>Show its window</button></div></div>`;
}

// Only what changed is touched, so each answer box keeps what's typed in it and where the caret is.
function renderAsks() {
  const box = $('#condAsks'), list = $('#condList');
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  render(html`${repeat(openPermissions(), p => p.id, permission)}${inWindowCard(conductor())}${repeat(openAsks(), a => a.id, askCard)}`, box);
  for (const input of box.querySelectorAll('[data-c-input]')) grow(input);
  if (atEnd) list.scrollTop = list.scrollHeight; // the chat got shorter: it stays at its end
}

// ---- The tabs: the conductor's thread, then each thread with an agent of its own ----

// How an agent is doing, in one word: asking, busy, listening, or not running.
function toneOf(c) {
  if ((c.open || []).length || (c.elsewhere || []).length || c.windowAsk || c.inWindow || c.stalled) return 'ask';
  return c.state === 'busy' ? 'busy' : c.state === 'listening' ? 'on' : 'none';
}

function progressOf(id) {
  const plan = byId(id), all = state.tasks.filter(t => t.plan === id), kids = all.filter(t => t.status !== 'removed');
  return { done: kids.filter(k => k.status === 'done').length, total: Math.max(kids.length, (plan?.steps || []).length - (all.length - kids.length)) };
}

function renderTabs() {
  // The thread shown just finished: back to Rocco's.
  if (active && !leadOf(active)) { openThread(''); return; }
  const tab = (id, name, sub, vars) => html`<button class="tab${id === active ? ' on' : ''}" role="tab" aria-selected=${id === active ? 'true' : 'false'} data-thread=${id} style=${ifDefined(vars)} title=${name}><i class="tab-dot t-${toneOf(agentOf(id))}"></i><span class="tab-name">${name}</span>${
    sub ? html`<span class="tab-sub">${sub}</span>` : nothing}${unread(id) ? html`<i class="tab-new" title="New since you were last here"></i>` : nothing}</button>`;
  // Rocco's own chat is the main one: a tab of its own kind, with its mark, set apart from the features' threads.
  const main = html`<button class="tab tab-main${active === '' ? ' on' : ''}" role="tab" aria-selected=${active === '' ? 'true' : 'false'} data-thread="" title="Rocco: the main chat"><span class="tab-mark">R</span><span class="tab-name">Rocco</span><i class="tab-dot t-${toneOf(agentOf(''))}"></i>${
    unread('') ? html`<i class="tab-new" title="New since you were last here"></i>` : nothing}</button>`;
  const threads = leads();
  render(html`${main}${threads.length ? html`<span class="tabs-sep" aria-hidden="true"></span>` : nothing}${repeat(threads, l => l.id, l => {
    const p = l.kind === 'feature' ? progressOf(l.id) : null;
    return tab(l.id, l.title, p ? `${p.done}/${p.total}` : l.id, featureVars(l.id));
  })}`, $('#threadTabs'));
}

// Shows a thread: the conductor's (''), or a feature's or a card's own. What's new since it was last looked at is
// marked, and the chat opens at its end.
export function openThread(id) {
  if (id && !leadOf(id)) id = '';
  if (id === active) return;
  markSeen(active);
  active = id;
  decisionsOpen = false;
  view().since = seenAt(id);
  if (mode) setMode(null);
  renderConductor();
  renderHistory(true);
  emit('thread');
}

// ---- A feature's thread: its steps, pinned above the chat, and what was decided in it ----

const STATUS = { ready: ['To test', 'var(--green)'], stuck: ['Needs you', 'var(--amber)'], working: ['Working', 'var(--blue)'], queued: ['Up next', 'var(--gray)'],
  inbox: ['Suggested', 'var(--claude)'], done: ['Approved', 'var(--green)'], removed: ['Deleted', 'var(--gray)'] };

// Each step of the plan with the task that builds it: by its title, else by its place.
function stepsOf(plan) {
  const kids = state.tasks.filter(t => t.plan === plan.id && t.status !== 'removed').sort((a, b) => a.id.localeCompare(b.id));
  const steps = plan.steps || [];
  if (!steps.length) return kids.map(k => ({ title: k.title, task: k }));
  const left = [...kids];
  const take = fn => { const i = left.findIndex(fn); return i < 0 ? null : left.splice(i, 1)[0]; };
  const named = steps.map(s => take(k => k.title.trim().toLowerCase() === String(s.title).trim().toLowerCase()));
  return steps.map((s, i) => ({ title: s.title, task: named[i] || left.shift() || null })).concat(left.map(k => ({ title: k.title, task: k })));
}

// Questions asked and answered in this thread: the feature's decisions.
const decisions = () => {
  const items = view().history?.items || [];
  return items.filter(e => e.kind === 'asked').flatMap(e => {
    const reply = items.find(x => x.kind === 'answered' && x.to === e.id);
    return reply ? e.questions.map((q, i) => ({ at: reply.at, q: q.text, a: reply.answers?.[i] ?? '' })) : [];
  });
};

function renderHead() {
  const lead = active && leadOf(active), t = lead && byId(lead.id), box = $('#threadHead');
  box.hidden = !t;
  if (!t) { render(nothing, box); return; }
  const lane = lead.lane ? `Lane ${lead.lane}` : '', made = decisions();
  const waiting = lead.handoff ? 'Its worker is wrapping up, then its own agent takes over' : lead.waiting;
  if (lead.kind === 'card') {
    const s = STATUS[t.status] || ['', 'var(--gray)'];
    render(html`<div class="thd-row"><span class="thd-title">${t.title}</span><span class="chip" style="--c:${s[1]}"><i></i>${s[0]}</span><span class="thd-sub">${[t.id, lane, t.attempt > 1 ? `attempt ${t.attempt}` : ''].filter(Boolean).join(' · ')}</span><span class="sp"></span><button class="btn-sm" data-open-card=${t.id}>Open the card</button></div>${
      waiting ? html`<div class="thd-wait">${icon.clock}${waiting}</div>` : nothing}`, box);
    return;
  }
  const p = progressOf(t.id), steps = stepsOf(t);
  render(html`<div class="thd-row" style=${featureVars(t.id)}><span class="thd-title">${t.title}</span><span class="thd-sub">${[`${p.done} of ${p.total} done`, lane, t.branch].filter(Boolean).join(' · ')}</span><span class="sp"></span>${
    made.length ? html`<button class="btn-sm${decisionsOpen ? ' on' : ''}" data-decisions aria-expanded=${decisionsOpen ? 'true' : 'false'}>${made.length} decision${made.length === 1 ? '' : 's'}</button>` : nothing
  }<button class="btn-sm" data-open-card=${t.id}>The plan</button></div><ol class="thd-steps">${steps.map((s, i) => {
    const st = s.task ? STATUS[s.task.status] : null;
    return html`<li class="thd-step${s.task ? '' : ' todo'}" style="--c:${st ? st[1] : 'var(--gray)'}" data-open-task=${ifDefined(s.task?.id)} title=${st ? `${s.title}: ${st[0]}` : `${s.title}: not started`}><span class="thd-n">${s.task?.status === 'done' ? icon.check : i + 1}</span><span class="thd-name">${s.title}</span>${
      st && s.task.status !== 'done' ? html`<span class="thd-state">${st[0]}</span>` : nothing}</li>`;
  })}</ol>${waiting ? html`<div class="thd-wait">${icon.clock}${waiting}</div>` : nothing}${
    decisionsOpen ? html`<div class="thd-decisions">${made.map(d => html`<div class="thd-dec"><span class="thd-q">${proseLine(d.q)}</span><span class="thd-a">${d.a}</span><span class="h-at">${hhmm(d.at)}</span></div>`)}</div>` : nothing}`, box);
}

// ---- The status line ----

function statusOf() {
  // Rocco, whichever agent runs as the conductor (agent.js). On a feature's tab, its own agent.
  const c = conductor(), lead = active && leadOf(active), name = lead ? 'Its agent' : 'Rocco';
  if (openPermissions().length) return { tone: 'ask', text: `${name} wants your OK` };
  if (openAsks().length) return { tone: 'ask', text: `${name} is asking you something` };
  if ((c.elsewhere || []).length || c.windowAsk) return { tone: 'ask', text: `${name} is waiting for you in its window`, faded: 'answer it there' };
  // Opened by Rocco, and its hooks haven't spoken: it's asking something in its window first (whether to trust the folder).
  if (c.inWindow) return { tone: 'ask', text: `${name} is waiting for you in its window`, faded: 'the first time in a folder, it asks whether you trust it', show: true };
  // Running, but not watching the board, and silent while something waits on it (server/conductor.ps1): it has
  // stopped mid-way, or it's asking in its own window. Its window, or a restart, is the way out.
  if (c.stalled) return { tone: 'ask', text: `${name} hasn't answered for ${c.quiet} minutes`, faded: `${c.waiting} thing${c.waiting === 1 ? ' is' : 's are'} waiting on it`, show: true, restart: true };
  if (c.state === 'busy') return { tone: 'busy', text: name, doing: c.doing || 'Working' };
  if (c.state === 'listening') return { tone: 'on', text: `${name} is listening` };
  if (lead) return { tone: 'none', text: 'Its agent is not running', faded: lead.waiting || lead.handoff ? '' : 'Sending it a message starts it' };
  return { tone: 'none', text: 'No conductor', faded: 'Sending a message starts one' };
}

function renderBar() {
  const s = statusOf(), c = conductor();
  const cutOff = !active && state.tasks.some(t => t.status === 'working');
  const waiting = !active && state.tasks.some(t => t.pending);
  const start = c.state === 'none' && (waiting || cutOff) && state.agent?.installed
    ? html`<button class="btn-sm go cond-start" data-start-conductor title=${cutOff ? 'No conductor is running, and work was cut off: this carries it on' : 'No conductor is running for this game'}>${cutOff ? 'Carry on with' : 'Start'} ${agentName()}</button>` : nothing;
  render(html`<span class="cond-stat t-${s.tone}"><i class="cond-dot"></i><span class="cond-text"><b>${s.text}</b>${
    s.doing ? html`<span class="cond-doing"> · ${s.doing}</span>` : nothing}${s.faded ? html`<span class="cond-faded"> · ${s.faded}</span>` : nothing
  }</span></span>${start}${
    s.show ? html`<button class="btn-sm cond-start" data-show-window>Show its window</button>` : nothing}${
    s.restart ? html`<button class="btn-sm cond-start${restartArmed ? ' danger confirm' : ''}" data-restart-conductor title="End its session and open a new one, which picks the work up from the board and the lanes">${restartArmed ? 'End its session and start again?' : 'Restart it'}</button>` : nothing}${
    usageNote(c)}`, $('#condBar'));
}

// What the agent's own session has used so far, and the model it's on, when Rocco can read them: small, at the
// end of its line.
function usageNote(c) {
  const u = c.usage, total = u ? (u.in || 0) + (u.out || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) : 0;
  if (!total && !c.model) return nothing;
  const model = c.model || u?.model || '';
  const size = total >= 1e6 ? `${(total / 1e6).toFixed(1)}M` : total >= 1e3 ? `${Math.round(total / 1e3)}k` : String(total);
  return html`<span class="cond-used" title=${total ? `Its session so far: ${u.messages} messages, ${Math.round(u.out || 0).toLocaleString()} tokens written, ${Math.round(u.cacheRead || 0).toLocaleString()} read from the cache` : 'The model it was opened on'}>${[model, total ? `${size} tokens` : ''].filter(Boolean).join(' · ')}</span>`;
}

// Restart asks once more for a few seconds: it ends the agent's session, and its workers with it.
let restartArmed = 0;
function restartConductor(button) {
  if (!restartArmed) { restartArmed = setTimeout(() => { restartArmed = 0; renderBar(); }, 4000); renderBar(); return; }
  clearTimeout(restartArmed);
  restartArmed = 0;
  renderBar();
  const thread = active;
  once('conductor:restart', async () => {
    try {
      const r = await api.restartConductor(thread);
      await refresh();
      toast(r.agent ? `${r.agent} started again, on what's on the board` : "Its session is ended. No agent could be opened in its place", r.agent ? 'var(--claude)' : 'var(--amber)');
    } catch (err) { toast(`Couldn't restart it: ${err.message}`, 'var(--red)'); }
  }, button);
}

async function showWindow(id = active) {
  try { const r = await api.showConductor(id); if (!r.shown) toast("Couldn't find its window. It's in your taskbar", 'var(--amber)'); } catch (err) { toast(err.message, 'var(--red)'); }
}

// ---- The chat ----

// What the user did to a card, as a line: "You approved", then the card.
const DID = {
  approve: 'approved', 'approve-plan': 'approved the plan for', queue: 'queued', remove: 'deleted', undo: 'took back what you did to',
  'got-it': 'closed', pause: 'paused', resume: 'resumed', restart: 'started again', assign: 'picked a lane or worker for',
  promote: 'gave an agent of its own to', 'make-task': 'made a task of', reopen: 'sent back', followup: 'added to', answer: 'answered',
  revise: 'asked for changes to', 'ask-more': 'asked more about',
};
// What the user typed about a card, above their words.
const SAID = { reopen: 'Sent back', followup: 'Added', answer: 'Answered', revise: 'Asked for changes', 'ask-more': 'Asked more', restart: 'Started again', 'make-task': 'Made a task' };

// What you write sits on the right in a bubble, as in any chat app; what Rocco says and does runs down the left, so
// its work never reads as yours.
const yours = (body, foot, shots = []) => html`<div class="h-you">${
  shots.length ? html`<div class="h-shots" data-pic-set>${pics(shots)}</div>` : nothing}${
  body ? html`<div class="h-bubble">${body}</div>` : nothing}${foot ? html`<div class="h-you-foot">${foot}</div>` : nothing}</div>`;

// The screenshots that went with what the user sent: a note's (kept on the message), or a send-back's, which names
// them in its text ("Screenshots: shot-2.png, shot-3.png"); that line comes out of the words shown. A note sent before
// they were kept on the message shows its card's.
const SHOTS_LINE = /^Screenshots: (.+)$/m;
function sentShots(e) {
  const text = String(e.text || '');
  const named = [...(e.shots || []), ...(text.match(SHOTS_LINE)?.[1].split(',').map(s => s.trim()) || [])].filter(Boolean);
  const urls = named.map(n => /^(data|blob|https?):/.test(n) ? n : api.file(e.task, n));
  if (!urls.length && (e.act === 'note' || e.act === 'question') && e.task) urls.push(...(byId(e.task)?.shots || []));
  return { text: text.replace(SHOTS_LINE, '').trim(), shots: urls };
}

// A card, small, where the chat mentions it: its name and where it is now. It opens the card's own conversation.
// typed: the words the card came from. Until Rocco names the card, its title is just those words again, so only
// where it is shows ("Up next"), not the same text twice.
function taskChip(id, title = '', typed = '') {
  const t = byId(id), s = t && STATUS[t.status];
  const where = !t ? '' : t.kind === 'plan' ? (t.status === 'inbox' ? 'Plan to approve' : t.status === 'done' ? 'Built' : 'Feature')
    : t.kind === 'question' ? (t.status === 'queued' ? 'Asked' : 'Answered') : t.kind === 'errand' ? 'Done' : s?.[0] || '';
  const name = t?.title || title || id;
  const flat = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const echo = !!typed && flat(typed).startsWith(flat(name).replace(/\.\.\.$/, ''));
  if (echo && !where) return nothing; // a card that's gone: nothing left to say about it
  return html`<button class="tchip" data-open-task=${id} style="--c:${s ? s[1] : 'var(--gray)'}" title="Open ${id}"><i class="sdot"></i>${
    echo ? nothing : html`<span class="tchip-name">${name}</span>`}${where ? html`<span class="tchip-state">${where}</span>` : nothing}</button>`;
}

// "Reply" on a line about a card: what's typed next goes to that card (sent back if it's waiting to be tested).
const replyTo = id => { const t = byId(id); return t && !['done', 'removed', 'inbox'].includes(t.status) && t.kind !== 'plan' ? html`<button class="linkish h-reply" data-reply-card=${id}>Reply</button>` : nothing; };

function row(e, all, prev = '') {
  const at = html`<span class="h-at">${hhmm(e.at)}</span>`;
  const task = e.task || undefined; // a row about a task opens it
  switch (e.kind) {
    case 'said': {
      const long = (String(e.text || '').length > 900 || String(e.text || '').split('\n').length > 18) && !expanded.has(e.id);
      return html`<div class="h-msg them"><div class="h-body"><div class="h-head">${e.re && task !== prev ? html`<span class="h-re" data-open-task=${ifDefined(task)}>re: ${e.re}</span>` : nothing}${at}<button class="linkish h-reply" data-reply=${e.id}>Reply</button></div><div class="h-text${long ? ' clamp' : ''}">${prose(e.text)}</div>${
        long ? html`<button class="linkish h-more" data-more=${e.id}>Show all</button>` : nothing}</div></div>`;
    }
    case 'message':
      // Rocco's own word to the agent (Fix lanes): a line, in the words meant for the user.
      if (e.who === 'rocco') return html`<div class="h-event"><span class="h-dot"></span><span class="h-line">${e.line || e.text}</span>${at}</div>`;
      return yours(e.text, html`${e.via === 'terminal' ? html`<span>in its window</span>` : nothing}${at}`);
    case 'sent': {
      // What the user typed (a note, a question, why a card went back) reads as their message, with the card under it.
      const typed = e.act === 'note' || e.act === 'question';
      const { text, shots } = sentShots(e);
      if (typed || (SAID[e.act] && e.text)) return yours(text || (shots.length ? '' : e.title || ''), html`${typed ? nothing : html`<span>${SAID[e.act]}</span>`}${task ? taskChip(task, e.title, e.text || e.title) : nothing}${at}`, shots);
      // Something you did to a card, with no words: a small line on your side.
      return html`<div class="h-you mine"><div class="h-you-foot"><span>You ${DID[e.act] || e.act}</span>${task ? taskChip(task, e.title) : html`<span>${e.title || ''}</span>`}${at}</div></div>`;
    }
    case 'asked': {
      const reply = all.find(x => x.kind === 'answered' && x.to === e.id);
      // Still open: it's asked under the chat, with its own answer box. Here, just a line that says so.
      if (!reply) return html`<div class="h-event asking"><span class="h-dot"></span><span class="h-line">Waiting for your answer below</span>${at}</div>`;
      return html`<div class="h-msg them"><div class="h-body"><div class="h-head"><span class="h-act ask">Asked</span>${at}</div>${e.questions.map((q, i) => {
        // The picture of the option picked, when it had one.
        const pic = reply && (q.options || []).find(o => o.image && o.label === reply.answers?.[i])?.image;
        return html`<div class="h-qq">${proseLine(q.text)}</div><div class="h-qa${reply ? '' : ' open'}">${pic ? html`<img class="h-pic" src=${fileOf(pic)} alt="" loading="lazy">` : nothing}${reply ? reply.answers?.[i] ?? '' : 'Waiting for your answer, below'}</div>`;
      })}</div></div>`;
    }
    case 'permission': {
      const d = all.find(x => x.kind === 'decided' && x.to === e.id), gone = all.find(x => x.kind === 'expired' && x.to === e.id);
      const verdict = d ? (d.allow ? 'Allowed' : 'Denied') : gone ? 'Asked in its window' : 'Waiting for your OK';
      return html`<div class="h-event perm"><span class="h-dot"></span><span class="h-line">${e.worker ? 'A worker' : 'Rocco'} asked to: ${e.text}</span><span class="h-verdict v-${d ? (d.allow ? 'yes' : 'no') : 'wait'}">${verdict}</span>${at}</div>`;
    }
    case 'event': {
      // A line about a card, in the color of where the card is now.
      const t = task && byId(task), s = t && STATUS[t.status];
      return html`<div class="h-event${task ? ' of-card' : ''}" data-open-task=${ifDefined(task)} style=${ifDefined(s ? `--c:${s[1]}` : undefined)}><span class="h-dot"></span><span class="h-line">${e.text}</span>${task ? replyTo(task) : nothing}${at}</div>`;
    }
  }
  return nothing;
}

// What a step did, from how the server words it (server/thread.ps1 Get-ToolSummary): the kind of action, and what it
// was done to. A command is said by its description, so anything not worded as a tool is a command.
/** @type {[RegExp, string, (what: string) => string, (n: number, what: string) => string][]} */
const ACTIONS = [
  [/^Reading a web page$|^Reading \S+\.(?:com|org|net|io|dev|gg|ai)$/, 'web', () => 'read a web page', n => `read ${n} web pages`],
  [/^Reading (.+)$/, 'read', x => `read ${x}`, n => `read ${n} files`],
  [/^Editing (.+)$/, 'edit', x => `edited ${x}`, n => `edited ${n} files`],
  [/^Writing (.+)$/, 'write', x => `wrote ${x}`, n => `wrote ${n} files`],
  [/^Searching for /, 'search', () => 'searched code', () => 'searched code'],
  [/^Looking up /, 'lookup', () => 'searched the web', () => 'searched the web'],
  [/^Starting a worker/, 'worker', () => 'started a worker', n => `started ${n} workers`],
  [/^Using Studio/, 'studio', () => 'used Studio', () => 'used Studio'],
  [/^Using ([^:]+):/, 'mcp', x => `used ${x}`, (_, x) => `used ${x}`],
  [/^/, 'run', () => 'ran a command', n => `ran ${n} commands`],
];
// Claude Code's way of saying a run of steps: "Read 3 files, edited TradeWindow.luau, and 2 more actions".
// The first three kinds in the order they came, then how many steps are left over.
function stepsLine(texts) {
  const kinds = new Map(); // key -> { one, many, n, what }
  for (const text of texts) {
    for (const [re, kind, one, many] of ACTIONS) {
      const m = re.exec(text);
      if (!m) continue;
      const key = kind === 'mcp' ? `mcp:${m[1]}` : kind;
      const k = kinds.get(key) || { one, many, n: 0, what: m[1] || '' };
      k.n++;
      kinds.set(key, k);
      break;
    }
  }
  const all = [...kinds.values()];
  const parts = all.slice(0, 3).map(k => k.n === 1 ? k.one(k.what) : k.many(k.n, k.what));
  const rest = all.slice(3).reduce((n, k) => n + k.n, 0);
  if (rest) parts.push(`${rest} more action${rest === 1 ? '' : 's'}`);
  const last = parts.pop() || '';
  const line = !parts.length ? last : parts.length === 1 ? `${parts[0]} and ${last}` : `${parts.join(', ')}, and ${last}`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// Steps between two messages fold into one line that says what they did, and opens to the list.
function stepGroup(group) {
  const key = group[0].at, open = unfolded.has(key);
  return html`<div class="h-steps${open ? ' open' : ''}"><button class="h-steps-head" data-steps=${key} title="${group.length} step${group.length === 1 ? '' : 's'}"><span class="h-steps-last">${stepsLine(group.map(s => s.text))}</span>${icon.chev}</button>${
    open ? html`<ul>${group.map(s => html`<li><span class="h-at">${hhmm(s.at)}</span>${s.text}</li>`)}</ul>` : nothing}</div>`;
}

function historyView() {
  const v = view(), history = v.history;
  const failed = v.loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't load the chat: ${v.loadError}</span><button class="btn-sm" data-history-retry>Retry</button></div>` : nothing;
  if (!history) return v.loadError ? failed : html`<div class="h-empty"><span class="spin"></span>Loading</div>`;
  const items = history.items.filter(e => !['answered', 'decided', 'expired', 'handled'].includes(e.kind));
  if (!items.length && !history.steps.length) {
    return html`<div class="h-empty">${active ? "Nothing here yet. What this feature's agent does and says shows here, and what you type goes straight to it."
      : 'Tell Rocco what you noticed, ask it something, or describe a feature. What it does and says shows here, with a line for each card as it moves.'}</div>${failed}`;
  }
  // What the agent said just before a question that's still open is that question's reasons: it goes with the
  // question, under the chat ("Why"), so the chat doesn't say it twice. Once it's answered, the chat has it again.
  const answeredTo = new Set(history.items.filter(x => x.kind === 'answered').map(x => x.to));
  const hidden = new Set();
  whyOf.clear();
  items.forEach((e, i) => {
    if (e.kind !== 'asked' || answeredTo.has(e.id)) return;
    const before = items.slice(0, i).reverse().find(x => !isIdle(x));
    if (before?.kind === 'said' && Date.parse(e.at) - Date.parse(before.at) < 10 * 60e3) { hidden.add(before.id); whyOf.set(e.id, before.text); }
  });
  // A card that came from something you typed shows where it is under your message, so "Started: ..." about it
  // says nothing new. The lines that need you (ready to test, an answer) stay.
  const yoursTasks = new Set(items.filter(e => e.kind === 'sent' && (e.act === 'note' || e.act === 'question') && e.task).map(e => e.task));
  for (const e of items) if (e.kind === 'event' && e.task && yoursTasks.has(e.task) && /^Started\b/.test(e.text || '')) hidden.add(e.id);
  const rows = [...items.filter(e => !hidden.has(e.id)).map(e => ({ at: e.at, e })), ...history.steps.map(s => ({ at: s.at, s }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const out = [];
  let prev = ''; // the card the last line was about: a message about it right after doesn't name it again
  let group = [], day = '', idle = null; // idle: the run of check-ins being read, and the steps since its last one
  let marked = !v.since || !rows.some(r => String(r.at) <= v.since); // "new" is marked once, and never above everything
  const flushSteps = () => { if (group.length) { out.push(stepGroup(group)); group = []; } };
  // Check-ins with nothing new are Rocco's own bookkeeping: they aren't shown, nor the steps between them.
  const flushIdle = () => {
    if (!idle) return;
    group = idle.after; // what it did after its last check-in belongs to what comes next
    idle = null;
  };
  for (const r of rows) {
    const d = new Date(r.at).toDateString();
    if (d !== day) {
      flushIdle();
      flushSteps();
      day = d;
      out.push(html`<div class="h-day"><span>${d === new Date().toDateString() ? 'Today' : new Date(r.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span></div>`);
    }
    // The first thing from the agent since the thread was last looked at.
    if (!marked && String(r.at) > v.since && r.e && r.e.who !== 'you' && !isIdle(r.e)) {
      flushIdle();
      flushSteps();
      marked = true;
      out.push(html`<div class="h-new" id="chatNew"><span>New since you were last here</span></div>`);
    }
    if (r.s) { (idle ? idle.after : group).push(r.s); continue; }
    if (isIdle(r.e)) {
      // The steps between two check-ins are the checking itself: they fold away with them.
      if (idle) { idle.lines.push(r.e); idle.after = []; } else { flushSteps(); idle = { lines: [r.e], after: [] }; }
      continue;
    }
    flushIdle();
    flushSteps();
    out.push(row(r.e, history.items, prev));
    prev = r.e.task || '';
  }
  flushIdle();
  // The steps it's still taking are the live line's while it works: they fold into the chat once it's done.
  if (conductor().state !== 'busy') flushSteps();
  // At the end: what the agent is doing now, kept current every second (liveView).
  return html`${out}${failed}<div class="h-live" id="chatLive"></div>`;
}

// ---- What it's doing right now, at the end of the chat ----
// "··· Reading CarEntry.luau, editing CarEntry.luau, using Studio … 1m 27s": while the agent is at work, its last few
// steps in a few words, and how long it has been at it since it last said something or you last wrote.

const lower = s => s ? s[0].toLowerCase() + s.slice(1) : s;
const took = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

function liveView() {
  const c = conductor(), history = view().history;
  if (c.state !== 'busy' || !history || openAsks().length || openPermissions().length) return nothing;
  // Since the last thing said, by either of you.
  const since = history.items.filter(e => e.who === 'you' || e.kind === 'said').reduce((a, e) => (String(e.at) > a ? String(e.at) : a), '');
  const steps = history.steps.filter(s => String(s.at) > since);
  const names = [...new Set(steps.map(s => s.text).filter(Boolean).reverse())].slice(0, 3).reverse();
  if (!names.length && c.doing) names.push(c.doing);
  const from = Date.parse(steps[0]?.at || since) || Date.now();
  return html`<span class="live-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="live-text">${names.length ? names.map((n, i) => i ? lower(n) : n).join(', ') : 'Working'} …</span><span class="live-time">${took(Date.now() - from)}</span>`;
}

function renderLive() {
  const box = document.getElementById('chatLive');
  if (!box) return;
  const list = $('#condList'), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  render(liveView(), box);
  box.classList.toggle('on', !!box.childElementCount);
  if (atEnd) list.scrollTop = list.scrollHeight;
}

let lastState = ''; // the agent's state at the last draw (renderConductor)
let toEnd = false; // the next draw ends at the chat's end, whatever was scrolled (the user just sent something)
function stickToEnd() { toEnd = true; renderHistory(); }

// fresh: the thread was just opened. It starts at what's new, or at its end.
function renderHistory(fresh = false) {
  const list = $('#condList');
  const atEnd = toEnd || fresh || list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  toEnd = false;
  render(historyView(), list);
  renderLive();
  const mark = fresh && list.querySelector('#chatNew');
  if (mark) mark.scrollIntoView({ block: 'start' });
  else if (atEnd) list.scrollTop = list.scrollHeight;
  if (view().history) markSeen(active);
}

async function loadHistory() {
  const id = active, v = view(id);
  if (v.loading) return;
  v.loading = true;
  try {
    const r = await api.conductorThread(v.history?.stamp || '', id);
    const hadError = !!v.loadError, wasEmpty = !v.history;
    v.loadError = '';
    if (!r.same) v.history = r;
    if (id === active && (!r.same || hadError)) { renderHistory(wasEmpty); renderHead(); renderAsks(); }
  } catch (e) {
    if (v.loadError !== e.message) { v.loadError = e.message; if (id === active) renderHistory(); }
  }
  v.loading = false;
}

// ---- Keeping it current ----

// New questions and requests get a toast and a desktop notification, whichever thread they're in; what was already
// open when Rocco loaded doesn't.
function announce() {
  if (!('stamp' in (state.meta.conductor || {}))) return; // not loaded yet
  for (const id of ['', ...leads().map(l => l.id)]) {
    const lead = id && leadOf(id);
    for (const e of agentOf(id).open || []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (first) continue;
      const who = lead ? `${lead.title}: its agent` : 'Rocco';
      const message = e.kind === 'permission' ? `${who} wants your OK: ${e.text}` : `${who} asks: ${e.questions?.[0]?.text || ''}`;
      const show = () => { go('workboard'); openThread(id); $('#condAsks').scrollIntoView({ block: 'center' }); };
      // The corner says only that it asks, and about what: the question itself is on the page.
      const topic = e.questions?.[0]?.header;
      const short = e.kind === 'permission' ? message : topic ? `${who} asks about ${topic}` : `${who} has a question for you`;
      toast(short, 'var(--amber)', id !== active ? { label: 'Show', run: show } : null);
      notify('Rocco', message, show);
    }
    // Something only its own window can answer: say where, and bring that window up from the notification.
    const c = agentOf(id), late = (c.elsewhere || []).at(-1);
    for (const w of [c.windowAsk, late].filter(Boolean)) {
      const key = `window:${id}:${w.id || w.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (first) continue;
      const who = lead ? `${lead.title}: its agent` : 'Rocco';
      const message = `${who} is waiting for you in its window${lead?.lane ? ` (lane ${lead.lane})` : ''}: ${w.text}. Rocco can't answer this one: answer it there.`;
      const show = () => { go('workboard'); openThread(id); showWindow(id); };
      toast(message, 'var(--amber)', { label: 'Show its window', run: show });
      notify('Rocco', message, show);
    }
  }
  first = false;
}

function renderAll() {
  renderTabs();
  renderHead();
  renderBar();
  renderAsks();
  renderNoteMode();
  renderLive();
}

export function renderConductor() {
  // A thread whose feature is finished or deleted is gone: back to the conductor's.
  if (active && !leadOf(active) && 'stamp' in (state.meta.conductor || {})) { active = ''; view().since = seenAt(''); emit('thread'); }
  // A question that's gone (answered elsewhere) leaves nothing behind. Not before its state has loaded, or what was
  // being typed when the page reloaded would go too.
  if ('stamp' in (state.meta.conductor || {})) {
    const ids = ['', ...leads().map(l => l.id)].flatMap(id => (agentOf(id).open || []).filter(e => e.kind === 'asked').map(e => e.id));
    for (const kind of ASK_DRAFTS) draft.prune(kind, ids);
  }
  // A card the note box was for that's gone or finished: a plain note again.
  if (mode?.kind === 'card') { const t = byId(mode.task); if (state.tasks.length && (!t || ['done', 'removed'].includes(t.status))) mode = null; }
  announce();
  renderAll();
  const v = view();
  if (v.history?.stamp !== conductor().stamp || v.loadError || !v.history) loadHistory();
  // It stopped or started working: its last steps move between the live line and the chat.
  else if (lastState !== conductor().state) renderHistory();
  lastState = conductor().state;
}

// A different project: its own threads, and its own reply in progress.
export function resetConductor() {
  threads.clear();
  active = '';
  view().since = seenAt('');
  mode = savedMode();
  decisionsOpen = false;
  unfolded.clear();
  expanded.clear();
  seen.clear();
  answering.clear();
  deciding.clear();
  first = true;
}

export function initConductor() {
  resetConductor();
  // The live line's clock ticks while the agent works.
  setInterval(() => { if (conductor().state === 'busy') renderLive(); }, 1000);
  on('conductor', renderConductor);
  on('project', () => renderHistory(true));
  on('prose', () => { renderAsks(); renderHistory(); renderHead(); });
  // The cards changed: the chat's lines about them follow (where each is now), and so do the tabs' counts.
  on('tasks', () => { renderTabs(); renderHead(); renderHistory(); renderNoteMode(); });
  on('me', () => renderHistory());
  on('note-sent', stickToEnd); // what the user just sent is at the chat's end: it's shown
  $('#composer').addEventListener('click', e => { if (e.target.closest('[data-leave-mode]')) { leaveMode(); $('#noteText').focus(); } });
  $('#threadTabs').addEventListener('click', e => { const tab = e.target.closest('[data-thread]'); if (tab) openThread(tab.dataset.thread); });
  $('#threadHead').addEventListener('click', e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-decisions]')) { decisionsOpen = !decisionsOpen; renderHead(); }
    else if (hit('[data-open-card]')) emit('open-card', hit('[data-open-card]').dataset.openCard);
    else if (hit('[data-open-task]')) emit('open-task', hit('[data-open-task]').dataset.openTask);
  });
  $('#condBar').addEventListener('click', e => {
    if (e.target.closest('[data-show-window]')) showWindow();
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
      const allow = !!hit('[data-allow]'), id = (hit('[data-allow]') || hit('[data-deny]')).dataset[allow ? 'allow' : 'deny'], thread = active;
      if (deciding.has(id)) return;
      deciding.add(id);
      renderAsks();
      try { await api.conductorPermission(id, allow, thread); await refresh(); toast(allow ? 'Allowed' : `Denied. Rocco hears you said no`, allow ? 'var(--green)' : 'var(--gray)'); }
      catch (err) { toast(err.message, 'var(--red)'); await refresh(); }
      deciding.delete(id);
      renderAsks();
    } else if (hit('[data-show-window]')) showWindow();
  });
  $('#condList').addEventListener('click', e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-pic-src]')) openPicsFrom(hit('[data-pic-src]'), null);
    else if (hit('[data-steps]')) {
      const key = hit('[data-steps]').dataset.steps;
      if (unfolded.has(key)) unfolded.delete(key); else unfolded.add(key);
      renderHistory();
    } else if (hit('[data-reply]')) {
      setMode({ kind: 'reply', to: hit('[data-reply]').dataset.reply });
      $('#noteText').focus();
    } else if (hit('[data-reply-card]')) {
      // What's typed next is filed into this card: sent back if it's waiting to be tested, added to it otherwise.
      setMode({ kind: 'card', task: hit('[data-reply-card]').dataset.replyCard });
      $('#noteText').focus();
    } else if (hit('[data-more]')) {
      expanded.add(hit('[data-more]').dataset.more);
      renderHistory();
    } else if (hit('[data-history-retry]')) loadHistory();
    else if (hit('[data-open-task]') && !hit('a')) emit('open-task', hit('[data-open-task]').dataset.openTask);
  });
  // The chat's room changes (a question opens under it, the note box grows): read at its end, it stays at its end.
  const list = $('#condList');
  let pinned = true;
  list.addEventListener('scroll', () => { pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 60; }, { passive: true });
  new ResizeObserver(() => { if (pinned) list.scrollTop = list.scrollHeight; }).observe(list);
  // Looked at again after being away: what came in meanwhile is marked, once.
  document.addEventListener('visibilitychange', () => { if (document.hidden) view().since = new Date().toISOString(); else renderHistory(); });
}
