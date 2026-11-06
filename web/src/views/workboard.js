// The Workboard. Top: the note box, then what needs the user's OK: feature plans to approve, and what the agent
// spotted (the inbox). Middle: features in progress, then three columns: To test, Stuck and Working.
// Bottom: Up next, the queue in order, which the user can reorder (never ahead of what a task waits on).
import { state, byId, of, approvedToday } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { hhmm, minsSince, featureVars } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { settings } from '../settings.js';
import { toast } from '../ui/toast.js';
import { showSheet, closeSheet, openSheetKey } from '../ui/sheet.js';
import { initPopover, hidePopover } from '../ui/popover.js';
import { shotOf, imagesIn, shotsHTML, shotClick, clip } from '../ui/shots.js';
import { showDoc } from './docs.js';
import { prose, proseLine } from '../prose.js';
import { startSession, scrollSessionToEnd } from './session.js';

const NAMES = { ready: 'To test', stuck: 'Stuck', working: 'Working', queued: 'Up next', inbox: 'Inbox', done: 'Approved' };
const EMPTY = { ready: 'Nothing to test', stuck: 'Nothing stuck', working: 'No one working' };
const COLOR = { ready: 'var(--green)', stuck: 'var(--amber)', working: 'var(--blue)', queued: 'var(--gray)', inbox: 'var(--claude)', done: 'var(--green)' };
const TYPES = { bug: 'Bug', tweak: 'Tweak', idea: 'Idea', feature: 'Feature', question: 'Question' };
const SKIP = '\u0000skip';
const place = t => t.where === 'lane' ? 'Lane ' + t.lane : 'Main';
const isPlan = t => t.kind === 'plan';
const isQuestion = t => t.kind === 'question';
const work = status => of(status).filter(t => !isPlan(t) && !isQuestion(t));
// The user's questions to the conductor: waiting, or answered and not yet marked "got it".
const openQuestions = () => state.tasks.filter(t => isQuestion(t) && t.status !== 'done' && t.status !== 'removed');
const answered = () => openQuestions().filter(t => t.status === 'ready');
const approvedWork = () => approvedToday().filter(t => !isPlan(t) && !isQuestion(t));
const queue = () => work('queued').sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id));
const plansToApprove = () => state.tasks.filter(t => isPlan(t) && t.status === 'inbox');
// Features under way: not one whose every step was deleted, which has nothing left to show (planCount, below).
const features = () => state.tasks.filter(t => isPlan(t) && ['queued', 'working', 'stuck', 'ready'].includes(t.status) && planCount(t).total > 0);
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
const answers = new Map(); // task id -> picked answers, kept across re-renders
// The reply boxes on the board: a plan's "Change it" and "Ask", an answer's "Ask more". The board re-renders on every
// refresh and every 30 seconds, so each open box is kept here, with what's typed in it, until it's sent or closed.
const drafts = new Map(); // task id -> { mode, text }
const PLAN_PROMPT = { revise: 'What should change?', followup: 'Your question' };

// Where a queued task came from, for its tag in Up next.
const source = t => t.pending === 'reopen' ? ['Reopened', 'var(--amber)']
  : t.pending === 'answer' ? ['Answered', 'var(--amber)']
  : t.kind === 'suggestion' ? [`From Rocco`, 'var(--claude)']
  : t.kind === 'note' ? ['Your note', 'var(--violet)'] : null;

const typeTag = t => TYPES[t.type] && t.type !== 'feature' ? `<span class="ttag t-${t.type}">${TYPES[t.type]}</span>` : '';
const featureTag = t => { const p = t.plan && byId(t.plan); return p ? `<span class="ftag" style="${featureVars(p.id)}" title="Part of ${esc(p.title)}"><i></i>${esc(p.title)}</span>` : ''; };

// ---- Audio options ----

let player = null, playing = '';
function play(url, button) {
  const again = playing === url;
  player?.pause();
  document.querySelectorAll('.speaker.playing').forEach(b => b.classList.remove('playing'));
  playing = '';
  if (again) return;
  player = new Audio(url);
  playing = url;
  button.classList.add('playing');
  player.onended = () => { button.classList.remove('playing'); playing = ''; };
  player.play().catch(() => { button.classList.remove('playing'); toast("Couldn't play that sound", 'var(--red)'); });
}

const optionHTML = (o, i, picked) => `<span class="opt-wrap"><button class="opt${picked === o.label ? ' on' : ''}" data-pick="${esc(o.label)}" data-q="${i}" title="${esc(o.label)}"><span>${esc(o.label)}</span></button>`
  + `${o.audio ? `<button class="speaker" data-play="${esc(o.audio)}" title="Play" aria-label="Play ${esc(o.label)}">${icon.speaker}</button>` : ''}</span>`;

// ---- Columns ----

// The stuck card asks its questions one at a time, right on the board. The last answer sends them all (pick).
function questionCardHTML(t) {
  const qs = questionsOf(t), picked = answers.get(t.id) || [];
  if (!qs.length) return '';
  if (picked.length >= qs.length) return `<div class="ask-card done"><span class="spin"></span><span>Sending your answer${qs.length === 1 ? '' : 's'}</span></div>`;
  const i = picked.length, q = qs[i];
  return `<div class="ask-card"><div class="ask-q"><span>${proseLine(q.text)}</span>${qs.length > 1 ? `<span class="ask-n">${i + 1} of ${qs.length}</span>` : ''}</div>`
    + `<div class="opts">${(q.options || []).map(o => optionHTML(o, i, '')).join('')}</div>`
    + `<div class="ask-foot"><button class="linkish" data-pick="${SKIP}" data-q="${i}">Let Rocco decide</button>${i ? `<button class="linkish" data-back="${t.id}">Back</button>` : ''}</div></div>`;
}

