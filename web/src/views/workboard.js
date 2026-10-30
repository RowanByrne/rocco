// The Workboard. Top: the note box, then what needs the user's OK: feature plans to approve, and what Claude
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

const NAMES = { ready: 'To test', stuck: 'Stuck', working: 'Working', queued: 'Up next', inbox: 'Inbox', done: 'Approved' };
const EMPTY = { ready: 'Nothing to test', stuck: 'Nothing stuck', working: 'No one working' };
const COLOR = { ready: 'var(--green)', stuck: 'var(--amber)', working: 'var(--blue)', queued: 'var(--gray)', inbox: 'var(--claude)', done: 'var(--green)' };
const TYPES = { bug: 'Bug', tweak: 'Tweak', idea: 'Idea', feature: 'Feature' };
const SKIP = '\u0000skip';
const place = t => t.where === 'lane' ? 'Lane ' + t.lane : 'Main';
const isPlan = t => t.kind === 'plan';
const work = status => of(status).filter(t => !isPlan(t));
const queue = () => work('queued').sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.id.localeCompare(b.id));
const plansToApprove = () => state.tasks.filter(t => isPlan(t) && t.status === 'inbox');
const features = () => state.tasks.filter(t => isPlan(t) && ['queued', 'working', 'stuck', 'ready'].includes(t.status));
const childrenOf = plan => state.tasks.filter(t => t.plan === plan.id && t.status !== 'removed');
const unfinishedDeps = t => (t.after || []).filter(id => { const d = byId(id); return d && d.status !== 'done' && d.status !== 'removed'; });

// Questions for the user: the list, or the older single question.
const questionsOf = t => t.questions?.length ? t.questions : (t.question ? [{ text: t.question, options: (t.options || []).map(label => ({ label })) }] : []);
const answers = new Map(); // task id -> picked answers, kept across re-renders

// Where a queued task came from, for its tag in Up next.
const source = t => t.pending === 'reopen' ? ['Reopened', 'var(--amber)']
  : t.pending === 'answer' ? ['Answered', 'var(--amber)']
  : t.kind === 'suggestion' ? ['From Claude', 'var(--claude)']
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

const optionHTML = (o, i, picked) => `<span class="opt-wrap"><button class="opt${picked === o.label ? ' on' : ''}" data-pick="${esc(o.label)}" data-q="${i}">${esc(o.label)}</button>`
  + `${o.audio ? `<button class="speaker" data-play="${esc(o.audio)}" title="Play" aria-label="Play ${esc(o.label)}">${icon.speaker}</button>` : ''}</span>`;

// ---- Columns ----

// The stuck card asks its questions one at a time, right on the board.
function questionCardHTML(t) {
  const qs = questionsOf(t), picked = answers.get(t.id) || [];
  if (!qs.length) return '';
  if (picked.length >= qs.length) {
    return `<div class="ask-card done"><span>${qs.length === 1 ? 'Answered' : `All ${qs.length} answered`}</span><span class="sp"></span>`
      + `<button class="btn-sm" data-restart="${t.id}">Start over</button><button class="btn-sm warm-sm" data-send-answers="${t.id}">Send</button></div>`;
  }
  const i = picked.length, q = qs[i];
  return `<div class="ask-card"><div class="ask-q"><span>${esc(q.text)}</span>${qs.length > 1 ? `<span class="ask-n">${i + 1} of ${qs.length}</span>` : ''}</div>`
    + `<div class="opts">${(q.options || []).map(o => optionHTML(o, i, '')).join('')}</div>`
    + `<div class="ask-foot"><button class="linkish" data-pick="${SKIP}" data-q="${i}">Let Claude decide</button>${i ? `<button class="linkish" data-back="${t.id}">Back</button>` : ''}</div></div>`;
}

function workingHTML(t) {
  if (!settings().liveSteps) return '';
  const done = t.log.filter(l => l.who === 'worker').slice(-3);
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
    + (list.length ? list.map(cardHTML).join('') : `<div class="empty">${EMPTY[status]}</div>`) + `</div>`;
}

// ---- Feature plans: their own look, in the feature's color ----

