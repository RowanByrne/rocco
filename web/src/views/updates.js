// Updates: the game's calendar. The user's cards for upcoming updates (live/CALENDAR.md), the events on the game page
// (from Roblox), and each update's game page event, which the agent makes. Rocco queues it by itself when the update is
// close enough (the lead, kept in CALENDAR.md), or the user queues it from the card.
import { state, emit } from '../state.js';
import { $, webUrl } from '../lib/dom.js';
import { html, render, nothing, keyed } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { busy, once } from '../lib/busy.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { go } from '../router.js';
import { openTask } from './workboard.js';

const KINDS = ['Update', 'Live event', 'Timed release'];
const KIND_COLOR = { 'Update': 'var(--accent-text)', 'Live event': 'var(--amber)', 'Timed release': 'var(--cyan)' };
const LEADS = [0, 7, 14, 21, 30];
let month = null;   // the first day of the month on show
let timer = null;
let loadError = ''; // why the last load couldn't be read
let editing = null; // the card in the editor: { n, card (null for a new one), fields as it opened, kind, confirm }
let opened = 0;     // counts the editor's openings, so each starts from fresh fields
const modal = $('#updateModal');

export async function loadUpdates(force = false) {
  clearTimeout(timer);
  if (state.view !== 'updates') return;
  try {
    state.updates = await api.updates(force);
    loadError = '';
    emit('updates');
    const queued = state.updates.auto?.queued || [];
    if (queued.length) toast(`Queued for Rocco: the game page event for ${queued.map(q => q.title).join(', ')}`, 'var(--violet)');
  } catch (e) {
    // What was loaded before stays, under what went wrong.
    loadError = e.message;
    emit('updates');
  }
  // Sooner while Roblox is still being asked.
  timer = setTimeout(() => loadUpdates(), state.updates?.roblox?.loading ? 2500 : 60000);
}

export function resetUpdates() { state.updates = null; month = null; loadError = ''; }

// ---- Dates (cards are days in UTC; the calendar shows the user's days) ----

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayYmd = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = s => Math.round((parseYmd(s).getTime() - parseYmd(todayYmd()).getTime()) / 86400000);
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
  return html`<span class="chip" style="--c:${color}"><i></i>${label}</span>`;
}

// A draft event goes public with the user's click (their Roblox key), else on the Creator Hub.
const hubLink = u => u.roblox?.universe ? html`<a class="mini" href="https://create.roblox.com/dashboard/creations/experiences/${encodeURIComponent(u.roblox.universe)}/events" target="_blank" rel="noreferrer">Publish on the Creator Hub${icon.external}</a>` : nothing;
const publishButton = (id, u) => u.roblox?.linked && id
  ? html`<button class="mini go" data-publish=${id} ?disabled=${busy(`upd:publish:${id}`)}>${busy(`upd:publish:${id}`) ? html`<span class="spin"></span>Publishing` : 'Publish it'}</button>` : hubLink(u);

function cardActions(c, u) {
  if (c.event === 'queued' && c.task) return html`<button class="mini" data-task=${c.task}>${c.task}</button>`;
  if (c.event === 'drafted') return c.onRoblox ? publishButton(c.eventId, u) : hubLink(u);
  if (c.event !== 'notyet' || daysUntil(c.date) < 0) return nothing;
  return html`${u.lead > 0 && daysUntil(c.date) > u.lead ? html`<span class="upd-note">Rocco gets it ${u.lead} days before</span>` : nothing}<button class="mini" data-queue=${c.id} ?disabled=${busy(`upd:queue:${c.id}`)}>Queue its event now</button>`;
}

// The card images the agent made for an update's event: the user picks one.
function candidates(c) {
  if (!c.candidates?.length || !['notyet', 'queued', 'drafted'].includes(c.event)) return nothing; // once it's public, the card is settled
  const picked = (c.image || '').replace(/\\/g, '/').split('/').pop();
  return html`<span class="upd-cands"><span class="upd-note">Pick its card image:</span>${c.candidates.map(f => {
    const on = f.split('/').pop() === picked;
    return html`<button class="upd-cand${on ? ' on' : ''}" data-pick=${c.id} data-image=${f} title=${on ? 'Picked' : 'Use this one'}><img src=${api.artFile(f)} alt="" loading="lazy">${on ? icon.checkSm : nothing}</button>`;
  })}</span>`;
}

