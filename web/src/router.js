// Which view is showing, kept in the address: ?p=<project>#<view>, or #docs/<path> for one doc.
import { state, emit } from './state.js';
import { $$ } from './lib/dom.js';
import { DEMO } from './api.js';

const VIEWS = ['workboard', 'metrics', 'history', 'docs', 'connections', 'settings'];

export function showView(name) {
  const [view, ...doc] = String(name).split('/');
  state.view = VIEWS.includes(view) ? view : 'workboard';
  if (state.view === 'docs' && doc.length) { try { state.doc = decodeURI(doc.join('/')); } catch { state.doc = ''; } }
  $$('.view').forEach(el => { el.hidden = el.dataset.view !== state.view; });
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === state.view));
  emit('view');
}

export function go(name) {
  showView(name);
  syncUrl();
}

// A doc's own address, to open it in a new tab.
export const docUrl = path => `?p=${encodeURIComponent(state.project)}${DEMO ? '&demo' : ''}#docs/${encodeURI(path)}`;

export function syncUrl() {
  const hash = state.view === 'docs' && state.doc ? `docs/${encodeURI(state.doc)}` : state.view;
  try { history.replaceState(null, '', `?p=${encodeURIComponent(state.project)}${DEMO ? '&demo' : ''}#${hash}`); } catch {}
}
