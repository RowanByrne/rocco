// Updates: the game's calendar. The user's cards for upcoming updates (live/CALENDAR.md), the events on the game page
// (from Roblox), and each update's game page event, which the agent makes. Rocco queues it by itself when the update is
// close enough (the lead, kept in CALENDAR.md), or the user queues it from the card.
import { state, emit } from '../state.js';
import { $, esc } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { openTask } from './workboard.js';

const KINDS = ['Update', 'Live event', 'Timed release'];
const KIND_COLOR = { 'Update': 'var(--accent-text)', 'Live event': 'var(--amber)', 'Timed release': 'var(--cyan)' };
const LEADS = [0, 7, 14, 21, 30];
let month = null;   // the first day of the month on show
let timer = null;
let busy = false;
let editing = { id: '', kind: 'Update' }; // the card in the editor
const modal = $('#updateModal');

export async function loadUpdates(force = false) {
  clearTimeout(timer);
  if (state.view !== 'updates') return;
  try {
    state.updates = await api.updates(force);
    emit('updates');
    const queued = state.updates.auto?.queued || [];
    if (queued.length) toast(`Queued for Rocco: the game page event for ${queued.map(q => q.title).join(', ')}`, 'var(--violet)');
  } catch (e) { state.updates = { error: e.message }; emit('updates'); }
  // Sooner while Roblox is still being asked.
  timer = setTimeout(() => loadUpdates(), state.updates?.roblox?.loading ? 2500 : 60000);
}

export function resetUpdates() { state.updates = null; month = null; }

