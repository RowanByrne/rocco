// The cards beside the chat (views/conductor.js), in a rail: To test, Needs you (a stuck card's questions, a feature
// plan to approve, what the agent spotted), Working, and Up next, the queue in order, which the user can reorder
// (never ahead of what a task waits on). On a feature's tab the rail lists that feature's cards. On a narrow window
// the rail is a row of counts above the chat, which opens to the lists.
// A card opens as its own conversation in the chat's place (ui/sheet.js, docked): what it is, what to try, what it
// changed, its agent's session word for word, and a box that sends it back or adds to it.
// Everything is drawn from the tasks each time they change, an open card included, and only what differs is
// touched, so a list stays where it was scrolled and a box keeps what's typed in it.
import { state, byId, of, approvedToday, on } from '../state.js';
import { $, webUrl } from '../lib/dom.js';
import { html, render, nothing, repeat, live } from '../lib/html.js';
import { hhmm, minsSince, featureVars } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { draft } from '../lib/drafts.js';
import { busy, once } from '../lib/busy.js';
import { api } from '../api.js';
import { refresh, taskFrom } from '../sync.js';
import { settings } from '../settings.js';
import { toast } from '../ui/toast.js';
import { showSheet, closeSheet, openSheetKey } from '../ui/sheet.js';
import { initPopover, hidePopover } from '../ui/popover.js';
import { shotOf, imagesIn, shotThumbs, shotClick, clip } from '../ui/shots.js';
import { pics, picOption, openPicsFrom } from '../ui/pics.js';
import { showDoc } from './docs.js';
import { prose, proseLine } from '../prose.js';
import { startSession, scrollSessionToEnd } from './session.js';
import { stepIn, stepChips, effort, checks, changedFile, linkButton, partsClick, partsChange, resetParts, forgetDiffs } from './taskparts.js';
import { showArchive } from './archive.js';
import { showUsage } from './usage.js';
import { activeThread, openThread } from './conductor.js';
import { storage } from '../lib/storage.js';

const NAMES = { ready: 'To test', stuck: 'Needs you', working: 'Working', queued: 'Up next', inbox: 'Suggested', done: 'Approved', removed: 'Deleted' };
const COLOR = { ready: 'var(--green)', stuck: 'var(--amber)', working: 'var(--blue)', queued: 'var(--gray)', inbox: 'var(--claude)', done: 'var(--green)', removed: 'var(--gray)' };
const TYPES = { bug: 'Bug', tweak: 'Tweak', idea: 'Idea', fix: 'Fix', feature: 'Feature', question: 'Question' };
const SKIP = 'skip'; // "Let Rocco decide", as a pick no option's label can be
const place = t => t.where === 'lane' ? 'Lane ' + t.lane : 'Main';
const isPlan = t => t.kind === 'plan';
const isQuestion = t => t.kind === 'question';
// On a feature's tab, the rail is that feature's: its plan and its steps. On the conductor's, everything.
const inView = t => { const thread = activeThread(); return !thread || t.id === thread || t.plan === thread; };
const work = status => of(status).filter(t => !isPlan(t) && !isQuestion(t) && inView(t));
// The user's questions to the conductor: waiting, or answered and not yet marked "got it". (Rocco answers most in
// the chat and keeps no card: rocco.ps1 reply -Answer. These are the ones it's still on.)
const openQuestions = () => state.tasks.filter(t => isQuestion(t) && t.status !== 'done' && t.status !== 'removed' && inView(t));
const answered = () => openQuestions().filter(t => t.status === 'ready');
// An errand (open the lanes, push main) was done, not approved: it's said in the chat, and not counted here.
const approvedWork = () => approvedToday().filter(t => !isPlan(t) && !isQuestion(t) && t.kind !== 'errand');
const queue = () => work('queued').sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id));
const plansToApprove = () => state.tasks.filter(t => isPlan(t) && t.status === 'inbox' && inView(t));
// Features under way: not one whose every step was deleted, which has nothing left to show (planCount, below).
const features = () => state.tasks.filter(t => isPlan(t) && ['queued', 'working', 'stuck', 'ready'].includes(t.status) && planCount(t).total > 0);
// A thread with an agent of its own (server/leads.ps1): a feature's, or a card's. It's talked to on its tab.
const hasThread = id => (state.meta.leads || []).some(l => l.id === id);
const childrenOf = plan => state.tasks.filter(t => t.plan === plan.id && t.status !== 'removed');
// A plan's count, as the server finishes it (tasks.ps1 Sync-Plan): its tasks done, out of its steps, or its tasks if
// there are more. A step whose task was deleted is dropped, not waiting.
function planCount(p) {
  const all = state.tasks.filter(t => t.plan === p.id), kids = all.filter(t => t.status !== 'removed');
  return { done: kids.filter(k => k.status === 'done').length, total: Math.max(kids.length, (p.steps || []).length - (all.length - kids.length)) };
}
const unfinishedDeps = t => (t.after || []).filter(id => { const d = byId(id); return d && d.status !== 'done' && d.status !== 'removed'; });

// Questions for the user: the list, or the older single question.
const questionsOf = t => t.questions?.length ? t.questions : (t.question ? [{ text: t.question, options: (t.options || []).map(label => ({ label })) }] : []);

// What the user is in the middle of, kept by project and task (lib/drafts.js) until it's sent: the answers picked so
// far on a stuck task (one per question, null where none is picked yet), and what's typed in a card's own box.
const picksOf = id => draft.get(`answers:${id}`, []);
const sheetText = id => draft.get(`sheet:${id}`);

const sendingAnswers = new Set(); // tasks whose answers are on their way
const unsent = new Map();         // task -> what was typed with answers that didn't send, to go with them next time
const folding = new Set();        // tasks being approved: the box is lit and the card folds away

// Where a queued task came from, for its tag in Up next.
const source = t => t.pending === 'reopen' ? ['Reopened', 'var(--amber)']
  : t.pending === 'answer' ? ['Answered', 'var(--amber)']
  : t.kind === 'suggestion' ? [`From Rocco`, 'var(--claude)']
  : t.kind === 'note' ? ['Your note', 'var(--violet)'] : null;

const hasType = t => !!TYPES[t.type] && t.type !== 'feature';
const typeTag = t => hasType(t) ? html`<span class="ttag t-${t.type}">${TYPES[t.type]}</span>` : nothing;
const featureOf = t => (t.plan && byId(t.plan)) || null;
const featureTag = t => { const p = featureOf(t); return p ? html`<span class="ftag" style=${featureVars(p.id)} title="Part of ${p.title}"><i></i>${p.title}</span>` : nothing; };

// ---- Audio options ----

let player = null, playing = '';
function play(url) {
  const again = playing === url;
  player?.pause();
  playing = '';
  if (!again) {
    player = new Audio(url);
    playing = url;
    player.onended = () => { if (playing === url) { playing = ''; renderWorkboard(); } };
    player.play().catch(() => { if (playing === url) playing = ''; renderWorkboard(); toast("Couldn't play that sound", 'var(--red)'); });
  }
  renderWorkboard();
}

const speaker = o => o.audio ? html`<button class="speaker${playing === o.audio ? ' playing' : ''}" data-play=${o.audio} title="Play" aria-label="Play ${o.label}">${icon.speaker}</button>` : nothing;
// An option: a button to pick, with a play button for a sound, or a picture to see bigger (ui/pics.js).
const option = (o, i, picked) => o.image ? picOption(o, o.image, { pick: o.label, q: i }, picked === o.label, speaker(o))
  : html`<span class="opt-wrap"><button class="opt${picked === o.label ? ' on' : ''}" data-pick=${o.label} data-q=${i} title=${o.label}><span>${o.label}</span></button>${speaker(o)}</span>`;
