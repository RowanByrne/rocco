// The sidebar: project picker, navigation, Main and the lanes, and the user.
import { state, emit, currentProject } from './state.js';
import { $, $$, esc } from './lib/dom.js';
import { agoText, initial, logoVars } from './lib/format.js';
import { icon } from './lib/icons.js';
import { storage } from './lib/storage.js';
import { api, DEMO } from './api.js';
import { openMenu, closeMenus } from './ui/menu.js';
import { sortable } from './ui/sortable.js';
import { switchProject } from './projects.js';
import { openOnboarding, openLanesDialog } from './dialogs/onboarding.js';
import { go } from './router.js';

// A lane is busy while a worker is in it, or while it holds a branch: stuck, or a feature waiting for the user or the conductor.
function laneState(n) {
  const t = state.tasks.find(t => t.lane === n && (t.status === 'working' || t.status === 'stuck' || (t.where === 'lane' && (t.status === 'ready' || t.status === 'queued'))));
  if (!t) return ['', `Lane ${n}: free`];
  if (t.status === 'working' || t.status === 'stuck') return [t.status, `Lane ${n}: ${t.title}`];
  return ['held', `Lane ${n}: holding ${t.branch || 'a branch'} for ${t.title}`];
}

export function renderSidebar() {
  const p = currentProject();
  $('#projLogo').textContent = initial(p.name);
  $('#projLogo').style.cssText = logoVars(p.id || p.name);
  $('#projName').textContent = p.name || 'Rocco';
  $('#projSub').textContent = DEMO ? `${p.phase || ''} · demo data` : (p.phase || '');

  // Main: green while Lync serves it, grey when it doesn't, red when the Rocco server is gone.
  const lanes = state.meta.lanes || { count: 0, open: [], main: false };
  $('#liveDot').className = 'live' + (!state.online ? ' off' : lanes.main ? '' : ' idle');
  $('#mainAgo').textContent = state.online ? agoText(state.meta.main.at) : 'Rocco offline';
  $('#mainStat').title = !state.online ? 'The Rocco server stopped. Run tools\\rocco.bat in any project.'
    : `${lanes.main ? 'Lync is serving Main.' : 'Lync isn\'t serving Main.'}${state.meta.main.subject ? ` Last change: ${state.meta.main.subject}` : ''}`;

  // Lanes: one labeled chip per lane this PC opens, up to 8 a row, outlined while its Lync isn't serving. The key below says what each color means.
  const open = new Set(lanes.open || []);
  const bars = Array.from({ length: lanes.count }, (_, i) => {
    const n = i + 1, [cls, tip] = laneState(n), isOpen = open.has(n);
    return { n, cls: cls + (isOpen ? '' : ' closed'), tip: tip + (isOpen ? '' : ' · not open'), busy: !!cls };
  });
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
  $('#lanes').innerHTML = bars.map(b => `<span class="ln ${b.cls}" title="${esc(b.tip)}">L${b.n}</span>`).join('');
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

const avatarHTML = () => state.me?.avatar ? `<img src="${esc(state.me.avatar)}" alt="" referrerpolicy="no-referrer">` : esc(initial(state.me?.name || 'You'));

export function renderMe() {
  $('#meAvatar').innerHTML = avatarHTML();
  $('#meName').textContent = state.me?.name || 'You';
  $('#meSub').textContent = state.me?.pc || '';
}

export async function loadMe() {
  try { state.me = await api.me(); emit('me'); } catch { /* the sidebar shows the server is offline */ }
}

function meMenuHTML() {
  const m = state.me || {};
  const row = (key, value) => value ? `<div class="kv"><span>${key}</span><span title="${esc(value)}">${esc(value)}</span></div>` : '';
  return `<div class="me-card"><span class="avatar">${avatarHTML()}</span><span class="ws-text"><span class="ws-name">${esc(m.name || 'You')}</span>`
    + `<span class="ws-sub">${esc(m.login ? '@' + m.login : m.email || '')}</span></span></div><div class="menu-sep"></div>`
    + row('Agent', state.agent?.name) + row('Claude account', m.claude) + row('Git email', m.email) + row('This PC', m.pc)
    + row('Lanes here', state.meta.lanes.count ? `${state.meta.lanes.count} for this project` : '')
    + `<div class="menu-sep"></div><button class="menu-item" data-goto="connections" role="menuitem">${icon.plug}<span class="mi-text">Connections</span></button>`
    + `<button class="menu-item" data-goto="settings" role="menuitem">${icon.sliders}<span class="mi-text">Settings</span></button>`;
}

// ---- Projects ----

function projectMenuHTML() {
  return `<div class="menu-label">Projects</div>`
    + state.projects.map(p => `<button class="menu-item" data-project="${esc(p.id)}" role="menuitem"><span class="logo sm" style="${logoVars(p.id)}">${initial(p.name)}</span>`
      + `<span class="mi-text"><span class="mi-name">${esc(p.name)}</span><span class="mi-sub">${esc(p.phase)}</span></span>`
      + `${p.id === state.project ? `<span class="tick">${icon.checkSm}</span>` : ''}</button>`).join('')
    + `<div class="menu-sep"></div><button class="menu-item" data-new-project role="menuitem"><span class="add-tile">${icon.plus}</span><span class="mi-text">New project</span></button>`;
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

  $('#projBtn').addEventListener('click', () => openMenu($('#projMenu'), $('#projBtn'), projectMenuHTML()));
  $('#projMenu').addEventListener('click', e => {
    const project = e.target.closest('[data-project]');
    if (project) { closeMenus(); switchProject(project.dataset.project); }
    else if (e.target.closest('[data-new-project]')) { closeMenus(); openOnboarding(); }
  });

  $('#meBtn').addEventListener('click', () => openMenu($('#meMenu'), $('#meBtn'), meMenuHTML(), { up: true }));
  $('#meMenu').addEventListener('click', e => {
    const target = e.target.closest('[data-goto]');
    if (target) { closeMenus(); go(target.dataset.goto); }
  });

  $('#laneStat').addEventListener('click', () => { if (!currentProject().template && !state.meta.lanes.jobs?.length) openLanesDialog(); });
}