// ---- The page ----

function events(u) {
  const r = u.roblox || {};
  const list = (r.events || []).filter(e => !e.end || new Date(e.end) > new Date());
  let body;
  if (!r.universe) body = html`<div class="upd-empty">Add the game's universe id to <code>docs/game/PROJECT.md</code> (the Roblox row) to see its game page events here.</div>`;
  else if (r.loading && !list.length) body = html`<div class="upd-empty"><span class="spin"></span>Checking the game page…</div>`;
  else if (r.error) body = html`<div class="upd-empty">${r.error}</div>`;
  else if (!list.length) body = html`<div class="upd-empty">No upcoming events on the game page.</div>`;
  else body = html`<div class="upd-events">${list.map(e => {
    const draft = e.visibility && e.visibility !== 'public';
    const live = !draft && e.start && new Date(e.start) <= new Date();
    const card = (u.cards || []).find(c => c.eventId && c.eventId === String(e.id));
    return html`<div class="upd-ev${draft ? ' draft' : ''}"><a class="upd-ev-img" href=${webUrl(e.url)} target="_blank" rel="noreferrer">${e.image ? html`<img src=${e.image} alt="" loading="lazy">` : icon.calendar}</a><span class="upd-ev-body"><a class="upd-ev-title" href=${webUrl(e.url)} target="_blank" rel="noreferrer">${e.title}</a><span>${
      draft ? html`<span class="chip" style="--c:var(--amber)"><i></i>Draft: only you see it</span>` : live ? html`<span class="chip" style="--c:var(--green)"><i></i>Live</span>` : nothing}${rangeText(e)}</span>${
      card ? html`<span class="upd-ev-card">${icon.link}${card.title}</span>` : nothing}${
      e.interested != null ? html`<span class="upd-ev-meta">${Number(e.interested).toLocaleString()} interested</span>` : nothing}${
      draft ? html`<span>${publishButton(e.id, u)}</span>` : nothing}</span></div>`;
  })}</div>`;
  const foot = !r.universe ? '' : !r.linked ? 'Public events only. Link your Roblox Open Cloud key in Connections to see drafts and publish them here.'
    : r.access === 'denied' ? 'Your Roblox key can\'t read this game\'s events, so these are only the public ones (Connections).' : '';
  return html`<div class="panel upd-panel"><div class="panel-head">${icon.rocket}On the game page${list.length ? html`<span class="count">${list.length}</span>` : nothing}</div>${body}${
    foot ? html`<div class="panel-foot">${foot}</div>` : nothing}</div>`;
}

function rangeText(e) {
  const f = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return e.end ? `${f(e.start)} – ${f(e.end)}` : f(e.start);
}

