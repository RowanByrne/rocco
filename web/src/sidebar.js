// The sidebar: project picker, navigation, Main and the lanes, and the user.
import { state, emit, currentProject } from './state.js';
import { $, $$ } from './lib/dom.js';
import { html, render, nothing } from './lib/html.js';
import { agoText, initial, logoVars } from './lib/format.js';
import { icon } from './lib/icons.js';
import { storage } from './lib/storage.js';
import { api, DEMO } from './api.js';
import { openMenu, closeMenus } from './ui/menu.js';
import { sortable } from './ui/sortable.js';
import { switchProject } from './projects.js';
import { openOnboarding, openLanesDialog } from './dialogs/onboarding.js';
import { go } from './router.js';
import { shownTheme, toggleTheme } from './theme.js';
import { once } from './lib/busy.js';
import { toast } from './ui/toast.js';
import { notify } from './notify.js';
import { refresh } from './sync.js';

// A lane is busy while a worker is in it, or while it holds a branch: stuck, or a feature waiting for the user or the conductor.
function laneState(n) {
  const t = state.tasks.find(t => t.lane === n && (t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && (t.status === 'ready' || t.status === 'queued'))));
  // A feature's own agent (or a card's) keeps its lane for as long as it's being built (server/leads.ps1).
  const lead = state.tasks.find(t => t.lead && t.lane === n && !['done', 'removed'].includes(t.status));
  if (lead && !(t && t.status === 'stuck')) return ['working', `Lane ${n}: ${lead.title}, with its own agent`];
  if (!t) return ['', `Lane ${n}: free`];
  if (t.status === 'working' || t.status === 'stuck') return [t.status, `Lane ${n}: ${t.title}`];
  return ['held', `Lane ${n}: holding ${t.branch || 'a branch'} for ${t.title}`];
}

// ---- A lane that went down ----

const DOWN_WHAT = { lync: 'Lync stopped', studio: 'Studio closed', agent: 'its agent stopped' };
const downText = d => d.what.map(w => DOWN_WHAT[w]).join(', ');

// The lanes with work in them that went down: [{ lane, what }], what holding 'lync' (its Lync stopped), 'studio' (its
// place isn't open in Studio) and 'agent' (the feature's own agent in it stopped). Only lanes with work in them: a lane
// with none is just shown as not open, since Rocco can't tell a crash from the user closing it. Nothing while the lanes
// are being opened.
export function downLanes() {
  const lanes = /** @type {any} */ (state.meta.lanes) || {};
  if (!lanes.count || lanes.jobs?.length) return [];
  const open = new Set(lanes.open || []), studio = Array.isArray(lanes.studio) ? new Set(lanes.studio) : null;
  const out = [];
  for (let n = 1; n <= lanes.count; n++) {
    const work = state.tasks.some(t => t.lane === n && t.status === 'working');
    const leadTask = state.tasks.find(t => t.lead && t.lane === n && !['done', 'removed'].includes(t.status));
    const lead = leadTask && (state.meta.leads || []).find(l => l.id === leadTask.id);
    const building = !!lead && lead.opened && !lead.done && !lead.handoff && !lead.waiting;
    if (!work && !building) continue;
    const what = [];
    if (!open.has(n)) what.push('lync');
    if (studio && !studio.has(n)) what.push('studio');
    if (building && lead.conductor?.state === 'none') what.push('agent');
    if (what.length) out.push({ lane: n, what });
  }
  return out;
}

// Fix lanes: Rocco opens again what went down (server/lanes.ps1 Repair-Lanes), and tells the agent with work there.
async function fixLanes(button) {
  const down = downLanes();
  if (!down.length) return;
  await once('fix-lanes', async () => {
    try {
      const r = await api.fixLanes(down);
      const names = down.map(d => d.lane);
      toast(`Rocco is opening ${names.length === 1 ? `lane ${names[0]}` : `lanes ${names.join(', ')}`} again${r.agents?.length ? ', with its agent' : ''}`, 'var(--green)');
      await refresh();
    } catch (e) { toast(`Couldn't fix the lanes: ${e.message}`, 'var(--red)'); }
  }, button);
}

