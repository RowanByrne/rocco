// The conductor in Rocco (README.md "The conductor in Rocco"): a status line above the note box that says what it's
// doing; its questions and permission requests above the note box, each question with its pictures and its own answer
// box; and its history, which slides open from the status line, everything below moving down to make room. The data
// is its thread (server/thread.ps1).
import { state, on, emit } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { hhmm } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { notify } from '../notify.js';
import { agentName } from '../agent.js';
import { go } from '../router.js';
import { prose, proseLine } from '../prose.js';
import { picsHTML, picOptionHTML, openPicsFrom } from '../ui/pics.js';

let shown = false;           // the history is open
let history = null;          // { stamp, items, steps }
let loading = false;
let mode = null;             // what the note box sends: { kind: 'reply', to }, else a note
let shownAsks = '';          // what the questions above the note box show now, so an unchanged one isn't redrawn
const typed = new Map();     // question id -> what the user is typing in its answer box, kept across redraws
const picks = new Map();     // question id -> answers picked so far, one per question
const unfolded = new Set();  // step groups the user opened, by their first step's time
const seen = new Set();      // open questions and requests already announced
let first = true;

const SKIP = "No preference: it's your call.";
const conductor = () => state.meta.conductor || { state: 'none' };
const opened = () => (conductor().open || []);
const openAsks = () => opened().filter(e => e.kind === 'asked');
const openPermissions = () => opened().filter(e => e.kind === 'permission');
const firstLine = text => String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';

// ---- The note box: a note, or a reply to one of the conductor's messages ----
// Its questions aren't answered here: each has its own answer box, on the question.

export function noteMode() {
  return mode?.kind === 'reply' ? { kind: 'reply', label: `Replying to Rocco`, placeholder: `Reply to Rocco` } : null;
}

// Back to a plain note (the chip's ×, or picking a note type).
export function leaveMode() {
  mode = null;
  renderNoteMode();
}

