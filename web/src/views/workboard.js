// The Workboard: the user's notes and Claude's tasks, from the inbox to approved.
import { state, byId, of, approvedToday } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { hhmm, minsSince } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { refresh } from '../sync.js';
import { toast } from '../ui/toast.js';
import { showSheet, closeSheet, openSheetKey } from '../ui/sheet.js';
import { initPopover, hidePopover } from '../ui/popover.js';

const COLUMNS = {
  ready:   { name: 'To test', empty: 'Nothing to test' },
  stuck:   { name: 'Stuck',   empty: 'Nothing stuck' },
  working: { name: 'Working', empty: 'All lanes idle' },
  queued:  { name: 'Up next', empty: 'Nothing queued' },
  inbox:   { name: 'Inbox',   empty: 'No new notes' },
  done:    { name: 'Approved' },
};
const COLOR = { ready: 'var(--green)', stuck: 'var(--amber)', working: 'var(--blue)', queued: 'var(--gray)', inbox: 'var(--violet)', done: 'var(--green)' };
const place = t => t.where === 'lane' ? 'Lane ' + t.lane : 'Main';

// ---- Columns and cards ----

function cardHTML(t) {
  const title = `<div class="c-title">${t.feature ? icon.branch : ''}<span>${esc(t.title)}</span></div>`;
  const tries = t.attempt > 1 ? `<span class="note-meta" title="Attempt ${t.attempt}">${icon.retry}${t.attempt}</span>` : '';
  let info = '', right = '', extra = '';
  switch (t.status) {
    case 'ready':
      info = `<span class="tag ${t.where === 'lane' ? 't-lane' : 't-main'}"><i></i>${place(t)}</span>${tries}`;
      right = `<button class="chk" role="checkbox" aria-checked="false" data-approve="${t.id}" aria-label="Tested, approve" title="Tested, approve">${icon.check}</button>`;
      break;
    case 'stuck':
      info = tries;
      right = `<span class="qm" title="Needs your answer">?</span>`;
      break;
    case 'working':
      info = `<span class="note-meta">${esc(t.step || 'Working')} · ${minsSince(t.startedAt)}m</span>`;
      right = t.lane ? `<span class="lc" title="Lane ${t.lane}">L${t.lane}</span>` : '';
      extra = '<div class="progress"></div>';
      break;
    case 'queued':
      right = `<span class="wait${t.pending ? ' conductor' : ''}" title="${esc(t.waiting || 'Queued')}">${icon.clock}</span>`;
      break;
    case 'inbox':
      if (t.shots.length) info = `<div class="thumbs">${t.shots.map(src => `<img src="${src}" alt="">`).join('')}</div>`;
      break;
  }
  return `<div class="card s-${t.status}${t.fresh ? ' fresh' : ''}" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(t.title)}">`
    + `<div class="c-main">${title}<div class="c-meta">${info}</div></div>${right}${extra}</div>`;
}

function columnHTML(status) {
  const list = of(status), c = COLUMNS[status];
  const send = status === 'inbox' ? `<span class="sp"></span><button class="mini" data-send ${list.length ? '' : 'disabled'} title="Send these notes to the conductor">Send ${icon.send}</button>` : '';
  return `<div class="col c-${status}"><div class="col-head"><span class="sdot"></span>${c.name}<span class="count">${list.length}</span>${send}</div>`
    + (list.length ? list.map(cardHTML).join('') : `<div class="empty">${c.empty}</div>`) + `</div>`;
}

export function renderWorkboard() {
  const ready = of('ready').length, stuck = of('stuck').length;
  $('#boardSub').textContent = [ready && `${ready} to test`, stuck && `${stuck} stuck`].filter(Boolean).join(' · ');
  $('#boardBadge').textContent = ready + stuck;
  $('#boardBadge').hidden = !(ready + stuck);
  $('#approvedText').textContent = `${approvedToday().length} approved today`;
  $('#needs').innerHTML = columnHTML('ready') + columnHTML('stuck');
  $('#pipe').innerHTML = columnHTML('working') + columnHTML('queued') + columnHTML('inbox');
  document.title = ready + stuck ? `(${ready + stuck}) Rocco` : 'Rocco';
  state.tasks.forEach(t => { t.fresh = false; });
}

function summaryHTML(t) {
  const head = label => `<div class="ph"><span class="sdot" style="--c:${COLOR[t.status]}"></span>${label}</div>`;
  switch (t.status) {
    case 'ready': return head('Ready to test') + esc(t.summary) + (t.test ? `<div class="try">${esc(t.test)}</div>` : '');
    case 'stuck': return head('Needs your answer') + esc(t.question);
    case 'working': return head(`${esc(t.step || 'Working')} · Lane ${t.lane}`) + (t.summary ? esc(t.summary) : 'No report yet');
    case 'queued': return head('Up next') + esc(t.waiting || 'Queued');
  }
  return '';
}

// ---- A task in the sheet ----

function whereLine(t) {
  switch (t.status) {
    case 'ready': return `Test in ${place(t)}${t.where === 'lane' ? ' · approving merges it into Main' : ''}`;
    case 'stuck': return t.lane ? `Lane ${t.lane}` : '';
    case 'working': return `Lane ${t.lane} · ${minsSince(t.startedAt)}m`;
    case 'queued': return esc(t.waiting || 'Queued');
    case 'inbox': return 'Not sent yet';
    case 'done': return `Approved at ${hhmm(t.doneAt)}${t.pending === 'merge' ? ' · merging into Main' : ''}`;
  }
  return '';
}