// ---- Dates (cards are days in UTC; the calendar shows the user's days) ----

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayYmd = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = s => Math.round((parseYmd(s) - parseYmd(todayYmd())) / 86400000);
const whenText = c => {
  const n = daysUntil(c.date);
  const day = parseYmd(c.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const rel = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? `in ${n} days` : n === -1 ? 'yesterday' : `${-n} days ago`;
  return `${day}${c.time ? `, ${c.time} UTC` : ''} · ${rel}`;
};
const eventDay = iso => ymd(new Date(iso));

// ---- What each card's game page event is doing ----

function eventChip(c) {
  const states = {
    notyet: ['No event yet', 'var(--gray)'], queued: [`Queued for Rocco`, 'var(--violet)'], drafted: ['Drafted: ready to publish', 'var(--amber)'],
    scheduled: ['On the game page', 'var(--green)'], live: ['Live on the game page', 'var(--green)'], over: ['Event over', 'var(--gray)'], none: ['No game page event', 'var(--gray)'],
  };
  const [label, color] = states[c.event] || states.notyet;
  return `<span class="chip" style="--c:${color}"><i></i>${esc(label)}</span>`;
}

// A draft event goes public with the user's click (their Roblox key), else on the Creator Hub.
const hubLink = u => u.roblox?.universe ? `<a class="mini" href="https://create.roblox.com/dashboard/creations/experiences/${esc(u.roblox.universe)}/events" target="_blank" rel="noreferrer">Publish on the Creator Hub${icon.external}</a>` : '';
const publishButton = (id, u) => u.roblox?.linked && id ? `<button class="mini go" data-publish="${esc(id)}">Publish it</button>` : hubLink(u);

function cardActions(c, u) {
  if (c.event === 'queued' && c.task) return `<button class="mini" data-task="${esc(c.task)}">${esc(c.task)}</button>`;
  if (c.event === 'drafted') return c.onRoblox ? publishButton(c.eventId, u) : hubLink(u);
  if (c.event !== 'notyet' || daysUntil(c.date) < 0) return '';
  const auto = u.lead > 0 && daysUntil(c.date) > u.lead ? `<span class="upd-note">Rocco gets it ${u.lead} days before</span>` : '';
  return `${auto}<button class="mini" data-queue="${esc(c.id)}">Queue its event now</button>`;
}

// The card images the agent made for an update's event: the user picks one.
function candidatesHTML(c) {
  if (!c.candidates?.length || !['notyet', 'queued', 'drafted'].includes(c.event)) return ''; // once it's public, the card is settled
  const picked = (c.image || '').replace(/\\/g, '/').split('/').pop();
  return `<span class="upd-cands"><span class="upd-note">Pick its card image:</span>${c.candidates.map(f => {
    const on = f.split('/').pop() === picked;
    return `<button class="upd-cand${on ? ' on' : ''}" data-pick="${esc(c.id)}" data-image="${esc(f)}" title="${on ? 'Picked' : 'Use this one'}"><img src="${esc(api.artFile(f))}" alt="" loading="lazy">${on ? icon.checkSm : ''}</button>`;
  }).join('')}</span>`;
}

// ---- The page ----

function eventsHTML(u) {
  const r = u.roblox || {};
  const events = (r.events || []).filter(e => !e.end || new Date(e.end) > new Date());
  let body;
  if (!r.universe) body = `<div class="upd-empty">Add the game's universe id to <code>docs/game/PROJECT.md</code> (the Roblox row) to see its game page events here.</div>`;
  else if (r.loading && !events.length) body = '<div class="upd-empty"><span class="spin"></span>Checking the game page…</div>';
  else if (r.error) body = `<div class="upd-empty">${esc(r.error)}</div>`;
  else if (!events.length) body = `<div class="upd-empty">No upcoming events on the game page.</div>`;
  else body = `<div class="upd-events">${events.map(e => {
    const draft = e.visibility && e.visibility !== 'public';
    const live = !draft && e.start && new Date(e.start) <= new Date();
    const card = (u.cards || []).find(c => c.eventId && c.eventId === String(e.id));
    return `<div class="upd-ev${draft ? ' draft' : ''}">`
      + `<a class="upd-ev-img" href="${esc(e.url || '#')}" target="_blank" rel="noreferrer">${e.image ? `<img src="${esc(e.image)}" alt="" loading="lazy">` : icon.calendar}</a>`
      + `<span class="upd-ev-body"><a class="upd-ev-title" href="${esc(e.url || '#')}" target="_blank" rel="noreferrer">${esc(e.title)}</a>`
      + `<span>${draft ? '<span class="chip" style="--c:var(--amber)"><i></i>Draft: only you see it</span>' : live ? '<span class="chip" style="--c:var(--green)"><i></i>Live</span>' : ''}${esc(rangeText(e))}</span>`
      + `${card ? `<span class="upd-ev-card">${icon.link}${esc(card.title)}</span>` : ''}`
      + `${e.interested != null ? `<span class="upd-ev-meta">${Number(e.interested).toLocaleString()} interested</span>` : ''}`
      + `${draft ? `<span>${publishButton(e.id, u)}</span>` : ''}</span></div>`;
  }).join('')}</div>`;
  const foot = !r.universe ? '' : !r.linked ? 'Public events only. Link your Roblox Open Cloud key in Connections to see drafts and publish them here.'
    : r.access === 'denied' ? 'Your Roblox key can\'t read this game\'s events, so these are only the public ones (Connections).' : '';
  return `<div class="panel upd-panel"><div class="panel-head">${icon.rocket}On the game page${events.length ? `<span class="count">${events.length}</span>` : ''}</div>${body}`
    + `${foot ? `<div class="panel-foot">${esc(foot)}</div>` : ''}</div>`;
}

function rangeText(e) {
  const f = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return e.end ? `${f(e.start)} – ${f(e.end)}` : f(e.start);
}

function calendarHTML(u) {
  const first = month || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const today = todayYmd();
  const byDay = {};
  for (const c of u.cards || []) if (c.date) (byDay[c.date] ||= []).push(`<button class="cal-item" style="--c:${KIND_COLOR[c.kind] || KIND_COLOR.Update}" data-card="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>`);
  for (const e of u.roblox?.events || []) {
    if (!e.start) continue;
    const from = parseYmd(eventDay(e.start)), to = parseYmd(eventDay(e.end || e.start));
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = ymd(d), first = key === eventDay(e.start) || d.getDay() === 1;
      (byDay[key] ||= []).push(`<span class="cal-ev${key === eventDay(e.start) ? ' start' : ''}${first ? '' : ' cont'}${e.visibility && e.visibility !== 'public' ? ' draft' : ''}" title="${esc(e.title)} (game page event)">${first ? esc(e.title) : ''}</span>`);
    }
  }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== first.getMonth()) break; // five weeks were enough
    const key = ymd(d);
    cells.push(`<div class="cal-day${d.getMonth() !== first.getMonth() ? ' out' : ''}${key === today ? ' today' : ''}${key < today ? ' past' : ''}" data-day="${key}">`
      + `<span class="cal-num">${d.getDate()}</span>${(byDay[key] || []).join('')}</div>`);
  }
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<div class="panel cal"><div class="cal-head"><b>${esc(label)}</b><span class="sp"></span>`
    + `<button class="mini" data-month="-1" aria-label="Previous month">‹</button><button class="mini" data-month="0">Today</button><button class="mini" data-month="1" aria-label="Next month">›</button></div>`
    + `<div class="cal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>`
    + `<div class="cal-grid">${cells.join('')}</div><div class="cal-foot">Click a day to plan an update on it.</div></div>`;
}

