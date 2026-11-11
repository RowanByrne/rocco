// Every call to the Rocco server (server/http.ps1). With ?demo in the address, src/demo.js answers instead.
import { state } from './state.js';
import * as demo from './demo.js';

export const DEMO = new URLSearchParams(location.search).has('demo');

const withProject = (path, extra = '') => `${path}?p=${encodeURIComponent(state.project)}${extra}`;
// The thread a call is about, when it isn't the conductor's.
const inThread = thread => thread ? `&t=${encodeURIComponent(thread)}` : '';

// An error says which kind it is: offline (no answer at all: the server stopped), or status (it answered with an error,
// and the message is what it said).
async function request(path, options) {
  let res;
  try { res = await fetch(path, { cache: 'no-store', ...options }); }
  catch { throw Object.assign(new Error("The Rocco server can't be reached"), { offline: true }); }
  if (!res.ok) throw Object.assign(new Error((await res.text()) || res.statusText), { status: res.status });
  return res;
}
const getJson = async path => (await request(path)).json();
// Writes carry X-Rocco: a page on another site can't add it without a preflight the server never answers.
const post = async (path, body, type = 'application/json') => (await request(path, {
  method: 'POST',
  headers: { 'Content-Type': type, 'X-Rocco': '1' },
  body: type === 'application/json' ? JSON.stringify(body || {}) : body,
})).json();

