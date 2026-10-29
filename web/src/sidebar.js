// The sidebar: project picker, navigation, Main and the lanes, and the user.
import { state, emit, currentProject } from './state.js';
import { $, $$, esc } from './lib/dom.js';
import { agoText, initial, logoVars } from './lib/format.js';
import { icon } from './lib/icons.js';
import { storage } from './lib/storage.js';
import { api, DEMO } from './api.js';
import { openMenu, closeMenus } from './ui/menu.js';
import { switchProject } from './projects.js';
import { openNewProject } from './dialogs/new-project.js';
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
  $('#mainStat').title = !state.online ? 'The Rocco server stopped. Run rocco\\Rocco.bat.'
    : `${lanes.main ? 'Lync is serving Main.' : 'Lync isn\'t serving Main.'}${state.meta.main.subject ? ` Last change: ${state.meta.main.subject}` : ''}`;

  // Lanes: one bar per lane this PC opens, outlined while its Lync isn't serving.
  const open = new Set(lanes.open || []);
  const bars = Array.from({ length: lanes.count }, (_, i) => {
    const n = i + 1, [cls, tip] = laneState(n), isOpen = open.has(n);
    return { cls: cls + (isOpen ? '' : ' closed'), tip: tip + (isOpen ? '' : ' · not open'), busy: !!cls };
  });
  $('#laneStat').hidden = !lanes.count;
  $('#laneCount').textContent = `${[...open].filter(n => n <= lanes.count).length} open · ${bars.filter(b => b.busy).length} busy`;
  $('#lanes').style.gridTemplateColumns = `repeat(${lanes.count || 1}, 1fr)`;
  $('#lanes').style.gap = lanes.count > 8 ? '3px' : '4px';
  $('#lanes').innerHTML = bars.map(b => `<span class="ln ${b.cls}" title="${esc(b.tip)}"></span>`).join('');
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
    + row('Claude', m.claude) + row('Git email', m.email) + row('This PC', m.pc)
    + row('Lanes here', state.meta.lanes.count ? `${state.meta.lanes.count} for this project` : '')
    + `<div class="menu-sep"></div><button class="menu-item" data-goto="connections" role="menuitem">${icon.plug}<span class="mi-text">Connections</span></button>`;
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
  const app = $('#app');
  const saved = storage.get('rocco.sidebar');
  app.classList.toggle('collapsed', saved ? saved === 'collapsed' : innerWidth < 600);
  $('#collapse').addEventListener('click', () => {
    closeMenus();
    app.classList.toggle('collapsed');
    storage.set('rocco.sidebar', app.classList.contains('collapsed') ? 'collapsed' : 'open');
  });

  $$('.nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.view); }));

  $('#projBtn').addEventListener('click', () => openMenu($('#projMenu'), $('#projBtn'), projectMenuHTML()));
  $('#projMenu').addEventListener('click', e => {
    const project = e.target.closest('[data-project]');
    if (project) { closeMenus(); switchProject(project.dataset.project); }
    else if (e.target.closest('[data-new-project]')) { closeMenus(); openNewProject(); }
  });

  $('#meBtn').addEventListener('click', () => openMenu($('#meMenu'), $('#meBtn'), meMenuHTML(), { up: true }));
  $('#meMenu').addEventListener('click', e => {
    const target = e.target.closest('[data-goto]');
    if (target) { closeMenus(); go(target.dataset.goto); }
  });
}