// A busy lane going down gets a toast and a desktop notification, once; one already down when Rocco loaded doesn't.
const downSeen = new Set();
let downFirst = true;
function announceDown(down) {
  if (!state.online || !('stamp' in (state.meta.conductor || {}))) return; // not loaded yet
  const now = new Set(down.map(d => `${state.project}:${d.lane}:${d.what.join(',')}`));
  for (const key of [...downSeen]) if (!now.has(key)) downSeen.delete(key);
  for (const d of down) {
    const key = `${state.project}:${d.lane}:${d.what.join(',')}`;
    if (downSeen.has(key)) continue;
    downSeen.add(key);
    if (downFirst) continue;
    const message = `Lane ${d.lane} is down: ${downText(d)}. Fix lanes opens it again.`;
    toast(message, 'var(--red)', { label: 'Fix lanes', run: () => fixLanes(null) });
    notify('Rocco', message, () => fixLanes(null));
  }
  downFirst = false;
}

export function renderSidebar() {
  const p = currentProject();
  $('#projLogo').textContent = initial(p.name);
  $('#projLogo').style.cssText = logoVars(p.id || p.name);
  $('#projName').textContent = p.name || 'Rocco';
  $('#projSub').textContent = DEMO ? `${p.phase || ''} · demo data` : (p.phase || '');

  // Main: green while Lync serves it, grey when it doesn't, red when the Rocco server is gone, amber when it
  // answers with an error (sync.js).
  const lanes = state.meta.lanes || { count: 0, open: [], main: false };
  $('#liveDot').className = 'live' + (!state.online ? ' off' : state.problem ? ' warn' : lanes.main ? '' : ' idle');
  $('#mainAgo').textContent = !state.online ? 'Rocco offline' : state.problem ? 'Rocco error' : agoText(state.meta.main.at);
  $('#mainStat').title = !state.online ? 'The Rocco server stopped. Run tools\\rocco.bat in any project.'
    : state.problem ? `The Rocco server answered with an error: ${state.problem}`
    : `${lanes.main ? 'Lync is serving Main.' : 'Lync isn\'t serving Main.'}${state.meta.main.subject ? ` Last change: ${state.meta.main.subject}` : ''}`;

  // Lanes: one labeled chip per lane this PC opens, up to 8 a row, outlined while its Lync isn't serving. The key below says what each color means.
  // A lane with work in it that went down is red, and the line under them says so, with Fix lanes.
  const open = new Set(lanes.open || []);
  const down = downLanes(), downOf = new Map(down.map(d => [d.lane, d]));
  const bars = Array.from({ length: lanes.count }, (_, i) => {
    const n = i + 1, [cls, tip] = laneState(n), isOpen = open.has(n), d = downOf.get(n);
    if (d) return { n, cls: `${cls} down`, tip: `${tip} · down: ${downText(d)}`, busy: true };
    return { n, cls: cls + (isOpen ? '' : ' closed'), tip: tip + (isOpen ? '' : ' · not open'), busy: !!cls };
  });
  render(down.length ? html`<span class="ld-text" title=${down.map(d => `Lane ${d.lane}: ${downText(d)}`).join('\n')}>${
    down.length === 1 ? `Lane ${down[0].lane}: ${downText(down[0])}` : `Lanes ${down.map(d => d.lane).join(', ')} are down`}</span><button class="btn-sm ld-fix" data-fix-lanes title="Open again what went down, and tell the agent working there">Fix lanes</button>` : nothing, $('#laneDown'));
  $('#laneDown').hidden = !down.length;
  announceDown(down);
  // Lanes opens the lanes screen (onboarding.js): how many this PC runs, and opening them. A PC with none yet is asked.
  const game = !currentProject().template && state.online;
  $('#laneStat').hidden = !lanes.count && !game;
  $('#laneKey').hidden = !lanes.count;
  $('#laneStat').classList.toggle('unset', game && lanes.mine == null && !lanes.jobs?.length);
  $('#laneStat').title = game ? 'How many lanes this PC runs, and opening them' : '';
  $('#laneCount').textContent = lanes.jobs?.length ? 'Opening…'
    : game && lanes.mine == null ? 'Set up'
    : `${[...open].filter(n => n <= lanes.count).length} open · ${bars.filter(b => b.busy).length} busy`;
  $('#lanes').style.gridTemplateColumns = `repeat(${Math.min(lanes.count, 8) || 1}, 1fr)`;
  render(bars.map(b => html`<span class="ln ${b.cls}" title=${b.tip}>L${b.n}</span>`), $('#lanes'));
}

