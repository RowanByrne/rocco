// Keeps the open project's tasks current: polls the server and announces 'tasks' when anything changed.
import { state, emit } from './state.js';
import { api } from './api.js';
import { toast } from './ui/toast.js';
import { notify } from './notify.js';

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

// Task files (screenshots, audio options) by name become addresses; data: and blob: ones are already addresses.
const fileUrl = (t, name) => !name || /^(data|blob|https?):/.test(name) ? name : api.file(t.id, name);

function apply(s) {
  const before = new Map(state.tasks.map(t => [t.id, t.status]));
  state.meta = { project: s.project, lanes: s.lanes || { count: 0, open: [], main: false }, main: s.main || {} };
  state.tasks = (s.tasks || []).map(t => ({
    ...t,
    options: t.options || [],
    log: t.log || [],
    shots: (t.shots || []).map(name => fileUrl(t, name)),
    questions: (t.questions || []).map(q => ({ ...q, options: (q.options || []).map(o => ({ ...o, audio: fileUrl(t, o.audio) })) })),
  }));
  if (loaded) for (const t of state.tasks) {
    const was = before.get(t.id);
    if (was === t.status) continue;
    t.fresh = true;
    if (!was && t.kind === 'plan') tell(`Plan to approve: ${t.title}`, t, 'var(--violet)');
    else if (!was && t.status === 'inbox') tell(`Claude spotted: ${t.title}`, t, 'var(--claude)');
    else if (was && t.status === 'ready') tell(`Ready to test: ${t.title}`, t);
    else if (was && t.status === 'stuck') tell(`Needs your answer: ${t.title}`, t, 'var(--amber)');
  }
  loaded = true;
  emit('tasks');
}

// A toast, and a desktop notification when Rocco is in the background; clicking it opens the task.
function tell(message, t, color) {
  toast(message, color);
  notify('Rocco', message, () => emit('open-task', t.id));
}

function setOnline(value) {
  if (state.online === value) return;
  state.online = value;
  emit('side');
}