function workingHTML(t) {
  if (!settings().liveSteps) return '';
  // This attempt's steps: a task sent back starts its list again.
  const since = Date.parse(t.startedAt) || 0;
  const done = t.log.filter(l => l.who === 'worker' && (Date.parse(l.at) || 0) >= since).slice(-3);
  return `<ol class="steps">${done.map(l => `<li>${icon.check}<span>${esc(l.text)}</span></li>`).join('')}`
    + `<li class="now"><span class="spin"></span><span>${esc(t.step || 'Working')}</span></li></ol>`;
}

function cardHTML(t) {
  const title = `<div class="c-title">${t.feature && !t.plan ? icon.branch : ''}<span>${esc(t.title)}</span></div>`;
  const tries = t.attempt > 1 ? `<span class="note-meta" title="Attempt ${t.attempt}">${icon.retry}${t.attempt}</span>` : '';
  const follow = t.followups > 0 ? `<span class="fchip" title="The worker hasn't read your follow-up yet">Follow-up sent</span>` : '';
  let info = typeTag(t) + featureTag(t), right = '', extra = '';
  if (t.status === 'ready') {
    info += `<span class="tag ${t.where === 'lane' ? 't-lane' : 't-main'}"><i></i>${place(t)}</span>${tries}`;
    right = `<button class="chk" role="checkbox" aria-checked="false" data-approve="${t.id}" aria-label="Tested, approve" title="Tested, approve">${icon.check}</button>`;
  } else if (t.status === 'stuck') {
    info += tries;
    right = questionsOf(t).length ? '' : `<span class="qm" title="Needs your answer">?</span>`;
    extra = questionCardHTML(t);
  } else if (t.status === 'working') {
    info += `<span class="note-meta">${settings().liveSteps ? '' : `${esc(t.step || 'Working')} · `}${minsSince(t.startedAt)}m</span>${follow}`;
    right = t.lane ? `<span class="lc" title="Lane ${t.lane}">L${t.lane}</span>` : '';
    extra = workingHTML(t);
  }
  const bar = t.status === 'working'
    ? (typeof t.progress === 'number' ? `<div class="bar"><i style="width:${Math.max(3, t.progress)}%"></i></div>` : '<div class="progress"></div>') : '';
  return `<div class="card s-${t.status}${t.fresh ? ' fresh' : ''}" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(t.title)}">`
    + `<div class="c-row"><div class="c-main">${title}<div class="c-meta">${info}</div></div>${right}</div>${extra}${bar}</div>`;
}

function columnHTML(status) {
  const list = work(status);
  return `<div class="col c-${status}"><div class="col-head"><span class="sdot"></span>${NAMES[status]}<span class="count">${list.length}</span></div>`
    + `<div class="col-list">${list.length ? list.map(cardHTML).join('') : `<div class="empty">${EMPTY[status]}</div>`}</div></div>`;
}

// ---- Feature plans: their own look, in the feature's color ----

const stepsHTML = p => `<ol class="plan-steps">${(p.steps || []).map((s, i) => `<li><span class="ps-n">${i + 1}</span><span class="ps-t">${esc(s.title)}</span>`
  + `<span class="ps-meta">${s.lane ? `Lane ${s.lane}` : ''}${s.lane && s.tier ? ' · ' : ''}${esc(s.tier || '')}</span></li>`).join('')}</ol>`;

// A plan's spec (rocco.ps1 plan -Spec): what it builds, in full, opened in Docs.
const specButton = p => p.spec ? `<span class="sp"></span><button class="btn-sm" data-plan-spec="${esc(p.spec)}" title="${esc(p.spec)}">${icon.doc}Read the spec</button>` : '';

function planCardHTML(p) {
  const d = drafts.get(p.id);
  return `<div class="plan${p.fresh ? ' fresh' : ''}" style="${featureVars(p.id)}" data-id="${p.id}">`
    + `<div class="plan-top"><span class="plan-badge">${icon.layers}Feature plan</span><span class="sp"></span><span class="s-id">${p.id}</span>`
    + `<button class="plan-x" data-plan-dismiss="${p.id}" title="Dismiss this plan" aria-label="Dismiss this plan">×</button></div>`
    + `<div class="plan-title">${esc(p.title)}</div>${p.summary ? `<div class="plan-sum">${prose(p.summary)}</div>` : ''}${stepsHTML(p)}`
    + (p.pending === 'revise' ? '<div class="plan-note">Changes asked for · waiting for Rocco</div>' : '')
    + `<div class="plan-actions"><button class="btn-sm go" data-plan-approve="${p.id}">Approve plan</button>`
    + `<button class="btn-sm" data-plan-reply="${p.id}" data-mode="revise">Change it</button><button class="btn-sm" data-plan-reply="${p.id}" data-mode="followup">Ask</button>`
    + `${specButton(p)}</div>`
    + `<div class="plan-reply"${d ? ` data-mode="${d.mode}"` : ' hidden'}><textarea class="field" placeholder="${d ? PLAN_PROMPT[d.mode] : ''}">${esc(d?.text || '')}</textarea>`
    + `<div class="row"><span class="sp"></span><button class="btn-sm go" data-plan-send="${p.id}">Send</button></div></div></div>`;
}

function featuresHTML() {
  return features().map(p => {
    const { done, total } = planCount(p);
    return `<button class="feat" style="${featureVars(p.id)}" data-id="${p.id}" title="${esc(p.title)}"><span class="feat-dot"></span><span class="feat-name">${esc(p.title)}</span>`
      + `<span class="feat-bar"><i style="width:${Math.round(done / Math.max(total, 1) * 100)}%"></i></span><span class="feat-count">${done}/${total}</span></button>`;
  }).join('');
}

