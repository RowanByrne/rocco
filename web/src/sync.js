// Keeps the open project's tasks current: polls the server and announces 'tasks' when anything changed.
import { state, emit } from './state.js';
import { api } from './api.js';
import { toast } from './ui/toast.js';

const POLL_MS = 2500;
let lastJson = '';
let loaded = false;

export async function load() {
  try {
    const text = await api.state();
    setOnline(true);
    if (text === lastJson) return;
    lastJson = text;
    apply(JSON.parse(text));
  } catch { setOnline(false); }
}

// After the user changes something: load now, even if the text looks the same.
export function refresh() { lastJson = ''; return load(); }

// A different project: forget the old one, so its changes don't toast.
export function reset() { lastJson = ''; loaded = false; }

export function start() {
  load();
  setInterval(load, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}

function apply(s) {
  const before = new Map(state.tasks.map(t => [t.id, t.status]));
  state.meta = { project: s.project, lanes: s.lanes || { count: 0, open: [], main: false }, main: s.main || {} };
  state.tasks = (s.tasks || []).map(t => ({
    ...t,
    options: t.options || [],
    log: t.log || [],
    shots: (t.shots || []).map(name => /^(data|blob):/.test(name) ? name : api.file(t.id, name)),
  }));
  if (loaded) for (const t of state.tasks) {
    const was = before.get(t.id);
    if (!was || was === t.status) continue;
    t.fresh = true;
    if (t.status === 'ready') toast(`Ready to test: ${t.title}`);
    else if (t.status === 'stuck') toast(`Needs your answer: ${t.title}`, 'var(--amber)');
  }
  loaded = true;
  emit('tasks');
}

function setOnline(value) {
  if (state.online === value) return;
  state.online = value;
  emit('side');
}