function listHTML(u) {
  const today = todayYmd();
  const upcoming = (u.cards || []).filter(c => !c.date || c.date >= today);
  const past = (u.cards || []).filter(c => c.date && c.date < today).reverse();
  const row = c => `<div class="upd-row" data-card="${esc(c.id)}"><span class="upd-dot" style="--c:${KIND_COLOR[c.kind] || KIND_COLOR.Update}"></span>`
    + `<div class="upd-main"><b>${esc(c.title)}</b><span class="upd-when">${esc(c.kind)} · ${c.date ? esc(whenText(c)) : 'No date'}</span>`
    + `${c.notes ? `<span class="upd-notes">${esc(c.notes)}</span>` : ''}<span class="upd-state">${eventChip(c)}${cardActions(c, u)}</span>${candidatesHTML(c)}</div></div>`;
  const lead = `<label class="upd-lead">Rocco makes each update's game page event <select class="input" id="updLead">`
    + LEADS.map(n => `<option value="${n}"${n === u.lead ? ' selected' : ''}>${n ? `${n} days before` : 'only when I ask'}</option>`).join('') + '</select></label>';
  return `<div class="panel upd-list"><div class="panel-head">${icon.calendar}Planned<span class="count">${upcoming.length}</span></div>`
    + (upcoming.length ? upcoming.map(row).join('') : `<div class="upd-empty">Nothing planned yet. <button class="mini" id="updFirst">Plan an update</button></div>`)
    + (past.length ? `<details class="upd-past"><summary>Past (${past.length})</summary>${past.map(row).join('')}</details>` : '')
    + `<div class="panel-foot">${lead}</div></div>`;
}

export function renderUpdates() {
  const u = state.updates;
  const el = $('#updates');
  if (!u) { el.innerHTML = '<div class="upd-empty"><span class="spin"></span> Loading…</div>'; $('#updatesSub').textContent = ''; return; }
  if (u.error) { el.innerHTML = `<div class="upd-empty">${esc(u.error)}</div>`; return; }
  const planned = (u.cards || []).filter(c => !c.date || c.date >= todayYmd()).length;
  const onPage = (u.roblox?.events || []).filter(e => !e.end || new Date(e.end) > new Date()).length;
  $('#updatesSub').textContent = `${planned} planned${u.roblox?.universe && !u.roblox.error ? ` · ${onPage} on the game page` : ''}`;
  el.innerHTML = eventsHTML(u) + `<div class="upd-layout">${calendarHTML(u)}${listHTML(u)}</div>`;
}

// ---- Editing a card ----

function openEditor(card, date) {
  const c = card || { id: '', title: '', date: date || todayYmd(), time: '', kind: 'Update', notes: '', event: 'notyet' };
  modal.querySelector('.modal-card').innerHTML = `<h2>${card ? 'Edit the update' : 'Plan an update'}</h2>`
    + `<p class="m-sub">It goes on the game's calendar (<code>live/CALENDAR.md</code>), where Rocco reads it too.</p>`
    + `<div class="fields"><label class="lbl">Name<input class="input" id="updTitle" value="${esc(c.title)}" placeholder="Pet evolution" autocomplete="off"></label>`
    + `<div class="two"><label class="lbl">Day<input class="input" type="date" id="updDate" value="${esc(c.date)}"></label>`
    + `<label class="lbl">Time <small>UTC, optional</small><input class="input" type="time" id="updTime" value="${esc(c.time)}"></label></div>`
    + `<div class="lbl">Kind<div class="ob-kinds">${KINDS.map(k => `<button type="button" class="ob-kind${k === c.kind ? ' on' : ''}" data-kind="${k}">${k}</button>`).join('')}</div></div>`
    + `<label class="lbl">What's in it<textarea class="field" id="updNotes" rows="4" placeholder="As much or as little as you like: what's new, what players will notice, anything the event should say">${esc(c.notes)}</textarea></label>`
    + `<label class="upd-announce"><input type="checkbox" id="updAnnounce"${c.event === 'none' ? '' : ' checked'}> Announce it with an event on the game page</label></div>`
    + `<div class="m-actions">${card ? `<button class="btn ghost-btn" data-upd="delete" style="margin-right:auto">Delete</button>` : ''}`
    + `<button class="btn" data-upd="cancel">Cancel</button><button class="btn accent" data-upd="save">${card ? 'Save' : 'Add it'}</button></div>`;
  editing = { id: c.id, kind: c.kind };
  modal.classList.add('open');
  $('#updTitle').focus();
}