const stepsHTML = p => `<ol class="plan-steps">${(p.steps || []).map((s, i) => `<li><span class="ps-n">${i + 1}</span><span class="ps-t">${esc(s.title)}</span>`
  + `<span class="ps-meta">${s.lane ? `Lane ${s.lane}` : ''}${s.lane && s.tier ? ' · ' : ''}${esc(s.tier || '')}</span></li>`).join('')}</ol>`;

function planCardHTML(p) {
  return `<div class="plan${p.fresh ? ' fresh' : ''}" style="${featureVars(p.id)}" data-id="${p.id}">`
    + `<div class="plan-top"><span class="plan-badge">${icon.layers}Feature plan</span><span class="sp"></span><span class="s-id">${p.id}</span></div>`
    + `<div class="plan-title">${esc(p.title)}</div>${p.summary ? `<div class="plan-sum">${esc(p.summary)}</div>` : ''}${stepsHTML(p)}`
    + (p.pending === 'revise' ? '<div class="plan-note">Changes asked for · waiting for the conductor</div>' : '')
    + `<div class="plan-actions"><button class="btn-sm go" data-plan-approve="${p.id}">Approve plan</button>`
    + `<button class="btn-sm" data-plan-reply="${p.id}" data-mode="revise">Change it</button><button class="btn-sm" data-plan-reply="${p.id}" data-mode="followup">Ask</button></div>`
    + `<div class="plan-reply" hidden><textarea class="field" placeholder=""></textarea><div class="row"><span class="sp"></span><button class="btn-sm go" data-plan-send="${p.id}">Send</button></div></div></div>`;
}

function featuresHTML() {
  return features().map(p => {
    const kids = childrenOf(p), done = kids.filter(k => k.status === 'done').length, total = Math.max(kids.length, (p.steps || []).length, 1);
    return `<button class="feat" style="${featureVars(p.id)}" data-id="${p.id}" title="${esc(p.title)}"><span class="feat-dot"></span><span class="feat-name">${esc(p.title)}</span>`
      + `<span class="feat-bar"><i style="width:${Math.round(done / total * 100)}%"></i></span><span class="feat-count">${done}/${total}</span></button>`;
  }).join('');
}

// ---- Inbox: what Claude spotted ----

function inboxHTML() {
  const list = work('inbox');
  if (!list.length) return '';
  const why = t => t.summary || (t.note && t.note !== t.title ? t.note : '');
  return `<div class="inbox-head">${icon.sparkle}Claude spotted ${list.length === 1 ? 'something' : `${list.length} things`}<span class="sp"></span>`
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
        : `<span class="q-wait${t.pending ? ' conductor' : ''}">${icon.clock}<span>${esc(t.waiting || 'Queued')}</span></span>`) + '</div>';
  };
  return `<div class="col-head">${icon.queue}Up next<span class="count">${list.length}</span>${list.length > 1 ? '<span class="q-hint">Drag to reorder</span>' : ''}</div>`
    + (list.length ? `<div class="q-list">${list.map(row).join('')}</div>` : '<div class="empty">Nothing queued. Notes you add go here.</div>');
}

export function renderWorkboard() {
  const ready = work('ready').length, stuck = work('stuck').length, asks = work('inbox').length + plansToApprove().length;
  $('#boardSub').textContent = [ready && `${ready} to test`, stuck && `${stuck} stuck`, asks && `${asks} waiting for your OK`].filter(Boolean).join(' · ');
  $('#boardBadge').textContent = ready + stuck + asks;
  $('#boardBadge').hidden = !(ready + stuck + asks);
  $('#approvedText').textContent = `${approvedToday().filter(t => !isPlan(t)).length} approved today`;
  $('#plans').innerHTML = plansToApprove().map(planCardHTML).join('');
  $('#plans').hidden = !plansToApprove().length;
  $('#inbox').innerHTML = inboxHTML();
  $('#inbox').hidden = !work('inbox').length;
  $('#features').innerHTML = featuresHTML();
  $('#features').hidden = !features().length;
  $('#board').innerHTML = columnHTML('ready') + columnHTML('stuck') + columnHTML('working');
  $('#queue').innerHTML = queueHTML();
  document.title = ready + stuck + asks ? `(${ready + stuck + asks}) Rocco` : 'Rocco';
  state.tasks.forEach(t => { t.fresh = false; });
}

