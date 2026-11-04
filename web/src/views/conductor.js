// The conductor in Rocco (README.md "The conductor in Rocco"): a status line above the note box that says what it's
// doing; its questions and permission requests, answered above the note box; and its history, which slides open from
// the status line, everything below moving down to make room. The data is its thread (server/thread.ps1).
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

let shown = false;           // the history is open
let history = null;          // { stamp, items, steps }
let loading = false;
let mode = null;             // what the note box sends: { kind: 'answer', id } or { kind: 'reply', to }, else a note
let dismissed = '';          // the question the user switched the note box away from (×)
const picks = new Map();     // question id -> answers picked so far, one per question
const unfolded = new Set();  // step groups the user opened, by their first step's time
const seen = new Set();      // open questions and requests already announced
let first = true;

const SKIP = "No preference: it's your call.";
const conductor = () => state.meta.conductor || { state: 'none' };
// Its short name ("Claude"), from the agent it runs as.
function short() {
  const c = conductor(), list = state.agent?.agents || [];
  return list.find(a => a.name === c.agent)?.short || (c.agent ? c.agent.split(' ')[0] : state.agent?.short) || 'Your agent';
}
const opened = () => (conductor().open || []);
const openAsks = () => opened().filter(e => e.kind === 'asked');
const openPermissions = () => opened().filter(e => e.kind === 'permission');
const firstLine = text => String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';

// ---- The note box: a note, or an answer or reply to the conductor ----

// The question the note box answers: the first open one the user hasn't switched away from.
function currentAsk() { return openAsks().find(e => e.id !== dismissed) || null; }

export function noteMode() {
  if (mode?.kind === 'reply') return { kind: 'reply', label: `Replying to ${short()}`, placeholder: `Reply to ${short()}` };
  const ask = currentAsk();
  if (ask) {
    const i = (picks.get(ask.id) || []).length, q = ask.questions[i] || ask.questions[0];
    return { kind: 'answer', id: ask.id, label: `Answering ${short()}`, detail: q?.text || '', placeholder: 'Your answer, or pick one above' };
  }
  return null;
}

// Back to a plain note (the chip's ×, or picking a note type).
export function leaveMode() {
  const m = noteMode();
  if (m?.kind === 'answer') dismissed = m.id;
  mode = null;
  renderNoteMode();
}