// A question's pictures and options, as one set for the picture viewer.
const options = (q, i, picked, extra = nothing) => html`<div data-pic-set data-q=${i}>${pics(q.images)}<div class="opts${(q.options || []).some(o => o.image) ? ' with-pics' : ''}">${(q.options || []).map(o => option(o, i, picked))}${extra}</div></div>`;

// ---- Columns ----

// The stuck card asks its questions one at a time, right on the board. The last answer sends them all (pick).
function questionCard(t) {
  const qs = questionsOf(t), picked = picksOf(t.id);
  if (!qs.length) return nothing;
  const many = qs.length > 1;
  if (sendingAnswers.has(t.id)) return html`<div class="ask-card done"><span class="spin"></span><span>Sending your answer${many ? 's' : ''}</span></div>`;
  const i = qs.findIndex((_, n) => picked[n] == null);
  // Every question has its pick, and they aren't on their way: the last send didn't go through.
  if (i < 0) return html`<div class="ask-card"><div class="ask-q"><span>Your answer${many ? 's are' : ' is'} picked, and not sent yet.</span></div><div class="ask-foot"><button class="btn-sm go" data-resend=${t.id}>Send ${many ? 'them' : 'it'}</button><button class="linkish" data-back=${t.id}>Back</button></div></div>`;
  const q = qs[i];
  return html`<div class="ask-card"><div class="ask-q"><span>${proseLine(q.text)}</span>${many ? html`<span class="ask-n">${i + 1} of ${qs.length}</span>` : nothing}</div>${options(q, i, '')}<div class="ask-foot"><button class="linkish" data-pick=${SKIP} data-q=${i}>Let Rocco decide</button>${
    i ? html`<button class="linkish" data-back=${t.id}>Back</button>` : nothing}</div></div>`;
}

function workingSteps(t) {
  if (!settings().liveSteps) return nothing;
  // This attempt's steps: a task sent back starts its list again.
  const since = Date.parse(t.startedAt) || 0;
  const done = t.log.filter(l => l.who === 'worker' && (Date.parse(l.at) || 0) >= since).slice(-3);
  return html`<ol class="steps">${done.map(l => html`<li>${icon.check}<span>${l.text}</span></li>`)}<li class="now"><span class="spin"></span><span>${t.step || 'Working'}</span></li></ol>`;
}

function card(t) {
  const fold = folding.has(t.id);
  const tries = t.attempt > 1 ? html`<span class="note-meta" title="Attempt ${t.attempt}">${icon.retry}${t.attempt}</span>` : nothing;
  let info = nothing, right = nothing, extra = nothing, bar = nothing;
  if (t.status === 'ready') {
    info = html`<span class="tag ${t.where === 'lane' ? 't-lane' : 't-main'}"><i></i>${place(t)}</span>${tries}`;
    right = html`<button class="chk${fold ? ' on' : ''}" role="checkbox" aria-checked=${fold ? 'true' : 'false'} data-approve=${t.id} aria-label="Tested, approve" title="Tested, approve">${icon.check}</button>`;
  } else if (t.status === 'stuck') {
    info = tries;
    right = questionsOf(t).length ? nothing : html`<span class="qm" title="Needs your answer">?</span>`;
    extra = questionCard(t);
  } else if (t.status === 'working') {
    info = html`<span class="note-meta">${settings().liveSteps ? '' : `${t.step || 'Working'} · `}${minsSince(t.startedAt)}m</span>${
      t.followups > 0 ? html`<span class="fchip" title="The worker hasn't read your follow-up yet">Follow-up sent</span>` : nothing}${stepChips(t)}`;
    right = t.lane ? html`<span class="lc" title="Lane ${t.lane}">L${t.lane}</span>` : nothing;
    extra = workingSteps(t);
    bar = typeof t.progress === 'number' ? html`<div class="bar"><i style="width:${Math.max(3, t.progress)}%"></i></div>` : html`<div class="progress"></div>`;
  }
  return html`<div class="card s-${t.status}${t.fresh ? ' fresh' : ''}${fold ? ' collapse' : ''}" data-id=${t.id} tabindex="0" role="button" aria-label=${t.title}><div class="c-row"><div class="c-main"><div class="c-title">${
    t.feature && !t.plan ? icon.branch : nothing}<span>${t.title}</span></div><div class="c-meta">${typeTag(t)}${featureTag(t)}${info}</div></div>${right}</div>${extra}${bar}</div>`;
}

// ---- The rail's groups ----

// The groups the user folded away, kept in this browser.
const FOLD_KEY = 'rocco.rail';
let folded = new Set();
try { folded = new Set(JSON.parse(storage.get(FOLD_KEY) || '[]')); } catch { /* none folded */ }
let railOpen = false; // on a narrow window: the row of counts is opened to the lists

// One group: its name and count (click to fold it), then its cards. An empty one is just its name.
function group(key, name, color, count, body) {
  const shut = folded.has(key) || !count;
  return html`<section class="rail-group g-${key}${shut ? ' shut' : ''}${count ? '' : ' none'}" style="--c:${color}" data-group=${key}><button class="rail-head" data-fold=${key} aria-expanded=${shut ? 'false' : 'true'} ?disabled=${!count}><span class="sdot"></span><span class="rail-name">${name}</span><span class="count">${count}</span><span class="sp"></span>${count ? icon.chev : nothing}</button>${
    shut ? nothing : html`<div class="rail-list">${body}</div>`}</section>`;
}

// ---- Feature plans ----

const planSteps = p => html`<ol class="plan-steps">${(p.steps || []).map((s, i) => html`<li><span class="ps-n">${i + 1}</span><span class="ps-t">${s.title}</span><span class="ps-meta">${s.lane ? `Lane ${s.lane}` : ''}${s.lane && s.tier ? ' · ' : ''}${s.tier || ''}</span></li>`)}</ol>`;

// A plan's spec (rocco.ps1 plan -Spec): what it builds, in full, opened in Docs.
const specButton = p => html`<button class="btn-sm" data-plan-spec=${p.spec} title=${p.spec}>${icon.doc}Read the spec</button>`;

// A plan waiting for the user's go-ahead, in the rail: what it is and Approve. The plan itself (its steps, its spec,
// asking for changes) is its card.
function planCard(p) {
  const n = (p.steps || []).length;
  return html`<div class="card s-plan${p.fresh ? ' fresh' : ''}" style=${featureVars(p.id)} data-id=${p.id} tabindex="0" role="button" aria-label=${p.title}><div class="c-title">${icon.layers}<span>${p.title}</span></div><div class="c-meta"><span class="note-meta">Feature plan${n ? ` · ${n} step${n === 1 ? '' : 's'}` : ''}</span>${
    p.pending === 'revise' ? html`<span class="fchip">Changes asked for</span>` : nothing}</div><div class="card-actions"><button class="btn-sm go" data-plan-approve=${p.id}>Approve plan</button><button class="btn-sm" data-open=${p.id}>Read it</button></div></div>`;
}