// ---- Questions: asked from the note box, answered by the conductor ----

function questionHTML(t) {
  const done = t.status === 'ready';
  const status = done ? `<span class="qa-state on">Answered</span>` : `<span class="qa-state"><span class="spin"></span>Waiting for an answer</span>`;
  return `<div class="qa${done ? ' answered' : ''}${t.fresh ? ' fresh' : ''}" data-id="${t.id}">`
    + `<div class="qa-q" title="Open the whole thread"><span class="qa-icon">?</span><span class="qa-text">${esc(t.note || t.title)}</span>${status}</div>`
    // After "Ask more", the follow-up it's waiting on.
    + (!done && t.attempt > 1 ? `<div class="qa-follow">${esc(t.log.filter(l => l.who === 'you').at(-1)?.text || '')}</div>` : '')
    + (done ? `<div class="qa-a">${prose(t.summary || '')}</div>`
      + `<div class="qa-actions"><button class="btn-sm go" data-got-it="${t.id}">${icon.check}Got it</button><button class="btn-sm" data-ask-more="${t.id}">Ask more</button></div>`
      + `<div class="qa-reply"${drafts.has(t.id) ? '' : ' hidden'}><textarea class="field" placeholder="Ask a follow-up">${esc(drafts.get(t.id)?.text || '')}</textarea>`
      + `<div class="row"><span class="sp"></span><button class="btn-sm go" data-ask-send="${t.id}">Ask</button></div></div>`
      : `<div class="qa-actions"><button class="linkish" data-unask="${t.id}">Take it back</button></div>`)
    + `</div>`;
}

const questionsHTML = () => openQuestions().sort((a, b) => a.id.localeCompare(b.id)).map(questionHTML).join('');

// ---- Inbox: what the agent spotted ----

function inboxHTML() {
  const list = work('inbox');
  if (!list.length) return '';
  const why = t => t.summary || (t.note && t.note !== t.title ? t.note : '');
  return `<div class="inbox-head">${icon.sparkle}Rocco spotted ${list.length === 1 ? 'something' : `${list.length} things`}<span class="sp"></span>`
    + `${list.length > 1 ? '<button class="btn-sm" data-queue-all>Queue all</button>' : ''}</div>`
    + `<div class="inbox-items">${list.map(t => `<div class="sug${t.fresh ? ' fresh' : ''}" data-id="${t.id}"><div class="sug-title">${esc(t.title)}</div>`
      + `${why(t) ? `<div class="sug-why">${esc(why(t))}</div>` : ''}`
      + `<div class="sug-actions"><button class="btn-sm go" data-queue="${t.id}">Queue</button><button class="btn-sm" data-dismiss="${t.id}">Dismiss</button></div></div>`).join('')}</div>`;
}

// ---- Up next ----

function queueHTML() {
  const list = queue();
  const row = (t, i) => {
    const src = source(t), deps = unfinishedDeps(t);
    return `<div class="q-row${t.fresh ? ' fresh' : ''}" data-id="${t.id}" draggable="true" tabindex="0" role="button">`
      + `<span class="grip" aria-hidden="true">${icon.grip}</span><span class="q-num">${i + 1}</span>`
      + `<span class="q-title">${t.feature && !t.plan ? icon.branch : ''}<span>${esc(t.title)}</span>${t.shots[0] ? `<img src="${t.shots[0]}" alt="">` : ''}</span>`
      + typeTag(t) + featureTag(t)
      + `${src ? `<span class="q-src" style="--sc:${src[1]}">${src[0]}</span>` : ''}`
      // A task waiting on another shows that, with the reason on hover; the rest show what they wait for.
      + (deps.length ? `<span class="q-dep" title="${esc(t.waiting || `Needs ${deps.join(', ')} done first`)}">${icon.lock}After ${deps.join(', ')}</span>`
        : `<span class="q-wait${t.pending ? ' conductor' : ''}">${icon.clock}<span>${esc(waitText(t) || 'Queued')}</span></span>`) + '</div>';
  };
  // Whether a conductor is there to pick things up is the status line above the note box (conductor.js).
  return `<div class="col-head">${icon.queue}Up next<span class="count">${list.length}</span>${list.length > 1 ? '<span class="q-hint">Drag to reorder</span>' : ''}</div>`
    + (list.length ? `<div class="q-list">${list.map(row).join('')}</div>` : '<div class="empty">Nothing queued. Notes you add go here.</div>');
}

// The server opened a conductor because none was running: say so.
export function conductorOpened(agent) { if (agent) toast(`${agent} started, minimized in your taskbar, to pick it up`, 'var(--claude)'); }

// The cursor in a reply box (drafts, above), put back after the board re-renders.
function keepTyping(render) {
  const f = document.activeElement;
  const box = f?.matches?.('.plan-reply textarea, .qa-reply textarea') ? f : null;
  const at = box && { id: box.closest('[data-id]').dataset.id, start: box.selectionStart, end: box.selectionEnd, top: box.scrollTop };
  render();
  if (!at) return;
  const again = [...document.querySelectorAll('#plans .plan-reply textarea, #questions .qa-reply textarea')].find(t => t.closest('[data-id]').dataset.id === at.id);
  if (!again || again === box) return;
  again.focus({ preventScroll: true });
  again.setSelectionRange(at.start, at.end);
  again.scrollTop = at.top;
}

export function renderWorkboard() {
  keepTyping(renderBoard);
}