function summaryHTML(t) {
  const head = label => `<div class="ph"><span class="sdot" style="--c:${COLOR[t.status]}"></span>${label}</div>`;
  switch (t.status) {
    case 'ready': return head('Ready to test') + esc(t.summary) + (t.test ? `<div class="try">${esc(t.test)}</div>` : '');
    case 'stuck': return head('Needs your answer') + esc(questionsOf(t).map(q => q.text).join(' · '));
    case 'working': return head(`${esc(t.step || 'Working')} · Lane ${t.lane}`) + (t.summary ? esc(t.summary) : 'No report yet');
  }
  return '';
}

// ---- A task in the sheet ----

function whereLine(t) {
  if (isPlan(t)) return t.status === 'inbox' ? 'Feature plan · waiting for your OK' : `Feature · ${childrenOf(t).filter(k => k.status === 'done').length} of ${Math.max(childrenOf(t).length, (t.steps || []).length)} done`;
  switch (t.status) {
    case 'ready': return `Test in ${place(t)}${t.where === 'lane' ? ' · approving merges it into Main' : ''}`;
    case 'stuck': return t.lane ? `Lane ${t.lane}` : '';
    case 'working': return `Lane ${t.lane} · ${minsSince(t.startedAt)}m${typeof t.progress === 'number' ? ` · ${t.progress}%` : ''}`;
    case 'queued': return esc(t.waiting || 'Queued');
    case 'inbox': return 'Claude spotted this. Queue it to have it done.';
    case 'done': return `Approved at ${hhmm(t.doneAt)}${t.pending === 'merge' ? ' · merging into Main' : ''}`;
  }
  return '';
}

function questionsSheetHTML(t) {
  const picked = answers.get(t.id) || [];
  return questionsOf(t).map((q, i) => `<div class="s-q">${esc(q.text)}</div><div class="opts">${(q.options || []).map(o => optionHTML(o, i, picked[i])).join('')}`
    + `<button class="opt${picked[i] === SKIP ? ' on' : ''}" data-pick="${SKIP}" data-q="${i}">Let Claude decide</button></div>`).join('');
}

function sheetBody(t) {
  const meta = [typeTag(t), featureTag(t)].join('');
  let h = `<h2 class="s-title">${esc(t.title)}</h2><div class="s-where">${whereLine(t)}</div>${meta ? `<div class="c-meta">${meta}</div>` : ''}`;
  if (t.summary) h += `<p class="s-sum">${esc(t.summary)}</p>`;
  if (isPlan(t)) {
    h += stepsHTML(t);
    const kids = childrenOf(t);
    if (kids.length) h += `<div class="sec-h">Tasks</div>${kids.map(k => `<div class="s-row" data-id="${k.id}"><span class="sdot" style="--c:${COLOR[k.status] || 'var(--gray)'}"></span><span>${esc(k.title)}</span><span class="at">${NAMES[k.status] || ''}</span></div>`).join('')}`;
  }
  if (t.status === 'ready' && t.test) h += `<div class="s-try"><small>Try</small>${esc(t.test)}</div>`;
  if (t.status === 'stuck') h += questionsSheetHTML(t);
  if (t.shots.length) h += `<div class="shots">${t.shots.map(src => `<img src="${src}" alt="Screenshot">`).join('')}</div>`;
  if (t.note && t.note !== t.title) h += `<div class="s-note">${esc(t.note)}</div>`;
  if (t.branch) h += `<div class="sec-h">What changed</div><div class="changes" id="changes"><span class="mut">Loading…</span></div>`;
  if (t.log.length) h += `<details class="hist"><summary>${icon.chev}History · ${t.log.length}</summary><ul class="tl">${t.log.map(l =>
    `<li class="w-${esc(l.who)}"><span class="who">${esc(l.who)}</span>${esc(l.text)}<span class="at">${hhmm(l.at)}</span></li>`).join('')}</ul></details>`;
  return h;
}

const followUpHTML = placeholder => `<textarea class="field" id="followText" placeholder="${placeholder}"></textarea><div class="row"><span class="sp"></span><button class="btn accent" data-follow>Send follow-up</button></div>`;