// ---- Navigation: categories fold, and categories and the tabs in them drag into the user's order. Kept in this browser. ----

const NAV_KEY = 'rocco.nav';
let navDefault = null; // the page's own order, for Reset

const navGroups = () => [...$('#navGroups').children];
const navOrder = () => ({
  groups: navGroups().map(g => g.dataset.group),
  items: Object.fromEntries(navGroups().map(g => [g.dataset.group, [...g.querySelectorAll('.nav a')].map(a => a.dataset.view)])),
});

function saveNav() {
  const closed = navGroups().filter(g => g.classList.contains('closed')).map(g => g.dataset.group);
  storage.set(NAV_KEY, JSON.stringify({ ...navOrder(), closed }));
}

function setFolded(group, folded) {
  group.classList.toggle('closed', folded);
  group.querySelector('.nav-head').setAttribute('aria-expanded', String(!folded));
}

// Puts a parent's children in the saved order. One the saved order doesn't know (a tab added in a newer Rocco) stays after the one it followed.
function arrange(parent, saved, idOf) {
  const kids = [...parent.children];
  const order = (saved || []).map(id => kids.find(k => idOf(k) === id)).filter(Boolean);
  kids.forEach((k, i) => { if (!order.includes(k)) order.splice(i ? order.indexOf(kids[i - 1]) + 1 : 0, 0, k); });
  order.forEach(k => parent.appendChild(k));
}

function applyNav(saved) {
  arrange($('#navGroups'), saved.groups, g => g.dataset.group);
  for (const g of navGroups()) {
    arrange(g.querySelector('.nav'), saved.items?.[g.dataset.group], a => a.dataset.view);
    setFolded(g, (saved.closed || []).includes(g.dataset.group));
  }
}

export function resetNav() {
  applyNav(navDefault);
  storage.set(NAV_KEY, '');
}

function initNav() {
  navDefault = navOrder();
  let saved = {};
  try { saved = JSON.parse(storage.get(NAV_KEY) || '{}'); } catch { /* a broken entry: start from the page's order */ }
  applyNav(saved);
  $('#navGroups').addEventListener('click', e => {
    const group = e.target.closest('.nav-head')?.closest('.nav-group');
    if (!group) return;
    setFolded(group, !group.classList.contains('closed'));
    saveNav();
  });
  sortable($('#navGroups'), { items: '.nav-group', handle: '.nav-head', onDrop: saveNav });
  $$('.nav').forEach(nav => sortable(nav, { items: 'a', onDrop: saveNav }));
}

// ---- The user ----

const avatar = () => state.me?.avatar ? html`<img src=${state.me.avatar} alt="" referrerpolicy="no-referrer">` : initial(state.me?.name || 'You');

export function renderMe() {
  render(avatar(), $('#meAvatar'));
  $('#meName').textContent = state.me?.name || 'You';
  $('#meSub').textContent = state.me?.pc || '';
}

export async function loadMe() {
  try { state.me = await api.me(); emit('me'); } catch { /* the sidebar shows the server is offline */ }
}