function renderBoard() {
  const ready = work('ready').length, stuck = work('stuck').length, asks = work('inbox').length + plansToApprove().length, replies = answered().length;
  const waiting = ready + stuck + asks + replies;
  $('#boardSub').textContent = [ready && `${ready} to test`, stuck && `${stuck} stuck`, asks && `${asks} waiting for your OK`, replies && `${replies} answer${replies === 1 ? '' : 's'} for you`].filter(Boolean).join(' · ');
  $('#boardBadge').textContent = waiting;
  $('#boardBadge').hidden = !waiting;
  $('#approvedText').textContent = `${approvedWork().length} approved today`;
  $('#questions').innerHTML = questionsHTML();
  $('#questions').hidden = !openQuestions().length;
  $('#plans').innerHTML = plansToApprove().map(planCardHTML).join('');
  $('#plans').hidden = !plansToApprove().length;
  $('#inbox').innerHTML = inboxHTML();
  $('#inbox').hidden = !work('inbox').length;
  $('#features').innerHTML = featuresHTML();
  $('#features').hidden = !features().length;
  $('#board').innerHTML = columnHTML('ready') + columnHTML('stuck') + columnHTML('working');
  $('#queue').innerHTML = queueHTML();
  document.title = waiting ? `(${waiting}) Rocco` : 'Rocco';
  state.tasks.forEach(t => { t.fresh = false; });
}