function sheetFoot(t) {
  if (isPlan(t) && t.status === 'inbox') return `<div class="row"><button class="btn accent" style="flex:1" data-plan-approve="${t.id}">Approve plan</button></div>`
    + `<textarea class="field" id="followText" placeholder="Want changes? Say what, then send"></textarea><div class="row"><span class="sp"></span><button class="btn" data-revise>Ask for changes</button></div>`;
  if (t.status === 'ready') return `<div class="row"><button class="btn go" data-approve-open>${icon.checkSm}Approve</button><button class="btn" data-reopen-toggle>Reopen</button></div>`
    + `<div id="reopenBox" hidden><textarea class="field" id="reopenText" placeholder="What's still wrong?"></textarea><div class="row" style="margin-top:8px"><button class="btn warm" data-reopen>Send back</button></div></div>`;
  if (t.status === 'stuck') return `<textarea class="field" id="answerText" placeholder="${questionsOf(t).length ? 'Anything to add? (optional)' : 'Your answer'}"></textarea><div class="row"><button class="btn warm" data-answer>Send answer</button></div>`;
  if (t.status === 'inbox') return `<div class="row"><button class="btn accent" style="flex:1" data-queue-open>Queue it</button><button class="btn" data-remove>Dismiss</button></div>`;
  if (t.status === 'working' || isPlan(t)) return followUpHTML('Add something while it works. It picks it up at its next stop.');
  // A queued task can take a follow-up too; a note the conductor hasn't picked up yet can be taken back.
  if (t.status === 'queued') return followUpHTML('Add more for when it starts') + (t.pending === 'plan' ? '<div class="row"><button class="btn" data-remove>Remove from Up next</button></div>' : '');
  return '';
}