// A feature under way with no agent of its own (one that has is a tab above the chat).
const feature = p => {
  const { done, total } = planCount(p);
  return html`<button class="feat" style=${featureVars(p.id)} data-id=${p.id} title=${p.title}><span class="feat-dot"></span><span class="feat-name">${p.title}</span><span class="feat-bar"><i style="width:${Math.round(done / Math.max(total, 1) * 100)}%"></i></span><span class="feat-count">${done}/${total}</span></button>`;
};

// ---- Questions Rocco is still on, or has answered and kept for a "Got it" ----

function question(t) {
  const done = t.status === 'ready';
  return html`<div class="card s-question${t.fresh ? ' fresh' : ''}" data-id=${t.id} tabindex="0" role="button" aria-label=${t.title}><div class="c-title"><span class="qa-icon">?</span><span>${t.note || t.title}</span></div><div class="c-meta">${
    done ? html`<span class="note-meta">Answered</span>` : html`<span class="note-meta"><span class="spin"></span>Waiting for an answer</span>`}</div>${
    done ? html`<div class="card-actions"><button class="btn-sm go" data-got-it=${t.id}>${icon.check}Got it</button><button class="btn-sm" data-open=${t.id}>Read it</button></div>`
      : html`<div class="card-actions"><button class="linkish" data-unask=${t.id}>Take it back</button></div>`}</div>`;
}

// ---- What the agent spotted ----

const why = t => t.summary || (t.note && t.note !== t.title ? t.note : '');
const suggestion = t => html`<div class="card s-inbox${t.fresh ? ' fresh' : ''}" data-id=${t.id} tabindex="0" role="button" aria-label=${t.title}><div class="c-title">${icon.sparkle}<span>${t.title}</span></div>${
  why(t) ? html`<div class="sug-why">${why(t)}</div>` : nothing
}<div class="card-actions"><button class="btn-sm go" data-queue=${t.id}>Queue</button><button class="btn-sm" data-dismiss=${t.id}>Dismiss</button></div></div>`;

// ---- Up next ----

function queueRow(t, i) {
  const src = source(t), deps = unfinishedDeps(t);
  return html`<div class="q-row${t.fresh ? ' fresh' : ''}" data-id=${t.id} draggable="true" tabindex="0" role="button" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="Drag to reorder, or Alt+↑ and Alt+↓"><span class="q-num">${i + 1}</span><div class="q-main"><div class="q-title">${
    t.feature && !t.plan ? icon.branch : nothing}<span>${t.title}</span></div><div class="q-meta">${typeTag(t)}${featureTag(t)}${stepChips(t)}${
    src ? html`<span class="q-src" style="--sc:${src[1]}">${src[0]}</span>` : nothing}${
    // A task waiting on another shows that, with the reason on hover; the rest show what they wait for.
    deps.length ? html`<span class="q-dep" title=${t.waiting || `Needs ${deps.join(', ')} done first`}>${icon.lock}After ${deps.join(', ')}</span>`
      : html`<span class="q-wait${t.pending ? ' conductor' : ''}">${icon.clock}<span>${waitText(t) || 'Queued'}</span></span>`}</div></div>${
    t.shots[0] ? html`<img class="q-shot" src=${t.shots[0]} alt="">` : nothing}<span class="grip" aria-hidden="true">${icon.grip}</span></div>`;
}

function upNext() {
  const list = queue();
  return group('queued', 'Up next', COLOR.queued, list.length, repeat(list, t => t.id, queueRow));
}

// The server opened a conductor because none was running: say so.
export function conductorOpened(agent) { if (agent) toast(`${agent} started, minimized in your taskbar, to pick it up`, 'var(--claude)'); }

// The board, and whatever sheet is open on it: a task's follows the task as it changes.
export function renderWorkboard() {
  renderBoard();
  const key = openSheetKey();
  if (key === 'approved') showApproved();
  else if (key && key === sheetTask) drawTask(key);
  else if (key !== sheetTask) sheetTask = null;
}

function renderBoard() {
  const ready = work('ready'), stuck = work('stuck'), working = work('working'), spotted = work('inbox'), plans = plansToApprove();
  const asked = openQuestions().sort((a, b) => a.id.localeCompare(b.id)), replies = answered();
  const needs = stuck.length + plans.length + spotted.length + replies.length, waiting = ready.length + needs;
  // The sidebar's badge and the tab's title count everything that waits on the user, whichever tab is showing.
  const all = state.tasks.filter(t => (['ready', 'stuck', 'inbox'].includes(t.status) && !isQuestion(t)) || (isQuestion(t) && t.status === 'ready')).length;
  $('#boardBadge').textContent = String(all);
  $('#boardBadge').hidden = !all;
  document.title = all ? `(${all}) Rocco` : 'Rocco';
  $('#approvedText').textContent = `${approvedWork().length} approved today`;
  // Features with no agent of their own: the ones that have one are tabs.
  const feats = activeThread() ? [] : features().filter(p => !hasThread(p.id));
  render(repeat(feats, p => p.id, feature), $('#features'));
  $('#features').hidden = !feats.length;
  render(html`${group('ready', 'To test', COLOR.ready, ready.length, repeat(ready, t => t.id, card))}${
    group('stuck', 'Needs you', COLOR.stuck, needs, html`${repeat(stuck, t => t.id, card)}${repeat(replies, t => t.id, question)}${repeat(plans, p => p.id, planCard)}${repeat(spotted, t => t.id, suggestion)}${
      spotted.length > 1 ? html`<button class="linkish rail-all" data-queue-all>Queue all ${spotted.length} that Rocco spotted</button>` : nothing}`)}${
    group('working', 'Working', COLOR.working, working.length + asked.length - replies.length, html`${repeat(working, t => t.id, card)}${repeat(asked.filter(t => t.status !== 'ready'), t => t.id, question)}`)}`, $('#board'));
  render(upNext(), $('#queue'));
  // On a narrow window, the rail is this row of counts, which opens to the lists.
  const count = (key, name, n, color) => html`<button class="rc${n ? '' : ' none'}" data-rail=${key} style="--c:${color}"><span class="sdot"></span>${name}<b>${n}</b></button>`;
  render(html`${count('ready', 'To test', ready.length, COLOR.ready)}${count('stuck', 'Needs you', needs, COLOR.stuck)}${count('working', 'Working', working.length, COLOR.working)}${
    count('queued', 'Up next', queue().length, COLOR.queued)}<span class="sp"></span><button class="rc-toggle" data-rail="" aria-expanded=${railOpen ? 'true' : 'false'} title=${railOpen ? 'Hide the cards' : 'Show the cards'}>${icon.chev}</button>`, $('#railCounts'));
  $('#rail').classList.toggle('open', railOpen);
  $('#rail').classList.toggle('waiting', waiting > 0);
  state.tasks.forEach(t => { t.fresh = false; });
}

// The steps to try: one a line (rocco.ps1 set -Test "a","b").
const stepsOf = t => String(t.test || '').split('\n').map(s => s.trim()).filter(Boolean);
const trySteps = steps => steps.length > 1 ? html`<ul>${steps.map(s => html`<li>${proseLine(s)}</li>`)}</ul>` : proseLine(steps[0] || '');
// A task parked for a lane (rocco.ps1 set -ForLane): whether one is free now, counted as the sidebar counts them.
function waitText(t) {
  if (t.waitingFor !== 'lane') return t.waiting;
  const count = state.meta.lanes?.count || 0;
  const held = new Set(state.tasks.filter(x => x.lane && (x.status === 'working' || x.status === 'stuck' || (x.where === 'lane' && (x.status === 'ready' || x.status === 'queued'))
    || (x.lead && x.status !== 'done' && x.status !== 'removed'))).map(x => x.lane));
  const free = Array.from({ length: count }, (_, i) => i + 1).filter(n => !held.has(n));
  return free.length ? `Lane ${free[0]} is free: Rocco starts it next` : `Waiting for a free lane: all ${count} are busy`;
}
const lanePart = t => t.lane ? `lane ${t.lane}` : 'conductor';