// What the user typed, sent in the note box's mode. Returns false when it's a plain note.
export async function sendInMode(text) {
  if (!noteMode()) return false;
  const to = mode.to;
  mode = null;
  renderNoteMode();
  try {
    const r = await api.conductorMessage(text, to);
    await refresh();
    toast(`Sent to Rocco${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--claude)');
  } catch (e) { toast(`Couldn't send it: ${e.message}`, 'var(--red)'); throw e; }
  return true;
}

function renderNoteMode() {
  const m = noteMode(), box = $('#noteMode');
  box.hidden = !m;
  box.innerHTML = m ? `<span class="nm-label">${icon.send}${esc(m.label)}</span>${m.detail ? `<span class="nm-detail">${esc(m.detail)}</span>` : ''}`
    + `<button type="button" class="nm-x" data-leave-mode title="Write a note instead" aria-label="Write a note instead">×</button>` : '';
  $('#composer').classList.toggle('to-conductor', !!m);
  emit('note-mode');
}

// ---- Answering its questions ----

// One answer per question: a picked option (several, for a multi-select), the user's words, or "your call".
// Returns false when it couldn't be sent.
async function answer(id, given) {
  const ask = openAsks().find(e => e.id === id);
  if (!ask) return false;
  const got = [...(picks.get(id) || [])];
  if (given) got.push(given);
  multi.delete(id);
  if (got.length < ask.questions.length) { picks.set(id, got); renderAsks(); focusAnswer(id); return true; }
  picks.delete(id);
  const text = ask.questions.map((q, i) => `${q.text.trim()} ${got[i]}`).join('\n');
  let ok = true;
  try {
    const r = await api.conductorAnswer(id, got, text);
    await refresh();
    toast(`Answer sent to Rocco${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--amber)');
  } catch (e) { ok = false; picks.set(id, got.slice(0, -1)); toast(`Couldn't send the answer: ${e.message}`, 'var(--red)'); }
  renderAll();
  return ok;
}

// The question's answer box: what's typed, with what's ticked on a multi-select. Enter or its send button.
async function sendTyped(id) {
  const words = (typed.get(id) || '').trim(), ticked = multi.get(id) || [];
  const value = [ticked.join(', '), words].filter(Boolean).join('. ');
  if (!value) { focusAnswer(id); return; }
  typed.delete(id);
  if (!await answer(id, value)) { typed.set(id, words); renderAsks(true); }
}

const multi = new Map(); // question id -> labels ticked on a multi-select question
const sendIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>';

function askHTML(ask) {
  const got = picks.get(ask.id) || [], i = got.length, q = ask.questions[i];
  if (!q) return `<div class="c-ask done"><span class="spin"></span>Sending your answer</div>`;
  const ticked = multi.get(ask.id) || [];
  const attrs = o => `data-c-pick="${esc(o.label)}" data-ask="${ask.id}"`;
  const opt = o => o.image ? picOptionHTML(o, api.conductorFile(o.image), attrs(o), ticked.includes(o.label))
    : `<button class="opt${ticked.includes(o.label) ? ' on' : ''}" ${attrs(o)}${o.detail ? ` title="${esc(o.detail)}"` : ''}><span>${esc(o.label)}</span></button>`;
  const pictured = (q.options || []).some(o => o.image);
  return `<div class="c-ask${ask.expired ? ' late' : ''}" data-ask-card="${ask.id}">`
    + `<div class="c-ask-head"><span class="c-who">Rocco asks</span>${q.header ? `<span class="c-tag">${esc(q.header)}</span>` : ''}`
    + `${ask.questions.length > 1 ? `<span class="ask-n">${i + 1} of ${ask.questions.length}</span>` : ''}<span class="c-at">${hhmm(ask.at)}</span></div>`
    + `<div class="c-ask-q">${proseLine(q.text)}</div>`
    + `<div data-pic-set data-ask="${ask.id}">${picsHTML((q.images || []).map(api.conductorFile))}`
    + (q.options?.length ? `<div class="opts${pictured ? ' with-pics' : ''}">${q.options.map(opt).join('')}</div>` : '') + '</div>'
    + `<div class="c-reply"><textarea data-c-input="${ask.id}" rows="1" placeholder="${q.options?.length ? (q.multi ? 'Tick some, or type your answer' : 'Or type your answer') : 'Type your answer'}" aria-label="Your answer to Rocco"></textarea>`
    + `<button type="button" class="send" data-c-send="${ask.id}" title="Send your answer" aria-label="Send your answer">${sendIcon}</button></div>`
    + `<div class="ask-foot">${q.multi ? `<button class="btn-sm go" data-c-multi="${ask.id}"${ticked.length ? '' : ' disabled'}>Send these</button>` : ''}`
    + `<button class="linkish" data-c-skip="${ask.id}">Let Rocco decide</button>`
    + `${i ? `<button class="linkish" data-c-back="${ask.id}">Back</button>` : ''}</div></div>`;
}

const grow = box => { box.style.height = 'auto'; box.style.height = box.scrollHeight + 'px'; };

function focusAnswer(id) {
  const box = $('#condAsks').querySelector(`[data-c-input="${id}"]`);
  if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

function permissionHTML(p) {
  return `<div class="c-perm" data-perm-card="${p.id}"><div class="c-ask-head"><span class="c-who">${p.worker ? 'A worker' : 'Rocco'} wants your OK</span><span class="c-at">${hhmm(p.at)}</span></div>`
    + `<div class="c-ask-q">${esc(p.text)}</div>${p.detail && p.detail !== p.text ? `<pre class="c-detail">${esc(p.detail)}</pre>` : ''}`
    + `<div class="c-perm-btns"><button class="btn-sm go" data-allow="${p.id}">${icon.check}Allow</button><button class="btn-sm danger" data-deny="${p.id}">Deny</button></div></div>`;
}

// A request its hook stopped waiting on: the agent's own window asks now.
const elsewhereHTML = list => list.length ? `<div class="c-perm late"><div class="c-ask-head"><span class="c-who">Rocco is waiting for your OK in its window</span></div>`
  + `<div class="c-ask-q">${esc(list.at(-1).text)}</div><div class="c-perm-btns"><button class="btn-sm" data-show-window>Show its window</button></div></div>` : '';

// Redrawn only when what it shows changed (the board refreshes every few seconds), keeping what's typed in each
// answer box and where the caret was.
function renderAsks(force = false) {
  const box = $('#condAsks');
  const html = openPermissions().map(permissionHTML).join('') + elsewhereHTML(conductor().elsewhere || []) + openAsks().map(askHTML).join('');
  if (html === shownAsks && !force) return;
  shownAsks = html;
  const active = document.activeElement?.closest?.('[data-c-input]');
  const caret = active ? { id: active.dataset.cInput, start: active.selectionStart, end: active.selectionEnd } : null;
  box.innerHTML = html;
  for (const input of box.querySelectorAll('[data-c-input]')) { input.value = typed.get(input.dataset.cInput) || ''; if (input.value) grow(input); }
  const again = caret && box.querySelector(`[data-c-input="${caret.id}"]`);
  if (again) { again.focus(); again.setSelectionRange(caret.start, caret.end); }
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
  if (c.state === 'busy') return { tone: 'busy', text: name, doing: c.doing || 'Working' };
  if (c.state === 'listening') {
    const last = c.last && !c.last.replied && Date.now() - new Date(c.last.at) < 12 * 3600e3 ? firstLine(c.last.text) : '';
    return { tone: 'on', text: `${name} is listening`, faded: last };
  }
  return { tone: 'none', text: 'No conductor', faded: 'Sending a note starts one' };
}

function renderBar() {
  const s = statusOf(), c = conductor();
  const cutOff = state.tasks.some(t => t.status === 'working');
  const waiting = state.tasks.some(t => t.pending);
  const start = c.state === 'none' && (waiting || cutOff) && state.agent?.installed
    ? `<button class="btn-sm go cond-start" data-start-conductor title="${cutOff ? 'No conductor is running, and work was cut off: this carries it on' : 'No conductor is running for this game'}">${cutOff ? 'Carry on with' : 'Start'} ${esc(agentName())}</button>` : '';
  $('#condBar').innerHTML = `<button class="cond-stat t-${s.tone}" data-cond-toggle aria-expanded="${shown}" title="${shown ? 'Hide' : 'Show'} what Rocco has been doing">`
    + `<i class="cond-dot"></i><span class="cond-text"><b>${esc(s.text)}</b>${s.doing ? `<span class="cond-doing"> · ${esc(s.doing)}</span>` : ''}`
    + `${s.faded ? `<span class="cond-faded"> · ${esc(s.faded)}</span>` : ''}</span>`
    + `<span class="cond-more"><span class="cond-more-label">History</span><span class="cond-chev${shown ? ' up' : ''}">${icon.chev}</span></span></button>${start}`
    + (s.show ? '<button class="btn-sm cond-start" data-show-window>Show its window</button>' : '');
}

async function showWindow() {
  try { const r = await api.showConductor(); if (!r.shown) toast("Couldn't find its window. It's in your taskbar", 'var(--amber)'); } catch (err) { toast(err.message, 'var(--red)'); }
}

// ---- The history ----

const ACT = {
  note: 'Note', question: 'Question', answer: 'Answer', reopen: 'Sent back', followup: 'Follow-up', approve: 'Approved',
  'approve-plan': 'Approved the plan', revise: 'Asked for changes', queue: 'Queued', remove: 'Deleted', undo: 'Took back',
  'got-it': 'Got it', 'ask-more': 'Asked more',
};

function rowHTML(e, all) {
  const at = `<span class="h-at">${hhmm(e.at)}</span>`;
  const taskLink = id => id ? ` data-open-task="${esc(id)}"` : '';
  switch (e.kind) {
    case 'said': {
      const long = String(e.text || '').length > 700 || String(e.text || '').split('\n').length > 14;
      return `<div class="h-msg them"><div class="h-head"><span class="h-who">Rocco</span>${e.re ? `<span class="h-re"${taskLink(e.task)}>re: ${esc(e.re)}</span>` : ''}${at}`
        + `<button class="linkish h-reply" data-reply="${e.id}">Reply</button></div>`
        + `<div class="h-text${long ? ' clamp' : ''}">${prose(e.text)}</div>${long ? '<button class="linkish h-more" data-more>Show all</button>' : ''}</div>`;
    }
    case 'message':
      return `<div class="h-msg you"><div class="h-head">${e.via === 'terminal' ? `<span class="h-re">In Rocco's window</span>` : ''}${at}</div><div class="h-text">${esc(e.text)}</div></div>`;
    case 'sent':
      return `<div class="h-sent"${taskLink(e.task)}><span class="h-act">${esc(ACT[e.act] || e.act)}</span><span class="h-what">${esc(e.text || e.title || '')}</span>${at}</div>`;
    case 'asked': {
      const reply = all.find(x => x.kind === 'answered' && x.to === e.id);
      return `<div class="h-q"><div class="h-head"><span class="h-who">Rocco asked</span>${at}</div>`
        + e.questions.map((q, i) => {
          // The picture of the option picked, when it had one.
          const pic = reply && (q.options || []).find(o => o.image && o.label === reply.answers?.[i])?.image;
          return `<div class="h-qq">${proseLine(q.text)}</div><div class="h-qa${reply ? '' : ' open'}">${pic ? `<img class="h-pic" src="${esc(api.conductorFile(pic))}" alt="" loading="lazy">` : ''}`
            + `${reply ? esc(reply.answers?.[i] ?? '') : 'Waiting for your answer'}</div>`;
        }).join('') + '</div>';
    }
    case 'permission': {
      const d = all.find(x => x.kind === 'decided' && x.to === e.id), gone = all.find(x => x.kind === 'expired' && x.to === e.id);
      const verdict = d ? (d.allow ? 'Allowed' : 'Denied') : gone ? 'Asked in its window' : 'Waiting for your OK';
      return `<div class="h-event perm"><span class="h-dot"></span><span>${e.worker ? 'A worker' : 'Rocco'} asked to: ${esc(e.text)}</span><span class="h-verdict v-${d ? (d.allow ? 'yes' : 'no') : 'wait'}">${verdict}</span>${at}</div>`;
    }
    case 'event':
      return `<div class="h-event"${taskLink(e.task)}><span class="h-dot"></span><span>${esc(e.text)}</span>${at}</div>`;
  }
  return '';
}

// Steps between two messages fold into one line that opens to the list.
function stepsHTML(group) {
  const key = group[0].at, open = unfolded.has(key), last = group.at(-1);
  return `<div class="h-steps${open ? ' open' : ''}"><button class="h-steps-head" data-steps="${esc(key)}">${icon.chev}<span>${group.length} step${group.length === 1 ? '' : 's'}</span>`
    + `<span class="h-steps-last">${esc(last.text)}</span><span class="h-at">${hhmm(group[0].at)}${group.length > 1 ? `–${hhmm(last.at)}` : ''}</span></button>`
    + (open ? `<ul>${group.map(s => `<li><span class="h-at">${hhmm(s.at)}</span>${esc(s.text)}</li>`).join('')}</ul>` : '') + '</div>';
}

function historyHTML() {
  if (!history) return `<div class="h-empty"><span class="spin"></span>Loading</div>`;
  const items = history.items.filter(e => !['answered', 'decided', 'expired', 'handled'].includes(e.kind));
  if (!items.length && !history.steps.length) return `<div class="h-empty">Nothing yet. What Rocco does and says, and what you send it, shows here.</div>`;
  const rows = [...items.map(e => ({ at: e.at, e })), ...history.steps.map(s => ({ at: s.at, s }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let html = '', group = [], day = '';
  const flush = () => { if (group.length) { html += stepsHTML(group); group = []; } };
  for (const r of rows) {
    const d = new Date(r.at).toDateString();
    if (d !== day) {
      flush();
      day = d;
      html += `<div class="h-day">${d === new Date().toDateString() ? 'Today' : new Date(r.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>`;
    }
    if (r.s) { group.push(r.s); continue; }
    flush();
    html += rowHTML(r.e, history.items);
  }
  flush();
  return html;
}

function renderHistory() {
  const list = $('#condList');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = historyHTML();
  if (atBottom) list.scrollTop = list.scrollHeight;
}

async function loadHistory() {
  if (loading || !shown) return;
  loading = true;
  try {
    const r = await api.conductorThread(history?.stamp || '');
    if (!r.same) { history = r; renderHistory(); }
  } catch { /* shows what it had */ }
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
  // A question that's gone (answered elsewhere, or the project changed) leaves nothing behind.
  const ids = new Set(openAsks().map(e => e.id));
  for (const map of [picks, typed, multi]) for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
  announce();
  renderAll();
  if (shown && history?.stamp !== conductor().stamp) loadHistory();
}

// A different project: its own thread.
export function resetConductor() { history = null; mode = null; shownAsks = ''; picks.clear(); typed.clear(); multi.clear(); seen.clear(); first = true; }

export function initConductor() {
  on('conductor', renderConductor);
  $('#composer').addEventListener('click', e => { if (e.target.closest('[data-leave-mode]')) { leaveMode(); $('#noteText').focus(); } });
  $('#condBar').addEventListener('click', async e => {
    if (e.target.closest('[data-cond-toggle]')) toggleHistory();
    else if (e.target.closest('[data-show-window]')) showWindow();
    else if (e.target.closest('[data-start-conductor]')) {
      try {
        const r = await api.openConductor();
        await refresh();
        if (r.agent) toast(`${r.agent} started as the conductor, minimized in your taskbar`, 'var(--claude)');
      } catch (err) { toast(`Couldn't start the conductor: ${err.message}`, 'var(--red)'); }
    }
  });
  // An option picked: on a multi-select it's ticked, otherwise it's the answer (with the last question, sent).
  const pickOption = (id, label) => {
    const ask = openAsks().find(a => a.id === id), q = ask?.questions[(picks.get(id) || []).length];
    if (!q) return;
    if (q.multi) {
      const t = multi.get(id) || [];
      multi.set(id, t.includes(label) ? t.filter(x => x !== label) : [...t, label]);
      renderAsks();
    } else answer(id, label);
  };
  const box = $('#condAsks');
  box.addEventListener('input', e => {
    const input = e.target.closest('[data-c-input]');
    if (input) { typed.set(input.dataset.cInput, input.value); grow(input); }
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
      const id = hit('[data-c-multi]').dataset.cMulti, t = multi.get(id) || [];
      multi.delete(id);
      if (t.length) answer(id, t.join(', '));
    } else if (hit('[data-c-skip]')) answer(hit('[data-c-skip]').dataset.cSkip, SKIP);
    else if (hit('[data-c-back]')) {
      const id = hit('[data-c-back]').dataset.cBack;
      picks.set(id, (picks.get(id) || []).slice(0, -1));
      multi.delete(id);
      renderAsks();
    } else if (hit('[data-allow]') || hit('[data-deny]')) {
      const allow = !!hit('[data-allow]'), id = (hit('[data-allow]') || hit('[data-deny]')).dataset[allow ? 'allow' : 'deny'];
      hit('.c-perm')?.classList.add('sending');
      try { await api.conductorPermission(id, allow); await refresh(); toast(allow ? 'Allowed' : `Denied. Rocco hears you said no`, allow ? 'var(--green)' : 'var(--gray)'); }
      catch (err) { toast(err.message, 'var(--red)'); await refresh(); }
    } else if (hit('[data-show-window]')) showWindow();
  });
  $('#condList').addEventListener('click', e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-steps]')) {
      const key = hit('[data-steps]').dataset.steps;
      if (unfolded.has(key)) unfolded.delete(key); else unfolded.add(key);
      renderHistory();
    } else if (hit('[data-reply]')) {
      mode = { kind: 'reply', to: hit('[data-reply]').dataset.reply };
      renderNoteMode();
      $('#noteText').focus();
    } else if (hit('[data-more]')) {
      const b = hit('[data-more]');
      b.previousElementSibling.classList.remove('clamp');
      b.remove();
    } else if (hit('[data-open-task]') && !hit('a')) emit('open-task', hit('[data-open-task]').dataset.openTask);
  });
}