// The steps to try: one a line (rocco.ps1 set -Test "a","b").
const stepsOf = t => String(t.test || '').split('\n').map(s => s.trim()).filter(Boolean);
const stepsHTMLOf = steps => steps.length > 1 ? `<ul>${steps.map(s => `<li>${proseLine(s)}</li>`).join('')}</ul>` : proseLine(steps[0] || '');
// A task parked for a lane (rocco.ps1 set -ForLane): whether one is free now, counted as the sidebar counts them.
function waitText(t) {
  if (t.waitingFor !== 'lane') return t.waiting;
  const count = state.meta.lanes?.count || 0;
  const held = new Set(state.tasks.filter(x => x.lane && (x.status === 'working' || x.status === 'stuck' || (x.where === 'lane' && (x.status === 'ready' || x.status === 'queued')))).map(x => x.lane));
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
function summaryHTML(t) {
  const head = label => `<div class="ph"><span class="sdot" style="--c:${COLOR[t.status]}"></span>${label}</div>`;
  const words = 30, more = '<div class="pmore">Open it for the rest</div>';
  const sum = cutWords([t.summary || ''], words);
  switch (t.status) {
    case 'ready': {
      const test = cutWords(stepsOf(t), words);
      return head(`Ready to test · ${place(t)}`)
        + (sum.out.length ? `<div class="pl">What changed</div><div class="pt">${esc(sum.out[0])}</div>` : '')
        + (test.out.length ? `<div class="try"><div class="pl">Try</div>${stepsHTMLOf(test.out)}</div>` : '')
        + (sum.cut || test.cut ? more : '');
    }
    case 'stuck': {
      const qs = cutWords(questionsOf(t).map(q => q.text), words * 2);
      return head('Needs your answer') + `<div class="pt">${esc(qs.out.join(' · '))}</div>` + (qs.cut ? more : '');
    }
    case 'working':
      return head(`${esc(t.step || 'Working')} · ${lanePart(t)} · ${minsSince(t.startedAt)}m`)
        + `<div class="pt">${sum.out.length ? esc(sum.out[0]) : 'No report yet'}</div>` + (sum.cut ? more : '');
  }
  return '';
}

// ---- A task in the sheet ----

function whereLine(t) {
  if (isPlan(t)) return t.status === 'inbox' ? 'Feature plan · waiting for your OK' : `Feature · ${planCount(t).done} of ${planCount(t).total} done`;
  if (isQuestion(t)) return t.status === 'ready' ? 'Answered' : t.status === 'done' ? `Got it at ${hhmm(t.doneAt)}` : 'Waiting for an answer';
  switch (t.status) {
    case 'ready': return `Test in ${place(t)}${t.where === 'lane' ? ' · approving merges it into Main' : ''}`;
    case 'stuck': return t.lane ? `Lane ${t.lane}` : '';
    case 'working': return `${t.lane ? `Lane ${t.lane}` : 'The conductor'} · ${minsSince(t.startedAt)}m${typeof t.progress === 'number' ? ` · ${t.progress}%` : ''}`;
    case 'queued': return esc(waitText(t) || 'Queued');
    case 'inbox': return `Rocco spotted this. Queue it to have it done.`;
    case 'done': return `Approved at ${hhmm(t.doneAt)}${t.pending === 'merge' ? ' · merging into Main' : ''}`;
  }
  return '';
}

function questionsSheetHTML(t) {
  const picked = answers.get(t.id) || [];
  return questionsOf(t).map((q, i) => `<div class="s-q">${proseLine(q.text)}</div><div class="opts">${(q.options || []).map(o => optionHTML(o, i, picked[i])).join('')}`
    + `<button class="opt${picked[i] === SKIP ? ' on' : ''}" data-pick="${SKIP}" data-q="${i}">Let Rocco decide</button></div>`).join('');
}

// The top of the sheet (what it is, what to try, Approve, its questions) stays in view while the session scrolls under it.
function sheetBody(t) {
  return `<div class="s-top">${sheetTop(t)}</div>${sheetRest(t)}`;
}

// A task to test is approved from what to try; sending it back is the box at the foot.
const approveHTML = t => isQuestion(t) ? '' : `<button class="btn go s-approve" data-approve-open>${icon.checkSm}Approve</button>`;

function sheetTop(t) {
  const meta = [typeTag(t), featureTag(t)].join('');
  let h = `<h2 class="s-title">${esc(t.title)}</h2><div class="s-where">${whereLine(t)}</div>${meta ? `<div class="c-meta">${meta}</div>` : ''}`;
  if (t.summary) h += `<div class="s-sum">${prose(t.summary)}</div>`;
  if (isPlan(t)) {
    h += stepsHTML(t);
    if (t.spec) h += `<div class="row s-spec">${specButton(t).replace('<span class="sp"></span>', '')}</div>`;
    const kids = childrenOf(t);
    if (kids.length) h += `<div class="sec-h">Tasks</div>${kids.map(k => `<div class="s-row" data-id="${k.id}"><span class="sdot" style="--c:${COLOR[k.status] || 'var(--gray)'}"></span><span>${esc(k.title)}</span><span class="at">${NAMES[k.status] || ''}</span></div>`).join('')}`;
  }
  if (t.status === 'ready' && t.test) h += `<div class="s-try"><small>Try</small>${stepsHTMLOf(stepsOf(t))}${approveHTML(t)}</div>`;
  else if (t.status === 'ready') h += approveHTML(t);
  if (t.status === 'stuck') h += questionsSheetHTML(t);
  return h;
}

function sheetRest(t) {
  let h = '';
  if (t.shots.length) h += `<div class="shots">${t.shots.map(src => `<img src="${src}" alt="Screenshot">`).join('')}</div>`;
  if (t.note && t.note !== t.title) h += `<div class="s-note">${esc(t.note)}</div>`;
  if (t.branch) h += `<div class="sec-h">What changed</div><div class="changes" id="changes"><span class="mut">Loading…</span></div>`;
  // Its agent's session and the card's history, word for word (session.js).
  h += `<div class="sec-h">Session</div><div class="sx" id="sx"><div class="sx-empty"><span class="spin"></span>Loading</div></div>`;
  return h;
}

// The round send button, as on the note box: Enter does the same.
const sendButton = (attr, label) => `<button type="button" class="send" ${attr} title="${label} (Enter)" aria-label="${label}">`
  + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>';

const followUpHTML = placeholder => `<div class="reply msg"><textarea class="field" id="followText" placeholder="${placeholder}"></textarea>`
  + `<div class="row"><span class="sp"></span>${sendButton('data-follow', 'Send')}</div></div>`;

// ---- Sending a task back: a box that's always open under To test, with screenshots like the note box ----

let reply = { id: '', shots: [] }; // the sheet's task, and the screenshots going back with it

const replyHTML = () => `<div class="reply" id="reply"><div class="drafts" id="replyShots">${shotsHTML(reply.shots)}</div>`
  + `<textarea class="field" id="reopenText" placeholder="Not right yet? Say what's wrong, paste or drop a screenshot, and press Enter to send it back"></textarea>`
  + `<div class="row"><button type="button" class="tool" data-reply-attach title="Attach screenshots" aria-label="Attach screenshots">${clip}</button>`
  + `<input type="file" id="replyInput" accept="image/*" multiple hidden><span class="sp"></span>${sendButton('data-reopen', 'Send it back')}</div></div>`;

function attachReply(files) {
  const added = files.map(shotOf).filter(Boolean);
  if (!added.length || !$('#replyShots')) return;
  reply.shots.push(...added);
  $('#replyShots').innerHTML = shotsHTML(reply.shots);
  $('#reopenText').focus();
}

// The screenshots go up first, so the conductor finds them, named in the text, when the task comes back to it.
async function sendBack(id) {
  const text = $('#reopenText').value.trim(), shots = [...reply.shots];
  if (!text && !shots.length) { $('#reopenText').focus(); toast("Say what's still wrong, or add a screenshot", 'var(--amber)'); return; }
  $('#reopenText').disabled = true;
  await attempt('send it back', async () => {
    const names = [];
    for (const s of shots) { const { name } = await api.shot(id, s.file); if (name) names.push(name); }
    await act(id, 'reopen', [text, names.length ? `Screenshots: ${names.join(', ')}` : ''].filter(Boolean).join('\n'));
    reply = { id: '', shots: [] };
    toast('Sent back to Rocco', 'var(--amber)');
    stayOpen(id);
  });
  if ($('#reopenText')) $('#reopenText').disabled = false;
}

function sendFollowUp(id, text) {
  $('#followText').disabled = true;
  attempt('send it', async () => { await act(id, 'followup', text); toast('Sent to Rocco', 'var(--violet)'); stayOpen(id); })
    .finally(() => { if ($('#followText')) $('#followText').disabled = false; });
}

// After you send a card something, it stays open like a session: your words show in it, and what its agent does next.
function stayOpen(id) {
  if (openSheetKey() !== id) return;
  openTask(id);
  scrollSessionToEnd();
}

function sheetFoot(t) {
  if (isQuestion(t)) {
    if (t.status === 'ready') return `<div class="row"><button class="btn go" data-got-it="${t.id}">${icon.checkSm}Got it</button></div>`
      + `<textarea class="field" id="followText" placeholder="Ask a follow-up"></textarea><div class="row"><span class="sp"></span><button class="btn" data-ask-more-send>Ask more</button></div>`;
    if (t.status === 'done') return '';
    return followUpHTML('Add to your question');
  }
  if (isPlan(t) && t.status === 'inbox') return `<div class="row"><button class="btn accent" style="flex:1" data-plan-approve="${t.id}">Approve plan</button></div>`
    + `<textarea class="field" id="followText" placeholder="Want changes? Say what, then send"></textarea><div class="row"><span class="sp"></span><button class="btn" data-revise>Ask for changes</button></div>`;
  if (t.status === 'ready') return replyHTML();
  if (t.status === 'stuck') return `<textarea class="field" id="answerText" placeholder="${questionsOf(t).length ? 'Anything to add? Type it before you pick, or press Enter to send it' : 'Your answer. Enter sends it'}"></textarea><div class="row"><button class="btn warm" data-answer>Send answer</button></div>`;
  if (t.status === 'inbox') return `<div class="row"><button class="btn accent" style="flex:1" data-queue-open>Queue it</button></div>`;
  if (isPlan(t)) return followUpHTML('Add something about this feature, for Rocco');
  if (t.status === 'working') return followUpHTML('Message its agent. It reads it at its next step');
  if (t.status === 'queued') return followUpHTML('Add more for its agent, for when it starts');
  return '';
}

// ---- Deleting a task, from its sheet: a second click confirms, and Undo takes it back for a few seconds ----

// Work a worker is on, or that's done on a branch but not merged: the conductor stops it and drops it.
const running = t => t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && !!t.branch && (t.status !== 'done' || t.pending === 'merge'));