// Up to n words of each text in turn, and whether any were left out.
function cutWords(texts, n) {
  let cut = false;
  const out = [];
  for (const text of texts) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (n <= 0) { if (words.length) cut = true; continue; }
    if (words.length > n) { out.push(words.slice(0, n).join(' ') + '…'); cut = true; } else out.push(words.join(' '));
    n -= words.length;
  }
  return { out: out.filter(Boolean), cut };
}

// The hover: what the card is now, in a few lines. Rocco keeps a summary and a test to 30 words each (rocco.ps1
// Assert-CardText); a card written before that is cut short here, and its sheet has it all.
function summary(t) {
  const head = label => html`<div class="ph"><span class="sdot" style="--c:${COLOR[t.status]}"></span>${label}</div>`;
  const words = 30, more = html`<div class="pmore">Open it for the rest</div>`;
  const sum = cutWords([t.summary || ''], words);
  switch (t.status) {
    case 'ready': {
      const test = cutWords(stepsOf(t), words);
      return html`${head(`Ready to test · ${place(t)}`)}${sum.out.length ? html`<div class="pl">What changed</div><div class="pt">${sum.out[0]}</div>` : nothing}${
        test.out.length ? html`<div class="try"><div class="pl">Try</div>${trySteps(test.out)}</div>` : nothing}${sum.cut || test.cut ? more : nothing}`;
    }
    case 'stuck': {
      const qs = cutWords(questionsOf(t).map(q => q.text), words * 2);
      return html`${head('Needs your answer')}<div class="pt">${qs.out.join(' · ')}</div>${qs.cut ? more : nothing}`;
    }
    case 'working':
      return html`${head(`${t.step || 'Working'} · ${lanePart(t)} · ${minsSince(t.startedAt)}m`)}<div class="pt">${sum.out.length ? sum.out[0] : 'No report yet'}</div>${sum.cut ? more : nothing}`;
  }
  return null;
}

// ---- A task in the sheet ----

let sheetTask = null;                         // the task whose sheet is open
let ui = { confirm: false, big: new Set() };  // in that sheet: Delete asked once, and the screenshots shown big
let changes = null;                           // what it changed: { id, stamp, loading, data, error }
let reply = { id: '', shots: [] };            // the screenshots going back with it

function whereLine(t) {
  if (isPlan(t)) return t.status === 'inbox' ? 'Feature plan · waiting for your OK' : `Feature · ${planCount(t).done} of ${planCount(t).total} done`;
  if (isQuestion(t)) return t.status === 'ready' ? 'Answered' : t.status === 'done' ? `Got it at ${hhmm(t.doneAt)}` : 'Waiting for an answer';
  switch (t.status) {
    case 'ready': return `Test in ${place(t)}${t.where === 'lane' ? ' · approving merges it into Main' : ''}`;
    case 'stuck': return ['Needs your answer', t.lane ? `lane ${t.lane}` : ''].filter(Boolean).join(' · ');
    case 'working': return `${t.lane ? `Lane ${t.lane}` : 'The conductor'} · ${minsSince(t.startedAt)}m${typeof t.progress === 'number' ? ` · ${t.progress}%` : ''}`;
    case 'queued': return t.held ? 'Paused' : waitText(t) || 'Queued';
    case 'inbox': return `Rocco spotted this. Queue it to have it done.`;
    case 'done': return `${t.kind === 'errand' ? 'Done' : 'Approved'} ${dayAt(t.doneAt)}${t.pending === 'merge' ? ' · merging into Main' : ''}`;
    case 'removed': return `Deleted${t.updated ? ` ${dayAt(t.updated)}` : ''}`;
  }
  return '';
}
// "at 14:05" for today, "on 3 Nov" for a task from the archive.
const dayAt = iso => !iso ? '' : new Date(iso).toDateString() === new Date().toDateString() ? `at ${hhmm(iso)}` : `on ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;

function sheetQuestions(t) {
  const picked = picksOf(t.id);
  return questionsOf(t).map((q, i) => html`<div class="s-q">${proseLine(q.text)}</div>${
    options(q, i, picked[i], html`<button class="opt${picked[i] === SKIP ? ' on' : ''}" data-pick=${SKIP} data-q=${i}>Let Rocco decide</button>`)}`);
}

// A task to test is approved from what to try; sending it back is the box at the foot.
const approveButton = t => isQuestion(t) ? nothing : html`<button class="btn go s-approve" data-approve-open>${icon.checkSm}Approve</button>`;

// A card that keeps coming back can be given an agent of its own (server/leads.ps1), to work it through with the
// user directly, on a tab of its own. Offered from the third attempt, where a feature's own agent isn't already on it.
const canPromote = t => !isPlan(t) && !isQuestion(t) && !t.lead && !(t.plan && hasThread(t.plan)) && ['ready', 'working', 'stuck', 'queued'].includes(t.status) && state.agent?.leads !== false;
const promoteOffer = t => t.lead && t.pending === 'handoff' ? html`<div class="s-offer">${icon.clock}<span>Its worker is wrapping up. Then an agent of its own takes over, on a tab above the chat.</span></div>`
  : t.attempt >= 3 && canPromote(t) ? html`<div class="s-offer"><span><b>Attempt ${t.attempt}.</b> Give it an agent of its own, and work it through with that agent directly?</span><button class="btn-sm go" data-promote>Give it its own agent</button></div>` : nothing;

// The top of the sheet (what it is, what to try, Approve, its questions) stays in view while the session scrolls under it.
function sheetTop(t) {
  const kids = isPlan(t) ? childrenOf(t) : [];
  return html`<h2 class="s-title">${t.title}</h2><div class="s-where">${whereLine(t)}</div>${effort(t)}${promoteOffer(t)}${
    hasType(t) || featureOf(t) ? html`<div class="c-meta">${typeTag(t)}${featureTag(t)}</div>` : nothing}${stepIn(t)}${
    t.summary ? html`<div class="s-sum">${prose(t.summary)}</div>` : nothing}${
    isPlan(t) ? html`${planSteps(t)}${t.spec ? html`<div class="row s-spec">${specButton(t)}</div>` : nothing}${
      kids.length ? html`<div class="sec-h">Tasks</div>${kids.map(k => html`<div class="s-row" data-id=${k.id}><span class="sdot" style="--c:${COLOR[k.status] || 'var(--gray)'}"></span><span>${k.title}</span><span class="at">${NAMES[k.status] || ''}</span></div>`)}` : nothing}` : nothing}${
    t.status === 'ready' && t.test ? html`<div class="s-try"><small>Try</small>${trySteps(stepsOf(t))}${approveButton(t)}</div>` : t.status === 'ready' ? approveButton(t) : nothing}${
    t.status === 'stuck' ? sheetQuestions(t) : nothing}`;
}

// What its branch changed (server/tasks.ps1), loaded when the sheet opens and again when the task moves on.
function changesView(t) {
  const c = changes?.id === t.id ? changes : null;
  if (!c || (!c.data && !c.error)) return html`<span class="mut">Loading…</span>`;
  if (!c.data) return html`<div class="load-error">${icon.alert}<span>Couldn't load what changed: ${c.error}</span><button class="btn-sm" data-changes-retry>Retry</button></div>`;
  const d = c.data;
  if (!d.files.length) return html`<span class="mut">No changes found for its branch yet.</span>`;
  return html`${d.files.map(changedFile)}<div class="chg-foot">${
    d.source === 'merged' ? 'As merged into main' : 'On its branch, against main'}${d.url ? html` · <a href=${webUrl(d.url)} target="_blank" rel="noreferrer">View on GitHub</a>` : nothing}</div>`;
}

