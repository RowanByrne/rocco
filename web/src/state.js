// What the app knows, shared by every part. Parts announce changes with emit(); main.js decides what re-renders.
import { isToday } from './lib/format.js';

export const state = {
  project: '',          // the open project's id: its folder name in the RoDev folder
  projects: [],         // every project in the RoDev folder
  tasks: [],            // the open project's Workboard tasks
  extra: new Map(),     // tasks opened from the archive or a link, which the board no longer carries: id -> task
  others: [],           // the other projects that want the user: { id, name, stuck, ready, asks } (sync.js)
  // leads: the threads with an agent of their own (a feature's, or a card's): { id, title, kind, lane, conductor, ... }
  meta: { project: null, lanes: { count: 0, open: [], main: false }, conductor: { state: 'none' }, leads: [], main: {}, limits: null, memory: null },
  me: null,             // the user: git name and email, GitHub avatar, Claude account (if any), this PC
  agent: null,          // this PC's coding agent: { id, name, short, installed, agents } (agent.js)
  conn: null,           // Connections: { checking, checkedAt, online, items }
  history: null,        // History: { repo, main, branches, lanes }
  docs: null,           // Docs: { repo, template, docs }, every Markdown file in the repo
  doc: '',              // the doc open in Docs: its path in the repo
  online: true,         // false while the Rocco server can't be reached
  problem: '',          // what the server said when it answered the last poll with an error
  rocco: '',            // the running Rocco's version, like v0.2.0 (or main @ abc1234 for a development copy)
  view: 'workboard',
};

const bus = new EventTarget();
export const on = (name, handler) => bus.addEventListener(name, e => handler(/** @type {CustomEvent} */ (e).detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

// A task by its id: on the board, or one opened from the archive.
// A task's id: its game's code and a number (DR-012). A game made before that keeps T-012 on disk, shown with the code
// (ticket), and its code's form finds it (taskId). TASK_ID matches either in text; TASK_ID_IN_TEXT as an id appears in
// a message, three digits or more (server/core.ps1 $TaskIdPattern).
export const TASK_ID = /^(?:T|[A-Z][A-Z0-9]{1,3})-\d+$/;
export const TASK_ID_IN_TEXT = /(?:^|[^\w-])((?:T|[A-Z][A-Z0-9]{1,3})-\d{3,})(?![\w-])/g;
const code = () => /** @type {any} */ (state.meta.project)?.code || '';
export const ticket = id => { const m = /^T-(\d+)$/.exec(String(id || '')), c = code(); return m && c ? `${c}-${m[1]}` : String(id || ''); };
export const taskId = id => {
  const up = String(id || '').trim().toUpperCase(), c = code(), m = c && new RegExp(`^${c}-(\\d+)$`).exec(up);
  return m && !state.tasks.some(t => t.id === up) && !state.extra.has(up) ? `T-${m[1]}` : up;
};
export const byId = id => state.tasks.find(t => t.id === id) || state.extra.get(id) || (TASK_ID.test(String(id || '').toUpperCase()) && id !== taskId(id) ? byId(taskId(id)) : undefined);
export const of = status => state.tasks.filter(t => t.status === status);
export const approvedToday = () => of('done').filter(t => isToday(t.doneAt)).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
export const currentProject = () => state.projects.find(p => p.id === state.project) || state.meta.project || { id: state.project, name: 'Rocco', phase: '' };