function calendar(u) {
  const first = month || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const today = todayYmd();
  const byDay = {};
  for (const c of u.cards || []) if (c.date) (byDay[c.date] ||= []).push(html`<button class="cal-item" style="--c:${KIND_COLOR[c.kind] || KIND_COLOR.Update}" data-card=${c.id} title=${c.title}>${c.title}</button>`);
  for (const e of u.roblox?.events || []) {
    if (!e.start) continue;
    const from = parseYmd(eventDay(e.start)), to = parseYmd(eventDay(e.end || e.start));
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = ymd(d), lead = key === eventDay(e.start) || d.getDay() === 1;
      (byDay[key] ||= []).push(html`<span class="cal-ev${key === eventDay(e.start) ? ' start' : ''}${lead ? '' : ' cont'}${e.visibility && e.visibility !== 'public' ? ' draft' : ''}" title="${e.title} (game page event)">${lead ? e.title : ''}</span>`);
    }
  }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== first.getMonth()) break; // five weeks were enough
    const key = ymd(d);
    cells.push(html`<div class="cal-day${d.getMonth() !== first.getMonth() ? ' out' : ''}${key === today ? ' today' : ''}${key < today ? ' past' : ''}" data-day=${key}><span class="cal-num">${d.getDate()}</span>${byDay[key] || nothing}</div>`);
  }
  return html`<div class="panel cal"><div class="cal-head"><b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><span class="sp"></span><button class="mini" data-month="-1" aria-label="Previous month">‹</button><button class="mini" data-month="0">Today</button><button class="mini" data-month="1" aria-label="Next month">›</button></div><div class="cal-dow">${
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<span>${d}</span>`)}</div><div class="cal-grid">${cells}</div><div class="cal-foot">Click a day to plan an update on it.</div></div>`;
}

function list(u) {
  const today = todayYmd();
  const upcoming = (u.cards || []).filter(c => !c.date || c.date >= today);
  const past = (u.cards || []).filter(c => c.date && c.date < today).reverse();
  const row = c => html`<div class="upd-row" data-card=${c.id}><span class="upd-dot" style="--c:${KIND_COLOR[c.kind] || KIND_COLOR.Update}"></span><div class="upd-main"><b>${c.title}</b><span class="upd-when">${c.kind} · ${c.date ? whenText(c) : 'No date'}</span>${
    c.notes ? html`<span class="upd-notes">${c.notes}</span>` : nothing}<span class="upd-state">${eventChip(c)}${cardActions(c, u)}</span>${candidates(c)}</div></div>`;
  return html`<div class="panel upd-list"><div class="panel-head">${icon.calendar}Planned<span class="count">${upcoming.length}</span></div>${
    upcoming.length ? upcoming.map(row) : html`<div class="upd-empty">Nothing planned yet. <button class="mini" id="updFirst">Plan an update</button></div>`}${
    past.length ? html`<details class="upd-past"><summary>Past (${past.length})</summary>${past.map(row)}</details>` : nothing
  }<div class="panel-foot"><label class="upd-lead">Rocco makes each update's game page event <select class="input" id="updLead" .value=${String(u.lead)}>${
    LEADS.map(n => html`<option value=${n} ?selected=${n === u.lead}>${n ? `${n} days before` : 'only when I ask'}</option>`)}</select></label></div></div>`;
}

const failed = () => loadError ? html`<div class="load-error">${icon.alert}<span>Couldn't load the updates: ${loadError}</span><button class="btn-sm" data-updates-retry>Retry</button></div>` : nothing;

export function renderUpdates() {
  const u = state.updates;
  const el = $('#updates');
  if (!u) {
    render(loadError ? failed() : html`<div class="upd-empty"><span class="spin"></span> Loading…</div>`, el);
    $('#updatesSub').textContent = '';
    return;
  }
  const planned = (u.cards || []).filter(c => !c.date || c.date >= todayYmd()).length;
  const onPage = (u.roblox?.events || []).filter(e => !e.end || new Date(e.end) > new Date()).length;
  $('#updatesSub').textContent = `${planned} planned${u.roblox?.universe && !u.roblox.error ? ` · ${onPage} on the game page` : ''}`;
  render(html`${failed()}${events(u)}<div class="upd-layout">${calendar(u)}${list(u)}</div>`, el);
}

// ---- Editing a card ----

// The fields start from the card and are then the user's: drawing it again (a kind picked, Delete asked once) leaves
// what's typed alone, and each opening starts from fresh ones.
function drawEditor() {
  const e = editing, c = e.fields;
  render(keyed(e.n, html`<h2>${e.card ? 'Edit the update' : 'Plan an update'}</h2><p class="m-sub">It goes on the game's calendar (<code>live/CALENDAR.md</code>), where Rocco reads it too.</p><div class="fields"><label class="lbl">Name<input class="input" id="updTitle" .value=${c.title} placeholder="Pet evolution" autocomplete="off"></label><div class="two"><label class="lbl">Day<input class="input" type="date" id="updDate" .value=${c.date}></label><label class="lbl">Time <small>UTC, optional</small><input class="input" type="time" id="updTime" .value=${c.time}></label></div><div class="lbl">Kind<div class="ob-kinds">${
    KINDS.map(k => html`<button type="button" class="ob-kind${k === e.kind ? ' on' : ''}" data-kind=${k}>${k}</button>`)
  }</div></div><label class="lbl">What's in it<textarea class="field" id="updNotes" rows="4" placeholder="As much or as little as you like: what's new, what players will notice, anything the event should say" .value=${c.notes}></textarea></label><label class="upd-announce"><input type="checkbox" id="updAnnounce" .checked=${c.event !== 'none'}> Announce it with an event on the game page</label></div><div class="m-actions">${
    e.card ? html`<button class="btn ghost-btn${e.confirm ? ' confirm' : ''}" data-upd="delete" style="margin-right:auto">${e.confirm ? 'Delete it?' : 'Delete'}</button>` : nothing
  }<button class="btn" data-upd="cancel">Cancel</button><button class="btn accent" data-upd="save" ?disabled=${busy('upd:save')}>${e.card ? 'Save' : 'Add it'}</button></div>`), modal.querySelector('.modal-card'));
}

