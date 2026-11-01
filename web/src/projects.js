// The projects in the RoDev folder, and switching between them.
import { state, emit } from './state.js';
import { api, DEMO } from './api.js';
import { storage } from './lib/storage.js';

const remember = id => { if (!DEMO) storage.set('rocco.project', id); };

export async function loadProjects() {
  const r = await api.projects();
  state.projects = r.projects || [];
  if (!state.projects.some(p => p.id === state.project)) state.project = r.home;
  remember(state.project);
}

export function switchProject(id) {
  if (id === state.project) return;
  state.project = id;
  remember(id);
  state.tasks = [];
  state.conn = null;
  state.history = null;
  state.docs = null;
  state.meta = { project: state.projects.find(p => p.id === id) || null, lanes: { count: 0, open: [], main: false }, main: {} };
  emit('project');
}