function sheetBody(t) {
  return html`<div class="s-top">${sheetTop(t)}</div>${
    t.shots.length ? html`<div class="shots">${t.shots.map(src => html`<img src=${src} alt="Screenshot" class=${ui.big.has(src) ? 'big' : ''}>`)}</div>` : nothing}${
    t.note && t.note !== t.title ? html`<div class="s-note">${t.note}</div>` : nothing}${checks(t)}${
    t.branch ? html`<div class="sec-h">What changed</div><div class="changes" id="changes">${changesView(t)}</div>` : nothing
  }<div class="sec-h">Session</div><div class="sx" id="sx"></div>`; // its agent's session and the card's history, word for word (session.js draws it)
}

// The round send button, as on the note box: Enter does the same. kind: follow (a message) or reopen (send it back).
const sendButton = (kind, label, off) => html`<button type="button" class="send" data-send=${kind} title="${label} (Enter)" aria-label=${label} ?disabled=${off}>${SEND_ICON}</button>`;
const SEND_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;

// What the sheet's foot offers depends on where the task is; the one box in it keeps what's typed (sheetText) as the
// task moves on, and through a reload.
function sheetFoot(t) {
  const sending = busy(`task:${t.id}`);
  const box = (id, placeholder) => html`<textarea class="field" id=${id} data-sheet-text placeholder=${placeholder} .value=${live(sheetText(t.id))} ?disabled=${sending}></textarea>`;
  const followUp = placeholder => html`<div class="reply msg">${box('followText', placeholder)}<div class="row"><span class="sp"></span>${sendButton('follow', 'Send', sending)}</div></div>`;
  if (isQuestion(t)) {
    if (t.status === 'ready') return html`<div class="row"><button class="btn go" data-got-it=${t.id}>${icon.checkSm}Got it</button></div>${box('followText', 'Ask a follow-up')}<div class="row"><span class="sp"></span><button class="btn" data-ask-more-send>Ask more</button></div>`;
    if (t.status === 'done') return nothing;
    return followUp('Add to your question');
  }
  if (isPlan(t) && t.status === 'inbox') return html`<div class="row"><button class="btn accent" style="flex:1" data-plan-approve=${t.id}>Approve plan</button></div>${box('followText', 'Want changes? Say what, then send')}<div class="row"><span class="sp"></span><button class="btn" data-revise>Ask for changes</button></div>`;
  // Sending a task back: a box that's always open under To test, with screenshots like the note box.
  if (t.status === 'ready') return html`<div class="reply" id="reply"><div class="drafts" id="replyShots">${shotThumbs(reply.shots)}</div>${
    box('reopenText', "Not right yet? Say what's wrong, paste or drop a screenshot, and press Enter to send it back")
  }<div class="row"><button type="button" class="tool" data-reply-attach title="Attach screenshots" aria-label="Attach screenshots">${clip}</button><input type="file" id="replyInput" accept="image/*" multiple hidden><span class="sp"></span>${sendButton('reopen', 'Send it back', sending)}</div></div>`;
  if (t.status === 'stuck') return html`${box('answerText', questionsOf(t).length ? 'Anything to add? Type it before you pick, or press Enter to send it' : 'Your answer. Enter sends it')}<div class="row"><button class="btn warm" data-answer ?disabled=${sendingAnswers.has(t.id)}>Send answer</button></div>`;
  if (t.status === 'inbox') return html`<div class="row"><button class="btn accent" style="flex:1" data-queue-open>Queue it</button></div>`;
  if (isPlan(t)) return followUp('Add something about this feature, for Rocco');
  if (t.status === 'working') return followUp('Message its agent. It reads it at its next step');
  if (t.status === 'queued') return followUp('Add more for its agent, for when it starts');
  return nothing;
}

function attachReply(files) {
  const added = files.map(shotOf).filter(Boolean);
  if (!added.length || !$('#replyShots') || !sheetTask) return;
  reply.shots.push(...added);
  drawTask(sheetTask);
  $('#reopenText')?.focus();
}

// The screenshots go up first, so the conductor finds them, named in the text, when the task comes back to it.
function sendBack(id) {
  const text = sheetText(id).trim(), shots = [...reply.shots];
  if (!text && !shots.length) { $('#reopenText')?.focus(); toast("Say what's still wrong, or add a screenshot", 'var(--amber)'); return; }
  attempt('send it back', async () => {
    // One that went up before a send that failed isn't sent twice.
    for (const s of shots) s.name ??= (await api.shot(id, s.file)).name || '';
    const names = shots.map(s => s.name).filter(Boolean);
    await act(id, 'reopen', [text, names.length ? `Screenshots: ${names.join(', ')}` : ''].filter(Boolean).join('\n'));
    draft.clear(`sheet:${id}`);
    reply = { id: '', shots: [] };
    toast('Sent back to Rocco', 'var(--amber)');
    stayOpen(id);
  }, id).then(() => backToBox(id));
}

function sendFollowUp(id, text) {
  attempt('send it', async () => {
    await act(id, 'followup', text);
    draft.clear(`sheet:${id}`);
    toast('Sent to Rocco', 'var(--violet)');
    stayOpen(id);
  }, id).then(() => backToBox(id));
}

// The box was off while its words were on their way: the caret goes back in it, to carry on like a chat.
function backToBox(id) {
  if (openSheetKey() === id) $('#sFoot [data-sheet-text]')?.focus();
}

// After you send a card something, it stays open like a session: your words show in it, and what its agent does next.
function stayOpen(id) {
  if (openSheetKey() !== id) return;
  openTask(id);
  scrollSessionToEnd();
}

// ---- Deleting a task, from its sheet: a second click confirms, and Undo takes it back for a few seconds ----

// Work a worker is on, or that's done on a branch but not merged: the conductor stops it and drops it.
const running = t => t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && !!t.branch && (t.status !== 'done' || t.pending === 'merge'));

const deleteButton = t => html`<button class="btn-sm danger${ui.confirm ? ' confirm' : ''}" data-delete>${
  ui.confirm ? (running(t) || (isPlan(t) && childrenOf(t).some(running)) ? 'Stop and delete?' : 'Delete it?') : isPlan(t) && childrenOf(t).length ? 'Delete plan' : 'Delete'}</button>`;

function deletedText(t) {
  if (isPlan(t)) return childrenOf(t).length ? 'Deleted the plan and its tasks' : 'Plan deleted';
  if (isQuestion(t)) return 'Question deleted';
  if (running(t)) return 'Deleted. The conductor stops its work.';
  if (t.status === 'ready' || t.status === 'done') return 'Deleted. What it changed stays in Main.';
  return 'Deleted';
}