function openEditor(card, date) {
  const fields = card || { id: '', title: '', date: date || todayYmd(), time: '', kind: 'Update', notes: '', event: 'notyet' };
  editing = { n: ++opened, card: card || null, fields: { title: fields.title || '', date: fields.date || '', time: fields.time || '', notes: fields.notes || '', event: fields.event }, id: fields.id, kind: fields.kind, confirm: false };
  drawEditor();
  modal.classList.add('open');
  $('#updTitle').focus();
}

export const updateEditorOpen = () => modal.classList.contains('open');
export function closeUpdateEditor() { modal.classList.remove('open'); }

const saveCard = () => once('upd:save', async () => {
  const card = { id: editing.id, title: $('#updTitle').value, date: $('#updDate').value, time: $('#updTime').value, kind: editing.kind, notes: $('#updNotes').value, announce: $('#updAnnounce').checked };
  drawEditor();
  try {
    const r = await api.saveUpdate(card);
    closeUpdateEditor();
    toast(r.saved?.note || `${card.title.trim()}: on the calendar`, r.saved?.note ? 'var(--amber)' : undefined);
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); }
}).then(() => { if (updateEditorOpen()) drawEditor(); });

function deleteCard() {
  if (!editing.confirm) { editing.confirm = true; drawEditor(); return; }
  once('upd:delete', async () => {
    try { await api.removeUpdate(editing.id); closeUpdateEditor(); await loadUpdates(); } catch (e) { toast(e.message, 'var(--red)'); }
  });
}

const publish = eventId => once(`upd:publish:${eventId}`, async () => {
  renderUpdates();
  try {
    await api.publishEvent(eventId);
    toast('Published: it\'s on the game page');
    await loadUpdates(true);
  } catch (e) { toast(e.message, 'var(--red)'); }
}).then(renderUpdates);

const pickImage = (id, image) => once(`upd:image:${id}`, async () => {
  try {
    await api.pickCardImage(id, image);
    toast(`Card image picked. Rocco puts it on the event`);
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); }
});

const queueEvent = id => once(`upd:queue:${id}`, async () => {
  renderUpdates();
  try {
    const r = await api.queueUpdateEvent(id);
    const q = r.queued?.[0];
    toast(q ? `${q.task} is in Up next: Rocco makes the game page event for ${q.title}` : 'It already has one', 'var(--violet)');
    await loadUpdates();
  } catch (e) { toast(e.message, 'var(--red)'); }
}).then(renderUpdates);

export function initUpdates() {
  $('#updateNew').addEventListener('click', () => openEditor(null));
  $('#updates').addEventListener('click', e => {
    if (e.target.closest('a')) return; // links to Roblox open on their own
    const el = e.target.closest('[data-month],[data-queue],[data-task],[data-publish],[data-pick],[data-card],[data-day],[data-updates-retry],#updFirst');
    if (!el) return;
    if (el.id === 'updFirst') openEditor(null);
    else if (el.hasAttribute('data-updates-retry')) loadUpdates(true);
    else if (el.dataset.publish) publish(el.dataset.publish);
    else if (el.dataset.pick) pickImage(el.dataset.pick, el.dataset.image);
    else if (el.dataset.month !== undefined) {
      const now = new Date(), m = month || new Date(now.getFullYear(), now.getMonth(), 1);
      month = +el.dataset.month ? new Date(m.getFullYear(), m.getMonth() + +el.dataset.month, 1) : null;
      renderUpdates();
    }
    else if (el.dataset.queue) queueEvent(el.dataset.queue);
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
    if (kind) { editing.kind = kind.dataset.kind; drawEditor(); return; }
    const action = e.target.closest('[data-upd]')?.dataset.upd;
    if (action === 'cancel') closeUpdateEditor();
    else if (action === 'save') saveCard();
    else if (action === 'delete') deleteCard();
  });
  modal.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveCard(); } });
}