export const api = {
  projects: () => DEMO ? demo.projects() : getJson('/api/projects'),
  // The raw text, so the caller can skip work when nothing changed.
  state: async () => DEMO ? demo.snapshot() : (await request(withProject('/api/state'))).text(),
  me: () => DEMO ? demo.me() : getJson('/api/me'),
  connections: force => DEMO ? demo.connections() : getJson(withProject('/api/connections', force ? '&refresh=1' : '')),
  history: () => DEMO ? demo.history() : getJson(withProject('/api/history')),
  // hold: the task is made but not handed to the conductor yet, so its screenshots can go up first; release hands it over.
  note: (text, type, hold = false) => DEMO ? demo.note(text, type, hold) : post(withProject('/api/note'), { text, type, hold }),
  release: id => DEMO ? demo.release(id) : post(withProject(`/api/tasks/${id}/release`), {}),
  shot: (id, file) => DEMO ? demo.shot(id, file) : post(withProject(`/api/tasks/${id}/shot`), file, file.type),
  act: (id, action, text) => DEMO ? demo.act(id, action, text) : post(withProject(`/api/tasks/${id}/${action}`), { text }),
  // Up next in this order; the server refuses an order that puts a task before one it needs.
  order: ids => DEMO ? demo.order(ids) : post(withProject('/api/order'), { ids }),
  changes: id => DEMO ? demo.changes(id) : getJson(withProject(`/api/tasks/${id}/changes`)),
  // One of those files' lines as git shows them: { path, text, binary, cut }.
  diff: (id, path) => DEMO ? demo.diff(id, path) : getJson(withProject(`/api/tasks/${id}/diff`, `&path=${encodeURIComponent(path)}`)),
  // One task by its id, on the board or put away: what a link to a task opens.
  task: id => DEMO ? demo.task(id) : getJson(withProject(`/api/tasks/${id}`)),
  // What the board no longer shows (approved more than a few days ago, or deleted), newest first, 50 at a time,
  // narrowed to tasks with every word of q: { total, skip, tasks }.
  archive: (q = '', skip = 0) => DEMO ? demo.archive(q, skip) : getJson(withProject('/api/archive', `&q=${encodeURIComponent(q)}&skip=${skip}`)),
  // What each task took: its time at work, and the tokens its sessions used (server/sessions.ps1).
  usage: () => DEMO ? demo.usage() : getJson(withProject('/api/usage')),
  // The output of a check a worker ran (rocco.ps1 result -File), as text.
  checkOutput: async (id, name) => DEMO ? demo.checkOutput(id, name) : (await request(withProject(`/files/${id}/${encodeURIComponent(name)}`))).text(),
  // A card's agent sessions (server/sessions.ps1), then one's lines from a byte offset: { text, next }.
  sessions: id => DEMO ? demo.sessions(id) : getJson(withProject(`/api/tasks/${id}/sessions`)),
  session: async (id, key, from) => {
    if (DEMO) return demo.session(id, key, from);
    const res = await request(withProject(`/api/tasks/${id}/session`, `&key=${encodeURIComponent(key)}&from=${from}`));
    return { text: await res.text(), next: Number(res.headers.get('X-Next')) || from };
  },
  docs: () => DEMO ? demo.docs() : getJson(withProject('/api/docs')),
  doc: path => DEMO ? demo.doc(path) : getJson(withProject('/api/docs/file', `&path=${encodeURIComponent(path)}`)),
  // The user's edit, committed on main and pushed. { conflict, hash } instead if the doc changed since base.
  saveDoc: (path, text, base, message) => DEMO ? demo.saveDoc(path, text, base, message) : post(withProject('/api/docs/save'), { path, text, base, message }),
  bookmark: hash =>DEMO ? demo.bookmark(hash) : post(withProject('/api/history/bookmark'), { hash }),
  // Accounts linked on this PC; the key is only ever sent, never read back.
  link: (service, key) => DEMO ? demo.link(service, key) : post(withProject(`/api/links/${service}`), { key }),
  unlink: service => DEMO ? demo.unlink(service) : post(withProject(`/api/links/${service}/remove`)),
  // A Connections row's button: { message } once it's done, or { run, label } for an update in its own window.
  action: (id, value) => DEMO ? demo.action(id, value) : post(withProject(`/api/actions/${id}`), { value }),
  actionRun: run => DEMO ? demo.actionRun(run) : getJson(`/api/actions/runs/${run}`),
  // Rocco moves to a newer release and restarts; the page reloads when the new version answers.
  updateRocco: tag => DEMO ? demo.updateRocco() : post(withProject('/api/rocco/update'), { tag }),
  send: () =>DEMO ? demo.send() : post(withProject('/api/send')),
  // Stop Rocco, and the Lync servers it runs with no windows (Settings).
  quit: () => DEMO ? Promise.resolve({ ok: true }) : post('/api/rocco/quit?p=' + encodeURIComponent(state.project)),
  // This PC's coding agent (server/agents.ps1).
  agent: () => DEMO ? demo.agent() : getJson('/api/agent'),
  setAgent: id => DEMO ? demo.setAgent(id) : post(withProject('/api/agent'), { id }),
  // The model the next conductor is opened on ('' for the agent's own default).
  setAgentModel: model => DEMO ? demo.setAgentModel(model) : post(withProject('/api/agent/model'), { model }),
  // The user's own accounts on this PC: each agent's sign-in, Codex for images, GitHub, and the linked keys (server/accounts.ps1).
  accounts: refresh => DEMO ? demo.accounts() : getJson(`/api/accounts${refresh ? '?refresh=1' : ''}`),
  // Onboarding (server/onboarding.ps1). A game being made isn't the open project yet, so these name theirs.
  survey: () => DEMO ? demo.survey() : getJson('/api/onboarding/survey'),
  onboarding: () => DEMO ? demo.onboarding() : getJson(withProject('/api/onboarding')),
  saveAnswers: (project, body) => DEMO ? demo.saveAnswers(project, body) : post(`/api/onboarding/answers?p=${encodeURIComponent(project)}`, body),
  startSetup: (project, part, tiles) => DEMO ? demo.startSetup(project, part, tiles) : post(`/api/onboarding/setup?p=${encodeURIComponent(project)}`, { part, tiles }),
  // { name, code, repo, existing: { kind, from } }: a new game, or one brought in. Returns { job }.
  newProject: details => DEMO ? demo.newProject(details) : post('/api/projects/new', details),
  // This PC's lanes (server/lanes.ps1): its memory and threads with a suggested number, and opening them in the
  // background ({ job }). A count records this PC's number first; without one, the lanes it has are opened.
  laneAdvice: project => DEMO ? demo.laneAdvice() : getJson(project ? `/api/lanes?p=${encodeURIComponent(project)}` : '/api/lanes'),
  openLanes: (project, count = null) => DEMO ? demo.openLanes(project, count) : post(`/api/lanes?p=${encodeURIComponent(project || state.project)}`, { count }),
  // The user's agent as this project's conductor, when none is running (server/conductor.ps1): { agent }.
  openConductor: () => DEMO ? demo.openConductor() : post(withProject('/api/conductor')),
  // A thread (server/thread.ps1): its history (only if it changed since stamp), and the user's side of it. thread:
  // '' for the conductor's (the main chat), or the id of a feature or card with an agent of its own (server/leads.ps1).
  conductorThread: (stamp, thread = '') => DEMO ? demo.conductorThread(stamp, thread) : getJson(withProject('/api/conductor/thread', (stamp ? `&stamp=${encodeURIComponent(stamp)}` : '') + inThread(thread))),
  conductorAnswer: (id, answers, text, thread = '') => DEMO ? demo.conductorAnswer(id, answers, text, thread) : post(withProject('/api/conductor/answer', inThread(thread)), { id, answers, text }),
  conductorPermission: (id, allow, thread = '') => DEMO ? demo.conductorPermission(id, allow, thread) : post(withProject('/api/conductor/permission', inThread(thread)), { id, allow }),
  conductorMessage: (text, to, thread = '') => DEMO ? demo.conductorMessage(text, to, thread) : post(withProject('/api/conductor/message', inThread(thread)), { text, to }),
  showConductor: (thread = '') => DEMO ? demo.showConductor() : post(withProject('/api/conductor/show-window', inThread(thread))),
  // An agent has stopped answering: its session is ended and a new one opened on what's on the board. { agent }.
  restartConductor: (thread = '') => DEMO ? demo.restartConductor(thread) : post(withProject('/api/conductor/restart', inThread(thread))),
  // Whether a feature the user approves gets an agent of its own, on this PC (Settings).
  setLeads: on => DEMO ? demo.setLeads(on) : post(withProject('/api/agent/leads'), { on }),
  job: id => DEMO ? demo.job(id) : getJson(`/api/jobs/${id}`),
  // Stops a background job (a new project, opening lanes) and whatever it started.
  cancelJob: id => DEMO ? demo.cancelJob(id) : post(`/api/jobs/${id}/cancel`),
  file: (taskId, name) => withProject(`/files/${taskId}/${encodeURIComponent(name)}`),
  // A picture on one of the conductor's questions: '<question id>/<file>'. data: ones (the demo's) are already addresses.
  conductorFile: (rel, thread = '') => /^(data|blob|https?):/.test(rel) ? rel : withProject(`/files/conductor/${rel.split('/').map(encodeURIComponent).join('/')}`, inThread(thread)),
  // Updates: the calendar's cards (live/CALENDAR.md) and the game page's events.
  updates: force => DEMO ? demo.updates() : getJson(withProject('/api/updates', force ? '&refresh=1' : '')),
  saveUpdate: card => DEMO ? demo.saveUpdate(card) : post(withProject('/api/updates/save'), card),
  removeUpdate: id => DEMO ? demo.removeUpdate(id) : post(withProject('/api/updates/remove'), { id }),
  queueUpdateEvent: id => DEMO ? demo.queueUpdateEvent(id) : post(withProject('/api/updates/queue'), { id }),
  setUpdateLead: days => DEMO ? demo.setUpdateLead(days) : post(withProject('/api/updates/lead'), { days }),
  pickCardImage: (id, image) => DEMO ? demo.pickCardImage(id, image) : post(withProject('/api/updates/image'), { id, image }),
  publishEvent: eventId => DEMO ? demo.publishEvent(eventId) : post(withProject('/api/updates/publish'), { eventId }),
  // Thumbnails: the game page's, directions, and concepts made with Codex.
  thumbnails: force => DEMO ? demo.thumbnails() : getJson(withProject('/api/thumbnails', force ? '&refresh=1' : '')),
  makeConcepts: (direction, count) => DEMO ? demo.makeConcepts(direction, count) : post(withProject('/api/thumbnails/generate'), { direction, count }),
  // Stops the concepts being made. The ones already made stay.
  cancelConcepts: () => DEMO ? demo.cancelConcepts() : post(withProject('/api/thumbnails/cancel')),
  useConcept: file => DEMO ? demo.useConcept(file) : post(withProject('/api/thumbnails/use'), { file }),
  askDirections: () => DEMO ? demo.askDirections() : post(withProject('/api/thumbnails/directions')),
  // A candidate image in ..\art\generated: 'thumbnails/<direction>/<file>' or 'events/<card>/<file>'.
  artFile: rel => DEMO ? demo.artFile(rel) : withProject(`/files/art/${rel.split('/').map(encodeURIComponent).join('/')}`),
};
