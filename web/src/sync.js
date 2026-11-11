// Keeps the open project's tasks current: polls the server and announces 'tasks' when anything changed, and
// 'conductor' after every change. A change to the conductor alone (what it's doing, its questions) announces only
// 'conductor', so the board isn't redrawn for each of its steps. No answer at all means the server stopped; an
// answer that's an error is shown as what it says, and the polling goes on.
import { state, emit } from './state.js';
import { api } from './api.js';
import { toast } from './ui/toast.js';
import { notify } from './notify.js';
import { draft } from './lib/drafts.js';

const POLL_MS = 2500;
let lastJson = '';
let lastRest = '';
let loaded = false;

export async function load() {
  try {
    const text = await api.state();
    setOnline(true);
    if (text === lastJson) { setProblem(''); return; }
    // leads: the threads with an agent of their own, each with its agent's state. Like the conductor's, it changes
    // with every step an agent takes, so it's kept apart from what redraws the board.
    const s = JSON.parse(text), { conductor, leads, ...rest } = s;
    lastJson = text;
    const restJson = JSON.stringify(rest);
    if (restJson !== lastRest) { lastRest = restJson; apply(s); }
    state.meta.conductor = conductor || { state: 'none' };
    state.meta.leads = leads || [];
    emit('conductor');
    setProblem('');
  } catch (e) {
    if (e.offline) { setOnline(false); return; }
    setOnline(true);
    setProblem(e.message || 'It answered with something Rocco can\'t read');
  }
}

// After the user changes something: load now, even if the text looks the same.
export function refresh() { lastJson = ''; lastRest = ''; return load(); }

// A different project: forget the old one, so its changes don't toast.
export function reset() { lastJson = ''; lastRest = ''; loaded = false; state.others = []; state.extra.clear(); }

export function start() {
  load();
  setInterval(load, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}

// Task files (screenshots, audio options, pictures on questions) by name become addresses; data: and blob: ones are already addresses.
const fileUrl = (t, name) => !name || /^(data|blob|https?):/.test(name) ? name : api.file(t.id, name);

// A task as the server sends it, made ready to show: its lists always there, its files as addresses.
export const taskFrom = t => ({
  ...t,
  options: t.options || [],
  log: t.log || [],
  shots: (t.shots || []).map(name => fileUrl(t, name)),
  questions: (t.questions || []).map(q => ({ ...q, images: (q.images || []).map(name => fileUrl(t, name)),
    options: (q.options || []).map(o => ({ ...o, audio: fileUrl(t, o.audio), image: fileUrl(t, o.image) })) })),
});

// The other projects that want the user (a card stuck or ready to test, their conductor asking): said once when one
// starts to, so work in another game isn't left waiting. The project picker shows them all the while (sidebar.js).
function others(list) {
  const wants = o => (o.stuck || 0) + (o.ready || 0) + (o.asks || 0);
  const before = new Map(state.others.map(o => [o.id, wants(o)]));
  if (loaded) for (const o of list) {
    if (wants(o) <= (before.get(o.id) || 0)) continue;
    const what = [o.asks && 'its conductor is asking you something', o.stuck && `${o.stuck} stuck`, o.ready && `${o.ready} to test`].filter(Boolean).join(', ');
    const message = `${o.name}: ${what}`;
    toast(message, 'var(--amber)', { label: 'Open it', run: () => emit('open-project', o.id) }, 8000);
    notify('Rocco', message, () => emit('open-project', o.id));
  }
  state.others = list;
}

function apply(s) {
  // A different Rocco answering: it updated itself and restarted.
  if (state.rocco && s.rocco && s.rocco !== state.rocco) emit('rocco-updated', s.rocco);
  state.rocco = s.rocco || state.rocco;
  const before = new Map(state.tasks.map(t => [t.id, t.status]));
  state.meta = { project: s.project, lanes: s.lanes || { count: 0, open: [], main: false }, conductor: s.conductor || { state: 'none' }, leads: s.leads || [], main: s.main || {} };
  others(s.others || []);
  state.tasks = (s.tasks || []).map(taskFrom);
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
  // What was being typed on a task that's gone goes with it.
  const ids = state.tasks.map(t => t.id);
  for (const kind of ['sheet:', 'reply:', 'answers:']) draft.prune(kind, ids);
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
  if (!value) state.problem = '';
  emit('side');
}

// The server answered with an error: say so once, and again only if what it says changes.
function setProblem(message) {
  if (state.problem === message) return;
  state.problem = message;
  if (message) toast(`Rocco couldn't read the board: ${message}`, 'var(--red)', null, 8000);
  emit('side');
}