function deleteTask(id) {
  const t = byId(id);
  if (!t) return;
  if (!ui.confirm) { ui.confirm = true; drawTask(id); return; }
  closeSheet();
  attempt('delete it', async () => { await act(id, 'remove'); undoable(id, deletedText(t), 'var(--gray)'); }, id);
}

// What a task's changes were loaded for: when it moves on (sent back, built again), they're loaded again.
const changeStamp = t => `${t.branch}|${t.status}|${t.attempt}`;

async function loadChanges(id) {
  const t = byId(id);
  if (!t?.branch) return;
  const c = changes?.id === id ? changes : (changes = { id, data: null, error: '' });
  c.stamp = changeStamp(t);
  c.loading = true;
  try { c.data = await api.changes(id); c.error = ''; }
  catch (e) { c.error = e.message; }
  c.loading = false;
  if (changes === c && openSheetKey() === id) drawTask(id);
}

// Draws the open task's sheet from the task as it is now. Reading at the end of the session, it stays there as the
// top fills in above.
function drawTask(id) {
  const t = byId(id);
  if (!t) { if (openSheetKey() === id) closeSheet(); return; }
  const body = $('#sBody'), atEnd = openSheetKey() === id && body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  showSheet(id, {
    color: isPlan(t) ? 'var(--accent)' : isQuestion(t) ? 'var(--claude)' : COLOR[t.status],
    chip: isPlan(t) ? 'Feature plan' : isQuestion(t) ? 'Question' : NAMES[t.status],
    // A deleted task (opened from the archive) has nothing left to delete.
    id: t.id, body: sheetBody(t), foot: sheetFoot(t), tools: html`${linkButton(t)}${t.status === 'removed' ? nothing : deleteButton(t)}`, wide: true,
    dock: true, // in the chat's place, with the rail still beside it
  });
  if (atEnd) body.scrollTop = body.scrollHeight;
  // It moved on (sent back, built again): what it changed is loaded again, and the lines that were open are let go.
  if (t.branch && changes?.id === id && !changes.loading && changes.stamp !== changeStamp(t)) { forgetDiffs(); loadChanges(id); }
}

// Opens a card as its own conversation, in the chat's place. A feature or a card with an agent of its own is talked
// to on its tab instead, unless it's the card itself that's wanted (asCard: its plan, its details).
export function openTask(id, asCard = false) {
  const t = byId(id);
  if (!t) return;
  if (!asCard && hasThread(id)) { closeSheet(); openThread(id); return; }
  if (sheetTask !== id || openSheetKey() !== id) {
    sheetTask = id;
    ui = { confirm: false, big: new Set() };
    resetParts(id);
    if (changes?.id !== id) changes = null;
    if (reply.id !== id) reply = { id, shots: [] };
  }
  drawTask(id);
  if (t.branch && !changes) loadChanges(id);
  startSession(id);
}

// A task by its id alone: one on the board opens as it is; one the board no longer carries (from the archive, a link,
// the usage list) is fetched first. known: the task, when the caller already has it.
export async function openTaskById(id, known = null) {
  if (!state.tasks.some(t => t.id === id)) {
    try { state.extra.set(id, taskFrom(known || await api.task(id))); }
    catch (e) { toast(e.status === 404 ? `There's no task ${id} in this project` : `Couldn't open ${id}: ${e.message}`, 'var(--red)'); return; }
  }
  openTask(id);
}

function showApproved() {
  const list = approvedWork();
  showSheet('approved', {
    color: COLOR.done,
    chip: 'Approved today',
    body: html`<h2 class="s-title">${list.length} approved today</h2><div style="margin-top:12px">${list.map(t => html`<div class="s-row" data-id=${t.id}>${icon.checkSm}<span>${t.title}</span>${
      t.pending === 'merge' ? html`<span class="tag t-merge"><i></i>Merging</span>` : nothing}<span class="at">${hhmm(t.doneAt)}</span></div>`)}</div><div class="row s-older"><button class="btn-sm" data-archive>Earlier ones, in the archive</button></div>`,
  });
}

// A different project: nothing of the old one's stays (what was typed is kept by project, lib/drafts.js).
export function resetWorkboard() {
  player?.pause();
  playing = '';
  sendingAnswers.clear();
  unsent.clear();
  folding.clear();
  sheetTask = null;
  changes = null;
  reply = { id: '', shots: [] };
  resetParts();
  dragId = null;
  clearTimeout(orderTimer);
}

// ---- What the user does ----

// Runs what the user asked for, and says so if it fails. id: the task it's for; while one thing is on its way for a
// task, asking again does nothing.
async function attempt(what, fn, id = '') {
  const run = async () => { try { await fn(); } catch (e) { toast(`Couldn't ${what}: ${e.message}`, 'var(--red)'); } };
  if (!id) { await run(); renderWorkboard(); return; }
  if (busy(`task:${id}`)) return;
  const done = once(`task:${id}`, run);
  renderWorkboard();
  await done;
  renderWorkboard();
}

async function act(id, action, text) {
  const { opened } = await api.act(id, action, text);
  await refresh();
  // Beside the caller's own toast, which comes first.
  if (opened) setTimeout(() => conductorOpened(opened), 300);
}

// What a task's extra parts (taskparts.js) need from here: drawing its sheet again, and doing something to it.
const partsContext = id => ({
  redraw: () => { if (openSheetKey() === id) drawTask(id); },
  run: (what, action, text, done) => attempt(what, async () => { await act(id, action, text); done?.(); }, id),
});

// Approve, answer, queue and dismiss can be taken back for a few seconds.
const undoable = (id, message, color) => toast(message, color, { label: 'Undo', run: () => attempt('undo it', () => act(id, 'undo'), id) });

const boardCard = id => document.querySelector(`#board .card[data-id="${CSS.escape(id)}"]`);

// The card whose conversation is open is marked in the rail.
function markOpenCard() {
  const open = openSheetKey();
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#rail [data-id]'))) el.classList.toggle('open', !!open && el.dataset.id === open);
}

