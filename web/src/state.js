// What the app knows, shared by every part. Parts announce changes with emit(); main.js decides what re-renders.
import { isToday } from './lib/format.js';

export const state = {
  project: '',          // the open project's id: its folder name in the RoDev folder
  projects: [],         // every project in the RoDev folder
  tasks: [],            // the open project's Workboard tasks
  meta: { project: null, lanes: { count: 0, open: [], main: false }, main: {} },
  me: null,             // the user: git name and email, GitHub avatar, Claude account, this PC
  conn: null,           // Connections: { checking, checkedAt, online, items }
  history: null,        // History: { repo, main, branches, lanes }
  docs: null,           // Docs: { repo, template, docs }, every Markdown file in the repo
  doc: '',              // the doc open in Docs: its path in the repo
  online: true,         // false while the Rocco server can't be reached
  view: 'workboard',
};

const bus = new EventTarget();
export const on = (name, handler) => bus.addEventListener(name, e => handler(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export const byId = id => state.tasks.find(t => t.id === id);
export const of = status => state.tasks.filter(t => t.status === status);
export const approvedToday = () => of('done').filter(t => isToday(t.doneAt)).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
export const currentProject = () => state.projects.find(p => p.id === state.project) || state.meta.project || { id: state.project, name: 'Rocco', phase: '' };
