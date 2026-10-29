// Which view is showing, kept in the address: ?p=<project>#<view>.
import { state, emit } from './state.js';
import { $$ } from './lib/dom.js';
import { DEMO } from './api.js';

const VIEWS = ['workboard', 'metrics', 'history', 'connections'];

export function showView(name) {
  state.view = VIEWS.includes(name) ? name : 'workboard';
  $$('.view').forEach(el => { el.hidden = el.dataset.view !== state.view; });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === state.view));
  emit('view');
}

export function go(name) {
  showView(name);
  syncUrl();
}

export function syncUrl() {
  try { history.replaceState(null, '', `?p=${encodeURIComponent(state.project)}${DEMO ? '&demo' : ''}#${state.view}`); } catch {}
}