function fold(el) {
  el.style.height = el.offsetHeight + 'px';
  requestAnimationFrame(() => Object.assign(el.style, { height: '0px', opacity: '0', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', borderWidth: '0px' }));
}

// The box lights up, the card folds away, then the server hears about it.
function approve(id) {
  const t = byId(id);
  if (!t) return;
  hidePopover();
  attempt('approve it', async () => {
    folding.add(id);
    renderBoard();
    setTimeout(() => { const el = folding.has(id) && boardCard(id); if (el) fold(el); }, 420);
    await new Promise(r => setTimeout(r, 760));
    try {
      await act(id, 'approve');
      undoable(id, t.where === 'lane' ? `Approved. The conductor merges “${t.title}” into Main.` : `Approved “${t.title}”`, t.where === 'lane' ? 'var(--cyan)' : 'var(--green)');
      const button = $('#approvedBtn');
      button.classList.remove('bump'); void button.offsetWidth; button.classList.add('bump');
    } finally {
      // Still on the board (it didn't go through, or Undo brought it back): unfolded again.
      folding.delete(id);
      boardCard(id)?.removeAttribute('style');
    }
  }, id);
}

const queueIt = id => attempt('queue it', async () => { await act(id, 'queue'); undoable(id, 'Added to Up next', 'var(--violet)'); }, id);
const gotIt = id => attempt('close it', async () => { await act(id, 'approve'); undoable(id, 'Got it', 'var(--claude)'); }, id);
const askMore = (id, text) => attempt('ask it', async () => {
  await act(id, 'reopen', text);
  draft.clear(`reply:${id}`);
  draft.clear(`sheet:${id}`);
  toast('Asked. The answer shows here.', 'var(--claude)');
}, id);
const unask = id => attempt('take it back', async () => { await act(id, 'remove'); undoable(id, 'Question taken back', 'var(--gray)'); }, id);
const dismiss = id => attempt('dismiss it', async () => { await act(id, 'remove'); undoable(id, 'Dismissed', 'var(--gray)'); }, id);
// An approved feature is built by an agent of its own, on a tab of its own (unless this PC turned that off).
const approvePlan = id => attempt('approve the plan', async () => {
  await act(id, 'approve-plan');
  if (hasThread(id)) { closeSheet(); openThread(id); toast('Plan approved. It has a tab of its own now, with its own agent.', 'var(--accent-text)'); }
  else toast('Plan approved. Rocco starts it.', 'var(--accent-text)');
}, id);
const queueAll = () => attempt('queue them', async () => {
  const n = work('inbox').length;
  const { opened } = await api.send();
  await refresh();
  toast(`Added ${n} to Up next`, 'var(--violet)');
  if (opened) conductorOpened(opened);
}, 'inbox');

function answerText(t, extra) {
  const picked = picksOf(t.id);
  // "Pick a sound: Blade swing", "Every swing or only on hits? Only on hits"
  const line = (q, answer) => q.text.trim().endsWith('?') ? `${q.text.trim()} ${answer}` : `${q.text.trim().replace(/[.:]+$/, '')}: ${answer}`;
  const lines = questionsOf(t).map((q, i) => picked[i] == null ? '' : line(q, picked[i] === SKIP ? 'your call' : picked[i])).filter(Boolean);
  if (extra) lines.push(extra);
  return lines.join('\n');
}

// Sent straight away, with a few seconds to take it back. One that doesn't go through keeps its picks and what was
// typed, on the card and in its sheet, to send again.
async function sendAnswers(id, extra = '') {
  const t = byId(id), text = t && answerText(t, extra);
  if (!text) { toast('Pick an answer, or write one', 'var(--amber)'); return; }
  if (sendingAnswers.has(id)) return;
  sendingAnswers.add(id);
  closeSheet();
  renderWorkboard();
  try {
    await act(id, 'answer', text);
    draft.clear(`answers:${id}`);
    draft.clear(`sheet:${id}`);
    unsent.delete(id);
    undoable(id, 'Answer sent to Rocco', 'var(--amber)');
  } catch (e) {
    unsent.set(id, extra);
    toast(`Couldn't send the answer: ${String(e.message).replace(/\.$/, '')}. It's kept on the card`, 'var(--red)', { label: 'Try again', run: () => sendAnswers(id, extra) }, 8000);
  }
  sendingAnswers.delete(id);
  renderWorkboard();
}

// Picking the last unanswered question's option sends them all, with anything typed in the sheet's box.
function pick(taskId, q, value) {
  const t = byId(taskId);
  if (!t || sendingAnswers.has(taskId)) return;
  const picked = [...picksOf(taskId)];
  picked[q] = value;
  for (let i = 0; i < picked.length; i++) picked[i] ??= null; // a question skipped over, in the sheet
  draft.set(`answers:${taskId}`, picked);
  if (questionsOf(t).every((_, i) => picked[i] != null)) {
    sendAnswers(taskId, openSheetKey() === taskId ? sheetText(taskId).trim() : unsent.get(taskId) || '');
    return;
  }
  renderWorkboard();
}

// ---- Reordering Up next ----

// The first task in this order that comes before something it waits on, if any.
function conflict(ids) {
  for (let i = 0; i < ids.length; i++) {
    for (const dep of byId(ids[i])?.after || []) {
      const j = ids.indexOf(dep);
      if (j > i) return [ids[i], dep];
    }
  }
  return null;
}

let dragId = null;
let orderTimer = 0;

// The queue in this order: shown at once, then kept by the server. later: after a pause, for a key held down.
function reorder(ids, later = false) {
  const bad = conflict(ids);
  if (bad) { toast(`${bad[0]} waits on ${bad[1]}, so it has to stay after it`, 'var(--amber)'); renderWorkboard(); return false; }
  ids.forEach((id, i) => { byId(id).order = i + 1; });
  renderWorkboard();
  const save = () => attempt('reorder Up next', async () => { await api.order(ids); await refresh(); });
  clearTimeout(orderTimer);
  if (later) orderTimer = setTimeout(save, 500); else save();
  return true;
}

// From the keyboard: the row that has focus moves one place, and keeps focus.
function moveRow(id, by) {
  const ids = queue().map(t => t.id), at = ids.indexOf(id), to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return;
  ids.splice(at, 1);
  ids.splice(to, 0, id);
  if (reorder(ids, true)) $(`#queue .q-row[data-id="${CSS.escape(id)}"]`)?.focus();
}

function initReorder() {
  const box = $('#queue');
  const clearMarks = () => box.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  box.addEventListener('dragstart', e => {
    const row = e.target.closest('.q-row');
    if (!row) return;
    dragId = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  box.addEventListener('dragend', () => { dragId = null; clearMarks(); box.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging')); });
  box.addEventListener('dragover', e => {
    const row = e.target.closest('.q-row');
    if (!dragId || !row) return;
    e.preventDefault();
    clearMarks();
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  box.addEventListener('drop', e => {
    const row = e.target.closest('.q-row');
    if (!dragId || !row) return;
    e.preventDefault();
    const before = row.classList.contains('drop-before');
    clearMarks();
    const ids = queue().map(t => t.id).filter(id => id !== dragId);
    const at = ids.indexOf(row.dataset.id) + (before ? 0 : 1);
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    reorder(ids);
  });
  box.addEventListener('keydown', e => {
    const row = e.target.closest('.q-row');
    if (!row || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    moveRow(row.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  });
}

export function initWorkboard() {
  initPopover('.card', el => { const t = byId(el.dataset.id); return t ? summary(t) : null; });
  initReorder();
  on('prose', renderWorkboard);
  // What the open card's sessions used has come in (session.js): its line under the title follows.
  on('session-usage', id => { if (openSheetKey() === id && sheetTask === id) drawTask(id); });
  $('#approvedBtn').addEventListener('click', showApproved);
  $('#archiveBtn').addEventListener('click', () => showArchive());
  $('#usageBtn').addEventListener('click', showUsage);

  // A different tab above the chat: the rail lists that thread's cards, and a card that was open gives way to the chat.
  on('thread', () => { closeSheet(); renderWorkboard(); });
  // A card's sheet was opened or closed: the rail marks the one that's open.
  on('sheet-opened', markOpenCard);
  on('sheet-closed', markOpenCard);

  const rail = $('#rail');
  rail.addEventListener('click', e => {
    const hit = selector => e.target.closest(selector);
    const card = hit('[data-id]')?.dataset.id;
    // The rail itself: a group folded away, and, on a narrow window, the row of counts opened to the lists.
    if (hit('[data-fold]')) {
      const key = hit('[data-fold]').dataset.fold;
      if (folded.has(key)) folded.delete(key); else folded.add(key);
      storage.set(FOLD_KEY, JSON.stringify([...folded]));
      renderBoard();
    } else if (hit('[data-rail]')) {
      const key = hit('[data-rail]').dataset.rail;
      railOpen = key ? true : !railOpen;
      if (key) folded.delete(key);
      renderBoard();
      if (key) rail.querySelector(`[data-group="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // A task's pictures (the conductor's questions handle their own).
    else if (hit('[data-pic-src]') && hit('[data-pic-set][data-q]')) openPicsFrom(hit('[data-pic-src]'), (label, set) => pick(card, +set.dataset.q, label));
    else if (hit('[data-play]')) play(hit('[data-play]').dataset.play);
    else if (hit('[data-plan-spec]')) showDoc(hit('[data-plan-spec]').dataset.planSpec);
    else if (hit('[data-pick]')) pick(card, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-resend]')) sendAnswers(card, unsent.get(card) || '');
    else if (hit('[data-back]')) { draft.set(`answers:${card}`, picksOf(card).slice(0, -1)); renderWorkboard(); }
    else if (hit('[data-approve]')) approve(hit('[data-approve]').dataset.approve);
    else if (hit('[data-queue]')) queueIt(hit('[data-queue]').dataset.queue);
    else if (hit('[data-dismiss]')) dismiss(hit('[data-dismiss]').dataset.dismiss);
    else if (hit('[data-queue-all]')) queueAll();
    else if (hit('[data-got-it]')) gotIt(card);
    else if (hit('[data-unask]')) unask(card);
    else if (hit('[data-plan-approve]')) approvePlan(card);
    // A plan or an answer is read as its card, whatever thread it has.
    else if (hit('[data-open]')) openTask(card, true);
    else if (hit('.card, .q-row, .feat')) openTask(card, hit('.s-plan, .s-question') != null);
    else return;
    // A card picked from the opened row of counts: the row closes, so the card's conversation shows.
    if (railOpen && hit('.card, .q-row, .feat') && openSheetKey()) { railOpen = false; renderBoard(); }
  });
  rail.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card, .q-row')) { e.preventDefault(); openTask(e.target.dataset.id, e.target.matches('.s-plan, .s-question')); }
  });

  // What's typed in a task's sheet is kept as it's typed.
  $('#sheet').addEventListener('input', e => { if (e.target.matches('[data-sheet-text]') && sheetTask) draft.set(`sheet:${sheetTask}`, e.target.value); });
  // A typed answer, or what's still wrong, goes with Enter; Shift+Enter starts a new line.
  $('#sheet').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || openSheetKey() !== sheetTask) return;
    if (e.target.id === 'answerText' && e.target.value.trim()) { e.preventDefault(); sendAnswers(sheetTask, e.target.value.trim()); }
    if (e.target.id === 'reopenText') { e.preventDefault(); sendBack(sheetTask); }
    // A message to a card's agent, as in a session (not a plan's changes or a question's follow-up: those have buttons).
    if (e.target.id === 'followText' && $('#sheet [data-send="follow"]') && e.target.value.trim()) { e.preventDefault(); sendFollowUp(sheetTask, e.target.value.trim()); }
  });
  // Screenshots for sending a task back: pasted anywhere while its sheet is open, dropped on the box, or picked.
  document.addEventListener('paste', e => {
    if (!openSheetKey() || !$('#reply')) return;
    const files = imagesIn(e.clipboardData?.items);
    if (!files.length) return;
    e.preventDefault();
    attachReply(files);
  });
  $('#sheet').addEventListener('change', e => {
    if (e.target.id === 'replyInput') { attachReply([...e.target.files]); e.target.value = ''; return; }
    // The lane or worker picked for the open task.
    const t = openSheetKey() === sheetTask && byId(sheetTask);
    if (t) partsChange(e, t, partsContext(t.id));
  });
  $('#sheet').addEventListener('dragover', e => { const box = e.target.closest('#reply'); if (box) { e.preventDefault(); box.classList.add('drag'); } });
  $('#sheet').addEventListener('dragleave', e => e.target.closest('#reply')?.classList.remove('drag'));
  $('#sheet').addEventListener('drop', e => {
    const box = e.target.closest('#reply');
    if (!box) return;
    e.preventDefault();
    box.classList.remove('drag');
    attachReply(imagesIn(e.dataTransfer.files));
  });

  // The controls inside a task's sheet (and today's approvals, whose rows open their tasks).
  $('#sheet').addEventListener('click', e => {
    const el = e.target, hit = selector => el.closest(selector);
    const key = openSheetKey();
    if (key === 'approved') { if (hit('.s-row')) openTask(hit('.s-row').dataset.id); else if (hit('[data-archive]')) showArchive(); return; }
    if (!key || key !== sheetTask) return;
    const id = key, text = () => sheetText(id).trim();
    // Its extra parts first (taskparts.js): stepping in on its worker, its checks, a file's lines, a link to it.
    if (byId(id) && partsClick(e, byId(id), partsContext(id))) return;
    if (hit('[data-pic-src]')) openPicsFrom(hit('[data-pic-src]'), (label, set) => pick(id, +set.dataset.q, label));
    else if (hit('[data-play]')) play(hit('[data-play]').dataset.play);
    else if (hit('[data-plan-spec]')) { closeSheet(); showDoc(hit('[data-plan-spec]').dataset.planSpec); }
    else if (hit('[data-pick]')) pick(id, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-answer]')) sendAnswers(id, text());
    else if (hit('[data-approve-open]')) { closeSheet(); setTimeout(() => approve(id), 250); }
    else if (hit('[data-send="reopen"]')) sendBack(id);
    else if (hit('[data-reply-attach]')) $('#replyInput').click();
    else if (hit('#replyShots')) shotClick(el, reply.shots).then(changed => { if (changed && openSheetKey() === id) drawTask(id); });
    else if (hit('[data-changes-retry]')) loadChanges(id);
    else if (hit('[data-send="follow"]') || hit('[data-revise]')) {
      if (!text()) { $('#followText').focus(); return; }
      if (hit('[data-revise]')) {
        const words = text();
        closeSheet();
        attempt('send it', async () => { await act(id, 'revise', words); draft.clear(`sheet:${id}`); toast('Changes asked for', 'var(--violet)'); }, id);
      } else sendFollowUp(id, text());
    } else if (hit('[data-plan-approve]')) { closeSheet(); approvePlan(id); }
    else if (hit('[data-got-it]')) { closeSheet(); gotIt(id); }
    else if (hit('[data-ask-more-send]')) {
      if (!text()) { $('#followText').focus(); return; }
      const words = text();
      closeSheet();
      askMore(id, words);
    } else if (hit('[data-queue-open]')) { closeSheet(); queueIt(id); }
    else if (hit('[data-promote]')) attempt('give it its own agent', async () => {
      await act(id, 'promote');
      // Its tab, once it has one (a worker still on it lets go first).
      if (hasThread(id) && byId(id)?.pending !== 'handoff') { closeSheet(); openThread(id); toast('It has an agent of its own now, on this tab', 'var(--accent-text)'); }
      else toast('It gets an agent of its own, on a tab above the chat, once its worker has let go', 'var(--accent-text)');
    }, id);
    else if (hit('[data-delete]')) deleteTask(id);
    else if (el.matches('.shots img')) { const src = el.getAttribute('src'); if (ui.big.has(src)) ui.big.delete(src); else ui.big.add(src); drawTask(id); }
    else if (hit('.s-row')) openTask(hit('.s-row').dataset.id);
    else if (hit('.ftag')) { const t = byId(id); if (t?.plan) openTask(t.plan); }
  });
}
