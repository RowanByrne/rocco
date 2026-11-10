// Keeps the open project's tasks current: polls the server and announces 'tasks' when anything changed, and
// 'conductor' after every change. A change to the conductor alone (what it's doing, its questions) announces only
// 'conductor', so the board isn't redrawn for each of its steps.
import { state, emit } from './state.js';
import { api } from './api.js';
import { toast } from './ui/toast.js';
import { notify } from './notify.js';

const POLL_MS = 2500;
let lastJson = '';
let lastRest = '';
let loaded = false;

export async function load() {
  try {
    const text = await api.state();
    setOnline(true);
    if (text === lastJson) return;
    lastJson = text;
    const s = JSON.parse(text), { conductor, ...rest } = s;
    const restJson = JSON.stringify(rest);
    if (restJson !== lastRest) { lastRest = restJson; apply(s); }
    state.meta.conductor = conductor || { state: 'none' };
    emit('conductor');
  } catch { setOnline(false); }
}

// After the user changes something: load now, even if the text looks the same.
export function refresh() { lastJson = ''; lastRest = ''; return load(); }

// A different project: forget the old one, so its changes don't toast.
export function reset() { lastJson = ''; lastRest = ''; loaded = false; }

export function start() {
  load();
  setInterval(load, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}

// Task files (screenshots, audio options, pictures on questions) by name become addresses; data: and blob: ones are already addresses.
const fileUrl = (t, name) => !name || /^(data|blob|https?):/.test(name) ? name : api.file(t.id, name);

function apply(s) {
  // A different Rocco answering: it updated itself and restarted.
  if (state.rocco && s.rocco && s.rocco !== state.rocco) emit('rocco-updated', s.rocco);
  state.rocco = s.rocco || state.rocco;
  const before = new Map(state.tasks.map(t => [t.id, t.status]));
  state.meta = { project: s.project, lanes: s.lanes || { count: 0, open: [], main: false }, conductor: s.conductor || { state: 'none' }, main: s.main || {} };
  state.tasks = (s.tasks || []).map(t => ({
    ...t,
    options: t.options || [],
    log: t.log || [],
    shots: (t.shots || []).map(name => fileUrl(t, name)),
    questions: (t.questions || []).map(q => ({ ...q, images: (q.images || []).map(name => fileUrl(t, name)),
      options: (q.options || []).map(o => ({ ...o, audio: fileUrl(t, o.audio), image: fileUrl(t, o.image) })) })),
  }));
  if (loaded) for (const t of state.tasks) {
    const was = before.get(t.id);
    if (was === t.status) continue;
    t.fresh = true;
    if (t.kind === 'question') { if (was && t.status === 'ready') tell(`Answered: ${t.title}`, t, 'var(--claude)'); }
    else if (!was && t.kind === 'plan') tell(`Plan to approve: ${t.title}`, t, 'var(--violet)');
    else if (!was && t.status === 'inbox') tell(`Rocco spotted: ${t.title}`, t, 'var(--claude)');
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