const deleteHTML = t => `<button class="btn-sm danger" data-delete>${isPlan(t) && childrenOf(t).length ? 'Delete plan' : 'Delete'}</button>`;

function deletedText(t) {
  if (isPlan(t)) return childrenOf(t).length ? 'Deleted the plan and its tasks' : 'Plan deleted';
  if (isQuestion(t)) return 'Question deleted';
  if (running(t)) return 'Deleted. The conductor stops its work.';
  if (t.status === 'ready' || t.status === 'done') return 'Deleted. What it changed stays in Main.';
  return 'Deleted';
}

function deleteTask(id, button) {
  const t = byId(id);
  if (!t) return;
  if (!button.classList.contains('confirm')) {
    button.classList.add('confirm');
    button.textContent = running(t) || (isPlan(t) && childrenOf(t).some(running)) ? 'Stop and delete?' : 'Delete it?';
    return;
  }
  closeSheet();
  attempt('delete it', async () => { await act(id, 'remove'); undoable(id, deletedText(t), 'var(--gray)'); });
}

async function loadChanges(t) {
  try {
    const c = await api.changes(t.id);
    const box = $('#changes');
    if (!box || openSheetKey() !== t.id) return;
    // Reading at the end of the session, it stays there as this fills in above.
    const body = $('#sBody'), fromEnd = body.scrollHeight - body.scrollTop;
    const atEnd = fromEnd - body.clientHeight < 40;
    box.innerHTML = c.files.length
      ? c.files.map(f => `<div class="chg"><span class="chg-path">${esc(f.path)}</span><span class="chg-add">+${f.added}</span><span class="chg-del">−${f.removed}</span></div>`).join('')
        + `<div class="chg-foot">${c.source === 'merged' ? 'As merged into main' : 'On its branch, against main'}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noreferrer">View on GitHub</a>` : ''}</div>`
      : '<span class="mut">No changes found for its branch yet.</span>';
    if (atEnd) body.scrollTop = body.scrollHeight;
  } catch { /* the sheet just keeps "Loading…" */ }
}

export function openTask(id) {
  const t = byId(id);
  if (!t) return;
  const color = isPlan(t) ? 'var(--accent)' : isQuestion(t) ? 'var(--claude)' : COLOR[t.status];
  const chip = isPlan(t) ? 'Feature plan' : isQuestion(t) ? 'Question' : NAMES[t.status];
  if (reply.id !== id) reply = { id, shots: [] };
  showSheet(id, { color, chip, id: t.id, body: sheetBody(t), foot: sheetFoot(t), tools: deleteHTML(t), wide: true });
  if (t.branch) loadChanges(t);
  startSession(id);
}

function openApproved() {
  const list = approvedWork();
  showSheet('approved', {
    color: COLOR.done,
    chip: 'Approved today',
    body: `<h2 class="s-title">${list.length} approved today</h2><div style="margin-top:12px">`
      + list.map(t => `<div class="s-row" data-id="${t.id}">${icon.checkSm}<span>${esc(t.title)}</span>`
        + `${t.pending === 'merge' ? '<span class="tag t-merge"><i></i>Merging</span>' : ''}<span class="at">${hhmm(t.doneAt)}</span></div>`).join('') + '</div>',
  });
}

// ---- What the user does ----

async function attempt(what, fn) {
  try { await fn(); } catch (e) { toast(`Couldn't ${what}: ${e.message}`, 'var(--red)'); renderWorkboard(); }
}

async function act(id, action, text) {
  const { opened } = await api.act(id, action, text);
  await refresh();
  // After the caller's own toast.
  if (opened) setTimeout(() => conductorOpened(opened), 1600);
}

// Approve, answer, queue and dismiss can be taken back for a few seconds.
const undoable = (id, message, color) => toast(message, color, { label: 'Undo', run: () => attempt('undo it', () => act(id, 'undo')) });