export const updateEditorOpen = () => modal.classList.contains('open');
export function closeUpdateEditor() { modal.classList.remove('open'); }

async function saveCard() {
  if (busy) return;
  const card = { id: editing.id, title: $('#updTitle').value, date: $('#updDate').value, time: $('#updTime').value, kind: editing.kind, notes: $('#updNotes').value, announce: $('#updAnnounce').checked };
  busy = true;
  try {
    const r = await api.saveUpdate(card);
    closeUpdateEditor();
    toast(r.saved?.note || `${card.title.trim()}: on the calendar`, r.saved?.note ? 'var(--amber)' : undefined);
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); }
  busy = false;
}

async function deleteCard(button) {
  if (!button.classList.contains('confirm')) { button.classList.add('confirm'); button.textContent = 'Delete it?'; return; }
  try { await api.removeUpdate(editing.id); closeUpdateEditor(); await loadUpdates(); } catch (e) { toast(e.message, 'var(--red)'); }
}

async function publish(eventId, button) {
  button.disabled = true;
  button.innerHTML = '<span class="spin"></span>Publishing';
  try {
    await api.publishEvent(eventId);
    toast('Published: it\'s on the game page');
    await loadUpdates(true);
  } catch (e) { toast(e.message, 'var(--red)'); button.disabled = false; button.textContent = 'Publish it'; }
}

async function pickImage(id, image) {
  try {
    await api.pickCardImage(id, image);
    toast(`Card image picked. Rocco puts it on the event`);
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); }
}

async function queueEvent(id, button) {
  button.disabled = true;
  try {
    const r = await api.queueUpdateEvent(id);
    const q = r.queued?.[0];
    toast(q ? `${q.task} is in Up next: Rocco makes the game page event for ${q.title}` : 'It already has one', 'var(--violet)');
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); button.disabled = false; }
}

export function initUpdates() {
  $('#updateNew').addEventListener('click', () => openEditor(null));
  $('#updates').addEventListener('click', e => {
    if (e.target.closest('a')) return; // links to Roblox open on their own
    const el = e.target.closest('[data-month],[data-queue],[data-task],[data-publish],[data-pick],[data-card],[data-day],#updFirst');
    if (!el) return;
    if (el.id === 'updFirst') openEditor(null);
    else if (el.dataset.publish) publish(el.dataset.publish, el);
    else if (el.dataset.pick) pickImage(el.dataset.pick, el.dataset.image);
    else if (el.dataset.month !== undefined) {
      const now = new Date(), m = month || new Date(now.getFullYear(), now.getMonth(), 1);
      month = +el.dataset.month ? new Date(m.getFullYear(), m.getMonth() + +el.dataset.month, 1) : null;
      renderUpdates();
    }
    else if (el.dataset.queue) queueEvent(el.dataset.queue, el);
    else if (el.dataset.task) { go('workboard'); openTask(el.dataset.task); }
    else if (el.dataset.card) openEditor((state.updates.cards || []).find(c => c.id === el.dataset.card));
    else if (el.dataset.day) openEditor(null, el.dataset.day);
  });
  $('#updates').addEventListener('change', async e => {
    if (e.target.id !== 'updLead') return;
    try { await api.setUpdateLead(+e.target.value); await loadUpdates(); } catch (err) { toast(err.message, 'var(--red)'); }
  });
  modal.addEventListener('click', e => {
    if (e.target === modal) { closeUpdateEditor(); return; }
    const kind = e.target.closest('[data-kind]');
    if (kind) { editing.kind = kind.dataset.kind; modal.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b === kind)); return; }
    const action = e.target.closest('[data-upd]')?.dataset.upd;
    if (action === 'cancel') closeUpdateEditor();
    else if (action === 'save') saveCard();
    else if (action === 'delete') deleteCard(e.target.closest('[data-upd]'));
  });
  modal.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveCard(); } });
}