function sheetBody(t) {
  let h = `<h2 class="s-title">${esc(t.title)}</h2><div class="s-where">${whereLine(t)}</div>`;
  if (t.summary) h += `<p class="s-sum">${esc(t.summary)}</p>`;
  if (t.status === 'ready' && t.test) h += `<div class="s-try"><small>Try</small>${esc(t.test)}</div>`;
  if (t.status === 'stuck') h += `<div class="s-q">${esc(t.question)}</div><div class="opts">${t.options.map(o => `<button class="opt" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  if (t.shots.length) h += `<div class="shots">${t.shots.map(src => `<img src="${src}" alt="Screenshot">`).join('')}</div>`;
  if (t.note && t.note !== t.title) h += `<div class="s-note">${esc(t.note)}</div>`;
  if (t.log.length) h += `<details class="hist"><summary>${icon.chev}History · ${t.log.length}</summary><ul class="tl">${t.log.map(l =>
    `<li class="w-${esc(l.who)}"><span class="who">${esc(l.who)}</span>${esc(l.text)}<span class="at">${hhmm(l.at)}</span></li>`).join('')}</ul></details>`;
  return h;
}

function sheetFoot(t) {
  if (t.status === 'ready') return `<div class="row"><button class="btn go" data-approve-open>${icon.checkSm}Approve</button><button class="btn" data-reopen-toggle>Reopen</button></div>`
    + `<div id="reopenBox" hidden><textarea class="field" id="reopenText" placeholder="What's still wrong?"></textarea><div class="row" style="margin-top:8px"><button class="btn warm" data-reopen>Send back</button></div></div>`;
  if (t.status === 'stuck') return `<textarea class="field" id="answerText" placeholder="${t.options.length ? 'Or write an answer' : 'Your answer'}"></textarea><div class="row"><button class="btn warm" data-answer>Send answer</button></div>`;
  if (t.status === 'inbox') return `<div class="row"><button class="btn" data-remove>Remove note</button></div>`;
  return '';
}

export function openTask(id) {
  const t = byId(id);
  if (t) showSheet(id, { color: COLOR[t.status], chip: COLUMNS[t.status].name, id: t.id, body: sheetBody(t), foot: sheetFoot(t) });
}

function openApproved() {
  const list = approvedToday();
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

function collapseCard(card) {
  card.style.height = card.offsetHeight + 'px';
  card.classList.add('collapse');
  requestAnimationFrame(() => Object.assign(card.style, { height: '0px', opacity: '0', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', borderWidth: '0px' }));
}

// The box lights up, the card folds away, then the server hears about it.
async function approve(id) {
  const t = byId(id);
  if (!t) return;
  const box = document.querySelector(`[data-approve="${id}"]`), card = box && box.closest('.card');
  hidePopover();
  if (box) { box.classList.add('on'); box.setAttribute('aria-checked', 'true'); }
  setTimeout(() => card && collapseCard(card), 420);
  await new Promise(r => setTimeout(r, 760));
  await attempt('approve it', async () => {
    const feature = t.where === 'lane';
    await act(id, 'approve');
    if (feature) toast(`Approved. The conductor merges “${t.title}” into Main.`, 'var(--cyan)');
    const button = $('#approvedBtn');
    button.classList.remove('bump'); void button.offsetWidth; button.classList.add('bump');
  });
}

async function sendInbox() {
  const n = of('inbox').length;
  if (!n) return;
  await attempt('send the notes', async () => {
    await api.send();
    await refresh();
    toast(`Sent ${n} to the conductor`, 'var(--violet)');
  });
}

export function initWorkboard() {
  initPopover('.card', el => { const t = byId(el.dataset.id); return t ? summaryHTML(t) : ''; });
  $('#approvedBtn').addEventListener('click', openApproved);

  const view = $('.view[data-view="workboard"]');
  view.addEventListener('click', e => {
    const box = e.target.closest('[data-approve]');
    if (box) { approve(box.dataset.approve); return; }
    if (e.target.closest('[data-send]')) { sendInbox(); return; }
    const card = e.target.closest('.card');
    if (card) openTask(card.dataset.id);
  });
  view.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card')) { e.preventDefault(); openTask(e.target.dataset.id); }
  });

  // The controls inside a task's sheet.
  $('#sheet').addEventListener('click', e => {
    const el = e.target, hit = selector => el.closest(selector);
    const id = openSheetKey();
    if (el.dataset.opt) {
      document.querySelectorAll('.opt').forEach(b => b.classList.toggle('on', b === el));
      $('#answerText').value = el.dataset.opt;
    } else if (hit('[data-answer]')) {
      const text = $('#answerText').value.trim();
      if (!text) { $('#answerText').focus(); return; }
      closeSheet();
      attempt('send the answer', async () => { await act(id, 'answer', text); toast('Answer sent to the conductor', 'var(--amber)'); });
    } else if (hit('[data-approve-open]')) {
      closeSheet();
      setTimeout(() => approve(id), 250);
    } else if (hit('[data-reopen-toggle]')) {
      const box = $('#reopenBox');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#reopenText').focus();
    } else if (hit('[data-reopen]')) {
      const text = $('#reopenText').value.trim();
      closeSheet();
      attempt('reopen it', async () => { await act(id, 'reopen', text); toast('Sent back to the conductor', 'var(--amber)'); });
    } else if (hit('[data-remove]')) {
      closeSheet();
      attempt('remove the note', () => act(id, 'remove'));
    } else if (el.matches('.shots img')) {
      el.classList.toggle('big');
    } else if (hit('.s-row')) {
      openTask(hit('.s-row').dataset.id);
    }
  });
}