async function loadChanges(t) {
  try {
    const c = await api.changes(t.id);
    const box = $('#changes');
    if (!box || openSheetKey() !== t.id) return;
    box.innerHTML = c.files.length
      ? c.files.map(f => `<div class="chg"><span class="chg-path">${esc(f.path)}</span><span class="chg-add">+${f.added}</span><span class="chg-del">−${f.removed}</span></div>`).join('')
        + `<div class="chg-foot">${c.source === 'merged' ? 'As merged into main' : 'On its branch, against main'}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noreferrer">View on GitHub</a>` : ''}</div>`
      : '<span class="mut">No changes found for its branch yet.</span>';
  } catch { /* the sheet just keeps "Loading…" */ }
}

export function openTask(id) {
  const t = byId(id);
  if (!t) return;
  const color = isPlan(t) ? 'var(--accent)' : COLOR[t.status];
  showSheet(id, { color, chip: isPlan(t) ? 'Feature plan' : NAMES[t.status], id: t.id, body: sheetBody(t), foot: sheetFoot(t) });
  if (t.branch) loadChanges(t);
}

function openApproved() {
  const list = approvedToday().filter(t => !isPlan(t));
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
  await api.act(id, action, text);
  await refresh();
}

// Approve, queue and dismiss can be taken back for a few seconds.
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
const dismiss = id => attempt('dismiss it', async () => { await act(id, 'remove'); undoable(id, 'Dismissed', 'var(--gray)'); });
const queueAll = () => attempt('queue them', async () => {
  const n = work('inbox').length;
  await api.send();
  await refresh();
  toast(`Added ${n} to Up next`, 'var(--violet)');
});

function answerText(t, extra) {
  const picked = answers.get(t.id) || [];
  // "Pick a sound: Blade swing", "Every swing or only on hits? Only on hits"
  const line = (q, answer) => q.text.trim().endsWith('?') ? `${q.text.trim()} ${answer}` : `${q.text.trim().replace(/[.:]+$/, '')}: ${answer}`;
  const lines = questionsOf(t).map((q, i) => picked[i] === undefined ? '' : line(q, picked[i] === SKIP ? 'your call' : picked[i])).filter(Boolean);
  if (extra) lines.push(extra);
  return lines.join('\n');
}

function sendAnswers(id, extra = '') {
  const t = byId(id), text = t && answerText(t, extra);
  if (!text) { toast('Pick an answer, or write one', 'var(--amber)'); return; }
  closeSheet();
  attempt('send the answer', async () => { await act(id, 'answer', text); answers.delete(id); toast('Answer sent to the conductor', 'var(--amber)'); });
}

function pick(taskId, q, value) {
  const t = byId(taskId);
  const picked = [...(answers.get(taskId) || [])];
  picked[q] = value;
  answers.set(taskId, picked.slice(0, Math.max(q + 1, picked.length)));
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
    else if (hit('[data-pick]')) pick(card, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-back]')) { answers.set(card, (answers.get(card) || []).slice(0, -1)); renderWorkboard(); }
    else if (hit('[data-restart]')) { answers.delete(card); renderWorkboard(); }
    else if (hit('[data-send-answers]')) sendAnswers(card);
    else if (hit('[data-approve]')) approve(hit('[data-approve]').dataset.approve);
    else if (hit('[data-queue]')) queueIt(hit('[data-queue]').dataset.queue);
    else if (hit('[data-dismiss]')) dismiss(hit('[data-dismiss]').dataset.dismiss);
    else if (hit('[data-queue-all]')) queueAll();
    else if (hit('[data-plan-approve]')) attempt('approve the plan', async () => { await act(card, 'approve-plan'); toast('Plan approved. The conductor starts it.', 'var(--accent-text)'); });
    else if (hit('[data-plan-reply]')) {
      const box = hit('.plan').querySelector('.plan-reply'), mode = hit('[data-plan-reply]').dataset.mode;
      box.hidden = box.dataset.mode === mode ? !box.hidden : false;
      box.dataset.mode = mode;
      box.querySelector('textarea').placeholder = mode === 'revise' ? 'What should change?' : 'Your question';
      if (!box.hidden) box.querySelector('textarea').focus();
    } else if (hit('[data-plan-send]')) {
      const box = hit('.plan-reply'), text = box.querySelector('textarea').value.trim();
      if (!text) { box.querySelector('textarea').focus(); return; }
      attempt('send it', async () => { await act(card, box.dataset.mode === 'revise' ? 'revise' : 'followup', text); toast('Sent to the conductor', 'var(--accent-text)'); });
    } else if (hit('.plan-reply')) { /* typing in it */ }
    else if (hit('.card, .sug, .q-row, .feat, .plan')) openTask(card);
  });
  view.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card, .q-row')) { e.preventDefault(); openTask(e.target.dataset.id); }
  });

  // The controls inside a task's sheet.
  $('#sheet').addEventListener('click', e => {
    const el = e.target, hit = selector => el.closest(selector);
    const id = openSheetKey();
    if (hit('[data-play]')) play(hit('[data-play]').dataset.play, hit('[data-play]'));
    else if (hit('[data-pick]')) pick(id, +hit('[data-pick]').dataset.q, hit('[data-pick]').dataset.pick);
    else if (hit('[data-answer]')) sendAnswers(id, $('#answerText').value.trim());
    else if (hit('[data-approve-open]')) { closeSheet(); setTimeout(() => approve(id), 250); }
    else if (hit('[data-reopen-toggle]')) {
      const box = $('#reopenBox');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#reopenText').focus();
    } else if (hit('[data-reopen]')) {
      const text = $('#reopenText').value.trim();
      closeSheet();
      attempt('reopen it', async () => { await act(id, 'reopen', text); toast('Sent back to the conductor', 'var(--amber)'); });
    } else if (hit('[data-follow]') || hit('[data-revise]')) {
      const text = $('#followText').value.trim();
      if (!text) { $('#followText').focus(); return; }
      closeSheet();
      attempt('send it', async () => { await act(id, hit('[data-revise]') ? 'revise' : 'followup', text); toast(hit('[data-revise]') ? 'Changes asked for' : 'Follow-up sent', 'var(--violet)'); });
    } else if (hit('[data-plan-approve]')) {
      closeSheet();
      attempt('approve the plan', async () => { await act(id, 'approve-plan'); toast('Plan approved. The conductor starts it.', 'var(--accent-text)'); });
    } else if (hit('[data-queue-open]')) { closeSheet(); queueIt(id); }
    else if (hit('[data-remove]')) { closeSheet(); dismiss(id); }
    else if (el.matches('.shots img')) el.classList.toggle('big');
    else if (hit('.s-row')) openTask(hit('.s-row').dataset.id);
    else if (hit('.ftag')) { const t = byId(id); if (t?.plan) openTask(t.plan); }
  });
}