function meMenu() {
  const m = state.me || {};
  const row = (key, value) => value ? html`<div class="kv"><span>${key}</span><span title=${value}>${value}</span></div>` : nothing;
  return html`<div class="me-card"><span class="avatar">${avatar()}</span><span class="ws-text"><span class="ws-name">${m.name || 'You'}</span><span class="ws-sub">${m.login ? '@' + m.login : m.email || ''}</span></span></div><div class="menu-sep"></div>${
    row('Agent', state.agent?.name)}${row('Claude account', m.claude)}${row('Git email', m.email)}${row('This PC', m.pc)}${
    row('Lanes here', state.meta.lanes.count ? `${state.meta.lanes.count} for this project` : '')
  }<div class="menu-sep"></div><button class="menu-item" data-dark role="menuitemcheckbox" aria-checked=${shownTheme() === 'dark' ? 'true' : 'false'}>${icon.moon}<span class="mi-text">Dark mode</span><span class="switch sm" aria-checked=${shownTheme() === 'dark' ? 'true' : 'false'}><span></span></span></button><button class="menu-item" data-goto="connections" role="menuitem">${icon.plug}<span class="mi-text">Connections</span></button><button class="menu-item" data-goto="settings" role="menuitem">${icon.sliders}<span class="mi-text">Settings</span></button>`;
}

// ---- Projects ----

// What another project wants the user for (sync.js keeps state.others): shown beside it, so work there isn't left waiting.
function wantsOf(id) {
  const o = state.others.find(x => x.id === id);
  if (!o) return nothing;
  const parts = [o.asks && `${o.asks} question${o.asks === 1 ? '' : 's'} from its conductor`, o.stuck && `${o.stuck} stuck`, o.ready && `${o.ready} to test`].filter(Boolean);
  return html`<span class="mi-wants" title=${parts.join(', ')}>${(o.asks || 0) + (o.stuck || 0) + (o.ready || 0)}</span>`;
}

function projectMenu() {
  return html`<div class="menu-label">Projects</div>${state.projects.map(p => html`<button class="menu-item" data-project=${p.id} role="menuitem"><span class="logo sm" style=${logoVars(p.id)}>${initial(p.name)}</span><span class="mi-text"><span class="mi-name">${p.name}</span><span class="mi-sub">${p.phase}</span></span>${wantsOf(p.id)}${
    p.id === state.project ? html`<span class="tick">${icon.checkSm}</span>` : nothing}</button>`)
  }<div class="menu-sep"></div><button class="menu-item" data-new-project role="menuitem"><span class="add-tile">${icon.plus}</span><span class="mi-text">New project</span></button>`;
}

export function initSidebar() {
  // Narrow windows always get the icon rail; wide ones keep the user's choice.
  const app = $('#app');
  const narrow = matchMedia('(max-width: 760px)');
  const fit = () => app.classList.toggle('collapsed', narrow.matches || storage.get('rocco.sidebar') === 'collapsed');
  fit();
  narrow.addEventListener('change', fit);
  $('#collapse').addEventListener('click', () => {
    closeMenus();
    app.classList.toggle('collapsed');
    if (!narrow.matches) storage.set('rocco.sidebar', app.classList.contains('collapsed') ? 'collapsed' : 'open');
  });

  $$('.nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.view); }));
  initNav();

  $('#projBtn').addEventListener('click', () => openMenu($('#projMenu'), $('#projBtn'), projectMenu()));
  $('#projMenu').addEventListener('click', e => {
    const project = e.target.closest('[data-project]');
    if (project) { closeMenus(); switchProject(project.dataset.project); }
    else if (e.target.closest('[data-new-project]')) { closeMenus(); openOnboarding(); }
  });

  $('#meBtn').addEventListener('click', () => openMenu($('#meMenu'), $('#meBtn'), meMenu(), { up: true }));
  $('#meMenu').addEventListener('click', e => {
    const target = e.target.closest('[data-goto]');
    if (target) { closeMenus(); go(target.dataset.goto); }
    // The menu stays open, with its switch flipped.
    else if (e.target.closest('[data-dark]')) { toggleTheme(); render(meMenu(), $('#meMenu')); }
  });

  $('#laneDown').addEventListener('click', e => { const b = /** @type {Element} */ (e.target).closest('[data-fix-lanes]'); if (b) fixLanes(b); });
  $('#laneStat').addEventListener('click', () => { if (!currentProject().template && !state.meta.lanes.jobs?.length) openLanesDialog(); });
}