// What the user typed, sent in the note box's mode. Returns false when it's a plain note.
export async function sendInMode(text) {
  const m = noteMode();
  if (!m) return false;
  if (m.kind === 'reply') {
    const to = mode.to;
    mode = null;
    renderNoteMode();
    try {
      const r = await api.conductorMessage(text, to);
      await refresh();
      toast(`Sent to ${short()}${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--claude)');
    } catch (e) { toast(`Couldn't send it: ${e.message}`, 'var(--red)'); throw e; }
    return true;
  }
  await answer(m.id, text);
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
async function answer(id, typed) {
  const ask = openAsks().find(e => e.id === id);
  if (!ask) return;
  const got = [...(picks.get(id) || [])];
  if (typed) got.push(typed);
  if (got.length < ask.questions.length) { picks.set(id, got); renderAsks(); renderNoteMode(); return; }
  picks.delete(id);
  const text = ask.questions.map((q, i) => `${q.text.trim()} ${got[i]}`).join('\n');
  try {
    const r = await api.conductorAnswer(id, got, text);
    await refresh();
    toast(`Answer sent to ${short()}${r.opened ? `. ${r.opened} started, minimized in your taskbar, to pick it up` : ''}`, 'var(--amber)');
  } catch (e) { picks.set(id, got.slice(0, -1)); toast(`Couldn't send the answer: ${e.message}`, 'var(--red)'); }
  renderAll();
}

const multi = new Map(); // question id -> labels ticked on a multi-select question

function askHTML(ask) {
  const got = picks.get(ask.id) || [], i = got.length, q = ask.questions[i];
  if (!q) return `<div class="c-ask done"><span class="spin"></span>Sending your answer</div>`;
  const ticked = multi.get(ask.id) || [];
  const opt = o => `<button class="opt${ticked.includes(o.label) ? ' on' : ''}" data-c-pick="${esc(o.label)}" data-ask="${ask.id}"${o.detail ? ` title="${esc(o.detail)}"` : ''}><span>${esc(o.label)}</span></button>`;
  return `<div class="c-ask${ask.expired ? ' late' : ''}" data-ask-card="${ask.id}">`
    + `<div class="c-ask-head"><span class="c-who">${esc(short())} asks</span>${q.header ? `<span class="c-tag">${esc(q.header)}</span>` : ''}`
    + `${ask.questions.length > 1 ? `<span class="ask-n">${i + 1} of ${ask.questions.length}</span>` : ''}<span class="c-at">${hhmm(ask.at)}</span></div>`
    + `<div class="c-ask-q">${esc(q.text)}</div>`
    + (q.options?.length ? `<div class="opts">${q.options.map(opt).join('')}</div>` : '')
    + `<div class="ask-foot">${q.multi ? `<button class="btn-sm go" data-c-multi="${ask.id}"${ticked.length ? '' : ' disabled'}>Send these</button>` : ''}`
    + `<button class="linkish" data-c-skip="${ask.id}">Let ${esc(short())} decide</button>`
    + `${i ? `<button class="linkish" data-c-back="${ask.id}">Back</button>` : ''}`
    + `<span class="c-hint">${q.options?.length ? 'Or type an answer below' : 'Type your answer below'}</span></div></div>`;
}

function permissionHTML(p) {
  return `<div class="c-perm" data-perm-card="${p.id}"><div class="c-ask-head"><span class="c-who">${p.worker ? 'A worker' : esc(short())} wants your OK</span><span class="c-at">${hhmm(p.at)}</span></div>`
    + `<div class="c-ask-q">${esc(p.text)}</div>${p.detail && p.detail !== p.text ? `<pre class="c-detail">${esc(p.detail)}</pre>` : ''}`
    + `<div class="c-perm-btns"><button class="btn-sm go" data-allow="${p.id}">${icon.check}Allow</button><button class="btn-sm danger" data-deny="${p.id}">Deny</button></div></div>`;
}

// A request its hook stopped waiting on: the agent's own window asks now.
const elsewhereHTML = list => list.length ? `<div class="c-perm late"><div class="c-ask-head"><span class="c-who">${esc(short())} is waiting for your OK in its window</span></div>`
  + `<div class="c-ask-q">${esc(list.at(-1).text)}</div><div class="c-perm-btns"><button class="btn-sm" data-show-window>Show its window</button></div></div>` : '';

function renderAsks() {
  $('#condAsks').innerHTML = openPermissions().map(permissionHTML).join('') + elsewhereHTML(conductor().elsewhere || []) + openAsks().map(askHTML).join('');
}

// ---- The status line ----

function statusOf() {
  const c = conductor(), name = short();
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
  $('#condBar').innerHTML = `<button class="cond-stat t-${s.tone}" data-cond-toggle aria-expanded="${shown}" title="${shown ? 'Hide' : 'Show'} what ${esc(short())} has been doing">`
    + `<i class="cond-dot"></i><span class="cond-text"><b>${esc(s.text)}</b>${s.doing ? `<span class="cond-doing"> · ${esc(s.doing)}</span>` : ''}`
    + `${s.faded ? `<span class="cond-faded"> · ${esc(s.faded)}</span>` : ''}</span>`
    + `<span class="cond-more"><span class="cond-more-label">History</span><span class="cond-chev${shown ? ' up' : ''}">${icon.chev}</span></span></button>${start}`
    + (s.show ? '<button class="btn-sm cond-start" data-show-window>Show its window</button>' : '');
}

async function showWindow() {
  try { const r = await api.showConductor(); if (!r.shown) toast("Couldn't find its window. It's in your taskbar", 'var(--amber)'); } catch (err) { toast(err.message, 'var(--red)'); }
}

// ---- The history ----

// Messages from the conductor: escaped, then a little Markdown (bold, code, lists, links).
function richText(text) {
  const inline = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const parts = esc(text).split(/```[\w-]*\n?/);
  return parts.map((part, i) => {
    if (i % 2) return `<pre>${part.replace(/\n$/, '')}</pre>`;
    let out = '', list = '';
    const close = () => { if (list) { out += `</${list}>`; list = ''; } };
    for (const line of part.split('\n')) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/), number = line.match(/^\s*\d+[.)]\s+(.*)$/), head = line.match(/^#{1,4}\s+(.*)$/);
      if (bullet || number) {
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) { close(); out += `<${kind}>`; list = kind; }
        out += `<li>${inline((bullet || number)[1])}</li>`;
      } else {
        close();
        if (head) out += `<p class="h">${inline(head[1])}</p>`;
        else if (line.trim()) out += `<p>${inline(line)}</p>`;
        else out += '<p class="gap"></p>';
      }
    }
    close();
    return out;
  }).join('');
}

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
      return `<div class="h-msg them"><div class="h-head"><span class="h-who">${esc(short())}</span>${e.re ? `<span class="h-re"${taskLink(e.task)}>re: ${esc(e.re)}</span>` : ''}${at}`
        + `<button class="linkish h-reply" data-reply="${e.id}">Reply</button></div>`
        + `<div class="h-text${long ? ' clamp' : ''}">${richText(e.text)}</div>${long ? '<button class="linkish h-more" data-more>Show all</button>' : ''}</div>`;
    }
    case 'message':
      return `<div class="h-msg you"><div class="h-head">${e.via === 'terminal' ? `<span class="h-re">In ${esc(short())}'s window</span>` : ''}${at}</div><div class="h-text">${esc(e.text)}</div></div>`;
    case 'sent':
      return `<div class="h-sent"${taskLink(e.task)}><span class="h-act">${esc(ACT[e.act] || e.act)}</span><span class="h-what">${esc(e.text || e.title || '')}</span>${at}</div>`;
    case 'asked': {
      const reply = all.find(x => x.kind === 'answered' && x.to === e.id);
      return `<div class="h-q"><div class="h-head"><span class="h-who">${esc(short())} asked</span>${at}</div>`
        + e.questions.map((q, i) => `<div class="h-qq">${esc(q.text)}</div><div class="h-qa${reply ? '' : ' open'}">${reply ? esc(reply.answers?.[i] ?? '') : 'Waiting for your answer'}</div>`).join('') + '</div>';
    }
    case 'permission': {
      const d = all.find(x => x.kind === 'decided' && x.to === e.id), gone = all.find(x => x.kind === 'expired' && x.to === e.id);
      const verdict = d ? (d.allow ? 'Allowed' : 'Denied') : gone ? 'Asked in its window' : 'Waiting for your OK';
      return `<div class="h-event perm"><span class="h-dot"></span><span>${e.worker ? 'A worker' : esc(short())} asked to: ${esc(e.text)}</span><span class="h-verdict v-${d ? (d.allow ? 'yes' : 'no') : 'wait'}">${verdict}</span>${at}</div>`;
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
  if (!items.length && !history.steps.length) return `<div class="h-empty">Nothing yet. What ${esc(short())} does and says, and what you send it, shows here.</div>`;
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
    const message = e.kind === 'permission' ? `${short()} wants your OK: ${e.text}` : `${short()} asks: ${e.questions?.[0]?.text || ''}`;
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
  for (const id of [...picks.keys()]) if (!ids.has(id)) picks.delete(id);
  if (dismissed && !ids.has(dismissed)) dismissed = '';
  announce();
  renderAll();
  if (shown && history?.stamp !== conductor().stamp) loadHistory();
}

// A different project: its own thread.
export function resetConductor() { history = null; mode = null; dismissed = ''; picks.clear(); seen.clear(); first = true; }

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
  $('#condAsks').addEventListener('click', async e => {
    const hit = s => e.target.closest(s);
    if (hit('[data-c-pick]')) {
      const b = hit('[data-c-pick]'), ask = openAsks().find(a => a.id === b.dataset.ask);
      const q = ask?.questions[(picks.get(ask.id) || []).length];
      if (!q) return;
      if (q.multi) {
        const t = multi.get(ask.id) || [], label = b.dataset.cPick;
        multi.set(ask.id, t.includes(label) ? t.filter(x => x !== label) : [...t, label]);
        renderAsks();
      } else answer(ask.id, b.dataset.cPick);
    } else if (hit('[data-c-multi]')) {
      const id = hit('[data-c-multi]').dataset.cMulti, t = multi.get(id) || [];
      multi.delete(id);
      if (t.length) answer(id, t.join(', '));
    } else if (hit('[data-c-skip]')) answer(hit('[data-c-skip]').dataset.cSkip, SKIP);
    else if (hit('[data-c-back]')) {
      const id = hit('[data-c-back]').dataset.cBack;
      picks.set(id, (picks.get(id) || []).slice(0, -1));
      renderAsks(); renderNoteMode();
    } else if (hit('[data-allow]') || hit('[data-deny]')) {
      const allow = !!hit('[data-allow]'), id = (hit('[data-allow]') || hit('[data-deny]')).dataset[allow ? 'allow' : 'deny'];
      hit('.c-perm')?.classList.add('sending');
      try { await api.conductorPermission(id, allow); await refresh(); toast(allow ? 'Allowed' : `Denied. ${short()} hears you said no`, allow ? 'var(--green)' : 'var(--gray)'); }
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