function collapse(el) {
  el.style.height = el.offsetHeight + 'px';
  el.classList.add('collapse');
  requestAnimationFrame(() => Object.assign(el.style, { height: '0px', opacity: '0', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', borderWidth: '0px' }));
}

// The box lights up, the card folds away, then the server hears about it.
async function approve(id) {
  const t = byId(id);
  if (!t) return;
  const box = document.querySelector(`[data-approve="${id}"]`), card = box && box.closest('.card');
  hidePopover();
  if (box) { box.classList.add('on'); box.setAttribute('aria-checked', 'true'); }
  setTimeout(() => card && collapse(card), 420);
  await new Promise(r => setTimeout(r, 760));
  await attempt('approve it', async () => {
    await act(id, 'approve');
    undoable(id, t.where === 'lane' ? `Approved. The conductor merges “${t.title}” into Main.` : `Approved “${t.title}”`, t.where === 'lane' ? 'var(--cyan)' : 'var(--green)');
    const button = $('#approvedBtn');
    button.classList.remove('bump'); void button.offsetWidth; button.classList.add('bump');
  });
}

const queueIt = id => attempt('queue it', async () => { await act(id, 'queue'); undoable(id, 'Added to Up next', 'var(--violet)'); });
const gotIt = id => attempt('close it', async () => { await act(id, 'approve'); undoable(id, 'Got it', 'var(--claude)'); });
const askMore = (id, text) => attempt('ask it', async () => { await act(id, 'reopen', text); drafts.delete(id); renderWorkboard(); toast('Asked. The answer shows here.', 'var(--claude)'); });
const unask = id => attempt('take it back', async () => { await act(id, 'remove'); undoable(id, 'Question taken back', 'var(--gray)'); });
const dismiss = id => attempt('dismiss it', async () => { await act(id, 'remove'); undoable(id, 'Dismissed', 'var(--gray)'); });
const queueAll = () => attempt('queue them', async () => {
  const n = work('inbox').length;
  const { opened } = await api.send();
  await refresh();
  toast(`Added ${n} to Up next`, 'var(--violet)');
  if (opened) setTimeout(() => conductorOpened(opened), 1600);
});

function answerText(t, extra) {
  const picked = answers.get(t.id) || [];
  // "Pick a sound: Blade swing", "Every swing or only on hits? Only on hits"
  const line = (q, answer) => q.text.trim().endsWith('?') ? `${q.text.trim()} ${answer}` : `${q.text.trim().replace(/[.:]+$/, '')}: ${answer}`;
  const lines = questionsOf(t).map((q, i) => picked[i] === undefined ? '' : line(q, picked[i] === SKIP ? 'your call' : picked[i])).filter(Boolean);
  if (extra) lines.push(extra);
  return lines.join('\n');
}

// Sent straight away, with a few seconds to take it back.
async function sendAnswers(id, extra = '') {
  const t = byId(id), text = t && answerText(t, extra);
  if (!text) { toast('Pick an answer, or write one', 'var(--amber)'); return; }
  closeSheet();
  renderWorkboard();
  try {
    await act(id, 'answer', text);
    undoable(id, 'Answer sent to Rocco', 'var(--amber)');
  } catch (e) {
    toast(`Couldn't send the answer: ${e.message}`, 'var(--red)');
  }
  answers.delete(id);
  renderWorkboard();
}

// Picking the last unanswered question's option sends them all, with anything typed in the sheet's box.
function pick(taskId, q, value) {
  const t = byId(taskId);
  const picked = [...(answers.get(taskId) || [])];
  picked[q] = value;
  answers.set(taskId, picked.slice(0, Math.max(q + 1, picked.length)));
  if (t && questionsOf(t).every((_, i) => picked[i] !== undefined)) {
    sendAnswers(taskId, openSheetKey() === taskId ? $('#answerText')?.value.trim() || '' : '');
    return;
  }
  if (openSheetKey() === taskId) openTask(taskId); else renderWorkboard();
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
    const bad = conflict(ids);
    if (bad) { toast(`${bad[0]} waits on ${bad[1]}, so it has to stay after it`, 'var(--amber)'); renderWorkboard(); return; }
    ids.forEach((id, i) => { byId(id).order = i + 1; });
    renderWorkboard();
    attempt('reorder Up next', async () => { await api.order(ids); await refresh(); });
  });
}

export function initWorkboard() {
  initPopover('.card', el => { const t = byId(el.dataset.id); return t ? summaryHTML(t) : ''; });
  initReorder();
  $('#approvedBtn').addEventListener('click', openApproved);

  const view = $('.view[data-view="workboard"]');
  view.addEventListener('click', e => {
    const hit = selector => e.target.closest(selector);
    const card = hit('[data-id]')?.dataset.id;
    if (hit('[data-play]')) play(hit('[data-play]').dataset.play, hit('[data-play]'));
    else if (hit('[data-plan-spec]')) showDoc(hit('[data-plan-spec]').dataset.planSpec);
    else if (hit('[data-pick]')) pick(card, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-back]')) { answers.set(card, (answers.get(card) || []).slice(0, -1)); renderWorkboard(); }
    else if (hit('[data-approve]')) approve(hit('[data-approve]').dataset.approve);
    else if (hit('[data-queue]')) queueIt(hit('[data-queue]').dataset.queue);
    else if (hit('[data-dismiss]')) dismiss(hit('[data-dismiss]').dataset.dismiss);
    else if (hit('[data-queue-all]')) queueAll();
    else if (hit('[data-got-it]')) gotIt(card);
    else if (hit('[data-unask]')) unask(card);
    else if (hit('[data-ask-more]')) {
      const box = hit('.qa').querySelector('.qa-reply');
      box.hidden = !box.hidden;
      if (box.hidden) drafts.delete(card); else { drafts.set(card, { mode: 'more', text: box.querySelector('textarea').value }); box.querySelector('textarea').focus(); }
    } else if (hit('[data-ask-send]')) {
      const field = hit('.qa-reply').querySelector('textarea'), text = field.value.trim();
      if (!text) { field.focus(); return; }
      askMore(card, text);
    } else if (hit('.qa-reply')) { /* typing in it */ }
    else if (hit('.qa-q')) openTask(card);
    else if (hit('[data-plan-approve]')) attempt('approve the plan', async () => { await act(card, 'approve-plan'); toast('Plan approved. Rocco starts it.', 'var(--accent-text)'); });
    else if (hit('[data-plan-dismiss]')) attempt('dismiss the plan', async () => { await act(card, 'remove'); drafts.delete(card); undoable(card, 'Plan dismissed', 'var(--gray)'); });
    else if (hit('[data-plan-reply]')) {
      const box = hit('.plan').querySelector('.plan-reply'), mode = hit('[data-plan-reply]').dataset.mode;
      const field = box.querySelector('textarea');
      box.hidden = box.dataset.mode === mode ? !box.hidden : false;
      box.dataset.mode = mode;
      field.placeholder = PLAN_PROMPT[mode];
      if (box.hidden) drafts.delete(card); else { drafts.set(card, { mode, text: field.value }); field.focus(); }
    } else if (hit('[data-plan-send]')) {
      const box = hit('.plan-reply'), text = box.querySelector('textarea').value.trim();
      if (!text) { box.querySelector('textarea').focus(); return; }
      attempt('send it', async () => {
        await act(card, box.dataset.mode === 'revise' ? 'revise' : 'followup', text);
        drafts.delete(card);
        renderWorkboard();
        toast('Sent to Rocco', 'var(--accent-text)');
      });
    } else if (hit('.plan-reply')) { /* typing in it */ }
    else if (hit('.card, .sug, .q-row, .feat, .plan')) openTask(card);
  });
  view.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card, .q-row')) { e.preventDefault(); openTask(e.target.dataset.id); }
  });
  view.addEventListener('input', e => {
    const box = e.target.closest('.plan-reply, .qa-reply'), id = e.target.closest('[data-id]')?.dataset.id;
    if (box && id) drafts.set(id, { mode: box.dataset.mode || 'more', text: e.target.value });
  });

  // A typed answer, or what's still wrong, goes with Enter; Shift+Enter starts a new line.
  $('#sheet').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target.id === 'answerText' && e.target.value.trim()) { e.preventDefault(); sendAnswers(openSheetKey(), e.target.value.trim()); }
    if (e.target.id === 'reopenText') { e.preventDefault(); sendBack(openSheetKey()); }
    // A message to a card's agent, as in a session (not a plan's changes or a question's follow-up: those have buttons).
    if (e.target.id === 'followText' && $('[data-follow]') && e.target.value.trim()) { e.preventDefault(); sendFollowUp(openSheetKey(), e.target.value.trim()); }
  });
  // Screenshots for sending a task back: pasted anywhere while its sheet is open, dropped on the box, or picked.
  document.addEventListener('paste', e => {
    if (!openSheetKey() || !$('#reply')) return;
    const files = imagesIn(e.clipboardData?.items);
    if (!files.length) return;
    e.preventDefault();
    attachReply(files);
  });
  $('#sheet').addEventListener('change', e => { if (e.target.id === 'replyInput') { attachReply([...e.target.files]); e.target.value = ''; } });
  $('#sheet').addEventListener('dragover', e => { const box = e.target.closest('#reply'); if (box) { e.preventDefault(); box.classList.add('drag'); } });
  $('#sheet').addEventListener('dragleave', e => e.target.closest('#reply')?.classList.remove('drag'));
  $('#sheet').addEventListener('drop', e => {
    const box = e.target.closest('#reply');
    if (!box) return;
    e.preventDefault();
    box.classList.remove('drag');
    attachReply(imagesIn(e.dataTransfer.files));
  });

  // The controls inside a task's sheet.
  $('#sheet').addEventListener('click', e => {
    const el = e.target, hit = selector => el.closest(selector);
    const id = openSheetKey();
    if (hit('[data-play]')) play(hit('[data-play]').dataset.play, hit('[data-play]'));
    else if (hit('[data-plan-spec]')) { closeSheet(); showDoc(hit('[data-plan-spec]').dataset.planSpec); }
    else if (hit('[data-pick]')) pick(id, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-answer]')) sendAnswers(id, $('#answerText').value.trim());
    else if (hit('[data-approve-open]')) { closeSheet(); setTimeout(() => approve(id), 250); }
    else if (hit('[data-reopen]')) sendBack(id);
    else if (hit('[data-reply-attach]')) $('#replyInput').click();
    else if (hit('#replyShots')) shotClick(el, reply.shots).then(changed => { if (changed && $('#replyShots')) $('#replyShots').innerHTML = shotsHTML(reply.shots); });
    else if (hit('[data-follow]') || hit('[data-revise]')) {
      const text = $('#followText').value.trim();
      if (!text) { $('#followText').focus(); return; }
      if (hit('[data-revise]')) {
        closeSheet();
        attempt('send it', async () => { await act(id, 'revise', text); toast('Changes asked for', 'var(--violet)'); });
      } else sendFollowUp(id, text);
    } else if (hit('[data-plan-approve]')) {
      closeSheet();
      attempt('approve the plan', async () => { await act(id, 'approve-plan'); toast('Plan approved. Rocco starts it.', 'var(--accent-text)'); });
    } else if (hit('[data-got-it]')) { closeSheet(); gotIt(id); }
    else if (hit('[data-ask-more-send]')) {
      const text = $('#followText').value.trim();
      if (!text) { $('#followText').focus(); return; }
      closeSheet();
      askMore(id, text);
    } else if (hit('[data-queue-open]')) { closeSheet(); queueIt(id); }
    else if (hit('[data-delete]')) deleteTask(id, hit('[data-delete]'));
    else if (el.matches('.shots img')) el.classList.toggle('big');
    else if (hit('.s-row')) openTask(hit('.s-row').dataset.id);
    else if (hit('.ftag')) { const t = byId(id); if (t?.plan) openTask(t.plan); }
  });
}
